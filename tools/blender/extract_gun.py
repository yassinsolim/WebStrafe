"""Extract mesh(es) by material name from a GLB, un-skin them (return to bind
pose), join, recenter at origin, and export as a clean standalone GLB.

Usage:
    blender --background --python extract_gun.py -- <in.glb> <out.glb> <mat1> [mat2 ...]
"""
import bpy
import sys
from mathutils import Vector

a = sys.argv
args = a[a.index("--") + 1:] if "--" in a else []
inp, outp = args[0], args[1]
mats = [m.lower() for m in args[2:]]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=inp)

# select target meshes by material
targets = []
for obj in bpy.data.objects:
    if obj.type != "MESH":
        continue
    omats = [m.name.lower() for m in obj.data.materials] if obj.data.materials else []
    if any(any(t in om for om in omats) for t in mats):
        targets.append(obj)

print("TARGETS:", [o.name for o in targets])
assert targets, "no meshes matched materials " + str(mats)

# un-skin: remove armature modifiers, clear vertex groups, apply visual geometry
bpy.ops.object.select_all(action='DESELECT')
for obj in targets:
    # bake current (bind-pose) deformation into the mesh, then drop rig links
    for m in list(obj.modifiers):
        obj.modifiers.remove(m)
    obj.vertex_groups.clear()
    obj.parent = None

# join into one
bpy.context.view_layer.objects.active = targets[0]
for obj in targets:
    obj.select_set(True)
bpy.ops.object.join()
gun = bpy.context.view_layer.objects.active
gun.name = "Gun"

# apply its world transform so geometry is in a clean local space
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# --- find the GRIP point and set it as the origin, so attaching the gun at a
# hand bone with zero offset seats the grip in the palm (like the knife handle).
bpy.context.view_layer.update()
depsgraph = bpy.context.evaluated_depsgraph_get()
m = gun.evaluated_get(depsgraph).to_mesh()
xs = [v.co.x for v in m.vertices]; ys = [v.co.y for v in m.vertices]; zs = [v.co.z for v in m.vertices]
mnx, mxx = min(xs), max(xs); mny, mxy = min(ys), max(ys); mnz, mxz = min(zs), max(zs)
ext = {"x": mxx-mnx, "y": mxy-mny, "z": mxz-mnz}
L = max(ext, key=ext.get)                       # barrel axis (longest)
rest = [k for k in "xyz" if k != L]
H = max(rest, key=lambda k: ext[k])             # height axis (grip drop)
W = [k for k in rest if k != H][0]              # width axis
idx = {"x": 0, "y": 1, "z": 2}
verts = [v.co for v in m.vertices]
Lc = [v[idx[L]] for v in verts]; Hc = [v[idx[H]] for v in verts]
Lmid = (min(Lc)+max(Lc))/2; Lhalf = (max(Lc)-min(Lc))/2

def h_ext(sel):
    hs = [Hc[i] for i, lv in enumerate(Lc) if sel(lv)]
    return (max(hs)-min(hs)) if hs else 0

hi_ext = h_ext(lambda lv: lv > Lmid + 0.6*Lhalf)   # near +L end
lo_ext = h_ext(lambda lv: lv < Lmid - 0.6*Lhalf)   # near -L end
grip_sign = 1 if hi_ext >= lo_ext else -1          # grip end = taller end
# grip drop direction along H: mean H of grip-end verts vs overall center
Hmid = (min(Hc)+max(Hc))/2
grip_end_H = [Hc[i] for i, lv in enumerate(Lc)
              if (lv > Lmid + 0.6*Lhalf) == (grip_sign == 1)]
grip_H_sign = 1 if (sum(grip_end_H)/len(grip_end_H)) > Hmid else -1

grip = [0.0, 0.0, 0.0]
grip[idx[L]] = Lmid + grip_sign * 0.80 * Lhalf
grip[idx[H]] = Hmid + grip_H_sign * 0.55 * (max(Hc)-Hmid if grip_H_sign > 0 else Hmid-min(Hc))
grip[idx[W]] = (min(xs)+max(xs))/2 if W == "x" else ((min(ys)+max(ys))/2 if W == "y" else (min(zs)+max(zs))/2)
print(f"AXES barrel={L} height={H} width={W}  grip_sign={grip_sign} grip_H_sign={grip_H_sign}")
print(f"GRIP_POINT ({grip[0]:.1f},{grip[1]:.1f},{grip[2]:.1f})")

bpy.context.scene.cursor.location = (grip[0], grip[1], grip[2])
bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
gun.location = (0, 0, 0)
bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)

# report final size
bpy.context.view_layer.update()
depsgraph = bpy.context.evaluated_depsgraph_get()
m = gun.evaluated_get(depsgraph).to_mesh()
lo = Vector((1e18,)*3); hi = Vector((-1e18,)*3)
for v in m.vertices:
    w = gun.matrix_world @ v.co
    for i in range(3):
        lo[i] = min(lo[i], w[i]); hi[i] = max(hi[i], w[i])
size = hi - lo
print(f"GUN_SIZE ({size.x:.3f},{size.y:.3f},{size.z:.3f})  verts={len(m.vertices)}")

# keep only the gun
for obj in list(bpy.data.objects):
    if obj is not gun:
        bpy.data.objects.remove(obj, do_unlink=True)

bpy.ops.export_scene.gltf(filepath=outp, export_format='GLB', use_selection=False)
print("EXPORTED", outp)
