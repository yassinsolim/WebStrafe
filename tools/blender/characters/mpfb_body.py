"""a real humanoid under the armor: an MPFB2 human (MakeHuman CC0 system
assets, see CREDITS.md) conformed onto the game's skeleton (rig.json).

why conform instead of shipping the mpfb rig: the knife stance, menu pose and
remote swing are tuned on the game skeleton's joints, and the netcode, hit
boxes and first-person arms don't care what the body looks like. so the mpfb
body is posed until every joint sits where the game expects it, that pose is
baked into the rest shape, and its (good, hand painted) weights are renamed
onto the game's bones. the game rig carries mpfb's finger bones
(FINGER_JOINTS in skeleton.ts), so the hands stay open at rest and the grip
is posed at runtime (playerRig.ts).

needs the MPFB2 blender extension (tools/blender/README.md).
"""

import importlib
import math
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

import cbuild as B

# mpfb game_engine bone -> game bone
BONE_MAP = {
    "Root": "pelvis",
    "pelvis": "pelvis",
    "spine_01": "spine_1",
    "spine_02": "spine_2",
    "spine_03": "spine_3",
    "neck_01": "neck_0",
    "head": "head_0",
}
for s in ("l", "r"):
    BONE_MAP.update({
        f"clavicle_{s}": f"clavicle_{s}",
        f"upperarm_{s}": f"arm_upper_{s}",
        f"lowerarm_{s}": f"arm_lower_{s}",
        f"hand_{s}": f"hand_{s}",
        f"thigh_{s}": f"leg_upper_{s}",
        f"calf_{s}": f"leg_lower_{s}",
        f"foot_{s}": f"ankle_{s}",
        f"ball_{s}": f"ball_{s}",
        # cap helpers (CAP_HELPERS in skeleton.ts), only armor weights them
        f"knee_{s}": f"knee_{s}",
        f"elbow_{s}": f"elbow_{s}",
    })
    for f in ("thumb", "index", "middle", "ring", "pinky"):
        for i in (1, 2, 3):
            BONE_MAP[f"{f}_0{i}_{s}"] = f"finger_{f}_{i - 1}_{s}"

# the torso, neck and legs of the game skeleton are the mpfb joints, so only
# the arms move: mpfb rests with the elbows bent forward, the game rig has
# straight a-pose arms. (bone, head joint, aim joint, match length)
AIM = {}
for s in ("l", "r"):
    AIM.update({
        f"upperarm_{s}": (f"arm_upper_{s}", f"arm_lower_{s}", True),
        f"lowerarm_{s}": (f"arm_lower_{s}", f"hand_{s}", True),
        f"hand_{s}": (f"hand_{s}", f"weapon_hand_{s}", False),
    })

# lean and athletic: the cyborg sets read slim, and heavier settings made the gloves look chubby
MACROS = {"gender": 1.0, "muscle": 0.85, "weight": 0.45, "height": 0.56, "proportions": 1.0}


def _mpfb(pkg, key):
    for name in list(sys.modules):
        if name.endswith(pkg):
            return getattr(importlib.import_module(name), key)
    raise RuntimeError(f"mpfb module {pkg} not loaded: install and enable the MPFB2 extension")


def make_human():
    HumanService = _mpfb("mpfb.services.humanservice", "HumanService")
    TargetService = _mpfb("mpfb.services.targetservice", "TargetService")
    Props = _mpfb("mpfb.entities.objectproperties", "HumanObjectProperties")
    human = HumanService.create_human()
    for key, val in MACROS.items():
        Props.set_value(key, val, entity_reference=human)
    TargetService.reapply_macro_details(human)
    rig = HumanService.add_builtin_rig(human, "game_engine")
    bpy.context.view_layer.update()
    return human, rig


def _target_blender(rig_json, joint):
    return Vector(B.to_blender(rig_json.p(joint)).tolist())


def conform(rig_obj, rig_json):
    """poses the mpfb rig onto the game joints (head position, aim and length)"""
    bpy.context.view_layer.objects.active = rig_obj
    bpy.ops.object.mode_set(mode="POSE")
    pose = rig_obj.pose.bones
    order = []

    def walk(b):
        order.append(b.name)
        for c in b.children:
            walk(c)

    walk(rig_obj.data.bones["Root"])
    for name in order:
        pb = pose[name]
        if name not in AIM:
            continue
        head_j, tail_j, match = AIM[name]
        head = _target_blender(rig_json, head_j)
        rest = pb.bone.matrix_local.copy()
        rest_len = pb.bone.length
        tail = _target_blender(rig_json, tail_j)
        y = (tail - head)
        length = y.length if match else rest_len
        y.normalize()
        x_rest = rest.to_3x3() @ Vector((1, 0, 0))
        x = (x_rest - y * x_rest.dot(y)).normalized()
        z = x.cross(y)
        s = length / max(rest_len, 1e-6)
        M = Matrix((
            (x.x, y.x * s, z.x, head.x),
            (x.y, y.y * s, z.y, head.y),
            (x.z, y.z * s, z.z, head.z),
            (0, 0, 0, 1),
        ))
        pb.matrix = M
        bpy.context.view_layer.update()
    bpy.ops.object.mode_set(mode="OBJECT")


def bake_body(human):
    """the posed, masked human as a plain mesh in the conformed rest shape"""
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(human.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    me.transform(human.matrix_world)
    body = bpy.data.objects.new("mpfb_body", me)
    bpy.context.scene.collection.objects.link(body)
    # the mesh keeps the human's weights by group index; give it the same names
    for vg in human.vertex_groups:
        body.vertex_groups.new(name=vg.name)
    return body


def game_weights(body, human):
    """per-vertex weights keyed by game bone, from the mpfb groups (summed where many map to one)"""
    n = len(body.data.vertices)
    idx_to_game = {}
    for vg in body.vertex_groups:
        if vg.name in BONE_MAP:
            idx_to_game[vg.index] = BONE_MAP[vg.name]
    out = {}
    for v in body.data.vertices:
        for g in v.groups:
            bone = idx_to_game.get(g.group)
            if bone is None or g.weight <= 0:
                continue
            arr = out.setdefault(bone, np.zeros(n))
            arr[v.index] += g.weight
    return out


def posed_points(rig_obj):
    """mpfb bone name -> (head, tail) in blender world space, as posed"""
    mw = rig_obj.matrix_world
    return {pb.name: (mw @ pb.head, mw @ pb.tail) for pb in rig_obj.pose.bones}


def build(rig_json, with_points=False):
    """returns (body object in blender space, weights keyed by game bone[, posed mpfb landmarks])"""
    human, rig_obj = make_human()
    conform(rig_obj, rig_json)
    body = bake_body(human)
    weights = game_weights(body, human)
    points = posed_points(rig_obj)
    # the source human and its rig are done with
    for ob in (human, rig_obj):
        bpy.data.objects.remove(ob, do_unlink=True)
    return (body, weights, points) if with_points else (body, weights)
