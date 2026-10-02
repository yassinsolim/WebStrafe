"""builds public/viewmodels/v2/arms.glb from scratch: slim cyborg arms.

  blender -b --factory-startup --python-exit-code 1 -P tools/blender/arms/build_arms.py -- \
      --out .blender-tmp/arms/arms_raw.glb [--renders docs/screenshots/arms] [--fast]
  npx tsx tools/assets/optimize-glb.ts .blender-tmp/arms/arms_raw.glb public/viewmodels/v2/arms.glb --texture-size 2048

steps: synthetic muscle sdf (hand + forearm) -> openvdb mesh -> decimate ->
project back onto the sdf, lofted upper arm, every plate / mechanical part /
glow line of the core and the four kits meshed the same way, one packed uv
atlas, texel space normal and orm maps, mirror to the left arm, armature +
custom weights, the watch on forearm_twist_l, gltf export, optional renders.
every piece ends up in one skinned mesh `arms` with one primitive per
material `fp_<set>_<slot>`. see docs/assets/arms.md.
"""

import argparse
import math
import os
import sys
import time

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import common  # noqa: E402
import arm as A  # noqa: E402
import kits as K  # noqa: E402
import materials as MAT  # noqa: E402
import params as P  # noqa: E402
import rig as R  # noqa: E402
import sdf  # noqa: E402
import watch as W  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))


def parse_args():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, ".blender-tmp", "arms", "arms_raw.glb"))
    ap.add_argument("--renders", default=None, help="folder for the preview renders")
    ap.add_argument("--only-renders", default=None, help="comma list of render names")
    ap.add_argument("--voxel", type=float, default=0.075, help="muscle sdf voxel size in cm")
    ap.add_argument("--suit-tris", type=int, default=8500)
    ap.add_argument("--piece-tris", type=float, default=0.6, help="scale on every piece's triangle target")
    ap.add_argument("--bake-size", type=int, default=2048)
    ap.add_argument("--kits", default=",".join(K.KITS))
    ap.add_argument("--pieces", default=None, help="comma list of name substrings to build (iteration)")
    ap.add_argument("--no-textures", action="store_true")
    ap.add_argument("--no-export", action="store_true")
    ap.add_argument("--fast", action="store_true", help="coarse voxels, small bakes, quick renders")
    ap.add_argument("--save-blend", default=None)
    return ap.parse_args(common.script_args())


def log(msg, t0=[time.time()]):
    print(f"[arms {time.time() - t0[0]:6.1f}s] {msg}", flush=True)


def enable_gpu():
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for dev_type in ("METAL", "OPTIX", "CUDA", "HIP", "ONEAPI"):
        try:
            prefs.compute_device_type = dev_type
            break
        except TypeError:
            continue
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type != "CPU"
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "GPU" if any(d.use for d in prefs.devices) else "CPU"
    scene.cycles.seed = 7


# ---------------------------------------------------------------- mesh helpers
def mesh_object(name, verts, faces, uvs=None, smooth=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata(np.asarray(verts, dtype=np.float64).tolist(), [], [list(f) for f in faces])
    if uvs is not None:
        layer = me.uv_layers.new(name="UVMap")
        flat = np.array([c for face in uvs for c in face], dtype=np.float32).ravel()
        layer.data.foreach_set("uv", flat)
    me.polygons.foreach_set("use_smooth", [smooth] * len(me.polygons))
    me.validate(clean_customdata=False)
    me.update()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def get_co(obj):
    co = np.zeros(len(obj.data.vertices) * 3)
    obj.data.vertices.foreach_get("co", co)
    return co.reshape(-1, 3)


def set_co(obj, co):
    obj.data.vertices.foreach_set("co", np.asarray(co, dtype=np.float64).ravel())
    obj.data.update()


def world_to_hand_cm(p):
    return (np.asarray(p) - P.WRIST_R) / P.CM


def hand_cm_to_world(p):
    return P.WRIST_R + np.asarray(p) * P.CM


def apply_modifiers(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    new_me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    old = obj.data
    obj.modifiers.clear()
    obj.data = new_me
    bpy.data.meshes.remove(old)


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def triangulate(obj, ngons_only=True):
    import bmesh

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    faces = [f for f in bm.faces if len(f.verts) > 4] if ngons_only else list(bm.faces)
    if faces:
        bmesh.ops.triangulate(bm, faces=faces, quad_method="BEAUTY", ngon_method="BEAUTY")
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


# ---------------------------------------------------------------- sdf meshing
CACHE_DIR = os.path.join(ROOT, ".blender-tmp", "arms", "mesh-cache")


def _cache_key(name, fn, bounds, voxel, target_tris, relax):
    """meshing is the slow part: reuse a piece while its field is unchanged,
    fingerprinted by sampling it at fixed points inside its bounds"""
    import hashlib

    rng = np.random.default_rng(7)
    pts = bounds[0] + rng.random((4096, 3)) * (np.asarray(bounds[1]) - bounds[0])
    h = hashlib.sha1(np.round(fn(pts), 6).tobytes())
    h.update(repr((name, np.round(bounds[0], 5).tolist(), np.round(bounds[1], 5).tolist(), voxel, target_tris,
                   relax)).encode())
    return os.path.join(CACHE_DIR, f"{name}-{h.hexdigest()[:16]}.npz")


def build_sdf_object(name, fn, bounds, voxel, target_tris, relax=4):
    path = _cache_key(name, fn, bounds, voxel, target_tris, relax)
    if os.path.exists(path):
        data = np.load(path)
        faces = data["faces"]
        return mesh_object(name, data["co"], [tuple(f) for f in faces])
    obj = _mesh_sdf_object(name, fn, bounds, voxel, target_tris, relax)
    triangulate(obj, ngons_only=False)
    os.makedirs(CACHE_DIR, exist_ok=True)
    faces = np.array([tuple(p.vertices) for p in obj.data.polygons], dtype=np.int64)
    np.savez(path, co=get_co(obj), faces=faces)
    return obj


def _mesh_sdf_object(name, fn, bounds, voxel, target_tris, relax=4):
    bmin, bmax = bounds
    verts, faces = sdf.mesh_sdf(fn, bmin, bmax, voxel)
    if len(faces) == 0:
        raise RuntimeError(f"{name}: the sdf has no surface inside its bounds")
    obj = mesh_object(name, hand_cm_to_world(verts), faces)
    tris = tri_count(obj)
    if tris > target_tris:
        mod = obj.modifiers.new("decimate", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = target_tris / tris
        mod.use_collapse_triangulate = True
        apply_modifiers(obj)
    co = world_to_hand_cm(get_co(obj))
    eps = min(0.01, voxel * 0.25)
    co = sdf.project_to_surface(fn, co, eps=eps, iterations=3)
    set_co(obj, hand_cm_to_world(co))
    if relax:
        relax_on_surface(obj, fn, eps, iterations=relax)
    _check_box(name, obj, bmin, bmax)
    return obj


def _check_box(name, obj, bmin, bmax):
    """a surface touching the box means the bounds cut the piece open"""
    co = world_to_hand_cm(get_co(obj))
    tol = 1e-3
    if (co.min(axis=0) < bmin + tol).any() or (co.max(axis=0) > bmax - tol).any():
        log(f"warning: {name} touches its bounds {co.min(axis=0).round(2)} {co.max(axis=0).round(2)}")


def relax_on_surface(obj, fn, eps, iterations=4, strength=0.5):
    """tangential laplacian smoothing, reprojected onto the sdf each pass"""
    me = obj.data
    n = len(me.vertices)
    edges = np.zeros(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get("vertices", edges)
    edges = edges.reshape(-1, 2)
    co = world_to_hand_cm(get_co(obj))
    deg = np.bincount(edges.ravel(), minlength=n).astype(np.float64)
    for _ in range(iterations):
        acc = np.zeros_like(co)
        np.add.at(acc, edges[:, 0], co[edges[:, 1]])
        np.add.at(acc, edges[:, 1], co[edges[:, 0]])
        avg = acc / np.maximum(deg, 1)[:, None]
        g = sdf.gradient(fn, co, eps)
        g /= np.maximum(np.linalg.norm(g, axis=1, keepdims=True), 1e-9)
        delta = avg - co
        delta -= g * np.sum(delta * g, axis=1, keepdims=True)
        co = co + strength * delta
        co = sdf.project_to_surface(fn, co, eps=eps, iterations=2)
    set_co(obj, hand_cm_to_world(co))


# ---------------------------------------------------------------- uv atlas
def smart_uv(obj, angle=38.0):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    if not obj.data.uv_layers:
        obj.data.uv_layers.new(name="UVMap")
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=0.0, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")


def scale_uvs(obj, factor):
    me = obj.data
    uv = np.zeros(len(me.loops) * 2, dtype=np.float32)
    me.uv_layers.active.data.foreach_get("uv", uv)
    me.uv_layers.active.data.foreach_set("uv", uv * factor)


def uv_to_3d_ratio(obj):
    """sqrt(uv area / 3d area) so objects can be brought to one texel density"""
    me = obj.data
    me.calc_loop_triangles()
    uv = np.zeros(len(me.loops) * 2, dtype=np.float64)
    me.uv_layers.active.data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    co = get_co(obj)
    loops = np.zeros(len(me.loop_triangles) * 3, dtype=np.int64)
    me.loop_triangles.foreach_get("loops", loops)
    verts = np.zeros(len(me.loop_triangles) * 3, dtype=np.int64)
    me.loop_triangles.foreach_get("vertices", verts)
    loops = loops.reshape(-1, 3)
    verts = verts.reshape(-1, 3)
    a3 = 0.5 * np.linalg.norm(np.cross(co[verts[:, 1]] - co[verts[:, 0]], co[verts[:, 2]] - co[verts[:, 0]]), axis=1).sum()
    e1 = uv[loops[:, 1]] - uv[loops[:, 0]]
    e2 = uv[loops[:, 2]] - uv[loops[:, 0]]
    auv = 0.5 * np.abs(e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0]).sum()
    return math.sqrt(auv / max(a3, 1e-12))


def pack_atlas(objs, weights, margin=0.0025):
    """one texel density across objects (times a weight), then pack together"""
    for obj in objs:
        scale_uvs(obj, weights.get(obj.name, 1.0) / uv_to_3d_ratio(obj))
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objs:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(udim_source="CLOSEST_UDIM", rotate=True, scale=True, margin_method="FRACTION",
                            margin=margin, shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")


def uv_overlap_texels(objs, size):
    """texel centres covered by more than one triangle across the atlas"""
    count = np.zeros((size, size), dtype=np.int32)
    for obj in objs:
        me = obj.data
        me.calc_loop_triangles()
        uv = np.zeros(len(me.loops) * 2)
        me.uv_layers.active.data.foreach_get("uv", uv)
        uv = uv.reshape(-1, 2) * size
        loops = np.zeros(len(me.loop_triangles) * 3, dtype=np.int64)
        me.loop_triangles.foreach_get("loops", loops)
        for a, b, c in uv[loops].reshape(-1, 3, 2):
            lo = np.clip(np.floor(np.minimum(np.minimum(a, b), c)).astype(int), 0, size - 1)
            hi = np.clip(np.ceil(np.maximum(np.maximum(a, b), c)).astype(int), 0, size)
            px, py = np.meshgrid(np.arange(lo[0], hi[0]) + 0.5, np.arange(lo[1], hi[1]) + 0.5)
            d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
            if abs(d) < 1e-12:
                continue
            l1 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / d
            l2 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / d
            inside = (l1 > 1e-4) & (l2 > 1e-4) & (1.0 - l1 - l2 > 1e-4)
            count[py[inside].astype(int), px[inside].astype(int)] += 1
    return int((count > 1).sum())


# ---------------------------------------------------------------- left side
def mirror_object(src, name):
    me = src.data.copy()
    me.name = name
    co = np.zeros(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    co[:, 0] *= -1.0
    me.vertices.foreach_set("co", co.ravel())
    me.flip_normals()
    me.update()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    for k, v in src.items():
        obj[k] = v
    return obj


def join_objects(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    joined.name = name
    joined.data.name = name
    return joined


# ---------------------------------------------------------------- weights
def weights_for(obj, kind, piece=None):
    p = world_to_hand_cm(get_co(obj))
    if kind == "suit":
        _, parts = K.SUIT.fields(p, want_parts=True)
        w = R.glove_weights(p, parts)
    elif kind == "upper" or piece.rig == "arm":
        w = R.arm_rule(-p[:, 1])
    elif isinstance(piece.rig, tuple):
        segs = K.digit_segments(piece.rig[1])
        d = np.stack([sdf.dist_segment(p, a, b) for a, b, *_ in segs], axis=1)
        pick = np.argmin(d, axis=1)
        w = {seg[6]: (pick == i).astype(np.float64) for i, seg in enumerate(segs)}
    else:
        w = {piece.rig: np.ones(len(p))}
    return R.limit_and_normalize(w)


def check_weights(obj):
    worst = 0
    bad_sum = 0
    for v in obj.data.vertices:
        ws = [g.weight for g in v.groups if g.weight > 0]
        worst = max(worst, len(ws))
        if abs(sum(ws) - 1.0) > 2e-3:
            bad_sum += 1
    return worst, bad_sum


# ---------------------------------------------------------------- export
def export_glb(path, objects):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_extras=False,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_skins=True,
        export_morph=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
    )
    log(f"wrote {path} ({os.path.getsize(path) / 1024:.0f} KB)")


def _image_from_array(name, rgba_linear, colorspace="sRGB"):
    """numpy (h, w, 4) linear rgba -> packed png image in the blend"""
    h, w = rgba_linear.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=True, float_buffer=False)
    img.colorspace_settings.name = colorspace
    data = rgba_linear.copy()
    if colorspace == "sRGB":
        c = np.clip(data[..., :3], 0, 1)
        data[..., :3] = np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)
    img.pixels.foreach_set(np.clip(data, 0, 1).astype(np.float32).ravel())
    tmp = os.path.join(ROOT, ".blender-tmp", "arms", "tex")
    os.makedirs(tmp, exist_ok=True)
    img.filepath_raw = os.path.join(tmp, f"{name}.png")
    img.file_format = "PNG"
    img.save()
    return img


# ---------------------------------------------------------------- main
def main():
    args = parse_args()
    if args.fast:
        args.voxel = max(args.voxel, 0.12)
        args.bake_size = min(args.bake_size, 1024)
    vscale = 1.6 if args.fast else 1.0
    kits = [k for k in args.kits.split(",") if k]
    common.reset_scene()
    enable_gpu()
    shape = K.SUIT

    suit_r = build_sdf_object("suit_r", shape.sdf, shape.bounds(), args.voxel, args.suit_tris, relax=6)
    suit_r["kind"] = "suit"
    log(f"muscle suit {tri_count(suit_r)} tris")
    v, f, uv = A.upperarm_tube()
    upper_r = mesh_object("upper_r", hand_cm_to_world(v), f, uv)
    upper_r["kind"] = "upper"

    pieces = [pc for pc in K.all_pieces() if pc.set == "core" or pc.set in kits]
    if args.pieces:
        keys = args.pieces.split(",")
        pieces = [pc for pc in pieces if any(k in pc.name for k in keys)]
    built = []
    for pc in pieces:
        obj = build_sdf_object(f"{pc.name}_r", pc.fn, pc.bounds, pc.voxel * vscale, max(60, int(pc.tris * args.piece_tris)),
                               relax=2 if pc.style != "glow" else 1)
        obj["kind"] = "piece"
        obj["set"] = pc.set
        obj["slot"] = pc.slot
        built.append((pc, obj))
    log(f"{len(built)} pieces, {sum(tri_count(o) for _, o in built)} tris")

    right = [suit_r, upper_r] + [o for _, o in built]
    for obj in right:
        if obj is not upper_r:
            smart_uv(obj)
    weights = {"upper_r": 0.4}
    for pc, obj in built:
        weights[obj.name] = 0.3 if pc.style == "glow" else 1.0
    pack_atlas(right, weights)
    if not args.fast and not args.no_textures:
        overlap = uv_overlap_texels(right, args.bake_size)
        log(f"uv atlas packed, {overlap} texels shared by two triangles")
        # a few hundred texels out of millions are smart project slivers on plate rims
        if overlap > 500:
            raise RuntimeError(f"uv atlas has {overlap} overlapping texels")

    by_name = {obj.name: pc for pc, obj in built}
    if args.no_textures:
        images = None
    else:
        import texture as T

        images = T.build_textures(suit_r, upper_r, built, args.bake_size, log)
    mats = MAT.watch_materials()
    fp_mats = {}

    def fp_mat(set_id, slot):
        key = f"fp_{set_id}_{slot}"
        if key not in fp_mats:
            fp_mats[key] = MAT.cyborg(key, slot, images)
        return fp_mats[key]

    for obj in right:
        obj.data.materials.clear()
        if obj["kind"] in ("suit", "upper"):
            obj.data.materials.append(fp_mat("core", "muscle"))
        else:
            obj.data.materials.append(fp_mat(obj["set"], obj["slot"]))

    arm_obj = R.build_armature("ArmsRig")
    everything = []
    for obj in right:
        pc = by_name.get(obj.name)
        side = pc.side if pc is not None else "both"
        names, Wm = weights_for(obj, obj["kind"], pc)
        made = []
        # mirror before any weights go in, the copy would carry the right side's groups
        left = mirror_object(obj, obj.name[:-2] + "_l") if side in ("both", "l") else None
        if side in ("both", "r"):
            R.assign_weights(obj, names, Wm, "r")
            made.append(obj)
        if left is not None:
            R.assign_weights(left, names, Wm, "l")
            made.append(left)
        if side == "l":
            bpy.data.objects.remove(obj, do_unlink=True)
        for o in made:
            R.bind(o, arm_obj)
            everything.append(o)

    empty, watch_objs, watch_tris, frame = W.build_watch(arm_obj, mats, None)
    for obj in watch_objs.values():
        if obj.type == "MESH":
            triangulate(obj)
    dial_img = _image_from_array("watch_dial_tex", W.draw_dial_texture())
    bezel_img = _image_from_array("watch_bezel_tex", W.draw_bezel_texture())
    MAT.base_color_textured(mats["mat_watch_dial"], dial_img)
    MAT.base_color_textured(mats["mat_watch_bezel"], bezel_img)
    log(f"watch {sum(watch_tris.values())} tris")

    if args.renders:
        import render as RN

        only = args.only_renders.split(",") if args.only_renders else None
        RN.render_all(args.renders, arm_obj, everything, kits, fast=args.fast, log=log, only=only)

    if args.no_export:
        log("done (no export)")
        return

    for obj in everything:
        triangulate(obj)
    arms = join_objects(everything, "arms")
    worst, bad = check_weights(arms)
    log(f"arms: {tri_count(arms)} tris, max influences {worst}, non-normalized {bad}")

    export_glb(args.out, [arm_obj, arms, empty] + list(watch_objs.values()))
    if args.save_blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.save_blend))
    log("done")


if __name__ == "__main__":
    main()
