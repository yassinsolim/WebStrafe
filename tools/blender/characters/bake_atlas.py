"""one texture atlas for every character piece, baked in cycles.

every full-resolution piece (armor, undersuit, hands) gets its own uv islands
in a single shared layout, so any mix of pieces still merges into one mesh
with one material. lod copies are cut after packing and inherit the uvs.

baked on lod0, per piece:
  normal  tangent space: rounded edges (bevel shader) plus cc0 micro detail
          per material, box projected (textures/, see CREDITS.md)
  orm     r ambient occlusion (each set baked against the body and itself only)
          g roughness detail around 0.5, b edge wear mask, a grime (cavity dirt
          and run-off streaks, 1 = clean)
"""

import math
import os

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
TEX = os.path.join(HERE, "textures")

# material slot -> (normal map, roughness map, tile metres, normal strength, bevel radius, extra panel strength)
DETAIL = {
    "primary": ("metal027_n.jpg", "metal027_r.jpg", 0.30, 0.55, 0.0028, 0.22),
    "secondary": ("metal027_n.jpg", "metal027_r.jpg", 0.30, 0.55, 0.0028, 0.22),
    "accent": ("metal027_n.jpg", "metal027_r.jpg", 0.30, 0.55, 0.0025, 0.0),
    "metal": ("metal009_n.jpg", "metal009_r.jpg", 0.22, 0.7, 0.0018, 0.0),
    "cloth": ("fabric004_n.jpg", "fabric004_r.jpg", 0.09, 1.0, 0.0012, 0.0),
    "suit": ("bi_stretch_n.jpg", "bi_stretch_r.jpg", 0.16, 0.9, 0.0, 0.0),
    "dark": ("leather014_n.jpg", "leather014_r.jpg", 0.10, 0.8, 0.0012, 0.0),
    "trim": ("metal027_n.jpg", "metal027_r.jpg", 0.30, 0.5, 0.0018, 0.0),
    "light": (None, None, 1.0, 0.0, 0.0010, 0.0),
    "visor": (None, None, 1.0, 0.0, 0.0, 0.0),
}
UV = "UVMap"


def log(msg):
    print(f"[atlas] {msg}", flush=True)


def _select(objs, active=None):
    bpy.ops.object.mode_set(mode="OBJECT") if bpy.context.object and bpy.context.object.mode != "OBJECT" else None
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]


def ensure_uv(obj):
    me = obj.data
    if not me.uv_layers:
        me.uv_layers.new(name=UV)
    else:
        me.uv_layers[0].name = UV
    while len(me.uv_layers) > 1:
        me.uv_layers.remove(me.uv_layers[1])
    me.uv_layers.active_index = 0


def unwrap_and_pack(unwrap, keep, margin=0.0012):
    """smart projects `unwrap`, keeps the uvs `keep` already has (mpfb body), packs all of it"""
    for o in unwrap + keep:
        ensure_uv(o)
    if unwrap:
        _select(unwrap)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=math.radians(58), island_margin=0.0, area_weight=0.0,
                                 correct_aspect=True, scale_to_bounds=False)
        bpy.ops.object.mode_set(mode="OBJECT")
    everything = unwrap + keep
    _select(everything)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(rotate=True, margin=margin)
    bpy.ops.object.mode_set(mode="OBJECT")
    log(f"packed {len(everything)} pieces")


# ---------------------------------------------------------------------- bake materials

def _img(name, size, fill, non_color=True):
    img = bpy.data.images.get(name)
    if img:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=True)
    img.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
    img.generated_color = (*fill, 1.0)
    return img


def _tex(nt, file, tile, non_color=True):
    coord = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (1 / tile, 1 / tile, 1 / tile)
    nt.links.new(coord.outputs["Object"], mp.inputs["Vector"])
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = bpy.data.images.load(os.path.join(TEX, file), check_existing=True)
    t.image.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
    t.projection = "BOX"
    t.projection_blend = 0.3
    nt.links.new(mp.outputs["Vector"], t.inputs["Vector"])
    return t


def setup(mat, slot, mode, target):
    """rebuilds `mat` for one bake pass; the target image node ends up active"""
    nrm_file, rough_file, tile, strength, bevel_r, panel = DETAIL.get(slot, DETAIL["primary"])
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    shading = None
    if mode == "normal":
        nvec = None
        # thin bands (armorkit.band_plate) skip the panel seams and the bevel shader: the seams
        # cross a few cm of plate like a crease, and the bevel shader rounds the small angles
        # between the band's grid rows into visible lines (its rim has real bevels anyway)
        band = nt.nodes.new("ShaderNodeAttribute")
        band.attribute_name = "thin_band"
        if nrm_file and strength > 0:
            nm = nt.nodes.new("ShaderNodeNormalMap")
            nm.inputs["Strength"].default_value = strength
            nt.links.new(_tex(nt, nrm_file, tile).outputs["Color"], nm.inputs["Color"])
            nvec = nm.outputs["Normal"]
        if panel > 0:
            # large painted panels with seams and fasteners over the micro detail
            pm = nt.nodes.new("ShaderNodeNormalMap")
            keep = nt.nodes.new("ShaderNodeMath")
            keep.operation = "MULTIPLY_ADD"
            keep.inputs[1].default_value = -panel
            keep.inputs[2].default_value = panel
            nt.links.new(band.outputs["Fac"], keep.inputs[0])
            nt.links.new(keep.outputs["Value"], pm.inputs["Strength"])
            nt.links.new(_tex(nt, "metalplates017a_n.jpg", 0.42).outputs["Color"], pm.inputs["Color"])
            if nvec is not None:
                mix = nt.nodes.new("ShaderNodeVectorMath")
                mix.operation = "ADD"
                nt.links.new(nvec, mix.inputs[0])
                nt.links.new(pm.outputs["Normal"], mix.inputs[1])
                norm = nt.nodes.new("ShaderNodeVectorMath")
                norm.operation = "NORMALIZE"
                nt.links.new(mix.outputs["Vector"], norm.inputs[0])
                nvec = norm.outputs["Vector"]
            else:
                nvec = pm.outputs["Normal"]
        if bevel_r > 0:
            bev = nt.nodes.new("ShaderNodeBevel")
            bev.samples = 8
            bev.inputs["Radius"].default_value = bevel_r
            plain = nvec if nvec is not None else nt.nodes.new("ShaderNodeNewGeometry").outputs["Normal"]
            nt.links.new(plain, bev.inputs["Normal"])
            pick = nt.nodes.new("ShaderNodeMix")
            pick.data_type = "VECTOR"
            nt.links.new(band.outputs["Fac"], pick.inputs["Factor"])
            nt.links.new(bev.outputs["Normal"], pick.inputs["A"])
            nt.links.new(plain, pick.inputs["B"])
            nvec = pick.outputs["Result"]
        if nvec is not None:
            nt.links.new(nvec, bsdf.inputs["Normal"])
    elif mode == "rough":
        em = nt.nodes.new("ShaderNodeEmission")
        if rough_file:
            t = _tex(nt, rough_file, tile)
            # centre the detail on 0.5 so the runtime can add it to the finish roughness
            ramp = nt.nodes.new("ShaderNodeMapRange")
            ramp.inputs["From Min"].default_value = 0.0
            ramp.inputs["From Max"].default_value = 1.0
            ramp.inputs["To Min"].default_value = 0.3
            ramp.inputs["To Max"].default_value = 0.7
            nt.links.new(t.outputs["Color"], ramp.inputs["Value"])
            if slot in ("primary", "secondary", "accent", "trim"):
                sc = _tex(nt, "scratches005.jpg", 0.5)
                mix = nt.nodes.new("ShaderNodeMath")
                mix.operation = "SUBTRACT"
                mix.use_clamp = True
                sc_scale = nt.nodes.new("ShaderNodeMath")
                sc_scale.operation = "MULTIPLY"
                sc_scale.inputs[1].default_value = 0.22
                nt.links.new(sc.outputs["Color"], sc_scale.inputs[0])
                nt.links.new(ramp.outputs["Result"], mix.inputs[0])
                nt.links.new(sc_scale.outputs["Value"], mix.inputs[1])
                nt.links.new(mix.outputs["Value"], em.inputs["Color"])
            else:
                nt.links.new(ramp.outputs["Result"], em.inputs["Color"])
        else:
            em.inputs["Color"].default_value = (0.5, 0.5, 0.5, 1)
        nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    elif mode == "grime":
        # cavity dirt plus faint vertical run-off streaks; 1 = clean, towards 0.45 = grimy
        em = nt.nodes.new("ShaderNodeEmission")
        ao = nt.nodes.new("ShaderNodeAmbientOcclusion")
        ao.samples = 16
        ao.inputs["Distance"].default_value = 0.035
        coord = nt.nodes.new("ShaderNodeTexCoord")
        mp = nt.nodes.new("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = (26.0, 26.0, 3.0)
        nt.links.new(coord.outputs["Object"], mp.inputs["Vector"])
        noise = nt.nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 1.0
        noise.inputs["Detail"].default_value = 4.0
        nt.links.new(mp.outputs["Vector"], noise.inputs["Vector"])
        streak = nt.nodes.new("ShaderNodeMapRange")
        streak.inputs["From Min"].default_value = 0.5
        streak.inputs["From Max"].default_value = 0.75
        streak.inputs["To Min"].default_value = 0.0
        streak.inputs["To Max"].default_value = 0.18
        nt.links.new(noise.outputs["Fac"], streak.inputs["Value"])
        cav = nt.nodes.new("ShaderNodeMapRange")
        cav.inputs["From Min"].default_value = 0.2
        cav.inputs["From Max"].default_value = 1.0
        cav.inputs["To Min"].default_value = 0.42
        cav.inputs["To Max"].default_value = 0.0
        nt.links.new(ao.outputs["AO"], cav.inputs["Value"])
        add = nt.nodes.new("ShaderNodeMath")
        add.operation = "ADD"
        nt.links.new(cav.outputs["Result"], add.inputs[0])
        nt.links.new(streak.outputs["Result"], add.inputs[1])
        inv = nt.nodes.new("ShaderNodeMath")
        inv.operation = "SUBTRACT"
        inv.use_clamp = True
        inv.inputs[0].default_value = 1.0
        nt.links.new(add.outputs["Value"], inv.inputs[1])
        nt.links.new(inv.outputs["Value"], em.inputs["Color"])
        nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    elif mode == "edge":
        em = nt.nodes.new("ShaderNodeEmission")
        if bevel_r > 0:
            bev = nt.nodes.new("ShaderNodeBevel")
            bev.samples = 8
            bev.inputs["Radius"].default_value = bevel_r * 2.2
            geo = nt.nodes.new("ShaderNodeNewGeometry")
            dot = nt.nodes.new("ShaderNodeVectorMath")
            dot.operation = "DOT_PRODUCT"
            nt.links.new(bev.outputs["Normal"], dot.inputs[0])
            nt.links.new(geo.outputs["Normal"], dot.inputs[1])
            inv = nt.nodes.new("ShaderNodeMath")
            inv.operation = "SUBTRACT"
            inv.inputs[0].default_value = 1.0
            nt.links.new(dot.outputs["Value"], inv.inputs[1])
            amp = nt.nodes.new("ShaderNodeMath")
            amp.operation = "MULTIPLY"
            amp.use_clamp = True
            amp.inputs[1].default_value = 9.0
            nt.links.new(inv.outputs["Value"], amp.inputs[0])
            nt.links.new(amp.outputs["Value"], em.inputs["Color"])
        else:
            em.inputs["Color"].default_value = (0, 0, 0, 1)
        nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    node = nt.nodes.new("ShaderNodeTexImage")
    node.image = target
    for n in nt.nodes:
        n.select = False
    node.select = True
    nt.nodes.active = node


def _materials(objs):
    mats = {}
    for o in objs:
        for m in o.data.materials:
            if m is not None:
                mats[m.name] = m
    return mats


def _slot(mat):
    return mat.name.replace("char_", "")


def bake(kind, objs, target, samples, margin):
    for mat in _materials(objs).values():
        setup(mat, _slot(mat), kind, target)
    sc = bpy.context.scene
    sc.cycles.samples = samples
    _select(objs)
    bake_type = {"normal": "NORMAL", "rough": "EMIT", "edge": "EMIT", "grime": "EMIT", "ao": "AO"}[kind]
    if kind == "ao":
        for mat in _materials(objs).values():
            setup(mat, _slot(mat), "edge", target)  # any tree with the target active
    bpy.ops.object.bake(type=bake_type, normal_space="TANGENT", margin=margin, margin_type="EXTEND",
                        use_clear=False, target="IMAGE_TEXTURES")


def joined(objs, name):
    """one plain mesh copy of `objs` in the rest pose (cycles syncs the scene once per baked object)"""
    copies = []
    for o in objs:
        c = o.copy()
        c.data = o.data.copy()
        c.modifiers.clear()
        c.parent = None
        c.matrix_world = o.matrix_world.copy()
        bpy.context.scene.collection.objects.link(c)
        c.hide_render = False
        copies.append(c)
    _select(copies)
    if len(copies) > 1:
        bpy.ops.object.join()
    out = bpy.context.view_layer.objects.active
    out.name = name
    return out


def run(lod0, groups, size, out_dir, samples_ao=24):
    """lod0: every lod0 object; groups: (objects to bake, objects visible around them) for ao"""
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        sc.cycles.device = "GPU"
    except Exception as e:  # cpu is fine, just slower
        log(f"gpu unavailable: {e}")
    sc.render.bake.use_selected_to_active = False
    # ao reach: a hand's width, so plates darken each other's seams without the body going black
    if sc.world is None:
        sc.world = bpy.data.worlds.new("bake")
    sc.world.light_settings.distance = 0.25
    margin = max(4, size // 512)
    saved = {m.name: m.copy() for m in _materials(lod0).values()}

    nrm = _img("atlas_normal", size, (0.5, 0.5, 1.0))
    rough = _img("atlas_rough", size, (0.5, 0.5, 0.5))
    edge = _img("atlas_edge", size, (0.0, 0.0, 0.0))
    grime = _img("atlas_grime", size, (1.0, 1.0, 1.0))
    ao = _img("atlas_ao", size, (1.0, 1.0, 1.0))
    # lod1/lod2 copies sit exactly on top of lod0: nothing but the bake objects may be visible to rays
    was_hidden = {o.name: o.hide_render for o in bpy.data.objects}
    for o in bpy.data.objects:
        o.hide_render = True
    everything = joined(lod0, "bake_all")
    band = everything.data.attributes.get("thin_band")
    flagged = 0
    if band:
        vals = np.empty(len(band.data), dtype=np.float32)
        band.data.foreach_get("value", vals)
        flagged = int((vals > 0.5).sum())
    log(f"baking normal {size}px, {len(lod0)} pieces, {flagged} thin band vertices")
    bake("normal", [everything], nrm, 4, margin)
    log("baking roughness detail")
    bake("rough", [everything], rough, 1, margin)
    log("baking edge mask")
    bake("edge", [everything], edge, 4, margin)
    bpy.data.objects.remove(everything, do_unlink=True)
    for i, (grp, around) in enumerate(groups):
        target = joined(grp, f"bake_ao_{i}")
        occluder = joined(around, f"bake_occ_{i}") if around else None
        log(f"baking ao and grime group {i + 1}/{len(groups)} ({len(grp)} pieces)")
        bake("ao", [target], ao, samples_ao, margin)
        bake("grime", [target], grime, 8, margin)
        bpy.data.objects.remove(target, do_unlink=True)
        if occluder:
            bpy.data.objects.remove(occluder, do_unlink=True)
    for o in bpy.data.objects:
        o.hide_render = was_hidden.get(o.name, False)

    def px(img):
        a = np.empty(size * size * 4, dtype=np.float32)
        img.pixels.foreach_get(a)
        return a.reshape(size, size, 4)

    orm = np.ones((size, size, 4), dtype=np.float32)
    orm[..., 0] = px(ao)[..., 0]
    orm[..., 1] = px(rough)[..., 0]
    orm[..., 2] = px(edge)[..., 0]
    orm[..., 3] = px(grime)[..., 0]
    os.makedirs(out_dir, exist_ok=True)
    written = []
    for name, data in (("armor_normal", px(nrm)), ("armor_orm", orm)):
        img = bpy.data.images.new(name + "_out", size, size, alpha=name == "armor_orm", float_buffer=False)
        img.colorspace_settings.name = "Non-Color"
        img.pixels.foreach_set(np.clip(data, 0, 1).ravel())
        path = os.path.join(out_dir, name + ".png")
        img.filepath_raw = path
        img.file_format = "PNG"
        img.save()
        written.append(path)
    # put the plain slot materials back for export
    for name, copy in saved.items():
        mat = bpy.data.materials[name]
        mat.node_tree.nodes.clear()
        bpy.data.materials.remove(copy)
        bsdf = mat.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
        out = mat.node_tree.nodes.new("ShaderNodeOutputMaterial")
        mat.node_tree.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    log("wrote " + ", ".join(written))
    return written
