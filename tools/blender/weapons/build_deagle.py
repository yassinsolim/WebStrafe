"""builds the deagle viewmodel, a heavy .50 gas pistol laid out like the
magnum research desert eagle mark xix with the 6 in barrel. original model:
every vertex comes from this script. sizes follow the published mark xix
numbers (273 mm long, 159 mm tall, 32 mm slide, 70 mm trigger reach) and the
proportions were measured off real side photos.

  blender -b --factory-startup --python-exit-code 1 -P tools/blender/weapons/build_deagle.py -- \
      [--out .blender-tmp/weapons/deagle_raw.glb] [--renders docs/screenshots/weapons] [--quick] [--size 2048]

then optimize (keep png so ktx2 encodes from lossless sources) and convert the textures to ktx2:
  npx tsx tools/assets/optimize-glb.ts .blender-tmp/weapons/deagle_raw.glb public/viewmodels/v2/deagle.glb \
      --texture-size 1024 --no-webp
  npx tsx tools/assets/ktx2-textures.ts public/viewmodels/v2/deagle.glb public/viewmodels/v2/deagle.glb

the script builds the gun twice: the low poly that ships and a high poly with
rounder bevels, finer curves and small details, which is baked onto the low
poly's uv atlas (normal, ao, edge wear and material maps). --quick skips the
high poly and the bake and renders flat materials.

design units are millimetres. y runs forward along the bore with y=0 where the
slide's slanted rear face crosses the bore height, z=0 is the bore axis and x
points right. at the end everything is shifted so socket_grip_r is the origin.
"""

import math
import os
import sys

from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wlib as W  # noqa: E402
from wlib import MM  # noqa: E402

ARGS = W.common.script_args()


def arg(name, default=None):
    return ARGS[ARGS.index(name) + 1] if name in ARGS else default


QUICK = "--quick" in ARGS
# stainless (default) or black
FINISH = arg("--finish", "stainless")
OUT = arg("--out", os.path.join(W.TMP, "deagle_raw.glb"))
RENDERS = arg("--renders", None)
SIZE = int(arg("--size", "2048"))

# slide and barrel
MUZZLE_Y = 232.5
HW = 16.0                        # slide and barrel half width (32 mm)
RAIL_TOP = 12.5                  # top of the rail teeth
FLANK_TOP = (9.0, 9.5)           # (x, z) where the sloped flank meets the rail base
EDGE_Z = -3.5                    # the long horizontal edge under the flanks
ARM_TOP = -5.8                   # top of the slide arms, bottom of the visible barrel
SLIDE_BOTTOM = -26.0
CHAMFER_X, CHAMFER_Z = 12.5, -17.5   # lower chamfer on the slide arms and the front block
ARM_IN = 9.5                     # inner face of the slide arms
HOOD_Y = 74.3                    # front face of the slide's rear block, the barrel starts here
HOOD_TOP = 16.0
DECK_Z = 10.5                    # low deck at the back that carries the rear sight
SLANT_DEG = 17.4                 # rear face and serrations lean forward at the top
SLANT = math.tan(math.radians(SLANT_DEG))
CHAMBER_R = 14.2
SCOOP_Y, SCOOP_R = 106.0, 20.0   # the flank cut runs out in an arc over the round chamber
FRONT_BLOCK_Y = 204.0
RAIL_SLOTS = [123.5 + 10.6 * k for k in range(8)]
SLIDE_TRAVEL_M = 0.045

# frame
FRAME_HW = 14.5
DUST_HW = 11.0
DUST_BOTTOM = -29.7
GUARD_IN = [(59.5, -36.0), (97.3, -36.0, 2.0), (97.3, -64.5, 3.0), (64.0, -64.5, 5.5), (59.5, -58.5, 3.5)]
HAMMER_PIVOT = (-12.5, -30.5)
HAMMER_REST_DEG = 4.0            # cocked hammer leans this far behind vertical
HAMMER_FIRE_DEG = 21.0           # swing forward until the face sits on the firing pin
TRIGGER_PIVOT = (63.5, -33.0)
TRIGGER_PULL_DEG = 10.0

# grip outline: (z, front y, rear y, half width). the front strap is nearly
# vertical and the back flares out into a palm swell. the rubber wraps the
# sides and the back, the metal front strap stays bare
GRIP_SECTIONS = [(-127.5, 49.3, -23.0, 15.8), (-118.0, 49.6, -22.5, 16.2), (-102.0, 50.3, -19.5, 16.5),
                 (-86.0, 50.9, -13.5, 16.5), (-74.0, 51.3, -8.0, 16.4), (-62.0, 51.8, -5.5, 16.2),
                 (-50.0, 52.2, -6.5, 16.0), (-40.0, 52.5, -9.5, 15.8)]
GRIP_R_FRONT, GRIP_R_REAR = 7.0, 8.0
RUBBER_T = 1.6                   # rubber thickness over the metal core
RUBBER_FRONT = 5.5               # rubber stops this far behind the front strap
# socket_grip_r leans with the front strap the fingers wrap (the grip's centreline
# rakes about 10 degrees because of the palm swell). at this height the index
# finger's line crosses the lower half of the trigger face and the middle finger
# sits just under the guard
GRIP_RAKE = 4.0
GRIP_SOCKET = (22.9, -66.8)
# stippled fields on each side, split by the smooth diagonal band of the stock grip
PAD_UPPER = [(1.0, -50.5), (30.0, -51.5), (39.5, -54.5, 3.0), (42.5, -60.0, 2.0), (42.5, -68.5), (-10.0, -95.6),
             (-8.5, -85.0), (-4.5, -73.0), (-1.0, -61.0)]
PAD_LOWER = [(42.5, -82.0), (42.5, -121.0, 2.5), (-17.0, -121.0, 3.0), (-18.0, -113.3)]

# magazine: it follows the front strap, so it rakes less than the grip
MAG_RAKE = 2.5
MAG_AXIS = (23.5, -128.0)        # magazine axis where it leaves the grip
MAG_TOP_Z = -29.0
BASE_Y = (-1.0, 50.0)
BASE_Z = (-133.5, -138.5)
MAG_M = Matrix.Translation(Vector((0, MAG_AXIS[0] * MM, MAG_AXIS[1] * MM))) @ Matrix.Rotation(math.radians(-MAG_RAKE), 4, "X")
MAG_S_TOP = (MAG_TOP_Z - MAG_AXIS[1]) / math.cos(math.radians(MAG_RAKE))

# the eye in weapon space (blender axes, metres from socket_grip_r) with the
# gun at its idle viewmodel pose, used to give near parts more texels
EYE = Vector((-0.14, -0.32, 0.155))


def final(x, y, z):
    """design mm -> exported metres (origin on socket_grip_r)"""
    return (x * MM, (y - GRIP_SOCKET[0]) * MM, (z - GRIP_SOCKET[1]) * MM)


def rear_face_y(z):
    return z * SLANT


def mag_point(t, s, x=0.0):
    """design mm of a point in magazine coords (t forward, s up the magazine)"""
    p = MAG_M @ Vector((x * MM, t * MM, s * MM))
    return (p.x / MM, p.y / MM, p.z / MM)


# ---------------------------------------------------------------- shape helpers

side, front, top, cube, pin_x, rod_y, bevel_worn, sx_range = (W.side, W.front, W.top, W.cube, W.pin_x, W.rod_y,
                                                             W.bevel_worn, W.sx_range)


def slot(name, b, t, width, x0, x1, mat):
    """round ended slot from b to t (y, z mm), extruded across x"""
    d = Vector((t[0] - b[0], t[1] - b[1])).normalized()
    p = Vector((d.y, -d.x)) * (width / 2)
    r = width * 0.49
    pts = [(b[0] + p.x, b[1] + p.y, r), (t[0] + p.x, t[1] + p.y, r), (t[0] - p.x, t[1] - p.y, r), (b[0] - p.x, b[1] - p.y, r)]
    return side(name, pts, x0, x1, mat)


def trapezoid(bottom):
    """front section of the barrel: vertical sides, then the flanks slope in to the rail base"""
    fx, fz = FLANK_TOP
    return [(-HW, bottom), (HW, bottom), (HW, EDGE_Z), (fx, fz), (-fx, fz), (-HW, EDGE_Z)]


def chamfered(top_z, bottom_z, x_in=None):
    """front section below the barrel with the lower chamfer (whole block, or one arm when x_in is set)"""
    k = (HW - CHAMFER_X) / (CHAMFER_Z - SLIDE_BOTTOM)
    xb = CHAMFER_X - k * (SLIDE_BOTTOM - bottom_z)
    if x_in is None:
        return [(-HW, top_z), (HW, top_z), (HW, CHAMFER_Z), (xb, bottom_z), (-xb, bottom_z), (-HW, CHAMFER_Z)]
    return [(x_in, top_z), (HW, top_z), (HW, CHAMFER_Z), (xb, bottom_z), (x_in, bottom_z)]


def mirrored(pts):
    return [(-p[0], *p[1:]) for p in reversed(pts)]


def grip_rows():
    """the grip sections with smooth steps in between (catmull-rom through
    the measured ones), so the palm swell doesn't show loft kinks"""
    per = 4 if W.hi() else 2
    keys = [(z, f, r, hw) for z, f, r, hw in GRIP_SECTIONS]
    return W.smooth_curve(keys, per)


def grip_section(z, front_y, rear_y, hw, grow=0.0, segs=6, r_front=GRIP_R_FRONT, r_rear=GRIP_R_REAR):
    """horizontal section of the grip (a rounded rectangle), for W.loft along z"""
    pts = [(-hw - grow, rear_y - grow, r_rear), (hw + grow, rear_y - grow, r_rear),
           (hw + grow, front_y + grow, r_front), (-hw - grow, front_y + grow, r_front)]
    return (z * MM, W.fillet(W.mm(pts), segs))


def mag_local_prism(name, t0, t1, xh, s0, s1, mat, r_front=4.0, r_rear=1.5):
    """rounded prism along the magazine axis, still in magazine coords (metres)"""
    sec = W.fillet(W.mm([(-xh, t0, r_rear), (xh, t0, r_rear), (xh, t1, r_front), (-xh, t1, r_front)]), 3)
    return W.prism(name, sec, "Z", s0 * MM, s1 * MM, mat)


def point_segment_distance(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(1e-9, ab.length_squared)))
    return (a + ab * t - p).length


def inside_polygon(p, poly):
    inside = False
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        if (a.y > p.y) != (b.y > p.y):
            x = a.x + (p.y - a.y) * (b.x - a.x) / (b.y - a.y)
            if x > p.x:
                inside = not inside
    return inside


def hi_cut(obj, cutters):
    """small cuts (ridges, slots, anti-glare lines) only go into the high poly:
    the bake carries them in the normal and cavity maps, the low poly saves
    the triangles"""
    if W.hi():
        W.boolean(obj, cutters)
    else:
        for c in cutters:
            W.delete(c)
    return obj


# ---------------------------------------------------------------- materials

def make_materials():
    if FINISH == "black":
        # black nitride on the slide and barrel, a rougher black on the frame,
        # bare steel on the controls and where the finish wears off the edges
        metals = {
            "dark": W.finish("mat_steel_dark", base=0x34363a, rough=0.36, metal=0.8, wear=0.85, wear_color=0x9a9ea4,
                             wear_rough=0.24, wear_metal=1.0, grime=0.35, rvar=0.07, scratch=0.6, detail="brushed"),
            "frame": W.finish("mat_gunmetal", base=0x383a3e, rough=0.44, metal=0.75, wear=0.75, wear_color=0x8f9398,
                              wear_rough=0.28, wear_metal=1.0, grime=0.45, rvar=0.08, scratch=0.5, detail="plastic"),
            "steel": W.finish("mat_steel", base=0x55585e, rough=0.32, metal=1.0, wear=0.7, wear_color=0xa6aab0,
                              wear_rough=0.2, grime=0.45, rvar=0.06, scratch=0.4, detail="brushed"),
        }
        metals["sight"] = metals["dark"]
    else:
        # satin stainless slide and barrel (brushed along the bore), a rougher
        # bead blasted frame as the second tone, darker steel controls and
        # matte black sights. the black finish lost the gun against bright maps
        # once the viewmodel took the world's light
        metals = {
            "dark": W.finish("mat_stainless", base=0xa3a7ad, rough=0.28, metal=1.0, wear=0.55, wear_color=0xc9cdd2,
                             wear_rough=0.16, grime=0.35, rvar=0.07, scratch=0.55, detail="brushed"),
            "frame": W.finish("mat_stainless_frame", base=0x8e9298, rough=0.4, metal=1.0, wear=0.5, wear_color=0xbcc0c6,
                              wear_rough=0.22, grime=0.45, rvar=0.09, scratch=0.45, detail="plastic"),
            "steel": W.finish("mat_steel", base=0x62666c, rough=0.3, metal=1.0, wear=0.65, wear_color=0xa9adb3,
                              wear_rough=0.2, grime=0.45, rvar=0.06, scratch=0.4, detail="brushed"),
            "sight": W.finish("mat_sight_black", base=0x2a2b2e, rough=0.5, metal=0.6, wear=0.45, wear_color=0x8a8d92,
                              wear_rough=0.3, wear_metal=1.0, grime=0.3, rvar=0.05, scratch=0.3, detail="plastic"),
        }
    return {
        **metals,
        "worn": None,
        "rubber": W.finish("mat_rubber", base=0x1c1c1e, rough=0.62, wear=0.25, wear_color=0x242428, wear_rough=0.45,
                           grime=0.5, rvar=0.08, scratch=0.1, bump="grain"),
        "grip": W.finish("mat_grip", base=0x161617, rough=0.85, wear=0.35, wear_color=0x202023, wear_rough=0.6,
                         grime=0.6, rvar=0.05, scratch=0.05, bump="stipple"),
        "dot": W.finish("mat_sight_dot", base=0xe9e6dc, rough=0.45, grime=0.3, rvar=0.03, scratch=0.05),
        "red": W.finish("mat_paint_red", base=0xc0221c, rough=0.5, wear=0.3, wear_color=0x8c8f94, wear_rough=0.3,
                        wear_metal=1.0, grime=0.3, rvar=0.04),
        "brass": W.finish("mat_brass", base=0xc49a4a, rough=0.3, metal=1.0, wear=0.4, wear_color=0xdcbc78,
                          wear_rough=0.2, grime=0.4, rvar=0.1, scratch=0.3, detail="brushed"),
    }


# ---------------------------------------------------------------- slide

SAFETY_HUB = (8.3, -1.9)
SAFETY_PLATE = [(1.3, -8.9, 6.5), (31.5, -6.2, 2.5), (33.0, -4.3, 2.5), (33.0, 3.8, 2.5), (31.0, 5.6, 2.5),
                (1.3, 5.1, 6.5)]


def serration_top(yb, zb, plate, z_max=1.0, margin=1.2):
    """highest point a slanted groove can reach without running under the safety plate"""
    z = zb
    while z < z_max:
        nz = min(z_max, z + 0.25)
        p = Vector((yb + (nz - zb) * SLANT, nz))
        near = any(point_segment_distance(p, plate[i], plate[(i + 1) % len(plate)]) < margin
                   for i in range(len(plate)))
        if near or inside_polygon(p, plate):
            return z
        z = nz
    return z


def build_slide(M):
    d = M["dark"]
    # rear block: side profile (slanted rear face, low deck, ramp up to the hood)
    # intersected with the hood's front profile, rounded over the chamber
    block = side("slide_block", [(rear_face_y(SLIDE_BOTTOM), SLIDE_BOTTOM), (HOOD_Y, SLIDE_BOTTOM),
                                 (HOOD_Y, HOOD_TOP), (34.5, HOOD_TOP, 6.0), (15.5, DECK_Z, 4.0),
                                 (rear_face_y(DECK_Z), DECK_Z, 2.2)], -HW - 1.0, HW + 1.0, d)
    hood = front("c", [(-HW, SLIDE_BOTTOM - 1.0), (HW, SLIDE_BOTTOM - 1.0), (HW, HOOD_TOP, 9.0), (-HW, HOOD_TOP, 9.0)],
                 -20.0, HOOD_Y + 1.0, d)
    W.boolean(block, hood, op="INTERSECT")
    # the two arms run forward under the barrel to the front block
    for sx in (1, -1):
        sec = chamfered(ARM_TOP, SLIDE_BOTTOM, ARM_IN)
        arm = front("slide_arm", sec if sx > 0 else mirrored(sec), HOOD_Y - 1.0, FRONT_BLOCK_Y, d)
        W.boolean(block, arm, op="UNION")

    # 12 slanted grooves each side, the ones under the safety stop short of it
    plate = [Vector(p) for p in W.fillet(SAFETY_PLATE, 4)]
    grooves = []
    for i in range(12):
        yb, zb = -4.6 + 6.1 * i, -24.4
        zt = serration_top(yb, zb, plate)
        b, t = (yb, zb), (yb + (zt - zb) * SLANT, zt)
        for sx in (1, -1):
            grooves.append(slot("c", b, t, 2.1, *sx_range(sx, HW - 1.2, HW + 2.0), d))
    W.boolean(block, grooves)
    bevel_worn(block, M["worn"], 0.65, segs=2)

    # rear sight: vertical back face with anti-glare lines, square notch, two dots
    rs0, rs1, rtop = 2.4, 14.5, 18.8
    s = M["sight"]
    sight = side("rear_sight", [(rs0, DECK_Z - 0.5), (rs1, DECK_Z - 0.5), (rs0 + 6.0, rtop, 0.9), (rs0, rtop, 0.5)],
                 -11.0, 11.0, s)
    W.boolean(sight, cube("c", -1.9, 1.9, rs0 - 1.0, rs1 + 1.0, rtop - 3.0, rtop + 1.0, s))
    hi_cut(sight, [cube("c", -12.0, 12.0, rs0 - 1.0, rs0 + 0.35, z - 0.28, z + 0.28, s) for z in (11.7, 12.9, 14.1)])
    bevel_worn(sight, M["worn"], 0.3)
    dots = [rod_y("rear_dot", sx * 5.6, 16.4, [(1.0, rs0 - 0.25), (1.0, rs0 + 0.6)], 12, M["dot"]) for sx in (1, -1)]

    # plate and firing pin on the slanted rear face
    rear_plate = cube("rear_plate", -5.0, 5.0, -0.25, 0.4, -7.0, 7.0, M["steel"])
    W.rotate(rear_plate, -SLANT_DEG, "X", (0, 0, 0))
    W.transform(rear_plate, Matrix.Translation(Vector((0, rear_face_y(-8.0) * MM, -8.0 * MM))))
    W.bevel(rear_plate, 0.15 * MM, segs=1)
    pin_z = -4.5
    firing_pin = rod_y("firing_pin", 0, pin_z, [(1.5, rear_face_y(pin_z) - 0.45), (1.5, rear_face_y(pin_z) + 1.0)], 12,
                       M["steel"])

    # rotating bolt head on the hood's front face, only seen with the slide back
    bolt = rod_y("bolt_head", 0, 0, [(8.0, HOOD_Y - 0.5), (8.0, HOOD_Y + 4.0), (7.0, HOOD_Y + 5.0), (0.0, HOOD_Y + 5.0)],
                 20, M["steel"])
    lugs = [cube("bolt_lug", -2.2, 2.2, HOOD_Y - 0.5, HOOD_Y + 4.0, 7.0, 10.2, M["steel"]) for _ in range(3)]
    for k, lug in enumerate(lugs):
        W.rotate(lug, 60.0 + 120.0 * k, "Y", (0, 0, 0))
    W.bevel(bolt, 0.3 * MM, segs=1)

    parts = [block, sight, rear_plate, firing_pin, bolt] + dots + lugs
    # ambidextrous safety: teardrop plate, slotted hub, paddle lever, red fire dot
    hy, hz = SAFETY_HUB
    for sx in (1, -1):
        plate_obj = side("safety_plate", SAFETY_PLATE, *sx_range(sx, HW - 0.3, HW + 1.0), d)
        bevel_worn(plate_obj, M["worn"], 0.35)
        hub = pin_x("safety_hub", hy, hz, 4.2, *sx_range(sx, HW + 0.8, HW + 2.0), M["steel"], segs=20)
        cut = cube("c", *sx_range(sx, HW + 1.55, HW + 2.6), hy - 3.8, hy + 3.8, hz - 0.45, hz + 0.45, M["steel"])
        W.rotate(cut, 30.0, "X", (0, hy * MM, hz * MM))
        W.boolean(hub, cut)
        W.bevel(hub, 0.3 * MM, segs=1)
        arm = side("safety_arm", [(hy, hz - 2.2), (20.5, -1.2), (20.5, 2.8), (hy, hz + 2.2)],
                   *sx_range(sx, HW + 0.8, HW + 1.7), M["steel"])
        paddle = side("safety_paddle", [(19.0, -1.2, 1.5), (31.5, 0.6, 2.0), (32.6, 3.6, 1.8), (30.6, 5.4, 1.5),
                                        (20.5, 4.4, 1.8), (17.8, 1.6, 1.5)], *sx_range(sx, HW + 0.8, HW + 2.6),
                      M["steel"])
        hi_cut(paddle, [cube("c", *sx_range(sx, HW + 2.2, HW + 3.2), y - 0.35, y + 0.35, -3.0, 7.0, M["steel"])
                        for y in (25.8, 27.6, 29.4)])
        W.bevel(arm, 0.25 * MM, segs=1)
        W.bevel(paddle, 0.35 * MM, segs=1)
        red = pin_x("fire_dot", 21.6, -9.6, 1.1, *sx_range(sx, HW - 0.3, HW + 0.1), M["red"], segs=12)
        parts += [plate_obj, hub, arm, paddle, red]
    return W.join(parts, "slide_parts")


# ---------------------------------------------------------------- barrel

RAIL = [(-7.2, 9.3), (7.2, 9.3), (7.2, 10.5), (8.4, 11.6), (8.4, 12.0), (7.9, RAIL_TOP), (-7.9, RAIL_TOP),
        (-8.4, 12.0), (-8.4, 11.6), (-7.2, 10.5)]


def scoop_cutter(mat):
    """everything outside the flanks and above the rail base, in front of the
    point where the milling pass runs out. the back end is an arc in side view,
    which leaves the curved scoop on the round chamber"""
    box = cube("c", -25.0, 25.0, SCOOP_Y - 2.0, 160.0, ARM_TOP - 10.0, 30.0, mat)
    W.boolean(box, front("c", trapezoid(ARM_TOP - 12.0), SCOOP_Y - 5.0, 165.0, mat))
    cy, cz = SCOOP_Y + SCOOP_R, HOOD_TOP
    step = 2 if W.hi() else 5
    arc = [(cy - SCOOP_R * math.cos(math.radians(a)), cz - SCOOP_R * math.sin(math.radians(a)))
           for a in range(0, 91, step)]
    lim = side("c", [(165.0, 32.0), (SCOOP_Y, 32.0)] + arc + [(cy, ARM_TOP - 12.0), (165.0, ARM_TOP - 12.0)],
               -30.0, 30.0, mat, segs=1)
    W.boolean(box, lim, op="INTERSECT")
    return box


def build_barrel(M):
    d = M["dark"]
    body = front("barrel", trapezoid(ARM_TOP), HOOD_Y, MUZZLE_Y, d)
    # round chamber section behind the flanks
    chamber = rod_y("chamber", 0, 0, [(CHAMBER_R, HOOD_Y), (CHAMBER_R, SCOOP_Y + SCOOP_R + 4.0)], 40, d)
    W.boolean(chamber, cube("c", -20.0, 20.0, HOOD_Y - 1.0, 160.0, -30.0, ARM_TOP, d))
    W.boolean(chamber, scoop_cutter(d))
    W.boolean(body, chamber, op="UNION")
    W.boolean(body, front("rail", RAIL, SCOOP_Y + 0.6, MUZZLE_Y, d), op="UNION")
    # front block below the muzzle, down over the end of the frame: chamfered
    # lower corners and a slanted lower front face
    fb = side("front_block", [(FRONT_BLOCK_Y, ARM_TOP + 1.0), (MUZZLE_Y, ARM_TOP + 1.0), (MUZZLE_Y, -13.0),
                              (MUZZLE_Y - 5.5, DUST_BOTTOM), (FRONT_BLOCK_Y, DUST_BOTTOM)], -HW - 1.0, HW + 1.0, d)
    W.boolean(fb, front("c", chamfered(ARM_TOP + 2.0, DUST_BOTTOM - 1.0), FRONT_BLOCK_Y - 1.0, MUZZLE_Y + 1.0, d),
              op="INTERSECT")
    W.boolean(body, fb, op="UNION")
    # gas block between the slide arms, only seen when the slide is back
    W.boolean(body, cube("barrel_core", -ARM_IN + 0.2, ARM_IN - 0.2, HOOD_Y, FRONT_BLOCK_Y + 1.0, SLIDE_BOTTOM + 0.5,
                         ARM_TOP + 1.0, d), op="UNION")

    cuts = [
        rod_y("c", 0, 0, [(0.0, MUZZLE_Y - 30.0), (6.35, MUZZLE_Y - 30.0), (6.35, MUZZLE_Y - 1.2), (7.7, MUZZLE_Y + 0.5),
                          (0.0, MUZZLE_Y + 0.5)], 28, d),
        rod_y("c", 0, 0, [(0.0, HOOD_Y + 22.0), (6.9, HOOD_Y + 22.0), (6.9, HOOD_Y + 0.6), (7.6, HOOD_Y - 0.5),
                          (0.0, HOOD_Y - 0.5)], 24, d),
    ]
    cuts += [cube("c", -12.0, 12.0, c - 2.65, c + 2.65, 9.9, 14.0, d) for c in RAIL_SLOTS]
    W.boolean(body, cuts)
    bevel_worn(body, M["worn"], 0.75, segs=2)

    # front sight blade in a dovetail base, dot on the sloped back face
    y0, y1 = MUZZLE_Y - 16.0, MUZZLE_Y - 3.6
    fs_top, fs_run = 21.5, 6.0
    blade = side("front_sight", [(y0, RAIL_TOP - 0.4), (y1, RAIL_TOP - 0.4), (y1, fs_top - 0.7, 0.5),
                                 (y1 - 0.8, fs_top, 0.4), (y0 + fs_run, fs_top, 1.0), (y0, RAIL_TOP + 0.8, 0.8)],
                 -1.8, 1.8, M["sight"])
    bevel_worn(blade, M["worn"], 0.25)
    base = side("front_sight_base", [(y0 - 1.0, RAIL_TOP - 0.4), (y1 + 1.0, RAIL_TOP - 0.4), (y1 + 1.0, RAIL_TOP + 0.9, 0.5),
                                     (y0 - 1.0, RAIL_TOP + 0.9, 0.5)], -6.0, 6.0, M["sight"])
    bevel_worn(base, M["worn"], 0.25)
    slope = math.atan2(fs_top - RAIL_TOP - 0.8, fs_run)
    dot = rod_y("front_dot", 0, 0, [(0.85, -0.45), (0.85, 0.3)], 12, M["dot"])
    W.rotate(dot, math.degrees(slope) + 90.0, "X", (0, 0, 0))
    W.transform(dot, Matrix.Translation(Vector((0, (y0 + 3.2) * MM, (RAIL_TOP + 0.8 + 3.2 * math.tan(slope)) * MM))))
    return [body, blade, base, dot]


# ---------------------------------------------------------------- frame

def magwell(mat):
    return W.transform(mag_local_prism("c", -21.6, 21.6, 8.6, -20.0, 30.0, mat), MAG_M)


def grip_core(M):
    """metal grip frame under the rubber; only its front strap shows"""
    core = W.loft("grip_core", [grip_section(z, f, r + RUBBER_T, hw - RUBBER_T, r_front=5.5, r_rear=6.5)
                                for z, f, r, hw in grip_rows()], "Z", M["frame"])
    W.boolean(core, magwell(M["frame"]))
    return W.mark_sharp_by_angle(core, 40.0)


def rubber_grip(M):
    rows = grip_rows()
    grip = W.loft("grip", [grip_section(*s) for s in rows], "Z", M["rubber"])
    trim = side("c", [(-45.0, -43.5), (40.0, -45.5), (47.0, -49.0, 3.0), (52.0, -58.0, 3.0), (54.5, -63.0),
                      (80.0, -63.0), (80.0, 10.0), (-45.0, 10.0)], -30.0, 30.0, M["rubber"])
    edge = [(f - RUBBER_FRONT, z) for z, f, _, _ in rows]
    nose = side("c", [(edge[0][0], -140.0)] + edge + [(edge[-1][0], -30.0), (90.0, -30.0), (90.0, -140.0)],
                -30.0, 30.0, M["rubber"], segs=1)
    W.boolean(grip, [trim, magwell(M["rubber"])])
    W.boolean(grip, nose)
    W.bevel(grip, 1.2 * MM, segs=2, angle=35.0)

    # raised stippled fields, cut from a copy of the grip grown by 0.45 mm
    grown = W.loft("c", [grip_section(*s, grow=0.45) for s in rows], "Z", M["grip"])
    pads = []
    for sx in (1, -1):
        fields = [side("grip_pad", pts, *sx_range(sx, 11.0, 20.0), M["grip"]) for pts in (PAD_UPPER, PAD_LOWER)]
        pad = W.join(fields, "grip_pad")
        W.boolean(pad, W.copy(grown, "c"), op="INTERSECT")
        W.bevel(pad, 0.25 * MM, segs=1)
        pads.append(pad)
    W.delete(grown)
    return [grip] + pads


def build_frame(M):
    f, s = M["frame"], M["steel"]
    body = side("frame_body", [(-12.0, SLIDE_BOTTOM), (102.0, SLIDE_BOTTOM), (102.0, -36.5), (60.5, -36.5),
                               (60.5, -56.0, 5.0), (56.0, -64.0, 4.0), (51.5, -64.5), (51.5, -52.0),
                               (44.0, -48.0), (-4.0, -46.0), (-12.0, -40.0)], -FRAME_HW, FRAME_HW, f)
    # dust cover rails under the slide arms, their front end sits inside the barrel's front block
    dust = cube("frame_dust", -DUST_HW, DUST_HW, 100.0, FRONT_BLOCK_Y + 5.0, DUST_BOTTOM, SLIDE_BOTTOM, f)
    guard = side("trigger_guard", [(56.0, -40.0), (98.0, -29.5), (103.2, -29.5, 1.0), (102.6, -63.2),
                                   (103.5, -66.6, 1.6), (100.4, -68.7, 3.5), (68.0, -68.7, 7.0), (56.5, -63.5, 3.5),
                                   (54.5, -55.0)], -5.2, 5.2, f)
    # beavertail: side profile with the curved web under it, tapered in plan
    tail = side("beavertail", [(0.0, SLIDE_BOTTOM - 0.6), (-9.0, SLIDE_BOTTOM - 0.6), (-29.0, -28.0, 6.0),
                               (-38.8, -29.6, 3.5), (-40.5, -32.8, 2.2), (-39.0, -35.8, 2.5), (-30.0, -39.3, 6.0),
                               (-19.5, -43.2, 8.0), (-10.5, -48.0, 6.0), (-6.5, -53.0, 4.0), (-5.0, -59.0),
                               (0.0, -59.0)], -15.0, 15.0, f)
    W.boolean(tail, top("c", [(-FRAME_HW, 1.0), (FRAME_HW, 1.0), (FRAME_HW, -12.0), (10.0, -34.0, 5.0),
                              (8.8, -41.5, 4.0), (-8.8, -41.5, 4.0), (-10.0, -34.0, 5.0), (-FRAME_HW, -12.0)],
                        -60.0, -20.0, f), op="INTERSECT")

    hammer_slot = cube("c", -4.3, 4.3, -21.0, -4.0, -40.0, -25.0, f)
    # one cutter at a time, these overlap each other
    W.boolean(body, side("c", GUARD_IN, -20.0, 20.0, f))
    W.boolean(body, W.copy(hammer_slot, "c"))
    W.boolean(guard, side("c", GUARD_IN, -20.0, 20.0, f))
    # trigger slot in the roof of the guard, and the recess its back swings into
    for part in (body, guard):
        W.boolean(part, cube("c", -3.9, 3.9, 55.0, 70.0, -37.0, -27.0, f))
        W.boolean(part, cube("c", -3.9, 3.9, 56.0, 60.5, -50.0, -36.5, f))
    W.boolean(tail, hammer_slot)
    bevel_worn(body, M["worn"], 0.7, segs=2)
    bevel_worn(dust, M["worn"], 0.6)
    # the guard reads as a round bar, not a flat plate
    bevel_worn(guard, M["worn"], 1.6, segs=3)
    W.bevel(tail, 2.0 * MM, segs=3, angle=30.0)

    # frame lip under the rubber, flared a little like a magwell funnel
    z0, fr, rr, hw = GRIP_SECTIONS[0]
    lip = W.loft("grip_lip", [grip_section(BASE_Z[0] + 0.2, fr + 0.3, rr - 0.3, hw + 0.2),
                              grip_section(z0 + 3.0, fr - 0.6, rr + 0.6, hw - 0.6)], "Z", f)
    W.boolean(lip, magwell(f))
    bevel_worn(lip, M["worn"], 0.9, segs=2)

    parts = [body, dust, guard, tail, lip, grip_core(M)] + rubber_grip(M)

    # left side: long slide stop along the frame, barrel release button, magazine release
    stop = side("slide_stop", [(8.0, -28.6, 1.5), (43.0, -27.6, 1.5), (49.5, -30.5, 3.0), (48.5, -37.0, 3.0),
                               (43.0, -36.0, 1.0), (15.0, -32.6, 1.0), (8.0, -32.4, 1.5)], -FRAME_HW - 1.9, -FRAME_HW + 0.2, s)
    hi_cut(stop, [cube("c", -FRAME_HW - 2.5, -FRAME_HW - 1.4, y - 0.4, y + 0.4, -34.0, -27.0, s)
                  for y in (10.5, 12.6, 14.7, 16.8)])
    W.bevel(stop, 0.35 * MM, segs=1)
    stop_boss = pin_x("slide_stop_boss", 46.0, -33.3, 3.4, -FRAME_HW - 2.5, -FRAME_HW - 1.5, s, segs=18)
    barrel_btn = pin_x("barrel_release", 80.0, -31.0, 3.1, -FRAME_HW - 1.3, -FRAME_HW + 0.2, s, segs=18)
    mag_btn = pin_x("mag_release", 54.8, -50.0, 4.0, -FRAME_HW - 1.8, -FRAME_HW + 0.2, s, segs=20)
    hi_cut(mag_btn, [cube("c", -FRAME_HW - 2.5, -FRAME_HW - 1.4, 50.0, 59.6, z - 0.3, z + 0.3, s)
                     for z in (-51.6, -50.0, -48.4)])
    # right side: barrel release lever, the magazine release's other end
    lever = side("barrel_lever", [(84.0, -29.2, 1.2), (98.5, -29.2, 1.0), (102.0, -32.8, 3.0), (99.5, -37.2, 3.0),
                                  (84.0, -31.6, 1.0)], FRAME_HW - 0.2, FRAME_HW + 1.4, s)
    W.bevel(lever, 0.3 * MM, segs=1)
    lever_pin = pin_x("barrel_lever_pin", 99.2, -33.3, 2.2, FRAME_HW + 1.2, FRAME_HW + 1.9, s, segs=14)
    mag_end = pin_x("mag_release_end", 54.8, -50.0, 3.2, FRAME_HW - 0.2, FRAME_HW + 0.7, s, segs=18)
    hi_cut(mag_end, [cube("c", FRAME_HW + 0.3, FRAME_HW + 1.2, 51.0, 58.6, -50.4, -49.6, s)])
    for p in (stop_boss, barrel_btn, mag_btn, lever_pin, mag_end):
        W.bevel(p, 0.35 * MM, segs=1)
    parts += [stop, stop_boss, barrel_btn, mag_btn, lever, lever_pin, mag_end]

    pins = []
    for sx in (1, -1):
        pins += [
            pin_x("pin_trigger", TRIGGER_PIVOT[0], TRIGGER_PIVOT[1], 1.9, *sx_range(sx, FRAME_HW - 0.2, FRAME_HW + 0.5), s),
            pin_x("pin_hammer", HAMMER_PIVOT[0], HAMMER_PIVOT[1], 2.3, *sx_range(sx, FRAME_HW - 0.4, FRAME_HW + 0.5), s),
            pin_x("pin_sear", 1.0, -33.0, 1.6, *sx_range(sx, FRAME_HW - 0.2, FRAME_HW + 0.4), s, segs=10),
        ]
        head = pin_x("grip_screw", -7.0, -98.0, 3.2, *sx_range(sx, 16.1, 17.0), s, segs=16)
        hi_cut(head, [cube("c", *sx_range(sx, 16.6, 17.6), -10.6, -3.4, -98.4, -97.6, s)])
        pins.append(head)
    for p in pins:
        W.bevel(p, 0.25 * MM, segs=1)
    return parts + pins


# ---------------------------------------------------------------- small moving parts

def build_hammer(M):
    """spur hammer, drawn in its own frame (v forward, u up from the pivot), then
    leaned back to the cocked rest pose"""
    pts = [(2.2, 2.0), (2.2, 29.5, 1.5), (1.4, 33.5, 1.5), (-2.0, 35.6, 1.5), (-7.5, 36.0, 1.5), (-10.5, 34.6, 1.2),
           (-10.8, 32.6, 1.0), (-8.2, 31.0, 2.0), (-6.4, 26.0, 2.5), (-6.4, 10.0), (-5.2, 2.0)]
    ham = side("hammer", pts, -3.6, 3.6, M["steel"])
    W.boolean(ham, pin_x("c", 0.0, 0.0, 4.8, -3.6, 3.6, M["steel"], segs=20), op="UNION")
    # serrated spur
    W.boolean(ham, [cube("c", -5.0, 5.0, v - 0.42, v + 0.42, u, 40.0, M["steel"])
                    for v, u in ((-0.6, 34.6), (-2.6, 35.0), (-4.6, 35.2), (-6.6, 35.2), (-8.6, 34.6))])
    bevel_worn(ham, M["worn"], 0.55, segs=2)
    W.rotate(ham, HAMMER_REST_DEG, "X", (0, 0, 0))
    return W.transform(ham, Matrix.Translation(Vector((0, HAMMER_PIVOT[0] * MM, HAMMER_PIVOT[1] * MM))))


def build_trigger(M):
    py, pz = TRIGGER_PIVOT
    # curved blade, concave where the finger sits, tip curling forward
    pts = [(0.5, -2.5), (2.4, -8.0), (4.3, -13.0), (5.6, -18.0), (6.5, -23.0), (7.7, -27.2, 1.2), (5.8, -28.8, 1.2),
           (3.4, -25.5), (1.4, -20.0), (-1.2, -15.0), (-3.6, -10.0), (-5.3, -5.0, 1.5), (-5.6, 0.5, 2.0),
           (-2.5, 3.0, 2.0), (0.8, 1.8, 1.0)]
    pts = [p if len(p) == 3 else (p[0], p[1], 0.0) for p in pts]
    trig = side("trigger", [(py + y, pz + z, r) for y, z, r in pts], -3.4, 3.4, M["steel"])
    return bevel_worn(trig, M["worn"], 0.9, segs=2)


def build_mag(M):
    d = M["dark"]
    body = mag_local_prism("mag_body", -21.0, 21.0, 8.0, -6.0, MAG_S_TOP, d)
    # witness holes on the right side
    holes = [W.lathe("c", [(1.4 * MM, 0.0), (1.4 * MM, 10.0 * MM)], 10, d, axis="X", center=(0, -13.0 * MM, s * MM))
             for s in (30.0, 52.0, 74.0)]
    lips = mag_local_prism("c", -17.0, 22.0, 4.6, MAG_S_TOP - 2.5, MAG_S_TOP + 1.0, d, r_front=1.0, r_rear=1.0)
    W.boolean(body, holes + [lips])
    W.bevel(body, 0.45 * MM, segs=1)
    # top round: .50 ae case and bullet lying in the feed lips, nose forward
    prof = [(0.0, -20.2), (6.2, -20.2), (6.2, -19.1), (5.5, -18.7), (5.5, -17.9), (6.9, -17.3), (6.9, 12.3),
            (6.35, 12.5), (6.35, 14.8), (5.3, 17.6), (3.0, 19.8), (0.0, 20.2)]
    if W.hi():
        # a rounder ogive on the bullet nose
        prof = prof[:9] + [(6.1, 15.8), (5.3, 17.6), (4.3, 18.9), (3.0, 19.8), (1.6, 20.1), (0.0, 20.2)]
    round_ = W.lathe("mag_round", [(r * MM, t * MM) for r, t in prof], 16, M["brass"], axis="Y",
                     center=(0, -0.5 * MM, (MAG_S_TOP + 5.4) * MM))
    W.mark_sharp_by_angle(round_, 50)
    mag = W.join([body, round_], "mag_parts")
    W.transform(mag, MAG_M)
    # the floorplate is square to the grip bottom, not to the magazine
    base = side("mag_base", [(BASE_Y[0], BASE_Z[0], 1.5), (BASE_Y[1] - 1.0, BASE_Z[0], 1.5), (BASE_Y[1] + 0.8, -135.6, 1.8),
                             (BASE_Y[1], BASE_Z[1], 1.4), (BASE_Y[0], BASE_Z[1], 1.4)], -11.0, 11.0, d)
    bevel_worn(base, M["worn"], 1.2, segs=3)
    return W.join([mag, base], "mag_parts")


# ---------------------------------------------------------------- assemble

def build_parts(M):
    """every node's geometry at the current detail level, already shifted so
    socket_grip_r is the origin"""
    slide = build_slide(M)
    body = W.join(build_barrel(M) + build_frame(M), "body_parts")
    hammer = build_hammer(M)
    trigger = build_trigger(M)
    mag = build_mag(M)
    shift = Matrix.Translation(Vector(final(0, 0, 0)))
    parts = {"body": body, "slide": slide, "hammer": hammer, "trigger": trigger, "mag": mag}
    for obj in parts.values():
        obj.data.transform(shift)
    return parts


def build():
    W.common.reset_scene()
    M = make_materials()
    W.set_hi(False)
    p = build_parts(M)
    body, slide, hammer, trigger, mag = p["body"], p["slide"], p["hammer"], p["trigger"], p["mag"]

    root = W.empty("deagle", (0, 0, 0))
    W.parent_static(body, root)
    body.name = body.data.name = "body"
    mag_top = mag_point(0.0, MAG_S_TOP)
    mag_bottom = (0.0, 0.5 * (BASE_Y[0] + BASE_Y[1]), BASE_Z[1])
    drop = (Vector(mag_point(0.0, -6.0)) - Vector(mag_top)).normalized()
    # extras end up in three.js userData; directions are in three.js axes (y up, -z forward)
    slide_e = W.pin_part(slide, "slide", final(0, 0, 0), root, extras={"travel_m": SLIDE_TRAVEL_M})
    W.pin_part(hammer, "hammer", final(0, *HAMMER_PIVOT), root, extras={"fire_rot_x_deg": -HAMMER_FIRE_DEG})
    W.pin_part(trigger, "trigger", final(0, *TRIGGER_PIVOT), root, extras={"pull_rot_x_deg": -TRIGGER_PULL_DEG})
    mag_e = W.pin_part(mag, "mag", final(*mag_top), root,
                       extras={"drop_dir": [round(drop.x, 4), round(drop.z, 4), round(-drop.y, 4)], "drop_m": 0.16})

    rake = (math.radians(-GRIP_RAKE), 0.0, 0.0)
    sockets = [
        W.empty("socket_grip_r", final(0.0, *GRIP_SOCKET), rake, parent=root),
        W.empty("socket_grip_l", final(-16.8, GRIP_SOCKET[0] + 8.0, GRIP_SOCKET[1] - 1.0), parent=root),
        W.empty("socket_trigger", final(0.0, 68.6, -48.0), parent=root),
        W.empty("socket_muzzle", final(0.0, MUZZLE_Y, 0.0), parent=root),
        W.empty("socket_eject", final(HW, 52.0, 5.0), parent=root),
        W.empty("socket_mag_bottom", final(*mag_bottom), parent=mag_e),
        W.empty("socket_slide_rear", final(0.0, 28.0, -10.0), parent=slide_e),
    ]
    return root, [body, slide, hammer, trigger, mag], sockets, M


def build_high(M):
    """the bake source: same parts at the high detail level, in world space"""
    W.set_hi(True)
    p = build_parts(M)
    W.set_hi(False)
    names = {"body": "body", "slide": "slide_mesh", "hammer": "hammer_mesh", "trigger": "trigger_mesh", "mag": "mag_mesh"}
    out = {}
    for key, obj in p.items():
        obj.name = obj.data.name = f"hi_{key}"
        out[names[key]] = obj
    print(f"[deagle] high poly {W.tri_count(list(out.values()))} tris")
    return out


# texel density: parts near the eye get more of the atlas, the grip rubber (under
# the hand) and the magazine (seen during reloads) less
MAT_TEXELS = {"mat_rubber": 0.7, "mat_grip": 0.75, "mat_brass": 0.8}
OBJ_TEXELS = {"mag_mesh": 0.75, "trigger_mesh": 0.9}


def texel_weight(obj, centre, mat_name):
    d = (centre - EYE).length
    w = max(0.6, min(1.6, (0.42 / max(d, 0.05)) ** 1.5))
    return w * MAT_TEXELS.get(mat_name, 1.0) * OBJ_TEXELS.get(obj.name, 1.0)


def report(meshes):
    total = W.tri_count(meshes)
    for m in meshes:
        print(f"[deagle] {m.name}: {W.tri_count([m])} tris")
    print(f"[deagle] total {total} tris")
    lo = Vector((1e9, 1e9, 1e9))
    hi_ = -lo
    for m in meshes:
        for v in m.data.vertices:
            w = m.matrix_world @ v.co
            lo = Vector(map(min, lo, w))
            hi_ = Vector(map(max, hi_, w))
    size = (hi_ - lo) / MM
    print(f"[deagle] size {size.y:.1f} long, {size.z:.1f} tall, {size.x:.1f} wide (mm)")
    return total


def posed_tree(obj, rot_x_deg=0.0):
    """bvh of a part in world space with its pivot rotated about x, like the runtime does"""
    from mathutils.bvhtree import BVHTree
    m = obj.matrix_world @ Matrix.Rotation(math.radians(rot_x_deg), 4, "X")
    return BVHTree.FromPolygons([m @ v.co for v in obj.data.vertices], [p.vertices for p in obj.data.polygons])


def check_clearances(meshes):
    """the fired hammer has to sit on the slide's rear face, the pulled trigger inside the guard"""
    body, slide, hammer, trigger, _ = meshes
    slide_t, body_t = posed_tree(slide), posed_tree(body)
    fired = posed_tree(hammer, -HAMMER_FIRE_DEG).overlap(slide_t)
    rest = posed_tree(hammer).overlap(slide_t)
    pulled = posed_tree(trigger, -TRIGGER_PULL_DEG).overlap(body_t)
    print(f"[deagle] overlaps: hammer rest/slide {len(rest)}, fired/slide {len(fired)}, "
          f"pulled trigger/frame {len(pulled)}")
    if "--debug-overlaps" in ARGS:
        shift = Vector(final(0, 0, 0))
        for label, pairs, obj in (("fired hammer", fired, slide), ("pulled trigger", pulled, body)):
            for _, j in pairs[:12]:
                c = obj.matrix_world @ obj.data.polygons[j].center - shift
                print(f"[deagle]   {label} hits {obj.name} near design ({c.x / MM:.1f}, {c.y / MM:.1f}, {c.z / MM:.1f})")


def bake(meshes, M):
    """high poly, uv atlas, bakes and the atlas material (replaces every material)"""
    highs = build_high(M)
    W.texture_set(meshes, highs, "deagle", SIZE, texel_weight, isolate=("mag_mesh",),
                  look=dict(edge_gain=0.9, value_var=0.08))
    W.delete_high(highs)


def renders(outdir, sockets, quick=False):
    W.add_light("key", (-0.3, -0.2, 0.42), (0, 0.05, 0.02), 55.0, size=0.6)
    W.add_light("rim", (0.42, 0.45, 0.22), (0, 0.05, 0.02), 30.0, size=0.5, color=(0.85, 0.9, 1.0))
    W.add_light("top", (0.05, 0.1, 0.6), (0, 0.05, 0.0), 30.0, size=0.9)
    center = Vector(final(0, 96, -59))
    eye = Vector(final(-48.0, -110.0, 44.0))
    three_q = (tuple(center + Vector((0.4, -0.41, 0.2))), tuple(center + Vector((0, 0.0, -0.012))), 56)
    fp = (tuple(eye), tuple(eye + Vector((0.07, 1.0, -0.2))), 30)
    dbg = (tuple(center + Vector((-0.42, -0.27, 0.2))), tuple(center + Vector((0, -0.01, -0.004))), 55, 0.013)
    # right side, orthographic, 4 px per mm around design (0, 95, -60), to hold against a side photo
    ref_center = Vector(final(0, 95, -60))
    if not quick:
        W.preview_set("deagle", outdir, three_q, fp, dbg, sockets)
        W.render(os.path.join(outdir, "deagle_side.png"), tuple(ref_center + Vector((0.6, 0, 0))), tuple(ref_center),
                 resolution=(1600, 900), samples=128, ortho_scale=0.4)
        return
    W.setup_studio(strength=0.45)
    res = (960, 540)
    for label, loc in (("left", (-0.6, 0, 0)), ("right", (0.6, 0, 0)), ("top", (0, 0, 0.6)), ("front", (0, 0.7, 0))):
        W.render(os.path.join(W.TMP, f"deagle_{label}.png"), tuple(center + Vector(loc)), tuple(center),
                 resolution=res, samples=48, ortho_scale=0.31)
    W.render(os.path.join(W.TMP, "deagle_ref_right.png"), tuple(ref_center + Vector((0.6, 0, 0))), tuple(ref_center),
             resolution=(1600, 900), samples=48, ortho_scale=0.4)
    W.render(os.path.join(W.TMP, "deagle_34.png"), three_q[0], three_q[1], lens=three_q[2], resolution=res, samples=48)
    W.render(os.path.join(W.TMP, "deagle_fp.png"), fp[0], fp[1], lens=fp[2], resolution=res, samples=48)


def main():
    root, meshes, sockets, M = build()
    total = report(meshes)
    check_clearances(meshes)
    if not QUICK:
        bake(meshes, M)
    W.export(OUT, root, tangents=not QUICK)
    if RENDERS or QUICK:
        renders(RENDERS or W.TMP, sockets, quick=QUICK)
    print(f"[deagle] done, {total} tris -> {OUT}")


main()
