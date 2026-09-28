"""helpers for the knife build script (build_knives.py).

knives are authored in millimetres in the knife frame from
docs/assets/knife-contract.md: +X runs from the guard to the tip, +Y is the
spine, the edge faces -Y, Z is thickness, and the origin sits where the hand
meets the guard, at the height of the edge heel (the frame the old procedural
knives used). while a knife is built, blender's own axes stand in for the knife
frame. assemble() then turns every mesh +90 degrees about X, so the gltf
exporter's y-up conversion lands it back in knife axes (three.js +X tip, +Y
spine, +Z thickness).

blades are real cross sections (see blade()): stations run from the heel to the
tip, and each station spans edge to spine with rows for the sharpened bevel,
the primary grind, the flats, a swedge or a second edge. everything else is
lofts, lathes, domed scales and 2d outlines from weapons/wlib.py.
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "weapons"))
import wlib as W  # noqa: E402

common = W.common
MM = 0.001
REPO = W.REPO
TMP = os.path.join(REPO, ".blender-tmp", "knives")
TO_BLENDER = Matrix.Rotation(math.radians(90.0), 4, "X")

# resolution for the viewmodel, where a knife can fill half of a 1440p screen:
# curves get a point every CURVE_STEP mm, round sections and lathes get
# RING_Q times the segments the builders ask for, blades STATION_Q times the
# stations
CURVE_STEP = 1.1
RING_Q = 1.8
STATION_Q = 2.0


def _even(n, q):
    return max(4, int(round(n * q / 2.0)) * 2)


def kv(x, y, z=0.0):
    """knife-frame millimetres -> blender metres (after assemble's rotation)"""
    return Vector((x * MM, -z * MM, y * MM))


def lerp(a, b, t):
    return a + (b - a) * t


def smoothstep(a, b, x):
    if b == a:
        return 1.0 if x >= b else 0.0
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3.0 - 2.0 * t)


# ---------------------------------------------------------------- 2d paths (mm)

def line(a, b, n=1):
    return [(lerp(a[0], b[0], i / n), lerp(a[1], b[1], i / n)) for i in range(n + 1)]


def _poly_len(pts):
    return sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:]))


def quad(a, c, b, n=8):
    n = max(n, int(math.ceil(_poly_len((a, c, b)) / CURVE_STEP)))
    out = []
    for i in range(n + 1):
        t = i / n
        u = 1.0 - t
        out.append((u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]))
    return out


def cubic(a, c1, c2, b, n=10):
    n = max(n, int(math.ceil(_poly_len((a, c1, c2, b)) / CURVE_STEP)))
    out = []
    for i in range(n + 1):
        t = i / n
        u = 1.0 - t
        out.append((u ** 3 * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * b[0],
                    u ** 3 * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * b[1]))
    return out


def arc(cx, cy, r, a0, a1, n=8):
    """arc in degrees, inclusive"""
    n = max(n, int(math.ceil(abs(math.radians(a1 - a0)) * r / (CURVE_STEP * 0.6))))
    return [(cx + r * math.cos(math.radians(lerp(a0, a1, i / n))), cy + r * math.sin(math.radians(lerp(a0, a1, i / n))))
            for i in range(n + 1)]


def path(*parts):
    """joins point runs, dropping the duplicate where runs meet"""
    out = []
    for part in parts:
        for p in part:
            if out and abs(out[-1][0] - p[0]) < 1e-9 and abs(out[-1][1] - p[1]) < 1e-9:
                continue
            out.append((float(p[0]), float(p[1])))
    return out


def fillet(points, segs=10):
    """rounds polygon corners, points (a, b[, r]) in metres, about `segs` segments
    per 90 degrees on large radii and never fewer than 3 on small ones"""
    pts = [(p[0], p[1], p[2] if len(p) > 2 else 0.0) for p in points]
    n = len(pts)
    out = []
    for i in range(n):
        ax, ay, _ = pts[i - 1]
        px, py, r = pts[i]
        bx, by, _ = pts[(i + 1) % n]
        if r <= 0:
            out.append((px, py))
            continue
        v1 = Vector((ax - px, ay - py))
        v2 = Vector((bx - px, by - py))
        l1, l2 = v1.length, v2.length
        if l1 < 1e-9 or l2 < 1e-9:
            out.append((px, py))
            continue
        v1.normalize()
        v2.normalize()
        ang = math.acos(max(-1.0, min(1.0, v1.dot(v2))))
        if ang < 1e-3 or math.pi - ang < 1e-3:
            out.append((px, py))
            continue
        d = r / math.tan(ang / 2)
        dmax = 0.49 * min(l1, l2)
        if d > dmax:
            d = dmax
            r = d * math.tan(ang / 2)
        p = Vector((px, py))
        t1 = p + v1 * d
        t2 = p + v2 * d
        c = p + (v1 + v2).normalized() * (r / math.sin(ang / 2))
        a1 = math.atan2(t1.y - c.y, t1.x - c.x)
        a2 = math.atan2(t2.y - c.y, t2.x - c.x)
        da = (a2 - a1 + math.pi) % (2 * math.pi) - math.pi
        per90 = min(segs, 3.0 + r * 1000.0 * 1.4)
        k = max(2, int(round(per90 * abs(da) / (math.pi / 2))))
        for j in range(k + 1):
            a = a1 + da * j / k
            out.append((c.x + r * math.cos(a), c.y + r * math.sin(a)))
    return out


def rounded(points, segs=10):
    """closed polygon with per-corner fillet radii (x, y, r) in mm, result in mm"""
    return [(x / MM, y / MM) for x, y in fillet(W.mm(points), segs)]


def _cum(pts):
    d = [0.0]
    for a, b in zip(pts, pts[1:]):
        d.append(d[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    return d


def _at(pts, cum, s):
    target = s * cum[-1]
    lo, hi = 0, len(cum) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if cum[mid] <= target:
            lo = mid
        else:
            hi = mid
    seg = cum[hi] - cum[lo]
    t = 0.0 if seg < 1e-12 else (target - cum[lo]) / seg
    a, b = pts[lo], pts[hi]
    return (lerp(a[0], b[0], t), lerp(a[1], b[1], t))


def _corners(pts, cum, deg):
    out = []
    for i in range(1, len(pts) - 1):
        ax, ay = pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]
        bx, by = pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]
        la, lb = math.hypot(ax, ay), math.hypot(bx, by)
        if la < 1e-9 or lb < 1e-9:
            continue
        c = max(-1.0, min(1.0, (ax * bx + ay * by) / (la * lb)))
        if math.degrees(math.acos(c)) > deg:
            out.append(cum[i] / cum[-1])
    return out


def point_at_x(pts, x):
    """point and outward (left) normal on a polyline running +x, at x"""
    for a, b in zip(pts, pts[1:]):
        if min(a[0], b[0]) - 1e-9 <= x <= max(a[0], b[0]) + 1e-9 and abs(b[0] - a[0]) > 1e-9:
            t = (x - a[0]) / (b[0] - a[0])
            dx, dy = b[0] - a[0], b[1] - a[1]
            ln = math.hypot(dx, dy)
            return (lerp(a[0], b[0], t), lerp(a[1], b[1], t)), (-dy / ln, dx / ln)
    a, b = pts[-2], pts[-1]
    dx, dy = b[0] - a[0], b[1] - a[1]
    ln = math.hypot(dx, dy)
    return b, (-dy / ln, dx / ln)


def y_at(pts, x):
    return point_at_x(pts, x)[0][1]


# ---------------------------------------------------------------- mesh plumbing

def _new_obj(name, bm, mats, smooth=True, recalc=True):
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        f.smooth = smooth
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    for m in mats:
        obj.data.materials.append(m)
    return obj


def mark_sharp(obj, angle_deg=35.0):
    """adds sharp edges above an angle, keeping the ones already marked"""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    thr = math.radians(angle_deg)
    for e in bm.edges:
        if len(e.link_faces) != 2:
            e.smooth = False
        elif e.calc_face_angle(0.0) > thr:
            e.smooth = False
    for f in bm.faces:
        f.smooth = True
    bm.to_mesh(obj.data)
    bm.free()
    return obj


def flat(obj):
    for p in obj.data.polygons:
        p.use_smooth = False
    return obj


def _sharp_keys(obj):
    me = obj.data
    keys = set()
    attr = me.attributes.get("sharp_edge")
    if attr is None:
        return keys
    for e, a in zip(me.edges, attr.data):
        if a.value:
            p = me.vertices[e.vertices[0]].co
            q = me.vertices[e.vertices[1]].co
            keys.add(_ekey(p, q))
    return keys


def _ekey(p, q):
    a = (round(p.x, 6), round(p.y, 6), round(p.z, 6))
    b = (round(q.x, 6), round(q.y, 6), round(q.z, 6))
    return (a, b) if a < b else (b, a)


def _restore_sharp(obj, keys, angle_deg):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    thr = math.radians(angle_deg)
    for e in bm.edges:
        if _ekey(e.verts[0].co, e.verts[1].co) in keys:
            e.smooth = False
        elif len(e.link_faces) == 2 and e.calc_face_angle(0.0) > thr:
            e.smooth = False
    for f in bm.faces:
        f.smooth = True
    bm.to_mesh(obj.data)
    bm.free()


def cut(obj, cutters, transfer=False, angle=35.0):
    """exact boolean difference that keeps the sharp edges already marked"""
    keys = _sharp_keys(obj)
    W.boolean(obj, cutters, transfer_material=transfer)
    _restore_sharp(obj, keys, angle)
    return obj




def bevel(obj, width_mm, segs=2, angle=30.0, harden=True):
    return W.bevel(obj, width_mm * MM, segs=segs, angle=angle, harden=harden)


def join(objs, name):
    return W.join([o for o in objs if o is not None], name)


def xform(obj, m):
    obj.data.transform(m)
    obj.data.update()
    return obj










# ---------------------------------------------------------------- primitives (mm in, knife frame)

def prism(name, pts, z0, z1, mat, segs=10):
    """side outline (x, y[, r]) extruded across the thickness from z0 to z1"""
    pts = fillet(W.mm(pts), segs) if any(len(p) > 2 for p in pts) else W.mm(pts)
    return W.prism(name, pts, "Z", z0 * MM, z1 * MM, mat)


def plate(name, pts, thick, mat, segs=10):
    return prism(name, pts, -thick / 2, thick / 2, mat, segs)


def front(name, pts, x0, x1, mat, segs=10):
    """front outline (y, z[, r]) extruded along the blade from x0 to x1"""
    pts = fillet(W.mm(pts), segs) if any(len(p) > 2 for p in pts) else W.mm(pts)
    return W.prism(name, pts, "X", x0 * MM, x1 * MM, mat)


def lathe_x(name, prof, segs, mat, cy=0.0, cz=0.0, closed=False, ripple=None, phase=0.0):
    """revolves (r, x) mm around the knife x axis through (cy, cz)"""
    return W.lathe(name, [(r * MM, x * MM) for r, x in prof], _even(segs, RING_Q), mat, axis="X", center=(0.0, cy * MM, cz * MM),
                   closed=closed, ripple=ripple, phase=phase)




def lathe_z(name, prof, segs, mat, cx=0.0, cy=0.0, closed=False, phase=0.0):
    """revolves (r, z) mm around a knife z axis through (cx, cy): pins, rings, screws"""
    return W.lathe(name, [(r * MM, z * MM) for r, z in prof], _even(segs, RING_Q), mat, axis="Z", center=(cx * MM, cy * MM, 0.0),
                   closed=closed, phase=phase)


def pin(name, x, y, r, z0, z1, mat, segs=12, dome=0.35):
    """pin or screw along z with slightly domed heads"""
    d = r * dome
    prof = [(0.0, z0 - d), (r * 0.75, z0 - d * 0.7), (r, z0), (r, z1), (r * 0.75, z1 + d * 0.7), (0.0, z1 + d)]
    return lathe_z(name, prof, segs, mat, x, y)


def screw_head(name, x, y, r, z, side, mat, segs=14, height=0.9, socket=None):
    """flat screw head sitting on a face at z (side +1 faces +z). socket='torx'|'hex'|None"""
    z0, z1 = z - side * 0.4, z + side * height
    prof = [(0.0, z0), (r, z0), (r, z1 - side * 0.25), (r * 0.82, z1), (0.0, z1)]
    obj = lathe_z(name, prof, segs, mat, x, y)
    if socket:
        if socket == "torx":
            # six lobed star
            pts = []
            for i in range(36):
                a = 2 * math.pi * i / 36
                rr = r * (0.36 + 0.09 * math.cos(6 * a))
                pts.append(((x + rr * math.cos(a)) * MM, (y + rr * math.sin(a)) * MM))
        else:
            pts = [((x + r * 0.42 * math.cos(math.pi / 6 + i * math.pi / 3)) * MM,
                    (y + r * 0.42 * math.sin(math.pi / 6 + i * math.pi / 3)) * MM) for i in range(6)]
        lo, hi = sorted(((z1 - side * 0.5) * MM, (z1 + side * 1.0) * MM))
        W.boolean(obj, W.prism("c", pts, "Z", lo, hi, mat))
    return flat(obj) if socket else mark_sharp(obj, 40)


def torus(name, cx, cy, R, rt, rw, mat, segs=32, tsegs=10, axis="Z", cz=0.0, e=2.0):
    """ring: tube radius rt in the ring plane, half width rw across it. axis Z lies in
    the blade plane (finger rings), axis X in the YZ plane (muzzle rings)"""
    tsegs = _even(tsegs, 1.6)
    prof = []
    for k in range(tsegs):
        a = 2 * math.pi * k / tsegs
        c, s = math.cos(a), math.sin(a)
        c = math.copysign(abs(c) ** (2.0 / e), c)
        s = math.copysign(abs(s) ** (2.0 / e), s)
        prof.append((R + rt * c, rw * s))
    if axis == "Z":
        return lathe_z(name, prof, segs, mat, cx, cy, closed=True)
    return lathe_x(name, [(r, cx + t) for r, t in prof], segs, mat, cy=cy, cz=cz, closed=True)


def superellipse(cy, top, bottom, halfw, n, e=2.4, cz=0.0):
    """ring in the y/z plane: top/bottom half heights above/below cy, half width in z (mm).
    returns (y, z) in metres, starting at the spine side, counter-clockwise seen from +x"""
    n = _even(n, RING_Q)
    out = []
    for i in range(n):
        a = 2 * math.pi * i / n
        s, c = math.cos(a), math.sin(a)
        ys = math.copysign(abs(s) ** (2.0 / e), s)
        zs = math.copysign(abs(c) ** (2.0 / e), c)
        out.append(((cy + ys * (top if s >= 0 else bottom)) * MM, (cz + zs * halfw) * MM))
    return out


def loft(name, sections, mat, cap0=True, cap1=True, uv_scale=0.03, fan=True):
    """skins (x_mm, [(y, z) metres]) rings along x into a solid with cylindrical uvs"""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    n = len(sections[0][1])
    rings = [[bm.verts.new((x * MM, p[0], p[1])) for p in pts] for x, pts in sections]
    along = [0.0]
    for (xa, pa), (xb, pb) in zip(sections, sections[1:]):
        ca = Vector((xa * MM, sum(p[0] for p in pa) / n, 0))
        cb = Vector((xb * MM, sum(p[0] for p in pb) / n, 0))
        along.append(along[-1] + (cb - ca).length)
    arcs = []
    for _, pts in sections:
        a = [0.0]
        for k in range(1, n + 1):
            p, q = pts[k - 1], pts[k % n]
            a.append(a[-1] + math.hypot(q[0] - p[0], q[1] - p[1]))
        arcs.append(a)
    for i in range(len(rings) - 1):
        ra, rb = rings[i], rings[i + 1]
        for k in range(n):
            k2 = (k + 1) % n
            f = bm.faces.new((ra[k], rb[k], rb[k2], ra[k2]))
            uvs = [(along[i], arcs[i][k]), (along[i + 1], arcs[i + 1][k]), (along[i + 1], arcs[i + 1][k + 1]),
                   (along[i], arcs[i][k + 1])]
            for loop, (u, v) in zip(f.loops, uvs):
                loop[uvl].uv = (u / uv_scale, v / uv_scale)
    caps = []
    for idx, on in ((0, cap0), (len(rings) - 1, cap1)):
        if not on:
            continue
        ring = rings[idx]
        if fan:
            c = sum((v.co for v in ring), Vector()) / n
            cv = bm.verts.new(c)
            for k in range(n):
                k2 = (k + 1) % n
                f = bm.faces.new((cv, ring[k2], ring[k]) if idx == 0 else (cv, ring[k], ring[k2]))
                caps.append(f)
                for loop in f.loops:
                    loop[uvl].uv = (loop.vert.co.y / uv_scale, loop.vert.co.z / uv_scale)
        else:
            f = bm.faces.new(list(reversed(ring)) if idx == 0 else ring)
            caps.append(f)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        f.smooth = True
    for f in caps:
        for e in f.edges:
            if len(e.link_faces) == 2 and any(g not in caps for g in e.link_faces):
                e.smooth = False
    return _new_obj(name, bm, [mat], recalc=False)


def tube(name, pts, r, mat, sides=6, cap=True, uv_scale=0.01):
    """round tube along a 3d polyline in mm (parallel transport frames)"""
    sides = _even(sides, 1.6)
    P = [Vector(p) * MM for p in pts]
    rr = r * MM
    normal = Vector((0.0, 1.0, 0.0))
    sections = []
    for i, p in enumerate(P):
        t = (P[min(len(P) - 1, i + 1)] - P[max(0, i - 1)]).normalized()
        normal = (normal - t * normal.dot(t))
        if normal.length < 1e-6:
            normal = t.orthogonal()
        normal.normalize()
        b = t.cross(normal).normalized()
        sections.append([p + normal * (math.cos(2 * math.pi * k / sides) * rr) + b * (math.sin(2 * math.pi * k / sides) * rr)
                         for k in range(sides)])
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    rings = [[bm.verts.new(v) for v in s] for s in sections]
    along = 0.0
    for i in range(len(rings) - 1):
        seg = (P[i + 1] - P[i]).length
        for k in range(sides):
            k2 = (k + 1) % sides
            f = bm.faces.new((rings[i][k], rings[i + 1][k], rings[i + 1][k2], rings[i][k2]))
            for loop, (u, v) in zip(f.loops, [(along, k), (along + seg, k), (along + seg, k + 1), (along, k + 1)]):
                loop[uvl].uv = (u / uv_scale, v / sides)
        along += seg
    if cap:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    return _new_obj(name, bm, [mat])


def slab(name, top, bottom, z0, thick, side, mat, dome=0.55, rows=6, uv_scale=0.03, round_mm=None):
    """domed scale on one side of the knife. top/bottom are (x, y) mm with matching x,
    front to back. inner face flat at |z| = z0, the crown rises by thick with rounded
    shoulders (rows packed towards the edges), and the outside edges get a small
    rounded bevel. side +1 builds on +z, -1 on -z"""
    if dome > 0:
        rows = max(rows, 16)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    n = len(top)
    outer = []
    for i in range(n):
        x, yt = top[i]
        yb = bottom[i][1]
        row = []
        for r in range(rows + 1):
            v = 0.5 - 0.5 * math.cos(math.pi * r / rows) if dome > 0 else r / rows
            k = max(0.0, 1.0 - abs(2 * v - 1) ** 2.6) ** 0.5
            z = z0 + thick * ((1 - dome) + dome * k)
            row.append(bm.verts.new((x * MM, lerp(yb, yt, v) * MM, side * z * MM)))
        outer.append(row)
    inner = [(bm.verts.new((top[i][0] * MM, bottom[i][1] * MM, side * z0 * MM)),
              bm.verts.new((top[i][0] * MM, top[i][1] * MM, side * z0 * MM))) for i in range(n)]
    faces_outer = []
    for i in range(n - 1):
        for r in range(rows):
            faces_outer.append(bm.faces.new((outer[i][r], outer[i + 1][r], outer[i + 1][r + 1], outer[i][r + 1])))
    for i in range(n - 1):
        bm.faces.new((inner[i][0], inner[i][1], inner[i + 1][1], inner[i + 1][0]))
        bm.faces.new((outer[i][0], inner[i][0], inner[i + 1][0], outer[i + 1][0]))
        bm.faces.new((outer[i][rows], outer[i + 1][rows], inner[i + 1][1], inner[i][1]))
    for i in (0, n - 1):
        loop = [outer[i][r] for r in range(rows + 1)] + [inner[i][1], inner[i][0]]
        bm.faces.new(loop if i == n - 1 else list(reversed(loop)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        f.smooth = True
        for loop in f.loops:
            loop[uvl].uv = (loop.vert.co.x / uv_scale, loop.vert.co.y / uv_scale)
    fo = set(faces_outer)
    for e in bm.edges:
        lf = e.link_faces
        if len(lf) == 2 and (lf[0] in fo) != (lf[1] in fo):
            e.smooth = False
        elif len(lf) == 2 and lf[0] not in fo and lf[1] not in fo and e.calc_face_angle(0.0) > math.radians(30):
            e.smooth = False
    obj = _new_obj(name, bm, [mat], recalc=False)
    rnd = round_mm if round_mm is not None else min(0.45, 0.35 * thick if dome > 0 else 0.3 * thick)
    if rnd > 0.05:
        bevel(obj, rnd, segs=2, angle=35.0)
    return obj


# ---------------------------------------------------------------- blades

def _stations(edge, ecum, spine, scum, n, corner_deg):
    corners = sorted(set(round(c, 5) for c in _corners(edge, ecum, corner_deg) + _corners(spine, scum, corner_deg)))
    params = []
    for i in range(n + 1):
        s = i / n
        if all(abs(s - c) > 0.45 / n for c in corners):
            params.append(s)
    params = sorted(set(params + corners))
    return params


def blade(name, edge, spine, mats, thick, stations=46, grind="flat", grind_h=0.6, edge_bevel=1.1, shoulder=0.55,
          ricasso=10.0, taper=0.6, taper_min=0.35, swedge=None, double_from=None, fuller=None, hollow_pow=1.9,
          tip_close=0.3, corner_deg=14.0, grind_sub=None):
    """blade solid with a real cross section.

    edge and spine are (x, y) mm polylines from the heel to the tip; both end on the
    tip. stations pair them by arc length (corners of either curve get their own
    station, so tanto breaks and clip corners stay crisp). across each station,
    from the edge up: the polished secondary bevel (material 1), the primary grind
    (flat, or hollow and concave), the flats at full thickness, then an optional
    swedge (the spine side ground thinner from `swedge['from']` of the blade) or a
    mirrored second edge from `double_from`. the grind fades in over `ricasso` mm
    from the heel (the plunge), thickness tapers toward the tip and closes to a
    point. fuller={'from','to','lo','hi','depth'} cuts a rounded groove in the flats.
    returns (object, tip (x, y) mm, info with hmax / xmax / ymin / ymax in mm)."""
    stations = int(stations * STATION_Q)
    ecum, scum = _cum(edge), _cum(spine)
    params = _stations(edge, ecum, spine, scum, stations, corner_deg)
    elen = ecum[-1]
    st = []
    for s in params:
        e = _at(edge, ecum, s)
        p = _at(spine, scum, s)
        st.append({"s": s, "e": e, "p": p, "h": math.hypot(p[0] - e[0], p[1] - e[1])})
    h0 = max(x["h"] for x in st[:max(2, len(st) // 5)])
    ric = min(0.6, ricasso / max(1e-6, elen))
    gsub = grind_sub or (5 if grind == "hollow" else 1)
    dbl = double_from is not None

    keys = ["edge", "bevel"] + [f"g{k}" for k in range(1, gsub)] + ["grind"]
    if fuller:
        keys += ["f0", "f1", "f2", "f3"]
    if swedge and not dbl:
        keys += ["sw"]
    if dbl:
        keys += ["dgrind"] + [f"dg{k}" for k in range(gsub - 1, 0, -1)] + ["dbevel"]
    else:
        keys += ["ease"]
    keys += ["spine"]
    sharp_rows = {"edge", "bevel", "grind", "sw", "dgrind", "dbevel", "spine", "f0", "f3", "ease"}
    # the spine's corners are eased by a small chamfer, like a finished blade
    ease_mm = 0.4
    R = len(keys)

    def rows_for(x):
        h = max(x["h"], 1e-6)
        vb = min(0.3, max(0.04, edge_bevel / h))
        vg = max(vb + 0.05, min(0.49 if dbl else 0.98, grind_h))
        vals = {"edge": 0.0, "bevel": vb, "grind": vg, "spine": 1.0}
        for k in range(1, gsub):
            vals[f"g{k}"] = vb + (vg - vb) * k / gsub
        if fuller:
            for k in range(4):
                vals[f"f{k}"] = lerp(fuller["lo"], fuller["hi"], k / 3)
        if swedge and not dbl:
            vals["sw"] = 1.0 - min(0.45, max(0.1, swedge.get("width", 4.0) / h))
        if dbl:
            vals["dgrind"] = 1.0 - vg
            vals["dbevel"] = 1.0 - vb
            for k in range(1, gsub):
                vals[f"dg{k}"] = 1.0 - vals[f"g{k}"]
        else:
            vals["ease"] = 1.0 - min(0.2, ease_mm / h)
        out = [vals[k] for k in keys]
        for i in range(1, R):
            out[i] = max(out[i], out[i - 1] + 1e-4)
        out[-1] = max(out[-1], 1.0)
        return out

    def thickness(x, v, rowv):
        u = x["s"]
        ts = thick * max(taper_min, 1.0 - taper * u ** 1.5)
        ts *= min(1.0, x["h"] / (tip_close * h0)) ** 0.6
        tb = min(ts, shoulder)
        vb, vg = rowv[1], rowv[keys.index("grind")]

        def ground(w):
            if w <= vb:
                return tb * (w / vb)
            if w <= vg:
                f = (w - vb) / (vg - vb)
                return tb + (ts - tb) * (f ** hollow_pow if grind == "hollow" else f)
            return ts

        plunge = smoothstep(0.0, ric, u)
        t = lerp(ts, ground(v), plunge)
        if dbl:
            de = smoothstep(double_from, double_from + 0.12, u) * plunge
            t = min(t, lerp(ts, ground(1.0 - v), de))
        if swedge and not dbl:
            sw = smoothstep(swedge["from"], swedge["from"] + swedge.get("ramp", 0.06), u) * swedge.get("depth", 0.6)
            vs = rowv[keys.index("sw")]
            if v > vs:
                t = min(t, ts * (1.0 - sw * (v - vs) / max(1e-6, 1.0 - vs)))
        if not dbl:
            ve = rowv[keys.index("ease")]
            if v > ve:
                t -= min(0.45, 0.3 * t) * (v - ve) / max(1e-6, 1.0 - ve)
        if fuller and fuller["lo"] < v < fuller["hi"]:
            ramp = smoothstep(fuller["from"], fuller["from"] + 0.05, u) * (1 - smoothstep(fuller["to"] - 0.05, fuller["to"], u))
            t -= 2 * fuller["depth"] * ramp * math.sin(math.pi * (v - fuller["lo"]) / (fuller["hi"] - fuller["lo"]))
        return max(0.0, t)

    bm = bmesh.new()
    V = []
    for x in st:
        rowv = rows_for(x)
        row = []
        for v in rowv:
            px = lerp(x["e"][0], x["p"][0], v)
            py = lerp(x["e"][1], x["p"][1], v)
            half = thickness(x, v, rowv) / 2
            row.append((bm.verts.new((px * MM, py * MM, half * MM)), bm.verts.new((px * MM, py * MM, -half * MM))))
        V.append(row)
    N = len(V)
    edge_mat_rows = {0}
    if dbl:
        edge_mat_rows.add(R - 2)

    def band_mat(i, r):
        u = 0.5 * (st[i]["s"] + st[i + 1]["s"])
        plunge = smoothstep(0.0, ric, u)
        if r == 0 and plunge > 0.5:
            return 1
        if dbl and r == R - 2 and smoothstep(double_from, double_from + 0.12, u) * plunge > 0.5:
            return 1
        return 0

    for i in range(N - 1):
        for r in range(R - 1):
            m = band_mat(i, r)
            f = bm.faces.new((V[i][r][0], V[i + 1][r][0], V[i + 1][r + 1][0], V[i][r + 1][0]))
            f.material_index = m
            f = bm.faces.new((V[i][r][1], V[i][r + 1][1], V[i + 1][r + 1][1], V[i + 1][r][1]))
            f.material_index = m
        bm.faces.new((V[i][0][1], V[i + 1][0][1], V[i + 1][0][0], V[i][0][0]))
        bm.faces.new((V[i][R - 1][0], V[i + 1][R - 1][0], V[i + 1][R - 1][1], V[i][R - 1][1]))
    heel = [V[0][r][0] for r in range(R)] + [V[0][r][1] for r in range(R - 1, -1, -1)]
    heel_face = bm.faces.new(heel)
    for i in range(N - 1):
        for r, k in enumerate(keys):
            if k not in sharp_rows:
                continue
            for s in (0, 1):
                e = bm.edges.get((V[i][r][s], V[i + 1][r][s]))
                if e is not None:
                    e.smooth = False
    for e in heel_face.edges:
        e.smooth = False
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=2e-7)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-8, edges=bm.edges)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        f.smooth = True
    obj = _new_obj(name, bm, [mats["blade"], mats["edge"]], recalc=False)
    tip = st[-1]["e"]
    info = {"hmax": max(x["h"] for x in st), "xmax": max(max(x["e"][0], x["p"][0]) for x in st),
            "ymin": min(min(x["e"][1], x["p"][1]) for x in st), "ymax": max(max(x["e"][1], x["p"][1]) for x in st)}
    return obj, tip, info


def spine_thickness(thick, spine, taper=0.6, taper_min=0.35):
    """the blade's spine thickness at x, with the same distal taper blade() uses, so
    teeth sitting on the spine never stand proud of the flats"""
    cum = _cum(spine)

    def f(x):
        best, s = 1e9, 0.0
        for i, p in enumerate(spine):
            if abs(p[0] - x) < best:
                best, s = abs(p[0] - x), cum[i] / cum[-1]
        return thick * max(taper_min, 1.0 - taper * s ** 1.5)
    return f


def teeth(name, spine, x0, x1, count, height, thick, mat, rake=0.62, sink=0.5, tip_frac=0.4, lean=0.0):
    """sawback teeth on a spine polyline between x0 and x1 (mm): raked, filed to a
    narrower crest, flat shaded. thick is the spine thickness (or a callable of x,
    see spine_thickness); teeth are 0.92 of it so they sit inside the flats"""
    bm = bmesh.new()
    w = (x1 - x0) / count
    for j in range(count):
        xa, xb = x0 + j * w, x0 + (j + 1) * w
        (pa, na), (pb, nb) = point_at_x(spine, xa), point_at_x(spine, xb)
        pp, npk = point_at_x(spine, xa + w * rake)
        t = min((thick(xa), thick(xb)) if callable(thick) else (thick, thick)) * 0.46
        tp = t * tip_frac
        A = (pa[0] - na[0] * sink, pa[1] - na[1] * sink)
        B = (pb[0] - nb[0] * sink, pb[1] - nb[1] * sink)
        P = (pp[0] + npk[0] * height + lean, pp[1] + npk[1] * height)
        v = [bm.verts.new((A[0] * MM, A[1] * MM, t * MM)), bm.verts.new((B[0] * MM, B[1] * MM, t * MM)),
             bm.verts.new((P[0] * MM, P[1] * MM, tp * MM)), bm.verts.new((A[0] * MM, A[1] * MM, -t * MM)),
             bm.verts.new((B[0] * MM, B[1] * MM, -t * MM)), bm.verts.new((P[0] * MM, P[1] * MM, -tp * MM))]
        for f in ((0, 1, 2), (3, 5, 4), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)):
            bm.faces.new([v[k] for k in f])
    obj = _new_obj(name, bm, [mat], smooth=False)
    return obj






# ---------------------------------------------------------------- textures and materials

# material name -> spec, read by kbake.detail_shader when the knife is baked
MAT_SPECS = {}


def _mat(name, spec):
    MAT_SPECS[name] = spec
    return W.material(name, spec[0], spec[1], spec[2])


STEEL = (0xc4c9d0, 0.3, 1.0, {"detail": "brushed"})
EDGE = (0xe9ecf0, 0.14, 1.0, {"detail": "polished"})


def materials(handle, metal=(0x9aa0a8, 0.34, 1.0, {"detail": "bead"}), accent=(0x2a2c30, 0.5, 0.2), blade=STEEL, edge=EDGE):
    """the five contract materials. each spec is (hex, roughness, metallic[, opts]) with
    opts {'detail': kind, 'strength': bump strength, 'color2': second colour}, see
    kbake.detail_shader for the kinds (brushed, polished, bead, pebble, knurl, g10,
    wood, ivory, cord, tape)"""
    MAT_SPECS.clear()
    if len(metal) < 4:
        metal = (*metal, {"detail": "bead" if metal[2] >= 0.5 else "g10", "strength": 0.6})
    if len(accent) < 4:
        accent = (*accent, {"detail": "bead" if accent[2] >= 0.5 else "g10", "strength": 0.5})
    return {
        "blade": _mat("knife_blade", blade),
        "edge": _mat("knife_edge", edge),
        "handle": _mat("knife_handle", handle),
        "metal": _mat("knife_metal", metal),
        "accent": _mat("knife_accent", accent),
    }


# ---------------------------------------------------------------- assembly and export

class Knife:
    """what a knife builder returns. positions are knife-frame mm."""

    def __init__(self, kid):
        self.id = kid
        self.static = []
        self.blade = []
        self.pivot = None
        self.handles = {}
        self.sockets = {}
        self.extras = {}

    def add(self, *objs):
        self.static.extend(o for o in objs if o is not None)

    def add_blade(self, *objs):
        self.blade.extend(o for o in objs if o is not None)

    def socket(self, name, x, y, z=0.0, rot=(0.0, 0.0, 0.0), parent=None):
        self.sockets[name] = ((x, y, z), rot, parent)


def assemble(k):
    """rotates the parts into blender axes, builds the node tree from the contract and
    returns (root, meshes)"""
    parts = list(k.static) + list(k.blade) + [o for objs in k.handles.values() for o in objs[0]]
    for o in parts:
        if not o.data.uv_layers:
            W.box_uv(o, 0.03)
        o.data.transform(TO_BLENDER)
        o.data.update()
    root = W.empty(k.id, (0, 0, 0))
    meshes = []
    fixed_blade = k.pivot is None
    body_parts = list(k.static) + (list(k.blade) if fixed_blade else [])
    body = join(body_parts, "body")
    W.parent_static(body, root)
    body.name = body.data.name = "body"
    meshes.append(body)
    nodes = {k.id: root}
    if not fixed_blade:
        blade = join(k.blade, "blade_pivot_mesh")
        nodes["blade_pivot"] = W.pin_part(blade, "blade_pivot", kv(*k.pivot), root)
        meshes.append(blade)
    for name, (objs, pin_xy) in k.handles.items():
        h = join(objs, name + "_mesh")
        nodes[name] = W.pin_part(h, name, kv(*pin_xy), root)
        meshes.append(h)
    for name, (pos, rot, parent) in k.sockets.items():
        W.empty(name, kv(*pos), rot, parent=nodes[parent or k.id])
    for key, value in k.extras.items():
        root[key] = value
    bpy.context.view_layer.update()
    return root, meshes


def export(root, path):
    W.export(path, root)


def report(kid, meshes):
    total = W.tri_count(meshes)
    parts = ", ".join(f"{m.name} {W.tri_count([m])}" for m in meshes)
    print(f"[knives] {kid}: {total} tris ({parts})")
    return total
