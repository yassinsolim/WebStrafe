"""whole-body skins: artist-made, rigged sci-fi humanoids (cc-by, see
CREDITS.md and docs/assets/characters.md) re-posed onto the game skeleton.

  node tools/assets/sketchfab-fetch.mjs <uid>     # the sources live outside the repo
  sh tools/characters/build-skins.sh [ids]        # this script, the atlas and the optimizer

each skin keeps its own proportions. it gets its own joint positions: the
spine, neck, head, clavicle and hip sockets stay where the source has them,
the limbs and fingers take the game's bone directions with the source's bone
lengths. the source mesh is posed from its rest pose into that bind pose
(the limbs only turn, nothing stretches), baked, and its weights renamed onto
the game bones. the runtime builds the skeleton from those joints with the
game's bone orientations, so the pose code (playerRig.ts) runs unchanged.

every source material gets a cell of one texture atlas; this script moves the
uvs into the cells and writes the plan, tools/characters/skin_textures.py
fills the cells from the source textures.
"""

import argparse
import json
import math
import os
import re
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import common  # noqa: E402
import cbuild as B  # noqa: E402
from rig import Rig  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
SRC = os.path.join(os.path.expanduser(os.environ.get("WEBSTRAFE_ASSETS", "~/Assets/webstrafe")), "sketchfab")
OUT = os.path.join(ROOT, ".blender-tmp", "characters", "skins")
ATLAS = 2048
CELL = ATLAS // 4

FINGERS = (("thumb", "Thumb", "Thumb"), ("index", "Index", "Index"), ("middle", "Mid", "Middle"),
           ("ring", "Ring", "Ring"), ("pinky", "Pinky", "Pinky"))


def cc_map():
    """character creator (cc3/cc4) bones -> game bones. twist bones and the
    face follow their parents (see weight_map)"""
    m = {
        "CC_Base_Hip": "pelvis",
        "CC_Base_Pelvis": "pelvis",
        "CC_Base_Waist": "spine_1",
        "CC_Base_Spine01": "spine_2",
        "CC_Base_Spine02": "spine_3",
        "CC_Base_NeckTwist01": "neck_0",
        "CC_Base_NeckTwist02": "neck_0",
        "CC_Base_Head": "head_0",
    }
    for S, s in (("L", "l"), ("R", "r")):
        m.update({
            f"CC_Base_{S}_Clavicle": f"clavicle_{s}",
            f"CC_Base_{S}_Upperarm": f"arm_upper_{s}",
            f"CC_Base_{S}_Forearm": f"arm_lower_{s}",
            f"CC_Base_{S}_Hand": f"hand_{s}",
            f"CC_Base_{S}_Thigh": f"leg_upper_{s}",
            f"CC_Base_{S}_Calf": f"leg_lower_{s}",
            f"CC_Base_{S}_Foot": f"ankle_{s}",
            f"CC_Base_{S}_ToeBase": f"ball_{s}",
            # cc's volume keepers sit halfway through the bend, like the game's cap helpers
            f"CC_Base_{S}_ElbowShareBone": f"elbow_{s}",
            f"CC_Base_{S}_KneeShareBone": f"knee_{s}",
        })
        for game, cc, _ in FINGERS:
            for i in (1, 2, 3):
                m[f"CC_Base_{S}_{cc}{i}"] = f"finger_{game}_{i - 1}_{s}"
    return m


def mixamo_map():
    m = {
        "mixamorig:Hips": "pelvis",
        "mixamorig:Spine": "spine_1",
        "mixamorig:Spine1": "spine_2",
        "mixamorig:Spine2": "spine_3",
        "mixamorig:Neck": "neck_0",
        "mixamorig:Head": "head_0",
    }
    for S, s in (("Left", "l"), ("Right", "r")):
        m.update({
            f"mixamorig:{S}Shoulder": f"clavicle_{s}",
            f"mixamorig:{S}Arm": f"arm_upper_{s}",
            f"mixamorig:{S}ForeArm": f"arm_lower_{s}",
            f"mixamorig:{S}Hand": f"hand_{s}",
            f"mixamorig:{S}UpLeg": f"leg_upper_{s}",
            f"mixamorig:{S}Leg": f"leg_lower_{s}",
            f"mixamorig:{S}Foot": f"ankle_{s}",
            f"mixamorig:{S}ToeBase": f"ball_{s}",
        })
        for game, _, mx in FINGERS:
            for i in (1, 2, 3):
                m[f"mixamorig:{S}Hand{mx}{i}"] = f"finger_{game}_{i - 1}_{s}"
    return m


RIG_MAPS = {"cc": cc_map, "mixamo": mixamo_map}

# cells are (column, row, size) in quarters of the atlas, rows from the top
SKINS = {
    "ronin": {
        "file": "sci-fi-warrior-armor/sci-fi-warrior-armor.glb",
        "rig": "cc",
        "cells": {
            "head": (0, 0, 2), "torss": (2, 0, 2), "material_6": (0, 2, 2), "material_4": (2, 2, 1),
            "material": (3, 2, 1), "material_7": (2, 3, 1), "glass": (3, 3, 0.5), "lights": (3.5, 3, 0.5),
        },
        "tris": (0, 14000, 4500),
    },
    "sentinel": {
        "file": "security-cyborg/security-cyborg.glb",
        "rig": "mixamo",
        "cells": {"Body": (0, 0, 2), "Secondary": (2, 0, 2), "Head": (0, 2, 2), "material": (2, 2, 1), "Glow": (3, 2, 0.5)},
        "tris": (0, 12000, 4000),
    },
}
NECK_HEIGHT = 1.54  # the game skeleton's neck_0 (rig.json), every skin is scaled to it


def parse_args():
    ap = argparse.ArgumentParser()
    ap.add_argument("--skins", default=",".join(SKINS))
    ap.add_argument("--renders", default=None, help="folder for preview renders")
    return ap.parse_args(common.script_args())


def base_name(name):
    # sketchfab's fbx -> gltf conversion numbers every node: CC_Base_L_Hand_055
    return re.sub(r"_\d+$", "", name)


def V(a):
    return Vector(B.to_blender(np.asarray(a, dtype=np.float64)).tolist())


def rmin(a, b):
    """the smallest rotation taking direction a onto b (3x3)"""
    return a.normalized().rotation_difference(b.normalized()).to_matrix()


def frame(forward, across):
    x = forward.normalized()
    y = (across - x * across.dot(x)).normalized()
    return Matrix((x, y, x.cross(y))).transposed()


# ------------------------------------------------------------------ source
def import_source(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
    meshes = [o for o in bpy.context.scene.objects
              if o.type == "MESH" and any(m.type == "ARMATURE" and m.object == arm for m in o.modifiers)]
    # props the uploader left in the scene (a gun, a stray sphere) aren't skinned
    for o in list(bpy.context.scene.objects):
        if o.type == "MESH" and o not in meshes:
            bpy.data.objects.remove(o, do_unlink=True)
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    arm.data.pose_position = "POSE"
    bpy.context.view_layer.update()
    return arm, meshes


def normalizer(arm, meshes, joint_src):
    """uniform scale and offset into game space: neck at the game's neck height,
    pelvis over the game's pelvis, soles on the floor"""
    W = arm.matrix_world
    bones = {base_name(b.name): b for b in arm.data.bones}
    neck = W @ bones[joint_src["neck_0"]].head_local
    pelvis = W @ bones[joint_src["pelvis"]].head_local
    s = NECK_HEIGHT / neck.z
    floor = min((o.matrix_world @ v.co).z for o in meshes for v in o.data.vertices)
    game_pelvis = V([0, 0.9756, 0.0035])
    t = Vector((-pelvis.x * s, game_pelvis.y - pelvis.y * s, -floor * s))
    return Matrix.Translation(t) @ Matrix.Scale(s, 4), s


# ------------------------------------------------------------------ joints
def skin_joints(rig, src):
    """the skin's bind joints (blender space) and each joint's rotation from the source rest pose"""
    G = {j: V(rig.p(j)) for j in rig.order}
    GA = {j: V(rig.axis(j)) for j in rig.order}
    I3 = Matrix.Identity(3)
    pos, rot = {}, {}

    def chain_child(j):
        for c in rig.order:
            if rig.parent(c) == j and c in src and (G[c] - G[j]).normalized().dot(GA[j]) > 0.99:
                return c
        return None

    def src_len(a, b):
        return (src[b] - src[a]).length

    for side in ("l", "r"):
        hand = f"hand_{side}"
        fs = lambda f, k: f"finger_{f}_{k}_{side}"  # noqa: E731
        F_src = frame(src[fs("middle", 0)] - src[hand], src[fs("index", 0)] - src[fs("pinky", 0)])
        F_game = frame(G[fs("middle", 0)] - G[hand], G[fs("index", 0)] - G[fs("pinky", 0)])
        rot[hand] = F_game @ F_src.transposed()

    hand_scale = {}
    for side in ("l", "r"):
        a = (src[f"finger_middle_0_{side}"] - src[f"hand_{side}"]).length
        b = (G[f"finger_middle_0_{side}"] - G[f"hand_{side}"]).length
        hand_scale[side] = a / b

    for j in rig.order:
        p = rig.parent(j)
        if p is None:
            pos[j], rot[j] = src[j].copy(), I3
            continue
        if j in ("spine_1", "spine_2", "spine_3", "neck_0", "head_0") or j.startswith(("clavicle_", "leg_upper_")):
            pos[j] = src[j].copy()
        elif j == "spine_0":
            t = (G["spine_0"] - G["pelvis"]).length / (G["spine_1"] - G["pelvis"]).length
            pos[j] = pos["pelvis"].lerp(src["spine_1"], t)
        elif j.startswith("weapon_hand_"):
            pos[j] = pos[p] + GA[p] * ((G[j] - G[p]).length * hand_scale[j[-1]])
        elif j.startswith("finger_") and j.split("_")[2] == "0":
            pos[j] = pos[p] + rot[p] @ (src[j] - src[p])
        elif j.startswith("finger_"):
            pos[j] = pos[p] + (G[j] - G[p]).normalized() * src_len(p, j)
        elif j in src and p in src:
            # a limb joint on its parent's axis
            pos[j] = pos[p] + GA[p] * src_len(p, j)
        else:
            # cloth chains and cap helpers keep the game's offsets
            pos[j] = pos[p] + (G[j] - G[p])
        if j in rot:
            continue
        prot = rot.get(p, I3)
        if j in ("spine_0", "spine_1", "spine_2", "spine_3", "neck_0", "head_0"):
            # the trunk stays as modelled
            rot[j] = I3
        elif j.startswith("finger_"):
            _, f, k, side = j.split("_")
            child = f"finger_{f}_{int(k) + 1}_{side}"
            # each segment takes the game's finger line; the tips ride along
            rot[j] = rmin(prot @ (src[child] - src[j]), G[child] - G[j]) @ prot if child in src else prot
        else:
            child = chain_child(j)
            rot[j] = rmin(prot @ (src[child] - src[j]), GA[j]) @ prot if child else prot
    return pos, rot


class SkinRig(Rig):
    """rig.json with this skin's joint positions (directions unchanged)"""

    def __init__(self, base, pos_blender):
        self.joints = {k: dict(v) for k, v in base.joints.items()}
        self.order = list(base.order)
        self.knife = base.knife
        for j in self.order:
            self.joints[j]["position"] = B.to_three(np.array(pos_blender[j][:])).tolist()
        for j in self.order:
            kids = [c for c in self.order if self.joints[c]["parent"] == j]
            axis = np.array(self.joints[j]["axis"])
            on = [np.linalg.norm(self.p(c) - self.p(j)) for c in kids
                  if np.dot(self.p(c) - self.p(j), axis) > 0.99 * np.linalg.norm(self.p(c) - self.p(j)) > 0]
            if on:
                self.joints[j]["length"] = float(on[0])


# ------------------------------------------------------------------ pose and bake
def bone_order(arm):
    out = []

    def walk(b):
        out.append(b)
        for c in b.children:
            walk(c)

    for b in arm.pose.bones:
        if b.parent is None:
            walk(b)
    return out


def pose_source(arm, AW, targets):
    """targets: source bone name -> (head in game space, 3x3 world rotation from rest)"""
    AWi = AW.inverted()
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    for pb in bone_order(arm):
        if pb.name not in targets:
            continue
        head, D = targets[pb.name]
        rest = AW @ pb.bone.matrix_local
        M = Matrix.Translation(head) @ D.to_4x4() @ Matrix.Translation(-rest.translation) @ rest
        pb.matrix = AWi @ M
        bpy.context.view_layer.update()
    bpy.ops.object.mode_set(mode="OBJECT")


def bake(meshes, A):
    dg = bpy.context.evaluated_depsgraph_get()
    out = []
    for ob in meshes:
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
        me.transform(A @ ob.matrix_world)
        baked = bpy.data.objects.new(f"{ob.name}.baked", me)
        bpy.context.scene.collection.objects.link(baked)
        for vg in ob.vertex_groups:
            baked.vertex_groups.new(name=vg.name)
        out.append(baked)
    return out


def weight_map(arm, explicit):
    """source bone -> game bone: the explicit map, else the nearest mapped ancestor"""
    out = {}
    for b in arm.data.bones:
        p = b
        while p is not None and base_name(p.name) not in explicit:
            p = p.parent
        out[b.name] = explicit[base_name(p.name)] if p is not None else "pelvis"
    return out


def game_weights(obj, names):
    n = len(obj.data.vertices)
    idx = {vg.index: names.get(vg.name, "pelvis") for vg in obj.vertex_groups}
    out = {}
    for v in obj.data.vertices:
        for g in v.groups:
            if g.weight <= 0:
                continue
            bone = idx[g.group]
            arr = out.get(bone)
            if arr is None:
                arr = out[bone] = np.zeros(n)
            arr[v.index] += g.weight
    return out


# ------------------------------------------------------------------ atlas
def cell_rect(cell):
    col, row, size = cell
    return (col * CELL, row * CELL, size * CELL)


def remap_uvs(obj, rect, pad):
    """source uvs (one tile, gltf v down) into the atlas cell, inset by pad pixels"""
    me = obj.data
    uv = me.uv_layers.active or me.uv_layers[0]
    co = np.zeros(len(uv.data) * 2)
    uv.data.foreach_get("uv", co)
    co = co.reshape(-1, 2)
    u, v = co[:, 0], 1.0 - co[:, 1]
    # one tile per material, but not always tile 0
    u = u - math.floor(float(u.min()) + 1e-4) if len(u) else u
    v = v - math.floor(float(v.min()) + 1e-4) if len(v) else v
    x, y, size = rect
    inner = size - 2 * pad
    u = (x + pad + np.clip(u, 0, 1) * inner) / ATLAS
    v = (y + pad + np.clip(v, 0, 1) * inner) / ATLAS
    co[:, 0], co[:, 1] = u, 1.0 - v
    uv.data.foreach_set("uv", co.ravel())
    # one uv layer on the export
    keep = uv.name
    for layer in list(me.uv_layers):
        if layer.name != keep:
            me.uv_layers.remove(layer)
    me.uv_layers[0].name = "UVMap"


def decimate(obj, target):
    """collapse decimation that keeps the vertex groups"""
    if B.tri_count(obj) <= target:
        return
    mod = obj.modifiers.new("decimate", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = max(0.0005, min(1.0, target / B.tri_count(obj)))
    mod.use_collapse_triangulate = True
    with bpy.context.temp_override(object=obj, active_object=obj):
        bpy.ops.object.modifier_apply(modifier=mod.name)


def plain_material(name):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    return mat


# ------------------------------------------------------------------ decals
# emblem on the left breast, callsign on the right, like the kit's chest plates
DECALS = (("emblem", 1.0, 0.075), ("tag", -1.0, 0.13))


def find_decal_spot(body, side):
    """the flattest front facing spot on one side of the upper chest"""
    best = None
    for x in (0.06, 0.075, 0.09, 0.105, 0.12):
        for z in (1.30, 1.33, 1.36, 1.39, 1.42):
            ok, loc, normal, _ = body.ray_cast(Vector((x * side, -1.0, z)), Vector((0, 1, 0)), distance=2.0)
            if not ok:
                continue
            frontal = -normal.y
            score = frontal - abs(z - 1.36) * 0.8 - abs(x - 0.09) * 0.8
            if best is None or score > best[0]:
                best = (score, loc.copy(), normal.copy())
    return best


def add_anchor(skin_id, kind, loc, normal, size):
    """an empty at the decal spot: in three space +z out of the surface, +y up the decal"""
    z = B.to_three(np.array(normal.normalized()[:]))
    up = np.array([0.0, 1.0, 0.0])
    y = up - z * float(up @ z)
    y /= np.linalg.norm(y)
    x = np.cross(y, z)
    R = np.stack([x, y, z], axis=1)
    # three -> blender basis change on both sides, the exporter undoes it the same way
    C = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], dtype=np.float64)
    M = Matrix((C @ R @ C.T).tolist())
    empty = common.add_empty(f"anchor.skin.{skin_id}.{kind}", tuple(loc + normal.normalized() * 0.002))
    empty.rotation_euler = M.to_euler()
    empty["bone"] = "spine_3"
    empty["size"] = size
    empty["kind"] = kind
    empty["set"] = skin_id
    return empty


# ------------------------------------------------------------------ renders
def render_views(folder, skin_id, objs):
    """front, side and back stills plus a hand close-up with the source materials"""
    scene = bpy.context.scene
    views = {
        "front": ((0, -4.2, 1.0), (0, 0, 0.92), 50, (640, 1000)),
        "side": ((4.2, 0, 1.0), (0, 0, 0.92), 50, (640, 1000)),
        "back": ((0, 4.2, 1.0), (0, 0, 0.92), 50, (640, 1000)),
        "hand": ((0.9, -0.75, 1.0), (0.55, 0.0, 0.95), 85, (640, 640)),
        "head": ((0.35, -0.9, 1.72), (0, 0, 1.68), 85, (640, 640)),
    }
    for view, (cam, target, lens, res) in views.items():
        common.render_preview(os.path.join(folder, f"{skin_id}_{view}.png"), cam, target, lens=lens, resolution=res,
                              world_color=(0.32, 0.34, 0.38))


# ------------------------------------------------------------------ first-person arms
ARMS_DIR = os.path.join(os.path.dirname(HERE), "arms")
FINGER_FP = {"thumb": "thumb", "index": "index", "middle": "middle", "ring": "ring", "pinky": "pinky"}


def render_fp(folder, skin_id, objs):
    """the fp arms in the rig's rest pose: from beside the right arm and from the camera"""
    hidden = []
    for ob in bpy.context.scene.objects:
        if ob.type == "MESH" and ob not in objs and not ob.hide_render:
            ob.hide_render = True
            hidden.append(ob)
    views = {
        "fp_side": ((0.75, 0.25, 0.05), (0.19, 0.42, -0.28), 50),
        "fp_cam": ((0.0, -0.02, 0.02), (0.0, 0.5, -0.3), 28),
    }
    for view, (cam, target, lens) in views.items():
        common.render_preview(os.path.join(folder, f"{skin_id}_{view}.png"), cam, target, lens=lens, resolution=(800, 520),
                              world_color=(0.32, 0.34, 0.38))
    for ob in hidden:
        ob.hide_render = False


def _arms_modules():
    """tools/blender/arms params and rig, loaded by path (this folder has its own rig.py)"""
    import importlib.util

    if ARMS_DIR not in sys.path:
        sys.path.append(ARMS_DIR)
    out = []
    for name, file in (("params", "params.py"), ("arms_rig", "rig.py")):
        if name in sys.modules:
            out.append(sys.modules[name])
            continue
        spec = importlib.util.spec_from_file_location(name, os.path.join(ARMS_DIR, file))
        mod = importlib.util.module_from_spec(spec)
        sys.modules[name] = mod
        spec.loader.exec_module(mod)
        out.append(mod)
    return out


def smoothstep(e0, e1, x):
    t = np.clip((np.asarray(x, dtype=np.float64) - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def rot_about(axis, angle):
    return Matrix.Rotation(angle, 3, axis.normalized())


def build_fp_arms(skin_id, body, names, pos):
    """the skin's own arms for first person: each arm cut from the conformed
    body and posed onto the fp rig (tools/blender/arms), whose joints the
    grips are fitted to. the limbs turn and scale onto the rig's bones, the
    hand rolls palm down with the roll spread along the forearm (like a real
    forearm turns) instead of twisting at the wrist, then the weights move onto
    the fp bones with the rig's forearm twist ramp."""
    P, AR = _arms_modules()
    layout = P.bone_layout()
    # face the camera's way: the character looks -y, the fp rig +y
    R0 = Matrix.Rotation(math.pi, 3, "Z")
    R0n = np.array(R0)
    me0 = body.data
    co_all = np.zeros(len(me0.vertices) * 3)
    me0.vertices.foreach_get("co", co_all)
    co_all = co_all.reshape(-1, 3) @ R0n.T
    n_all = len(co_all)
    loop_start = np.zeros(len(me0.polygons), dtype=np.int64)
    loop_total = np.zeros(len(me0.polygons), dtype=np.int64)
    me0.polygons.foreach_get("loop_start", loop_start)
    me0.polygons.foreach_get("loop_total", loop_total)
    loop_vert = np.zeros(len(me0.loops), dtype=np.int64)
    me0.loops.foreach_get("vertex_index", loop_vert)
    uv_all = np.zeros(len(me0.loops) * 2)
    me0.uv_layers[0].data.foreach_get("uv", uv_all)
    uv_all = uv_all.reshape(-1, 2)
    cn_all = np.zeros(len(me0.loops) * 3)
    me0.corner_normals.foreach_get("vector", cn_all)
    cn_all = cn_all.reshape(-1, 3) @ R0n.T
    W_all = game_weights(body, names)
    fp_arm = AR.build_armature(f"ArmsRig_{skin_id}")
    made = []
    for side in ("r", "l"):
        chain = [f"arm_upper_{side}", f"arm_lower_{side}", f"hand_{side}", f"weapon_hand_{side}", f"elbow_{side}"]
        chain += [f"finger_{f}_{k}_{side}" for f in FINGER_FP for k in range(3)]
        total = sum(W_all.values())
        share = sum(W_all[b] for b in chain if b in W_all) / np.maximum(total, 1e-9)

        S = {j: R0 @ pos[j] for j in pos}
        F = {name: Vector(head) for name, (head, tail, parent, conn) in layout.items()}
        elbow, wrist = F[f"forearm_{side}"], F[f"hand_{side}"]
        axis = (wrist - elbow).normalized()
        fore_len = (wrist - elbow).length

        T = {}  # game bone -> (src origin, target origin, scale, rotation)
        up, lo, hand = f"arm_upper_{side}", f"arm_lower_{side}", f"hand_{side}"
        R_u = rmin(S[lo] - S[up], elbow - F[f"upperarm_{side}"])
        s_u = (elbow - F[f"upperarm_{side}"]).length / (S[lo] - S[up]).length
        T[up] = (S[up], F[f"upperarm_{side}"], s_u, R_u)
        R_f = rmin(R_u @ (S[hand] - S[lo]), wrist - elbow) @ R_u
        T[lo] = (S[lo], elbow, fore_len / (S[hand] - S[lo]).length, R_f)
        # the hand: full frame onto the rig's hand, scaled to its palm
        mid0, idx0, pin0 = (f"finger_{f}_0_{side}" for f in ("middle", "index", "pinky"))
        F_mid, F_idx, F_pin = (F[f"{f}_01_{side}"] for f in ("middle", "index", "pinky"))
        R_full = frame(F_mid - wrist, F_idx - F_pin) @ frame(S[mid0] - S[hand], S[idx0] - S[pin0]).transposed()
        R_h0 = rmin(R_f @ (S[mid0] - S[hand]), F_mid - wrist) @ R_f
        a0 = R_h0 @ (S[idx0] - S[pin0])
        a1 = F_idx - F_pin
        a0 = (a0 - axis * a0.dot(axis)).normalized()
        a1 = (a1 - axis * a1.dot(axis)).normalized()
        phi = math.atan2(axis.dot(a0.cross(a1)), a0.dot(a1))
        unroll = rot_about(axis, -phi)

        def pre(p):
            # rig targets turned back by the roll, the twist pass turns them home
            return elbow + unroll @ (p - elbow)

        s_h = (F_mid - wrist).length / (S[mid0] - S[hand]).length
        R_h = unroll @ R_full
        T[hand] = (S[hand], wrist, s_h, R_h)
        T[f"weapon_hand_{side}"] = T[hand]
        T[f"elbow_{side}"] = T[lo]
        for f in FINGER_FP:
            fp = FINGER_FP[f]
            prev = R_h
            for k in range(3):
                g = f"finger_{f}_{k}_{side}"
                head = pre(F[f"{fp}_{k + 1:02d}_{side}"])
                if k < 2:
                    nxt_src = S[f"finger_{f}_{k + 1}_{side}"]
                    nxt_dst = pre(F[f"{fp}_{k + 2:02d}_{side}"])
                    R_k = rmin(prev @ (nxt_src - S[g]), nxt_dst - head) @ prev
                    s_k = (nxt_dst - head).length / max((nxt_src - S[g]).length, 1e-6)
                else:
                    R_k, s_k = prev, last_scale
                T[g] = (S[g], head, s_k, R_k)
                prev, last_scale = R_k, s_k

        # linear blend of the bone moves (anything else the cut keeps rides the upper
        # arm), keeping each vertex's blended rotation for its normals
        keep_v = share > 0.5
        face_keep = np.minimum.reduceat(keep_v[loop_vert].astype(np.int8), loop_start).astype(bool)
        loop_keep = np.repeat(face_keep, loop_total)
        used = np.zeros(n_all, bool)
        used[loop_vert[loop_keep]] = True
        idx = np.nonzero(used)[0]
        co = co_all[idx]
        out = np.zeros_like(co)
        rot = np.zeros((len(idx), 3, 3))
        wsum = np.zeros(len(idx))
        for b, wb in W_all.items():
            w = wb[idx]
            if not np.any(w > 0):
                continue
            src, dst, sc, R = T.get(b, T[up])
            Rm = np.array(R)
            out += ((co - np.array(src)) @ Rm.T * sc + np.array(dst)) * w[:, None]
            rot += Rm[None] * w[:, None, None]
            wsum += w
        out /= np.maximum(wsum, 1e-9)[:, None]
        rot[wsum <= 0] = np.eye(3)
        U, _, Vt = np.linalg.svd(rot)
        flip = np.linalg.det(U @ Vt) < 0
        U[flip, :, 2] *= -1
        rot = U @ Vt

        # the twist pass: hand and fingers turn the full roll, the forearm ramps into it
        W = lambda names_: sum(W_all[x][idx] for x in names_ if x in W_all)  # noqa: E731
        w_hand = W([hand, f"weapon_hand_{side}"] + [f"finger_{f}_{k}_{side}" for f in FINGER_FP for k in range(3)])
        w_fore = W([lo, f"elbow_{side}"])
        e = np.array(elbow)
        ax = np.array(axis)
        s_v = ((out - e) @ ax) / fore_len
        t = np.clip((w_hand + w_fore * smoothstep(0.1, 0.95, s_v)) / np.maximum(wsum, 1e-9), 0, 1)
        rel = out - e
        along = (rel @ ax)[:, None] * ax
        perp = rel - along
        ang = phi * t
        c, sn = np.cos(ang), np.sin(ang)
        out = e + along + perp * c[:, None] + np.cross(ax, perp) * sn[:, None]
        K = np.array([[0, -ax[2], ax[1]], [ax[2], 0, -ax[0]], [-ax[1], ax[0], 0]])
        Rt = c[:, None, None] * np.eye(3)[None] + (1 - c)[:, None, None] * np.outer(ax, ax)[None] + sn[:, None, None] * K[None]
        rot = Rt @ rot

        # a new mesh with just this arm: kept faces, their uvs and the artist's normals turned along
        remap = -np.ones(n_all, dtype=np.int64)
        remap[idx] = np.arange(len(idx))
        faces = [remap[loop_vert[loop_start[f]:loop_start[f] + loop_total[f]]].tolist() for f in np.nonzero(face_keep)[0]]
        me = bpy.data.meshes.new(f"skinarms.{skin_id}.{side}")
        me.from_pydata(out.tolist(), [], faces)
        me.validate(clean_customdata=False)
        layer = me.uv_layers.new(name="UVMap")
        layer.data.foreach_set("uv", uv_all[loop_keep].ravel())
        nrm = np.einsum("nij,nj->ni", rot[remap[loop_vert[loop_keep]]], cn_all[loop_keep])
        me.normals_split_custom_set([tuple(v) for v in nrm])
        me.materials.append(plain_material(f"skin_{skin_id}"))
        me.update()
        ob = bpy.data.objects.new(f"skinarms.{skin_id}.{side}", me)
        bpy.context.scene.collection.objects.link(ob)

        # weights onto the fp bones, the forearm split by the rig's twist ramp
        s_cm = ((np.array(wrist) - out) @ ax) / P.CM
        twist = 1.0 - smoothstep(P.TWIST_FULL_S, P.TWIST_RAMP_START_S, s_cm)
        fpw = {}

        def add(bone, w):
            fpw[bone] = fpw.get(bone, 0.0) + w

        for b, wb in W_all.items():
            w = wb[idx]
            if not np.any(w > 0):
                continue
            if b in (lo, f"elbow_{side}"):
                add(f"forearm_{side}", w * (1 - twist))
                add(f"forearm_twist_{side}", w * twist)
            elif b in (hand, f"weapon_hand_{side}"):
                add(f"hand_{side}", w)
            elif b.startswith("finger_") and b.endswith(f"_{side}"):
                _, f, k, _s = b.split("_")
                add(f"{FINGER_FP[f]}_{int(k) + 1:02d}_{side}", w)
            else:
                add(f"upperarm_{side}", w)
        B.bind(ob, fp_arm, fpw)
        ob["skin_arms"] = skin_id
        ob["side"] = side
        made.append(ob)
        B.log(f"{skin_id}: fp {side} arm {B.tri_count(ob)} tris, roll {math.degrees(phi):.0f} deg, "
              f"hand x{s_h:.2f}, forearm x{fore_len / (S[hand] - S[lo]).length:.2f}")
    return fp_arm, made


# ------------------------------------------------------------------ build
def build_skin(skin_id, spec, rig, renders):
    path = os.path.join(SRC, spec["file"])
    B.log(f"{skin_id}: importing {path}")
    arm, meshes = import_source(path)
    explicit = RIG_MAPS[spec["rig"]]()
    joint_src = {}
    for src_name, game in explicit.items():
        if game.startswith(("elbow_", "knee_")):
            continue
        joint_src.setdefault(game, src_name)
    A, s = normalizer(arm, meshes, joint_src)
    AW = A @ arm.matrix_world
    bones = {base_name(b.name): b for b in arm.data.bones}
    missing = [g for g, n in joint_src.items() if n not in bones]
    if missing:
        raise RuntimeError(f"{skin_id}: source has no bones for {missing}")
    src = {g: AW @ bones[n].head_local for g, n in joint_src.items()}
    pos, rot = skin_joints(rig, src)

    targets = {bones[n].name: (pos[g], rot[g]) for g, n in joint_src.items()}
    pose_source(arm, AW, targets)
    baked = bake(meshes, A)
    names = weight_map(arm, explicit)

    if renders:
        for ob in meshes:
            ob.hide_render = True
        arm.hide_render = True
        render_views(renders, skin_id, baked)

    # atlas: each material's uvs into its cell
    plan = {"skin": skin_id, "source": spec["file"], "size": ATLAS, "cells": []}
    for ob in baked:
        mat = ob.data.materials[0].name if ob.data.materials else ""
        cell = spec["cells"].get(mat)
        if cell is None:
            raise RuntimeError(f"{skin_id}: material {mat!r} has no atlas cell")
        rect = cell_rect(cell)
        pad = max(2, int(rect[2] * 0.01))
        remap_uvs(ob, rect, pad)
    for mat, cell in spec["cells"].items():
        x, y, size = cell_rect(cell)
        plan["cells"].append({"material": mat, "rect": [x, y, size], "pad": max(2, int(size * 0.01))})

    # one object, one material
    bpy.ops.object.select_all(action="DESELECT")
    for ob in baked:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = baked[0]
    bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    body.name = f"skin.{skin_id}"
    body.data.materials.clear()
    body.data.materials.append(plain_material(f"skin_{skin_id}"))
    body.data.polygons.foreach_set("material_index", [0] * len(body.data.polygons))
    for ob in meshes:
        bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.objects.remove(arm, do_unlink=True)

    srig = SkinRig(rig, pos)
    skel = B.build_armature(srig, name=f"SkinRig_{skin_id}")
    joints_three = {j: [round(float(x), 5) for x in srig.p(j)] for j in srig.order}
    empties = []
    for kind, side, size in DECALS:
        spot = find_decal_spot(body, side)
        if spot is None:
            B.log(f"WARNING {skin_id}: no chest spot for the {kind}")
            continue
        empties.append(add_anchor(skin_id, kind, spot[1], spot[2], size))
        B.log(f"{skin_id}: {kind} at {tuple(round(v, 3) for v in spot[1])}, facing {-spot[2].y:.2f}")

    fp_arm, fp_made = build_fp_arms(skin_id, body, names, pos)
    if renders:
        render_fp(renders, skin_id, fp_made)
    common.export_glb(os.path.join(OUT, f"{skin_id}_arms_raw.glb"), objects=[fp_arm] + fp_made, animations=False)
    made = []
    full = B.tri_count(body)
    for lod, target in enumerate(spec["tris"]):
        dup = B.copy_object(body, f"skin.{skin_id}.body.lod{lod}")
        if target and full > target:
            decimate(dup, target)
        dup.data.validate(clean_customdata=False)
        weights = game_weights(dup, names)
        dup.vertex_groups.clear()
        B.bind(dup, skel, weights)
        dup["slot"] = "skin"
        dup["set"] = skin_id
        dup["part"] = "body"
        dup["lod"] = lod
        dup["mat"] = "primary"
        if lod == 0:
            dup["joints"] = json.dumps(joints_three, separators=(",", ":"))
        made.append(dup)
        B.log(f"{skin_id}: lod{lod} {B.tri_count(dup)} tris, {len(dup.data.vertices)} verts")
    bpy.data.objects.remove(body, do_unlink=True)

    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, f"{skin_id}_atlas.json"), "w") as f:
        json.dump(plan, f, indent=1)
    common.export_glb(os.path.join(OUT, f"{skin_id}_raw.glb"), objects=[skel] + made + empties, animations=False)
    B.log(f"{skin_id}: scale {s:.4f}, hand {(pos['finger_middle_0_r'] - pos['hand_r']).length:.3f} m to the knuckles")


def main():
    args = parse_args()
    rig = Rig()
    for skin_id in [s for s in args.skins.split(",") if s]:
        build_skin(skin_id, SKINS[skin_id], rig, args.renders)


if __name__ == "__main__":
    main()
