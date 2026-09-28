"""a small signed distance modelling kit for the character armor.

every shape is an SDF node you call with (N, 3) points and get (N,) distances
back (negative inside). nodes know a conservative bounding box so the mesher
can size its grid. modelling happens in three.js space (y up, the character
faces +z, its left side on +x, metres); build_characters.py converts to
blender space only when it makes the mesh objects.

the mesher samples a dense grid and runs openvdb's level set to polygons,
the same approach as the first-person arms (tools/blender/arms/sdf.py).
"""

import math

import numpy as np


def length(v, axis=-1):
    return np.sqrt(np.sum(v * v, axis=axis))


def normalize(v):
    v = np.asarray(v, dtype=np.float64)
    return v / max(np.linalg.norm(v), 1e-12)


def smin(a, b, k):
    if k <= 0.0:
        return np.minimum(a, b)
    h = np.maximum(k - np.abs(a - b), 0.0) / k
    return np.minimum(a, b) - h * h * h * k * (1.0 / 6.0)


def smax(a, b, k):
    return -smin(-a, -b, k)


# ------------------------------------------------------------------ nodes
class SDF:
    lo = np.array([-1.0, -1.0, -1.0])
    hi = np.array([1.0, 1.0, 1.0])

    def __call__(self, p):
        raise NotImplementedError

    # combinators read left to right: a | b union, a & b intersect, a - b cut
    def __or__(self, other):
        return Union([self, other])

    def __and__(self, other):
        return Intersect(self, other)

    def __sub__(self, other):
        return Subtract(self, other)

    def su(self, other, k):
        """smooth union"""
        return SmoothUnion(self, other, k)

    def ss(self, other, k):
        """smooth subtract"""
        return SmoothSubtract(self, other, k)

    def si(self, other, k):
        """smooth intersect"""
        return SmoothIntersect(self, other, k)

    def offset(self, r):
        """grow (r > 0) or shrink the surface"""
        return Offset(self, r)

    def shell(self, t):
        """hollow skin of thickness t centred on the surface"""
        return Shell(self, t)

    def move(self, x=0.0, y=0.0, z=0.0):
        return Transform(self, np.eye(3), np.array([x, y, z], dtype=np.float64))

    def place(self, rotation, origin):
        """rotation columns are the local axes in world space, origin is where local 0 lands"""
        return Transform(self, np.asarray(rotation, dtype=np.float64), np.asarray(origin, dtype=np.float64))

    def rot_x(self, deg):
        return Transform(self, rot_x(deg), np.zeros(3))

    def rot_y(self, deg):
        return Transform(self, rot_y(deg), np.zeros(3))

    def rot_z(self, deg):
        return Transform(self, rot_z(deg), np.zeros(3))

    def mirror_x(self):
        """mirrors across x = 0 and keeps both halves (build the +x side)"""
        return MirrorX(self)

    def flip_x(self):
        """moves the shape to the other side, only one copy"""
        return FlipX(self)

    def scale(self, s):
        return Scale(self, s)


class Sphere(SDF):
    def __init__(self, c, r):
        self.c = np.asarray(c, dtype=np.float64)
        self.r = float(r)
        self.lo = self.c - self.r
        self.hi = self.c + self.r

    def __call__(self, p):
        return length(p - self.c) - self.r


class Ellipsoid(SDF):
    """close to exact near the surface (iq's bound)"""

    def __init__(self, c, radii):
        self.c = np.asarray(c, dtype=np.float64)
        self.r = np.asarray(radii, dtype=np.float64)
        self.lo = self.c - self.r
        self.hi = self.c + self.r

    def __call__(self, p):
        q = p - self.c
        k0 = length(q / self.r)
        k1 = length(q / (self.r * self.r))
        return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)


class SuperEllipsoid(SDF):
    """|x/a|^n + |y/b|^n + |z/c|^n = 1, first order distance. n=2 is an ellipsoid, big n boxier"""

    def __init__(self, c, radii, n=3.0):
        self.c = np.asarray(c, dtype=np.float64)
        self.r = np.asarray(radii, dtype=np.float64)
        self.n = float(n)
        self.lo = self.c - self.r
        self.hi = self.c + self.r

    def __call__(self, p):
        q = np.abs(p - self.c) / self.r + 1e-9
        n = self.n
        s = np.sum(np.power(q, n), axis=1)
        f = np.power(s, 1.0 / n)
        # gradient of f wrt p
        g = np.power(s, 1.0 / n - 1.0)[:, None] * np.power(q, n - 1.0) / self.r
        return (f - 1.0) / np.maximum(length(g), 1e-9)


class Box(SDF):
    """rounded box, half extents h, corner radius r"""

    def __init__(self, c, h, r=0.0):
        self.c = np.asarray(c, dtype=np.float64)
        self.h = np.asarray(h, dtype=np.float64)
        self.r = float(r)
        self.lo = self.c - self.h
        self.hi = self.c + self.h

    def __call__(self, p):
        q = np.abs(p - self.c) - self.h + self.r
        return length(np.maximum(q, 0.0)) + np.minimum(np.max(q, axis=1), 0.0) - self.r


class Capsule(SDF):
    def __init__(self, a, b, r):
        self.a = np.asarray(a, dtype=np.float64)
        self.b = np.asarray(b, dtype=np.float64)
        self.r = float(r)
        self.lo = np.minimum(self.a, self.b) - self.r
        self.hi = np.maximum(self.a, self.b) + self.r

    def __call__(self, p):
        ba = self.b - self.a
        t = np.clip(((p - self.a) @ ba) / float(ba @ ba), 0.0, 1.0)
        return length(p - (self.a + np.outer(t, ba))) - self.r


class RoundCone(SDF):
    """cone with spherical caps, radius r1 at a and r2 at b (exact, iq)"""

    def __init__(self, a, b, r1, r2):
        self.a = np.asarray(a, dtype=np.float64)
        self.b = np.asarray(b, dtype=np.float64)
        self.r1 = float(r1)
        self.r2 = float(r2)
        rmax = max(self.r1, self.r2)
        self.lo = np.minimum(self.a, self.b) - rmax
        self.hi = np.maximum(self.a, self.b) + rmax

    def __call__(self, p):
        a, b, r1, r2 = self.a, self.b, self.r1, self.r2
        ba = b - a
        l2 = float(ba @ ba)
        rr = r1 - r2
        a2 = l2 - rr * rr
        il2 = 1.0 / l2
        pa = p - a
        y = pa @ ba
        z = y - l2
        q = pa * l2 - np.outer(y, ba)
        x2 = np.sum(q * q, axis=1)
        y2 = y * y * l2
        z2 = z * z * l2
        k = np.sign(rr) * rr * rr * x2
        d_mid = (np.sqrt(np.maximum(x2 * a2 * il2, 0.0)) + y * rr) * il2 - r1
        d_b = np.sqrt(x2 + z2) * il2 - r2
        d_a = np.sqrt(x2 + y2) * il2 - r1
        out = np.where(np.sign(y) * a2 * y2 < k, d_a, d_mid)
        return np.where(np.sign(z) * a2 * z2 > k, d_b, out)


class Cylinder(SDF):
    """capped cylinder from a to b with radius r and edge rounding e"""

    def __init__(self, a, b, r, e=0.0):
        self.a = np.asarray(a, dtype=np.float64)
        self.b = np.asarray(b, dtype=np.float64)
        self.r = float(r)
        self.e = float(e)
        self.lo = np.minimum(self.a, self.b) - self.r
        self.hi = np.maximum(self.a, self.b) + self.r

    def __call__(self, p):
        ba = self.b - self.a
        L = float(np.linalg.norm(ba))
        u = ba / L
        pa = p - self.a
        y = pa @ u
        radial = length(pa - np.outer(y, u))
        dx = radial - (self.r - self.e)
        dy = np.abs(y - L * 0.5) - (L * 0.5 - self.e)
        return np.minimum(np.maximum(dx, dy), 0.0) + length(np.stack([np.maximum(dx, 0), np.maximum(dy, 0)], 1)) - self.e


class Torus(SDF):
    """ring in the plane through c with normal n, major radius R, tube radius r"""

    def __init__(self, c, n, R, r):
        self.c = np.asarray(c, dtype=np.float64)
        self.n = normalize(n)
        self.R = float(R)
        self.r = float(r)
        pad = self.R + self.r
        self.lo = self.c - pad
        self.hi = self.c + pad

    def __call__(self, p):
        q = p - self.c
        h = q @ self.n
        radial = length(q - np.outer(h, self.n))
        return np.sqrt((radial - self.R) ** 2 + h * h) - self.r


class HalfSpace(SDF):
    """everything on the side of the plane the normal points away from (n.p < d inside)"""

    def __init__(self, n, d, lo=(-3, -3, -3), hi=(3, 3, 3)):
        self.n = normalize(n)
        self.d = float(d)
        self.lo = np.asarray(lo, dtype=np.float64)
        self.hi = np.asarray(hi, dtype=np.float64)

    def __call__(self, p):
        return p @ self.n - self.d


class Extrusion(SDF):
    """a 2d polygon in the local xy plane extruded +-h along z, rounded by r"""

    def __init__(self, verts, h, r=0.0):
        self.v = np.asarray(verts, dtype=np.float64)
        self.h = float(h)
        self.r = float(r)
        self.lo = np.array([self.v[:, 0].min(), self.v[:, 1].min(), -self.h])
        self.hi = np.array([self.v[:, 0].max(), self.v[:, 1].max(), self.h])

    def __call__(self, p):
        d2 = polygon2(p[:, 0], p[:, 1], self.v) + self.r
        dz = np.abs(p[:, 2]) - self.h + self.r
        wx = np.maximum(d2, 0.0)
        wz = np.maximum(dz, 0.0)
        return np.minimum(np.maximum(d2, dz), 0.0) + np.sqrt(wx * wx + wz * wz) - self.r


def polygon2(px, py, verts):
    """exact signed distance to a simple 2d polygon (negative inside)"""
    v = verts
    n = len(v)
    d = (px - v[0, 0]) ** 2 + (py - v[0, 1]) ** 2
    s = np.ones_like(px)
    j = n - 1
    for i in range(n):
        ex, ey = v[j, 0] - v[i, 0], v[j, 1] - v[i, 1]
        wx, wy = px - v[i, 0], py - v[i, 1]
        t = np.clip((wx * ex + wy * ey) / (ex * ex + ey * ey), 0.0, 1.0)
        bx, by = wx - ex * t, wy - ey * t
        d = np.minimum(d, bx * bx + by * by)
        c1 = py >= v[i, 1]
        c2 = py < v[j, 1]
        c3 = ex * wy > ey * wx
        flip = (c1 & c2 & c3) | (~c1 & ~c2 & ~c3)
        s = np.where(flip, -s, s)
        j = i
    return s * np.sqrt(d)


class Displace(SDF):
    """adds a small pattern to a surface (ribs, quilting); keep amplitudes to a few mm"""

    def __init__(self, a, fn, amp):
        self.a, self.fn, self.amp = a, fn, float(amp)
        self.lo = a.lo - abs(self.amp)
        self.hi = a.hi + abs(self.amp)

    def __call__(self, p):
        return self.a(p) + self.amp * self.fn(p)


class Fn(SDF):
    """wraps a plain function with explicit bounds"""

    def __init__(self, fn, lo, hi):
        self.fn = fn
        self.lo = np.asarray(lo, dtype=np.float64)
        self.hi = np.asarray(hi, dtype=np.float64)

    def __call__(self, p):
        return self.fn(p)


# ------------------------------------------------------------------ operators
class Union(SDF):
    def __init__(self, items):
        flat = []
        for it in items:
            flat.extend(it.items if isinstance(it, Union) else [it])
        self.items = flat
        self.lo = np.min([i.lo for i in flat], axis=0)
        self.hi = np.max([i.hi for i in flat], axis=0)

    def __call__(self, p):
        d = self.items[0](p)
        for it in self.items[1:]:
            d = np.minimum(d, it(p))
        return d


def union(*items):
    return Union(list(items))


class SmoothUnion(SDF):
    def __init__(self, a, b, k):
        self.a, self.b, self.k = a, b, float(k)
        self.lo = np.minimum(a.lo, b.lo) - self.k
        self.hi = np.maximum(a.hi, b.hi) + self.k

    def __call__(self, p):
        return smin(self.a(p), self.b(p), self.k)


class Intersect(SDF):
    def __init__(self, a, b):
        self.a, self.b = a, b
        self.lo = np.maximum(a.lo, b.lo)
        self.hi = np.minimum(a.hi, b.hi)

    def __call__(self, p):
        return np.maximum(self.a(p), self.b(p))


class SmoothIntersect(SDF):
    def __init__(self, a, b, k):
        self.a, self.b, self.k = a, b, float(k)
        self.lo = np.maximum(a.lo, b.lo)
        self.hi = np.minimum(a.hi, b.hi)

    def __call__(self, p):
        return smax(self.a(p), self.b(p), self.k)


class Subtract(SDF):
    def __init__(self, a, b):
        self.a, self.b = a, b
        self.lo, self.hi = a.lo, a.hi

    def __call__(self, p):
        return np.maximum(self.a(p), -self.b(p))


class SmoothSubtract(SDF):
    def __init__(self, a, b, k):
        self.a, self.b, self.k = a, b, float(k)
        self.lo, self.hi = a.lo, a.hi

    def __call__(self, p):
        return smax(self.a(p), -self.b(p), self.k)


class Offset(SDF):
    def __init__(self, a, r):
        self.a, self.r = a, float(r)
        self.lo = a.lo - max(self.r, 0.0)
        self.hi = a.hi + max(self.r, 0.0)

    def __call__(self, p):
        return self.a(p) - self.r


class Shell(SDF):
    def __init__(self, a, t):
        self.a, self.t = a, float(t)
        self.lo = a.lo - self.t
        self.hi = a.hi + self.t

    def __call__(self, p):
        return np.abs(self.a(p)) - self.t * 0.5


class Transform(SDF):
    """rigid transform: child authored in local space, R columns = local axes in world"""

    def __init__(self, a, R, t):
        self.a = a
        self.R = np.asarray(R, dtype=np.float64)
        self.t = np.asarray(t, dtype=np.float64)
        corners = np.array([[x, y, z] for x in (a.lo[0], a.hi[0]) for y in (a.lo[1], a.hi[1]) for z in (a.lo[2], a.hi[2])])
        world = corners @ self.R.T + self.t
        self.lo = world.min(axis=0)
        self.hi = world.max(axis=0)

    def __call__(self, p):
        return self.a((p - self.t) @ self.R)


class Scale(SDF):
    def __init__(self, a, s):
        self.a, self.s = a, float(s)
        self.lo = a.lo * self.s
        self.hi = a.hi * self.s

    def __call__(self, p):
        return self.a(p / self.s) * self.s


class MirrorX(SDF):
    def __init__(self, a):
        self.a = a
        m = max(abs(a.lo[0]), abs(a.hi[0]))
        self.lo = np.array([-m, a.lo[1], a.lo[2]])
        self.hi = np.array([m, a.hi[1], a.hi[2]])

    def __call__(self, p):
        q = p.copy()
        q[:, 0] = np.abs(q[:, 0])
        return self.a(q)


class FlipX(SDF):
    def __init__(self, a):
        self.a = a
        self.lo = np.array([-a.hi[0], a.lo[1], a.lo[2]])
        self.hi = np.array([-a.lo[0], a.hi[1], a.hi[2]])

    def __call__(self, p):
        q = p.copy()
        q[:, 0] = -q[:, 0]
        return self.a(q)


# ------------------------------------------------------------------ frames
def rot_x(deg):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]], dtype=np.float64)


def rot_y(deg):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]], dtype=np.float64)


def rot_z(deg):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]], dtype=np.float64)


def frame_from(x=None, y=None, z=None):
    """right handed rotation (columns) from two given axes; the first given wins exactly"""
    given = [(i, normalize(v)) for i, v in enumerate((x, y, z)) if v is not None]
    if len(given) < 2:
        raise ValueError("need two axes")
    (i0, a0), (i1, a1) = given[0], given[1]
    a1 = normalize(a1 - a0 * (a1 @ a0))
    axes = [None, None, None]
    axes[i0], axes[i1] = a0, a1
    k = 3 - i0 - i1
    # x = y cross z, y = z cross x, z = x cross y
    if k == 0:
        axes[0] = np.cross(axes[1], axes[2])
    elif k == 1:
        axes[1] = np.cross(axes[2], axes[0])
    else:
        axes[2] = np.cross(axes[0], axes[1])
    return np.stack(axes, axis=1)


# ------------------------------------------------------------------ queries
def evaluate(fn, p, chunk=400000):
    out = np.empty(len(p), dtype=np.float64)
    for i in range(0, len(p), chunk):
        out[i:i + chunk] = fn(p[i:i + chunk])
    return out


def gradient(fn, p, eps=5e-4):
    g = np.zeros_like(p)
    for i in range(3):
        o = np.zeros(3)
        o[i] = eps
        g[:, i] = (evaluate(fn, p + o) - evaluate(fn, p - o)) / (2.0 * eps)
    return g


def normals(fn, p, eps=5e-4):
    g = gradient(fn, p, eps)
    return g / np.maximum(length(g), 1e-12)[:, None]


def project(fn, p, iterations=4, eps=5e-4):
    """newton steps onto the zero level set"""
    q = p.copy()
    for _ in range(iterations):
        d = evaluate(fn, q)
        g = gradient(fn, q, eps)
        gl2 = np.maximum(np.sum(g * g, axis=1), 1e-12)
        step = (d / gl2)[:, None] * g
        # never jump further than a few mm, decimated verts start close
        n = length(step)
        step *= np.minimum(1.0, 0.006 / np.maximum(n, 1e-12))[:, None]
        q = q - step
    return q


def ambient_occlusion(fn, p, n, steps=5, delta=0.012, falloff=0.55):
    """classic sdf ao: how much closer than expected the scene is along the normal"""
    occ = np.zeros(len(p))
    w = 1.0
    for i in range(1, steps + 1):
        h = delta * i
        d = evaluate(fn, p + n * h)
        occ += w * np.maximum(h - d, 0.0) / h
        w *= falloff
    total = sum(falloff ** i for i in range(steps))
    return np.clip(1.0 - occ / total * 1.6, 0.0, 1.0)


def convexity(fn, p, n, depth=0.0035):
    """0 on flat or concave skin, towards 1 on sharp outside edges (paint chips there)"""
    d = evaluate(fn, p - n * depth)
    return np.clip((d + depth) / depth, 0.0, 1.0)


def raycast(fn, origin, direction, max_dist=1.0, eps=2e-5):
    """sphere traces one ray, returns the surface point (or None)"""
    o = np.asarray(origin, dtype=np.float64)
    d = normalize(direction)
    t = 0.0
    for _ in range(256):
        p = o + d * t
        dist = float(fn(p[None, :])[0])
        if abs(dist) < eps:
            return p
        t += max(dist * 0.9, eps) if dist > 0 else dist * 0.9
        if t > max_dist or t < -max_dist:
            return None
    return o + d * t


def keep_side(point, normal):
    """region on the side `normal` points to, through `point` (negative inside)"""
    n = normalize(normal)
    return HalfSpace(-n, -float(np.dot(np.asarray(point, dtype=np.float64), n)))


def rounded_shell(fn, t, r=0.002):
    """skin of total thickness t with its cut edges rounded by r"""
    return fn.shell(max(t - 2 * r, 1e-4)).offset(r)


# ------------------------------------------------------------------ meshing
def mesh(fn, voxel, pad=None, lo=None, hi=None, adaptivity=0.0):
    """dense grid + openvdb level set -> (verts (N,3), faces list), outward winding"""
    import openvdb

    pad = voxel * 4 if pad is None else pad
    lo = np.asarray(fn.lo if lo is None else lo, dtype=np.float64) - pad
    hi = np.asarray(fn.hi if hi is None else hi, dtype=np.float64) + pad
    dims = np.ceil((hi - lo) / voxel).astype(int) + 1
    if np.prod(dims) > 60_000_000:
        raise ValueError(f"grid too big {dims} for voxel {voxel}")
    xs = lo[0] + np.arange(dims[0]) * voxel
    ys = lo[1] + np.arange(dims[1]) * voxel
    zs = lo[2] + np.arange(dims[2]) * voxel
    grid = np.empty(tuple(dims), dtype=np.float32)
    yy, zz = np.meshgrid(ys, zs, indexing="ij")
    plane = np.stack([np.zeros_like(yy).ravel(), yy.ravel(), zz.ravel()], axis=1)
    for i, x in enumerate(xs):
        plane[:, 0] = x
        grid[i] = fn(plane).reshape(dims[1], dims[2]).astype(np.float32)
    band = 4.0 * voxel
    grid = np.clip(grid, -band, band) / voxel
    vdb = openvdb.FloatGrid(background=4.0)
    vdb.copyFromArray(grid, ijk=(0, 0, 0), tolerance=0.0)
    points, tris, quads = vdb.convertToPolygons(isovalue=0.0, adaptivity=adaptivity)
    verts = lo + np.asarray(points, dtype=np.float64) * voxel
    tris = np.asarray(tris, dtype=np.int64).reshape(-1, 3)
    quads = np.asarray(quads, dtype=np.int64).reshape(-1, 4)
    faces = np.concatenate([tris, quads[:, [0, 1, 2]], quads[:, [0, 2, 3]]], axis=0)
    if len(faces) == 0:
        return verts, faces
    # outward winding: flip if the signed volume is negative
    a, b, c = verts[faces[:, 0]], verts[faces[:, 1]], verts[faces[:, 2]]
    vol = float(np.sum(np.einsum("ij,ij->i", a, np.cross(b, c))))
    if vol < 0.0:
        faces = faces[:, ::-1].copy()
    return verts, faces
