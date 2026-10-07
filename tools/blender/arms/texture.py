"""texel space procedural textures for the cyborg arms atlas.

1. cycles bakes data maps of the packed atlas: position, normal, uv tangent
   and an object id, one texel = one surface point.
2. numpy works out every texel's surface coordinates from the same analytic
   shapes the meshes came from and builds a height and two masks:
     muscle: corded synthetic fibres along the limb, flex ribs across the
             wrist and finger joints, grip pads on the palm and finger pads
     plates: an engraved panel line inset from the edge, faint casting grain,
             the edge mask the runtime chips paint on
     mech:   ribbed bands and wound cables
   the base normal is the gradient of the piece's own sdf, so the decimated
   meshes shade like the dense ones (chamfers stay crisp).
3. the height gradient bends that normal, the object space result is
   re-baked by cycles to a tangent space map (mikktspace exact), and ao is
   baked per kit (each kit against the core and itself, never the others).

outputs two images: arms_normal (tangent space) and arms_orm (r ao, g
roughness detail around 0.5, b edge wear), read by src/characters/fpArmor.ts.
"""

import math
import os

import bpy
import numpy as np

import arm as A
import kits as K
import params as P
import sdf

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
TEX_DIR = os.path.join(ROOT, ".blender-tmp", "arms", "tex")


# ---------------------------------------------------------------- noise
def _hash3(ix, iy, iz, seed):
    h = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791) ^ (seed * 2654435761)
    h = (h ^ (h >> 13)) * 1274126177
    h = h ^ (h >> 16)
    return (h & 0xFFFFFF).astype(np.float64) / float(0xFFFFFF)


def value_noise(p, scale, seed=0):
    """smooth 3d value noise in 0..1, p in cm, scale = feature size in cm"""
    q = p / scale
    i = np.floor(q).astype(np.int64)
    f = q - i
    u = f * f * f * (f * (f * 6 - 15) + 10)
    out = np.zeros(len(p))
    for dx in (0, 1):
        wx = u[:, 0] if dx else 1 - u[:, 0]
        for dy in (0, 1):
            wy = u[:, 1] if dy else 1 - u[:, 1]
            for dz in (0, 1):
                wz = u[:, 2] if dz else 1 - u[:, 2]
                out += wx * wy * wz * _hash3(i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz, seed)
    return out


def fbm(p, scale, octaves=3, seed=0, gain=0.5):
    out = np.zeros(len(p))
    amp = 1.0
    total = 0.0
    for o in range(octaves):
        out += amp * value_noise(p, scale / (2 ** o), seed + o * 17)
        total += amp
        amp *= gain
    return out / total


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def line(d, width):
    return np.exp(-(d / width) ** 2)


# ---------------------------------------------------------------- surfaces
def fibres(along, across, p, seed=0):
    """(height, cord mask) of corded synthetic muscle running along `along`"""
    warp = 0.12 * (fbm(p, 2.0, 2, seed=seed) - 0.5)
    c = across + warp
    cord = np.abs(np.sin(math.pi * c / 0.5))
    h = 0.026 * (np.power(cord, 0.5) - 0.64)
    # faint straight striations inside each cord
    h += 0.0014 * np.sin(2 * math.pi * c / 0.11)
    # cords pinch slightly every so often like bundled cable
    h += 0.003 * np.sin(2 * math.pi * along / 1.3 + 4.0 * value_noise(p, 1.2, seed + 7))
    return h, cord


def ribs(t, centre, half, period=0.12, depth=0.014):
    """flex ribs across a joint: ridges around the limb within +-half of centre"""
    w = 1.0 - smoothstep(half * 0.6, half, np.abs(t - centre))
    return depth * (np.abs(np.sin(math.pi * (t - centre) / period)) - 0.5) * w, w


def grip_pads(a, b, cell=0.3):
    """raised rounded square pads in a grid"""
    fa = np.mod(a / cell, 1.0) - 0.5
    fb = np.mod(b / cell, 1.0) - 0.5
    d = np.maximum(np.abs(fa), np.abs(fb))
    return smoothstep(0.36, 0.28, d)


def _chain(p, pts):
    """closest segment index and arc length along a joint chain"""
    best = np.full(len(p), np.inf)
    seg = np.zeros(len(p), dtype=np.int64)
    t_out = np.zeros(len(p))
    acc = 0.0
    lens = []
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        ab = b - a
        L = float(np.linalg.norm(ab))
        lens.append(L)
        t = np.clip(((p - a) @ ab) / (L * L), 0.0, 1.0)
        d = np.linalg.norm(p - (a + np.outer(t, ab)), axis=1)
        better = d < best
        best = np.where(better, d, best)
        seg = np.where(better, i, seg)
        t_out = np.where(better, acc + t * L, t_out)
        acc += L
    return seg, t_out, lens


def muscle_surface(p, n, parts=None):
    """height and roughness detail of the muscle suit (hand frame cm)"""
    if parts is None:
        _, parts = K.SUIT.fields(p, want_parts=True)
    names = list(parts.keys())
    which = np.argmin(np.stack([parts[k] for k in names], axis=1), axis=1)
    h = np.zeros(len(p))
    rough = np.full(len(p), 0.5)

    # forearm and wrist: fibres along the arm, flex ribs over the wrist joint
    s = -p[:, 1]
    half_w, top, bot, _ = A.core_section(np.clip(s, -2.0, 60.0))
    theta = np.arctan2(p[:, 2] - (top + bot) * 0.5, p[:, 0])
    across = theta * (half_w + (top - bot) * 0.5) * 0.5
    ha, cord = fibres(s, across, p, seed=11)
    rib, rw = ribs(s, 0.0, 1.35, period=0.15, depth=0.016)
    arm_h = ha * (1 - rw) + rib
    arm_r = 0.5 - 0.1 * cord * (1 - rw) + 0.08 * rw

    # back of the hand: fibres towards the knuckles; palm: grip pads
    palm_side = smoothstep(0.1, 0.5, -n[:, 2])
    hh, hcord = fibres(p[:, 1], p[:, 0], p, seed=13)
    pads = grip_pads(p[:, 0] + 0.07 * p[:, 1], p[:, 1] - 0.07 * p[:, 0])
    hand_h = hh * (1 - palm_side) + palm_side * (0.012 * pads - 0.006)
    hand_r = (0.5 - 0.1 * hcord) * (1 - palm_side) + palm_side * (0.62 + 0.1 * pads)

    out_h = np.where(np.isin(which, [names.index("arm")]), arm_h, hand_h)
    out_r = np.where(np.isin(which, [names.index("arm")]), arm_r, hand_r)

    # digits: fibres along each segment, ribs over every joint, pads underneath
    for digit in P.FINGER_ORDER + ("thumb",):
        sel = which == names.index(digit)
        if not sel.any():
            continue
        q = p[sel]
        segs = K.digit_segments(digit)
        pts = [segs[0][0]] + [sg[1] for sg in segs]
        si, t, lens = _chain(q, pts)
        dors = np.stack([segs[i][4] for i in si])
        side = np.stack([segs[i][5] for i in si])
        a = np.stack([segs[i][0] for i in si])
        rel = q - a
        ang = np.arctan2(np.sum(rel * side, axis=1), np.sum(rel * dors, axis=1))
        r = segs[0][2]
        dh, dc = fibres(t, ang * r * 0.8, q, seed=17)
        jh = np.zeros(len(q))
        jw = np.zeros(len(q))
        acc = 0.0
        for L in lens[:-1]:
            acc += L
            rb, w = ribs(t, acc, 0.42, period=0.1, depth=0.012)
            jh += rb
            jw = np.maximum(jw, w)
        under = smoothstep(0.35, 0.75, -np.sum(n[sel] * dors, axis=1))
        fp = grip_pads(t, ang * r, cell=0.22)
        hd = (dh * (1 - jw) + jh) * (1 - under) + under * (0.01 * fp - 0.005)
        rd = (0.5 - 0.1 * dc) * (1 - under) + under * (0.64 + 0.08 * fp)
        out_h[sel] = hd
        out_r[sel] = rd
    out_r += 0.06 * (fbm(p, 0.7, 2, seed=19) - 0.5)
    return out_h, out_r


def upper_surface(p):
    s = -p[:, 1]
    half_w, top, bot, _ = A.core_section(s)
    theta = np.arctan2(p[:, 2] - (top + bot) * 0.5, p[:, 0])
    h, cord = fibres(s, theta * (half_w + (top - bot) * 0.5) * 0.5, p, seed=21)
    # the raised lip where the upper arm sleeve starts
    lip, _ = ribs(s, P.ARM_SDF_END_S - 0.1, 0.5, period=0.1, depth=0.01)
    return h + lip, 0.5 - 0.1 * cord


def plate_surface(pc, p):
    """(height, roughness detail, edge mask) of a plate"""
    f = pc.foot(p)
    edge = smoothstep(-0.1, 0.0, f)
    big = pc.rig == "arm" or "hand" in pc.name or pc.name == "anvil_knuckles"
    h = 0.0015 * (value_noise(p, 0.06, seed=31) - 0.5)
    r = 0.5 + 0.12 * (fbm(p, 0.8, 3, seed=33) - 0.5)
    if big:
        groove = line(f + 0.3, 0.022)
        h = h - 0.02 * groove
        r = r + 0.12 * groove
    else:
        # small plates: a soft ridge along the middle catches light
        h = h + 0.004 * smoothstep(-0.05, -0.25, f)
    return h, r, edge


def mech_surface(pc, p):
    s = -p[:, 1]
    if pc.name == "wrist_band":
        h = 0.007 * np.abs(np.sin(math.pi * s / 0.09))
        return h, np.full(len(p), 0.45)
    # wound cable: a fine helix
    half_w, top, bot, _ = A.core_section(np.clip(s, 0.0, 40.0))
    theta = np.arctan2(p[:, 2] - (top + bot) * 0.5, p[:, 0])
    h = 0.006 * np.sin(2 * math.pi * (s / 0.09) + theta * 8.0)
    return h, np.full(len(p), 0.5)


# ---------------------------------------------------------------- baking
def _float_image(name, size):
    img = bpy.data.images.get(name)
    if img is not None:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, size, size, alpha=True, float_buffer=True)
    img.colorspace_settings.name = "Non-Color"
    return img


def _read(img):
    w, h = img.size
    px = np.zeros(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    return px.reshape(h, w, 4)


def _write(img, arr):
    img.pixels.foreach_set(np.ascontiguousarray(arr, dtype=np.float32).ravel())
    img.update()


def _bake_material(name, target_img, build):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    shader = build(nt)
    nt.links.new(shader, out.inputs["Surface"])
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = target_img
    for n in nt.nodes:
        n.select = False
    tex.select = True
    nt.nodes.active = tex
    return mat


def _emission(nt, color_socket):
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(color_socket, em.inputs["Color"])
    return em.outputs["Emission"]


def _bake(objs, mats, bake_type, samples=1, device=None, **kw):
    """bakes objs (each with its own material from mats, or one shared)"""
    scene = bpy.context.scene
    prev_device = scene.cycles.device
    if device is not None:
        scene.cycles.device = device
    saved = {o.name: list(o.data.materials) for o in objs}
    for k, o in enumerate(objs):
        o.data.materials.clear()
        o.data.materials.append(mats[k] if isinstance(mats, list) else mats)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    scene.cycles.samples = samples
    scene.render.bake.margin = 0
    scene.render.bake.use_clear = True
    bpy.ops.object.bake(type=bake_type, margin=0, use_clear=True, **kw)
    scene.cycles.device = prev_device
    for o in objs:
        o.data.materials.clear()
        for m in saved[o.name]:
            o.data.materials.append(m)


def bake_data_maps(objs, size, bmin, bsize):
    maps = {}

    def build_pos(nt):
        geo = nt.nodes.new("ShaderNodeNewGeometry")
        sub = nt.nodes.new("ShaderNodeVectorMath")
        sub.operation = "SUBTRACT"
        sub.inputs[1].default_value = tuple(bmin)
        mul = nt.nodes.new("ShaderNodeVectorMath")
        mul.operation = "MULTIPLY"
        mul.inputs[1].default_value = tuple(1.0 / np.asarray(bsize))
        nt.links.new(geo.outputs["Position"], sub.inputs[0])
        nt.links.new(sub.outputs[0], mul.inputs[0])
        return _emission(nt, mul.outputs[0])

    def encode(nt, socket):
        ma = nt.nodes.new("ShaderNodeVectorMath")
        ma.operation = "MULTIPLY_ADD"
        ma.inputs[1].default_value = (0.5, 0.5, 0.5)
        ma.inputs[2].default_value = (0.5, 0.5, 0.5)
        nt.links.new(socket, ma.inputs[0])
        return _emission(nt, ma.outputs[0])

    def build_nrm(nt):
        return encode(nt, nt.nodes.new("ShaderNodeNewGeometry").outputs["Normal"])

    def build_tan(nt):
        tg = nt.nodes.new("ShaderNodeTangent")
        tg.direction_type = "UV_MAP"
        tg.uv_map = "UVMap"
        return encode(nt, tg.outputs["Tangent"])

    for key, build in (("pos", build_pos), ("nrm", build_nrm), ("tan", build_tan)):
        img = _float_image(f"bake_{key}", size)
        mat = _bake_material(f"bake_{key}_mat", img, build)
        _bake(objs, mat, "EMIT")
        maps[key] = _read(img)
        bpy.data.materials.remove(mat)

    # object ids in one pass: every object emits its own index
    img = _float_image("bake_id", size)
    id_mats = []
    for k in range(len(objs)):
        def build_id(nt, k=k):
            rgb = nt.nodes.new("ShaderNodeRGB")
            rgb.outputs[0].default_value = ((k + 1) / 1024.0, 1.0, 0.0, 1.0)
            return _emission(nt, rgb.outputs[0])
        id_mats.append(_bake_material(f"bake_id_mat{k}", img, build_id))
    _bake(objs, id_mats, "EMIT")
    px = _read(img)
    maps["id"] = np.where(px[..., 1] > 0.5, np.rint(px[..., 0] * 1024.0).astype(np.int32), 0)
    for m in id_mats:
        bpy.data.materials.remove(m)
    return maps


def dilate(arr, mask, levels=None):
    """pull-push fill so mips and filtering never pull black into the islands"""
    a = np.asarray(arr, dtype=np.float32)
    flat = a.ndim == 2
    if flat:
        a = a[..., None]
    m = mask.astype(np.float32)
    h, w = m.shape
    if levels is None:
        levels = int(math.log2(min(h, w)))
    vals = [a * m[..., None]]
    wts = [m]
    for _ in range(levels):
        v, wt = vals[-1], wts[-1]
        hh, ww = wt.shape
        if hh < 2 or ww < 2:
            break
        v = v.reshape(hh // 2, 2, ww // 2, 2, -1).sum(axis=(1, 3))
        wt = wt.reshape(hh // 2, 2, ww // 2, 2).sum(axis=(1, 3))
        vals.append(v)
        wts.append(wt)
    filled = vals[-1] / np.maximum(wts[-1], 1e-6)[..., None]
    for k in range(len(vals) - 2, -1, -1):
        up = np.repeat(np.repeat(filled, 2, axis=0), 2, axis=1)
        cur = vals[k] / np.maximum(wts[k], 1e-6)[..., None]
        has = (wts[k] > 0)[..., None]
        filled = np.where(has, cur, up)
    out = np.where(m[..., None] > 0, a, filled)
    return out[..., 0] if flat else out


def _byte_image(name, rgba_linear, colorspace):
    h, w = rgba_linear.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=False, float_buffer=False)
    img.colorspace_settings.name = colorspace
    data = np.clip(rgba_linear, 0, 1).astype(np.float64)
    data[..., 3] = 1.0
    img.pixels.foreach_set(data.astype(np.float32).ravel())
    img.filepath_raw = os.path.join(TEX_DIR, f"{name}.png")
    img.file_format = "PNG"
    img.save()
    return img


def _normalize(v):
    return v / np.maximum(np.linalg.norm(v, axis=1, keepdims=True), 1e-9)


# ---------------------------------------------------------------- assembly
def build_textures(suit, upper, built, size, log):
    os.makedirs(TEX_DIR, exist_ok=True)
    objs = [suit, upper] + [o for _, o in built]
    info = [("suit", None), ("upper", None)] + [(pc.style, pc) for pc, _ in built]
    allco = np.concatenate([np.array([v.co for v in o.data.vertices]) for o in objs])
    bmin = allco.min(axis=0) - 0.01
    bsize = allco.max(axis=0) + 0.01 - bmin

    maps = bake_data_maps(objs, size, bmin, bsize)
    log(f"baked data maps at {size}px")
    ident = maps["id"]
    cover = ident > 0
    pos = bmin + maps["pos"][..., :3].astype(np.float64) * bsize
    nrm = maps["nrm"][..., :3].astype(np.float64) * 2 - 1
    tan = maps["tan"][..., :3].astype(np.float64) * 2 - 1

    height = np.zeros(cover.shape)
    rough = np.full(cover.shape, 0.5)
    edge = np.zeros(cover.shape)
    n_obj = np.zeros(cover.shape + (3,))
    eps = 0.01

    for k, (kind, pc) in enumerate(info):
        sel = ident == k + 1
        if not sel.any():
            continue
        p = (pos[sel] - P.WRIST_R) / P.CM
        n0 = _normalize(nrm[sel])
        if kind == "suit":
            fn = K.SUIT.sdf
        elif kind == "upper":
            fn = None
        else:
            fn = pc.fn
        if fn is not None:
            p = sdf.project_to_surface(fn, p, eps=0.008, iterations=2)
            n_base = _normalize(sdf.gradient(fn, p, 0.006))
            # a texel can land on the wrong side of a thin shell, keep the mesh's side
            n_base *= np.sign(np.sum(n_base * n0, axis=1, keepdims=True) + 1e-9)
        else:
            n_base = n0

        if kind == "suit":
            def surf(q):
                return muscle_surface(q, n_base)[0]
            h, r = muscle_surface(p, n_base)
            e = np.zeros(len(p))
        elif kind == "upper":
            def surf(q):
                return upper_surface(q)[0]
            h, r = upper_surface(p)
            e = np.zeros(len(p))
        elif kind == "plate":
            def surf(q, pc=pc):
                return plate_surface(pc, q)[0]
            h, r, e = plate_surface(pc, p)
        elif kind == "mech":
            def surf(q, pc=pc):
                return mech_surface(pc, q)[0]
            h, r = mech_surface(pc, p)
            e = np.zeros(len(p))
        else:
            def surf(q):
                return np.zeros(len(q))
            h, r, e = np.zeros(len(p)), np.full(len(p), 0.5), np.zeros(len(p))

        t0 = tan[sel]
        t0 = _normalize(t0 - n_base * np.sum(t0 * n_base, axis=1, keepdims=True))
        b0 = np.cross(n_base, t0)
        dh_t = (surf(p + t0 * eps) - surf(p - t0 * eps)) / (2 * eps)
        dh_b = (surf(p + b0 * eps) - surf(p - b0 * eps)) / (2 * eps)
        n_obj[sel] = _normalize(n_base - t0 * dh_t[:, None] - b0 * dh_b[:, None])
        height[sel] = h
        rough[sel] = r
        edge[sel] = e
    log("texel surfaces done")

    # object space normal -> tangent space through cycles
    nimg = _float_image("bake_nobj", size)
    arr = np.zeros(cover.shape + (4,), dtype=np.float32)
    arr[..., :3] = dilate(n_obj * 0.5 + 0.5, cover)
    arr[..., 3] = 1.0
    _write(nimg, arr)
    timg = _float_image("bake_ntan", size)

    def build_n(nt):
        src = nt.nodes.new("ShaderNodeTexImage")
        src.image = nimg
        src.interpolation = "Closest"
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.space = "OBJECT"
        bsdf = nt.nodes.new("ShaderNodeBsdfDiffuse")
        nt.links.new(src.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
        return bsdf.outputs["BSDF"]

    mat = _bake_material("bake_ntan_mat", timg, build_n)
    _bake(objs, mat, "NORMAL", samples=1, normal_space="TANGENT")
    ntan = _read(timg)[..., :3]
    bpy.data.materials.remove(mat)
    log("baked tangent space normals")

    # ao per group: the core alone, then each kit over the core (kits share the
    # same space, so they must never shadow each other)
    world = bpy.context.scene.world or bpy.data.worlds.new("BakeWorld")
    bpy.context.scene.world = world
    world.light_settings.distance = 0.03
    sets = ["core"] + sorted({pc.set for pc, _ in built if pc.set != "core"})
    set_of = ["core", "core"] + [pc.set for pc, _ in built]
    ao = np.ones(cover.shape)
    for group in sets:
        for o, s in zip(objs, set_of):
            o.hide_render = not (s == "core" or s == group)
        targets = [o for o, s in zip(objs, set_of) if s == group]
        aimg = _float_image("bake_ao", size)
        mat = _bake_material("bake_ao_mat", aimg, lambda nt: nt.nodes.new("ShaderNodeBsdfDiffuse").outputs["BSDF"])
        _bake(targets, mat, "AO", samples=64, device="CPU")
        px = _read(aimg)[..., 0]
        ids = [k + 1 for k, s in enumerate(set_of) if s == group]
        sel = np.isin(ident, ids)
        ao[sel] = px[sel]
        bpy.data.materials.remove(mat)
        bpy.data.images.remove(aimg)
        log(f"baked ao for {group}")
    for o in objs:
        o.hide_render = False
    ao = np.clip(ao, 0.0, 1.0) * np.clip(1.0 + height * 14.0, 0.6, 1.0)

    orm = np.ones(cover.shape + (4,), dtype=np.float32)
    orm[..., 0] = dilate(ao, cover)
    orm[..., 1] = dilate(np.clip(rough, 0.0, 1.0), cover)
    orm[..., 2] = dilate(edge, cover)
    nmap = np.ones(cover.shape + (4,), dtype=np.float32)
    nmap[..., :3] = dilate(ntan, cover)
    orm_img = _byte_image("arms_orm", orm, "Non-Color")
    n_img = _byte_image("arms_normal", nmap, "Non-Color")
    for img in (nimg, timg):
        bpy.data.images.remove(img)
    for key in ("pos", "nrm", "tan", "id"):
        im = bpy.data.images.get(f"bake_{key}")
        if im is not None:
            bpy.data.images.remove(im)
    return {"normal": n_img, "orm": orm_img}
