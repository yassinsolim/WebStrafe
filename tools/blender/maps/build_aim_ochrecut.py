"""Ochre Cut: an AWP and Deagle duel arena in the floor of a sandstone quarry.

  blender -b --factory-startup --python-exit-code 1 -P tools/blender/maps/build_aim_ochrecut.py -- [--no-bake] [--no-render] [--no-package]

124 m x 52 m, point symmetric (rotate 180 degrees about the centre to get the
other side). a 92 m mid lane with low cover for AWP duels, container rows
separating it from two side lanes full of crates and cut stone for 10 to 30 m
Deagle fights, and a sniper nest 4.5 m up at each end reached by two 29 degree
stair ramps. team colours: side A teal containers and floor paint, side B orange.
six spawns per side face the enemy half; bots start on side B.
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

MAP_ID = "aim_ochrecut"
TEX_SEED = 53
HALF_X = 26.0
HALF_Y = 62.0
WALL_H = 14.0
NEST_TOP = 4.5

ENV = {
    "sun_azimuth": 90.0,
    "sun_elevation": 60.0,
    "sun_strength": 4.3,
    "sun_color": "#fff0d8",
    "sun_angle": 1.0,
    "sky_strength": 2.1,
    "sky": {
        "zenith": "#3f7fc6",
        "horizon": "#ead9bb",
        "ground": "#b88c5c",
        "bake_ground": "#c49a68",
        "exponent": 0.55,
        "sun_size_deg": 1.7,
        "sun_glow": 0.38,
        "sun_haze": 0.2,
        "clouds": {"color": "#fffaf0", "shadow": "#b9aa94", "coverage": 0.3, "scale": 0.8, "speed": 0.004, "height": 0.25},
    },
    "bake_ground_scale": 0.8,
    "hemi": {"sky": "#c4d6ea", "ground": "#c49a68", "intensity": 3.2},
    "fog": {"color": "#e4d3b4", "near": 90.0, "far": 620.0},
    "grade": {"exposure": 0.8, "contrast": 1.12, "saturation": 1.04, "temperature": 0.05, "vignette": 0.2, "bloom": 0.05},
    "exposure": 1.0,
}


# ---------------------------------------------------------------------------
# textures


def tex_sand(folder):
    tg = M.TexGen(1024, TEX_SEED)
    base = tg.fbm(3, 5)
    fine = tg.noise(260)
    f1, f2, idx = tg.voronoi(900, jitter=1.0)
    pebble = 1.0 - M.smoothstep(0.12, 0.26, f1)
    ptint = tg.cell_values(idx, 900)
    patches = M.smoothstep(0.55, 0.75, tg.fbm(2, 3))
    t = 0.5 + 0.28 * (base - 0.5) + 0.1 * (fine - 0.5) - 0.12 * patches
    col = M.mix(M.hex_rgb("#a8865c"), M.hex_rgb("#e6cc9f"), np.clip(t, 0, 1))
    col = M.mix(col, M.mix(M.hex_rgb("#977a58"), M.hex_rgb("#efdcbc"), ptint), pebble * 0.3)
    return M.save_texture("sand", col, folder)


def tex_cliff(folder):
    tg = M.TexGen(1024, TEX_SEED + 1)
    warp = tg.fbm(2, 4)
    layer = tg.v * 7 + (warp - 0.5) * 0.9
    band = 0.5 + 0.5 * np.sin(layer * 2 * np.pi)
    band2 = 0.5 + 0.5 * np.sin(layer * 2 * np.pi * 3 + 0.7)
    # vertical drill grooves from the saw cuts
    groove = (1.0 - M.smoothstep(0.0, 0.006, M.line_dist(tg.u + 0.02 * tg.fbm(8, 2), 12) / 12)) * M.smoothstep(0.4, 0.7, tg.fbm(3, 3, cells_v=1))
    n = tg.fbm(6, 5)
    f1, f2, _ = tg.voronoi(30, stretch_v=3.0)
    crack = 1.0 - M.smoothstep(0.01, 0.05, f2 - f1)
    t = 0.42 + 0.26 * band + 0.1 * band2 + 0.28 * (n - 0.5)
    col = M.mix(M.hex_rgb("#a86f3e"), M.hex_rgb("#f1d3a0"), np.clip(t, 0, 1))
    red = M.smoothstep(0.62, 0.8, 0.5 + 0.5 * np.sin(layer * 2 * np.pi * 0.5 + 2.0))
    col = M.mix(col, M.hex_rgb("#b25a34"), red * 0.35)
    col = col * (1 - 0.08 * groove[..., None]) * (1 - 0.22 * crack[..., None])
    return M.save_texture("cliff", col, folder)


def tex_stone(folder):
    tg = M.TexGen(1024, TEX_SEED + 2)
    rows = 3
    row = np.floor(tg.v * rows)
    shift = (row % 2) * 0.5
    cols = 2
    bu = (tg.u * cols + shift) % 1.0
    block = np.floor(tg.u * cols + shift) % cols + row * 3
    tint = (np.sin(block * 12.9898) * 43758.5453) % 1.0
    joint = np.minimum(np.minimum(bu, 1 - bu) / cols, np.minimum((tg.v * rows) % 1.0, 1 - (tg.v * rows) % 1.0) / rows)
    joint = 1.0 - M.smoothstep(0.002, 0.008, joint)
    chisel = 0.5 + 0.5 * np.sin((tg.u * 3 + tg.v * 5) * 2 * np.pi * 14 + tg.fbm(5, 2) * 6)
    n = tg.fbm(5, 4)
    t = 0.55 + 0.18 * (tint - 0.5) + 0.2 * (n - 0.5) + 0.05 * (chisel - 0.5)
    col = M.mix(M.hex_rgb("#a88760"), M.hex_rgb("#efd9b4"), np.clip(t, 0, 1))
    col = col * (1 - 0.4 * joint[..., None])
    return M.save_texture("stone", col, folder)


def tex_crate(folder):
    tg = M.TexGen(512, TEX_SEED + 3)
    u, v = tg.u, tg.v
    planks = np.floor(v * 5)
    grain = 0.5 + 0.5 * np.sin((u * 40 + tg.fbm(3, 3, cells_v=12) * 8 + planks * 3.1) * 2)
    ptint = (np.sin(planks * 7.7) * 4375.5) % 1.0
    wood = M.mix(M.hex_rgb("#7a5230"), M.hex_rgb("#c79a62"), np.clip(0.45 + 0.25 * (grain - 0.5) + 0.2 * (ptint - 0.5), 0, 1))
    gap = 1.0 - M.smoothstep(0.004, 0.01, M.line_dist(v, 5) / 5)
    wood = wood * (1 - 0.5 * gap[..., None])
    frame = (np.minimum(np.minimum(u, 1 - u), np.minimum(v, 1 - v)) < 0.1)
    brace = np.abs(u - v) < 0.07
    trim = M.mix(M.hex_rgb("#5a3a20"), M.hex_rgb("#9a7046"), grain * 0.6)
    col = np.where((frame | brace)[..., None], trim, wood)
    edge = 1.0 - M.smoothstep(0.0, 0.015, np.minimum(np.minimum(u, 1 - u), np.minimum(v, 1 - v)))
    col = col * (1 - 0.35 * edge[..., None])
    nails = 1.0 - M.smoothstep(0.006, 0.012, np.sqrt((np.minimum(u, 1 - u) - 0.05) ** 2 + (np.minimum(v, 1 - v) - 0.05) ** 2))
    col = col * (1 - 0.5 * nails[..., None])
    return M.save_texture("crate", col, folder)


def tex_container(folder, name, paint):
    tg = M.TexGen(1024, TEX_SEED + 4 + len(name))
    ribs = 0.5 + 0.5 * np.sin(tg.u * 2 * np.pi * 10)
    ribs = ribs ** 0.7
    base = M.mix(np.array(M.hex_rgb(paint), np.float32) * 0.7, M.hex_rgb(paint), ribs)
    rust = M.smoothstep(0.6, 0.85, tg.fbm(4, 5)) * (M.smoothstep(0.75, 1.0, tg.v) + M.smoothstep(0.25, 0.0, tg.v))
    streak = M.smoothstep(0.55, 0.8, tg.fbm(24, 3, cells_v=2)) * M.smoothstep(0.4, 1.0, tg.v)
    col = M.mix(base, M.hex_rgb("#6b3a1e"), np.clip(rust * 0.8 + streak * 0.25, 0, 1))
    frame = 1.0 - M.smoothstep(0.02, 0.035, np.minimum(tg.v, 1 - tg.v))
    col = M.mix(col, np.array(M.hex_rgb(paint), np.float32) * 0.5, frame)
    grime = tg.fbm(6, 4)
    col = col * (0.9 + 0.14 * grime[..., None])
    return M.save_texture(name, col, folder)


def tex_steel(folder):
    tg = M.TexGen(512, TEX_SEED + 9)
    n = tg.fbm(3, 4, cells_v=24)
    col = M.mix(M.hex_rgb("#3d4046"), M.hex_rgb("#6c7178"), n)
    return M.save_texture("steel", col, folder)


def tex_yellow(folder):
    tg = M.TexGen(256, TEX_SEED + 10)
    wear = M.smoothstep(0.6, 0.85, tg.fbm(6, 4))
    col = M.mix(M.hex_rgb("#e8b41e"), M.hex_rgb("#6d5a3a"), wear * 0.7)
    return M.save_texture("yellow", col, folder)


def tex_paint(folder, name, color):
    tg = M.TexGen(256, TEX_SEED + 11 + len(name))
    wear = M.smoothstep(0.45, 0.8, tg.fbm(8, 4))
    col = M.mix(M.hex_rgb(color), M.hex_rgb("#c9a777"), wear * 0.75)
    return M.save_texture(name, col, folder)


def make_materials(folder):
    M.material("sand", image=tex_sand(folder), tile=6.0, roughness=0.95)
    M.material("cliff", image=tex_cliff(folder), tile=(12.0, 14.0), roughness=0.95, weight=0.3)
    M.material("stone", image=tex_stone(folder), tile=(2.8, 2.1), roughness=0.9, weight=0.8)
    M.material("crate", image=tex_crate(folder), tile=1.0, roughness=0.85, weight=0.8, uv_mode="face")
    M.material("cont_teal", image=tex_container(folder, "cont_teal", "#1f8f8a"), tile=(2.5, 2.59), roughness=0.6, metallic=0.2, weight=0.7)
    M.material("cont_orange", image=tex_container(folder, "cont_orange", "#d0661f"), tile=(2.5, 2.59), roughness=0.6, metallic=0.2, weight=0.7)
    M.material("steel", image=tex_steel(folder), tile=(1.5, 3.0), roughness=0.5, metallic=0.6, weight=0.3)
    M.material("yellow", image=tex_yellow(folder), tile=1.0, roughness=0.5, metallic=0.3, weight=0.4)
    M.material("paint_teal", image=tex_paint(folder, "paint_teal", "#1aa39a"), tile=2.0, roughness=0.8)
    M.material("paint_orange", image=tex_paint(folder, "paint_orange", "#e06d20"), tile=2.0, roughness=0.8)
    M.material("lamp", color=(0.3, 0.3, 0.3), emissive=M.lin("#fff2d0"), emissive_strength=3.0, lit=False)


# ---------------------------------------------------------------------------
# point symmetry: everything authored for side A (y < 0) is copied rotated 180 degrees


def rot180(p):
    return (-p[0], -p[1]) + tuple(p[2:])


class Arena:
    def __init__(self, b):
        self.b = b
        self.cover = []  # (center, size, rot) of solid cover, for the layout file

    def box(self, center, size, mat, chunk, rot=0.0, bevel=0.04, collide=True, mirror=True, face_uv=False, weight=None):
        for k, (c, r) in enumerate(((center, rot), (rot180(center), rot + math.pi))):
            if k == 1 and not mirror:
                break
            side_mat = mat
            if mat == "cont_teal" and k == 1:
                side_mat = "cont_orange"
            elif mat == "paint_teal" and k == 1:
                side_mat = "paint_orange"
            ch = f"{chunk}_{'a' if k == 0 else 'b'}" if mirror else chunk
            self.b.add(M.bm_box(c, size, rot_z=r, bevel=bevel), ch, side_mat, rot_z=r, face_uv=face_uv, weight=weight)
            if collide:
                self.b.collide(M.bm_box(c, size, rot_z=r))
                self.cover.append({"center": [round(v, 3) for v in c], "size": list(size), "rot": round(r, 4)})

    def crate(self, x, y, stack=1, size=1.2, rot=0.0, chunk="lanes"):
        for i in range(stack):
            self.box((x, y, size * (i + 0.5)), (size, size, size), "crate", chunk, rot=rot + (0.08 if i else 0.0), bevel=0.03, face_uv=True)

    def container(self, x, y, rot=0.0, stack=1, chunk="sep"):
        for i in range(stack):
            self.box((x, y, 1.295 + 2.59 * i), (2.44, 6.06, 2.59), "cont_teal", chunk, rot=rot + (0.03 if i else 0.0), bevel=0.05)
            # corner posts and door bars in dark steel, render only
            for k, c in enumerate(((x, y), rot180((x, y)))):
                r = rot + (math.pi if k else 0.0)
                ch = f"{chunk}_{'a' if k == 0 else 'b'}"
                for sx in (-1, 1):
                    for sy in (-1, 1):
                        off = Vector((sx * 1.18, sy * 2.99, 0.0))
                        off.rotate(M.Matrix.Rotation(r, 3, "Z"))
                        self.b.add(M.bm_box((c[0] + off.x, c[1] + off.y, 1.295 + 2.59 * i), (0.14, 0.14, 2.6), rot_z=r), ch, "steel", rot_z=r)


def build_floor_and_walls(a, b, rng):
    # floor slab: one piece for the arena, collision included
    b.add(M.bm_box((0, 0, -0.5), (HALF_X * 2, HALF_Y * 2, 1.0)), "floor", "sand", bottom_weight=0.001)
    b.collide(M.bm_box((0, 0, -0.5), (HALF_X * 2 + 2, HALF_Y * 2 + 2, 1.0)))
    # quarry walls with terraces stepping back and up outside the arena
    for side in ("x+", "x-", "y+", "y-"):
        if side[0] == "x":
            s = 1 if side[1] == "+" else -1
            length = HALF_Y * 2 + 12
            c = (s * (HALF_X + 1.0), 0.0)
            size = (2.0, length)
        else:
            s = 1 if side[1] == "+" else -1
            length = HALF_X * 2 + 12
            c = (0.0, s * (HALF_Y + 1.0))
            size = (length, 2.0)
        ch = f"cliff_{side}"
        b.add(M.bm_box((c[0], c[1], WALL_H / 2), (size[0], size[1], WALL_H), bevel=0.1), ch, "cliff", weight=0.3)
        b.collide(M.bm_box((c[0], c[1], WALL_H / 2 + 6), (size[0], size[1], WALL_H + 12)))
        z = WALL_H
        for step in range(3):
            back = 4.0 + step * 5.0
            h = rng.uniform(4.5, 7.0)
            if side[0] == "x":
                cc = (s * (HALF_X + 2 + back), 0.0)
                ss = (8.0, length + 2 * back)
            else:
                cc = (0.0, s * (HALF_Y + 2 + back))
                ss = (length + 2 * back, 8.0)
            b.add(M.bm_box((cc[0], cc[1], z + h / 2 - 0.5), (ss[0], ss[1], h + 1.0), bevel=0.2), ch, "cliff", weight=0.04)
            z += h
        # saw cut blocks lying on the first terrace
        for k in range(6):
            t = rng.uniform(-0.45, 0.45)
            if side[0] == "x":
                p = (s * (HALF_X + 4.5), t * length, WALL_H + 0.9)
            else:
                p = (t * length, s * (HALF_Y + 4.5), WALL_H + 0.9)
            sz = (rng.uniform(1.6, 2.6), rng.uniform(1.6, 3.2), 1.8)
            b.add(M.bm_box(p, sz, rot_z=rng.uniform(-0.3, 0.3), bevel=0.05), ch, "stone", weight=0.05)


def build_nest(a, b):
    """sniper nest A at the back centre: platform, parapet, canopy, two stair ramps"""
    y0, y1 = -HALF_Y + 2.0, -52.0
    x0 = 6.0
    ch = "nest"
    a.box((0, (y0 + y1) / 2, NEST_TOP / 2), (x0 * 2, y1 - y0, NEST_TOP), "stone", ch, bevel=0.05)
    # parapet with a centre window: two low blocks leave a 2 m slot
    a.box((-3.5, y1 + 0.35, NEST_TOP + 0.6), (5.0, 0.7, 1.2), "stone", ch)
    a.box((3.5, y1 + 0.35, NEST_TOP + 0.6), (5.0, 0.7, 1.2), "stone", ch)
    a.box((0, y1 + 0.35, NEST_TOP + 0.2), (2.0, 0.7, 0.4), "stone", ch)
    # side parapets on the stair side
    for s in (-1, 1):
        a.box((s * (x0 - 0.3), y1 - 1.6, NEST_TOP + 0.55), (0.6, 2.6, 1.1), "stone", ch)
    # yellow railing along the open back and stair tops
    for s in (-1, 1):
        a.box((s * (x0 - 0.1), y0 + 1.8, NEST_TOP + 1.05), (0.08, 3.4, 0.08), "yellow", ch, collide=False, bevel=0.0)
        for yy in (y0 + 0.3, y0 + 3.3):
            a.box((s * (x0 - 0.1), yy, NEST_TOP + 0.55), (0.08, 0.08, 1.1), "yellow", ch, collide=False, bevel=0.0)
    # canopy on four posts
    cy1 = y0 + 4.6
    for sx in (-1, 1):
        for yy in (y0 + 0.6, cy1):
            a.box((sx * (x0 - 0.5), yy, NEST_TOP + 2.0), (0.2, 0.2, 4.0), "steel", ch, collide=False, bevel=0.0)
    a.box((0, (y0 + cy1) / 2 + 0.2, NEST_TOP + 4.05), (x0 * 2 + 0.8, cy1 - y0 + 1.4, 0.18), "steel", ch, collide=False, bevel=0.02)
    # stair ramps down both sides against the back wall: 4.5 m over 8 m, about 29 degrees
    run = 8.0
    for s in (-1, 1):
        cx = s * (x0 + run / 2)
        cy = y0 + 1.6
        rot = math.pi / 2 if s > 0 else -math.pi / 2
        for k, (c, r) in enumerate((((cx, cy), rot), (rot180((cx, cy)), rot + math.pi))):
            chs = f"{ch}_{'a' if k == 0 else 'b'}"
            wedge = M.bm_wedge((c[0], c[1], 0.0), (3.2, run, NEST_TOP), rot_z=r)
            b.collide(wedge)
            steps = 12
            for i in range(steps):
                t0 = i / steps
                off = Vector((0.0, -run / 2 + run * (t0 + 0.5 / steps), 0.0))
                off.rotate(M.Matrix.Rotation(r, 3, "Z"))
                h = NEST_TOP * (i + 1) / steps
                b.add(M.bm_box((c[0] + off.x, c[1] + off.y, h / 2), (3.2, run / steps + 0.01, h), rot_z=r, bevel=0.02), chs, "stone", rot_z=r)
            # stringer rail
            rail = Vector((1.65, 0.0, 0.0))
            rail.rotate(M.Matrix.Rotation(r, 3, "Z"))
            ang = math.atan2(NEST_TOP, run)
            bm = M.bm_box((0, 0, 0), (0.08, math.hypot(run, NEST_TOP), 0.08), rot_x=ang)
            M._transform(bm, r, (c[0] + rail.x, c[1] + rail.y, NEST_TOP / 2 + 1.0))
            b.add(bm, chs, "yellow", rot_z=r)


def build_cover(a, rng):
    # spawn shield in front of the mid spawns, blocks the enemy nest's view
    a.box((0, -45.0, 1.1), (10.0, 1.2, 2.2), "stone", "mid")
    # mid lane: low walls and blocks, keeping the x = 0 line open nest to nest
    a.box((-3.2, -30.0, 0.6), (4.0, 0.9, 1.2), "stone", "mid")
    a.box((4.2, -14.0, 1.1), (3.0, 1.6, 2.2), "stone", "mid")
    a.box((-4.6, -4.0, 0.9), (2.6, 2.6, 1.8), "stone", "mid", rot=0.2)
    a.crate(3.6, -36.0, stack=1, chunk="mid")
    a.crate(-5.6, -20.0, stack=2, chunk="mid")
    # separator rows: containers with gaps at y = -24 and y = -6 to cross between lanes
    for x in (9.5, -9.5):
        a.container(x, -39.0)
        a.container(x, -30.5, stack=2 if x > 0 else 1)
        a.container(x, -15.0)
        a.container(x, 6.0 if x > 0 else 3.0, rot=0.0)
    # side lanes: crates, stone and low walls every 8 to 12 m, alternating sides
    lane = [
        (20.0, -40.0, "crate", 2), (15.5, -33.0, "wall", 0), (23.0, -25.0, "block", 0),
        (16.5, -17.0, "crate", 1), (21.5, -10.0, "wall", 0), (14.8, -3.0, "block", 0),
        (-20.5, -40.5, "block", 0), (-15.5, -34.0, "crate", 2), (-22.5, -26.5, "wall", 0),
        (-16.0, -18.5, "block", 0), (-21.0, -11.0, "crate", 1), (-14.8, -4.5, "wall", 0),
    ]
    for x, y, kind, n in lane:
        if kind == "crate":
            a.crate(x, y, stack=n, rot=rng.uniform(-0.2, 0.2))
            a.crate(x + 1.3, y + 0.2, stack=1, rot=rng.uniform(-0.2, 0.2))
        elif kind == "wall":
            a.box((x, y, 0.6), (5.0, 0.9, 1.2), "stone", "lanes")
        else:
            a.box((x, y, 0.95), (2.4, 1.5, 1.9), "stone", "lanes", rot=rng.uniform(-0.15, 0.15))
    # pallets as steps up onto crate stacks (0.6 m, jumpable)
    a.box((18.3, -40.0, 0.3), (1.2, 1.2, 0.6), "crate", "lanes", face_uv=True, bevel=0.02)
    a.box((-15.5, -35.8, 0.3), (1.2, 1.2, 0.6), "crate", "lanes", face_uv=True, bevel=0.02)
    # centre line pieces (their mirror is themselves, so author half of them)
    a.box((19.0, 0.0, 1.5), (5.0, 7.0, 3.0), "stone", "centre", rot=0.0)
    a.box((-4.2, 1.5, 0.9), (1.4, 3.6, 1.8), "steel", "centre", rot=0.1)


def build_markings(a):
    # team floor paint: spawn boxes and lane arrows, render only
    for x in (-19.0, -11.0, 11.0, 19.0):
        a.box((x, -52.0, 0.006), (4.0, 0.25, 0.012), "paint_teal", "paint", collide=False, bevel=0.0)
    a.box((0.0, -47.2, 0.006), (9.0, 0.3, 0.012), "paint_teal", "paint", collide=False, bevel=0.0)
    for y in (-40.0, -28.0):
        for s in (-1, 1):
            a.box((s * 0.7, y, 0.006), (1.6, 0.25, 0.012), "paint_teal", "paint", rot=s * 0.6, collide=False, bevel=0.0)


def build_props(a, b):
    # light towers in the four corners and lamps on the nest canopies
    for x, y in ((22.0, -58.0), (-22.0, -58.0)):
        a.box((x, y, 6.0), (0.35, 0.35, 12.0), "steel", "props", collide=True, bevel=0.0)
        a.box((x, y, 12.2), (2.2, 0.5, 0.6), "steel", "props", collide=False, bevel=0.02)
        a.box((x, y + 0.28, 12.1), (2.0, 0.08, 0.4), "lamp", "props", collide=False, bevel=0.0)
    a.box((0, -57.6, NEST_TOP + 3.9), (3.0, 0.3, 0.1), "lamp", "props", collide=False, bevel=0.0)
    # barrels by the containers
    for x, y in ((12.4, -35.0), (-12.3, -22.0), (12.6, -9.5)):
        for k, c in enumerate(((x, y), rot180((x, y)))):
            ch = f"props_{'a' if k == 0 else 'b'}"
            b.add(M.bm_cylinder(c, 0.3, 0.0, 0.9, segments=10, bevel=0.02), ch, "steel")
            b.collide(M.bm_cylinder(c, 0.3, 0.0, 0.9, segments=10))
    # a mobile crane outside side B's wall for the skyline
    base = (8.0, HALF_Y + 11.0)
    b.add(M.bm_box((base[0], base[1], WALL_H + 17.0), (4.0, 6.0, 3.0), bevel=0.1), "crane", "yellow", weight=0.05)
    ang = math.radians(38)
    boom = M.bm_box((0, 0, 0), (1.0, 34.0, 1.0), rot_x=ang)
    M._transform(boom, 0.0, (base[0], base[1] - 12.0, WALL_H + 17.0 + 10.5))
    b.add(boom, "crane", "yellow", weight=0.05)
    b.add(M.bm_box((base[0], base[1] - 26.0, WALL_H + 14.0), (0.1, 0.1, 22.0)), "crane", "steel", weight=0.05)


def main():
    opts = M.parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    folder = M.tmp_dir(MAP_ID)
    make_materials(folder)
    rng = random.Random(11)
    b = M.MapBuilder(MAP_ID)
    a = Arena(b)
    build_floor_and_walls(a, b, rng)
    build_nest(a, b)
    build_cover(a, rng)
    build_markings(a)
    build_props(a, b)

    side_a = [(-19.0, -55.0), (-11.0, -51.5), (-3.2, -48.5), (3.2, -48.5), (11.0, -51.5), (19.0, -55.0)]
    spawns = []
    for side, pts in (("a", side_a), ("b", [rot180(p) for p in side_a])):
        for x, y in pts:
            yaw = M.yaw_deg(0.0, 1.0) if side == "a" else M.yaw_deg(0.0, -1.0)
            spawns.append({"position": M.to_three((x, y, 0.05)), "yawDeg": yaw, "side": side})
    meta = {
        "id": MAP_ID,
        "name": "Ochre Cut",
        "author": "WebStrafe Team",
        "source": "Original map built in Blender by tools/blender/maps/build_aim_ochrecut.py",
        "license": "Original work (MIT, same as the project)",
        "attribution": "Original layout and procedural textures made for WebStrafe.",
        "spawns": spawns,
        "notes": "AWP and Deagle duel arena. Sniper nests at both ends, six spawns per side, bots start on side B.",
    }
    layout = {
        "id": MAP_ID,
        "note": "generated by build_aim_ochrecut.py. blender coordinates (z up), side B is side A rotated 180 degrees",
        "halfX": HALF_X, "halfY": HALF_Y, "nestTop": NEST_TOP,
        "nests": [M.to_three((0.0, -56.0, NEST_TOP)), M.to_three((0.0, 56.0, NEST_TOP))],
        "stairs": [
            {"bottom": M.to_three((s * 14.0, -58.4, 0.0)), "top": M.to_three((s * 6.0, -58.4, NEST_TOP))} for s in (-1, 1)
        ] + [
            {"bottom": M.to_three((-s * 14.0, 58.4, 0.0)), "top": M.to_three((-s * 6.0, 58.4, NEST_TOP))} for s in (-1, 1)
        ],
        "cover": a.cover,
    }
    views = {
        "overview": {"location": (-42.0, -86.0, 52.0), "target": (0.0, -6.0, 0.0), "lens": 22},
        "eye": {"location": (0.0, -56.0, NEST_TOP + 1.6), "target": (0.0, 40.0, 2.0), "lens": M.world_lens_for_fov(100)},
        "thumb": {"location": (-30.0, -70.0, 30.0), "target": (2.0, -10.0, 0.0), "lens": 22, "resolution": (960, 540)},
        "lane": {"location": (19.0, -46.0, 1.6), "target": (17.0, 0.0, 1.2), "lens": M.world_lens_for_fov(100)},
    }
    M.finish_map(b, ENV, meta, views, opts, layout=layout)


main()
