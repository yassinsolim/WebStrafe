"""quill: the long coat set. a helm with a tall swept crest, a vertical slit
visor flanked by sensor eyes and a stand-up collar; a coat with glowing
seams and skirt panels that follow the legs; long flared cuffs; leggings
with shin guards; a waist sash whose ribbons ride the tail bones.
"""

import numpy as np

import csdf as S
from body import chain_weights, torso_core
from hands import hand_parts
from parts import Anchor, Part, TaperTube, box_region, outline, strap

SET = "quill"


def helmet(rig):
    parts = []
    C = np.array([0.0, 1.695, -0.004])
    cranium = S.SuperEllipsoid(C + (0, 0.022, -0.01), (0.095, 0.108, 0.114), 2.4)
    mask = S.SuperEllipsoid(C + (0, -0.04, 0.03), (0.082, 0.072, 0.09), 2.5)
    mask = mask.si(S.keep_side((0, 1.6, 0.11), (0, 0.4, -0.92)), 0.012)
    outer = cranium.su(mask, 0.03)
    outer = outer.si(S.keep_side((0, 1.583, 0), (0, 1, 0.3)), 0.01)
    outer = outer - S.Ellipsoid((0, 1.55, -0.02), (0.066, 0.07, 0.072))
    slit_poly = [(-0.011, 1.752), (0.011, 1.752), (0.015, 1.66), (0, 1.644), (-0.015, 1.66)]
    slit = outline(slit_poly, "z", 0.02, 0.3, 0.0015)
    shell = outer.ss(slit, 0.002)
    eyes = []
    for x, y in ((0.036, 1.71), (0.052, 1.688)):
        eyes.append(S.Sphere((x, y, 0.0), 0.0075))
    eye_cut = S.union(*[S.Cylinder((e.c[0], e.c[1], 0.02), (e.c[0], e.c[1], 0.3), 0.009, 0.002) for e in eyes]).mirror_x()
    shell = shell.ss(eye_cut, 0.002)
    for side in (1, -1):
        shell = shell.ss(S.Box((0.05 * side, 1.635, 0.1), (0.022, 0.0035, 0.03), 0.002), 0.002)
    parts.append(Part("helmet", SET, "shell", shell, "primary", bone="head_0", voxel=0.0018, tris=(4000, 1250, 360), symmetric=True))
    visor = outer.offset(-0.004) & slit
    parts.append(Part("helmet", SET, "visor", visor, "visor", bone="head_0", voxel=0.0013, tris=(500, 180, 60), symmetric=True))
    lenses = (outer.offset(-0.003) & eye_cut)
    parts.append(Part("helmet", SET, "eyes", lenses, "light", bone="head_0", voxel=0.0011, tris=(400, 140, 40), symmetric=True))
    # tall crest swept back from the brow
    crest_poly = [(0.07, 1.775), (0.02, 1.83), (-0.06, 1.872), (-0.15, 1.868), (-0.19, 1.82), (-0.12, 1.8), (-0.03, 1.79)]
    crest = outline(crest_poly, "x", -0.007, 0.007, 0.003).su(outer.offset(0.004) & box_region((-0.02, 1.7, -0.2), (0.02, 1.9, 0.12)), 0.012)
    crest = crest - outer.offset(-0.006)
    parts.append(Part("helmet", SET, "crest", crest, "accent", bone="head_0", voxel=0.0015, tris=(1000, 340, 100), symmetric=True))
    # layered temple plates swept back
    for i, (grow, y0, mat) in enumerate(((0.006, 1.69, "secondary"), (0.013, 1.705, "primary"))):
        poly = [(0.06, y0 + 0.03), (-0.1, y0 + 0.05), (-0.12, y0 + 0.02), (-0.02, y0 - 0.02), (0.05, y0 - 0.025)]
        plate = S.rounded_shell(outer.offset(grow), 0.011, 0.003).si(outline(poly, "x", 0.05, 0.3), 0.003)
        parts.append(Part("helmet", SET, f"temple{i}", plate.mirror_x(), mat, bone="head_0", voxel=0.0016, tris=(900, 300, 80), symmetric=True))
    collar = S.RoundCone((0, 1.555, -0.05), (0, 1.635, -0.07), 0.098, 0.116).shell(0.011)
    collar = collar.si(S.keep_side((0, 1.56, 0), (0, 1, 0)), 0.005).si(S.keep_side((0, 1.64, 0), (0, -1, 0)), 0.005)
    collar = collar - outline([(-0.03, 1.5), (0.03, 1.5), (0.07, 1.7), (-0.07, 1.7)], "z", 0.02, 0.3)
    parts.append(Part("helmet", SET, "collar", collar, "secondary", bone="neck_0", voxel=0.0019, tris=(1200, 400, 120), symmetric=True))
    return parts


def chest(rig):
    parts, anchors = [], []
    core = torso_core(rig)
    coat = S.rounded_shell(core.offset(0.014), 0.012, 0.003).si(box_region((-0.18, 0.95, -0.4), (0.18, 1.475, 0.4), 0.02), 0.01)
    coat = coat - outline([(-0.035, 1.5), (0.035, 1.5), (0.0, 1.36)], "z", 0.0, 0.4)
    parts.append(Part("chest", SET, "coat", coat, "cloth", bone="spine_3", voxel=0.0024, tris=(2400, 820, 250), symmetric=True))
    panel_poly = [(-0.11, 1.44), (-0.03, 1.39), (0.03, 1.39), (0.11, 1.44), (0.12, 1.29), (0.05, 1.19), (0, 1.17), (-0.05, 1.19), (-0.12, 1.29)]
    panel = S.rounded_shell(core.offset(0.024), 0.012, 0.003).si(outline(panel_poly, "z", 0.0, 0.4), 0.004)
    parts.append(Part("chest", SET, "panel", panel, "primary", bone="spine_3", voxel=0.0021, tris=(1600, 560, 170), symmetric=True))
    seams = None
    for (x0, y0), (x1, y1) in (((0.03, 1.385), (0.0, 1.29)), ((0.1, 1.32), (0.045, 1.2))):
        cut = outline([(x0 - 0.003, y0), (x0 + 0.003, y0), (x1 + 0.003, y1), (x1 - 0.003, y1)], "z", 0.0, 0.4)
        line = core.offset(0.03).shell(0.003) & cut
        seams = line if seams is None else seams | line
    parts.append(Part("chest", SET, "seams", seams.mirror_x(), "light", bone="spine_3", voxel=0.0011, tris=(400, 150, 40), lods=(0, 1), symmetric=True))
    # stand-up lapels
    lapel_poly = [(0.02, 1.47), (0.12, 1.49), (0.14, 1.43), (0.05, 1.37)]
    lapel = S.rounded_shell(core.offset(0.03), 0.01, 0.003).si(outline(lapel_poly, "z", 0.0, 0.4), 0.004).mirror_x()
    parts.append(Part("chest", SET, "lapels", lapel, "trim", bone="spine_3", voxel=0.0019, tris=(900, 320, 100), symmetric=True))
    sh = rig.p("arm_upper_l")
    for i, (grow, drop, mat) in enumerate(((0.0, 0.04, "secondary"), (0.01, 0.015, "primary"))):
        cap = S.rounded_shell(S.Ellipsoid(sh + (0.01, 0.02, 0.0), (0.082, 0.072, 0.088)).offset(grow), 0.01, 0.003)
        cap = cap.si(S.keep_side(sh + (0, -drop, 0), (-0.6, 1.0, 0.0)), 0.006).si(S.keep_side((sh[0] - 0.04, 0, 0), (1, 0, 0)), 0.008)
        parts.append(Part("chest", SET, f"mantle{i}", cap, mat, bone="arm_upper_l", voxel=0.002, tris=(700, 250, 80), mirror=True))
    belt = S.rounded_shell(core.offset(0.024), 0.014, 0.003).si(box_region((-0.4, 0.99, -0.4), (0.4, 1.03, 0.4), 0.004), 0.004)
    parts.append(Part("chest", SET, "belt", belt, "dark", bone="pelvis", voxel=0.0024, tris=(900, 320, 100), symmetric=True))
    hit = S.raycast(core, (0, 1.01, 0.4), (0, 0, -1))
    clasp = S.Cylinder(hit + (0, 0, 0.022), hit + (0, 0, 0.032), 0.02, 0.003)
    parts.append(Part("chest", SET, "clasp", clasp, "metal", bone="pelvis", voxel=0.0014, tris=(260, 100, 30), symmetric=True))
    # coat skirt, split up the front: side panels ride the thighs, the back panel the tail bones
    Rt, ot = rig.limb_frame("leg_upper_l", "leg_lower_l")
    side = S.rounded_shell(TaperTube(0.0, 0.47, 0.118, 0.11, 0.13, 0.122, cz=0.0), 0.009, 0.003)
    side = side.si(S.keep_side((-0.01, 0, 0), (1, 0, -0.15)), 0.012)
    side = S.Displace(side, lambda p: np.sin(np.arctan2(p[:, 2], p[:, 0]) * 7.0) * np.clip(p[:, 1] / 0.47, 0, 1), 0.004)
    parts.append(Part("chest", SET, "skirt_side", side.place(Rt, ot), "cloth", bone="leg_upper_l", voxel=0.0024, tris=(1100, 380, 120), mirror=True))
    back_panel = S.rounded_shell(S.SuperEllipsoid((0, 0.8, -0.02), (0.15, 0.25, 0.15), 2.4), 0.009, 0.003)
    back_panel = back_panel.si(S.keep_side((0, 0, -0.08), (0, 0, -1)), 0.012).si(box_region((-0.3, 0.56, -0.4), (0.3, 1.0, 0.1)), 0.01)
    back_panel = S.Displace(back_panel, lambda p: np.sin(p[:, 0] * 70.0) * np.clip((1.0 - p[:, 1]) / 0.4, 0, 1), 0.004)
    tail_w = lambda co: chain_weights(rig, co, ["tail_0", "tail_1", "tail_2"], "pelvis")  # noqa: E731
    parts.append(Part("chest", SET, "skirt_back", back_panel, "cloth", weights=tail_w, voxel=0.0026, tris=(1100, 380, 120), symmetric=True))
    hem = (S.rounded_shell(S.SuperEllipsoid((0, 0.8, -0.02), (0.15, 0.25, 0.15), 2.4).offset(0.001), 0.011, 0.003)
           .si(S.keep_side((0, 0, -0.08), (0, 0, -1)), 0.012).si(box_region((-0.3, 0.56, -0.4), (0.3, 0.585, 0.1)), 0.004))
    parts.append(Part("chest", SET, "skirt_hem", hem, "trim", weights=tail_w, voxel=0.0018, tris=(500, 180, 50), lods=(0, 1), symmetric=True))
    for kind, x, y in (("emblem", 0.0, 1.3), ("tag", 0.0, 1.22)):
        p = S.raycast(panel, (x, y, 0.5), (0, 0, -1))
        n = S.normals(panel, p[None, :])[0]
        anchors.append(Anchor(SET, kind, "spine_3", p + n * 0.0015, n, (0, 1, 0), 0.052 if kind == "emblem" else 0.07))
    return parts, anchors


def arms(rig):
    parts = []
    R, o = rig.limb_frame("arm_lower_l", "hand_l")
    sleeve = S.rounded_shell(TaperTube(0.0, 0.2, 0.054, 0.051, 0.046, 0.044), 0.009, 0.0025)
    parts.append(Part("arms", SET, "sleeve", sleeve.place(R, o), "secondary", bone="arm_lower_l", voxel=0.0022, tris=(800, 280, 90), mirror=True))
    cuff = S.rounded_shell(TaperTube(0.12, 0.262, 0.056, 0.053, 0.074, 0.07), 0.01, 0.003)
    cuff = cuff.si(S.keep_side((0, 0.27, 0), (0, -1, 0.35)), 0.006)
    parts.append(Part("arms", SET, "cuff", cuff.place(R, o), "primary", bone="arm_lower_l", voxel=0.002, tris=(1100, 380, 110), mirror=True))
    trim = S.Torus((0, 0.13, 0), (0, 1, 0), 0.058, 0.0045) | S.Torus((0, 0.252, 0.004), S.normalize((0, 1, -0.3)), 0.071, 0.0045)
    parts.append(Part("arms", SET, "cuff_trim", trim.place(R, o), "accent", bone="arm_lower_l", voxel=0.0015, tris=(500, 180, 50), lods=(0, 1), mirror=True))
    light = S.Box((0.062, 0.19, 0.0), (0.004, 0.04, 0.004), 0.0025)
    parts.append(Part("arms", SET, "cuff_light", light.place(R, o), "light", bone="arm_lower_l", voxel=0.0012, tris=(120, 50, 20), lods=(0, 1), mirror=True))
    Ru, ou = rig.limb_frame("arm_upper_l", "arm_lower_l")
    up = S.rounded_shell(TaperTube(0.04, 0.27, 0.064, 0.062, 0.052, 0.05), 0.009, 0.0025)
    parts.append(Part("arms", SET, "upper", up.place(Ru, ou), "secondary", bone="arm_upper_l", voxel=0.0022, tris=(800, 280, 90), mirror=True))
    rings = S.Torus((0, 0.15, 0), (0, 1, 0), 0.064, 0.0045) | S.Torus((0, 0.17, 0), (0, 1, 0), 0.062, 0.0045)
    parts.append(Part("arms", SET, "rings", rings.place(Ru, ou), "metal", bone="arm_upper_l", voxel=0.0014, tris=(500, 180, 50), lods=(0, 1), mirror=True))
    for side in ("r", "l"):
        h = hand_parts(rig, side, bulk=0.98)
        bone = f"hand_{side}"
        parts.append(Part("arms", SET, f"glove_{side}", h["glove"], "suit", bone=bone, voxel=0.0015, tris=(1500, 520, 170)))
        parts.append(Part("arms", SET, f"backplate_{side}", h["back_plate"], "primary", bone=bone, voxel=0.0014, tris=(300, 110, 40)))
        parts.append(Part("arms", SET, f"fingerplates_{side}", h["finger_plates"], "accent", bone=bone, voxel=0.0012, tris=(420, 160, 0), lods=(0, 1)))
    return parts


def legs(rig):
    parts = []
    Rt, ot = rig.limb_frame("leg_upper_l", "leg_lower_l")
    legging = S.rounded_shell(TaperTube(0.02, 0.4, 0.096, 0.089, 0.064, 0.06, cz=0.004), 0.008, 0.0025)
    parts.append(Part("legs", SET, "legging", legging.place(Rt, ot), "suit", bone="leg_upper_l", voxel=0.0024, tris=(900, 320, 100), mirror=True))
    thigh = S.rounded_shell(TaperTube(0.15, 0.36, 0.1, 0.094, 0.078, 0.073, cz=0.004), 0.01, 0.003)
    thigh = thigh.si(S.keep_side((0.03, 0, 0), (1, 0, 0.4)), 0.008)
    parts.append(Part("legs", SET, "thigh", thigh.place(Rt, ot), "primary", bone="leg_upper_l", voxel=0.0021, tris=(800, 280, 90), mirror=True))
    Rs, os_ = rig.limb_frame("leg_lower_l", "ankle_l")
    knee = S.rounded_shell(S.Ellipsoid((0, 0.0, 0.028), (0.055, 0.064, 0.05)), 0.01, 0.003).si(S.keep_side((0, 0, 0.018), (0, 0, 1)), 0.006)
    parts.append(Part("legs", SET, "knee", knee.place(Rs, os_), "primary", bone="leg_lower_l", voxel=0.0019, tris=(600, 220, 70), mirror=True))
    guard_poly = [(-0.06, 0.07), (0.0, 0.05), (0.06, 0.07), (0.05, 0.3), (0.0, 0.34), (-0.05, 0.3)]
    guard = S.rounded_shell(TaperTube(0.04, 0.35, 0.064, 0.062, 0.05, 0.048), 0.012, 0.003).si(outline(guard_poly, "z", 0.0, 0.3), 0.004)
    parts.append(Part("legs", SET, "shin_guard", guard.place(Rs, os_), "primary", bone="leg_lower_l", voxel=0.0021, tris=(900, 320, 100), mirror=True))
    boot = S.SuperEllipsoid((0.12, 0.05, 0.02), (0.046, 0.05, 0.142), 2.7).su(S.Cylinder((0.105, 0.05, -0.064), (0.105, 0.26, -0.064), 0.05, 0.012), 0.03)
    boot = boot.si(S.keep_side((0, 0.022, 0), (0, 1, 0)), 0.004)
    parts.append(Part("legs", SET, "boot", boot, "secondary", bone="ankle_l", voxel=0.0023, tris=(1400, 500, 160), mirror=True))
    sole = S.SuperEllipsoid((0.12, 0.013, 0.016), (0.05, 0.014, 0.15), 4.0).si(S.keep_side((0, 0.0, 0), (0, 1, 0)), 0.003)
    parts.append(Part("legs", SET, "sole", sole, "dark", bone="ankle_l", voxel=0.002, tris=(500, 180, 60), mirror=True))
    cuff = S.Torus((0.105, 0.255, -0.064), (0, 1, 0), 0.052, 0.008)
    parts.append(Part("legs", SET, "boot_cuff", cuff, "accent", bone="ankle_l", voxel=0.0016, tris=(300, 110, 36), mirror=True))
    return parts


def class_item(rig):
    parts = []
    sash = S.rounded_shell(torso_core(rig).offset(0.036), 0.012, 0.004).si(box_region((-0.4, 0.97, -0.4), (0.4, 1.03, 0.4), 0.006), 0.006)
    sash = S.Displace(sash, lambda p: np.sin(p[:, 1] * 260.0 + p[:, 0] * 40.0), 0.0015)
    parts.append(Part("classItem", SET, "sash", sash, "trim", bone="pelvis", voxel=0.0024, tris=(1200, 420, 130), symmetric=True))
    ribbons = None
    for x, z0, swing in ((0.05, -0.16, 0.014), (-0.028, -0.168, -0.012)):
        path = []
        for t in np.linspace(0.0, 1.0, 7):
            path.append(np.array([x + swing * t + 0.006 * np.sin(t * 5.0), 1.0 - 0.5 * t, z0 - 0.07 * t - 0.012 * np.sin(t * 3.1)]))
        rib = strap(path, 0.05, 0.006, up_hint=(0.0, 0.0, -1.0), r=0.002)
        ribbons = rib if ribbons is None else ribbons | rib
    tail_w = lambda co: chain_weights(rig, co, ["tail_0", "tail_1", "tail_2"], "pelvis")  # noqa: E731
    parts.append(Part("classItem", SET, "ribbons", ribbons, "trim", weights=tail_w, voxel=0.002, tris=(900, 320, 100)))
    knot = S.Ellipsoid((0.03, 1.0, -0.165), (0.035, 0.03, 0.02))
    parts.append(Part("classItem", SET, "knot", knot, "trim", bone="pelvis", voxel=0.0018, tris=(400, 150, 50)))
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
