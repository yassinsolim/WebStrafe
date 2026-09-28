"""texture bakes for the knives (build_knives.py).

every knife gets three texture sets, one per group of contract materials:
steel (knife_blade, knife_edge), handle (knife_handle) and fittings
(knife_metal, knife_accent). each group's faces are unwrapped together into one
uv atlas (UV0), so materials in a group share their images.

the fine detail (g10 weave, pebbled rubber, checkering, wood grain, paracord
weave, tape, bead blast, the satin grain on the steel) is a high-resolution
procedural height field and colour in each material's shader. cycles bakes it
onto the low poly: a tangent-space normal map, ambient occlusion from the real
geometry (screws, pins, guards, teeth, cut-outs), roughness, metalness and base
colour. ao, roughness and metalness are packed into one orm image (gltf
occlusion in r, roughness in g, metalness in b), then the materials are rebuilt
to use the baked images so the gltf exporter writes baseColorTexture,
normalTexture, metallicRoughnessTexture and occlusionTexture.
"""

import math
import os

import bmesh
import bpy
import numpy as np

import klib as K

# ao, roughness, metalness and colour change slowly, the normal map carries the fine detail
LOW_RES = 1024

GROUPS = (
    ("steel", ("knife_blade", "knife_edge")),
    ("handle", ("knife_handle",)),
    ("fittings", ("knife_metal", "knife_accent")),
)


# ---------------------------------------------------------------- uv atlases

def unwrap(meshes, margin=0.004):
    """one atlas per texture group: smart project the group's faces across all meshes"""
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_mode(type="FACE")
    for _, names in GROUPS:
        any_faces = False
        for o in meshes:
            bm = bmesh.from_edit_mesh(o.data)
            mats = [m.name if m else "" for m in o.data.materials]
            for f in bm.faces:
                f.select = mats[f.material_index] in names
                any_faces |= f.select
            bm.select_flush_mode()
            bmesh.update_edit_mesh(o.data)
        if any_faces:
            bpy.ops.uv.smart_project(angle_limit=math.radians(55.0), island_margin=margin, area_weight=0.0,
                                     correct_aspect=True, scale_to_bounds=False)
            bpy.ops.uv.pack_islands(margin=margin, rotate=True)
    bpy.ops.object.mode_set(mode="OBJECT")


# ---------------------------------------------------------------- procedural detail

def _node(nt, kind, **inputs):
    n = nt.nodes.new(kind)
    for k, v in inputs.items():
        n.inputs[k].default_value = v
    return n


def _link(nt, a, b):
    nt.links.new(a, b)


def _math(nt, op, a, b=None, value=None):
    n = nt.nodes.new("ShaderNodeMath")
    n.operation = op
    if isinstance(a, float):
        n.inputs[0].default_value = a
    else:
        _link(nt, a, n.inputs[0])
    if b is not None:
        if isinstance(b, float):
            n.inputs[1].default_value = b
        else:
            _link(nt, b, n.inputs[1])
    return n.outputs[0]


def _coords(nt, scale):
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = scale
    _link(nt, tc.outputs["Object"], mp.inputs["Vector"])
    return mp.outputs["Vector"]


def _noise(nt, vec, scale, detail=4.0, rough=0.55):
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.inputs["Scale"].default_value = scale
    n.inputs["Detail"].default_value = detail
    n.inputs["Roughness"].default_value = rough
    _link(nt, vec, n.inputs["Vector"])
    return n.outputs["Fac"]


def _wave(nt, vec, scale, direction="X", distortion=0.0, profile="SIN", detail=0.0):
    w = nt.nodes.new("ShaderNodeTexWave")
    w.wave_type = "BANDS"
    w.bands_direction = direction
    w.wave_profile = profile
    w.inputs["Scale"].default_value = scale
    w.inputs["Distortion"].default_value = distortion
    w.inputs["Detail"].default_value = detail
    _link(nt, vec, w.inputs["Vector"])
    return w.outputs["Fac"]


def _voronoi(nt, vec, scale, metric="EUCLIDEAN"):
    v = nt.nodes.new("ShaderNodeTexVoronoi")
    v.distance = metric
    v.inputs["Scale"].default_value = scale
    _link(nt, vec, v.inputs["Vector"])
    return v.outputs["Distance"]


def _mix_color(nt, fac, a, b):
    m = nt.nodes.new("ShaderNodeMix")
    m.data_type = "RGBA"
    m.inputs[6].default_value = a
    m.inputs[7].default_value = b
    if isinstance(fac, float):
        m.inputs["Factor"].default_value = fac
    else:
        _link(nt, fac, m.inputs["Factor"])
    return m.outputs[2]


def _rgba(hex_value):
    return (*K.W.srgb(hex_value), 1.0)


def detail_shader(mat, spec):
    """rebuilds `mat` as a bake source: base colour, roughness, metalness and a bump
    from a procedural height field. object coordinates are blender metres, the
    knife's x (along the blade) is blender x"""
    hexc, rough, metal = spec[:3]
    opts = spec[3] if len(spec) > 3 else {}
    kind = opts.get("detail", "none")
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    _link(nt, bsdf.outputs["BSDF"], out.inputs["Surface"])
    base = _rgba(hexc)
    base2 = _rgba(opts["color2"]) if "color2" in opts else base
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Base Color"].default_value = base
    height = None
    strength = opts.get("strength", 1.0)
    distance = 0.0003
    color_fac = None
    rough_var = 0.0
    v1 = _coords(nt, (1.0, 1.0, 1.0))
    if kind == "brushed":
        # satin grain: streaks along the blade
        # streaks about half a millimetre wide, coarse enough not to alias on a 1024 atlas
        v = _coords(nt, (10.0, 800.0, 800.0))
        height = _noise(nt, v, 1.0, 2.0, 0.5)
        distance, rough_var = 0.00002, 0.05
        color_fac = _math(nt, "MULTIPLY", height, 0.35)
    elif kind == "polished":
        v = _coords(nt, (20.0, 1200.0, 1200.0))
        height = _noise(nt, v, 1.0, 2.0, 0.5)
        distance, rough_var = 0.00001, 0.03
    elif kind == "bead":
        height = _noise(nt, v1, 3800.0, 1.0, 0.5)
        distance, rough_var = 0.00004, 0.05
        color_fac = _noise(nt, v1, 900.0, 2.0, 0.5)
    elif kind == "pebble":
        cells = _voronoi(nt, v1, 950.0)
        bumps = _math(nt, "POWER", _math(nt, "SUBTRACT", 1.0, _math(nt, "MINIMUM", cells, 1.0)), 1.6)
        grit = _noise(nt, v1, 4000.0, 1.0, 0.5)
        height = _math(nt, "ADD", bumps, _math(nt, "MULTIPLY", grit, 0.12))
        distance, rough_var = 0.00028, 0.1
        color_fac = _noise(nt, v1, 400.0, 3.0, 0.6)
    elif kind == "knurl":
        # diamond checkering: two diagonal plane waves, peaks where both are high
        a = _wave(nt, _coords(nt, (1.0, 0.7, 0.7)), 780.0, "DIAGONAL", profile="SIN")
        rot = nt.nodes.new("ShaderNodeVectorRotate")
        rot.rotation_type = "X_AXIS"
        rot.inputs["Angle"].default_value = math.radians(90.0)
        _link(nt, v1, rot.inputs["Vector"])
        mp = nt.nodes.new("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = (-1.0, 0.7, 0.7)
        _link(nt, rot.outputs["Vector"], mp.inputs["Vector"])
        b = _wave(nt, mp.outputs["Vector"], 780.0, "DIAGONAL", profile="SIN")
        height = _math(nt, "MULTIPLY", a, b)
        distance, rough_var = 0.0006, 0.06
        color_fac = height
    elif kind == "g10":
        fibres = _noise(nt, _coords(nt, (700.0, 1800.0, 1800.0)), 1.0, 3.0, 0.55)
        weave = _math(nt, "MULTIPLY", _wave(nt, v1, 1300.0, "DIAGONAL"), 0.45)
        height = _math(nt, "ADD", fibres, weave)
        distance, rough_var = 0.00011, 0.12
        color_fac = _noise(nt, v1, 260.0, 3.0, 0.55)
    elif kind == "wood":
        # grain along the handle (blender x); rings from bands across it
        # long flowing grain: rings stretched along the handle, bent by low noise, with
        # streaks of figure and open pores
        warp = nt.nodes.new("ShaderNodeTexNoise")
        warp.inputs["Scale"].default_value = 1.0
        warp.inputs["Detail"].default_value = 3.0
        _link(nt, _coords(nt, (6.0, 40.0, 40.0)), warp.inputs["Vector"])
        mixv = nt.nodes.new("ShaderNodeMix")
        mixv.data_type = "VECTOR"
        mixv.inputs["Factor"].default_value = 0.012
        _link(nt, v1, mixv.inputs[4])
        _link(nt, warp.outputs["Color"], mixv.inputs[5])
        rings = _wave(nt, mixv.outputs[1], 1.0, "Z", distortion=2.5, detail=3.0)
        rings_node = rings.node
        rings_node.inputs["Scale"].default_value = 140.0
        figure = _noise(nt, _coords(nt, (8.0, 260.0, 260.0)), 1.0, 5.0, 0.6)
        pores = _noise(nt, _coords(nt, (300.0, 4500.0, 4500.0)), 1.0, 2.0, 0.5)
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].position = 0.25
        ramp.color_ramp.elements[1].position = 0.85
        _link(nt, _math(nt, "ADD", _math(nt, "MULTIPLY", rings, 0.55), _math(nt, "MULTIPLY", figure, 0.45)), ramp.inputs["Fac"])
        height = _math(nt, "ADD", _math(nt, "MULTIPLY", rings, 0.25), pores)
        distance, rough_var = 0.00005, 0.1
        color_fac = ramp.outputs["Color"]
    elif kind == "ivory":
        lines = _noise(nt, _coords(nt, (60.0, 900.0, 900.0)), 1.0, 5.0, 0.5)
        height = _noise(nt, v1, 2500.0, 1.0, 0.5)
        distance, rough_var = 0.00003, 0.04
        color_fac = lines
    elif kind == "cord":
        # woven sheath: crossed diagonal threads with deep grooves between cords
        a = _wave(nt, v1, 750.0, "DIAGONAL", profile="SIN")
        rot = nt.nodes.new("ShaderNodeVectorRotate")
        rot.rotation_type = "X_AXIS"
        rot.inputs["Angle"].default_value = math.radians(90.0)
        _link(nt, v1, rot.inputs["Vector"])
        b = _wave(nt, rot.outputs["Vector"], 750.0, "DIAGONAL", profile="SIN")
        height = _math(nt, "MULTIPLY", _math(nt, "ADD", a, b), 0.5)
        distance, rough_var = 0.00016, 0.03
        color_fac = height
    elif kind == "tape":
        crepe = _noise(nt, _coords(nt, (2200.0, 900.0, 900.0)), 1.0, 2.0, 0.55)
        wrinkles = _noise(nt, v1, 180.0, 2.0, 0.5)
        height = _math(nt, "ADD", crepe, _math(nt, "MULTIPLY", wrinkles, 0.6))
        distance, rough_var = 0.00012, 0.05
        color_fac = wrinkles
    if color_fac is not None:
        col = _mix_color(nt, color_fac, base, base2 if base2 != base else tuple(c * 0.82 for c in base[:3]) + (1.0,))
        _link(nt, col, bsdf.inputs["Base Color"])
    if height is not None:
        bump = nt.nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = strength
        bump.inputs["Distance"].default_value = distance
        _link(nt, height, bump.inputs["Height"])
        _link(nt, bump.outputs["Normal"], bsdf.inputs["Normal"])
        if rough_var:
            r = _math(nt, "ADD", _math(nt, "MULTIPLY", _math(nt, "SUBTRACT", height, 0.5), rough_var * 2.0), rough)
            _link(nt, r, bsdf.inputs["Roughness"])
    mat["_metal"] = metal


# ---------------------------------------------------------------- baking

def _image(name, size, data=False):
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    if data:
        img.colorspace_settings.name = "Non-Color"
    return img


def _set_active(mats_by_group, images):
    for group, mats in mats_by_group.items():
        for m in mats:
            nt = m.node_tree
            node = nt.nodes.get("_bake_target") or nt.nodes.new("ShaderNodeTexImage")
            node.name = "_bake_target"
            node.image = images[group]
            nt.nodes.active = node
            node.select = True


def _emit_swap(mat, what):
    """plugs the base colour (or the metallic value) into an emission shader on the output"""
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    out = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeOutputMaterial")
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.name = "_bake_emit"
    emit.inputs["Strength"].default_value = 1.0
    if what == "color":
        src = bsdf.inputs["Base Color"]
        if src.is_linked:
            _link(nt, src.links[0].from_socket, emit.inputs["Color"])
        else:
            emit.inputs["Color"].default_value = tuple(src.default_value)
    else:
        v = float(mat.get("_metal", 0.0))
        emit.inputs["Color"].default_value = (v, v, v, 1.0)
    _link(nt, emit.outputs["Emission"], out.inputs["Surface"])


def _emit_restore(mat):
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    out = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeOutputMaterial")
    _link(nt, bsdf.outputs["BSDF"], out.inputs["Surface"])
    nt.nodes.remove(nt.nodes["_bake_emit"])


def _bake(kind, **kw):
    bpy.ops.object.bake(type=kind, margin=8, margin_type="EXTEND", use_clear=True, **kw)


def _pixels(img):
    w, h = img.size
    return np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)


def bake(kid, meshes, sizes, ao_distance=0.01):
    """bakes every texture group of the knife and rebuilds the five materials to use
    the baked images. sizes maps group -> pixels. returns {group: {pass: image}}"""
    scene = K.W.use_cycles("GPU", 1)
    scene.render.bake.target = "IMAGE_TEXTURES"
    if scene.world is None:
        scene.world = bpy.data.worlds.new("BakeWorld")
    scene.world.light_settings.distance = ao_distance
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    used = {m.name: m for o in meshes for m in o.data.materials if m}
    mats_by_group = {g: [used[n] for n in names if n in used] for g, names in GROUPS}
    mats_by_group = {g: ms for g, ms in mats_by_group.items() if ms}
    out = {g: {} for g in mats_by_group}
    passes = (("normal", "NORMAL", {"normal_space": "TANGENT"}, True, 1),
              ("rough", "ROUGHNESS", {}, True, 1),
              ("ao", "AO", {}, True, 48))
    for pname, ptype, kw, data, samples in passes:
        scene.cycles.samples = samples
        imgs = {g: _image(f"{kid}_{g}_{pname}", sizes[g] if pname == "normal" else min(sizes[g], LOW_RES), data)
                for g in mats_by_group}
        _set_active(mats_by_group, imgs)
        _bake(ptype, **kw)
        for g, img in imgs.items():
            out[g][pname] = img
    # base colour and metalness go through the emission pass (cycles' diffuse colour
    # pass is black on metals)
    scene.cycles.samples = 1
    for pname, data in (("color", False), ("metal", True)):
        for ms in mats_by_group.values():
            for m in ms:
                _emit_swap(m, pname)
        imgs = {g: _image(f"{kid}_{g}_{pname}", min(sizes[g], LOW_RES), data) for g in mats_by_group}
        _set_active(mats_by_group, imgs)
        _bake("EMIT")
        for g, img in imgs.items():
            out[g][pname] = img
        for ms in mats_by_group.values():
            for m in ms:
                _emit_restore(m)
    for g in mats_by_group:
        orm = _image(f"{kid}_{g}_orm", min(sizes[g], LOW_RES), True)
        ao, ro, me = _pixels(out[g]["ao"]), _pixels(out[g]["rough"]), _pixels(out[g]["metal"])
        packed = np.stack([np.clip(0.3 + 0.7 * ao[..., 0], 0, 1), np.clip(ro[..., 0], 0.04, 1), me[..., 0],
                           np.ones_like(ao[..., 0])], axis=-1)
        orm.pixels.foreach_set(packed.astype(np.float32).ravel())
        out[g]["orm"] = orm
        for pname in ("color", "normal", "orm"):
            img = out[g][pname]
            img.filepath_raw = os.path.join(K.TMP, "bakes", f"{img.name}.png")
            os.makedirs(os.path.dirname(img.filepath_raw), exist_ok=True)
            img.file_format = "PNG"
            img.save()
            img.pack()
    for g, ms in mats_by_group.items():
        for m in ms:
            final_material(m, out[g])
    for g in out:
        for pname in ("ao", "rough", "metal"):
            bpy.data.images.remove(out[g].pop(pname))
    return out


def _gltf_output_group():
    ng = bpy.data.node_groups.get("glTF Material Output")
    if ng is None:
        ng = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        ng.interface.new_socket(name="Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
        ng.nodes.new("NodeGroupInput")
    return ng


def final_material(mat, images):
    """baseColorTexture, normalTexture, and the orm image for roughness, metalness and
    occlusion; factors stay at 1 so three.js uses the maps as they are"""
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    _link(nt, bsdf.outputs["BSDF"], out.inputs["Surface"])
    col = nt.nodes.new("ShaderNodeTexImage")
    col.image = images["color"]
    _link(nt, col.outputs["Color"], bsdf.inputs["Base Color"])
    nrm = nt.nodes.new("ShaderNodeTexImage")
    nrm.image = images["normal"]
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    _link(nt, nrm.outputs["Color"], nmap.inputs["Color"])
    _link(nt, nmap.outputs["Normal"], bsdf.inputs["Normal"])
    orm = nt.nodes.new("ShaderNodeTexImage")
    orm.image = images["orm"]
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    _link(nt, orm.outputs["Color"], sep.inputs["Color"])
    _link(nt, sep.outputs["Green"], bsdf.inputs["Roughness"])
    _link(nt, sep.outputs["Blue"], bsdf.inputs["Metallic"])
    grp = nt.nodes.new("ShaderNodeGroup")
    grp.node_tree = _gltf_output_group()
    _link(nt, sep.outputs["Red"], grp.inputs["Occlusion"])
    if "_metal" in mat:
        del mat["_metal"]


# ---------------------------------------------------------------- lod1

def decimate(meshes, ratio):
    """collapse decimation that keeps uv seams and material borders"""
    for o in meshes:
        mod = o.modifiers.new("lod", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
        K.W.apply_modifiers(o)
        K.mark_sharp(o, 40.0)
