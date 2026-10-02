"""armor plates, mechanical parts and glow lines for the cyborg arms.

every piece is a small signed distance field in the right hand frame (cm),
meshed on its own. plates are thin shells over the muscle surface cut by a
footprint drawn in the surface's own coordinates:

  forearm: (u, s), u = arc length around the arm from the top centre line
           (+ towards the thumb side), s = cm from the wrist towards the elbow
  hand:    (x, y) seen from above the back of the hand
  digits:  (t, lat) along and across each finger segment

the pieces come in kits, one per arms piece of the armor sets, so a player's
arms pick change the plate shapes in first person. plates on a finger or the
hand are rigid on that bone; forearm plates bend with the muscle under them
so wrist roll never pushes the muscle through them.
"""

import math
from dataclasses import dataclass, field
from typing import Callable

import numpy as np

import arm as A
import params as P
import sdf
from suit import FAR, SuitShape

SUIT = SuitShape()
KITS = ("strafe", "anvil", "vector", "quill")
SQ = math.sqrt(0.5)


@dataclass
class Piece:
    name: str
    set: str  # core or a kit id
    slot: str  # primary, dark, metal, glow (the runtime's material slots)
    fn: Callable
    bounds: tuple
    voxel: float
    tris: int
    rig: object  # "arm" (weights follow the arm), a bone base name, or ("digit", name)
    foot: Callable | None = None  # footprint distance for edge wear and panel lines
    style: str = "plate"  # plate, mech, glow
    side: str = "both"  # both, r (right arm only) or l (left arm only, built in the right frame and mirrored)
    meta: dict = field(default_factory=dict)


# ---------------------------------------------------------------- helpers
def shell(d_surf, gap, th, foot, bevel=0.022, chamfer=0.0):
    """a plate between gap and gap + th over a surface, cut by a footprint"""
    ds = np.abs(d_surf - (gap + th * 0.5)) - th * 0.5
    d = sdf.op_extrude_round(foot + bevel, ds + bevel, bevel)
    if chamfer > 0.0:
        top = d_surf - (gap + th)
        d = np.maximum(d, (foot + top + chamfer) * SQ)
    return d


def dist_polyline(p, pts):
    d = np.full(len(p), np.inf)
    for a, b in zip(pts[:-1], pts[1:]):
        d = np.minimum(d, sdf.dist_segment(p, a, b))
    return d


def densify(path, step=0.12):
    """resample a 2d polyline so mapped 3d points follow the surface"""
    out = [np.asarray(path[0], dtype=np.float64)]
    for a, b in zip(path[:-1], path[1:]):
        a = np.asarray(a, dtype=np.float64)
        b = np.asarray(b, dtype=np.float64)
        n = max(1, int(math.ceil(np.linalg.norm(b - a) / step)))
        for k in range(1, n + 1):
            out.append(a + (b - a) * k / n)
    return np.array(out)


def bbox(points, margin):
    pts = np.asarray(points)
    return pts.min(axis=0) - margin, pts.max(axis=0) + margin


# ---------------------------------------------------------------- forearm frame
def arm_rm(s):
    half_w, top, bot, _ = A.core_section(s)
    return (half_w + (top - bot) * 0.5) * 0.5


def arm_coords(p):
    """(s, u) of points around the forearm"""
    s = -p[:, 1]
    sc = np.clip(s, -2.0, 40.0)
    half_w, top, bot, _ = A.core_section(sc)
    cz = (top + bot) * 0.5
    theta = np.arctan2(p[:, 2] - cz, p[:, 0])
    u = A._wrap(theta - math.pi / 2) * (half_w + (top - bot) * 0.5) * 0.5
    return s, u


def ang(deg, s):
    """u of an angle around the arm (0 = little finger side, 90 = top, 180 = thumb side)"""
    return math.radians(deg - 90.0) * float(arm_rm(s))


def arm_point(u, s, off):
    """3d point (cm, hand frame) on the muscle at (u, s), pushed out by off"""
    u = np.asarray(u, dtype=np.float64)
    s = np.asarray(s, dtype=np.float64)
    half_w, top, bot, n = A.core_section(s)
    theta = math.pi / 2 + u / ((half_w + (top - bot) * 0.5) * 0.5)
    x, z = A.section_point(half_w, top, bot, n, theta, A.muscle_offset(theta, s) + off)
    return np.stack([x, -s + 0.0 * x, z], axis=-1)


def arm_bounds(poly, off_hi, margin=0.3):
    poly = np.asarray(poly)
    us = np.linspace(poly[:, 0].min(), poly[:, 0].max(), 24)
    ss = np.linspace(poly[:, 1].min(), poly[:, 1].max(), 24)
    uu, ss = np.meshgrid(us, ss)
    pts = np.concatenate([arm_point(uu.ravel(), ss.ravel(), o) for o in (-0.1, off_hi)])
    return bbox(pts, margin)


def arm_surface(p):
    d, _ = SUIT.arm_surface(p)
    return d


def forearm_plate(name, kit, poly, gap=0.03, th=0.16, chamfer=0.05, rc=0.12, glow_paths=(), groove_r=0.085,
                  clip_s=None, tris=900, layer=0.0):
    """a forearm plate. plates that reach into the watch zone get a right arm
    version and a left arm twin cut back past the watch strap"""
    poly = np.asarray(poly, dtype=np.float64)
    start = P.PLATE_START_S
    if poly[:, 1].min() >= start:
        return _forearm_plate(name, kit, poly, gap, th, chamfer, rc, glow_paths, groove_r, clip_s, None, tris,
                              layer, "both")
    out = _forearm_plate(name, kit, poly, gap, th, chamfer, rc, glow_paths, groove_r, clip_s, None, tris, layer, "r")
    if poly[:, 1].max() - start > 2.0:
        paths = [[q for q in path if q[1] > start + 0.35] for path in glow_paths]
        paths = [p for p in paths if len(p) >= 2]
        lo_poly = poly.copy()
        out += _forearm_plate(f"{name}_l", kit, lo_poly, gap, th, chamfer, rc, paths, groove_r, clip_s, start,
                              tris, layer, "l")
    return out


def _forearm_plate(name, kit, poly, gap, th, chamfer, rc, glow_paths, groove_r, clip_s, min_s, tris, layer, side):
    base = gap + layer

    def foot(p):
        s, u = arm_coords(p)
        f = sdf.sd_polygon2(u, s, poly) - rc
        if clip_s is not None:
            f = np.maximum(f, s - clip_s)
        if min_s is not None:
            f = np.maximum(f, min_s - s)
        return f

    grooves = [densify(path) for path in glow_paths]
    grooves3 = [arm_point(g[:, 0], g[:, 1], base + th) for g in grooves]

    def fn(p):
        d = shell(arm_surface(p), base, th, foot(p), chamfer=chamfer)
        for g in grooves3:
            d = sdf.smax(d, groove_r - dist_polyline(p, g), 0.02)
        return d

    bpoly = poly.copy()
    if min_s is not None:
        bpoly[:, 1] = np.maximum(bpoly[:, 1], min_s - 0.3)
    pieces = [Piece(name, kit, "primary", fn, arm_bounds(bpoly, base + th + 0.1, 0.35 + rc), 0.035, tris, "arm", foot,
                    side=side)]
    for k, g in enumerate(grooves):
        glow = glow_strip(f"{name}_glow{k}", kit, arm_point(g[:, 0], g[:, 1], base + th - 0.05), "arm")
        glow.side = side
        pieces.append(glow)
    return pieces


# ---------------------------------------------------------------- glow
def glow_strip(name, kit, pts3, rig, r=0.055):
    pts3 = np.asarray(pts3, dtype=np.float64)

    def fn(p):
        return dist_polyline(p, pts3) - r

    return Piece(name, kit, "glow", fn, bbox(pts3, r + 0.12), 0.016, max(80, int(len(pts3) * 9)), rig,
                 style="glow")


# ---------------------------------------------------------------- hand
def hand_top(x, y):
    return SUIT.palm_top(x, y)


def knuckle_line_y(x, margin):
    """y of the knuckle row (minus a margin) at x, flat past the index and pinky"""
    c = np.array([SUIT.knuckle_centre(n) for n in P.FINGER_ORDER])
    return np.interp(x, c[:, 0], c[:, 1]) - margin


SHELL_TH = 0.12
SHELL_GAP = 0.03


def hand_shell(name, kit, inset=0.25, margin=0.05, start=0.7, th=SHELL_TH, chamfer=0.035, tris=1800,
               glow_paths=(), groove_r=0.07):
    """the back of the hand as one shell: it follows the muscle over the
    metacarpals and onto the knuckle heads and wraps down the sides, so the
    hand reads armoured rather than a glove with a badge on it"""
    outline = SUIT.palm_outline

    def foot(p):
        x, y, z = p[:, 0], p[:, 1], p[:, 2]
        f = sdf.sd_polygon2(x, y, outline) + inset
        f = np.maximum(f, y - knuckle_line_y(x, margin))
        f = np.maximum(f, start - y)
        return np.maximum(f, 0.35 - z)

    grooves = [densify(path, 0.1) for path in glow_paths]
    grooves3 = []
    for g in grooves:
        q = np.stack([g[:, 0], g[:, 1], hand_top(g[:, 0], g[:, 1]) + 1.0], axis=1)
        # drop each path point onto the shell's top surface
        for _ in range(4):
            q[:, 2] -= SUIT.sd_palm(q) - (SHELL_GAP + th)
        grooves3.append(q)

    def fn(p):
        d = shell(SUIT.sd_palm(p), SHELL_GAP, th, foot(p), chamfer=chamfer)
        for g in grooves3:
            d = sdf.smax(d, groove_r - dist_polyline(p, g), 0.02)
        return d

    lo = np.array([outline[:, 0].min() - 0.3, start - 0.4, -0.4])
    hi = np.array([outline[:, 0].max() + 0.3, knuckle_line_y(0.0, margin) + 1.6, 3.0])
    pieces = [Piece(name, kit, "primary", fn, (lo, hi), 0.028, tris, "hand", foot)]
    for k, g3 in enumerate(grooves3):
        pieces.append(glow_strip(f"{name}_glow{k}", kit, g3 - np.array([0.0, 0.0, 0.05]), "hand"))
    return pieces


# top plates sit on the shell
ON_SHELL = SHELL_GAP + SHELL_TH - 0.04


def hand_plate(name, kit, poly, gap=0.06, th=0.15, chamfer=0.05, rc=0.12, glow_paths=(), groove_r=0.08,
               tris=700, slot="primary", layer=0.0):
    poly = np.asarray(poly, dtype=np.float64)
    base = gap + layer

    def foot(p):
        f = sdf.sd_polygon2(p[:, 0], p[:, 1], poly) - rc
        return np.maximum(f, 0.4 - p[:, 2])

    grooves = [densify(path, 0.1) for path in glow_paths]
    grooves3 = [np.stack([g[:, 0], g[:, 1], hand_top(g[:, 0], g[:, 1]) + base + th], axis=1) for g in grooves]

    def fn(p):
        d = shell(SUIT.sd_palm_slab(p), base, th, foot(p), chamfer=chamfer)
        for g in grooves3:
            d = sdf.smax(d, groove_r - dist_polyline(p, g), 0.02)
        return d

    xy = poly
    z = hand_top(xy[:, 0], xy[:, 1])
    lo = np.array([xy[:, 0].min(), xy[:, 1].min(), z.min() - 0.6])
    hi = np.array([xy[:, 0].max(), xy[:, 1].max(), z.max() + base + th + 0.3])
    pieces = [Piece(name, kit, slot, fn, (lo - 0.35, hi + 0.35), 0.028, tris, "hand", foot)]
    for k, (g, g3) in enumerate(zip(grooves, grooves3)):
        pieces.append(glow_strip(f"{name}_glow{k}", kit, g3 - np.array([0.0, 0.0, 0.05]), "hand"))
    return pieces


def knuckle_caps(name, kit, style, slot="dark", tris=420, layer=0.0):
    """caps over the four knuckle heads, rigid on the hand"""
    centres = [SUIT.knuckle_centre(n) for n in P.FINGER_ORDER]
    radii = [SUIT.fingers[n]["radii"][0] for n in P.FINGER_ORDER]

    if style == "bar":
        line = np.array([c[:2] for c in centres])
        line = np.concatenate([[line[0] + (line[0] - line[1]) * 0.35], line, [line[-1] + (line[-1] - line[-2]) * 0.3]])

        def surf(p):
            d = sdf.sd_sphere(p, centres[0], radii[0])
            for c, r in zip(centres[1:], radii[1:]):
                d = sdf.smin(d, sdf.sd_sphere(p, c, r), 1.3)
            return d

        def foot(p):
            q = np.stack([p[:, 0], p[:, 1], np.zeros(len(p))], axis=1)
            l3 = np.stack([line[:, 0], line[:, 1], np.zeros(len(line))], axis=1)
            f = dist_polyline(q, l3) - 0.62
            return np.maximum(f, 0.25 - (p[:, 2] - np.interp(p[:, 0], line[:, 0], [c[2] for c in [centres[0]] + centres + [centres[-1]]])))

        def fn(p):
            return shell(surf(p), 0.04 + layer, 0.17, foot(p), chamfer=0.06)

        lo = np.min(centres, axis=0) - 1.6
        hi = np.max(centres, axis=0) + 1.6
        return Piece(name, kit, slot, fn, (lo, hi), 0.026, tris, "hand", foot)

    def one_foot(p, c, r):
        dx = p[:, 0] - c[0]
        dy = p[:, 1] - c[1]
        if style == "oval":
            f = (np.sqrt((dx / (0.78 * r)) ** 2 + (dy / (0.92 * r)) ** 2) - 1.0) * 0.7 * r
        elif style == "diamond":
            f = (np.abs(dx) / (0.62 * r) + np.abs(dy) / (0.95 * r) - 1.0) * 0.45 * r
        else:  # disc
            f = np.sqrt(dx * dx + dy * dy) - 0.46 * r
        return np.maximum(f, 0.2 - (p[:, 2] - c[2]))

    def fn(p):
        d = np.full(len(p), FAR)
        for c, r in zip(centres, radii):
            d = np.minimum(d, shell(sdf.sd_sphere(p, c, r), 0.025 + layer, 0.1, one_foot(p, c, r), chamfer=0.035))
        return d

    def foot(p):
        f = np.full(len(p), FAR)
        for c, r in zip(centres, radii):
            f = np.minimum(f, one_foot(p, c, r))
        return f

    lo = np.min(centres, axis=0) - 1.3
    hi = np.max(centres, axis=0) + 1.3
    return Piece(name, kit, slot, fn, (lo, hi), 0.022, tris, "hand", foot)


# ---------------------------------------------------------------- digits
def digit_segments(digit):
    """per bone segment: (a, b, ra, rb, dorsal dir, side dir, bone)"""
    if digit == "thumb":
        t = SUIT.thumb
        pts, pads, radii = t["points"], t["pads"], t["radii"]
        tip_c = pts[3] - P.normalize(pts[3] - pts[2]) * radii[3]
        ends = [(pts[0], pts[1]), (pts[1], pts[2]), (pts[2], tip_c)]
        rr = [(radii[0], radii[1]), (radii[1], radii[2]), (radii[2], radii[3])]
        out = []
        for i, ((a, b), (ra, rb)) in enumerate(zip(ends, rr)):
            u = P.normalize(b - a)
            dors = -np.asarray(pads[i], dtype=np.float64)
            dors = P.normalize(dors - u * np.dot(dors, u))
            out.append((a, b, ra, rb, dors, np.cross(u, dors), f"thumb_{i + 1:02d}"))
        return out
    f = SUIT.fingers[digit]
    pts, radii, axis = f["points"], f["radii"], f["axis"]
    tip_c = pts[3] - P.normalize(pts[3] - pts[2]) * radii[3]
    ends = [(pts[0], pts[1]), (pts[1], pts[2]), (pts[2], tip_c)]
    out = []
    for i, (a, b) in enumerate(ends):
        u = P.normalize(b - a)
        dors = P.normalize(np.cross(u, axis))
        out.append((a, b, radii[i], radii[i + 1], dors, np.cross(u, dors), f"{digit}_{i + 1:02d}"))
    return out


def finger_plates(name, kit, digit, which, width=0.88, th=0.1, tip="round", gap=0.02, joint_gap=0.14,
                  knuckle_gap=0.5, chamfer=0.03, slot="primary", ventral=False):
    """dorsal plates on the chosen segments of one digit (0 = the bone nearest the hand),
    nearly end to end so the finger reads as segmented armour. ventral puts
    grip pads on the palm side instead, with wider joint gaps since that side
    folds shut when the finger curls"""
    segs = digit_segments(digit)
    shapes = []
    for i in which:
        a, b, ra, rb, dors, side, bone = segs[i]
        if ventral:
            dors, side = -dors, -side
        L = float(np.linalg.norm(b - a))
        t0 = knuckle_gap if (i == 0 and digit != "thumb") else joint_gap
        if digit == "thumb" and i == 0:
            t0 = 1.2
        distal = i == 2
        t1 = L + rb * (0.5 if ventral else 0.85) if distal else L - joint_gap
        w0 = width * (ra + (rb - ra) * t0 / L)
        w1 = width * (ra + (rb - ra) * min(t1, L) / L) * (0.82 if distal else 1.0)
        if tip == "point":
            poly = [(t0, -w0), (t1 - 0.45 * w1, -w1), (t1, 0.0), (t1 - 0.45 * w1, w1), (t0, w0)]
        elif tip == "square":
            poly = [(t0, -w0), (t1, -w1), (t1, w1), (t0, w0)]
        else:
            k = 0.5 if distal else 0.25
            poly = [(t0, -w0), (t1 - k * w1, -w1), (t1, -w1 * 0.45), (t1, w1 * 0.45), (t1 - k * w1, w1), (t0, w0)]
        shapes.append((a, b, ra, rb, dors, side, np.array(poly)))

    def seg_foot(p, a, b, dors, side, poly):
        q = p - a
        u = P.normalize(b - a)
        f = sdf.sd_polygon2(q @ u, q @ side, poly) - 0.05
        return np.maximum(f, 0.1 - q @ dors)

    def fn(p):
        d = np.full(len(p), FAR)
        for a, b, ra, rb, dors, side, poly in shapes:
            surf = sdf.sd_round_cone(p, a, b, ra, rb)
            d = np.minimum(d, shell(surf, gap, th, seg_foot(p, a, b, dors, side, poly), chamfer=chamfer))
        return d

    def foot(p):
        f = np.full(len(p), FAR)
        for a, b, ra, rb, dors, side, poly in shapes:
            f = np.minimum(f, seg_foot(p, a, b, dors, side, poly))
        return f

    pts = []
    for a, b, ra, rb, *_ in shapes:
        pts += [a, b]
    lo, hi = bbox(pts, max(s[2] for s in shapes) + th + 0.35)
    tris = 130 * len(shapes)
    return Piece(name, kit, slot, fn, (lo, hi), 0.022, tris, ("digit", digit), foot)


# ---------------------------------------------------------------- core
def core_pieces():
    out = []
    s0, s1 = P.WRIST_BAND_S
    sm = (s0 + s1) * 0.5
    hw = (s1 - s0) * 0.5

    def band_foot(p):
        s = -p[:, 1]
        # two rings with a narrow groove between them
        return np.maximum(np.abs(s - sm) - hw, 0.07 - np.abs(s - sm))

    def band(p):
        d, _ = SUIT.arm_surface(p, bumps=False)
        return shell(d, 0.0, 0.2, band_foot(p), bevel=0.03, chamfer=0.05)

    lo = np.array([-3.2, -s1 - 0.3, -2.4])
    hi = np.array([3.2, -s0 + 0.3, 2.4])
    out.append(Piece("wrist_band", "core", "dark", band, (lo, hi), 0.03, 1100, "arm", band_foot, style="mech"))

    # two cables on the palm side of the wrist, half sunk into the muscle
    rods = []
    for deg in (250.0, 290.0):
        path = densify([(ang(deg, 6.0), s1 + 0.3), (ang(deg, 6.0), 10.6)], 0.2)
        rods.append(arm_point(path[:, 0], path[:, 1], -0.03))

    def cables(p):
        d = np.full(len(p), FAR)
        for r in rods:
            d = np.minimum(d, dist_polyline(p, r) - 0.11)
            for end in (r[0], r[-1]):
                d = sdf.smin(d, sdf.sd_sphere(p, end, 0.17), 0.05)
        return d

    lo, hi = bbox(np.concatenate(rods), 0.45)
    out.append(Piece("cables", "core", "metal", cables, (lo, hi), 0.025, 700, "arm", None, style="mech"))

    # palm side: a segmented dark plate across the palm and pads on every digit
    outline = SUIT.palm_outline

    def palm_foot(p):
        x, y, z = p[:, 0], p[:, 1], p[:, 2]
        f = sdf.sd_polygon2(x, y, outline) + 0.45
        f = np.maximum(f, y - knuckle_line_y(x, 1.35))
        f = np.maximum(f, 1.0 - y)
        f = np.maximum(f, -1.6 - x)
        # a groove splits it into a heel and an upper plate
        f = np.maximum(f, 0.06 - np.abs(y - 5.2))
        return np.maximum(f, z + 0.45)

    def palm(p):
        return shell(SUIT.sd_palm(p), 0.02, 0.08, palm_foot(p), chamfer=0.03)

    lo = np.array([outline[:, 0].min(), 0.6, -2.6])
    hi = np.array([outline[:, 0].max(), knuckle_line_y(0.0, 0.0), 0.4])
    out.append(Piece("palm_plate", "core", "dark", palm, (lo, hi), 0.026, 600, "hand", palm_foot))
    for d in P.FINGER_ORDER:
        out.append(finger_plates(f"pads_{d}", "core", d, (0, 1, 2), width=0.6, th=0.07, joint_gap=0.3,
                                 knuckle_gap=1.0, slot="dark", ventral=True))
    out.append(finger_plates("pads_thumb", "core", "thumb", (1, 2), width=0.6, th=0.07, joint_gap=0.3,
                             slot="dark", ventral=True))
    return out


# ---------------------------------------------------------------- kits
def kit_strafe():
    k = "strafe"
    out = []
    main = [(0.6, 3.6), (1.8, 4.6), (2.5, 7.0), (2.9, 13.0), (3.0, 20.5), (2.5, 23.0), (-3.4, 23.2), (-4.5, 20.0),
            (-4.3, 12.0), (-3.0, 6.5), (-1.2, 4.0)]
    out += forearm_plate("strafe_fore", k, main, th=0.17, glow_paths=[[(-2.3, 13.5), (-2.5, 22.2)]], tris=1300)
    over = [(0.55, 4.1), (1.6, 5.0), (2.0, 9.8), (-2.5, 10.2), (-2.9, 6.5), (-1.0, 4.4)]
    out += forearm_plate("strafe_fore_top", k, over, layer=0.19, th=0.13, chamfer=0.04,
                         glow_paths=[[(-2.2, 9.6), (-1.4, 5.8), (-0.5, 4.9)]], tris=800)
    out += hand_shell("strafe_hand", k)
    spine = [(-0.15, 1.5), (1.25, 1.5), (1.95, 3.9), (1.65, 7.3), (-0.45, 7.5), (-0.95, 3.9)]
    out += hand_plate("strafe_hand_top", k, spine, layer=ON_SHELL, th=0.11, chamfer=0.04, rc=0.1,
                      glow_paths=[[(0.55, 2.3), (0.6, 6.7)]], groove_r=0.07, tris=500)
    for d in P.FINGER_ORDER:
        out.append(finger_plates(f"strafe_{d}", k, d, (0, 1, 2)))
    out.append(finger_plates("strafe_thumb", k, "thumb", (0, 1, 2)))
    return out


def kit_anvil():
    k = "anvil"
    out = []
    bands = [(3.6, 8.0), (8.4, 12.8), (13.2, 17.9), (18.3, 23.1)]
    for i, (s0, s1) in enumerate(bands):
        poly = [(ang(-6, s0), s0), (ang(-6, s1), s1), (ang(186, s1), s1), (ang(186, s0), s0)]
        sm = (s0 + s1) * 0.5
        vents = [[(ang(a, sm), sm - 1.1), (ang(a, sm), sm + 1.1)] for a in (58.0, 72.0)]
        out += forearm_plate(f"anvil_fore{i}", k, poly, th=0.2, chamfer=0.08, rc=0.1, glow_paths=vents, tris=900)
    out += hand_shell("anvil_hand", k, inset=0.15)
    hand = [(-0.6, 1.4), (1.8, 1.4), (3.2, 3.2), (3.2, 6.6), (-1.4, 7.0), (-1.5, 2.9)]
    out += hand_plate("anvil_hand_top", k, hand, layer=ON_SHELL, th=0.15, chamfer=0.07, rc=0.08,
                      glow_paths=[[(-0.5, 6.2), (2.4, 5.9)]])
    out.append(knuckle_caps("anvil_knuckles", k, "bar", slot="primary", tris=600, layer=SHELL_GAP + SHELL_TH))
    for d in P.FINGER_ORDER:
        out.append(finger_plates(f"anvil_{d}", k, d, (0, 1, 2), width=0.94, th=0.12, tip="square", chamfer=0.045))
    out.append(finger_plates("anvil_thumb", k, "thumb", (0, 1, 2), width=0.94, th=0.12, tip="square", chamfer=0.045))
    return out


def kit_vector():
    k = "vector"
    out = []
    spine = [(-0.55, 3.7), (0.55, 3.7), (0.65, 23.0), (-0.65, 23.0)]
    out += forearm_plate("vector_spine", k, spine, th=0.14, rc=0.35, chamfer=0.04,
                         glow_paths=[[(0.0, 4.6), (0.0, 22.1)]], groove_r=0.07, tris=800)
    side = [(ang(10, 6.0) - 0.5, 6.0), (ang(10, 6.0) + 0.5, 6.0), (ang(10, 21.5) + 0.55, 21.5),
            (ang(10, 21.5) - 0.55, 21.5)]
    out += forearm_plate("vector_side", k, side, th=0.12, rc=0.35, chamfer=0.035, tris=500)
    out += hand_shell("vector_hand", k, inset=0.6, glow_paths=[[(0.62, 1.8), (0.66, 6.9)]])
    out.append(knuckle_caps("vector_knuckles", k, "disc", layer=SHELL_GAP + SHELL_TH))
    for d in P.FINGER_ORDER:
        out.append(finger_plates(f"vector_{d}", k, d, (0, 1, 2), width=0.74, th=0.085))
    out.append(finger_plates("vector_thumb", k, "thumb", (1, 2), width=0.74, th=0.085))
    return out


def kit_quill():
    k = "quill"
    out = []
    slope = 0.42
    u_lo_deg, u_hi_deg = 14.0, 160.0
    for i, s0 in enumerate((3.6, 7.1, 10.6, 14.1, 17.6)):
        ulo = ang(u_lo_deg, s0 + 2.0)
        uhi = ang(u_hi_deg, s0 + 2.0)
        c = 0.3
        L = 3.1

        def front(u, s0=s0):
            return s0 + slope * abs(u - c)

        poly = [(ulo, front(ulo)), (c, s0), (uhi, front(uhi)), (uhi, front(uhi) + L), (c, s0 + L), (ulo, front(ulo) + L)]
        glow = [(ulo + 0.45, front(ulo + 0.45) + 0.42), (c, s0 + 0.42), (uhi - 0.45, front(uhi - 0.45) + 0.42)]
        out += forearm_plate(f"quill_fore{i}", k, poly, th=0.15, chamfer=0.05, rc=0.08, clip_s=23.4,
                             glow_paths=[glow], groove_r=0.075, tris=800)
    out += hand_shell("quill_hand", k)
    blade_a = [(0.1, 1.2), (1.1, 1.5), (-0.4, 7.6), (-1.5, 7.3)]
    blade_b = [(0.9, 1.2), (1.9, 1.3), (3.4, 6.9), (2.4, 7.3)]
    out += hand_plate("quill_hand_a", k, blade_a, layer=ON_SHELL, th=0.12, rc=0.1,
                      glow_paths=[[(0.45, 2.1), (-0.75, 6.9)]], groove_r=0.065)
    out += hand_plate("quill_hand_b", k, blade_b, layer=ON_SHELL, th=0.12, rc=0.1,
                      glow_paths=[[(1.55, 2.1), (2.8, 6.7)]], groove_r=0.065)
    out.append(knuckle_caps("quill_knuckles", k, "diamond", layer=SHELL_GAP + SHELL_TH))
    for d in P.FINGER_ORDER:
        out.append(finger_plates(f"quill_{d}", k, d, (0, 1, 2), width=0.86, tip="point"))
    out.append(finger_plates("quill_thumb", k, "thumb", (0, 1, 2), width=0.86, tip="point"))
    return out


def all_pieces():
    out = core_pieces()
    for fn in (kit_strafe, kit_anvil, kit_vector, kit_quill):
        out += fn()
    return out
