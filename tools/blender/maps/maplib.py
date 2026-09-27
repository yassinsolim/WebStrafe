"""shared helpers for the map build scripts in this folder.

a build script (build_<id>.py) describes one map as render parts (geometry grouped
by chunk and material), collision shapes, spawns and triggers. this module turns
that into the shipped files:

  - tileable albedo textures generated with numpy (nothing downloaded)
  - a cycles gpu lightmap bake (diffuse direct + indirect, no albedo) into uv set 2
  - scene.glb (render), collision.glb (positions only), meta.json
  - preview renders that use the baked lightmap, the game's fog and the same
    aces tone curve as three.js, so the pictures match what the game shows

run a build with:
  blender -b --factory-startup --python-exit-code 1 -P tools/blender/maps/build_<id>.py -- \
      [--no-bake] [--no-render] [--no-package] [--samples N] [--lightmap N]

blender is z-up. the gltf exporter turns blender (x, y, z) into three.js (x, z, -y),
so everything written to meta.json goes through to_three().
"""

import json
import math
import os
import subprocess
import sys
import time

import bmesh
import bpy
import numpy as np
from bpy_extras import bmesh_utils
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
UP = Vector((0.0, 0.0, 1.0))


# ---------------------------------------------------------------------------
# args, paths, coordinates


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opts = {
        "bake": True,
        "render": True,
        "package": True,
        "samples": 384,
        "lightmap": 2048,
        "preview_samples": 24,
    }
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg == "--no-bake":
            opts["bake"] = False
        elif arg == "--no-render":
            opts["render"] = False
        elif arg == "--no-package":
            opts["package"] = False
        elif arg == "--samples":
            i += 1
            opts["samples"] = int(argv[i])
        elif arg == "--lightmap":
            i += 1
            opts["lightmap"] = int(argv[i])
        else:
            raise SystemExit(f"unknown arg {arg}")
        i += 1
    return opts


def tmp_dir(map_id):
    path = os.path.join(REPO, ".blender-tmp", "maps", map_id)
    os.makedirs(path, exist_ok=True)
    return path


def to_three(p, digits=3):
    """blender (x, y, z) -> three.js (x, y, z)"""
    return [round(float(p[0]), digits), round(float(p[2]), digits), round(float(-p[1]), digits) + 0.0]


def aabb_three(mn, mx):
    a = to_three(mn)
    b = to_three(mx)
    return [min(a[i], b[i]) for i in range(3)], [max(a[i], b[i]) for i in range(3)]


def yaw_deg(dx, dy):
    """movement controller yaw for a blender xy direction (0 faces blender +y)"""
    return round(math.degrees(math.atan2(-dx, dy)), 2) + 0.0


def heading_vec(heading_deg):
    """unit xy vector for a course heading, 0 = +y, 90 = +x (clockwise from above)"""
    a = math.radians(heading_deg)
    return Vector((math.sin(a), math.cos(a), 0.0))


# ---------------------------------------------------------------------------
# colour


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def srgb_to_linear(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(np.asarray(c, dtype=np.float64), 0.0, None)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1.0 / 2.4) - 0.055)


def lin(h):
    """hex -> linear rgb tuple"""
    return tuple(float(v) for v in srgb_to_linear(hex_rgb(h)))


# ---------------------------------------------------------------------------
# tileable procedural textures (numpy). every function wraps around at the
# image edges so the result tiles without seams.


class TexGen:
    def __init__(self, size, seed):
        self.size = size
        self.rng = np.random.default_rng(seed)
        coords = (np.arange(size, dtype=np.float32) + 0.5) / size
        self.u, self.v = np.meshgrid(coords, coords)  # u = columns, v = rows (v=0 is the bottom row)

    def noise(self, cells_u, cells_v=None):
        """periodic value noise in [0, 1]"""
        cells_v = cells_v or cells_u
        lattice = self.rng.random((cells_v, cells_u)).astype(np.float32)
        fx = self.u * cells_u
        fy = self.v * cells_v
        x0 = np.floor(fx).astype(np.int32)
        y0 = np.floor(fy).astype(np.int32)
        tx = fx - x0
        ty = fy - y0
        tx = tx * tx * tx * (tx * (tx * 6 - 15) + 10)
        ty = ty * ty * ty * (ty * (ty * 6 - 15) + 10)
        x0 %= cells_u
        y0 %= cells_v
        x1 = (x0 + 1) % cells_u
        y1 = (y0 + 1) % cells_v
        a = lattice[y0, x0]
        b = lattice[y0, x1]
        c = lattice[y1, x0]
        d = lattice[y1, x1]
        return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty

    def fbm(self, cells, octaves=4, gain=0.5, cells_v=None):
        total = np.zeros_like(self.u)
        amp = 1.0
        norm = 0.0
        cu = cells
        cv = cells_v or cells
        for _ in range(octaves):
            total += amp * self.noise(cu, cv)
            norm += amp
            amp *= gain
            cu *= 2
            cv *= 2
        return total / norm

    def voronoi(self, count, jitter=1.0, stretch_v=1.0):
        """toroidal worley noise: returns (f1, f2, cell index), distances in cell units"""
        side = math.sqrt(count)
        pts = self.rng.random((count, 2)).astype(np.float32)
        if jitter < 1.0:
            grid = int(round(side))
            gx, gy = np.meshgrid(np.arange(grid), np.arange(grid))
            base = np.stack([(gx.ravel() + 0.5) / grid, (gy.ravel() + 0.5) / grid], axis=1)
            offsets = self.rng.random(base.shape).astype(np.float32)
            pts = ((base + (offsets - 0.5) * jitter / grid) % 1.0).astype(np.float32)
            count = len(pts)
            side = grid
        f1 = np.full(self.u.shape, 9.0, np.float32)
        f2 = np.full(self.u.shape, 9.0, np.float32)
        idx = np.zeros(self.u.shape, np.int32)
        for i in range(count):
            dx = np.abs(self.u - pts[i, 0])
            dx = np.minimum(dx, 1.0 - dx)
            dy = np.abs(self.v - pts[i, 1]) * stretch_v
            dy = np.minimum(dy, stretch_v - dy)
            d = np.sqrt(dx * dx + dy * dy)
            closer = d < f1
            f2 = np.where(closer, f1, np.minimum(f2, d))
            idx = np.where(closer, i, idx)
            f1 = np.where(closer, d, f1)
        return f1 * side, f2 * side, idx

    def cell_values(self, idx, count):
        return self.rng.random(count).astype(np.float32)[idx]


def line_dist(coord, count):
    """distance (in tile units of 1/count) to the nearest of `count` evenly spaced lines"""
    f = (coord * count) % 1.0
    return np.minimum(f, 1.0 - f)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def mix(a, b, t):
    """lerp between colours (tuples or arrays) with a scalar field t"""
    a = np.asarray(a, np.float32)
    b = np.asarray(b, np.float32)
    t = np.asarray(t, np.float32)
    if t.ndim == 2:
        t = t[..., None]
    return a * (1 - t) + b * t


def save_texture(name, rgb, folder, colorspace="sRGB"):
    """rgb: (h, w, 3) floats in display (srgb) space. returns a blender image saved as png"""
    rgb = np.clip(np.asarray(rgb, np.float32), 0.0, 1.0)
    h, w = rgb.shape[:2]
    rgba = np.ones((h, w, 4), np.float32)
    rgba[..., :3] = rgb
    img = bpy.data.images.new(name, w, h, alpha=False)
    img.colorspace_settings.name = colorspace
    img.pixels.foreach_set(rgba.ravel())
    path = os.path.join(folder, f"tex_{name}.png")
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    return img


# ---------------------------------------------------------------------------
# materials


class MatInfo:
    def __init__(self, mat, lit, tile, weight, uv_mode, emissive, albedo_image):
        self.mat = mat
        self.lit = lit
        self.tile = tile
        self.weight = weight
        self.uv_mode = uv_mode
        self.emissive = emissive
        self.albedo_image = albedo_image


MATS = {}


def material(name, image=None, color=(0.8, 0.8, 0.8), roughness=0.85, metallic=0.0,
             emissive=None, emissive_strength=1.0, emissive_image=None, lit=True,
             tile=2.0, weight=1.0, uv_mode="world", bake_emission_scale=1.0):
    """principled material that the gltf exporter maps to MeshStandardMaterial.
    `lit` materials get the lightmap, unlit ones (glow strips, lava) keep emissive shading."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    if image is not None:
        uv = nt.nodes.new("ShaderNodeUVMap")
        uv.uv_map = "UVMap"
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = image
        tex.name = "albedo"
        nt.links.new(uv.outputs["UV"], tex.inputs["Vector"])
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    else:
        bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emissive_image is not None:
        uv = nt.nodes.new("ShaderNodeUVMap")
        uv.uv_map = "UVMap"
        etex = nt.nodes.new("ShaderNodeTexImage")
        etex.image = emissive_image
        etex.name = "emissive"
        nt.links.new(uv.outputs["UV"], etex.inputs["Vector"])
        nt.links.new(etex.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = emissive_strength
    elif emissive is not None:
        bsdf.inputs["Emission Color"].default_value = (*emissive, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emissive_strength
    tile = tile if isinstance(tile, tuple) else (tile, tile)
    MATS[name] = MatInfo(mat, lit, tile, weight, uv_mode, emissive is not None or emissive_image is not None, image)
    # glow that should throw more light in the bake than it shows on screen (lava)
    MATS[name].bake_emission_scale = bake_emission_scale
    return mat


# ---------------------------------------------------------------------------
# primitive shapes. each returns a bmesh in world space.


def _transform(bm, rot_z=0.0, loc=(0, 0, 0), rot_x=0.0, rot_y=0.0):
    m = Matrix.Translation(Vector(loc)) @ Matrix.Rotation(rot_z, 4, "Z") @ Matrix.Rotation(rot_y, 4, "Y") @ Matrix.Rotation(rot_x, 4, "X")
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    return bm


def _outward(bm):
    """closed shapes built by hand: make every face normal point outwards (the
    bake shoots its rays along the normal, an inward face bakes black)"""
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    return bm


def _bevel(bm, bevel, segments=1):
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges) + list(bm.verts), offset=bevel, offset_type="OFFSET",
                        segments=segments, profile=0.5, affect="EDGES", clamp_overlap=True)
    return bm


def bm_box(center, size, rot_z=0.0, bevel=0.0, segments=1, rot_x=0.0, rot_y=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    _bevel(bm, min(bevel, 0.45 * min(size)), segments)
    return _transform(bm, rot_z, center, rot_x, rot_y)


def bm_band(center, size, rot_z=0.0):
    """the four side faces of a box, no top or bottom. used for trim bands that
    hug a bigger block, where the caps would be hidden and waste lightmap space"""
    bm = bm_box((0, 0, 0), size)
    for f in [f for f in bm.faces if abs(f.normal.z) > 0.9]:
        bm.faces.remove(f)
    return _transform(bm, rot_z, center)


def bm_box_mm(mn, mx, bevel=0.0, segments=1):
    c = [(mn[i] + mx[i]) * 0.5 for i in range(3)]
    s = [mx[i] - mn[i] for i in range(3)]
    return bm_box(c, s, 0.0, bevel, segments)


def bm_poly(points, z0, z1, bevel=0.0, segments=1, rot_z=0.0, loc=(0, 0, 0)):
    """extrudes a counter-clockwise 2d outline from z0 to z1"""
    bm = bmesh.new()
    bottom = [bm.verts.new((p[0], p[1], z0)) for p in points]
    top = [bm.verts.new((p[0], p[1], z1)) for p in points]
    bm.faces.new(list(reversed(bottom)))
    bm.faces.new(top)
    n = len(points)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((bottom[i], bottom[j], top[j], top[i]))
    _outward(bm)
    _bevel(bm, bevel, segments)
    return _transform(bm, rot_z, loc)


def bm_arch(center, rot_z, span, spring, depth, leg, crown, base_z, segments=10, bevel=0.03):
    """round arch in the local x/z plane, extruded along local y. `span` is the
    opening width, `spring` the height where the curve starts (from base_z),
    `leg` the pillar width and `crown` the stone above the keystone"""
    r = span / 2
    outer = span / 2 + leg
    top = spring + r + crown
    pts = [(-outer, 0.0), (-outer, top), (outer, top), (outer, 0.0), (r, 0.0), (r, spring)]
    for i in range(1, segments):
        a = math.pi * i / segments
        pts.append((math.cos(a) * r, spring + math.sin(a) * r))
    pts += [(-r, spring), (-r, 0.0)]
    bm = bmesh.new()
    front = [bm.verts.new((x, -depth / 2, z)) for x, z in pts]
    back = [bm.verts.new((x, depth / 2, z)) for x, z in pts]
    bm.faces.new(front)
    bm.faces.new(list(reversed(back)))
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((front[i], back[i], back[j], front[j]))
    _outward(bm)
    _bevel(bm, bevel, 1)
    return _transform(bm, rot_z, (center[0], center[1], base_z))


def bm_cylinder(center, radius, z0, z1, segments=10, bevel=0.0, radius_top=None, phase=0.0):
    rt = radius if radius_top is None else radius_top
    bm = bmesh.new()
    ring0 = []
    ring1 = []
    for i in range(segments):
        a = 2 * math.pi * i / segments + phase
        ring0.append(bm.verts.new((center[0] + radius * math.cos(a), center[1] + radius * math.sin(a), z0)))
        ring1.append(bm.verts.new((center[0] + rt * math.cos(a), center[1] + rt * math.sin(a), z1)))
    bm.faces.new(list(reversed(ring0)))
    bm.faces.new(ring1)
    for i in range(segments):
        j = (i + 1) % segments
        bm.faces.new((ring0[i], ring0[j], ring1[j], ring1[i]))
    _outward(bm)
    return _bevel(bm, bevel, 1)


def bm_rock(center, radius, z0, z1, rng, segments=10, rings=5, taper=0.55, jitter=0.16,
            lean=(0.0, 0.0), bulge=0.12, top_dome=0.0):
    """organic spire or mesa: stacked jittered rings with a taper and a lean"""
    bm = bmesh.new()
    angles = [(i + rng.uniform(-0.3, 0.3)) * math.tau / segments for i in range(segments)]
    rows = []
    for k in range(rings + 1):
        t = k / rings
        z = z0 + (z1 - z0) * t
        r = radius * (1 - taper * t ** 1.4) * (1 + bulge * math.sin(t * math.pi))
        cx = center[0] + lean[0] * t
        cy = center[1] + lean[1] * t
        ring = []
        for a in angles:
            rr = r * (1 + rng.uniform(-jitter, jitter))
            dz = 0.0 if k in (0, rings) else rng.uniform(-0.25, 0.25) * (z1 - z0) / rings
            ring.append(bm.verts.new((cx + math.cos(a) * rr, cy + math.sin(a) * rr, z + dz)))
        rows.append(ring)
    for k in range(rings):
        for i in range(segments):
            j = (i + 1) % segments
            bm.faces.new((rows[k][i], rows[k][j], rows[k + 1][j], rows[k + 1][i]))
    bm.faces.new(list(reversed(rows[0])))
    top = bm.faces.new(rows[-1])
    if top_dome > 0:
        res = bmesh.ops.poke(bm, faces=[top])
        for v in res["verts"]:
            v.co.z += top_dome
    _outward(bm)
    return bm


def prism_points(y0, y1, ridge_x, z_top, z_bottom, angle_left, angle_right):
    """cross-section of a surf ramp: a triangle (or trapezoid with a vertical side
    when an angle is None) swept from y0 to y1 along +y. returns the 2d profile
    [(x, z), ...] counter-clockwise when looking down +y."""
    h = z_top - z_bottom
    left = ridge_x - (h / math.tan(math.radians(angle_left)) if angle_left else 0.0)
    right = ridge_x + (h / math.tan(math.radians(angle_right)) if angle_right else 0.0)
    profile = [(left, z_bottom), (right, z_bottom)]
    if angle_right is None:
        profile.append((ridge_x, z_bottom))
    profile.append((ridge_x, z_top))
    if angle_left is None:
        profile.append((ridge_x, z_bottom))
    # drop duplicate points from vertical sides
    out = []
    for p in profile:
        if not out or (abs(out[-1][0] - p[0]) > 1e-6 or abs(out[-1][1] - p[1]) > 1e-6):
            out.append(p)
    if abs(out[0][0] - out[-1][0]) < 1e-6 and abs(out[0][1] - out[-1][1]) < 1e-6:
        out.pop()
    return out


def bm_sweep(profile, y0, y1, rot_z=0.0, loc=(0, 0, 0), drop=0.0):
    """sweeps an (x, z) profile along +y from y0 to y1. `drop` lowers the far end,
    keeping every long face a single planar quad."""
    bm = bmesh.new()
    a = [bm.verts.new((x, y0, z)) for x, z in profile]
    b = [bm.verts.new((x, y1, z - drop)) for x, z in profile]
    n = len(profile)
    bm.faces.new(list(reversed(a)))
    bm.faces.new(b)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]))
    _outward(bm)
    return _transform(bm, rot_z, loc)


def bm_wedge(center, size, rot_z=0.0, rise_axis="y"):
    """walkable ramp: a box whose top slopes from 0 at -y to size.z at +y"""
    sx, sy, sz = size
    bm = bmesh.new()
    p = [
        (-sx / 2, -sy / 2, 0), (sx / 2, -sy / 2, 0), (sx / 2, sy / 2, 0), (-sx / 2, sy / 2, 0),
        (sx / 2, sy / 2, sz), (-sx / 2, sy / 2, sz),
    ]
    v = [bm.verts.new(q) for q in p]
    bm.faces.new((v[3], v[2], v[1], v[0]))  # bottom
    bm.faces.new((v[0], v[1], v[4], v[5]))  # slope
    bm.faces.new((v[2], v[3], v[5], v[4]))  # back
    bm.faces.new((v[1], v[2], v[4]))
    bm.faces.new((v[0], v[5], v[3]))
    _outward(bm)
    return _transform(bm, rot_z, center)


def merge_bm(bms):
    out = bmesh.new()
    me = bpy.data.meshes.new("_merge_tmp")
    for bm in bms:
        bm.to_mesh(me)
        out.from_mesh(me)
        bm.free()
    bpy.data.meshes.remove(me)
    return out


# ---------------------------------------------------------------------------
# render parts and collision


class Part:
    def __init__(self):
        self.verts = []
        self.faces = []
        self.uvs = []
        self.weights = []


def _face_axes(n, rot_z, uv_hint):
    fx = Vector((math.cos(rot_z), math.sin(rot_z), 0.0))
    if abs(n.z) > 0.7:
        u = fx - n * fx.dot(n)
        if u.length < 1e-6:
            u = Vector((1, 0, 0))
        u.normalize()
    else:
        u = UP.cross(n)
        if u.length < 1e-6:
            u = Vector((1, 0, 0))
        u.normalize()
    v = n.cross(u)
    if uv_hint is not None and u.dot(uv_hint) < 0:
        u = -u
        v = -v
    return u, v


class MapBuilder:
    def __init__(self, map_id, sink_z=None):
        self.map_id = map_id
        self.parts = {}
        self.col_verts = []
        self.col_faces = []
        self.stats = {}
        # faces entirely below this height (under lava or water) get almost no lightmap texels
        self.sink_z = sink_z

    # render geometry ---------------------------------------------------
    def add(self, bm, chunk, mat_name, rot_z=0.0, uv_hint=None, weight=None, bottom_weight=0.15,
            uv_offset=(0.0, 0.0), face_uv=False, tile=None, fit_v=False):
        """appends a world-space bmesh to the (chunk, material) part with uv0 computed
        by projecting world positions onto each face (so textures tile in metres).
        fit_v stretches v over each face from its lowest to its highest point while
        u keeps tiling, used for surf ramps so the ridge band sits on the ridge."""
        info = MATS[mat_name]
        key = (chunk, mat_name)
        part = self.parts.setdefault(key, Part())
        base = len(part.verts)
        bm.normal_update()
        part.verts.extend([tuple(v.co) for v in bm.verts])
        bm.verts.index_update()
        tu, tv = tile if tile is not None else info.tile
        if weight is None:
            weight = info.weight
        use_face = face_uv or info.uv_mode == "face"
        for f in bm.faces:
            n = f.normal.copy()
            if n.length < 1e-8:
                continue
            u_axis, v_axis = _face_axes(n, rot_z, uv_hint)
            raw = [(l.vert.co.dot(u_axis), l.vert.co.dot(v_axis)) for l in f.loops]
            if use_face:
                us = [r[0] for r in raw]
                vs = [r[1] for r in raw]
                du = max(max(us) - min(us), 1e-6)
                dv = max(max(vs) - min(vs), 1e-6)
                uvs = [((r[0] - min(us)) / du, (r[1] - min(vs)) / dv) for r in raw]
            elif fit_v:
                vs = [r[1] for r in raw]
                dv = max(max(vs) - min(vs), 1e-6)
                up = v_axis.z >= 0
                uvs = [(r[0] / tu + uv_offset[0], (r[1] - min(vs)) / dv if up else (max(vs) - r[1]) / dv) for r in raw]
            else:
                uvs = [(r[0] / tu + uv_offset[0], r[1] / tv + uv_offset[1]) for r in raw]
            part.faces.append(tuple(base + l.vert.index for l in f.loops))
            part.uvs.append(uvs)
            w = weight * (bottom_weight if n.z < -0.7 else 1.0)
            if self.sink_z is not None and max(l.vert.co.z for l in f.loops) < self.sink_z:
                w *= 0.002
            part.weights.append(w)
        bm.free()

    # collision -----------------------------------------------------------
    def collide(self, bm, free=True):
        base = len(self.col_verts)
        bm.verts.index_update()
        self.col_verts.extend([tuple(v.co) for v in bm.verts])
        for f in bm.faces:
            self.col_faces.append(tuple(base + v.index for v in f.verts))
        if free:
            bm.free()

    def both(self, bm, chunk, mat_name, **kw):
        """same geometry for render and collision (used for surf ramps so both
        meshes share the exact planar faces)"""
        copy = bm.copy()
        self.collide(copy)
        self.add(bm, chunk, mat_name, **kw)

    # blender objects -------------------------------------------------------
    def build_objects(self):
        render = []
        lit = []
        for (chunk, mat_name), part in sorted(self.parts.items()):
            if not part.faces:
                continue
            info = MATS[mat_name]
            name = f"{chunk}__{mat_name}"
            me = bpy.data.meshes.new(name)
            me.from_pydata(part.verts, [], part.faces)
            uv0 = me.uv_layers.new(name="UVMap")
            flat = [c for face in part.uvs for uv in face for c in uv]
            uv0.data.foreach_set("uv", flat)
            if info.lit:
                me.uv_layers.new(name="Lightmap")
                attr = me.attributes.new("lm_weight", "FLOAT", "FACE")
                attr.data.foreach_set("value", part.weights)
            me.materials.append(info.mat)
            me.validate(clean_customdata=False)
            ob = bpy.data.objects.new(name, me)
            bpy.context.scene.collection.objects.link(ob)
            render.append(ob)
            if info.lit:
                lit.append(ob)
        me = bpy.data.meshes.new("collision")
        me.from_pydata(self.col_verts, [], self.col_faces)
        me.validate()
        col = bpy.data.objects.new("collision", me)
        bpy.context.scene.collection.objects.link(col)
        col.hide_render = True
        self.render_objects = render
        self.lit_objects = lit
        self.collision_object = col
        tris = sum(sum(len(f) - 2 for f in p.faces) for p in self.parts.values())
        col_tris = sum(len(f) - 2 for f in self.col_faces)
        self.stats.update(render_triangles=tris, render_objects=len(render), collision_triangles=col_tris)
        print(f"[maps] {self.map_id}: {len(render)} render objects, {tris} triangles, collision {col_tris} triangles")
        return render, lit, col


# ---------------------------------------------------------------------------
# cycles, world, sun


def setup_cycles(samples):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    scene.cycles.device = "GPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 6
    scene.cycles.diffuse_bounces = 4
    scene.cycles.glossy_bounces = 1
    scene.cycles.transparent_max_bounces = 2
    scene.cycles.sample_clamp_indirect = 8.0
    return scene


def sun_vector(azimuth_deg, elevation_deg):
    """direction towards the sun in blender space; azimuth 0 = +y, 90 = +x"""
    az = math.radians(azimuth_deg)
    el = math.radians(elevation_deg)
    return Vector((math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el)))


def add_sun(env):
    direction = sun_vector(env["sun_azimuth"], env["sun_elevation"])
    data = bpy.data.lights.new("Sun", "SUN")
    data.energy = env["sun_strength"]
    data.color = lin(env["sun_color"])
    data.angle = math.radians(env.get("sun_angle", 1.2))
    sun = bpy.data.objects.new("Sun", data)
    sun.rotation_euler = (-direction).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.collection.objects.link(sun)
    return sun


def _node(nt, kind, loc=(0, 0), **inputs):
    n = nt.nodes.new(kind)
    n.location = loc
    for k, v in inputs.items():
        n.inputs[k].default_value = v
    return n


def _math(nt, op, a, b=None, clamp=False):
    n = nt.nodes.new("ShaderNodeMath")
    n.operation = op
    n.use_clamp = clamp
    for i, x in enumerate((a, b)):
        if x is None:
            continue
        if isinstance(x, (int, float)):
            n.inputs[i].default_value = x
        else:
            nt.links.new(x, n.inputs[i])
    return n.outputs[0]


def _vmath(nt, op, a, b=None):
    n = nt.nodes.new("ShaderNodeVectorMath")
    n.operation = op
    for i, x in enumerate((a, b)):
        if x is None:
            continue
        if isinstance(x, (tuple, list)):
            n.inputs[i].default_value = x
        else:
            nt.links.new(x, n.inputs[i])
    return n.outputs["Value"] if op in ("DOT_PRODUCT", "LENGTH", "DISTANCE") else n.outputs["Vector"]


def _mix_rgb(nt, a, b, fac):
    n = nt.nodes.new("ShaderNodeMix")
    n.data_type = "RGBA"
    for sock, x in ((6, a), (7, b)):
        if isinstance(x, (tuple, list)):
            n.inputs[sock].default_value = (*x[:3], 1.0)
        else:
            nt.links.new(x, n.inputs[sock])
    if isinstance(fac, (int, float)):
        n.inputs[0].default_value = fac
    else:
        nt.links.new(fac, n.inputs[0])
    return n.outputs[2]


def sky_display_nodes(nt, env, direction):
    """display-space sky colour for a view direction, same formula as the game's
    sky dome shader in src/world/MapEnvironment.ts (minus the clouds)"""
    sky = env["sky"]
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(direction, sep.inputs[0])
    h = sep.outputs["Z"]
    up = _math(nt, "POWER", _math(nt, "MAXIMUM", h, 0.0), sky.get("exponent", 0.6))
    upper = _mix_rgb(nt, hex_rgb(sky["horizon"]), hex_rgb(sky["zenith"]), up)
    down = _math(nt, "MINIMUM", _math(nt, "MULTIPLY", _math(nt, "MAXIMUM", _math(nt, "MULTIPLY", h, -1.0), 0.0), 4.0), 1.0)
    lower = _mix_rgb(nt, hex_rgb(sky["horizon"]), hex_rgb(sky["ground"]), down)
    below = _math(nt, "LESS_THAN", h, 0.0)
    col = _mix_rgb(nt, upper, lower, below)
    sun_dir = tuple(sun_vector(env["sun_azimuth"], env["sun_elevation"]))
    d = _vmath(nt, "DOT_PRODUCT", direction, sun_dir)
    d = _math(nt, "MAXIMUM", d, 0.0)
    size = math.radians(sky.get("sun_size_deg", 1.6))
    disc = _math(nt, "MULTIPLY", _math(nt, "SUBTRACT", d, math.cos(size * 1.25)), 1.0 / max(1e-6, math.cos(size * 0.75) - math.cos(size * 1.25)))
    disc = _math(nt, "MINIMUM", _math(nt, "MAXIMUM", disc, 0.0), 1.0)
    glow = _math(nt, "ADD",
                 _math(nt, "MULTIPLY", _math(nt, "POWER", d, 48.0), sky.get("sun_glow", 0.35)),
                 _math(nt, "MULTIPLY", _math(nt, "POWER", d, 6.0), sky.get("sun_haze", 0.18)))
    amount = _math(nt, "MINIMUM", _math(nt, "ADD", disc, glow), 1.0)
    return _mix_rgb(nt, col, hex_rgb(env["sun_color"]), amount)


def _linearize(nt, col):
    """display srgb -> linear, so blender's 'standard' view shows the display value"""
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(col, sep.inputs[0])
    comb = nt.nodes.new("ShaderNodeCombineColor")
    for i, ch in enumerate(("Red", "Green", "Blue")):
        c = _math(nt, "MAXIMUM", sep.outputs[ch], 0.0)
        c = _math(nt, "POWER", _math(nt, "DIVIDE", _math(nt, "ADD", c, 0.055), 1.055), 2.4)
        nt.links.new(c, comb.inputs[i])
    return comb.outputs[0]


def setup_bake_world(env):
    """physically plausible sky light for the bake: gradient radiance + ground bounce"""
    world = bpy.data.worlds.new("BakeWorld")
    world.use_nodes = True
    nt = world.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    direction = _vmath(nt, "NORMALIZE", tc.outputs["Generated"])
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(direction, sep.inputs[0])
    h = sep.outputs["Z"]
    sky = env["sky"]
    up = _math(nt, "POWER", _math(nt, "MAXIMUM", h, 0.0), sky.get("exponent", 0.6))
    upper = _mix_rgb(nt, lin(sky["horizon"]), lin(sky["zenith"]), up)
    below = _math(nt, "LESS_THAN", h, 0.0)
    ground = tuple(c * env.get("bake_ground_scale", 0.6) for c in lin(sky.get("bake_ground", sky["ground"])))
    col = _mix_rgb(nt, upper, ground, below)
    nt.links.new(col, bg.inputs["Color"])
    bg.inputs["Strength"].default_value = env["sky_strength"]
    nt.links.new(bg.outputs[0], out.inputs["Surface"])
    bpy.context.scene.world = world
    return world


def setup_preview_world(env):
    world = bpy.data.worlds.new("PreviewWorld")
    world.use_nodes = True
    nt = world.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    direction = _vmath(nt, "NORMALIZE", tc.outputs["Generated"])
    col = sky_display_nodes(nt, env, direction)
    nt.links.new(_linearize(nt, col), bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 1.0
    nt.links.new(bg.outputs[0], out.inputs["Surface"])
    bpy.context.scene.world = world


# ---------------------------------------------------------------------------
# lightmap uvs and bake


def lightmap_uvs(lit_objects, size, pack_margin_px=6):
    view_layer = bpy.context.view_layer
    bpy.ops.object.select_all(action="DESELECT")
    for ob in lit_objects:
        ob.select_set(True)
        ob.data.uv_layers.active = ob.data.uv_layers["Lightmap"]
    view_layer.objects.active = lit_objects[0]
    t = time.time()
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(48), island_margin=0.0, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    # scale islands by their texel weight before the final pack so big, dull
    # surfaces (cliffs, ramp undersides) get fewer texels than walkable tops
    for ob in lit_objects:
        bm = bmesh.from_edit_mesh(ob.data)
        uv = bm.loops.layers.uv["Lightmap"]
        wl = bm.faces.layers.float.get("lm_weight")
        for island in bmesh_utils.bmesh_linked_uv_islands(bm, uv):
            area = sum(f.calc_area() for f in island)
            w = sum(f[wl] * f.calc_area() for f in island) / max(area, 1e-9)
            s = math.sqrt(max(w, 1e-4))
            cu = sum(l[uv].uv.x for f in island for l in f.loops) / sum(len(f.loops) for f in island)
            cv = sum(l[uv].uv.y for f in island for l in f.loops) / sum(len(f.loops) for f in island)
            for f in island:
                for l in f.loops:
                    l[uv].uv.x = cu + (l[uv].uv.x - cu) * s
                    l[uv].uv.y = cv + (l[uv].uv.y - cv) * s
        bmesh.update_edit_mesh(ob.data)
    bpy.ops.uv.pack_islands(rotate=True, rotate_method="CARDINAL", scale=True, margin_method="FRACTION",
                            margin=pack_margin_px / size, shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")
    for ob in lit_objects:
        ob.data.uv_layers.active = ob.data.uv_layers["UVMap"]
        ob.data.uv_layers["UVMap"].active_render = True
    # texel density report per weight band
    dens = {}
    for ob in lit_objects:
        me = ob.data
        uvl = me.uv_layers["Lightmap"].data
        wl = me.attributes["lm_weight"].data
        for p in me.polygons:
            if p.area < 0.05:
                continue
            pts = [uvl[i].uv for i in p.loop_indices]
            a = 0.0
            for i in range(1, len(pts) - 1):
                a += abs((pts[i].x - pts[0].x) * (pts[i + 1].y - pts[0].y) - (pts[i + 1].x - pts[0].x) * (pts[i].y - pts[0].y)) * 0.5
            texels_per_m = math.sqrt(a * size * size / p.area)
            dens.setdefault(round(wl[p.index].value, 2), []).append(texels_per_m)
    report = {k: round(float(np.median(v)), 1) for k, v in sorted(dens.items())}
    print(f"[maps] lightmap uvs in {time.time() - t:.1f}s, texels per metre by weight: {report}")
    budget = {}
    for ob in lit_objects:
        me = ob.data
        wl = me.attributes["lm_weight"].data
        key = me.materials[0].name
        budget[key] = budget.get(key, 0.0) + sum(p.area * wl[p.index].value for p in me.polygons)
    total = sum(budget.values())
    print("[maps] weighted lightmap area share: " + ", ".join(
        f"{k} {v / total * 100:.0f}%" for k, v in sorted(budget.items(), key=lambda kv: -kv[1])))
    return report


def _dilate(rgb, mask, iterations):
    """grows masked pixels outwards by averaging masked neighbours"""
    rgb = rgb.copy()
    mask = mask.copy()
    for _ in range(iterations):
        acc = np.zeros_like(rgb)
        cnt = np.zeros(mask.shape, np.float32)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                m = np.roll(np.roll(mask, dy, 0), dx, 1)
                c = np.roll(np.roll(rgb, dy, 0), dx, 1)
                acc += c * m[..., None]
                cnt += m
        grow = (~mask.astype(bool)) & (cnt > 0)
        rgb[grow] = acc[grow] / cnt[grow][:, None]
        mask = mask | grow
    return rgb, mask


def _denoise(rgb, folder):
    """runs blender's compositor denoise node (openimagedenoise) over a float image"""
    h, w = rgb.shape[:2]
    scene = bpy.context.scene
    src = bpy.data.images.new("lm_denoise_src", w, h, float_buffer=True, alpha=False)
    rgba = np.ones((h, w, 4), np.float32)
    rgba[..., :3] = rgb
    src.pixels.foreach_set(rgba.ravel())
    tree = bpy.data.node_groups.new("lm_denoise", "CompositorNodeTree")
    scene.compositing_node_group = tree
    n_img = tree.nodes.new("CompositorNodeImage")
    n_img.image = src
    n_dn = tree.nodes.new("CompositorNodeDenoise")
    for name, value in (("HDR", True),):
        try:
            n_dn.inputs[name].default_value = value
        except Exception:
            pass
    out = tree.nodes.new("NodeGroupOutput")
    tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    tree.links.new(n_img.outputs["Image"], n_dn.inputs["Image"])
    tree.links.new(n_dn.outputs["Image"], out.inputs[0])
    prev = (scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage,
            scene.render.filepath, scene.cycles.samples, scene.camera)
    scene.render.resolution_x = w
    scene.render.resolution_y = h
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "OPEN_EXR"
    scene.render.image_settings.color_depth = "32"
    path = os.path.join(folder, "lightmap_denoised.exr")
    scene.render.filepath = path
    scene.cycles.samples = 1
    if scene.camera is None:
        cam = bpy.data.objects.new("DenoiseCam", bpy.data.cameras.new("DenoiseCam"))
        scene.collection.objects.link(cam)
        cam.location = (0, 0, -5000)
        scene.camera = cam
    for ob in scene.objects:
        ob.hide_render = True
    bpy.ops.render.render(write_still=True)
    for ob in scene.objects:
        if ob.name != "collision":
            ob.hide_render = False
    scene.compositing_node_group = None
    (scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage,
     scene.render.filepath, scene.cycles.samples, _cam) = prev
    res = bpy.data.images.load(path)
    px = np.empty(w * h * 4, np.float32)
    res.pixels.foreach_get(px)
    bpy.data.images.remove(res)
    bpy.data.images.remove(src)
    return px.reshape(h, w, 4)[..., :3]


def bake_lightmap(lit_objects, size, samples, folder):
    """cycles bake of diffuse direct + indirect light (no albedo) into one atlas.
    returns (encoded png path, scale) where linear light = srgb_decode(texel) * scale."""
    scene = bpy.context.scene
    scene.cycles.samples = samples
    img = bpy.data.images.new("lightmap_raw", size, size, float_buffer=True, alpha=True)
    touched = []
    for ob in lit_objects:
        mat = ob.data.materials[0]
        if mat in touched:
            continue
        nt = mat.node_tree
        uvn = nt.nodes.new("ShaderNodeUVMap")
        uvn.uv_map = "Lightmap"
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.name = "lightmap_bake_target"
        tex.image = img
        nt.links.new(uvn.outputs["UV"], tex.inputs["Vector"])
        nt.nodes.active = tex
        touched.append(mat)
    bpy.ops.object.select_all(action="DESELECT")
    for ob in lit_objects:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = lit_objects[0]
    scene.render.bake.use_pass_direct = True
    scene.render.bake.use_pass_indirect = True
    scene.render.bake.use_pass_color = False
    boosted = []
    for info in MATS.values():
        scale = getattr(info, "bake_emission_scale", 1.0)
        if info.emissive and scale != 1.0:
            sock = info.mat.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"]
            boosted.append((sock, sock.default_value))
            sock.default_value *= scale
    t = time.time()
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, uv_layer="Lightmap",
                        margin=0, use_clear=True, target="IMAGE_TEXTURES")
    print(f"[maps] baked {size}x{size} at {samples} samples in {time.time() - t:.1f}s")
    for sock, value in boosted:
        sock.default_value = value
    for mat in touched:
        nt = mat.node_tree
        for n in list(nt.nodes):
            if n.name == "lightmap_bake_target" or (n.bl_idname == "ShaderNodeUVMap" and n.uv_map == "Lightmap"):
                nt.nodes.remove(n)
    px = np.empty(size * size * 4, np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(size, size, 4)
    mask = px[..., 3] > 0.5
    rgb = np.maximum(px[..., :3], 0.0)
    np.save(os.path.join(folder, "lightmap_raw.npy"), rgb.astype(np.float16))
    np.save(os.path.join(folder, "lightmap_mask.npy"), mask)
    filled, _ = _dilate(rgb, mask, 6)
    t = time.time()
    den = _denoise(filled, folder)
    print(f"[maps] denoised lightmap in {time.time() - t:.1f}s")
    den = np.maximum(den, 0.0)
    den[~mask] = 0.0
    final, _ = _dilate(den, mask, 10)
    return encode_lightmap(final, mask, folder)


def encode_lightmap(rgb, mask, folder, scale=None):
    lit = rgb[mask]
    if scale is None:
        scale = float(np.percentile(lit.max(axis=1), 99.7)) * 1.08
        scale = max(0.5, math.ceil(scale * 4) / 4)
    enc = linear_to_srgb(np.clip(rgb / scale, 0.0, 1.0))
    h, w = rgb.shape[:2]
    rgba = np.ones((h, w, 4), np.float32)
    rgba[..., :3] = enc
    out = bpy.data.images.new("lightmap_encoded", w, h, alpha=False)
    out.colorspace_settings.name = "Non-Color"
    out.pixels.foreach_set(rgba.ravel())
    path = os.path.join(folder, "lightmap.png")
    out.filepath_raw = path
    out.file_format = "PNG"
    out.save()
    print(f"[maps] lightmap encoded with scale {scale} (median lit {float(np.median(lit)):.3f})")
    return path, scale


def flat_lightmap(folder, size=64, value=0.55, scale=1.0):
    """stand-in lightmap for --no-bake iterations"""
    rgb = np.full((size, size, 3), value, np.float32)
    return encode_lightmap(rgb, np.ones((size, size), bool), folder, scale=scale)


# ---------------------------------------------------------------------------
# export


def export_glb(path, objects, materials=True, normals=True, texcoords=True):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objects:
        ob.hide_set(False)
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_texcoords=texcoords,
        export_normals=normals,
        export_tangents=False,
        export_materials="EXPORT" if materials else "NONE",
        export_attributes=False,
        export_extras=False,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_skins=False,
        export_morph=False,
    )
    print(f"[maps] wrote {path} ({os.path.getsize(path) / 1024:.0f} KB)")


def write_json(path, data):
    with open(path, "w", encoding="utf8") as fh:
        fh.write(json.dumps(data, indent=2) + "\n")
    print(f"[maps] wrote {path}")


# ---------------------------------------------------------------------------
# preview renders: albedo x baked light -> three.js aces filmic -> linear fog in
# display space, the same order three.js uses for MeshBasicMaterial + Fog.

ACES_IN = ((0.59719, 0.35458, 0.04823), (0.07600, 0.90834, 0.01566), (0.02840, 0.13383, 0.83777))
ACES_OUT = ((1.60475, -0.53108, -0.07367), (-0.10208, 1.10813, -0.00605), (-0.00327, -0.07276, 1.07602))


def _mat3(nt, rows, vec):
    comb = nt.nodes.new("ShaderNodeCombineXYZ")
    for i, row in enumerate(rows):
        nt.links.new(_vmath(nt, "DOT_PRODUCT", vec, row), comb.inputs[i])
    return comb.outputs[0]


def _aces(nt, color, exposure):
    v = _vmath(nt, "SCALE", color)
    v.node.inputs["Scale"].default_value = exposure / 0.6
    v = _mat3(nt, ACES_IN, v)
    a = _vmath(nt, "SUBTRACT", _vmath(nt, "MULTIPLY", v, _vmath(nt, "ADD", v, (0.0245786,) * 3)), (0.000090537,) * 3)
    b = _vmath(nt, "ADD", _vmath(nt, "MULTIPLY", v, _vmath(nt, "ADD", _vmath(nt, "MULTIPLY", v, (0.983729,) * 3), (0.4329510,) * 3)), (0.238081,) * 3)
    v = _vmath(nt, "DIVIDE", a, b)
    v = _mat3(nt, ACES_OUT, v)
    v = _vmath(nt, "MAXIMUM", v, (0.0, 0.0, 0.0))
    v = _vmath(nt, "MINIMUM", v, (1.0, 1.0, 1.0))
    return v


def _fog_factor(nt, fog):
    cam = nt.nodes.new("ShaderNodeCameraData")
    t = _math(nt, "DIVIDE", _math(nt, "SUBTRACT", cam.outputs["View Z Depth"], fog["near"]), fog["far"] - fog["near"])
    t = _math(nt, "MINIMUM", _math(nt, "MAXIMUM", t, 0.0), 1.0)
    return _math(nt, "MULTIPLY", _math(nt, "MULTIPLY", t, t), _math(nt, "SUBTRACT", 3.0, _math(nt, "MULTIPLY", t, 2.0)))


def preview_materials(lit_objects, render_objects, lightmap_png, scale, env):
    """swaps every render material for an emission shader that shows exactly what
    the game draws: MeshBasicMaterial(map, lightMap) for lit parts and emissive +
    ambient for the unlit ones"""
    lm_img = bpy.data.images.load(lightmap_png)
    lm_img.colorspace_settings.name = "sRGB"
    fog = env["fog"]
    fog_col = hex_rgb(fog["color"])
    exposure = env.get("exposure", 1.0)
    cache = {}
    lit_set = set(lit_objects)
    hemi = env["hemi"]
    for ob in render_objects:
        src = ob.data.materials[0]
        key = (src.name, ob in lit_set)
        if key not in cache:
            info = MATS[src.name]
            mat = bpy.data.materials.new(f"preview_{src.name}")
            mat.use_nodes = True
            nt = mat.node_tree
            for n in list(nt.nodes):
                nt.nodes.remove(n)
            out = nt.nodes.new("ShaderNodeOutputMaterial")
            emit = nt.nodes.new("ShaderNodeEmission")
            uv0 = nt.nodes.new("ShaderNodeUVMap")
            uv0.uv_map = "UVMap"
            if info.albedo_image is not None:
                at = nt.nodes.new("ShaderNodeTexImage")
                at.image = info.albedo_image
                nt.links.new(uv0.outputs["UV"], at.inputs["Vector"])
                albedo = at.outputs["Color"]
            else:
                rgb = nt.nodes.new("ShaderNodeRGB")
                rgb.outputs[0].default_value = (*src.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value[:3], 1)
                albedo = rgb.outputs[0]
            if ob in lit_set:
                uv1 = nt.nodes.new("ShaderNodeUVMap")
                uv1.uv_map = "Lightmap"
                lt = nt.nodes.new("ShaderNodeTexImage")
                lt.image = lm_img
                lt.interpolation = "Linear"
                nt.links.new(uv1.outputs["UV"], lt.inputs["Vector"])
                light = _vmath(nt, "SCALE", lt.outputs["Color"])
                light.node.inputs["Scale"].default_value = scale
                color = _vmath(nt, "MULTIPLY", albedo, light)
            else:
                bsdf = src.node_tree.nodes["Principled BSDF"]
                amb = tuple(c * hemi["intensity"] / math.pi for c in lin(hemi["sky"]))
                base = _vmath(nt, "MULTIPLY", albedo, amb)
                em_node = src.node_tree.nodes.get("emissive")
                strength = bsdf.inputs["Emission Strength"].default_value
                if em_node is not None:
                    et = nt.nodes.new("ShaderNodeTexImage")
                    et.image = em_node.image
                    nt.links.new(uv0.outputs["UV"], et.inputs["Vector"])
                    em = _vmath(nt, "SCALE", et.outputs["Color"])
                else:
                    em = _vmath(nt, "SCALE", tuple(bsdf.inputs["Emission Color"].default_value[:3]))
                em.node.inputs["Scale"].default_value = strength
                color = _vmath(nt, "ADD", base, em)
            display = _aces(nt, color, exposure)
            fogged = _mix_rgb(nt, display, fog_col, _fog_factor(nt, fog))
            nt.links.new(_linearize(nt, fogged), emit.inputs["Color"])
            emit.inputs["Strength"].default_value = 1.0
            nt.links.new(emit.outputs[0], out.inputs["Surface"])
            cache[key] = mat
        ob.data.materials[0] = cache[key]


def render_view(path, location, target, lens=24.0, resolution=(1280, 720), samples=24):
    scene = bpy.context.scene
    cam_data = bpy.data.cameras.new("PreviewCam")
    cam_data.lens = lens
    cam_data.clip_start = 0.05
    cam_data.clip_end = 5000
    cam = bpy.data.objects.new("PreviewCam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = location
    d = Vector(target) - Vector(location)
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = False
    scene.render.resolution_x, scene.render.resolution_y = resolution
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.display_settings.display_device = "sRGB"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_depth = "8"
    scene.render.filepath = path
    t = time.time()
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    print(f"[maps] rendered {path} in {time.time() - t:.1f}s")


def world_lens_for_fov(vfov_deg, aspect=16 / 9, sensor=36.0):
    """blender lens for a vertical fov (sensor fit auto -> horizontal)"""
    hfov = 2 * math.atan(math.tan(math.radians(vfov_deg) / 2) * aspect)
    return sensor / (2 * math.tan(hfov / 2))


# ---------------------------------------------------------------------------
# environment block for meta.json


def environment_meta(env, map_id, lightmap_scale, has_lightmap=True):
    sun = sun_vector(env["sun_azimuth"], env["sun_elevation"])
    sky = env["sky"]
    out = {
        "sky": {
            "zenith": sky["zenith"],
            "horizon": sky["horizon"],
            "ground": sky["ground"],
            "exponent": sky.get("exponent", 0.6),
            "sunSizeDeg": sky.get("sun_size_deg", 1.6),
            "sunGlow": sky.get("sun_glow", 0.35),
            "sunHaze": sky.get("sun_haze", 0.18),
            "clouds": sky.get("clouds", {}),
        },
        "sun": {
            "direction": [round(v, 4) for v in to_three(sun, 4)],
            "color": env["sun_color"],
            "intensity": round(env["sun_strength"] * env.get("runtime_sun_scale", 1.0), 3),
        },
        "hemi": {
            "sky": env["hemi"]["sky"],
            "ground": env["hemi"]["ground"],
            "intensity": round(env["hemi"]["intensity"], 3),
        },
        "fog": {"color": env["fog"]["color"], "near": env["fog"]["near"], "far": env["fog"]["far"]},
        "exposure": env.get("exposure", 1.0),
    }
    if has_lightmap:
        out["lightmaps"] = [{"path": f"/maps/{map_id}/lightmap.webp"}]
        out["lightMapIntensity"] = round(math.pi * lightmap_scale, 4)
    return out


# ---------------------------------------------------------------------------
# the whole pipeline after geometry is built


def finish_map(builder, env, meta, views, opts, layout=None):
    map_id = builder.map_id
    folder = tmp_dir(map_id)
    render, lit, col = builder.build_objects()
    add_sun(env)
    setup_bake_world(env)
    setup_cycles(opts["samples"])
    if opts["bake"]:
        builder.stats["texels_per_metre"] = lightmap_uvs(lit, opts["lightmap"])
        lm_png, scale = bake_lightmap(lit, opts["lightmap"], opts["samples"], folder)
    else:
        lightmap_uvs(lit, 256)
        lm_png, scale = flat_lightmap(folder)
    export_glb(os.path.join(folder, "scene.glb"), render)
    export_glb(os.path.join(folder, "collision.glb"), [col], materials=False, normals=False, texcoords=False)
    meta = dict(meta)
    meta["environment"] = environment_meta(env, map_id, scale)
    write_json(os.path.join(folder, "meta.json"), meta)
    stats = dict(builder.stats)
    stats["lightmap_scale"] = scale
    write_json(os.path.join(folder, "build_stats.json"), stats)
    if layout is not None:
        os.makedirs(os.path.join(HERE, "layouts"), exist_ok=True)
        write_json(os.path.join(HERE, "layouts", f"{map_id}.json"), layout)
    if opts["render"]:
        preview_materials(lit, render, lm_png, scale, env)
        setup_preview_world(env)
        for name, view in views.items():
            res = view.get("resolution", (1280, 720))
            render_view(os.path.join(folder, f"{name}.png"), view["location"], view["target"],
                        lens=view.get("lens", 24.0), resolution=res, samples=opts["preview_samples"])
    if opts["package"]:
        cmd = ["npx", "tsx", os.path.join("tools", "blender", "maps", "package_map.ts"), map_id]
        print("[maps] packaging:", " ".join(cmd))
        subprocess.run(cmd, cwd=REPO, check=True)
