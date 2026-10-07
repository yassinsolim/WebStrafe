"""builds the katana viewmodel and third person model: an original high
frequency style katana. a long blade with a dark blued body, a polished edge
and a glowing channel down each flat, an angular guard, chrome collars and a
diamond wrapped handle over a red underlay. every vertex comes from this
script; proportions follow a standard katana (70 cm blade, 25 cm handle, about
18 mm of curve).

  blender -b --factory-startup --python-exit-code 1 -P tools/blender/weapons/build_katana.py -- \\
      [--out .blender-tmp/weapons/katana_raw.glb] [--renders .blender-tmp/weapons/katana] [--quick] [--size 2048]

then, like the guns:
  npx tsx tools/assets/optimize-glb.ts .blender-tmp/weapons/katana_raw.glb public/viewmodels/v2/katana.glb \\
      --texture-size 1024 --no-webp
  KTX2_UASTC_NORMALS=1 npx tsx tools/assets/ktx2-textures.ts public/viewmodels/v2/katana.glb public/viewmodels/v2/katana.glb

frame: the knife frame, so the knife grip fitter holds it (docs/assets/knife-contract.md).
blender +x runs to the tip, +z is the spine (the edge faces -z), y is the
thickness. that exports as three.js +x tip, +y spine. design units are mm with
x = 0 at the front of the guard; at the end everything is shifted so
socket_grip_r (the middle of the right fist) is the origin.
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wlib as W  # noqa: E402
from wlib import MM  # noqa: E402

ARGS = W.common.script_args()


def arg(name, default=None):
    return ARGS[ARGS.index(name) + 1] if name in ARGS else default


QUICK = "--quick" in ARGS
OUT = arg("--out", os.path.join(W.TMP, "katana_raw.glb"))
RENDERS = arg("--renders", None)
SIZE = int(arg("--size", "2048"))

BLADE_L = 700.0          # habaki to tip
SORI = 17.0              # how far the spine rises over the blade
KISSAKI = 50.0           # length of the tip section
W0, W1 = 31.0, 24.5      # spine to edge at the root and before the tip
MUNE_T0, MUNE_T1 = 7.0, 4.6
GUARD = (-9.0, -1.5)     # tsuba x range
HANDLE = (-268.0, -24.0)
FUCHI = (-24.0, -9.0)
KASHIRA = (-284.0, -268.0)
GRIP_R_X = -62.0         # middle of the right fist, just behind the guard
GRIP_L_X = -165.0        # middle of the left fist near the pommel
# blade root: spine at +15.5, so the handle axis sits at z = 0
Z_SPINE0 = W0 * 0.5


def spine_z(x):
    u = max(0.0, x) / BLADE_L
    return Z_SPINE0 + SORI * u ** 1.7


def width(x):
    """spine to edge, the edge sweeping up into the tip over the kissaki"""
    k0 = BLADE_L - KISSAKI
    u = max(0.0, min(x, k0)) / k0
    w = W0 + (W1 - W0) * u
    if x > k0:
        f = (x - k0) / KISSAKI
        w = W1 * max(0.0, 1.0 - f ** 1.6) ** 0.62
    return w


def thickness(x):
    u = max(0.0, x) / BLADE_L
    return MUNE_T0 + (MUNE_T1 - MUNE_T0) * u


def section(x):
    """blade cross section at x as (y, z) mm, with the material of the face
    that starts at each point: e = polished edge bevel, b = blued body"""
    zs = spine_z(x)
    w = max(width(x), 0.4)
    t = thickness(x) * min(1.0, 0.25 + w / W1)
    ze = zs - w
    shinogi = zs - 0.3 * w
    ha = ze + 0.2 * w
    th = min(1.5, t * 0.3)
    pts = [
        ((0.0, ze), "e"),
        ((th * 0.5, ha), "b"),
        ((t * 0.55, shinogi), "b"),
        ((t * 0.5, zs - 0.05 * w), "b"),
        ((t * 0.28, zs), "b"),
        ((-t * 0.28, zs), "b"),
        ((-t * 0.5, zs - 0.05 * w), "b"),
        ((-t * 0.55, shinogi), "b"),
        ((-th * 0.5, ha), "e"),
    ]
    return pts


def blade_mesh(M, n):
    """lofted blade with per strip materials"""
    # denser near the tip where the edge curves
    k0 = BLADE_L - KISSAKI
    xs = [k0 * i / (n - 1) for i in range(n)]
    tip_n = max(8, n // 4)
    xs += [k0 + KISSAKI * (1 - (1 - j / tip_n) ** 1.5) * 0.992 for j in range(1, tip_n + 1)]
    bm = bmesh.new()
    rings = []
    mats = []
    for x in xs:
        sec = section(x)
        rings.append([bm.verts.new((x * MM, y * MM, z * MM)) for (y, z), _ in sec])
        mats = [m for _, m in sec]
    tip = bm.verts.new((BLADE_L * MM, 0.0, spine_z(BLADE_L) * MM - 0.2 * MM))
    m_idx = {"b": 0, "e": 1}
    count = len(rings[0])
    for ra, rb in zip(rings, rings[1:]):
        for i in range(count):
            j = (i + 1) % count
            f = bm.faces.new((ra[i], ra[j], rb[j], rb[i]))
            f.material_index = m_idx[mats[i]]
    for i in range(count):
        j = (i + 1) % count
        f = bm.faces.new((rings[-1][i], rings[-1][j], tip))
        f.material_index = m_idx[mats[i]]
    f = bm.faces.new(list(reversed(rings[0])))
    f.material_index = 0
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("blade")
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new("blade", me)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(M["blade"])
    obj.data.materials.append(M["edge"])
    W.mark_sharp_by_angle(obj, 25.0)
    return obj


def glow_strips(M, n):
    """glowing channels on both flats, between the shinogi and the spine"""
    x0, x1 = 48.0, BLADE_L - 130.0
    bm = bmesh.new()
    for side in (1, -1):
        rows = []
        for i in range(n):
            x = x0 + (x1 - x0) * i / (n - 1)
            zs = spine_z(x)
            w = width(x)
            t = thickness(x) * min(1.0, 0.25 + w / W1)
            # lerp the flat between the shinogi (y .55t) and the spine corner (y .5t)
            taper = min(1.0, (x - x0) / 30.0, (x1 - x) / 60.0)
            half = 0.055 * w * max(0.15, taper)
            zc = zs - 0.17 * w
            pts = []
            for dz in (half, -half):
                z = zc + dz
                f = (zs - 0.05 * w - z) / ((zs - 0.05 * w) - (zs - 0.3 * w))
                y = (0.5 + 0.05 * f) * t + 0.12
                pts.append(bm.verts.new((x * MM, side * y * MM, z * MM)))
            rows.append(pts)
        for a, b in zip(rows, rows[1:]):
            face = (a[0], b[0], b[1], a[1]) if side > 0 else (a[1], b[1], b[0], a[0])
            bm.faces.new(face)
    me = bpy.data.meshes.new("blade_glow")
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new("blade_glow", me)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(M["glow"])
    return obj


def ellipse(cy, cz, ry, rz, n, sq=2.4):
    """superellipse loop in the (y, z) plane"""
    out = []
    for i in range(n):
        a = 2 * math.pi * i / n
        c, s = math.cos(a), math.sin(a)
        out.append((cy + ry * math.copysign(abs(c) ** (2 / sq), c), cz + rz * math.copysign(abs(s) ** (2 / sq), s)))
    return out


def handle_ry(x):
    u = (x - HANDLE[0]) / (HANDLE[1] - HANDLE[0])
    return 12.6 - 0.8 * math.sin(math.pi * u)


def handle_rz(x):
    u = (x - HANDLE[0]) / (HANDLE[1] - HANDLE[0])
    return 16.2 - 1.0 * math.sin(math.pi * u)


def handle(M, n_sec, n_ring):
    xs = [HANDLE[0] + (HANDLE[1] - HANDLE[0]) * i / (n_sec - 1) for i in range(n_sec)]
    # the low poly sits halfway up the wrap so the bake reaches both the ribbons and the underlay
    grow = 0.0 if W.hi() else 0.5
    sections = [(x * MM, [(y * MM, z * MM) for y, z in ellipse(0, 0, handle_ry(x) + grow, handle_rz(x) + grow, n_ring)])
                for x in xs]
    core = W.loft("handle", sections, "X", M["same"])
    W.mark_sharp_by_angle(core, 60.0)
    parts = [core]
    if W.hi():
        parts += wrap_ribbons(M)
    return parts


def wrap_ribbons(M):
    """the diamond wrap: flat ribbons spiralling both ways round the handle (high poly only)"""
    out = []
    x0, x1 = HANDLE[0] + 6.0, HANDLE[1] - 6.0
    turns = 6.0
    for sgn in (1, -1):
        for k in range(2):
            bm = bmesh.new()
            n = 360
            rows = []
            for i in range(n + 1):
                t = i / n
                x = x0 + (x1 - x0) * t
                a = sgn * 2 * math.pi * turns * t + k * math.pi + math.pi / 2
                ry, rz = handle_ry(x) - 0.05, handle_rz(x) - 0.05
                c, s = math.cos(a), math.sin(a)
                y, z = ry * c, rz * s
                nrm = Vector((0.0, c / ry, s / rz)).normalized()
                half = 4.6
                rows.append([bm.verts.new(((x - half) * MM, y * MM, z * MM)),
                             bm.verts.new(((x + half) * MM, y * MM, z * MM)),
                             bm.verts.new(((x + half) * MM + 0, (y + nrm.y * 1.0) * MM, (z + nrm.z * 1.0) * MM)),
                             bm.verts.new(((x - half) * MM, (y + nrm.y * 1.0) * MM, (z + nrm.z * 1.0) * MM))])
            for a_, b_ in zip(rows, rows[1:]):
                for q in range(4):
                    r = (q + 1) % 4
                    bm.faces.new((a_[q], a_[r], b_[r], b_[q]))
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            me = bpy.data.meshes.new("ito")
            bm.to_mesh(me)
            bm.free()
            obj = bpy.data.objects.new("ito", me)
            bpy.context.scene.collection.objects.link(obj)
            obj.data.materials.append(M["ito"])
            for p in obj.data.polygons:
                p.use_smooth = True
            out.append(obj)
    return out


def guard(M):
    zc = 0.0
    outline = [(0, 41, 3), (23, 35, 4), (34, 15, 3), (34, -15, 3), (23, -35, 4), (0, -41, 3), (-23, -35, 4),
               (-34, -15, 3), (-34, 15, 3), (-23, 35, 4)]
    tsuba = W.prism("tsuba", W.fillet(W.mm([(y, z + zc, r) for y, z, r in outline])), "X", GUARD[0] * MM, GUARD[1] * MM,
                    M["guard"])
    cuts = []
    for sy in (1, -1):
        for sz in (1, -1):
            tri = [(sy * 14, sz * 22), (sy * 26, sz * 13), (sy * 22, sz * 30)]
            cuts.append(W.prism("c", W.fillet(W.mm([(y, z, 1.2) for y, z in tri])), "X", (GUARD[0] - 1) * MM,
                                (GUARD[1] + 1) * MM, M["guard"]))
    W.boolean(tsuba, cuts)
    W.bevel(tsuba, 1.0 * MM, segs=2, angle=30.0)
    seppa = []
    for x0, x1 in ((GUARD[0] - 1.6, GUARD[0]), (GUARD[1], GUARD[1] + 1.6)):
        s = W.prism("seppa", W.fillet(W.mm([(y, z, 6.0) for y, z in [(-9, -19), (9, -19), (9, 19), (-9, 19)]])), "X",
                    x0 * MM, x1 * MM, M["chrome"])
        W.bevel(s, 0.4 * MM, segs=1)
        seppa.append(s)
    return [tsuba] + seppa


def collars(M):
    # habaki: a tapered sleeve round the blade root
    z0, z1 = Z_SPINE0 - W0 - 1.4, Z_SPINE0 + 1.6
    base = [(-6.0, z0, 2.0), (6.0, z0, 2.0), (6.0, z1, 2.0), (-6.0, z1, 2.0)]
    tip = [(-4.8, z0 + 1.0, 2.0), (4.8, z0 + 1.0, 2.0), (4.8, z1 - 0.2, 2.0), (-4.8, z1 - 0.2, 2.0)]
    habaki = W.prism("habaki", W.fillet(W.mm(base)), "X", GUARD[1] * MM + 1.6 * MM, 32.0 * MM, M["chrome"],
                     pts_hi=W.fillet(W.mm(tip)))
    W.bevel(habaki, 0.6 * MM, segs=2)
    # fuchi: chrome collar at the top of the handle, kashira: pommel cap with a glow ring
    ry, rz = handle_ry(HANDLE[1]) + 1.2, handle_rz(HANDLE[1]) + 1.2
    fuchi = W.loft("fuchi", [(x * MM, [(y * MM, z * MM) for y, z in ellipse(0, 0, ry * s, rz * s, 40)])
                             for x, s in ((FUCHI[0], 1.0), (FUCHI[1] - 2.0, 1.04), (FUCHI[1], 1.06))], "X", M["chrome"])
    W.bevel(fuchi, 0.6 * MM, segs=2, angle=20.0)
    ry, rz = handle_ry(HANDLE[0]) + 1.2, handle_rz(HANDLE[0]) + 1.2
    rows = [(KASHIRA[1], 1.0), (KASHIRA[0] + 7.0, 1.02), (KASHIRA[0] + 3.0, 0.9), (KASHIRA[0], 0.6)]
    kashira = W.loft("kashira", [(x * MM, [(y * MM, z * MM) for y, z in ellipse(0, 0, ry * s, rz * s, 40)]) for x, s in rows],
                     "X", M["chrome"])
    W.bevel(kashira, 0.6 * MM, segs=2, angle=20.0)
    return [habaki, fuchi, kashira]


def pommel_glow(M):
    ry, rz = handle_ry(HANDLE[0]) + 1.45, handle_rz(HANDLE[0]) + 1.45
    x = KASHIRA[0] + 10.5
    secs = [(xx * MM, [(y * MM, z * MM) for y, z in ellipse(0, 0, ry, rz, 40)]) for xx in (x - 0.9, x + 0.9)]
    ring = W.loft("pommel_glow", secs, "X", M["glow"], cap=False)
    return ring


def make_materials():
    return {
        "blade": W.finish("mat_katana_blade", base=0x1c1f25, rough=0.2, metal=1.0, wear=0.2, wear_color=0x7d848f,
                          wear_rough=0.16, grime=0.15, rvar=0.05, scratch=0.25, detail="brushed"),
        "edge": W.finish("mat_katana_edge", base=0xdfe4ea, rough=0.1, metal=1.0, wear=0.0, grime=0.05, rvar=0.03,
                         scratch=0.12, detail="brushed"),
        "chrome": W.finish("mat_katana_chrome", base=0xb9bec5, rough=0.16, metal=1.0, wear=0.25, wear_color=0xe0e3e8,
                           grime=0.25, rvar=0.05, scratch=0.3, detail="brushed"),
        "guard": W.finish("mat_katana_guard", base=0x2b2e33, rough=0.34, metal=0.9, wear=0.55, wear_color=0x9da2a9,
                          wear_rough=0.22, wear_metal=1.0, grime=0.35, rvar=0.07, scratch=0.45, detail="brushed"),
        "same": W.finish("mat_katana_underlay", base=0x8c1421, rough=0.5, metal=0.0, grime=0.5, rvar=0.06,
                         scratch=0.05, bump="stipple"),
        "ito": W.finish("mat_katana_wrap", base=0x17181c, rough=0.86, grime=0.4, rvar=0.05, scratch=0.05,
                        bump="grain"),
        # not baked: the glow keeps its own unlit-looking material
        "glow": W.material("mat_katana_glow", 0xff2a3d, 0.4, 0.0, emission=0xff2a3d, emission_strength=6.0),
    }


def build_parts(M):
    n_blade = 72 if W.hi() else 36
    blade = blade_mesh(M, n_blade)
    body = W.join(guard(M) + collars(M) + handle(M, 40 if W.hi() else 22, 64 if W.hi() else 28), "hilt")
    return blade, body


def final_shift():
    return Matrix.Translation(Vector((-GRIP_R_X * MM, 0.0, 0.0)))


def build():
    W.common.reset_scene()
    M = make_materials()
    W.set_hi(False)
    blade, hilt = build_parts(M)
    glow = W.join([glow_strips(M, 40), pommel_glow(M)], "glow", sharp=False)
    shift = final_shift()
    for obj in (blade, hilt, glow):
        obj.data.transform(shift)
    root = W.empty("katana", (0, 0, 0))
    blade.name = blade.data.name = "blade"
    hilt.name = hilt.data.name = "hilt"
    glow.name = glow.data.name = "glow"
    for obj in (blade, hilt, glow):
        W.parent_static(obj, root)
    gx = lambda x: (x - GRIP_R_X) * MM  # noqa: E731
    sockets = [
        W.empty("socket_grip_r", (0.0, 0.0, 0.0), parent=root),
        W.empty("socket_grip_l", (gx(GRIP_L_X), 0.0, 0.0), parent=root),
        W.empty("socket_tip", (gx(BLADE_L), 0.0, spine_z(BLADE_L) * MM), parent=root),
        W.empty("socket_guard", (gx(GUARD[1]), 0.0, 0.0), parent=root),
    ]
    root["grip"] = "hammer"
    root["handleLength"] = round((HANDLE[1] - HANDLE[0]) * MM, 4)
    root["bladeLength"] = round(BLADE_L * MM, 4)
    return root, [blade, hilt], glow, sockets, M


def build_high(M):
    W.set_hi(True)
    blade, hilt = build_parts(M)
    W.set_hi(False)
    shift = final_shift()
    for obj in (blade, hilt):
        obj.data.transform(shift)
        obj.name = obj.data.name = f"hi_{obj.name}"
    return {"blade": blade, "hilt": hilt}


def texel_weight(obj, centre, mat_name):
    # the blade fills the screen, the wrapped handle sits under the hands
    return 1.25 if mat_name in ("mat_katana_blade", "mat_katana_edge") else 0.85


def renders(outdir):
    os.makedirs(outdir, exist_ok=True)
    W.setup_studio(strength=0.55)
    W.add_light("key", (0.2, -0.5, 0.6), (0.3, 0, 0), 60.0, size=0.8)
    W.add_light("rim", (0.6, 0.5, 0.3), (0.3, 0, 0), 40.0, size=0.6, color=(0.85, 0.9, 1.0))
    c = Vector((0.33, 0.0, 0.0))
    res = (1600, 700)
    W.render(os.path.join(outdir, "katana_side.png"), tuple(c + Vector((0, -1.4, 0.05))), tuple(c), lens=50,
             resolution=res, samples=64)
    W.render(os.path.join(outdir, "katana_34.png"), tuple(c + Vector((-0.5, -0.9, 0.35))), tuple(c), lens=45,
             resolution=res, samples=64)
    hilt = Vector((-0.02, 0, 0))
    W.render(os.path.join(outdir, "katana_hilt.png"), tuple(hilt + Vector((0.05, -0.35, 0.12))), tuple(hilt), lens=60,
             resolution=(1200, 800), samples=64)


def main():
    root, meshes, glow, sockets, M = build()
    total = W.tri_count(meshes + [glow])
    print(f"[katana] {total} tris")
    if not QUICK:
        highs = build_high(M)
        W.texture_set(meshes, highs, "katana", SIZE, texel_weight, look=dict(edge_gain=0.8, value_var=0.06))
        W.delete_high(highs)
    W.export(OUT, root, tangents=not QUICK)
    if RENDERS or QUICK:
        renders(RENDERS or W.TMP)
    print(f"[katana] done -> {OUT}")


main()
