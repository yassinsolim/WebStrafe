"""Lumen: one long, calm beginner line over a bright lagoon on a clear morning.
pearl stone plazas with gold trim, six wide sea-glass ramps that shift from aqua
to peach along the line, lantern arches over every gap and a lighthouse by the
finish.

  blender -b --factory-startup --python-exit-code 1 -P tools/blender/maps/build_surf_lumen.py -- [--no-bake] [--no-render] [--no-package]

one stage: drop through the gate onto the first ramp, ride six ramps from 50 to
56 degrees, land on the walled finish plaza. every ramp is wider than the one
before it and sits 9 to 10 m under the previous ridge after a 5.5 to 6 m gap, so
a slow rider (about 12 m/s) anywhere on a face still lands above the next one.
the faces carry faint depth lines at a quarter, half and three quarters down.
falling off anywhere teleports you back to the start.
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
import surflib as S  # noqa: E402

MAP_ID = "surf_lumen"
TEX_SEED = 61

ENV = {
    "sun_azimuth": 205.0,
    "sun_elevation": 47.0,
    "sun_strength": 4.0,
    "sun_color": "#fff3de",
    "sun_angle": 1.0,
    "sky_strength": 1.3,
    "sky": {
        "zenith": "#6aa9e4",
        "horizon": "#fbe9d4",
        "ground": "#f6ecdf",
        "bake_ground": "#b9e3dd",
        "exponent": 0.55,
        "sun_size_deg": 2.0,
        "sun_glow": 0.42,
        "sun_haze": 0.2,
        "clouds": {"color": "#fffaf3", "shadow": "#cdbfb4", "coverage": 0.32, "scale": 0.65, "speed": 0.005, "height": 0.2},
    },
    "bake_ground_scale": 0.75,
    "hemi": {"sky": "#d6e6f5", "ground": "#e9ddc8", "intensity": 2.3},
    "fog": {"color": "#f6e8d7", "near": 170.0, "far": 1150.0},
    "exposure": 1.0,
}

# pastel per ramp, cool to warm along the line: (name, base, deep)
RAMP_TINTS = [
    ("aqua", "#63cdd0", "#2b8f98"),
    ("seafoam", "#74d6b0", "#2f9474"),
    ("sky", "#7cb6ea", "#3a70b3"),
    ("lilac", "#a597e6", "#5f51ad"),
    ("blush", "#eb9fb7", "#b0576f"),
    ("peach", "#f3b784", "#bd7440"),
]

# one stage, six ramps. the first starts under the gate, the rest follow after
# `gap` metres with their ridge `drop` under the previous ridge end
RAMPS = [
    dict(length=88, height=16.0, angle=50, tilt=3.0),
    dict(length=84, height=17.5, angle=51, gap=5.5, drop=9.0, tilt=4.0),
    dict(length=80, height=18.5, angle=52, gap=5.5, drop=9.0, tilt=4.0),
    dict(length=80, height=19.5, angle=53, gap=6.0, drop=9.5, tilt=5.0),
    dict(length=78, height=20.5, angle=54, gap=6.0, drop=9.5, tilt=5.0),
    dict(length=92, height=22.5, angle=56, gap=6.0, drop=10.0, tilt=6.0),
]

START_HALF = (14.0, 12.0)
FINISH_LEN = 48.0
FINISH_HALF_LAT = 18.0
GATE_HALF = 6.0
LAGOON_DROP = 78.0   # lagoon surface under the finish plaza
# fastest full run of the headless test rider (src/world/__tests__/surfRiders.ts), rounded
PAR_TIME_MS = 26900


# ---------------------------------------------------------------------------
# textures


def tex_limestone(folder):
    tg = M.TexGen(1024, TEX_SEED)
    cloud = tg.fbm(3, 5)
    grain = tg.noise(260)
    # faint wandering veins, only where a second noise lets them through
    vein = 1.0 - M.smoothstep(0.0, 0.012, np.abs(tg.fbm(2, 5) - 0.5))
    vein = vein * M.smoothstep(0.45, 0.75, tg.fbm(4, 3))
    seam = 1.0 - M.smoothstep(0.001, 0.003, np.minimum(M.line_dist(tg.u, 2) / 2, M.line_dist(tg.v, 2) / 2))
    slab = np.floor(tg.u * 2) + np.floor(tg.v * 2) * 2
    tint = (np.sin(slab * 57.3) * 4375.85) % 1.0
    t = 0.74 + 0.08 * (cloud - 0.5) + 0.04 * (grain - 0.5) + 0.05 * (tint - 0.5)
    col = M.mix(M.hex_rgb("#c7bba8"), M.hex_rgb("#efe7d9"), np.clip(t, 0, 1))
    col = M.mix(col, M.hex_rgb("#c9b491"), vein * 0.25)
    col = col * (1 - 0.14 * seam[..., None])
    return M.save_texture("limestone", col, folder)


def tex_gold(folder):
    tg = M.TexGen(256, TEX_SEED + 1)
    brushed = tg.fbm(2, 3, cells_v=30)
    col = M.mix(M.hex_rgb("#b8893a"), M.hex_rgb("#f2d488"), 0.35 + 0.55 * brushed)
    return M.save_texture("gold", col, folder)


def tex_ramp(folder, name, base, deep, seed):
    tg = M.TexGen(1024, TEX_SEED + seed)
    u, v = tg.u, tg.v
    # pearl face with a pastel wash that pools towards the foot
    pearl = M.mix(M.hex_rgb("#e9e4db"), M.hex_rgb("#fbf9f4"), M.smoothstep(0.0, 1.0, v))
    wash = (1.0 - M.smoothstep(0.1, 0.8, v)) * 0.55 + 0.12
    col = M.mix(pearl, M.hex_rgb(base), wash)
    # soft sea-glass ripples running along the ramp
    ripple = 0.5 + 0.5 * np.sin((u * 5.0 + 0.35 * np.sin(v * 9.0 + u * 2.0 * np.pi)) * 2 * np.pi)
    col = M.mix(col, M.hex_rgb(base), ripple * 0.06)
    frost = tg.fbm(6, 4)
    col = col * (0.96 + 0.06 * frost[..., None])
    # depth lines a quarter, half and three quarters down the face, in the tint
    for lv, strength in ((0.25, 0.55), (0.5, 0.7), (0.75, 0.55)):
        line = 1.0 - M.smoothstep(0.003, 0.007, np.abs(v - lv))
        col = M.mix(col, M.hex_rgb(deep), line * strength)
    # panel joints every third of a tile
    seam = 1.0 - M.smoothstep(0.0015, 0.004, M.line_dist(u, 3) / 3)
    col = col * (1 - 0.12 * seam[..., None])
    # gold ridge band, tinted foot band
    ridge = M.smoothstep(0.94, 0.955, v)
    col = M.mix(col, M.hex_rgb("#efcd7a"), ridge * 0.92)
    foot = 1.0 - M.smoothstep(0.03, 0.045, v)
    col = M.mix(col, M.hex_rgb(deep), foot * 0.9)
    return M.save_texture(name, col, folder)


def tex_under(folder):
    tg = M.TexGen(512, TEX_SEED + 20)
    n = tg.fbm(4, 4)
    rib = 1.0 - M.smoothstep(0.004, 0.012, M.line_dist(tg.u, 4) / 4)
    col = M.mix(M.hex_rgb("#bdb4a6"), M.hex_rgb("#e6dfd3"), n)
    col = col * (1 - 0.2 * rib[..., None])
    return M.save_texture("under", col, folder)


def tex_column(folder):
    tg = M.TexGen(512, TEX_SEED + 21)
    flute = 0.5 + 0.5 * np.cos(tg.u * 2 * np.pi * 12)
    n = tg.fbm(3, 4, cells_v=6)
    col = M.mix(M.hex_rgb("#d8d0c2"), M.hex_rgb("#fbf7ef"), 0.45 + 0.35 * flute + 0.2 * (n - 0.5))
    return M.save_texture("column", col, folder)


def tex_water(folder):
    tg = M.TexGen(1024, TEX_SEED + 22)
    swell = tg.fbm(2, 5)
    glint = M.smoothstep(0.62, 0.8, tg.fbm(12, 3)) * M.smoothstep(0.4, 0.7, tg.fbm(3, 3))
    col = M.mix(M.hex_rgb("#2aa2b0"), M.hex_rgb("#62d3cf"), np.clip(0.25 + 0.65 * swell, 0, 1))
    col = M.mix(col, M.hex_rgb("#bdf1ea"), glint * 0.35)
    emit = col * 0.42
    return M.save_texture("water", col, folder), M.save_texture("water_emit", emit, folder)


def tex_sand(folder):
    tg = M.TexGen(512, TEX_SEED + 23)
    n = tg.fbm(4, 5)
    ripple = 0.5 + 0.5 * np.sin((tg.v * 14 + tg.fbm(2, 3) * 3) * 2 * np.pi)
    col = M.mix(M.hex_rgb("#d4bf98"), M.hex_rgb("#efe1c4"), np.clip(0.5 + 0.35 * (n - 0.5) + 0.12 * ripple, 0, 1))
    return M.save_texture("sand", col, folder)


def tex_rock(folder):
    tg = M.TexGen(512, TEX_SEED + 24)
    warp = tg.fbm(2, 4)
    band = 0.5 + 0.5 * np.sin((tg.v * 6 + (warp - 0.5) * 1.6) * 2 * np.pi)
    n = tg.fbm(6, 5)
    col = M.mix(M.hex_rgb("#a99a86"), M.hex_rgb("#e3d8c6"), np.clip(0.3 + 0.35 * band + 0.3 * (n - 0.5), 0, 1))
    return M.save_texture("rock", col, folder)


def tex_lighthouse(folder):
    tg = M.TexGen(512, TEX_SEED + 25)
    band = (tg.v * 5) % 1.0 < 0.5
    n = tg.fbm(3, 4)
    white = M.mix(M.hex_rgb("#e2ddd4"), M.hex_rgb("#fbf8f3"), n)
    coral = M.mix(M.hex_rgb("#d8705a"), M.hex_rgb("#f08d74"), n)
    col = np.where(band[..., None], coral, white)
    return M.save_texture("lighthouse", col, folder)


def make_materials(folder):
    M.material("limestone", image=tex_limestone(folder), tile=4.0, roughness=0.8)
    M.material("gold", image=tex_gold(folder), tile=(1.5, 0.4), roughness=0.35, metallic=0.7, weight=0.5)
    for i, (name, base, deep) in enumerate(RAMP_TINTS):
        M.material(f"ramp_{name}", image=tex_ramp(folder, f"ramp_{name}", base, deep, 2 + i), tile=(12.0, 1.0),
                   roughness=0.45, weight=0.2)
    M.material("under", image=tex_under(folder), tile=4.0, roughness=0.8, weight=0.05)
    M.material("column", image=tex_column(folder), tile=(4.0, 12.0), roughness=0.7, weight=0.012)
    water, water_emit = tex_water(folder)
    M.material("water", image=water, emissive_image=water_emit, emissive_strength=1.0, lit=False, tile=90.0, roughness=0.2)
    M.material("sand", image=tex_sand(folder), tile=8.0, roughness=0.95, weight=0.004)
    M.material("rock", image=tex_rock(folder), tile=(10.0, 8.0), roughness=0.9, weight=0.003)
    M.material("lighthouse", image=tex_lighthouse(folder), tile=(12.0, 24.0), roughness=0.6, weight=0.01)
    M.material("glow_lantern", color=(0.3, 0.25, 0.15), emissive=M.lin("#ffd79a"), emissive_strength=2.6, lit=False)
    M.material("glow_aqua", color=(0.1, 0.25, 0.25), emissive=M.lin("#a8f4ec"), emissive_strength=2.2, lit=False)


# ---------------------------------------------------------------------------
# layout


def layout():
    start = S.Frame((0.0, 0.0), 0.0, 0.0)
    ramps = S.chain(0, start, RAMPS, START_HALF[1] - S.GATE_TUCK, -S.GATE_DROP)
    last = ramps[-1]
    land_s0 = last.s1 + S.LANDING_GAP
    land_top = last.end_bottom()
    c = start.p(0.0, land_s0 + FINISH_LEN / 2)
    finish = S.Frame((c[0], c[1]), land_top, 0.0)
    return start, ramps, finish, (land_s0, FINISH_LEN, land_top, FINISH_HALF_LAT)


# ---------------------------------------------------------------------------
# geometry


def bm_orb(center, radius, segments=8, rings=5):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=radius)
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    return bm


def build_ramp(b, ramp, lagoon_z):
    name = RAMP_TINTS[ramp.index][0]
    ch = f"r{ramp.index + 1}"
    S.build_ramp(b, ramp, ch, f"ramp_{name}", "under")
    for side in (-1, 1):
        S.edge_strip(b, ramp, side, ch, "gold", size=0.18)
    fr = ramp.frame
    w = ramp.half_width
    # a pair of slender columns every ~30 m, standing in the lagoon
    n = max(2, int(ramp.length / 30))
    for i in range(n):
        t = (i + 0.5) / n
        fwd = ramp.s0 + ramp.length * t
        bottom = fr.z + ramp.ridge_at(fwd) - ramp.height
        c = fr.p(ramp.lateral, fwd, 0.0)
        b.add(M.bm_box((c[0], c[1], bottom - 0.45), (w * 1.6, 1.4, 0.9), rot_z=fr.rot, bevel=0.1), ch, "under", rot_z=fr.rot)
        for side in (-1, 1):
            e = fr.p(ramp.lateral + side * w * 0.45, fwd, 0.0)
            b.add(M.bm_cylinder((e[0], e[1]), 0.8, lagoon_z - 2.0, bottom - 0.9, segments=10, radius_top=0.6), ch, "column",
                  weight=0.012)
            b.add(M.bm_cylinder((e[0], e[1]), 1.1, bottom - 2.0, bottom - 0.9, segments=10), ch, "gold", weight=0.05)


def lantern_arch(b, ramp, nxt, ch, lagoon_z):
    """round arch over the gap between two ramps (render only), standing in the
    lagoon with its legs well outside both ramps, with a glowing inner rim"""
    fr = ramp.frame
    fwd = (ramp.s1 + nxt.s0) / 2
    r_in = max(ramp.half_width, nxt.half_width) + 9.0
    base = lagoon_z - 2.0
    spring = (fr.z + ramp.end_ridge() + 4.0) - base
    c = fr.p(ramp.lateral, fwd)
    b.add(S.bm_ring_arch(c, fr.rot, r_in, r_in + 2.0, spring, 1.8, base, segments=18), ch, "limestone", rot_z=fr.rot,
          weight=0.03)
    b.add(S.bm_ring_arch(c, fr.rot, r_in - 0.18, r_in + 0.02, spring, 0.6, base, segments=18), ch, "glow_lantern")
    # a lantern hanging under the crown
    k = fr.p(ramp.lateral, fwd, 0.0)
    top = base + spring + r_in
    b.add(M.bm_cylinder((k[0], k[1]), 0.05, top - 3.2, top, segments=6), ch, "gold")
    b.add(bm_orb((k[0], k[1], top - 3.9), 0.8), ch, "glow_lantern")


def build_start(b, fr):
    hl, hf = START_HALF
    ch = "start"
    S.slab(b, fr, hl, hf, ch, "limestone", rim=("gold", 0.28))
    b.add(M.bm_box(fr.p(0, 0, -2.6), (hl * 1.5, hf * 1.1, 2.0), rot_z=fr.rot, bevel=0.1), ch, "under", rot_z=fr.rot, weight=0.04)
    S.platform_walls(b, fr, hl, hf, "start", ch, "limestone", gate_half=GATE_HALF, height=2.4, cap=("gold", 0.2))
    # the gate: two posts and an arch with a lantern keystone, well above head height
    for side in (-1, 1):
        p = fr.p(side * (GATE_HALF + 0.3), hf - 0.4)
        b.add(M.bm_box((p[0], p[1], fr.z + 2.6), (0.7, 1.0, 5.2), rot_z=fr.rot, bevel=0.06), ch, "limestone", rot_z=fr.rot)
        b.collide(M.bm_box((p[0], p[1], fr.z + 2.6), (0.7, 1.0, 5.2), rot_z=fr.rot))
    g = fr.p(0, hf - 0.4)
    b.add(S.bm_ring_arch(g, fr.rot, GATE_HALF - 0.05, GATE_HALF + 0.65, 5.2, 1.0, fr.z, segments=14, legs=False), ch,
          "limestone", rot_z=fr.rot)
    b.add(S.bm_ring_arch(g, fr.rot, GATE_HALF - 0.2, GATE_HALF - 0.03, 5.2, 0.4, fr.z, segments=14, legs=False), ch,
          "glow_lantern")
    # corner lanterns on short posts and a pale inlay ring on the floor
    for sx in (-1, 1):
        for sy in (-1, 1):
            p = fr.p(sx * (hl - 1.6), sy * (hf - 1.6))
            b.add(M.bm_cylinder((p[0], p[1]), 0.18, fr.z, fr.z + 1.9, segments=8), ch, "gold")
            b.add(bm_orb((p[0], p[1], fr.z + 2.2), 0.36), ch, "glow_lantern")
    for i in range(24):
        a = i * math.tau / 24
        p = fr.p(math.cos(a) * 5.0, -3.0 + math.sin(a) * 5.0, 0.014)
        b.add(M.bm_box(p, (1.1, 0.16, 0.02), rot_z=a + math.pi / 2), ch, "gold")


def build_finish(b, fr):
    hl, hf = FINISH_HALF_LAT, FINISH_LEN / 2
    ch = "finish"
    S.slab(b, fr, hl, hf, ch, "limestone", rim=("gold", 0.28))
    b.add(M.bm_box(fr.p(0, 0, -2.8), (hl * 1.5, hf * 1.5, 2.4), rot_z=fr.rot, bevel=0.1), ch, "under", rot_z=fr.rot, weight=0.04)
    # tall end wall: the line arrives fast and high
    S.platform_walls(b, fr, hl, hf, "finish", ch, "limestone", height=2.4, end_height=11.0, cap=("gold", 0.2))
    # sun rosette on the floor and lanterns along the walls
    for i in range(16):
        a = i * math.tau / 16
        p = fr.p(math.cos(a) * 6.5, 4.0 + math.sin(a) * 6.5, 0.014)
        b.add(M.bm_box(p, (4.0, 0.3, 0.02), rot_z=a), ch, "gold")
    b.add(M.bm_cylinder(fr.p(0, 4.0)[:2], 1.6, fr.z + 0.004, fr.z + 0.024, segments=16), ch, "glow_lantern")
    for sy in (-0.6, -0.1, 0.4):
        for sx in (-1, 1):
            p = fr.p(sx * (hl - 1.4), sy * hf)
            b.add(M.bm_cylinder((p[0], p[1]), 0.18, fr.z, fr.z + 1.9, segments=8), ch, "gold")
            b.add(bm_orb((p[0], p[1], fr.z + 2.2), 0.36), ch, "glow_lantern")
    # sun disc on the end wall, facing the arrivals
    e = fr.p(0, hf - 0.84)
    disc = M.bm_cylinder((0, 0), 2.6, -0.1, 0.1, segments=20)
    M._transform(disc, fr.rot, (e[0], e[1], fr.z + 6.2), rot_x=math.pi / 2)
    b.add(disc, ch, "glow_lantern")


def build_lighthouse(b, center, water_z, top_z):
    ch = "lighthouse"
    x, y = center
    b.add(M.bm_rock((x, y), 34.0, water_z - 4.0, water_z + 5.0, random.Random(3), segments=14, rings=3, taper=0.25, jitter=0.1),
          "isles", "sand", weight=0.004)
    b.add(M.bm_rock((x + 6, y - 4), 16.0, water_z - 2.0, water_z + 14.0, random.Random(4), segments=11, rings=4, taper=0.4),
          "isles", "rock", weight=0.003)
    b.add(M.bm_cylinder(center, 6.0, water_z + 10.0, top_z, segments=16, radius_top=4.2), ch, "lighthouse")
    b.add(M.bm_cylinder(center, 5.4, top_z, top_z + 0.8, segments=16), ch, "gold")
    b.add(M.bm_cylinder(center, 3.4, top_z + 0.8, top_z + 5.2, segments=12), ch, "glow_lantern")
    b.add(M.bm_cylinder(center, 4.2, top_z + 5.2, top_z + 9.0, segments=12, radius_top=0.4), ch, "lighthouse")


def build_lagoon(b, center, water_z, rng, keep_out):
    # far bigger than the fog distance so its edge never shows
    b.add(M.bm_box((center[0], center[1], water_z - 0.5), (4200.0, 4200.0, 1.0)), "lagoon", "water")
    placed = 0
    tries = 0
    while placed < 16 and tries < 600:
        tries += 1
        x = center[0] + rng.uniform(-520, 520)
        y = center[1] + rng.uniform(-420, 420)
        if any(math.hypot(x - k[0], y - k[1]) < k[2] for k in keep_out):
            continue
        r = rng.uniform(14, 40)
        ch = f"isle{placed % 3}"
        b.add(M.bm_rock((x, y), r, water_z - 3.0, water_z + rng.uniform(1.5, 3.5), rng, segments=12, rings=2, taper=0.3,
                        jitter=0.14), ch, "sand", weight=0.002)
        if rng.random() < 0.7:
            rr = r * rng.uniform(0.25, 0.45)
            a = rng.uniform(0, math.tau)
            b.add(M.bm_rock((x + math.cos(a) * r * 0.3, y + math.sin(a) * r * 0.3), rr, water_z - 1.0,
                            water_z + rng.uniform(6, 22), rng, segments=9, rings=4, taper=0.5, jitter=0.2), ch, "rock",
                  weight=0.002)
        placed += 1


def build_sky_lanterns(b, ramps, rng):
    """floating lanterns drifting beside the line, out of reach"""
    for i in range(22):
        r = ramps[i % len(ramps)]
        fr = r.frame
        side = 1 if i % 2 else -1
        fwd = r.s0 + rng.uniform(0.1, 0.9) * r.length
        lat = r.lateral + side * (r.half_width + rng.uniform(14, 40))
        z = r.ridge_at(fwd) + rng.uniform(-8, 14)
        p = fr.p(lat, fwd, z)
        b.add(bm_orb(p, rng.uniform(0.6, 1.1)), f"lanterns{i % 2}", "glow_lantern")


# ---------------------------------------------------------------------------
# main


def main():
    opts = M.parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    folder = M.tmp_dir(MAP_ID)
    make_materials(folder)
    rng = random.Random(29)
    start, ramps, finish, landing = layout()
    lagoon_z = finish.z - LAGOON_DROP
    b = M.MapBuilder(MAP_ID, sink_z=lagoon_z + 0.5)

    for r in ramps:
        build_ramp(b, r, lagoon_z)
    for a, nxt in zip(ramps, ramps[1:]):
        lantern_arch(b, a, nxt, "arches", lagoon_z)
    build_start(b, start)
    build_finish(b, finish)

    xs = [v[0] for v in b.col_verts]
    ys = [v[1] for v in b.col_verts]
    center = ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2)
    house = finish.p(-78.0, 30.0)[:2]
    build_lighthouse(b, house, lagoon_z, finish.z + 26.0)
    keep = [(house[0], house[1], 90.0)]
    keep += [(r.frame.p(r.lateral, (r.s0 + r.s1) / 2)[0], r.frame.p(r.lateral, (r.s0 + r.s1) / 2)[1], 70.0) for r in ramps]
    keep += [(start.p(0, 0)[0], start.p(0, 0)[1], 80.0), (finish.p(0, 0)[0], finish.p(0, 0)[1], 70.0)]
    build_lagoon(b, center, lagoon_z, rng, keep)
    build_sky_lanterns(b, ramps, rng)

    hl, hf = START_HALF
    spawns = [{"position": M.to_three(start.p(lat, -6.0, 0.05)), "yawDeg": M.yaw_deg(*start.f[:2])} for lat in (0.0, -4.0, 4.0)]
    start_target = {"position": spawns[0]["position"], "yawDeg": spawns[0]["yawDeg"]}
    triggers = []
    mn, mx = S.platform_volume(start, -hl + 0.8, hl - 0.8, -hf + 0.8, hf - 0.8)
    triggers.append({"id": "start", "type": "start", "min": mn, "max": mx, "target": start_target})
    fhl, fhf = FINISH_HALF_LAT, FINISH_LEN / 2
    mn, mx = S.platform_volume(finish, -fhl + 0.8, fhl - 0.8, -fhf + 0.5, fhf - 0.8, z1=14.0)
    triggers.append({"id": "finish", "type": "finish", "min": mn, "max": mx})
    # one catch volume under each ramp, stepping down with the line. each stops a
    # metre before the next ramp so it never reaches under that ramp's face
    for i, r in enumerate(ramps):
        ahead = ramps[i + 1].s0 - r.s1 - 1.0 if i + 1 < len(ramps) else 7.0
        mn, mx = S.fall_volume([r], ahead=ahead)
        triggers.append({"id": f"fall{i + 1}", "type": "teleport", "stage": 1, "min": mn, "max": mx, "target": start_target})
    mn, mx = S.void_volume(b)
    triggers.append({"id": "void", "type": "teleport", "min": mn, "max": mx})

    meta = {
        "id": MAP_ID,
        "name": "Lumen",
        "author": "WebStrafe Team",
        "source": "Original map built in Blender by tools/blender/maps/build_surf_lumen.py",
        "license": "Original work (MIT, same as the project)",
        "attribution": "Original layout and procedural textures made for WebStrafe.",
        "spawns": spawns,
        "triggers": triggers,
        "cvars": {"sv_airaccelerate": 100},
        "modes": ["surf"],
        "difficulty": "beginner",
        "parTimeMs": PAR_TIME_MS,
        "notes": "Beginner surf. One stage, six wide ramps from 50 to 56 degrees. Falling off teleports you back to the start.",
    }
    layout_json = S.layout_json(MAP_ID, "build_surf_lumen.py", [start], [START_HALF], [landing], ramps, [0], extra={
        "finish": {"origin": M.to_three(finish.p(0, 0)), "halfLat": fhl, "halfFwd": fhf},
    })

    f0 = start
    views = {
        "overview": {"location": f0.p(-215.0, -95.0, 120.0), "target": f0.p(10.0, 265.0, -55.0), "lens": 20},
        "eye": {"location": f0.p(-2.0, 2.0, 1.6), "target": f0.p(3.0, 40.0, -12.0), "lens": M.world_lens_for_fov(100)},
        "thumb": {"location": f0.p(-62.0, -28.0, 30.0), "target": f0.p(0.0, 70.0, -16.0), "lens": 22, "resolution": (960, 540)},
        "ride": {"location": f0.p(8.0, 70.0, -10.0), "target": f0.p(3.0, 160.0, -22.0), "lens": M.world_lens_for_fov(100)},
    }
    M.finish_map(b, ENV, meta, views, opts, layout=layout_json)


main()
