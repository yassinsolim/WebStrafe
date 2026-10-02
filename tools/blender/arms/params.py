"""anatomy numbers for the first-person arms, all in one place.

everything here is plain python/numpy so the sdf, rig, weights and textures
all read the same joint positions. dimensions are written in cm and converted
with CM. the joints are an adult male's (the knife grips are fitted to them),
the body around them is a slim cyborg's: synthetic muscle under thin plates.

frames:
  world  = blender world, camera at the origin looking down +Y, z up.
  hand   = right hand frame, origin on the right wrist joint, axes parallel to
           world: +Y towards the fingers, +Z back of the hand, -Z palm,
           -X thumb (radial) side, +X little finger (ulnar) side.
  arm s  = distance from the wrist joint back along the forearm (proximal +).
the left arm is the exact mirror of the right arm across world x = 0.
"""

import math

import numpy as np

CM = 0.01
MM = 0.001

# shoulder joints from the spec, camera at the origin
SHOULDER_R = np.array([0.19, -0.12, -0.28])
UPPERARM_LEN = 30.0 * CM
FOREARM_LEN = 26.0 * CM
TWIST_OFFSET = 7.0 * CM  # forearm_twist head sits this far before the wrist

ELBOW_R = SHOULDER_R + np.array([0.0, UPPERARM_LEN, 0.0])
WRIST_R = ELBOW_R + np.array([0.0, FOREARM_LEN, 0.0])
TWIST_R = WRIST_R - np.array([0.0, TWIST_OFFSET, 0.0])

# ---------------------------------------------------------------- hand
HAND_LENGTH = 19.5  # wrist crease to middle fingertip
PALM_LENGTH = 10.5  # wrist crease to the middle knuckle
PALM_WIDTH = 8.4  # across the knuckles
PALM_THICKNESS = 2.8

SEGMENT_RATIO = (0.46, 0.30, 0.24)

# per finger: knuckle pivot (hand frame, cm), visible length from the knuckle
# crease (spec), base radius, tip radius, spread (deg, + towards the pinky),
# rest flexion at knuckle / middle / last joint (deg), slightly relaxed.
# the pivot to tip length is the visible length plus the ~0.8 cm the knuckle
# pivot sits behind the finger crease, which also makes the middle finger land
# exactly on the 19.5 cm hand length.
KNUCKLE_TO_CREASE = 0.8

FINGERS = {
    "index": dict(mcp=(-2.36, 10.12, 0.00), length=7.4, r0=0.92, r1=0.73, spread=-4.0,
                  flex=(5.0, 9.0, 5.0)),
    "middle": dict(mcp=(0.00, 10.50, 0.00), length=8.2, r0=0.94, r1=0.75, spread=0.0,
                   flex=(6.0, 10.0, 6.0)),
    "ring": dict(mcp=(2.14, 10.16, -0.05), length=7.7, r0=0.89, r1=0.71, spread=3.5,
                 flex=(7.0, 11.0, 7.0)),
    "pinky": dict(mcp=(4.06, 9.25, -0.22), length=6.2, r0=0.80, r1=0.64, spread=8.0,
                  flex=(8.0, 12.0, 8.0)),
}
FINGER_ORDER = ("index", "middle", "ring", "pinky")

# thumb: base on the radial side near the wrist, metacarpal about 35 deg from
# the index metacarpal and tipped towards the palm, phalanges curving back so
# the tip rests beside the index finger with the pad facing the fingers.
THUMB = dict(
    cmc=(-2.20, 1.90, -0.80),
    lengths=(4.6, 3.3, 2.8),
    r=(1.12, 0.99, 0.91, 0.79),  # radius at cmc, mcp, ip, tip
    meta_dir=(-0.58, 0.76, -0.30),
    pad_dir=(0.85, 0.0, 0.50),  # rough direction the thumb pad faces
    flex=(38.0, 22.0),  # bend at mcp and ip towards the pad side
)

# ---------------------------------------------------------------- forearm
# synthetic muscle cross sections along the forearm, s in cm from the wrist
# joint. width is the full x size, top/bottom are the dorsal/palmar surface
# heights relative to the bone axis. a lean, tapered forearm: narrow wrist,
# the flexor mass on the palm side towards the elbow.
FOREARM_S = np.array([-2.0, 0.0, 3.0, 6.0, 9.0, 13.0, 18.0, 23.0, 26.0, 29.0, 34.0])
FOREARM_W = np.array([5.0, 5.0, 5.15, 5.6, 6.2, 6.95, 7.6, 8.0, 7.8, 7.6, 7.5])
FOREARM_TOP = np.array([1.62, 1.62, 1.7, 1.86, 2.08, 2.42, 2.82, 3.2, 3.25, 3.2, 3.15])
FOREARM_BOT = np.array([-1.62, -1.62, -1.72, -2.02, -2.45, -3.0, -3.48, -3.78, -3.5, -3.35, -3.3])
# superellipse exponent (2 = ellipse), squarer at the wrist
FOREARM_N = np.array([2.5, 2.5, 2.4, 2.3, 2.2, 2.1, 2.05, 2.0, 2.0, 2.0, 2.0])

# upper arm core (s from the elbow joint towards the shoulder)
UPPERARM_RADIUS = 4.4

# the muscle field runs to here, the lofted upper arm takes over under a ring
ARM_SDF_END_S = 31.0
# mechanical wrist band around the twist bone, nothing else in the watch zone
WRIST_BAND_S = (1.5, 3.1)
WATCH_ZONE_S = (4.2, 8.9)
# forearm plates start here (past the watch strap)
PLATE_START_S = 9.3

# twist blend: forearm -> forearm_twist between these s values, the watch
# and cuff zone below TWIST_FULL_S is rigid on the twist bone so the strap
# never cuts into the skin when the wrist rolls
TWIST_RAMP_START_S = 15.5
TWIST_FULL_S = 8.8
WRIST_BLEND = (1.3, -2.2)  # forearm_twist -> hand across the wrist joint
ELBOW_BLEND = (FOREARM_LEN / CM + 4.5, FOREARM_LEN / CM - 5.0)

# ---------------------------------------------------------------- watch
WATCH_S = 6.4  # watch centre, cm from the wrist joint
WATCH_CLEARANCE = 1.5 * MM
STRAP_CLEARANCE = 1.5 * MM


def forearm_section(s_cm):
    """(half width, top, bottom, exponent) of the skin at s (cm), numpy friendly"""
    s = np.asarray(s_cm, dtype=np.float64)
    w = _smooth_interp(s, FOREARM_S, FOREARM_W) * 0.5
    top = _smooth_interp(s, FOREARM_S, FOREARM_TOP)
    bot = _smooth_interp(s, FOREARM_S, FOREARM_BOT)
    n = np.interp(s, FOREARM_S, FOREARM_N)
    return w, top, bot, n


def _smooth_interp(x, xs, ys):
    """monotone cubic (fritsch-carlson) so the arm profile has no kinks"""
    xs = np.asarray(xs, dtype=np.float64)
    ys = np.asarray(ys, dtype=np.float64)
    h = np.diff(xs)
    delta = np.diff(ys) / h
    m = np.zeros_like(ys)
    m[1:-1] = (delta[:-1] + delta[1:]) * 0.5
    m[0] = delta[0]
    m[-1] = delta[-1]
    for i in range(len(delta)):
        if delta[i] == 0.0:
            m[i] = 0.0
            m[i + 1] = 0.0
        else:
            a = m[i] / delta[i]
            b = m[i + 1] / delta[i]
            r = a * a + b * b
            if r > 9.0:
                t = 3.0 / math.sqrt(r)
                m[i] = t * a * delta[i]
                m[i + 1] = t * b * delta[i]
    x = np.clip(np.asarray(x, dtype=np.float64), xs[0], xs[-1])
    idx = np.clip(np.searchsorted(xs, x) - 1, 0, len(xs) - 2)
    t = (x - xs[idx]) / h[idx]
    t2 = t * t
    t3 = t2 * t
    h00 = 2 * t3 - 3 * t2 + 1
    h10 = t3 - 2 * t2 + t
    h01 = -2 * t3 + 3 * t2
    h11 = t3 - t2
    return h00 * ys[idx] + h10 * h[idx] * m[idx] + h01 * ys[idx + 1] + h11 * h[idx] * m[idx + 1]


def superellipse_radius(theta, a, b, n):
    """radius of |x/a|^n + |y/b|^n = 1 along angle theta (x = cos, y = sin)"""
    c = np.abs(np.cos(theta))
    s = np.abs(np.sin(theta))
    return 1.0 / np.power(np.power(c / a, n) + np.power(s / b, n), 1.0 / n)


def forearm_point(s_cm, theta, offset_cm=0.0):
    """skin point in the right arm frame (cm, relative to the wrist joint).

    theta is measured around the arm: 0 = +X (ulnar side when palm down),
    pi/2 = +Z (dorsal), pi = -X (radial), 3pi/2 = -Z (palm).
    returns (x, y, z) arrays with y = -s.
    """
    half_w, top, bot, n = forearm_section(s_cm)
    centre_z = (top + bot) * 0.5
    half_d = (top - bot) * 0.5
    r = superellipse_radius(theta, half_w, half_d, n)
    # push out along the section normal instead of the radius for offsets
    x = r * np.cos(theta)
    z = r * np.sin(theta)
    if np.any(np.asarray(offset_cm) != 0.0):
        nx = np.sign(x) * np.power(np.abs(x) / half_w, n - 1) / half_w
        nz = np.sign(z) * np.power(np.abs(z) / half_d, n - 1) / half_d
        nl = np.sqrt(nx * nx + nz * nz) + 1e-12
        x = x + offset_cm * nx / nl
        z = z + offset_cm * nz / nl
    s = np.asarray(s_cm, dtype=np.float64)
    return x, -s + 0.0 * x, z + centre_z


def rotate(v, axis, angle_deg):
    """rodrigues rotation of vector v about a unit axis"""
    v = np.asarray(v, dtype=np.float64)
    k = np.asarray(axis, dtype=np.float64)
    k = k / np.linalg.norm(k)
    a = math.radians(angle_deg)
    return v * math.cos(a) + np.cross(k, v) * math.sin(a) + k * np.dot(k, v) * (1.0 - math.cos(a))


def normalize(v):
    v = np.asarray(v, dtype=np.float64)
    return v / np.linalg.norm(v)


def finger_chain(name):
    """joint positions (cm, hand frame) knuckle, middle joint, last joint, tip"""
    f = FINGERS[name]
    total = f["length"] + KNUCKLE_TO_CREASE
    lengths = [total * r for r in SEGMENT_RATIO]
    up = np.array([0.0, 0.0, 1.0])
    d0 = rotate(np.array([0.0, 1.0, 0.0]), up, -f["spread"])  # + spread goes to +X
    axis = np.cross(up, d0)  # flexion axis, positive angle curls towards the palm
    points = [np.array(f["mcp"], dtype=np.float64)]
    bend = 0.0
    for length, flex in zip(lengths, f["flex"]):
        bend += flex
        d = rotate(d0, axis, bend)
        points.append(points[-1] + d * length)
    return points, axis


def finger_radii(name):
    """radius at knuckle, middle joint, last joint and tip (cm)"""
    f = FINGERS[name]
    r0, r1 = f["r0"], f["r1"]
    return [r0, r0 * 0.90 + r1 * 0.10, r0 * 0.50 + r1 * 0.50, r1]


def thumb_chain():
    """(points cmc, mcp, ip, tip in cm hand frame, pad direction per segment)"""
    t = THUMB
    d1 = normalize(t["meta_dir"])
    pad = np.array(t["pad_dir"], dtype=np.float64)
    pad = normalize(pad - d1 * np.dot(pad, d1))
    axis = normalize(np.cross(d1, pad))  # rotating about this bends d towards the pad
    points = [np.array(t["cmc"], dtype=np.float64)]
    points.append(points[0] + d1 * t["lengths"][0])
    d2 = rotate(d1, axis, t["flex"][0])
    points.append(points[1] + d2 * t["lengths"][1])
    d3 = rotate(d1, axis, t["flex"][0] + t["flex"][1])
    points.append(points[2] + d3 * t["lengths"][2])
    pads = [pad, rotate(pad, axis, t["flex"][0]), rotate(pad, axis, t["flex"][0] + t["flex"][1])]
    return points, pads, axis


def hand_to_world_r(p_cm):
    """hand frame cm -> world metres for the right hand"""
    return WRIST_R + np.asarray(p_cm, dtype=np.float64) * CM


def arm_to_world_r(p_cm):
    """arm frame (same axes as the hand frame, origin on the wrist) -> world"""
    return WRIST_R + np.asarray(p_cm, dtype=np.float64) * CM


def mirror_x(p):
    p = np.array(p, dtype=np.float64)
    p[..., 0] *= -1.0
    return p


def bone_layout():
    """rest pose bones for both sides: name -> (head, tail, parent, connected), world metres"""
    bones = {}
    for side, flip in (("r", False), ("l", True)):
        def w(p):
            return mirror_x(p) if flip else np.array(p, dtype=np.float64)

        def hw(p_cm):
            return w(hand_to_world_r(p_cm))

        bones[f"upperarm_{side}"] = (w(SHOULDER_R), w(ELBOW_R), None, False)
        bones[f"forearm_{side}"] = (w(ELBOW_R), w(WRIST_R), f"upperarm_{side}", True)
        bones[f"forearm_twist_{side}"] = (w(TWIST_R), w(WRIST_R), f"forearm_{side}", False)
        middle_mcp = FINGERS["middle"]["mcp"]
        bones[f"hand_{side}"] = (w(WRIST_R), hw(middle_mcp), f"forearm_twist_{side}", True)
        tpts, _, _ = thumb_chain()
        for i in range(3):
            parent = f"hand_{side}" if i == 0 else f"thumb_{i:02d}_{side}"
            bones[f"thumb_{i + 1:02d}_{side}"] = (hw(tpts[i]), hw(tpts[i + 1]), parent, i > 0)
        for name in FINGER_ORDER:
            pts, _ = finger_chain(name)
            for i in range(3):
                parent = f"hand_{side}" if i == 0 else f"{name}_{i:02d}_{side}"
                bones[f"{name}_{i + 1:02d}_{side}"] = (hw(pts[i]), hw(pts[i + 1]), parent, i > 0)
    return bones


REQUIRED_BONES = [
    f"{base}_{side}"
    for side in ("l", "r")
    for base in (
        ["upperarm", "forearm", "forearm_twist", "hand"]
        + [f"{f}_{i:02d}" for f in ("thumb",) + FINGER_ORDER for i in (1, 2, 3)]
    )
]
