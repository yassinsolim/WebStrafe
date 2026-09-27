"""helpers for the weapon build scripts (build_deagle.py, build_awp.py).

everything is modelled in metres with blender axes: +X right, +Y forward along
the barrel, +Z up. parts come from 2d outlines (extruded prisms, lofts, lathes),
get cut with booleans, bevelled with hardened normals, then joined per node.
moving parts end up as an empty on the pivot with the geometry in a child mesh
called <part>_mesh (see pin_part for why).
"""

import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import common  # noqa: E402

MM = 0.001
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
TMP = os.path.join(REPO, ".blender-tmp", "weapons")


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


def pebble_normal_map(name, size=256, count=1400, radius=(2.2, 4.2), seed=7):
    """tileable pebbled rubber normal map, generated with numpy (no external images)"""
    import numpy as np

    rng = np.random.default_rng(seed)
    height = np.zeros((size, size), dtype=np.float32)
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    for _ in range(count):
        cx, cy = rng.uniform(0, size, 2)
        r = rng.uniform(*radius)
        dx = (xx - cx + size / 2) % size - size / 2
        dy = (yy - cy + size / 2) % size - size / 2
        d2 = (dx * dx + dy * dy) / (r * r)
        bump = np.clip(1.0 - d2, 0.0, None)
        height = np.maximum(height, np.sqrt(bump) * rng.uniform(0.7, 1.0))
    gx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * 0.5
    gy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * 0.5
    k = 2.5
    nx, ny, nz = -gx * k, -gy * k, np.ones_like(height)
    inv = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
    rgba = np.stack([nx * inv * 0.5 + 0.5, ny * inv * 0.5 + 0.5, nz * inv * 0.5 + 0.5,
                     np.ones_like(height)], axis=-1)
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    img.colorspace_settings.name = "Non-Color"
    img.pixels.foreach_set(rgba.astype(np.float32).ravel())
    os.makedirs(TMP, exist_ok=True)
    img.filepath_raw = os.path.join(TMP, f"{name}.png")
    img.file_format = "PNG"
    img.save()
    img.pack()
    return img


# ---------------------------------------------------------------- 2d outlines

def fillet(points, segs=4):
    """rounds polygon corners. points are (a, b) or (a, b, radius) in metres.
    each corner gets an arc with about `segs` segments per 90 degrees."""
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
        # small radii get fewer segments, a 1 mm fillet doesn't need 4
        per90 = min(segs, 1.0 + r * 1000.0 * 0.7)
        k = max(1, int(round(per90 * abs(da) / (math.pi / 2))))
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


def lathe_mm(name, prof, segs, mat, axis, center, ripple=None, closed=False, phase=0.0):
    """lathe with an (r, t) profile and centre in mm"""
    return lathe(name, [(r * MM, t * MM) for r, t in prof], segs, mat, axis=axis,
                 center=tuple(c * MM for c in center), ripple=ripple, closed=closed, phase=phase)


def bevel_worn(obj, worn, width_mm, segs=1, angle=30.0):
    """bevel whose convex faces get the worn steel material (bare edges)"""
    obj.data.materials.append(worn)
    idx = len(obj.data.materials) - 1
    bevel(obj, width_mm * MM, segs=segs, angle=angle, material=idx)
    wear_convex_only(obj, idx)
    return obj


def sx_range(sx, a, b):
    """(a, b) mirrored to the side given by sx, sorted"""
    lo, hi = sorted((sx * a, sx * b))
    return lo, hi


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


def prism(name, pts, axis, lo, hi, mat, pts_hi=None):
    """extrudes a 2d outline along `axis` from lo to hi (metres).
    axis X: points are (y, z). axis Y: (x, z). axis Z: (x, y).
    pts_hi (same length) makes it a loft to a second outline at hi."""
    top = pts_hi if pts_hi is not None else pts
    assert len(top) == len(pts)
    bm = bmesh.new()
    va = [bm.verts.new(_to3(axis, p[0], p[1], lo)) for p in pts]
    vb = [bm.verts.new(_to3(axis, p[0], p[1], hi)) for p in top]
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


def lathe(name, prof, segs, mat, axis="Y", center=(0.0, 0.0, 0.0), phase=0.0, ripple=None, scale_xz=(1.0, 1.0),
          closed=False):
    """revolves a (radius, t) profile around `axis` through `center`.
    radius 0 at an end makes a pole, otherwise the ends get n-gon caps.
    ripple=(depth_fraction) pulls every other vertex in for knurling.
    closed=True treats the profile as a loop (rings, tubes) instead of capping."""
    cx, cy, cz = center
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
    cutter = join(cutters, target.name + "_cutter") if len(cutters) > 1 else cutters[0]
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


def bevel(obj, width, segs=2, angle=30.0, material=-1, profile=0.5, harden=True, clamp=True):
    """angle-limited bevel with hardened normals, applied right away"""
    for p in obj.data.polygons:
        p.use_smooth = True
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


def wear_convex_only(obj, worn_index):
    """bevel faces tagged with the worn material stay worn only on convex edges"""
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.faces.ensure_lookup_table()
    changed = True
    passes = 0
    while changed and passes < 6:
        changed = False
        passes += 1
        for f in bm.faces:
            if f.material_index != worn_index:
                continue
            convex = concave = 0
            neighbour_mat = None
            for e in f.edges:
                if len(e.link_faces) != 2:
                    continue
                other = e.link_faces[0] if e.link_faces[1] == f else e.link_faces[1]
                if other.material_index != worn_index and neighbour_mat is None:
                    neighbour_mat = other.material_index
                if e.calc_face_angle(0.0) < math.radians(2.0):
                    continue
                if e.is_convex:
                    convex += 1
                else:
                    concave += 1
            if concave > convex and neighbour_mat is not None:
                f.material_index = neighbour_mat
                changed = True
    bm.to_mesh(mesh)
    bm.free()
    return obj


# ---------------------------------------------------------------- scene graph

def join(objs, name):
    objs = [o for o in objs if o is not None]
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


# ---------------------------------------------------------------- ambient occlusion

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

def export(path, root):
    """exports the root empty and everything under it"""
    objs = [root] + list(root.children_recursive)
    common.export_glb(path, objects=objs)


# ---------------------------------------------------------------- previews

STUDIO_HDRI = os.path.join(os.path.dirname(bpy.app.binary_path), "..", "Resources",
                           f"{bpy.app.version[0]}.{bpy.app.version[1]}", "datafiles", "studiolights", "world", "studio.exr")


def preview_materials_with_ao():
    """multiplies the baked ao into base colour so blender renders match three.js"""
    for mat in bpy.data.materials:
        if not mat.use_nodes or mat.get("_ao_wired"):
            continue
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        bsdf = nodes.get("Principled BSDF")
        if bsdf is None:
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
        ball = lathe("_dbg", [(0.0, -1), (0.7, -0.7), (1.0, 0.0), (0.7, 0.7), (0.0, 1)], 12, white, axis="Z")
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
