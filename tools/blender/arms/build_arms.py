"""builds public/viewmodels/v2/arms.glb from scratch.

  blender -b --factory-startup --python-exit-code 1 -P tools/blender/arms/build_arms.py -- \
      --out .blender-tmp/arms/arms_raw.glb [--renders docs/screenshots/arms] [--fast]
  npx tsx tools/assets/optimize-glb.ts .blender-tmp/arms/arms_raw.glb public/viewmodels/v2/arms.glb --texture-size 1024

steps: sdf glove -> openvdb mesh -> decimate -> project back onto the sdf,
lofted skin and sleeve tubes, one packed uv atlas, texel space procedural
textures baked with cycles, mirror to the left arm, armature + custom
weights, the watch on forearm_twist_l, gltf export, optional posed renders.
see docs/assets/arms.md.
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
import hand as H  # noqa: E402
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
    ap.add_argument("--voxel", type=float, default=0.08, help="sdf voxel size in cm")
    ap.add_argument("--glove-tris", type=int, default=10600)
    ap.add_argument("--bake-size", type=int, default=2048)
    ap.add_argument("--no-textures", action="store_true")
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


def triangulate_ngons(obj):
    """mikktspace in the exporter only takes tris and quads"""
    import bmesh

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    ngons = [f for f in bm.faces if len(f.verts) > 4]
    if ngons:
        bmesh.ops.triangulate(bm, faces=ngons, quad_method="BEAUTY", ngon_method="BEAUTY")
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


# ---------------------------------------------------------------- glove
def build_glove(shape, voxel, target_tris):
    bmin, bmax = shape.bounds()
    verts, faces = sdf.mesh_sdf(shape.sdf, bmin, bmax, voxel)
    log(f"glove sdf mesh {len(verts)} verts {len(faces)} faces at {voxel} cm voxels")
    obj = mesh_object("glove_r", hand_cm_to_world(verts), faces)
    # the dense surface nets mesh is uniform, decimate to the budget
    tris = tri_count(obj)
    mod = obj.modifiers.new("decimate", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = min(1.0, target_tris / tris)
    mod.use_collapse_triangulate = True
    apply_modifiers(obj)
    # put every vertex back on the exact surface
    co = world_to_hand_cm(get_co(obj))
    co = sdf.project_to_surface(shape.sdf, co, eps=0.01, iterations=3)
    set_co(obj, hand_cm_to_world(co))
    relax_on_surface(obj, shape, iterations=6)
    log(f"glove low poly {tri_count(obj)} tris")
    return obj


def relax_on_surface(obj, shape, iterations=4, strength=0.5):
    """tangential laplacian smoothing, reprojected onto the sdf each pass,
    evens out the decimated triangles without changing the shape"""
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
        g = sdf.gradient(shape.sdf, co, 0.01)
        g /= np.maximum(np.linalg.norm(g, axis=1, keepdims=True), 1e-9)
        delta = avg - co
        delta -= g * np.sum(delta * g, axis=1, keepdims=True)
        co = co + strength * delta
        co = sdf.project_to_surface(shape.sdf, co, eps=0.01, iterations=2)
    set_co(obj, hand_cm_to_world(co))


# ---------------------------------------------------------------- uv atlas
def smart_uv(obj, angle=62.0):
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


def scale_uvs(obj, factor, face_mask=None):
    me = obj.data
    uv = np.zeros(len(me.loops) * 2, dtype=np.float32)
    me.uv_layers.active.data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    if face_mask is None:
        uv *= factor
    else:
        loop_face = np.zeros(len(me.loops), dtype=np.int64)
        for poly in me.polygons:
            loop_face[poly.loop_start:poly.loop_start + poly.loop_total] = poly.index
        sel = np.asarray(face_mask)[loop_face]
        uv[sel] *= factor
    me.uv_layers.active.data.foreach_set("uv", uv.ravel())


def uv_to_3d_ratio(obj):
    """sqrt(uv area / 3d area) so objects can be brought to one texel density"""
    me = obj.data
    uv = np.zeros(len(me.loops) * 2, dtype=np.float32)
    me.uv_layers.active.data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    co = get_co(obj)
    a_uv = 0.0
    a_3d = 0.0
    for poly in me.polygons:
        idx = list(range(poly.loop_start, poly.loop_start + poly.loop_total))
        vs = [co[me.loops[i].vertex_index] for i in idx]
        us = [uv[i] for i in idx]
        for k in range(1, len(idx) - 1):
            a_3d += 0.5 * np.linalg.norm(np.cross(vs[k] - vs[0], vs[k + 1] - vs[0]))
            e1 = us[k] - us[0]
            e2 = us[k + 1] - us[0]
            a_uv += 0.5 * abs(e1[0] * e2[1] - e1[1] * e2[0])
    return math.sqrt(a_uv / max(a_3d, 1e-12))


def pack_atlas(objs, weights, margin=0.004, island_scale=None):
    """one texel density across objects (times a weight), optional per face
    scale on top (for islands that are rarely seen), then pack together"""
    for obj in objs:
        r = uv_to_3d_ratio(obj)
        scale_uvs(obj, weights.get(obj.name, 1.0) / r)
    for obj, (mask, factor) in (island_scale or {}).items():
        scale_uvs(obj, factor, face_mask=mask)
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
def weights_for(obj, shape=None):
    p_cm = world_to_hand_cm(get_co(obj))
    if shape is not None:
        _, parts = shape.glove_fields(p_cm, want_parts=True)
        w = R.glove_weights(p_cm, parts)
    else:
        w = R.arm_rule(-p_cm[:, 1])
    return R.limit_and_normalize(w)


def check_weights(obj, max_influences=4):
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
        export_tangents=True,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_skins=True,
        export_morph=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
    )
    merged = merge_identical_skins(path)
    log(f"wrote {path} ({os.path.getsize(path) / 1024:.0f} KB), merged {merged} duplicate skins")


def merge_identical_skins(path):
    """the exporter writes one skin per skinned mesh even when they share the
    armature; point every mesh at the first identical skin so the file has a
    single skeleton (unused accessors are dropped later by the optimizer)"""
    import json
    import struct

    with open(path, "rb") as fh:
        data = fh.read()
    magic, version, _ = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67 and version == 2
    off = 12
    chunks = []
    while off < len(data):
        clen, ctype = struct.unpack_from("<II", data, off)
        chunks.append([ctype, data[off + 8:off + 8 + clen]])
        off += 8 + clen
    gltf = json.loads(chunks[0][1].decode("utf-8"))
    binchunk = chunks[1][1] if len(chunks) > 1 else b""
    skins = gltf.get("skins", [])

    def ibm_bytes(skin):
        acc = gltf["accessors"][skin["inverseBindMatrices"]]
        view = gltf["bufferViews"][acc["bufferView"]]
        start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
        return binchunk[start:start + acc["count"] * 64]

    keep, remap = [], {}
    for i, sk in enumerate(skins):
        for j, kept in enumerate(keep):
            if kept["joints"] == sk["joints"] and ibm_bytes(kept) == ibm_bytes(sk):
                remap[i] = j
                break
        else:
            remap[i] = len(keep)
            keep.append(sk)
    if len(keep) == len(skins):
        return 0
    gltf["skins"] = keep
    for node in gltf["nodes"]:
        if "skin" in node:
            node["skin"] = remap[node["skin"]]
    js = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    js += b" " * ((4 - len(js) % 4) % 4)
    out = bytearray(struct.pack("<III", 0x46546C67, 2, 0))
    out += struct.pack("<II", len(js), 0x4E4F534A) + js
    for ctype, payload in chunks[1:]:
        out += struct.pack("<II", len(payload), ctype) + payload
    struct.pack_into("<I", out, 8, len(out))
    with open(path, "wb") as fh:
        fh.write(out)
    return len(skins) - len(keep)


# ---------------------------------------------------------------- main
def main():
    args = parse_args()
    if args.fast:
        args.voxel = max(args.voxel, 0.12)
        args.bake_size = min(args.bake_size, 1024)
    common.reset_scene()
    enable_gpu()
    shape = H.HandShape()

    glove_r = build_glove(shape, args.voxel, args.glove_tris)
    v, f, uv = A.skin_tube()
    skin_r = mesh_object("skin_r", hand_cm_to_world(v), f, uv)
    v, f, uv, islands = A.sleeve_tube()
    sleeve_r = mesh_object("sleeve_r", hand_cm_to_world(v), f, uv)
    log(f"skin {tri_count(skin_r)} tris, sleeve {tri_count(sleeve_r)} tris")

    smart_uv(glove_r, angle=70.0)
    # texel density: glove first, the upper arm part of the sleeve is almost never on screen
    island = np.array(islands)
    pack_weights = {"glove_r": 1.0, "skin_r": 0.72, "sleeve_r": 0.6}
    pack_atlas([glove_r, skin_r, sleeve_r], pack_weights, island_scale={sleeve_r: (island > 0, 0.35)})
    log("uv atlas packed")

    mats = MAT.watch_materials()
    if args.no_textures:
        arm_mats = {
            "mat_glove": MAT.plain("mat_glove", (0.16, 0.165, 0.17), 0.8),
            "mat_sleeve": MAT.plain("mat_sleeve", (0.3, 0.32, 0.22), 0.9),
            "mat_skin": MAT.plain("mat_skin", (0.78, 0.58, 0.47), 0.55),
        }
    else:
        import texture as T

        arm_mats = T.build_arm_textures(glove_r, skin_r, sleeve_r, shape, args.bake_size, log)
    mats.update(arm_mats)
    for obj, key in ((glove_r, "mat_glove"), (skin_r, "mat_skin"), (sleeve_r, "mat_sleeve")):
        obj.data.materials.clear()
        obj.data.materials.append(mats[key])

    glove_l = mirror_object(glove_r, "glove_l")
    skin_l = mirror_object(skin_r, "skin_l")
    sleeve_l = mirror_object(sleeve_r, "sleeve_l")

    arm_obj = R.build_armature("ArmsRig")
    for right, left, use_shape in ((glove_r, glove_l, True), (skin_r, skin_l, False), (sleeve_r, sleeve_l, False)):
        names, Wm = weights_for(right, shape if use_shape else None)
        R.assign_weights(right, names, Wm, "r")
        R.assign_weights(left, names, Wm, "l")
    arm_tris = sum(tri_count(o) for o in (glove_r, glove_l, skin_r, skin_l, sleeve_r, sleeve_l))
    log(f"arm parts: glove {tri_count(glove_r)} x2, skin {tri_count(skin_r)} x2, sleeve {tri_count(sleeve_r)} x2")
    # one skinned mesh (a primitive per material) so the file keeps a single
    # skin after the optimizer quantizes it; hide an arm at runtime by
    # scaling its upperarm bone to zero
    arms = join_objects([glove_r, glove_l, skin_r, skin_l, sleeve_r, sleeve_l], "arms")
    R.bind(arms, arm_obj)
    worst, bad = check_weights(arms)
    log(f"arms: max influences {worst}, non-normalized {bad}")

    empty, watch_objs, watch_tris, frame = W.build_watch(arm_obj, mats, None)
    for obj in watch_objs.values():
        if obj.type == "MESH":
            triangulate_ngons(obj)
    dial_img = _image_from_array("watch_dial_tex", W.draw_dial_texture())
    bezel_img = _image_from_array("watch_bezel_tex", W.draw_bezel_texture())
    MAT.base_color_textured(mats["mat_watch_dial"], dial_img)
    MAT.base_color_textured(mats["mat_watch_bezel"], bezel_img)
    total_watch = sum(watch_tris.values())
    log(f"watch {total_watch} tris: " + ", ".join(f"{k}={v}" for k, v in watch_tris.items()))

    log(f"arms {arm_tris} tris, total {arm_tris + total_watch}")

    objects = [arm_obj, arms, empty] + list(watch_objs.values())
    export_glb(args.out, objects)
    if args.save_blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.save_blend))

    if args.renders:
        import render as RN

        RN.render_all(args.renders, arm_obj, fast=args.fast, log=log)
    log("done")


def _image_from_array(name, rgba_linear, colorspace="sRGB"):
    """numpy (h, w, 4) linear rgba -> packed png image in the blend"""
    h, w = rgba_linear.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=True, float_buffer=False)
    # colour space first: changing it later regenerates (clears) the buffer
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


if __name__ == "__main__":
    main()
