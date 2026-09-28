"""Emberdrift: a linear bhop course of sandstone caps on basalt pillars rising out
of a lava sea at golden hour.

  blender -b --factory-startup --python-exit-code 1 -P tools/blender/maps/build_bhop_emberdrift.py -- [--no-bake] [--no-render] [--no-package]

32 jumps in six sections: warm-up, drops, a 90 degree right turn over four
jumps, long jumps, a sharp corner and a zigzag, then the finish. checkpoints
every six jumps, falling into the lava teleports you to the last one.

layout numbers are tuned to the movement code (gravity 19, jump 5.4 m/s, a flat
jump lasts 0.57 s, so 5.4 m at 9.5 m/s). tools/blender/maps/layouts/ gets the
platform list so the vitest suite can check every jump.
"""

import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

import maplib as M  # noqa: E402

MAP_ID = "bhop_emberdrift"
LAVA_Z = -11.0
TEX_SEED = 7

ENV = {
    "sun_azimuth": 205.0,
    "sun_elevation": 34.0,
    "sun_strength": 5.4,
    "sun_color": "#ffc893",
    "sun_angle": 1.4,
    "sky_strength": 1.7,
    "sky": {
        "zenith": "#28305f",
        "horizon": "#f2a36e",
        "ground": "#7a3326",
        "bake_ground": "#d0542a",
        "exponent": 0.55,
        "sun_size_deg": 2.2,
        "sun_glow": 0.45,
        "sun_haze": 0.3,
        "clouds": {"color": "#ffb48a", "shadow": "#6a4a78", "coverage": 0.46, "scale": 0.9, "speed": 0.004, "height": 0.35},
    },
    "bake_ground_scale": 0.9,
    "hemi": {"sky": "#9a9ed8", "ground": "#c0583a", "intensity": 2.4},
    "fog": {"color": "#e9946a", "near": 55.0, "far": 460.0},
    "exposure": 1.12,
}


# ---------------------------------------------------------------------------
# textures


def tex_sandstone(folder):
    """irregular sandstone flagstones with grout, per-stone tint and pitting"""
    tg = M.TexGen(1024, TEX_SEED)
    f1, f2, idx = tg.voronoi(16, jitter=0.75)
    edge = f2 - f1
    grout = 1.0 - M.smoothstep(0.035, 0.07, edge)
    bevel = 1.0 - M.smoothstep(0.07, 0.22, edge)
    tint = tg.cell_values(idx, 16)
    mottle = tg.fbm(4, 5)
    grain = tg.noise(220)
    p1, _, _ = tg.voronoi(160)
    pits = 1.0 - M.smoothstep(0.04, 0.11, p1)
    worn = M.smoothstep(0.55, 0.8, tg.fbm(6, 3))
    t = 0.46 + 0.22 * (tint - 0.5) + 0.3 * (mottle - 0.5) + 0.1 * (grain - 0.5) + 0.08 * worn
    col = M.mix(M.hex_rgb("#a67c50"), M.hex_rgb("#f3dbad"), np.clip(t, 0, 1))
    col = col * (1 - 0.12 * bevel[..., None]) * (1 - 0.5 * grout[..., None]) * (1 - 0.14 * pits[..., None])
    return M.save_texture("sandstone", col, folder)


def tex_basalt(folder):
    tg = M.TexGen(1024, TEX_SEED + 1)
    f1, f2, idx = tg.voronoi(36, stretch_v=0.35)
    edge = 1.0 - M.smoothstep(0.02, 0.09, f2 - f1)
    cell = tg.cell_values(idx, 36)
    cracks_h = 1.0 - M.smoothstep(0.0, 0.004, M.line_dist(tg.v + 0.03 * tg.fbm(6, 2), 5) / 5)
    n = tg.fbm(5, 5)
    t = 0.35 + 0.35 * n + 0.2 * (cell - 0.5)
    col = M.mix(M.hex_rgb("#2e2630"), M.hex_rgb("#74646c"), np.clip(t, 0, 1))
    col = col * (1 - 0.55 * edge[..., None]) * (1 - 0.35 * cracks_h[..., None])
    return M.save_texture("basalt", col, folder)


def tex_brass(folder):
    tg = M.TexGen(512, TEX_SEED + 2)
    streak = tg.fbm(3, 3, cells_v=48)
    tarnish = tg.fbm(3, 4)
    t = 0.45 + 0.35 * (streak - 0.5) + 0.3 * (tarnish - 0.5)
    col = M.mix(M.hex_rgb("#6e4a1f"), M.hex_rgb("#e7b560"), np.clip(t, 0, 1))
    rivet = 1.0 - M.smoothstep(0.012, 0.02, np.sqrt(M.line_dist(tg.u, 8) ** 2 / 64 + (tg.v - 0.5) ** 2 * 0.02))
    col = col * (1 - 0.3 * rivet[..., None])
    band = 1.0 - M.smoothstep(0.0, 0.03, np.minimum(tg.v, 1 - tg.v))
    col = col * (1 - 0.25 * band[..., None])
    return M.save_texture("brass", col, folder)


def tex_ruin(folder):
    tg = M.TexGen(1024, TEX_SEED + 3)
    rows = 6
    row = np.floor(tg.v * rows)
    shift = (row % 2) * 0.5
    cols = 3
    bu = (tg.u * cols + shift) % 1.0
    brick_id = (np.floor(tg.u * cols + shift) % cols) + row * 5
    tint = (np.sin(brick_id * 78.233) * 43758.5453) % 1.0
    mortar = np.minimum(np.minimum(bu, 1 - bu) / cols, np.minimum((tg.v * rows) % 1.0, 1 - (tg.v * rows) % 1.0) / rows)
    mortar = 1.0 - M.smoothstep(0.003, 0.012, mortar)
    wear = tg.fbm(6, 4)
    chips = 1.0 - M.smoothstep(0.02, 0.07, tg.voronoi(120)[0])
    t = 0.45 + 0.25 * (wear - 0.5) + 0.2 * (tint - 0.5)
    col = M.mix(M.hex_rgb("#9c8163"), M.hex_rgb("#e3cfab"), np.clip(t, 0, 1))
    col = col * (1 - 0.45 * mortar[..., None]) * (1 - 0.15 * chips[..., None])
    return M.save_texture("ruin", col, folder)


def tex_cliff(folder):
    tg = M.TexGen(1024, TEX_SEED + 4)
    warp = tg.fbm(2, 4)
    layers = tg.v * 9 + (warp - 0.5) * 2.2
    band = (np.sin(layers * 2 * np.pi) * 0.5 + 0.5)
    band2 = (np.sin(layers * 2 * np.pi * 3.0 + 1.3) * 0.5 + 0.5)
    n = tg.fbm(8, 5)
    f1, f2, _ = tg.voronoi(40, stretch_v=2.5)
    crack = 1.0 - M.smoothstep(0.01, 0.06, f2 - f1)
    t = 0.3 + 0.3 * band + 0.1 * band2 + 0.3 * (n - 0.5)
    col = M.mix(M.hex_rgb("#2e1a18"), M.hex_rgb("#7e4c3a"), np.clip(t, 0, 1))
    col = col * (1 - 0.35 * crack[..., None])
    return M.save_texture("cliff", col, folder)


def tex_lava(folder):
    tg = M.TexGen(1024, TEX_SEED + 5)
    # winding rivers from ridged noise, fine cracks only where the crust is thin
    river_a = 1.0 - M.smoothstep(0.0, 0.05, np.abs(tg.fbm(2, 4) - 0.5))
    river_b = 1.0 - M.smoothstep(0.0, 0.03, np.abs(tg.fbm(3, 4) - 0.5))
    f1, f2, _ = tg.voronoi(140, jitter=0.95)
    crack = (1.0 - M.smoothstep(0.012, 0.06, f2 - f1)) * M.smoothstep(0.5, 0.75, tg.fbm(4, 3))
    pools = M.smoothstep(0.7, 0.84, tg.fbm(3, 5))
    glow = np.clip(river_a * 0.95 + river_b * 0.45 + crack * 0.3 + pools, 0, 1)
    heat = tg.fbm(10, 4)
    crust = M.mix(M.hex_rgb("#0d0807"), M.hex_rgb("#33170f"), heat)
    base = M.mix(crust, M.hex_rgb("#d8541a"), glow * 0.7)
    emit = M.mix(M.hex_rgb("#000000"), M.hex_rgb("#ff4a0c"), glow)
    emit = M.mix(emit, M.hex_rgb("#ffc45a"), np.clip(glow - 0.7, 0, 1) * 2.5)
    return M.save_texture("lava", base, folder), M.save_texture("lava_emit", emit, folder)


def tex_iron(folder):
    tg = M.TexGen(256, TEX_SEED + 6)
    n = tg.fbm(4, 4)
    col = M.mix(M.hex_rgb("#1f1a19"), M.hex_rgb("#4a3f3a"), n)
    return M.save_texture("iron", col, folder)


def make_materials(folder):
    M.material("sandstone", image=tex_sandstone(folder), tile=3.0, roughness=0.9)
    M.material("basalt", image=tex_basalt(folder), tile=(4.0, 6.0), roughness=0.9, weight=0.45)
    M.material("brass", image=tex_brass(folder), tile=(1.5, 0.3), roughness=0.4, metallic=0.6, weight=0.6)
    M.material("ruin", image=tex_ruin(folder), tile=3.0, roughness=0.9, weight=0.7)
    M.material("cliff", image=tex_cliff(folder), tile=(14.0, 18.0), roughness=0.95, weight=0.1)
    lava, lava_emit = tex_lava(folder)
    M.material("lava", image=lava, emissive_image=lava_emit, emissive_strength=3.0, lit=False, tile=46.0,
               bake_emission_scale=3.0)
    M.material("iron", image=tex_iron(folder), tile=1.0, roughness=0.6, metallic=0.4, weight=0.5)
    M.material("glow_teal", color=(0.05, 0.3, 0.28), emissive=M.lin("#35f0d2"), emissive_strength=2.6, lit=False)
    M.material("glow_gold", color=(0.4, 0.25, 0.05), emissive=M.lin("#ffb627"), emissive_strength=2.6, lit=False)
    M.material("glow_fire", color=(0.4, 0.12, 0.02), emissive=M.lin("#ff7a1a"), emissive_strength=5.0, lit=False)


# ---------------------------------------------------------------------------
# course

# gap = edge to edge along the flight line, length along the heading, width across,
# dz = top height change, turn = heading change (deg, + is right), pivot = exit
# through the side of the previous platform, lateral = sideways shift
COURSE = [
    dict(kind="start", length=12.0, width=10.0),
    # warm-up: flat, 9.5-10.5 m/s rhythm
    dict(gap=2.2, length=4.0, width=3.4),
    dict(gap=2.6, length=3.0, width=3.0),
    dict(gap=2.7, length=3.0, width=3.0),
    dict(gap=2.6, length=2.8, width=2.8, dz=0.3),
    dict(gap=2.4, length=3.0, width=3.0, dz=-0.3),
    dict(gap=2.6, length=5.6, width=5.6, kind="checkpoint"),
    # drops: longer airtime, longer gaps
    dict(gap=3.6, length=3.0, width=3.0, dz=-1.2),
    dict(gap=1.8, length=3.0, width=3.0, dz=0.4),
    dict(gap=3.8, length=3.0, width=3.0, dz=-1.6),
    dict(gap=2.8, length=2.8, width=2.8),
    dict(gap=3.0, length=3.2, width=3.2, dz=-0.8),
    dict(gap=2.8, length=6.0, width=6.0, kind="checkpoint"),
    # 90 degree right turn, 22.5 degrees of air strafe per jump
    dict(gap=2.6, length=3.0, width=3.0, turn=22.5),
    dict(gap=2.6, length=3.0, width=3.0, turn=22.5),
    dict(gap=2.6, length=3.0, width=3.0, turn=22.5),
    dict(gap=2.6, length=3.0, width=3.0, turn=22.5),
    dict(gap=2.8, length=3.0, width=3.0, dz=0.3),
    dict(gap=2.6, length=6.0, width=6.0, kind="checkpoint"),
    # long jumps: build speed, then two long gaps
    dict(gap=3.2, length=3.0, width=3.0),
    dict(gap=3.4, length=2.6, width=3.0),
    dict(gap=4.6, length=3.2, width=3.4, dz=-1.4, tag="long jump"),
    dict(gap=3.0, length=3.0, width=3.0),
    dict(gap=5.0, length=3.4, width=3.6, dz=-0.6, tag="long jump"),
    dict(gap=3.0, length=6.0, width=6.0, dz=-0.4, kind="checkpoint"),
    # sharp 90 degree left turn in two 45 degree jumps, then a zigzag
    dict(gap=2.8, length=3.0, width=3.0),
    dict(gap=2.8, length=4.2, width=4.2, tag="corner"),
    dict(gap=2.6, length=3.2, width=3.2, turn=-45.0),
    dict(gap=2.6, length=3.2, width=3.2, turn=-45.0),
    dict(gap=2.8, length=2.4, width=2.4, lateral=1.6),
    dict(gap=2.8, length=2.4, width=2.4, lateral=-3.2),
    dict(gap=2.9, length=2.4, width=2.4, lateral=3.2, dz=0.3),
    dict(gap=3.4, length=3.0, width=3.0, lateral=-1.6, dz=-1.0),
    dict(gap=3.0, length=9.0, width=11.0, kind="finish"),
]


class Plat:
    def __init__(self, index, center, z, length, width, heading, kind, section, tag=None):
        self.index = index
        self.center = Vector((center[0], center[1], 0.0))
        self.z = z
        self.length = length
        self.width = width
        self.heading = heading
        self.kind = kind
        self.section = section
        self.tag = tag

    @property
    def rot(self):
        # heading 0 faces +y; boxes are built with length along local y
        return -math.radians(self.heading)

    def corners(self):
        f = M.heading_vec(self.heading)
        r = M.heading_vec(self.heading + 90)
        out = []
        for sl, sw in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            out.append(self.center + f * (sl * self.length / 2) + r * (sw * self.width / 2))
        return out


def layout_course():
    plats = []
    section = 0
    heading = 0.0
    prev = None
    z = 0.0
    for i, m in enumerate(COURSE):
        kind = m.get("kind", "jump")
        length = m["length"]
        width = m["width"]
        if prev is None:
            center = Vector((0.0, 0.0, 0.0))
        else:
            turn = m.get("turn", 0.0)
            gap = m["gap"]
            if m.get("pivot"):
                heading = prev.heading + turn
                center = prev.center + M.heading_vec(heading) * (prev.width / 2 + gap + length / 2)
            else:
                mid = prev.heading + turn / 2
                heading = prev.heading + turn
                center = (prev.center + M.heading_vec(prev.heading) * (prev.length / 2)
                          + M.heading_vec(mid) * gap + M.heading_vec(heading) * (length / 2))
            center = center + M.heading_vec(heading + 90) * m.get("lateral", 0.0)
            z = prev.z + m.get("dz", 0.0)
        p = Plat(i, center, round(z, 3), length, width, heading, kind, section, m.get("tag"))
        plats.append(p)
        if kind == "checkpoint":
            section += 1
        prev = p
    return plats


# ---------------------------------------------------------------------------
# geometry


def chunk_of(p):
    return f"s{p.section}"


def build_platform(b, p, rng):
    ch = chunk_of(p)
    cap_h = 0.8 if p.kind == "jump" else 1.0
    b.add(M.bm_box((p.center.x, p.center.y, p.z - cap_h / 2), (p.width, p.length, cap_h), rot_z=p.rot, bevel=0.07, segments=2),
          ch, "sandstone", rot_z=p.rot)
    # brass band wrapped just under the lip
    b.add(M.bm_band((p.center.x, p.center.y, p.z - 0.36), (p.width + 0.06, p.length + 0.06, 0.14), rot_z=p.rot),
          ch, "brass", rot_z=p.rot)
    # basalt pillar down into the lava, octagonal with a flared foot. the upper
    # part is what you see mid-jump, so it gets more lightmap texels
    r = 0.42 * min(p.length, p.width)
    top = p.z - cap_h + 0.02
    phase = math.radians(22.5) + p.rot
    b.add(M.bm_cylinder((p.center.x, p.center.y), r, top - 3.0, top, segments=8, phase=phase), ch, "basalt", weight=0.3)
    b.add(M.bm_cylinder((p.center.x, p.center.y), r, LAVA_Z - 1.0, top - 3.0, segments=8, phase=phase), ch, "basalt", weight=0.05)
    b.add(M.bm_cylinder((p.center.x, p.center.y), r * 1.6, LAVA_Z - 1.0, LAVA_Z + 1.2, segments=8, radius_top=r * 1.02,
                        phase=phase), ch, "basalt", weight=0.04)
    # collision: the cap plus the pillar down to well below the teleport height
    b.collide(M.bm_box((p.center.x, p.center.y, p.z - cap_h / 2), (p.width, p.length, cap_h), rot_z=p.rot))
    b.collide(M.bm_cylinder((p.center.x, p.center.y), r, LAVA_Z + 0.5, top, segments=8, phase=math.radians(22.5) + p.rot))
    if p.kind == "checkpoint":
        glow_ring(b, p, "glow_teal", ch)
        beacon(b, p, "glow_teal", ch, rng)
    elif p.kind == "finish":
        glow_ring(b, p, "glow_gold", ch)
    elif p.index % 3 == 1:
        lantern(b, p, ch, side=1 if p.index % 2 else -1)


def glow_ring(b, p, mat, ch, inset=0.35, width=0.14):
    f = M.heading_vec(p.heading)
    r = M.heading_vec(p.heading + 90)
    z = p.z + 0.004
    L = p.length - 2 * inset
    W = p.width - 2 * inset
    for s in (-1, 1):
        c = p.center + f * (s * L / 2)
        b.add(M.bm_box((c.x, c.y, z), (W + width, width, 0.008), rot_z=p.rot), ch, mat, rot_z=p.rot)
        c = p.center + r * (s * W / 2)
        b.add(M.bm_box((c.x, c.y, z), (width, L - width, 0.008), rot_z=p.rot), ch, mat, rot_z=p.rot)


def beacon(b, p, mat, ch, rng):
    """tall lantern post beside a checkpoint so it reads from far away"""
    side = M.heading_vec(p.heading + 90) * (p.width / 2 + 0.55)
    c = p.center - side
    b.add(M.bm_box((c.x, c.y, p.z + 2.2), (0.34, 0.34, 6.4), rot_z=p.rot, bevel=0.04), ch, "ruin", rot_z=p.rot)
    b.add(M.bm_box((c.x, c.y, p.z + 5.6), (0.5, 0.5, 0.7), rot_z=p.rot, bevel=0.03), ch, mat, rot_z=p.rot)
    b.add(M.bm_box((c.x, c.y, p.z + 6.1), (0.62, 0.62, 0.18), rot_z=p.rot, bevel=0.03), ch, "brass", rot_z=p.rot)
    b.collide(M.bm_box((c.x, c.y, p.z + 2.2), (0.34, 0.34, 6.4), rot_z=p.rot))


def arch(b, center, heading, span, height, ch, depth=1.2, pillar=1.1, collide=True):
    """round ruin gateway straddling the path. `height` is the top of the opening
    above center.z; the legs stand outside the platform and drop into the lava"""
    rot = -math.radians(heading)
    right = M.heading_vec(heading + 90)
    base = center.z - 1.5
    r = span / 2
    spring = max(0.5, height - r + 1.5)
    b.add(M.bm_arch((center.x, center.y), rot, span, spring, depth, pillar, 0.9, base, segments=12, bevel=0.04),
          ch, "ruin", rot_z=rot)
    top = base + spring + r + 0.9
    b.add(M.bm_box((center.x, center.y, top + 0.2), (span + 2 * pillar + 0.5, depth + 0.3, 0.4), rot_z=rot, bevel=0.05),
          ch, "ruin", rot_z=rot)
    b.add(M.bm_band((center.x, center.y, top - 0.25), (span + 2 * pillar + 0.08, depth + 0.08, 0.14), rot_z=rot), ch, "brass", rot_z=rot)
    for s in (-1, 1):
        c = center + right * (s * (r + pillar / 2))
        b.add(M.bm_box((c.x, c.y, LAVA_Z - 1.0 + (base - LAVA_Z + 1.0) / 2), (pillar, depth, base - LAVA_Z + 1.0), rot_z=rot),
              ch, "ruin", rot_z=rot, weight=0.04)
        if collide:
            z0 = LAVA_Z + 0.5
            z1 = base + spring + r * 0.6
            b.collide(M.bm_box((c.x, c.y, (z0 + z1) / 2), (pillar, depth, z1 - z0), rot_z=rot))


def lantern(b, p, ch, side=1):
    """iron bracket with a fire bowl hanging off a pillar, lights the bake too"""
    r = 0.42 * min(p.length, p.width)
    out = M.heading_vec(p.heading + 90) * side
    c = p.center + out * (r + 0.35)
    z = p.z - 1.9
    rot = -math.radians(p.heading)
    b.add(M.bm_box((c.x - out.x * 0.2, c.y - out.y * 0.2, z + 0.3), (0.12, 0.12, 0.7), rot_z=rot), ch, "iron", rot_z=rot)
    b.add(M.bm_cylinder((c.x, c.y), 0.26, z - 0.15, z + 0.05, segments=8, radius_top=0.34), ch, "iron")
    b.add(M.bm_cylinder((c.x, c.y), 0.24, z + 0.02, z + 0.2, segments=8, radius_top=0.12), ch, "glow_fire")


def build_start(b, p):
    ch = "s0"
    b.add(M.bm_box((p.center.x, p.center.y, p.z - 0.6), (p.width, p.length, 1.2), bevel=0.08, segments=2), ch, "sandstone")
    b.add(M.bm_band((p.center.x, p.center.y, p.z - 0.4), (p.width + 0.06, p.length + 0.06, 0.14)), ch, "brass")
    b.collide(M.bm_box((p.center.x, p.center.y, p.z - 0.6), (p.width, p.length, 1.2)))
    # stepped plinth under the plaza
    for k, (grow, depth) in enumerate(((1.0, 3.5), (1.6, 6.0))):
        b.add(M.bm_box((p.center.x, p.center.y, p.z - 1.2 - depth / 2), (p.width - 1.5 * grow, p.length - 1.5 * grow, depth), bevel=0.06), ch, "basalt", weight=0.2)
    b.add(M.bm_cylinder((p.center.x, p.center.y), 3.2, LAVA_Z - 1, p.z - 8.0, segments=8, radius_top=3.6), ch, "basalt", weight=0.05)
    # low walls on three sides keep you on the plaza
    y0 = p.center.y - p.length / 2
    x0 = p.center.x - p.width / 2
    x1 = p.center.x + p.width / 2
    walls = [
        ((p.center.x, y0 + 0.4, p.z + 1.0), (p.width, 0.8, 2.0)),
        ((x0 + 0.4, p.center.y - 1.0, p.z + 1.0), (0.8, p.length - 2.0, 2.0)),
        ((x1 - 0.4, p.center.y - 1.0, p.z + 1.0), (0.8, p.length - 2.0, 2.0)),
    ]
    for c, s in walls:
        b.add(M.bm_box(c, s, bevel=0.06), ch, "ruin")
        b.add(M.bm_box((c[0], c[1], c[2] + 1.05), (s[0] + 0.14, s[1] + 0.14, 0.12), bevel=0.02), ch, "brass", bottom_weight=0.02)
        b.collide(M.bm_box(c, s))
    # braziers in the back corners
    for sx in (-1, 1):
        c = (p.center.x + sx * (p.width / 2 - 1.5), y0 + 1.5)
        b.add(M.bm_cylinder(c, 0.35, p.z, p.z + 0.9, segments=8, radius_top=0.28), ch, "iron")
        b.add(M.bm_cylinder(c, 0.62, p.z + 0.9, p.z + 1.25, segments=8, radius_top=0.7), ch, "iron")
        b.add(M.bm_cylinder(c, 0.5, p.z + 1.1, p.z + 1.35, segments=8, radius_top=0.3), ch, "glow_fire")
        b.collide(M.bm_cylinder(c, 0.62, p.z, p.z + 1.25, segments=8))
    # start pad marking
    glow_ring(b, p, "glow_teal", ch, inset=1.2)
    front = Vector((p.center.x, p.center.y + p.length / 2 - 0.6, p.z))
    arch(b, front, 0.0, p.width + 0.2, 7.2, ch)


def build_finish(b, p):
    ch = f"s{p.section}"
    b.add(M.bm_box((p.center.x, p.center.y, p.z - 0.6), (p.width, p.length, 1.2), rot_z=p.rot, bevel=0.08, segments=2), ch, "sandstone", rot_z=p.rot)
    b.add(M.bm_band((p.center.x, p.center.y, p.z - 0.4), (p.width + 0.06, p.length + 0.06, 0.14), rot_z=p.rot), ch, "brass", rot_z=p.rot)
    b.collide(M.bm_box((p.center.x, p.center.y, p.z - 0.6), (p.width, p.length, 1.2), rot_z=p.rot))
    b.add(M.bm_cylinder((p.center.x, p.center.y), 3.4, LAVA_Z - 1, p.z - 1.1, segments=8, radius_top=4.2), ch, "basalt", weight=0.06)
    glow_ring(b, p, "glow_gold", ch, inset=0.8)
    # sun emblem: gold disc with rays in the middle of the pad
    b.add(M.bm_cylinder((p.center.x, p.center.y), 1.3, p.z, p.z + 0.01, segments=24), ch, "glow_gold")
    for k in range(12):
        a = k * math.pi / 6
        c = (p.center.x + math.cos(a) * 2.1, p.center.y + math.sin(a) * 2.1, p.z + 0.004)
        b.add(M.bm_box(c, (0.9, 0.16, 0.008), rot_z=a), ch, "glow_gold")
    # back wall with a tall arch so the finish reads from the course
    f = M.heading_vec(p.heading)
    back = p.center + f * (p.length / 2 - 0.5)
    b.add(M.bm_box((back.x, back.y, p.z + 1.1), (p.width, 1.0, 2.2), rot_z=p.rot, bevel=0.06), ch, "ruin", rot_z=p.rot)
    b.collide(M.bm_box((back.x, back.y, p.z + 1.1), (p.width, 1.0, 2.2), rot_z=p.rot))
    arch(b, Vector((back.x, back.y, p.z)), p.heading, p.width - 3.0, 7.5, ch, depth=1.4, pillar=1.4)
    for s in (-1, 1):
        c = p.center + M.heading_vec(p.heading + 90) * (s * (p.width / 2 - 0.45))
        b.add(M.bm_box((c.x, c.y, p.z + 0.5), (0.9, p.length - 2.0, 1.0), rot_z=p.rot, bevel=0.05), ch, "ruin", rot_z=p.rot)
        b.collide(M.bm_box((c.x, c.y, p.z + 0.5), (0.9, p.length - 2.0, 1.0), rot_z=p.rot))


def rock_mass(b, center, radius, z_top, rng, ch, mat="cliff", segments=11, weight=0.1, spire=False):
    """a mesa (wide, flat top) or a spire (narrow, leaning) rising from the lava,
    with a smaller shoulder rock at its foot"""
    lean = (rng.uniform(-0.18, 0.18) * radius, rng.uniform(-0.18, 0.18) * radius)
    taper = rng.uniform(0.45, 0.7) if spire else rng.uniform(0.15, 0.35)
    rings = 6 if spire else 5
    b.add(M.bm_rock(center, radius, LAVA_Z - 3.0, z_top, rng, segments=segments + 3, rings=rings, taper=taper,
                    jitter=0.2, lean=lean, top_dome=radius * (0.05 if spire else 0.02)), ch, mat, weight=weight)
    a = rng.uniform(0, math.tau)
    sc = (center[0] + math.cos(a) * radius * 0.9, center[1] + math.sin(a) * radius * 0.9)
    b.add(M.bm_rock(sc, radius * rng.uniform(0.35, 0.55), LAVA_Z - 3.0, LAVA_Z + (z_top - LAVA_Z) * rng.uniform(0.2, 0.45), rng,
                    segments=8, rings=3, taper=0.5, jitter=0.2), ch, mat, weight=weight)


def floating_ruin(b, center, rng, ch):
    """decorative island with broken columns, too far to reach"""
    x, y, z = center
    r = rng.uniform(4.0, 7.0)
    b.add(M.bm_cylinder((x, y), r, z - 1.2, z, segments=7, bevel=0.15, phase=rng.uniform(0, 1)), ch, "sandstone", weight=0.08)
    b.add(M.bm_cylinder((x, y), r * 0.95, z - r * 1.6, z - 1.2, segments=7, radius_top=r * 0.98, phase=rng.uniform(0, 1)), ch, "basalt", weight=0.03)
    b.add(M.bm_cylinder((x, y), r * 0.4, z - r * 2.6, z - r * 1.6, segments=7, radius_top=r * 0.9), ch, "basalt", weight=0.03)
    for k in range(rng.randint(2, 4)):
        a = rng.uniform(0, math.tau)
        d = rng.uniform(0.3, 0.7) * r
        h = rng.uniform(1.5, 5.5)
        cx, cy = x + math.cos(a) * d, y + math.sin(a) * d
        b.add(M.bm_cylinder((cx, cy), 0.45, z, z + h, segments=8, bevel=0.03), ch, "ruin", weight=0.06)
        b.add(M.bm_box((cx, cy, z + h + 0.12), (1.1, 1.1, 0.24), rot_z=a, bevel=0.03), ch, "ruin", weight=0.06)
    if rng.random() < 0.6:
        a = rng.uniform(0, math.tau)
        b.add(M.bm_box((x, y, z + 1.4), (r * 1.2, 0.7, 2.8), rot_z=a, bevel=0.05), ch, "ruin", weight=0.06)


def build_scenery(b, plats, rng, keep_out):
    # lava sea, one big slab
    b.add(M.bm_box((40, 60, LAVA_Z - 0.5), (900, 900, 1.0)), "lava", "lava")
    xs = [p.center.x for p in plats]
    ys = [p.center.y for p in plats]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2

    def path_dist(x, y):
        return min(math.hypot(x - p.center.x, y - p.center.y) for p in plats)

    def clear_of_cameras(x, y, r):
        return all(math.hypot(x - k[0], y - k[1]) > r + 12 for k in keep_out)

    # an uneven ring of mesas framing the course like a caldera wall
    for k in range(30):
        a = k * math.tau / 30 + rng.uniform(-0.06, 0.06)
        rx = (max(xs) - min(xs)) / 2 + rng.uniform(95, 130)
        ry = (max(ys) - min(ys)) / 2 + rng.uniform(95, 130)
        c = (cx + math.cos(a) * rx, cy + math.sin(a) * ry)
        r = rng.uniform(20, 32)
        h = rng.uniform(24, 70)
        if not clear_of_cameras(c[0], c[1], r):
            continue
        rock_mass(b, c, r, h, rng, f"cliff{k * 4 // 30}", weight=0.0015)
    # big mesas in the inside corners so the course bends around them
    rock_mass(b, (cx + 12, cy - 30), 19.0, 26.0, rng, "cliff_core", segments=12, weight=0.02)
    rock_mass(b, (cx + 2, cy + 64), 12.0, 18.0, rng, "cliff_core", segments=12, weight=0.02)
    # closer basalt spires between the course and the ring
    placed = 0
    tries = 0
    while placed < 18 and tries < 600:
        tries += 1
        x = rng.uniform(min(xs) - 80, max(xs) + 80)
        y = rng.uniform(min(ys) - 80, max(ys) + 80)
        if path_dist(x, y) < 22 or not clear_of_cameras(x, y, 8):
            continue
        rock_mass(b, (x, y), rng.uniform(3.0, 7.0), rng.uniform(-4, 16), rng, f"spire{placed % 3}", mat="basalt",
                  segments=8, weight=0.01, spire=True)
        placed += 1
    placed = 0
    tries = 0
    while placed < 9 and tries < 400:
        tries += 1
        x = rng.uniform(min(xs) - 60, max(xs) + 60)
        y = rng.uniform(min(ys) - 60, max(ys) + 60)
        if path_dist(x, y) < 24 or not clear_of_cameras(x, y, 8):
            continue
        floating_ruin(b, (x, y, rng.uniform(-2, 9)), rng, f"isle{placed % 3}")
        placed += 1


def build_arches(b, plats):
    for p in plats:
        if p.kind == "checkpoint":
            f = M.heading_vec(p.heading)
            c = p.center - f * (p.length / 2 - 0.9)
            arch(b, Vector((c.x, c.y, p.z)), p.heading, p.width + 0.6, 5.6, chunk_of(p), depth=0.9, pillar=0.9)


# ---------------------------------------------------------------------------
# triggers, spawns, meta


def plat_aabb(p, z0, z1, pad=0.0):
    cs = p.corners()
    mn = (min(c.x for c in cs) - pad, min(c.y for c in cs) - pad, z0)
    mx = (max(c.x for c in cs) + pad, max(c.y for c in cs) + pad, z1)
    return M.aabb_three(mn, mx)


def make_triggers(plats):
    triggers = []
    start = plats[0]
    mn, mx = plat_aabb(start, start.z - 0.5, start.z + 3.0, pad=-0.2)
    triggers.append({"id": "start", "type": "start", "min": mn, "max": mx,
                     "target": {"position": M.to_three((start.center.x, start.center.y - 3.0, start.z + 0.05)), "yawDeg": 0.0}})
    cp_index = 0
    for p in plats:
        if p.kind == "checkpoint":
            cp_index += 1
            mn, mx = plat_aabb(p, p.z - 0.5, p.z + 3.0)
            back = p.center - M.heading_vec(p.heading) * (p.length / 2 - 1.2)
            triggers.append({
                "id": f"cp{cp_index}", "type": "checkpoint", "stage": cp_index, "min": mn, "max": mx,
                "target": {"position": M.to_three((back.x, back.y, p.z + 0.05)), "yawDeg": M.yaw_deg(*M.heading_vec(p.heading)[:2])},
            })
    fin = plats[-1]
    mn, mx = plat_aabb(fin, fin.z - 0.5, fin.z + 3.0, pad=-0.3)
    triggers.append({"id": "finish", "type": "finish", "min": mn, "max": mx})
    # lava catch per section, a few metres under that section's lowest top
    sections = {}
    for p in plats:
        sections.setdefault(p.section, []).append(p)
    for s, ps in sorted(sections.items()):
        low = min(p.z for p in ps)
        cs = [c for p in ps for c in p.corners()]
        mn = (min(c.x for c in cs) - 7, min(c.y for c in cs) - 7, LAVA_Z - 30)
        mx = (max(c.x for c in cs) + 7, max(c.y for c in cs) + 7, low - 3.5)
        a, b = M.aabb_three(mn, mx)
        triggers.append({"id": f"lava_s{s}", "type": "teleport", "min": a, "max": b})
    xs = [c.x for p in plats for c in p.corners()]
    ys = [c.y for p in plats for c in p.corners()]
    a, b = M.aabb_three((min(xs) - 120, min(ys) - 120, LAVA_Z - 60), (max(xs) + 120, max(ys) + 120, LAVA_Z + 1.5))
    triggers.append({"id": "lava", "type": "teleport", "min": a, "max": b})
    return triggers


def main():
    opts = M.parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    folder = M.tmp_dir(MAP_ID)
    make_materials(folder)
    rng = random.Random(1234)
    plats = layout_course()
    start = plats[0]
    fin = plats[-1]
    mid = plats[len(plats) // 2]
    spawn = (start.center.x, start.center.y - 3.0, start.z + 0.05)
    views = {
        "overview": {"location": (start.center.x - 34, start.center.y - 30, 44), "target": (mid.center.x - 6, mid.center.y - 4, -6), "lens": 20},
        "eye": {"location": (spawn[0] + 0.6, spawn[1] + 7.5, spawn[2] + 1.6), "target": (plats[3].center.x, plats[3].center.y + 6, plats[3].z - 0.6),
                "lens": M.world_lens_for_fov(100)},
        "thumb": {"location": (start.center.x - 22, start.center.y - 18, 18), "target": (plats[8].center.x, plats[8].center.y, -2), "lens": 22, "resolution": (960, 540)},
        "finish": {"location": (fin.center.x - 16, fin.center.y - 26, fin.z + 9), "target": (fin.center.x, fin.center.y, fin.z + 2), "lens": 24},
    }
    b = M.MapBuilder(MAP_ID, sink_z=LAVA_Z)
    for p in plats:
        if p.kind == "start":
            build_start(b, p)
        elif p.kind == "finish":
            build_finish(b, p)
        else:
            build_platform(b, p, rng)
    build_arches(b, plats)
    build_scenery(b, plats, rng, [v["location"] for v in views.values()])

    spawns = [{"position": M.to_three(spawn), "yawDeg": 0.0}]
    for dx in (-2.0, 2.0):
        spawns.append({"position": M.to_three((spawn[0] + dx, spawn[1] - 0.5, spawn[2])), "yawDeg": 0.0})
    jumps = len([p for p in plats if p.kind != "start"])
    meta = {
        "id": MAP_ID,
        "name": "Emberdrift",
        "author": "WebStrafe Team",
        "source": "Original map built in Blender by tools/blender/maps/build_bhop_emberdrift.py",
        "license": "Original work (MIT, same as the project)",
        "attribution": "Original layout and procedural textures made for WebStrafe.",
        "spawns": spawns,
        "triggers": make_triggers(plats),
        # autobhop bhop servers run 1000 (sharptimer's bhop config, shavit's normal style)
        "cvars": {"sv_airaccelerate": 1000},
        "notes": f"{jumps} jumps, checkpoints every six, lava teleports to the last checkpoint.",
    }
    layout = {
        "id": MAP_ID,
        "note": "generated by build_bhop_emberdrift.py, blender coordinates (z up)",
        "lavaZ": LAVA_Z,
        "platforms": [
            {"index": p.index, "kind": p.kind, "section": p.section, "tag": p.tag,
             "center": [round(p.center.x, 3), round(p.center.y, 3)], "top": p.z,
             "length": p.length, "width": p.width, "heading": p.heading}
            for p in plats
        ],
    }
    M.finish_map(b, ENV, meta, views, opts, layout=layout)


main()
