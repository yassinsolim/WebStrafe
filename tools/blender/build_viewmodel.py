"""Build a first-person weapon viewmodel by reusing the WORKING knife rig+arms
and attaching a clean gun mesh to the same wrist attachment the knife used.

Usage:
  blender --background --python build_viewmodel.py -- \
      <knife.glb> <gun.glb> <out.glb> <renderdir> \
      scale=0.017 rx=0 ry=0 rz=0 px=0 py=0 pz=0 action=anims frame=40 [--export]

The gun is parented to the 'knife' empty (child of R_wrist_Goal) so it inherits
the exact palm placement the knife had; scale/rx.. tune it to sit as a gun.
"""
import bpy
import sys
import os
import math
from mathutils import Vector

a = sys.argv
args = a[a.index("--") + 1:] if "--" in a else []
knife_glb, gun_glb, out_glb, renderdir = args[0], args[1], args[2], args[3]
kv = {}
for x in args[4:]:
    if "=" in x:
        k, v = x.split("=", 1)
        kv[k] = v
scale = float(kv.get("scale", 0.017))
rx = math.radians(float(kv.get("rx", 0)))
ry = math.radians(float(kv.get("ry", 0)))
rz = math.radians(float(kv.get("rz", 0)))
px = float(kv.get("px", 0)); py = float(kv.get("py", 0)); pz = float(kv.get("pz", 0))
action_name = kv.get("action", "anims")
frame = int(kv.get("frame", 40))
do_export = "--export" in args
os.makedirs(renderdir, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)

# 1) import knife viewmodel (arms + rig + attachment)
bpy.ops.import_scene.gltf(filepath=knife_glb)
knife_empty = bpy.data.objects.get("knife")
assert knife_empty, "no 'knife' attachment empty found"

# delete the knife MESH (keep the empty as the attach point)
for o in list(bpy.data.objects):
    if o.type == "MESH" and o.data.materials and any(
        "knife" in m.name.lower() for m in o.data.materials):
        bpy.data.objects.remove(o, do_unlink=True)
# delete stray Icosphere
for o in list(bpy.data.objects):
    if "icosphere" in o.name.lower():
        bpy.data.objects.remove(o, do_unlink=True)

# 2) import gun
before = set(bpy.data.objects.keys())
bpy.ops.import_scene.gltf(filepath=gun_glb)
new = [bpy.data.objects[n] for n in bpy.data.objects.keys() if n not in before]
gun = next((o for o in new if o.type == "MESH"), None)
assert gun, "no gun mesh imported"
# unparent gun from its own imported hierarchy, drop empties that came with it
gun.parent = None
for o in new:
    if o is not gun and o.type != "MESH":
        try:
            bpy.data.objects.remove(o, do_unlink=True)
        except Exception:
            pass

# 3) parent gun to the knife attach empty, in the empty's local space
gun.parent = knife_empty
gun.matrix_parent_inverse = knife_empty.matrix_world.inverted()
gun.location = (px, py, pz)
gun.rotation_euler = (rx, ry, rz)
gun.scale = (scale, scale, scale)

# 4) apply animation
arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
if arm and action_name:
    act = next((ac for ac in bpy.data.actions if action_name.lower() in ac.name.lower()), None)
    if act:
        if not arm.animation_data:
            arm.animation_data_create()
        arm.animation_data.action = act
        print(f"ACTION {act.name!r} {tuple(act.frame_range)}")
bpy.context.scene.frame_set(frame)
bpy.context.view_layer.update()

# report where gun ended up vs arms
depsgraph = bpy.context.evaluated_depsgraph_get()

def world_center(o):
    eo = o.evaluated_get(depsgraph); m = eo.to_mesh()
    if not m.vertices:
        eo.to_mesh_clear(); return None
    lo = Vector((1e18,)*3); hi = Vector((-1e18,)*3); mw = o.matrix_world
    for v in m.vertices:
        w = mw @ v.co
        for i in range(3):
            lo[i] = min(lo[i], w[i]); hi[i] = max(hi[i], w[i])
    eo.to_mesh_clear(); return (lo+hi)/2, (hi-lo)

gc = world_center(gun)
arms = next((o for o in bpy.data.objects if o.type == "MESH" and o is not gun), None)
ac = world_center(arms) if arms else None
if gc: print(f"GUN center={tuple(round(x,1) for x in gc[0])} size={tuple(round(x,1) for x in gc[1])}")
if ac: print(f"ARMS center={tuple(round(x,1) for x in ac[0])} size={tuple(round(x,1) for x in ac[1])}")

# 5) EXPORT first (before adding render-only lights/camera) so the GLB stays clean
if do_export:
    # strip any leftover junk (stray Icosphere from the source scenes)
    for o in list(bpy.data.objects):
        if "icosphere" in o.name.lower():
            bpy.data.objects.remove(o, do_unlink=True)
    for o in bpy.data.objects:
        o.select_set(False)
    bpy.ops.export_scene.gltf(filepath=out_glb, export_format='GLB',
                              export_animations=True, use_selection=False)
    print("EXPORTED", out_glb)

# 6) render POV-ish + 3q + side
scene = bpy.context.scene
world = bpy.data.worlds.new("W"); scene.world = world; world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.06,0.06,0.07,1)

# frame on arms+gun combined (robust median)
allw = []
for o in [gun, arms]:
    if not o: continue
    eo = o.evaluated_get(depsgraph); m = eo.to_mesh(); mw = o.matrix_world
    for v in m.vertices: allw.append(mw @ v.co)
    eo.to_mesh_clear()
def med(vs):
    s=sorted(vs); return s[len(s)//2]
center = Vector((med([w.x for w in allw]), med([w.y for w in allw]), med([w.z for w in allw])))
dists = sorted((w-center).length for w in allw)
radius = max(dists[int(len(dists)*0.92)], 1.0)
print(f"FRAME center={tuple(round(x,1) for x in center)} radius={radius:.1f}")

for loc, e in [((2,-3,2),2000),((-2,-2,1.5),1200),((0,3,1),1000)]:
    ld = bpy.data.lights.new("L","AREA"); ld.energy=e*radius*radius/10; ld.size=radius*2
    lo=bpy.data.objects.new("L",ld); lo.location=center+Vector(loc)*radius
    scene.collection.objects.link(lo)

cam_data = bpy.data.cameras.new("C"); cam = bpy.data.objects.new("C", cam_data)
scene.collection.objects.link(cam); scene.camera = cam
cam_data.clip_start=0.01; cam_data.clip_end=1e7; cam_data.lens=42
scene.render.engine='BLENDER_WORKBENCH'
sh=scene.display.shading; sh.light='STUDIO'; sh.color_type='SINGLE'
sh.single_color=(0.7,0.7,0.72); sh.show_shadows=True; sh.show_cavity=True
scene.render.resolution_x=900; scene.render.resolution_y=700

# POV: behind the wrist, looking where arms point (arms extend toward -Y)
angles={"pov":(0.15,1.0,0.25),"threeq":(1.0,0.8,0.5),"side":(1.0,0.05,0.1),"top":(0.1,0.3,1.1)}
for name,d3 in angles.items():
    d=Vector(d3).normalized(); cam.location=center+d*radius*3.0
    dd=cam.location-center; cam.rotation_euler=dd.to_track_quat('Z','Y').to_euler()
    scene.render.filepath=os.path.join(renderdir,f"{name}.png")
    bpy.ops.render.render(write_still=True)
print("RENDERED", renderdir)
