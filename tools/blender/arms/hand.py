"""gloved right hand as a signed distance field (hand frame, cm).

the hand is sculpted from smooth-unioned primitives: a rounded palm slab,
thenar/hypothenar pads, knuckle heads, round-cone finger segments with joint
bulges, an opposable thumb, the glove cuff and its velcro strap, plus raised
knuckle and finger pads as offset shells. glove_fields() also returns the
per-part distances that the skin weights use to tell fingers apart.
"""

import math

import numpy as np

import params as P
import sdf


def _frame_from(u, hint):
    u = P.normalize(u)
    v = np.asarray(hint, dtype=np.float64)
    v = P.normalize(v - u * np.dot(v, u))
    w = np.cross(u, v)
    return np.stack([u, v, w])


class HandShape:
    """precomputed primitive layout, evaluate with glove_fields(points_cm)"""

    def __init__(self):
        self.fingers = {}
        for name in P.FINGER_ORDER:
            pts, axis = P.finger_chain(name)
            radii = P.finger_radii(name)
            self.fingers[name] = dict(points=pts, radii=radii, axis=axis)
        tpts, tpads, taxis = P.thumb_chain()
        self.thumb = dict(points=tpts, pads=tpads, axis=taxis, radii=P.THUMB["r"])

        # palm outline (cm, hand frame) from the wrist to just past the knuckles
        self.palm_outline = np.array([
            (-2.80, -1.0), (-3.05, 1.5), (-3.35, 4.0), (-3.62, 7.0), (-3.72, 8.9),
            (-3.30, 10.0), (-2.30, 10.72), (-1.10, 10.98), (0.00, 11.08), (1.10, 10.98),
            (2.20, 10.74), (3.20, 10.34), (4.08, 9.84), (4.80, 9.38),
            (5.32, 8.78), (5.45, 7.60), (5.22, 5.20), (4.55, 2.60), (3.55, 0.60), (3.00, -1.0),
        ])
        self.palm_round = 1.05

        # thenar pad: a broad mound between the thumb metacarpal and the palm
        cmc, mcp = tpts[0], tpts[1]
        meta = mcp - cmc
        self.thenar_c = cmc + meta * 0.40 + np.array([1.05, 0.0, -0.50])
        self.thenar_axes = _frame_from(meta * np.array([1.0, 1.0, 0.25]), (1.0, 0.0, 0.0))
        self.thenar_r = (2.95, 2.05, 1.12)

        # hypothenar pad along the little finger side of the palm
        pinky_mcp = np.array(P.FINGERS["pinky"]["mcp"])
        hyp_dir = pinky_mcp - np.array([2.8, 0.5, 0.0])
        self.hyp_c = np.array([3.35, 4.3, -1.25])
        self.hyp_axes = _frame_from(hyp_dir * np.array([1.0, 1.0, 0.0]), (1.0, 0.0, 0.0))
        self.hyp_r = (3.45, 1.55, 0.92)

        # thumb web: a flattened pad spanning from the thumb knuckle to the
        # index knuckle, slightly behind the line between them
        imcp = np.array(P.FINGERS["index"]["mcp"])
        span = imcp - mcp
        web_mid = (mcp + imcp) * 0.5
        self.web_c = web_mid + np.array([0.55, -1.25, -0.25])
        self.web_axes = _frame_from(span, (0.0, -1.0, 0.0))
        self.web_r = (2.55, 1.55, 0.78)

        # knuckle pad centre line (dorsal), slightly behind the knuckle pivots
        self.knuckle_line = np.array([
            [self.fingers[n]["points"][0][0], self.fingers[n]["points"][0][1] - 0.25]
            for n in P.FINGER_ORDER
        ])

    # ------------------------------------------------------------ palm pieces
    def palm_top(self, x, y):
        t = np.interp(y, [-1.0, 0.0, 3.0, 6.0, 9.0, 11.5], [2.02, 2.0, 1.92, 1.72, 1.45, 1.30])
        return t - 0.042 * (x - 0.6) ** 2

    def palm_bot(self, x, y):
        b = np.interp(y, [-1.0, 0.0, 3.0, 6.0, 9.0, 11.5], [-1.95, -1.95, -1.72, -1.60, -1.84, -1.62])
        return b + 0.012 * (x - 0.7) ** 2

    def sd_palm_slab(self, p):
        x, y, z = p[:, 0], p[:, 1], p[:, 2]
        r = self.palm_round
        d2 = sdf.sd_polygon2(x, y, self.palm_outline) + r
        top = self.palm_top(x, y) - r
        bot = self.palm_bot(x, y) + r
        dz = np.maximum(z - top, bot - z)
        return sdf.op_extrude_round(d2, dz, r)

    def sd_thenar(self, p):
        return sdf.sd_ellipsoid(p, self.thenar_c, self.thenar_r, self.thenar_axes)

    def sd_palm(self, p):
        """palm without the thenar pad (that one is its own part for the weights)"""
        d = self.sd_palm_slab(p)
        d = sdf.smin(d, sdf.sd_ellipsoid(p, self.hyp_c, self.hyp_r, self.hyp_axes), 1.2)
        d = sdf.smin(d, sdf.sd_ellipsoid(p, self.web_c, self.web_r, self.web_axes), 1.2)
        # knuckle heads and the padded finger bases on the palm side
        for name in P.FINGER_ORDER:
            f = self.fingers[name]
            mcp = f["points"][0]
            r0 = f["radii"][0]
            d = sdf.smin(d, sdf.sd_sphere(p, mcp + np.array([0.0, -0.2, 0.22]), r0 * 1.0), 0.7)
            pad_c = mcp + np.array([0.0, -0.35, -0.95])
            d = sdf.smin(d, sdf.sd_ellipsoid(p, pad_c, (r0 * 0.98, 1.0, 0.72)), 0.8)
        return d

    # ------------------------------------------------------------ fingers
    def sd_finger(self, p, name):
        f = self.fingers[name]
        a, b, c, tip = f["points"]
        r0, r1, r2, r3 = f["radii"]
        d3 = P.normalize(tip - c)
        tip_c = tip - d3 * r3
        up = np.array([0.0, 0.0, 1.0])
        d = sdf.sd_round_cone(p, a, b, r0, r1)
        d = sdf.smin(d, sdf.sd_round_cone(p, b, c, r1, r2), 0.12)
        d = sdf.smin(d, sdf.sd_round_cone(p, c, tip_c, r2, r3), 0.1)
        # subtle joint bulges, a bit more on the back of the finger
        d = sdf.smin(d, sdf.sd_sphere(p, b + up * 0.05, r1 * 1.015), 0.3)
        d = sdf.smin(d, sdf.sd_sphere(p, c + up * 0.03, r2 * 1.01), 0.25)
        # soft fingertip pad under the last segment
        seg = tip_c - c
        axes = _frame_from(seg, (1.0, 0.0, 0.0))
        n = -axes[2] if axes[2][2] > 0 else axes[2]
        d = sdf.smin(d, sdf.sd_ellipsoid(p, c + seg * 0.62 + n * r2 * 0.18,
                                         (np.linalg.norm(seg) * 0.55, r2 * 0.86, r2 * 0.74), axes), 0.25)
        return d

    def sd_thumb(self, p):
        t = self.thumb
        cmc, mcp, ip, tip = t["points"]
        r0, r1, r2, r3 = t["radii"]
        d3 = P.normalize(tip - ip)
        tip_c = tip - d3 * r3
        d = sdf.sd_round_cone(p, cmc, mcp, r0, r1)
        d = sdf.smin(d, sdf.sd_round_cone(p, mcp, ip, r1, r2), 0.15)
        d = sdf.smin(d, sdf.sd_round_cone(p, ip, tip_c, r2, r3), 0.12)
        d = sdf.smin(d, sdf.sd_sphere(p, mcp - t["pads"][0] * 0.06, r1 * 1.03), 0.35)
        d = sdf.smin(d, sdf.sd_sphere(p, ip - t["pads"][1] * 0.04, r2 * 1.02), 0.25)
        # pads face the fingers
        for s0, s1, rr, pad in ((mcp, ip, r1, t["pads"][1]), (ip, tip_c, r2, t["pads"][2])):
            seg = s1 - s0
            axes = _frame_from(seg, np.cross(seg, pad))
            d = sdf.smin(d, sdf.sd_ellipsoid(p, s0 + seg * 0.58 + pad * rr * 0.2,
                                             (np.linalg.norm(seg) * 0.5, rr * 0.86, rr * 0.74), axes), 0.3)
        return d

    # ------------------------------------------------------------ cuff and strap
    def cuff_section(self, y):
        s = -y
        half_w, top, bot, n = P.forearm_section(np.clip(s, -2.0, 34.0))
        c = P.CUFF_CLEARANCE
        return half_w + c, (top - bot) * 0.5 + c, (top + bot) * 0.5, n

    def sd_cuff_radial(self, p):
        x, y, z = p[:, 0], p[:, 1], p[:, 2]
        a, b, cz, n = self.cuff_section(y)
        return sdf.superellipse_distance(x, z - cz, a, b, n)

    def sd_cuff(self, p):
        y = p[:, 1]
        r = 0.36
        d_rad = self.sd_cuff_radial(p)
        y_lo = -P.CUFF_END_S
        y_hi = 1.2
        d_ax = np.maximum(y - y_hi, y_lo - y)
        return sdf.op_extrude_round(d_rad + r, d_ax + r, r)

    def cuff_angle(self, p):
        """angle around the cuff, 0 = ulnar (+x), pi/2 = dorsal"""
        a, b, cz, n = self.cuff_section(p[:, 1])
        return np.arctan2((p[:, 2] - cz) / b, p[:, 0] / a)

    STRAP_Y = (-3.50, -0.95)
    STRAP_THETA = (math.radians(28.0), math.radians(215.0))

    def sd_strap(self, p, d_cuff_rad):
        y = p[:, 1]
        theta = np.mod(self.cuff_angle(p) + 2 * math.pi, 2 * math.pi)
        # arc length coordinate around the cuff (about 2.9 cm mean radius)
        rmean = 2.95
        t0, t1 = self.STRAP_THETA
        u = (theta - (t0 + t1) * 0.5) * rmean
        hu = (t1 - t0) * 0.5 * rmean
        yc = (self.STRAP_Y[0] + self.STRAP_Y[1]) * 0.5
        hy = (self.STRAP_Y[1] - self.STRAP_Y[0]) * 0.5
        # rounded rectangle footprint, the tab end is at the ulnar side
        corner = 0.75
        qx = np.abs(u) - hu + corner
        qy = np.abs(y - yc) - hy + corner
        foot = np.minimum(np.maximum(qx, qy), 0.0) + np.sqrt(np.maximum(qx, 0) ** 2 + np.maximum(qy, 0) ** 2) - corner
        # strap thickness tapers to zero on the palm side where it is sewn on
        thick = 0.20 * np.clip((t1 + 0.35 - theta) / 0.6, 0.0, 1.0)
        shell = d_cuff_rad - thick
        return sdf.smax(shell, foot, 0.12), foot

    # ------------------------------------------------------------ raised pads
    def knuckle_pad_foot(self, p):
        x, y = p[:, 0], p[:, 1]
        pts = self.knuckle_line
        d = np.full(len(p), 1e9)
        for i in range(len(pts) - 1):
            ax, ay = pts[i]
            bx, by = pts[i + 1]
            ex, ey = bx - ax, by - ay
            t = np.clip(((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey), 0.0, 1.0)
            dx, dy = x - (ax + ex * t), y - (ay + ey * t)
            d = np.minimum(d, np.sqrt(dx * dx + dy * dy))
        # extend a little past the index and pinky knuckles, rounded ends
        return d - 1.05

    def finger_pad_foot(self, p, name):
        f = self.fingers[name]
        a, b = f["points"][0], f["points"][1]
        seg = b - a
        L = np.linalg.norm(seg)
        u = seg / L
        rel = p - a
        t = rel @ u
        up = np.array([0.0, 0.0, 1.0])
        v = P.normalize(up - u * np.dot(up, u))
        side = np.cross(u, v)
        yv = rel @ v
        xs = rel @ side
        ang = np.arctan2(np.abs(xs), yv)  # 0 = straight up the back of the finger
        r = f["radii"][0]
        qa = np.abs(t - L * 0.56) - L * 0.26
        qb = (ang - math.radians(52.0)) * r
        corner = 0.3
        qa2 = qa + corner
        qb2 = qb + corner
        return np.minimum(np.maximum(qa2, qb2), 0.0) + np.sqrt(np.maximum(qa2, 0) ** 2 + np.maximum(qb2, 0) ** 2) - corner

    # ------------------------------------------------------------ full field
    def glove_fields(self, p, want_parts=False):
        palm = self.sd_palm(p)
        thenar = self.sd_thenar(p)
        fingers = {n: self.sd_finger(p, n) for n in P.FINGER_ORDER}
        thumb = self.sd_thumb(p)
        d_cuff_rad = self.sd_cuff_radial(p)
        cuff = self.sd_cuff(p)

        hand = sdf.smin(palm, thenar, 1.5)
        for n in P.FINGER_ORDER:
            hand = sdf.smin(hand, fingers[n], 0.7)
        hand = sdf.smin(hand, thumb, 0.95)
        base = sdf.smin(hand, cuff, 0.9)

        # padded knuckle guard (dorsal only) and pads on the first finger
        # segments, pushed out of the surface with a soft rounded edge
        dorsal = 0.35 - p[:, 2]
        kfoot = sdf.smax(self.knuckle_pad_foot(p), dorsal, 0.2)
        raise_k = 0.26 * _soft_step(-kfoot / 0.4)
        d = base - raise_k
        for n in P.FINGER_ORDER:
            ffoot = self.finger_pad_foot(p, n)
            d = d - 0.11 * _soft_step(-ffoot / 0.3)
        strap, _ = self.sd_strap(p, d_cuff_rad)
        strap = sdf.smax(strap, -p[:, 1] - P.CUFF_END_S + 0.25, 0.1)
        d = sdf.smin(d, strap, 0.04)
        if not want_parts:
            return d
        parts = dict(palm=palm, thenar=thenar, thumb=thumb, cuff=cuff, **fingers)
        return d, parts

    def sdf(self, p):
        return self.glove_fields(p)

    def bounds(self):
        return np.array([-7.8, -CUFF_MARGIN - P.CUFF_END_S, -5.6]), np.array([6.6, 20.4, 3.4])


CUFF_MARGIN = 0.8


def _soft_step(x):
    """0 below 0, 1 above 1, smooth (quintic) in between"""
    t = np.clip(x, 0.0, 1.0)
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)
