"""materials for the arms asset. every material maps 1:1 to a gltf
MeshStandardMaterial; textured ones use the gltf layout (base colour, ORM
with occlusion in R / roughness in G / metal in B, tangent space normal)."""

import bpy


def srgb_to_linear(c):
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)


def _base(name):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.use_backface_culling = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    return mat, nt, bsdf


def plain(name, color_srgb, roughness, metallic=0.0, emission_srgb=None, emission_strength=0.0, alpha=1.0,
          ior=1.5, specular=0.5):
    mat, nt, bsdf = _base(name)
    bsdf.inputs["Base Color"].default_value = (*srgb_to_linear(color_srgb), 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["IOR"].default_value = ior
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = specular
    if emission_srgb is not None:
        bsdf.inputs["Emission Color"].default_value = (*srgb_to_linear(emission_srgb), 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        mat.surface_render_method = "BLENDED"
        mat.use_transparency_overlap = False
    return mat


def _gltf_output_group():
    """node group the gltf exporter reads the occlusion map from"""
    ng = bpy.data.node_groups.get("glTF Material Output")
    if ng is None:
        ng = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        ng.interface.new_socket(name="Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
        ng.nodes.new("NodeGroupInput")
    return ng


def textured(name, base_img, orm_img, normal_img, uv_name="UVMap", normal_strength=1.0):
    mat, nt, bsdf = _base(name)
    nodes, links = nt.nodes, nt.links
    uv = nodes.new("ShaderNodeUVMap")
    uv.uv_map = uv_name
    uv.location = (-1100, 0)

    tex_base = nodes.new("ShaderNodeTexImage")
    tex_base.image = base_img
    tex_base.location = (-700, 300)
    links.new(uv.outputs["UV"], tex_base.inputs["Vector"])
    links.new(tex_base.outputs["Color"], bsdf.inputs["Base Color"])

    tex_orm = nodes.new("ShaderNodeTexImage")
    tex_orm.image = orm_img
    tex_orm.location = (-700, 0)
    links.new(uv.outputs["UV"], tex_orm.inputs["Vector"])
    sep = nodes.new("ShaderNodeSeparateColor")
    sep.location = (-400, 0)
    links.new(tex_orm.outputs["Color"], sep.inputs["Color"])
    links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    grp = nodes.new("ShaderNodeGroup")
    grp.node_tree = _gltf_output_group()
    grp.location = (-100, -400)
    links.new(sep.outputs["Red"], grp.inputs["Occlusion"])

    tex_n = nodes.new("ShaderNodeTexImage")
    tex_n.image = normal_img
    tex_n.location = (-700, -300)
    links.new(uv.outputs["UV"], tex_n.inputs["Vector"])
    nmap = nodes.new("ShaderNodeNormalMap")
    nmap.space = "TANGENT"
    nmap.uv_map = uv_name
    nmap.inputs["Strength"].default_value = normal_strength
    nmap.location = (-400, -300)
    links.new(tex_n.outputs["Color"], nmap.inputs["Color"])
    links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def base_color_textured(mat, img, uv_name="UVMap"):
    """adds an image as base colour on an existing plain material"""
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    uv = nt.nodes.new("ShaderNodeUVMap")
    uv.uv_map = uv_name
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    nt.links.new(uv.outputs["UV"], tex.inputs["Vector"])
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


def watch_materials():
    return {
        "mat_watch_steel": plain("mat_watch_steel", (0.78, 0.78, 0.8), 0.26, metallic=1.0),
        "mat_watch_bezel": plain("mat_watch_bezel", (0.07, 0.07, 0.075), 0.3),
        "mat_watch_dial": plain("mat_watch_dial", (0.06, 0.06, 0.065), 0.72),
        "mat_watch_lume": plain("mat_watch_lume", (0.86, 0.9, 0.8), 0.45,
                                emission_srgb=(0.55, 0.85, 0.62), emission_strength=0.35),
        # glass: no diffuse, only the fresnel reflection shows through alpha
        "mat_watch_crystal": plain("mat_watch_crystal", (0.02, 0.022, 0.025), 0.02, alpha=0.28, ior=1.77),
        "mat_watch_strap": plain("mat_watch_strap", (0.075, 0.075, 0.08), 0.62),
    }
