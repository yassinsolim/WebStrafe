"""the four armor sets, modelled on the mpfb body with the plate kit
(armorkit.py): outline patches projected onto smoothed shells around the
body, thickened and bevelled, layered in two or three depths. strafe is the
research prototype's "vanguard" design; anvil, vector and quill reuse the same
building blocks with their own shape language.

everything here works in blender space on the conformed body (z up, the
character faces -y). pieces are rigid (or blended across two bones) and come
back as (object, bone spec, material slot, slot, set).
"""

import math
import re

import bmesh
import bpy
from mathutils import Vector as V

import armorkit as ak

UP, FWD, BACK = V((0, 0, 1)), V((0, -1, 0)), V((0, 1, 0))
SMALL = dict(n=32, rings=3)
MED = dict(n=44, rings=4)
BIG = dict(n=56, rings=5)

# prototype zones -> game material slots (armorMaterial.ts)
ZONE = {"primary": "primary", "secondary": "secondary", "paint": "accent", "light": "light",
        "trim": "metal", "visor": "visor", "rubber": "dark", "cloth": "cloth"}


class Kit:
    def __init__(self, body, points):
        self.body = body
        self.P = points
        self.tree, _ = ak.bvh_of(body)
        self.pieces = []
        self.anchors = []
        self.set = None
        self._forms = {}
        h = self.head
        self.z_neck, self.z_clav = h("neck_01").z, h("clavicle_l").z
        self.z_s3, self.z_s2, self.z_s1 = h("spine_03").z, h("spine_02").z, h("spine_01").z
        self.z_pel = h("pelvis").z
        self.yc = 0.012
        self.torso_a = V((0, self.yc, self.z_pel - 0.10))
        self.torso_b = V((0, self.yc, self.z_neck + 0.02))
        self.TORSO = ak.Cylinder(self.torso_a, self.torso_b, FWD, r0=0.14)
        self.BACKC = ak.Cylinder(self.torso_a, self.torso_b, BACK, r0=0.14)
        self.ua = (h("upperarm_l"), h("lowerarm_l"))
        self.fa = (h("lowerarm_l"), h("hand_l"))
        self.th = (h("thigh_l"), h("calf_l"))
        self.sh = (h("calf_l"), h("foot_l"))
        self.L_ua = (self.ua[1] - self.ua[0]).length
        self.L_fa = (self.fa[1] - self.fa[0]).length
        self.L_th = (self.th[1] - self.th[0]).length
        self.L_sh = (self.sh[1] - self.sh[0]).length
        self.UA = ak.Cylinder(*self.ua, UP, r0=0.055)
        self.FA = ak.Cylinder(*self.fa, UP, r0=0.045)
        self.TH = ak.Cylinder(*self.th, FWD, r0=0.075)
        self.SH = ak.Cylinder(*self.sh, FWD, r0=0.055)
        self.THB = ak.Cylinder(*self.th, BACK, r0=0.075)
        self.SHB = ak.Cylinder(*self.sh, BACK, r0=0.055)

    def head(self, n):
        return self.P[n][0].copy()

    def tail(self, n):
        return self.P[n][1].copy()

    def hz(self, z):
        return z - self.torso_a.z

    def form(self, key, fn):
        if key not in self._forms:
            self._forms[key] = fn()
        return self._forms[key]

    def torso(self, off):
        return self.form(("torso", round(off, 4)), lambda: ak.mandrel(
            f"form_torso_{off:.3f}", self.tree, self.torso_a, self.torso_b, FWD, rings=30, seg=64, offset=off)[1])

    def limb(self, name, a, b, ref, off, t0, t1, rings=12):
        return self.form((name, round(off, 4), t0, t1), lambda: ak.mandrel(
            f"form_{name}_{off:.3f}", self.tree, a, b, ref, t0=t0, t1=t1, rings=rings, seg=40, offset=off)[1])

    def add(self, ob, bone, zone, slot):
        ob.name = f"{self.set}.{slot}.{ob.name}"
        self.pieces.append((ob, bone, ZONE[zone], slot, self.set))
        return ob

    def rect(self, s0, s1, h0, h1):
        return [(s0, h1), (s1, h1), (s1, h0), (s0, h0)]


def band(name, tree, a, b, t, height, *, thickness=0.004, gap=0.0, seg=40):
    """closed strap around the limb axis a->b at fraction t, hugging the form `tree`"""
    ax = (b - a).normalized()
    ref = V((0, 0, 1)) if abs(ax.z) < 0.9 else V((0, -1, 0))
    e1 = (ref - ax * ref.dot(ax)).normalized()
    e2 = ax.cross(e1).normalized()
    secs = []
    for dh in (-height / 2, height / 2):
        c = a + (b - a) * t + ax * dh
        loop = []
        for i in range(seg):
            g = 2 * math.pi * i / seg
            d = e1 * math.cos(g) + e2 * math.sin(g)
            hit = tree.ray_cast(c + d * 0.4, -d, 0.5)
            r = (hit[0] - c).length if hit[0] is not None else 0.06
            loop.append(c + d * (r + gap))
        secs.append(loop)
    ob = ak.loft(name, secs, cap_top=False)
    m = ob.modifiers.new("t", "SOLIDIFY"); m.thickness = thickness; m.offset = 1
    bv = ob.modifiers.new("b", "BEVEL"); bv.width = thickness * 0.35; bv.segments = 1; bv.limit_method = "ANGLE"
    ak.apply_modifiers(ob); ak.shade(ob, 40)
    return ob


# ---------------------------------------------------------------------- chest

def chest(k, st):
    t = st["thick"]
    hz, zc, z3, z2, z1, zp = k.hz, k.z_clav, k.z_s3, k.z_s2, k.z_s1, k.z_pel
    T1, T2, T3 = k.torso(0.013 * st["bulk"]), k.torso(0.026 * st["bulk"]), k.torso(0.038 * st["bulk"])
    w = st["chest_w"]
    chest_half = [
        (0.0, hz(zc - 0.045)), (0.055, hz(zc - 0.018)), (0.125 * w, hz(zc - 0.002)),
        (0.205 * w, hz(zc - 0.040)), (0.218 * w, hz(zc - 0.150)), (0.180 * w, hz(z3 + 0.010)),
        (0.070, hz(z3 - 0.012)), (0.0, hz(z3 + 0.008)),
    ]
    base = k.add(ak.plate("chest_base", T1, k.TORSO, ak.mirror_x(chest_half), **BIG, thickness=0.013 * t,
                          bevel=0.004, fillet_r=0.022), "spine_03", "secondary", "chest")
    style = st["chest"]
    if style == "chevron":
        pec = [(0.012, hz(zc - 0.050)), (0.070, hz(zc - 0.030)), (0.150, hz(zc - 0.022)), (0.196, hz(zc - 0.060)),
               (0.150, hz(z3 + 0.030)), (0.020, hz(z3 + 0.070))]
        fil = [0.02, 0.02, 0.02, 0.03, 0.02, 0.008]
    else:
        pec = [(0.014, hz(zc - 0.058)), (0.060, hz(zc - 0.034)), (0.130 * w, hz(zc - 0.020)),
               (0.195 * w, hz(zc - 0.052)), (0.190 * w, hz(zc - 0.140)), (0.145 * w, hz(z3 + 0.040)),
               (0.014, hz(z3 + 0.034))]
        fil = [0.03, 0.02, 0.02, 0.03, 0.02, 0.035, 0.01]
    pec_l = k.add(ak.plate("pec_l", T2, k.TORSO, pec, **BIG, thickness=0.012 * t, bevel=0.0038, fillet_r=fil),
                  "spine_03", "primary", "chest")
    if style != "vest":
        k.add(ak.strip("light_l", k.torso(0.026 * st["bulk"] + 0.012 * t + 0.0015), k.TORSO,
                       [(0.035, hz(z3 + 0.058)), (0.118, hz(z3 + 0.062))], 0.008, thickness=0.003, n=32),
              "spine_03", "light", "chest")
        rib = [(0.205 * w, hz(zc - 0.16)), (0.295 * w, hz(zc - 0.14)), (0.285 * w, hz(z3 - 0.01)), (0.195 * w, hz(z3 + 0.02))]
        k.add(ak.plate("rib_l", T2, k.TORSO, rib, **MED, thickness=0.010 * t, bevel=0.0032, fillet_r=0.018),
              "spine_03", "secondary", "chest")
    if style == "heavy":
        # sternum keel and a second rib layer
        keel = [(-0.030, hz(zc - 0.040)), (0.030, hz(zc - 0.040)), (0.040, hz(z3 + 0.020)), (0.0, hz(z3 - 0.010)),
                (-0.040, hz(z3 + 0.020))]
        k.add(ak.plate("keel", k.torso(0.052), k.TORSO, keel, **MED, thickness=0.012, bevel=0.004,
                       fillet_r=[0.01, 0.01, 0.02, 0.01, 0.02]), "spine_03", "secondary", "chest")
        rib2 = [(0.215, hz(zc - 0.19)), (0.300, hz(zc - 0.17)), (0.290, hz(z3 - 0.04)), (0.205, hz(z3 - 0.02))]
        k.add(ak.plate("rib2_l", T3, k.TORSO, rib2, **MED, thickness=0.010, bevel=0.0032, fillet_r=0.018),
              "spine_03", "primary", "chest")
    if style == "chevron":
        # reactor core on the sternum
        core_c = V((0, 0, zc - 0.115))
        hit = k.tree.ray_cast(core_c + FWD * 0.6, BACK, 1.0)
        y = (hit[0].y if hit[0] else -0.12) - 0.036 * k_bulk(st)
        c = V((0, y, zc - 0.115))
        k.add(ak.cylinder("core_ring", 0.032, 0.014, c, verts=32, bevel=0.003, rot=(math.radians(90), 0, 0)),
              "spine_03", "trim", "chest")
        k.add(ak.cylinder("core_glow", 0.022, 0.016, c + FWD * 0.002, verts=32, bevel=0.002,
                          rot=(math.radians(90), 0, 0)), "spine_03", "light", "chest")
        for j, e in enumerate((0.0, 0.03)):
            k.add(ak.strip(f"seam_{j}_l", k.torso(0.026 * st["bulk"] + 0.012 * t + 0.0015), k.TORSO, [(0.06, hz(z3 + 0.02 - e)), (0.17, hz(z3 + 0.06 - e))], 0.006,
                           thickness=0.003, n=28), "spine_03", "light", "chest")
    if style == "vest":
        # cross straps and a utility plate instead of ribs
        for side, sgn in (("l", 1), ("r", -1)):
            k.add(ak.strip(f"strap_{side}", k.torso(0.026 * st["bulk"] + 0.012 * t + 0.002), k.TORSO,
                           [(sgn * 0.12, hz(zc - 0.02)), (-sgn * 0.09, hz(z2 + 0.01))], 0.026, thickness=0.004, n=48),
                  "spine_03", "cloth", "chest")
        k.add(ak.plate("pouch_plate", T3, k.TORSO, k.rect(-0.07, 0.07, hz(z2 - 0.02), hz(z2 + 0.05)), **SMALL,
                       thickness=0.014, bevel=0.004, fillet_r=0.012), "spine_02", "secondary", "chest")
    # abdomen bands
    n_bands = st["abs"]
    top, bot = z3 - 0.004, z1 - 0.012
    step = (top - bot) / n_bands
    for i in range(n_bands):
        z0, z1b = top - i * step, top - (i + 1) * step + 0.008
        bw = (0.160 - 0.006 * i) * w
        band = [(-bw, hz(z0)), (-0.02, hz(z0) + 0.004), (0.02, hz(z0) + 0.004), (bw, hz(z0)),
                (bw * 0.95, hz(z1b)), (0.0, hz(z1b) - 0.006), (-bw * 0.95, hz(z1b))]
        bone = "spine_02" if z0 > z2 else "spine_01"
        k.add(ak.plate(f"abs_{i}", T2, k.TORSO, band, **BIG, thickness=0.010 * t, bevel=0.0032, fillet_r=0.014),
              bone, "secondary" if i % 2 else "primary", "chest")
    back_half = [(0.0, hz(zc + 0.005)), (0.07, hz(zc + 0.012)), (0.19 * w, hz(zc - 0.02)),
                 (0.215 * w, hz(zc - 0.15)), (0.17 * w, hz(z2)), (0.0, hz(z2 - 0.02))]
    k.add(ak.plate("back_base", T1, k.BACKC, ak.mirror_x(back_half), **BIG, thickness=0.013 * t, bevel=0.004,
                   fillet_r=0.02), "spine_03", "secondary", "chest")
    lumbar = [(-0.13, hz(z2 - 0.03)), (0.13, hz(z2 - 0.03)), (0.12, hz(zp + 0.05)), (0.0, hz(zp + 0.042)),
              (-0.12, hz(zp + 0.05))]
    k.add(ak.plate("lumbar", T2, k.BACKC, lumbar, **BIG, thickness=0.011 * t, bevel=0.0035,
                   fillet_r=[0.02, 0.02, 0.02, 0.01, 0.02]), "spine_01", "primary", "chest")
    if style != "vest":
        blade = [(0.02, hz(zc - 0.01)), (0.17 * w, hz(zc - 0.03)), (0.18 * w, hz(zc - 0.14)), (0.02, hz(zc - 0.18))]
        k.add(ak.plate("blade_l", T2, k.BACKC, blade, **MED, thickness=0.011 * t, bevel=0.0035, fillet_r=0.02),
              "spine_03", "primary", "chest")
    collar(k, st)
    # emblem on the left pec, callsign on the right (three.js space anchors)
    tree_l, _ = ak.bvh_of(pec_l)
    for kind, x in (("emblem", 0.092), ("tag", -0.092)):
        o = V((abs(x), -0.8, zc - 0.085))
        hit = tree_l.ray_cast(o, BACK, 2.0)
        if hit[0] is None:
            continue
        p, n = hit[0], hit[1]
        if x < 0:
            p, n = V((-p.x, p.y, p.z)), V((-n.x, n.y, n.z))
        k.anchors.append((k.set, kind, "spine_3", (p + n * 0.0015), n, 0.056 if kind == "emblem" else 0.068))
    return base


def k_bulk(st):
    return st["bulk"]


def collar(k, st):
    neck_c = V((0, k.head("neck_01").y + 0.01, k.z_neck - 0.01))
    hgt = st["collar"]
    secs = []
    for dz, a, bf, bb, ex in ((-0.080, 0.160, 0.130, 0.130, 3.2), (-0.042, 0.110, 0.098, 0.108, 3.0),
                              (-0.006, 0.086, 0.080, 0.094, 2.8), (0.030 * hgt, 0.080, 0.074, 0.092, 2.6)):
        secs.append(ak.superellipse(0, neck_c.y + 0.004, a, a, bb, bf, ex, 40, neck_c.z + dz))
    for sec in secs[2:]:
        for v in sec:
            if v.y < neck_c.y:
                v.z -= (neck_c.y - v.y) * 0.45
    col = ak.loft("collar", secs, cap_top=False)
    s = col.modifiers.new("t", "SOLIDIFY"); s.thickness = 0.008; s.offset = 1
    b = col.modifiers.new("b", "BEVEL"); b.width = 0.0025; b.segments = 2; b.limit_method = "ANGLE"
    sd = col.modifiers.new("sub", "SUBSURF"); sd.levels = 1; sd.render_levels = 1
    ak.apply_modifiers(col); ak.shade(col, 40)
    k.add(col, "spine_03", "secondary", "chest")


# ---------------------------------------------------------------------- arms

def arms(k, st):
    t = st["thick"]
    ua_a, ua_b = k.ua
    fa_a, fa_b = k.fa
    L_ua, L_fa = k.L_ua, k.L_fa
    arm_dir = (ua_b - ua_a).normalized()
    ps = st["paul"]
    if ps > 0:
        cap_axis = (arm_dir * 0.55 + UP).normalized()
        paul_c = ua_a + arm_dir * 0.045 + V((0.010, 0.0, -0.022))
        rot = (0, math.radians(-34), 0)
        forms = [ak.ellipsoid(f"form_{k.set}_paul{i}_l", paul_c, tuple(r * ps for r in rr), rot=rot)[1]
                 for i, rr in enumerate(((0.132, 0.143, 0.125), (0.147, 0.158, 0.140), (0.162, 0.173, 0.155),
                                         (0.176, 0.187, 0.169)))]
        PAUL = ak.Sphere(paul_c, cap_axis, FWD, r0=0.12 * ps)
        sc = ps
        layers = st["paul_layers"]
        outlines = [
            ("paul_under_l", [(0.030, -0.170), (0.165, -0.150), (0.185, 0.0), (0.165, 0.150), (0.030, 0.170)],
             "upperarm_l:0.8,clavicle_l:0.2", "secondary"),
            ("paul_mid_l", [(-0.030, -0.165), (0.125, -0.145), (0.145, 0.0), (0.125, 0.145), (-0.030, 0.165)],
             "upperarm_l:0.72,clavicle_l:0.28", "primary"),
            ("paul_top_l", [(-0.110, -0.140), (0.075, -0.125), (0.092, 0.0), (0.075, 0.125), (-0.110, 0.140), (-0.130, 0.0)],
             "upperarm_l:0.65,clavicle_l:0.35", "secondary"),
            ("paul_ridge_l", [(-0.120, -0.040), (0.050, -0.034), (0.060, 0.034), (-0.120, 0.040)],
             "upperarm_l:0.65,clavicle_l:0.35", "paint"),
        ]
        chosen = outlines[3 - layers:3] if layers <= 3 else outlines
        if layers == 1:
            chosen = [outlines[1]]
        for i, (name, ol, bone, zone) in enumerate(chosen):
            depth = outlines.index((name, ol, bone, zone))
            ol = [(u * sc, v * sc) for u, v in ol]
            fil = [0.02, 0.05, 0.07, 0.05, 0.02, 0.05][:len(ol)]
            k.add(ak.plate(name, forms[depth], PAUL, ol, **BIG, thickness=(0.011 + 0.001 * (depth == 2)) * t,
                           bevel=0.0035, inner=True, fillet_r=fil if len(ol) > 4 else 0.012), bone, zone, "arms")
        if st["lights"]:
            k.add(ak.strip("paul_light_l", forms[3], PAUL, [(0.020 * sc, -0.105 * sc), (0.020 * sc, 0.105 * sc)],
                           0.007, thickness=0.003, n=36), "upperarm_l:0.65,clavicle_l:0.35", "light", "arms")
        if st.get("fins"):
            # quill: two swept fins rising off the left pauldron only (no side suffix, not mirrored)
            for j, (dx, h) in enumerate(((0.0, 0.085), (0.034, 0.062))):
                base = paul_c + V((0.04 + dx, 0.03, 0.10 * ps))
                k.add(ak.box(f"paul_fin_{j}", (0.010, 0.085, h), base + V((0, 0.02, h * 0.45)), bevel=0.003,
                             rot=(math.radians(-28), 0, math.radians(-8)), taper=(0.6, 0.35)),
                      "upperarm_l:0.65,clavicle_l:0.35", "primary", "arms")
    if st["bicep"]:
        T_UA = k.limb("upperarm", ua_a, ua_b, UP, 0.011, 0.20, 1.0)
        k.add(ak.plate("bicep_l", T_UA, k.UA, k.rect(-0.06, 0.06, 0.52 * L_ua, 0.88 * L_ua), **MED,
                       thickness=0.009 * t, bevel=0.003, fillet_r=0.014), "upperarm_l", "secondary", "arms")
    elb_c = fa_a + V((0.006, 0.012, 0.006))
    es = st["elbow"]
    _, T_E = ak.ellipsoid(f"form_{k.set}_elbow_l", elb_c, (0.050 * es, 0.050 * es, 0.048 * es))
    ELB = ak.Sphere(elb_c, V((0.30, 0.90, 0.30)).normalized(), UP, r0=0.05 * es)
    k.add(ak.plate("elbow_l", T_E, ELB, [(-0.045 * es, -0.042 * es), (0.045 * es, -0.042 * es), (0.052 * es, 0.036 * es),
                                         (-0.052 * es, 0.036 * es)], **SMALL, thickness=0.009 * t, bevel=0.003,
                   fillet_r=0.025 * es), "lowerarm_l:0.55,upperarm_l:0.45", "trim", "arms")
    T_FA = k.limb("forearm", fa_a, fa_b, UP, 0.013, 0.05, 0.98)
    T_FA2 = k.limb("forearm", fa_a, fa_b, UP, 0.024, 0.05, 0.98)
    vw = st["vam_w"]
    k.add(ak.plate("vambrace_l", T_FA, k.FA, [(-0.085 * vw, 0.08 * L_fa), (0.085 * vw, 0.08 * L_fa),
                                              (0.076 * vw, 0.92 * L_fa), (-0.076 * vw, 0.92 * L_fa)],
                   **BIG, thickness=0.011 * t, bevel=0.0035, fillet_r=[0.02, 0.02, 0.014, 0.014]),
          "lowerarm_l", "primary", "arms")
    if st["wraps"]:
        # cloth wraps below the vambrace edge
        wrap_form = k.limb("forearm", fa_a, fa_b, UP, 0.0035, 0.0, 1.0)
        for j in range(3):
            k.add(band(f"wrap_{j}_l", wrap_form, fa_a, fa_b, 0.10 + 0.07 * j, 0.022, thickness=0.004),
                  "lowerarm_l", "cloth", "arms")
    else:
        k.add(ak.plate("vambrace_top_l", T_FA2, k.FA, [(-0.036, 0.26 * L_fa), (0.036, 0.26 * L_fa),
                                                       (0.032, 0.72 * L_fa), (-0.032, 0.72 * L_fa)],
                       **MED, thickness=0.008 * t, bevel=0.003, fillet_r=0.01), "lowerarm_l", "secondary", "arms")
    T_FA3 = k.limb("forearm", fa_a, fa_b, UP, 0.013 + 0.011 * t + 0.0015, 0.05, 0.98)
    if st["lights"]:
        if st.get("seams"):
            k.add(ak.strip("vam_seam_l", T_FA3, k.FA, [(0.05, 0.15 * L_fa), (0.05, 0.85 * L_fa)], 0.005,
                           thickness=0.005, n=40), "lowerarm_l", "light", "arms")
        k.add(ak.strip("vam_light_l", T_FA3, k.FA, [(-0.036, 0.79 * L_fa), (0.036, 0.79 * L_fa)], 0.006,
                       thickness=0.003, n=32), "lowerarm_l", "light", "arms")
    T_W = k.limb("wrist", fa_a, fa_b, UP, 0.009, 0.84, 1.02, rings=6)
    k.add(ak.plate("cuff_l", T_W, k.FA, [(-0.110, 0.86 * L_fa), (0.110, 0.86 * L_fa), (0.110, 0.97 * L_fa),
                                         (-0.110, 0.97 * L_fa)], **MED, thickness=0.012 * t, bevel=0.003,
                   fillet_r=0.008), "lowerarm_l", "secondary", "arms")
    hand_a, hand_b = k.head("hand_l"), k.head("middle_01_l")
    HAND_T = k.form(("hand", 0.006), lambda: ak.mandrel("form_hand_l", k.tree, hand_a, hand_b + (hand_b - hand_a) * 0.15,
                                                        UP, t0=0.05, t1=1.0, rings=6, seg=32, offset=0.006)[1])
    HANDC = ak.Cylinder(hand_a, hand_b, UP, r0=0.035)
    L_h = (hand_b - hand_a).length
    k.add(ak.plate("hand_plate_l", HAND_T, HANDC, [(-0.030, 0.15 * L_h), (0.030, 0.15 * L_h), (0.036, 1.05 * L_h),
                                                    (-0.036, 1.05 * L_h)], **SMALL, thickness=0.006 * t, bevel=0.002,
                   fillet_r=0.01), "hand_l", "secondary", "arms")


# ---------------------------------------------------------------------- legs

def legs(k, st):
    t = st["thick"]
    th_a, th_b = k.th
    sh_a, sh_b = k.sh
    L_th, L_sh = k.L_th, k.L_sh
    T_TH = k.limb("thigh", th_a, th_b, FWD, 0.013, 0.08, 1.0, rings=14)
    T_TH2 = k.limb("thigh", th_a, th_b, FWD, 0.028, -0.16, 1.0, rings=16)
    T_TH3 = k.limb("thigh", th_a, th_b, FWD, 0.026, 0.08, 1.0, rings=14)
    T_SH = k.limb("shin", sh_a, sh_b, FWD, 0.014, 0.02, 0.97, rings=14)
    tw = st["thigh_w"]
    style = st["legs"]
    if style == "straps":
        strap_form = k.limb("thigh", th_a, th_b, FWD, 0.004, 0.0, 1.0, rings=14)
        for j, tt in enumerate((0.26, 0.70)):
            k.add(band(f"thigh_strap_{j}_l", strap_form, th_a, th_b, tt, 0.030, thickness=0.005),
                  "thigh_l", "cloth", "legs")
        k.add(ak.plate("thigh_plate_l", T_TH3, k.TH, [(-0.080, 0.36 * L_th), (0.030, 0.36 * L_th), (0.026, 0.62 * L_th),
                                                      (-0.070, 0.64 * L_th)], **MED, thickness=0.008, bevel=0.003,
                       fillet_r=0.014), "thigh_l", "primary", "legs")
    else:
        k.add(ak.plate("thigh_plate_l", T_TH, k.TH, [(-0.110 * tw, 0.16 * L_th), (0.052 * tw, 0.16 * L_th),
                                                     (0.046 * tw, 0.80 * L_th), (-0.092 * tw, 0.82 * L_th)],
                       **BIG, thickness=0.012 * t, bevel=0.0038, fillet_r=[0.03, 0.02, 0.025, 0.03]),
              "thigh_l", "primary", "legs")
        k.add(ak.plate("thigh_inlay_l", T_TH3, k.TH, [(-0.064, 0.30 * L_th), (0.016, 0.30 * L_th), (0.012, 0.66 * L_th),
                                                      (-0.055, 0.66 * L_th)], **MED, thickness=0.007, bevel=0.0025,
                       fillet_r=0.012), "thigh_l", "secondary" if style != "coat" else "paint", "legs")
    tl = st["tasset"]
    if tl > 0:
        k.add(ak.plate("tasset_l", T_TH2, k.TH, [(-0.150, -0.10 * L_th), (-0.035, -0.10 * L_th), (-0.045, tl * L_th),
                                                 (-0.140, (tl + 0.04) * L_th)], **MED, thickness=0.011 * t,
                       bevel=0.0035, inner=True, fillet_r=[0.012, 0.012, 0.03, 0.02]), "thigh_l", "secondary", "legs")
        k.add(ak.plate("rear_tasset_l", T_TH2, k.THB, [(-0.090, -0.08 * L_th), (0.010, -0.08 * L_th),
                                                       (0.000, (tl - 0.04) * L_th), (-0.085, (tl - 0.01) * L_th)],
                       **MED, thickness=0.010 * t, bevel=0.0032, inner=True, fillet_r=[0.01, 0.01, 0.03, 0.02]),
              "thigh_l", "primary", "legs")
    if style == "coat":
        # long coat tails front and back, split at the side
        for name, proj, s0, s1, zone in (("coat_front_l", k.TH, -0.02, 0.10, "primary"),
                                         ("coat_back_l", k.THB, -0.10, 0.06, "secondary")):
            k.add(ak.plate(name, k.limb("thigh", th_a, th_b, FWD, 0.040, -0.2, 1.0, rings=16), proj,
                           [(s0 - 0.12, -0.12 * L_th), (s1, -0.12 * L_th), (s1 - 0.01, 0.78 * L_th), (s0 - 0.10, 0.84 * L_th)],
                           **BIG, thickness=0.006, bevel=0.002, inner=True, fillet_r=[0.01, 0.01, 0.04, 0.03]),
                  "thigh_l", zone, "legs")
    ks = st["knee"]
    knee_c = sh_a + V((0.002, -0.048, 0.012))
    _, T_K = ak.ellipsoid(f"form_{k.set}_knee_l", knee_c, (0.064 * ks, 0.052 * ks, 0.072 * ks))
    KNEE = ak.Sphere(knee_c, FWD, UP, r0=0.056 * ks)
    k.add(ak.plate("knee_l", T_K, KNEE, [(-0.052 * ks, -0.042 * ks), (0.052 * ks, -0.042 * ks), (0.060 * ks, 0.030 * ks),
                                         (0.0, 0.070 * ks), (-0.060 * ks, 0.030 * ks)], **MED, thickness=0.011 * t,
                   bevel=0.0035, fillet_r=[0.02, 0.02, 0.02, 0.01, 0.02]), "calf_l:0.6,thigh_l:0.4", "secondary", "legs")
    gw = st["greave_w"]
    k.add(ak.plate("greave_l", T_SH, k.SH, [(-0.085 * gw, 0.10 * L_sh), (0.062 * gw, 0.10 * L_sh), (0.052 * gw, 0.70 * L_sh),
                                            (-0.075 * gw, 0.72 * L_sh)], **BIG, thickness=0.012 * t, bevel=0.0038,
                   fillet_r=[0.025, 0.025, 0.02, 0.02]), "calf_l", "primary", "legs")
    if st["lights"]:
        T_SH2 = k.limb("shin", sh_a, sh_b, FWD, 0.014 + 0.012 * t + 0.0015, 0.02, 0.97, rings=14)
        k.add(ak.strip("greave_light_l", T_SH2, k.SH, [(-0.012, 0.20 * L_sh), (-0.012, 0.52 * L_sh)], 0.007,
                       thickness=0.003, n=32), "calf_l", "light", "legs")
    if style != "straps":
        k.add(ak.plate("hamstring_l", T_TH, k.THB, [(-0.075, 0.30 * L_th), (0.070, 0.30 * L_th), (0.060, 0.78 * L_th),
                                                    (-0.065, 0.80 * L_th)], **MED, thickness=0.010 * t, bevel=0.0032,
                       fillet_r=0.02), "thigh_l", "secondary", "legs")
    k.add(ak.plate("calf_plate_l", T_SH, k.SHB, [(-0.065, 0.14 * L_sh), (0.065, 0.14 * L_sh), (0.050, 0.62 * L_sh),
                                                 (-0.050, 0.62 * L_sh)], **MED, thickness=0.010 * t, bevel=0.0032,
                   fillet_r=0.02), "calf_l", "secondary", "legs")
    boots(k, st)
    belt(k, st)


def boots(k, st):
    sh_a, sh_b = k.sh
    L_sh = k.L_sh
    foot_h, toe = k.head("foot_l"), k.tail("ball_l")
    boot_a = V((foot_h.x, foot_h.y + 0.085, 0.060))
    boot_b = V((toe.x, toe.y - 0.015, 0.030))
    bo = st["boot"]
    boot, T_BOOT = ak.mandrel(f"boot_l", k.tree, boot_a, boot_b, UP, t0=0.0, t1=1.0, rings=12, seg=32,
                              offset=0.016 * bo, min_r=0.035, max_r=0.075 * bo, coll="armor")
    boot.hide_render = False
    bm = bmesh.new(); bm.from_mesh(boot.data)
    for v in bm.verts:
        v.co.z = max(v.co.z, 0.022)
    bmesh.ops.holes_fill(bm, edges=bm.edges, sides=0)
    bm.to_mesh(boot.data); bm.free()
    boot.data.update()
    sd = boot.modifiers.new("sub", "SUBSURF"); sd.levels = 1; sd.render_levels = 1
    ak.apply_modifiers(boot); ak.shade(boot, 50)
    k.add(boot, "foot_l", "secondary", "legs")
    BOOTC = ak.Cylinder(boot_a, boot_b, UP, r0=0.05)
    L_b = (boot_b - boot_a).length
    k.add(ak.plate("toecap_l", T_BOOT, BOOTC, [(-0.075, 0.66 * L_b), (0.075, 0.66 * L_b), (0.060, 0.97 * L_b),
                                               (-0.060, 0.97 * L_b)], **MED, thickness=0.009, bevel=0.003,
                   fillet_r=[0.02, 0.02, 0.03, 0.03]), "ball_l", "primary", "legs")
    k.add(ak.plate("instep_l", T_BOOT, BOOTC, [(-0.060, 0.30 * L_b), (0.060, 0.30 * L_b), (0.055, 0.62 * L_b),
                                               (-0.055, 0.62 * L_b)], **SMALL, thickness=0.008, bevel=0.003,
                   fillet_r=0.015), "foot_l", "trim", "legs")
    sole_len = (boot_a - boot_b).length + 0.03
    k.add(ak.box("sole_l", (0.118 * min(bo, 1.1), sole_len, 0.024 * bo), V(((boot_a.x + boot_b.x) / 2,
                                                                            (boot_a.y + boot_b.y) / 2, 0.012 * bo)),
                 bevel=0.006, segments=2), "foot_l", "rubber", "legs")
    T_AN = k.form(("ankle", bo), lambda: ak.mandrel("form_ankle_l", k.tree, sh_a, sh_b + V((0, 0, -0.02)), FWD, t0=0.68,
                                                     t1=1.0, rings=6, seg=40, offset=0.022 * bo, max_r=0.09)[1])
    k.add(ak.plate("boot_cuff_l", T_AN, k.SH, [(-0.19, 0.72 * L_sh), (0.19, 0.72 * L_sh), (0.19, 0.97 * L_sh),
                                               (-0.19, 0.97 * L_sh)], **BIG, thickness=0.010, bevel=0.003,
                   fillet_r=0.01), "calf_l", "primary", "legs")


def belt(k, st):
    T1 = k.torso(0.013 * st["bulk"])
    zp, yc = k.z_pel, k.yc
    bh = st["belt"]
    secs = []
    for dz in (-0.032 * bh, -0.006, 0.020, 0.040 * bh):
        z = zp + dz
        loop = []
        for i in range(56):
            g = 2 * math.pi * i / 56
            d = V((math.sin(g), -math.cos(g), 0))
            o = V((0, yc, z))
            hit = T1.ray_cast(o + d * 0.6, -d, 1.0)
            r = (hit[0] - o).length if hit[0] else 0.16
            loop.append(o + d * (r + 0.004))
        secs.append(loop)
    b = ak.loft("belt", secs, cap_top=False)
    s = b.modifiers.new("t", "SOLIDIFY"); s.thickness = 0.011; s.offset = 1
    bv = b.modifiers.new("b", "BEVEL"); bv.width = 0.003; bv.segments = 2; bv.limit_method = "ANGLE"
    ak.apply_modifiers(b); ak.shade(b, 40)
    k.add(b, "pelvis", "trim" if st["legs"] != "straps" else "cloth", "legs")
    front_y = min(v[1] for v in secs[1]) - 0.006
    k.add(ak.box("buckle", (0.080 * bh, 0.018, 0.052 * bh), V((0, front_y - 0.004, zp + 0.004)), bevel=0.005,
                 segments=2), "pelvis", "paint", "legs")
    for j, ang in enumerate(st["pouches"]):
        g = math.radians(ang)
        d = V((math.sin(g), -math.cos(g), 0))
        o = V((0, yc, zp))
        hit = T1.ray_cast(o + d * 0.6, -d, 1.0)
        r = (hit[0] - o).length if hit[0] else 0.16
        k.add(ak.box(f"pouch_{j}_l", (0.054, 0.040, 0.064), o + d * (r + 0.030) + V((0, 0, -0.012)), bevel=0.006,
                     segments=2, rot=(0, 0, g)), "pelvis", "secondary" if j == 0 else "primary", "legs")


# ---------------------------------------------------------------------- helmet

def helmet(k, st):
    bm = bmesh.new()
    bm.from_mesh(k.body.data)
    hv = [v.co.copy() for v in bm.verts if v.co.z > k.z_neck + 0.07]
    bm.free()
    hy0, hy1 = min(v.y for v in hv), max(v.y for v in hv)
    hz0, hz1 = min(v.z for v in hv), max(v.z for v in hv)
    hc = V((0, (hy0 + hy1) / 2 + 0.004, (hz0 + hz1) / 2 + 0.012))
    wide, ex_mul, jaw_push = st["helm_w"], st["helm_ex"], st["jaw"]
    prof = [(-0.150, 0.080, 0.084, 0.090, 3.0), (-0.122, 0.106, 0.128, 0.110, 3.6), (-0.084, 0.119, 0.143, 0.124, 3.9),
            (-0.040, 0.125, 0.147, 0.130, 3.9), (0.000, 0.127, 0.146, 0.132, 3.7), (0.042, 0.123, 0.138, 0.130, 3.3),
            (0.078, 0.112, 0.122, 0.121, 2.9), (0.107, 0.093, 0.100, 0.101, 2.5), (0.130, 0.062, 0.066, 0.068, 2.2),
            (0.142, 0.020, 0.022, 0.024, 2.0)]
    hsecs = [ak.superellipse(0, hc.y, a * wide, a * wide, bb * wide, bf, max(2.0, ex * ex_mul), 36, hc.z + dz,
                             rot=-math.pi / 2) for dz, a, bf, bb, ex in prof]
    for sec, (dz, *_r) in zip(hsecs, prof):
        for v in sec:
            if v.y < hc.y and dz < -0.02:
                v.y -= 0.016 * jaw_push * (-(dz + 0.02) / 0.12)
            if v.y < hc.y and abs(v.x) < 0.05 and -0.03 < dz < 0.06:
                v.y -= 0.006 * (1 - abs(v.x) / 0.05)
    helm = ak.loft("shell", hsecs, cap_top=True)
    helm.data.update()
    if sum(((p.center - hc).dot(p.normal) for p in helm.data.polygons)) < 0:
        helm.data.flip_normals()
    sd = helm.modifiers.new("sub", "SUBSURF"); sd.levels = 2; sd.render_levels = 2
    ak.apply_modifiers(helm); ak.shade(helm, 50)
    helm_tree, _ = ak.bvh_of(helm)
    k.add(helm, "head", "secondary", "helmet")

    def shell_form(dist):
        f = helm.copy(); f.data = helm.data.copy(); f.name = f"form_{k.set}_helm_{dist}"; ak.link(f, "forms")
        d = f.modifiers.new("d", "DISPLACE"); d.mid_level = 0; d.strength = dist
        ak.apply_modifiers(f); f.hide_render = True
        return ak.bvh_of(f)[0]

    T_H0, T_H1, T_H2, T_H3 = shell_form(0.002), shell_form(0.007), shell_form(0.016), shell_form(0.026)
    HEL = ak.Sphere(hc, FWD, UP, r0=0.13)
    vz = -0.002
    style = st["visor"]
    if style == "wrap":
        visor = [(-0.150, vz + 0.024), (-0.050, vz + 0.030), (0.0, vz + 0.022), (0.050, vz + 0.030), (0.150, vz + 0.024),
                 (0.168, vz), (0.078, vz - 0.014), (0.0, vz - 0.036), (-0.078, vz - 0.014), (-0.168, vz)]
        vf = [0.006, 0.012, 0.01, 0.012, 0.006, 0.006, 0.012, 0.006, 0.012, 0.006]
    elif style == "slit":
        visor = [(-0.140, vz + 0.020), (0.140, vz + 0.020), (0.150, vz + 0.004), (-0.150, vz + 0.004)]
        vf = 0.004
    elif style == "face":
        visor = [(-0.120, vz + 0.040), (0.0, vz + 0.048), (0.120, vz + 0.040), (0.150, vz - 0.010), (0.080, vz - 0.060),
                 (0.0, vz - 0.075), (-0.080, vz - 0.060), (-0.150, vz - 0.010)]
        vf = [0.03, 0.02, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03]
    else:  # chevron
        visor = [(-0.150, vz + 0.040), (0.0, vz + 0.004), (0.150, vz + 0.040), (0.162, vz + 0.018), (0.0, vz - 0.024),
                 (-0.162, vz + 0.018)]
        vf = [0.006, 0.004, 0.006, 0.006, 0.004, 0.006]
    vis = k.add(ak.plate("visor", T_H0, HEL, visor, n=96, rings=7, thickness=0.004, bevel=0.0015, fillet_r=vf,
                         smooth_iters=4),
                "head", "visor", "helmet")
    # glass reflects everything: take the smooth shell normals, not the projected ring surface
    m = vis.modifiers.new("n", "DATA_TRANSFER")
    m.object = helm
    m.use_loop_data = True
    m.data_types_loops = {"CUSTOM_NORMAL"}
    m.loop_mapping = "POLYINTERP_NEAREST"
    ak.apply_modifiers(vis)
    if style != "face":
        top = max(v for _, v in visor[: len(visor) // 2 + 1])
        brow = [(-0.182, top + 0.008), (-0.050, top + 0.017), (0.0, top + 0.010), (0.050, top + 0.017), (0.182, top + 0.008),
                (0.176, top + 0.054 * st["brow"]), (0.060, top + 0.074 * st["brow"]), (0.0, top + 0.084 * st["brow"]),
                (-0.060, top + 0.074 * st["brow"]), (-0.176, top + 0.054 * st["brow"])]
        k.add(ak.plate("brow", T_H2, HEL, brow, n=96, rings=6, thickness=0.013 * st["thick"], bevel=0.004, smooth_iters=4,
                       fillet_r=[0.006, 0.012, 0.008, 0.012, 0.006, 0.02, 0.03, 0.02, 0.03, 0.02]), "head", "primary", "helmet")
        bottom = min(v for _, v in visor)
        jd = st["jaw_h"]
        jaw = [(-0.180, bottom + 0.010), (-0.082, bottom - 0.004), (0.0, bottom - 0.010), (0.082, bottom - 0.004),
               (0.180, bottom + 0.010), (0.172, bottom - 0.064 * jd), (0.060, bottom - 0.086 * jd),
               (-0.060, bottom - 0.086 * jd), (-0.172, bottom - 0.064 * jd)]
        k.add(ak.plate("jaw", T_H2, HEL, jaw, n=96, rings=6, thickness=0.010 * st["thick"], bevel=0.0035, smooth_iters=4,
                       fillet_r=[0.006, 0.012, 0.008, 0.012, 0.006, 0.02, 0.02, 0.02, 0.02]), "head", "primary", "helmet")
        for j in range(st["vents"]):
            e = bottom - 0.030 - 0.009 * j
            k.add(ak.strip(f"vent_{j}", T_H3, HEL, [(-0.030 + 0.003 * j, e), (0.030 - 0.003 * j, e)], 0.0045,
                           thickness=0.006, n=24), "head", "trim", "helmet")
    else:
        # faceplate rim and a thin brow line
        rim = [(-0.184, vz + 0.070), (0.184, vz + 0.070), (0.184, vz + 0.052), (-0.184, vz + 0.052)]
        k.add(ak.plate("brow", T_H2, HEL, rim, n=64, rings=3, thickness=0.008, bevel=0.003, fillet_r=0.006),
              "head", "primary", "helmet")
        k.add(ak.plate("chin", T_H2, HEL, [(-0.080, vz - 0.082), (0.080, vz - 0.082), (0.050, vz - 0.112),
                                           (-0.050, vz - 0.112)], n=48, rings=3, thickness=0.009, bevel=0.003,
                       fillet_r=0.012), "head", "primary", "helmet")
    HEL_TOP = ak.Sphere(hc, UP, FWD, r0=0.13)
    crest = st["crest"]
    if crest == "ridge":
        k.add(ak.plate("crest", T_H0, HEL_TOP, [(-0.014, -0.125), (0.014, -0.125), (0.022, 0.078), (-0.022, 0.078)],
                       n=44, rings=3, thickness=0.011, bevel=0.0035, fillet_r=0.009), "head", "paint", "helmet")
    elif crest == "twin":
        for side, sx in (("l", 1), ("r", -1)):
            k.add(ak.plate(f"crest_{side}", T_H0, HEL_TOP, [(sx * 0.030, -0.120), (sx * 0.052, -0.120), (sx * 0.058, 0.070),
                                                          (sx * 0.036, 0.070)], n=40, rings=3, thickness=0.012,
                           bevel=0.0035, fillet_r=0.008), "head", "paint", "helmet")
    elif crest == "fin":
        # tall swept crest fin
        top_z = hc.z + 0.150
        k.add(ak.box("crest_fin", (0.012, 0.20, 0.07), V((0, hc.y + 0.05, top_z + 0.01)), bevel=0.004,
                     rot=(math.radians(-14), 0, 0), taper=(0.5, 0.55)), "head", "paint", "helmet")
        k.add(ak.strip("crest_light", T_H3, HEL_TOP, [(0.0, -0.10), (0.0, 0.06)], 0.006, thickness=0.004, n=32),
              "head", "light", "helmet")
    HEL_BACK = ak.Sphere(hc, BACK, UP, r0=0.13)
    for j in range(st["neckguard"]):
        e0, e1, w = (-0.050 - 0.030 * j, -0.085 - 0.028 * j, 0.150 - 0.016 * j)
        k.add(ak.plate(f"neckguard_{j}", (T_H1, T_H2, T_H3)[min(j, 2)], HEL_BACK, [(-w, e0), (w, e0), (w * 0.9, e1),
                                                                               (-w * 0.9, e1)], n=48, rings=3,
                       thickness=0.009, bevel=0.003, fillet_r=0.012), "head", "secondary" if j % 2 else "primary", "helmet")
    ear_c = V((0.127 * wide + 0.006, hc.y + 0.016, hc.z - 0.016))
    er = st["ear"]
    if er > 0:
        k.add(ak.cylinder("ear_l", 0.038 * er, 0.020, ear_c, verts=28, bevel=0.004, rot=(0, math.radians(90), 0)),
              "head", "trim", "helmet")
        k.add(ak.cylinder("ear_glow_l", 0.024 * er, 0.024, ear_c + V((0.001, 0, 0)), verts=28, bevel=0.002,
                          rot=(0, math.radians(90), 0)), "head", "light", "helmet")
    if st["antenna"]:
        k.add(ak.cylinder("antenna", 0.0035, 0.11, ear_c + V((0.012, 0.02, 0.07)), verts=10, bevel=0.001,
                          rot=(math.radians(-18), 0, 0)), "head", "trim", "helmet")


# ---------------------------------------------------------------------- class items

def class_item(k, st):
    kind = st["class"]
    zc = k.z_clav
    bp_c = V((0, 0.175, zc - 0.10))
    if kind in ("pack", "reactor"):
        big = 1.18 if kind == "reactor" else 1.0
        k.add(ak.box("pack_core", (0.22 * big, 0.08 * big, 0.22 * big), bp_c, bevel=0.012, segments=3, taper=(0.82, 0.9)),
              "spine_03", "secondary", "classItem")
        k.add(ak.box("pack_plate", (0.19 * big, 0.022, 0.18 * big), bp_c + V((0, 0.050 * big, 0.005)), bevel=0.006,
                     segments=2, taper=(0.85, 1.0)), "spine_03", "primary", "classItem")
        cells = (0.115 * big,) if kind == "pack" else (0.125, -0.125)
        for j, x in enumerate(cells):
            k.add(ak.cylinder(f"cell_{j}", 0.028, 0.19 * big, bp_c + V((x, 0.01, -0.005)), verts=20, bevel=0.004),
                  "spine_03", "trim", "classItem")
            k.add(ak.cylinder(f"cell_glow_{j}", 0.0295, 0.05, bp_c + V((x, 0.01, -0.005)), verts=20, bevel=0.0015),
                  "spine_03", "light", "classItem")
        k.add(ak.box("vent", (0.10 * big, 0.012, 0.035), bp_c + V((0, 0.058 * big, -0.055)), bevel=0.003),
              "spine_03", "trim", "classItem")
        if kind == "reactor":
            k.add(ak.box("reactor_cap", (0.12, 0.03, 0.06), bp_c + V((0, 0.03, 0.15)), bevel=0.008, segments=2,
                         taper=(0.8, 0.8)), "spine_03", "paint", "classItem")
    elif kind == "cloak":
        cloak(k)
    elif kind == "array":
        k.add(ak.box("array_spine", (0.05, 0.05, 0.26), bp_c + V((0, -0.02, 0.0)), bevel=0.01, segments=2,
                     taper=(0.7, 0.8)), "spine_03", "secondary", "classItem")
        for j, (x, ang, h) in enumerate(((0.05, 22, 0.20), (-0.05, -22, 0.20), (0.0, 0, 0.26))):
            k.add(ak.box(f"array_fin_{j}", (0.008, 0.05, h), bp_c + V((x, 0.02, 0.10 + h * 0.3)), bevel=0.003,
                         rot=(math.radians(-12), math.radians(ang), 0), taper=(0.5, 0.4)), "spine_03", "primary", "classItem")
        k.add(ak.cylinder("array_core", 0.03, 0.03, bp_c + V((0, 0.035, -0.02)), verts=24, bevel=0.003,
                          rot=(math.radians(90), 0, 0)), "spine_03", "light", "classItem")


def cloak(k):
    """cloth panel from the shoulder blades to mid thigh, weighted down the cape bones"""
    T = k.torso(0.05)
    top, bot = k.z_clav + 0.01, k.head("calf_l").z + 0.14
    rows, cols = 12, 24
    secs = []
    for i in range(rows):
        t = i / (rows - 1)
        z = top + (bot - top) * t
        half = 0.20 + 0.10 * t
        loop = []
        for j in range(cols):
            x = -half + 2 * half * j / (cols - 1)
            o = V((x, 0.6, z))
            hit = T.ray_cast(o, FWD, 1.0) if z > k.z_pel - 0.05 else (None,)
            y = (hit[0].y if hit[0] is not None else 0.16) + 0.012 + 0.10 * max(0.0, t - 0.4)
            loop.append(V((x, y, z)))
        secs.append(loop)
    verts = [v for row in secs for v in row]
    faces = [(i * cols + j, i * cols + j + 1, (i + 1) * cols + j + 1, (i + 1) * cols + j)
             for i in range(rows - 1) for j in range(cols - 1)]
    ob = ak.mesh_object("cloak", verts, faces)
    s = ob.modifiers.new("t", "SOLIDIFY"); s.thickness = 0.005; s.offset = 1
    sd = ob.modifiers.new("sub", "SUBSURF"); sd.levels = 1
    ak.apply_modifiers(ob); ak.shade(ob, 60)
    k.add(ob, "cape", "cloth", "classItem")


# ---------------------------------------------------------------------- styles

STYLES = {
    "strafe": dict(thick=1.0, bulk=1.0, chest_w=1.0, chest="plate", abs=3, collar=1.0, paul=1.0, paul_layers=3,
                   lights=True, bicep=True, elbow=1.0, vam_w=1.0, wraps=False, legs="plate", thigh_w=1.0,
                   tasset=0.26, knee=1.0, greave_w=1.0, boot=1.0, belt=1.0, pouches=(50, 76),
                   helm_w=1.0, helm_ex=1.0, jaw=1.0, visor="wrap", brow=1.0, jaw_h=1.0, vents=4, crest="ridge",
                   neckguard=2, ear=1.0, antenna=True, **{"class": "pack"}),
    "anvil": dict(thick=1.45, bulk=1.25, chest_w=1.06, chest="heavy", abs=3, collar=1.5, paul=1.2, paul_layers=4,
                  lights=False, bicep=True, elbow=1.25, vam_w=1.15, wraps=False, legs="plate", thigh_w=1.25,
                  tasset=0.36, knee=1.25, greave_w=1.2, boot=1.2, belt=1.4, pouches=(48, 70, 94),
                  helm_w=1.07, helm_ex=1.15, jaw=1.6, visor="slit", brow=1.3, jaw_h=1.35, vents=0, crest="twin",
                  neckguard=3, ear=0.0, antenna=False, **{"class": "reactor"}),
    "vector": dict(thick=0.75, bulk=0.85, chest_w=0.94, chest="vest", abs=2, collar=0.6, paul=0.82, paul_layers=1,
                   lights=False, bicep=False, elbow=0.85, vam_w=0.85, wraps=True, legs="straps", thigh_w=0.9,
                   tasset=0.0, knee=0.85, greave_w=0.85, boot=0.9, belt=0.8, pouches=(80,),
                   helm_w=0.97, helm_ex=0.75, jaw=0.4, visor="face", brow=1.0, jaw_h=1.0, vents=0, crest="none",
                   neckguard=1, ear=0.7, antenna=False, **{"class": "cloak"}),
    "quill": dict(thick=0.9, bulk=1.0, chest_w=0.98, chest="chevron", abs=4, collar=1.25, paul=1.05, paul_layers=2,
                  lights=True, seams=True, fins=True, bicep=False, elbow=0.95, vam_w=0.95, wraps=False, legs="plate",
                  thigh_w=0.95, tasset=0.30, knee=0.95, greave_w=0.95, boot=1.0, belt=0.9, pouches=(),
                  helm_w=1.0, helm_ex=0.9, jaw=1.2, visor="chevron", brow=0.8, jaw_h=0.9, vents=2, crest="fin",
                  neckguard=2, ear=1.1, antenna=True, **{"class": "array"}),
}


def build_set(k, set_id, slots=("helmet", "arms", "chest", "legs", "classItem")):
    st = STYLES[set_id]
    k.set = set_id
    start = len(k.pieces)
    if "chest" in slots:
        chest(k, st)
    if "arms" in slots:
        arms(k, st)
    if "legs" in slots:
        legs(k, st)
    if "helmet" in slots:
        helmet(k, st)
    if "classItem" in slots:
        class_item(k, st)
    # mirror every left piece
    for ob, bone, mat, slot, sid in list(k.pieces[start:]):
        if ob.name.endswith("_l"):
            r = ak.mirror_object(ob, ob.name[:-2] + "_r")
            k.pieces.append((r, re.sub(r"_l(?=:|,|$)", "_r", bone), mat, slot, sid))
    # forms are construction only
    for f in [o for o in bpy.data.objects if o.name.startswith("form_")]:
        bpy.data.objects.remove(f, do_unlink=True)
    k._forms.clear()
