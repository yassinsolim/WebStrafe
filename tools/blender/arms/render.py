"""posed preview renders of the cyborg arms (cycles, gpu when available).

poses are applied as world space rotations about bone heads so they do not
depend on bone roll: curl() bends a digit bone about its own curl axis
(-local x for every finger and thumb bone on both sides, see rig.py).
kits share the same space, so each shot shows the core plus one kit.
"""

import math
import os

import bpy
from mathutils import Vector

import rig as R


def _clear_pose(arm_obj):
    for pb in arm_obj.pose.bones:
        pb.matrix_basis.identity()
    bpy.context.view_layer.update()


def curl(arm_obj, bone, angle):
    axis = -R.bone_axis_world(arm_obj, bone, "X")
    R.pose_world_rotation(arm_obj, bone, axis, angle)


def spread(arm_obj, bone, angle):
    axis = R.bone_axis_world(arm_obj, bone, "Z")
    R.pose_world_rotation(arm_obj, bone, axis, angle)


def roll(arm_obj, bone, angle):
    axis = R.bone_axis_world(arm_obj, bone, "Y")
    R.pose_world_rotation(arm_obj, bone, axis, angle)


def aim(arm_obj, bone, target_world):
    """rotate a pose bone about its head so its tail points at a world target"""
    pb = arm_obj.pose.bones[bone]
    bpy.context.view_layer.update()
    mw = arm_obj.matrix_world
    head = mw @ pb.head
    tail = mw @ pb.tail
    cur = (tail - head).normalized()
    want = (Vector(target_world) - head).normalized()
    axis = cur.cross(want)
    if axis.length < 1e-8:
        return
    angle = math.degrees(cur.angle(want))
    R.pose_world_rotation(arm_obj, bone, axis.normalized(), angle)


def hand_point(arm_obj, side, p_cm):
    """hand frame cm (right hand convention) -> world, following the posed hand bone"""
    import params as P

    q = Vector(p_cm) * P.CM
    if side == "l":
        q.x = -q.x
    pb = arm_obj.pose.bones[f"hand_{side}"]
    bpy.context.view_layer.update()
    rest = pb.bone.matrix_local
    posed = arm_obj.matrix_world @ pb.matrix
    wrist_rest = Vector(P.WRIST_R) if side == "r" else Vector(P.mirror_x(P.WRIST_R))
    local = rest.inverted() @ (wrist_rest + q)
    return posed @ local


def pose_grip(arm_obj, side):
    """pistol grip: three fingers wrapped, index on the trigger, thumb wrapped over"""
    s = side
    flip = 1.0 if s == "r" else -1.0
    curl(arm_obj, f"hand_{s}", 8)
    for name, a, b, c in (("middle", 78, 92, 42), ("ring", 80, 94, 44), ("pinky", 84, 92, 42)):
        curl(arm_obj, f"{name}_01_{s}", a)
        curl(arm_obj, f"{name}_02_{s}", b)
        curl(arm_obj, f"{name}_03_{s}", c)
    curl(arm_obj, f"index_01_{s}", 42)
    curl(arm_obj, f"index_02_{s}", 58)
    curl(arm_obj, f"index_03_{s}", 26)
    spread(arm_obj, f"index_01_{s}", -3 * flip)
    aim(arm_obj, f"thumb_01_{s}", hand_point(arm_obj, s, (-4.27, 4.75, -3.74)))
    aim(arm_obj, f"thumb_02_{s}", hand_point(arm_obj, s, (-2.35, 7.05, -5.2)))
    aim(arm_obj, f"thumb_03_{s}", hand_point(arm_obj, s, (-0.25, 8.65, -5.95)))


def pose_twist(arm_obj, side="l", twist=60.0, flex=30.0):
    flip = 1.0 if side == "r" else -1.0
    roll(arm_obj, f"forearm_twist_{side}", twist * flip)
    curl(arm_obj, f"hand_{side}", flex)


def pose_elbow(arm_obj, side="r", angle=90.0):
    R.pose_world_rotation(arm_obj, f"forearm_{side}", Vector((1.0, 0.0, 0.0)), angle)


# ---------------------------------------------------------------- scene
def _look_at(obj, target):
    d = Vector(target) - obj.location
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def _setup(scene, fast, resolution):
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 24 if fast else 128
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 6
    scene.cycles.transparent_max_bounces = 8
    scene.render.resolution_x, scene.render.resolution_y = resolution
    scene.render.resolution_percentage = 50 if fast else 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.compression = 100
    scene.view_settings.view_transform = "AgX"
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass
    if scene.world is None:
        scene.world = bpy.data.worlds.new("PreviewWorld")
    world = scene.world
    world.use_nodes = True
    nt = world.node_tree
    bg = nt.nodes.get("Background")
    if nt.nodes.get("CameraBackground") is not None:
        return
    tex = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[0].color = (0.05, 0.05, 0.055, 1)
    ramp.color_ramp.elements[1].position = 0.75
    ramp.color_ramp.elements[1].color = (0.42, 0.45, 0.5, 1)
    maprange = nt.nodes.new("ShaderNodeMapRange")
    maprange.inputs["From Min"].default_value = -1.0
    maprange.inputs["From Max"].default_value = 1.0
    nt.links.new(tex.outputs["Generated"], sep.inputs["Vector"])
    nt.links.new(sep.outputs["Z"], maprange.inputs["Value"])
    nt.links.new(maprange.outputs["Result"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = WORLD_STRENGTH
    bg_cam = nt.nodes.new("ShaderNodeBackground")
    bg_cam.name = "CameraBackground"
    path = nt.nodes.new("ShaderNodeLightPath")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(ramp.outputs["Color"], bg_cam.inputs["Color"])
    nt.links.new(path.outputs["Is Camera Ray"], mix.inputs["Fac"])
    nt.links.new(bg.outputs["Background"], mix.inputs[1])
    nt.links.new(bg_cam.outputs["Background"], mix.inputs[2])
    out = next(n for n in nt.nodes if n.type == "OUTPUT_WORLD")
    nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])


LIGHT_SCALE = 0.4
WORLD_STRENGTH = 0.6
# stops per shot, tuned for white plates over black muscle
EXPOSURE = {"rest": -2.6, "fist": -2.3, "palm": -2.0, "watch_closeup": -1.8, "elbow_bend": -2.0}


def _light(name, kind, loc, target, energy, size=0.3, color=(1, 1, 1)):
    data = bpy.data.lights.new(name, kind)
    data.energy = energy * LIGHT_SCALE
    data.color = color
    if kind == "AREA":
        data.size = size
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = loc
    _look_at(obj, target)
    return obj


def _camera(loc, target, lens):
    cam_data = bpy.data.cameras.new("PreviewCam")
    cam_data.lens = lens
    cam_data.clip_start = 0.005
    cam = bpy.data.objects.new("PreviewCam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = loc
    _look_at(cam, target)
    bpy.context.scene.camera = cam
    return cam


def _shot(path, cam_loc, target, lens, lights, exposure=0.0):
    scene = bpy.context.scene
    scene.view_settings.exposure = exposure
    bg_cam = scene.world.node_tree.nodes.get("CameraBackground")
    if bg_cam is not None:
        bg_cam.inputs["Strength"].default_value = WORLD_STRENGTH * 2.0 ** -exposure
    cam = _camera(cam_loc, target, lens)
    made = [_light(*l[:5], **(l[5] if len(l) > 5 else {})) for l in lights]
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    for obj in made:
        bpy.data.objects.remove(obj, do_unlink=True)


def show_kit(objects, kit, watch=True):
    for obj in objects:
        s = obj.get("set", "core")
        obj.hide_render = not (s == "core" or s == kit)
    w = bpy.data.objects.get("watch")
    if w is not None:
        for o in [w] + list(w.children_recursive):
            o.hide_render = not watch


def render_all(outdir, arm_obj, objects, kits, fast=False, log=print, only=None):
    """rest, fist and palm shots per kit, then watch and elbow with the first kit"""
    os.makedirs(outdir, exist_ok=True)
    scene = bpy.context.scene
    _setup(scene, fast, (1600, 900))

    def want(name):
        return only is None or name in only

    for kit in kits:
        show_kit(objects, kit)
        if want("rest"):
            _clear_pose(arm_obj)
            target = Vector((0.0, 0.5, -0.255))
            lights = [
                ("Key", "AREA", (0.35, 0.1, 0.35), (0.1, 0.5, -0.28), 90, {"size": 0.6}),
                ("Fill", "AREA", (-0.5, 0.2, 0.0), (0.0, 0.5, -0.28), 30, {"size": 0.8}),
                ("Rim", "AREA", (0.0, 1.1, 0.2), (0.0, 0.5, -0.28), 60, {"size": 0.5}),
            ]
            # 26 mm is about a 70 degree horizontal fov, close to a usual viewmodel fov
            _shot(os.path.join(outdir, f"rest_{kit}.png"), (0.0, 0.0, 0.0), target, 26, lights, EXPOSURE["rest"])
            log(f"rendered rest_{kit}.png")

        if want("top"):
            _clear_pose(arm_obj)
            hand = arm_obj.matrix_world @ arm_obj.pose.bones["hand_r"].head
            target = hand + Vector((0.0, 0.0, 0.0))
            cam = hand + Vector((-0.02, -0.12, 0.2))
            lights = [
                ("Key", "AREA", tuple(target + Vector((0.25, -0.1, 0.4))), tuple(target), 30, {"size": 0.5}),
                ("Fill", "AREA", tuple(target + Vector((-0.35, -0.2, 0.1))), tuple(target), 10, {"size": 0.6}),
            ]
            _shot(os.path.join(outdir, f"top_{kit}.png"), tuple(cam), tuple(target), 30, lights, EXPOSURE["fist"])
            log(f"rendered top_{kit}.png")

        if want("fp"):
            # roughly the knife idle: a fist, palm down, seen from the eye over the wrist
            _clear_pose(arm_obj)
            R.pose_world_rotation(arm_obj, "upperarm_r", Vector((0.0, 0.0, 1.0)), 28.0)
            pose_grip(arm_obj, "r")
            roll(arm_obj, "forearm_twist_r", -20.0)
            bpy.context.view_layer.update()
            hand = arm_obj.matrix_world @ arm_obj.pose.bones["hand_r"].head
            target = hand + Vector((-0.03, 0.04, 0.0))
            cam = hand + Vector((0.05, -0.2, 0.17))
            lights = [
                ("Key", "AREA", tuple(target + Vector((0.25, -0.1, 0.4))), tuple(target), 30, {"size": 0.5}),
                ("Fill", "AREA", tuple(target + Vector((-0.35, -0.2, 0.1))), tuple(target), 10, {"size": 0.6}),
                ("Rim", "AREA", tuple(target + Vector((-0.1, 0.35, 0.2))), tuple(target), 22, {"size": 0.3}),
            ]
            _shot(os.path.join(outdir, f"fp_{kit}.png"), tuple(cam), tuple(target), 38, lights, EXPOSURE["fist"])
            log(f"rendered fp_{kit}.png")

        if want("fist"):
            _clear_pose(arm_obj)
            roll(arm_obj, "upperarm_r", 90.0)
            pose_grip(arm_obj, "r")
            bpy.context.view_layer.update()
            hand = arm_obj.matrix_world @ arm_obj.pose.bones["hand_r"].tail
            target = hand + Vector((-0.02, -0.04, -0.005))
            cam = target + Vector((-0.27, 0.2, 0.2))
            lights = [
                ("Key", "AREA", tuple(target + Vector((-0.15, 0.1, 0.32))), tuple(target), 25, {"size": 0.4}),
                ("Fill", "AREA", tuple(target + Vector((-0.3, -0.15, -0.05))), tuple(target), 10, {"size": 0.5}),
                ("Rim", "AREA", tuple(target + Vector((0.2, 0.3, 0.15))), tuple(target), 20, {"size": 0.3}),
            ]
            _shot(os.path.join(outdir, f"fist_{kit}.png"), tuple(cam), tuple(target), 42, lights, EXPOSURE["fist"])
            log(f"rendered fist_{kit}.png")

        if want("palm"):
            _clear_pose(arm_obj)
            pose_twist(arm_obj, "l", 95.0, 25.0)
            bpy.context.view_layer.update()
            w = arm_obj.matrix_world @ arm_obj.pose.bones["hand_l"].head
            target = w + Vector((0.0, -0.02, 0.0))
            cam = target + Vector((0.2, -0.16, 0.2))
            lights = [
                ("Key", "AREA", tuple(target + Vector((0.2, -0.15, 0.35))), tuple(target), 30, {"size": 0.4}),
                ("Fill", "AREA", tuple(target + Vector((-0.3, -0.1, 0.05))), tuple(target), 10, {"size": 0.6}),
                ("Rim", "AREA", tuple(target + Vector((-0.1, 0.35, 0.2))), tuple(target), 20, {"size": 0.3}),
            ]
            _shot(os.path.join(outdir, f"palm_{kit}.png"), tuple(cam), tuple(target), 42, lights, EXPOSURE["palm"])
            log(f"rendered palm_{kit}.png")

    show_kit(objects, kits[0])
    if want("watch_closeup") and bpy.data.objects.get("watch") is not None:
        _clear_pose(arm_obj)
        watch = bpy.data.objects["watch"]
        c = watch.matrix_world.translation
        z = watch.matrix_world.col[2].xyz
        target = c + Vector((0.0, 0.004, -0.004))
        cam = c + z * 0.13 + Vector((0.08, -0.1, 0.0))
        lights = [
            ("Key", "AREA", tuple(c + Vector((0.12, -0.05, 0.25))), tuple(c), 14, {"size": 0.25}),
            ("Fill", "AREA", tuple(c + Vector((-0.25, -0.1, 0.1))), tuple(c), 5, {"size": 0.5}),
            ("Rim", "AREA", tuple(c + Vector((-0.05, 0.3, 0.12))), tuple(c), 10, {"size": 0.2}),
        ]
        _shot(os.path.join(outdir, "watch_closeup.png"), tuple(cam), tuple(target), 60, lights,
              EXPOSURE["watch_closeup"])
        log("rendered watch_closeup.png")

    if want("elbow_bend"):
        _clear_pose(arm_obj)
        pose_elbow(arm_obj, "r", 90.0)
        pose_grip(arm_obj, "r")
        bpy.context.view_layer.update()
        e = arm_obj.matrix_world @ arm_obj.pose.bones["forearm_r"].head
        target = e + Vector((0.0, 0.02, 0.1))
        cam = target + Vector((0.75, 0.05, 0.05))
        lights = [
            ("Key", "AREA", tuple(target + Vector((0.4, -0.3, 0.4))), tuple(target), 60, {"size": 0.6}),
            ("Fill", "AREA", tuple(target + Vector((0.3, 0.4, -0.1))), tuple(target), 20, {"size": 0.8}),
        ]
        _shot(os.path.join(outdir, "elbow_bend.png"), tuple(cam), tuple(target), 50, lights, EXPOSURE["elbow_bend"])
        log("rendered elbow_bend.png")

    _clear_pose(arm_obj)
