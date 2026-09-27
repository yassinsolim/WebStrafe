"""preview sheet for the runtime procedural knives (src/cosmetics/ProceduralKnife.ts).

the knives are built by three.js at runtime, so this only renders a dump of
their geometry for review:

  npx tsx tools/blender/weapons/dump_knives.ts .blender-tmp/knives.json [ids] [open|folded]
  blender -b --factory-startup --python-exit-code 1 -P tools/blender/weapons/render_knives.py -- \
      .blender-tmp/knives.json out.png [cols] [cell_width_m]

textures are approximated (pebble/braid as noise bump, wood as a wave
texture), the geometry and colours are exact.
"""

import json
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wlib as W  # noqa: E402

args = W.common.script_args()
src = args[0]
out = args[1]
cols = int(args[2]) if len(args) > 2 else 5
cell = float(args[3]) if len(args) > 3 else 0.36

W.common.reset_scene()
knives = json.load(open(src))
mat_cache = {}


def hex_to_linear(h):
    v = int(h[1:], 16)
    # three.js getHexString is already srgb
    return W.srgb(v)


def material(spec):
    key = json.dumps(spec, sort_keys=True)
    if key in mat_cache:
        return mat_cache[key]
    m = bpy.data.materials.new(spec["name"])
    m.use_nodes = True
    nodes, links = m.node_tree.nodes, m.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*hex_to_linear(spec["color"]), 1.0)
    bsdf.inputs["Metallic"].default_value = spec["metalness"]
    bsdf.inputs["Roughness"].default_value = spec["roughness"] * (0.75 if spec.get("roughnessMap") else 1.0)
    if spec.get("normalMap"):
        noise = nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 900.0 if "pebble" in spec["normalMap"] else 400.0
        bump = nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.25
        bump.inputs["Distance"].default_value = 0.0004
        links.new(noise.outputs["Fac"], bump.inputs["Height"])
        links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    if spec.get("map") and "wood" in spec["map"]:
        wave = nodes.new("ShaderNodeTexWave")
        wave.inputs["Scale"].default_value = 60.0
        wave.inputs["Distortion"].default_value = 6.0
        ramp = nodes.new("ShaderNodeMix")
        ramp.data_type = "RGBA"
        ramp.blend_type = "MULTIPLY"
        ramp.inputs["Factor"].default_value = 0.35
        ramp.inputs[6].default_value = (*hex_to_linear(spec["color"]), 1.0)
        links.new(wave.outputs["Color"], ramp.inputs[7])
        links.new(ramp.outputs[2], bsdf.inputs["Base Color"])
    mat_cache[key] = m
    return m


def build_mesh(spec, offset):
    pos = spec["pos"]
    nrm = spec["nrm"]
    idx = spec["index"]
    verts = [Vector((pos[i], -pos[i + 2], pos[i + 1])) + offset for i in range(0, len(pos), 3)]
    faces = [tuple(idx[i:i + 3]) for i in range(0, len(idx), 3)]
    mesh = bpy.data.meshes.new(spec["name"])
    mesh.from_pydata([tuple(v) for v in verts], [], faces)
    mats = [material(m) for m in spec["materials"]]
    for m in mats:
        mesh.materials.append(m)
    face_mat = [0] * len(faces)
    for g in spec["groups"]:
        for f in range(g["start"] // 3, (g["start"] + g["count"]) // 3):
            if f < len(face_mat):
                face_mat[f] = g["mat"]
    mesh.polygons.foreach_set("material_index", face_mat)
    mesh.polygons.foreach_set("use_smooth", [True] * len(faces))
    normals = [(nrm[i], -nrm[i + 2], nrm[i + 1]) for i in range(0, len(nrm), 3)]
    mesh.normals_split_custom_set_from_vertices(normals)
    mesh.update()
    obj = bpy.data.objects.new(spec["name"], mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


if len(args) > 4 and args[4] == "detail":
    # one 3/4 close-up per knife: out is a directory
    os.makedirs(out, exist_ok=True)
    W.setup_studio(strength=0.3)
    W.add_light("key", (0.35, -0.5, 0.45), (0, 0, 0), 60.0, size=0.6)
    W.add_light("fill", (-0.5, -0.3, 0.1), (0, 0, 0), 20.0, size=0.6)
    for k in knives:
        made = [build_mesh(m, Vector((0, 0, 0))) for m in k["meshes"]]
        mid = Vector(((k["length"] * 0.5 - 0.12) * 0.5 + 0.02, 0, 0.012))
        W.render(os.path.join(out, f"{k['id']}.png"), tuple(mid + Vector((0.12, -0.24, 0.16))), tuple(mid), lens=50,
                 resolution=(1100, 700), samples=64)
        for o in made:
            bpy.data.objects.remove(o, do_unlink=True)
    sys.exit(0)

rows = math.ceil(len(knives) / cols)
row_h = 0.15
for i, k in enumerate(knives):
    c = i % cols
    r = i // cols
    # centre each knife in its cell by its overall length
    offset = Vector(((c - (cols - 1) / 2) * cell - 0.05 + (0.12 - k["length"] / 2) * 0.3, 0, ((rows - 1) / 2 - r) * row_h))
    for m in k["meshes"]:
        build_mesh(m, offset)
    curve = bpy.data.curves.new("label", "FONT")
    curve.body = k["id"]
    curve.size = 0.012
    t = bpy.data.objects.new("label", curve)
    t.data.materials.append(W.material("_label", 0xdfe3ea, 0.5, 0.0, emission=0xdfe3ea, emission_strength=1.2))
    bpy.context.scene.collection.objects.link(t)
    t.rotation_euler = (math.radians(90), 0, 0)
    t.location = offset + Vector((-0.1, 0.0, -0.06))

W.setup_studio(strength=0.35)
W.add_light("key", (-0.6, -1.2, 1.0), (0, 0, 0), 400.0, size=1.2)
W.add_light("fill", (0.9, -0.8, 0.3), (0, 0, 0), 150.0, size=1.0)
width = cols * cell
W.render(out, (0.0, -3.0, 0.0), (0.0, 0.0, 0.0), resolution=(1800, int(1800 * rows * row_h / width) + 40),
         samples=64, ortho_scale=width * 1.02)
