# vendored from the asset research prototype (~/Assets/webstrafe/prototype/scripts/armorkit.py,
# written for webstrafe on 2026-09-27); shared plate kit for the armor sets.
# armor kit helpers for the webstrafe prototype.
# plates are clean outline patches projected onto smoothed, inflated copies of the
# body ("shells"), then thickened and bevelled. outlines are resampled by arc length
# and filled with concentric rings, so the rim follows the outline exactly (no jagged
# marching-cubes edges).
import math

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree


# ---------------------------------------------------------------- basics

def link(ob, coll_name="armor"):
    coll = bpy.data.collections.get(coll_name)
    if coll is None:
        coll = bpy.data.collections.new(coll_name)
        bpy.context.scene.collection.children.link(coll)
    coll.objects.link(ob)
    return ob


def mesh_object(name, verts, faces, coll="armor"):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.validate()
    me.update()
    ob = bpy.data.objects.new(name, me)
    return link(ob, coll)


def apply_modifiers(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    if old.users == 0:
        bpy.data.meshes.remove(old)
    return ob


def shade(ob, angle_deg=35.0):
    me = ob.data
    for p in me.polygons:
        p.use_smooth = True
    try:
        me.set_sharp_from_angle(angle=math.radians(angle_deg))
    except AttributeError:
        pass
    return ob


def bvh_of(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.transform(ob.matrix_world)
    bm.normal_update()
    tree = BVHTree.FromBMesh(bm)
    ev.to_mesh_clear()
    return tree, bm


# ---------------------------------------------------------------- 2d outlines

def fillet(poly, radius, seg=4):
    """round the corners of a closed 2d polygon. radius can be a float or a list."""
    out = []
    n = len(poly)
    for i in range(n):
        r = radius[i] if isinstance(radius, (list, tuple)) else radius
        p0, p1, p2 = Vector(poly[i - 1]), Vector(poly[i]), Vector(poly[(i + 1) % n])
        a, b = (p0 - p1), (p2 - p1)
        la, lb = a.length, b.length
        if r <= 0 or la < 1e-6 or lb < 1e-6:
            out.append(p1)
            continue
        a.normalize(); b.normalize()
        ang = math.acos(max(-1.0, min(1.0, a.dot(b))))
        if ang < 1e-3 or ang > math.pi - 1e-3:
            out.append(p1)
            continue
        d = min(r / math.tan(ang / 2), la * 0.45, lb * 0.45)
        s, e = p1 + a * d, p1 + b * d
        for k in range(seg + 1):
            t = k / seg
            # quadratic bezier through the corner
            q = (1 - t) ** 2 * s + 2 * (1 - t) * t * p1 + t ** 2 * e
            out.append(q)
    return [Vector(p) for p in out]


def resample(poly, n):
    pts = [Vector(p) for p in poly]
    segs = []
    total = 0.0
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        L = (b - a).length
        segs.append((a, b, L))
        total += L
    out = []
    step = total / n
    acc = 0.0
    si = 0
    a, b, L = segs[0]
    pos = 0.0
    for k in range(n):
        target = k * step
        while acc + L < target and si < len(segs) - 1:
            acc += L
            si += 1
            a, b, L = segs[si]
        t = 0.0 if L < 1e-9 else (target - acc) / L
        out.append(a.lerp(b, t))
    return out


def mirror_x(half):
    """half outline listed from top centre, down the +x side to bottom centre. returns the full loop."""
    full = [Vector(p) for p in half]
    back = [Vector((-p[0], p[1])) for p in reversed(half[1:-1])]
    return full + back


def polygon_centroid(poly):
    c = Vector((0.0, 0.0))
    for p in poly:
        c += Vector(p)
    return c / len(poly)


def offset_poly(poly, amount):
    """shrink (negative) or grow a polygon towards/away from its centroid."""
    c = polygon_centroid(poly)
    out = []
    for p in poly:
        d = Vector(p) - c
        L = d.length
        out.append(c + d * max(0.05, (L + amount) / max(L, 1e-6)))
    return out


def ring_topology(n, rings):
    """concentric rings (outer first) plus a centre vertex. returns faces for vertex order
    [ring0..ring{rings-1}, centre]."""
    faces = []
    for r in range(rings - 1):
        for i in range(n):
            a = r * n + i
            b = r * n + (i + 1) % n
            c = (r + 1) * n + (i + 1) % n
            d = (r + 1) * n + i
            faces.append((a, b, c, d))
    centre = rings * n
    last = (rings - 1) * n
    for i in range(n):
        faces.append((last + i, last + (i + 1) % n, centre))
    return faces


def ring_uvs(outline, rings, centre=None, ease=1.6):
    c = Vector(centre) if centre is not None else polygon_centroid(outline)
    uvs = []
    for r in range(rings):
        # rings bunch towards the rim so the bevel has support
        t = (r / rings) ** ease
        for p in outline:
            uvs.append(Vector(p).lerp(c, t))
    uvs.append(c)
    return uvs


# ---------------------------------------------------------------- projections

class Planar:
    """(u, v) in metres on a plane; rays cast along `cast` onto the target."""

    def __init__(self, origin, u_axis, v_axis, cast):
        self.o = Vector(origin)
        self.u = Vector(u_axis).normalized()
        self.v = Vector(v_axis).normalized()
        self.d = Vector(cast).normalized()

    def ray(self, uv):
        p = self.o + self.u * uv[0] + self.v * uv[1]
        return p - self.d * 1.5, self.d

    def inward(self, p):
        return self.d.copy()


class Cylinder:
    """metric (s, h) around the axis a->b: s is arc length at nominal radius r0 (s=0 along
    `ref`, positive towards ax x ref), h is metres from a along the axis."""

    def __init__(self, a, b, ref, r0=0.08, far=0.6):
        self.a, self.b = Vector(a), Vector(b)
        ax = (self.b - self.a).normalized()
        r = Vector(ref)
        r = (r - ax * r.dot(ax)).normalized()
        self.ax, self.e1, self.e2 = ax, r, ax.cross(r).normalized()
        self.r0, self.far = r0, far
        self.length = (self.b - self.a).length

    def dir(self, s):
        ang = s / self.r0
        return self.e1 * math.cos(ang) + self.e2 * math.sin(ang)

    def ray(self, uv):
        p = self.a + self.ax * uv[1]
        out = self.dir(uv[0])
        return p + out * self.far, -out

    def inward(self, p):
        q = Vector(p) - self.a
        foot = self.a + self.ax * q.dot(self.ax)
        return (foot - Vector(p)).normalized()


class Sphere:
    """metric (s, e) on a sphere of nominal radius r0 around centre: s along azimuth
    (0 = `front`, positive towards front x up), e along elevation."""

    def __init__(self, centre, front, up, r0=0.1, far=0.6):
        self.c = Vector(centre)
        self.f = Vector(front).normalized()
        up = Vector(up)
        self.up = (up - self.f * up.dot(self.f)).normalized()
        self.side = self.f.cross(self.up).normalized()
        self.r0, self.far = r0, far

    def ray(self, uv):
        az, el = uv[0] / self.r0, uv[1] / self.r0
        d = (self.f * math.cos(az) + self.side * math.sin(az)) * math.cos(el) + self.up * math.sin(el)
        return self.c + d * self.far, -d

    def inward(self, p):
        return (self.c - Vector(p)).normalized()


# ---------------------------------------------------------------- targets (armor forms)

def _hull(points):
    pts = sorted(set((round(p[0], 6), round(p[1], 6)) for p in points))
    if len(pts) < 3:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def _ray_poly(poly, ang):
    """distance from origin along angle to a convex polygon around the origin."""
    d = (math.cos(ang), math.sin(ang))
    best = None
    n = len(poly)
    for i in range(n):
        p, q = poly[i], poly[(i + 1) % n]
        ex, ey = q[0] - p[0], q[1] - p[1]
        den = d[0] * ey - d[1] * ex
        if abs(den) < 1e-12:
            continue
        t = (p[0] * ey - p[1] * ex) / den
        u = (p[0] * d[1] - p[1] * d[0]) / den
        if t > 0 and -1e-6 <= u <= 1 + 1e-6:
            best = t if best is None else min(best, t)
    return best


def mandrel(name, tree, a, b, ref, *, t0=0.0, t1=1.0, rings=14, seg=40, offset=0.012,
            hull=True, smooth_rings=2, min_r=0.02, max_r=0.8, scale=(1.0, 1.0), coll="forms"):
    """convex, smoothed armor form around a body part. samples the body radially from the
    axis a->b, takes the convex hull of each slice, smooths along the axis and adds offset.
    returns (object, bvh). the form is guaranteed to sit outside the sampled body."""
    a, b = Vector(a), Vector(b)
    ax = (b - a).normalized()
    r = Vector(ref)
    e1 = (r - ax * r.dot(ax)).normalized()
    e2 = ax.cross(e1).normalized()
    L = (b - a).length
    angs = [2 * math.pi * k / seg for k in range(seg)]
    table = []
    for i in range(rings):
        t = t0 + (t1 - t0) * i / (rings - 1)
        c = a + ax * (L * t)
        rs = []
        for ang in angs:
            d = e1 * math.cos(ang) + e2 * math.sin(ang)
            hit = tree.ray_cast(c, d, max_r)
            rs.append(min((hit[0] - c).length, max_r) if hit[0] is not None else None)
        valid = [x for x in rs if x is not None] or [min_r]
        rs = [x if x is not None else (max_r if max_r < 0.8 else max(valid)) for x in rs]
        if hull:
            poly = _hull([(x * math.cos(g), x * math.sin(g)) for x, g in zip(rs, angs)])
            rs = [(_ray_poly(poly, g) or x) for x, g in zip(rs, angs)]
        rs = [max(x, min_r) for x in rs]
        table.append((c, rs))
    # smooth radii along the axis (never below the sampled radius)
    for _ in range(smooth_rings):
        new = []
        for i, (c, rs) in enumerate(table):
            lo = table[max(0, i - 1)][1]
            hi = table[min(len(table) - 1, i + 1)][1]
            new.append((c, [max(x, (l + 2 * x + h) / 4) for x, l, h in zip(rs, lo, hi)]))
        table = new
    verts, faces = [], []
    for c, rs in table:
        for x, g in zip(rs, angs):
            d = e1 * math.cos(g) * scale[0] + e2 * math.sin(g) * scale[1]
            verts.append(c + d * (x + offset))
    for i in range(rings - 1):
        for k in range(seg):
            p = i * seg + k
            q = i * seg + (k + 1) % seg
            faces.append((p, q, q + seg, p + seg))
    ob = mesh_object(name, verts, faces, coll)
    ob.hide_render = True
    tree2, _ = bvh_of(ob)
    return ob, tree2


def ellipsoid(name, centre, radii, rot=(0, 0, 0), coll="forms"):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=32, radius=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * radii[0], v.co.y * radii[1], v.co.z * radii[2]))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    link(ob, coll)
    ob.location = centre
    ob.rotation_euler = rot
    bake_transform(ob)
    ob.hide_render = True
    tree, _ = bvh_of(ob)
    return ob, tree


def project(tree, proj, uvs, fallback=None):
    pts = []
    miss = 0
    # sphere/cylinder rays start `far` out from the axis: never accept hits past the axis
    max_dist = getattr(proj, "far", 4.0)
    for uv in uvs:
        o, d = proj.ray(uv)
        hit = tree.ray_cast(o, d, max_dist)
        if hit[0] is None:
            miss += 1
            pts.append(None)
        else:
            pts.append(hit[0])
    # patch misses with the nearest valid neighbour in list order
    for i, p in enumerate(pts):
        if p is None:
            for k in range(1, len(pts)):
                q = pts[(i - k) % len(pts)] or pts[(i + k) % len(pts)]
                if q is not None:
                    pts[i] = q
                    break
    return pts, miss


# ---------------------------------------------------------------- plates

def drop_inner_faces(ob, proj, limit=0.55):
    """delete faces that look towards the body (never visible on a body-hugging plate)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    dead = [f for f in bm.faces if f.normal.dot(proj.inward(f.calc_center_median())) > limit]
    bmesh.ops.delete(bm, geom=dead, context="FACES")
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def plate(name, tree, proj, outline, *, n=64, rings=7, thickness=0.008, bevel=0.0032,
          bevel_segments=2, fillet_r=0.012, centre=None, material=None, coll="armor",
          extrude_dir_flip=False, smooth_iters=2, sharp_deg=38.0, inner=False):
    """build one armor plate. outline is a closed 2d polygon in the projection's uv space.
    inner=False drops the body-facing side after thickening."""
    loop = fillet(outline, fillet_r, 5) if fillet_r else [Vector(p) for p in outline]
    loop = resample(loop, n)
    uvs = ring_uvs(loop, rings, centre)
    pts, miss = project(tree, proj, uvs)
    faces = ring_topology(n, rings)
    ob = mesh_object(name, pts, faces, coll)
    return _finish_plate(ob, proj, uvs[-1], miss, thickness=thickness, bevel=bevel, bevel_segments=bevel_segments,
                         material=material, extrude_dir_flip=extrude_dir_flip, smooth_iters=smooth_iters,
                         sharp_deg=sharp_deg, inner=inner)


def _finish_plate(ob, proj, ray_uv, miss, *, thickness, bevel, bevel_segments, material, extrude_dir_flip,
                  smooth_iters, sharp_deg, inner):
    """shared by plate and band_plate: face outwards, relax, thicken, bevel, drop the body side"""
    # make normals point away from the body: compare with the cast direction
    me = ob.data
    me.update()
    o, d = proj.ray(ray_uv)
    avg_n = Vector()
    for p in me.polygons:
        avg_n += p.normal
    if avg_n.dot(d) > 0:  # normals point along the cast (into the body), flip
        me.flip_normals()
    if extrude_dir_flip:
        me.flip_normals()
    if smooth_iters:
        m = ob.modifiers.new("relax", "SMOOTH")
        m.factor = 0.35
        m.iterations = smooth_iters
    s = ob.modifiers.new("thick", "SOLIDIFY")
    s.thickness = thickness
    s.offset = 1.0
    s.use_even_offset = True
    s.use_rim = True
    s.use_rim_only = False
    if bevel:
        b = ob.modifiers.new("bevel", "BEVEL")
        b.width = bevel
        b.segments = bevel_segments
        b.limit_method = "ANGLE"
        b.angle_limit = math.radians(50)
        b.profile = 0.6
        b.use_clamp_overlap = True
    apply_modifiers(ob)
    if not inner:
        drop_inner_faces(ob, proj)
    shade(ob, sharp_deg)
    if material:
        ob.data.materials.append(material)
    ob["miss"] = miss
    return ob


def _open_resample(poly, n):
    pts = [Vector(p) for p in poly]
    acc = [0.0]
    for a, b in zip(pts, pts[1:]):
        acc.append(acc[-1] + (b - a).length)
    out = []
    for i in range(n):
        t = acc[-1] * i / (n - 1)
        j = max(k for k in range(len(acc)) if acc[k] <= t + 1e-12)
        j = min(j, len(pts) - 2)
        f = (t - acc[j]) / max(acc[j + 1] - acc[j], 1e-12)
        out.append(pts[j].lerp(pts[j + 1], min(1.0, f)))
    return out


def band_plate(name, tree, proj, lower, upper, *, cols=96, rows=8, thickness=0.008, bevel=0.0032, bevel_segments=2,
               material=None, coll="armor", smooth_iters=2, sharp_deg=38.0, inner=False, ease=0.25):
    """a wide, short plate (brows, jaw guards) filled with a quad grid between two open uv
    curves running the same way. ring filled plates pinch a seam along the middle of
    shapes like this; a grid keeps even rows. ease rounds the two ends in."""
    lo = _open_resample(lower, cols)
    hi = _open_resample(upper, cols)
    uvs = []
    for r in range(rows + 1):
        t = r / rows
        for c in range(cols):
            e = min(c, cols - 1 - c) / max(1, (cols - 1) / 2)
            # pull the corners of the upper edge towards the middle row so the ends round off
            pinch = ease * (1.0 - min(1.0, e * 6.0)) * (abs(t - 0.5) * 2.0)
            uvs.append(lo[c].lerp(hi[c], t + (0.5 - t) * pinch))
    pts, miss = project(tree, proj, uvs)
    faces = []
    for r in range(rows):
        for c in range(cols - 1):
            a = r * cols + c
            faces.append((a, a + 1, a + cols + 1, a + cols))
    ob = mesh_object(name, pts, faces, coll)
    ob = _finish_plate(ob, proj, uvs[len(uvs) // 2], miss, thickness=thickness, bevel=bevel,
                       bevel_segments=bevel_segments, material=material, extrude_dir_flip=False,
                       smooth_iters=smooth_iters, sharp_deg=sharp_deg, inner=inner)
    # the atlas bake keeps panel seams and its bevel shader off bands (bake_atlas.py);
    # joins fill it with 0 on every other piece
    attr = ob.data.attributes.new("thin_band", "FLOAT", "POINT")
    attr.data.foreach_set("value", [1.0] * len(ob.data.vertices))
    return ob


def strip(name, tree, proj, path_uv, width, *, n=48, thickness=0.004, bevel=0.0012,
          material=None, coll="armor"):
    """thin raised strip following a uv polyline (used for emissive light lines and trims)."""
    pts2 = [Vector(p) for p in path_uv]
    left, right = [], []
    for i, p in enumerate(pts2):
        a = pts2[max(0, i - 1)]
        b = pts2[min(len(pts2) - 1, i + 1)]
        t = (b - a).normalized()
        nrm = Vector((-t.y, t.x))
        left.append(p + nrm * width / 2)
        right.append(p - nrm * width / 2)
    outline = left + list(reversed(right))
    return plate(name, tree, proj, outline, n=n, rings=2, thickness=thickness, bevel=bevel,
                 bevel_segments=1, fillet_r=width * 0.45, material=material, coll=coll, smooth_iters=0)


# ---------------------------------------------------------------- lofted solids

def loft(name, sections, *, cap_top=True, cap_bottom=False, coll="armor", material=None):
    """sections: list of closed loops (same vertex count) from bottom to top."""
    n = len(sections[0])
    verts = [Vector(v) for sec in sections for v in sec]
    faces = []
    for s in range(len(sections) - 1):
        for i in range(n):
            a = s * n + i
            b = s * n + (i + 1) % n
            faces.append((a, b, b + n, a + n))
    if cap_top:
        c = Vector()
        for v in sections[-1]:
            c += Vector(v)
        verts.append(c / n)
        ci = len(verts) - 1
        base = (len(sections) - 1) * n
        for i in range(n):
            faces.append((base + i, base + (i + 1) % n, ci))
    if cap_bottom:
        c = Vector()
        for v in sections[0]:
            c += Vector(v)
        verts.append(c / n)
        ci = len(verts) - 1
        for i in range(n):
            faces.append(((i + 1) % n, i, ci))
    ob = mesh_object(name, verts, faces, coll)
    ob.data.update()
    if material:
        ob.data.materials.append(material)
    return ob


def superellipse(cx, cy, a_pos, a_neg, b_pos, b_neg, expo, n, z, rot=0.0):
    """closed loop in the xy plane at height z. separate half extents per direction."""
    pts = []
    for i in range(n):
        t = 2 * math.pi * i / n + rot
        c, s = math.cos(t), math.sin(t)
        x = (a_pos if c >= 0 else a_neg) * math.copysign(abs(c) ** (2 / expo), c)
        y = (b_pos if s >= 0 else b_neg) * math.copysign(abs(s) ** (2 / expo), s)
        pts.append(Vector((cx + x, cy + y, z)))
    return pts


def box(name, size, loc, *, bevel=0.003, segments=2, rot=(0, 0, 0), material=None, coll="armor",
        taper=None):
    """beveled box. taper=(sx, sy) scales the +z face for wedge shapes."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        x, y, z = v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]
        if taper and v.co.z > 0:
            x, y = x * taper[0], y * taper[1]
        v.co = Vector((x, y, z))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    link(ob, coll)
    ob.location = loc
    ob.rotation_euler = rot
    if bevel:
        b = ob.modifiers.new("bevel", "BEVEL")
        b.width = bevel
        b.segments = segments
        b.limit_method = "ANGLE"
    apply_modifiers(ob)
    bake_transform(ob)
    shade(ob, 40)
    if material:
        ob.data.materials.append(material)
    return ob


def cylinder(name, radius, depth, loc, *, verts=24, bevel=0.002, segments=2, rot=(0, 0, 0),
             material=None, coll="armor"):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=verts,
                          radius1=radius, radius2=radius, depth=depth)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    link(ob, coll)
    ob.location = loc
    ob.rotation_euler = rot
    if bevel:
        b = ob.modifiers.new("bevel", "BEVEL")
        b.width = bevel
        b.segments = segments
        b.limit_method = "ANGLE"
    apply_modifiers(ob)
    bake_transform(ob)
    shade(ob, 40)
    if material:
        ob.data.materials.append(material)
    return ob


def bake_transform(ob):
    # matrix_basis is valid right after setting loc/rot/scale (matrix_world needs a depsgraph update)
    ob.data.transform(ob.matrix_basis.copy())
    ob.location = (0, 0, 0)
    ob.rotation_euler = (0, 0, 0)
    ob.scale = (1, 1, 1)
    ob.data.update()


def mirror_object(ob, name=None):
    """mirror across x (character left/right)."""
    new = ob.copy()
    new.data = ob.data.copy()
    new.name = name or ob.name.replace("_l", "_r")
    for c in ob.users_collection:
        c.objects.link(new)
    new.data.transform(Matrix.Scale(-1, 4, Vector((1, 0, 0))))
    new.data.flip_normals()
    new.data.update()
    return new
