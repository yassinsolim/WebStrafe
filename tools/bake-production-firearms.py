"""Build compact, animated first-person firearm presentations.

The licensed sources contain complete hand-assisted reload clips. This tool
keeps those armatures, removes non-viewmodel Deagle clothing, downsizes source
textures, and exports one reload action for deterministic runtime playback.

Usage:
  blender --background --python tools/bake-production-firearms.py -- \
    deagle SOURCE.blend TEXTURE_DIR OUTPUT.glb
  blender --background --python tools/bake-production-firearms.py -- \
        awp SOURCE.fbx TEXTURE_DIR OUTPUT.glb
"""

from pathlib import Path
import sys

import bmesh
import bpy

MAX_TEXTURE_SIZE = 512
BLACK_GLOVE_BASE = (0.022, 0.024, 0.028)


def downsize_image(image: bpy.types.Image) -> bpy.types.Image:
    width, height = image.size
    scale = min(1.0, MAX_TEXTURE_SIZE / max(width, height))
    if scale < 1.0:
        image.scale(max(1, round(width * scale)), max(1, round(height * scale)))
    return image


def load_image(path: Path, colorspace: str) -> bpy.types.Image:
    image = bpy.data.images.load(str(path), check_existing=True)
    image.colorspace_settings.name = colorspace
    return downsize_image(image)


def style_awp_hands(image: bpy.types.Image) -> bpy.types.Image:
    """Preserves authored skin while matching the AWP gloves to the Deagle."""
    styled = downsize_image(image.copy())
    styled.name = f"{image.name}_BlackGlovesSkin"
    pixels = list(styled.pixels)
    width, height = styled.size
    for index in range(0, len(pixels), 4):
        red, green, blue, alpha = pixels[index : index + 4]
        pixel = index // 4
        u = (pixel % width) / width
        v = (pixel // width) / height
        is_skin_island = u < 0.735 and (
            0.39 < v < 0.76
            or 0.02 < v < 0.38
        )
        is_unused_background = max(red, green, blue) < 0.002
        if alpha <= 0.01 or is_unused_background:
            continue
        if is_skin_island:
            continue
        luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722
        base = BLACK_GLOVE_BASE
        detail = max(0.62, min(1.52, luminance / 0.055))
        pixels[index] = base[0] * detail
        pixels[index + 1] = base[1] * detail
        pixels[index + 2] = base[2] * detail
    styled.pixels.foreach_set(pixels)
    styled.update()
    return styled


def texture_node(
    nodes: bpy.types.Nodes,
    path: Path,
    colorspace: str,
    image_transform=None,
) -> bpy.types.ShaderNodeTexImage:
    node = nodes.new("ShaderNodeTexImage")
    image = load_image(path, colorspace)
    node.image = image_transform(image) if image_transform else image
    return node


def configure_material(
    material: bpy.types.Material,
    textures: Path,
    base: str | None = None,
    normal: str | None = None,
    metallic: str | None = None,
    roughness: str | None = None,
    fallback: tuple[float, float, float, float] = (0.18, 0.2, 0.22, 1.0),
    base_image_transform=None,
) -> None:
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Base Color"].default_value = fallback
    shader.inputs["Metallic"].default_value = 0.15
    shader.inputs["Roughness"].default_value = 0.62
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    if base:
        links.new(
            texture_node(
                nodes,
                textures / base,
                "sRGB",
                base_image_transform,
            ).outputs["Color"],
            shader.inputs["Base Color"],
        )
    if normal:
        image = texture_node(nodes, textures / normal, "Non-Color")
        normal_map = nodes.new("ShaderNodeNormalMap")
        links.new(image.outputs["Color"], normal_map.inputs["Color"])
        links.new(normal_map.outputs["Normal"], shader.inputs["Normal"])
    if metallic:
        links.new(
            texture_node(nodes, textures / metallic, "Non-Color").outputs["Color"],
            shader.inputs["Metallic"],
        )
    if roughness:
        links.new(
            texture_node(nodes, textures / roughness, "Non-Color").outputs["Color"],
            shader.inputs["Roughness"],
        )


def keep_material_faces(source: bpy.types.Object, allowed: set[str]) -> None:
    allowed_indices = {
        index
        for index, material in enumerate(source.data.materials)
        if material and material.name.split(".")[0] in allowed
    }
    editable = bmesh.new()
    editable.from_mesh(source.data)
    rejected = [
        face for face in editable.faces if face.material_index not in allowed_indices
    ]
    bmesh.ops.delete(editable, geom=rejected, context="FACES")
    editable.to_mesh(source.data)
    editable.free()
    source.data.update()


def prepare_deagle(
    source: Path,
    textures: Path,
) -> tuple[list[bpy.types.Object], bpy.types.Object, bpy.types.Action]:
    bpy.ops.wm.open_mainfile(filepath=str(source))
    mappings = {
        "Gloves": (
            "Gloves_BaseColor.1003.png",
            "Gloves_Normal.1003.png",
            "Gloves_Metallic.1003.png",
            "Gloves_Roughness.1003.png",
        ),
        "Body": ("Face_Basecolor.png", "Face_Normal.png", None, None),
        "Watch": (
            "Watch_BaseColor.1004.png",
            None,
            "Watch_Metallic.1004.png",
            "Watch_Roughness.1004.png",
        ),
        "Watch_Emission": ("Watch_BaseColor.1004.png", None, None, None),
        "MainBody": (
            "T_Deagle_MainBody_BaseColor.png",
            "T_Deagle_MainBody_Normal.png",
            "T_Deagle_MainBody_Metallic.png",
            "T_Deagle_MainBody_Roughness.png",
        ),
        "Slide": (
            "T_Deagle_Slide_BaseColor.png",
            "T_Deagle_Slide_Normal.png",
            "T_Deagle_Slide_Metallic.png",
            "T_Deagle_Slide_Roughness.png",
        ),
        "Magazine": (
            "T_Deagle_Magazine_BaseColor.png",
            "T_Deagle_Magazine_Normal.png",
            "T_Deagle_Magazine_Metallic.png",
            "T_Deagle_Magazine_Roughness.png",
        ),
        "Bullet": (
            "T_Deagle_Bullet_BaseColor.png",
            "T_Deagle_Bullet_Normal.png",
            "T_Deagle_Bullet_Metallic.png",
            "T_Deagle_Bullet_Roughness.png",
        ),
    }
    for name, files in mappings.items():
        material = bpy.data.materials.get(name)
        if material:
            configure_material(material, textures, *files)

    rig = bpy.data.objects["rig"]
    arms = bpy.data.objects["Mesh"]
    gun = bpy.data.objects["Deagle"]
    arms.name = "DeagleArms"
    keep_material_faces(arms, {"Body", "Watch", "Watch_Emission", "Gloves"})
    return [rig, arms, gun], rig, bpy.data.actions["Reload"]


def prepare_awp(
    source: Path,
    textures: Path,
) -> tuple[list[bpy.types.Object], bpy.types.Object, bpy.types.Action]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=str(source))
    mappings = {
        "Material": ("arms_color.png", "arms_normal.png", (0.3, 0.18, 0.12, 1.0)),
        "Bolt": ("bolt_color.png", "Bolt_normal.png", (0.12, 0.13, 0.14, 1.0)),
        "scope": ("scope_color.png", "scope_normal.png", (0.08, 0.1, 0.09, 1.0)),
        "Barrel": ("barrel_color.png", None, (0.08, 0.09, 0.08, 1.0)),
        "Back": (None, "Back_normal.png", (0.16, 0.2, 0.13, 1.0)),
        "Body": ("Body_color.png", "Body_normal.png", (0.15, 0.2, 0.12, 1.0)),
    }
    for name, (base, normal, fallback) in mappings.items():
        material = bpy.data.materials.get(name)
        if material:
            configure_material(
                material,
                textures,
                base,
                normal,
                fallback=fallback,
                base_image_transform=style_awp_hands if name == "Material" else None,
            )
            if name == "Material":
                material.name = "BlackGlovesSkin"

    rig = bpy.data.objects["Arm"]
    names = [
        "Arms.002",
        "Bolt.Low",
        "scope.low",
        "barrel.low",
        "back.low",
        "Body.low",
    ]
    return (
        [rig, *(bpy.data.objects[name] for name in names)],
        rig,
        bpy.data.actions["Arm|Arm|Reload"],
    )


def export(
    objects: list[bpy.types.Object],
    rig: bpy.types.Object,
    action: bpy.types.Action,
    output: Path,
) -> None:
    rig.animation_data_create()
    rig.animation_data.action = action
    rig["authoring"] = "Licensed source rig with authored reload animation"
    bpy.context.scene.frame_start = round(action.frame_range[0])
    bpy.context.scene.frame_end = round(action.frame_range[1])

    for obj in bpy.data.objects:
        obj.select_set(False)
    for obj in objects:
        obj.hide_viewport = False
        obj.hide_render = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = rig

    bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        use_selection=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_animations=True,
        export_animation_mode="ACTIVE_ACTIONS",
        export_force_sampling=True,
        export_frame_range=True,
        export_skins=True,
        export_def_bones=True,
        export_armature_object_remove=False,
        export_optimize_animation_size=True,
        export_cameras=False,
        export_lights=False,
    )


def main() -> None:
    args = sys.argv[sys.argv.index("--") + 1 :]
    if len(args) != 4 or args[0] not in {"deagle", "awp"}:
        raise SystemExit("usage: WEAPON SOURCE TEXTURE_DIR OUTPUT")
    weapon, source, texture_dir, output = args
    prepare = prepare_deagle if weapon == "deagle" else prepare_awp
    objects, rig, action = prepare(Path(source), Path(texture_dir))
    export(objects, rig, action, Path(output))


if __name__ == "__main__":
    main()
