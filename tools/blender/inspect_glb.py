"""Headless Blender inspector for a GLB rig.

Usage:
    blender --background --python inspect_glb.py -- /path/to/model.glb

Dumps: objects, armatures+bones, meshes (verts, materials, weighted bones),
world-space deformed bounds per mesh at frame 1, and animations.
The goal is to see WHERE the gun mesh sits vs the hands so we can fix the rig.
"""
import bpy
import sys
from mathutils import Vector


def argv_after_ddash():
    a = sys.argv
    return a[a.index("--") + 1:] if "--" in a else []


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path):
    bpy.ops.import_scene.gltf(filepath=path)


def deformed_world_bounds(obj, depsgraph):
    """True world-space bounds of a (possibly skinned) mesh after evaluation."""
    eval_obj = obj.evaluated_get(depsgraph)
    mesh = eval_obj.to_mesh()
    mw = obj.matrix_world
    if not mesh.vertices:
        eval_obj.to_mesh_clear()
        return None
    lo = Vector((1e18, 1e18, 1e18))
    hi = Vector((-1e18, -1e18, -1e18))
    for v in mesh.vertices:
        w = mw @ v.co
        for i in range(3):
            lo[i] = min(lo[i], w[i])
            hi[i] = max(hi[i], w[i])
    eval_obj.to_mesh_clear()
    c = (lo + hi) / 2
    size = hi - lo
    return lo, hi, c, size


def main():
    args = argv_after_ddash()
    path = args[0]
    clear_scene()
    import_glb(path)

    # advance to frame 1 and evaluate the rig so skinning is applied
    scene = bpy.context.scene
    scene.frame_set(1)
    depsgraph = bpy.context.evaluated_depsgraph_get()

    print("\n===== OBJECTS =====")
    for obj in bpy.data.objects:
        print(f"OBJ  {obj.type:9s}  {obj.name!r}  parent={obj.parent.name if obj.parent else None!r}")

    print("\n===== ARMATURES / BONES =====")
    for obj in bpy.data.objects:
        if obj.type != "ARMATURE":
            continue
        arm = obj.data
        print(f"ARMATURE {obj.name!r}  bones={len(arm.bones)}")
        # print bones whose name hints hand/weapon/arm/wrist
        for b in arm.bones:
            n = b.name.lower()
            if any(k in n for k in ("hand", "weapon", "wrist", "gun", "arm", "palm", "finger", "root", "grip")):
                head_w = obj.matrix_world @ b.head_local
                print(f"  BONE {b.name!r}  head_world=({head_w.x:.2f},{head_w.y:.2f},{head_w.z:.2f})")

    print("\n===== MESHES (deformed world bounds @ frame1) =====")
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        mats = [m.name for m in obj.data.materials] if obj.data.materials else []
        vgs = [g.name for g in obj.vertex_groups]
        nv = len(obj.data.vertices)
        b = deformed_world_bounds(obj, depsgraph)
        if b:
            lo, hi, c, size = b
            print(f"MESH {obj.name!r}  verts={nv}  mats={mats}")
            print(f"     center=({c.x:.2f},{c.y:.2f},{c.z:.2f})  size=({size.x:.2f},{size.y:.2f},{size.z:.2f})")
            print(f"     weightGroups={vgs[:8]}{'...' if len(vgs) > 8 else ''}")
        else:
            print(f"MESH {obj.name!r}  verts={nv}  mats={mats}  (no eval verts)")

    print("\n===== ANIMATIONS =====")
    for act in bpy.data.actions:
        fr = act.frame_range
        print(f"ACTION {act.name!r}  frames=[{fr[0]:.0f},{fr[1]:.0f}]")

    print("\n===== DONE =====")


main()
