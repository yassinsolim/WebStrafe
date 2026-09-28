"""Vanta: an advanced night surf line high above a city of lights, plus a combat
deck at spawn. graphite ramps edged in neon (cyan, magenta, lime, amber by
stage), dark steel decks, storm clouds and a big pale moon.

  blender -b --factory-startup --python-exit-code 1 -P tools/blender/maps/build_surf_vanta.py -- [--no-bake] [--no-render] [--no-package]

surf: four stages, ramps from 58 to 64 degrees with 6 to 7 m gaps. stages two
and three have a transfer: the line splits into two mirrored ramps that form a
valley, so a rider coming off the right face of one ramp lands on the left face
of the next (and back again onto the ramp after it). each stage ends on a walled
landing that is the next stage's start with a checkpoint, a teleport under each
stage sends you back to its start.

combat: the start pad opens through a doorway onto a flat 64 x 48 m deck with
point symmetric cover, four spawns per side (side a by the pad, side b across).
bots stage on side b.
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

MAP_ID = "surf_vanta"
TEX_SEED = 97

ENV = {
    "sun_azimuth": 318.0,
    "sun_elevation": 36.0,
    "sun_strength": 2.6,
    "sun_color": "#c8d3ff",
    "sun_angle": 0.9,
    "sky_strength": 1.0,
    "sky": {
        "zenith": "#05060f",
        "horizon": "#231d4a",
        "ground": "#08070f",
        "bake_ground": "#1a1638",
        "exponent": 0.5,
        "sun_size_deg": 2.8,
        "sun_glow": 0.5,
        "sun_haze": 0.22,
        "clouds": {"color": "#343660", "shadow": "#0c0c1c", "coverage": 0.55, "scale": 0.9, "speed": 0.012, "height": 0.14},
    },
    "bake_ground_scale": 0.9,
    "hemi": {"sky": "#3d4585", "ground": "#1a1530", "intensity": 1.5},
    "fog": {"color": "#1d1a3e", "near": 140.0, "far": 950.0},
    "exposure": 1.15,
}
# violet glow of the city for the faces turned away from the moon (bake only)
FILL = {"azimuth": 138.0, "elevation": 25.0, "strength": 2.0, "color": "#b98cff"}

# (name, neon hex) per stage
STAGE_NEON = [
    ("cyan", "#34f0ff"),
    ("magenta", "#ff3df2"),
    ("lime", "#a6ff3a"),
    ("amber", "#ffb52e"),
]

# ramps per stage. `fork` splits a slot into two mirrored ramps at lateral
# +-fork: a rider on the right face of the ramp before lands on the left face
# of the right half (a transfer) and comes back onto the right face after it
STAGES = [
    [
        dict(length=90, height=16.0, angle=58, tilt=3.0),
        dict(length=80, height=18.0, angle=59, gap=6.0, drop=9.5, tilt=3.0),
        dict(length=72, height=19.5, angle=60, gap=6.5, drop=9.5, tilt=4.0),
    ],
    [
        dict(length=70, height=16.0, angle=60, tilt=2.0),
        dict(length=62, height=18.0, angle=61, gap=6.0, drop=9.0, tilt=2.0, fork=9.0),
        dict(length=70, height=19.5, angle=61, gap=6.0, drop=9.5, tilt=4.0),
    ],
    [
        dict(length=76, height=16.5, angle=62, tilt=3.0),
        dict(length=60, height=18.5, angle=62, gap=6.5, drop=9.5, tilt=2.0),
        dict(length=58, height=19.5, angle=63, gap=6.0, drop=9.0, tilt=2.0, fork=9.5),
        dict(length=64, height=20.5, angle=63, gap=6.5, drop=9.5, tilt=3.0),
    ],
    [
        dict(length=72, height=17.0, angle=63, tilt=3.0),
        dict(length=66, height=19.0, angle=64, gap=7.0, drop=10.0, tilt=4.0),
        dict(length=80, height=21.0, angle=64, gap=7.0, drop=10.0, tilt=6.0),
    ],
]
TURNS = [1, -1, -1]

START_HALF = (13.0, 10.0)
LANDING_LEN = 40.0
LANDING_HALF_LAT = 15.0
FINISH_LEN = 50.0
FINISH_HALF_LAT = 16.0
GATE_HALF = 6.0
ARENA_HALF = (32.0, 24.0)    # combat deck behind the start pad: half lateral, half forward
DOOR_HALF = 6.0
CITY_DROP = 120.0            # city lights under the finish
# fastest full run of the headless test rider (src/world/__tests__/surfRiders.ts), rounded
PAR_TIME_MS = 72800

# combat cover for side a, arena frame (x lateral, y towards the start pad).
# side b is the same rotated 180 degrees about the deck centre.
# (x, y, size x, size y, height, rot, stack)
COVER = [
    (-11.0, 6.0, 4.5, 1.0, 1.6, 0.0, 1),
    (-13.25, 8.25, 1.0, 5.5, 1.6, 0.0, 1),
    (9.0, 11.0, 1.8, 1.8, 5.0, 0.0, 1),
    (21.0, 4.0, 1.8, 1.8, 5.0, 0.0, 1),
    (17.0, 14.5, 5.0, 0.8, 1.1, 0.35, 1),
    (-21.5, 13.5, 1.4, 1.4, 1.4, 0.2, 2),
    (-20.0, 14.6, 1.4, 1.4, 1.4, 0.05, 1),
    (2.5, 17.0, 3.5, 0.9, 1.2, 0.0, 1),
    (-26.5, -1.5, 1.2, 6.0, 2.2, 0.0, 1),
]
CENTER_BLOCK = (7.0, 3.2, 2.6)
ARENA_SPAWNS = [(-7.0, 20.5), (7.5, 21.0), (-18.0, 19.5), (24.0, 18.0)]


# ---------------------------------------------------------------------------
# textures


# ramps get 512 textures so the map fits the 16 MB texture memory budget (tools/assets/budgets.test.ts)
def tex_ramp(folder, name, neon, seed):
    tg = M.TexGen(512, TEX_SEED + seed)
    u, v = tg.u, tg.v
    grad = M.smoothstep(0.0, 1.0, v)
    # mid blue-grey rather than true graphite: the night comes from the light,
    # a near black albedo would leave the faces unreadable
    col = M.mix(M.hex_rgb("#4f5872"), M.hex_rgb("#9ba7c7"), 0.3 + 0.7 * grad)
    # brushed metal and faint hex cells
    brushed = tg.fbm(3, 3, cells_v=24)
    col = col * (0.9 + 0.16 * brushed[..., None])
    f1, f2, _ = tg.voronoi(64, jitter=0.35)
    cell = 1.0 - M.smoothstep(0.01, 0.035, f2 - f1)
    col = M.mix(col, M.hex_rgb("#c3cde6"), cell * 0.18)
    # panel grid: joints every sixth of a tile along the ramp, four bands up the face
    seam_u = 1.0 - M.smoothstep(0.001, 0.003, M.line_dist(u, 6) / 6)
    seam_v = 1.0 - M.smoothstep(0.002, 0.005, M.line_dist(v, 4) / 4) * (M.smoothstep(0.05, 0.1, v) * (1 - M.smoothstep(0.9, 0.95, v)))
    col = col * (1 - 0.35 * np.maximum(seam_u, 0)[..., None])
    col = M.mix(col, M.hex_rgb(neon), seam_v * 0.35)
    # neon tinted ridge band and a dark foot
    ridge = M.smoothstep(0.935, 0.95, v)
    col = M.mix(col, np.array(M.hex_rgb(neon), np.float32) * 0.8 + 0.15, ridge * 0.85)
    foot = 1.0 - M.smoothstep(0.03, 0.05, v)
    col = M.mix(col, M.hex_rgb("#0b0c12"), foot * 0.9)
    return M.save_texture(name, col, folder)


def tex_deck(folder):
    tg = M.TexGen(1024, TEX_SEED + 1)
    n = tg.fbm(4, 5)
    grain = tg.noise(300)
    plate = np.floor(tg.u * 4) + np.floor(tg.v * 4) * 4
    tint = (np.sin(plate * 91.3) * 43758.5) % 1.0
    seam = 1.0 - M.smoothstep(0.001, 0.0035, np.minimum(M.line_dist(tg.u, 4) / 4, M.line_dist(tg.v, 4) / 4))
    grip = 0.5 + 0.5 * np.sin((tg.u + tg.v) * 2 * np.pi * 90) * np.sin((tg.u - tg.v) * 2 * np.pi * 90)
    t = 0.5 + 0.18 * (n - 0.5) + 0.08 * (grain - 0.5) + 0.12 * (tint - 0.5) + 0.05 * (grip - 0.5)
    col = M.mix(M.hex_rgb("#4a5063"), M.hex_rgb("#8f97ab"), np.clip(t, 0, 1))
    col = col * (1 - 0.45 * seam[..., None])
    bolts = 1.0 - M.smoothstep(0.003, 0.006, np.sqrt((M.line_dist(tg.u + 0.02, 4) / 4) ** 2 + (M.line_dist(tg.v + 0.02, 4) / 4) ** 2))
    col = M.mix(col, M.hex_rgb("#cfd6e4"), bolts * 0.5)
    return M.save_texture("deck", col, folder)


def tex_hull(folder):
    tg = M.TexGen(512, TEX_SEED + 2)
    n = tg.fbm(3, 4)
    panel_v = 1.0 - M.smoothstep(0.002, 0.006, M.line_dist(tg.v, 3) / 3)
    panel_u = 1.0 - M.smoothstep(0.002, 0.006, M.line_dist(tg.u, 2) / 2)
    col = M.mix(M.hex_rgb("#3c4258"), M.hex_rgb("#7d859e"), 0.35 + 0.5 * n)
    col = col * (1 - 0.4 * np.maximum(panel_u, panel_v)[..., None])
    stripe = ((tg.u * 6 + tg.v * 6) % 1.0 < 0.5) & (tg.v < 0.08)
    col = np.where(stripe[..., None], np.array(M.hex_rgb("#c9a227"), np.float32) * 0.8, col)
    return M.save_texture("hull", col, folder)


def tex_cover(folder):
    tg = M.TexGen(512, TEX_SEED + 3)
    n = tg.fbm(4, 4)
    edge = np.minimum(np.minimum(tg.u, 1 - tg.u), np.minimum(tg.v, 1 - tg.v))
    rim = 1.0 - M.smoothstep(0.03, 0.05, edge)
    cross = (np.abs(tg.u - tg.v) < 0.03) | (np.abs(tg.u + tg.v - 1) < 0.03)
    col = M.mix(M.hex_rgb("#4d5470"), M.hex_rgb("#8e97b3"), 0.4 + 0.5 * n)
    col = M.mix(col, M.hex_rgb("#c4cce0"), rim * 0.6)
    col = np.where(cross[..., None], col * 0.7, col)
    return M.save_texture("cover", col, folder)


def tex_frame(folder):
    tg = M.TexGen(256, TEX_SEED + 4)
    n = tg.fbm(3, 4)
    col = M.mix(M.hex_rgb("#0f1018"), M.hex_rgb("#2a2d3c"), n)
    return M.save_texture("frame", col, folder)


def tex_city(folder):
    tg = M.TexGen(1024, TEX_SEED + 5)
    # warped street grids so the city never reads as a clean grid from above
    wu = tg.u + (tg.fbm(3, 3) - 0.5) * 0.04
    wv = tg.v + (tg.fbm(3, 3) - 0.5) * 0.04
    district = tg.fbm(3, 4)
    dark_patch = M.smoothstep(0.3, 0.45, tg.fbm(2, 3))       # parks and water stay dark
    arterial = 1.0 - M.smoothstep(0.0012, 0.0035, np.minimum(M.line_dist(wu, 5) / 5, M.line_dist(wv, 5) / 5))
    local = (1.0 - M.smoothstep(0.0006, 0.0018, np.minimum(M.line_dist(wu, 22) / 22, M.line_dist(wv, 22) / 22)))
    local = local * M.smoothstep(0.4, 0.65, tg.fbm(7, 3))
    windows = M.smoothstep(0.9 - 0.1 * district, 0.97 - 0.1 * district, tg.noise(512)) * (1 - arterial)
    base = M.mix(M.hex_rgb("#040408"), M.hex_rgb("#101221"), district * 0.8)
    warm = M.smoothstep(0.35, 0.7, tg.fbm(5, 3))
    lights = M.mix(M.hex_rgb("#ffd79c"), M.hex_rgb("#ff79d2"), warm * 0.6)
    col = M.mix(base, M.hex_rgb("#ffb65a"), arterial * 0.6 * dark_patch)
    col = M.mix(col, M.hex_rgb("#ffcf8a"), local * 0.35 * dark_patch)
    col = M.mix(col, lights, windows * dark_patch * 0.9)
    cyan = (1.0 - M.smoothstep(0.001, 0.003, M.line_dist(wu + 0.37, 2) / 2)) * M.smoothstep(0.5, 0.7, tg.fbm(4, 2))
    col = M.mix(col, M.hex_rgb("#58d6ff"), cyan * 0.6 * dark_patch)
    return M.save_texture("city", col * 0.35, folder), M.save_texture("city_emit", col, folder)


def tex_tower(folder):
    tg = M.TexGen(512, TEX_SEED + 6)
    rows = (tg.v * 40) % 1.0
    cols = (tg.u * 12) % 1.0
    window = (rows > 0.35) & (rows < 0.75) & (cols > 0.2) & (cols < 0.8)
    lit = (tg.noise(256) > 0.72) & window
    hue = tg.fbm(4, 3)
    body = M.mix(M.hex_rgb("#0b0c14"), M.hex_rgb("#1b1e2c"), tg.fbm(3, 3))
    glow = M.mix(M.hex_rgb("#ffd89a"), M.hex_rgb("#8fe6ff"), hue)
    col = np.where(lit[..., None], glow, body)
    return M.save_texture("tower", col * 0.4, folder), M.save_texture("tower_emit", np.where(lit[..., None], glow, 0.0), folder)


def make_materials(folder):
    for i, (name, neon) in enumerate(STAGE_NEON):
        M.material(f"ramp_{name}", image=tex_ramp(folder, f"ramp_{name}", neon, 10 + i), tile=(12.0, 1.0), roughness=0.4,
                   weight=0.2)
        M.material(f"neon_{name}", color=(0.1, 0.1, 0.1), emissive=M.lin(neon), emissive_strength=4.0, lit=False,
                   bake_emission_scale=3.0)
    M.material("deck", image=tex_deck(folder), tile=6.0, roughness=0.6, metallic=0.3)
    M.material("hull", image=tex_hull(folder), tile=(4.0, 3.0), roughness=0.5, metallic=0.4, weight=0.6)
    M.material("cover", image=tex_cover(folder), tile=1.0, roughness=0.55, metallic=0.3, weight=0.8, uv_mode="face")
    M.material("frame", image=tex_frame(folder), tile=4.0, roughness=0.6, metallic=0.4, weight=0.05)
    city, city_emit = tex_city(folder)
    M.material("city", image=city, emissive_image=city_emit, emissive_strength=1.6, lit=False, tile=320.0)
    tower, tower_emit = tex_tower(folder)
    M.material("tower", image=tower, emissive_image=tower_emit, emissive_strength=1.4, lit=False, tile=(18.0, 60.0))
    M.material("neon_white", color=(0.2, 0.2, 0.2), emissive=M.lin("#e6ecff"), emissive_strength=3.0, lit=False,
               bake_emission_scale=2.0)
    M.material("team_a", color=(0.1, 0.1, 0.1), emissive=M.lin("#34f0ff"), emissive_strength=2.4, lit=False)
    M.material("team_b", color=(0.1, 0.1, 0.1), emissive=M.lin("#ff4d8d"), emissive_strength=2.4, lit=False)


# ---------------------------------------------------------------------------
# layout


def layout():
    frames = []
    platforms = []
    landings = []
    ramps = []
    frame = S.Frame((0.0, 0.0), 0.0, 0.0)
    half = START_HALF
    for k, specs in enumerate(STAGES):
        frames.append(frame)
        platforms.append(half)
        stage_ramps = S.chain(k, frame, specs, half[1] - S.GATE_TUCK, -S.GATE_DROP)
        ramps += stage_ramps
        last = stage_ramps[-1]
        land_s0 = last.s1 + S.LANDING_GAP
        land_top = last.end_bottom()
        if k + 1 < len(STAGES):
            landings.append((land_s0, LANDING_LEN, land_top, LANDING_HALF_LAT))
            c = frame.p(0.0, land_s0 + LANDING_LEN / 2)
            frame = S.Frame((c[0], c[1]), frame.z + land_top, frame.heading + 90.0 * TURNS[k])
            half = (LANDING_LEN / 2, LANDING_HALF_LAT)
        else:
            landings.append((land_s0, FINISH_LEN, land_top, FINISH_HALF_LAT))
    last_frame = frames[-1]
    s0, length, top, _ = landings[-1]
    c = last_frame.p(0.0, s0 + length / 2)
    finish = S.Frame((c[0], c[1]), last_frame.z + top, last_frame.heading)
    a = frames[0].p(0.0, -(START_HALF[1] + ARENA_HALF[1]))
    arena = S.Frame((a[0], a[1]), frames[0].z, frames[0].heading)
    return frames, platforms, landings, ramps, finish, arena


# ---------------------------------------------------------------------------
# geometry


def build_ramp(b, ramp):
    name = STAGE_NEON[ramp.stage][0]
    ch = f"st{ramp.stage}"
    S.build_ramp(b, ramp, ch, f"ramp_{name}", "frame")
    S.ridge_cap(b, ramp, ch, f"neon_{name}")
    for side in (-1, 1):
        S.edge_strip(b, ramp, side, ch, f"neon_{name}", size=0.2)
    # glowing lift pods under the slab, the ramps float
    fr = ramp.frame
    for t in (0.22, 0.78):
        fwd = ramp.s0 + ramp.length * t
        bottom = fr.z + ramp.ridge_at(fwd) - ramp.height
        c = fr.p(ramp.lateral, fwd)
        b.add(M.bm_box((c[0], c[1], bottom - 0.8), (ramp.half_width * 0.9, 3.0, 1.6), rot_z=fr.rot, bevel=0.2), ch, "frame",
              rot_z=fr.rot)
        b.add(M.bm_cylinder((c[0], c[1]), 1.1, bottom - 1.9, bottom - 1.6, segments=12), ch, f"neon_{name}")


def neon_frame(b, ramp, nxt, ch):
    """square neon outline over the gap before a transfer (render only)"""
    fr = ramp.frame
    fwd = (ramp.s1 + nxt.s0) / 2
    half = max(ramp.half_width, abs(nxt.lateral) + nxt.half_width) + 7.0
    lo = fr.z + nxt.ridge_z - nxt.height - 3.0
    hi = fr.z + ramp.end_ridge() + 10.0
    name = STAGE_NEON[ramp.stage][0]
    for side in (-1, 1):
        p = fr.p(ramp.lateral + side * half, fwd)
        b.add(M.bm_box((p[0], p[1], (lo + hi) / 2), (0.6, 0.6, hi - lo), rot_z=fr.rot), ch, f"neon_{name}", rot_z=fr.rot)
    top = fr.p(ramp.lateral, fwd)
    b.add(M.bm_box((top[0], top[1], hi), (half * 2 + 0.6, 0.6, 0.6), rot_z=fr.rot), ch, f"neon_{name}", rot_z=fr.rot)


def build_platform(b, fr, hl, hf, kind, ch, turn, digit_value, neon, open_back=None):
    S.slab(b, fr, hl, hf, ch, "deck", rim=(neon, 0.12))
    # truss under the slab, short of the first ramp that starts under the gate edge
    b.add(M.bm_box(fr.p(0, 0, -3.0), (hl * 1.5, hf * 1.1, 2.6), rot_z=fr.rot, bevel=0.3), ch, "frame", rot_z=fr.rot, weight=0.03)
    b.add(M.bm_cylinder(fr.p(0, 0)[:2], 2.2, fr.z - 4.6, fr.z - 4.2, segments=16), ch, neon)
    S.platform_walls(b, fr, hl, hf, kind, ch, "hull", turn=turn, gate_half=GATE_HALF, height=2.6, far_height=6.0,
                     end_height=10.0, cap=(neon, 0.14), open_back=open_back)
    if kind in ("start", "corner"):
        for side in (-1, 1):
            p = fr.p(side * (GATE_HALF + 0.3), hf - 0.4)
            b.add(M.bm_box((p[0], p[1], fr.z + 2.4), (0.7, 1.0, 4.8), rot_z=fr.rot, bevel=0.05), ch, "hull", rot_z=fr.rot)
            b.collide(M.bm_box((p[0], p[1], fr.z + 2.4), (0.7, 1.0, 4.8), rot_z=fr.rot))
            b.add(M.bm_box((p[0], p[1], fr.z + 2.4), (0.76, 1.06, 4.4), rot_z=fr.rot), ch, neon, rot_z=fr.rot)
        top = fr.p(0, hf - 0.4)
        b.add(M.bm_box((top[0], top[1], fr.z + 5.1), (GATE_HALF * 2 + 1.4, 1.0, 0.6), rot_z=fr.rot, bevel=0.05), ch, "hull",
              rot_z=fr.rot)
        b.add(M.bm_box((top[0], top[1], fr.z + 5.1), (GATE_HALF * 2 + 0.6, 1.08, 0.16), rot_z=fr.rot), ch, neon, rot_z=fr.rot)
        S.digit(b, fr, digit_value, -GATE_HALF - 4.5, hf - 0.88, 0.4, 1.8, neon, ch)


def build_arena(b, arena, rng):
    """the combat deck. returns the solid cover as dicts for the layout file"""
    hx, hy = ARENA_HALF
    ch = "arena"
    S.slab(b, arena, hx, hy, ch, "deck", rim=("neon_white", 0.12))
    b.add(M.bm_box(arena.p(0, 0, -3.2), (hx * 1.7, hy * 1.7, 3.0), rot_z=arena.rot, bevel=0.3), ch, "frame", rot_z=arena.rot,
          weight=0.03)
    t = 0.8
    kw = dict(thick=t)
    # back and sides full height, the front only outside the start pad
    S.wall(b, arena, -hx + 0.02, hx - 0.02, -hy + t / 2, -hy + t / 2, 2.6, ch, "hull", cap=("team_b", 0.14), **kw)
    for side in (-1, 1):
        x = side * (hx - t / 2)
        S.wall(b, arena, x, x, -hy + t, 0.0, 2.6, ch, "hull", cap=("team_b", 0.14), **kw)
        S.wall(b, arena, x, x, 0.0, hy - 0.02, 2.6, ch, "hull", cap=("team_a", 0.14), **kw)
        S.wall(b, arena, side * (START_HALF[0] + 0.02), side * (hx - t), hy - t / 2, hy - t / 2, 2.6, ch, "hull",
               cap=("team_a", 0.14), **kw)
    cover = []

    def block(x, y, sx, sy, sz, rot, z0=0.0):
        for k, (cx, cy, r) in enumerate(((x, y, rot), (-x, -y, rot + math.pi))):
            if k == 1 and abs(x) < 1e-6 and abs(y) < 1e-6:
                break
            c = arena.p(cx, cy, z0 + sz / 2)
            rz = arena.rot + r
            b.add(M.bm_box(c, (sx, sy, sz), rot_z=rz, bevel=0.04), ch, "cover", rot_z=rz)
            b.collide(M.bm_box(c, (sx, sy, sz), rot_z=rz))
            b.add(M.bm_band((c[0], c[1], z0 + sz - 0.06 + arena.z), (sx + 0.03, sy + 0.03, 0.08), rot_z=rz), ch,
                  "team_a" if cy > 0 else "team_b", rot_z=rz)
            cover.append({"center": M.to_three(c), "size": [sx, sz, sy], "rotDeg": round(math.degrees(rz), 2)})

    block(0.0, 0.0, *CENTER_BLOCK, 0.0)
    for x, y, sx, sy, sz, rot, stack in COVER:
        for i in range(stack):
            block(x, y, sx, sy, sz, rot + 0.1 * i, z0=sz * i)
    # floor paint: a centre line, lane marks and glowing spawn pads (render only, lifted off the floor)
    b.add(M.bm_box(arena.p(0, 0, 0.012), (hx * 2 - 2.0, 0.18, 0.016), rot_z=arena.rot), ch, "neon_white", rot_z=arena.rot)
    for sgn, mat in ((1, "team_a"), (-1, "team_b")):
        for x, y in ARENA_SPAWNS:
            p = arena.p(sgn * x, sgn * y, 0.012)
            b.add(M.bm_band(p, (1.6, 1.6, 0.016), rot_z=arena.rot), ch, mat, rot_z=arena.rot)
        for x in (-hx + 6, hx - 6):
            p = arena.p(x, sgn * (hy - 9), 0.012)
            b.add(M.bm_box(p, (0.18, 6.0, 0.016), rot_z=arena.rot), ch, mat, rot_z=arena.rot)
    # light masts in the corners
    for sx in (-1, 1):
        for sy in (-1, 1):
            p = arena.p(sx * (hx - 1.4), sy * (hy - 1.4))
            b.add(M.bm_box((p[0], p[1], arena.z + 4.0), (0.3, 0.3, 8.0)), ch, "hull")
            b.collide(M.bm_box((p[0], p[1], arena.z + 4.0), (0.3, 0.3, 8.0)))
            b.add(M.bm_box((p[0], p[1], arena.z + 8.2), (1.6, 1.6, 0.3), bevel=0.05), ch, "neon_white")
    return cover


def build_city(b, rng, course_pts, center, city_z, top_z):
    b.add(M.bm_box((center[0], center[1], city_z - 0.5), (4400.0, 4400.0, 1.0)), "city", "city")
    placed = 0
    tries = 0
    while placed < 16 and tries < 1200:
        tries += 1
        a = rng.uniform(0, math.tau)
        d = rng.uniform(90, 520)
        x = center[0] + math.cos(a) * d
        y = center[1] + math.sin(a) * d
        w = rng.uniform(16, 34)
        near = min(math.hypot(x - p[0], y - p[1]) for p in course_pts)
        if near < w + 55:
            continue
        top = top_z + rng.uniform(-90, 30)
        rot = rng.uniform(0, math.pi / 2)
        ch = f"tower{placed % 3}"
        b.add(M.bm_box((x, y, (city_z + top) / 2), (w, w * rng.uniform(0.7, 1.3), top - city_z), rot_z=rot), ch, "tower",
              rot_z=rot)
        b.add(M.bm_box((x, y, top + 0.5), (w * 0.9, w * 0.9, 1.0), rot_z=rot), ch, "frame", rot_z=rot)
        b.add(M.bm_box((x, y, top + 5.0), (0.8, 0.8, 9.0), rot_z=rot), ch, f"neon_{STAGE_NEON[placed % 4][0]}")
        placed += 1


def main():
    opts = M.parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    folder = M.tmp_dir(MAP_ID)
    make_materials(folder)
    rng = random.Random(53)
    frames, platforms, landings, ramps, finish, arena = layout()
    city_z = finish.z - CITY_DROP
    b = M.MapBuilder(MAP_ID, sink_z=city_z + 1.0)

    for r in ramps:
        build_ramp(b, r)
    for a, nxt in zip(ramps, ramps[1:]):
        if a.stage == nxt.stage and nxt.branch == "left" and a.branch is None:
            neon_frame(b, a, nxt, f"st{a.stage}")
    for k, fr in enumerate(frames):
        hl, hf = platforms[k]
        kind = "start" if k == 0 else "corner"
        turn = TURNS[k - 1] if k > 0 else 1
        neon = f"neon_{STAGE_NEON[k][0]}"
        build_platform(b, fr, hl, hf, kind, f"pl{k}", turn, k + 1, neon, open_back=(-DOOR_HALF, DOOR_HALF) if k == 0 else None)
    build_platform(b, finish, FINISH_HALF_LAT, FINISH_LEN / 2, "finish", "pl_end", 1, 0, "neon_white")
    cover = build_arena(b, arena, rng)

    xs = [v[0] for v in b.col_verts]
    ys = [v[1] for v in b.col_verts]
    center = ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2)
    course_pts = [fr.p(0, 0)[:2] for fr in frames] + [finish.p(0, 0)[:2], arena.p(0, 0)[:2]]
    for r in ramps:
        for t in (0.0, 0.5, 1.0):
            course_pts.append(r.frame.p(r.lateral, r.s0 + r.length * t)[:2])
    build_city(b, rng, course_pts, center, city_z, frames[0].z)

    # spawns: the run start on the pad first (side a), then the deck spawns
    f0 = frames[0]
    run_yaw = M.yaw_deg(*f0.f[:2])
    spawns = [{"position": M.to_three(f0.p(0.0, -5.0, 0.05)), "yawDeg": run_yaw, "side": "a"}]
    for side, sgn in (("a", 1), ("b", -1)):
        yaw = M.yaw_deg(*(-arena.f * sgn)[:2])
        for x, y in ARENA_SPAWNS:
            spawns.append({"position": M.to_three(arena.p(sgn * x, sgn * y, 0.05)), "yawDeg": yaw, "side": side})
    targets = [{"position": spawns[0]["position"], "yawDeg": run_yaw}]
    triggers = []
    hl, hf = START_HALF
    mn, mx = S.platform_volume(f0, -hl + 0.8, hl - 0.8, -hf + 0.8, hf - 0.8)
    triggers.append({"id": "start", "type": "start", "min": mn, "max": mx, "target": targets[0]})
    for k in range(1, len(frames)):
        fk = frames[k]
        hl, hf = platforms[k]
        turn = TURNS[k - 1]
        lat0, lat1 = (-hl + 0.8, hl) if turn > 0 else (-hl, hl - 0.8)
        mn, mx = S.platform_volume(fk, lat0, lat1, -hf + 0.8, hf - 0.8, z1=6.0)
        target = S.target(fk, 0.0, -4.0)
        targets.append(target)
        triggers.append({"id": f"stage{k + 1}", "type": "checkpoint", "stage": k + 1, "min": mn, "max": mx, "target": target})
    fhl, fhf = FINISH_HALF_LAT, FINISH_LEN / 2
    mn, mx = S.platform_volume(finish, -fhl + 0.8, fhl - 0.8, -fhf + 0.5, fhf - 0.8, z1=14.0)
    triggers.append({"id": "finish", "type": "finish", "min": mn, "max": mx})
    for k in range(len(frames)):
        stage_ramps = [r for r in ramps if r.stage == k]
        mn, mx = S.fall_volume(stage_ramps, lateral_pad=24.0)
        triggers.append({"id": f"fall{k + 1}", "type": "teleport", "stage": k + 1, "min": mn, "max": mx, "target": targets[k]})
    mn, mx = S.void_volume(b)
    triggers.append({"id": "void", "type": "teleport", "min": mn, "max": mx})

    meta = {
        "id": MAP_ID,
        "name": "Vanta",
        "author": "WebStrafe Team",
        "source": "Original map built in Blender by tools/blender/maps/build_surf_vanta.py",
        "license": "Original work (MIT, same as the project)",
        "attribution": "Original layout and procedural textures made for WebStrafe.",
        "spawns": spawns,
        "triggers": triggers,
        "cvars": {"sv_airaccelerate": 100},
        "modes": ["surf", "combat"],
        "difficulty": "advanced",
        "parTimeMs": PAR_TIME_MS,
        "notes": (f"Advanced surf, four stages, {len(ramps)} ramps from 58 to 64 degrees with two transfers. "
                  "Combat deck behind the start pad, four spawns per side, bots start on side b."),
    }
    ahx, ahy = ARENA_HALF
    layout_json = S.layout_json(MAP_ID, "build_surf_vanta.py", frames, platforms, landings, ramps, TURNS + [0], extra={
        "finish": {"origin": M.to_three(finish.p(0, 0)), "halfLat": fhl, "halfFwd": fhf},
        "arena": {
            "origin": M.to_three(arena.p(0, 0)),
            "forward": [round(v, 4) for v in M.to_three((arena.f.x, arena.f.y, 0.0), 4)],
            "right": [round(v, 4) for v in M.to_three((arena.r.x, arena.r.y, 0.0), 4)],
            "halfLat": ahx, "halfFwd": ahy, "wallThickness": 0.8,
            "cover": cover,
            "spawns": {"a": list(range(1, 1 + len(ARENA_SPAWNS))), "b": list(range(1 + len(ARENA_SPAWNS), 1 + 2 * len(ARENA_SPAWNS)))},
        },
    })
    views = {
        "overview": {"location": (center[0] - 290, center[1] - 380, 215), "target": (center[0] + 10, center[1], -75), "lens": 22},
        "eye": {"location": f0.p(-2.0, 2.0, 1.6), "target": f0.p(3.0, 40.0, -12.0), "lens": M.world_lens_for_fov(100)},
        "arena": {"location": arena.p(-27.0, -20.0, 7.5), "target": arena.p(4.0, 8.0, 0.0), "lens": M.world_lens_for_fov(90)},
        "thumb": {"location": arena.p(-52.0, -44.0, 34.0), "target": f0.p(0.0, 30.0, -12.0), "lens": 22, "resolution": (960, 540)},
        "ride": {"location": f0.p(7.0, 60.0, -9.0), "target": f0.p(3.0, 140.0, -18.0), "lens": M.world_lens_for_fov(100)},
    }
    S.add_fill_light(FILL)
    M.finish_map(b, ENV, meta, views, opts, layout=layout_json)


main()
