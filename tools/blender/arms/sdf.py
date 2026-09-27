"""small numpy signed distance toolkit plus an openvdb mesher.

everything works on (N, 3) float64 point arrays so the same functions build
the dense grid for meshing and answer point queries later (projecting
decimated vertices back onto the surface, texel normals, skin weights).
"""

import numpy as np


def length(v, axis=-1):
    return np.sqrt(np.sum(v * v, axis=axis))


def smin(a, b, k):
    """polynomial smooth min, k is the blend width"""
    if k <= 0.0:
        return np.minimum(a, b)
    h = np.maximum(k - np.abs(a - b), 0.0) / k
    return np.minimum(a, b) - h * h * h * k * (1.0 / 6.0)


def smax(a, b, k):
    return -smin(-a, -b, k)


def sd_sphere(p, c, r):
    return length(p - np.asarray(c)) - r


def sd_round_cone(p, a, b, r1, r2):
    """exact distance to a cone with spherical caps (inigo quilez formulation)"""
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    ba = b - a
    l2 = float(np.dot(ba, ba))
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
    out = np.where(np.sign(z) * a2 * z2 > k, d_b, out)
    return out


def segment_param(p, a, b):
    """clamped 0..1 parameter of the closest point on segment ab"""
    a = np.asarray(a, dtype=np.float64)
    ba = np.asarray(b, dtype=np.float64) - a
    return np.clip(((p - a) @ ba) / float(np.dot(ba, ba)), 0.0, 1.0)


def dist_segment(p, a, b):
    t = segment_param(p, a, b)
    a = np.asarray(a, dtype=np.float64)
    ba = np.asarray(b, dtype=np.float64) - a
    return length(p - (a + np.outer(t, ba)))


def sd_ellipsoid(p, c, radii, axes=None):
    """approximate (bound-ish) ellipsoid distance, axes rows are the local x,y,z"""
    q = p - np.asarray(c, dtype=np.float64)
    if axes is not None:
        q = q @ np.asarray(axes, dtype=np.float64).T
    r = np.asarray(radii, dtype=np.float64)
    k0 = length(q / r)
    k1 = length(q / (r * r))
    return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)


def sd_polygon2(px, py, verts):
    """exact signed distance to a simple 2d polygon (negative inside)"""
    v = np.asarray(verts, dtype=np.float64)
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


def op_extrude_round(d2, dz, radius):
    """combine a 2d distance and a slab distance into a rounded solid"""
    wx = np.maximum(d2, 0.0)
    wz = np.maximum(dz, 0.0)
    return np.minimum(np.maximum(d2, dz), 0.0) + np.sqrt(wx * wx + wz * wz) - radius


def superellipse_distance(x, z, a, b, n):
    """first order distance to |x/a|^n + |z/b|^n = 1 (a, b, n may be arrays)"""
    ax = np.abs(x) / a + 1e-12
    az = np.abs(z) / b + 1e-12
    q = np.power(ax, n) + np.power(az, n)
    g = np.power(q, 1.0 / n) - 1.0
    qn = np.power(q, 1.0 / n - 1.0)
    gx = qn * np.power(ax, n - 1.0) / a
    gz = qn * np.power(az, n - 1.0) / b
    return g / np.maximum(np.sqrt(gx * gx + gz * gz), 1e-9)


def gradient(fn, p, eps):
    """central difference gradient of a point sdf"""
    g = np.zeros_like(p)
    for i in range(3):
        o = np.zeros(3)
        o[i] = eps
        g[:, i] = (fn(p + o) - fn(p - o)) / (2.0 * eps)
    return g


def project_to_surface(fn, p, eps, iterations=3):
    """newton steps onto the zero level set"""
    q = p.copy()
    for _ in range(iterations):
        d = fn(q)
        g = gradient(fn, q, eps)
        gl2 = np.maximum(np.sum(g * g, axis=1), 1e-12)
        q = q - (d / gl2)[:, None] * g
    return q


def evaluate_chunked(fn, p, chunk=262144):
    out = np.empty(len(p), dtype=np.float64)
    for i in range(0, len(p), chunk):
        out[i:i + chunk] = fn(p[i:i + chunk])
    return out


def mesh_sdf(fn, bmin, bmax, voxel, adaptivity=0.0):
    """samples fn on a dense grid and meshes the zero level set with openvdb.

    returns (verts (N,3), faces list of tuples) in the same units as bmin/bmax,
    faces wound so normals point out of the solid (negative inside).
    """
    import openvdb

    bmin = np.asarray(bmin, dtype=np.float64)
    bmax = np.asarray(bmax, dtype=np.float64)
    dims = np.ceil((bmax - bmin) / voxel).astype(int) + 1
    xs = bmin[0] + np.arange(dims[0]) * voxel
    ys = bmin[1] + np.arange(dims[1]) * voxel
    zs = bmin[2] + np.arange(dims[2]) * voxel
    grid = np.empty(tuple(dims), dtype=np.float32)
    yy, zz = np.meshgrid(ys, zs, indexing="ij")
    plane = np.stack([np.zeros_like(yy).ravel(), yy.ravel(), zz.ravel()], axis=1)
    for i, x in enumerate(xs):
        plane[:, 0] = x
        grid[i] = fn(plane).reshape(dims[1], dims[2]).astype(np.float32)
    # clamp into a narrow band so vdb keeps a clean level set
    band = 4.0 * voxel
    grid = np.clip(grid, -band, band) / voxel
    vdb = openvdb.FloatGrid(background=4.0)
    vdb.copyFromArray(grid, ijk=(0, 0, 0), tolerance=0.0)
    points, tris, quads = vdb.convertToPolygons(isovalue=0.0, adaptivity=adaptivity)
    verts = bmin + np.asarray(points, dtype=np.float64) * voxel
    faces = [tuple(int(i) for i in f) for f in quads] + [tuple(int(i) for i in f) for f in tris]
    faces = _orient_outward(verts, faces)
    return verts, faces


def _orient_outward(verts, faces):
    """flip every face if the signed volume comes out negative"""
    vol = 0.0
    for f in faces:
        a = verts[f[0]]
        for k in range(1, len(f) - 1):
            vol += np.dot(a, np.cross(verts[f[k]], verts[f[k + 1]]))
    if vol < 0.0:
        faces = [tuple(reversed(f)) for f in faces]
    return faces
