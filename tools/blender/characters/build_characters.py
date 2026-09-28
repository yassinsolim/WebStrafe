"""builds public/characters/armor.glb, the armored character part library.

  npx tsx tools/characters/export-rig.ts           # only when the skeleton changes
  blender -b --factory-startup --python-exit-code 1 -P tools/blender/characters/build_characters.py -- \
      --out .blender-tmp/characters/armor_raw.glb [--sets strafe,anvil] [--renders docs/screenshots/characters/blender] [--fast]
  npx tsx tools/assets/optimize-glb.ts .blender-tmp/characters/armor_raw.glb public/characters/armor.glb

every piece is a signed distance field (csdf.py) meshed with openvdb, then
per lod: decimated, projected back onto the exact surface, given smooth
normals from the field, ambient occlusion and an edge wear mask in the vertex
colours (r = ao, g = wear), a material slot, and skin weights on the shared
skeleton (rig.json). the runtime merges whatever pieces a player picked into
one skinned mesh per lod. see docs/assets/characters.md.
"""

import argparse
import importlib
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
from parts import Part, mirror_bone  # noqa: E402
from rig import Rig  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ALL_SETS = ["strafe", "anvil", "vector", "quill"]


def parse_args():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, ".blender-tmp", "characters", "armor_raw.glb"))
    ap.add_argument("--sets", default=",".join(ALL_SETS))
    ap.add_argument("--renders", default=None, help="folder for blender preview renders")
    ap.add_argument("--fast", action="store_true", help="coarser voxels for quick looks")
    ap.add_argument("--only", default="", help="comma list of slots to build (debug)")
    ap.add_argument("--save-blend", default=None)
    return ap.parse_args(common.script_args())


def body_part(rig, body):
    weights = lambda co: body_weights(rig, co)  # noqa: E731
    return Part("body", "core", "suit", body, "suit", weights=weights, voxel=0.0042, tris=(7000, 2600, 850), symmetric=True)


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


def process(part, arm, scene_fn, fast):
    voxel = part.voxel * (1.8 if fast else 1.0)
    verts, faces = S.mesh(part.sdf, voxel)
    if len(faces) == 0:
        B.log(f"WARNING {part.slot}.{part.set}.{part.name} is empty")
        return []
    hi = B.mesh_object(f"{part.slot}.{part.set}.{part.name}.hi", verts, faces)
    made = []
    for lod in part.lods:
        target = part.tris[lod]
        if target <= 0:
            continue
        name = f"{part.slot}.{part.set}.{part.name}.lod{lod}"
        obj = B.copy_object(hi, name)
        B.decimate(obj, target, symmetric=part.symmetric)
        co = S.project(part.sdf, B.get_co(obj))
        B.set_co(obj, co)
        if lod == 0:
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
    # three -> blender basis change for the rotation
    C = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], dtype=np.float64)
    Rb = C @ R
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
    for set_id in sets:
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
    B.log(f"renders in {folder}")


def main():
    args = parse_args()
    common.reset_scene()
    rig = Rig()
    arm = B.build_armature(rig)
    body = body_sdf(rig)
    only = {s for s in args.only.split(",") if s}
    sets = [s for s in args.sets.split(",") if s]

    parts, anchors = [], []
    if not only or "body" in only:
        parts.append(body_part(rig, body))
    for set_id in sets:
        module = importlib.import_module(f"set_{set_id}")
        set_parts, set_anchors = module.build(rig)
        parts += [p for p in set_parts if not only or p.slot in only]
        anchors += set_anchors

    # ao sees the body plus every piece of the same slot and set
    groups = {}
    for p in parts:
        groups.setdefault((p.slot, p.set), []).append(p.sdf)
    made = []
    for p in parts:
        scene_fn = body if p.slot == "body" else S.Union([body] + groups[(p.slot, p.set)])
        made += process(p, arm, scene_fn, args.fast)
    empties = [add_anchor(a) for a in anchors]

    total = sum(B.tri_count(o) for o in made if o.get("lod") == 0)
    B.log(f"{len(made)} meshes, lod0 library {total} tris")
    if args.save_blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.save_blend))
    common.export_glb(args.out, objects=[arm] + made + empties, animations=False)
    if args.renders:
        render_previews(args.renders, sets)


main()
