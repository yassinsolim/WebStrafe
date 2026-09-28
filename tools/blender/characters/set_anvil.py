"""anvil: the heavy set. a boxy helm with a thick brow and a narrow slit
visor over a squared jaw guard, slab chest with big layered shoulders,
bulky gauntlets, heavy greaves and a half-cape off the left shoulder.
"""

import numpy as np

import csdf as S
from body import chain_weights, torso_core
from hands import hand_parts
from parts import Anchor, Part, TaperTube, box_region, outline

SET = "anvil"


def helmet(rig):
    parts = []
    C = np.array([0.0, 1.695, -0.004])
    cranium = S.SuperEllipsoid(C + (0, 0.03, -0.012), (0.106, 0.11, 0.118), 3.6)
    for n in ((0.7, 0.72, 0.0), (-0.7, 0.72, 0.0), (0.0, 0.7, 0.72), (0.0, 0.62, -0.78)):
        cranium = cranium.si(S.keep_side(C + np.array(n) * 0.118 + (0, 0.03, -0.012), -np.array(n)), 0.012)
    jaw = S.SuperEllipsoid(C + (0, -0.05, 0.03), (0.096, 0.066, 0.092), 3.4)
    jaw = jaw.si(S.keep_side((0, 0, 0.118), (0, 0, -1)), 0.01).si(S.keep_side((0, 1.585, 0.09), (0, 0.8, -0.6)), 0.012)
    outer = cranium.su(jaw, 0.018)
    outer = outer.si(S.keep_side((0, 1.58, 0), (0, 1, 0.28)), 0.01)
    outer = outer - S.Ellipsoid((0, 1.55, -0.02), (0.066, 0.07, 0.072))
    slit_poly = [(-0.09, 1.716), (0.09, 1.716), (0.086, 1.699), (0.03, 1.694), (-0.03, 1.694), (-0.086, 1.699)]
    slit = outline(slit_poly, "z", 0.02, 0.3, 0.0015)
    shell = outer.ss(slit, 0.002)
    # vertical vents in the jaw guard
    for x in (-0.042, -0.021, 0.0, 0.021, 0.042):
        shell = shell.ss(S.Box((x, 1.628, 0.12), (0.0045, 0.022, 0.02), 0.003), 0.002)
    parts.append(Part("helmet", SET, "shell", shell, "primary", bone="head_0", voxel=0.0018, tris=(4200, 1300, 380), symmetric=True))
    visor = outer.offset(-0.004) & slit
    parts.append(Part("helmet", SET, "visor", visor, "visor", bone="head_0", voxel=0.0014, tris=(500, 180, 60), symmetric=True))
    slit_light = (outer.offset(-0.0045).shell(0.002) & outline([(-0.07, 1.7), (0.07, 1.7), (0.07, 1.697), (-0.07, 1.697)], "z", 0.02, 0.3))
    parts.append(Part("helmet", SET, "visor_light", slit_light, "light", bone="head_0", voxel=0.001, tris=(200, 80, 30), lods=(0, 1), symmetric=True))
    vents = S.union(*[S.Box((x, 1.628, 0.108), (0.0045, 0.02, 0.006), 0.002) for x in (-0.042, -0.021, 0.0, 0.021, 0.042)])
    parts.append(Part("helmet", SET, "vents", vents, "dark", bone="head_0", voxel=0.0014, tris=(300, 110, 40), lods=(0, 1), symmetric=True))
    # heavy brow ridge overhanging the slit
    brow_poly = [(-0.11, 1.78), (0.11, 1.78), (0.108, 1.722), (0.04, 1.719), (0, 1.724), (-0.04, 1.719), (-0.108, 1.722)]
    brow = S.rounded_shell(outer.offset(0.012), 0.02, 0.004).si(outline(brow_poly, "z", 0.0, 0.3), 0.004)
    parts.append(Part("helmet", SET, "brow", brow, "secondary", bone="head_0", voxel=0.0017, tris=(1400, 450, 120), symmetric=True))
    cheek_poly = [(-0.07, 1.73), (0.06, 1.72), (0.09, 1.66), (0.075, 1.585), (-0.03, 1.575), (-0.085, 1.62)]
    cheek = S.rounded_shell(outer.offset(0.01), 0.016, 0.0035).si(outline(cheek_poly, "x", 0.05, 0.3), 0.004)
    parts.append(Part("helmet", SET, "cheeks", cheek.mirror_x(), "secondary", bone="head_0", voxel=0.0017, tris=(1600, 500, 130), symmetric=True))
    bolts = S.union(*[S.Cylinder((0.118, y, z), (0.126, y, z), 0.006, 0.0015) for y, z in ((1.7, -0.04), (1.6, 0.04), (1.6, -0.05))]).mirror_x()
    parts.append(Part("helmet", SET, "bolts", bolts, "metal", bone="head_0", voxel=0.0011, tris=(300, 100, 0), lods=(0, 1), symmetric=True))
    crest = S.Box((0, 1.83, 0.02), (0.018, 0.02, 0.06), 0.006) & outer.offset(0.016)
    crest = crest - outer.offset(0.001)
    parts.append(Part("helmet", SET, "crest", crest, "accent", bone="head_0", voxel=0.0015, tris=(500, 180, 50), symmetric=True))
    nape_poly = [(-0.1, 1.7), (0.1, 1.7), (0.112, 1.6), (0.08, 1.565), (-0.08, 1.565), (-0.112, 1.6)]
    nape = S.rounded_shell(outer.offset(0.009), 0.016, 0.0035).si(outline(nape_poly, "z", -0.4, -0.03), 0.004)
    parts.append(Part("helmet", SET, "nape", nape, "secondary", bone="head_0", voxel=0.0017, tris=(1000, 330, 90), symmetric=True))
    return parts


def chest(rig):
    parts, anchors = [], []
    core = torso_core(rig)
    base = core.offset(0.028)
    slab_poly = [(-0.16, 1.47), (-0.07, 1.48), (0.07, 1.48), (0.16, 1.47), (0.172, 1.32), (0.15, 1.235), (-0.15, 1.235), (-0.172, 1.32)]
    slab = S.rounded_shell(base, 0.02, 0.004).si(outline(slab_poly, "z", -0.02, 0.4), 0.005)
    for y in (1.33, 1.285):
        slab = slab.ss(S.Box((0, y, 0.15), (0.12, 0.004, 0.06), 0.003), 0.002)
    parts.append(Part("chest", SET, "slab", slab, "primary", bone="spine_3", voxel=0.0022, tris=(2400, 800, 250), symmetric=True))
    boss = S.rounded_shell(base.offset(0.016), 0.012, 0.003).si(outline([(-0.06, 1.46), (0.06, 1.46), (0.07, 1.38), (0, 1.35), (-0.07, 1.38)], "z", 0.0, 0.4), 0.004)
    parts.append(Part("chest", SET, "boss", boss, "secondary", bone="spine_3", voxel=0.002, tris=(700, 250, 80), symmetric=True))
    under = S.rounded_shell(core.offset(0.014), 0.014, 0.003).si(box_region((-0.19, 1.19, -0.05), (0.19, 1.482, 0.4), 0.02), 0.008)
    parts.append(Part("chest", SET, "under", under, "secondary", bone="spine_3", voxel=0.0024, tris=(1500, 520, 170), symmetric=True))
    back = S.rounded_shell(base, 0.02, 0.004).si(box_region((-0.16, 1.21, -0.45), (0.16, 1.47, -0.07), 0.02), 0.006)
    parts.append(Part("chest", SET, "back", back, "primary", bone="spine_3", voxel=0.0024, tris=(1700, 600, 190), symmetric=True))
    pack = S.Box((0, 1.3, -0.19), (0.1, 0.1, 0.038), 0.02).su(S.Cylinder((0, 1.22, -0.19), (0, 1.39, -0.19), 0.034, 0.008).move(0.07, 0, 0).mirror_x(), 0.01)
    parts.append(Part("chest", SET, "pack", pack, "dark", bone="spine_3", voxel=0.0022, tris=(1000, 360, 120), symmetric=True))
    pack_lights = S.union(*[S.Box((x, 1.3, -0.228), (0.004, 0.06, 0.004), 0.0025) for x in (-0.03, 0.03)])
    parts.append(Part("chest", SET, "pack_lights", pack_lights, "light", bone="spine_3", voxel=0.0012, tris=(160, 60, 20), lods=(0, 1), symmetric=True))
    gorget = S.RoundCone((0, 1.44, -0.052), (0, 1.52, -0.058), 0.105, 0.085).shell(0.024)
    gorget = gorget.si(S.keep_side((0, 1.45, 0), (0, 1, 0.12)), 0.006).si(S.keep_side((0, 1.53, 0), (0, -1, 0)), 0.006)
    parts.append(Part("chest", SET, "gorget", gorget, "dark", bone="spine_3", voxel=0.002, tris=(1100, 380, 120), symmetric=True))
    abs_base = core.offset(0.02)
    for i, (top, bottom, bone) in enumerate(((1.23, 1.165, "spine_2"), (1.16, 1.095, "spine_1"))):
        band = S.rounded_shell(abs_base, 0.016, 0.0035).si(box_region((-0.115, bottom, 0.0), (0.115, top, 0.4), 0.012), 0.006)
        parts.append(Part("chest", SET, f"abs{i}", band, "primary" if i == 0 else "secondary", bone=bone, voxel=0.0022, tris=(600, 220, 70), symmetric=True))
    belt = S.rounded_shell(core.offset(0.018), 0.022, 0.004).si(box_region((-0.4, 0.978, -0.4), (0.4, 1.035, 0.4), 0.004), 0.004)
    parts.append(Part("chest", SET, "belt", belt, "dark", bone="pelvis", voxel=0.0024, tris=(1000, 350, 110), symmetric=True))
    hit = S.raycast(core, (0, 1.006, 0.4), (0, 0, -1))
    buckle = S.Box(hit + (0, 0, 0.026), (0.042, 0.03, 0.01), 0.005).ss(S.Box(hit + (0, 0, 0.037), (0.028, 0.016, 0.006), 0.003), 0.002)
    parts.append(Part("chest", SET, "buckle", buckle, "metal", bone="pelvis", voxel=0.0016, tris=(260, 100, 30), symmetric=True))
    # big three layer shoulders with a raised rim and a fin
    sh = rig.p("arm_upper_l")
    dome = S.Ellipsoid(sh + (0.02, 0.02, 0.0), (0.11, 0.1, 0.112))
    keep_out = S.keep_side((sh[0] - 0.06, 0, 0), (1, 0, 0))
    for i, (grow, drop, mat) in enumerate(((0.0, 0.07, "secondary"), (0.011, 0.04, "primary"), (0.022, 0.01, "primary"))):
        cap = S.rounded_shell(dome.offset(grow), 0.014, 0.0035)
        cap = cap.si(S.keep_side(sh + (0, -drop, 0), (-0.38, 1.0, 0.0)), 0.006).si(keep_out, 0.008)
        parts.append(Part("chest", SET, f"pauldron{i}", cap, mat, bone="arm_upper_l", voxel=0.0021, tris=(900, 320, 100), mirror=True))
    rim = S.Torus(sh + (0.045, -0.045, 0.0), S.normalize((0.38, 1.0, 0.0)), 0.105, 0.0065) & keep_out
    parts.append(Part("chest", SET, "pauldron_rim", rim, "accent", bone="arm_upper_l", voxel=0.0016, tris=(360, 130, 40), lods=(0, 1), mirror=True))
    fin = outline([(-0.07, 0.0), (0.06, 0.0), (0.02, 0.04), (-0.05, 0.035)], "x", -0.005, 0.005, 0.002)
    fin_R = S.frame_from(x=(0.93, 0.36, 0.0), y=(-0.36, 0.93, 0.0))
    fin = fin.place(fin_R, sh + (0.05, 0.09, 0.0)) - dome.offset(0.01)
    parts.append(Part("chest", SET, "pauldron_fin", fin, "accent", bone="arm_upper_l", voxel=0.0015, tris=(300, 110, 30), lods=(0, 1), mirror=True))
    for kind, x, y in (("emblem", 0.0, 1.415), ("tag", 0.0, 1.3)):
        target = boss if kind == "emblem" else slab
        p = S.raycast(target, (x, y, 0.5), (0, 0, -1))
        n = S.normals(target, p[None, :])[0]
        anchors.append(Anchor(SET, kind, "spine_3", p + n * 0.0015, n, (0, 1, 0), 0.06 if kind == "emblem" else 0.09))
    return parts, anchors


def arms(rig):
    parts = []
    R, o = rig.limb_frame("arm_lower_l", "hand_l")
    tube = TaperTube(0.04, 0.25, 0.068, 0.063, 0.054, 0.05)
    bracer = S.rounded_shell(tube, 0.016, 0.0035)
    bracer = bracer.ss(S.Box((0.0, 0.145, 0.066), (0.03, 0.004, 0.02), 0.002), 0.002).ss(S.Box((0.0, 0.195, 0.061), (0.026, 0.004, 0.02), 0.002), 0.002)
    parts.append(Part("arms", SET, "bracer", bracer.place(R, o), "primary", bone="arm_lower_l", voxel=0.0021, tris=(1500, 520, 160), mirror=True))
    plate = S.rounded_shell(tube.offset(0.012), 0.012, 0.003).si(S.keep_side((0.028, 0, 0), (1, 0, 0)), 0.006).si(S.keep_side((0, 0.2, 0), (0, -1, 0)), 0.006)
    parts.append(Part("arms", SET, "bracer_plate", plate.place(R, o), "secondary", bone="arm_lower_l", voxel=0.002, tris=(700, 250, 80), mirror=True))
    light = S.Box((0.0, 0.11, 0.07), (0.018, 0.004, 0.0035), 0.0025)
    parts.append(Part("arms", SET, "bracer_light", light.place(R, o), "light", bone="arm_lower_l", voxel=0.0012, tris=(120, 50, 20), lods=(0, 1), mirror=True))
    elbow = S.rounded_shell(S.Ellipsoid((0.006, 0.01, -0.022), (0.064, 0.07, 0.064)), 0.015, 0.0035)
    elbow = elbow.si(S.keep_side((0, 0, -0.004), (0, 0, -1)), 0.006).si(S.keep_side((0, 0.07, 0), (0, -1, 0)), 0.006)
    parts.append(Part("arms", SET, "elbow", elbow.place(R, o), "secondary", bone="arm_lower_l", voxel=0.002, tris=(700, 250, 80), mirror=True))
    Ru, ou = rig.limb_frame("arm_upper_l", "arm_lower_l")
    up = S.rounded_shell(TaperTube(0.09, 0.235, 0.076, 0.073, 0.066, 0.063), 0.015, 0.0035)
    up = up.ss(S.Box((0.07, 0.16, 0.0), (0.01, 0.004, 0.05), 0.002), 0.002)
    parts.append(Part("arms", SET, "upper", up.place(Ru, ou), "primary", bone="arm_upper_l", voxel=0.0021, tris=(1100, 380, 120), mirror=True))
    for side in ("r", "l"):
        h = hand_parts(rig, side, bulk=1.14)
        bone = f"hand_{side}"
        parts.append(Part("arms", SET, f"glove_{side}", h["glove"], "suit", bone=bone, voxel=0.0016, tris=(1500, 520, 170)))
        parts.append(Part("arms", SET, f"backplate_{side}", h["back_plate"].offset(0.003), "primary", bone=bone, voxel=0.0014, tris=(360, 130, 40)))
        parts.append(Part("arms", SET, f"knuckles_{side}", h["knuckles"].offset(0.003), "secondary", bone=bone, voxel=0.0014, tris=(300, 110, 36)))
        parts.append(Part("arms", SET, f"fingerplates_{side}", h["finger_plates"].offset(0.0015), "primary", bone=bone, voxel=0.0012, tris=(420, 160, 0), lods=(0, 1)))
    return parts


def legs(rig):
    parts = []
    Rt, ot = rig.limb_frame("leg_upper_l", "leg_lower_l")
    thigh = S.rounded_shell(TaperTube(0.06, 0.37, 0.108, 0.1, 0.08, 0.075, cz=0.004), 0.017, 0.0035)
    thigh = thigh.si(S.keep_side((-0.02, 0, -0.03), (0.5, 0, 0.85)), 0.008)
    thigh = thigh.ss(S.Box((0.0, 0.25, 0.1), (0.05, 0.004, 0.04), 0.002), 0.002)
    parts.append(Part("legs", SET, "thigh", thigh.place(Rt, ot), "primary", bone="leg_upper_l", voxel=0.0022, tris=(1500, 520, 160), mirror=True))
    tasset = S.rounded_shell(TaperTube(-0.02, 0.2, 0.122, 0.112, 0.11, 0.1, cz=0.004), 0.016, 0.0035).si(S.keep_side((0.02, 0, 0), (1, 0, 0.5)), 0.008)
    parts.append(Part("legs", SET, "tasset", tasset.place(Rt, ot), "secondary", bone="leg_upper_l", voxel=0.0022, tris=(900, 320, 100), mirror=True))
    Rs, os_ = rig.limb_frame("leg_lower_l", "ankle_l")
    knee = S.rounded_shell(S.Ellipsoid((0, 0.0, 0.034), (0.07, 0.082, 0.064)), 0.017, 0.0035).si(S.keep_side((0, 0, 0.01), (0, 0, 1)), 0.006)
    parts.append(Part("legs", SET, "knee", knee.place(Rs, os_), "primary", bone="leg_lower_l", voxel=0.002, tris=(800, 280, 90), mirror=True))
    boss = S.Sphere((0, 0.0, 0.1), 0.02).si(S.keep_side((0, 0, 0.09), (0, 0, 1)), 0.004)
    parts.append(Part("legs", SET, "knee_boss", boss.place(Rs, os_), "metal", bone="leg_lower_l", voxel=0.0014, tris=(200, 80, 24), lods=(0, 1), mirror=True))
    greave = S.rounded_shell(TaperTube(0.065, 0.335, 0.074, 0.072, 0.056, 0.054), 0.016, 0.0035)
    greave = greave.ss(S.Box((0.0, 0.2, 0.075), (0.016, 0.1, 0.02), 0.005), 0.003)
    parts.append(Part("legs", SET, "greave", greave.place(Rs, os_), "primary", bone="leg_lower_l", voxel=0.0022, tris=(1400, 480, 150), mirror=True))
    shin_light = S.Box((0.0, 0.2, 0.06), (0.005, 0.09, 0.004), 0.003)
    parts.append(Part("legs", SET, "greave_light", shin_light.place(Rs, os_), "light", bone="leg_lower_l", voxel=0.0012, tris=(120, 50, 20), lods=(0, 1), mirror=True))
    boot_body = S.SuperEllipsoid((0.118, 0.062, 0.014), (0.058, 0.062, 0.145), 3.6)
    column = S.Cylinder((0.105, 0.05, -0.066), (0.105, 0.215, -0.066), 0.058, 0.014)
    boot = boot_body.su(column, 0.035).si(S.keep_side((0, 0.032, 0), (0, 1, 0)), 0.004)
    parts.append(Part("legs", SET, "boot", boot, "suit", bone="ankle_l", voxel=0.0024, tris=(1300, 460, 150), mirror=True))
    sole = S.SuperEllipsoid((0.118, 0.02, 0.012), (0.064, 0.022, 0.156), 4.0).si(S.keep_side((0, 0.0, 0), (0, 1, 0)), 0.003)
    sole = sole.ss(S.union(*[S.Box((0.118, 0.0, z), (0.09, 0.007, 0.008), 0.002) for z in (-0.11, -0.07, 0.02, 0.06, 0.1)]), 0.002)
    parts.append(Part("legs", SET, "sole", sole, "dark", bone="ankle_l", voxel=0.0022, tris=(700, 250, 80), mirror=True))
    shell = S.rounded_shell(boot.offset(0.006), 0.015, 0.0035).si(S.keep_side((0, 0.036, 0), (0, 1, 0)), 0.005)
    shell = shell.si(outline([(-0.2, 0.03), (0.2, 0.03), (0.2, 0.1), (0.05, 0.13), (-0.03, 0.23), (-0.2, 0.24)], "x", -0.4, 0.4), 0.005)
    shell = shell.ss(S.Box((0.118, 0.07, 0.11), (0.08, 0.004, 0.03), 0.002), 0.002)
    parts.append(Part("legs", SET, "boot_shell", shell, "primary", bone="ankle_l", voxel=0.0021, tris=(1200, 420, 130), mirror=True))
    return parts


def class_item(rig):
    parts = []
    # a half-cape hung from the left shoulder, down the back to the knees
    top_l = np.array([0.12, 1.47, -0.1])
    pts = []
    for t in np.linspace(0.0, 1.0, 9):
        y = 1.47 - t * 0.83
        width = 0.2 + t * 0.06
        cx = 0.05 + 0.03 * t
        z = -0.17 - 0.08 * t - 0.04 * np.sin(t * np.pi)
        pts.append((cx, y, z, width))
    cape = None
    for (x0, y0, z0, w0), (x1, y1, z1, w1) in zip(pts[:-1], pts[1:]):
        a = np.array([x0, y0, z0])
        b = np.array([x1, y1, z1])
        yv = S.normalize(b - a)
        R = S.frame_from(y=yv, z=(0.0, 0.0, 1.0))
        seg = S.Box((0, 0, 0), ((w0 + w1) * 0.25, float(np.linalg.norm(b - a)) * 0.5 + 0.01, 0.006), 0.004).place(R, (a + b) * 0.5)
        cape = seg if cape is None else cape.su(seg, 0.01)
    # vertical folds, deeper towards the hem
    cape = S.Displace(cape, lambda p: np.sin(p[:, 0] * 75.0 + 0.6) * np.clip((1.45 - p[:, 1]) / 0.5, 0.15, 1.0), 0.0045)
    shoulder = S.rounded_shell(S.Ellipsoid(rig.p("arm_upper_l") + (0.0, 0.03, -0.02), (0.1, 0.07, 0.12)), 0.01, 0.003)
    shoulder = shoulder.si(S.keep_side(rig.p("arm_upper_l") + (0, 0.0, 0), (-0.3, 1, 0)), 0.01)
    weights = lambda co: chain_weights(rig, co, ["cape_0", "cape_1", "cape_2", "cape_3"], "spine_3")  # noqa: E731
    parts.append(Part("classItem", SET, "cape", cape, "cloth", weights=weights, voxel=0.0028, tris=(1500, 550, 180)))
    parts.append(Part("classItem", SET, "drape", shoulder, "cloth", bone="spine_3", voxel=0.0022, tris=(700, 250, 80)))
    hem = None
    for (x0, y0, z0, w0) in pts[-2:-1]:
        hem = S.Box((x0, y0 - 0.02, z0 - 0.004), (w0 * 0.5, 0.012, 0.0075), 0.003)
    parts.append(Part("classItem", SET, "hem", hem, "trim", weights=weights, voxel=0.0018, tris=(200, 80, 24), lods=(0, 1)))
    clasp = S.Cylinder(top_l + (0.0, 0.0, 0.0), top_l + (0.0, 0.0, 0.012), 0.016, 0.003).move(0.0, -0.01, -0.02)
    parts.append(Part("classItem", SET, "clasp", clasp, "metal", bone="spine_3", voxel=0.0013, tris=(160, 60, 0), lods=(0, 1)))
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
