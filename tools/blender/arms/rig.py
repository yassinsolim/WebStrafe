"""armature and custom skin weights for the arms.

weights are computed from the build geometry instead of blender's heat
weighting (which is flaky headless on meshes like this):
  - along the arm axis: upperarm -> forearm across the elbow, forearm ->
    forearm_twist over the distal forearm, twist -> hand across the wrist.
  - on the muscle suit: a soft assignment to parts (palm, thenar, each
    finger, thumb, forearm) from the sdf part distances, then per part rules
    along the bone chain with smooth blends centred on every joint.
  - plates on the hand and digits are rigid on their bone.
max 4 influences, normalized.
"""

import math

import bpy
import numpy as np
from mathutils import Vector

import params as P


def smoothstep(e0, e1, x):
    t = np.clip((np.asarray(x, dtype=np.float64) - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


# ---------------------------------------------------------------- armature
def build_armature(name="ArmsRig"):
    arm_data = bpy.data.armatures.new(name)
    arm_obj = bpy.data.objects.new(name, arm_data)
    bpy.context.scene.collection.objects.link(arm_obj)
    bpy.context.view_layer.objects.active = arm_obj
    arm_obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    layout = P.bone_layout()
    ebones = {}
    for bname, (head, tail, parent, connected) in layout.items():
        eb = arm_data.edit_bones.new(bname)
        eb.head = Vector(head)
        eb.tail = Vector(tail)
        ebones[bname] = eb
    thumb_pts, thumb_pads, _ = P.thumb_chain()
    for bname, (head, tail, parent, connected) in layout.items():
        eb = ebones[bname]
        if parent:
            eb.parent = ebones[parent]
            eb.use_connect = connected
        side = bname[-1]
        flip = -1.0 if side == "l" else 1.0
        if bname.startswith("thumb_"):
            # z axis out of the thumbnail, so local x is the thumb curl axis
            i = int(bname[6:8]) - 1
            nail = -np.array(thumb_pads[i])
            nail[0] *= flip
            eb.align_roll(Vector(nail))
        else:
            eb.align_roll(Vector((0.0, 0.0, 1.0)))
        eb.use_deform = True
    bpy.ops.object.mode_set(mode="OBJECT")
    arm_data.display_type = "STICK"
    return arm_obj


# ---------------------------------------------------------------- weights
def arm_rule(s):
    """weights for upperarm/forearm/forearm_twist/hand from s (cm from wrist)"""
    e_hi, e_lo = P.ELBOW_BLEND
    upper = smoothstep(e_lo, e_hi, s)
    rest = 1.0 - upper
    hand = rest * (1.0 - smoothstep(P.WRIST_BLEND[1], P.WRIST_BLEND[0], s))
    rest2 = rest - hand
    twist = rest2 * (1.0 - smoothstep(P.TWIST_FULL_S, P.TWIST_RAMP_START_S, s))
    fore = rest2 - twist
    return {"upperarm": upper, "forearm": fore, "forearm_twist": twist, "hand": hand}


def _chain_param(p, pts):
    """arc length of the closest point on the polyline, negative before the start"""
    best_d = np.full(len(p), np.inf)
    best_t = np.zeros(len(p))
    acc = 0.0
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        ab = b - a
        L = float(np.linalg.norm(ab))
        raw = ((p - a) @ ab) / (L * L)
        lo = -np.inf if i == 0 else 0.0
        hi = np.inf if i == len(pts) - 2 else 1.0
        t = np.clip(raw, lo, hi)
        q = a + np.outer(np.clip(t, 0.0, 1.0), ab)
        d = np.linalg.norm(p - q, axis=1)
        better = d < best_d - 1e-9
        best_d = np.where(better, d, best_d)
        best_t = np.where(better, acc + t * L, best_t)
        acc += L
    return best_t


def finger_rule(p, pts, blends):
    """hand / seg1 / seg2 / seg3 weights along a finger or thumb chain"""
    t = _chain_param(p, pts)
    L = [float(np.linalg.norm(pts[i + 1] - pts[i])) for i in range(3)]
    (h0a, h0b), h1, h2 = blends
    s0 = smoothstep(-h0a, h0b, t)
    s1 = smoothstep(L[0] - h1, L[0] + h1, t)
    s2 = smoothstep(L[0] + L[1] - h2, L[0] + L[1] + h2, t)
    return [1.0 - s0, s0 * (1.0 - s1), s0 * s1 * (1.0 - s2), s0 * s1 * s2]


def glove_weights(p_cm, parts, tau=0.24):
    """p_cm: (N,3) hand frame points, parts: dict of part distances"""
    names = list(parts.keys())
    D = np.stack([parts[n] for n in names], axis=1)
    D = D - D.min(axis=1, keepdims=True)
    W = np.exp(-D / tau)
    W /= W.sum(axis=1, keepdims=True)
    part_w = {n: W[:, i] for i, n in enumerate(names)}
    s = -p_cm[:, 1]
    arm = arm_rule(s)
    out = {}

    def add(bone, w):
        out[bone] = out.get(bone, 0.0) + w

    def add_arm(w):
        for k, v in arm.items():
            add(k, w * v)

    for n in ("palm", "arm"):
        if n in part_w:
            add_arm(part_w[n])
    if "thenar" in part_w:
        # the thenar mound rides halfway with the thumb metacarpal
        k = 0.5 * smoothstep(0.8, 3.2, p_cm[:, 1])
        add("thumb_01", part_w["thenar"] * k)
        add_arm(part_w["thenar"] * (1.0 - k))
    for name in P.FINGER_ORDER:
        pts, _ = P.finger_chain(name)
        w = finger_rule(p_cm, pts, ((0.95, 0.55), 0.5, 0.38))
        add_arm(part_w[name] * w[0])
        for i in range(3):
            add(f"{name}_{i + 1:02d}", part_w[name] * w[i + 1])
    tpts, _, _ = P.thumb_chain()
    w = finger_rule(p_cm, tpts, ((1.1, 0.9), 0.6, 0.45))
    add_arm(part_w["thumb"] * w[0])
    for i in range(3):
        add(f"thumb_{i + 1:02d}", part_w["thumb"] * w[i + 1])
    return out


def limit_and_normalize(weights, max_influences=4, min_weight=0.004):
    """keep the strongest influences per vertex and renormalize"""
    names = list(weights.keys())
    n = len(next(iter(weights.values())))
    W = np.stack([np.broadcast_to(np.asarray(weights[k], dtype=np.float64), (n,)) for k in names], axis=1)
    W = np.where(W < min_weight, 0.0, W)
    order = np.argsort(-W, axis=1)
    keep = np.zeros_like(W, dtype=bool)
    rows = np.arange(n)[:, None]
    keep[rows, order[:, :max_influences]] = True
    W = np.where(keep, W, 0.0)
    total = W.sum(axis=1, keepdims=True)
    W = W / np.maximum(total, 1e-12)
    return names, W


def assign_weights(obj, names, W, side):
    """writes the weight matrix into vertex groups named <bone>_<side>"""
    groups = {}
    for j, base in enumerate(names):
        col = W[:, j]
        idx = np.nonzero(col > 0.0)[0]
        if len(idx) == 0:
            continue
        vg = obj.vertex_groups.new(name=f"{base}_{side}")
        groups[base] = vg
        # batch identical weights to keep the python calls down
        vals = np.round(col[idx], 5)
        for val in np.unique(vals):
            members = idx[vals == val].tolist()
            vg.add(members, float(val), "REPLACE")
    return groups


def bind(obj, arm_obj):
    obj.parent = arm_obj
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm_obj
    mod.use_vertex_groups = True
    return mod


# ---------------------------------------------------------------- posing
def pose_world_rotation(arm_obj, bone_name, axis_world, angle_deg):
    """rotate a pose bone about a world axis through its head, on top of its current pose"""
    from mathutils import Matrix

    pb = arm_obj.pose.bones[bone_name]
    bpy.context.view_layer.update()
    mw = arm_obj.matrix_world
    head_w = mw @ pb.head
    rot = Matrix.Rotation(math.radians(angle_deg), 4, Vector(axis_world).normalized())
    m_world = mw @ pb.matrix
    t_to = Matrix.Translation(head_w)
    t_from = Matrix.Translation(-head_w)
    new_world = t_to @ rot @ t_from @ m_world
    pb.matrix = mw.inverted() @ new_world
    bpy.context.view_layer.update()


def bone_axis_world(arm_obj, bone_name, local_axis="X"):
    pb = arm_obj.pose.bones[bone_name]
    bpy.context.view_layer.update()
    m = arm_obj.matrix_world @ pb.matrix
    col = {"X": 0, "Y": 1, "Z": 2}[local_axis]
    return Vector((m[0][col], m[1][col], m[2][col])).normalized()
