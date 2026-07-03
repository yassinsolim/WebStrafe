"""Build a clean, cohesive low-poly AWP-style sniper rifle from primitives.
Barrel along +Y (forward), up +Z, hand-grip near origin — matches the extracted
Deagle convention so build_viewmodel.py handles it identically.

Everything overlaps a central receiver spine so there are no floating gaps.

Usage: blender --background --python make_awp.py -- <out.glb>
"""
import bpy
import sys
import math
from mathutils import Vector

a = sys.argv
args = a[a.index("--") + 1:] if "--" in a else []
outp = args[0]

bpy.ops.wm.read_factory_settings(use_empty=True)

MATS = {}
def mat(name, rgb, rough=0.5, metal=0.4):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    MATS[name] = m
    return m

parts = []
def box(name, size, loc, rot=(0, 0, 0), material=None, bevel=0.08):
    # size=2 base cube spans +/-1, so scale=size/2 yields the intended dimensions
    bpy.ops.mesh.primitive_cube_add(size=2, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = (size[0] / 2, size[1] / 2, size[2] / 2)
    o.rotation_euler = rot
    if bevel > 0:
        bm = o.modifiers.new("bev", "BEVEL"); bm.width = bevel; bm.segments = 2
    if material:
        o.data.materials.append(material)
    parts.append(o); return o

def cyl(name, r, depth, loc, axis="y", rot=(0, 0, 0), material=None, verts=24):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc, vertices=verts)
    o = bpy.context.active_object
    o.name = name
    base = {"x": (0, math.pi / 2, 0), "y": (math.pi / 2, 0, 0), "z": (0, 0, 0)}[axis]
    o.rotation_euler = (base[0] + rot[0], base[1] + rot[1], base[2] + rot[2])
    if material:
        o.data.materials.append(material)
    parts.append(o); return o

body_c = mat("Body", (0.10, 0.12, 0.10), rough=0.5, metal=0.55)   # olive gunmetal
black_c = mat("Black", (0.04, 0.04, 0.045), rough=0.4, metal=0.7)
grip_c = mat("Grip", (0.06, 0.06, 0.065), rough=0.85, metal=0.1)
scope_c = mat("Scope", (0.02, 0.02, 0.02), rough=0.3, metal=0.6)

# central receiver spine (everything overlaps this): Y -7..15
box("Receiver", (2.4, 22.0, 3.0), (0, 4.0, 0.8), material=body_c, bevel=0)
# handguard / fore under the front receiver
box("Handguard", (2.6, 8.0, 1.8), (0, 11.0, -0.7), material=body_c, bevel=0)
# barrel + shroud + muzzle
cyl("BarrelShroud", 0.95, 8.0, (0, 12.5, 1.0), axis="y", material=body_c)
cyl("Barrel", 0.5, 12.0, (0, 18.5, 1.0), axis="y", material=black_c)
cyl("Muzzle", 0.72, 1.6, (0, 24.2, 1.0), axis="y", material=black_c)
# scope: mounts bridge receiver top (z=2.3) to tube; tube sits just above
box("ScopeMountF", (0.6, 1.2, 1.6), (0, 7.0, 2.7), material=black_c, bevel=0)
box("ScopeMountR", (0.6, 1.2, 1.6), (0, 1.0, 2.7), material=black_c, bevel=0)
cyl("Scope", 0.85, 9.5, (0, 4.0, 3.35), axis="y", material=scope_c)
cyl("ScopeFrontBell", 1.15, 1.6, (0, 8.6, 3.35), axis="y", material=black_c)
cyl("ScopeRearBell", 1.05, 1.6, (0, -0.6, 3.35), axis="y", material=black_c)
# stock: solid cheek-piece that overlaps receiver back generously (Y -12..-3)
box("StockTop", (2.0, 9.5, 1.4), (0, -7.7, 1.6), material=body_c, bevel=0)
box("StockBottom", (2.0, 9.5, 1.5), (0, -7.7, -0.5), material=body_c, bevel=0)
box("StockMid", (2.0, 9.5, 3.2), (0, -7.7, 0.6), material=body_c, bevel=0)
box("Cheek", (1.7, 6.5, 0.8), (0, -7.0, 2.5), material=grip_c, bevel=0)
box("ButtPad", (2.1, 1.4, 4.4), (0, -12.4, 0.6), material=grip_c, bevel=0)
# thumbhole / pistol grip near origin (hand wraps here) — overlaps receiver bottom
box("PistolGrip", (1.7, 2.4, 5.2), (0, -2.4, -1.4), rot=(math.radians(20), 0, 0), material=grip_c, bevel=0)
# trigger guard
cyl("TriggerGuard", 0.85, 0.55, (0, -0.4, -1.0), axis="z", material=black_c, verts=18)
box("Trigger", (0.25, 0.3, 1.1), (0, -0.4, -0.8), material=black_c, bevel=0)
# magazine (overlaps receiver bottom)
box("Magazine", (1.5, 2.8, 4.0), (0, 2.6, -1.7), rot=(math.radians(-8), 0, 0), material=black_c, bevel=0)
# bolt handle on the right side
cyl("Bolt", 0.22, 2.2, (1.4, 1.5, 1.2), axis="x", material=black_c, verts=12)
box("BoltKnob", (0.5, 0.5, 0.5), (2.3, 1.5, 1.2), material=black_c, bevel=0)

# --- assemble: apply bevels, join into one object (crisp hard-surface parts that
# now genuinely overlap, so the silhouette reads as one continuous rifle) ---
bpy.ops.object.select_all(action='DESELECT')
for o in parts:
    bpy.context.view_layer.objects.active = o
    for m in list(o.modifiers):
        try:
            bpy.ops.object.modifier_apply(modifier=m.name)
        except Exception:
            pass
for o in parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
gun = bpy.context.view_layer.objects.active
gun.name = "Gun"
# weld coincident verts at overlaps
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=0.02)
bpy.ops.object.mode_set(mode='OBJECT')

# origin at the grip so the hand wraps it when attached with zero offset
bpy.context.scene.cursor.location = (0, -1.6, -1.1)
bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
gun.location = (0, 0, 0)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.shade_smooth()

depsgraph = bpy.context.evaluated_depsgraph_get()
m = gun.evaluated_get(depsgraph).to_mesh()
lo = Vector((1e18,)*3); hi = Vector((-1e18,)*3)
for v in m.vertices:
    for i in range(3):
        lo[i] = min(lo[i], v.co[i]); hi[i] = max(hi[i], v.co[i])
print(f"AWP_SIZE {tuple(round(x,2) for x in (hi-lo))} verts={len(m.vertices)}")

bpy.ops.export_scene.gltf(filepath=outp, export_format='GLB', use_selection=False)
print("EXPORTED", outp)
