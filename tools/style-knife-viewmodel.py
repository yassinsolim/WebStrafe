"""Restyle knife-viewmodel gloves and forearms without rebaking its rig.

Usage:
    blender --background --python tools/style-knife-viewmodel.py -- \
        TEXTURE_SOURCE.glb TARGET.glb OUTPUT.glb
"""

import json
from pathlib import Path
import struct
import sys
import tempfile

import bpy


DARK_GLOVE_BASE = (0.012, 0.014, 0.018)
SKIN_BASE = (0.88, 0.58, 0.46)
FOREARM_HEIGHT_RATIO = 0.52


def align4(value: int) -> int:
    return (value + 3) & ~3


def find_base_color_image(material: bpy.types.Material) -> bpy.types.Image:
    if not material.use_nodes or not material.node_tree:
        raise RuntimeError("Knife arms material has no node tree")
    for link in material.node_tree.links:
        if (
            link.to_node.type == "BSDF_PRINCIPLED"
            and link.to_socket.name == "Base Color"
            and link.from_node.type == "TEX_IMAGE"
            and link.from_node.image
        ):
            return link.from_node.image
    raise RuntimeError("Knife arms material has no base-color image")


def write_styled_texture(image: bpy.types.Image, output: Path) -> tuple[int, int]:
    width, height = image.size
    if width <= 0 or height <= 0:
        raise RuntimeError("Knife arms material has an invalid base-color image")
    pixels = list(image.pixels)
    glove_pixels = 0
    skin_pixels = 0
    for index in range(0, len(pixels), 4):
        red, green, blue, alpha = pixels[index : index + 4]
        if alpha <= 0.01:
            continue
        luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722
        row = index // 4 // width
        if row < height * FOREARM_HEIGHT_RATIO:
            detail = max(0.78, min(1.12, luminance / 0.105))
            base = SKIN_BASE
            skin_pixels += 1
        else:
            detail = max(0.62, min(1.85, luminance / 0.24))
            base = DARK_GLOVE_BASE
            glove_pixels += 1
        pixels[index] = min(1, base[0] * detail)
        pixels[index + 1] = min(1, base[1] * detail)
        pixels[index + 2] = min(1, base[2] * detail)

    image.pixels.foreach_set(pixels)
    image.update()
    image.filepath_raw = str(output)
    image.file_format = "PNG"
    image.save()
    return glove_pixels, skin_pixels


def replace_base_color_image(source: Path, output: Path, png: bytes) -> None:
    raw = source.read_bytes()
    magic, version, _ = struct.unpack_from("<4sII", raw, 0)
    if magic != b"glTF" or version != 2:
        raise RuntimeError(f"{source} is not a GLB 2.0 asset")

    json_length, json_type = struct.unpack_from("<II", raw, 12)
    if json_type != 0x4E4F534A:
        raise RuntimeError("GLB JSON chunk is missing")
    document = json.loads(raw[20 : 20 + json_length].decode("utf-8").rstrip(" \0"))

    binary_header = 20 + json_length
    binary_length, binary_type = struct.unpack_from("<II", raw, binary_header)
    if binary_type != 0x004E4942:
        raise RuntimeError("GLB binary chunk is missing")
    binary_start = binary_header + 8
    binary = raw[binary_start : binary_start + binary_length]

    material = next(
        item for item in document["materials"] if item.get("name") == "arms"
    )
    texture_index = material["pbrMetallicRoughness"]["baseColorTexture"]["index"]
    texture = document["textures"][texture_index]
    source_index = texture.get("source")
    if source_index is None:
        source_index = texture["extensions"]["EXT_texture_webp"]["source"]
    texture["source"] = source_index
    extensions = texture.get("extensions", {})
    extensions.pop("EXT_texture_webp", None)
    if not extensions:
        texture.pop("extensions", None)

    image = document["images"][source_index]
    image["mimeType"] = "image/png"
    view_index = image["bufferView"]
    view = document["bufferViews"][view_index]
    if view.get("buffer", 0) != 0:
        raise RuntimeError("Knife base-color image is not in the primary buffer")

    old_start = view.get("byteOffset", 0)
    old_end = align4(old_start + view["byteLength"])
    replacement = png + bytes(align4(len(png)) - len(png))
    delta = len(replacement) - (old_end - old_start)
    binary = binary[:old_start] + replacement + binary[old_end:]
    view["byteLength"] = len(png)
    for index, other in enumerate(document["bufferViews"]):
        if index == view_index:
            continue
        offset = other.get("byteOffset", 0)
        if offset >= old_end:
            other["byteOffset"] = offset + delta
    document["buffers"][0]["byteLength"] = len(binary)

    encoded_json = json.dumps(document, separators=(",", ":")).encode("utf-8")
    encoded_json += b" " * (align4(len(encoded_json)) - len(encoded_json))
    binary += bytes(align4(len(binary)) - len(binary))
    total_length = 12 + 8 + len(encoded_json) + 8 + len(binary)
    rebuilt = (
        struct.pack("<4sII", b"glTF", 2, total_length)
        + struct.pack("<II", len(encoded_json), 0x4E4F534A)
        + encoded_json
        + struct.pack("<II", len(binary), 0x004E4942)
        + binary
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(rebuilt)


def main() -> None:
    texture_source_text, target_text, output_text = sys.argv[
        sys.argv.index("--") + 1 :
    ]
    texture_source = Path(texture_source_text)
    target = Path(target_text)
    output = Path(output_text)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(texture_source))
    material = bpy.data.materials.get("arms")
    if not material:
        raise RuntimeError("Knife viewmodel is missing the arms material")

    with tempfile.TemporaryDirectory(prefix="webstrafe-knife-style-") as temp:
        texture_path = Path(temp) / "arms-gloves-skin.png"
        glove_pixels, skin_pixels = write_styled_texture(
            find_base_color_image(material),
            texture_path,
        )
        replace_base_color_image(target, output, texture_path.read_bytes())
    print(
        f"Styled {glove_pixels} glove pixels and {skin_pixels} skin pixels "
        f"into {output}"
    )


if __name__ == "__main__":
    main()
