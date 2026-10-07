"""builds public/characters/armor.glb, the armored character part library,
and its baked atlas. normally run through tools/characters/build-armor.sh.

  npx tsx tools/characters/export-rig.ts           # only when the skeleton changes
  blender -b --python-exit-code 1 -P tools/blender/characters/build_characters.py -- \\
      --out .blender-tmp/characters/armor_raw.glb [--sets strafe,anvil] [--atlas 4096]

the body is an MPFB2 human (mpfb_body.py, needs the extension) conformed onto
the game skeleton (rig.json). the armor sets are polygon plates from the plate
kit (armor_sets.py, armorkit.py). every full-resolution piece is uv packed
into one shared atlas, lods are cut from it (custom normals carried over from
the full piece), and the atlas is baked on lod0 (bake_atlas.py). each lod mesh
carries a material slot, rigid or blended skin weights and set/slot extras;
the runtime merges whatever pieces a player picked into one skinned mesh per
lod. see docs/assets/characters.md.
"""

import argparse
import os
import sys

import bmesh
import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import common  # noqa: E402
import cbuild as B  # noqa: E402
import csdf as S  # noqa: E402
from body import body_sdf, body_weights  # noqa: E402
from parts import Anchor, Part, mirror_bone  # noqa: E402
from rig import Rig  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ALL_SETS = ["strafe", "anvil", "vector", "quill", "edge"]


def parse_args():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, ".blender-tmp", "characters", "armor_raw.glb"))
    ap.add_argument("--sets", default=",".join(ALL_SETS))
    ap.add_argument("--renders", default=None, help="folder for blender preview renders")
    ap.add_argument("--fast", action="store_true", help="coarser voxels for quick looks")
    ap.add_argument("--only", default="", help="comma list of slots to build (debug)")
    ap.add_argument("--save-blend", default=None)
    ap.add_argument("--no-body", action="store_true", help="skip the undersuit (per-set parallel builds)")
    ap.add_argument("--lod0-scale", type=float, default=1.0, help="multiplies every lod0 budget")
    ap.add_argument("--adaptivity", type=float, default=0.0, help="openvdb adaptivity before decimation")
    ap.add_argument("--body", default="mpfb", choices=["mpfb", "sdf"], help="undersuit source")
    ap.add_argument("--kit-lod0", type=float, default=0.3, help="lod0 share of the kit pieces as modelled")
    ap.add_argument("--atlas", type=int, default=0, help="uv pack and bake the texture atlas at this size (0 = off)")
    return ap.parse_args(common.script_args())


def body_part(rig, body):
    weights = lambda co: body_weights(rig, co)  # noqa: E731
    return Part("body", "core", "suit", body, "suit", weights=weights, voxel=0.0042, tris=(5200, 2000, 700), symmetric=True)


def split_by_bones(obj, weights, bones, threshold=0.5):
    """moves the faces mostly weighted to `bones` into their own object (gloves off the body)"""
    import bmesh as _bm

    n = len(obj.data.vertices)
    total = np.zeros(n)
    for w in weights.values():
        total += w
    part = np.zeros(n)
    for b in bones:
        if b in weights:
            part += weights[b]
    share = part / np.maximum(total, 1e-9)
    dup = B.copy_object(obj, obj.name + "_split")
    for ob, keep_hands in ((obj, False), (dup, True)):
        bm = _bm.new()
        bm.from_mesh(ob.data)
        bm.verts.ensure_lookup_table()
        dead = [f for f in bm.faces if (np.mean([share[v.index] for v in f.verts]) > threshold) != keep_hands]
        _bm.ops.delete(bm, geom=dead, context="FACES")
        bm.to_mesh(ob.data)
        bm.free()
        ob.data.update()
    return dup


def process_mesh(slot, set_id, name, obj, material, tris, arm, lods=(0, 1, 2)):
    """a ready mesh (vertex groups named after game bones) -> lod copies, bound and tagged"""
    made = []
    for lod in lods:
        target = tris[lod]
        if target <= 0:
            continue
        dup = B.copy_object(obj, f"{slot}.{set_id}.{name}.lod{lod}")
        B.decimate(dup, target, symmetric=True)
        if B.tri_count(dup) > target * 1.5:
            B.decimate(dup, target, symmetric=False)
        dup.data.validate(clean_customdata=False)
        dup.data.polygons.foreach_set("use_smooth", [True] * len(dup.data.polygons))
        n = len(dup.data.vertices)
        B.set_colors(dup, np.tile(np.array([[1.0, 0.0, 0.0, 1.0]]), (n, 1)))
        B.set_material(dup, material)
        dup.parent = arm
        mod = dup.modifiers.new("Armature", "ARMATURE")
        mod.object = arm
        tag(dup, type("P", (), {"slot": slot, "set": set_id, "material": material})(), lod, name)
        made.append(dup)
    B.log(f"{slot}.{set_id}.{name}: lod0 {B.tri_count(made[0]) if made else 0} tris (mesh)")
    return made


def kit_bone_weights(obj, spec, rig):
    """armor_sets bone spec (mpfb names, 'a:0.8,b:0.2' blends, or 'cape') -> game bone weights"""
    import mpfb_body

    n = len(obj.data.vertices)
    if spec == "cape":
        co = B.to_three(B.get_co(obj))
        chain = ["spine_3", "cape_0", "cape_1", "cape_2", "cape_3"]
        ys = np.array([rig.p(b)[1] for b in chain])
        out = {b: np.zeros(n) for b in chain}
        for i, y in enumerate(co[:, 1]):
            k = int(np.clip(np.searchsorted(-ys, -y) - 1, 0, len(chain) - 2))
            t = float(np.clip((ys[k] - y) / max(ys[k] - ys[k + 1], 1e-6), 0, 1))
            out[chain[k]][i] += 1 - t
            out[chain[k + 1]][i] += t
        return out
    out = {}
    for item in spec.split(","):
        name, _, w = item.partition(":")
        bone = mpfb_body.BONE_MAP[name.strip()]
        out[bone] = out.get(bone, np.zeros(n)) + (float(w) if w else 1.0)
    return out


# lod1 and lod2 as shares of lod0
KIT_LODS = ((0, 1.0), (1, 0.4), (2, 0.14))
# thin strips and straps fall apart under collapse, never go below this per piece
KIT_FLOOR = {0: 260, 1: 60, 2: 12}
# finger segments and knuckle caps are tiny and simple, they hold their shape at far fewer
SMALL_FLOOR = {0: 90, 1: 28, 2: 12}


def kit_sources(body, points, sets, slots):
    import armor_sets as AS

    k = AS.Kit(body, points)
    for sid in sets:
        AS.build_set(k, sid, slots)
    anchors = [Anchor(sid, kind, bone, B.to_three(np.array(p[:])), B.to_three(np.array(n[:])), (0, 1, 0), size)
               for sid, kind, bone, p, n, size in k.anchors]
    return k.pieces, anchors


def kit_lods(pieces, rig, arm, lod0_ratio):
    made = []
    per_set = {}
    for ob, spec, mat, slot, sid in pieces:
        name = ob.name.split(".")[-1]
        weights = kit_bone_weights(ob, spec, rig)
        base = B.tri_count(ob)
        floor = SMALL_FLOOR if name.startswith(("finger_", "knuckle_")) else KIT_FLOOR
        for lod, frac in KIT_LODS:
            # helmets fill the frame in the menu and the customize screen: twice the density up close
            ratio = min(1.0, lod0_ratio * (2.0 if slot == "helmet" else 1.0))
            target = max(int(base * frac * ratio), min(base, floor[lod]))
            dup = B.copy_object(ob, f"{slot}.{sid}.{name}.lod{lod}")
            B.decimate(dup, max(12, target))
            dup.data.validate(clean_customdata=False)
            if B.tri_count(dup) < base:
                B.transfer_normals(dup, ob)
            nv = len(dup.data.vertices)
            B.set_colors(dup, np.tile(np.array([[1.0, 0.0, 0.0, 1.0]]), (nv, 1)))
            B.set_material(dup, mat)
            w = kit_bone_weights(dup, spec, rig) if spec == "cape" else {b: np.full(nv, v[0]) for b, v in weights.items()}
            B.bind(dup, arm, w)
            tag(dup, type("P", (), {"slot": slot, "set": sid, "material": mat})(), lod, name)
            made.append(dup)
            if lod == 0:
                per_set[(sid, slot)] = per_set.get((sid, slot), 0) + B.tri_count(dup)
        bpy.data.objects.remove(ob, do_unlink=True)
    for (sid, slot), tris in sorted(per_set.items()):
        B.log(f"{sid}.{slot}: lod0 {tris} tris")
    return made


BODY_TRIS = (7000, 2800, 1000)
HAND_TRIS = (2000, 800, 280)


def mpfb_body_parts(rig, arm, keep=False):
    import mpfb_body

    body, weights, points = mpfb_body.build(rig, with_points=True)
    body.vertex_groups.clear()
    for bone, w in weights.items():
        nz = np.nonzero(w > 1e-4)[0]
        if len(nz) == 0:
            continue
        vg = body.vertex_groups.new(name=bone)
        q = np.round(w[nz], 3)
        for value in np.unique(q):
            vg.add(nz[q == value].tolist(), float(value), "REPLACE")
    ref = B.copy_object(body, "mpfb_reference")
    hands = split_by_bones(body, weights, [b for b in weights if b.startswith(("hand_", "finger_"))], threshold=0.5)
    if keep == "sources":
        ref.vertex_groups.clear()
        return body, hands, ref, points
    made = process_mesh("body", "core", "suit", body, "suit", BODY_TRIS, arm)
    made += process_mesh("body", "core", "hands", hands, "dark", HAND_TRIS, arm)
    bpy.data.objects.remove(body, do_unlink=True)
    bpy.data.objects.remove(hands, do_unlink=True)
    if keep:
        ref.vertex_groups.clear()
        return made, ref, points
    bpy.data.objects.remove(ref, do_unlink=True)
    return made


def mirror_object(src, name, normals):
    dup = B.copy_object(src, name)
    co = B.get_co(dup)
    co[:, 0] *= -1.0
    B.set_co(dup, co)
    bm = bmesh.new()
    bm.from_mesh(dup.data)
    bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    bm.to_mesh(dup.data)
    bm.free()
    mirrored = normals.copy()
    mirrored[:, 0] *= -1.0
    B.set_normals(dup, mirrored)
    # rename the groups via a temporary name so l and r never clash
    for vg in dup.vertex_groups:
        vg.name = "__m_" + mirror_bone(vg.name)
    for vg in dup.vertex_groups:
        vg.name = vg.name[4:]
    return dup


def tag(obj, part, lod, name):
    obj["slot"] = part.slot
    obj["set"] = part.set
    obj["part"] = name
    obj["lod"] = lod
    obj["mat"] = part.material


def process(part, arm, scene_fn, fast, lod0_scale=1.0, adaptivity=0.0):
    voxel = part.voxel * (1.8 if fast else 1.0)
    verts, faces = S.mesh(part.sdf, voxel, adaptivity=adaptivity)
    if len(faces) == 0:
        B.log(f"WARNING {part.slot}.{part.set}.{part.name} is empty")
        return []
    hi = B.mesh_object(f"{part.slot}.{part.set}.{part.name}.hi", verts, faces)
    made = []
    for lod in part.lods:
        target = int(part.tris[lod] * (lod0_scale if lod == 0 else 1.0))
        if target <= 0:
            continue
        name = f"{part.slot}.{part.set}.{part.name}.lod{lod}"
        obj = B.copy_object(hi, name)
        B.decimate(obj, target, symmetric=part.symmetric)
        if B.tri_count(obj) > target * 1.5:
            # symmetric collapse can stall on thin shells, finish without it
            B.decimate(obj, target, symmetric=False)
        obj.data.validate(clean_customdata=False)
        co = S.project(part.sdf, B.get_co(obj))
        B.set_co(obj, co)
        if lod == 0 and part.material in ("suit", "cloth", "trim"):
            B.relax(obj, part.sdf, iterations=2)
        co = B.get_co(obj)
        n = S.normals(part.sdf, co)
        B.set_normals(obj, n)
        ao = S.ambient_occlusion(scene_fn, co + n * 0.001, n)
        wear = S.convexity(part.sdf, co, n)
        rgba = np.stack([ao, wear, np.zeros_like(ao), np.ones_like(ao)], axis=1)
        B.set_colors(obj, rgba)
        B.set_material(obj, part.material)
        B.bind(obj, arm, part.bone if part.bone else part.weights(co))
        tag(obj, part, lod, part.name)
        made.append(obj)
        if part.mirror:
            mname = part.name[:-2] + "_r" if part.name.endswith("_l") else part.name + "_r"
            dup = mirror_object(obj, f"{part.slot}.{part.set}.{mname}.lod{lod}", n)
            tag(dup, part, lod, mname)
            made.append(dup)
    bpy.data.objects.remove(hi, do_unlink=True)
    tris = [B.tri_count(o) for o in made if o.get("lod") == 0]
    B.log(f"{part.slot}.{part.set}.{part.name}: {len(verts)} sdf verts -> lod0 {sum(tris)} tris")
    return made


def add_anchor(anchor):
    """an empty at the decal spot, +z out of the surface, +y up the decal"""
    z = anchor.normal
    y = anchor.up - z * float(anchor.up @ z)
    y = y / max(np.linalg.norm(y), 1e-9)
    x = np.cross(y, z)
    R = np.stack([x, y, z], axis=1)
    # three -> blender basis change on both sides, the exporter undoes it the same way
    C = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], dtype=np.float64)
    Rb = C @ R @ C.T
    from mathutils import Matrix

    M = Matrix(((Rb[0, 0], Rb[0, 1], Rb[0, 2], 0), (Rb[1, 0], Rb[1, 1], Rb[1, 2], 0), (Rb[2, 0], Rb[2, 1], Rb[2, 2], 0), (0, 0, 0, 1)))
    empty = common.add_empty(f"anchor.chest.{anchor.set}.{anchor.kind}", tuple(B.to_blender(anchor.position).tolist()))
    empty.rotation_euler = M.to_euler()
    empty["bone"] = anchor.bone
    empty["size"] = anchor.size
    empty["kind"] = anchor.kind
    empty["set"] = anchor.set
    return empty


def render_previews(folder, sets):
    """bind pose, lod0 only, one set at a time: front, three quarter and back"""
    import math
    from mathutils import Vector

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 900, 1200
    scene.render.film_transparent = False
    if scene.world is None:
        scene.world = bpy.data.worlds.new("w")
    scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.05, 0.055, 0.065, 1)
    bg.inputs["Strength"].default_value = 1.2
    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = 60
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    for i, (angle, energy) in enumerate(((35, 4.0), (-120, 2.0))):
        ld = bpy.data.lights.new(f"sun{i}", "SUN")
        ld.energy = energy
        lo = bpy.data.objects.new(f"sun{i}", ld)
        lo.rotation_euler = (math.radians(55), 0, math.radians(angle))
        scene.collection.objects.link(lo)
    os.makedirs(folder, exist_ok=True)
    # edge renders in its default paint (gloss black, graphite, chrome) so the preview reads like the game
    palettes = {"edge": {"primary": ((0.012, 0.013, 0.015), 0.22, 0.0), "secondary": ((0.05, 0.053, 0.058), 0.3, 0.3)}}
    base = {slot: B.SLOT_PREVIEW[slot] for slot in ("primary", "secondary")}
    for set_id in sets:
        for slot, (color, rough, metal) in {**base, **palettes.get(set_id, {})}.items():
            mat = bpy.data.materials.get(f"char_{slot}")
            bsdf = mat.node_tree.nodes.get("Principled BSDF") if mat and mat.use_nodes else None
            if bsdf:
                bsdf.inputs["Base Color"].default_value = (*color, 1.0)
                bsdf.inputs["Roughness"].default_value = rough
                bsdf.inputs["Metallic"].default_value = metal
        for obj in scene.objects:
            if obj.type != "MESH":
                continue
            visible = obj.get("lod") == 0 and obj.get("set") in (set_id, "core")
            obj.hide_render = not visible
        for view, yaw in (("front", 0), ("quarter", 35), ("back", 180)):
            r = 3.0
            a = math.radians(yaw)
            # character faces -y in blender
            cam.location = Vector((r * math.sin(a), -r * math.cos(a), 1.05))
            common.look_at(cam, (0, 0, 0.92))
            scene.render.filepath = os.path.join(folder, f"{set_id}_{view}.png")
            bpy.ops.render.render(write_still=True)
        # close-ups: the head three quarter and the left hand from outside
        for view, loc, target in (("head", (0.30, -0.62, 1.74), (0.0, -0.02, 1.68)),
                                  ("face", (0.0, -0.70, 1.70), (0.0, -0.02, 1.68)),
                                  ("chest", (0.12, -1.25, 1.38), (0.0, 0.0, 1.30)),
                                  ("hand", (0.95, -0.42, 1.02), (0.57, -0.07, 0.96))):
            cam.location = Vector(loc)
            common.look_at(cam, target)
            scene.render.filepath = os.path.join(folder, f"{set_id}_{view}.png")
            bpy.ops.render.render(write_still=True)
    B.log(f"renders in {folder}")


def main():
    args = parse_args()
    if args.body == "mpfb" and not args.no_body:
        # a factory reset would unload the mpfb extension; clear the scene by hand
        for ob in list(bpy.data.objects):
            bpy.data.objects.remove(ob, do_unlink=True)
        for block in (bpy.data.meshes, bpy.data.materials, bpy.data.armatures, bpy.data.images):
            for item in list(block):
                block.remove(item)
        bpy.context.scene.unit_settings.system = "METRIC"
    else:
        common.reset_scene()
    rig = Rig()
    arm = B.build_armature(rig)
    body = body_sdf(rig)
    only = {s for s in args.only.split(",") if s}
    sets = [s for s in args.sets.split(",") if s]

    parts, anchors = [], []
    mesh_made = []
    kit_sets = [s for s in sets if s != "none"]
    if kit_sets:
        import bake_atlas

        body_src, hands_src, ref, points = mpfb_body_parts(rig, arm, keep="sources")
        slots = tuple(s for s in ("helmet", "arms", "chest", "legs", "classItem") if not only or s in only)
        pieces, anchors = kit_sources(ref, points, kit_sets, slots)
        bpy.data.objects.remove(ref, do_unlink=True)
        with_body = not args.no_body and (not only or "body" in only)
        keep_uv = [body_src, hands_src] if with_body else []
        if args.atlas:
            bake_atlas.unwrap_and_pack([p[0] for p in pieces], keep_uv)
        if with_body:
            mesh_made += process_mesh("body", "core", "suit", body_src, "muscle", BODY_TRIS, arm)
            mesh_made += process_mesh("body", "core", "hands", hands_src, "dark", HAND_TRIS, arm)
        for ob in (body_src, hands_src):
            bpy.data.objects.remove(ob, do_unlink=True)
        mesh_made += kit_lods(pieces, rig, arm, args.kit_lod0)
        if args.atlas:
            lod0 = [o for o in mesh_made if o.get("lod") == 0]
            body0 = [o for o in lod0 if o.get("slot") == "body"]
            groups = [(body0, [])] + [([o for o in lod0 if o.get("set") == sid], body0) for sid in kit_sets]
            bake_atlas.run(lod0, groups, args.atlas, os.path.dirname(os.path.abspath(args.out)))
    elif not args.no_body and (not only or "body" in only):
        if args.body == "mpfb":
            mesh_made = mpfb_body_parts(rig, arm)
        else:
            parts.append(body_part(rig, body))

    # ao sees the body plus every piece of the same slot and set
    groups = {}
    for p in parts:
        groups.setdefault((p.slot, p.set), []).append(p.sdf)
    made = list(mesh_made)
    for p in parts:
        scene_fn = body if p.slot == "body" else S.Union([body] + groups[(p.slot, p.set)])
        made += process(p, arm, scene_fn, args.fast, args.lod0_scale, args.adaptivity)
    empties = [add_anchor(a) for a in anchors]

    total = sum(B.tri_count(o) for o in made if o.get("lod") == 0)
    B.log(f"{len(made)} meshes, lod0 library {total} tris")
    if args.save_blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.save_blend))
    common.export_glb(args.out, objects=[arm] + made + empties, animations=False)
    if args.renders:
        render_previews(args.renders, sets)


main()
