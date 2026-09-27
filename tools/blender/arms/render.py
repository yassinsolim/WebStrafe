"""posed preview renders of the arms rig (cycles, gpu when available).

poses are applied as world space rotations about bone heads so they do not
depend on bone roll: curl() bends a digit bone about its own curl axis
(-local x for every finger and thumb bone on both sides, see rig.py).
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
    # thumb wrapped over the curled middle finger: aim each bone at a target in
    # hand space (cm) so the pose does not depend on bone roll
    aim(arm_obj, f"thumb_01_{s}", hand_point(arm_obj, s, (-4.27, 4.75, -3.74)))
    aim(arm_obj, f"thumb_02_{s}", hand_point(arm_obj, s, (-2.35, 7.05, -5.2)))
    aim(arm_obj, f"thumb_03_{s}", hand_point(arm_obj, s, (-0.25, 8.65, -5.95)))


def pose_twist(arm_obj, side="l", twist=60.0, flex=30.0):
    flip = 1.0 if side == "r" else -1.0
    roll(arm_obj, f"forearm_twist_{side}", twist * flip)
    curl(arm_obj, f"hand_{side}", flex)


def pose_elbow(arm_obj, side="r", angle=90.0):
    # hand comes up towards the face, about the world x axis
    R.pose_world_rotation(arm_obj, f"forearm_{side}", Vector((1.0, 0.0, 0.0)), angle)


# ---------------------------------------------------------------- scene
def _look_at(obj, target):
    d = Vector(target) - obj.location
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def _setup(scene, fast, resolution):
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 24 if fast else 160
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 6
    scene.cycles.transparent_max_bounces = 8
    scene.render.resolution_x, scene.render.resolution_y = resolution
    scene.render.resolution_percentage = 60 if fast else 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
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
    # soft vertical gradient: bright overhead, dark floor bounce
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
    # the backdrop the camera sees gets its own strength so it keeps the same
    # brightness whatever exposure a shot uses (lighting stays unchanged)
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
# stops per shot: the area lights wash the charcoal glove out to mid grey at 0
EXPOSURE = {"rest": -2.0, "fist_pose": -1.6, "watch_closeup": -1.2, "wrist_twist": -1.6, "elbow_bend": -1.2}


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


def _shot(path, cam_loc, target, lens, lights, fast, exposure=0.0):
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


def render_all(outdir, arm_obj, fast=False, log=print, only=None):
    os.makedirs(outdir, exist_ok=True)
    scene = bpy.context.scene
    _setup(scene, fast, (1600, 900))
    wl = arm_obj.pose.bones["hand_l"].head
    wr = arm_obj.pose.bones["hand_r"].head

    def want(name):
        return only is None or name in only

    if want("rest"):
        _clear_pose(arm_obj)
        target = Vector((0.0, 0.5, -0.255))
        lights = [
            ("Key", "AREA", (0.35, 0.1, 0.35), (0.1, 0.5, -0.28), 90, {"size": 0.6}),
            ("Fill", "AREA", (-0.5, 0.2, 0.0), (0.0, 0.5, -0.28), 30, {"size": 0.8}),
            ("Rim", "AREA", (0.0, 1.1, 0.2), (0.0, 0.5, -0.28), 60, {"size": 0.5}),
        ]
        # 26 mm is about a 70 degree horizontal fov, close to a usual viewmodel fov
        _shot(os.path.join(outdir, "rest.png"), (0.0, 0.0, 0.0), target, 26, lights, fast, EXPOSURE["rest"])
        log("rendered rest.png")

    if want("fist_pose"):
        _clear_pose(arm_obj)
        # thumb up like holding a pistol: roll the whole straight arm about its
        # own axis (rigid, no deformation), then close the hand
        roll(arm_obj, "upperarm_r", 90.0)
        pose_grip(arm_obj, "r")
        bpy.context.view_layer.update()
        hand = arm_obj.matrix_world @ arm_obj.pose.bones["hand_r"].tail
        target = hand + Vector((-0.02, -0.02, -0.005))
        cam = target + Vector((-0.25, 0.225, 0.175))
        lights = [
            ("Key", "AREA", tuple(target + Vector((-0.15, 0.1, 0.32))), tuple(target), 25, {"size": 0.4}),
            ("Fill", "AREA", tuple(target + Vector((-0.3, -0.15, -0.05))), tuple(target), 10, {"size": 0.5}),
            ("Rim", "AREA", tuple(target + Vector((0.2, 0.3, 0.15))), tuple(target), 20, {"size": 0.3}),
        ]
        _shot(os.path.join(outdir, "fist_pose.png"), tuple(cam), tuple(target), 50, lights, fast,
              EXPOSURE["fist_pose"])
        log("rendered fist_pose.png")

    if want("watch_closeup"):
        _clear_pose(arm_obj)
        watch = bpy.data.objects["watch"]
        c = watch.matrix_world.translation
        z = watch.matrix_world.col[2].xyz
        target = c + Vector((0.0, 0.004, -0.004))
        cam = c + z * 0.11 + Vector((0.07, -0.08, 0.0))
        lights = [
            ("Key", "AREA", tuple(c + Vector((0.12, -0.05, 0.25))), tuple(c), 14, {"size": 0.25}),
            ("Fill", "AREA", tuple(c + Vector((-0.25, -0.1, 0.1))), tuple(c), 5, {"size": 0.5}),
            ("Rim", "AREA", tuple(c + Vector((-0.05, 0.3, 0.12))), tuple(c), 10, {"size": 0.2}),
        ]
        _shot(os.path.join(outdir, "watch_closeup.png"), tuple(cam), tuple(target), 70, lights, fast,
              EXPOSURE["watch_closeup"])
        log("rendered watch_closeup.png")

    if want("wrist_twist"):
        _clear_pose(arm_obj)
        pose_twist(arm_obj, "l", 60.0, 30.0)
        bpy.context.view_layer.update()
        w = arm_obj.matrix_world @ arm_obj.pose.bones["hand_l"].head
        target = w + Vector((0.0, -0.035, 0.0))
        cam = target + Vector((0.24, -0.1, 0.16))
        lights = [
            ("Key", "AREA", tuple(target + Vector((0.2, -0.15, 0.35))), tuple(target), 30, {"size": 0.4}),
            ("Fill", "AREA", tuple(target + Vector((-0.3, -0.1, 0.05))), tuple(target), 10, {"size": 0.6}),
            ("Rim", "AREA", tuple(target + Vector((-0.1, 0.35, 0.2))), tuple(target), 20, {"size": 0.3}),
        ]
        _shot(os.path.join(outdir, "wrist_twist.png"), tuple(cam), tuple(target), 45, lights, fast,
              EXPOSURE["wrist_twist"])
        log("rendered wrist_twist.png")

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
        _shot(os.path.join(outdir, "elbow_bend.png"), tuple(cam), tuple(target), 50, lights, fast,
              EXPOSURE["elbow_bend"])
        log("rendered elbow_bend.png")

    _clear_pose(arm_obj)
