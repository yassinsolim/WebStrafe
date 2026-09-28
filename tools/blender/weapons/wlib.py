"""helpers for the weapon build scripts (build_deagle.py, build_awp.py).

everything is modelled in metres with blender axes: +X right, +Y forward along
the barrel, +Z up. parts come from 2d outlines (extruded prisms, lofts, lathes),
get cut with booleans, bevelled with hardened normals, then joined per node.
moving parts end up as an empty on the pivot with the geometry in a child mesh
called <part>_mesh (see pin_part for why).

each gun is built twice from the same functions: the low poly that ships
(set_hi(False)) and a high poly (set_hi(True)) with finer curves, rounder
bevels and extra detail. the high poly is baked onto the uv atlas of the low
poly (normal, ao, edge masks and material parameters), and compose_textures
turns those bakes into the base colour, orm and normal maps.
"""

import math
import os
import random
import sys
import time

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import common  # noqa: E402

MM = 0.001
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
TMP = os.path.join(REPO, ".blender-tmp", "weapons")
TEXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "textures")

# detail level. tol is the largest gap (mm) a curve's chord may leave to the
# true arc, so segment counts follow the radius instead of a fixed number
LEVEL = {"hi": False, "tol_lo": 0.03, "tol_hi": 0.006, "fillet_lo": 0.05, "fillet_hi": 0.012}


def set_hi(on):
    LEVEL["hi"] = bool(on)


def hi():
    return LEVEL["hi"]


def set_tolerance(lathe_mm=None, fillet_mm=None):
    """chord tolerance of the low poly (the high poly is always finer)"""
    if lathe_mm is not None:
        LEVEL["tol_lo"] = lathe_mm
    if fillet_mm is not None:
        LEVEL["fillet_lo"] = fillet_mm


def _segs_for(radius_mm, tol_mm):
    """segments per full turn so the chord stays within tol of the arc"""
    if radius_mm <= tol_mm:
        return 4
    theta = 2.0 * math.acos(max(-1.0, 1.0 - tol_mm / radius_mm))
    return 2.0 * math.pi / max(theta, 1e-4)


# ---------------------------------------------------------------- materials

def srgb(hex_value):
    """0xRRGGBB in srgb -> linear rgb tuple for principled inputs"""
    def lin(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (lin((hex_value >> 16) & 255), lin((hex_value >> 8) & 255), lin(hex_value & 255))


def material(name, hex_color, roughness, metallic, normal_image=None, normal_strength=1.0,
             emission=None, emission_strength=0.0):
    mat = common.principled(name, srgb(hex_color), roughness=roughness, metallic=metallic,
                            emission=srgb(emission) if emission is not None else None,
                            emission_strength=emission_strength)
    if normal_image is not None:
        nodes = mat.node_tree.nodes
        links = mat.node_tree.links
        bsdf = nodes.get("Principled BSDF")
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = normal_image
        tex.interpolation = "Linear"
        nmap = nodes.new("ShaderNodeNormalMap")
        nmap.inputs["Strength"].default_value = normal_strength
        links.new(tex.outputs["Color"], nmap.inputs["Color"])
        links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


# a finish spec per material drives the flat preview material and every bake
# pass. colours are 0xRRGGBB srgb. wear shows on convex edges and scratches,
# grime sits in cavities, rvar is how much the roughness breaks up, detail
# picks the micro roughness texture (brushed metal or plastic)
SPEC_DEFAULTS = dict(base=0x808080, rough=0.5, metal=0.0, wear=0.0, wear_color=None, wear_rough=None,
                     wear_metal=None, grime=0.5, rvar=0.06, scratch=0.3, detail="plastic", bump=None,
                     bump_scale=1.0, bump_depth=1.0)
SPECS = {}


def finish(name, **spec):
    """registers a finish and returns its flat preview material"""
    s = dict(SPEC_DEFAULTS)
    s.update(spec)
    if s["wear_color"] is None:
        s["wear_color"] = s["base"]
    if s["wear_rough"] is None:
        s["wear_rough"] = s["rough"]
    if s["wear_metal"] is None:
        s["wear_metal"] = s["metal"]
    SPECS[name] = s
    return material(name, s["base"], s["rough"], s["metal"])


# ---------------------------------------------------------------- 2d outlines

def fillet(points, segs=4):
    """rounds polygon corners. points are (a, b) or (a, b, radius) in metres.
    the arc gets enough segments to stay within the chord tolerance of the
    current detail level, capped by `segs` (a hint, 1 keeps cutters coarse)."""
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
        bis = (v1 + v2).normalized()
        c = p + bis * (r / math.sin(ang / 2))
        a1 = math.atan2(t1.y - c.y, t1.x - c.x)
        a2 = math.atan2(t2.y - c.y, t2.x - c.x)
        da = (a2 - a1 + math.pi) % (2 * math.pi) - math.pi
        tol = LEVEL["fillet_hi"] if LEVEL["hi"] else LEVEL["fillet_lo"]
        per90 = _segs_for(r * 1000.0, tol) / 4.0
        per90 = max(1.0, min(per90, segs * (6.0 if LEVEL["hi"] else 2.0)))
        k = max(1, int(math.ceil(per90 * abs(da) / (math.pi / 2) - 0.25)))
        for j in range(k + 1):
            a = a1 + da * j / k
            out.append((c.x + r * math.cos(a), c.y + r * math.sin(a)))
    return out


def arc(cx, cy, r, a0_deg, a1_deg, segs):
    """points along a circular arc, angles in degrees, inclusive"""
    out = []
    for j in range(segs + 1):
        a = math.radians(a0_deg + (a1_deg - a0_deg) * j / segs)
        out.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return out


def mm(points):
    """scales (a, b[, r]) tuples from millimetres to metres"""
    return [tuple(v * MM for v in p) for p in points]


def smooth_curve(points, per_span):
    """catmull-rom through (a, b) points (any units), per_span samples per gap"""
    pts = [Vector(p) for p in points]
    out = []
    n = len(pts)
    for i in range(n - 1):
        p0, p1, p2, p3 = pts[max(0, i - 1)], pts[i], pts[i + 1], pts[min(n - 1, i + 2)]
        for j in range(per_span):
            t = j / per_span
            t2, t3 = t * t, t * t * t
            v = 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
            out.append(tuple(v))
    out.append(tuple(pts[-1]))
    return out


# ---------------------------------------------------------------- millimetre wrappers
# the build scripts author everything in mm, these convert on the way in

def side(name, pts, x0, x1, mat, segs=4):
    """side outline (y, z[, r]) in mm extruded across x"""
    return prism(name, fillet(mm(pts), segs), "X", x0 * MM, x1 * MM, mat)


def front(name, pts, y0, y1, mat, segs=4):
    """front outline (x, z[, r]) in mm extruded along the barrel"""
    return prism(name, fillet(mm(pts), segs), "Y", y0 * MM, y1 * MM, mat)


def top(name, pts, z0, z1, mat, segs=4):
    """top outline (x, y[, r]) in mm extruded up"""
    return prism(name, fillet(mm(pts), segs), "Z", z0 * MM, z1 * MM, mat)


def cube(name, x0, x1, y0, y1, z0, z1, mat):
    return box(name, ((x1 - x0) * MM, (y1 - y0) * MM, (z1 - z0) * MM),
               ((x0 + x1) * 0.5 * MM, (y0 + y1) * 0.5 * MM, (z0 + z1) * 0.5 * MM), mat)


def pin_x(name, y, z, r, x0, x1, mat, segs=14):
    """round pin/button along x"""
    return lathe(name, [(r * MM, x0 * MM), (r * MM, x1 * MM)], segs, mat, axis="X", center=(0, y * MM, z * MM))


def rod_y(name, x, z, prof, segs, mat, phase=0.0, ripple=None, closed=False):
    """lathe along the barrel axis, prof is (r, y) in mm"""
    return lathe(name, [(r * MM, y * MM) for r, y in prof], segs, mat, axis="Y", center=(x * MM, 0, z * MM),
                 phase=phase, ripple=ripple, closed=closed)


def lathe_mm(name, prof, segs, mat, axis, center, ripple=None, closed=False, phase=0.0, ribs=None):
    """lathe with an (r, t) profile and centre in mm"""
    return lathe(name, [(r * MM, t * MM) for r, t in prof], segs, mat, axis=axis,
                 center=tuple(c * MM for c in center), ripple=ripple, closed=closed, phase=phase, ribs=ribs)


def bevel_worn(obj, worn, width_mm, segs=1, angle=30.0):
    """bevel for metal parts. edge wear used to be a material on the convex
    bevel faces; now it comes from the baked edge mask, so this is a bevel"""
    return bevel(obj, width_mm * MM, segs=segs, angle=angle)


def sx_range(sx, a, b):
    """(a, b) mirrored to the side given by sx, sorted"""
    lo, hi_ = sorted((sx * a, sx * b))
    return lo, hi_


# ---------------------------------------------------------------- mesh building

def _link(name, mesh, mats):
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    for m in mats:
        obj.data.materials.append(m)
    return obj


def _finish_bm(bm, name, mats, smooth=True):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        f.smooth = smooth
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    return _link(name, mesh, mats)


def _to3(axis, a, b, t):
    if axis == "X":
        return (t, a, b)
    if axis == "Y":
        return (a, t, b)
    return (a, b, t)


def prism(name, pts, axis, lo, hi_, mat, pts_hi=None):
    """extrudes a 2d outline along `axis` from lo to hi (metres).
    axis X: points are (y, z). axis Y: (x, z). axis Z: (x, y).
    pts_hi (same length) makes it a loft to a second outline at hi."""
    top_ = pts_hi if pts_hi is not None else pts
    assert len(top_) == len(pts)
    bm = bmesh.new()
    va = [bm.verts.new(_to3(axis, p[0], p[1], lo)) for p in pts]
    vb = [bm.verts.new(_to3(axis, p[0], p[1], hi_)) for p in top_]
    n = len(pts)
    bm.faces.new(va)
    bm.faces.new(list(reversed(vb)))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((va[i], va[j], vb[j], vb[i]))
    return _finish_bm(bm, name, [mat])


def loft(name, sections, axis, mat, cap=True):
    """skins a list of (t, pts) outlines with equal point counts along axis"""
    bm = bmesh.new()
    rings = [[bm.verts.new(_to3(axis, p[0], p[1], t)) for p in pts] for t, pts in sections]
    n = len(rings[0])
    for ra, rb in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((ra[i], ra[j], rb[j], rb[i]))
    if cap:
        bm.faces.new(rings[0])
        bm.faces.new(list(reversed(rings[-1])))
    return _finish_bm(bm, name, [mat])


def lathe_segments(segs, prof, ripple=None, ribs=None):
    """segment count for a lathe at the current detail level. 8 or fewer is
    a polygon on purpose (hex nuts), knurled and ribbed lathes keep theirs"""
    if segs <= 8 or ripple or ribs:
        return segs
    r = max((abs(p[0]) for p in prof), default=0.0) * 1000.0
    if r <= 0:
        return segs
    if LEVEL["hi"]:
        need, base, cap = _segs_for(r, LEVEL["tol_hi"]), segs * 2, 192
    else:
        need, base, cap = _segs_for(r, LEVEL["tol_lo"]), segs, 80
    n = min(cap, max(base, need))
    return int(math.ceil(n / 4.0)) * 4


def lathe(name, prof, segs, mat, axis="Y", center=(0.0, 0.0, 0.0), phase=0.0, ripple=None, scale_xz=(1.0, 1.0),
          closed=False, ribs=None):
    """revolves a (radius, t) profile around `axis` through `center`.
    radius 0 at an end makes a pole, otherwise the ends get n-gon caps.
    ripple=(depth_fraction) pulls every other vertex in for knurling.
    ribs=(count, depth, flat) makes rounded ribs: the radius dips by depth
    (metres) in a smooth cosine between ribs, flat is the share left round.
    closed=True treats the profile as a loop (rings, tubes) instead of capping."""
    segs = lathe_segments(segs, prof, ripple, ribs)
    bm = bmesh.new()
    rings = []
    for (r, t) in prof:
        if r <= 1e-7:
            rings.append([bm.verts.new(_axis_point(axis, 0.0, 0.0, t, center))])
            continue
        ring = []
        for k in range(segs):
            a = phase + 2 * math.pi * k / segs
            rr = r * (1.0 - ripple) if (ripple and k % 2 == 1) else r
            if ribs:
                count, depth, flat = ribs
                u = (a * count / (2 * math.pi)) % 1.0
                # 0 on the rib crest, 1 in the valley
                w = 0.0 if u < flat * 0.5 or u > 1.0 - flat * 0.5 else 0.5 - 0.5 * math.cos(
                    2 * math.pi * (u - flat * 0.5) / max(1e-6, 1.0 - flat))
                rr = r - depth * w
            u = rr * math.cos(a) * scale_xz[0]
            v = rr * math.sin(a) * scale_xz[1]
            ring.append(bm.verts.new(_axis_point(axis, u, v, t, center)))
        rings.append(ring)
    for ra, rb in zip(rings, rings[1:]):
        if len(ra) == 1 and len(rb) == 1:
            continue
        if len(ra) == 1:
            for k in range(segs):
                bm.faces.new((ra[0], rb[k], rb[(k + 1) % segs]))
        elif len(rb) == 1:
            for k in range(segs):
                bm.faces.new((ra[k], rb[0], ra[(k + 1) % segs]))
        else:
            for k in range(segs):
                k2 = (k + 1) % segs
                bm.faces.new((ra[k], ra[k2], rb[k2], rb[k]))
    if closed:
        ra, rb = rings[-1], rings[0]
        for k in range(segs):
            k2 = (k + 1) % segs
            bm.faces.new((ra[k], ra[k2], rb[k2], rb[k]))
        return _finish_bm(bm, name, [mat])
    if len(rings[0]) > 1:
        bm.faces.new(list(reversed(rings[0])))
    if len(rings[-1]) > 1:
        bm.faces.new(rings[-1])
    return _finish_bm(bm, name, [mat])


def _axis_point(axis, u, v, t, center):
    cx, cy, cz = center
    if axis == "Y":
        return (cx + u, cy + t, cz + v)
    if axis == "X":
        return (cx + t, cy + u, cz + v)
    return (cx + u, cy + v, cz + t)


def box(name, size, center, mat):
    sx, sy, sz = size
    x, y, z = center
    pts = [(y - sy / 2, z - sz / 2), (y + sy / 2, z - sz / 2), (y + sy / 2, z + sz / 2), (y - sy / 2, z + sz / 2)]
    return prism(name, pts, "X", x - sx / 2, x + sx / 2, mat)


def cylinder(name, radius, length, center, axis, segs, mat, phase=0.0):
    return lathe(name, [(radius, -length / 2), (radius, length / 2)], segs, mat, axis=axis, center=center, phase=phase)


def tube(name, p0, p1, r0, r1, segs, mat, prof=None):
    """tapered cylinder from p0 to p1 (metres). prof=[(r, t 0..1)] overrides the taper."""
    a, b = Vector(p0), Vector(p1)
    d = b - a
    length = d.length
    prof = prof or [(r0, 0.0), (r1, 1.0)]
    obj = lathe(name, [(r, t * length) for r, t in prof], segs, mat, axis="Z")
    rot = d.normalized().to_track_quat("Z", "Y").to_matrix().to_4x4()
    return transform(obj, Matrix.Translation(a) @ rot)


def sphere(name, center, radius, segs, mat, rings=None, scale=(1.0, 1.0, 1.0)):
    segs = lathe_segments(segs, [(radius, 0.0)])
    rings = rings or max(4, segs // 2)
    prof = [(radius * math.sin(math.pi * i / rings), -radius * math.cos(math.pi * i / rings)) for i in range(rings + 1)]
    prof[0] = (0.0, prof[0][1])
    prof[-1] = (0.0, prof[-1][1])
    obj = lathe(name, prof, segs, mat, axis="Z")
    return transform(obj, Matrix.Translation(Vector(center)) @ Matrix.Diagonal((*scale, 1.0)))


def transform(obj, matrix):
    obj.data.transform(matrix)
    obj.data.update()
    return obj


def rotate(obj, angle_deg, axis, pivot):
    """rotates mesh data about an axis through pivot (world space)"""
    p = Vector(pivot)
    m = Matrix.Translation(p) @ Matrix.Rotation(math.radians(angle_deg), 4, axis) @ Matrix.Translation(-p)
    return transform(obj, m)


def mirror_x(obj, name):
    """mirrored copy across the x=0 plane"""
    new = obj.copy()
    new.data = obj.data.copy()
    new.name = name
    bpy.context.scene.collection.objects.link(new)
    new.data.transform(Matrix.Scale(-1, 4, (1, 0, 0)))
    new.data.flip_normals()
    new.data.update()
    return new


def copy(obj, name, offset=(0, 0, 0)):
    new = obj.copy()
    new.data = obj.data.copy()
    new.name = name
    bpy.context.scene.collection.objects.link(new)
    new.data.transform(Matrix.Translation(Vector(offset)))
    return new


def delete(obj):
    mesh = obj.data if obj.type == "MESH" else None
    bpy.data.objects.remove(obj, do_unlink=True)
    if mesh is not None and mesh.users == 0:
        bpy.data.meshes.remove(mesh)


# ---------------------------------------------------------------- modifiers

def apply_modifiers(obj):
    """bakes the modifier stack into the mesh (keeps custom normals)"""
    if not obj.modifiers:
        return obj
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    mesh = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    old = obj.data
    obj.modifiers.clear()
    obj.data = mesh
    if old.users == 0:
        bpy.data.meshes.remove(old)
    mesh.name = obj.name
    return obj


def boolean(target, cutters, op="DIFFERENCE", solver="EXACT", transfer_material=False):
    """applies a boolean with one or more cutter objects, then deletes them.
    transfer_material=True gives the new cut faces the cutter's material."""
    if not isinstance(cutters, (list, tuple)):
        cutters = [cutters]
    if not cutters:
        return target
    cutter = join(cutters, target.name + "_cutter", sharp=False) if len(cutters) > 1 else cutters[0]
    mod = target.modifiers.new("bool", "BOOLEAN")
    mod.operation = op
    mod.solver = solver
    mod.object = cutter
    if solver == "EXACT":
        mod.use_self = False
        mod.use_hole_tolerant = False
        mod.material_mode = "TRANSFER" if transfer_material else "INDEX"
    cutter.hide_render = True
    apply_modifiers(target)
    delete(cutter)
    return target


def bevel_segments(width, segs):
    """bevel segments at the current detail level: the low poly rounds the
    bigger edges, the high poly rounds everything for the bake"""
    w = width * 1000.0
    if LEVEL["hi"]:
        return max(3, segs * 2, 5 if w >= 1.2 else 3)
    if w >= 2.0:
        return max(segs, 3)
    if w >= 0.8:
        return max(segs, 2)
    return segs


def mark_creases(obj, bevel_angle, lo_deg=10.0, min_width_mm=2.5, steep_deg=18.0, steep_width_mm=1.2):
    """creases under the bevel angle stay unbevelled. left smooth, a crease
    between two wide flat faces bends the normals across both of them (the
    deagle barrel's 28 degree flank shaded as a gradient that the bake then
    turned into triangle shaped streaks), so those shade sharp. narrow strips
    (fillet arcs, lathe segments) stay smooth"""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    lo, hi_ = math.radians(lo_deg), math.radians(bevel_angle)
    for e in bm.edges:
        if len(e.link_faces) != 2:
            continue
        a = e.calc_face_angle(0.0)
        if not lo < a < hi_:
            continue
        length = max(e.calc_length(), 1e-9)
        # fillet segments steeper than steep_deg only happen on small radii,
        # where the strips are narrower than steep_width_mm
        need = steep_width_mm if a >= math.radians(steep_deg) else min_width_mm
        wide = all(f.calc_area() / length > need * MM for f in e.link_faces)
        if wide:
            e.smooth = False
    bm.to_mesh(obj.data)
    bm.free()


def bevel(obj, width, segs=2, angle=30.0, material=-1, profile=0.5, harden=True, clamp=True):
    """angle-limited bevel with hardened normals, applied right away"""
    segs = bevel_segments(width, segs)
    for p in obj.data.polygons:
        p.use_smooth = True
    mark_creases(obj, angle)
    mod = obj.modifiers.new("bevel", "BEVEL")
    mod.width = width
    mod.segments = segs
    mod.limit_method = "ANGLE"
    mod.angle_limit = math.radians(angle)
    mod.profile = profile
    mod.material = material
    mod.harden_normals = harden
    mod.use_clamp_overlap = clamp
    mod.miter_outer = "MITER_ARC" if segs > 1 else "MITER_SHARP"
    apply_modifiers(obj)
    return obj


def weighted_normals(obj):
    for p in obj.data.polygons:
        p.use_smooth = True
    mod = obj.modifiers.new("wn", "WEIGHTED_NORMAL")
    mod.keep_sharp = True
    mod.weight = 50
    mod.mode = "FACE_AREA"
    apply_modifiers(obj)
    return obj


def mark_sharp_by_angle(obj, angle_deg=40.0):
    """smooth shading with sharp edges above an angle (for parts without bevels)"""
    mesh = obj.data
    for p in mesh.polygons:
        p.use_smooth = True
    mesh.set_sharp_from_angle(angle=math.radians(angle_deg))
    return obj


def auto_sharp(obj, angle_deg=40.0):
    """parts that never got a bevel (so no custom normals) shade smooth with
    sharp edges above an angle. without this a lathe's caps would shade as
    one smooth blob with its sides"""
    if obj.type != "MESH" or obj.data.has_custom_normals:
        return obj
    return mark_sharp_by_angle(obj, angle_deg)


# ---------------------------------------------------------------- scene graph

def join(objs, name, sharp=True):
    objs = [o for o in objs if o is not None]
    if sharp:
        for o in objs:
            auto_sharp(o)
    if len(objs) == 1:
        objs[0].name = name
        objs[0].data.name = name
        return objs[0]
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    active = objs[0]
    bpy.context.view_layer.objects.active = active
    with bpy.context.temp_override(active_object=active, selected_editable_objects=objs, selected_objects=objs):
        bpy.ops.object.join()
    active.name = name
    active.data.name = name
    # the join keeps uv layers from other objects but not the active flags,
    # which breaks normal map tangents and the gltf texcoord export
    uvs = active.data.uv_layers
    if len(uvs) and uvs.active is None:
        uvs.active = uvs[0]
    for layer in uvs:
        layer.active_render = layer == uvs.active
    return active


def empty(name, location=(0, 0, 0), rotation=(0, 0, 0), parent=None, size=0.01, extras=None):
    """empty whose world transform is `location`/`rotation` regardless of parent"""
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = "ARROWS"
    obj.empty_display_size = size
    bpy.context.scene.collection.objects.link(obj)
    world = Matrix.Translation(Vector(location)) @ _euler_matrix(rotation)
    if parent is not None:
        obj.parent = parent
        obj.matrix_parent_inverse = Matrix.Identity(4)
        obj.matrix_basis = parent.matrix_world.inverted() @ world
    else:
        obj.matrix_basis = world
    for key, value in (extras or {}).items():
        obj[key] = value
    bpy.context.view_layer.update()
    return obj


def _euler_matrix(rotation):
    from mathutils import Euler
    return Euler(rotation, "XYZ").to_matrix().to_4x4()


def pin_part(mesh_obj, name, pivot, parent, extras=None):
    """turns a mesh into a moving part: empty `name` on the pivot, geometry in
    child `<name>_mesh` with an identity local transform.

    gltf-transform's quantize() (run by meshopt) folds a scale and offset into
    the matrix of any mesh node that has no children, which would move the
    origin off the pivot. an empty with a mesh child keeps the pivot exact."""
    # rename first so the empty gets the plain name instead of name.001
    mesh_obj.name = name + "_mesh"
    mesh_obj.data.name = name + "_mesh"
    pivot_empty = empty(name, pivot, parent=parent, extras=extras)
    assert pivot_empty.name == name, f"name clash for {name}: got {pivot_empty.name}"
    mesh_obj.data.transform(Matrix.Translation(-Vector(pivot)))
    mesh_obj.data.update()
    mesh_obj.parent = pivot_empty
    mesh_obj.matrix_parent_inverse = Matrix.Identity(4)
    mesh_obj.matrix_basis = Matrix.Identity(4)
    return pivot_empty


def parent_static(mesh_obj, parent):
    mw = mesh_obj.matrix_world.copy()
    mesh_obj.parent = parent
    mesh_obj.matrix_parent_inverse = Matrix.Identity(4)
    mesh_obj.matrix_basis = parent.matrix_world.inverted() @ mw
    return mesh_obj


def shift_all(offset):
    """moves every mesh vertex by offset (used to put the origin on the grip)"""
    m = Matrix.Translation(Vector(offset))
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH" and obj.parent is None:
            obj.data.transform(m)


def tri_count(objs):
    total = 0
    for o in objs:
        if o.type != "MESH":
            continue
        for p in o.data.polygons:
            total += len(p.vertices) - 2
    return total


def mesh_objects():
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


# ---------------------------------------------------------------- cycles

def use_cycles(device="GPU", samples=64):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    if device == "GPU":
        try:
            prefs.compute_device_type = "METAL"
            prefs.get_devices()
            for d in prefs.devices:
                d.use = True
            scene.cycles.device = "GPU"
        except Exception as exc:  # no metal, fall back to cpu
            print(f"[wlib] gpu unavailable ({exc}), using cpu")
            scene.cycles.device = "CPU"
    else:
        scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    return scene


# ---------------------------------------------------------------- uv atlas

def _mode(mode):
    if bpy.context.object is not None and bpy.context.object.mode != mode:
        bpy.ops.object.mode_set(mode=mode)


def _select_only(objs):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def uv_islands(bm, uv):
    """faces grouped into uv islands (connected through edges whose two
    corners match in uv on both faces)"""
    parent = list(range(len(bm.faces)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    bm.faces.ensure_lookup_table()
    for e in bm.edges:
        if len(e.link_faces) != 2:
            continue
        f1, f2 = e.link_faces
        ok = True
        for v in e.verts:
            l1 = next(lp for lp in f1.loops if lp.vert == v)
            l2 = next(lp for lp in f2.loops if lp.vert == v)
            if (l1[uv].uv - l2[uv].uv).length_squared > 1e-12:
                ok = False
                break
        if ok:
            a, b = find(f1.index), find(f2.index)
            if a != b:
                parent[a] = b
    groups = {}
    for f in bm.faces:
        groups.setdefault(find(f.index), []).append(f)
    return list(groups.values())


def uv_atlas(objs, weight=None, margin=0.003, angle=66.0, concave=True):
    """one uv atlas across several objects. smart project finds the islands,
    they are re-unwrapped with minimum stretch, scaled to equal texel density
    times weight(obj, centre_world, material_name), then packed together."""
    t0 = time.time()
    for o in objs:
        me = o.data
        while me.uv_layers:
            me.uv_layers.remove(me.uv_layers[0])
        me.uv_layers.new(name="UVMap")
    _select_only(objs)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.mark_seam(clear=True)
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=0.0, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.seams_from_islands()
    bpy.ops.uv.unwrap(method="ANGLE_BASED", fill_holes=True, margin=0.0)
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode="OBJECT")
    islands = 0
    if weight is not None:
        for o in objs:
            bm = bmesh.new()
            bm.from_mesh(o.data)
            uv = bm.loops.layers.uv.active
            mw = o.matrix_world
            groups = uv_islands(bm, uv)
            islands += len(groups)
            for faces in groups:
                area, c3, mats = 0.0, Vector(), {}
                for f in faces:
                    a = f.calc_area()
                    area += a
                    c3 += (mw @ f.calc_center_median()) * a
                    m = o.data.materials[f.material_index] if f.material_index < len(o.data.materials) else None
                    key = m.name if m is not None else ""
                    mats[key] = mats.get(key, 0.0) + a
                c3 /= max(area, 1e-12)
                mat_name = max(mats.items(), key=lambda kv: kv[1])[0]
                w = weight(o, c3, mat_name)
                s = math.sqrt(max(w, 1e-3))
                cu = Vector((0.0, 0.0))
                n = 0
                for f in faces:
                    for lp in f.loops:
                        cu += lp[uv].uv
                        n += 1
                cu /= max(n, 1)
                for f in faces:
                    for lp in f.loops:
                        lp[uv].uv = cu + (lp[uv].uv - cu) * s
            bm.to_mesh(o.data)
            bm.free()
    _select_only(objs)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(rotate=True, scale=True, margin_method="FRACTION", margin=margin,
                            shape_method="CONCAVE" if concave else "CONVEX")
    bpy.ops.object.mode_set(mode="OBJECT")
    used = 0.0
    for o in objs:
        me = o.data
        uvl = me.uv_layers.active.data
        for p in me.polygons:
            if len(p.loop_indices) < 3:
                continue
            pts = [uvl[li].uv for li in p.loop_indices]
            a = 0.0
            for i in range(len(pts)):
                x1, y1 = pts[i]
                x2, y2 = pts[(i + 1) % len(pts)]
                a += x1 * y2 - x2 * y1
            used += abs(a) * 0.5
    print(f"[wlib] uv atlas: {islands} islands, {used * 100:.0f}% of the square used, {time.time() - t0:.1f} s")
    return used


def texel_density(objs, size):
    """average texels per millimetre over the atlas"""
    area3 = areauv = 0.0
    for o in objs:
        me = o.data
        uvl = me.uv_layers.active.data
        for p in me.polygons:
            area3 += p.area
            pts = [uvl[li].uv for li in p.loop_indices]
            a = 0.0
            for i in range(len(pts)):
                x1, y1 = pts[i]
                x2, y2 = pts[(i + 1) % len(pts)]
                a += x1 * y2 - x2 * y1
            areauv += abs(a) * 0.5
    return math.sqrt(areauv * size * size / max(area3 * 1e6, 1e-12))


# ---------------------------------------------------------------- bake shaders

RAY_VIS = ("visible_camera", "visible_diffuse", "visible_glossy", "visible_transmission", "visible_volume_scatter",
           "visible_shadow")


def ray_visible(obj, on):
    for a in RAY_VIS:
        setattr(obj, a, on)


def _group(name):
    """node group lookup, None if it doesn't exist yet"""
    return bpy.data.node_groups.get(name)


def _img(path, colorspace="Non-Color"):
    img = bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = colorspace
    return img


def triplanar_group(name, image_path, scale):
    """object space triplanar lookup of a grayscale texture. the x and z
    facing projections run the texture's u along +y (the bore), so brushed
    streaks follow the barrel on the sides and the top"""
    ng = _group(name)
    if ng is not None:
        return ng
    ng = bpy.data.node_groups.new(name, "ShaderNodeTree")
    ng.interface.new_socket(name="Value", in_out="OUTPUT", socket_type="NodeSocketFloat")
    n, lk = ng.nodes, ng.links
    out = n.new("NodeGroupOutput")
    tc = n.new("ShaderNodeTexCoord")
    sep = n.new("ShaderNodeSeparateXYZ")
    lk.new(tc.outputs["Object"], sep.inputs[0])
    nsep = n.new("ShaderNodeSeparateXYZ")
    lk.new(tc.outputs["Normal"], nsep.inputs[0])
    img = _img(image_path)
    weights = []
    samples = []
    # (normal axis, u axis, v axis)
    for axis, ua, va in ((0, 1, 2), (1, 0, 2), (2, 1, 0)):
        comb = n.new("ShaderNodeCombineXYZ")
        lk.new(sep.outputs[ua], comb.inputs[0])
        lk.new(sep.outputs[va], comb.inputs[1])
        mp = n.new("ShaderNodeVectorMath")
        mp.operation = "SCALE"
        mp.inputs[3].default_value = scale
        lk.new(comb.outputs[0], mp.inputs[0])
        tex = n.new("ShaderNodeTexImage")
        tex.image = img
        tex.extension = "REPEAT"
        lk.new(mp.outputs[0], tex.inputs["Vector"])
        samples.append(tex)
        ab = n.new("ShaderNodeMath")
        ab.operation = "ABSOLUTE"
        lk.new(nsep.outputs[axis], ab.inputs[0])
        pw = n.new("ShaderNodeMath")
        pw.operation = "POWER"
        pw.inputs[1].default_value = 4.0
        lk.new(ab.outputs[0], pw.inputs[0])
        weights.append(pw)
    s01 = n.new("ShaderNodeMath")
    s01.operation = "ADD"
    lk.new(weights[0].outputs[0], s01.inputs[0])
    lk.new(weights[1].outputs[0], s01.inputs[1])
    wsum = n.new("ShaderNodeMath")
    wsum.operation = "ADD"
    lk.new(s01.outputs[0], wsum.inputs[0])
    lk.new(weights[2].outputs[0], wsum.inputs[1])
    acc = None
    for tex, w in zip(samples, weights):
        m = n.new("ShaderNodeMath")
        m.operation = "MULTIPLY"
        lk.new(tex.outputs["Color"], m.inputs[0])
        lk.new(w.outputs[0], m.inputs[1])
        if acc is None:
            acc = m
        else:
            a = n.new("ShaderNodeMath")
            a.operation = "ADD"
            lk.new(acc.outputs[0], a.inputs[0])
            lk.new(m.outputs[0], a.inputs[1])
            acc = a
    div = n.new("ShaderNodeMath")
    div.operation = "DIVIDE"
    lk.new(acc.outputs[0], div.inputs[0])
    lk.new(wsum.outputs[0], div.inputs[1])
    lk.new(div.outputs[0], out.inputs["Value"])
    return ng


def _noise(n, lk, coord, scale, detail=6.0, roughness=0.55, distortion=0.0, stretch=None):
    src = coord
    if stretch is not None:
        mp = n.new("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = stretch
        lk.new(coord, mp.inputs["Vector"])
        src = mp.outputs[0]
    tex = n.new("ShaderNodeTexNoise")
    tex.inputs["Scale"].default_value = scale
    tex.inputs["Detail"].default_value = detail
    tex.inputs["Roughness"].default_value = roughness
    tex.inputs["Distortion"].default_value = distortion
    lk.new(src, tex.inputs["Vector"])
    return tex.outputs["Fac"]


def _rgb(n, lk, r, g, b):
    """combine three float sockets or constants into a colour socket"""
    comb = n.new("ShaderNodeCombineColor")
    for sock, v in zip(("Red", "Green", "Blue"), (r, g, b)):
        if isinstance(v, (int, float)):
            comb.inputs[sock].default_value = float(v)
        else:
            lk.new(v, comb.inputs[sock])
    return comb.outputs[0]


def _ao(n, lk, distance, inside=False, local=True, samples=16):
    ao = n.new("ShaderNodeAmbientOcclusion")
    ao.inputs["Distance"].default_value = distance
    ao.inside = inside
    ao.only_local = local
    ao.samples = samples
    return ao.outputs["AO"]


def _one_minus(n, lk, sock):
    m = n.new("ShaderNodeMath")
    m.operation = "SUBTRACT"
    m.inputs[0].default_value = 1.0
    lk.new(sock, m.inputs[1])
    return m.outputs[0]


def _bump_height(n, lk, spec):
    """height socket for a finish's micro surface, or None"""
    kind = spec["bump"]
    if not kind:
        return None, 0.0
    tc = n.new("ShaderNodeTexCoord")
    s = spec["bump_scale"]
    if kind == "stipple":
        # raised pebbles about a millimetre across
        vor = n.new("ShaderNodeTexVoronoi")
        vor.feature = "F1"
        vor.inputs["Scale"].default_value = 900.0 / s
        vor.inputs["Randomness"].default_value = 0.85
        lk.new(tc.outputs["Object"], vor.inputs["Vector"])
        m = n.new("ShaderNodeMapRange")
        m.inputs["From Min"].default_value = 0.05
        m.inputs["From Max"].default_value = 0.55
        m.inputs["To Min"].default_value = 1.0
        m.inputs["To Max"].default_value = 0.0
        lk.new(vor.outputs["Distance"], m.inputs["Value"])
        p = n.new("ShaderNodeMath")
        p.operation = "POWER"
        p.inputs[1].default_value = 0.6
        lk.new(m.outputs[0], p.inputs[0])
        return p.outputs[0], 0.00022 * spec["bump_depth"]
    if kind == "grain":
        # fine moulded or rubber texture
        return _noise(n, lk, tc.outputs["Object"], 2600.0 / s, detail=3.0, roughness=0.6), 0.00005 * spec["bump_depth"]
    if kind == "cast":
        return _noise(n, lk, tc.outputs["Object"], 700.0 / s, detail=4.0, roughness=0.5), 0.00003 * spec["bump_depth"]
    raise ValueError(kind)


def _reset_tree(mat):
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    return nt.nodes, nt.links, out


def pass_shader(mat, kind, tex_paths):
    """rebuilds a finish material's node tree for one bake pass"""
    spec = SPECS.get(mat.name)
    if spec is None:
        spec = dict(SPEC_DEFAULTS, wear_color=0x808080, wear_rough=0.5, wear_metal=0.0)
    n, lk, out = _reset_tree(mat)
    if kind == "normal":
        bsdf = n.new("ShaderNodeBsdfPrincipled")
        lk.new(bsdf.outputs[0], out.inputs["Surface"])
        h, dist = _bump_height(n, lk, spec)
        if h is not None:
            bump = n.new("ShaderNodeBump")
            bump.inputs["Strength"].default_value = 1.0
            bump.inputs["Distance"].default_value = dist
            lk.new(h, bump.inputs["Height"])
            lk.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
        return
    em = n.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = 1.0
    lk.new(em.outputs[0], out.inputs["Surface"])
    col = None
    if kind == "cov":
        col = _rgb(n, lk, 1.0, 1.0, 1.0)
    elif kind == "base":
        col = _rgb(n, lk, *srgb(spec["base"]))
    elif kind == "wearc":
        col = _rgb(n, lk, *srgb(spec["wear_color"]))
    elif kind == "prm":
        col = _rgb(n, lk, spec["rough"], spec["metal"], spec["wear"])
    elif kind == "prm2":
        col = _rgb(n, lk, spec["wear_rough"], spec["wear_metal"], spec["grime"])
    elif kind == "prm3":
        col = _rgb(n, lk, spec["rvar"], spec["scratch"], 1.0 if spec["detail"] == "brushed" else 0.0)
    elif kind == "masks":
        # r: ao against every part, g: convex edges (occlusion from inside),
        # b: cavities (short range occlusion)
        ao = _ao(n, lk, 0.012, local=False, samples=12)
        edge = _one_minus(n, lk, _ao(n, lk, 0.0009, inside=True, samples=12))
        cav = _one_minus(n, lk, _ao(n, lk, 0.0022, samples=12))
        col = _rgb(n, lk, ao, edge, cav)
    elif kind == "detail":
        scr = n.new("ShaderNodeGroup")
        scr.node_tree = triplanar_group("tri_scratches", tex_paths["scratches"], 1.0 / 0.16)
        brushed = n.new("ShaderNodeGroup")
        brushed.node_tree = triplanar_group("tri_brushed", tex_paths["brushed"], 1.0 / 0.09)
        plastic = n.new("ShaderNodeGroup")
        plastic.node_tree = triplanar_group("tri_plastic", tex_paths["plastic"], 1.0 / 0.12)
        col = _rgb(n, lk, scr.outputs[0], brushed.outputs[0], plastic.outputs[0])
    elif kind == "noise":
        tc = n.new("ShaderNodeTexCoord")
        o = tc.outputs["Object"]
        grunge = _noise(n, lk, o, 28.0, detail=8.0, roughness=0.62)
        smudge = _noise(n, lk, o, 55.0, detail=4.0, roughness=0.5, distortion=0.6, stretch=(1.0, 0.45, 1.0))
        fine = _noise(n, lk, o, 420.0, detail=5.0, roughness=0.6)
        col = _rgb(n, lk, grunge, smudge, fine)
    else:
        raise ValueError(kind)
    lk.new(col, em.inputs["Color"])


# ---------------------------------------------------------------- baking

class Baker:
    """bakes high poly parts onto the shared uv atlas of their low poly parts.
    parts are (low, high, isolate): an isolated part (a magazine that drops
    out) only occludes itself. low polys are hidden from rays while baking so
    only the high poly casts ao."""

    def __init__(self, parts, size, cage_mm=0.3, reach_mm=0.8, margin=8):
        import numpy as np  # noqa: F401  (blender ships numpy)
        self.parts = parts
        self.size = size
        self.cage = cage_mm * MM
        self.reach = reach_mm * MM
        self.margin = margin
        self.target = bpy.data.materials.new("_bake_target")
        n, lk, out = _reset_tree(self.target)
        self.tex = n.new("ShaderNodeTexImage")
        n.active = self.tex
        self.saved_mats = {}
        for low, _, _ in parts:
            me = low.data
            self.saved_mats[low.name] = [m for m in me.materials]
            me.materials.clear()
            me.materials.append(self.target)
            for p in me.polygons:
                p.material_index = 0
            ray_visible(low, False)
        scene = use_cycles("GPU", 16)
        scene.render.bake.margin_type = "ADJACENT_FACES"
        scene.cycles.use_denoising = False
        self.high_mats = sorted({m for _, h, _ in parts for m in h.data.materials if m is not None},
                                key=lambda m: m.name)
        self.times = {}

    def run(self, kind, samples, tex_paths=None):
        import numpy as np
        t0 = time.time()
        for m in self.high_mats:
            pass_shader(m, kind, tex_paths or {})
        img = bpy.data.images.new(f"bake_{kind}", self.size, self.size, alpha=True, float_buffer=True)
        img.colorspace_settings.name = "Non-Color"
        self.tex.image = img
        scene = bpy.context.scene
        scene.cycles.samples = samples
        bake_type = "NORMAL" if kind == "normal" else "EMIT"
        highs = [h for _, h, _ in self.parts]
        for i, (low, high, isolate) in enumerate(self.parts):
            hidden = []
            if isolate:
                for h in highs:
                    if h is not high:
                        ray_visible(h, False)
                        hidden.append(h)
            _select_only([low, high])
            bpy.context.view_layer.objects.active = low
            kwargs = dict(type=bake_type, use_selected_to_active=True, cage_extrusion=self.cage,
                          max_ray_distance=self.reach, margin=self.margin, margin_type="ADJACENT_FACES",
                          use_clear=(i == 0),
                          target="IMAGE_TEXTURES")
            if bake_type == "NORMAL":
                kwargs.update(normal_space="TANGENT", normal_r="POS_X", normal_g="POS_Y", normal_b="POS_Z")
            bpy.ops.object.bake(**kwargs)
            for h in hidden:
                ray_visible(h, True)
        px = np.array(img.pixels[:], dtype=np.float32).reshape(self.size, self.size, 4)
        bpy.data.images.remove(img)
        self.times[kind] = time.time() - t0
        print(f"[wlib] baked {kind} in {self.times[kind]:.1f} s")
        return px

    def finish(self, atlas_mat):
        for low, _, _ in self.parts:
            ray_visible(low, True)
            me = low.data
            me.materials.clear()
            me.materials.append(atlas_mat)
            for p in me.polygons:
                p.material_index = 0
        bpy.data.materials.remove(self.target)


def bake_all(parts, size, tex_paths, samples_ao=96, **kw):
    """every pass compose_textures needs, as float arrays (blender row order)"""
    b = Baker(parts, size, **kw)
    passes = {}
    for kind, samples in (("cov", 1), ("base", 6), ("wearc", 6), ("prm", 6), ("prm2", 6), ("prm3", 6),
                          ("detail", 8), ("noise", 6), ("masks", samples_ao), ("normal", 16)):
        passes[kind] = b.run(kind, samples, tex_paths)
    return b, passes


# ---------------------------------------------------------------- compositing

def _smoothstep(e0, e1, x):
    import numpy as np
    t = np.clip((x - e0) / max(e1 - e0, 1e-6), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _to_srgb(c):
    import numpy as np
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1.0 / 2.4) - 0.055)


def _blur(x, radius):
    """cheap separable box blur (edge clamped), radius in pixels"""
    import numpy as np
    if radius <= 0:
        return x
    k = 2 * radius + 1
    for axis in (0, 1):
        pad = [(0, 0)] * x.ndim
        pad[axis] = (radius, radius)
        p = np.pad(x, pad, mode="edge")
        c = np.cumsum(p, axis=axis, dtype=np.float64)
        zero = np.zeros_like(np.take(c, [0], axis=axis))
        c = np.concatenate([zero, c], axis=axis)
        hi_ = np.take(c, np.arange(k, c.shape[axis]), axis=axis)
        lo = np.take(c, np.arange(0, c.shape[axis] - k), axis=axis)
        x = ((hi_ - lo) / k).astype(np.float32)
    return x


def dilate(arr, mask, iters=48):
    """grows the texels under mask outward into the empty ones (average of the
    filled 4-neighbours per step), then fills whatever is left with the mean"""
    import numpy as np
    out = arr.copy()
    filled = mask.copy()
    for _ in range(iters):
        acc = np.zeros_like(out)
        cnt = np.zeros(filled.shape, dtype=np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            f = np.roll(filled, (dy, dx), axis=(0, 1))
            acc += np.roll(out, (dy, dx), axis=(0, 1)) * f[..., None]
            cnt += f
        grow = (~filled) & (cnt > 0)
        if not grow.any():
            break
        out[grow] = acc[grow] / cnt[grow][..., None]
        filled = filled | grow
    out[~filled] = out[mask].mean(axis=0)
    return out


def compose_textures(P, name, look=None):
    """turns the bake passes into (base colour srgb, orm, normal) float arrays.
    look tweaks the wear, grime and breakup strengths for one gun"""
    import numpy as np
    L = dict(edge_lo=0.06, edge_hi=0.4, edge_gain=1.0, breakup=0.85, scratch_wear=0.45, grime=0.5, ao_albedo=0.3,
             value_var=0.1, smudge=0.7, ao_floor=0.15, scratch_rough=0.12)
    L.update(look or {})
    cov = P["cov"][..., 0] > 0.5
    base = P["base"][..., :3]
    wearc = P["wearc"][..., :3]
    rough0, metal0, wear_amt = (P["prm"][..., i] for i in range(3))
    wrough, wmetal, grime = (P["prm2"][..., i] for i in range(3))
    rvar, scr_amt, brushed_kind = (P["prm3"][..., i] for i in range(3))
    ao, edge, cav = (P["masks"][..., i] for i in range(3))
    scr, brushed, plastic = (P["detail"][..., i] for i in range(3))
    grunge, smudge, fine = (P["noise"][..., i] for i in range(3))

    def norm(x, lo=2.0, hi_=98.0):
        a, b = np.percentile(x[cov], [lo, hi_])
        return np.clip((x - a) / max(b - a, 1e-6), 0.0, 1.0)

    grunge, smudge, fine = norm(grunge), norm(smudge), norm(fine)
    brushed, plastic = norm(brushed), norm(plastic)
    scr = np.clip(scr, 0.0, 1.0)
    # the ao bake is a little noisy, soften it over a couple of texels
    ao = np.clip(_blur(ao, 1), 0.0, 1.0)
    edge = np.clip(_blur(edge, 1), 0.0, 1.0)
    cav = np.clip(_blur(cav, 1), 0.0, 1.0)

    # edge wear: convex edges broken up by low frequency noise, plus scratches
    e = _smoothstep(L["edge_lo"], L["edge_hi"], edge) * L["edge_gain"]
    breakup = _smoothstep(0.25, 0.75, grunge * 0.65 + fine * 0.35)
    wear = np.clip(e * (1.0 - L["breakup"] + L["breakup"] * 1.6 * breakup), 0.0, 1.0)
    wear = np.clip(wear + scr * scr_amt * L["scratch_wear"], 0.0, 1.0) * wear_amt
    c = _smoothstep(0.08, 0.55, cav)

    # finishes without grime (lens glass) stay clean: no ao or noise in the
    # colour, and a smooth ao so a lens deep in its tube doesn't come out blotchy
    dirt = np.clip(grime * 4.0, 0.0, 1.0)
    clean = grime < 0.02
    ao = np.where(clean, _blur(ao, 8), ao)
    col = base * (1.0 - wear[..., None]) + wearc * wear[..., None]
    col *= (1.0 - grime * L["grime"] * c)[..., None]
    col *= (1.0 - L["ao_albedo"] * dirt + L["ao_albedo"] * dirt * ao)[..., None]
    col *= (1.0 - (L["value_var"] * 0.5 - L["value_var"] * grunge) * dirt)[..., None]

    det = np.where(brushed_kind > 0.5, brushed, plastic)
    r = rough0 + rvar * 2.0 * (det - 0.5) + rvar * L["smudge"] * (smudge - 0.5)
    r = r + scr * scr_amt * L["scratch_rough"] * (1.0 - 0.6 * metal0)
    r = r * (1.0 - wear) + wrough * wear
    r = r + grime * 0.12 * c
    r = np.clip(r, 0.05, 1.0)
    m = np.clip(metal0 * (1.0 - wear) + wmetal * wear, 0.0, 1.0)
    occ = np.clip(L["ao_floor"] + (1.0 - L["ao_floor"]) * ao, 0.0, 1.0)

    nrm = P["normal"][..., :3].copy()
    # lens glass is a smooth dome with no detail to bake. the high to low poly
    # difference only added ripples, and ao deep in the tube made it blotchy,
    # so clean finishes get flat normals, no ao and their plain roughness
    nrm[clean] = (0.5, 0.5, 1.0)
    occ = np.where(clean, 1.0, occ)
    r = np.where(clean, np.clip(rough0, 0.05, 1.0), r)

    # empty texels take their neighbours' values, so mips and ktx2 blocks that
    # straddle an island edge don't pull in a foreign colour
    base_srgb = dilate(_to_srgb(col), cov)
    orm = dilate(np.stack([occ, r, m], axis=-1), cov)
    nrm = dilate(nrm, cov)
    stats = dict(coverage=float(cov.mean()), rough=(float(r[cov].min()), float(r[cov].mean()), float(r[cov].max())),
                 wear=float((wear[cov] > 0.3).mean()), ao=float(ao[cov].mean()))
    print(f"[wlib] {name} textures: {stats}")
    return base_srgb, orm, nrm


def downsample(arr, size, normal=False):
    """box filter down to size x size. normal maps are averaged as vectors and
    renormalised, so the bake at 2x resolution comes out antialiased"""
    import numpy as np
    k = arr.shape[0] // size
    if k <= 1:
        return arr
    h, w, c = arr.shape
    x = arr[..., :3].astype(np.float32)
    if normal:
        x = x * 2.0 - 1.0
    x = x.reshape(size, k, size, k, 3).mean(axis=(1, 3))
    if normal:
        x /= np.maximum(np.linalg.norm(x, axis=-1, keepdims=True), 1e-6)
        x = x * 0.5 + 0.5
    return x


def save_png(arr, name, colorspace):
    """float rgb array (blender row order) -> 8 bit png in TMP, returns the image"""
    import numpy as np
    h, w = arr.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=False, float_buffer=False)
    img.colorspace_settings.name = colorspace
    rgba = np.concatenate([arr[..., :3], np.ones((h, w, 1), dtype=np.float32)], axis=-1)
    img.pixels.foreach_set(np.clip(rgba, 0.0, 1.0).astype(np.float32).ravel())
    os.makedirs(TMP, exist_ok=True)
    img.filepath_raw = os.path.join(TMP, f"{name}.png")
    img.file_format = "PNG"
    img.save()
    img.pack()
    return img


def gltf_output_group():
    """the node group the gltf exporter reads the occlusion texture from"""
    ng = _group("glTF Material Output")
    if ng is None:
        ng = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        ng.interface.new_socket(name="Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
        ng.nodes.new("NodeGroupInput")
    return ng


def atlas_material(name, base_img, orm_img, normal_img):
    """one pbr material with the baked maps, laid out the way the gltf
    exporter maps it: orm r -> occlusion, g -> roughness, b -> metalness"""
    mat = bpy.data.materials.new(name)
    # closed solids: single sided keeps the gpu from shading back faces
    mat.use_backface_culling = True
    n, lk, out = _reset_tree(mat)
    bsdf = n.new("ShaderNodeBsdfPrincipled")
    lk.new(bsdf.outputs[0], out.inputs["Surface"])
    uvn = n.new("ShaderNodeUVMap")
    uvn.uv_map = "UVMap"
    tb = n.new("ShaderNodeTexImage")
    tb.image = base_img
    lk.new(uvn.outputs["UV"], tb.inputs["Vector"])
    lk.new(tb.outputs["Color"], bsdf.inputs["Base Color"])
    to = n.new("ShaderNodeTexImage")
    to.image = orm_img
    lk.new(uvn.outputs["UV"], to.inputs["Vector"])
    sep = n.new("ShaderNodeSeparateColor")
    lk.new(to.outputs["Color"], sep.inputs["Color"])
    lk.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    lk.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    grp = n.new("ShaderNodeGroup")
    grp.node_tree = gltf_output_group()
    lk.new(sep.outputs["Red"], grp.inputs["Occlusion"])
    tn = n.new("ShaderNodeTexImage")
    tn.image = normal_img
    lk.new(uvn.outputs["UV"], tn.inputs["Vector"])
    nm = n.new("ShaderNodeNormalMap")
    nm.uv_map = "UVMap"
    lk.new(tn.outputs["Color"], nm.inputs["Color"])
    lk.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def triangulate(obj):
    """triangles before the unwrap: the bake, the gltf tangents and three.js
    then all see the same faces (n-gons can't get mikktspace tangents)"""
    mod = obj.modifiers.new("tri", "TRIANGULATE")
    mod.quad_method = "BEAUTY"
    mod.ngon_method = "BEAUTY"
    mod.keep_custom_normals = True
    apply_modifiers(obj)
    return obj


def texture_set(lows, highs, name, size, weight, look=None, samples_ao=96, isolate=(), margin_px=3,
                pack_margin=0.003, out_sizes=(1024, 1024, 512)):
    """uv atlas for the low polys, bakes from the high polys, composed maps and
    the atlas material on every low poly. highs maps low name -> high object.
    bakes run at `size` and are box filtered down to out_sizes (base colour,
    normal, orm), the sizes that ship"""
    t0 = time.time()
    for lo in lows:
        triangulate(lo)
    uv_atlas(lows, weight=weight, margin=pack_margin)
    print(f"[wlib] {name}: {texel_density(lows, size):.1f} texels per mm on average")
    tex_paths = {
        "scratches": os.path.join(TEXTURES, "scratches.jpg"),
        "brushed": os.path.join(TEXTURES, "brushed_steel_rough.jpg"),
        "plastic": os.path.join(TEXTURES, "plastic_rough.jpg"),
    }
    parts = [(lo, highs[lo.name], lo.name in isolate) for lo in lows]
    baker, P = bake_all(parts, size, tex_paths, samples_ao=samples_ao, margin=margin_px)
    base, orm, nrm = compose_textures(P, name, look)
    base = downsample(base, out_sizes[0])
    nrm = downsample(nrm, out_sizes[1], normal=True)
    orm = downsample(orm, out_sizes[2])
    base_img = save_png(base, f"{name}_basecolor", "sRGB")
    orm_img = save_png(orm, f"{name}_orm", "Non-Color")
    nrm_img = save_png(nrm, f"{name}_normal", "Non-Color")
    mat = atlas_material(f"mat_{name}", base_img, orm_img, nrm_img)
    baker.finish(mat)
    print(f"[wlib] {name}: texture set done in {time.time() - t0:.0f} s")
    return mat, P


def delete_high(highs):
    for h in list(highs.values()):
        delete(h)


# ---------------------------------------------------------------- ambient occlusion (vertex, --quick previews)

def bake_ao(objs, distance, samples=96, strength=1.0, floor=0.18, isolate=False):
    """cycles ao bake into a corner colour attribute that exports as COLOR_0.
    isolate=True hides everything else so a moving part only shadows itself."""
    scene = use_cycles("CPU", samples)
    if scene.world is None:
        scene.world = bpy.data.worlds.new("BakeWorld")
    scene.world.light_settings.distance = distance
    scene.render.bake.target = "VERTEX_COLORS"
    hidden = []
    if isolate:
        for o in mesh_objects():
            if o not in objs and not o.hide_render:
                o.hide_render = True
                hidden.append(o)
    for o in objs:
        attrs = o.data.color_attributes
        attr = attrs.get("ao") or attrs.new(name="ao", type="FLOAT_COLOR", domain="CORNER")
        attrs.active_color = attr
        attrs.render_color_index = attrs.active_color_index
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.bake(type="AO", target="VERTEX_COLORS")
    for o in hidden:
        o.hide_render = False
    for o in objs:
        attr = o.data.color_attributes["ao"]
        for d in attr.data:
            ao = d.color[0]
            v = 1.0 - strength * (1.0 - ao)
            v = max(floor, min(1.0, v))
            d.color = (v, v, v, 1.0)
        merge_corner_colors(o, "ao")


def merge_corner_colors(obj, name):
    """averages a corner colour over corners that share a vertex and a normal.
    the gltf exporter splits a vertex for every distinct attribute combination,
    so per-corner ao would otherwise split almost every vertex."""
    mesh = obj.data
    attr = mesh.color_attributes[name]
    normals = mesh.corner_normals
    groups = {}
    for li, loop in enumerate(mesh.loops):
        n = normals[li].vector
        key = (loop.vertex_index, round(n.x, 3), round(n.y, 3), round(n.z, 3))
        groups.setdefault(key, []).append(li)
    for corners in groups.values():
        if len(corners) < 2:
            continue
        v = sum(attr.data[li].color[0] for li in corners) / len(corners)
        for li in corners:
            attr.data[li].color = (v, v, v, 1.0)


def ao_stats(obj):
    attr = obj.data.color_attributes.get("ao")
    if attr is None:
        return None
    vals = [d.color[0] for d in attr.data]
    return min(vals), sum(vals) / max(1, len(vals))


# ---------------------------------------------------------------- uv

def box_uv(obj, scale, material_names=None):
    """planar uv per face by its dominant normal axis, `scale` metres per tile"""
    mesh = obj.data
    if not mesh.uv_layers:
        mesh.uv_layers.new(name="UVMap")
    uv = mesh.uv_layers.active.data
    names = set(material_names or [])
    for poly in mesh.polygons:
        if names:
            mat = mesh.materials[poly.material_index]
            if mat is None or mat.name not in names:
                continue
        n = poly.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in poly.loop_indices:
            co = mesh.vertices[mesh.loops[li].vertex_index].co
            if ax == 0:
                u, v = co.y * (1 if n.x > 0 else -1), co.z
            elif ax == 1:
                u, v = co.x * (-1 if n.y > 0 else 1), co.z
            else:
                u, v = co.x, co.y
            uv[li].uv = (u / scale, v / scale)


# ---------------------------------------------------------------- export

def export(path, root, tangents=False):
    """exports the root empty and everything under it"""
    objs = [root] + list(root.children_recursive)
    common.export_glb(path, objects=objs, tangents=tangents)


# ---------------------------------------------------------------- previews

STUDIO_HDRI = os.path.join(os.path.dirname(bpy.app.binary_path), "..", "Resources",
                           f"{bpy.app.version[0]}.{bpy.app.version[1]}", "datafiles", "studiolights", "world", "studio.exr")


def preview_materials_with_ao():
    """multiplies the baked vertex ao into base colour so blender renders match
    three.js (flat --quick materials only, the atlas carries its own ao)"""
    for mat in bpy.data.materials:
        if not mat.use_nodes or mat.get("_ao_wired"):
            continue
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        bsdf = nodes.get("Principled BSDF")
        if bsdf is None or bsdf.inputs["Base Color"].is_linked:
            continue
        base = tuple(bsdf.inputs["Base Color"].default_value)
        attr = nodes.new("ShaderNodeVertexColor")
        attr.layer_name = "ao"
        mix = nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        mix.inputs[6].default_value = base
        links.new(attr.outputs["Color"], mix.inputs[7])
        links.new(mix.outputs[2], bsdf.inputs["Base Color"])
        mat["_ao_wired"] = True


def setup_studio(strength=0.9, background=(0.035, 0.038, 0.045), exposure=0.0):
    scene = bpy.context.scene
    world = scene.world or bpy.data.worlds.new("PreviewWorld")
    scene.world = world
    world.use_nodes = True
    nodes, links = world.node_tree.nodes, world.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputWorld")
    env = nodes.new("ShaderNodeTexEnvironment")
    path = os.path.abspath(STUDIO_HDRI)
    if os.path.exists(path):
        env.image = bpy.data.images.load(path, check_existing=True)
    bg_light = nodes.new("ShaderNodeBackground")
    bg_light.inputs["Strength"].default_value = strength
    links.new(env.outputs["Color"], bg_light.inputs["Color"])
    bg_cam = nodes.new("ShaderNodeBackground")
    bg_cam.inputs["Color"].default_value = (*background, 1.0)
    bg_cam.inputs["Strength"].default_value = 1.0
    lp = nodes.new("ShaderNodeLightPath")
    mix = nodes.new("ShaderNodeMixShader")
    links.new(lp.outputs["Is Camera Ray"], mix.inputs["Fac"])
    links.new(bg_light.outputs["Background"], mix.inputs[1])
    links.new(bg_cam.outputs["Background"], mix.inputs[2])
    links.new(mix.outputs["Shader"], out.inputs["Surface"])
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Punchy"
    scene.view_settings.exposure = exposure
    return world


def add_light(name, location, target, energy, size=0.3, color=(1.0, 1.0, 1.0)):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.size = size
    data.color = color
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    common.look_at(obj, target)
    obj["_preview"] = True
    return obj


def render(path, cam_location, target, lens=50.0, resolution=(1280, 720), samples=96, engine="CYCLES",
           ortho_scale=None, cam_up_roll=0.0):
    scene = bpy.context.scene
    if engine == "CYCLES":
        use_cycles("GPU", samples)
        scene.cycles.use_denoising = True
    else:
        scene.render.engine = engine
    cam_data = bpy.data.cameras.new("PreviewCam")
    cam_data.lens = lens
    cam_data.clip_start = 0.005
    if ortho_scale is not None:
        cam_data.type = "ORTHO"
        cam_data.ortho_scale = ortho_scale
    cam = bpy.data.objects.new("PreviewCam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = cam_location
    common.look_at(cam, target)
    if cam_up_roll:
        cam.rotation_euler.rotate_axis("Z", math.radians(cam_up_roll))
    scene.camera = cam
    scene.render.resolution_x, scene.render.resolution_y = resolution
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    print(f"[wlib] rendered {path}")
    return path


def stack_images(paths, out_path):
    """stacks same-width pngs vertically (numpy, no external libs)"""
    import numpy as np

    arrays = []
    for p in paths:
        img = bpy.data.images.load(p, check_existing=False)
        w, h = img.size
        px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
        arrays.append(px)
        bpy.data.images.remove(img)
    width = max(a.shape[1] for a in arrays)
    arrays = [a if a.shape[1] == width else np.pad(a, ((0, 0), (0, width - a.shape[1]), (0, 0))) for a in arrays]
    # blender pixel rows run bottom-up, so the first image goes on top
    full = np.concatenate(list(reversed(arrays)), axis=0)
    h, w = full.shape[:2]
    out = bpy.data.images.new("stacked", w, h, alpha=False)
    out.pixels.foreach_set(full.ravel())
    out.filepath_raw = out_path
    out.file_format = "PNG"
    out.save()
    bpy.data.images.remove(out)
    print(f"[wlib] wrote {out_path}")


def socket_markers(sockets, size=0.012, camera=None):
    """temporary axis tripods + labels at each socket for a debug render.
    labels face `camera` (a world position) so they read in the render."""
    made = []
    red = material("_dbg_x", 0xff3b30, 0.5, 0.0, emission=0xff3b30, emission_strength=2.0)
    green = material("_dbg_y", 0x34c759, 0.5, 0.0, emission=0x34c759, emission_strength=2.0)
    blue = material("_dbg_z", 0x0a84ff, 0.5, 0.0, emission=0x0a84ff, emission_strength=2.0)
    white = material("_dbg_label", 0xffffff, 0.5, 0.0, emission=0xffffff, emission_strength=1.5)
    for s in sockets:
        mw = s.matrix_world
        origin = mw.translation
        for axis, mat in ((Vector((1, 0, 0)), red), (Vector((0, 1, 0)), green), (Vector((0, 0, 1)), blue)):
            d = (mw.to_3x3() @ axis).normalized()
            c = cylinder("_dbg", size * 0.06, size, (0, 0, 0), "Z", 8, mat)
            rot = d.to_track_quat("Z", "Y").to_matrix().to_4x4()
            c.data.transform(Matrix.Translation(origin + d * size * 0.5) @ rot)
            made.append(c)
        ball = lathe("_dbg", [(0.0, -1), (0.7, -0.7), (1.0, 0.0), (0.7, 0.7), (0.0, 1)], 8, white, axis="Z")
        ball.data.transform(Matrix.Translation(origin) @ Matrix.Scale(size * 0.18, 4))
        made.append(ball)
        curve = bpy.data.curves.new("_dbg_text", "FONT")
        curve.body = s.name.replace("socket_", "")
        curve.size = size * 0.6
        curve.extrude = size * 0.02
        text = bpy.data.objects.new("_dbg_text", curve)
        text.data.materials.append(white)
        bpy.context.scene.collection.objects.link(text)
        to_cam = (Vector(camera) - origin).normalized() if camera is not None else Vector((0, -1, 0))
        text.rotation_euler = to_cam.to_track_quat("Z", "Y").to_euler()
        text.location = origin + to_cam * size * 1.2 + Vector((0.0, 0.0, size * 0.45))
        made.append(text)
    return made


def ghost_materials(alpha=0.3):
    """makes every non-debug material see-through so sockets inside parts show"""
    for mat in bpy.data.materials:
        if mat.name.startswith("_dbg") or not mat.use_nodes:
            continue
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf is not None:
            bsdf.inputs["Alpha"].default_value = alpha


def preview_set(name, outdir, three_q, fp, dbg, sockets, samples=192, resolution=(1600, 900)):
    """renders the committed docs images: <name>.png (3/4 view stacked over a
    first-person view) and <name>_sockets.png (see-through with socket axes).
    each view is (camera_location, target, lens)."""
    preview_materials_with_ao()
    # a dim environment keeps dark rubber and polymer dark (the studio hdri
    # irradiance washes them out), area lights in the scripts give the highlights
    setup_studio(strength=0.1)
    tmp = TMP
    a = os.path.join(tmp, f"{name}_34.png")
    b = os.path.join(tmp, f"{name}_fp.png")
    render(a, three_q[0], three_q[1], lens=three_q[2], resolution=resolution, samples=samples)
    render(b, fp[0], fp[1], lens=fp[2], resolution=resolution, samples=samples)
    os.makedirs(outdir, exist_ok=True)
    stack_images([a, b], os.path.join(outdir, f"{name}.png"))
    markers = socket_markers(sockets, size=dbg[3], camera=dbg[0])
    ghost_materials(0.28)
    render(os.path.join(outdir, f"{name}_sockets.png"), dbg[0], dbg[1], lens=dbg[2], resolution=resolution,
           samples=max(64, samples // 2))
    for m in markers:
        bpy.data.objects.remove(m, do_unlink=True)
    ghost_materials(1.0)


def seeded(seed):
    return random.Random(seed)
