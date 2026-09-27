"""builds the awp-style bolt action magnum sniper viewmodel (original model, no imports).

  blender -b --factory-startup --python-exit-code 1 -P tools/blender/weapons/build_awp.py -- \
      [--out .blender-tmp/weapons/awp_raw.glb] [--renders docs/screenshots/weapons] [--quick]

then optimize:
  npx tsx tools/assets/optimize-glb.ts .blender-tmp/weapons/awp_raw.glb public/viewmodels/v2/awp.glb --texture-size 1024

design units are millimetres with y=0 on the receiver's rear face and z=0 on
the bore axis. at the end everything is shifted so socket_grip_r is the origin.
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
OUT = arg("--out", os.path.join(W.TMP, "awp_raw.glb"))
RENDERS = arg("--renders", None)

side, front, top, cube, pin_x, rod_y, lathe_mm, bevel_worn, sx_range = (
    W.side, W.front, W.top, W.cube, W.pin_x, W.rod_y, W.lathe_mm, W.bevel_worn, W.sx_range)

RAKE = 14.0                        # pistol grip angle from vertical, degrees
GRIP_R = (0.0, 0.5, -78.0)         # grip centreline at middle-finger height
TRIGGER_PIVOT = (56.0, -30.0)
TRIGGER_FACE = (TRIGGER_PIVOT[0] - 1.6, TRIGGER_PIVOT[1] - 16.0)
BREECH_Y = 170.0
BARREL_LEN = 660.0
MUZZLE_Y = BREECH_Y + BARREL_LEN   # crown, the brake sits in front of it
BRAKE_END_Y = MUZZLE_Y + 70.0
SCOPE_Z = 56.0                     # scope axis height above the bore
SCOPE_REAR_Y = -40.0
BOLT_Y = 12.0                      # bolt origin on the bore axis at the handle root
BOLT_KNOB = (54.0, 2.0, -32.0)
MAG_Y = (108.0, 202.0)
MAG_TOP_Z = -10.0
MAG_BASE_Z = -86.0
SUPPORT_Y = TRIGGER_FACE[0] + 340.0
FOREND_BOTTOM_Z = -47.0


def final(x, y, z):
    """design mm -> exported metres (origin on socket_grip_r)"""
    return ((x - GRIP_R[0]) * MM, (y - GRIP_R[1]) * MM, (z - GRIP_R[2]) * MM)


def barrel_r(y):
    """outer barrel radius (mm) along the taper"""
    if y <= 240.0:
        return 13.2
    if y >= 720.0:
        return 10.5
    return 13.2 - 2.7 * (y - 240.0) / 480.0


def capsule(name, p0, p1, r, segs, mat):
    """pill shaped cutter between two points (mm)"""
    a, b = Vector(p0) * MM, Vector(p1) * MM
    length = (b - a).length
    rr = r * MM
    prof = [(0.0, 0.0)]
    for i in range(1, 4):
        th = math.radians(90 * i / 4)
        prof.append((rr * math.sin(th), (rr - rr * math.cos(th)) / length))
    prof.append((rr, rr / length))
    prof.append((rr, 1.0 - rr / length))
    for i in range(3, 0, -1):
        th = math.radians(90 * i / 4)
        prof.append((rr * math.sin(th), 1.0 - (rr - rr * math.cos(th)) / length))
    prof.append((0.0, 1.0))
    return W.tube(name, a, b, rr, rr, segs, mat, prof=prof)


# ---------------------------------------------------------------- materials

def make_materials():
    stipple = W.pebble_normal_map("tex_stock_stipple", size=256, count=1300, radius=(2.0, 3.6), seed=5)
    return {
        "green": W.material("mat_polymer_green", 0x3d4a33, 0.62, 0.0),
        "green_grip": W.material("mat_polymer_green_stipple", 0x3d4a33, 0.72, 0.0, normal_image=stipple,
                                 normal_strength=0.75),
        "rubber": W.material("mat_rubber", 0x161617, 0.86, 0.0),
        "alu": W.material("mat_aluminium", 0x2f3135, 0.4, 0.85),
        "dark": W.material("mat_steel_dark", 0x222326, 0.36, 0.85),
        "steel": W.material("mat_steel", 0xa3a6aa, 0.2, 1.0),
        "worn": W.material("mat_steel_worn", 0x7a7d82, 0.26, 1.0),
        "scope": W.material("mat_scope", 0x151618, 0.4, 0.55),
        "glass": W.material("mat_glass", 0x0b1c24, 0.03, 0.0),
        "black": W.material("mat_polymer_black", 0x19191a, 0.5, 0.0),
        "paint": W.material("mat_paint_white", 0xe6e3da, 0.5, 0.0),
        "brass": W.material("mat_brass", 0xc49a4a, 0.28, 1.0),
        "red": W.material("mat_indicator", 0xc0261d, 0.45, 0.0),
    }


# ---------------------------------------------------------------- stock and chassis

def build_stock(M):
    rear = side("stock_rear", [(212.0, -20.0), (-6.0, -20.0, 2.0), (-10.0, -15.0, 3.0), (-128.0, -15.0, 16.0),
                               (-162.0, 4.0, 14.0), (-262.0, 4.0, 5.0), (-266.0, 0.0, 3.0), (-266.0, -138.0, 3.0),
                               (-262.0, -142.0, 5.0), (-30.0, -141.0, 12.0), (8.0, -136.0, 8.0), (18.0, -98.0, 30.0),
                               (27.0, -62.0, 6.0), (30.0, -46.0, 3.0), (212.0, -46.0)], -21.0, 21.0, M["green"], segs=5)
    hole = side("c", [(-100.0, -114.0, 14.0), (-32.0, -116.0, 14.0), (-19.0, -62.0, 10.0), (-24.0, -44.0, 8.0),
                      (-100.0, -40.0, 12.0)], -40.0, 40.0, M["green"], segs=5)
    well = cube("c", -15.0, 15.0, MAG_Y[0] - 1.5, MAG_Y[1] + 1.5, -70.0, -12.0, M["green"])
    slot = cube("c", -4.0, 4.0, TRIGGER_PIVOT[0] - 9.0, TRIGGER_PIVOT[0] + 9.0, -55.0, -24.0, M["green"])
    W.boolean(rear, [hole, well, slot])
    # the pistol grip is thinner than the stock, stippled where the hand goes
    thin = []
    for sx in (1, -1):
        thin.append(side("c", [(-26.0, -46.0), (40.0, -46.0), (40.0, -160.0), (-40.0, -160.0), (-40.0, -112.0)],
                         *sx_range(sx, 16.5, 40.0), M["green_grip"]))
    W.boolean(rear, thin, transfer_material=True)
    W.bevel(rear, 3.2 * MM, segs=3, angle=35.0)
    W.box_uv(rear, 0.024, ["mat_polymer_green_stipple"])

    fore = side("forend", [(205.0, -2.0), (452.0, -2.0, 10.0), (470.0, -12.0, 12.0), (473.0, FOREND_BOTTOM_Z + 9.0, 10.0),
                           (462.0, FOREND_BOTTOM_Z, 6.0), (205.0, FOREND_BOTTOM_Z)], -25.0, 25.0, M["green"], segs=5)
    cuts = [rod_y("c", 0, 0, [(0.0, 195.0), (16.8, 195.0), (16.8, 485.0), (0.0, 485.0)], 28, M["green"])]
    for sx in (1, -1):
        for y0 in (238.0, 300.0, 362.0):
            cuts.append(side("c", [(y0, -30.0, 4.0), (y0 + 50.0, -30.0, 4.0), (y0 + 50.0, -14.0, 4.0), (y0, -14.0, 4.0)],
                             *sx_range(sx, 23.4, 30.0), M["green"]))
    W.boolean(fore, cuts)
    W.bevel(fore, 3.0 * MM, segs=3, angle=35.0)

    cheek = side("cheek_rest", [(-252.0, 10.0, 3.0), (-166.0, 10.0, 3.0), (-168.0, 26.0, 10.0), (-200.0, 31.0, 14.0),
                                (-250.0, 29.0, 8.0)], -19.0, 19.0, M["green"], segs=5)
    W.bevel(cheek, 3.0 * MM, segs=3, angle=35.0)
    posts = [lathe_mm("cheek_post", [(4.2, 1.0), (4.2, 11.0)], 14, M["steel"], "Z", (0.0, y, 0.0)) for y in (-182.0, -234.0)]
    wheel = lathe_mm("cheek_wheel", [(9.0, -21.0), (9.0, -25.5)], 28, M["alu"], "X", (0.0, -208.0, 3.0), ripple=0.06)
    W.bevel(wheel, 0.4 * MM, segs=1)

    spacer = side("butt_spacer", [(-265.0, 3.0), (-265.0, -141.0), (-269.0, -141.0), (-269.0, 3.0)], -20.0, 20.0, M["alu"])
    W.bevel(spacer, 0.6 * MM, segs=1)
    pad = side("butt_pad", [(-268.5, 2.0, 2.0), (-268.5, -140.0, 2.0), (-284.0, -137.0, 8.0), (-285.5, 0.0, 8.0)],
               -20.5, 20.5, M["rubber"], segs=5)
    W.bevel(pad, 1.8 * MM, segs=2, angle=35.0)

    chassis = front("chassis_rail", [(-19.5, -21.0), (19.5, -21.0), (19.5, -13.0, 1.5), (-19.5, -13.0, 1.5)], -8.0, 214.0,
                    M["alu"])
    bevel_worn(chassis, M["worn"], 0.7)
    screws = []
    for sx in (1, -1):
        for y in (20.0, 185.0):
            screws.append(pin_x("chassis_screw", y, -17.0, 3.2, *sx_range(sx, 19.0, 20.6), M["steel"], segs=12))
    for s_ in screws:
        W.bevel(s_, 0.3 * MM, segs=1)

    guard = side("trigger_guard", [(20.0, -40.0), (96.0, -40.0), (98.0, -48.0, 4.0), (94.0, -70.0, 6.0),
                                   (34.0, -70.0, 8.0), (24.0, -58.0, 5.0)], -6.5, 6.5, M["alu"])
    W.boolean(guard, side("c", [(28.0, -44.0), (90.0, -44.0, 3.0), (88.5, -64.0, 5.0), (38.0, -64.5, 6.0), (30.0, -56.0)],
                          -9.0, 9.0, M["alu"]))
    bevel_worn(guard, M["worn"], 0.9, segs=2)
    release = side("mag_release", [(99.0, -44.0), (105.0, -44.0), (105.5, -60.0, 2.0), (100.5, -61.0, 2.0)], -6.0, 6.0,
                   M["alu"])
    W.bevel(release, 0.6 * MM, segs=1)
    well_lip = side("magwell_lip", [(MAG_Y[0] - 4.0, -44.0), (MAG_Y[1] + 4.0, -44.0), (MAG_Y[1] + 4.0, -49.0, 1.5),
                                    (MAG_Y[0] - 4.0, -49.0, 1.5)], -19.0, 19.0, M["alu"])
    W.boolean(well_lip, cube("c", -15.0, 15.0, MAG_Y[0] - 1.5, MAG_Y[1] + 1.5, -60.0, -30.0, M["alu"]))
    W.bevel(well_lip, 0.6 * MM, segs=1)

    studs = [lathe_mm("sling_stud", [(4.0, 0.0), (4.0, -5.0), (2.6, -6.0), (2.6, -9.0)], 12, M["steel"], "Z",
                      (0.0, -225.0, -142.0))]
    return [rear, fore, cheek, wheel, spacer, pad, chassis, guard, release, well_lip] + posts + screws + studs


# ---------------------------------------------------------------- receiver, barrel, brake

def build_action(M):
    rec = front("receiver", [(-16.0, -17.0), (16.0, -17.0), (16.0, 9.0, 2.0), (12.5, 15.0, 5.0), (-12.5, 15.0, 5.0),
                             (-16.0, 9.0, 2.0)], -5.0, 208.0, M["dark"])
    W.boolean(rec, [
        cube("c", 8.0, 22.0, 68.0, 142.0, -3.0, 13.5, M["dark"]),       # ejection port, right side
        cube("c", 7.0, 22.0, -8.0, 26.0, -10.0, 17.0, M["dark"]),       # bolt handle cut in the rear bridge
        cube("c", -17.5, -15.0, 40.0, 180.0, -6.0, -4.0, M["dark"]),    # machining line, left
        cube("c", 15.0, 17.5, 150.0, 205.0, -6.0, -4.0, M["dark"]),     # machining line, right front
    ])
    bevel_worn(rec, M["worn"], 0.8)

    rail = front("rail", [(-10.5, 14.0), (10.5, 14.0), (10.5, 20.0), (9.0, 22.0), (-9.0, 22.0), (-10.5, 20.0)],
                 0.0, 200.0, M["dark"])
    # slots only where the ring bases don't cover them
    slots = [c for c in range(6, 197, 10) if not (58 <= c <= 82 or 178 <= c <= 200)]
    W.boolean(rail, [cube("c", -12.0, 12.0, c - 2.6, c + 2.6, 19.3, 24.0, M["dark"]) for c in slots])
    bevel_worn(rail, M["worn"], 0.3)

    release = side("bolt_release", [(4.0, 2.0, 1.5), (22.0, 3.0, 1.5), (22.0, 7.5, 1.5), (4.0, 7.5, 1.5)], -17.8, -15.6,
                   M["alu"])
    W.bevel(release, 0.4 * MM, segs=1)
    safety = side("safety", [(-15.0, -12.0, 1.5), (-3.0, -12.0, 1.5), (-3.0, -6.0, 1.5), (-15.0, -7.0, 1.5)], 16.0, 19.2,
                  M["alu"])
    W.bevel(safety, 0.5 * MM, segs=1)
    screws = [pin_x("receiver_screw", y, -8.0, 2.6, *sx_range(sx, 15.6, 16.5), M["steel"], segs=12)
              for sx in (1, -1) for y in (30.0, 188.0)]
    for s_ in screws:
        W.bevel(s_, 0.25 * MM, segs=1)

    # fluted barrel with a shank collar at the receiver
    prof = [(0.0, 204.0), (16.5, 204.0), (16.5, 220.0), (14.4, 224.0), (13.2, 240.0), (10.5, 720.0), (10.5, MUZZLE_Y)]
    barrel = rod_y("barrel", 0, 0, prof + [(0.0, MUZZLE_Y)], 28, M["dark"])
    flutes = []
    for k in range(6):
        a = math.radians(30.0 + 60.0 * k)
        ends = []
        for y in (262.0, 700.0):
            d = barrel_r(y) + 2.6 - 1.7
            ends.append((d * math.cos(a), y, d * math.sin(a)))
        flutes.append(capsule("c", ends[0], ends[1], 2.6, 10, M["dark"]))
    W.boolean(barrel, flutes)
    bevel_worn(barrel, M["worn"], 0.35)

    brake = rod_y("muzzle_brake", 0, 0, [(0.0, MUZZLE_Y - 2.0), (12.5, MUZZLE_Y - 2.0), (15.5, MUZZLE_Y + 1.5),
                                         (15.5, BRAKE_END_Y - 3.0), (14.2, BRAKE_END_Y), (0.0, BRAKE_END_Y)], 28, M["dark"])
    ports = [cube("c", -20.0, 20.0, y - 5.5, y + 5.5, -8.5, 8.5, M["dark"]) for y in (MUZZLE_Y + 17.0, MUZZLE_Y + 35.0,
                                                                                     MUZZLE_Y + 53.0)]
    bore = rod_y("c", 0, 0, [(0.0, MUZZLE_Y - 10.0), (5.4, MUZZLE_Y - 10.0), (5.4, BRAKE_END_Y - 1.0),
                             (6.6, BRAKE_END_Y + 0.5), (0.0, BRAKE_END_Y + 0.5)], 16, M["dark"])
    top_vent = [cube("c", -3.0, 3.0, y - 3.0, y + 3.0, 8.0, 20.0, M["dark"]) for y in (MUZZLE_Y + 10.0, MUZZLE_Y + 62.0)]
    W.boolean(brake, ports + [bore] + top_vent)
    bevel_worn(brake, M["worn"], 0.5)
    return [rec, rail, release, safety, barrel, brake] + screws


# ---------------------------------------------------------------- scope and rings

def build_scope(M):
    z = SCOPE_Z
    body = lathe_mm("scope_body", [
        (17.5, -35.0), (21.0, SCOPE_REAR_Y), (22.5, SCOPE_REAR_Y + 1.5), (22.5, -14.0), (21.0, -10.0), (18.0, 20.0),
        (18.8, 22.0), (18.8, 44.0), (15.2, 47.0), (15.2, 214.0), (16.5, 220.0), (28.5, 260.0), (29.5, 263.0),
        (29.5, 306.0), (28.5, 310.0), (26.5, 310.0), (26.0, 306.0)], 40, M["scope"], "Y", (0.0, 0.0, z))
    W.bevel(body, 0.5 * MM, segs=1, angle=40.0)
    diopter = lathe_mm("diopter_ring", [(22.9, -31.0), (22.9, -19.0)], 60, M["scope"], "Y", (0.0, 0.0, z), ripple=0.035)
    power = lathe_mm("power_ring", [(19.4, 25.0), (19.4, 41.0)], 48, M["scope"], "Y", (0.0, 0.0, z), ripple=0.06)
    cup = lathe_mm("eye_cup", [(21.0, -41.5), (23.3, -41.5), (23.6, -39.0), (23.3, -36.5), (21.0, -36.5)], 40,
                   M["rubber"], "Y", (0.0, 0.0, z), closed=True)
    lever = cube("power_lever", 12.0, 16.0, 30.0, 36.0, z + 13.0, z + 22.5, M["scope"])
    W.rotate(lever, -35.0, "Y", (0.0, 33.0 * MM, z * MM))
    W.bevel(lever, 0.6 * MM, segs=1)
    rear_lens = lathe_mm("lens_rear", [(0.0, -36.6), (9.0, -36.3), (17.6, -35.1), (17.6, -34.6), (0.0, -34.6)], 32,
                         M["glass"], "Y", (0.0, 0.0, z))
    front_lens = lathe_mm("lens_front", [(0.0, 305.2), (26.1, 305.2), (26.1, 305.8), (13.0, 306.8), (0.0, 307.1)], 40,
                          M["glass"], "Y", (0.0, 0.0, z))

    saddle = front("turret_saddle", [(-18.0, z - 18.0, 7.0), (18.0, z - 18.0, 7.0), (18.0, z + 18.0, 7.0),
                                     (-18.0, z + 18.0, 7.0)], 112.0, 158.0, M["scope"])
    W.bevel(saddle, 1.0 * MM, segs=2)
    turrets = []
    for axis, sign, h in (("Z", 1, 16.0), ("X", 1, 12.0), ("X", -1, 10.5)):
        base_r, cap_r = (12.5, 14.8) if axis == "Z" else (11.5, 13.5)
        t0 = 17.5
        c = (0.0, 135.0, z)
        parts = [
            lathe_mm("turret_base", [(0.0, sign * t0), (base_r, sign * t0), (base_r, sign * (t0 + 6.5)),
                                     (0.0, sign * (t0 + 6.5))], 32, M["scope"], axis, c),
            lathe_mm("turret_cap", [(0.0, sign * (t0 + 6.5)), (cap_r, sign * (t0 + 6.5)), (cap_r, sign * (t0 + 6.5 + h)),
                                    (0.0, sign * (t0 + 6.5 + h))], 52, M["scope"], axis, c, ripple=0.05),
            lathe_mm("turret_top", [(0.0, sign * (t0 + 6.5 + h)), (cap_r - 0.6, sign * (t0 + 6.5 + h)),
                                    (cap_r - 1.4, sign * (t0 + 8.0 + h)), (0.0, sign * (t0 + 8.0 + h))], 32, M["scope"], axis, c),
        ]
        for p in parts:
            W.bevel(p, 0.3 * MM, segs=1, angle=40.0)
        turrets += parts
    # zero marks on the caps and a reference line on the saddle, seen from the shooter
    marks = [
        cube("turret_mark", -0.6, 0.6, 135.0 - 15.2, 135.0 - 14.4, z + 30.0, z + 38.0, M["paint"]),
        cube("turret_mark", 30.0, 35.5, 135.0 - 14.0, 135.0 - 13.2, z - 0.6, z + 0.6, M["paint"]),
        cube("saddle_mark", -0.6, 0.6, 111.6, 113.0, z + 16.0, z + 17.6, M["paint"]),
    ]

    rings = []
    for y in (70.0, 190.0):
        base = cube("ring_base", -16.0, 16.0, y - 10.0, y + 10.0, 16.0, 30.0, M["alu"])
        W.boolean(base, front("c", [(-10.8, 13.0), (10.8, 13.0), (10.8, 20.2), (9.2, 22.2), (-9.2, 22.2), (-10.8, 20.2)],
                              y - 12.0, y + 12.0, M["alu"]))
        bevel_worn(base, M["worn"], 0.8)
        stanchion = front("ring_post", [(-8.0, 28.0), (8.0, 28.0), (11.5, 44.0), (-11.5, 44.0)], y - 8.0, y + 8.0, M["alu"])
        W.bevel(stanchion, 0.8 * MM, segs=1)
        ring = lathe_mm("ring", [(15.2, y - 9.0), (19.8, y - 9.0), (19.8, y + 9.0), (15.2, y + 9.0)], 36, M["alu"], "Y",
                        (0.0, 0.0, z), closed=True)
        W.bevel(ring, 0.7 * MM, segs=1)
        nut = pin_x("ring_nut", y, 21.0, 5.2, -19.8, -16.0, M["alu"], segs=6)
        bolt_end = pin_x("ring_bolt", y, 21.0, 2.4, 16.0, 17.2, M["steel"], segs=10)
        W.bevel(nut, 0.4 * MM, segs=1)
        screws = [pin_x("ring_screw", y + dy, z + 5.0, 2.0, *sx_range(sx, 18.6, 20.8), M["steel"], segs=10)
                  for sx in (1, -1) for dy in (-4.5, 4.5)]
        rings += [base, stanchion, ring, nut, bolt_end] + screws
    return [body, diopter, power, cup, lever, rear_lens, front_lens, saddle] + turrets + marks + rings


def build_bipod(M):
    mount = cube("bipod_mount", -13.0, 13.0, 438.0, 462.0, FOREND_BOTTOM_Z - 9.0, FOREND_BOTTOM_Z + 1.0, M["alu"])
    W.bevel(mount, 1.2 * MM, segs=2)
    knob = pin_x("bipod_knob", 450.0, FOREND_BOTTOM_Z - 5.0, 5.0, 13.0, 19.0, M["black"], segs=16)
    W.bevel(knob, 0.8 * MM, segs=1)
    yoke = cube("bipod_yoke", -17.0, 17.0, 446.0, 458.0, FOREND_BOTTOM_Z - 15.0, FOREND_BOTTOM_Z - 8.0, M["dark"])
    W.bevel(yoke, 1.0 * MM, segs=1)
    parts = [mount, knob, yoke]
    for sx in (1, -1):
        z = FOREND_BOTTOM_Z - 12.0
        p0 = Vector((sx * 11.0, 452.0, z)) * MM
        p1 = Vector((sx * 11.5, 575.0, z - 1.0)) * MM
        p2 = Vector((sx * 12.0, 660.0, z - 1.5)) * MM
        outer = W.tube("bipod_leg", p0, p1, 5.0 * MM, 4.6 * MM, 16, M["dark"])
        inner = W.tube("bipod_leg_inner", p1, p2, 3.8 * MM, 3.8 * MM, 12, M["steel"])
        foot = W.sphere("bipod_foot", p2, 5.6 * MM, 14, M["rubber"], scale=(1.0, 1.25, 1.0))
        collar = W.tube("bipod_collar", p1 - Vector((0, 6 * MM, 0)), p1 + Vector((0, 1 * MM, 0)), 5.6 * MM, 5.6 * MM, 16,
                        M["dark"])
        for obj in (outer, inner, collar):
            W.mark_sharp_by_angle(obj, 40.0)
        parts += [outer, inner, foot, collar]
    return parts


# ---------------------------------------------------------------- moving parts

def build_bolt(M):
    body = rod_y("bolt_body", 0, 0, [(0.0, -4.0), (10.5, -4.0), (10.5, 150.0), (9.0, 152.0), (0.0, 152.0)], 24, M["steel"])
    W.boolean(body, [cube("c", *sx_range(sx, 9.4, 12.0), 40.0, 140.0, -2.0, 2.0, M["steel"]) for sx in (1, -1)])
    W.bevel(body, 0.4 * MM, segs=1)
    collar = rod_y("bolt_collar", 0, 0, [(12.2, 6.0), (12.8, 7.0), (12.8, 19.0), (12.2, 20.0)], 24, M["steel"])
    shroud = rod_y("bolt_shroud", 0, 0, [(0.0, -30.0), (9.0, -30.0), (12.5, -27.0), (13.0, -22.0), (13.0, -4.0),
                                         (11.0, -2.0), (0.0, -2.0)], 28, M["dark"])
    W.bevel(shroud, 0.4 * MM, segs=1, angle=40.0)
    indicator = rod_y("cocking_indicator", 0, 0, [(0.0, -33.0), (2.4, -33.0), (2.4, -29.5), (0.0, -29.5)], 12, M["red"])
    root = Vector((9.0, 14.0, 0.0)) * MM
    knob_c = Vector(BOLT_KNOB) * MM
    shaft = W.tube("bolt_handle", root, knob_c, 5.6 * MM, 4.4 * MM, 16, M["steel"])
    W.mark_sharp_by_angle(shaft, 40.0)
    knob = W.sphere("bolt_knob", knob_c, 12.0 * MM, 24, M["black"])
    return W.join([body, collar, shroud, indicator, shaft, knob], "bolt_parts")


def build_trigger(M):
    py, pz = TRIGGER_PIVOT
    pts = [(2.5, -1.5, 1.0), (0.4, -7.0), (-1.2, -13.0), (-1.6, -16.0), (-1.2, -20.0), (0.6, -24.0), (2.2, -26.5, 1.0),
           (1.8, -28.0, 1.2), (-2.2, -26.8, 1.0), (-5.0, -22.0), (-6.2, -17.0), (-6.0, -11.0), (-5.0, -5.5),
           (-3.5, 0.0, 1.0), (-1.0, 2.6, 1.0), (2.6, 1.6, 1.0)]
    pts = [p if len(p) == 3 else (p[0], p[1], 0.0) for p in pts]
    trig = side("trigger", [(py + y, pz + z, r) for y, z, r in pts], -3.4, 3.4, M["steel"])
    return bevel_worn(trig, M["worn"], 0.45)


def build_mag(M):
    y0, y1 = MAG_Y
    body = side("mag_body", [(y0, MAG_BASE_Z + 5.0), (y1, MAG_BASE_Z + 5.0), (y1, MAG_TOP_Z, 1.0), (y0 + 6.0, MAG_TOP_Z, 1.0),
                             (y0, MAG_TOP_Z - 6.0, 1.0)], -14.0, 14.0, M["dark"])
    W.boolean(body, [side("c", [(y0 + 12.0, z0), (y1 - 12.0, z0), (y1 - 12.0, z0 + 3.0), (y0 + 12.0, z0 + 3.0)],
                          *sx_range(sx, 13.2, 16.0), M["dark"]) for sx in (1, -1) for z0 in (-62.0, -40.0)])
    W.bevel(body, 0.8 * MM, segs=1)
    base = side("mag_base", [(y0 - 2.0, MAG_BASE_Z + 6.0), (y1 + 2.0, MAG_BASE_Z + 6.0), (y1 + 2.0, MAG_BASE_Z, 2.5),
                             (y0 - 2.0, MAG_BASE_Z, 2.5)], -15.5, 15.5, M["alu"])
    base = bevel_worn(base, M["worn"], 1.0, segs=2)
    prof = [(0.0, 112.0), (7.1, 112.0), (7.1, 113.5), (6.4, 114.0), (6.4, 115.2), (7.4, 115.8), (7.1, 172.0), (5.2, 175.5),
            (4.65, 176.0), (4.65, 181.0), (4.3, 181.2), (4.3, 188.0), (3.2, 196.0), (1.5, 202.5), (0.0, 204.0)]
    round_ = rod_y("mag_round", 0.0, MAG_TOP_Z + 7.4, prof, 14, M["brass"])
    W.mark_sharp_by_angle(round_, 50)
    return W.join([body, base, round_], "mag_parts")


# ---------------------------------------------------------------- assemble

def build():
    W.common.reset_scene()
    M = make_materials()
    body = W.join(build_stock(M) + build_action(M) + build_scope(M) + build_bipod(M), "body_parts")
    bolt = build_bolt(M)
    trigger = build_trigger(M)
    mag = build_mag(M)

    shift = Matrix.Translation(Vector(final(0, 0, 0)))
    for obj in (body, bolt, trigger, mag):
        obj.data.transform(shift)

    root = W.empty("awp", (0, 0, 0))
    W.parent_static(body, root)
    body.name = body.data.name = "body"
    # extras end up in three.js userData; angles are three.js local rotations
    bolt_e = W.pin_part(bolt, "bolt", final(0, BOLT_Y, 0), root,
                        extras={"lift_rot_z_deg": 60.0, "travel_m": 0.1})
    W.pin_part(trigger, "trigger", final(0, *TRIGGER_PIVOT), root, extras={"pull_rot_x_deg": -12.0})
    mag_top = (0.0, 0.5 * (MAG_Y[0] + MAG_Y[1]), MAG_TOP_Z)
    mag_e = W.pin_part(mag, "mag", final(*mag_top), root, extras={"drop_dir": [0.0, -1.0, 0.0], "drop_m": 0.12})

    rake = (math.radians(-RAKE), 0.0, 0.0)
    sockets = [
        W.empty("socket_grip_r", final(*GRIP_R), rake, parent=root),
        W.empty("socket_grip_l", final(0.0, SUPPORT_Y, FOREND_BOTTOM_Z), parent=root),
        W.empty("socket_trigger", final(0.0, *TRIGGER_FACE), parent=root),
        W.empty("socket_muzzle", final(0.0, BRAKE_END_Y, 0.0), parent=root),
        W.empty("socket_eject", final(16.0, 105.0, 6.0), parent=root),
        W.empty("socket_scope_eye", final(0.0, -36.6, SCOPE_Z), parent=root),
        W.empty("socket_mag_bottom", final(0.0, mag_top[1], MAG_BASE_Z), parent=mag_e),
        W.empty("socket_bolt_knob", final(*BOLT_KNOB), parent=bolt_e),
    ]
    return root, [body, bolt, trigger, mag], sockets, M


def report(meshes):
    total = W.tri_count(meshes)
    for m in meshes:
        print(f"[awp] {m.name}: {W.tri_count([m])} tris")
    print(f"[awp] total {total} tris")
    return total


def bake(meshes):
    body, bolt, trigger, mag = meshes
    W.bake_ao([body, bolt, trigger], distance=0.035, samples=128, strength=0.85, floor=0.25)
    W.bake_ao([mag], distance=0.035, samples=128, strength=0.85, floor=0.25, isolate=True)
    for m in meshes:
        print(f"[awp] ao {m.name}: min/mean {W.ao_stats(m)}")


def renders(outdir, sockets, quick=False):
    W.add_light("key", (-0.5, -0.3, 0.6), (0, 0.3, 0.05), 90.0, size=0.8)
    W.add_light("rim", (0.7, 0.9, 0.3), (0, 0.3, 0.05), 50.0, size=0.6, color=(0.85, 0.9, 1.0))
    center = Vector(final(0, 300, -20))
    three_q = (tuple(center + Vector((0.95, -0.95, 0.45))), tuple(center + Vector((0, 0.0, -0.01))), 50)
    eye = Vector(final(-120.0, -250.0, 150.0))
    fp = (tuple(eye), tuple(eye + Vector((0.13, 1.0, -0.27))), 30)
    dbg = (tuple(center + Vector((-1.05, -0.75, 0.45))), tuple(center + Vector((0, 0.0, -0.01))), 48, 0.03)
    if not quick:
        W.preview_set("awp", outdir, three_q, fp, dbg, sockets)
        return
    W.setup_studio(strength=0.45)
    res = (1280, 540)
    for label, loc in (("left", (-1.6, 0, 0)), ("right", (1.6, 0, 0)), ("top", (0, 0, 1.6)), ("front", (0, 1.8, 0))):
        W.render(os.path.join(W.TMP, f"awp_{label}.png"), tuple(center + Vector(loc)), tuple(center),
                 resolution=res, samples=40, ortho_scale=1.25)
    W.render(os.path.join(W.TMP, "awp_34.png"), three_q[0], three_q[1], lens=three_q[2], resolution=res, samples=40)
    W.render(os.path.join(W.TMP, "awp_fp.png"), fp[0], fp[1], lens=fp[2], resolution=res, samples=40)


def main():
    root, meshes, sockets, M = build()
    total = report(meshes)
    if not QUICK:
        bake(meshes)
    W.export(OUT, root)
    if RENDERS or QUICK:
        renders(RENDERS or W.TMP, sockets, quick=QUICK)
    print(f"[awp] done, {total} tris -> {OUT}")


main()
