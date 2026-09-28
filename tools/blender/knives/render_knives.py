"""preview renders for the knife glbs (built by build_knives.py).

  blender -b --factory-startup --python-exit-code 1 -P tools/blender/knives/render_knives.py -- \
      <glb_dir> <out_dir> [side] [34] [folding] [closeups] [--ids a,b] [--samples 48]

side: orthographic tiles of the -z face (the side first person shows), all at
one scale, tips pointing left. 34: perspective tiles from the +z side, all at
one camera distance. folding: folders half open and closed, the balisong half
closed. closeups: karambit ring, m9 saw back and wire cutter hole, stiletto
mechanism, skeleton handle. each sheet is a grid of tiles with the knife id
written under each knife.
"""

import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import klib as K  # noqa: E402
from klib import W  # noqa: E402

ARGS = K.common.script_args()
GLB_DIR, OUT_DIR = ARGS[0], ARGS[1]
OPTS = {}
MODES = []
_rest = ARGS[2:]
while _rest:
    a = _rest.pop(0)
    if a.startswith("--"):
        OPTS[a] = _rest.pop(0)
    else:
        MODES.append(a)
IDS = OPTS["--ids"].split(",") if "--ids" in OPTS else None
SAMPLES = int(OPTS.get("--samples", 48))
ORDER = ["bayonet", "m9_bayonet", "karambit", "butterfly", "flip", "gut", "huntsman", "falchion", "shadow_daggers",
         "bowie", "navaja", "stiletto", "talon", "ursus", "classic", "paracord", "survival", "nomad", "skeleton", "kukri"]
FOLDERS = ["flip", "falchion", "navaja", "stiletto", "talon", "ursus", "nomad"]
TILE_DIR = os.path.join(K.TMP, "tiles")


def reset():
    K.common.reset_scene()
    W.setup_studio(strength=0.3, background=(0.045, 0.048, 0.056))
    scene = bpy.context.scene
    scene.view_settings.look = "AgX - Base Contrast"


def wire_ao(objs):
    """multiplies the baked ao (COLOR_0, whatever the importer named it) into base colour,
    the way three.js applies vertex colours"""
    names = set()
    for o in objs:
        if o.type == "MESH" and len(o.data.color_attributes):
            names.add(o.data.color_attributes[0].name)
    if not names:
        return
    name = sorted(names)[0]
    for mat in bpy.data.materials:
        if not mat.use_nodes or mat.get("_ao") or mat.name.startswith("_"):
            continue
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        bsdf = nodes.get("Principled BSDF")
        if bsdf is None:
            continue
        attr = nodes.new("ShaderNodeVertexColor")
        attr.layer_name = name
        mix = nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        base_in = bsdf.inputs["Base Color"]
        if base_in.is_linked:
            links.new(base_in.links[0].from_socket, mix.inputs[6])
        else:
            mix.inputs[6].default_value = tuple(base_in.default_value)
        links.new(attr.outputs["Color"], mix.inputs[7])
        links.new(mix.outputs[2], base_in)
        mat["_ao"] = True


def load(kid):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(GLB_DIR, f"{kid}.glb"))
    objs = [o for o in bpy.data.objects if o not in before]
    root = next(o for o in objs if o.name == kid)
    wire_ao(objs)
    return root, objs


def bounds(objs):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    bpy.context.view_layer.update()
    for o in objs:
        if o.type != "MESH":
            continue
        for v in o.data.vertices:
            p = o.matrix_world @ v.co
            lo = Vector((min(lo.x, p.x), min(lo.y, p.y), min(lo.z, p.z)))
            hi = Vector((max(hi.x, p.x), max(hi.y, p.y), max(hi.z, p.z)))
    return lo, hi


def label(text, location, rotation, size=0.011):
    curve = bpy.data.curves.new("label", "FONT")
    curve.body = text
    curve.size = size
    curve.align_x = "CENTER"
    obj = bpy.data.objects.new("label", curve)
    obj.data.materials.append(W.material("_label", 0xd8dde4, 0.5, 0.0, emission=0xd8dde4, emission_strength=1.0))
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = rotation
    return obj


def lights(center, side=1.0):
    """a big softbox over the camera (the blade flats reflect it), a cool rim from
    behind and a low fill. side +1 lights the -z face, -1 the +z face"""
    c = Vector(center)
    return [W.add_light("softbox", tuple(c + Vector((0.05, 0.9 * side, 0.55))), tuple(c), 38.0, size=1.4),
            W.add_light("key", tuple(c + Vector((-0.25, 0.35 * side, 0.5))), tuple(c), 16.0, size=0.5),
            W.add_light("rim", tuple(c + Vector((0.3, -0.45 * side, 0.35))), tuple(c), 16.0, size=0.6, color=(0.85, 0.9, 1.0)),
            W.add_light("fill", tuple(c + Vector((-0.4, 0.5 * side, -0.35))), tuple(c), 5.0, size=1.0)]


def pose(objs, blade=0.0, handles=0.0):
    """three.js rotation.z about the knife's +z is blender rotation about -y. handles
    swings handle_safe to rotation.z = -handles (round the spine) and handle_bite to
    +handles (round the edge), the directions in which the two don't cross"""
    for o in objs:
        if o.name == "blade_pivot":
            o.rotation_mode = "XYZ"
            o.rotation_euler = (0.0, -blade, 0.0)
        elif o.name == "handle_safe":
            o.rotation_mode = "XYZ"
            o.rotation_euler = (0.0, handles, 0.0)
        elif o.name == "handle_bite":
            o.rotation_mode = "XYZ"
            o.rotation_euler = (0.0, -handles, 0.0)
    bpy.context.view_layer.update()


def tile_side(kid, path, ortho=0.40, res=(900, 330), text=None, blade=0.0, handles=0.0):
    reset()
    root, objs = load(kid)
    pose(objs, blade, handles)
    lo, hi = bounds(objs)
    c = (lo + hi) / 2
    cz = c.z - 0.012
    ls = lights((c.x, 0.0, cz), side=1.0)
    label(text or kid, (c.x, lo.y - 0.01, cz - ortho * res[1] / res[0] * 0.5 + 0.012), (math.pi / 2, 0.0, math.pi))
    W.render(path, (c.x, 1.0, cz), (c.x, 0.0, cz), resolution=res, samples=SAMPLES, ortho_scale=ortho)
    return path


def tile_34(kid, path, res=(900, 470), dist=1.2, text=None):
    reset()
    root, objs = load(kid)
    lo, hi = bounds(objs)
    c = (lo + hi) / 2
    ls = lights((c.x, 0.0, c.z), side=-1.0)
    off = Vector((0.13, -0.36, 0.2)) * dist
    cam = c + off
    lab = label(text or kid, (0, 0, 0), (0, 0, 0), size=0.013)
    # label on a plane facing the camera, under the knife
    to_cam = (cam - c).normalized()
    lab.rotation_euler = to_cam.to_track_quat("Z", "Y").to_euler()
    lab.location = c + Vector((0.0, 0.0, -0.064)) + to_cam * 0.02
    W.render(path, tuple(cam), tuple(c + Vector((0.0, 0.0, -0.016))), lens=50, resolution=res, samples=SAMPLES)
    return path


def grid(paths, cols, out):
    import numpy as np
    imgs = []
    for p in paths:
        img = bpy.data.images.load(p, check_existing=False)
        w, h = img.size
        imgs.append(np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4))
        bpy.data.images.remove(img)
    h, w = imgs[0].shape[:2]
    rows = math.ceil(len(imgs) / cols)
    sheet = np.zeros((rows * h, cols * w, 4), dtype=np.float32)
    sheet[..., :3] = imgs[0][0, 0, :3]
    sheet[..., 3] = 1.0
    for i, a in enumerate(imgs):
        r, c = divmod(i, cols)
        # blender rows run bottom-up
        y0 = (rows - 1 - r) * h
        sheet[y0:y0 + h, c * w:(c + 1) * w] = a
    out_img = bpy.data.images.new("sheet", cols * w, rows * h, alpha=False)
    out_img.pixels.foreach_set(sheet.ravel())
    out_img.filepath_raw = out
    out_img.file_format = "PNG"
    out_img.save()
    bpy.data.images.remove(out_img)
    print(f"[render] wrote {out}")


def sheet_side(ids):
    paths = [tile_side(k, os.path.join(TILE_DIR, f"side_{k}.png")) for k in ids]
    grid(paths, 4 if len(paths) > 6 else len(paths), os.path.join(OUT_DIR, "models_side.png"))


def sheet_34(ids):
    paths = [tile_34(k, os.path.join(TILE_DIR, f"34_{k}.png")) for k in ids]
    grid(paths, 4 if len(paths) > 6 else len(paths), os.path.join(OUT_DIR, "models_34.png"))


def sheet_folding(ids):
    paths = []
    for k in [k for k in ids if k in FOLDERS]:
        paths.append(tile_side(k, os.path.join(TILE_DIR, f"fold_half_{k}.png"), text=f"{k} half open", blade=-math.pi / 2,
                               res=(900, 460)))
        paths.append(tile_side(k, os.path.join(TILE_DIR, f"fold_closed_{k}.png"), text=f"{k} closed", blade=-math.pi,
                               res=(900, 460)))
    if "butterfly" in ids:
        paths.append(tile_side("butterfly", os.path.join(TILE_DIR, "fold_half_butterfly.png"), text="butterfly half closed",
                               handles=math.pi * 0.3, res=(900, 460)))
        paths.append(tile_side("butterfly", os.path.join(TILE_DIR, "fold_closed_butterfly.png"), text="butterfly closed",
                               handles=math.pi, res=(900, 460)))
    if paths:
        grid(paths, 4, os.path.join(OUT_DIR, "models_folding.png"))


def closeup(kid, name, cam_off, target, lens=60, res=(1200, 800), blade=0.0):
    reset()
    root, objs = load(kid)
    pose(objs, blade)
    t = Vector(target)
    ls = lights(tuple(t), side=1.0 if cam_off[1] > 0 else -1.0)
    path = os.path.join(OUT_DIR, f"models_closeup_{name}.png")
    W.render(path, tuple(t + Vector(cam_off)), tuple(t), lens=lens, resolution=res, samples=max(SAMPLES, 64))
    return path


def closeups():
    # knife mm -> blender: (x, y, z) knife is (x, -z, y) in blender
    def kb(x, y, z=0.0):
        return (x * 0.001, -z * 0.001, y * 0.001)

    closeup("karambit", "karambit_ring", (-0.05, 0.13, 0.07), kb(-80.0, -12.0), lens=55)
    closeup("m9_bayonet", "m9_saw_hole", (0.0, 0.3, 0.05), kb(92.0, 22.0), lens=58, res=(1400, 700))
    closeup("stiletto", "stiletto_mechanism", (-0.07, 0.16, 0.09), kb(-20.0, 20.0), lens=55, blade=-math.pi * 0.42)
    closeup("skeleton", "skeleton_handle", (0.02, 0.17, 0.08), kb(-58.0, 12.0), lens=55)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(TILE_DIR, exist_ok=True)
    ids = [k for k in ORDER if (IDS is None or k in IDS)]
    if "side" in MODES:
        sheet_side(ids)
    if "34" in MODES:
        sheet_34(ids)
    if "folding" in MODES:
        sheet_folding(ids)
    if "closeups" in MODES:
        closeups()


main()
