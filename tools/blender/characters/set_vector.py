"""vector: the light set. a sleek helmet with one big faceplate and a swept
tail, a slim vest with crossed straps and a cowl, wrapped sleeves, light
treads, and a long hooded cloak on the cape bones.
"""

import numpy as np

import csdf as S
from body import chain_weights, torso_core
from hands import hand_parts
from parts import Anchor, Part, TaperTube, box_region, outline, strap

SET = "vector"


def helmet(rig):
    parts = []
    C = np.array([0.0, 1.695, -0.004])
    shell_shape = S.SuperEllipsoid(C + (0, 0.018, -0.014), (0.097, 0.11, 0.118), 2.2)
    tail = S.RoundCone(C + (0, 0.03, -0.1), C + (0, -0.03, -0.168), 0.052, 0.012)
    chin = S.SuperEllipsoid(C + (0, -0.05, 0.026), (0.082, 0.062, 0.088), 2.3)
    outer = shell_shape.su(tail, 0.04).su(chin, 0.03)
    outer = outer.si(S.keep_side((0, 1.583, 0), (0, 1, 0.3)), 0.01)
    outer = outer - S.Ellipsoid((0, 1.55, -0.02), (0.066, 0.07, 0.072))
    plate = S.Ellipsoid((0, 1.68, 0.1), (0.083, 0.066, 0.075)) & S.keep_side((0, 0, 0.03), (0, 0, 1))
    shell = outer.ss(plate, 0.003)
    # a raised stripe over the top, front to tail
    parts.append(Part("helmet", SET, "shell", shell, "primary", bone="head_0", voxel=0.0018, tris=(3800, 1200, 350), symmetric=True))
    visor = outer.offset(-0.0025) & plate
    parts.append(Part("helmet", SET, "visor", visor, "visor", bone="head_0", voxel=0.0016, tris=(1300, 420, 110), symmetric=True))
    frame = (outer.offset(0.0025).shell(0.006) & (plate.offset(0.007) - plate.offset(0.001)))
    parts.append(Part("helmet", SET, "frame", frame, "dark", bone="head_0", voxel=0.0014, tris=(900, 300, 80), symmetric=True))
    stripe = S.Box((0, 1.79, -0.04), (0.012, 0.06, 0.16), 0.004) & outer.offset(0.004)
    stripe = stripe - outer.offset(0.0005)
    parts.append(Part("helmet", SET, "stripe", stripe, "accent", bone="head_0", voxel=0.0014, tris=(500, 180, 50), symmetric=True))
    disk = S.Cylinder((0.086, 1.69, -0.02), (0.108, 1.69, -0.02), 0.034, 0.007).mirror_x()
    parts.append(Part("helmet", SET, "disks", disk, "secondary", bone="head_0", voxel=0.0016, tris=(700, 240, 70), symmetric=True))
    ring = S.Torus((0.108, 1.69, -0.02), (1, 0, 0), 0.022, 0.0026).mirror_x()
    parts.append(Part("helmet", SET, "lights", ring, "light", bone="head_0", voxel=0.0011, tris=(260, 100, 40), lods=(0, 1), symmetric=True))
    return parts


def chest(rig):
    parts, anchors = [], []
    core = torso_core(rig)
    vest = S.rounded_shell(core.offset(0.012), 0.011, 0.003).si(box_region((-0.17, 1.12, -0.4), (0.17, 1.47, 0.4), 0.02), 0.008)
    vest = vest - S.Ellipsoid((0, 1.5, 0.06), (0.07, 0.09, 0.08))
    parts.append(Part("chest", SET, "vest", vest, "secondary", bone="spine_3", voxel=0.0024, tris=(2000, 700, 220), symmetric=True))
    plate_poly = [(-0.12, 1.44), (-0.04, 1.43), (0.04, 1.43), (0.12, 1.44), (0.13, 1.33), (0.07, 1.27), (-0.07, 1.27), (-0.13, 1.33)]
    plate = S.rounded_shell(core.offset(0.022), 0.012, 0.003).si(outline(plate_poly, "z", 0.0, 0.4), 0.004)
    plate = plate - S.Box((0, 1.35, 0.14), (0.004, 0.09, 0.04), 0.002)
    parts.append(Part("chest", SET, "plate", plate, "primary", bone="spine_3", voxel=0.0021, tris=(1500, 520, 160), symmetric=True))
    # crossed straps over the front
    straps = None
    for sx in (1, -1):
        path = []
        for t in np.linspace(0.0, 1.0, 6):
            q = np.array([0.1 * sx, 1.46, 0.0]) * (1 - t) + np.array([-0.12 * sx, 1.1, 0.0]) * t
            path.append(S.raycast(core.offset(0.036), q + (0, 0, 0.4), (0, 0, -1)))
        band = strap(path, 0.028, 0.007)
        straps = band if straps is None else straps | band
    parts.append(Part("chest", SET, "straps", straps, "cloth", bone="spine_3", voxel=0.0018, tris=(1000, 360, 110)))
    pouch_row = []
    for x in (-0.07, 0.0, 0.07):
        p = S.raycast(core.offset(0.03), (x, 1.2, 0.4), (0, 0, -1))
        pouch_row.append(S.Box(p + (0, 0, 0.012), (0.026, 0.028, 0.013), 0.008))
    parts.append(Part("chest", SET, "pouches", S.union(*pouch_row), "dark", bone="spine_2", voxel=0.002, tris=(700, 250, 80), symmetric=True))
    # a cowl bunched around the neck
    cowl = S.Torus((0, 1.47, -0.05), (0, 1, 0.28), 0.078, 0.03).su(S.Torus((0, 1.5, -0.056), (0, 1, 0.3), 0.066, 0.022), 0.02)
    cowl = S.Displace(cowl, lambda p: np.sin(np.arctan2(p[:, 0], p[:, 2] + 0.05) * 9.0), 0.003)
    parts.append(Part("chest", SET, "cowl", cowl, "cloth", bone="spine_3", voxel=0.0022, tris=(1400, 500, 150), symmetric=True))
    belt = S.rounded_shell(core.offset(0.012), 0.012, 0.003).si(box_region((-0.4, 0.99, -0.4), (0.4, 1.025, 0.4), 0.004), 0.004)
    parts.append(Part("chest", SET, "belt", belt, "dark", bone="pelvis", voxel=0.0024, tris=(800, 280, 90), symmetric=True))
    sh = rig.p("arm_upper_l")
    cap = S.rounded_shell(S.Ellipsoid(sh + (0.012, 0.012, 0.0), (0.078, 0.07, 0.084)), 0.01, 0.003)
    cap = cap.si(S.keep_side(sh + (0, -0.015, 0), (-0.5, 1.0, 0.0)), 0.006).si(S.keep_side((sh[0] - 0.04, 0, 0), (1, 0, 0)), 0.008)
    parts.append(Part("chest", SET, "shoulder", cap, "primary", bone="arm_upper_l", voxel=0.002, tris=(700, 250, 80), mirror=True))
    back = S.rounded_shell(core.offset(0.022), 0.012, 0.003).si(box_region((-0.11, 1.24, -0.4), (0.11, 1.44, -0.08), 0.02), 0.006)
    parts.append(Part("chest", SET, "back", back, "primary", bone="spine_3", voxel=0.0022, tris=(1000, 360, 110), symmetric=True))
    for kind, x, y in (("emblem", 0.07, 1.39), ("tag", -0.072, 1.39)):
        p = S.raycast(plate, (x, y, 0.5), (0, 0, -1))
        n = S.normals(plate, p[None, :])[0]
        anchors.append(Anchor(SET, kind, "spine_3", p + n * 0.0015, n, (0, 1, 0), 0.05 if kind == "emblem" else 0.06))
    return parts, anchors


def arms(rig):
    parts = []
    R, o = rig.limb_frame("arm_lower_l", "hand_l")
    sleeve = S.rounded_shell(TaperTube(0.0, 0.25, 0.054, 0.051, 0.041, 0.039), 0.009, 0.0025)
    parts.append(Part("arms", SET, "sleeve", sleeve.place(R, o), "cloth", bone="arm_lower_l", voxel=0.0022, tris=(900, 320, 100), mirror=True))
    wraps = None
    for i, y in enumerate(np.linspace(0.07, 0.23, 6)):
        r = 0.052 - (y / 0.25) * 0.012 + 0.004
        ring = S.Torus((0, y, 0), S.normalize((0.0, 1.0, 0.35 if i % 2 else -0.35)), r, 0.0055)
        wraps = ring if wraps is None else wraps | ring
    parts.append(Part("arms", SET, "wraps", wraps.place(R, o), "trim", bone="arm_lower_l", voxel=0.0016, tris=(1100, 380, 110), mirror=True))
    bracer = S.rounded_shell(TaperTube(0.12, 0.235, 0.058, 0.055, 0.051, 0.048), 0.01, 0.0028).si(S.keep_side((0.0, 0, 0.0), (0.3, 0, 1.0)), 0.006)
    parts.append(Part("arms", SET, "bracer", bracer.place(R, o), "primary", bone="arm_lower_l", voxel=0.0019, tris=(700, 250, 80), mirror=True))
    Ru, ou = rig.limb_frame("arm_upper_l", "arm_lower_l")
    up_sleeve = S.rounded_shell(TaperTube(0.06, 0.27, 0.065, 0.063, 0.052, 0.05), 0.009, 0.0025)
    parts.append(Part("arms", SET, "upper_sleeve", up_sleeve.place(Ru, ou), "cloth", bone="arm_upper_l", voxel=0.0023, tris=(900, 320, 100), mirror=True))
    band = S.Torus((0, 0.14, 0), (0, 1, 0), 0.066, 0.006)
    parts.append(Part("arms", SET, "band", band.place(Ru, ou), "dark", bone="arm_upper_l", voxel=0.0015, tris=(300, 110, 36), lods=(0, 1), mirror=True))
    for side in ("r", "l"):
        h = hand_parts(rig, side, bulk=1.0)
        bone = f"hand_{side}"
        parts.append(Part("arms", SET, f"glove_{side}", h["glove"], "suit", bone=bone, voxel=0.0015, tris=(1500, 520, 170)))
        parts.append(Part("arms", SET, f"backplate_{side}", h["back_plate"], "primary", bone=bone, voxel=0.0014, tris=(300, 110, 40)))
        parts.append(Part("arms", SET, f"knuckles_{side}", h["knuckles"], "dark", bone=bone, voxel=0.0014, tris=(260, 100, 36)))
    return parts


def legs(rig):
    parts = []
    Rt, ot = rig.limb_frame("leg_upper_l", "leg_lower_l")
    pants = S.rounded_shell(TaperTube(0.0, 0.4, 0.098, 0.09, 0.066, 0.062, cz=0.004), 0.01, 0.0028)
    parts.append(Part("legs", SET, "pants", pants.place(Rt, ot), "cloth", bone="leg_upper_l", voxel=0.0024, tris=(1100, 400, 120), mirror=True))
    thigh = S.rounded_shell(TaperTube(0.12, 0.32, 0.106, 0.098, 0.084, 0.078, cz=0.004), 0.011, 0.003)
    thigh = thigh.si(S.keep_side((0, 0, 0.0), (0.2, 0, 1)), 0.008).si(outline([(0.06, 0.12), (-0.06, 0.12), (-0.05, 0.3), (0.05, 0.32)], "z", -0.3, 0.3), 0.004)
    parts.append(Part("legs", SET, "thigh", thigh.place(Rt, ot), "primary", bone="leg_upper_l", voxel=0.0021, tris=(900, 320, 100), mirror=True))
    straps = S.Torus((0, 0.14, 0.0), (0, 1, 0), 0.1, 0.006) | S.Torus((0, 0.3, 0.0), (0, 1, 0), 0.084, 0.006)
    parts.append(Part("legs", SET, "straps", straps.place(Rt, ot), "dark", bone="leg_upper_l", voxel=0.0016, tris=(500, 180, 50), lods=(0, 1), mirror=True))
    pouch = S.Box((0.1, 0.2, 0.02), (0.018, 0.045, 0.035), 0.01)
    parts.append(Part("legs", SET, "pouch", pouch.place(Rt, ot), "secondary", bone="leg_upper_l", voxel=0.002, tris=(500, 180, 50), mirror=True))
    Rs, os_ = rig.limb_frame("leg_lower_l", "ankle_l")
    knee = S.rounded_shell(S.Ellipsoid((0, 0.004, 0.028), (0.054, 0.062, 0.05)), 0.01, 0.0028).si(S.keep_side((0, 0, 0.018), (0, 0, 1)), 0.006)
    parts.append(Part("legs", SET, "knee", knee.place(Rs, os_), "primary", bone="leg_lower_l", voxel=0.0019, tris=(600, 220, 70), mirror=True))
    shin = S.rounded_shell(TaperTube(0.04, 0.37, 0.06, 0.058, 0.043, 0.042), 0.009, 0.0025)
    parts.append(Part("legs", SET, "shin", shin.place(Rs, os_), "cloth", bone="leg_lower_l", voxel=0.0022, tris=(900, 320, 100), mirror=True))
    wraps = None
    for i, y in enumerate(np.linspace(0.2, 0.36, 5)):
        r = 0.06 - (y / 0.385) * 0.017 + 0.006
        ring = S.Torus((0, y, 0), S.normalize((0.0, 1.0, 0.3 if i % 2 else -0.3)), r, 0.0055)
        wraps = ring if wraps is None else wraps | ring
    parts.append(Part("legs", SET, "wraps", wraps.place(Rs, os_), "trim", bone="leg_lower_l", voxel=0.0016, tris=(900, 320, 100), mirror=True))
    boot = S.SuperEllipsoid((0.118, 0.052, 0.014), (0.048, 0.052, 0.134), 2.8).su(S.Cylinder((0.105, 0.05, -0.066), (0.105, 0.17, -0.066), 0.047, 0.012), 0.03)
    boot = boot.si(S.keep_side((0, 0.02, 0), (0, 1, 0)), 0.004)
    parts.append(Part("legs", SET, "boot", boot, "secondary", bone="ankle_l", voxel=0.0023, tris=(1300, 460, 150), mirror=True))
    sole = S.SuperEllipsoid((0.118, 0.012, 0.012), (0.052, 0.013, 0.14), 4.0).si(S.keep_side((0, 0.0, 0), (0, 1, 0)), 0.003)
    parts.append(Part("legs", SET, "sole", sole, "dark", bone="ankle_l", voxel=0.002, tris=(500, 180, 60), mirror=True))
    toe = S.rounded_shell(boot.offset(0.003), 0.008, 0.0025).si(S.keep_side((0, 0, 0.06), (0, 0, 1)), 0.01).si(S.keep_side((0, 0.016, 0), (0, 1, 0)), 0.004)
    parts.append(Part("legs", SET, "toe", toe, "primary", bone="ankle_l", voxel=0.0019, tris=(500, 180, 60), mirror=True))
    return parts


def class_item(rig):
    parts = []
    # long cloak: a curved sheet from the shoulders down to the back of the knees
    def cloak_fn(p):
        y = p[:, 1]
        t = np.clip((1.47 - y) / 0.9, 0.0, 1.0)
        half_w = 0.2 + 0.1 * t
        # the sheet bends round the back, a little further out lower down
        radius = 0.2 + 0.1 * t
        cz = -0.03 + 0.02 * t
        ang = np.arctan2(p[:, 0], -(p[:, 2] - cz))
        r = np.sqrt(p[:, 0] ** 2 + (p[:, 2] - cz) ** 2)
        folds = 0.006 * np.sin(ang * 7.0 + t * 2.0) * t
        d_r = np.abs(r - radius - folds) - 0.0045
        d_ang = (np.abs(ang) * radius - half_w)
        d_y = np.maximum(y - 1.47, (1.47 - 0.9) - y)
        return np.maximum(np.maximum(d_r, d_ang), d_y)

    cloak = S.Fn(cloak_fn, (-0.34, 0.54, -0.36), (0.34, 1.5, 0.12)).si(S.keep_side((0, 0, 0.02), (0, 0, -1)), 0.01)
    weights = lambda co: chain_weights(rig, co, ["cape_0", "cape_1", "cape_2", "cape_3"], "spine_3")  # noqa: E731
    parts.append(Part("classItem", SET, "cloak", cloak, "cloth", weights=weights, voxel=0.0026, tris=(2400, 800, 260), symmetric=True))
    hood = S.Torus((0, 1.46, -0.1), (0, 0.85, 0.52), 0.1, 0.036).si(S.keep_side((0, 0, -0.05), (0, 0, -1)), 0.015)
    hood = S.Displace(hood, lambda p: np.sin(p[:, 0] * 90.0), 0.003)
    parts.append(Part("classItem", SET, "hood", hood, "cloth", bone="spine_3", voxel=0.0022, tris=(1200, 420, 130), symmetric=True))
    hem = S.Fn(lambda p: np.maximum(cloak_fn(p) - 0.0015, np.abs(p[:, 1] - 0.6) - 0.012), (-0.34, 0.54, -0.36), (0.34, 0.66, 0.12))
    parts.append(Part("classItem", SET, "hem", hem, "trim", weights=weights, voxel=0.0018, tris=(700, 250, 80), lods=(0, 1), symmetric=True))
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
