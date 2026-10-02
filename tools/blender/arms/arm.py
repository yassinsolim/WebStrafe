"""forearm muscle shaping and the lofted upper arm (right arm, cm).

the hand and forearm are one signed distance field (suit.py) that runs to
ARM_SDF_END_S. the upper arm is a plain lofted tube from just before that,
starting with a small raised lip so the end of the field is hidden inside it.
arm frame: origin on the right wrist joint, y = -s.
"""

import math

import numpy as np

import params as P


def smoothstep(e0, e1, x):
    t = np.clip((np.asarray(x, dtype=np.float64) - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def core_section(s):
    """body cross section: forearm, blending into a round upper arm past the elbow"""
    s = np.asarray(s, dtype=np.float64)
    half_w, top, bot, n = P.forearm_section(np.minimum(s, 26.0))
    r = P.UPPERARM_RADIUS
    t = smoothstep(26.0, 31.0, s)
    half_w = half_w * (1 - t) + r * t
    top = top * (1 - t) + r * 0.98 * t
    bot = bot * (1 - t) - r * 1.02 * t
    n = n * (1 - t) + 2.0 * t
    return half_w, top, bot, n


def section_point(half_w, top, bot, n, theta, offset):
    """superellipse point at angle theta pushed out along its normal by offset.

    theta: 0 = +x (ulnar when palm down), pi/2 = +z (back of the arm).
    returns (x, z) in the arm frame.
    """
    cz = (top + bot) * 0.5
    hd = (top - bot) * 0.5
    r = P.superellipse_radius(theta, half_w, hd, n)
    x = r * np.cos(theta)
    z = r * np.sin(theta)
    nx = np.sign(x) * np.power(np.abs(x) / half_w + 1e-12, n - 1) / half_w
    nz = np.sign(z) * np.power(np.abs(z) / hd + 1e-12, n - 1) / hd
    nl = np.sqrt(nx * nx + nz * nz) + 1e-12
    return x + offset * nx / nl, z + offset * nz / nl + cz


def _wrap(a):
    return np.mod(a + math.pi, 2 * math.pi) - math.pi


def _bundle(theta, s, th0, width, s0, s1, amp):
    """one muscle belly: gaussian around the arm, smooth rise and fall along it"""
    d = _wrap(theta - th0)
    across = np.exp(-(d / width) ** 2)
    mid = (s0 + s1) * 0.5
    half = (s1 - s0) * 0.5
    along = np.clip(1.0 - ((s - mid) / half) ** 2, 0.0, 1.0) ** 1.5
    return amp * across * along


def muscle_offset(theta, s):
    """radial offset (cm) of the synthetic muscle over the core section.

    lean bundles on the palm and thumb side where they show; the back of the
    forearm stays smooth under the plates. zero through the wrist and the
    watch zone so the band and the strap sit on the plain section.
    """
    theta = np.asarray(theta, dtype=np.float64)
    s = np.asarray(s, dtype=np.float64)
    out = _bundle(theta, s, math.radians(268), 0.55, 9.5, 27.0, 0.26)  # flexors
    out += _bundle(theta, s, math.radians(300), 0.32, 11.0, 25.0, 0.1)  # flexor ridge
    out += _bundle(theta, s, math.radians(168), 0.42, 12.0, 28.5, 0.3)  # brachioradialis
    out += _bundle(theta, s, math.radians(40), 0.5, 13.0, 26.0, 0.12)  # extensors
    # the groove between the thumb side bundle and the flexors
    out -= 0.07 * np.exp(-(_wrap(theta - math.radians(218)) / 0.16) ** 2) * smoothstep(11.0, 15.0, s) * (
        1 - smoothstep(22.0, 27.0, s))
    return out * smoothstep(P.WATCH_ZONE_S[1] + 0.3, P.WATCH_ZONE_S[1] + 2.5, s) * (1 - smoothstep(27.5, 30.0, s))


# ---------------------------------------------------------------- upper arm
def _grid_faces(n_rings, n_around):
    """quads between consecutive rings, ring major, closed around"""
    faces = []
    for i in range(n_rings - 1):
        for j in range(n_around):
            a = i * n_around + j
            b = i * n_around + (j + 1) % n_around
            c = (i + 1) * n_around + (j + 1) % n_around
            d = (i + 1) * n_around + j
            faces.append((a, b, c, d))
    return faces


def _tube_uvs(faces, ring_v, n_around, circumference):
    """per face corner uvs in cm: u around (seam on the palm side), v along"""
    uvs = []
    for f in faces:
        corner = []
        js = [idx % n_around for idx in f]
        wrap = max(js) - min(js) > 1
        for idx in f:
            i, j = divmod(idx, n_around)
            if wrap and j == 0:
                j = n_around
            corner.append((j / n_around * circumference, ring_v[i]))
        uvs.append(corner)
    return uvs


def ring_angles(n_around):
    # start on the palm side so the uv seam sits where nobody looks
    return -0.5 * math.pi + np.arange(n_around) * (2.0 * math.pi / n_around)


def upperarm_profile():
    """(s, offset over the core section) rings from the lip to the shoulder"""
    s0 = P.ARM_SDF_END_S - 0.7
    rings = [(s0 - 0.05, -0.2), (s0 + 0.05, 0.06), (s0 + 0.2, 0.16), (s0 + 0.45, 0.2), (s0 + 0.8, 0.2)]
    s = s0 + 1.6
    while s < 56.5:
        rings.append((s, 0.2 * (1 - smoothstep(s0 + 1.0, s0 + 6.0, s)) + 0.04))
        s += 2.6 if s < 40 else 3.4
    return rings


def upperarm_tube(n_around=36):
    thetas = ring_angles(n_around)
    prof = upperarm_profile()
    verts = []
    for s, off in prof:
        half_w, top, bot, n = core_section(s)
        x, z = section_point(half_w, top, bot, n, thetas, off)
        for xi, zi in zip(x, z):
            verts.append((xi, -s, zi))
    n_rings = len(prof)
    last_s = prof[-1][0]
    half_w, top, bot, n = core_section(last_s)
    x, z = section_point(half_w, top, bot, n, thetas, -0.6)
    for xi, zi in zip(x, z):
        verts.append((xi, -(last_s + 1.0), zi))
    verts.append((0.0, -(last_s + 1.5), (top + bot) * 0.5))
    verts = np.array(verts)
    faces = _grid_faces(n_rings + 1, n_around)
    centre = len(verts) - 1
    base = n_rings * n_around
    cap = [(base + j, base + (j + 1) % n_around, centre) for j in range(n_around)]
    ring_s = np.array([p[0] for p in prof] + [last_s + 1.0])
    ring_o = np.array([p[1] for p in prof] + [-0.6])
    arc = np.concatenate([[0.0], np.cumsum(np.sqrt(np.diff(ring_s) ** 2 + np.diff(ring_o) ** 2))])
    uvs = _tube_uvs(faces, arc, n_around, 28.0)
    cap_uvs = []
    for f in cap:
        corner = []
        for idx in f:
            if idx == centre:
                corner.append((100.0, 100.0))
            else:
                a = thetas[idx % n_around]
                corner.append((100.0 + 5.0 * math.cos(a), 100.0 + 5.0 * math.sin(a)))
        cap_uvs.append(corner)
    faces_all, uvs_all = _orient(verts, faces + cap, uvs + cap_uvs, sample=faces[n_around * 4:n_around * 8])
    return verts, faces_all, uvs_all


def _orient(verts, faces, uvs, sample=None):
    """make faces point away from the arm axis (x = 0, z = 0 line along y)"""
    votes = 0.0
    for f in (sample if sample is not None else faces[: min(len(faces), 400)]):
        a, b, c = verts[f[0]], verts[f[1]], verts[f[2]]
        nrm = np.cross(b - a, c - a)
        centre = (a + b + c) / 3.0
        votes += np.dot(nrm, np.array([centre[0], 0.0, centre[2]]))
    if votes < 0:
        faces = [tuple(reversed(f)) for f in faces]
        uvs = [list(reversed(u)) for u in uvs]
    return faces, uvs
