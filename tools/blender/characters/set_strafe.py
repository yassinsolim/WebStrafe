"""strafe: the house style. rounded helmet with a wraparound visor, layered
chest plate and pauldrons, light gauntlets over armored fists, plated legs,
and a scarf whose tails ride the cape bones.
"""

import numpy as np

import csdf as S
from body import chain_weights, torso_core
from hands import hand_parts
from parts import Anchor, Part, TaperTube, box_region, outline, strap

SET = "strafe"


def helmet(rig):
    parts = []
    C = np.array([0.0, 1.695, -0.004])
    cranium = S.SuperEllipsoid(C + (0, 0.024, -0.012), (0.099, 0.106, 0.115), 2.5)
    # soft facets on the upper sides and the back of the skull
    for n in ((0.62, 0.78, 0.05), (-0.62, 0.78, 0.05), (0.0, 0.55, -0.83)):
        cranium = cranium.si(S.keep_side(C + np.array(n) * 0.109 + (0, 0.02, -0.01), -np.array(n)), 0.02)
    # v shaped face mask meeting at a ridge down the middle
    face = S.SuperEllipsoid(C + (0, -0.046, 0.028), (0.086, 0.07, 0.09), 2.8)
    for n in ((0.6, -0.08, 0.8), (-0.6, -0.08, 0.8)):
        face = face.si(S.keep_side((0, 1.63, 0.116), -np.array(n)), 0.006)
    face = face.si(S.keep_side((0, 1.586, 0.075), (0, 0.75, -0.66)), 0.01)
    outer = cranium.su(face, 0.022)
    outer = outer.si(S.keep_side((0, 1.582, 0), (0, 1, 0.3)), 0.01)
    outer = outer - S.Ellipsoid((0, 1.55, -0.02), (0.066, 0.07, 0.072))

    visor_poly = [(-0.097, 1.731), (-0.03, 1.709), (0, 1.701), (0.03, 1.709), (0.097, 1.731),
                  (0.093, 1.702), (0.03, 1.671), (0, 1.662), (-0.03, 1.671), (-0.093, 1.702)]
    visor_cut = outline(visor_poly, "z", 0.018, 0.3, 0.002)
    shell = outer.ss(visor_cut, 0.003)
    # rebreather vents on each face of the v
    for side in (1, -1):
        for i, y in enumerate((1.628, 1.611)):
            slot = S.Box((0, 0, 0), (0.017 - i * 0.003, 0.0034, 0.02), 0.003)
            R = S.frame_from(z=(0.6 * side, -0.08, 0.8), y=(0, 1, 0))
            shell = shell.ss(slot.place(R, (0.036 * side, y, 0.086)), 0.002)
    parts.append(Part("helmet", SET, "shell", shell, "primary", bone="head_0", voxel=0.0018, tris=(4200, 1300, 380), symmetric=True))

    visor = outer.offset(-0.0035) & visor_cut
    parts.append(Part("helmet", SET, "visor", visor, "visor", bone="head_0", voxel=0.0016, tris=(900, 300, 90), symmetric=True))
    # a thin team light tracing the bottom of the visor
    light_band = outline([(0.095, 1.7), (0.03, 1.668), (0, 1.659), (0, 1.652), (0.03, 1.661), (0.095, 1.692)], "z", 0.02, 0.3)
    visor_light = (outer.offset(0.0012).shell(0.0024) & light_band).mirror_x()
    parts.append(Part("helmet", SET, "visor_light", visor_light, "light", bone="head_0", voxel=0.0011, tris=(260, 100, 40), lods=(0, 1), symmetric=True))

    # brow plate over the visor, dipping to a point in the middle
    brow_poly = [(-0.104, 1.768), (0.104, 1.768), (0.102, 1.736), (0.03, 1.713), (0, 1.705), (-0.03, 1.713), (-0.102, 1.736)]
    brow = S.rounded_shell(outer.offset(0.008), 0.012, 0.0025).si(outline(brow_poly, "z", 0.0, 0.3), 0.003)
    parts.append(Part("helmet", SET, "brow", brow, "secondary", bone="head_0", voxel=0.0016, tris=(1300, 420, 110), symmetric=True))

    # angular cheek plates over the ears, seen from the side (z, y)
    cheek_poly = [(-0.045, 1.722), (0.05, 1.712), (0.078, 1.668), (0.066, 1.6), (0.01, 1.586), (-0.06, 1.61), (-0.07, 1.67)]
    cheek = S.rounded_shell(outer.offset(0.007), 0.012, 0.0025).si(outline(cheek_poly, "x", 0.045, 0.3), 0.003)
    cheek = cheek.ss(S.Box((0.11, 1.648, 0.0), (0.02, 0.0032, 0.034), 0.002), 0.002).mirror_x()
    parts.append(Part("helmet", SET, "cheeks", cheek, "secondary", bone="head_0", voxel=0.0016, tris=(1600, 500, 130), symmetric=True))
    cheek_light = S.Box((0.106, 1.648, 0.0), (0.006, 0.0022, 0.03), 0.0015)
    cheek_light = cheek_light.si(outer.offset(0.018), 0.001).mirror_x()
    parts.append(Part("helmet", SET, "lights", cheek_light, "light", bone="head_0", voxel=0.0012, tris=(160, 60, 24), lods=(0, 1), symmetric=True))

    # nape guard flaring over the back of the neck
    nape_poly = [(-0.086, 1.678), (0.086, 1.678), (0.1, 1.61), (0.072, 1.572), (-0.072, 1.572), (-0.1, 1.61)]
    nape = S.rounded_shell(outer.offset(0.007), 0.012, 0.0025).si(outline(nape_poly, "z", -0.4, -0.035), 0.004)
    nape = nape - S.Box((0, 1.625, -0.14), (0.004, 0.06, 0.04), 0.0015)
    parts.append(Part("helmet", SET, "nape", nape, "secondary", bone="head_0", voxel=0.0016, tris=(1000, 330, 90), symmetric=True))

    # a low spine along the top and two swept fins at the back
    ridge = S.Box((0, 1.81, -0.02), (0.007, 0.05, 0.095), 0.004) & outer.offset(0.009)
    ridge = ridge - outer.offset(0.0005)
    parts.append(Part("helmet", SET, "ridge", ridge, "dark", bone="head_0", voxel=0.0015, tris=(300, 120, 40), symmetric=True))
    fin_poly = [(-0.03, 1.79), (-0.12, 1.77), (-0.15, 1.742), (-0.06, 1.752)]
    fin = outline(fin_poly, "x", 0.052, 0.062, 0.002).si(outer.offset(0.022), 0.004) - outer.offset(-0.004)
    fin = fin.mirror_x()
    parts.append(Part("helmet", SET, "fins", fin, "accent", bone="head_0", voxel=0.0015, tris=(360, 130, 50), symmetric=True))
    return parts


def chest(rig):
    parts, anchors = [], []
    core = torso_core(rig)
    base = core.offset(0.022)
    # front plate: v neck, angled flanks, a point at the sternum
    front_poly = [(-0.152, 1.462), (-0.058, 1.472), (0, 1.428), (0.058, 1.472), (0.152, 1.462),
                  (0.16, 1.34), (0.128, 1.262), (0.035, 1.228), (0, 1.212), (-0.035, 1.228), (-0.128, 1.262), (-0.16, 1.34)]
    front = S.rounded_shell(base, 0.016, 0.003).si(outline(front_poly, "z", -0.02, 0.4), 0.004)
    front = front.ss(S.Box((0, 1.34, 0.14), (0.0045, 0.085, 0.05), 0.003), 0.002)
    for side in (1, -1):
        front = front.ss(S.Box((0.105 * side, 1.3, 0.12), (0.03, 0.0035, 0.06), 0.002).rot_z(0), 0.002)
    parts.append(Part("chest", SET, "front", front, "primary", bone="spine_3", voxel=0.0022, tris=(2200, 780, 250), symmetric=True))
    under_poly = [(-0.172, 1.476), (0.172, 1.476), (0.178, 1.3), (0.14, 1.2), (0.0, 1.18), (-0.14, 1.2), (-0.178, 1.3)]
    under = S.rounded_shell(core.offset(0.012), 0.012, 0.003).si(outline(under_poly, "z", -0.06, 0.4), 0.006)
    parts.append(Part("chest", SET, "under", under, "secondary", bone="spine_3", voxel=0.0024, tris=(1500, 540, 180), symmetric=True))
    back_poly = [(-0.146, 1.462), (-0.05, 1.47), (0.05, 1.47), (0.146, 1.462), (0.15, 1.3), (0.1, 1.215), (-0.1, 1.215), (-0.15, 1.3)]
    back = S.rounded_shell(base, 0.016, 0.003).si(outline(back_poly, "z", -0.45, -0.07), 0.004)
    back = back.su(S.Box((0, 1.34, -0.16), (0.012, 0.11, 0.02), 0.006) & base.offset(0.012), 0.006)
    parts.append(Part("chest", SET, "back", back, "primary", bone="spine_3", voxel=0.0024, tris=(1600, 580, 190), symmetric=True))
    module = S.Box((0, 1.31, -0.178), (0.075, 0.075, 0.028), 0.016)
    module = module.ss(S.union(*[S.Box((x, 1.31, -0.207), (0.0045, 0.05, 0.01), 0.003) for x in (-0.045, -0.03, 0.03, 0.045)]), 0.002)
    parts.append(Part("chest", SET, "module", module, "dark", bone="spine_3", voxel=0.002, tris=(700, 260, 90), symmetric=True))
    strip = S.Box((0, 1.31, -0.205), (0.006, 0.048, 0.004), 0.003)
    parts.append(Part("chest", SET, "back_light", strip, "light", bone="spine_3", voxel=0.0012, tris=(120, 50, 20), lods=(0, 1), symmetric=True))
    # gorget: an angular raised collar
    gorget = S.Torus((0, 1.462, -0.05), (0, 1, 0.3), 0.08, 0.021)
    gorget = gorget.si(S.keep_side((0, 1.45, 0), (0, 1, 0.1)), 0.006)
    gorget = gorget.su(S.Torus((0, 1.492, -0.054), (0, 1, 0.32), 0.071, 0.012), 0.012)
    parts.append(Part("chest", SET, "gorget", gorget, "dark", bone="spine_3", voxel=0.002, tris=(800, 290, 100), symmetric=True))

    # bandolier from the left shoulder to the right hip, with two small pouches
    path = []
    for t in np.linspace(0.0, 1.0, 7):
        start = np.array([0.1, 1.455, 0.0])
        end = np.array([-0.13, 1.06, 0.0])
        q = start * (1 - t) + end * t
        hit = S.raycast(core.offset(0.03), q + (0, 0, 0.4), (0, 0, -1))
        path.append(hit)
    band = strap(path, 0.042, 0.009, up_hint=(0, 0, 1))
    parts.append(Part("chest", SET, "bandolier", band, "cloth", bone="spine_3", voxel=0.002, tris=(700, 260, 90)))
    pouches = S.union(*[S.Box(path[i] + (0, 0, 0.012), (0.022, 0.026, 0.014), 0.007) for i in (3, 5)])
    parts.append(Part("chest", SET, "bandolier_pouches", pouches, "secondary", bone="spine_3", voxel=0.002, tris=(500, 190, 60), lods=(0, 1)))

    # chevron abdomen plates
    abs_base = core.offset(0.016)
    rows = [(1.232, 1.19, "spine_2", "primary"), (1.186, 1.143, "spine_2", "secondary"), (1.138, 1.095, "spine_1", "primary")]
    for i, (top, bottom, bone, mat) in enumerate(rows):
        w = 0.104 - i * 0.008
        poly = [(-w, top), (w, top), (w - 0.006, bottom + 0.008), (0, bottom - 0.004), (-w + 0.006, bottom + 0.008)]
        band = S.rounded_shell(abs_base, 0.012, 0.0028).si(outline(poly, "z", 0.0, 0.4), 0.004)
        parts.append(Part("chest", SET, f"abs{i}", band, mat, bone=bone, voxel=0.0022, tris=(460, 170, 60), symmetric=True))
    belt = S.rounded_shell(core.offset(0.014), 0.016, 0.003).si(box_region((-0.4, 0.984, -0.4), (0.4, 1.03, 0.4), 0.004), 0.004)
    parts.append(Part("chest", SET, "belt", belt, "dark", bone="pelvis", voxel=0.0024, tris=(900, 320, 110), symmetric=True))
    hit = S.raycast(core, (0, 1.007, 0.4), (0, 0, -1))
    buckle = S.Box(hit + (0, 0, 0.02), (0.03, 0.021, 0.008), 0.004)
    buckle = buckle.ss(S.Box(hit + (0, 0, 0.03), (0.018, 0.01, 0.006), 0.003), 0.002)
    parts.append(Part("chest", SET, "buckle", buckle, "metal", bone="pelvis", voxel=0.0015, tris=(200, 80, 28), symmetric=True))
    pouch_pts = []
    for ang in (58.0, 98.0):
        d = np.array([np.sin(np.radians(ang)), 0.0, np.cos(np.radians(ang))])
        p = S.raycast(core, np.array([0, 1.0, -0.02]) + d * 0.5, -d)
        pouch_pts.append(p + d * 0.028)
    pouches = S.union(*[S.Box(p, (0.024, 0.03, 0.017), 0.009) for p in pouch_pts]).mirror_x()
    parts.append(Part("chest", SET, "pouches", pouches, "secondary", bone="pelvis", voxel=0.0022, tris=(700, 250, 80), symmetric=True))

    # three layer pauldrons, left built, right mirrored
    sh = rig.p("arm_upper_l")
    dome = S.Ellipsoid(sh + (0.014, 0.014, 0.0), (0.09, 0.086, 0.097))
    keep_out = S.keep_side((sh[0] - 0.05, 0, 0), (1, 0, 0))
    for i, (grow, drop, mat) in enumerate(((0.0, 0.05, "secondary"), (0.009, 0.026, "primary"), (0.018, 0.0, "primary"))):
        cap = S.rounded_shell(dome.offset(grow), 0.011, 0.0028)
        cap = cap.si(S.keep_side(sh + (0, -drop, 0), (-0.42, 1.0, 0.0)), 0.006).si(keep_out, 0.008)
        parts.append(Part("chest", SET, f"pauldron{i}", cap, mat, bone="arm_upper_l", voxel=0.002, tris=(700, 260, 90), mirror=True))
    rim = S.Torus(sh + (0.036, -0.03, 0.0), S.normalize((0.42, 1.0, 0.0)), 0.086, 0.005) & keep_out
    parts.append(Part("chest", SET, "pauldron_rim", rim, "accent", bone="arm_upper_l", voxel=0.0016, tris=(300, 110, 40), lods=(0, 1), mirror=True))

    for kind, x, y in (("emblem", 0.086, 1.4), ("tag", -0.084, 1.405)):
        p = S.raycast(front, (x, y, 0.5), (0, 0, -1))
        n = S.normals(front, p[None, :])[0]
        anchors.append(Anchor(SET, kind, "spine_3", p + n * 0.0015, n, (0, 1, 0), 0.058 if kind == "emblem" else 0.07))
    return parts, anchors


def arms(rig):
    parts = []
    R, o = rig.limb_frame("arm_lower_l", "hand_l")
    # bracer: a plate over the outer forearm with a flared elbow end
    tube = TaperTube(0.045, 0.248, 0.062, 0.057, 0.048, 0.044)
    bracer = S.rounded_shell(tube, 0.012, 0.003).si(S.keep_side((-0.03, 0, 0), (1, 0.0, 0.25)), 0.006)
    bracer_poly = [(0.045, 0.06), (0.03, 0.02), (-0.2, 0.02), (-0.2, 0.25), (0.02, 0.25), (0.06, 0.2)]
    bracer = bracer.si(outline(bracer_poly, "x", -0.2, 0.2), 0.004)
    bracer = bracer.ss(S.Box((0.058, 0.15, 0.014), (0.008, 0.062, 0.0075), 0.003), 0.002)
    parts.append(Part("arms", SET, "bracer", bracer.place(R, o), "primary", bone="arm_lower_l", voxel=0.002, tris=(1200, 430, 140), mirror=True))
    sleeve = S.rounded_shell(TaperTube(0.03, 0.245, 0.052, 0.049, 0.041, 0.038), 0.008, 0.002)
    parts.append(Part("arms", SET, "sleeve", sleeve.place(R, o), "suit", bone="arm_lower_l", voxel=0.0024, tris=(700, 260, 90), mirror=True))
    light = S.Box((0.054, 0.15, 0.014), (0.004, 0.056, 0.004), 0.0028)
    parts.append(Part("arms", SET, "bracer_light", light.place(R, o), "light", bone="arm_lower_l", voxel=0.0012, tris=(120, 50, 20), lods=(0, 1), mirror=True))
    cuff = S.rounded_shell(TaperTube(0.226, 0.262, 0.05, 0.046, 0.052, 0.048), 0.01, 0.0028)
    parts.append(Part("arms", SET, "cuff", cuff.place(R, o), "secondary", bone="arm_lower_l", voxel=0.0018, tris=(400, 150, 50), mirror=True))
    elbow = S.rounded_shell(S.Ellipsoid((0.006, 0.012, -0.02), (0.054, 0.06, 0.054)), 0.011, 0.003)
    elbow = elbow.si(S.keep_side((0, 0, -0.006), (0, 0, -1)), 0.006).si(S.keep_side((0, 0.062, 0), (0, -1, 0)), 0.006)
    elbow = elbow.ss(S.Box((0.0, 0.01, -0.075), (0.004, 0.05, 0.02), 0.002), 0.002)
    parts.append(Part("arms", SET, "elbow", elbow.place(R, o), "secondary", bone="arm_lower_l", voxel=0.002, tris=(600, 220, 80), mirror=True))

    Ru, ou = rig.limb_frame("arm_upper_l", "arm_lower_l")
    up_tube = TaperTube(0.095, 0.228, 0.068, 0.065, 0.058, 0.056)
    up_plate = S.rounded_shell(up_tube, 0.011, 0.003).si(S.keep_side((-0.02, 0, 0), (1, 0, 0)), 0.006)
    up_plate = up_plate.si(outline([(0.08, 0.095), (-0.08, 0.1), (-0.08, 0.2), (0.0, 0.232), (0.08, 0.205)], "x", -0.2, 0.2), 0.004)
    parts.append(Part("arms", SET, "upper", up_plate.place(Ru, ou), "secondary", bone="arm_upper_l", voxel=0.002, tris=(800, 290, 100), mirror=True))
    strap_u = S.Torus((0, 0.215, 0), (0, 1, 0), 0.057, 0.0055)
    parts.append(Part("arms", SET, "strap", strap_u.place(Ru, ou), "dark", bone="arm_upper_l", voxel=0.0015, tris=(240, 90, 30), lods=(0, 1), mirror=True))

    for side in ("r", "l"):
        h = hand_parts(rig, side, bulk=1.06)
        bone = f"hand_{side}"
        parts.append(Part("arms", SET, f"glove_{side}", h["glove"], "suit", bone=bone, voxel=0.0016, tris=(1500, 520, 170)))
        parts.append(Part("arms", SET, f"backplate_{side}", h["back_plate"], "primary", bone=bone, voxel=0.0014, tris=(300, 110, 40)))
        parts.append(Part("arms", SET, f"knuckles_{side}", h["knuckles"], "secondary", bone=bone, voxel=0.0014, tris=(260, 100, 36)))
        parts.append(Part("arms", SET, f"fingerplates_{side}", h["finger_plates"], "dark", bone=bone, voxel=0.0012, tris=(420, 160, 0), lods=(0, 1)))
    return parts


def legs(rig):
    parts = []
    Rt, ot = rig.limb_frame("leg_upper_l", "leg_lower_l")
    thigh_tube = TaperTube(0.08, 0.36, 0.1, 0.093, 0.073, 0.069, cz=0.004)
    # a shield shaped plate over the front of the thigh, seen from the front (x, y along the leg)
    front = S.rounded_shell(thigh_tube, 0.014, 0.003).si(S.keep_side((0, 0, -0.012), (0, 0, 1)), 0.008)
    front = front.si(outline([(0.07, 0.095), (-0.06, 0.095), (-0.07, 0.3), (0.0, 0.365), (0.075, 0.3)], "z", -0.2, 0.2), 0.004)
    front = front.ss(S.Box((0.0, 0.225, 0.1), (0.0045, 0.085, 0.04), 0.003), 0.002)
    parts.append(Part("legs", SET, "thigh", front.place(Rt, ot), "primary", bone="leg_upper_l", voxel=0.0022, tris=(1100, 400, 130), mirror=True))
    side_tube = TaperTube(0.0, 0.22, 0.11, 0.102, 0.098, 0.092, cz=0.004)
    side = S.rounded_shell(side_tube, 0.012, 0.003).si(S.keep_side((0.03, 0, 0), (1, 0, 0.35)), 0.008)
    side = side.si(outline([(0.12, -0.01), (-0.08, -0.01), (-0.06, 0.2), (0.02, 0.235), (0.12, 0.19)], "x", -0.3, 0.3), 0.004)
    parts.append(Part("legs", SET, "tasset", side.place(Rt, ot), "secondary", bone="leg_upper_l", voxel=0.0022, tris=(800, 290, 100), mirror=True))
    thigh_strap = S.Torus((0, 0.33, 0.0), (0, 1, 0), 0.071, 0.0065)
    parts.append(Part("legs", SET, "thigh_strap", thigh_strap.place(Rt, ot), "dark", bone="leg_upper_l", voxel=0.0016, tris=(300, 110, 40), lods=(0, 1), mirror=True))

    Rs, os_ = rig.limb_frame("leg_lower_l", "ankle_l")
    # pointed knee guard
    knee = S.rounded_shell(S.Ellipsoid((0, 0.004, 0.03), (0.062, 0.074, 0.058)), 0.013, 0.003)
    knee = knee.si(S.keep_side((0, 0, 0.012), (0, 0, 1)), 0.006)
    knee = knee.si(outline([(-0.07, -0.07), (0.07, -0.07), (0.07, 0.03), (0.0, 0.085), (-0.07, 0.03)], "z", -0.2, 0.3), 0.004)
    parts.append(Part("legs", SET, "knee", knee.place(Rs, os_), "primary", bone="leg_lower_l", voxel=0.002, tris=(700, 250, 80), mirror=True))
    knee_ridge = S.Capsule((0, -0.035, 0.093), (0, 0.05, 0.089), 0.006) & S.Ellipsoid((0, 0.004, 0.03), (0.072, 0.084, 0.071))
    parts.append(Part("legs", SET, "knee_ridge", knee_ridge.place(Rs, os_), "accent", bone="leg_lower_l", voxel=0.0015, tris=(160, 60, 20), lods=(0, 1), mirror=True))
    shin_tube = TaperTube(0.07, 0.335, 0.066, 0.064, 0.048, 0.047)
    greave = S.rounded_shell(shin_tube, 0.013, 0.003).si(S.keep_side((0, 0, -0.022), (0, 0, 1)), 0.008)
    greave = greave.si(outline([(-0.08, 0.07), (0.0, 0.1), (0.08, 0.07), (0.08, 0.34), (-0.08, 0.34)], "z", -0.2, 0.3), 0.004)
    greave = greave.ss(S.Box((0.0, 0.215, 0.065), (0.013, 0.085, 0.02), 0.005), 0.003)
    parts.append(Part("legs", SET, "greave", greave.place(Rs, os_), "primary", bone="leg_lower_l", voxel=0.0022, tris=(1000, 360, 120), mirror=True))
    shin_light = S.Box((0.0, 0.215, 0.05), (0.0048, 0.078, 0.004), 0.003)
    parts.append(Part("legs", SET, "greave_light", shin_light.place(Rs, os_), "light", bone="leg_lower_l", voxel=0.0012, tris=(120, 50, 20), lods=(0, 1), mirror=True))
    calf = S.rounded_shell(TaperTube(0.05, 0.23, 0.072, 0.07, 0.06, 0.058), 0.011, 0.003).si(S.keep_side((0, 0, -0.006), (0, 0, -1)), 0.008)
    parts.append(Part("legs", SET, "calf", calf.place(Rs, os_), "secondary", bone="leg_lower_l", voxel=0.0022, tris=(700, 250, 80), mirror=True))

    # boot around the left foot: chunky sole, angular toe cap, heel counter, ankle guard
    boot_body = S.SuperEllipsoid((0.118, 0.058, 0.014), (0.052, 0.058, 0.138), 3.2)
    column = S.Cylinder((0.105, 0.05, -0.066), (0.105, 0.205, -0.066), 0.051, 0.012)
    boot = boot_body.su(column, 0.035).si(S.keep_side((0, 0.028, 0), (0, 1, 0)), 0.004)
    parts.append(Part("legs", SET, "boot", boot, "suit", bone="ankle_l", voxel=0.0024, tris=(1300, 460, 150), mirror=True))
    sole = S.SuperEllipsoid((0.118, 0.018, 0.012), (0.058, 0.02, 0.148), 4.0).si(S.keep_side((0, 0.0, 0), (0, 1, 0)), 0.003)
    sole = sole.ss(S.union(*[S.Box((0.118, 0.0, z), (0.08, 0.006, 0.007), 0.002) for z in (-0.1, -0.065, 0.03, 0.065, 0.1)]), 0.002)
    parts.append(Part("legs", SET, "sole", sole, "dark", bone="ankle_l", voxel=0.0022, tris=(700, 250, 80), mirror=True))
    toe_poly = [(0.03, 0.03), (0.2, 0.03), (0.2, 0.09), (0.09, 0.102), (0.045, 0.085)]
    toe = S.rounded_shell(boot.offset(0.005), 0.012, 0.003).si(outline(toe_poly, "x", -0.3, 0.4), 0.005)
    parts.append(Part("legs", SET, "toe", toe, "primary", bone="ankle_l", voxel=0.002, tris=(600, 220, 70), mirror=True))
    heel = S.rounded_shell(boot.offset(0.005), 0.012, 0.003).si(outline([(-0.2, 0.03), (-0.06, 0.03), (-0.075, 0.12), (-0.2, 0.13)], "x", -0.3, 0.4), 0.005)
    parts.append(Part("legs", SET, "heel", heel, "secondary", bone="ankle_l", voxel=0.002, tris=(500, 180, 60), mirror=True))
    ankle = S.rounded_shell(boot.offset(0.006), 0.012, 0.003).si(outline([(-0.07, 0.1), (0.02, 0.1), (0.045, 0.2), (-0.1, 0.215)], "x", 0.1, 0.4), 0.005)
    parts.append(Part("legs", SET, "ankle_guard", ankle, "primary", bone="ankle_l", voxel=0.002, tris=(400, 150, 50), mirror=True))
    cuff = S.Torus((0.105, 0.2, -0.066), (0, 1, 0), 0.053, 0.0095)
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
