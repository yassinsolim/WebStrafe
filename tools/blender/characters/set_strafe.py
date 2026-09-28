"""strafe: the house style. rounded helmet with a wraparound visor, layered
chest plate and pauldrons, light gauntlets over armored fists, plated legs,
and a scarf whose tails ride the cape bones.
"""

import numpy as np

import csdf as S
from body import chain_weights, torso_core
from hands import hand_parts
from parts import Anchor, Part, TaperTube, box_region

SET = "strafe"


def helmet(rig):
    parts = []
    dome = S.SuperEllipsoid((0, 1.712, -0.006), (0.104, 0.118, 0.12), 2.35)
    jaw = S.SuperEllipsoid((0, 1.632, 0.024), (0.089, 0.07, 0.094), 2.6)
    outer = dome.su(jaw, 0.035)
    # neck opening and a flat-ish rim at the back
    outer = outer.si(S.keep_side((0, 1.585, 0), (0, 1, 0.25)), 0.012)
    outer = outer - S.Ellipsoid((0, 1.555, -0.02), (0.068, 0.07, 0.074))
    # the visor band: a lens shaped wrap across the eyes
    band = S.Ellipsoid((0, 1.702, 0.078), (0.118, 0.031, 0.1))
    front = S.keep_side((0, 0, 0.018), (0, 0, 1))
    visor_region = band & front
    shell = outer.ss(visor_region.offset(0.003), 0.004)
    # brow and cheek seams
    seam = S.Box((0, 1.748, 0.1), (0.07, 0.0022, 0.05), 0.0015)
    shell = shell - seam
    rear_vent = S.Box((0, 1.66, -0.13), (0.03, 0.022, 0.03), 0.006)
    shell = shell.ss(rear_vent, 0.004)
    chin_slots = S.union(*[S.Box((x, 1.608, 0.11), (0.006, 0.013, 0.03), 0.004) for x in (-0.022, 0.0, 0.022)])
    shell = shell.ss(chin_slots, 0.002)
    parts.append(Part("helmet", SET, "shell", shell, "primary", bone="head_0", voxel=0.002, tris=(2600, 950, 320), symmetric=True))

    visor = outer.offset(-0.004) & visor_region.offset(0.0005)
    parts.append(Part("helmet", SET, "visor", visor, "visor", bone="head_0", voxel=0.0018, tris=(700, 260, 90), symmetric=True))

    # a low crest along the top
    crest = S.Box((0, 1.8, -0.01), (0.0085, 0.05, 0.1), 0.006) & dome.offset(0.011)
    crest = crest - dome.offset(0.001)
    parts.append(Part("helmet", SET, "crest", crest, "accent", bone="head_0", voxel=0.0018, tris=(300, 120, 50), symmetric=True))

    # ear pods with a team light ring
    pod = S.Cylinder((0.098, 1.69, -0.012), (0.118, 1.69, -0.012), 0.03, 0.006).mirror_x()
    parts.append(Part("helmet", SET, "pods", pod, "secondary", bone="head_0", voxel=0.0018, tris=(420, 160, 60), symmetric=True))
    ring = S.Torus((0.119, 1.69, -0.012), (1, 0, 0), 0.02, 0.0028).mirror_x()
    parts.append(Part("helmet", SET, "lights", ring, "light", bone="head_0", voxel=0.0012, tris=(260, 100, 40), lods=(0, 1), symmetric=True))
    grill = S.union(*[S.Box((0, 1.66 + dy, -0.121), (0.026, 0.0028, 0.012), 0.002) for dy in (-0.012, 0.0, 0.012)])
    parts.append(Part("helmet", SET, "vent", grill, "dark", bone="head_0", voxel=0.0015, tris=(160, 60, 20), lods=(0, 1), symmetric=True))
    return parts


def chest(rig):
    parts, anchors = [], []
    core = torso_core(rig)
    base = core.offset(0.021)
    # front plate with a centre seam, the secondary plate peeks out around it
    front = S.rounded_shell(base, 0.013, 0.003).si(box_region((-0.152, 1.225, 0.0), (0.152, 1.465, 0.3), 0.02), 0.01)
    front = front - S.Box((0, 1.34, 0.13), (0.0035, 0.14, 0.05), 0.002)
    front = front.ss(S.Box((0, 1.232, 0.12), (0.05, 0.02, 0.06), 0.01), 0.006)
    parts.append(Part("chest", SET, "front", front, "primary", bone="spine_3", tris=(1900, 680, 220), symmetric=True))
    under = S.rounded_shell(core.offset(0.012), 0.011, 0.003).si(box_region((-0.172, 1.18, -0.035), (0.172, 1.472, 0.3), 0.02), 0.012)
    parts.append(Part("chest", SET, "under", under, "secondary", bone="spine_3", tris=(1500, 540, 180), symmetric=True))
    back = S.rounded_shell(base, 0.013, 0.003).si(box_region((-0.145, 1.2, -0.4), (0.145, 1.462, -0.075), 0.02), 0.01)
    back = back - S.Box((0, 1.33, -0.19), (0.0035, 0.12, 0.05), 0.002)
    parts.append(Part("chest", SET, "back", back, "primary", bone="spine_3", tris=(1400, 500, 170), symmetric=True))
    module = S.Box((0, 1.325, -0.168), (0.082, 0.092, 0.03), 0.018)
    module = module.ss(S.Box((0, 1.325, -0.2), (0.052, 0.006, 0.01), 0.003), 0.003)
    parts.append(Part("chest", SET, "module", module, "dark", bone="spine_3", tris=(500, 200, 70), symmetric=True))
    strip = S.Box((0, 1.325, -0.195), (0.047, 0.0035, 0.004), 0.002)
    parts.append(Part("chest", SET, "back_light", strip, "light", bone="spine_3", voxel=0.0012, tris=(120, 50, 20), lods=(0, 1), symmetric=True))
    collar = S.Torus((0, 1.458, -0.048), (0, 1, 0.28), 0.078, 0.019)
    collar = collar.su(S.Torus((0, 1.49, -0.052), (0, 1, 0.3), 0.07, 0.012), 0.01)
    parts.append(Part("chest", SET, "collar", collar, "dark", bone="spine_3", tris=(700, 260, 90), symmetric=True))

    # segmented abdomen and the belt
    abs_base = core.offset(0.015)
    for i, (y0, y1, bone, mat) in enumerate([(1.183, 1.226, "spine_2", "primary"), (1.128, 1.175, "spine_2", "secondary"), (1.072, 1.12, "spine_1", "primary")]):
        band = S.rounded_shell(abs_base, 0.01, 0.0028).si(box_region((-0.098 + i * 0.008, y0, 0.0), (0.098 - i * 0.008, y1, 0.3), 0.012), 0.006)
        parts.append(Part("chest", SET, f"abs{i}", band, mat, bone=bone, tris=(420, 160, 60), symmetric=True))
    belt = S.rounded_shell(core.offset(0.014), 0.015, 0.003).si(box_region((-0.4, 0.985, -0.4), (0.4, 1.03, 0.4), 0.004), 0.004)
    parts.append(Part("chest", SET, "belt", belt, "dark", bone="pelvis", tris=(900, 320, 110), symmetric=True))
    hit = S.raycast(core, (0, 1.007, 0.4), (0, 0, -1))
    buckle = S.Box(hit + (0, 0, 0.018), (0.028, 0.02, 0.008), 0.004)
    parts.append(Part("chest", SET, "buckle", buckle, "metal", bone="pelvis", voxel=0.0015, tris=(160, 70, 24), symmetric=True))
    pouch_pts = []
    for ang in (38.0, 62.0):
        d = np.array([np.sin(np.radians(ang)), 0.0, np.cos(np.radians(ang))])
        p = S.raycast(core, np.array([0, 1.0, -0.02]) + d * 0.5, -d)
        pouch_pts.append(p + d * 0.03)
    pouches = S.union(*[S.Box(p, (0.026, 0.028, 0.016), 0.008) for p in pouch_pts]).mirror_x()
    parts.append(Part("chest", SET, "pouches", pouches, "secondary", bone="pelvis", tris=(600, 220, 80), symmetric=True))

    # layered pauldrons, left one built, the right is a mirror copy
    sh = rig.p("arm_upper_l")
    dome = S.Ellipsoid(sh + (0.014, 0.012, 0.0), (0.092, 0.088, 0.098))
    keep_top = S.keep_side(sh + (0, -0.038, 0), (-0.45, 1.0, 0.0))
    keep_out = S.keep_side((sh[0] - 0.05, 0, 0), (1, 0, 0))
    lower = S.rounded_shell(dome, 0.01, 0.0028).si(keep_top, 0.008).si(keep_out, 0.01)
    parts.append(Part("chest", SET, "pauldron_under", lower, "secondary", bone="arm_upper_l", tris=(800, 300, 100), mirror=True))
    upper = S.rounded_shell(dome.offset(0.009), 0.01, 0.0028).si(S.keep_side(sh + (0, -0.006, 0), (-0.55, 1.0, 0.0)), 0.008).si(keep_out, 0.01)
    upper = upper - S.Box(sh + (0.03, 0.07, 0.0), (0.004, 0.03, 0.12), 0.002).rot_z(0)
    parts.append(Part("chest", SET, "pauldron_top", upper, "primary", bone="arm_upper_l", tris=(800, 300, 100), mirror=True))
    trim_ring = S.Torus(sh + (0.034, -0.046, 0.0), S.normalize((0.45, 1.0, 0.0)), 0.083, 0.0045) & keep_out
    parts.append(Part("chest", SET, "pauldron_trim", trim_ring, "accent", bone="arm_upper_l", voxel=0.0016, tris=(300, 110, 40), lods=(0, 1), mirror=True))

    # decals: emblem on the upper left chest, callsign on the right
    for kind, x, y in (("emblem", 0.078, 1.405), ("tag", -0.08, 1.4)):
        p = S.raycast(front, (x, y, 0.5), (0, 0, -1))
        n = S.normals(front, p[None, :])[0]
        anchors.append(Anchor(SET, kind, "spine_3", p + n * 0.0015, n, (0, 1, 0), 0.06 if kind == "emblem" else 0.07))
    return parts, anchors


def arms(rig):
    parts = []
    # forearm bracer on the left forearm (x out, y down the arm, z front)
    R, o = rig.limb_frame("arm_lower_l", "hand_l")
    tube = TaperTube(0.058, 0.246, 0.057, 0.053, 0.047, 0.043)
    bracer = S.rounded_shell(tube, 0.009, 0.0025)
    groove = S.Box((0.052, 0.155, 0.01), (0.007, 0.068, 0.0065), 0.003)
    bracer = bracer.ss(groove, 0.002)
    parts.append(Part("arms", SET, "bracer", bracer.place(R, o), "primary", bone="arm_lower_l", tris=(1100, 400, 130), mirror=True))
    light = S.Box((0.047, 0.155, 0.01), (0.0038, 0.062, 0.0036), 0.0025)
    parts.append(Part("arms", SET, "bracer_light", light.place(R, o), "light", bone="arm_lower_l", voxel=0.0012, tris=(120, 50, 20), lods=(0, 1), mirror=True))
    ridge = S.Capsule((0.006, 0.075, 0.057), (0.004, 0.228, 0.047), 0.0056)
    parts.append(Part("arms", SET, "bracer_ridge", ridge.place(R, o), "accent", bone="arm_lower_l", voxel=0.0015, tris=(160, 60, 24), lods=(0, 1), mirror=True))
    rims = S.Torus((0, 0.06, 0), (0, 1, 0), 0.054, 0.0048) | S.Torus((0, 0.244, 0), (0, 1, 0), 0.045, 0.0045)
    parts.append(Part("arms", SET, "bracer_rims", rims.place(R, o), "dark", bone="arm_lower_l", voxel=0.0015, tris=(360, 140, 50), mirror=True))
    elbow = S.rounded_shell(S.Ellipsoid((0.004, 0.012, -0.018), (0.052, 0.058, 0.052)), 0.009, 0.0025)
    elbow = elbow.si(S.keep_side((0, 0, -0.004), (0, 0, -1)), 0.006).si(S.keep_side((0, 0.058, 0), (0, -1, 0)), 0.006)
    parts.append(Part("arms", SET, "elbow", elbow.place(R, o), "secondary", bone="arm_lower_l", tris=(500, 190, 70), mirror=True))

    # upper arm plate under the pauldron
    Ru, ou = rig.limb_frame("arm_upper_l", "arm_lower_l")
    up_tube = TaperTube(0.1, 0.225, 0.066, 0.063, 0.057, 0.055)
    up_plate = S.rounded_shell(up_tube, 0.009, 0.0025).si(S.keep_side((-0.018, 0, 0), (1, 0, 0)), 0.006)
    parts.append(Part("arms", SET, "upper", up_plate.place(Ru, ou), "secondary", bone="arm_upper_l", tris=(700, 260, 90), mirror=True))
    strap = S.Torus((0, 0.21, 0), (0, 1, 0), 0.056, 0.005)
    parts.append(Part("arms", SET, "strap", strap.place(Ru, ou), "dark", bone="arm_upper_l", voxel=0.0015, tris=(240, 90, 30), lods=(0, 1), mirror=True))

    # gloves: a fist round the knife on the right, relaxed on the left
    for side in ("r", "l"):
        h = hand_parts(rig, side, bulk=1.06)
        bone = f"hand_{side}"
        parts.append(Part("arms", SET, f"glove_{side}", h["glove"], "suit", bone=bone, voxel=0.0016, tris=(2000, 700, 220)))
        parts.append(Part("arms", SET, f"backplate_{side}", h["back_plate"], "primary", bone=bone, voxel=0.0014, tris=(300, 110, 40)))
        parts.append(Part("arms", SET, f"knuckles_{side}", h["knuckles"], "secondary", bone=bone, voxel=0.0014, tris=(260, 100, 36)))
        parts.append(Part("arms", SET, f"fingerplates_{side}", h["finger_plates"], "dark", bone=bone, voxel=0.0012, tris=(420, 160, 0), lods=(0, 1)))
    return parts


def legs(rig):
    parts = []
    Rt, ot = rig.limb_frame("leg_upper_l", "leg_lower_l")
    thigh_tube = TaperTube(0.1, 0.35, 0.097, 0.09, 0.071, 0.067, cz=0.004)
    front = S.rounded_shell(thigh_tube, 0.011, 0.003).si(S.keep_side((0, 0, -0.008), (0, 0, 1)), 0.008)
    front = front - S.Box((0.0, 0.225, 0.09), (0.003, 0.1, 0.04), 0.0015)
    parts.append(Part("legs", SET, "thigh", front.place(Rt, ot), "primary", bone="leg_upper_l", tris=(1000, 360, 120), mirror=True))
    side_tube = TaperTube(0.0, 0.22, 0.108, 0.1, 0.096, 0.09, cz=0.004)
    side = S.rounded_shell(side_tube, 0.01, 0.0028).si(S.keep_side((0.035, 0, 0), (1, 0, 0)), 0.008)
    parts.append(Part("legs", SET, "tasset", side.place(Rt, ot), "secondary", bone="leg_upper_l", tris=(700, 260, 90), mirror=True))

    Rs, os_ = rig.limb_frame("leg_lower_l", "ankle_l")
    knee = S.rounded_shell(S.Ellipsoid((0, 0.008, 0.028), (0.06, 0.07, 0.056)), 0.011, 0.003)
    knee = knee.si(S.keep_side((0, 0, 0.012), (0, 0, 1)), 0.006)
    parts.append(Part("legs", SET, "knee", knee.place(Rs, os_), "primary", bone="leg_lower_l", tris=(600, 220, 80), mirror=True))
    knee_ridge = S.Capsule((0, -0.03, 0.087), (0, 0.045, 0.085), 0.0055) & S.Ellipsoid((0, 0.008, 0.028), (0.07, 0.08, 0.068))
    parts.append(Part("legs", SET, "knee_ridge", knee_ridge.place(Rs, os_), "accent", bone="leg_lower_l", voxel=0.0015, tris=(140, 60, 20), lods=(0, 1), mirror=True))
    shin_tube = TaperTube(0.075, 0.33, 0.064, 0.062, 0.047, 0.046)
    greave = S.rounded_shell(shin_tube, 0.01, 0.0028).si(S.keep_side((0, 0, -0.02), (0, 0, 1)), 0.008)
    greave = greave.ss(S.Box((0.0, 0.2, 0.062), (0.012, 0.09, 0.02), 0.004), 0.003)
    parts.append(Part("legs", SET, "greave", greave.place(Rs, os_), "primary", bone="leg_lower_l", tris=(900, 330, 110), mirror=True))
    shin_light = S.Box((0.0, 0.2, 0.049), (0.0045, 0.082, 0.004), 0.003)
    parts.append(Part("legs", SET, "greave_light", shin_light.place(Rs, os_), "light", bone="leg_lower_l", voxel=0.0012, tris=(120, 50, 20), lods=(0, 1), mirror=True))
    calf = S.rounded_shell(TaperTube(0.05, 0.22, 0.07, 0.068, 0.058, 0.056), 0.009, 0.0025).si(S.keep_side((0, 0, -0.005), (0, 0, -1)), 0.008)
    parts.append(Part("legs", SET, "calf", calf.place(Rs, os_), "secondary", bone="leg_lower_l", tris=(600, 220, 80), mirror=True))

    # boot, modelled in place around the left foot
    boot_body = S.SuperEllipsoid((0.118, 0.056, 0.012), (0.051, 0.057, 0.138), 3.0)
    column = S.Cylinder((0.105, 0.05, -0.068), (0.105, 0.205, -0.068), 0.05, 0.012)
    boot = boot_body.su(column, 0.035).si(S.keep_side((0, 0.004, 0), (0, 1, 0)), 0.004)
    parts.append(Part("legs", SET, "boot", boot, "suit", bone="ankle_l", tris=(1300, 460, 150), mirror=True))
    sole = S.Box((0.118, 0.012, 0.012), (0.056, 0.012, 0.146), 0.008)
    sole = sole.ss(S.union(*[S.Box((0.118, 0.0, z), (0.07, 0.004, 0.006), 0.002) for z in (-0.09, -0.05, 0.04, 0.08)]), 0.002)
    parts.append(Part("legs", SET, "sole", sole, "dark", bone="ankle_l", tris=(500, 190, 70), mirror=True))
    toe = S.rounded_shell(boot.offset(0.004), 0.009, 0.0025).si(S.keep_side((0, 0, 0.055), (0, 0, 1)), 0.01).si(S.keep_side((0, 0.022, 0), (0, 1, 0)), 0.004)
    parts.append(Part("legs", SET, "toe", toe, "primary", bone="ankle_l", tris=(500, 190, 70), mirror=True))
    heel = S.rounded_shell(boot.offset(0.004), 0.009, 0.0025).si(S.keep_side((0, 0, -0.07), (0, 0, -1)), 0.01).si(box_region((-1, 0.022, -1), (1, 0.11, 1)), 0.004)
    parts.append(Part("legs", SET, "heel", heel, "secondary", bone="ankle_l", tris=(420, 160, 60), mirror=True))
    cuff = S.Torus((0.105, 0.198, -0.068), (0, 1, 0), 0.052, 0.009)
    parts.append(Part("legs", SET, "cuff", cuff, "dark", bone="ankle_l", voxel=0.0016, tris=(300, 120, 40), mirror=True))
    return parts


def class_item(rig):
    parts = []
    wrap = S.Torus((0, 1.472, -0.052), (0, 1, 0.3), 0.074, 0.03)
    wrap = wrap.su(S.Torus((0, 1.448, -0.05), (0, 1, 0.26), 0.084, 0.022), 0.02)
    wrap = wrap.su(S.Ellipsoid((0.0, 1.46, -0.14), (0.05, 0.04, 0.035)), 0.02)
    parts.append(Part("classItem", SET, "wrap", wrap, "cloth", bone="spine_3", tris=(1100, 400, 130), symmetric=True))
    tails = None
    for x, tilt in ((0.03, 5.0), (-0.034, -7.0)):
        top = np.array([x, 1.455, -0.155])
        bottom = np.array([x * 1.8, 1.02, -0.245])
        axis = S.normalize(bottom - top)
        Rr = S.frame_from(y=axis, x=S.normalize((1.0, np.tan(np.radians(tilt)), 0.0)))
        ribbon = S.Box((0, 0, 0), (0.036, float(np.linalg.norm(bottom - top)) * 0.5, 0.005), 0.004)
        ribbon = ribbon.place(Rr, (top + bottom) * 0.5)
        tails = ribbon if tails is None else tails | ribbon
    weights = lambda co: chain_weights(rig, co, ["cape_0", "cape_1", "cape_2"], "spine_3")  # noqa: E731
    parts.append(Part("classItem", SET, "tails", tails, "cloth", weights=weights, voxel=0.0024, tris=(700, 260, 90)))
    hem = None
    for x in (0.03, -0.034):
        b = np.array([x * 1.8, 1.02, -0.245])
        stripe = S.Box(b + (0, 0.03, 0), (0.037, 0.008, 0.0065), 0.003)
        hem = stripe if hem is None else hem | stripe
    parts.append(Part("classItem", SET, "hem", hem, "trim", weights=weights, voxel=0.0016, tris=(160, 60, 20), lods=(0, 1)))
    return parts


def build(rig):
    parts = []
    parts += helmet(rig)
    chest_parts, anchors = chest(rig)
    parts += chest_parts
    parts += arms(rig)
    parts += legs(rig)
    parts += class_item(rig)
    return parts, anchors
