"""the cyborg's synthetic muscle suit: right hand and forearm as one signed
distance field (hand frame, cm).

the hand is sculpted from smooth-unioned primitives like a real one but lean:
a thin palm slab, thenar and hypothenar pads, knuckle heads, round-cone finger
segments with small joint bulges and an opposable thumb. the forearm is a
superellipse section swept along the arm with the muscle bundles from
arm.muscle_offset, smooth-unioned into the palm at the wrist and running to
ARM_SDF_END_S. fields() also returns the per-part distances that the skin
weights use to tell fingers apart.
"""

import numpy as np

import arm as A
import params as P
import sdf

# far away value for parts that are masked out of a query
FAR = 50.0


def frame_from(u, hint):
    u = P.normalize(u)
    v = np.asarray(hint, dtype=np.float64)
    v = P.normalize(v - u * np.dot(v, u))
    w = np.cross(u, v)
    return np.stack([u, v, w])


def _slim_x(x):
    """the palm outline narrowed about the middle of the hand"""
    return 0.8 + (np.asarray(x, dtype=np.float64) - 0.8) * 0.92


class SuitShape:
    def __init__(self):
        self.fingers = {}
        for name in P.FINGER_ORDER:
            pts, axis = P.finger_chain(name)
            self.fingers[name] = dict(points=pts, radii=P.finger_radii(name), axis=axis)
        tpts, tpads, taxis = P.thumb_chain()
        self.thumb = dict(points=tpts, pads=tpads, axis=taxis, radii=P.THUMB["r"])

        outline = np.array([
            (-2.80, -1.0), (-3.05, 1.5), (-3.35, 4.0), (-3.62, 7.0), (-3.72, 8.9),
            (-3.30, 10.0), (-2.30, 10.72), (-1.10, 10.98), (0.00, 11.08), (1.10, 10.98),
            (2.20, 10.74), (3.20, 10.34), (4.08, 9.84), (4.80, 9.38),
            (5.32, 8.78), (5.45, 7.60), (5.22, 5.20), (4.55, 2.60), (3.55, 0.60), (3.00, -1.0),
        ])
        outline[:, 0] = _slim_x(outline[:, 0])
        # the finger bases carry the knuckle line, keep the outline's tips where they were
        outline[6:13, 1] -= 0.25
        self.palm_outline = outline
        self.palm_round = 0.82

        cmc, mcp = tpts[0], tpts[1]
        meta = mcp - cmc
        self.thenar_c = cmc + meta * 0.40 + np.array([0.95, 0.0, -0.42])
        self.thenar_axes = frame_from(meta * np.array([1.0, 1.0, 0.25]), (1.0, 0.0, 0.0))
        self.thenar_r = (2.65, 1.78, 0.95)

        pinky_mcp = np.array(P.FINGERS["pinky"]["mcp"])
        hyp_dir = pinky_mcp - np.array([2.8, 0.5, 0.0])
        self.hyp_c = np.array([3.05, 4.3, -1.05])
        self.hyp_axes = frame_from(hyp_dir * np.array([1.0, 1.0, 0.0]), (1.0, 0.0, 0.0))
        self.hyp_r = (3.2, 1.3, 0.78)

        imcp = np.array(P.FINGERS["index"]["mcp"])
        span = imcp - mcp
        self.web_c = (mcp + imcp) * 0.5 + np.array([0.5, -1.15, -0.2])
        self.web_axes = frame_from(span, (0.0, -1.0, 0.0))
        self.web_r = (2.3, 1.38, 0.66)

    # ------------------------------------------------------------ palm
    def palm_top(self, x, y):
        t = np.interp(y, [-1.0, 0.0, 3.0, 6.0, 9.0, 11.5], [1.62, 1.6, 1.56, 1.42, 1.22, 1.08])
        return t - 0.036 * (x - 0.6) ** 2

    def palm_bot(self, x, y):
        b = np.interp(y, [-1.0, 0.0, 3.0, 6.0, 9.0, 11.5], [-1.6, -1.6, -1.42, -1.32, -1.5, -1.32])
        return b + 0.01 * (x - 0.7) ** 2

    def sd_palm_slab(self, p):
        x, y, z = p[:, 0], p[:, 1], p[:, 2]
        r = self.palm_round
        d2 = sdf.sd_polygon2(x, y, self.palm_outline) + r
        top = self.palm_top(x, y) - r
        bot = self.palm_bot(x, y) + r
        dz = np.maximum(z - top, bot - z)
        return sdf.op_extrude_round(d2, dz, r)

    def knuckle_centre(self, name):
        f = self.fingers[name]
        return f["points"][0] + np.array([0.0, -0.2, 0.2])

    def sd_palm(self, p):
        d = self.sd_palm_slab(p)
        d = sdf.smin(d, sdf.sd_ellipsoid(p, self.hyp_c, self.hyp_r, self.hyp_axes), 1.1)
        d = sdf.smin(d, sdf.sd_ellipsoid(p, self.web_c, self.web_r, self.web_axes), 1.1)
        for name in P.FINGER_ORDER:
            f = self.fingers[name]
            r0 = f["radii"][0]
            d = sdf.smin(d, sdf.sd_sphere(p, self.knuckle_centre(name), r0), 0.6)
            pad_c = f["points"][0] + np.array([0.0, -0.35, -0.85])
            d = sdf.smin(d, sdf.sd_ellipsoid(p, pad_c, (r0 * 0.95, 0.9, 0.62)), 0.7)
        return d

    def sd_thenar(self, p):
        return sdf.sd_ellipsoid(p, self.thenar_c, self.thenar_r, self.thenar_axes)

    # ------------------------------------------------------------ digits
    def sd_finger(self, p, name):
        f = self.fingers[name]
        a, b, c, tip = f["points"]
        r0, r1, r2, r3 = f["radii"]
        tip_c = tip - P.normalize(tip - c) * r3
        up = np.array([0.0, 0.0, 1.0])
        d = sdf.sd_round_cone(p, a, b, r0, r1)
        d = sdf.smin(d, sdf.sd_round_cone(p, b, c, r1, r2), 0.1)
        d = sdf.smin(d, sdf.sd_round_cone(p, c, tip_c, r2, r3), 0.08)
        # small joint bulges, a bit more on the back of the finger
        d = sdf.smin(d, sdf.sd_sphere(p, b + up * 0.04, r1 * 1.02), 0.25)
        d = sdf.smin(d, sdf.sd_sphere(p, c + up * 0.03, r2 * 1.015), 0.2)
        seg = tip_c - c
        axes = frame_from(seg, (1.0, 0.0, 0.0))
        n = -axes[2] if axes[2][2] > 0 else axes[2]
        d = sdf.smin(d, sdf.sd_ellipsoid(p, c + seg * 0.62 + n * r2 * 0.16,
                                         (np.linalg.norm(seg) * 0.55, r2 * 0.84, r2 * 0.7), axes), 0.2)
        return d

    def sd_thumb(self, p):
        t = self.thumb
        cmc, mcp, ip, tip = t["points"]
        r0, r1, r2, r3 = t["radii"]
        tip_c = tip - P.normalize(tip - ip) * r3
        d = sdf.sd_round_cone(p, cmc, mcp, r0, r1)
        d = sdf.smin(d, sdf.sd_round_cone(p, mcp, ip, r1, r2), 0.13)
        d = sdf.smin(d, sdf.sd_round_cone(p, ip, tip_c, r2, r3), 0.1)
        d = sdf.smin(d, sdf.sd_sphere(p, mcp - t["pads"][0] * 0.05, r1 * 1.03), 0.3)
        d = sdf.smin(d, sdf.sd_sphere(p, ip - t["pads"][1] * 0.04, r2 * 1.02), 0.22)
        for s0, s1, rr, pad in ((mcp, ip, r1, t["pads"][1]), (ip, tip_c, r2, t["pads"][2])):
            seg = s1 - s0
            axes = frame_from(seg, np.cross(seg, pad))
            d = sdf.smin(d, sdf.sd_ellipsoid(p, s0 + seg * 0.58 + pad * rr * 0.18,
                                             (np.linalg.norm(seg) * 0.5, rr * 0.84, rr * 0.72), axes), 0.25)
        return d

    # ------------------------------------------------------------ forearm
    def arm_surface(self, p, bumps=True):
        """distance to the forearm muscle (or the plain core section), plus theta"""
        x, y, z = p[:, 0], p[:, 1], p[:, 2]
        s = np.clip(-y, -2.0, P.ARM_SDF_END_S + 1.0)
        half_w, top, bot, n = A.core_section(s)
        cz = (top + bot) * 0.5
        hd = (top - bot) * 0.5
        d = sdf.superellipse_distance(x, z - cz, half_w, hd, n)
        # polar angle, the same one arm.section_point takes
        theta = np.arctan2(z - cz, x)
        if bumps:
            d = d - A.muscle_offset(theta, s)
        return d, theta

    def sd_forearm(self, p):
        d, _ = self.arm_surface(p)
        s = -p[:, 1]
        # rounded into the palm at the wrist, flat inside the upper arm tube at the far end
        d = sdf.smax(d, -s - 1.2, 0.7)
        return np.maximum(d, s - P.ARM_SDF_END_S)

    # ------------------------------------------------------------ full field
    def fields(self, p, want_parts=False):
        n = len(p)
        y = p[:, 1]
        hand_zone = y > -3.6
        arm_zone = y < 2.6
        palm = np.full(n, FAR)
        thenar = np.full(n, FAR)
        thumb = np.full(n, FAR)
        fingers = {k: np.full(n, FAR) for k in P.FINGER_ORDER}
        arm = np.full(n, FAR)
        if hand_zone.any():
            q = p[hand_zone]
            palm[hand_zone] = self.sd_palm(q)
            thenar[hand_zone] = self.sd_thenar(q)
            thumb[hand_zone] = self.sd_thumb(q)
            for k in P.FINGER_ORDER:
                fingers[k][hand_zone] = self.sd_finger(q, k)
        if arm_zone.any():
            arm[arm_zone] = self.sd_forearm(p[arm_zone])
        hand = sdf.smin(palm, thenar, 1.3)
        for k in P.FINGER_ORDER:
            hand = sdf.smin(hand, fingers[k], 0.6)
        hand = sdf.smin(hand, thumb, 0.85)
        d = sdf.smin(hand, arm, 0.9)
        if not want_parts:
            return d
        return d, dict(palm=palm, thenar=thenar, thumb=thumb, arm=arm, **fingers)

    def sdf(self, p):
        return self.fields(p)

    def bounds(self):
        return np.array([-7.6, -(P.ARM_SDF_END_S + 0.4), -5.0]), np.array([6.2, 20.2, 4.8])
