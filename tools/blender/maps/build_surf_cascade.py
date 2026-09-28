"""Cascade: six short surf stages stepping down a canyon of waterfalls at dusk.
flagstone ledges walled in red cliff stone, carved stone ramps whose colour
cools from ochre to teal slate as you drop, lantern gates, sea stacks with
waterfalls pouring into a misty basin.

  blender -b --factory-startup --python-exit-code 1 -P tools/blender/maps/build_surf_cascade.py -- [--no-bake] [--no-render] [--no-package]

each stage is a chain of two or three prism ramps (55 to 60 degrees, every face
one planar quad shared by render and collision) that ends on a walled ledge.
that ledge is the next stage's start: a checkpoint, and a gate you drop through
onto the next chain. the stages zigzag (right, left, right...) so no stage ever
sits over another one, and a teleport under each stage sends you back to its
start. gaps of 4 to 4.5 m and drops of 8.5 to 9.5 m keep a slow rider (about
12 m/s) above the next face.
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

MAP_ID = "surf_cascade"
TEX_SEED = 83

ENV = {
    "sun_azimuth": 292.0,
    "sun_elevation": 12.0,
    "sun_strength": 4.2,
    "sun_color": "#ffb073",
    "sun_angle": 1.4,
    "sky_strength": 2.2,
    "sky": {
        "zenith": "#2b3571",
        "horizon": "#eaa684",
        "ground": "#3d3142",
        "bake_ground": "#7c6c72",
        "exponent": 0.42,
        "sun_size_deg": 2.4,
        "sun_glow": 0.55,
        "sun_haze": 0.4,
        "clouds": {"color": "#ffbc9c", "shadow": "#5c4b74", "coverage": 0.44, "scale": 0.8, "speed": 0.004, "height": 0.18},
    },
    "bake_ground_scale": 0.8,
    "hemi": {"sky": "#9a97cc", "ground": "#6b4b4b", "intensity": 2.1},
    "fog": {"color": "#dea286", "near": 170.0, "far": 1250.0},
    "exposure": 1.05,
}
# cool twilight from the east for the faces turned away from the low sun (bake only)
FILL = {"azimuth": 112.0, "elevation": 35.0, "strength": 1.6, "color": "#8f94d8"}

# per stage: (name, base, deep) for the carved ramp stone, ochre down to teal slate
STAGE_STONE = [
    ("ochre", "#c9915d", "#6e4428"),
    ("terracotta", "#c27b5b", "#6a3727"),
    ("rose", "#b27177", "#5e3339"),
    ("plum", "#907094", "#473350"),
    ("slate", "#7282a8", "#343f5f"),
    ("teal", "#62919a", "#284a52"),
]

# two or three ramps per stage. the first starts under the gate, later ones
# follow after `gap` metres with their ridge `drop` under the previous ridge end.
# each follow-up is wider than the one before so a rider low on one face is
# still over the next face after the gap
STAGES = [
    [
        dict(length=72, height=14.0, angle=55, tilt=2.0),
        dict(length=64, height=16.5, angle=56, gap=4.0, drop=8.5, tilt=2.0),
    ],
    [
        dict(length=68, height=14.5, angle=56, tilt=2.0),
        dict(length=62, height=17.0, angle=57, gap=4.0, drop=8.5, tilt=3.0),
    ],
    [
        dict(length=58, height=14.0, angle=57),
        dict(length=56, height=16.5, angle=57, gap=4.0, drop=8.5, tilt=2.0),
        dict(length=54, height=18.5, angle=58, gap=4.0, drop=9.0, tilt=2.0),
    ],
    [
        dict(length=76, height=15.0, angle=58, tilt=5.0),
        dict(length=60, height=17.5, angle=58, gap=4.5, drop=9.0, tilt=2.0),
    ],
    [
        dict(length=66, height=15.0, angle=59, tilt=3.0),
        dict(length=62, height=17.5, angle=59, gap=4.5, drop=9.0, tilt=3.0),
    ],
    [
        dict(length=60, height=15.0, angle=59),
        dict(length=58, height=17.5, angle=60, gap=4.5, drop=9.0),
        dict(length=72, height=19.5, angle=60, gap=4.5, drop=9.5, tilt=4.0),
    ],
]
# turn into the next stage: +1 right, -1 left. zigzag, so the canyon runs diagonally
TURNS = [1, -1, 1, -1, 1]

START_HALF = (13.0, 11.0)
LANDING_LEN = 40.0
LANDING_HALF_LAT = 15.0      # ledge half width across the stage that lands on it
FINISH_LEN = 46.0
FINISH_HALF_LAT = 16.0
GATE_HALF = 6.0
BASIN_DROP = 76.0            # basin water under the finish ledge
# fastest full run of the headless test rider (src/world/__tests__/surfRiders.ts), rounded
PAR_TIME_MS = 88100


# ---------------------------------------------------------------------------
# textures


def tex_flagstone(folder):
    tg = M.TexGen(1024, TEX_SEED)
    f1, f2, idx = tg.voronoi(56, jitter=0.9)
    joint = 1.0 - M.smoothstep(0.015, 0.05, f2 - f1)
    tint = tg.cell_values(idx, 56)
    n = tg.fbm(5, 5)
    grain = tg.noise(280)
    t = 0.55 + 0.22 * (tint - 0.5) + 0.18 * (n - 0.5) + 0.06 * (grain - 0.5)
    col = M.mix(M.hex_rgb("#8c7d70"), M.hex_rgb("#d3c2ab"), np.clip(t, 0, 1))
    moss = M.smoothstep(0.45, 0.7, tg.fbm(6, 3))
    col = M.mix(col, M.mix(M.hex_rgb("#6a6450"), M.hex_rgb("#62703f"), moss), joint * 0.75)
    return M.save_texture("flagstone", col, folder)


def _ashlar(tg, rows, cols, offset=0.5):
    """running bond blocks: returns (joint mask, per block random value)"""
    row = np.floor(tg.v * rows)
    shift = (row % 2) * offset
    bu = (tg.u * cols + shift) % 1.0
    bv = (tg.v * rows) % 1.0
    block = (np.floor(tg.u * cols + shift) % cols) + row * (cols + 3)
    rand = (np.sin(block * 12.9898 + 4.1) * 43758.5453) % 1.0
    edge = np.minimum(np.minimum(bu, 1 - bu) / cols, np.minimum(bv, 1 - bv) / rows)
    return edge, rand


def tex_cliffstone(folder):
    tg = M.TexGen(1024, TEX_SEED + 1)
    edge, rand = _ashlar(tg, 3, 2)
    wobble = (tg.fbm(8, 3) - 0.5) * 0.006
    joint = 1.0 - M.smoothstep(0.002, 0.007, edge + wobble)
    n = tg.fbm(6, 5)
    speck = tg.noise(300)
    t = 0.52 + 0.1 * (rand - 0.5) + 0.22 * (n - 0.5) + 0.08 * (speck - 0.5)
    col = M.mix(M.hex_rgb("#8a6a58"), M.hex_rgb("#cdb096"), np.clip(t, 0, 1))
    chip = M.smoothstep(0.7, 0.85, tg.fbm(14, 3))
    col = col * (1 - 0.1 * chip[..., None])
    col = M.mix(col, M.hex_rgb("#4a3a33"), joint * 0.55)
    return M.save_texture("cliffstone", col, folder)


def tex_ramp(folder, name, base, deep, seed):
    tg = M.TexGen(1024, TEX_SEED + seed)
    u, v = tg.u, tg.v
    # big granite slabs, three courses up the face and one per tile along it
    edge, rand = _ashlar(tg, 3, 1)
    joint = 1.0 - M.smoothstep(0.0015, 0.0045, edge)
    grad = M.smoothstep(0.0, 1.0, v)
    col = M.mix(M.hex_rgb(deep), M.hex_rgb(base), 0.5 + 0.5 * grad)
    col = col * (0.96 + 0.08 * rand[..., None])
    # granite speckle: a few dark and pale grains
    dark = M.smoothstep(0.9, 0.97, 1.0 - tg.noise(520))
    pale = M.smoothstep(0.9, 0.97, tg.noise(480))
    col = col * (1 - 0.12 * dark[..., None])
    col = M.mix(col, M.hex_rgb("#efe6da"), pale * 0.16)
    cloud = tg.fbm(4, 4)
    col = col * (0.92 + 0.14 * cloud[..., None])
    col = M.mix(col, np.array(M.hex_rgb(deep), np.float32) * 0.7, joint * 0.6)
    # pale quartz cap on the ridge, wet mossy foot
    ridge = M.smoothstep(0.935, 0.95, v)
    col = M.mix(col, M.hex_rgb("#f1e5d4"), ridge * 0.9)
    foot = 1.0 - M.smoothstep(0.03, 0.06, v)
    col = M.mix(col, M.hex_rgb("#2a2c22"), foot * 0.8)
    moss = M.smoothstep(0.6, 0.78, tg.fbm(10, 3)) * (1.0 - M.smoothstep(0.05, 0.3, v))
    col = M.mix(col, M.hex_rgb("#56663a"), moss * 0.5)
    return M.save_texture(name, col, folder)


def tex_rock(folder):
    tg = M.TexGen(1024, TEX_SEED + 12)
    warp = tg.fbm(3, 5)
    layer = tg.fbm(2, 4, cells_v=6) + (warp - 0.5) * 0.6
    band = M.smoothstep(0.35, 0.65, layer)
    n = tg.fbm(8, 5)
    f1, f2, idx = tg.voronoi(60, stretch_v=1.6)
    crack = 1.0 - M.smoothstep(0.01, 0.05, f2 - f1)
    facet = tg.cell_values(idx, 60)
    t = 0.4 + 0.2 * band + 0.25 * (n - 0.5) + 0.15 * (facet - 0.5)
    col = M.mix(M.hex_rgb("#4d3f3c"), M.hex_rgb("#a8927f"), np.clip(t, 0, 1))
    col = col * (1 - 0.35 * crack[..., None])
    moss = M.smoothstep(0.62, 0.8, tg.fbm(5, 3))
    col = M.mix(col, M.hex_rgb("#4d5a33"), moss * 0.35)
    return M.save_texture("rock", col, folder)


def tex_waterfall(folder):
    """mapped once over each sheet (face uvs): v = 0 at the basin, 1 at the lip"""
    tg = M.TexGen(512, TEX_SEED + 13)
    v = tg.v
    streak = tg.fbm(12, 4, cells_v=1)
    fine = tg.fbm(36, 3, cells_v=2)
    clumps = tg.fbm(5, 3, cells_v=6)
    t = np.clip(0.3 + 0.7 * streak + 0.3 * (fine - 0.5) + 0.3 * (clumps - 0.5), 0, 1)
    col = M.mix(M.hex_rgb("#6f97ad"), M.hex_rgb("#eef6f8"), t ** 1.3)
    # white water pouring over the lip, mist rising at the bottom
    lip = M.smoothstep(0.9, 0.985, v)
    mist = 1.0 - M.smoothstep(0.0, 0.18, v)
    col = M.mix(col, M.hex_rgb("#f7fbfc"), np.maximum(lip * 0.85, mist * 0.7))
    return M.save_texture("waterfall", col, folder), M.save_texture("waterfall_emit", col * 0.5, folder)


def tex_basin(folder):
    tg = M.TexGen(1024, TEX_SEED + 14)
    swell = tg.fbm(2, 5)
    foam = M.smoothstep(0.64, 0.82, tg.fbm(9, 4)) * M.smoothstep(0.45, 0.7, tg.fbm(3, 3))
    col = M.mix(M.hex_rgb("#1f3f4f"), M.hex_rgb("#43727c"), np.clip(0.25 + 0.6 * swell, 0, 1))
    col = M.mix(col, M.hex_rgb("#dbe9ec"), foam * 0.4)
    return M.save_texture("basin", col, folder), M.save_texture("basin_emit", col * 0.35, folder)


def tex_iron(folder):
    tg = M.TexGen(256, TEX_SEED + 15)
    n = tg.fbm(4, 4)
    col = M.mix(M.hex_rgb("#2a2422"), M.hex_rgb("#5a4a40"), n)
    return M.save_texture("iron", col, folder)


def make_materials(folder):
    M.material("flagstone", image=tex_flagstone(folder), tile=5.0, roughness=0.9)
    M.material("cliffstone", image=tex_cliffstone(folder), tile=(6.0, 5.0), roughness=0.9, weight=0.7)
    for i, (name, base, deep) in enumerate(STAGE_STONE):
        M.material(f"ramp_{name}", image=tex_ramp(folder, f"ramp_{name}", base, deep, 2 + i), tile=(10.0, 1.0),
                   roughness=0.8, weight=0.2)
    M.material("rock", image=tex_rock(folder), tile=(14.0, 16.0), roughness=0.95, weight=0.05)
    fall, fall_emit = tex_waterfall(folder)
    M.material("waterfall", image=fall, emissive_image=fall_emit, emissive_strength=1.0, lit=False, uv_mode="face")
    basin, basin_emit = tex_basin(folder)
    M.material("basin", image=basin, emissive_image=basin_emit, emissive_strength=1.0, lit=False, tile=70.0, roughness=0.3)
    M.material("iron", image=tex_iron(folder), tile=1.0, roughness=0.6, metallic=0.4, weight=0.3)
    M.material("glow_lantern", color=(0.35, 0.2, 0.08), emissive=M.lin("#ffb760"), emissive_strength=3.0, lit=False,
               bake_emission_scale=2.0)
    M.material("glow_mist", color=(0.45, 0.5, 0.55), emissive=M.lin("#b9cfd9"), emissive_strength=0.7, lit=False)


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
    return frames, platforms, landings, ramps, finish


# ---------------------------------------------------------------------------
# geometry


def build_ramp(b, ramp, basin_z, rng):
    name = STAGE_STONE[ramp.stage][0]
    ch = f"st{ramp.stage}"
    S.build_ramp(b, ramp, ch, f"ramp_{name}", "rock")
    fr = ramp.frame
    w = ramp.half_width
    # rough stone spires holding the slab up from the basin
    n = max(2, int(ramp.length / 28))
    for i in range(n):
        t = (i + 0.5) / n
        fwd = ramp.s0 + ramp.length * t
        bottom = fr.z + ramp.ridge_at(fwd) - ramp.height
        c = fr.p(ramp.lateral + rng.uniform(-1.5, 1.5), fwd)
        b.add(M.bm_rock((c[0], c[1]), w * 0.42, basin_z - 3.0, bottom + 0.4, rng, segments=9, rings=5, taper=-0.35,
                        jitter=0.18, bulge=0.05), ch, "rock", weight=0.01)


def lantern(b, p, z, ch, height=2.2):
    b.add(M.bm_box((p[0], p[1], z + height / 2), (0.22, 0.22, height)), ch, "iron")
    b.add(M.bm_box((p[0], p[1], z + height + 0.25), (0.55, 0.55, 0.5), bevel=0.06), ch, "glow_lantern")
    b.add(M.bm_box((p[0], p[1], z + height + 0.56), (0.7, 0.7, 0.12)), ch, "iron")


def hanging_rock(b, fr, hl, hf, ch, rng):
    """rock mass under a ledge, tapering down like the ledge was cut from a stack.
    it sits towards the back so it stays clear of the first ramp under the gate"""
    c = fr.p(0, -hf * 0.3)
    r = min(hl, hf) * 0.6
    b.add(M.bm_rock((c[0], c[1]), r, fr.z - 1.5, fr.z - 1.5 - rng.uniform(26, 38), rng, segments=12, rings=5, taper=0.8,
                    jitter=0.2, bulge=0.1), ch, "rock", weight=0.02)


def ledge_waterfall(b, fr, width, edge_fwd, ch, basin_z):
    """water pouring over a rock lip past one end of a ledge (edge_fwd = +-hf)
    down into the basin (render only)"""
    out_sign = 1 if edge_fwd > 0 else -1
    lip = fr.p(0.0, edge_fwd + out_sign * 1.6)
    b.add(M.bm_box((lip[0], lip[1], fr.z - 0.6), (width + 2.0, 3.2, 1.2), rot_z=fr.rot, bevel=0.25), ch, "cliffstone",
          rot_z=fr.rot)
    out = fr.p(0.0, edge_fwd + out_sign * 3.4)
    top = fr.z - 0.3
    height = top - basin_z
    b.add(M.bm_box((out[0], out[1], top - height / 2), (width, 0.3, height), rot_z=fr.rot), ch, "waterfall", rot_z=fr.rot)
    b.add(M.bm_cylinder((out[0], out[1]), width * 0.7, basin_z - 0.2, basin_z + 0.7, segments=12, radius_top=width * 0.95),
          "basin_fx", "glow_mist")


def build_platform(b, fr, hl, hf, kind, ch, turn, digit_value, basin_z, rng):
    S.slab(b, fr, hl, hf, ch, "flagstone", rim=("cliffstone", 0.5))
    S.platform_walls(b, fr, hl, hf, kind, ch, "cliffstone", turn=turn, gate_half=GATE_HALF, height=2.6,
                     far_height=6.0, end_height=9.0)
    hanging_rock(b, fr, hl, hf, ch, rng)
    if kind in ("start", "corner"):
        # gate lanterns and the stage number on the inside of the gate wall
        for side in (-1, 1):
            p = fr.p(side * (GATE_HALF + 0.3), hf - 0.4)
            b.add(M.bm_box((p[0], p[1], fr.z + 2.3), (0.8, 1.2, 4.6), rot_z=fr.rot, bevel=0.1), ch, "cliffstone", rot_z=fr.rot)
            b.collide(M.bm_box((p[0], p[1], fr.z + 2.3), (0.8, 1.2, 4.6), rot_z=fr.rot))
            b.add(M.bm_box((p[0], p[1], fr.z + 4.85), (0.6, 0.6, 0.5), rot_z=fr.rot, bevel=0.06), ch, "glow_lantern", rot_z=fr.rot)
        top = fr.p(0, hf - 0.4)
        b.add(M.bm_box((top[0], top[1], fr.z + 5.35), (GATE_HALF * 2 + 2.4, 1.3, 0.7), rot_z=fr.rot, bevel=0.12), ch,
              "cliffstone", rot_z=fr.rot)
        S.digit(b, fr, digit_value, -GATE_HALF - 4.2, hf - 0.88, 0.4, 1.8, "glow_lantern", ch)
    for sx in (-1, 1):
        for sy in (-1, 1):
            lantern(b, fr.p(sx * (hl - 1.5), sy * (hf - 1.5)), fr.z, ch)


def build_canyon(b, rng, course_pts, start, finish, basin_z):
    """two broken canyon walls of rock masses along the course's diagonal, with
    waterfalls pouring off them towards the course. the wall on the sun's side
    stays low so the low dusk sun still reaches the ramps"""
    a = Vector((start.origin.x, start.origin.y, 0.0))
    z_a = start.z
    e = Vector((finish.origin.x, finish.origin.y, 0.0))
    z_e = finish.z
    axis = (e - a).normalized()
    perp = Vector((axis.y, -axis.x, 0.0))
    sun = M.sun_vector(ENV["sun_azimuth"], ENV["sun_elevation"])
    sun_side = 1 if perp.dot(Vector((sun.x, sun.y, 0.0))) > 0 else -1
    length = (e - a).length
    k = 0
    s = -170.0
    while s < length + 170.0:
        for side in (-1, 1):
            r = rng.uniform(34, 58)
            off = rng.uniform(150, 195) + r * 0.4
            c = a + axis * (s + rng.uniform(-12, 12)) + perp * side * off
            near = min(math.hypot(c.x - p[0], c.y - p[1]) for p in course_pts)
            if near < r + 42:
                continue
            level = z_a + (z_e - z_a) * min(1.0, max(0.0, s / length))
            top = level + (rng.uniform(-35, 5) if side == sun_side else rng.uniform(5, 55))
            ch = f"canyon{k % 4}"
            taper = rng.uniform(0.1, 0.25)
            b.add(M.bm_rock((c.x, c.y), r, basin_z - 4.0, top, rng, segments=14, rings=6, taper=taper,
                            jitter=0.14, bulge=0.06, top_dome=r * 0.04), ch, "rock", weight=0.004)
            if k % 3 != 1:
                # a sheet of water just off the cliff, fed by a rock lip at the top
                to = -perp * side
                rot = math.atan2(to.y, to.x) + math.pi / 2
                d_w = r * 1.12
                r_top = r * (1 - taper) * 0.8
                width = r * rng.uniform(0.28, 0.5)
                fx, fy = c.x + to.x * d_w, c.y + to.y * d_w
                height = top - 3.0 - basin_z
                b.add(M.bm_box((fx, fy, basin_z + height / 2), (width, 0.5, height), rot_z=rot), "falls", "waterfall", rot_z=rot)
                lip_len = d_w - r_top + 2.0
                lc = (c.x + to.x * (r_top + lip_len / 2 - 1.0), c.y + to.y * (r_top + lip_len / 2 - 1.0))
                b.add(M.bm_box((lc[0], lc[1], top - 2.2), (width + 3.0, lip_len, 3.2), rot_z=rot, bevel=0.4), ch, "rock",
                      rot_z=rot, weight=0.004)
                b.add(M.bm_cylinder((fx + to.x * 4, fy + to.y * 4), width * 0.8, basin_z - 0.2, basin_z + 0.9, segments=12,
                                    radius_top=width * 1.15), "basin_fx", "glow_mist")
            k += 1
        s += rng.uniform(52, 70)


def main():
    opts = M.parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    folder = M.tmp_dir(MAP_ID)
    make_materials(folder)
    rng = random.Random(41)
    frames, platforms, landings, ramps, finish = layout()
    basin_z = finish.z - BASIN_DROP
    b = M.MapBuilder(MAP_ID, sink_z=basin_z + 1.0)

    for r in ramps:
        build_ramp(b, r, basin_z, rng)
    for k, fr in enumerate(frames):
        hl, hf = platforms[k]
        kind = "start" if k == 0 else "corner"
        turn = TURNS[k - 1] if k > 0 else 1
        build_platform(b, fr, hl, hf, kind, f"pl{k}", turn, k + 1, basin_z, rng)
        # water pours off the back of every ledge, on the left or right of the
        # riders coming in from the previous stage
        ledge_waterfall(b, fr, hl * 0.6, -hf, f"pl{k}", basin_z)
    build_platform(b, finish, FINISH_HALF_LAT, FINISH_LEN / 2, "finish", "pl_end", 1, 0, basin_z, rng)
    ledge_waterfall(b, finish, FINISH_HALF_LAT * 1.2, FINISH_LEN / 2, "pl_end", basin_z)

    xs = [v[0] for v in b.col_verts]
    ys = [v[1] for v in b.col_verts]
    center = ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2)
    course_pts = [fr.p(0, 0)[:2] for fr in frames] + [finish.p(0, 0)[:2]]
    for r in ramps:
        for t in (0.0, 0.5, 1.0):
            course_pts.append(r.frame.p(r.lateral, r.s0 + r.length * t)[:2])
    build_canyon(b, rng, course_pts, frames[0], finish, basin_z)
    b.add(M.bm_box((center[0], center[1], basin_z - 0.5), (4200.0, 4200.0, 1.0)), "basin", "basin")

    # spawns, triggers
    f0 = frames[0]
    spawns = [{"position": M.to_three(f0.p(lat, -5.0, 0.05)), "yawDeg": M.yaw_deg(*f0.f[:2])} for lat in (0.0, -4.0, 4.0)]
    targets = [{"position": spawns[0]["position"], "yawDeg": spawns[0]["yawDeg"]}]
    triggers = []
    hl, hf = START_HALF
    mn, mx = S.platform_volume(f0, -hl + 0.8, hl - 0.8, -hf + 0.8, hf - 0.8)
    triggers.append({"id": "start", "type": "start", "min": mn, "max": mx, "target": targets[0]})
    for k in range(1, len(frames)):
        fk = frames[k]
        hl, hf = platforms[k]
        turn = TURNS[k - 1]
        # reaches the open arrival side so a rider landing there counts
        lat0, lat1 = (-hl + 0.8, hl) if turn > 0 else (-hl, hl - 0.8)
        mn, mx = S.platform_volume(fk, lat0, lat1, -hf + 0.8, hf - 0.8, z1=6.0)
        target = S.target(fk, 0.0, -4.0)
        targets.append(target)
        triggers.append({"id": f"stage{k + 1}", "type": "checkpoint", "stage": k + 1, "min": mn, "max": mx, "target": target})
    fhl, fhf = FINISH_HALF_LAT, FINISH_LEN / 2
    mn, mx = S.platform_volume(finish, -fhl + 0.8, fhl - 0.8, -fhf + 0.5, fhf - 0.8, z1=12.0)
    triggers.append({"id": "finish", "type": "finish", "min": mn, "max": mx})
    for k in range(len(frames)):
        mn, mx = S.fall_volume([r for r in ramps if r.stage == k])
        triggers.append({"id": f"fall{k + 1}", "type": "teleport", "stage": k + 1, "min": mn, "max": mx, "target": targets[k]})
    mn, mx = S.void_volume(b)
    triggers.append({"id": "void", "type": "teleport", "min": mn, "max": mx})

    meta = {
        "id": MAP_ID,
        "name": "Cascade",
        "author": "WebStrafe Team",
        "source": "Original map built in Blender by tools/blender/maps/build_surf_cascade.py",
        "license": "Original work (MIT, same as the project)",
        "attribution": "Original layout and procedural textures made for WebStrafe.",
        "spawns": spawns,
        "triggers": triggers,
        "cvars": {"sv_airaccelerate": 100},
        "modes": ["surf"],
        "difficulty": "intermediate",
        "parTimeMs": PAR_TIME_MS,
        "notes": f"Six surf stages, {len(ramps)} ramps from 55 to 60 degrees. Each ledge is a checkpoint, falling under a stage teleports you to its start.",
    }
    layout_json = S.layout_json(MAP_ID, "build_surf_cascade.py", frames, platforms, landings, ramps, TURNS + [0], extra={
        "finish": {"origin": M.to_three(finish.p(0, 0)), "halfLat": fhl, "halfFwd": fhf},
    })
    views = {
        "overview": {"location": (center[0] - 330, center[1] - 260, 150), "target": (center[0], center[1], -70), "lens": 24},
        "eye": {"location": f0.p(-2.0, 2.0, 1.6), "target": f0.p(3.0, 40.0, -12.0), "lens": M.world_lens_for_fov(100)},
        "thumb": {"location": f0.p(-58.0, -30.0, 28.0), "target": f0.p(0.0, 62.0, -16.0), "lens": 22, "resolution": (960, 540)},
        "ride": {"location": f0.p(7.0, 50.0, -9.0), "target": f0.p(3.0, 130.0, -18.0), "lens": M.world_lens_for_fov(100)},
    }
    S.add_fill_light(FILL)
    M.finish_map(b, ENV, meta, views, opts, layout=layout_json)


main()
