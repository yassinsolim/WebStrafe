"""forearm skin and pushed-up jacket sleeve as lofted tubes (right arm, cm).

both tubes are built ring by ring around the arm axis in the arm frame
(origin on the right wrist joint, y = -s). the sleeve is a profile curve in
(s, offset) space that starts inside the skin, rolls over the hem and runs
up to a capped shoulder end, with bunched folds pushed up from the hem.
"""

import math

import numpy as np

import params as P


def smoothstep(e0, e1, x):
    t = np.clip((np.asarray(x, dtype=np.float64) - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def core_section(s):
    """body cross section under the sleeve: forearm, blending into a round upper arm"""
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


def _tube_uvs(faces, ring_v, n_around, circumference, u_seam=-0.5 * math.pi):
    """per face corner uvs in cm: u around (seam on the palm side), v along"""
    uvs = []
    for f in faces:
        corner = []
        js = [idx % n_around for idx in f]
        # the face that crosses the seam gets u = n_around on its far side
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


# ---------------------------------------------------------------- skin
SKIN_RINGS = np.concatenate([
    [1.6, 2.6, 3.3],
    np.arange(3.8, 13.61, 0.45),
    [14.4, 15.4, 16.8, 18.4, 20.0],
])


def skin_tube(n_around=32):
    thetas = ring_angles(n_around)
    verts = []
    for s in SKIN_RINGS:
        half_w, top, bot, n = P.forearm_section(s)
        x, z = section_point(half_w, top, bot, n, thetas, 0.0)
        for xi, zi in zip(x, z):
            verts.append((xi, -s, zi))
    verts = np.array(verts)
    faces = _grid_faces(len(SKIN_RINGS), n_around)
    circ = 21.0
    ring_v = SKIN_RINGS - SKIN_RINGS[0]
    uvs = _tube_uvs(faces, ring_v, n_around, circ)
    faces, uvs = _orient(verts, faces, uvs)
    return verts, faces, uvs


# ---------------------------------------------------------------- sleeve
def _wrap(a):
    return np.mod(a + math.pi, 2 * math.pi) - math.pi


def _fold_field(theta, s):
    """radial offset of the bunched folds (cm), deterministic.

    pushed up fabric does not make clean rings: each crest wanders along the
    arm, fades out over part of the circumference and is sharper on the hem
    side, plus some short partial folds and a couple of spiral ones."""
    rng = np.random.default_rng(1207)
    theta = np.asarray(theta, dtype=np.float64)
    s = np.asarray(s, dtype=np.float64)
    out = np.zeros(np.broadcast(theta, s).shape)
    crests = [14.75, 16.25, 17.95, 19.45, 21.1, 22.75, 24.5]
    amps = [0.24, 0.34, 0.36, 0.32, 0.28, 0.22, 0.16]
    for sk, ak in zip(crests, amps):
        ph = rng.uniform(0, 2 * math.pi, 6)
        centre = sk + 0.6 * np.sin(theta + ph[0]) + 0.28 * np.sin(2 * theta + ph[1]) + 0.12 * np.sin(3 * theta + ph[2])
        fade = 0.5 + 0.5 * np.sin(theta + ph[3])
        amp = ak * np.clip(0.18 + 0.95 * fade ** 0.8 + 0.18 * np.sin(2 * theta + ph[4]), 0.0, 1.25)
        sigma = 0.44 + 0.1 * np.sin(theta + ph[5])
        d = s - centre
        sig = np.where(d < 0, sigma * 0.72, sigma)
        out += amp * np.exp(-(d / sig) ** 2)
        # crease just below each crest
        out -= 0.3 * amp * np.exp(-((d + sigma * 1.05) / 0.2) ** 2)
    # short partial folds that only run part way round
    for _ in range(7):
        cs = rng.uniform(15.0, 23.5)
        th0 = rng.uniform(0, 2 * math.pi)
        span = rng.uniform(0.5, 1.1)
        tilt = rng.uniform(-0.5, 0.5)
        a = rng.uniform(0.12, 0.22)
        dth = _wrap(theta - th0)
        out += a * np.exp(-(dth / span) ** 2) * np.exp(-((s - cs - tilt * dth) / 0.32) ** 2)
    # two spiral folds, one each side of the arm
    for c0, slope, width, a in ((0.9, 1.4, 0.55, 0.18), (3.9, -1.1, 0.6, 0.15)):
        u = _wrap(theta - c0 - (s - 17.0) * slope / 10.0)
        out += a * np.exp(-(u / (width / 3.0)) ** 2) * smoothstep(14.5, 16.0, s) * (1 - smoothstep(22.0, 25.0, s))
    return out


def _upper_folds(theta, s):
    """gentle folds on the upper arm part"""
    out = 0.16 * np.sin(2.3 * theta + s * 0.35) * np.sin(s * 0.42 + 0.7)
    out += 0.1 * np.sin(theta * 3.0 - s * 0.21 + 1.3)
    return out


SLEEVE_OUTER_START = P.SLEEVE_HEM_S + 1.1  # past this the sleeve is a plain height field


def sleeve_base_offset(s):
    """clearance of the fabric over the arm (cm) on the outer part"""
    s = np.asarray(s, dtype=np.float64)
    hem = P.SLEEVE_HEM_S
    t = smoothstep(hem + 1.2, 23.0, s)
    off = 0.5 + 0.45 * t
    off = off + (1.05 - off) * smoothstep(24.0, 31.0, s)
    return off


def sleeve_fold_weight(s):
    s = np.asarray(s, dtype=np.float64)
    hem = P.SLEEVE_HEM_S
    return smoothstep(hem + 1.1, hem + 2.0, s) * (1.0 - 0.75 * smoothstep(24.5, 30.0, s))


def sleeve_outer_offset(theta, s):
    """full radial offset (base clearance, sag, folds) of the outer surface"""
    off = sleeve_base_offset(s)
    # loose fabric hangs a little under the arm
    sag = 1.0 - 0.28 * np.sin(theta)
    fold = np.where(s < 27.0, _fold_field(theta, s), 0.0)
    fold = fold + _upper_folds(theta, s) * smoothstep(26.0, 30.0, s)
    return off * sag + sleeve_fold_weight(s) * fold


def sleeve_outer_point(theta, s):
    """(x, y, z) cm in the arm frame of the outer sleeve surface"""
    half_w, top, bot, n = core_section(s)
    x, z = section_point(half_w, top, bot, n, theta, sleeve_outer_offset(theta, s))
    return x, -np.asarray(s, dtype=np.float64) + 0.0 * x, z


def sleeve_profile():
    """(s, base offset cm) of the hem rings, then the s values of the outer rings"""
    hem = P.SLEEVE_HEM_S
    lip = [
        (hem + 0.62, -0.24),
        (hem + 0.22, -0.20),
        (hem - 0.10, -0.10),
        (hem - 0.30, 0.05),
        (hem - 0.36, 0.19),
        (hem - 0.28, 0.32),
        (hem - 0.08, 0.41),
        (hem + 0.30, 0.46),
        (hem + 0.72, 0.49),
    ]
    outer = list(np.arange(SLEEVE_OUTER_START, 25.0, 0.44)) + [25.6, 26.6, 27.8, 29.2, 31.0, 33.5]
    s = 36.5
    while s < 56.5:
        outer.append(s)
        s += 3.3
    return lip, outer


def sleeve_tube(n_around=40):
    thetas = ring_angles(n_around)
    lip, outer = sleeve_profile()
    verts = []
    ring_s = []
    ring_off = []
    for s, off in lip:
        half_w, top, bot, n = core_section(s)
        sag = 1.0 - 0.28 * np.sin(thetas)
        extra = off * np.where(off > 0.3, sag, 1.0)
        x, z = section_point(half_w, top, bot, n, thetas, extra)
        for xi, zi in zip(x, z):
            verts.append((xi, -s, zi))
        ring_s.append(s)
        ring_off.append(off)
    for s in outer:
        x, y, z = sleeve_outer_point(thetas, s)
        for xi, zi in zip(x, z):
            verts.append((xi, -s, zi))
        ring_s.append(s)
        ring_off.append(float(sleeve_base_offset(s)))
    prof = list(zip(ring_s, ring_off))
    n_rings = len(prof)
    # shoulder cap: one squashed dome ring and a centre vertex
    last_s = prof[-1][0]
    half_w, top, bot, n = core_section(last_s)
    x, z = section_point(half_w, top, bot, n, thetas, 0.7)
    for xi, zi in zip(x, z):
        verts.append((xi, -(last_s + 0.9), zi))
    cz = (top + bot) * 0.5
    verts.append((0.0, -(last_s + 1.4), cz))
    verts = np.array(verts)
    faces = _grid_faces(n_rings + 1, n_around)
    centre = len(verts) - 1
    base = n_rings * n_around
    cap = [(base + j, base + (j + 1) % n_around, centre) for j in range(n_around)]

    # uv: arc length along the profile, split into a forearm island and an
    # upper arm island at the elbow so the upper part can get fewer texels
    ring_s = np.array(ring_s + [last_s + 0.9])
    ring_off = np.array([p[1] for p in prof] + [0.7])
    seg = np.sqrt(np.diff(ring_s) ** 2 + np.diff(ring_off) ** 2)
    arc = np.concatenate([[0.0], np.cumsum(seg)])
    split = int(np.searchsorted(ring_s[:n_rings], 27.0))
    circ = 33.0
    uvs = _tube_uvs(faces, arc, n_around, circ)
    island = [0 if (f[0] // n_around) < split else 1 for f in faces]
    # offset the upper island in v so the two never share corners
    for k, f in enumerate(faces):
        if island[k] == 1:
            uvs[k] = [(u, v + 40.0) for (u, v) in uvs[k]]
    cap_uvs = []
    for f in cap:
        corner = []
        for idx in f:
            if idx == centre:
                corner.append((0.0, 0.0))
            else:
                j = idx % n_around
                a = thetas[j]
                corner.append((6.0 * math.cos(a), 6.0 * math.sin(a)))
        cap_uvs.append([(u + 100.0, v + 100.0) for (u, v) in corner])
    faces_all = faces + cap
    uvs_all = uvs + cap_uvs
    islands = island + [2] * len(cap)
    # vote on the outer bunched part, the inner lip legitimately faces inwards
    faces_all, uvs_all = _orient(verts, faces_all, uvs_all, sample=faces[len(faces) // 2:len(faces) // 2 + 400])
    return verts, faces_all, uvs_all, islands


def _orient(verts, faces, uvs, sample=None):
    """make faces point away from the arm axis (x = 0, z = 0 line along y)"""
    votes = 0.0
    for f in (sample if sample is not None else faces[: min(len(faces), 400)]):
        a, b, c = verts[f[0]], verts[f[1]], verts[f[2]]
        nrm = np.cross(b - a, c - a)
        centre = (a + b + c) / 3.0
        radial = np.array([centre[0], 0.0, centre[2]])
        votes += np.dot(nrm, radial)
    if votes < 0:
        faces = [tuple(reversed(f)) for f in faces]
        uvs = [list(reversed(u)) for u in uvs]
    return faces, uvs
