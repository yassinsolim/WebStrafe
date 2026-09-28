"""Prismline: four surf stages spiralling down around a white signal tower in a
clear midday sky. clean sci-fi yard look: concrete platforms with hazard lips,
colour-coded prism ramps (teal, violet, amber, rose) on steel pylons.

  blender -b --factory-startup --python-exit-code 1 -P tools/blender/maps/build_surf_prismline.py -- [--no-bake] [--no-render] [--no-package]

every ramp is a triangular prism whose two long faces are single planar quads
(55 to 62 degrees), shared exactly by the render and the collision mesh. a stage
starts on a platform with a gate you drop through onto the first ramp, chains
ramps with gaps and drops sized so a slow rider (about 12 m/s) still arrives
above the next face, and ends on a walled landing platform that is the next
stage's start. a teleport volume under each stage sends you back to its start.
"""

import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bmesh  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

import maplib as M  # noqa: E402

MAP_ID = "surf_prismline"
TEX_SEED = 31

ENV = {
    "sun_azimuth": 140.0,
    "sun_elevation": 55.0,
    "sun_strength": 4.4,
    "sun_color": "#fff1dc",
    "sun_angle": 0.8,
    "sky_strength": 1.15,
    "sky": {
        "zenith": "#2f78d8",
        "horizon": "#cfe6fb",
        "ground": "#eaf4fc",
        "bake_ground": "#e4eef8",
        "exponent": 0.5,
        "sun_size_deg": 1.8,
        "sun_glow": 0.4,
        "sun_haze": 0.14,
        "clouds": {"color": "#ffffff", "shadow": "#aebdd1", "coverage": 0.38, "scale": 0.7, "speed": 0.006, "height": 0.22},
    },
    "bake_ground_scale": 0.7,
    "hemi": {"sky": "#bcd8f5", "ground": "#d9dfe6", "intensity": 2.2},
    "fog": {"color": "#d3e8fb", "near": 140.0, "far": 950.0},
    "exposure": 1.0,
}

# (name, base, dark, light) per stage
STAGE_COLORS = [
    ("teal", "#17b3a1", "#0a5f58", "#9ff5e7"),
    ("violet", "#7b5dff", "#382599", "#d2c6ff"),
    ("amber", "#ffab2d", "#a95c0a", "#ffe3a8"),
    ("rose", "#ff4d6b", "#9c1f3b", "#ffc6d0"),
]

# ramps per stage in the stage frame (forward = along the stage). the first ramp
# starts under the drop gate 4.5 m below the platform; later ones follow after
# `gap` metres, their ridge `drop` metres under the previous ridge end. `tilt`
# lowers the far end (the face stays one planar quad).
# each follow-up ramp is wider than the one before (height / tan(angle) grows),
# so a rider low on one face is still above the next face after the gap
STAGES = [
    [
        dict(length=92, height=14, angle=56),
        dict(length=80, height=17, angle=57, gap=3.5, drop=8.5, tilt=2.0),
    ],
    [
        dict(length=72, height=14, angle=58),
        dict(length=64, height=16.5, angle=58, gap=3.5, drop=8.5),
        dict(length=60, height=19, angle=59, gap=3.5, drop=8.5, tilt=3.0),
    ],
    [
        dict(length=112, height=16, angle=59, tilt=8.0),
        dict(length=56, height=19, angle=60, gap=4.0, drop=9.0),
    ],
    [
        dict(length=64, height=15, angle=60),
        dict(length=62, height=17.5, angle=61, gap=4.0, drop=9.0, tilt=2.0),
        dict(length=92, height=20, angle=62, gap=4.0, drop=9.0, tilt=4.0),
    ],
]

START_HALF = (12.0, 10.0)     # map start platform: half lateral, half forward
CORNER_HALF = (20.0, 15.0)    # stage platforms as seen from the stage they start
GATE_HALF = 6.0
LANDING_GAP = 2.0
LANDING_LEN = 40.0


# ---------------------------------------------------------------------------
# textures


def tex_concrete(folder):
    tg = M.TexGen(1024, TEX_SEED)
    stain = tg.fbm(3, 5)
    grain = tg.noise(300)
    speck = (tg.noise(180) > 0.83).astype(np.float32)
    seam = 1.0 - M.smoothstep(0.0012, 0.004, np.minimum(M.line_dist(tg.u, 2) / 2, M.line_dist(tg.v, 2) / 2))
    panel = np.floor(tg.u * 2) + np.floor(tg.v * 2) * 2
    tint = (np.sin(panel * 91.7) * 43758.5) % 1.0
    bolts = 1.0 - M.smoothstep(0.004, 0.007, np.sqrt((M.line_dist(tg.u + 0.25, 2) / 2 - 0.0) ** 2 + (M.line_dist(tg.v + 0.25, 2) / 2) ** 2))
    t = 0.62 + 0.14 * (stain - 0.5) + 0.05 * (grain - 0.5) + 0.05 * (tint - 0.5)
    col = M.mix(M.hex_rgb("#8e959d"), M.hex_rgb("#e9edf1"), np.clip(t, 0, 1))
    col = col * (1 - 0.4 * seam[..., None]) * (1 - 0.06 * speck[..., None]) * (1 - 0.25 * bolts[..., None])
    return M.save_texture("concrete", col, folder)


def tex_hazard(folder):
    tg = M.TexGen(512, TEX_SEED + 1)
    stripe = ((tg.u + tg.v) * 4) % 1.0 < 0.5
    wear = M.smoothstep(0.55, 0.85, tg.fbm(6, 4))
    col = np.where(stripe[..., None], np.array(M.hex_rgb("#ff8a1f"), np.float32), np.array(M.hex_rgb("#26282c"), np.float32))
    col = M.mix(col, M.hex_rgb("#8b8f94"), wear * 0.35)
    return M.save_texture("hazard", col, folder)


def tex_ramp(folder, name, base, dark, light, seed):
    tg = M.TexGen(1024, TEX_SEED + seed)
    u, v = tg.u, tg.v
    # colour runs dark at the foot of the face to bright under the ridge
    grad = M.smoothstep(0.0, 1.0, v)
    col = M.mix(M.hex_rgb(dark), M.hex_rgb(base), 0.55 + 0.45 * grad)
    # chevrons pointing along +u so the flow direction reads at speed
    chev = ((u * 3.0 - np.abs(v - 0.5) * 1.1) % 1.0)
    chev_band = (chev < 0.16).astype(np.float32) * M.smoothstep(0.12, 0.2, v) * (1 - M.smoothstep(0.8, 0.88, v))
    col = M.mix(col, M.hex_rgb(light), chev_band * 0.42)
    # panel seams every third of a tile and a thin rail line
    seam = 1.0 - M.smoothstep(0.0015, 0.004, M.line_dist(u, 3) / 3)
    col = col * (1 - 0.3 * seam[..., None])
    rail = 1.0 - M.smoothstep(0.004, 0.009, np.abs(v - 0.11))
    col = M.mix(col, M.hex_rgb(light), rail * 0.6)
    # ridge band and dark foot band
    ridge = M.smoothstep(0.935, 0.95, v)
    col = M.mix(col, M.hex_rgb("#f7fbff"), ridge * 0.92)
    foot = 1.0 - M.smoothstep(0.035, 0.05, v)
    col = M.mix(col, M.hex_rgb("#1e2126"), foot * 0.85)
    grime = tg.fbm(5, 4)
    col = col * (0.93 + 0.1 * grime[..., None])
    return M.save_texture(name, col, folder)


def tex_frame(folder):
    tg = M.TexGen(512, TEX_SEED + 7)
    n = tg.fbm(4, 4)
    seam = 1.0 - M.smoothstep(0.002, 0.006, np.minimum(M.line_dist(tg.u, 2) / 2, M.line_dist(tg.v, 2) / 2))
    col = M.mix(M.hex_rgb("#2b2f36"), M.hex_rgb("#4a5260"), n)
    col = col * (1 - 0.35 * seam[..., None])
    return M.save_texture("frame", col, folder)


def tex_steel(folder):
    tg = M.TexGen(512, TEX_SEED + 8)
    brushed = tg.fbm(2, 3, cells_v=40)
    col = M.mix(M.hex_rgb("#7b848f"), M.hex_rgb("#c6ced6"), 0.4 + 0.5 * brushed)
    band = 1.0 - M.smoothstep(0.0, 0.02, np.minimum(tg.v, 1 - tg.v))
    col = col * (1 - 0.3 * band[..., None])
    return M.save_texture("steel", col, folder)


def tex_tower(folder):
    tg = M.TexGen(1024, TEX_SEED + 9)
    rows = 1.0 - M.smoothstep(0.001, 0.003, M.line_dist(tg.v, 8) / 8)
    cols = 1.0 - M.smoothstep(0.001, 0.003, M.line_dist(tg.u, 4) / 4)
    n = tg.fbm(3, 4)
    col = M.mix(M.hex_rgb("#c9d3dd"), M.hex_rgb("#f4f7fa"), 0.5 + 0.4 * n)
    col = col * (1 - 0.3 * np.maximum(rows, cols)[..., None])
    return M.save_texture("tower", col, folder)


def make_materials(folder):
    M.material("concrete", image=tex_concrete(folder), tile=4.0, roughness=0.85)
    M.material("hazard", image=tex_hazard(folder), tile=1.4, roughness=0.6, weight=0.6)
    for i, (name, base, dark, light) in enumerate(STAGE_COLORS):
        M.material(f"ramp_{name}", image=tex_ramp(folder, f"ramp_{name}", base, dark, light, 10 + i), tile=(12.0, 1.0),
                   roughness=0.5, weight=0.2)
        M.material(f"glow_{name}", color=(0.1, 0.1, 0.1), emissive=M.lin(light), emissive_strength=2.4, lit=False)
    M.material("frame", image=tex_frame(folder), tile=3.0, roughness=0.7, weight=0.06)
    M.material("steel", image=tex_steel(folder), tile=(2.0, 4.0), roughness=0.45, metallic=0.5, weight=0.04)
    M.material("tower", image=tex_tower(folder), tile=(12.0, 24.0), roughness=0.6, weight=0.01)
    M.material("glow_white", color=(0.2, 0.2, 0.2), emissive=M.lin("#e8f6ff"), emissive_strength=2.2, lit=False)


# ---------------------------------------------------------------------------
# stage frames and layout


class Frame:
    """stage frame: x lateral (right), y forward, z up from the stage platform top"""

    def __init__(self, origin, z, heading):
        self.origin = Vector((origin[0], origin[1], 0.0))
        self.z = z
        self.heading = heading
        self.rot = -math.radians(heading)
        self.f = M.heading_vec(heading)
        self.r = M.heading_vec(heading + 90)

    def p(self, lat, fwd, z=0.0):
        w = self.origin + self.r * lat + self.f * fwd
        return (w.x, w.y, self.z + z)

    def loc(self):
        return (self.origin.x, self.origin.y, self.z)


class Ramp:
    def __init__(self, stage, index, frame, s0, s1, lateral, ridge_z, height, angle, tilt):
        self.stage = stage
        self.index = index
        self.frame = frame
        self.s0 = s0
        self.s1 = s1
        self.lateral = lateral
        self.ridge_z = ridge_z
        self.height = height
        self.angle = angle
        self.tilt = tilt

    @property
    def half_width(self):
        return self.height / math.tan(math.radians(self.angle))

    def end_ridge(self):
        return self.ridge_z - self.tilt

    def end_bottom(self):
        return self.ridge_z - self.tilt - self.height


def layout():
    frames = []
    ramps = []
    landings = []
    frame = Frame((0.0, 0.0), 0.0, 0.0)
    for k, stage in enumerate(STAGES):
        frames.append(frame)
        half_fwd = START_HALF[1] if k == 0 else CORNER_HALF[1]
        s = half_fwd - 4.0
        ridge = -4.5
        prev = None
        for i, r in enumerate(stage):
            if prev is not None:
                s += r["gap"]
                ridge = prev.end_ridge() - r["drop"]
            ramp = Ramp(k, i, frame, s, s + r["length"], r.get("lateral", 0.0), ridge, r["height"], r["angle"], r.get("tilt", 0.0))
            ramps.append(ramp)
            s = ramp.s1
            prev = ramp
        land_top = prev.end_bottom()
        land_start = prev.s1 + LANDING_GAP
        center_fwd = land_start + LANDING_LEN / 2
        landings.append((frame, land_start, land_top))
        c = frame.p(0.0, center_fwd)
        frame = Frame((c[0], c[1]), frame.z + land_top, frame.heading + 90.0)
    return frames, ramps, landings


# ---------------------------------------------------------------------------
# geometry


def split_faces(bm, keep):
    """copies bm into two bmeshes: faces where keep(face) and the rest"""
    a = bm.copy()
    b = bm.copy()
    bmesh.ops.delete(a, geom=[f for f in a.faces if not keep(f)], context="FACES")
    bmesh.ops.delete(b, geom=[f for f in b.faces if keep(f)], context="FACES")
    bm.free()
    return a, b


def build_ramp(b, ramp):
    fr = ramp.frame
    color = STAGE_COLORS[ramp.stage][0]
    ch = f"st{ramp.stage}"
    profile = M.prism_points(ramp.s0, ramp.s1, ramp.lateral, ramp.ridge_z, ramp.ridge_z - ramp.height, ramp.angle, ramp.angle)
    bm = M.bm_sweep(profile, ramp.s0, ramp.s1, rot_z=fr.rot, loc=fr.loc(), drop=ramp.tilt)
    b.collide(bm.copy())
    faces, frame_faces = split_faces(bm, lambda f: 0.3 < f.normal.z < 0.95)
    b.add(faces, ch, f"ramp_{color}", rot_z=fr.rot, uv_hint=fr.f, fit_v=True)
    b.add(frame_faces, ch, "frame", rot_z=fr.rot)
    w = ramp.half_width
    # glow strips hugging the underside of both bottom edges
    for side in (-1, 1):
        lat = ramp.lateral + side * (w - 0.12)
        for seg in range(2):
            t0 = seg / 2
            t1 = (seg + 1) / 2
            f0 = ramp.s0 + (ramp.s1 - ramp.s0) * t0
            f1 = ramp.s0 + (ramp.s1 - ramp.s0) * t1
            z0 = ramp.ridge_z - ramp.height - ramp.tilt * t0 - 0.09
            z1 = ramp.ridge_z - ramp.height - ramp.tilt * t1 - 0.09
            prof = [(lat - 0.08, -0.08), (lat + 0.08, -0.08), (lat + 0.08, 0.08), (lat - 0.08, 0.08)]
            strip = M.bm_sweep([(x, z0 + z) for x, z in prof], f0, f1, rot_z=fr.rot, loc=fr.loc(), drop=z0 - z1)
            b.add(strip, ch, f"glow_{color}")
    # steel pylons dropping into the clouds
    n = max(2, int((ramp.s1 - ramp.s0) / 26))
    for i in range(n):
        t = (i + 0.5) / n
        fwd = ramp.s0 + (ramp.s1 - ramp.s0) * t
        bottom = ramp.ridge_z - ramp.height - ramp.tilt * t
        c = fr.p(ramp.lateral, fwd, bottom)
        b.add(M.bm_box((c[0], c[1], c[2] - 0.5), (w * 1.5, 1.2, 1.0), rot_z=fr.rot, bevel=0.05), ch, "steel", rot_z=fr.rot)
        b.add(M.bm_box((c[0], c[1], c[2] - 36.0), (1.1, 1.1, 70.0), rot_z=fr.rot, bevel=0.06), ch, "steel", rot_z=fr.rot, weight=0.015)
        for side in (-1, 1):
            e = fr.p(ramp.lateral + side * w * 0.55, fwd, bottom)
            b.add(M.bm_box((e[0], e[1], e[2] - 4.5), (0.4, 0.4, 8.0), rot_z=fr.rot, rot_y=side * 0.55), ch, "steel", rot_z=fr.rot)


def ring_gate(b, frame, fwd, center_lat, center_z, radius, color, ch):
    """octagonal frame the surfer flies through between ramps (render only)"""
    segs = 8
    for i in range(segs):
        a0 = (i + 0.5) * math.tau / segs
        mid_lat = center_lat + math.cos(a0) * radius
        mid_z = center_z + math.sin(a0) * radius
        length = 2 * radius * math.tan(math.pi / segs) + 0.9
        c = frame.p(mid_lat, fwd, mid_z)
        # box long axis is local x (lateral), tilt it to follow the ring
        bm = M.bm_box((0, 0, 0), (length, 1.4, 1.2), bevel=0.1)
        rot = M.Matrix.Rotation(-(a0 + math.pi / 2), 4, "Y")
        bmesh.ops.transform(bm, matrix=rot, verts=bm.verts)
        M._transform(bm, frame.rot, c)
        b.add(bm, ch, "steel", rot_z=frame.rot)
        g = frame.p(center_lat + math.cos(a0) * (radius - 0.5), fwd, center_z + math.sin(a0) * (radius - 0.5))
        gb = M.bm_box((0, 0, 0), (length * 0.86, 1.5, 0.22))
        bmesh.ops.transform(gb, matrix=rot, verts=gb.verts)
        M._transform(gb, frame.rot, g)
        b.add(gb, ch, f"glow_{color}")


def seven_segment(b, frame, digit, lat, fwd, z, height, mat, ch):
    """big stage number on a wall, facing -forward"""
    segs = {1: "bc", 2: "abged", 3: "abgcd", 4: "fgbc"}[digit]
    w = height * 0.5
    t = height * 0.12
    pos = {
        "a": (0, height, w, t), "g": (0, height / 2, w, t), "d": (0, 0, w, t),
        "b": (w / 2, height * 0.75, t, height / 2), "c": (w / 2, height * 0.25, t, height / 2),
        "f": (-w / 2, height * 0.75, t, height / 2), "e": (-w / 2, height * 0.25, t, height / 2),
    }
    for s in segs:
        dx, dz, sx, sz = pos[s]
        c = frame.p(lat + dx, fwd, z + dz)
        b.add(M.bm_box(c, (sx, 0.12, sz), rot_z=frame.rot, bevel=0.02), ch, mat, rot_z=frame.rot)


def wall(b, frame, lat0, lat1, fwd0, fwd1, height, ch, glow=None, thick=None):
    """straight wall between two points in the frame, collision included"""
    a = Vector(frame.p(lat0, fwd0))
    c = Vector(frame.p(lat1, fwd1))
    mid = (a + c) / 2
    length = (c - a).length
    along = (c - a).normalized()
    rot = math.atan2(along.y, along.x)
    th = thick or 0.8
    center = (mid.x, mid.y, frame.z + height / 2)
    b.add(M.bm_box(center, (length, th, height), rot_z=rot, bevel=0.05), ch, "concrete", rot_z=rot)
    b.add(M.bm_band((mid.x, mid.y, frame.z + height - 0.18), (length + 0.04, th + 0.04, 0.2), rot_z=rot), ch, "hazard", rot_z=rot)
    b.collide(M.bm_box(center, (length, th, height), rot_z=rot))
    if glow:
        b.add(M.bm_box((mid.x, mid.y, frame.z + 0.35), (length - 0.6, th + 0.06, 0.08), rot_z=rot), ch, glow, rot_z=rot)


def build_platform(b, frame, half_lat, half_fwd, ch, gate=True, walls="start", color=None, digit=None):
    """slab centred on the frame origin. walls: 'start' (back + sides + gated front),
    'corner' (far side + back + gated front, arrival side open), 'finish' (three sides)"""
    thick = 1.6
    c = frame.p(0, 0, -thick / 2)
    size = (half_lat * 2, half_fwd * 2, thick)
    b.add(M.bm_box(c, size, rot_z=frame.rot, bevel=0.08, segments=2), ch, "concrete", rot_z=frame.rot)
    b.add(M.bm_band(frame.p(0, 0, -0.2), (half_lat * 2 + 0.06, half_fwd * 2 + 0.06, 0.34), rot_z=frame.rot), ch, "hazard", rot_z=frame.rot)
    b.collide(M.bm_box(c, size, rot_z=frame.rot))
    # underside truss so the slab does not look like a floating tile
    b.add(M.bm_box(frame.p(0, 0, -thick - 1.4), (half_lat * 1.4, half_fwd * 1.4, 2.8), rot_z=frame.rot, bevel=0.05), ch, "frame", rot_z=frame.rot, weight=0.05)
    b.add(M.bm_cylinder(frame.p(0, 0)[:2], min(half_lat, half_fwd) * 0.35, frame.z - 90, frame.z - thick - 2.8, segments=8), ch, "steel", weight=0.01)
    glow = f"glow_{color}" if color else None
    hl, hf = half_lat, half_fwd
    t = 0.8
    if walls == "start":
        wall(b, frame, -hl + t / 2, hl - t / 2, -hf + t / 2, -hf + t / 2, 2.6, ch, glow)     # back
    if walls == "start":
        wall(b, frame, -hl + t / 2, -hl + t / 2, -hf + t, hf - t, 2.6, ch, glow)            # left
        wall(b, frame, hl - t / 2, hl - t / 2, -hf + t, hf - t, 2.6, ch, glow)              # right
    if walls == "corner":
        wall(b, frame, -hl + t / 2, -hl + t / 2, -hf + t / 2, hf - t / 2, 6.0, ch, glow)    # far wall, catches fast arrivals
        wall(b, frame, -hl + t, hl - t / 2, -hf + t / 2, -hf + t / 2, 2.6, ch, glow)        # back
    if walls == "finish":
        wall(b, frame, -hl + t / 2, -hl + t / 2, -hf + t, hf - t / 2, 2.6, ch, glow)
        wall(b, frame, hl - t / 2, hl - t / 2, -hf + t, hf - t / 2, 2.6, ch, glow)
        wall(b, frame, -hl + t, hl - t, hf - t / 2, hf - t / 2, 7.0, ch, glow)              # far end
    if gate:
        wall(b, frame, -hl + (t if walls == "start" else t), -GATE_HALF - 0.6, hf - t / 2, hf - t / 2, 2.6, ch, glow)
        wall(b, frame, GATE_HALF + 0.6, hl - t / 2, hf - t / 2, hf - t / 2, 2.6, ch, glow)
        # gate posts with the next stage colour
        for side in (-1, 1):
            p = frame.p(side * (GATE_HALF + 0.3), hf - t / 2)
            b.add(M.bm_box((p[0], p[1], frame.z + 2.2), (0.6, 1.0, 4.4), rot_z=frame.rot, bevel=0.05), ch, "concrete", rot_z=frame.rot)
            b.add(M.bm_box((p[0], p[1], frame.z + 2.2), (0.66, 1.06, 0.18), rot_z=frame.rot), ch, glow or "glow_white", rot_z=frame.rot)
            b.collide(M.bm_box((p[0], p[1], frame.z + 2.2), (0.6, 1.0, 4.4), rot_z=frame.rot))
        top = frame.p(0, hf - t / 2)
        b.add(M.bm_box((top[0], top[1], frame.z + 4.6), (GATE_HALF * 2 + 1.8, 1.0, 0.5), rot_z=frame.rot, bevel=0.05), ch, "concrete", rot_z=frame.rot)
        b.add(M.bm_box((top[0], top[1], frame.z + 4.6), (GATE_HALF * 2 + 1.2, 1.08, 0.14), rot_z=frame.rot), ch, glow or "glow_white", rot_z=frame.rot)
        if digit:
            seven_segment(b, frame, digit, -GATE_HALF - 4.5, hf - t - 0.08, 0.35, 1.8, glow or "glow_white", ch)
    # corner lamps
    for sx in (-1, 1):
        for sy in (-1, 1):
            p = frame.p(sx * (hl - 1.2), sy * (hf - 1.2))
            b.add(M.bm_box((p[0], p[1], frame.z + 0.04), (1.2, 1.2, 0.08), rot_z=frame.rot), ch, "glow_white", rot_z=frame.rot)


def build_tower(b, center, z0, z1):
    b.add(M.bm_cylinder(center, 12.0, z0, z1, segments=6, bevel=0.2), "tower", "tower")
    b.add(M.bm_cylinder(center, 7.0, z1, z1 + 26, segments=6, radius_top=0.5), "tower", "tower")
    k = 0
    z = z0 + 20
    while z < z1:
        color = STAGE_COLORS[k % 4][0]
        b.add(M.bm_cylinder(center, 12.25, z, z + 0.9, segments=6), "tower", f"glow_{color}")
        z += 22
        k += 1
    b.add(M.bm_cylinder(center, 1.2, z1 + 26, z1 + 30, segments=6), "tower", "glow_white")


def build_satellites(b, rng, keep_out, bounds):
    """floating cubes and slabs for depth, outside the course footprint"""
    (x0, y0, x1, y1) = bounds
    placed = 0
    tries = 0
    while placed < 22 and tries < 800:
        tries += 1
        x = rng.uniform(x0 - 180, x1 + 180)
        y = rng.uniform(y0 - 180, y1 + 180)
        z = rng.uniform(-220, 40)
        inside = x0 - 45 < x < x1 + 45 and y0 - 45 < y < y1 + 45
        if inside or any(math.hypot(x - k[0], y - k[1]) < 60 for k in keep_out):
            continue
        s = rng.uniform(6, 22)
        rot = rng.uniform(0, math.tau)
        ch = f"sat{placed % 3}"
        b.add(M.bm_box((x, y, z), (s, s * rng.uniform(0.6, 1.4), s * rng.uniform(0.3, 1.0)), rot_z=rot, bevel=0.4), ch, "concrete", rot_z=rot, weight=0.004)
        b.add(M.bm_band((x, y, z), (s + 0.3, s * 0.2 + 0.3, 0.6), rot_z=rot), ch, f"glow_{STAGE_COLORS[placed % 4][0]}", rot_z=rot)
        placed += 1


# ---------------------------------------------------------------------------
# triggers and meta


def aabb_of_points(points, pad_xy=0.0, z0=None, z1=None):
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    zs = [p[2] for p in points]
    mn = (min(xs) - pad_xy, min(ys) - pad_xy, z0 if z0 is not None else min(zs))
    mx = (max(xs) + pad_xy, max(ys) + pad_xy, z1 if z1 is not None else max(zs))
    return M.aabb_three(mn, mx)


def main():
    opts = M.parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    folder = M.tmp_dir(MAP_ID)
    make_materials(folder)
    rng = random.Random(77)
    frames, ramps, landings = layout()
    b = M.MapBuilder(MAP_ID)

    for ramp in ramps:
        build_ramp(b, ramp)
    # ring gates over each transition
    for a, nxt in zip(ramps, ramps[1:]):
        if a.stage != nxt.stage:
            continue
        fwd = (a.s1 + nxt.s0) / 2
        cz = (a.end_ridge() + nxt.ridge_z) / 2 - a.height / 2
        ring_gate(b, a.frame, fwd, a.lateral, cz + 2.0, max(a.height, nxt.height) * 0.62 + 7.0, STAGE_COLORS[a.stage][0], f"st{a.stage}")

    # platforms: map start, three corners, finish
    build_platform(b, frames[0], START_HALF[0], START_HALF[1], "pl0", walls="start", color=STAGE_COLORS[0][0], digit=1)
    for k in range(1, 4):
        build_platform(b, frames[k], CORNER_HALF[0], CORNER_HALF[1], f"pl{k}", walls="corner", color=STAGE_COLORS[k][0], digit=k + 1)
    last_frame, land_start, land_top = landings[-1]
    fin_center = last_frame.p(0, land_start + LANDING_LEN / 2, land_top)
    fin_frame = Frame((fin_center[0], fin_center[1]), last_frame.z + land_top, last_frame.heading)
    build_platform(b, fin_frame, 15.0, LANDING_LEN / 2, "pl4", gate=False, walls="finish", color="rose")
    # finish marker: glowing chevron field on the pad
    for i in range(5):
        p = fin_frame.p(0, -12 + i * 5, 0.012)
        for side in (-1, 1):
            q = fin_frame.p(side * 2.6, -12 + i * 5 - 1.4, 0.012)
            rot = fin_frame.rot + side * math.radians(-35)
            b.add(M.bm_box((q[0], q[1], q[2]), (6.0, 0.5, 0.02), rot_z=rot), "pl4", "glow_white", rot_z=rot)
        del p

    xs = [v[0] for v in b.col_verts]
    ys = [v[1] for v in b.col_verts]
    center = ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2)
    build_tower(b, center, -300.0, 70.0)
    keep_out = [f.p(0, 0)[:2] for f in frames] + [fin_frame.p(0, 0)[:2]]
    keep_out += [r.frame.p(r.lateral, (r.s0 + r.s1) / 2)[:2] for r in ramps]
    keep_out += [center]
    build_satellites(b, rng, keep_out, (min(xs), min(ys), max(xs), max(ys)))

    # spawns on the start platform, facing the gate
    f0 = frames[0]
    spawns = [{"position": M.to_three(f0.p(lat, -6.0, 0.05)), "yawDeg": M.yaw_deg(*f0.f[:2])} for lat in (0.0, -4.0, 4.0)]

    triggers = []
    mn, mx = aabb_of_points([f0.p(-START_HALF[0] + 0.8, -START_HALF[1] + 0.8), f0.p(START_HALF[0] - 0.8, START_HALF[1] - 0.8)],
                            z0=f0.z - 0.5, z1=f0.z + 3.0)
    triggers.append({"id": "start", "type": "start", "min": mn, "max": mx,
                     "target": {"position": spawns[0]["position"], "yawDeg": spawns[0]["yawDeg"]}})
    stage_targets = [{"position": spawns[0]["position"], "yawDeg": spawns[0]["yawDeg"]}]
    for k in range(1, 4):
        fk = frames[k]
        mn, mx = aabb_of_points([fk.p(-CORNER_HALF[0] + 0.8, -CORNER_HALF[1] + 0.8), fk.p(CORNER_HALF[0], CORNER_HALF[1] - 0.8)],
                                z0=fk.z - 0.5, z1=fk.z + 6.0)
        target = {"position": M.to_three(fk.p(0.0, -4.0, 0.05)), "yawDeg": M.yaw_deg(*fk.f[:2])}
        stage_targets.append(target)
        triggers.append({"id": f"stage{k + 1}", "type": "checkpoint", "stage": k + 1, "min": mn, "max": mx, "target": target})
    mn, mx = aabb_of_points([fin_frame.p(-14.2, -LANDING_LEN / 2 + 0.5), fin_frame.p(14.2, LANDING_LEN / 2 - 0.8)],
                            z0=fin_frame.z - 0.5, z1=fin_frame.z + 8.0)
    triggers.append({"id": "finish", "type": "finish", "min": mn, "max": mx})
    # teleport under each stage back to its start. the volume stops short of the
    # next stage's first ramp so it can never catch a rider who is on course
    for k in range(4):
        rs = [r for r in ramps if r.stage == k]
        fk = frames[k]
        low = min(fk.z + r.end_bottom() for r in rs)
        pts = []
        for r in rs:
            w = r.half_width + 22
            pts += [fk.p(r.lateral - w, r.s0 - 6), fk.p(r.lateral + w, r.s1 + 7)]
        mn, mx = aabb_of_points(pts, z0=low - 60.0, z1=low - 4.0)
        triggers.append({"id": f"fall{k + 1}", "type": "teleport", "stage": k + 1, "min": mn, "max": mx, "target": stage_targets[k]})
    allx = [v[0] for v in b.col_verts]
    ally = [v[1] for v in b.col_verts]
    lowest = min(v[2] for v in b.col_verts)
    mn, mx = M.aabb_three((min(allx) - 400, min(ally) - 400, lowest - 400), (max(allx) + 400, max(ally) + 400, lowest - 60))
    triggers.append({"id": "void", "type": "teleport", "min": mn, "max": mx})

    meta = {
        "id": MAP_ID,
        "name": "Prismline",
        "author": "WebStrafe Team",
        "source": "Original map built in Blender by tools/blender/maps/build_surf_prismline.py",
        "license": "Original work (MIT, same as the project)",
        "attribution": "Original layout and procedural textures made for WebStrafe.",
        "spawns": spawns,
        "triggers": triggers,
        # surf servers run 150 (sharptimer's surf config)
        "cvars": {"sv_airaccelerate": 150},
        "notes": "Four surf stages, 10 ramps from 55 to 62 degrees. Falling under a stage teleports you to its start.",
    }
    layout_json = {
        "id": MAP_ID,
        "note": "generated by build_surf_prismline.py. ramp faces in three.js coordinates (y up)",
        "stages": [
            {
                "index": k + 1,
                "origin": M.to_three(frames[k].p(0, 0)),
                "forward": [round(v, 4) for v in M.to_three((frames[k].f.x, frames[k].f.y, 0.0), 4)],
                "right": [round(v, 4) for v in M.to_three((frames[k].r.x, frames[k].r.y, 0.0), 4)],
                "heading": frames[k].heading,
                "landing": {"s0": round(landings[k][1], 3), "s1": round(landings[k][1] + LANDING_LEN, 3),
                            "top": round(frames[k].z + landings[k][2], 3)},
            }
            for k in range(4)
        ],
        "ramps": [],
    }
    for r in ramps:
        fr = r.frame
        w = r.half_width
        for side in (-1, 1):
            # quad corners of one face: ridge start, ridge end, foot end, foot start
            quad = [
                fr.p(r.lateral, r.s0, r.ridge_z),
                fr.p(r.lateral, r.s1, r.ridge_z - r.tilt),
                fr.p(r.lateral + side * w, r.s1, r.ridge_z - r.tilt - r.height),
                fr.p(r.lateral + side * w, r.s0, r.ridge_z - r.height),
            ]
            layout_json["ramps"].append({
                "stage": r.stage + 1, "index": r.index + 1, "side": "right" if side > 0 else "left",
                "angleDeg": r.angle, "length": r.s1 - r.s0, "height": r.height,
                "s0": round(r.s0, 3), "s1": round(r.s1, 3), "lateral": r.lateral, "halfWidth": round(w, 4),
                "ridgeStart": round(fr.z + r.ridge_z, 3), "ridgeEnd": round(fr.z + r.end_ridge(), 3),
                "forward": [round(v, 4) for v in M.to_three((fr.f.x, fr.f.y, 0.0), 4)],
                "quad": [M.to_three(q) for q in quad],
            })
    f0 = frames[0]
    views = {
        "overview": {"location": (center[0] - 250, center[1] - 300, 150), "target": (center[0], center[1], -60), "lens": 24},
        "eye": {"location": f0.p(-2.0, 2.0, 1.6), "target": f0.p(3.0, 40.0, -14.0), "lens": M.world_lens_for_fov(100)},
        "thumb": {"location": f0.p(-60.0, -30.0, 32.0), "target": f0.p(0.0, 60.0, -18.0), "lens": 22, "resolution": (960, 540)},
        "ride": {"location": f0.p(7.0, 60.0, -9.0), "target": f0.p(3.0, 140.0, -18.0), "lens": M.world_lens_for_fov(100)},
    }
    M.finish_map(b, ENV, meta, views, opts, layout=layout_json)


main()
