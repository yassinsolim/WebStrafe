"""builds public/characters/fp_armor.glb: the first-person gauntlets and
sleeves each armor set puts over the shared arms rig (tools/blender/arms).

  blender -b --factory-startup --python-exit-code 1 -P tools/blender/characters/build_fp_armor.py -- \
      --out .blender-tmp/characters/fp_armor_raw.glb
  npx tsx tools/characters/optimize-armor.ts public/characters/fp_armor.glb .blender-tmp/characters/fp_armor_raw.glb

pieces are fitted to the arms' rest pose and forearm cross sections
(tools/blender/arms/params.py). tubes around the forearm are skinned with the
arms' own forearm / twist / hand blend, so they twist with the wrist exactly
like the sleeve under them; hand plates ride the hand bone. only the right
arm is modelled, the left is its mirror (like the arms themselves).
"""

import argparse
import importlib.util
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import common  # noqa: E402
import cbuild as B  # noqa: E402
import csdf as S  # noqa: E402
from parts import Part, mirror_bone  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))


def _load_arms_params():
    """the arms area keeps its own params.py; load it under another name"""
    spec = importlib.util.spec_from_file_location("arms_params", os.path.join(HERE, "..", "arms", "params.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


AP = _load_arms_params()
CM = 0.01


def _load_arms_hand():
    """the arms' glove sdf (hand frame cm), so hand plates can hug the real glove"""
    arms_dir = os.path.join(HERE, "..", "arms")
    sys.path.insert(0, arms_dir)
    try:
        spec = importlib.util.spec_from_file_location("arms_hand", os.path.join(arms_dir, "hand.py"))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
    finally:
        sys.path.remove(arms_dir)
    return mod.HandShape()


GLOVE = _load_arms_hand()


def to_three(v):
    v = np.asarray(v, dtype=np.float64)
    return np.array([v[0], v[2], -v[1]])


W = to_three(AP.WRIST_R)  # right wrist, three.js space; the forearm runs towards +z from here


def smoothstep(e0, e1, x):
    t = np.clip((np.asarray(x, dtype=np.float64) - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def arm_weights(co):
    """the arms rig's blend (tools/blender/arms/rig.py arm_rule), keyed by bone"""
    s = (co[:, 2] - W[2]) / CM
    e_hi, e_lo = AP.ELBOW_BLEND
    upper = smoothstep(e_lo, e_hi, s)
    rest = 1.0 - upper
    hand = rest * (1.0 - smoothstep(AP.WRIST_BLEND[1], AP.WRIST_BLEND[0], s))
    rest2 = rest - hand
    twist = rest2 * (1.0 - smoothstep(AP.TWIST_FULL_S, AP.TWIST_RAMP_START_S, s))
    fore = rest2 - twist
    return {"upperarm_r": upper, "forearm_r": fore, "forearm_twist_r": twist, "hand_r": hand}


def superellipse_distance(x, z, a, b, n):
    ax = np.abs(x) / a + 1e-12
    az = np.abs(z) / b + 1e-12
    q = np.power(ax, n) + np.power(az, n)
    g = np.power(q, 1.0 / n) - 1.0
    qn = np.power(q, 1.0 / n - 1.0)
    gx = qn * np.power(ax, n - 1.0) / a
    gz = qn * np.power(az, n - 1.0) / b
    return g / np.maximum(np.sqrt(gx * gx + gz * gz), 1e-9)


def skin_distance(p):
    """rough distance to the forearm skin (metres), from the arms' cross sections"""
    q = p - W
    s = np.clip(q[:, 2] / CM, -2.0, 34.0)
    w, top, bot, n = AP.forearm_section(s)
    x = q[:, 0] / CM
    y = q[:, 1] / CM
    b = np.where(y >= 0.0, top, -bot)
    return superellipse_distance(x, y, w, b, n) * CM


def tube(s0, s1, offset, thick, flare=0.0):
    """a shell around the forearm between s0 and s1 cm, `offset` above the skin; flare widens it towards s0"""
    def fn(p):
        s = (p[:, 2] - W[2]) / CM
        grow = flare * np.clip((s1 - s) / max(s1 - s0, 1e-3), 0.0, 1.0) ** 2
        d = skin_distance(p) - offset - grow
        shell = np.abs(d - thick * 0.5) - thick * 0.5
        cap = np.maximum(s0 - s, s - s1) * CM
        r = 0.0015
        wx = np.maximum(shell + r, 0.0)
        wy = np.maximum(cap + r, 0.0)
        return np.minimum(np.maximum(shell + r, cap + r), 0.0) + np.sqrt(wx * wx + wy * wy) - r

    pad = 0.07
    return S.Fn(fn, W + (-pad, -pad, s0 * CM - 0.01), W + (pad, pad, s1 * CM + 0.01))


def hand_point(x, y, z):
    """hand frame cm (x across to the pinky, y along to the knuckles, z out of the back) -> three"""
    return to_three(AP.WRIST_R + np.array([x, y, z]) * CM)


def _glove_three(p):
    """glove distance (metres) at three.js points, right hand"""
    b = np.stack([p[:, 0], -p[:, 2], p[:, 1]], axis=1)
    return GLOVE.sdf((b - AP.WRIST_R) / CM) * CM


_g0, _g1 = hand_point(-9, -2, -7), hand_point(8, 22, 5)
GLOVE_SDF = S.Fn(_glove_three, np.minimum(_g0, _g1) - 0.02, np.maximum(_g0, _g1) + 0.02)


def hand_region(x0, x1, y0, y1, z0):
    """a box in the hand frame (cm): across x0..x1, along y0..y1, above z0"""
    lo = np.array([x0, y0, z0])
    hi = np.array([x1, y1, 8.0])
    corners = [hand_point(*c) for c in (lo, hi)]
    mn = np.minimum(*corners)
    mx = np.maximum(*corners)
    return S.Box((mn + mx) * 0.5, (mx - mn) * 0.5, 0.006)


def hand_plate(y0, y1, width, lift, thick):
    """a plate hugging the back of the glove between y0 and y1 cm, `lift` above it"""
    half = width * 0.5
    region = hand_region(0.8 - half, 0.8 + half, y0, y1, 0.3)
    return S.rounded_shell(GLOVE_SDF.offset(lift + thick * 0.5), thick, min(0.0015, thick * 0.4)).si(region, 0.004)


def knuckle_bar(lift, thick):
    region = hand_region(-3.6, 4.9, 8.6, 10.5, -0.2)
    return S.rounded_shell(GLOVE_SDF.offset(lift + thick * 0.5), thick, min(0.0018, thick * 0.4)).si(region, 0.003)


def strip(s0, s1, angle_deg, above, width, thick):
    """a thin light strip along the forearm at an angle round it (0 = top, 90 = outer side)"""
    def fn(p):
        q = p - W
        ang = np.degrees(np.arctan2(q[:, 0], q[:, 1]))
        s = q[:, 2] / CM
        d_skin = np.abs(skin_distance(p) - above) - thick * 0.5
        d_ang = (np.abs(ang - angle_deg) / 57.3) * 0.045 - width * 0.5
        d_s = np.maximum(s0 - s, s - s1) * CM
        return np.maximum(np.maximum(d_skin, d_ang), d_s)

    return S.Fn(fn, W + (-0.07, -0.07, s0 * CM - 0.01), W + (0.07, 0.07, s1 * CM + 0.01))


def angle_region(center_deg, half_deg):
    def fn(p):
        q = p - W
        ang = np.degrees(np.arctan2(q[:, 0], q[:, 1]))
        diff = np.abs((ang - center_deg + 180.0) % 360.0 - 180.0)
        return (diff - half_deg) / 57.3 * 0.045

    return S.Fn(fn, W + (-0.08, -0.08, -0.05), W + (0.08, 0.08, 0.4))


def fp_parts():
    tw = arm_weights
    parts = []

    def add(set_id, name, sdf, mat, weights=None, bone=None, voxel=0.0011, tris=900):
        parts.append(Part("fp", set_id, name, sdf, mat, bone=bone, weights=weights, voxel=voxel, tris=(tris, 0, 0), lods=(0,), mirror=True))

    # strafe: a plated bracer over the top and outer forearm, back of hand plate, knuckle bar
    bracer = tube(2.4, 15.5, 0.0055, 0.0055).si(angle_region(20.0, 115.0), 0.004)
    add("strafe", "bracer_r", bracer, "primary", weights=tw, tris=2400)
    add("strafe", "cuff_r", tube(1.6, 3.2, 0.0048, 0.0042), "secondary", weights=tw, tris=900)
    add("strafe", "light_r", strip(5.0, 13.0, 75.0, 0.0115, 0.006, 0.0022), "light", weights=tw, voxel=0.0008, tris=300)
    add("strafe", "plate_r", hand_plate(1.8, 8.2, 6.4, 0.0012, 0.0035), "primary", bone="hand_r", tris=900)
    add("strafe", "knuckles_r", knuckle_bar(0.0012, 0.0045), "secondary", bone="hand_r", tris=800)

    # anvil: a thick full bracer with two raised rings, a big hand plate
    add("anvil", "bracer_r", tube(2.2, 16.5, 0.0058, 0.0085), "primary", weights=tw, tris=2600)
    rings = tube(6.0, 7.2, 0.0138, 0.0035) | tube(11.0, 12.2, 0.0138, 0.0035)
    add("anvil", "rings_r", rings, "secondary", weights=tw, tris=1200)
    add("anvil", "light_r", strip(8.0, 10.2, 70.0, 0.0145, 0.008, 0.0022), "light", weights=tw, voxel=0.0008, tris=240)
    add("anvil", "plate_r", hand_plate(1.4, 8.4, 7.4, 0.0014, 0.005), "primary", bone="hand_r", tris=900)
    add("anvil", "knuckles_r", knuckle_bar(0.0014, 0.006), "secondary", bone="hand_r", tris=900)

    # vector: a cloth sleeve down to the glove with crossed wraps
    add("vector", "sleeve_r", tube(2.6, 16.0, 0.0028, 0.0032), "cloth", weights=tw, tris=1800)
    wraps = None
    for i, s in enumerate((4.5, 7.0, 9.5, 12.0)):
        tilt = 1.5 if i % 2 else -1.5

        def band(p, s=s, tilt=tilt):
            q = p - W
            ang = np.arctan2(q[:, 0], q[:, 1])
            sc = q[:, 2] / CM - (s + tilt * np.sin(ang))
            return np.maximum(np.abs(skin_distance(p) - 0.0068) - 0.0022, np.abs(sc) * CM - 0.0045)

        b = S.Fn(band, W + (-0.07, -0.07, (s - 3) * CM), W + (0.07, 0.07, (s + 3) * CM))
        wraps = b if wraps is None else wraps | b
    add("vector", "wraps_r", wraps, "trim", weights=tw, voxel=0.0009, tris=1600)
    add("vector", "plate_r", hand_plate(2.4, 7.6, 5.2, 0.001, 0.003), "primary", bone="hand_r", tris=700)

    # quill: a cloth sleeve under a long flared cuff with a glowing seam
    add("quill", "sleeve_r", tube(2.6, 16.0, 0.0028, 0.0032), "cloth", weights=tw, tris=1600)
    add("quill", "cuff_r", tube(2.8, 11.5, 0.0064, 0.0045, flare=0.006), "primary", weights=tw, tris=2000)
    add("quill", "trim_r", tube(2.6, 3.6, 0.0122, 0.003, flare=0.0), "accent", weights=tw, tris=700)
    add("quill", "light_r", strip(4.5, 10.0, 90.0, 0.0125, 0.005, 0.0022), "light", weights=tw, voxel=0.0008, tris=300)
    return parts


def build_armature():
    arm_data = bpy.data.armatures.new("ArmsRig")
    arm_obj = bpy.data.objects.new("ArmsRig", arm_data)
    bpy.context.scene.collection.objects.link(arm_obj)
    bpy.context.view_layer.objects.active = arm_obj
    arm_obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    layout = AP.bone_layout()
    ebones = {}
    for name, (head, tail, parent, connected) in layout.items():
        eb = arm_data.edit_bones.new(name)
        eb.head = Vector(head)
        eb.tail = Vector(tail)
        ebones[name] = eb
    for name, (head, tail, parent, connected) in layout.items():
        if parent:
            ebones[name].parent = ebones[parent]
            ebones[name].use_connect = connected
    bpy.ops.object.mode_set(mode="OBJECT")
    return arm_obj


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, ".blender-tmp", "characters", "fp_armor_raw.glb"))
    args = ap.parse_args(common.script_args())
    common.reset_scene()
    arm = build_armature()
    made = []
    for part in fp_parts():
        verts, faces = S.mesh(part.sdf, part.voxel)
        if len(faces) == 0:
            B.log(f"WARNING fp.{part.set}.{part.name} is empty")
            continue
        obj = B.mesh_object(f"fp.{part.set}.{part.name}", verts, faces)
        B.decimate(obj, part.tris[0], symmetric=False)
        obj.data.validate(clean_customdata=False)
        co = S.project(part.sdf, B.get_co(obj))
        B.set_co(obj, co)
        n = S.normals(part.sdf, co)
        B.set_normals(obj, n)
        ao = S.ambient_occlusion(part.sdf, co + n * 0.0008, n, delta=0.006)
        wear = S.convexity(part.sdf, co, n, depth=0.002)
        B.set_colors(obj, np.stack([ao, wear, np.zeros_like(ao), np.ones_like(ao)], axis=1))
        B.set_material(obj, part.material)
        B.bind(obj, arm, part.bone if part.bone else part.weights(co))
        for o, side, name in ((obj, "r", part.name),):
            o["slot"], o["set"], o["part"], o["lod"], o["mat"], o["side"] = "fp", part.set, name, 0, part.material, side
        made.append(obj)
        # the left arm is an exact mirror of the right
        dup = B.copy_object(obj, f"fp.{part.set}.{part.name[:-2]}_l")
        c2 = B.get_co(dup)
        c2[:, 0] *= -1.0
        B.set_co(dup, c2)
        import bmesh

        bm = bmesh.new()
        bm.from_mesh(dup.data)
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
        bm.to_mesh(dup.data)
        bm.free()
        n2 = n.copy()
        n2[:, 0] *= -1.0
        B.set_normals(dup, n2)
        for vg in dup.vertex_groups:
            vg.name = "__m_" + mirror_bone(vg.name)
        for vg in dup.vertex_groups:
            vg.name = vg.name[4:]
        dup["side"] = "l"
        dup["part"] = part.name[:-2] + "_l"
        made.append(dup)
        B.log(f"fp.{part.set}.{part.name}: {B.tri_count(obj)} tris")
    common.export_glb(args.out, objects=[arm] + made, animations=False)
    del math


main()
