"""edge: the sleek cyborg set. thin black plates over chrome under-layers on
the synthetic muscle suit, segmented finger armour, a blade visor and an empty
scabbard across the back. original design: the cyber ninja genre gave the
mood, no shapes are copied from any game.

same conventions as armor_sets.py: blender space, the character faces -y,
left is +x, `_l` pieces are mirrored afterwards by build_set.
"""

import math

from mathutils import Vector as V

import armorkit as ak

UP, FWD, BACK = V((0, 0, 1)), V((0, -1, 0)), V((0, 1, 0))
SMALL = dict(n=32, rings=3)
MED = dict(n=44, rings=4)
BIG = dict(n=56, rings=5)
FINGERS = ("index", "middle", "ring", "pinky")


def _hexa(s0, s1, h0, h1, cut):
    """long hexagon: a rectangle with the four corners cut by `cut` along h"""
    return [(s0, h0 + cut), (0.5 * (s0 + s1), h0), (s1, h0 + cut), (s1, h1 - cut), (0.5 * (s0 + s1), h1), (s0, h1 - cut)]


# ---------------------------------------------------------------------- chest

def chest(k):
    hz, zc, z3, z2, z1, zp = k.hz, k.z_clav, k.z_s3, k.z_s2, k.z_s1, k.z_pel
    T1, T2, T3 = k.torso(0.008), k.torso(0.0165), k.torso(0.025)
    # chrome under-layer, then the black pec plate with a rim of chrome showing round it. the outer edge
    # stays under ~70 degrees round the torso: past that the torso form bulges out over the shoulder
    pec_under = [(0.012, hz(zc - 0.036)), (0.084, hz(zc - 0.018)), (0.150, hz(zc - 0.028)), (0.176, hz(zc - 0.080)),
                 (0.180, hz(zc - 0.168)), (0.118, hz(z3 + 0.026)), (0.012, hz(z3 + 0.058))]
    k.add(ak.plate("pec_under_l", T1, k.TORSO, pec_under, **BIG, thickness=0.0072, bevel=0.0024,
                   fillet_r=[0.006, 0.012, 0.016, 0.02, 0.016, 0.01, 0.006]), "spine_03", "trim", "chest")
    pec = [(0.026, hz(zc - 0.048)), (0.086, hz(zc - 0.030)), (0.142, hz(zc - 0.039)), (0.164, hz(zc - 0.084)),
           (0.166, hz(zc - 0.152)), (0.112, hz(z3 + 0.040)), (0.028, hz(z3 + 0.072))]
    pec_l = k.add(ak.plate("pec_l", T2, k.TORSO, pec, **BIG, thickness=0.0078, bevel=0.0026,
                           fillet_r=[0.005, 0.01, 0.014, 0.018, 0.014, 0.008, 0.005]), "spine_03", "primary", "chest")
    # sternum keel with the core light set into it
    keel = [(-0.024, hz(zc - 0.030)), (0.024, hz(zc - 0.030)), (0.020, hz(z3 + 0.050)), (0.0, hz(z3 + 0.012)),
            (-0.020, hz(z3 + 0.050))]
    k.add(ak.plate("keel", T3, k.TORSO, keel, **MED, thickness=0.0065, bevel=0.0024,
                   fillet_r=[0.004, 0.004, 0.006, 0.003, 0.006]), "spine_03", "trim", "chest")
    hc = hz(zc - 0.118)
    k.add(ak.plate("core_light", k.torso(0.025 + 0.0065 + 0.0008), k.TORSO,
                   [(0.0, hc + 0.024), (0.011, hc), (0.0, hc - 0.024), (-0.011, hc)], n=32, rings=2, thickness=0.0028,
                   bevel=0.0008, fillet_r=0.002, smooth_iters=0), "spine_03", "light", "chest")
    # mechanical abs: three rows of small plates either side of the midline, muscle between
    top, bot = z3 + 0.004, z1 - 0.006
    rows = 3
    step = (top - bot) / rows
    for i in range(rows):
        h1, h0 = hz(top - i * step), hz(top - (i + 1) * step + 0.010)
        inset = 0.004 * i
        out = [(0.010, h0 + 0.004), (0.010, h1), (0.066 - inset, h1 - 0.004), (0.072 - inset, h0 + 0.012),
               (0.060 - inset, h0)]
        bone = "spine_02" if top - i * step > z2 else "spine_01"
        k.add(ak.plate(f"abs_{i}_l", T1, k.TORSO, out, **MED, thickness=0.0068, bevel=0.0022, fillet_r=0.006),
              bone, "secondary", "chest")
    # rib blades down the sides
    for j in range(3):
        h0 = hz(z3 + 0.024) - j * 0.036
        rib = [(0.106, h0), (0.236, h0 - 0.030), (0.240, h0 - 0.046), (0.110, h0 - 0.018)]
        k.add(ak.plate(f"rib_{j}_l", T1, k.TORSO, rib, **MED, thickness=0.0062, bevel=0.002,
                       fillet_r=[0.004, 0.006, 0.006, 0.004]), "spine_03" if j < 2 else "spine_02", "primary", "chest")
    # back: shoulder blades and a segmented spine
    blade = [(0.040, hz(zc - 0.010)), (0.140, hz(zc - 0.024)), (0.166, hz(zc - 0.110)), (0.124, hz(zc - 0.190)),
             (0.046, hz(zc - 0.150))]
    k.add(ak.plate("blade_under_l", T1, k.BACKC, [(s * 1.06, h + (0.006 if h > hz(zc - 0.1) else -0.006)) for s, h in blade],
                   **MED, thickness=0.007, bevel=0.0024, fillet_r=0.012), "spine_03", "trim", "chest")
    k.add(ak.plate("blade_l", T2, k.BACKC, blade, **MED, thickness=0.0078, bevel=0.0026, fillet_r=0.010),
          "spine_03", "primary", "chest")
    n_vert = 8
    v_top, v_bot = zc - 0.012, z1 + 0.004
    v_step = (v_top - v_bot) / n_vert
    for j in range(n_vert):
        h = hz(v_top - (j + 0.5) * v_step)
        half = v_step * 0.5 - 0.0045
        w = 0.026 - 0.0012 * j
        vert = [(-w, h + half), (w, h + half), (w + 0.006, h), (w, h - half), (-w, h - half), (-w - 0.006, h)]
        bone = "spine_03" if v_top - j * v_step > z3 else ("spine_02" if v_top - j * v_step > z2 else "spine_01")
        k.add(ak.plate(f"vertebra_{j}", T2, k.BACKC, vert, n=32, rings=3, thickness=0.0075, bevel=0.0024,
                       fillet_r=0.003), bone, "trim" if j % 2 == 0 else "secondary", "chest")
    lumbar = [(0.034, hz(z2 - 0.010)), (0.120, hz(z2 - 0.022)), (0.112, hz(zp + 0.060)), (0.040, hz(zp + 0.050))]
    k.add(ak.plate("lumbar_l", T1, k.BACKC, lumbar, **MED, thickness=0.0068, bevel=0.0022, fillet_r=0.010),
          "spine_01", "secondary", "chest")
    collar(k)
    # emblem on the left pec, callsign on the right (three.js space anchors)
    tree_l, _ = ak.bvh_of(pec_l)
    for kind, x in (("emblem", 0.104), ("tag", -0.104)):
        o = V((abs(x), -0.8, zc - 0.092))
        hit = tree_l.ray_cast(o, BACK, 2.0)
        if hit[0] is None:
            continue
        p, n = hit[0], hit[1]
        if x < 0:
            p, n = V((-p.x, p.y, p.z)), V((-n.x, n.y, n.z))
        k.anchors.append((k.set, kind, "spine_3", (p + n * 0.0015), n, 0.046 if kind == "emblem" else 0.056))


def collar(k):
    """high, tight collar in two rings with a v cut at the front"""
    neck_c = V((0, k.head("neck_01").y + 0.008, k.z_neck - 0.012))
    for name, rows, zone in (("collar_low", ((-0.070, 0.124, 0.104, 0.112, 3.0), (-0.046, 0.098, 0.086, 0.096, 2.8),
                                              (-0.020, 0.082, 0.071, 0.085, 2.6)), "secondary"),
                             ("collar_high", ((-0.022, 0.080, 0.070, 0.084, 2.6), (0.010, 0.071, 0.064, 0.078, 2.4),
                                               (0.040, 0.068, 0.060, 0.074, 2.3)), "trim")):
        secs = [ak.superellipse(0, neck_c.y + 0.004, a, a, bb, bf, ex, 48, neck_c.z + dz) for dz, a, bf, bb, ex in rows]
        for sec in secs[1:]:
            for v in sec:
                if v.y < neck_c.y:
                    v.z -= (neck_c.y - v.y) * (0.55 if name == "collar_high" else 0.35)
        col = ak.loft(name, secs, cap_top=False)
        s = col.modifiers.new("t", "SOLIDIFY"); s.thickness = 0.0065; s.offset = 1
        b = col.modifiers.new("b", "BEVEL"); b.width = 0.0022; b.segments = 2; b.limit_method = "ANGLE"
        sd = col.modifiers.new("sub", "SUBSURF"); sd.levels = 1; sd.render_levels = 1
        ak.apply_modifiers(col); ak.shade(col, 40)
        k.add(col, "spine_03" if name == "collar_low" else "neck_01", zone, "chest")


# ---------------------------------------------------------------------- arms

def hand_frame(k):
    """left hand: wrist, pinky->index direction, wrist->knuckle direction, back of the hand"""
    wrist = k.head("hand_l")
    across = (k.head("index_01_l") - k.head("pinky_01_l")).normalized()
    fwd = (k.head("middle_01_l") - wrist).normalized()
    dorsal = across.cross(fwd).normalized()
    return wrist, across, fwd, dorsal


def _perp(v, ax):
    return (v - ax * v.dot(ax)).normalized()


def finger_plates(k):
    """one thin plate on the back of every finger segment, rigid on its bone, so the hand
    reads as a slim mechanical hand however the runtime curls it"""
    wrist, across, fwd, dorsal = hand_frame(k)
    segs = [(f, i) for f in FINGERS for i in (1, 2, 3)] + [("thumb", 2), ("thumb", 3)]
    for f, i in segs:
        bone = f"{f}_0{i}_l"
        a, b = k.head(bone), k.tail(bone)
        ax = (b - a).normalized()
        L = (b - a).length
        up = (dorsal * 0.42 + across * 0.9) if f == "thumb" else dorsal
        ref = _perp(up, ax)
        r0 = 0.0088 if f != "pinky" else 0.0078
        # the distal bone ends at the very tip: rings past the skin would miss and bulge
        t1 = 0.9 if i == 3 else 1.0
        form = ak.mandrel(f"form_edge_{f}{i}_l", k.tree, a - ax * 0.002, b, ref, t0=0.0, t1=t1, rings=6, seg=24,
                          offset=0.0013, min_r=0.0045, max_r=0.0145, smooth_rings=1)[1]
        C = ak.Cylinder(a, b, ref, r0=r0)
        w = r0 * (1.22 if f != "thumb" else 1.3)
        if i == 3:
            # tip segment: tapers to a point over the nail
            ol = [(-w * 0.92, 0.10 * L), (w * 0.92, 0.10 * L), (w * 0.8, 0.56 * L), (0.0, 0.88 * L), (-w * 0.8, 0.56 * L)]
            fil = [0.0018, 0.0018, 0.0028, 0.0012, 0.0028]
        else:
            ol = [(-w, 0.13 * L), (w, 0.13 * L), (w * 0.94, 0.88 * L), (-w * 0.94, 0.88 * L)]
            fil = 0.0022
        k.add(ak.plate(f"finger_{f}{i}_l", form, C, ol, n=28, rings=3, thickness=0.0021, bevel=0.0007,
                       bevel_segments=1, fillet_r=fil, smooth_iters=1), bone, "primary", "arms")
        if i == 1 and f != "thumb":
            # chrome cap over the knuckle joint
            kn = [(-w * 0.82, -0.10 * L), (w * 0.82, -0.10 * L), (w * 0.7, 0.10 * L), (-w * 0.7, 0.10 * L)]
            kform = ak.mandrel(f"form_edge_kn{f}_l", k.tree, a - ax * 0.012, a + ax * 0.012, ref, rings=4, seg=24,
                               offset=0.0034, min_r=0.006, max_r=0.017, smooth_rings=1)[1]
            k.add(ak.plate(f"knuckle_{f}_l", kform, C, kn, n=24, rings=2, thickness=0.0024, bevel=0.0008,
                           bevel_segments=1, fillet_r=0.0016, smooth_iters=1), "hand_l", "trim", "arms")


def hand_plates(k):
    wrist, across, fwd, dorsal = hand_frame(k)
    knuckle = (k.head("index_01_l") + k.head("middle_01_l") + k.head("ring_01_l") + k.head("pinky_01_l")) / 4
    L = (knuckle - wrist).length
    end = knuckle + fwd * 0.004
    form = k.form(("edge_hand", 0.0035), lambda: ak.mandrel("form_edge_hand_l", k.tree, wrist, end, dorsal, t0=0.04,
                                                             t1=1.0, rings=7, seg=36, offset=0.0035, max_r=0.06)[1])
    form2 = k.form(("edge_hand", 0.0062), lambda: ak.mandrel("form_edge_hand2_l", k.tree, wrist, end, dorsal, t0=0.04,
                                                              t1=1.0, rings=7, seg=36, offset=0.0062, max_r=0.06)[1])
    C = ak.Cylinder(wrist, end, dorsal, r0=0.032)
    back = [(-0.022, 0.12 * L), (0.022, 0.12 * L), (0.031, 0.50 * L), (0.028, 0.86 * L), (-0.028, 0.86 * L),
            (-0.031, 0.50 * L)]
    k.add(ak.plate("hand_back_l", form, C, back, **MED, thickness=0.0026, bevel=0.0009, fillet_r=0.004),
          "hand_l", "primary", "arms")
    top = [(-0.010, 0.22 * L), (0.010, 0.22 * L), (0.015, 0.52 * L), (0.012, 0.78 * L), (-0.012, 0.78 * L),
           (-0.015, 0.52 * L)]
    k.add(ak.plate("hand_ridge_l", form2, C, top, **SMALL, thickness=0.0022, bevel=0.0008, fillet_r=0.003),
          "hand_l", "trim", "arms")
    k.add(ak.strip("hand_light_l", k.form(("edge_hand", 0.0087), lambda: ak.mandrel(
        "form_edge_hand3_l", k.tree, wrist, end, dorsal, t0=0.04, t1=1.0, rings=7, seg=36, offset=0.0087, max_r=0.06)[1]),
        C, [(0.0, 0.30 * L), (0.0, 0.70 * L)], 0.0032, thickness=0.0018, n=24), "hand_l", "light", "arms")
    finger_plates(k)


def arms(k):
    ua_a, ua_b = k.ua
    fa_a, fa_b = k.fa
    L_ua, L_fa = k.L_ua, k.L_fa
    arm_dir = (ua_b - ua_a).normalized()
    # shoulder: two sharp layers, chrome under black, swept towards the back
    cap_axis = (arm_dir * 0.55 + UP).normalized()
    paul_c = ua_a + arm_dir * 0.040 + V((0.008, 0.004, -0.020))
    rot = (0, math.radians(-34), 0)
    forms = [ak.ellipsoid(f"form_edge_paul{i}_l", paul_c, rr, rot=rot)[1]
             for i, rr in enumerate(((0.104, 0.112, 0.098), (0.113, 0.121, 0.107), (0.121, 0.129, 0.115)))]
    PAUL = ak.Sphere(paul_c, cap_axis, FWD, r0=0.095)
    under = [(-0.018, -0.118), (0.092, -0.100), (0.112, -0.010), (0.094, 0.090), (-0.018, 0.104)]
    k.add(ak.plate("paul_under_l", forms[0], PAUL, under, **BIG, thickness=0.0075, bevel=0.0026, inner=True,
                   fillet_r=[0.008, 0.02, 0.03, 0.02, 0.008]), "upperarm_l:0.78,clavicle_l:0.22", "trim", "arms")
    top = [(-0.062, -0.132), (0.060, -0.094), (0.084, -0.010), (0.066, 0.078), (-0.058, 0.096), (-0.080, -0.030)]
    k.add(ak.plate("paul_l", forms[1], PAUL, top, **BIG, thickness=0.0085, bevel=0.0028, inner=True,
                   fillet_r=[0.004, 0.016, 0.026, 0.016, 0.01, 0.01]), "upperarm_l:0.68,clavicle_l:0.32", "primary", "arms")
    k.add(ak.strip("paul_light_l", forms[2], PAUL, [(0.036, -0.070), (0.040, 0.050)], 0.0044,
                   thickness=0.0028, n=40), "upperarm_l:0.68,clavicle_l:0.32", "light", "arms")
    # upper arm: a long outer plate over chrome
    T_UA = k.limb("upperarm", ua_a, ua_b, UP, 0.007, 0.20, 1.0)
    T_UA2 = k.limb("upperarm", ua_a, ua_b, UP, 0.0145, 0.20, 1.0)
    k.add(ak.plate("bicep_under_l", T_UA, k.UA, _hexa(-0.040, 0.040, 0.36 * L_ua, 0.86 * L_ua, 0.020), **MED,
                   thickness=0.0068, bevel=0.0022, fillet_r=0.006), "upperarm_l", "trim", "arms")
    k.add(ak.plate("bicep_l", T_UA2, k.UA, _hexa(-0.033, 0.033, 0.40 * L_ua, 0.82 * L_ua, 0.022), **MED,
                   thickness=0.0072, bevel=0.0024, fillet_r=0.005), "upperarm_l", "primary", "arms")
    # pointed elbow
    elb_c = fa_a + V((0.006, 0.012, 0.006))
    _, T_E = ak.ellipsoid("form_edge_elbow_l", elb_c, (0.044, 0.044, 0.043))
    ELB = ak.Sphere(elb_c, V((0.30, 0.90, 0.30)).normalized(), UP, r0=0.044)
    k.add(ak.plate("elbow_l", T_E, ELB, [(-0.036, -0.034), (0.036, -0.034), (0.042, 0.020), (0.0, 0.058), (-0.042, 0.020)],
                   **SMALL, thickness=0.0075, bevel=0.0026, fillet_r=[0.008, 0.008, 0.01, 0.004, 0.01]),
          "elbow_l", "trim", "arms")
    # forearm: two overlapping graphite shells, two black blades on top, a light seam between them
    T_FA = k.limb("forearm", fa_a, fa_b, UP, 0.0085, 0.05, 0.98)
    T_FA2 = k.limb("forearm", fa_a, fa_b, UP, 0.0125, 0.05, 0.98)
    T_FA3 = k.limb("forearm", fa_a, fa_b, UP, 0.0205, 0.05, 0.98)
    k.add(ak.plate("vambrace_l", T_FA, k.FA, [(-0.064, 0.08 * L_fa), (0.064, 0.08 * L_fa), (0.058, 0.56 * L_fa),
                                              (-0.058, 0.56 * L_fa)], **BIG, thickness=0.0068, bevel=0.0024,
                   fillet_r=[0.012, 0.012, 0.006, 0.006]), "lowerarm_l", "secondary", "arms")
    k.add(ak.plate("vambrace2_l", T_FA2, k.FA, [(-0.058, 0.52 * L_fa), (0.058, 0.52 * L_fa), (0.052, 0.88 * L_fa),
                                                (-0.052, 0.88 * L_fa)], **BIG, thickness=0.0068, bevel=0.0024,
                   fillet_r=[0.006, 0.006, 0.01, 0.01]), "lowerarm_l", "secondary", "arms")
    for j, (s0, s1) in enumerate(((0.007, 0.047), (-0.047, -0.007))):
        k.add(ak.plate(f"fa_blade_{j}_l", T_FA3, k.FA, _hexa(s0, s1, 0.12 * L_fa, 0.86 * L_fa, 0.045), **MED,
                       thickness=0.0062, bevel=0.0022, fillet_r=0.004), "lowerarm_l", "primary", "arms")
    k.add(ak.strip("fa_seam_l", k.limb("forearm", fa_a, fa_b, UP, 0.0205, 0.05, 0.98), k.FA,
                   [(0.0, 0.16 * L_fa), (0.0, 0.82 * L_fa)], 0.0048, thickness=0.0045, n=40), "lowerarm_l", "light", "arms")
    T_W = k.limb("wrist", fa_a, fa_b, UP, 0.0065, 0.86, 1.02, rings=6)
    k.add(ak.plate("cuff_l", T_W, k.FA, [(-0.104, 0.885 * L_fa), (0.104, 0.885 * L_fa), (0.104, 0.965 * L_fa),
                                         (-0.104, 0.965 * L_fa)], **MED, thickness=0.0068, bevel=0.0022,
                   fillet_r=0.006), "lowerarm_l", "trim", "arms")
    hand_plates(k)


# ---------------------------------------------------------------------- legs

def legs(k, st):
    import armor_sets as AS

    th_a, th_b = k.th
    sh_a, sh_b = k.sh
    L_th, L_sh = k.L_th, k.L_sh
    T_TH0 = k.limb("thigh", th_a, th_b, FWD, 0.0075, 0.08, 1.0, rings=14)
    T_TH = k.limb("thigh", th_a, th_b, FWD, 0.0155, 0.08, 1.0, rings=14)
    T_TH2 = k.limb("thigh", th_a, th_b, FWD, 0.024, -0.16, 1.0, rings=16)
    thigh = [(-0.098, 0.15 * L_th), (0.030, 0.15 * L_th), (0.036, 0.42 * L_th), (0.022, 0.76 * L_th),
             (-0.074, 0.80 * L_th), (-0.104, 0.52 * L_th)]
    k.add(ak.plate("thigh_under_l", T_TH0, k.TH, [(s * 1.08 + (-0.004 if s < 0 else 0.004), h) for s, h in thigh],
                   **BIG, thickness=0.0072, bevel=0.0024, fillet_r=0.012), "thigh_l", "trim", "legs")
    k.add(ak.plate("thigh_l", T_TH, k.TH, thigh, **BIG, thickness=0.0082, bevel=0.0028,
                   fillet_r=[0.012, 0.008, 0.012, 0.012, 0.012, 0.012]), "thigh_l", "primary", "legs")
    k.add(ak.strip("thigh_light_l", k.limb("thigh", th_a, th_b, FWD, 0.0155 + 0.0082 + 0.0008, 0.08, 1.0, rings=14),
                   k.TH, [(-0.082, 0.30 * L_th), (-0.086, 0.66 * L_th)], 0.0045, thickness=0.0026, n=36),
          "thigh_l", "light", "legs")
    k.add(ak.plate("tasset_l", T_TH2, k.TH, [(-0.138, -0.09 * L_th), (-0.044, -0.09 * L_th), (-0.050, 0.17 * L_th),
                                             (-0.128, 0.22 * L_th)], **MED, thickness=0.0075, bevel=0.0026, inner=True,
                   fillet_r=[0.01, 0.01, 0.02, 0.012]), "thigh_l", "secondary", "legs")
    k.add(ak.plate("hamstring_l", T_TH0, k.THB, _hexa(-0.060, 0.056, 0.32 * L_th, 0.76 * L_th, 0.04), **MED,
                   thickness=0.0068, bevel=0.0022, fillet_r=0.008), "thigh_l", "secondary", "legs")
    knee_c = sh_a + V((0.002, -0.046, 0.012))
    _, T_K = ak.ellipsoid("form_edge_knee_l", knee_c, (0.058, 0.048, 0.066))
    KNEE = ak.Sphere(knee_c, FWD, UP, r0=0.052)
    k.add(ak.plate("knee_l", T_K, KNEE, [(-0.044, -0.040), (0.044, -0.040), (0.050, 0.020), (0.0, 0.074), (-0.050, 0.020)],
                   **MED, thickness=0.0082, bevel=0.0028, fillet_r=[0.012, 0.012, 0.012, 0.004, 0.012]),
          "knee_l", "trim", "legs")
    T_SH = k.limb("shin", sh_a, sh_b, FWD, 0.0105, 0.02, 0.97, rings=14)
    T_SH2 = k.limb("shin", sh_a, sh_b, FWD, 0.0105 + 0.0082 + 0.0008, 0.02, 0.97, rings=14)
    greave = [(-0.070, 0.08 * L_sh), (0.050, 0.08 * L_sh), (0.046, 0.58 * L_sh), (0.0, 0.80 * L_sh), (-0.062, 0.60 * L_sh)]
    k.add(ak.plate("greave_l", T_SH, k.SH, greave, **BIG, thickness=0.0082, bevel=0.0028,
                   fillet_r=[0.016, 0.016, 0.012, 0.006, 0.012]), "calf_l", "primary", "legs")
    ridge = [(-0.011, 0.10 * L_sh), (0.011, 0.10 * L_sh), (0.009, 0.58 * L_sh), (0.0, 0.70 * L_sh), (-0.009, 0.58 * L_sh)]
    k.add(ak.plate("shin_ridge_l", T_SH2, k.SH, ridge, **SMALL, thickness=0.0055, bevel=0.002,
                   fillet_r=[0.004, 0.004, 0.003, 0.002, 0.003]), "calf_l", "trim", "legs")
    k.add(ak.strip("greave_light_l", T_SH2, k.SH, [(-0.050, 0.16 * L_sh), (-0.046, 0.50 * L_sh)], 0.0042,
                   thickness=0.0026, n=32), "calf_l", "light", "legs")
    k.add(ak.plate("calf_l", T_SH, k.SHB, _hexa(-0.056, 0.056, 0.12 * L_sh, 0.60 * L_sh, 0.05), **MED,
                   thickness=0.0072, bevel=0.0024, fillet_r=0.01), "calf_l", "secondary", "legs")
    AS.boots(k, st)
    # heel spur
    foot_h = k.head("foot_l")
    k.add(ak.box("heel_spur_l", (0.012, 0.062, 0.020), V((foot_h.x, foot_h.y + 0.066, 0.040)), bevel=0.0025,
                 rot=(math.radians(-24), 0, 0), taper=(0.5, 0.35)), "foot_l", "trim", "legs")
    AS.belt(k, st)


# ---------------------------------------------------------------------- class item

def scabbard(k):
    """empty scabbard across the back: mouth over the right shoulder, tip at the left hip"""
    T = k.torso(0.03)

    def back_y(x, z):
        hit = T.ray_cast(V((x, 0.8, z)), FWD, 1.6)
        return hit[0].y if hit[0] is not None else 0.16

    mouth = V((-0.150, 0.0, k.z_clav + 0.070))
    tip = V((0.215, 0.0, k.z_pel - 0.120))
    mouth.y = back_y(-0.11, k.z_clav - 0.02) + 0.020
    tip.y = back_y(0.16, k.z_pel + 0.02) + 0.050
    ax = (tip - mouth).normalized()
    out = BACK - ax * BACK.dot(ax)
    out.normalize()
    side = ax.cross(out).normalized()
    n = 28

    def section(t, grow=0.0):
        c = mouth + (tip - mouth) * t + side * (0.024 * math.sin(math.pi * t)) + out * (0.010 * math.sin(math.pi * t))
        w = 0.050 * (1.0 - 0.32 * t) + grow
        th = 0.024 * (1.0 - 0.25 * t) + grow
        ring = [(0.5, 0.0), (0.30, 0.5), (-0.30, 0.5), (-0.5, 0.0), (-0.30, -0.5), (0.30, -0.5)]
        return [c + side * (u * w) + out * (v * th) for u, v in ring]

    secs = [section(i / (n - 1)) for i in range(n)]
    secs.append([secs[-1][0].lerp(secs[-1][3], 0.5) + ax * 0.03] * 6)
    body = ak.loft("scabbard", secs, cap_top=False, cap_bottom=True)
    bv = body.modifiers.new("b", "BEVEL"); bv.width = 0.0022; bv.segments = 2; bv.limit_method = "ANGLE"
    ak.apply_modifiers(body); ak.shade(body, 35)
    k.add(body, "spine_03", "primary", "classItem")
    for j, (t0, t1) in enumerate(((0.0, 0.06), (0.30, 0.34), (0.62, 0.655))):
        ring = ak.loft(f"scabbard_band_{j}", [section(t0 + (t1 - t0) * i / 3, grow=0.006) for i in range(4)],
                       cap_top=True, cap_bottom=True)
        bv = ring.modifiers.new("b", "BEVEL"); bv.width = 0.0016; bv.segments = 1; bv.limit_method = "ANGLE"
        ak.apply_modifiers(ring); ak.shade(ring, 35)
        k.add(ring, "spine_03", "trim", "classItem")
    # glow line down the outer face
    pts = []
    for i in range(18):
        t = 0.09 + 0.50 * i / 17
        c = mouth + (tip - mouth) * t + side * (0.024 * math.sin(math.pi * t)) + out * (0.010 * math.sin(math.pi * t))
        pts.append(c + out * (0.024 * (1.0 - 0.25 * t) * 0.5 + 0.0008))
    secs = []
    for i, p in enumerate(pts):
        secs.append([p + side * 0.0035, p + out * 0.0018, p - side * 0.0035, p - out * 0.0010])
    glow = ak.loft("scabbard_light", secs, cap_top=True, cap_bottom=True)
    ak.shade(glow, 35)
    k.add(glow, "spine_03", "light", "classItem")
    # mount: a plate on the spine with a clamp reaching the scabbard
    hz, zc = k.hz, k.z_clav
    k.add(ak.plate("scabbard_mount", k.torso(0.036), k.BACKC, _hexa(-0.050, 0.050, hz(zc - 0.150), hz(zc - 0.060), 0.016),
                   **MED, thickness=0.009, bevel=0.003, fillet_r=0.006), "spine_03", "secondary", "classItem")
    mid = mouth + (tip - mouth) * 0.32
    k.add(ak.box("scabbard_clamp", (0.022, 0.030, 0.040), V((mid.x * 0.5, (mid.y + back_y(0.0, mid.z)) * 0.5 + 0.004, mid.z)),
                 bevel=0.003, rot=(0, math.atan2(ax.x, -ax.z), 0)), "spine_03", "trim", "classItem")


def build(k, st, slots):
    import armor_sets as AS

    if "chest" in slots:
        chest(k)
    if "arms" in slots:
        arms(k)
    if "legs" in slots:
        legs(k, st)
    if "helmet" in slots:
        AS.helmet(k, st)
    if "classItem" in slots:
        scabbard(k)
