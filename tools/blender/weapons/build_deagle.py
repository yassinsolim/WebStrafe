"""builds the deagle-style .50 pistol viewmodel (original model, no imports).

  blender -b --factory-startup --python-exit-code 1 -P tools/blender/weapons/build_deagle.py -- \
      [--out .blender-tmp/weapons/deagle_raw.glb] [--renders docs/screenshots/weapons] [--quick]

then optimize:
  npx tsx tools/assets/optimize-glb.ts .blender-tmp/weapons/deagle_raw.glb public/viewmodels/v2/deagle.glb --texture-size 1024

design units are millimetres with y=0 on the slide's rear face and z=0 on the
bore axis. at the end everything is shifted so socket_grip_r is the origin.
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
OUT = arg("--out", os.path.join(W.TMP, "deagle_raw.glb"))
RENDERS = arg("--renders", None)

RAKE = 14.0                      # grip angle from vertical, degrees
GRIP_TOP = (20.0, -35.0)         # grip axis point (y, z) under the frame
GRIP_M = Matrix.Translation(Vector((0, GRIP_TOP[0] * MM, GRIP_TOP[1] * MM))) @ Matrix.Rotation(math.radians(-RAKE), 4, "X")
MIDDLE_FINGER_S = -38.0          # along the grip axis from GRIP_TOP
MUZZLE_Y = 258.0
BREECH_Y = 106.0
HAMMER_PIVOT = (-5.5, -27.0)
TRIGGER_PIVOT = (68.0, -30.0)
MAG_T = -0.5                     # magazine axis offset (t) from the grip axis
MAG_TOP_S = 3.0
GRIP_BOTTOM_S = -90.5            # bottom of the grip frame along the grip axis
MAG_BASE_S = GRIP_BOTTOM_S - 7.0
SLIDE_TRAVEL_M = 0.05
SCREW_S = -54.0                  # grip screw height along the grip axis


def grip_point(t, s, x=0.0):
    """design mm of a point in grip-local coords (t forward, s up the grip)"""
    p = GRIP_M @ Vector((x * MM, t * MM, s * MM))
    return (p.x / MM, p.y / MM, p.z / MM)


GRIP_R = grip_point(0.0, MIDDLE_FINGER_S)


def final(x, y, z):
    """design mm -> exported metres (origin on socket_grip_r)"""
    return ((x - GRIP_R[0]) * MM, (y - GRIP_R[1]) * MM, (z - GRIP_R[2]) * MM)


# ---------------------------------------------------------------- shape helpers

side, front, cube, pin_x, rod_y, bevel_worn, sx_range = W.side, W.front, W.cube, W.pin_x, W.rod_y, W.bevel_worn, W.sx_range


def grip_side(name, pts, x0, x1, mat, segs=4):
    """outline in grip-local (t, s[, r]) mm, extruded across x, then raked"""
    obj = side(name, pts, x0, x1, mat, segs)
    return W.transform(obj, GRIP_M)


# ---------------------------------------------------------------- materials

def make_materials():
    pebble = W.pebble_normal_map("tex_grip_pebble", size=256, count=1500, seed=11)
    return {
        "dark": W.material("mat_steel_dark", 0x1d1e21, 0.36, 0.85),
        "frame": W.material("mat_gunmetal", 0x3b3e43, 0.44, 0.9),
        "steel": W.material("mat_steel", 0x77797e, 0.3, 1.0),
        "worn": W.material("mat_steel_worn", 0x7a7d82, 0.26, 1.0),
        "grip": W.material("mat_grip", 0x161617, 0.74, 0.0, normal_image=pebble, normal_strength=0.8),
        "dot": W.material("mat_sight_dot", 0xe9e6dc, 0.45, 0.0),
        "brass": W.material("mat_brass", 0xc49a4a, 0.28, 1.0),
    }


# ---------------------------------------------------------------- slide

def build_slide(M):
    body = front("slide_body", [(-13, -22), (13, -22), (13, 4.5, 1.0), (10.6, 10.8, 2.0), (7.0, 12.5, 1.5),
                                (-7.0, 12.5, 1.5), (-10.6, 10.8, 2.0), (-13, 4.5, 1.0)], 0, 124, M["dark"])
    arms = side("slide_arms", [(121.0, -22.0), (MUZZLE_Y - 12.0, -22.0, 1.0), (MUZZLE_Y - 5.5, -11.0, 0.8), (121.0, -11.0)],
                -13.0, 13.0, M["dark"])
    W.boolean(arms, cube("c", -9.0, 9.0, 118.0, 260.0, -16.6, -9.0, M["dark"]))
    W.boolean(body, arms, op="UNION")
    cutters = []
    for i in range(9):
        y = 20.0 + i * 3.3
        for sx in (1, -1):
            cutters.append(cube("c", *sx_range(sx, 12.0, 14.5), y - 0.8, y + 0.8, -19.0, 3.6, M["dark"]))
    for i in range(8):
        y = MUZZLE_Y - 50.0 + i * 3.3
        for sx in (1, -1):
            cutters.append(cube("c", *sx_range(sx, 12.2, 14.5), y - 0.75, y + 0.75, -20.3, -12.6, M["dark"]))
    cutters.append(cube("c", 5.0, 20.0, 96.0, 122.0, -7.0, 9.6, M["dark"]))   # ejection port, right side
    W.boolean(body, cutters)
    bevel_worn(body, M["worn"], 0.65)

    sight = side("rear_sight", [(3.6, 12.0), (17.5, 12.0), (15.6, 21.5, 1.2), (4.2, 21.5, 0.8)], -9.0, 9.0, M["dark"])
    glare = [cube("c", -10.0, 10.0, 2.0, 3.95, z - 0.3, z + 0.3, M["dark"]) for z in (13.4, 14.6, 15.8, 17.0)]
    W.boolean(sight, [cube("c", -1.7, 1.7, 0.0, 20.0, 18.5, 25.0, M["dark"])] + glare)
    bevel_worn(sight, M["worn"], 0.3)
    dots = [rod_y("dot", sx * 5.3, 19.6, [(1.05, 3.1), (1.05, 3.9)], 10, M["dot"]) for sx in (1, -1)]

    # rear plate over the firing pin channel, seen from behind in first person
    plate = front("rear_plate", [(-5.5, -15.0, 1.5), (5.5, -15.0, 1.5), (5.5, -1.0, 1.5), (-5.5, -1.0, 1.5)], -0.6, 0.4, M["steel"])
    W.bevel(plate, 0.25 * MM, segs=1)
    plate_pin = rod_y("plate_pin", 0.0, -4.0, [(1.3, -0.9), (1.3, 0.0)], 10, M["dark"])
    # extractor claw behind the ejection port
    extractor = side("extractor", [(84.0, 1.2, 0.6), (96.5, 1.2), (96.5, 6.6), (84.0, 6.6, 0.6)], 12.4, 13.35, M["steel"])
    W.bevel(extractor, 0.2 * MM, segs=1)

    parts = [body, sight, plate, plate_pin, extractor] + dots
    # ambidextrous safety levers on the slide's rear sides
    for sx in (1, -1):
        hub = pin_x("safety_hub", 11.5, -7.0, 4.6, *sx_range(sx, 13.0, 14.7), M["steel"], segs=18)
        paddle = side("safety_paddle", [(0.8, -12.2, 1.5), (11.5, -10.5, 2.0), (11.5, -3.5, 2.0), (2.2, -7.2, 1.5)],
                      *sx_range(sx, 13.0, 15.0), M["steel"])
        W.boolean(paddle, [cube("c", *sx_range(sx, 14.4, 16.0), y - 0.35, y + 0.35, -14.0, -2.0, M["steel"])
                           for y in (2.6, 4.2, 5.8)])
        W.bevel(hub, 0.3 * MM, segs=1)
        W.bevel(paddle, 0.3 * MM, segs=1)
        parts += [hub, paddle]
    return W.join(parts, "slide_parts")


# ---------------------------------------------------------------- barrel

def build_barrel(M):
    body = front("barrel_body", [(-8.5, -15.5), (8.5, -15.5), (8.5, -11.0), (12.8, -11.0), (12.8, 11.4, 1.0),
                                 (10.8, 13.0, 1.2), (-10.8, 13.0, 1.2), (-12.8, 11.4, 1.0), (-12.8, -11.0),
                                 (-8.5, -11.0)], 124.0, MUZZLE_Y, M["dark"])
    cuts = [rod_y("c", 0, 0, [(0.0, MUZZLE_Y - 26.0), (6.35, MUZZLE_Y - 26.0), (6.35, MUZZLE_Y - 1.2), (7.6, MUZZLE_Y + 0.6), (0.0, MUZZLE_Y + 0.6)],
                  24, M["dark"])]
    # shallow flat panels on the barrel sides break up the big slab
    for sx in (1, -1):
        cuts.append(side("c", [(148.0, -7.0, 2.5), (MUZZLE_Y - 36.0, -7.0, 2.5), (MUZZLE_Y - 36.0, 8.0, 2.5), (148.0, 8.0, 2.5)],
                         *sx_range(sx, 12.35, 14.0), M["dark"]))
    # a lateral line near the muzzle reads as the heavy front block
    for sx in (1, -1):
        cuts.append(cube("c", *sx_range(sx, 12.3, 14.0), MUZZLE_Y - 27.5, MUZZLE_Y - 26.5, -12.0, 11.0, M["dark"]))
    W.boolean(body, cuts)
    bevel_worn(body, M["worn"], 0.75)

    rail = front("rail", [(-10.5, 12.5), (10.5, 12.5), (10.5, 15.6, 0.4), (9.0, 17.5, 0.3), (-9.0, 17.5, 0.3),
                          (-10.5, 15.6, 0.4)], 130.0, MUZZLE_Y - 18.0, M["dark"])
    W.boolean(rail, [cube("c", -12, 12, c - 2.6, c + 2.6, 14.9, 19.0, M["dark"]) for c in range(135, int(MUZZLE_Y) - 20, 10)])
    bevel_worn(rail, M["worn"], 0.3)

    fsight = side("front_sight", [(MUZZLE_Y - 15.0, 12.5), (MUZZLE_Y - 6.2, 12.5), (MUZZLE_Y - 6.8, 15.2, 1.2),
                                  (MUZZLE_Y - 10.0, 18.9, 0.8), (MUZZLE_Y - 13.6, 18.9, 0.5)], -1.8, 1.8, M["dark"])
    bevel_worn(fsight, M["worn"], 0.3)
    fdot = rod_y("front_dot", 0, 17.2, [(0.9, MUZZLE_Y - 14.7), (0.9, MUZZLE_Y - 13.8)], 10, M["dot"])

    chamber = rod_y("chamber", 0, 0, [(10.0, BREECH_Y), (10.0, 125.0)], 24, M["dark"])
    W.boolean(chamber, rod_y("c", 0, 0, [(0.0, BREECH_Y - 1), (6.4, BREECH_Y - 1), (6.4, BREECH_Y + 12), (0.0, BREECH_Y + 12)],
                             16, M["dark"]))
    W.bevel(chamber, 0.5 * MM, segs=1)
    lug = cube("barrel_lug", -7.0, 7.0, BREECH_Y + 2, 124.5, -22.0, -8.0, M["dark"])
    W.bevel(lug, 0.6 * MM, segs=1)
    return [body, rail, fsight, fdot, chamber, lug]


# ---------------------------------------------------------------- frame

def rubber_grip(M):
    """wraparound rubber grip: lofted rounded sections along the grip axis,
    top trimmed to follow the frame, magwell and screw counterbores cut out"""
    def section(xh):
        return W.fillet(W.mm([(-xh, -24.3, 5.0), (xh, -24.3, 5.0), (xh, 27.0, 10.0), (-xh, 27.0, 10.0)]), 4)

    secs = [(GRIP_BOTTOM_S * MM, section(15.6)), ((GRIP_BOTTOM_S + 25.0) * MM, section(16.2)), (-35 * MM, section(16.3)),
            (10 * MM, section(15.6))]
    grip = W.loft("grip_panels", secs, "Z", M["grip"])
    W.transform(grip, GRIP_M)
    top = side("c", [(-40.0, -37.4), (16.0, -37.4, 3.0), (27.5, -43.6, 3.0), (70.0, -44.2), (70.0, 10.0), (-40.0, 10.0)],
               -30.0, 30.0, M["grip"])
    well = grip_side("c", [(-21.5, GRIP_BOTTOM_S + 25.0), (20.5, GRIP_BOTTOM_S + 25.0), (20.5, -130.0), (-21.5, -130.0)],
                     -9.4, 9.4, M["grip"])
    bores = []
    for sx in (1, -1):
        c = W.lathe("c", [(4.3 * MM, sx * 15.0 * MM), (4.3 * MM, sx * 19.0 * MM)], 18, M["grip"], axis="X")
        W.transform(c, GRIP_M @ Matrix.Translation(Vector((0, 1.0 * MM, SCREW_S * MM))))
        bores.append(c)
    W.boolean(grip, [top, well] + bores)
    W.bevel(grip, 1.8 * MM, segs=2, angle=35.0)
    W.box_uv(grip, 0.022)
    return grip


def build_frame(M):
    main = side("frame_main", [(-18.5, -31.0, 3.0), (-13.0, -23.4, 3.0), (-6.0, -22.0), (MUZZLE_Y - 12.0, -22.0, 0.6),
                               (MUZZLE_Y - 19.5, -35.5, 2.0), (40.0, -35.5), (-1.0, -36.5, 3.0), (-9.0, -37.0, 3.0)],
                -12.0, 12.0, M["frame"])
    cut = [
        cube("c", -4.3, 4.3, -26.0, 3.0, -34.0, -15.0, M["frame"]),          # hammer slot
        cube("c", -4.0, 4.0, 55.0, 82.0, -38.0, -25.0, M["frame"]),          # trigger slot
    ]
    for sx in (1, -1):
        cut.append(cube("c", *sx_range(sx, 11.4, 13.0), 128.0, MUZZLE_Y - 34.0, -30.3, -29.3, M["frame"]))   # dust cover line
    W.boolean(main, cut)
    bevel_worn(main, M["worn"], 0.7)

    core = grip_side("grip_core", [(-27.0, 4.0), (-27.0, GRIP_BOTTOM_S + 1.0, 2.5), (22.0, GRIP_BOTTOM_S + 1.0, 2.5), (22.0, 9.0)],
                     -11.3, 11.3, M["frame"])
    W.boolean(core, grip_side("c", [(-21.5, GRIP_BOTTOM_S + 25.0), (20.5, GRIP_BOTTOM_S + 25.0), (20.5, -130.0), (-21.5, -130.0)],
                               -9.4, 9.4, M["frame"]))
    bevel_worn(core, M["worn"], 1.2, segs=2)

    guard = side("trigger_guard", [(36.0, -34.5), (117.0, -34.5), (118.8, -42.0, 2.5), (120.0, -58.5, 2.8),
                                   (114.5, -63.0, 4.0), (50.0, -63.0, 8.0), (38.0, -57.0, 5.0)], -5.8, 5.8, M["frame"])
    W.boolean(guard, side("c", [(30.0, -36.5), (110.5, -36.5, 2.0), (112.0, -41.0, 3.0), (112.5, -56.5, 3.5),
                                (54.0, -57.0, 7.0), (40.0, -50.0)], -8.0, 8.0, M["frame"]))
    bevel_worn(guard, M["worn"], 0.9, segs=2)

    parts = [main, core, guard, rubber_grip(M)]

    for sx in (1, -1):
        screw = W.lathe("grip_screw", [(3.4 * MM, sx_range(sx, 14.6, 15.9)[0] * MM), (3.4 * MM, sx_range(sx, 14.6, 15.9)[1] * MM)],
                        18, M["steel"], axis="X")
        hexcut = W.lathe("c", [(1.35 * MM, sx_range(sx, 15.3, 16.5)[0] * MM), (1.35 * MM, sx_range(sx, 15.3, 16.5)[1] * MM)],
                         6, M["steel"], axis="X")
        W.boolean(screw, hexcut)
        W.bevel(screw, 0.3 * MM, segs=1)
        W.transform(screw, GRIP_M @ Matrix.Translation(Vector((0, 1.0 * MM, SCREW_S * MM))))
        parts.append(screw)

    stop = side("slide_stop", [(78.0, -31.8, 1.2), (103.5, -30.4, 2.4), (103.5, -25.6, 2.4), (86.0, -26.2, 1.0),
                               (78.0, -26.8, 1.2)], -14.0, -12.0, M["steel"])
    pad = cube("slide_stop_pad", -15.8, -12.5, 78.0, 86.5, -31.8, -26.4, M["steel"])
    W.boolean(pad, [cube("c", -17.0, -15.2, y - 0.45, y + 0.45, -33.0, -25.0, M["steel"]) for y in (79.8, 82.2, 84.6)])
    W.bevel(stop, 0.35 * MM, segs=1)
    W.bevel(pad, 0.4 * MM, segs=1)
    stop_pin = pin_x("slide_stop_pin", 100.5, -28.0, 2.6, 11.6, 12.7, M["steel"])
    W.bevel(stop_pin, 0.3 * MM, segs=1)

    release = side("mag_release", [(29.0, -43.0, 2.0), (37.5, -43.0, 2.0), (37.5, -37.2, 2.0), (29.0, -37.2, 2.0)],
                   -14.2, -10.8, M["steel"])
    W.bevel(release, 0.5 * MM, segs=1)

    barrel_btn = pin_x("barrel_release", 128.0, -29.0, 3.1, -13.7, -11.5, M["steel"], segs=18)
    W.bevel(barrel_btn, 0.4 * MM, segs=1)

    pins = [
        pin_x("pin_trigger", TRIGGER_PIVOT[0], TRIGGER_PIVOT[1], 2.0, -12.4, 12.4, M["steel"]),
        pin_x("pin_hammer", HAMMER_PIVOT[0], HAMMER_PIVOT[1], 2.3, -12.45, 12.45, M["steel"]),
        pin_x("pin_sear", 12.0, -31.0, 1.6, -12.35, 12.35, M["steel"], segs=10),
        pin_x("pin_frame", 176.0, -27.0, 1.8, -12.35, 12.35, M["steel"], segs=10),
    ]
    for p in pins:
        W.bevel(p, 0.25 * MM, segs=1)
    return parts + [stop, pad, stop_pin, release, barrel_btn] + pins


# ---------------------------------------------------------------- small moving parts

def build_hammer(M):
    py, pz = HAMMER_PIVOT
    pts = [(-5.4, -4.2, 3.0), (5.0, -5.0, 3.0), (5.4, 3.0, 2.0), (1.6, 12.0, 2.5), (-2.8, 20.6, 2.6),
           (-10.4, 22.0, 3.0), (-14.2, 17.0, 2.0), (-8.6, 8.0, 2.0), (-6.6, 2.0, 2.0)]
    ham = side("hammer", [(py + y, pz + z, r) for y, z, r in pts], -3.8, 3.8, M["steel"])
    cuts = [cube("c", -5, 5, py + y - 0.45, py + y + 0.45, pz + 20.0 + i * 0.35, pz + 24.0, M["steel"])
            for i, y in enumerate((-4.4, -6.2, -8.0, -9.8))]
    cuts.append(W.lathe("c", [(2.3 * MM, -5 * MM), (2.3 * MM, 5 * MM)], 12, M["steel"], axis="X",
                        center=(0, (py - 6.0) * MM, (pz + 13.5) * MM)))
    W.boolean(ham, cuts)
    return bevel_worn(ham, M["worn"], 0.4)


def build_trigger(M):
    py, pz = TRIGGER_PIVOT
    pts = [(2.5, -1.5, 1.0), (0.5, -6.0), (-1.2, -11.0), (-1.8, -14.0), (-1.4, -18.0), (0.2, -22.0), (2.0, -25.0, 1.0),
           (1.6, -26.6, 1.2), (-2.2, -25.2, 1.0), (-5.0, -21.0), (-6.3, -16.0), (-6.1, -10.0), (-5.0, -5.0),
           (-3.5, 0.0, 1.0), (-1.0, 2.6, 1.0), (2.6, 1.6, 1.0)]
    pts = [p if len(p) == 3 else (p[0], p[1], 0.0) for p in pts]
    trig = side("trigger", [(py + y, pz + z, r) for y, z, r in pts], -3.6, 3.6, M["steel"])
    return bevel_worn(trig, M["worn"], 0.45)


def build_mag(M):
    t0, t1 = MAG_T - 20.0, MAG_T + 20.0
    sec = W.fillet(W.mm([(-8.4, t0, 1.5), (8.4, t0, 1.5), (8.4, t1, 6.0), (-8.4, t1, 6.0)]), 3)
    body = W.prism("mag_body", sec, "Z", (MAG_BASE_S + 6.5) * MM, MAG_TOP_S * MM, M["dark"])
    holes = [W.lathe("c", [(1.5 * MM, -10 * MM), (1.5 * MM, 10 * MM)], 8, M["dark"], axis="X",
                     center=(0, (MAG_T - 9.0) * MM, s * MM)) for s in (-30.0, -60.0)]
    lips = W.prism("c", W.fillet(W.mm([(-4.5, t0 + 4.0, 1.0), (4.5, t0 + 4.0, 1.0), (4.5, t1 + 1.0, 1.0),
                                       (-4.5, t1 + 1.0, 1.0)]), 2), "Z", (MAG_TOP_S - 2.5) * MM, (MAG_TOP_S + 1.0) * MM, M["dark"])
    W.boolean(body, holes + [lips])
    W.bevel(body, 0.45 * MM, segs=1)
    base = side("mag_base", [(-23.0, GRIP_BOTTOM_S, 1.5), (22.5, GRIP_BOTTOM_S, 1.5), (23.6, GRIP_BOTTOM_S - 4.0, 2.0),
                             (21.5, MAG_BASE_S, 1.6), (-23.0, MAG_BASE_S, 1.6)], -10.4, 10.4, M["dark"])
    base = bevel_worn(base, M["worn"], 0.9, segs=2)
    # top round: .50 cal cartridge lying across the magazine
    prof = [(0.0, -20.5), (6.2, -20.5), (6.2, -19.4), (5.5, -19.0), (5.5, -18.2), (6.9, -17.6), (6.9, 12.0),
            (6.35, 12.2), (6.35, 14.5), (5.3, 17.4), (3.0, 19.6), (0.0, 20.4)]
    round_ = W.lathe("mag_round", [(r * MM, t * MM) for r, t in prof], 14, M["brass"], axis="Y",
                     center=(0, (MAG_T - 1.0) * MM, (MAG_TOP_S + 5.2) * MM))
    W.mark_sharp_by_angle(round_, 50)
    mag = W.join([body, base, round_], "mag_parts")
    return W.transform(mag, GRIP_M)


# ---------------------------------------------------------------- assemble

def build():
    W.common.reset_scene()
    M = make_materials()
    slide = build_slide(M)
    body = W.join(build_barrel(M) + build_frame(M), "body_parts")
    hammer = build_hammer(M)
    trigger = build_trigger(M)
    mag = build_mag(M)

    shift = Matrix.Translation(Vector(final(0, 0, 0)))
    for obj in (slide, body, hammer, trigger, mag):
        obj.data.transform(shift)

    root = W.empty("deagle", (0, 0, 0))
    W.parent_static(body, root)
    body.name = body.data.name = "body"
    mag_top = grip_point(MAG_T, MAG_TOP_S)
    mag_bottom = grip_point(MAG_T, MAG_BASE_S)
    drop = (Vector(mag_bottom) - Vector(mag_top)).normalized()
    # extras end up in three.js userData; directions are in three.js axes (y up, -z forward)
    slide_e = W.pin_part(slide, "slide", final(0, 0, 0), root, extras={"travel_m": SLIDE_TRAVEL_M})
    W.pin_part(hammer, "hammer", final(0, *HAMMER_PIVOT), root, extras={"fire_rot_x_deg": -55.0})
    W.pin_part(trigger, "trigger", final(0, *TRIGGER_PIVOT), root, extras={"pull_rot_x_deg": -14.0})
    mag_e = W.pin_part(mag, "mag", final(*mag_top), root,
                       extras={"drop_dir": [round(drop.x, 4), round(drop.z, 4), round(-drop.y, 4)], "drop_m": 0.16})

    rake = (math.radians(-RAKE), 0.0, 0.0)
    sockets = [
        W.empty("socket_grip_r", final(*GRIP_R), rake, parent=root),
        W.empty("socket_grip_l", final(*grip_point(8.0, -37.0, -16.3)), parent=root),
        W.empty("socket_trigger", final(0.0, TRIGGER_PIVOT[0] - 1.8, TRIGGER_PIVOT[1] - 14.0), parent=root),
        W.empty("socket_muzzle", final(0.0, MUZZLE_Y, 0.0), parent=root),
        W.empty("socket_eject", final(13.0, 109.0, 1.0), parent=root),
        W.empty("socket_mag_bottom", final(*mag_bottom), parent=mag_e),
        W.empty("socket_slide_rear", final(0.0, 33.2, -5.0), parent=slide_e),
    ]
    return root, [body, slide, hammer, trigger, mag], sockets, M


def report(meshes):
    total = W.tri_count(meshes)
    for m in meshes:
        print(f"[deagle] {m.name}: {W.tri_count([m])} tris")
    print(f"[deagle] total {total} tris")
    return total


def bake(meshes):
    body, slide, hammer, trigger, mag = meshes
    W.bake_ao([body, slide, hammer, trigger], distance=0.02, samples=128, strength=0.85, floor=0.25)
    W.bake_ao([mag], distance=0.02, samples=128, strength=0.85, floor=0.25, isolate=True)
    for m in meshes:
        print(f"[deagle] ao {m.name}: min/mean {W.ao_stats(m)}")


def renders(outdir, sockets, quick=False):
    W.add_light("key", (-0.3, -0.2, 0.42), (0, 0.05, 0.02), 55.0, size=0.6)
    W.add_light("rim", (0.42, 0.45, 0.22), (0, 0.05, 0.02), 30.0, size=0.5, color=(0.85, 0.9, 1.0))
    W.add_light("top", (0.05, 0.1, 0.6), (0, 0.05, 0.0), 30.0, size=0.9)
    center = Vector(final(0, 120, -58))
    eye = Vector((-0.05, -0.13, 0.115))
    three_q = (tuple(center + Vector((0.4, -0.41, 0.2))), tuple(center + Vector((0, 0.0, -0.012))), 56)
    fp = (tuple(eye), tuple(eye + Vector((0.07, 1.0, -0.2))), 30)
    dbg = (tuple(center + Vector((-0.42, -0.27, 0.2))), tuple(center + Vector((0, -0.01, -0.004))), 55, 0.013)
    if not quick:
        W.preview_set("deagle", outdir, three_q, fp, dbg, sockets)
        return
    W.setup_studio(strength=0.45)
    res = (960, 540)
    for label, loc in (("left", (-0.6, 0, 0)), ("right", (0.6, 0, 0)), ("top", (0, 0, 0.6)), ("front", (0, 0.7, 0))):
        W.render(os.path.join(W.TMP, f"deagle_{label}.png"), tuple(center + Vector(loc)), tuple(center),
                 resolution=res, samples=48, ortho_scale=0.31)
    W.render(os.path.join(W.TMP, "deagle_34.png"), three_q[0], three_q[1], lens=three_q[2], resolution=res, samples=48)
    W.render(os.path.join(W.TMP, "deagle_fp.png"), fp[0], fp[1], lens=fp[2], resolution=res, samples=48)


def main():
    root, meshes, sockets, M = build()
    total = report(meshes)
    if not QUICK:
        bake(meshes)
    W.export(OUT, root)
    if RENDERS or QUICK:
        renders(RENDERS or W.TMP, sockets, quick=QUICK)
    print(f"[deagle] done, {total} tris -> {OUT}")


main()
