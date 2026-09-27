"""left wrist dive-style watch, built in its own frame (mm).

watch frame (the `watch` empty): origin on the dial centre at the dial
surface, +Z out of the dial, +Y towards 12 (little finger side), +X towards
3 where the crown sits (towards the hand). 41 mm case, 12.5 mm from case back
to crystal top, 48 mm lug to lug, 20 mm strap.

the strap is built in the left arm frame so it can hug the real skin cross
section with a constant clearance, then moved into the watch frame.
"""

import math

import bpy
import numpy as np
from mathutils import Matrix

import arm as A
import meshutil as M
import params as P

MM = 0.001

CASE_R = 20.5
Z_BACK = -7.6
Z_TOP = 4.9
DIAL_R = 15.1
LUG_TIP = 24.0
LUG_X = (10.05, 12.75)
SPRING_BAR = (21.55, -5.45)  # |y|, z
STRAP_W = 20.0
STRAP_T = 3.0
CROWN_Z = -2.1


# ---------------------------------------------------------------- placement
def _skin_z(x_cm, s_cm):
    half_w, top, bot, n = P.forearm_section(s_cm)
    cz = (top + bot) * 0.5
    hd = (top - bot) * 0.5
    ax = np.clip(np.abs(x_cm) / half_w, 0.0, 0.999)
    return cz + hd * np.power(1.0 - np.power(ax, n), 1.0 / n)


def case_bottom_samples():
    pts = []
    for r, z in ((0.0, Z_BACK), (7.0, Z_BACK + 0.06), (14.5, -7.4), (17.3, -6.7), (18.3, -5.75), (20.3, -5.2)):
        n = 1 if r == 0 else 36
        for i in range(n):
            a = 2 * math.pi * i / n
            pts.append((r * math.cos(a), r * math.sin(a), z))
    for sx in (-1, 1):
        for sy in (-1, 1):
            for y, zb in ((16.0, -5.5), (19.0, -5.75), (22.0, -6.45), (24.0, -7.2)):
                for x in LUG_X:
                    pts.append((sx * x, sy * y, zb))
    return np.array(pts)


def watch_frame():
    """world matrix of the watch empty on the left wrist (4x4 numpy, metres)"""
    wrist_l = P.mirror_x(P.WRIST_R)
    s = P.WATCH_S
    ds = 0.4
    slope = (P.forearm_section(s + ds)[1] - P.forearm_section(s - ds)[1]) / (2 * ds)
    # +X towards the hand (+Y world), tilted with the dorsal line of the forearm
    x_w = np.array([0.0, 1.0, -slope])
    x_w /= np.linalg.norm(x_w)
    z_w = np.array([0.0, slope, 1.0])
    z_w /= np.linalg.norm(z_w)
    y_w = np.cross(z_w, x_w)  # comes out as -X world, the little finger side
    top_c = wrist_l + np.array([0.0, -s * P.CM, P.forearm_section(s)[1] * P.CM])
    samples = case_bottom_samples() * MM
    h = (P.WATCH_CLEARANCE / MM - Z_BACK) * MM
    for _ in range(4):
        origin = top_c + z_w * h
        world = origin + samples[:, 0:1] * x_w + samples[:, 1:2] * y_w + samples[:, 2:3] * z_w
        rel = (world - wrist_l) / P.CM
        clear = (rel[:, 2] - _skin_z(rel[:, 0], -rel[:, 1])) * P.CM
        h += P.WATCH_CLEARANCE - clear.min()
    mat = np.identity(4)
    mat[:3, 0] = x_w
    mat[:3, 1] = y_w
    mat[:3, 2] = z_w
    mat[:3, 3] = top_c + z_w * h
    return mat


# ---------------------------------------------------------------- case
def build_case():
    b = M.MeshBuilder()
    seg = 48
    profile = [
        (0.0, Z_BACK), (9.0, Z_BACK + 0.05), (14.5, -7.4), (17.3, -6.7), (18.3, -5.75),
        (19.9, -5.35), (20.55, -3.9), (20.6, -1.2), (20.3, 0.8), (19.6, 1.35),
        (15.75, 2.45), (DIAL_R, 0.0),
    ]
    # rehaut (last band) takes the dial material so it reads black under the crystal
    mats = [0] * (len(profile) - 2) + [1]
    M.lathe(b, profile, seg, mats=mats)
    for k, f in enumerate(b.faces):
        if b.mats[k] == 1:
            b.uvs[k] = [(0.02, 0.02)] * len(f)

    # lugs, built for +x +y then mirrored
    lug = M.MeshBuilder()
    ys = [15.2, 17.6, 20.0, 22.1, 23.4, 24.0]
    zt = [1.1, 0.35, -1.0, -2.75, -3.85, -4.45]
    zb = [-5.45, -5.55, -5.95, -6.55, -7.0, -7.2]
    x0, x1 = LUG_X
    rings = []
    for y, t, bo in zip(ys, zt, zb):
        shrink = 0.35 if y >= 23.9 else 0.0
        a0, a1 = x0 + shrink, x1 - shrink
        c = 0.45
        sec = [(a0 + c, bo), (a1 - c, bo), (a1, bo + c), (a1, t - c), (a1 - c, t), (a0 + c, t), (a0, t - c), (a0, bo + c)]
        rings.append(lug.add_verts([(x, y, z) for (x, z) in sec]))
    for k in range(len(rings) - 1):
        ra, rb = rings[k], rings[k + 1]
        for i in range(8):
            j = (i + 1) % 8
            lug.f((ra[i], rb[i], rb[j], ra[j]), 0)
    # sections run clockwise seen from +y: start cap as is, tip cap reversed
    lug.f(tuple(rings[0]), 0, smooth=False)
    lug.f(tuple(reversed(rings[-1])), 0, smooth=False)
    for sx in (1, -1):
        for sy in (1, -1):
            part = M.MeshBuilder()
            part.merge(lug)
            part.transform(lambda v, sx=sx, sy=sy: np.array([v[0] * sx, v[1] * sy, v[2]]))
            if sx * sy < 0:
                part.faces = [tuple(reversed(f)) for f in part.faces]
                part.uvs = [list(reversed(u)) for u in part.uvs]
            b.merge(part)

    # crown guards at 3 o'clock
    guard_outline = [(19.4, 4.15), (23.0, 4.15), (23.55, 4.75), (23.35, 5.95), (22.2, 6.95), (19.4, 7.7)]
    for sy in (1, -1):
        g = M.MeshBuilder()
        M.prism(g, guard_outline, -4.5, 0.55, smooth_side=False, bottom=True)
        if sy < 0:
            g.transform(lambda v: np.array([v[0], -v[1], v[2]]))
            g.faces = [tuple(reversed(f)) for f in g.faces]
            g.uvs = [list(reversed(u)) for u in g.uvs]
        b.merge(g)
    _norm_uvs(b)
    return b


def build_crown():
    b = M.MeshBuilder()
    seg = 36
    profile = [(1.7, 19.9), (1.7, 21.2), (3.0, 21.3), (3.3, 21.8), (3.3, 23.9), (2.8, 24.4), (0.0, 24.45)]
    rings = M.lathe(b, profile, seg)
    # knurl the grip rings: every other vertex pulled in
    for rk in (rings[3], rings[4]):
        for i, vi in enumerate(rk):
            if i % 2 == 1:
                x, y, z = b.verts[vi]
                b.verts[vi] = (x * 0.9, y * 0.9, z)
    # lathe axis is z, the crown points along +x at CROWN_Z
    b.transform(lambda v: np.array([v[2], v[1], -v[0] + CROWN_Z]))
    _norm_uvs(b)
    return b


# ---------------------------------------------------------------- bezel
BEZEL_INSERT = (16.3, 19.4)


def build_bezel():
    """mat 0 steel, 1 insert (u = angle clockwise from 12, v = radius), 2 lume"""
    b = M.MeshBuilder()
    teeth = 120
    n_t = teeth * 2
    seg = 60

    def ring_cw(r_fn, z, n):
        idx = []
        for i in range(n):
            a = 2 * math.pi * i / n
            r = r_fn(i)
            idx.append(b.v((r * math.sin(a), r * math.cos(a), z)))
        return idx

    # rings run clockwise seen from above, so faces are wound to point out
    t_lo = ring_cw(lambda i: 20.85 if i % 2 == 0 else 20.52, 1.45, n_t)
    t_hi = ring_cw(lambda i: 20.85 if i % 2 == 0 else 20.52, 3.25, n_t)
    for i in range(n_t):
        j = (i + 1) % n_t
        b.f((t_lo[i], t_hi[i], t_hi[j], t_lo[j]), 0)
    rim0 = ring_cw(lambda i: 20.3, 3.62, seg)
    _bridge_many_to_one(b, t_hi, rim0, 0)
    rim1 = ring_cw(lambda i: 19.9, 3.8, seg)
    rim2 = ring_cw(lambda i: 19.45, 3.8, seg)
    ins_o = ring_cw(lambda i: BEZEL_INSERT[1], 3.72, seg)
    for ra, rb in ((rim0, rim1), (rim1, rim2), (rim2, ins_o)):
        for i in range(seg):
            j = (i + 1) % seg
            b.f((ra[i], rb[i], rb[j], ra[j]), 0)
    # insert ring with its own seam at 12 so u runs 0..1 clockwise
    ins_i_pts = []
    for i in range(seg + 1):
        a = 2 * math.pi * i / seg
        ins_i_pts.append(a)
    r0, r1 = BEZEL_INSERT
    outer = [b.v((r1 * math.sin(a), r1 * math.cos(a), 3.72)) for a in ins_i_pts]
    inner = [b.v((r0 * math.sin(a), r0 * math.cos(a), 3.8)) for a in ins_i_pts]
    for i in range(seg):
        u0, u1 = i / seg, (i + 1) / seg
        b.f((outer[i], inner[i], inner[i + 1], outer[i + 1]), 1, uv=[(u0, 1.0), (u0, 0.0), (u1, 0.0), (u1, 1.0)])
    lip0 = ring_cw(lambda i: r0, 3.8, seg)
    lip1 = ring_cw(lambda i: 16.12, 3.9, seg)
    lip2 = ring_cw(lambda i: 15.92, 3.88, seg)
    lip3 = ring_cw(lambda i: 15.8, 3.55, seg)
    lip4 = ring_cw(lambda i: 15.8, 2.7, seg)
    for ra, rb in ((lip0, lip1), (lip1, lip2), (lip2, lip3), (lip3, lip4)):
        for i in range(seg):
            j = (i + 1) % seg
            b.f((ra[i], rb[i], rb[j], ra[j]), 0)
    # lume pip at 12 in a steel cup
    cup = M.MeshBuilder()
    M.prism(cup, M.circle2(1.25, 12, 0.0, 18.0), 3.7, 4.05, inset=M.circle2(0.95, 12, 0.0, 18.0), mat_inset=2, inset_depth=-0.08)
    b.merge(cup)
    _polar_uvs(b, r0, r1, skip_mat=1)
    return b


def _bridge_many_to_one(b, many, few, mat):
    """joins a dense ring to a sparse one (len(many) divisible by len(few))"""
    k = len(many) // len(few)
    n = len(few)
    for i in range(n):
        j = (i + 1) % n
        base = i * k
        for t in range(k):
            a = many[(base + t) % len(many)]
            c = many[(base + t + 1) % len(many)]
            b.f((a, few[i], c) if t < k // 2 else (a, few[j], c), mat)
        # fill the gap between few[i], few[j] and the middle of the dense span
        mid = many[(base + k // 2) % len(many)]
        b.f((mid, few[i], few[j]), mat)


# ---------------------------------------------------------------- crystal, dial, indices, hands
def build_crystal():
    b = M.MeshBuilder()
    profile = [(0.0, 2.45), (15.5, 2.45), (15.62, 2.7), (15.62, 3.32), (13.8, 3.9), (9.5, 4.5), (4.8, 4.82), (0.0, Z_TOP)]
    M.lathe(b, profile, 40)
    _norm_uvs(b)
    return b


def build_dial():
    b = M.MeshBuilder()
    seg = 48
    centre = b.v((0.0, 0.0, 0.0))
    rim = M.ring(b, DIAL_R, 0.0, seg)
    for i in range(seg):
        j = (i + 1) % seg
        face = (rim[i], rim[j], centre)
        b.f(face, 0, uv=[(0.5 + b.verts[k][0] / (2 * DIAL_R), 0.5 + b.verts[k][1] / (2 * DIAL_R)) for k in face], smooth=False)
    return b


def _rot2(pts, ang):
    c, s = math.cos(ang), math.sin(ang)
    return [(x * c + y * s, -x * s + y * c) for (x, y) in pts]


def build_indices():
    """mat 0 steel frame, 1 lume fill"""
    b = M.MeshBuilder()
    h = 0.55
    for hour in range(12):
        ang = hour * math.pi / 6.0  # clockwise from 12
        if hour == 0:
            outline = [(-1.95, 14.15), (0.0, 10.55), (1.95, 14.15)]
        elif hour % 3 == 0:
            outline = [(-1.1, 10.45), (1.1, 10.45), (1.1, 14.15), (-1.1, 14.15)]
        else:
            outline = M.circle2(1.38, 10, 0.0, 12.75, start=math.pi / 10)
        outline = _rot2(outline, ang)
        inset = M.offset_polygon(outline, 0.34)
        M.prism(b, outline, 0.0, h, mat_side=0, mat_top=0, inset=inset, mat_inset=1, inset_depth=0.06)
    _norm_uvs(b)
    return b


def _hand(outline, lume, z0, z1, hub_r, hub_z1, lollipop=None):
    b = M.MeshBuilder()
    if lume is not None:
        M.prism(b, outline, z0, z1, mat_side=0, mat_top=0, inset=lume, mat_inset=1, inset_depth=0.03)
    else:
        M.prism(b, outline, z0, z1)
    M.prism(b, M.circle2(hub_r, 12), z0, hub_z1)
    if lollipop is not None:
        cy, r = lollipop
        M.prism(b, M.circle2(r, 12, 0.0, cy), z0, z1, inset=M.circle2(r - 0.3, 12, 0.0, cy), mat_inset=1, inset_depth=0.03)
    _norm_uvs(b)
    return b


def build_hands():
    hour = _hand(
        [(-0.6, 1.0), (-1.2, 3.5), (-1.15, 7.1), (0.0, 9.2), (1.15, 7.1), (1.2, 3.5), (0.6, 1.0)],
        [(-0.42, 2.4), (-0.78, 3.7), (-0.74, 6.95), (0.0, 8.35), (0.74, 6.95), (0.78, 3.7), (0.42, 2.4)],
        0.72, 0.95, 1.45, 1.0)
    minute = _hand(
        [(-0.5, 1.0), (-0.95, 3.8), (-0.88, 11.2), (0.0, 13.3), (0.88, 11.2), (0.95, 3.8), (0.5, 1.0)],
        [(-0.34, 2.5), (-0.62, 3.95), (-0.56, 11.0), (0.0, 12.4), (0.56, 11.0), (0.62, 3.95), (0.34, 2.5)],
        1.08, 1.30, 1.15, 1.35)
    second = _hand(
        [(-0.55, -3.9), (0.55, -3.9), (0.22, 0.0), (0.11, 14.4), (-0.11, 14.4), (-0.22, 0.0)],
        None, 1.42, 1.58, 0.8, 1.78, lollipop=(10.3, 0.95))
    return {"watch_hand_hour": hour, "watch_hand_minute": minute, "watch_hand_second": second}


# ---------------------------------------------------------------- strap
def build_strap(frame):
    """rubber strap, steel buckle, keepers. mat 0 rubber, 1 steel.

    built in the left arm frame (mm, origin on the left wrist joint) and moved
    into the watch frame at the end.
    """
    s_mid = P.WATCH_S
    wrist_l = P.mirror_x(P.WRIST_R)
    fr = np.asarray(frame)
    to_arm = lambda p_local: ((fr[:3, :3] @ (np.asarray(p_local) * MM) + fr[:3, 3]) - wrist_l) / MM

    def skin(theta, s_cm, off_mm):
        half_w, top, bot, n = P.forearm_section(s_cm)
        x, z = A.section_point(half_w, top, bot, n, theta, off_mm / 10.0)
        return np.array([x * 10.0, -s_cm * 10.0, z * 10.0])

    def skin_n(theta, s_cm):
        p0 = skin(theta, s_cm, 0.0)
        p1 = skin(theta, s_cm, 1.0)
        return (p1 - p0) / np.linalg.norm(p1 - p0)

    axis = np.array([0.0, 1.0, 0.0])  # along the arm, towards the hand
    clear = P.STRAP_CLEARANCE / MM
    t_mid = clear + STRAP_T * 0.5

    sb12 = to_arm((0.0, SPRING_BAR[0], SPRING_BAR[1]))
    sb6 = to_arm((0.0, -SPRING_BAR[0], SPRING_BAR[1]))
    # 12 side is -x in the left arm frame (theta near pi), 6 side is +x
    th_a = math.radians(158.0)
    th_b = math.radians(382.0)
    n_main = 34
    thetas = np.linspace(th_a, th_b, n_main)

    def centre(theta):
        return skin(theta, s_mid, t_mid)

    def tangent(theta):
        d = centre(theta + 1e-3) - centre(theta - 1e-3)
        return d / np.linalg.norm(d)

    pts, ts = [], []
    # lead in from the 12 o'clock spring bar
    p3 = centre(th_a)
    tan3 = tangent(th_a)
    p0 = sb12
    d0 = p3 - p0
    L = np.linalg.norm(d0)
    dir0 = np.array([-0.55, 0.0, -1.0])
    dir0 /= np.linalg.norm(dir0)
    for k in range(5):
        t = k / 5.0
        p = _bezier(p0, p0 + dir0 * L * 0.4, p3 - tan3 * L * 0.4, p3, t)
        pts.append(p)
        ts.append(("lead", t))
    for th in thetas:
        pts.append(centre(th))
        ts.append(("wrap", th))
    p0 = centre(th_b)
    tan0 = tangent(th_b)
    p3 = sb6
    L = np.linalg.norm(p3 - p0)
    dir3 = np.array([-0.55, 0.0, 1.0])
    dir3 /= np.linalg.norm(dir3)
    for k in range(1, 6):
        t = k / 5.0
        pts.append(_bezier(p0, p0 + tan0 * L * 0.4, p3 - dir3 * L * 0.4, p3, t))
        ts.append(("lead", 1.0 - t))
    pts = np.array(pts)

    half_w = STRAP_W * 0.5
    c = 0.8
    section = [(-half_w + c, -STRAP_T / 2), (half_w - c, -STRAP_T / 2), (half_w, -STRAP_T / 2 + c), (half_w, STRAP_T / 2 - c),
               (half_w - c, STRAP_T / 2), (-half_w + c, STRAP_T / 2), (-half_w, STRAP_T / 2 - c), (-half_w, -STRAP_T / 2 + c)]
    b = M.MeshBuilder()
    rings = []
    for k, p in enumerate(pts):
        if k == 0:
            tan = pts[1] - pts[0]
        elif k == len(pts) - 1:
            tan = pts[-1] - pts[-2]
        else:
            tan = pts[k + 1] - pts[k - 1]
        tan = tan / np.linalg.norm(tan)
        nrm = np.cross(tan, axis)  # outward for this winding direction
        if np.dot(nrm, p - np.array([0.0, p[1], 0.0])) < 0:
            nrm = -nrm
        nrm /= np.linalg.norm(nrm)
        kind, val = ts[k]
        verts = []
        for (w, t) in section:
            if kind == "wrap":
                # hug the skin across the whole width, the forearm tapers
                verts.append(skin(val, s_mid - w / 10.0, t_mid + t))
            else:
                verts.append(p + axis * w + nrm * t)
        rings.append(b.add_verts(verts))
    for k in range(len(rings) - 1):
        ra, rb = rings[k], rings[k + 1]
        for i in range(8):
            j = (i + 1) % 8
            b.f((ra[i], ra[j], rb[j], rb[i]), 0)
    b.f(tuple(reversed(rings[0])), 0, smooth=False)
    b.f(tuple(rings[-1]), 0, smooth=False)
    _fix_winding_outward(b, rings, pts)

    # tail on top of the band from the buckle back towards the 12 side, keepers
    bottom = math.radians(270.0)
    tail = M.MeshBuilder()
    t_th = np.linspace(math.radians(262.0), math.radians(196.0), 12)
    t_rings = []
    lift = clear + STRAP_T + 0.25 + STRAP_T * 0.45
    tw = half_w - 0.4
    tsec = [(-tw + c, -1.3), (tw - c, -1.3), (tw, -0.5), (tw, 0.5), (tw - c, 1.3), (-tw + c, 1.3), (-tw, 0.5), (-tw, -0.5)]
    for k, th in enumerate(t_th):
        # rounded tail end: the last two rings narrow and thin out
        last = len(t_th) - 1
        ws = 1.0 if k < last - 1 else (0.86 if k == last - 1 else 0.55)
        ts_ = 1.0 if k < last else 0.6
        verts = [skin(th, s_mid - w * ws / 10.0, lift + t * ts_) for (w, t) in tsec]
        t_rings.append(tail.add_verts(verts))
    for k in range(len(t_rings) - 1):
        ra, rb = t_rings[k], t_rings[k + 1]
        for i in range(8):
            j = (i + 1) % 8
            tail.f((ra[i], ra[j], rb[j], rb[i]), 0)
    tail.f(tuple(reversed(t_rings[0])), 0, smooth=False)
    tail.f(tuple(t_rings[-1]), 0, smooth=False)
    _fix_winding_outward(tail, t_rings, None)
    b.merge(tail)

    for th_deg in (246.0, 222.0):
        th = math.radians(th_deg)
        # keeper: a rectangular rubber loop around both layers, 1 mm wall
        kp = M.MeshBuilder()
        in_lo, in_hi = clear - 0.1, clear + STRAP_T * 2 + 0.35
        kw_in = half_w + 0.15
        wall = 1.0
        outer_loop = [(-kw_in - wall, in_lo - wall * 0.6), (kw_in + wall, in_lo - wall * 0.6),
                      (kw_in + wall, in_hi + wall), (-kw_in - wall, in_hi + wall)]
        inner_loop = [(-kw_in, in_lo), (kw_in, in_lo), (kw_in, in_hi), (-kw_in, in_hi)]
        rk = {}
        for side, dth in (("a", -0.06), ("b", 0.06)):
            rk[side + "o"] = kp.add_verts([skin(th + dth, s_mid - w / 10.0, t) for (w, t) in outer_loop])
            rk[side + "i"] = kp.add_verts([skin(th + dth, s_mid - w / 10.0, t) for (w, t) in inner_loop])
        for i in range(4):
            j = (i + 1) % 4
            kp.f((rk["ao"][i], rk["ao"][j], rk["bo"][j], rk["bo"][i]), 0, smooth=False)  # outside
            kp.f((rk["ai"][j], rk["ai"][i], rk["bi"][i], rk["bi"][j]), 0, smooth=False)  # inside
            kp.f((rk["ao"][j], rk["ao"][i], rk["ai"][i], rk["ai"][j]), 0, smooth=False)  # edge a
            kp.f((rk["bo"][i], rk["bo"][j], rk["bi"][j], rk["bi"][i]), 0, smooth=False)  # edge b
        _orient_by_centroid(kp, skin(th, s_mid, (in_lo + in_hi) * 0.5), outside_first=True)
        b.merge(kp)

    # buckle frame and tongue sitting over the tail start
    buckle = M.MeshBuilder()
    bl = clear + STRAP_T + 0.9
    frame_pts = []
    bw = half_w + 1.6
    for (w, dth) in ((-bw, -0.07), (bw, -0.07), (bw, 0.075), (-bw, 0.075)):
        frame_pts.append(skin(bottom + dth, s_mid - w / 10.0, bl))
    frame_pts = np.array(frame_pts)
    wire = 1.1
    for i in range(4):
        a_, b_ = frame_pts[i], frame_pts[(i + 1) % 4]
        _box_between(buckle, a_, b_, wire, skin_n(bottom, s_mid), 1)
    tongue_a = skin(bottom - 0.07, s_mid, bl + 0.2)
    tongue_b = skin(bottom + 0.07, s_mid, bl + 0.6)
    _box_between(buckle, tongue_a, tongue_b, 0.65, skin_n(bottom, s_mid), 1)
    b.merge(buckle)

    # arm frame mm -> watch frame mm
    inv_r = fr[:3, :3].T
    org = fr[:3, 3]
    b.transform(lambda v: inv_r @ (((v * MM) + wrist_l) - org) / MM)
    _norm_uvs(b)
    return b


def _bezier(p0, p1, p2, p3, t):
    u = 1 - t
    return u ** 3 * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t ** 3 * p3


def _box_between(b, a, c, thick, up, mat):
    """square bar from a to c, 'up' picks the roll"""
    d = c - a
    L = np.linalg.norm(d)
    t = d / L
    u = up - t * np.dot(up, t)
    u /= np.linalg.norm(u)
    s = np.cross(t, u)
    h = thick * 0.5
    ext = t * h
    corners = []
    for p in (a - ext, c + ext):
        corners.append([p + (s * sx + u * sy) * h for (sx, sy) in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
    ra = b.add_verts(corners[0])
    rb = b.add_verts(corners[1])
    for i in range(4):
        j = (i + 1) % 4
        b.f((ra[i], ra[j], rb[j], rb[i]), mat, smooth=False)
    b.f(tuple(reversed(ra)), mat, smooth=False)
    b.f(tuple(rb), mat, smooth=False)
    # make sure the little box faces out
    centre = (a + c) * 0.5
    fi = len(b.faces) - 6
    f0 = b.faces[fi]
    v0, v1, v2 = (np.array(b.verts[k]) for k in f0[:3])
    if np.dot(np.cross(v1 - v0, v2 - v0), (v0 + v1 + v2) / 3 - centre) < 0:
        for k in range(fi, len(b.faces)):
            b.faces[k] = tuple(reversed(b.faces[k]))


def _orient_by_centroid(b, centre, outside_first=True):
    """flip every face if face 0 (an outside face) points towards centre"""
    f = b.faces[0]
    v0, v1, v2 = (np.array(b.verts[i]) for i in f[:3])
    nrm = np.cross(v1 - v0, v2 - v0)
    c = np.mean([b.verts[i] for i in f], axis=0)
    if np.dot(nrm, c - np.asarray(centre)) < 0:
        b.faces = [tuple(reversed(x)) for x in b.faces]
        b.uvs = [list(reversed(u)) for u in b.uvs]


def _fix_winding_outward(b, rings, pts):
    """flip the faces added for these rings if they point into the band"""
    first = rings[0][0]
    last = rings[-1][-1]
    faces = [k for k, f in enumerate(b.faces) if first <= min(f) and max(f) <= last]
    if not faces:
        return
    ring_centres = [np.mean([b.verts[i] for i in r], axis=0) for r in rings]
    votes = 0.0
    for k in faces[: max(1, len(faces) // 2)]:
        f = b.faces[k]
        v0, v1, v2 = (np.array(b.verts[i]) for i in f[:3])
        nrm = np.cross(v1 - v0, v2 - v0)
        c = (v0 + v1 + v2) / 3.0
        # nearest ring centre as the inside reference
        rc = min(ring_centres, key=lambda q: np.linalg.norm(q - c))
        votes += np.dot(nrm, c - rc)
    if votes < 0:
        for k in faces:
            b.faces[k] = tuple(reversed(b.faces[k]))
            b.uvs[k] = list(reversed(b.uvs[k]))


def _norm_uvs(b):
    """dummy planar uvs kept inside 0..1 for untextured parts (so they quantize)"""
    for k, f in enumerate(b.faces):
        uv = b.uvs[k]
        if all(0.0 <= u <= 1.0 and 0.0 <= v <= 1.0 for (u, v) in uv):
            continue
        b.uvs[k] = [(0.5 + b.verts[i][0] / 150.0, 0.5 + b.verts[i][1] / 150.0) for i in f]


def _polar_uvs(b, r0, r1, skip_mat=None):
    """u = angle clockwise from 12, v = radius mapped r0..r1 (clamped), for
    every face of the bezel so a canvas painted over the whole mesh lines up"""
    for k, f in enumerate(b.faces):
        if skip_mat is not None and b.mats[k] == skip_mat:
            continue
        us, vs = [], []
        for i in f:
            x, y, _ = b.verts[i]
            us.append(math.atan2(x, y) / (2 * math.pi) % 1.0)
            vs.append(min(max((math.hypot(x, y) - r0) / (r1 - r0), 0.0), 1.0))
        if max(us) - min(us) > 0.5:
            # face straddles 12 o'clock: pin its wrapped corners to the far edge
            us = [u if u > 0.5 else 1.0 for u in us]
        b.uvs[k] = list(zip(us, vs))


# ---------------------------------------------------------------- textures
def draw_dial_texture(size=512, ss=2):
    """matte black dial with a printed minute track (rgba float, bottom row first)"""
    n = size * ss
    ys, xs = np.mgrid[0:n, 0:n]
    u = (xs + 0.5) / n
    v = (ys + 0.5) / n
    x = (u - 0.5) * 2 * DIAL_R
    y = (v - 0.5) * 2 * DIAL_R
    r = np.sqrt(x * x + y * y)
    ang = np.mod(np.arctan2(x, y), 2 * math.pi)  # clockwise from 12
    base = np.full((n, n, 3), 0.014)
    ink = np.zeros((n, n))
    minute = ang / (2 * math.pi) * 60.0
    dm = np.abs(minute - np.round(minute)) * (2 * math.pi * r / 60.0)
    five = (np.mod(np.round(minute), 5) == 0)
    tick_len = np.where(five, 1.1, 0.7)
    in_track = (r > 14.7 - tick_len) & (r < 14.75)
    w = np.where(five, 0.2, 0.11)
    ink = np.maximum(ink, np.clip((w - dm) / 0.05, 0, 1) * in_track)
    ring = np.clip((0.06 - np.abs(r - 14.78)) / 0.04, 0, 1)
    ink = np.maximum(ink, ring)
    col = base * (1 - ink[..., None]) + np.array([0.78, 0.78, 0.74]) * ink[..., None]
    col = np.where((r > DIAL_R)[..., None], 0.014, col)
    img = _downsample(col, ss)
    return np.concatenate([img, np.ones(img.shape[:2] + (1,))], axis=2)


# simple stroke digits in a 1 x 1.6 box
DIGITS = {
    "0": [[(0.5, 0.0), (0.82, 0.12), (0.98, 0.5), (0.98, 1.1), (0.82, 1.48), (0.5, 1.6), (0.18, 1.48), (0.02, 1.1), (0.02, 0.5), (0.18, 0.12), (0.5, 0.0)]],
    "1": [[(0.22, 1.28), (0.55, 1.6), (0.55, 0.0)]],
    "2": [[(0.05, 1.28), (0.28, 1.55), (0.68, 1.58), (0.94, 1.3), (0.9, 0.98), (0.05, 0.0), (0.97, 0.0)]],
    "3": [[(0.06, 1.42), (0.38, 1.6), (0.76, 1.52), (0.9, 1.22), (0.66, 0.9), (0.36, 0.86)],
          [(0.66, 0.9), (0.94, 0.62), (0.88, 0.2), (0.52, 0.0), (0.08, 0.12)]],
    "4": [[(0.72, 0.0), (0.72, 1.6), (0.02, 0.5), (0.98, 0.5)]],
    "5": [[(0.9, 1.6), (0.16, 1.6), (0.1, 0.9), (0.5, 1.0), (0.86, 0.8), (0.92, 0.4), (0.66, 0.04), (0.3, 0.0), (0.05, 0.18)]],
}


def _stroke_ink(px, py, strokes, half_width):
    d = np.full(px.shape, 1e9)
    for poly in strokes:
        for (ax, ay), (bx, by) in zip(poly[:-1], poly[1:]):
            ex, ey = bx - ax, by - ay
            t = np.clip(((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey + 1e-12), 0, 1)
            dx, dy = px - (ax + ex * t), py - (ay + ey * t)
            d = np.minimum(d, np.sqrt(dx * dx + dy * dy))
    return d - half_width


def draw_bezel_texture(width=1024, height=64, ss=4):
    """insert markings: u = angle clockwise from 12, v = radius inner..outer"""
    w, h = width * ss, height * ss
    ys, xs = np.mgrid[0:h, 0:w]
    u = (xs + 0.5) / w
    v = (ys + 0.5) / h
    r0, r1 = BEZEL_INSERT
    r = r0 + v * (r1 - r0)
    ang = u * 2 * math.pi
    minute = u * 60.0
    ink = np.zeros((h, w))
    # physical coordinates relative to each marker: tangential (mm), radial (mm)
    nearest = np.round(minute)
    tang = (minute - nearest) / 60.0 * 2 * math.pi * r
    m_int = np.mod(nearest, 60).astype(int)
    # minute ticks in the first quarter, bars on the 5s, dots elsewhere
    first_q = (m_int > 0) & (m_int < 15)
    tick = first_q & (np.mod(m_int, 5) != 0) & (np.abs(tang) < 0.13) & (r > r1 - 1.05) & (r < r1 - 0.25)
    ink = np.maximum(ink, tick.astype(float))
    bar5 = (np.mod(m_int, 5) == 0) & (m_int % 10 != 0) & (np.abs(tang) < 0.3) & (r > r1 - 1.9) & (r < r1 - 0.25)
    ink = np.maximum(ink, bar5.astype(float))
    dots = (~first_q) & (np.mod(m_int, 5) != 0) & (np.sqrt(tang ** 2 + (r - (r1 - 0.7)) ** 2) < 0.26)
    ink = np.maximum(ink, dots.astype(float))
    # triangle at 12 (the lume pip sits in it)
    tri_r = r - (r0 + 0.35)
    in_tri = (tri_r > 0) & (tri_r < 2.6) & (np.abs(tang) < tri_r * 0.62)
    ink = np.maximum(ink, (in_tri & (m_int == 0)).astype(float))
    # numerals 10..50, tops pointing out
    for val in (10, 20, 30, 40, 50):
        a_c = val / 60.0
        du = u - a_c
        tang_c = du * 2 * math.pi * r
        radial = r - (r0 + (r1 - r0) * 0.5)
        mask = (np.abs(du) < 0.03)
        glyph_h = 1.75
        sc = glyph_h / 1.6
        text = str(val)
        adv = 1.25 * sc
        total = adv * (len(text) - 1) + 1.0 * sc
        for gi, ch in enumerate(text):
            gx = (tang_c - (-total / 2 + gi * adv)) / sc
            gy = (radial + glyph_h / 2) / sc
            dd = _stroke_ink(gx, gy, DIGITS[ch], 0.13)
            ink = np.maximum(ink, np.clip(-dd * sc / 0.03, 0, 1) * mask)
    col = np.full((h, w, 3), 0.012) * (1 - ink[..., None]) + np.array([0.82, 0.82, 0.78]) * ink[..., None]
    img = _downsample(col, ss)
    return np.concatenate([img, np.ones(img.shape[:2] + (1,))], axis=2)


def _downsample(img, ss):
    h, w = img.shape[0] // ss, img.shape[1] // ss
    return img.reshape(h, ss, w, ss, -1).mean(axis=(1, 3))


# ---------------------------------------------------------------- assembly
def build_watch(arm_obj, materials, images):
    """creates the watch empty + children. returns (empty, objects, tri counts)"""
    frame = watch_frame()
    empty = bpy.data.objects.new("watch", None)
    empty.empty_display_type = "ARROWS"
    empty.empty_display_size = 0.02
    bpy.context.scene.collection.objects.link(empty)
    empty.parent = arm_obj
    empty.parent_type = "BONE"
    empty.parent_bone = "forearm_twist_l"
    bpy.context.view_layer.update()
    empty.matrix_world = Matrix([list(r) for r in frame])
    bpy.context.view_layer.update()

    mats = materials
    parts = {
        "watch_case": (build_case(), [mats["mat_watch_steel"], mats["mat_watch_dial"]]),
        "watch_bezel": (build_bezel(), [mats["mat_watch_steel"], mats["mat_watch_bezel"], mats["mat_watch_lume"]]),
        "watch_crystal": (build_crystal(), [mats["mat_watch_crystal"]]),
        "watch_dial": (build_dial(), [mats["mat_watch_dial"]]),
        "watch_indices": (build_indices(), [mats["mat_watch_steel"], mats["mat_watch_lume"]]),
        "watch_crown": (build_crown(), [mats["mat_watch_steel"]]),
        "watch_strap": (build_strap(frame), [mats["mat_watch_strap"], mats["mat_watch_steel"]]),
    }
    for name, builder in build_hands().items():
        parts[name] = (builder, [mats["mat_watch_steel"], mats["mat_watch_lume"]])
    objs = {}
    tris = {}
    for name, (builder, mlist) in parts.items():
        parent = empty
        mesh_name = name
        if name in PIVOTS:
            # the runtime rotates this node, so it is an empty on the dial centre
            # and the geometry hangs under it (the web optimizer rewrites leaf
            # mesh node transforms when it quantizes, which would move the pivot)
            pivot = bpy.data.objects.new(name, None)
            pivot.empty_display_type = "SINGLE_ARROW"
            pivot.empty_display_size = 0.01
            bpy.context.scene.collection.objects.link(pivot)
            pivot.parent = empty
            pivot.matrix_parent_inverse = Matrix.Identity(4)
            pivot.matrix_basis = Matrix.Identity(4)
            objs[name] = pivot
            parent = pivot
            mesh_name = f"{name}_mesh"
        obj = builder.to_object(mesh_name, mlist, scale=MM)
        obj.parent = parent
        obj.matrix_parent_inverse = Matrix.Identity(4)
        obj.matrix_basis = Matrix.Identity(4)
        objs[mesh_name] = obj
        tris[name] = builder.tri_count()
    bpy.context.view_layer.update()
    return empty, objs, tris, frame


PIVOTS = ("watch_bezel", "watch_hand_hour", "watch_hand_minute", "watch_hand_second")
