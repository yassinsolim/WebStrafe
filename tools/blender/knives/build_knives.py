"""builds the 20 knife models (original geometry, nothing imported).

  blender -b --factory-startup --python-exit-code 1 -P tools/blender/knives/build_knives.py -- \
      [ids...] [--out .blender-tmp/knives] [--no-bake] [--no-lod] [--quick]

writes <out>/<id>.glb (raw), then optimize them all:
  npx tsx tools/blender/knives/optimize_knives.ts

writes <out>/<id>.glb (lod0, baked textures) and <out>/<id>_lod1.glb (about
40% of the triangles, same nodes and textures). --no-bake skips the texture
bakes (plain materials, for geometry work), --quick also skips lod1 and renders
a side and a 3/4 view per knife into .blender-tmp/knives/quick/. the contact
sheets come from render_knives.py.

every knife is authored in millimetres in the knife frame (+X tip, +Y spine,
Z thickness, origin at the front of the handle on the edge heel line), see
klib.py. the design notes and references for each knife are in
docs/assets/knives.md.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kbake  # noqa: E402
import klib as K  # noqa: E402
from klib import MM, W, arc, cubic, line, path, quad  # noqa: E402

ARGS = K.common.script_args()


def arg(name, default=None):
    return ARGS[ARGS.index(name) + 1] if name in ARGS else default


OUT = arg("--out", K.TMP)
QUICK = "--quick" in ARGS
NO_BAKE = "--no-bake" in ARGS
NO_LOD = "--no-lod" in ARGS or QUICK
MAX_TRIS = 15000
LOD1_RATIO = 0.4
STEEL_TEX, HANDLE_TEX, FITTING_TEX = 1024, 2048, 1024
ONLY = [a for i, a in enumerate(ARGS) if not a.startswith("--") and (i == 0 or ARGS[i - 1] != "--out")]

# cs2's ursus is a fixed blade ("no moving parts"); the contract lists it with the
# folders, so it ships with blade_pivot. set False to build it fixed
URSUS_FOLDER = True


# ---------------------------------------------------------------- shared shapes

def grip(name, x0, x1, cy, h, w, mat, rings=36, segs=24, e=2.4, shape=None, cz=0.0):
    """lofted handle from x0 (front) back to x1. shape(t) -> (top, bottom, width[, dy])
    scale factors (and an axis offset in mm), t is 0 at the front and 1 at the back"""
    secs = []
    for i in range(rings):
        t = i / (rings - 1)
        x = K.lerp(x0, x1, t)
        vals = shape(t) if shape else (1.0, 1.0, 1.0)
        top, bottom, wide = vals[:3]
        dy = vals[3] if len(vals) > 3 else 0.0
        secs.append((x, K.superellipse(cy + dy, h / 2 * top, h / 2 * bottom, w / 2 * wide, segs, e, cz)))
    return K.loft(name, secs, mat)


def grooves(t, count, depth, t0=0.0, t1=1.0, sharp=2.0):
    """periodic ring grooves between t0 and t1, returns a scale factor <= 1"""
    if t < t0 or t > t1:
        return 1.0
    f = (t - t0) / (t1 - t0) * count
    return 1.0 - depth * abs(math.sin(math.pi * f)) ** sharp


def bump(t, c, wdt):
    return math.exp(-((t - c) / wdt) ** 2)


def outline(x0, x1, n, top, bot, r0=3.0, r1=8.0, fmin=0.18):
    """samples top(x) / bot(x) from the front x0 back to x1, rounding both ends"""
    T, B = [], []
    for i in range(n):
        u = i / (n - 1)
        u = u - math.sin(2 * math.pi * u) / (2 * math.pi) * 0.7
        x = K.lerp(x0, x1, u)
        yt, yb = top(x), bot(x)
        c, h = (yt + yb) / 2, (yt - yb) / 2
        f = 1.0
        d0, d1 = x0 - x, x - x1
        if r0 > 0 and d0 < r0:
            f = min(f, math.sqrt(max(0.0, 1 - ((r0 - d0) / r0) ** 2)))
        if r1 > 0 and d1 < r1:
            f = min(f, math.sqrt(max(0.0, 1 - ((r1 - d1) / r1) ** 2)))
        f = max(f, fmin)
        T.append((x, c + h * f))
        B.append((x, c - h * f))
    return T, B


def inset(T, B, d):
    return [(x, y - d) for x, y in T], [(x, y + d) for x, y in B]


def stadium(a, b, r, n=8):
    ang = math.atan2(b[1] - a[1], b[0] - a[0])
    pts = []
    for i in range(n + 1):
        t = ang - math.pi / 2 + math.pi * i / n
        pts.append((b[0] + r * math.cos(t), b[1] + r * math.sin(t)))
    for i in range(n + 1):
        t = ang + math.pi / 2 + math.pi * i / n
        pts.append((a[0] + r * math.cos(t), a[1] + r * math.sin(t)))
    return pts


def hook_cutter(M, a, b, r, T, grow=1.1):
    """gut hook / line cutter: a slot whose walls meet at a sharp v in the middle"""
    secs = []
    for z, rr in ((-T, r + grow * 2.0), (-T / 2 - 0.25, r + grow), (0.0, r), (T / 2 + 0.25, r + grow), (T, r + grow * 2.0)):
        secs.append((z * MM, [(x * MM, y * MM) for x, y in stadium(a, b, rr)]))
    return W.loft("c", secs, "Z", M["edge"])


def hole_cutter(M, pts, depth=12.0):
    return K.prism("c", pts, -depth, depth, M["blade"])


def folder_handle(M, T, Tp, Bt, liner_t=0.8, scale_t=3.2, dome=0.5, scale_mat=None, liner_mat=None, inset_d=0.4,
                  back=None, back_mat=None, back_bottom=None):
    """steel liners and domed scales on both sides of the blade slot, plus the
    backspacer that closes the spine side. back=(x_front, x_back, height)"""
    gap = T / 2 + 0.3
    Ti, Bi = inset(Tp, Bt, inset_d)
    parts = []
    for s in (1, -1):
        parts.append(K.slab("liner", Tp, Bt, gap, liner_t, s, liner_mat or M["metal"], dome=0.0, rows=1))
        parts.append(K.slab("scale", Ti, Bi, gap + liner_t, scale_t, s, scale_mat or M["handle"], dome=dome))
    if back:
        xa, xb, bh = back
        top = [p for p in Tp if xb <= p[0] <= xa]
        pts = [(x, y - 0.35) for x, y in top] + [(x, back_bottom(x) if back_bottom else y - bh) for x, y in reversed(top)]
        parts.append(K.plate("backspacer", pts, 2 * gap, back_mat or M["accent"]))
    return parts, gap + liner_t + scale_t


def screws(M, pts, z, r=2.4, mat=None, socket="torx"):
    out = []
    for x, y in pts:
        for s in (1, -1):
            out.append(K.screw_head("screw", x, y, r, s * z, s, mat or M["metal"], socket=socket))
    return out


def fit_pivot(kid, px, edge, spine, top, bot, back=1.0, margin=0.3, n=80):
    """pivot height for a folder. rotating the blade by -pi about (px, py) maps a blade
    point (x, y) to (2px - x, 2py - y), so the closed edge must stay `back` mm under
    the handle's spine line (the backspacer is carved to clear it, see back_line) and
    the closed spine above the handle's bottom at every x. picks the highest pin that
    fits and warns if none does"""
    L = max(p[0] for p in spine + edge)
    lo, hi = -1e9, 1e9
    for i in range(n + 1):
        xb = 1.0 + (L - 2.0) * i / n
        ye, ys = K.y_at(edge, xb), K.y_at(spine, xb)
        xh = 2 * px - xb
        hi = min(hi, top(xh) - back + ye)
        lo = max(lo, bot(xh) + margin + ys)
    if lo <= hi:
        two = max(lo, hi - 0.3)
    else:
        two = (lo + hi) / 2
        print(f"[knives] warning: {kid} blade can't fold fully inside the handle ({lo - hi:.2f} mm short)")
    return two / 2


def back_line(top, px, py, edge, depth, min_t=1.0, clear=0.4):
    """bottom of the backspacer: `depth` under the spine line, carved up where the
    closed blade's edge (and belly) needs room, never thinner than min_t"""
    xs = [p[0] for p in edge]
    lo_x, hi_x = max(1.0, min(xs)), max(xs) - 0.5

    def f(x):
        xb = 2 * px - x
        carve = -1e9 if not (lo_x <= xb <= hi_x) else 2 * py - K.y_at(edge, xb) + clear
        return min(top(x) - min_t, max(top(x) - depth, carve))
    return f


def clear_ring(parts, c, inner, M):
    """cuts the finger hole through anything that reaches into it (tang ends, liners)"""
    for p in parts:
        K.cut(p, K.lathe_z("c", [(inner + 0.5, -20.0), (inner + 0.5, 20.0)], 32, M["metal"], c[0], c[1]))


def folder_tang(px, py, r, top, bottom, extra_bottom=(), n=12):
    """blade tang around the pivot: from the heel's top edge round the back of the
    pivot to the heel's bottom edge, with optional extra points (a flipper tab)"""
    pts = [(1.0, top), (px, py + r)]
    for i in range(1, n):
        a = math.radians(90 + 180 * i / n)
        pts.append((px + r * math.cos(a), py + r * math.sin(a)))
    pts.append((px, py - r))
    pts.extend(extra_bottom)
    pts.append((1.0, bottom))
    return pts


def lanyard_loop(M, x, y, length=30.0, width=9.0, cord=1.6, angle=235.0, mat=None, n=22):
    """cord loop through a hole at (x, y): both strands leave the hole along z and
    the loop hangs back and down at `angle` degrees"""
    dx, dy = math.cos(math.radians(angle)), math.sin(math.radians(angle))
    pts = []
    for i in range(n + 1):
        a = 2 * math.pi * i / n
        d = (1 - math.cos(a)) / 2
        pts.append((x + dx * length * d, y + dy * length * d, width / 2 * math.sin(a) * (0.35 + 0.65 * d)))
    return K.tube("lanyard", pts, cord, mat or M["accent"], sides=6, cap=False)


def std_extras(grip_kind, info, handle_len, handle_thick, handle_h, **more):
    ex = {"grip": grip_kind, "handleLength": round(handle_len * MM, 4), "handleThickness": round(handle_thick * MM, 4),
          "handleHeight": round(handle_h * MM, 4), "bladeLength": round(info["xmax"] * MM, 4),
          "bladeHeight": round(info["hmax"] * MM, 4)}
    ex.update(more)
    return ex


# ---------------------------------------------------------------- m9-pattern fittings

def m9_guard(M, cy, top_y):
    """crossguard plate with the 22 mm muzzle ring above the spine (nato flash hider)"""
    guard = K.front("guard", [(-11, -13, 4), (-9, 13, 4), (top_y, 13, 5), (top_y, -13, 5)], -8.5, 0.0, M["metal"])
    K.bevel(guard, 1.0, segs=2)
    ring_y = top_y + 15.0
    ring = K.torus("muzzle_ring", -4.25, ring_y, 15.0, 3.6, 4.2, M["metal"], segs=32, tsegs=10, axis="X", e=3.0)
    web = K.front("ring_web", [(top_y - 4, -9, 2), (top_y + 6, -7, 2), (top_y + 6, 7, 2), (top_y - 4, 9, 2)], -8.2, -0.3,
                  M["metal"])
    K.bevel(web, 0.8, segs=1)
    return [guard, ring, web]


def m9_pommel(M, cy, x0, half_h=(17.5, 15.0), half_w=14.0):
    """pommel cap with the bayonet lug slot on the spine side and the two lock release levers"""
    psecs = []
    for x, sc in ((x0, 1.04), (x0 - 2.0, 1.08), (x0 - 11.0, 1.08), (x0 - 14.5, 1.0), (x0 - 16.0, 0.86)):
        psecs.append((x, K.superellipse(cy + 1.0, half_h[0] * sc, half_h[1] * sc, half_w * sc, 24, 3.0)))
    pommel = K.loft("pommel", psecs, M["metal"])
    # the rifle's bayonet lug slides into this slot from the butt end
    slot = K.front("c", [(cy + 12.5, -3.2), (cy + 30, -3.2), (cy + 30, 3.2), (cy + 12.5, 3.2)], x0 - 21.0, x0 - 4.0,
                   M["metal"])
    K.cut(pommel, slot)
    parts = [pommel]
    for s in (1, -1):
        lv = K.prism("lever", [(x0 - 12.0, cy - 4, 1.5), (x0 - 2.5, cy - 2, 1.5), (x0 - 2.5, cy + 6, 1.5),
                               (x0 - 12.0, cy + 7, 1.5)], *sorted((s * 13.2, s * 16.2)), M["accent"])
        K.bevel(lv, 0.5, segs=1)
        parts.append(lv)
    return parts


# ---------------------------------------------------------------- 1 bayonet (m9 pattern, plain blade)

def bayonet():
    k = K.Knife("bayonet")
    M = K.materials(handle=(0x1c1d20, 0.72, 0.0, {"detail": "pebble", "strength": 0.7}),
                    metal=(0x2b2d31, 0.42, 0.85), accent=(0x8c9198, 0.35, 1.0))
    L, H, T = 180.0, 36.0, 5.8
    ty = 16.5
    edge = path(line((-4, 0), (112, 0), 8), quad((112, 0), (163, 0.4), (L, ty), 12))
    spine = path(line((-4, H), (98, H), 7), line((98, H), (L, ty), 10))
    b, tip, info = K.blade("blade", edge, spine, M, T, stations=50, grind="hollow", grind_h=0.46, ricasso=16,
                           swedge={"from": 0.56, "width": 5.5, "depth": 0.62},
                           fuller={"from": 0.07, "to": 0.5, "lo": 0.56, "hi": 0.73, "depth": 0.75})
    k.add_blade(b)
    cy = H / 2

    def gshape(t):
        s = 1.0 + 0.05 * math.sin(math.pi * t) + 0.07 * bump(t, 0.0, 0.05) + 0.06 * bump(t, 1.0, 0.05)
        g = grooves(t, 11, 0.07, 0.07, 0.93, 1.5)
        return (s * g, s * g, s * g)

    handle = grip("grip", -8.0, -116.0, cy, 30.0, 26.5, M["handle"], rings=56, segs=24, shape=gshape)
    k.add(*m9_guard(M, cy, 42.0), handle, *m9_pommel(M, cy, -115.0))
    k.socket("socket_tip", *tip)
    k.socket("socket_grip", -62.0, cy)
    k.extras = std_extras("hammer", info, 131, 28.6, 33.0)
    return k


# ---------------------------------------------------------------- 2 m9 bayonet

def m9_bayonet():
    k = K.Knife("m9_bayonet")
    M = K.materials(handle=(0x25271f, 0.7, 0.0, {"detail": "knurl", "strength": 1.0}),
                    metal=(0x26282b, 0.4, 0.85), accent=(0x8c9198, 0.35, 1.0))
    L, H, T = 190.0, 38.0, 6.0
    ty = 17.0
    edge = path(line((-4, 0), (120, 0), 8), quad((120, 0), (172, 0.4), (L, ty), 12))
    spine = path(line((-4, H), (106, H), 8), line((106, H), (L, ty), 10))
    b, tip, info = K.blade("blade", edge, spine, M, T, stations=54, grind="hollow", grind_h=0.44, ricasso=16,
                           swedge={"from": 0.56, "width": 5.5, "depth": 0.6})
    # wire cutter hole about 1.6 in behind the tip (it pivots on the scabbard's post)
    hole = hole_cutter(M, K.rounded([(140.5, 12.0, 3.5), (158.5, 13.6, 3.5), (157.9, 20.6, 3.5), (139.9, 19.0, 3.5)], 6))
    K.cut(b, hole)
    saw = K.teeth("saw", spine, 14.0, 100.0, 13, 3.6, K.spine_thickness(T, spine), M["blade"], rake=0.66)
    k.add_blade(b, saw)
    cy = H / 2

    def gshape(t):
        s = 1.0 + 0.06 * bump(t, 0.0, 0.06) + 0.05 * bump(t, 1.0, 0.06) - 0.035 * math.sin(math.pi * t)
        return (s, s, s)

    handle = grip("grip", -8.0, -118.0, cy, 32.0, 30.0, M["handle"], rings=16, segs=28, e=2.1, shape=gshape)
    k.add(*m9_guard(M, cy, 44.0), handle, *m9_pommel(M, cy, -117.0, (18.5, 16.5), 15.0))
    k.socket("socket_tip", *tip)
    k.socket("socket_grip", -63.0, cy)
    k.extras = std_extras("hammer", info, 133, 30.0, 35.0)
    return k


# ---------------------------------------------------------------- 3 karambit

def hawkbill(cx, cy, R, W0, th0, th1, n=40, taper=0.55, edge_k=0.96):
    spine, edge = [], []
    for i in range(n + 1):
        th = K.lerp(th0, th1, i / n)
        w = W0 if th >= 90 else W0 * ((th - th1) / (90 - th1)) ** taper
        a = math.radians(th)
        spine.append((cx + (R + w) * math.cos(a), cy + (R + w) * math.sin(a)))
        edge.append((cx + (R - w * edge_k) * math.cos(a), cy + (R - w * edge_k) * math.sin(a)))
    return edge, spine


def karambit():
    k = K.Knife("karambit")
    M = K.materials(handle=(0x232427, 0.6, 0.0, {"detail": "g10", "strength": 0.90}),
                    metal=(0xbfc4cb, 0.3, 1.0), accent=(0x9aa0a8, 0.3, 1.0))
    T = 4.2
    W0 = 13.0
    edge, spine = hawkbill(0.0, -67.0, 80.0, W0, 93.0, 27.0, n=44)
    edge = [(x, y + W0 * 0.04 * (1 if i < 2 else 0)) for i, (x, y) in enumerate(edge)]
    b, tip, info = K.blade("blade", edge, spine, M, T, stations=50, grind="hollow", grind_h=0.56, ricasso=9,
                           swedge={"from": 0.58, "width": 4.0, "depth": 0.6}, taper=0.45)
    jimp = K.teeth("jimping", spine, 3.0, 17.0, 8, 0.9, K.spine_thickness(T, spine, 0.45), M["blade"], rake=0.5, sink=0.3)
    k.add_blade(b, jimp)

    def axis(x):
        return 13.0 - 0.0036 * x * x

    def top(x):
        t = -x / 88.0
        return axis(x) + 12.5 + 2.6 * bump(t, 0.07, 0.06) - 1.2 * smooth(t, 0.75, 1.0)

    def bot(x):
        t = -x / 88.0
        return axis(x) - (12.5 + 6.5 * bump(t, 0.04, 0.045) - 2.8 * bump(t, 0.3, 0.12) + 1.2 * bump(t, 0.64, 0.16)
                          - 1.5 * smooth(t, 0.75, 1.0))

    Tp, Bt = outline(2.0, -91.0, 34, top, bot, r0=0.0, r1=0.0)
    tang = K.plate("tang", Tp + list(reversed(Bt)), T - 0.12, M["metal"])
    Ts, Bs = outline(-0.5, -84.5, 30, lambda x: top(x) - 0.7, lambda x: bot(x) + 0.7, r0=2.0, r1=4.0)
    scale_t = 4.4
    scales = [K.slab("scale", Ts, Bs, T / 2, scale_t, s, M["handle"], dome=0.55) for s in (1, -1)]
    zout = T / 2 + scale_t
    pins = [K.pin("pin", x, axis(x) + 0.5, 2.1, -zout + 0.3, zout - 0.3, M["accent"]) for x in (-13.0, -43.0, -71.0)]
    ring_c = (-99.8, -22.4)
    ring = K.torus("ring", ring_c[0], ring_c[1], 14.7, 3.2, T / 2 + 1.0, M["metal"], segs=40, tsegs=10, e=2.4)
    clear_ring([tang], ring_c, 11.5, M)
    k.add(tang, ring, *scales, *pins)
    k.socket("socket_tip", *tip)
    k.socket("socket_grip", -43.0, axis(-43.0))
    k.socket("socket_ring", *ring_c)
    k.extras = std_extras("reverse_ring", info, 86, 2 * zout, 26.0, ringInnerRadius=0.0115)
    return k


def smooth(t, a, b):
    return K.smoothstep(a, b, t)


# ---------------------------------------------------------------- 4 butterfly (balisong)

def butterfly():
    k = K.Knife("butterfly")
    M = K.materials(handle=(0x2a2d31, 0.38, 0.85, {"detail": "bead", "strength": 1.0}),
                    metal=(0xb8bdc4, 0.28, 1.0), accent=(0x1b1c1e, 0.5, 0.3))
    L, H, T = 102.0, 23.0, 3.6
    ty = 10.5
    # curved clip point with a long concave swedge and a slight recurve (hybrid scimitar)
    edge = path(line((-4, 0), (1.0, 0)), arc(4.0, 0.0, 3.0, 180, 0, 8), cubic((7.0, 0), (30, 0.9), (62, -1.0), (84, 0.6), 10),
                quad((84, 0.6), (97, 2.6), (L, ty), 8))
    spine = path(line((-4, H), (54, H), 6), quad((54, H), (78, 13.8), (L, ty), 12))
    b, tip, info = K.blade("blade", edge, spine, M, T, stations=44, grind="flat", grind_h=0.64, ricasso=9,
                           swedge={"from": 0.56, "width": 4.0, "depth": 0.62})
    # tang with the two pivot holes and the kicker that keeps the edge off the bite handle
    tang = K.plate("tang", [(-14.5, 22.5, 2.5), (1.0, 23.0), (1.0, 0.0), (-3.0, -0.2), (-5.0, -1.6, 1.0),
                            (-9.0, -1.8, 1.2), (-14.5, 0.5, 2.5)], T - 0.12, M["blade"])
    k.add_blade(b, tang)

    cy = 11.5
    band = 13.5
    gap = T / 2 + 0.35
    wall = 4.3
    zw = gap + wall
    pins = {"handle_safe": (-6.5, cy + band / 2), "handle_bite": (-6.5, cy - band / 2)}
    Lh = 128.0
    for name, s in (("handle_safe", 1), ("handle_bite", -1)):
        # channel handle: two walls with the back on the grip's centre line, so the
        # channels face out when open and fold round the blade when closed
        y_in, y_out = cy, cy + s * band
        yb = cy + s * 1.8
        sec = [(y_in, -zw), (y_in, zw), (y_out, zw, 1.6), (y_out, gap, 0.4), (yb, gap), (yb, -gap), (y_out, -gap, 0.4),
               (y_out, -zw, 1.6)]
        if s < 0:
            sec = [(y, z, *r) for (y, z, *r) in reversed(sec)]
        body = K.front(name + "_body", sec, -Lh, 0.0, M["handle"])
        side = K.prism("c", [(-Lh + 3, cy - s * 1, 4), (-1.0, cy - s * 1, 2), (-1.0, y_out + s * 0.6, 3),
                             (-Lh + 5, y_out + s * 0.6, 5)], -10, 10, M["handle"])
        W.boolean(body, side, op="INTERSECT")
        # the back is cut away round the pivot so the tang can sit between the walls
        K.cut(body, K.front("c", [(cy - s * 0.2, -gap), (cy - s * 0.2, gap), (yb + s * 0.4, gap), (yb + s * 0.4, -gap)],
                            -17.0, 2.0, M["handle"]))
        # drilled walls, like the milled titanium handles of the gargoyle-style original
        yc = cy + s * (band * 0.55 + 0.4)
        slots = [hole_cutter(M, stadium((x - ln / 2, yc), (x + ln / 2, yc), 2.6, 6), depth=12.0)
                 for x, ln in ((-34.0, 13.0), (-54.0, 13.0), (-74.0, 13.0), (-94.0, 11.0))]
        K.cut(body, slots)
        K.bevel(body, 0.55, segs=2, angle=35)
        px, py = pins[name]
        parts = [body] + [K.screw_head("pivot", px, py, 3.1, sz * zw, sz, M["metal"], socket="torx") for sz in (1, -1)]
        parts += [K.screw_head("zen", x, cy + s * 6.8, 1.9, sz * zw, sz, M["metal"]) for x in (-64.0, -113.0) for sz in (1, -1)]
        if s < 0:
            latch = K.prism("latch", [(-Lh + 2.5, cy - 4.5, 2.0), (-Lh + 24.0, cy - 5.5, 2.5), (-Lh + 24.0, cy - 9.5, 2.0),
                                      (-Lh + 6.0, cy - 15.2, 2.0), (-Lh + 1.0, cy - 13.0, 2.0)], -1.3, 1.3, M["metal"])
            K.bevel(latch, 0.35, segs=1)
            latch_pin = K.pin("latch_pin", -Lh + 6.5, cy - 8.0, 1.5, -zw - 0.2, zw + 0.2, M["metal"])
            parts += [latch, latch_pin]
        k.handles[name] = (parts, pins[name])
    k.socket("socket_tip", *tip)
    k.socket("socket_grip", -64.0, cy)
    k.socket("socket_pivot_safe", *pins["handle_safe"])
    k.socket("socket_pivot_bite", *pins["handle_bite"])
    k.extras = std_extras("balisong", info, Lh, 2 * zw, 2 * band)
    return k


# ---------------------------------------------------------------- 5 flip knife

def flip():
    k = K.Knife("flip")
    M = K.materials(handle=(0x1c1d20, 0.55, 0.0, {"detail": "g10", "strength": 0.99}),
                    metal=(0xa9aeb5, 0.32, 1.0), accent=(0x151618, 0.5, 0.3))
    L, H, T = 100.0, 30.0, 3.3
    ty = 13.5
    # broad blade with an angular (tanto-ish) swedge break and an upswept belly
    edge = path(line((-4, 0), (52, 0), 5), cubic((52, 0), (78, 0.1), (94, 3.4), (L, ty), 12))
    spine = path(line((-4, H), (54, 30.6), 6), line((54, 30.6), (L, ty), 8))
    b, tip, info = K.blade("blade", edge, spine, M, T, stations=46, grind="flat", grind_h=0.6, ricasso=8,
                           swedge={"from": 0.56, "width": 5.0, "depth": 0.62}, corner_deg=10.0)
    px = -9.0

    def top(x):
        return 32.8 + 0.6 * bump(x, -40, 30) - 2.2 * smooth(x, -95.0, -126.0)

    def bot(x):
        return -3.8 + 3.6 * bump(x, -20, 8) - 1.6 * bump(x, -66, 24) + 1.8 * smooth(x, -100.0, -126.0)

    py = fit_pivot("flip", px, edge, spine, top, bot)
    bb = back_line(top, px, py, edge, 3.4)
    rt = min(top(px) - py, py - bot(px)) - 0.9
    tang = K.plate("tang", folder_tang(px, py, rt, H - 0.5, 0.5,
                                       extra_bottom=[(px + 1.5, -2.0), (px + 2.5, -10.0, 3.0), (px + 9.0, -11.0, 3.0),
                                                     (px + 12.5, -3.0, 2.0)]), T - 0.12, M["blade"])
    k.add_blade(b, tang)
    Tp, Bt = outline(-1.5, -126.0, 36, top, bot, r0=5.0, r1=8.0)
    parts, zout = folder_handle(M, T, Tp, Bt, liner_t=0.9, scale_t=3.4, back=(-36.0, -122.0, 3.4), back_bottom=bb)
    hw = [K.screw_head("pivot", px, py, 4.4, s * (zout - 0.2), s, M["metal"], socket="torx") for s in (1, -1)]
    hw += screws(M, [(-62.0, 28.4), (-114.0, 18.0)], zout - 0.2, r=2.4)
    # tip-up pocket clip on the +z side, screwed at the butt
    clip = K.prism("clip", [(-121.0, 21.0, 2.0), (-64.0, 23.0, 3.0), (-58.0, 19.0, 3.0), (-64.0, 15.0, 3.0), (-121.0, 13.0, 2.0)],
                   zout + 0.2, zout + 1.3, M["metal"])
    K.bevel(clip, 0.3, segs=1)
    k.add(*parts, *hw, clip)
    k.pivot = (px, py)
    k.socket("socket_tip", *tip, parent="blade_pivot")
    k.socket("socket_pivot", px, py)
    k.socket("socket_grip", -62.0, 14.5)
    k.extras = std_extras("hammer", info, 126, 2 * zout, 36.0)
    return k


# ---------------------------------------------------------------- 6 gut knife

def gut():
    k = K.Knife("gut")
    M = K.materials(handle=(0x1b1c1e, 0.78, 0.0, {"detail": "pebble", "strength": 0.8}),
                    metal=(0xaab0b7, 0.32, 1.0), accent=(0x55595f, 0.45, 0.8))
    L, H, T = 100.0, 32.0, 4.5
    ty = 12.0
    edge = path(line((-4, 0), (62, 0), 6), quad((62, 0), (92, 0.6), (L, ty), 10))
    spine = path(line((-4, H), (48, H), 5), quad((48, H), (82, 31.5), (L, ty), 12))
    b, tip, info = K.blade("blade", edge, spine, M, T, stations=46, grind="flat", grind_h=0.62, ricasso=9,
                           swedge={"from": 0.62, "width": 4.0, "depth": 0.5})
    K.cut(b, hook_cutter(M, (55.0, 21.6), (69.5, 35.0), 3.6, T), transfer=True)
    k.add_blade(b)
    cy = 16.0
    guard = K.prism("guard", [(-5.0, 34.5, 2.5), (0.0, 34.5, 1.5), (0.0, -1.0), (4.5, -6.5, 3.0), (2.0, -10.5, 2.5),
                              (-5.0, -7.0, 3.0)], -8.2, 8.2, M["metal"])
    K.bevel(guard, 1.0, segs=2)

    def gshape(t):
        s = 1.0 + 0.07 * bump(t, 0.58, 0.22) + 0.05 * bump(t, 0.0, 0.05)
        bottom = s * (1 - 0.13 * bump(t, 0.13, 0.07)) * (1 + 0.1 * bump(t, 0.02, 0.04))
        return (s, bottom, s * (1 + 0.03 * bump(t, 0.58, 0.2)), -1.0 * smooth(t, 0.8, 1.0))

    handle = grip("grip", -5.0, -111.0, cy, 29.0, 24.0, M["handle"], rings=34, segs=24, shape=gshape)
    csecs = [(x, K.superellipse(cy - 1.0, 14.3 * s, 14.3 * s, 11.9 * s, 24, 2.4))
             for x, s in ((-110.0, 1.0), (-112.5, 1.02), (-117.0, 0.94), (-119.0, 0.7), (-119.8, 0.4))]
    cap = K.loft("butt_cap", csecs, M["metal"])
    K.cut(cap, K.lathe_z("c", [(2.6, -20), (2.6, 20)], 14, M["metal"], -114.5, cy - 1.0))
    k.add(guard, handle, cap)
    k.socket("socket_tip", *tip)
    k.socket("socket_grip", -58.0, cy)
    k.extras = std_extras("hammer", info, 120, 25.0, 31.0)
    return k


# ---------------------------------------------------------------- 7 huntsman

def huntsman():
    k = K.Knife("huntsman")
    M = K.materials(handle=(0x2a221c, 0.8, 0.0, {"detail": "pebble", "strength": 0.8}),
                    metal=(0x9ba1a8, 0.34, 1.0), accent=(0x3d4a2e, 0.85, 0.0, {"detail": "cord", "strength": 0.8}))
    L, H, T = 155.0, 38.0, 5.2
    ty = 18.0
    edge = path(line((-4, 0), (2.0, 0)), arc(7.5, 0.0, 5.5, 180, 0, 8), line((13.0, 0), (102, 0), 7),
                quad((102, 0), (142, 0.8), (L, ty), 12))
    spine = path(line((-4, H), (100, H), 8), quad((100, H), (126, 26.5), (L, ty), 12))
    b, tip, info = K.blade("blade", edge, spine, M, T, stations=52, grind="flat", grind_h=0.56, ricasso=16,
                           swedge={"from": 0.6, "width": 6.0, "depth": 0.62})
    saw = K.teeth("saw", spine, 16.0, 96.0, 12, 3.8, K.spine_thickness(T, spine), M["blade"], rake=0.64)
    k.add_blade(b, saw)
    cy = 19.0
    guard = K.prism("guard", [(-7.0, 48.0, 3.0), (0.0, 48.0, 2.0), (0.0, -9.5, 2.0), (-7.0, -9.5, 3.0)], -7.0, 7.0,
                    M["metal"])
    K.bevel(guard, 1.2, segs=2)

    def gshape(t):
        s = 1.0 + 0.06 * bump(t, 0.6, 0.25) + 0.08 * bump(t, 1.0, 0.07)
        fing = grooves(t, 4, 0.13, 0.04, 0.62, 1.6)
        return (s, s * fing, s, -0.8 * smooth(t, 0.75, 1.0))

    handle = grip("grip", -7.0, -118.0, cy, 31.0, 26.0, M["handle"], rings=44, segs=24, shape=gshape)
    psecs = [(x, K.superellipse(cy - 0.8, 17.2 * s, 17.2 * s, 14.2 * s, 24, 2.6))
             for x, s in ((-117.0, 1.0), (-119.5, 1.03), (-124.0, 0.98), (-126.5, 0.78), (-127.3, 0.45))]
    pommel = K.loft("pommel", psecs, M["metal"])
    K.cut(pommel, K.lathe_z("c", [(2.8, -20), (2.8, 20)], 14, M["metal"], -122.0, cy - 0.8))
    lan = lanyard_loop(M, -122.0, cy - 0.8, length=34.0, width=9.0, cord=1.7)
    k.add(guard, handle, pommel, lan)
    k.socket("socket_tip", *tip)
    k.socket("socket_grip", -62.0, cy)
    k.extras = std_extras("hammer", info, 127, 27.0, 33.5)
    return k


# ---------------------------------------------------------------- 8 falchion

def falchion():
    k = K.Knife("falchion")
    M = K.materials(handle=(0x19191b, 0.45, 0.0, {"detail": "g10", "strength": 0.63}),
                    metal=(0xc9ced4, 0.22, 1.0), accent=(0x141416, 0.5, 0.3))
    L, H, T = 128.0, 30.0, 4.0
    ty = 30.0
    # falchion-like: the belly sweeps up to an upturned point level with the spine,
    # which dips in a concave clip before it (navaja / espada lineage)
    edge = path(line((-4, 0), (32, 0), 4), cubic((32, 0), (78, -4.2), (116, 5.0), (L, ty), 18))
    spine = path(line((-4, H), (64, 31.6), 6), quad((64, 31.6), (104, 24.2), (L, ty), 14))
    b, tip, info = K.blade("blade", edge, spine, M, T, stations=52, grind="flat", grind_h=0.62, ricasso=9,
                           swedge={"from": 0.56, "width": 5.0, "depth": 0.62})
    px = -8.0

    def axis(x):
        return 15.0 - 0.00028 * x * x

    def top(x):
        return axis(x) + 18.2 - 0.8 * bump(x, -30, 14)

    def bot(x):
        t = -x / 150.0
        hook = 8.0 * smooth(t, 0.8, 0.95) * (1 - smooth(t, 0.96, 1.0))
        return axis(x) - 18.6 + 2.6 * bump(x, -21, 8) - hook

    py = fit_pivot("falchion", px, edge, spine, top, bot)
    bb = back_line(top, px, py, edge, 3.4)
    rt = min(top(px) - py, py - bot(px)) - 0.9
    tang = K.plate("tang", folder_tang(px, py, rt, H - 0.5, 0.5), T - 0.12, M["blade"])
    disk = K.pin("thumb_disc", 14.0, 24.0, 3.6, -T / 2 - 1.4, T / 2 + 1.4, M["accent"], segs=16, dome=0.15)
    k.add_blade(b, tang, disk)
    Tp, Bt = outline(-1.5, -150.0, 42, top, bot, r0=5.0, r1=6.0)
    parts, zout = folder_handle(M, T, Tp, Bt, liner_t=0.9, scale_t=3.4, back=(-40.0, -144.0, 3.4), back_bottom=bb)
    # polished bolsters over the pivot end
    Tb = [p for p in Tp if p[0] >= -24.0]
    Bb = [p for p in Bt if p[0] >= -24.0]
    bols = [K.slab("bolster", Tb, Bb, T / 2 + 0.3 + 0.9, 3.7, s, M["metal"], dome=0.45) for s in (1, -1)]
    hw = [K.screw_head("pivot", px, py, 4.6, s * (zout + 0.25), s, M["metal"], socket="torx") for s in (1, -1)]
    hw += screws(M, [(-80.0, axis(-80) + 1.0), (-132.0, axis(-132) + 0.5)], zout - 0.2, r=2.3)
    k.add(*parts, *bols, *hw)
    k.pivot = (px, py)
    k.socket("socket_tip", *tip, parent="blade_pivot")
    k.socket("socket_pivot", px, py)
    k.socket("socket_grip", -66.0, axis(-66.0))
    k.extras = std_extras("hammer", info, 150, 2 * zout + 0.6, 36.0)
    return k


# ---------------------------------------------------------------- 9 shadow daggers (push dagger)

def shadow_daggers():
    k = K.Knife("shadow_daggers")
    M = K.materials(handle=(0x1a1a1c, 0.7, 0.0, {"detail": "g10", "strength": 0.81}),
                    metal=(0x9aa0a8, 0.34, 1.0), accent=(0x6d737b, 0.4, 0.9))
    L, H, T = 66.0, 26.0, 4.6
    cy = H / 2
    # narrow neck where the blade passes between the middle and ring fingers,
    # the leaf only flares once it is clear of the fist
    edge = path(quad((-6, cy - 3.5), (3, cy - 3.8), (13, 0.6), 8), line((13, 0.6), (38, 1.4), 4),
                quad((38, 1.4), (58, 3.5), (L, cy), 8))
    spine = [(x, H - y) for x, y in edge]
    b, tip, info = K.blade("blade", edge, spine, M, T, stations=36, grind="flat", grind_h=0.47, ricasso=6,
                           double_from=0.0, taper=0.5)
    stem = K.plate("stem", [(-19.0, cy - 3.2, 1.2), (-4.0, cy - 3.4, 1.5), (-4.0, cy + 3.4, 1.5), (-19.0, cy + 3.2, 1.2)],
                   T * 0.9, M["blade"])
    k.add_blade(b, stem)
    # t-bar across the palm: lofted along the bar, finger grooves on the blade side
    bar_x, depth, thick, half_len = -24.0, 14.0, 18.0, 46.0
    secs = []
    n = 44
    for i in range(n):
        u = K.lerp(-half_len, half_len, i / (n - 1))
        e = abs(u) / half_len
        rnd = math.sqrt(max(0.06, 1 - ((e - 0.84) / 0.16) ** 2)) if e > 0.84 else 1.0
        g = 1.0
        for c in (-33.0, -15.0, 15.0, 33.0):
            g -= 0.16 * bump(u, c, 5.5)
        front = depth / 2 * rnd * g
        back = depth / 2 * rnd * (1.0 + 0.05 * (1 - e))
        secs.append((u, K.superellipse(-bar_x, back, front, thick / 2 * rnd * (1 - 0.08 * e), 20, 2.3)))
    bar = K.loft("tee", secs, M["handle"])
    K.xform(bar, K.Matrix.Rotation(math.radians(90), 4, "Z"))
    K.xform(bar, K.Matrix.Translation((0.0, cy * MM, 0.0)))
    screws_ = [K.screw_head("screw", bar_x, cy + dy, 2.2, s * (thick / 2 - 0.4), s, M["metal"], socket="hex")
               for dy in (-8.0, 8.0) for s in (1, -1)]
    k.add(bar, *screws_)
    k.socket("socket_tip", *tip)
    k.socket("socket_grip", bar_x, cy)
    k.socket("socket_tee", bar_x, cy, 0.0, rot=(-math.pi / 2, 0.0, 0.0))
    k.extras = std_extras("tee", info, 2 * half_len, thick, depth, pair=True)
    return k


# ---------------------------------------------------------------- 10 bowie

def bowie():
    k = K.Knife("bowie")
    M = K.materials(handle=(0x4a2e1c, 0.55, 0.0, {"detail": "wood", "color2": 0x2e1a0f}),
                    metal=(0xb58c4a, 0.3, 1.0), accent=(0x3a1d14, 0.6, 0.0))
    L, H, T = 185.0, 42.0, 5.2
    ty = 19.0
    edge = path(line((-4, 0), (95, 0), 7), cubic((95, 0), (140, -1.6), (174, 3.5), (L, ty), 14))
    spine = path(line((-4, H), (102, H), 8), quad((102, H), (140, 28.5), (L, ty), 12))
    b, tip, info = K.blade("blade", edge, spine, M, T, stations=54, grind="flat", grind_h=0.55, ricasso=16,
                           swedge={"from": 0.58, "width": 6.5, "depth": 0.62})
    saw = K.teeth("saw", spine, 24.0, 98.0, 14, 3.1, K.spine_thickness(T, spine), M["blade"], rake=0.55)
    k.add_blade(b, saw)
    cy = 20.0
    guard = K.prism("guard", [(-8.0, 51.0, 3.5), (-3.0, 53.5, 3.0), (0.5, 50.0, 2.0), (0.0, -8.0, 2.0), (-2.5, -12.5, 3.0),
                              (-8.0, -10.0, 3.5)], -8.0, 8.0, M["metal"])
    K.bevel(guard, 1.2, segs=2)
    spacer = K.loft("spacer", [(x, K.superellipse(cy, 16.4, 16.4, 13.4, 24, 2.4)) for x in (-8.0, -10.0)], M["accent"])

    def gshape(t):
        s = 1.0 + 0.06 * bump(t, 0.55, 0.25) - 0.03 * bump(t, 0.1, 0.06)
        return (s, s, s)

    handle = grip("grip", -10.0, -112.0, cy, 31.0, 25.5, M["handle"], rings=24, segs=24, shape=gshape)
    psecs = [(x, K.superellipse(cy, 16.0 * s, 16.0 * s, 13.2 * s, 24, 2.4))
             for x, s in ((-111.0, 1.0), (-113.0, 1.07), (-120.5, 1.04), (-123.5, 0.82), (-124.6, 0.5), (-125.0, 0.2))]
    pommel = K.loft("pommel", psecs, M["metal"])
    K.cut(pommel, K.lathe_z("c", [(2.6, -20), (2.6, 20)], 14, M["metal"], -118.0, cy))
    k.add(guard, spacer, handle, pommel)
    k.socket("socket_tip", *tip)
    k.socket("socket_grip", -60.0, cy)
    k.extras = std_extras("hammer", info, 125, 27.0, 33.0)
    return k


# ---------------------------------------------------------------- 11 navaja

def navaja():
    k = K.Knife("navaja")
    M = K.materials(handle=(0x5b3a24, 0.5, 0.0, {"detail": "wood", "color2": 0x3a2212}),
                    metal=(0xc7ccd2, 0.26, 1.0), accent=(0xc49a4a, 0.3, 1.0))
    L, H, T = 105.0, 21.0, 3.2
    ty = 13.0
    edge = path(line((-4, 0), (4, 0.2), 2), cubic((4, 0.2), (30, 1.6), (62, -2.6), (88, 1.2), 12),
                quad((88, 1.2), (100, 4.6), (L, ty), 8))
    spine = path(line((-4, H), (52, 21.6), 6), quad((52, 21.6), (86, 17.6), (L, ty), 12))
    b, tip, info = K.blade("blade", edge, spine, M, T, stations=46, grind="flat", grind_h=0.7, ricasso=8,
                           swedge={"from": 0.5, "width": 3.6, "depth": 0.6})
    px = -8.0

    def axis(x):
        tail = 8.5 * smooth(x, -110.0, -143.0) ** 1.5
        return 10.8 - 0.00036 * x * x - tail

    def hh(x):
        return 13.6 - 1.4 * smooth(x, -20.0, -110.0)

    def top(x):
        return axis(x) + hh(x) * (1.0 - 0.3 * smooth(x, -116.0, -143.0)) + 0.9 * bump(x, -6, 9)

    def bot(x):
        return axis(x) - hh(x) * (1.0 - 0.72 * smooth(x, -108.0, -143.0)) + 0.5 * bump(x, -24, 10)

    py = fit_pivot("navaja", px, edge, spine, top, bot, back=0.9)
    bb = back_line(top, px, py, edge, 2.8, min_t=0.9)
    rt = min(top(px) - py, py - bot(px)) - 0.8
    tang = K.plate("tang", folder_tang(px, py, rt, H - 0.4, 0.4), T - 0.12, M["blade"])
    k.add_blade(b, tang)
    Tp, Bt = outline(-1.5, -143.0, 46, top, bot, r0=4.0, r1=2.0, fmin=0.08)
    gap = T / 2 + 0.3
    liner_t, scale_t = 0.8, 3.0
    Ti, Bi = inset(Tp, Bt, 0.35)
    parts = []
    for s in (1, -1):
        parts.append(K.slab("liner", Tp, Bt, gap, liner_t, s, M["metal"], dome=0.0, rows=1))
        for lo, hi, mat, dome in ((-18.0, 0.0, M["metal"], 0.4), (-124.0, -17.4, M["handle"], 0.55),
                                  (-145.0, -123.4, M["metal"], 0.45)):
            T2 = [p for p in Ti if lo <= p[0] <= hi]
            B2 = [p for p in Bi if lo <= p[0] <= hi]
            parts.append(K.slab("scale", T2, B2, gap + liner_t, scale_t, s, mat, dome=dome))
    zout = gap + liner_t + scale_t
    top_run = [p for p in Tp if -128.0 <= p[0] <= -16.0]
    spring = K.plate("backspring", [(x, y - 0.2) for x, y in top_run] + [(x, bb(x)) for x, y in reversed(top_run)],
                     2 * gap, M["metal"])
    lever = K.prism("lock_lever", [(-124.0, top(-124.0) - 3.0), (-121.0, top(-121.0) + 1.2, 1.0),
                                   (-108.0, top(-108.0) + 1.5, 1.0), (-105.0, top(-105.0) - 3.0)],
                    -gap + 0.2, gap - 0.2, M["metal"])
    pins = [K.pin("rivet", x, axis(x) + 0.5, 1.5, -zout - 0.1, zout + 0.1, M["accent"], segs=10)
            for x in (-40.0, -78.0, -108.0)]
    hw = [K.screw_head("pivot", px, py, 3.2, s * (zout - 0.1), s, M["accent"]) for s in (1, -1)]
    k.add(*parts, spring, lever, *pins, *hw)
    k.pivot = (px, py)
    k.socket("socket_tip", *tip, parent="blade_pivot")
    k.socket("socket_pivot", px, py)
    k.socket("socket_grip", -62.0, axis(-62.0))
    k.extras = std_extras("hammer", info, 142, 2 * zout, 25.0)
    return k


# ---------------------------------------------------------------- 12 stiletto (italian side-opening switchblade)

def stiletto():
    k = K.Knife("stiletto")
    M = K.materials(handle=(0x3a2417, 0.45, 0.0, {"detail": "wood", "color2": 0x1f120a}),
                    metal=(0xcfd3d8, 0.2, 1.0), accent=(0xb9bec5, 0.25, 1.0))
    L, H, T = 125.0, 16.0, 2.8
    ty = 8.0
    edge = path(line((-4, 0), (80, 0), 8), quad((80, 0), (112, 0.7), (L, ty), 10))
    spine = path(line((-4, H), (60, H), 6), line((60, H), (L, ty), 10))
    b, tip, info = K.blade("blade", edge, spine, M, T, stations=46, grind="flat", grind_h=0.6, ricasso=12,
                           swedge={"from": 0.46, "width": 5.0, "depth": 0.85}, taper=0.5)
    px = -11.0

    def top(x):
        return 18.3

    def bot(x):
        return -2.5

    py = fit_pivot("stiletto", px, edge, spine, top, bot, back=0.8, margin=0.3)
    bb = back_line(top, px, py, edge, 1.6, min_t=0.8)
    rt = min(top(px) - py, py - bot(px)) - 0.7
    tang = K.plate("tang", folder_tang(px, py, rt, H - 0.3, 0.3), T - 0.12, M["blade"])
    k.add_blade(b, tang)
    Tp, Bt = outline(-1.0, -150.0, 40, top, bot, r0=3.0, r1=10.0, fmin=0.3)
    gap = T / 2 + 0.3
    liner_t, scale_t = 0.8, 3.6
    Ti, Bi = inset(Tp, Bt, 0.3)
    parts = []
    for s in (1, -1):
        parts.append(K.slab("liner", Tp, Bt, gap, liner_t, s, M["metal"], dome=0.0, rows=1))
        for lo, hi, mat, dome in ((-22.0, 0.0, M["metal"], 0.5), (-129.0, -21.4, M["handle"], 0.6),
                                  (-151.0, -128.4, M["metal"], 0.5)):
            T2 = [p for p in Ti if lo <= p[0] <= hi]
            B2 = [p for p in Bi if lo <= p[0] <= hi]
            parts.append(K.slab("scale", T2, B2, gap + liner_t, scale_t, s, mat, dome=dome))
    zout = gap + liner_t + scale_t
    # small quillons on the front bolsters, one per side so the blade swings between them
    quill = []
    for s in (1, -1):
        q = K.prism("quillon", [(-4.4, -8.2, 1.4), (-1.6, -8.2, 1.4), (-1.6, 24.0, 1.4), (-4.4, 24.0, 1.4)],
                    *sorted((s * (gap + 0.1), s * (zout - 0.4))), M["metal"])
        K.bevel(q, 0.5, segs=1)
        quill.append(q)
        for yy in (-8.6, 24.4):
            quill.append(W.sphere("quillon_ball", (-3.0 * MM, yy * MM, s * (zout + gap) / 2 * MM), 2.5 * MM, 12,
                                  M["metal"], rings=6))
    back = [p for p in Tp if -140.0 <= p[0] <= -14.0]
    spring = K.plate("backspring", [(x, y - 0.25) for x, y in back] + [(x, bb(x)) for x, y in reversed(back)],
                     2 * gap, M["metal"])
    # push button and the sliding safety on the show side (-z)
    button = K.lathe_z("button", [(0.0, -zout - 1.6), (3.0, -zout - 1.5), (3.8, -zout - 0.9), (3.8, -zout + 0.4)], 16,
                       M["accent"], -44.0, 8.0)
    safety = K.prism("safety", [(-62.0, 6.0, 1.2), (-53.0, 6.0, 1.2), (-53.0, 10.0, 1.2), (-62.0, 10.0, 1.2)],
                     -zout - 1.0, -zout + 0.3, M["accent"])
    K.bevel(safety, 0.3, segs=1)
    hw = [K.pin("pivot_pin", px, py, 2.6, -zout - 0.3, zout + 0.3, M["metal"], segs=14),
          K.pin("rivet", -137.0, 8.0, 1.6, -zout - 0.2, zout + 0.2, M["metal"], segs=10)]
    k.add(*parts, *quill, spring, button, safety, *hw)
    k.pivot = (px, py)
    k.socket("socket_tip", *tip, parent="blade_pivot")
    k.socket("socket_pivot", px, py)
    k.socket("socket_grip", -70.0, 8.0)
    k.extras = std_extras("hammer", info, 150, 2 * zout, 20.8)
    return k


# ---------------------------------------------------------------- 13 talon (folding hawkbill with a ring)

def talon():
    k = K.Knife("talon")
    M = K.materials(handle=(0xe6dcc3, 0.42, 0.0, {"detail": "ivory", "color2": 0xcfc2a2, "strength": 0.6}),
                    metal=(0xbcc1c8, 0.28, 1.0), accent=(0xc49a4a, 0.3, 1.0))
    T = 3.8
    W0 = 13.5
    edge, spine = hawkbill(0.0, -60.0, 73.5, W0, 93.0, 29.0, n=42)
    b, tip, info = K.blade("blade", edge, spine, M, T, stations=48, grind="hollow", grind_h=0.56, ricasso=8,
                           swedge={"from": 0.6, "width": 3.8, "depth": 0.6}, taper=0.45)
    K.cut(b, K.lathe_z("c", [(3.9, -12), (3.9, 12)], 18, M["blade"], 15.0, 18.0))
    ridges = K.teeth("saw_ridges", spine, 24.0, 44.0, 6, 1.9, K.spine_thickness(T, spine, 0.45), M["blade"], rake=0.7, sink=0.35)
    px = -8.0

    def axis(x):
        return 13.5 - 0.0032 * x * x

    def top(x):
        return axis(x) + 13.0

    def bot(x):
        return axis(x) - 13.0 + 2.2 * bump(x, -24, 9)

    py = (top(px) - 3.2) / 2
    tang = K.plate("tang", folder_tang(px, py, 12.6, 26.6, 0.4), T - 0.12, M["blade"])
    k.add_blade(b, ridges, tang)
    Tp, Bt = outline(-1.5, -86.0, 30, top, bot, r0=4.0, r1=0.0)
    parts, zout = folder_handle(M, T, Tp, Bt, liner_t=0.9, scale_t=3.2, back=(-30.0, -86.0, 3.2), back_mat=M["metal"])
    Tb = [p for p in Tp if p[0] >= -15.0]
    Bb = [p for p in Bt if p[0] >= -15.0]
    gap = T / 2 + 0.3
    bols = [K.slab("bolster", Tb, Bb, gap + 0.9, 3.4, s, M["metal"], dome=0.45) for s in (1, -1)]
    rivets = [K.pin("rivet", x, axis(x), 1.9, -zout - 0.25, zout + 0.25, M["accent"], segs=12, dome=0.5)
              for x in (-30.0, -52.0, -74.0)]
    hw = [K.screw_head("pivot", px, py, 3.8, s * (zout + 0.3), s, M["metal"], socket="torx") for s in (1, -1)]
    ring_c = (-95.5, -15.3)
    ring = K.torus("ring", ring_c[0], ring_c[1], 14.4, 2.9, gap + 0.9, M["metal"], segs=40, tsegs=10, e=2.6)
    clear_ring(parts, ring_c, 11.5, M)
    k.add(*parts, *bols, *rivets, *hw, ring)
    k.pivot = (px, py)
    k.socket("socket_tip", *tip, parent="blade_pivot")
    k.socket("socket_pivot", px, py)
    k.socket("socket_grip", -42.0, axis(-42.0))
    k.socket("socket_ring", *ring_c)
    k.extras = std_extras("reverse_ring", info, 84, 2 * zout, 26.0, ringInnerRadius=0.0115)
    return k


# ---------------------------------------------------------------- 14 ursus

def ursus():
    k = K.Knife("ursus")
    M = K.materials(handle=(0x4a5236, 0.62, 0.0, {"detail": "g10", "strength": 1.00}),
                    metal=(0x9ea4ab, 0.32, 1.0), accent=(0x17181a, 0.5, 0.3))
    L, H, T = 108.0, 33.0, 4.6
    ty = 16.5
    edge = path(line((-4, 0), (79, 0), 9), line((79, 0), (L, ty), 5))
    spine = path(line((-4, H), (70, 33.3), 8), line((70, 33.3), (L, ty), 6))
    b, tip, info = K.blade("blade", edge, spine, M, T, stations=46, grind="flat", grind_h=0.5, ricasso=10,
                           swedge={"from": 0.66, "width": 4.0, "depth": 0.5}, corner_deg=10.0)
    jimp = K.teeth("jimping", spine, 3.0, 21.0, 9, 1.1, K.spine_thickness(T, spine), M["blade"], rake=0.5, sink=0.3)
    px = -9.0

    def top(x):
        return 35.4 + 0.8 * bump(x, -34, 20) - 1.6 * smooth(x, -102.0, -128.0)

    def bot(x):
        return -4.4 + 3.4 * bump(x, -17, 7) - 1.8 * bump(x, -72, 22) + 2.6 * smooth(x, -104.0, -128.0)

    py = fit_pivot("ursus", px, edge, spine, top, bot)
    bb = back_line(top, px, py, edge, 3.8)
    rt = min(top(px) - py, py - bot(px)) - 0.9
    tang = K.plate("tang", folder_tang(px, py, rt, H - 0.5, 0.5,
                                       extra_bottom=[(px + 1.0, -2.2), (px + 2.0, -10.0, 3.0), (px + 9.5, -11.0, 3.0),
                                                     (px + 13.0, -3.0, 2.0)]), T - 0.12, M["blade"])
    Tp, Bt = outline(-1.5, -128.0, 36, top, bot, r0=5.0, r1=4.0)
    parts, zout = folder_handle(M, T, Tp, Bt, liner_t=1.0, scale_t=3.6, back=(-34.0, -126.0, 3.8), back_bottom=bb)
    hw = [K.screw_head("pivot", px, py, 4.8, s * (zout - 0.2), s, M["metal"], socket="torx") for s in (1, -1)]
    hw += screws(M, [(-66.0, 30.4), (-117.0, 17.0)], zout - 0.2, r=2.5)
    cy = 16.2
    pommel = K.lathe_x("impact_pommel", [(0.0, -126.0), (10.5, -126.0), (10.8, -129.5), (8.6, -133.0), (4.0, -136.8),
                                          (1.4, -138.6), (0.0, -139.0)], 20, M["metal"], cy=cy)
    K.mark_sharp(pommel, 30)
    if URSUS_FOLDER:
        k.add_blade(b, jimp, tang)
        k.pivot = (px, py)
        k.socket("socket_tip", *tip, parent="blade_pivot")
        k.socket("socket_pivot", px, py)
    else:
        k.add_blade(b, jimp, tang)
        k.socket("socket_tip", *tip)
    k.add(*parts, *hw, pommel)
    k.socket("socket_grip", -62.0, 16.0)
    k.extras = std_extras("hammer", info, 139, 2 * zout, 39.0)
    return k


# ---------------------------------------------------------------- 15 classic

def classic():
    k = K.Knife("classic")
    M = K.materials(handle=(0x1e1f22, 0.58, 0.0, {"detail": "g10", "strength": 0.54}),
                    metal=(0xa3a9b0, 0.3, 1.0), accent=(0x3b3f45, 0.4, 0.8))
    L, H, T = 200.0, 38.0, 6.0
    ty = 17.0
    edge = path(line((-4, 0), (122, 0), 8), quad((122, 0), (184, 0.6), (L, ty), 12))
    spine = path(line((-4, H), (116, H), 8), quad((116, H), (156, 27.5), (L, ty), 12))
    # wide polished edge band, after the original's press-fit stellite edge
    b, tip, info = K.blade("blade", edge, spine, M, T, stations=54, grind="flat", grind_h=0.52, ricasso=16,
                           edge_bevel=3.2, shoulder=1.1, swedge={"from": 0.6, "width": 6.0, "depth": 0.6})
    k.add_blade(b)
    cy = 19.0
    guard = K.prism("guard", [(-8.0, 46.5, 3.0), (-1.5, 47.5, 2.5), (0.5, 38.0, 2.0), (0.5, 2.0, 2.0), (6.0, -4.0, 6.0),
                              (14.0, -11.0, 3.0), (13.0, -15.2, 2.2), (7.0, -15.0, 4.0), (-3.0, -9.5, 6.0),
                              (-8.0, -4.5, 3.0)], -6.2, 6.2, M["metal"])
    K.bevel(guard, 1.2, segs=2)
    spacer = K.loft("spacer", [(x, K.superellipse(cy, 15.2, 15.2, 12.6, 24, 2.8)) for x in (-8.0, -9.6)], M["accent"])

    def gshape(t):
        s = 1.0 + 0.04 * bump(t, 0.55, 0.3)
        g = grooves(t, 13, 0.055, 0.02, 0.98, 1.2)
        return (s * g, s * g, s * g)

    handle = grip("grip", -9.6, -118.0, cy, 29.0, 24.0, M["handle"], rings=66, segs=24, e=2.8, shape=gshape)
    psecs = [(x, K.superellipse(cy, 15.4 * s, 15.4 * s, 12.8 * s, 24, 3.0))
             for x, s in ((-117.0, 1.0), (-118.2, 1.06), (-123.4, 1.06), (-124.6, 1.0), (-125.0, 0.9))]
    pommel = K.loft("pommel", psecs, M["metal"], fan=False)
    K.mark_sharp(pommel, 30)
    k.add(guard, spacer, handle, pommel)
    k.socket("socket_tip", *tip)
    k.socket("socket_grip", -63.0, cy)
    k.extras = std_extras("hammer", info, 125, 26.0, 32.5)
    return k


# ---------------------------------------------------------------- 16 paracord

def cord_wrap(M, x0, x1, cy, hh, hw, cord, ppt=10, mat=None):
    pitch = cord * 2.08
    turns = int(abs(x0 - x1) / pitch)
    pts = []
    for i in range(turns * ppt + 1):
        turn = i / ppt
        a = turn * 2 * math.pi
        s, c = math.sin(a), math.cos(a)
        y = cy + math.copysign(abs(s) ** 0.55, s) * (hh + cord * 0.8)
        z = math.copysign(abs(c) ** 0.55, c) * (hw + cord * 0.8)
        pts.append((x0 - turn * pitch, y, z))
    return K.tube("cord_wrap", pts, cord, mat or M["handle"], sides=5, uv_scale=cord * 3 * MM)


def paracord():
    k = K.Knife("paracord")
    M = K.materials(handle=(0x4c5236, 0.9, 0.0, {"detail": "cord", "color2": 0x33382a, "strength": 1.0}),
                    metal=(0x7c8189, 0.45, 0.9), accent=(0x1d1e1f, 0.85, 0.0, {"detail": "cord", "strength": 0.8}))
    L, H, T = 130.0, 32.0, 5.0
    ty = 19.5
    edge = path(line((-4, 0), (2.0, 0)), arc(7.5, 0.0, 5.5, 180, 0, 8), line((13.0, 0), (100, 0), 8), line((100, 0), (L, ty), 5))
    spine = path(line((-4, H), (94, H), 8), line((94, H), (L, ty), 6))
    b, tip, info = K.blade("blade", edge, spine, M, T, stations=48, grind="flat", grind_h=0.55, ricasso=14,
                           swedge={"from": 0.7, "width": 4.5, "depth": 0.6}, corner_deg=10.0)
    cy = 16.0
    tang = K.plate("tang", [(1.0, cy + 12.0), (-104.0, cy + 12.0, 6.0), (-116.0, cy + 7.0, 6.0), (-116.0, cy - 7.0, 6.0),
                            (-104.0, cy - 12.0, 6.0), (1.0, cy - 12.0)], T - 0.12, M["blade"])
    K.cut(tang, K.lathe_z("c", [(3.6, -10), (3.6, 10)], 16, M["blade"], -108.0, cy))
    K.bevel(tang, 0.5, segs=1)
    k.add_blade(b, tang)
    wrap = cord_wrap(M, -3.0, -98.0, cy, 12.0, T / 2, 2.2)
    lan = lanyard_loop(M, -108.0, cy, length=30.0, width=8.0, cord=1.8)
    k.add(wrap, lan)
    k.socket("socket_tip", *tip)
    k.socket("socket_grip", -52.0, cy)
    k.extras = std_extras("hammer", info, 116, T + 4 * 2.2 + 1.6, 24.0 + 4 * 2.2 + 1.6)
    return k


# ---------------------------------------------------------------- 17 survival

def survival():
    k = K.Knife("survival")
    M = K.materials(handle=(0x1c1d1f, 0.74, 0.0, {"detail": "g10", "strength": 1.00}),
                    metal=(0x8f959c, 0.36, 1.0), accent=(0x6e747c, 0.35, 1.0))
    L, H, T = 130.0, 34.0, 5.0
    ty = 13.0
    edge = path(line((-4, 0), (70, 0), 7), quad((70, 0), (118, 0.5), (L, ty), 12))
    spine = path(line((-4, H), (72, H), 7), quad((72, H), (108, 32.6), (L, ty), 12))
    b, tip, info = K.blade("blade", edge, spine, M, T, stations=48, grind="flat", grind_h=0.55, ricasso=12,
                           swedge={"from": 0.7, "width": 4.0, "depth": 0.5})
    K.cut(b, hook_cutter(M, (79.5, 25.8), (88.5, 36.0), 2.8, T), transfer=True)
    saw = K.teeth("saw", spine, 18.0, 68.0, 9, 3.5, K.spine_thickness(T, spine), M["blade"], rake=0.62)
    k.add_blade(b, saw)
    cy = 17.0
    guard = K.prism("guard", [(-6.0, 38.5, 2.5), (0.0, 38.5, 1.5), (0.0, -1.0), (2.5, -7.5, 2.5), (-1.0, -10.0, 2.0),
                              (-6.0, -8.0, 2.5)], -7.0, 7.0, M["metal"])
    K.bevel(guard, 1.0, segs=2)

    def gshape(t):
        s = 1.0 + 0.05 * bump(t, 0.55, 0.3)
        fing = grooves(t, 3, 0.1, 0.03, 0.5, 1.5)
        return (s, s * fing, s)

    handle = grip("grip", -6.0, -127.0, cy, 30.0, 25.0, M["handle"], rings=40, segs=24, shape=gshape)
    bolts = [K.screw_head("bolt", x, cy + 0.5, 4.0, s * 12.2, s, M["accent"], height=1.4, socket="hex")
             for x in (-38.0, -96.0) for s in (1, -1)]
    cap = K.lathe_x("butt_cap", [(0.0, -126.0), (12.4, -126.0), (12.8, -129.0), (11.4, -134.0), (6.0, -137.2), (2.6, -139.4),
                                 (0.0, -140.0)], 22, M["metal"], cy=cy)
    K.cut(cap, K.lathe_z("c", [(2.8, -20), (2.8, 20)], 14, M["metal"], -131.5, cy))
    K.mark_sharp(cap, 30)
    k.add(guard, handle, cap, *bolts)
    k.socket("socket_tip", *tip)
    k.socket("socket_grip", -66.0, cy)
    k.extras = std_extras("hammer", info, 140, 26.0, 32.0)
    return k


# ---------------------------------------------------------------- 18 nomad

def nomad():
    k = K.Knife("nomad")
    M = K.materials(handle=(0x2c2a26, 0.62, 0.0, {"detail": "g10", "strength": 0.90}),
                    metal=(0xa7adb4, 0.3, 1.0), accent=(0x18191b, 0.5, 0.3))
    L, H, T = 104.0, 32.0, 4.0
    ty = 20.0
    edge = path(line((-4, 0), (28, 0), 4), cubic((28, 0), (66, -3.4), (94, 2.4), (L, ty), 16))
    spine = path(line((-4, H), (50, 32.6), 6), quad((50, 32.6), (90, 31.8), (L, ty), 12))
    b, tip, info = K.blade("blade", edge, spine, M, T, stations=48, grind="flat", grind_h=0.58, ricasso=9,
                           swedge={"from": 0.62, "width": 4.2, "depth": 0.55})
    px = -8.0

    def top(x):
        return 34.8 + 0.5 * bump(x, -30, 18) - 1.0 * bump(x, -72, 26) - 1.2 * smooth(x, -104.0, -130.0)

    def bot(x):
        return -3.2 + 2.6 * bump(x, -13, 6) - 2.2 * bump(x, -68, 20) + 1.0 * bump(x, -97, 9) - 3.2 * bump(x, -120, 9)

    py = fit_pivot("nomad", px, edge, spine, top, bot)
    bb = back_line(top, px, py, edge, 3.6)
    rt = min(top(px) - py, py - bot(px)) - 0.9
    tang = K.plate("tang", folder_tang(px, py, rt, H - 0.5, 0.5), T - 0.12, M["blade"])
    stud = K.pin("thumb_stud", 11.0, 25.0, 2.3, -T / 2 - 2.2, T / 2 + 2.2, M["accent"], segs=12)
    k.add_blade(b, tang, stud)
    Tp, Bt = outline(-1.5, -130.0, 38, top, bot, r0=5.0, r1=9.0)
    # composite inserts set inside an exposed steel frame
    parts, zout = folder_handle(M, T, Tp, Bt, liner_t=1.5, scale_t=2.8, inset_d=2.1, back=(-30.0, -108.0, 3.6),
                                back_mat=M["metal"], back_bottom=bb)
    hole_c = (-118.0, 15.4)
    for i, p in enumerate(parts):
        if p.name.startswith(("liner", "scale")):
            K.cut(p, K.lathe_z("c", [(4.6, -12), (4.6, 12)], 20, M["metal"], *hole_c))
    tube_ = K.lathe_z("lanyard_tube", [(4.6, -zout + 0.3), (5.6, -zout + 0.1), (5.6, -zout + 0.6), (4.6, -zout + 0.8),
                                       (4.6, zout - 0.8), (5.6, zout - 0.6), (5.6, zout - 0.1), (4.6, zout - 0.3)], 20,
                      M["metal"], *hole_c, closed=True)
    hw = [K.screw_head("pivot", px, py, 4.4, s * (zout - 0.2), s, M["metal"], socket="torx") for s in (1, -1)]
    hw += screws(M, [(-60.0, 30.0), (-100.0, 28.5)], zout - 0.3, r=2.3)
    k.add(*parts, tube_, *hw)
    k.pivot = (px, py)
    k.socket("socket_tip", *tip, parent="blade_pivot")
    k.socket("socket_pivot", px, py)
    k.socket("socket_grip", -62.0, 15.5)
    k.extras = std_extras("hammer", info, 130, 2 * zout, 40.0)
    return k


# ---------------------------------------------------------------- 19 skeleton

def skeleton():
    k = K.Knife("skeleton")
    M = K.materials(handle=(0x141416, 0.88, 0.0, {"detail": "tape", "strength": 0.7}),
                    metal=(0xbfc4cb, 0.3, 1.0), accent=(0x2b2d30, 0.6, 0.2))
    L, H, T = 100.0, 28.0, 4.2
    ty = 12.0
    edge = path(line((-4, 0), (60, 0), 6), quad((60, 0), (92, 0.5), (L, ty), 10))
    spine = path(line((-4, H), (54, H), 5), quad((54, H), (86, 26.4), (L, ty), 10))
    b, tip, info = K.blade("blade", edge, spine, M, T, stations=44, grind="hollow", grind_h=0.58, ricasso=8,
                           swedge={"from": 0.6, "width": 4.0, "depth": 0.55})
    k.add_blade(b)
    cy = 14.0
    frame_pts = [(1.5, 27.0), (-10.0, 27.8, 6.0), (-46.0, 27.0, 20.0), (-80.0, 25.0, 8.0), (-88.0, 20.0, 3.0),
                 (-88.0, 8.0, 3.0), (-80.0, 3.0, 8.0), (-46.0, 1.2, 20.0), (-16.0, 0.8, 8.0), (-8.0, -3.0, 3.0),
                 (-3.0, -3.2, 3.0), (1.5, 0.5)]
    frame = K.plate("frame", frame_pts, T - 0.12, M["metal"])
    cut1 = hole_cutter(M, K.rounded([(-7.0, 8.0, 5.0), (-27.0, 8.6, 5.0), (-27.0, 20.4, 5.0), (-7.0, 21.0, 5.0)], 5))
    cut2 = hole_cutter(M, K.rounded([(-58.0, 8.6, 5.0), (-79.0, 9.4, 4.5), (-79.0, 19.2, 4.5), (-58.0, 20.4, 5.0)], 5))
    K.cut(frame, [cut1, cut2])
    K.bevel(frame, 0.7, segs=2, angle=40)
    ring_c = (-97.0, cy)
    ring = K.torus("ring", ring_c[0], ring_c[1], 13.75, 2.75, T / 2 + 0.15, M["metal"], segs=36, tsegs=10, e=2.8)
    clear_ring([frame], ring_c, 11.0, M)
    # grip tape band between the two windows
    tsecs = []
    for i in range(14):
        t = i / 13
        x = K.lerp(-29.0, -56.0, t)
        ridge = 0.25 if i in (4, 9) else 0.0
        top_y = 27.9 - 0.9 * bump(x, -46.0, 30) + 1.0 + ridge
        bot_y = 1.2 - 1.0 - ridge
        tsecs.append((x, K.superellipse((top_y + bot_y) / 2, (top_y - bot_y) / 2, (top_y - bot_y) / 2, T / 2 + 1.1 + ridge,
                                        20, 8.0)))
    tape = K.loft("tape", tsecs, M["handle"])
    k.add(frame, ring, tape)
    k.socket("socket_tip", *tip)
    k.socket("socket_grip", -44.0, cy)
    k.socket("socket_ring", *ring_c)
    k.extras = std_extras("hammer", info, 88, T + 1.5, 28.0, ringInnerRadius=0.011)
    return k


# ---------------------------------------------------------------- 20 kukri

def kukri():
    k = K.Knife("kukri")
    M = K.materials(handle=(0x5a3a22, 0.55, 0.0, {"detail": "wood", "color2": 0x33200f}),
                    metal=(0xb68b4c, 0.32, 1.0), accent=(0x2a1a10, 0.6, 0.0))
    T = 8.5
    spine = path(line((-6, 33), (22, 35.5), 3), cubic((22, 35.5), (95, 42.0), (195, 30.0), (250, -14.0), 22))
    edge = path(line((-6, 0), (27, 0), 4), cubic((27, 0), (80, -5.5), (148, -31.0), (204, -34.5), 16),
                quad((204, -34.5), (240, -31.5), (250, -14.0), 8))
    b, tip, info = K.blade("blade", edge, spine, M, T, stations=58, grind="flat", grind_h=0.32, ricasso=34,
                           taper=0.65, taper_min=0.3, swedge={"from": 0.86, "width": 5.0, "depth": 0.5})
    # cho (kaudi): the "3" shaped notch at the base of the edge
    cho = [K.lathe_z("c", [(3.3, -12), (3.3, 12)], 16, M["blade"], x, -0.6) for x in (11.0, 18.0)]
    K.cut(b, cho)
    k.add_blade(b)
    cy = 17.0
    bsecs = [(x, K.superellipse(cy, h, h, w, 24, 2.4)) for x, h, w in
             ((0.8, 16.2, 6.0), (-1.0, 16.4, 9.5), (-4.0, 16.3, 12.5), (-12.0, 15.8, 13.5), (-14.0, 15.4, 13.2))]
    bolster = K.loft("bolster", bsecs, M["metal"])

    def gshape(t):
        rings = 0.07 * (bump(t, 0.3, 0.025) + bump(t, 0.47, 0.025) + bump(t, 0.64, 0.025))
        flare = 0.42 * smooth(t, 0.7, 1.0) ** 1.5
        return (1.0 + rings + 0.12 * flare, 1.0 + rings + flare, 1.0 + rings + 0.4 * flare, -2.2 * smooth(t, 0.7, 1.0))

    handle = grip("grip", -14.0, -113.0, cy, 29.0, 25.0, M["handle"], rings=54, segs=24, shape=gshape)
    last = gshape(1.0)
    csecs = [(x, K.superellipse(cy + last[3], 14.5 * last[0] * s, 14.5 * last[1] * s, 12.5 * last[2] * s, 24, 2.4))
             for x, s in ((-112.6, 1.0), (-113.6, 1.03), (-117.2, 1.03), (-118.0, 0.96))]
    cap = K.loft("butt_cap", csecs, M["metal"], fan=False)
    K.mark_sharp(cap, 30)
    nub = K.lathe_x("tang_peen", [(0.0, -120.0), (3.0, -119.6), (3.6, -118.0), (3.6, -117.0)], 12, M["metal"],
                    cy=cy + last[3])
    k.add(bolster, handle, cap, nub)
    k.socket("socket_tip", *tip)
    k.socket("socket_grip", -62.0, cy)
    k.extras = std_extras("hammer", info, 120, 26.0, 33.0)
    return k


BUILDERS = {
    "bayonet": bayonet,
    "m9_bayonet": m9_bayonet,
    "karambit": karambit,
    "butterfly": butterfly,
    "flip": flip,
    "gut": gut,
    "huntsman": huntsman,
    "falchion": falchion,
    "shadow_daggers": shadow_daggers,
    "bowie": bowie,
    "navaja": navaja,
    "stiletto": stiletto,
    "talon": talon,
    "ursus": ursus,
    "classic": classic,
    "paracord": paracord,
    "survival": survival,
    "nomad": nomad,
    "skeleton": skeleton,
    "kukri": kukri,
}


# ---------------------------------------------------------------- driver

def quick_renders(kid, root):
    W.setup_studio(strength=0.3)
    lights = [W.add_light("key", (-0.25, 0.3, 0.45), (0, 0, 0), 60.0, size=0.6),
              W.add_light("fill", (0.3, -0.4, 0.2), (0, 0, 0), 25.0, size=0.6)]
    qdir = os.path.join(K.TMP, "quick")
    xs, zs = [], []
    for o in root.children_recursive:
        if o.type != "MESH":
            continue
        for v in o.data.vertices:
            p = o.matrix_world @ v.co
            xs.append(p.x)
            zs.append(p.z)
    cx, cz = (min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2
    span = max(max(xs) - min(xs), (max(zs) - min(zs)) * 2.7)
    W.render(os.path.join(qdir, f"{kid}_side.png"), (cx, 1.0, cz), (cx, 0.0, cz), resolution=(1400, 520),
             samples=24, ortho_scale=span * 1.08)
    W.render(os.path.join(qdir, f"{kid}_34.png"), (cx - 0.16, -0.26, cz + 0.2), (cx, 0.0, cz), lens=50,
             resolution=(1200, 700), samples=24)
    for light in lights:
        K.bpy.data.objects.remove(light, do_unlink=True)


def build_one(kid):
    K.common.reset_scene()
    k = BUILDERS[kid]()
    root, meshes = K.assemble(k)
    total = K.report(kid, meshes)
    assert total <= MAX_TRIS, f"{kid} over budget: {total}"
    os.makedirs(OUT, exist_ok=True)
    if not NO_BAKE:
        used = {m.name: m for o in meshes for m in o.data.materials if m}
        for name, mat in used.items():
            kbake.detail_shader(mat, K.MAT_SPECS[name])
        kbake.unwrap(meshes)
        handle_kind = K.MAT_SPECS.get("knife_handle", (0, 0, 0, {}))[3].get("detail", "none")
        sizes = {"steel": STEEL_TEX, "fittings": FITTING_TEX,
                 # periodic checkering and weave cost four times as much at 2048 after webp
                 "handle": HANDLE_TEX if handle_kind not in ("bead", "none", "knurl", "cord") else FITTING_TEX}
        kbake.bake(kid, meshes, sizes)
    K.export(root, os.path.join(OUT, f"{kid}.glb"))
    if QUICK:
        quick_renders(kid, root)
    lod1 = 0
    if not NO_LOD:
        kbake.decimate(meshes, LOD1_RATIO)
        lod1 = K.W.tri_count(meshes)
        K.export(root, os.path.join(OUT, f"{kid}_lod1.glb"))
        print(f"[knives] {kid} lod1: {lod1} tris")
    return total, lod1


# the knives the game ships (src/combat/knives.ts); the retired ones still build by id
SHIPPED = ["karambit", "butterfly", "m9_bayonet", "talon", "skeleton", "bayonet",
           "flip", "stiletto", "huntsman", "bowie", "gut", "shadow_daggers"]


def main():
    ids = ONLY or SHIPPED
    totals = {}
    for kid in ids:
        totals[kid] = build_one(kid)
    for kid, (t, t1) in totals.items():
        print(f"[knives] {kid:15s} {t:6d} tris  lod1 {t1:6d}")


main()
