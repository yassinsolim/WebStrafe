"""shared helpers for the headless blender asset scripts.

run any build script like:
  blender -b --factory-startup --python-exit-code 1 -P tools/blender/<area>/<script>.py -- [args]

conventions (see tools/blender/README.md):
  - metres, blender z-up. the gltf exporter converts to three.js y-up, so blender
    +Y (forward) becomes three.js -Z (camera forward) and blender +Z becomes +Y.
  - sockets are empties named socket_*; moving parts are separate objects with
    their origin on the pivot.
"""

import math
import os
import sys

import bpy


def script_args():
    """arguments after the `--` separator"""
    argv = sys.argv
    return argv[argv.index("--") + 1:] if "--" in argv else []


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    return scene


def principled(name, color, roughness=0.5, metallic=0.0, emission=None, emission_strength=0.0, alpha=1.0):
    """plain pbr material that the gltf exporter maps 1:1 to MeshStandardMaterial"""
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        # blender 4.2+ picks blend mode from the surface render method
        if hasattr(mat, "surface_render_method"):
            mat.surface_render_method = "BLENDED"
    return mat


def add_empty(name, location=(0, 0, 0), rotation=(0, 0, 0), parent=None, size=0.02):
    empty = bpy.data.objects.new(name, None)
    empty.empty_display_type = "ARROWS"
    empty.empty_display_size = size
    empty.location = location
    empty.rotation_euler = rotation
    bpy.context.scene.collection.objects.link(empty)
    if parent is not None:
        empty.parent = parent
    return empty


def export_glb(path, objects=None, animations=False, apply_modifiers=True, extras=True):
    """exports the given objects (or the whole scene) as a binary gltf"""
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    if objects is not None:
        for obj in objects:
            obj.select_set(True)
    kwargs = dict(
        filepath=path,
        export_format="GLB",
        use_selection=objects is not None,
        export_yup=True,
        export_apply=apply_modifiers,
        export_extras=extras,
        export_texcoords=True,
        export_normals=True,
        export_cameras=False,
        export_lights=False,
        export_animations=animations,
        export_skins=True,
        export_morph=False,
    )
    # vertex colours changed option names across blender versions
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    if "export_vertex_color" in props:
        kwargs["export_vertex_color"] = "ACTIVE"
    elif "export_colors" in props:
        kwargs["export_colors"] = True
    bpy.ops.export_scene.gltf(**kwargs)
    print(f"[blender] wrote {path}")


def look_at(obj, target):
    from mathutils import Vector

    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def render_preview(path, camera_location, target, lens=50.0, resolution=(1280, 720), engine=None,
                   world_color=(0.05, 0.055, 0.065), sun_angle=(math.radians(50), 0, math.radians(35))):
    """quick still for docs: one camera, a sun and a soft world colour"""
    scene = bpy.context.scene
    cam_data = bpy.data.cameras.new("PreviewCamera")
    cam_data.lens = lens
    cam = bpy.data.objects.new("PreviewCamera", cam_data)
    scene.collection.objects.link(cam)
    cam.location = camera_location
    look_at(cam, target)
    scene.camera = cam
    sun_data = bpy.data.lights.new("PreviewSun", "SUN")
    sun_data.energy = 3.0
    sun = bpy.data.objects.new("PreviewSun", sun_data)
    sun.rotation_euler = sun_angle
    scene.collection.objects.link(sun)
    if scene.world is None:
        scene.world = bpy.data.worlds.new("PreviewWorld")
    scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes.get("Background")
    if bg is not None:
        bg.inputs["Color"].default_value = (*world_color, 1.0)
        bg.inputs["Strength"].default_value = 1.0
    available = [item.identifier for item in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    if engine is None:
        engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in available else (
            "BLENDER_EEVEE" if "BLENDER_EEVEE" in available else "CYCLES")
    scene.render.engine = engine
    if engine == "CYCLES":
        scene.cycles.samples = 64
    scene.render.resolution_x, scene.render.resolution_y = resolution
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    bpy.data.objects.remove(sun, do_unlink=True)
    print(f"[blender] rendered {path}")
