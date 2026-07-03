"""Check UNDEFORMED (bind-pose) geometry bounds by disabling armature modifiers.

If the gun meshes assemble into a coherent gun shape in bind pose, we can strip
the broken skinning and rebuild a clean viewmodel. Prints per-mesh raw
world bounds with the armature modifier muted.

Usage: blender --background --python bindcheck.py -- /path/model.glb [gun_mat_substrings...]
"""
import bpy
import sys
from mathutils import Vector

a = sys.argv
args = a[a.index("--") + 1:] if "--" in a else []
path = args[0]
gun_hints = [s.lower() for s in args[1:]]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)

# mute all armature modifiers so we see bind-pose geometry
for obj in bpy.data.objects:
    if obj.type == "MESH":
        for m in obj.modifiers:
            if m.type == "ARMATURE":
                m.show_viewport = False
                m.show_render = False

bpy.context.view_layer.update()
depsgraph = bpy.context.evaluated_depsgraph_get()


def raw_world_bounds(obj):
    eval_obj = obj.evaluated_get(depsgraph)
    mesh = eval_obj.to_mesh()
    if not mesh.vertices:
        eval_obj.to_mesh_clear()
        return None
    mw = obj.matrix_world
    lo = Vector((1e18, 1e18, 1e18))
    hi = Vector((-1e18, -1e18, -1e18))
    for v in mesh.vertices:
        w = mw @ v.co
        for i in range(3):
            lo[i] = min(lo[i], w[i])
            hi[i] = max(hi[i], w[i])
    eval_obj.to_mesh_clear()
    return lo, hi, (lo + hi) / 2, (hi - lo)

print("\n===== BIND-POSE (undeformed) BOUNDS =====")
for obj in bpy.data.objects:
    if obj.type != "MESH":
        continue
    mats = [m.name for m in obj.data.materials] if obj.data.materials else []
    is_gun = any(h in (obj.name + " " + " ".join(mats)).lower() for h in gun_hints) if gun_hints else False
    b = raw_world_bounds(obj)
    tag = "GUN " if is_gun else "    "
    if b:
        lo, hi, c, size = b
        print(f"{tag}MESH {obj.name!r} mats={mats}")
        print(f"     lo=({lo.x:.2f},{lo.y:.2f},{lo.z:.2f}) hi=({hi.x:.2f},{hi.y:.2f},{hi.z:.2f})")
        print(f"     center=({c.x:.2f},{c.y:.2f},{c.z:.2f}) size=({size.x:.2f},{size.y:.2f},{size.z:.2f})")
    else:
        print(f"{tag}MESH {obj.name!r} mats={mats} (no verts)")
print("===== DONE =====")
