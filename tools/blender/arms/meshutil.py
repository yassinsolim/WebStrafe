"""tiny mesh builder: numpy-free list geometry with per face materials and uvs,
converted to a blender mesh at the end. used for the watch parts."""

import math

import bpy
import numpy as np


class MeshBuilder:
    def __init__(self):
        self.verts = []
        self.faces = []
        self.mats = []
        self.uvs = []
        self.smooth = []

    def v(self, co):
        self.verts.append(tuple(float(c) for c in co))
        return len(self.verts) - 1

    def add_verts(self, cos):
        start = len(self.verts)
        for co in cos:
            self.verts.append(tuple(float(c) for c in co))
        return list(range(start, len(self.verts)))

    def f(self, idx, mat=0, uv=None, smooth=True):
        idx = tuple(int(i) for i in idx)
        self.faces.append(idx)
        self.mats.append(mat)
        if uv is None:
            uv = [(self.verts[i][0], self.verts[i][1]) for i in idx]
        self.uvs.append([tuple(u) for u in uv])
        self.smooth.append(smooth)

    def tri_count(self):
        return sum(len(f) - 2 for f in self.faces)

    def transform(self, fn):
        self.verts = [tuple(fn(np.array(v))) for v in self.verts]

    def merge(self, other):
        off = len(self.verts)
        self.verts.extend(other.verts)
        for f, m, uv, sm in zip(other.faces, other.mats, other.uvs, other.smooth):
            self.faces.append(tuple(i + off for i in f))
            self.mats.append(m)
            self.uvs.append(uv)
            self.smooth.append(sm)

    def to_object(self, name, materials, scale=1.0, collection=None):
        me = bpy.data.meshes.new(name)
        verts = [(x * scale, y * scale, z * scale) for (x, y, z) in self.verts]
        me.from_pydata(verts, [], self.faces)
        uv_layer = me.uv_layers.new(name="UVMap")
        loop = 0
        for poly, uvs, m, sm in zip(me.polygons, self.uvs, self.mats, self.smooth):
            poly.material_index = m
            poly.use_smooth = sm
            for k in range(poly.loop_total):
                uv_layer.data[poly.loop_start + k].uv = uvs[k]
            loop += poly.loop_total
        for mat in materials:
            me.materials.append(mat)
        me.validate(clean_customdata=False)
        me.update()
        obj = bpy.data.objects.new(name, me)
        (collection or bpy.context.scene.collection).objects.link(obj)
        return obj


def ring(builder, r, z, segments, start=0.0, clockwise_from_y=False):
    """adds a ring of verts, returns indices"""
    idx = []
    for i in range(segments):
        a = start + 2.0 * math.pi * i / segments
        if clockwise_from_y:
            x, y = r * math.sin(a), r * math.cos(a)
        else:
            x, y = r * math.cos(a), r * math.sin(a)
        idx.append(builder.v((x, y, z)))
    return idx


def bridge(builder, ring_a, ring_b, mat=0, uv_fn=None, smooth=True, flip=False):
    """quads between two rings of equal length (closed)"""
    n = len(ring_a)
    for i in range(n):
        j = (i + 1) % n
        face = (ring_a[i], ring_a[j], ring_b[j], ring_b[i])
        if flip:
            face = tuple(reversed(face))
        builder.f(face, mat, uv_fn(face) if uv_fn else None, smooth)


def fan(builder, ring_idx, centre_idx, mat=0, flip=False, smooth=True):
    n = len(ring_idx)
    for i in range(n):
        j = (i + 1) % n
        face = (ring_idx[i], ring_idx[j], centre_idx)
        if flip:
            face = tuple(reversed(face))
        builder.f(face, mat, None, smooth)


def lathe(builder, profile, segments, mat=0, smooth=True, pole_start=False, pole_end=False, mats=None):
    """revolve a (r, z) profile around z. profile runs bottom to top on the
    outside so faces point outwards. poles close the ends at r = 0."""
    rings = []
    for k, (r, z) in enumerate(profile):
        if r <= 1e-9:
            rings.append([builder.v((0.0, 0.0, z))])
        else:
            rings.append(ring(builder, r, z, segments))
    for k in range(len(rings) - 1):
        a, b = rings[k], rings[k + 1]
        m = mats[k] if mats is not None else mat
        if len(a) == 1:
            for i in range(segments):
                j = (i + 1) % segments
                builder.f((a[0], b[j], b[i]), m, None, smooth)
        elif len(b) == 1:
            for i in range(segments):
                j = (i + 1) % segments
                builder.f((a[i], a[j], b[0]), m, None, smooth)
        else:
            for i in range(segments):
                j = (i + 1) % segments
                builder.f((a[i], a[j], b[j], b[i]), m, None, smooth)
    return rings


def prism(builder, outline, z0, z1, mat_side=0, mat_top=0, inset=None, mat_inset=None,
          inset_depth=0.0, smooth_side=False, bottom=False):
    """extrudes a ccw 2d outline from z0 to z1. with inset, the top gets a
    ring face down to an inner outline (same vertex count) that is capped
    with mat_inset slightly below the rim, like a lume fill in a steel frame."""
    n = len(outline)
    lo = builder.add_verts([(x, y, z0) for (x, y) in outline])
    hi = builder.add_verts([(x, y, z1) for (x, y) in outline])
    for i in range(n):
        j = (i + 1) % n
        builder.f((lo[i], lo[j], hi[j], hi[i]), mat_side, None, smooth_side)
    if inset is not None:
        inner = builder.add_verts([(x, y, z1 - inset_depth) for (x, y) in inset])
        for i in range(n):
            j = (i + 1) % n
            builder.f((hi[i], hi[j], inner[j], inner[i]), mat_top, None, False)
        builder.f(tuple(inner), mat_inset if mat_inset is not None else mat_top, None, False)
    else:
        builder.f(tuple(hi), mat_top, None, False)
    if bottom:
        builder.f(tuple(reversed(lo)), mat_side, None, False)
    return lo, hi


def circle2(r, n, cx=0.0, cy=0.0, start=0.0):
    return [(cx + r * math.cos(start + 2 * math.pi * i / n), cy + r * math.sin(start + 2 * math.pi * i / n))
            for i in range(n)]


def offset_polygon(poly, d):
    """moves each vertex of a ccw polygon inwards by d along the angle bisector"""
    n = len(poly)
    out = []
    for i in range(n):
        p0 = np.array(poly[i - 1])
        p1 = np.array(poly[i])
        p2 = np.array(poly[(i + 1) % n])
        e1 = p1 - p0
        e2 = p2 - p1
        n1 = np.array([-e1[1], e1[0]]) / (np.linalg.norm(e1) + 1e-12)
        n2 = np.array([-e2[1], e2[0]]) / (np.linalg.norm(e2) + 1e-12)
        bis = n1 + n2
        bl = np.linalg.norm(bis)
        if bl < 1e-9:
            bis = n1
            k = d
        else:
            bis /= bl
            k = d / max(np.dot(bis, n1), 0.2)
        out.append(tuple(p1 + bis * k))
    return out


def sweep(builder, path, frames, section, mat=0, closed_path=False, cap_ends=True, smooth=True):
    """sweeps a closed 2d section (list of (a, b)) along path points with
    frames (a_axis, b_axis) per point. returns ring indices."""
    rings = []
    for p, (ax, bx) in zip(path, frames):
        rings.append(builder.add_verts([np.asarray(p) + a * np.asarray(ax) + b * np.asarray(bx) for (a, b) in section]))
    m = len(section)
    count = len(rings) if closed_path else len(rings) - 1
    for k in range(count):
        ra = rings[k]
        rb = rings[(k + 1) % len(rings)]
        for i in range(m):
            j = (i + 1) % m
            builder.f((ra[i], ra[j], rb[j], rb[i]), mat, None, smooth)
    if cap_ends and not closed_path:
        builder.f(tuple(reversed(rings[0])), mat, None, False)
        builder.f(tuple(rings[-1]), mat, None, False)
    return rings
