"""Render a GLB from several angles to PNGs so we can SEE the viewmodel.

Usage:
    blender --background --python render_glb.py -- <model.glb> <outdir> [frame] [--bind]

- Deletes obvious junk (Icosphere, Skybox) and huge broken meshes far from the
  main cluster so framing is sane.
- Frames the camera on the surviving mesh cluster.
- Renders front / side / three-quarter / top views with EEVEE.
"""
import bpy
import sys
import os
import math
from mathutils import Vector

a = sys.argv
args = a[a.index("--") + 1:] if "--" in a else []
path = args[0]
outdir = args[1]
frame = int(args[2]) if len(args) > 2 and args[2].isdigit() else 1
bind = "--bind" in args
os.makedirs(outdir, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)

scene = bpy.context.scene

# optionally assign an action by (sub)name so we see the real animated pose
action_arg = None
for x in args:
    if x.startswith("action="):
        action_arg = x.split("=", 1)[1].lower()
if action_arg:
    arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
    if arm:
        act = next((a for a in bpy.data.actions if action_arg in a.name.lower()), None)
        if act:
            if not arm.animation_data:
                arm.animation_data_create()
            arm.animation_data.action = act
            print(f"ASSIGNED action {act.name!r} range={tuple(act.frame_range)}")
scene.frame_set(frame)

# delete junk
for name in list(bpy.data.objects.keys()):
    low = name.lower()
    if any(k in low for k in ("icosphere", "skybox", "sun", "camera", "aim")):
        try:
            bpy.data.objects.remove(bpy.data.objects[name], do_unlink=True)
        except Exception:
            pass

if bind:
    for obj in bpy.data.objects:
        if obj.type == "MESH":
            for m in obj.modifiers:
                if m.type == "ARMATURE":
                    m.show_viewport = False
                    m.show_render = False

bpy.context.view_layer.update()
depsgraph = bpy.context.evaluated_depsgraph_get()


def mesh_center_size(obj):
    eo = obj.evaluated_get(depsgraph)
    m = eo.to_mesh()
    if not m.vertices:
        eo.to_mesh_clear()
        return None
    mw = obj.matrix_world
    lo = Vector((1e18,) * 3); hi = Vector((-1e18,) * 3)
    for v in m.vertices:
        w = mw @ v.co
        for i in range(3):
            lo[i] = min(lo[i], w[i]); hi[i] = max(hi[i], w[i])
    eo.to_mesh_clear()
    return (lo + hi) / 2, (hi - lo)


# find the biggest reasonable mesh cluster: use median center of meshes whose
# size is not astronomically large
meshes = [o for o in bpy.data.objects if o.type == "MESH"]

# gather ALL world-space verts from candidate meshes, then frame robustly
# (median center + percentile radius) so stray outlier verts don't dominate.
allw = []
for o in meshes:
    eo = o.evaluated_get(depsgraph)
    m = eo.to_mesh()
    mw = o.matrix_world
    for v in m.vertices:
        allw.append(mw @ v.co)
    eo.to_mesh_clear()

if not allw:
    print("NO VERTS"); 
def median(vals):
    s = sorted(vals); n = len(s)
    return s[n // 2] if n else 0.0

cx = median([w.x for w in allw]); cy = median([w.y for w in allw]); cz = median([w.z for w in allw])
center = Vector((cx, cy, cz))
dists = sorted(((w - center).length for w in allw))
# 92nd percentile radius ignores far strays
radius = max(dists[int(len(dists) * 0.92)] if dists else 1.0, 0.05)
frac_far = sum(1 for d in dists if d > radius) / max(len(dists), 1)
print(f"FRAME center=({cx:.2f},{cy:.2f},{cz:.2f}) radius={radius:.3f} strays={frac_far*100:.1f}% maxdist={dists[-1]:.1f}")
print(f"KEPT {len(meshes)} meshes, {len(allw)} verts")

# lighting
world = bpy.data.worlds.new("W"); scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.05, 0.05, 0.06, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
for (loc, energy) in [((3, -4, 3), 1500), ((-3, -3, 2), 800), ((0, 4, 2), 600)]:
    ld = bpy.data.lights.new("L", "AREA"); ld.energy = energy; ld.size = 5
    lo_ = bpy.data.objects.new("L", ld); lo_.location = (center.x + loc[0]*radius, center.y + loc[1]*radius, center.z + loc[2]*radius)
    scene.collection.objects.link(lo_)

# camera
cam_data = bpy.data.cameras.new("Cam"); cam = bpy.data.objects.new("Cam", cam_data)
scene.collection.objects.link(cam); scene.camera = cam
cam_data.lens = 50
cam_data.clip_start = 0.01
cam_data.clip_end = 1.0e7


def look_at(obj, target):
    d = (obj.location - target)
    obj.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()


try:
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
except TypeError:
    scene.render.engine = 'BLENDER_EEVEE'

# Workbench gives clean, evenly-lit geometry for pose inspection regardless of
# how the GLB materials import. Use it unless --eevee is passed.
if "--eevee" not in args:
    scene.render.engine = 'BLENDER_WORKBENCH'
    sh = scene.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'SINGLE'
    sh.single_color = (0.75, 0.75, 0.78)
    sh.show_shadows = True
    sh.show_cavity = True
    sh.cavity_type = 'BOTH'
scene.render.resolution_x = 900
scene.render.resolution_y = 700
scene.render.film_transparent = False

dist = radius * 3.0
angles = {
    "front":  (0, -1, 0.15),
    "side":   (1, -0.2, 0.15),
    "threeq": (0.9, -0.9, 0.5),
    "top":    (0.1, -0.3, 1.2),
}
for name, dir3 in angles.items():
    d = Vector(dir3).normalized()
    cam.location = center + d * dist
    look_at(cam, center)
    scene.render.filepath = os.path.join(outdir, f"{name}.png")
    bpy.ops.render.render(write_still=True)
    print(f"WROTE {scene.render.filepath}")
print("RENDER_DONE")
