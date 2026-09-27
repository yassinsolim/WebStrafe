"""texel space procedural textures for the glove, skin and sleeve atlas.

1. cycles bakes data maps of the packed atlas: position, smooth normal,
   uv tangent and an object id, one texel = one surface point.
2. numpy works out every texel's surface coordinates (panel side, distance
   to seams, position along the finger, cuff angle...) from the same
   analytic shape the mesh came from, and builds height, colour and
   roughness from them. the glove normal comes from the sdf gradient so the
   decimated mesh shades like the dense one.
3. the height gradient bends that normal, the result is written as an
   object space normal image and cycles re-bakes it to a tangent space map
   (so it matches blender/gltf mikktspace exactly), plus an ao bake.
"""

import math
import os

import bpy
import numpy as np

import arm as A
import materials as MAT
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


def fbm(p, scale, octaves=4, seed=0, gain=0.5):
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
    """soft line profile, 1 on the line, 0 beyond width"""
    return np.exp(-(d / width) ** 2)


def dashes(along, period, duty=0.62, soft=0.12):
    """0..1 stitch dashes along a coordinate"""
    ph = np.mod(along / period, 1.0)
    return smoothstep(0.0, soft, ph) * (1.0 - smoothstep(duty - soft, duty, ph))


def stitch(d_signed, offset, along, period=0.29, width=0.028):
    """(height, mask) of a row of stitches running at d = offset"""
    across = np.abs(d_signed - offset)
    m = line(across, width) * dashes(along, period)
    return m, m


def srgb(c):
    return np.array(MAT.srgb_to_linear(c))


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


def _bake(objs, mat, bake_type, samples=1, device=None, **kw):
    scene = bpy.context.scene
    prev_device = scene.cycles.device
    if device is not None:
        scene.cycles.device = device
    saved = {o.name: list(o.data.materials) for o in objs}
    for o in objs:
        o.data.materials.clear()
        o.data.materials.append(mat)
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
    """position (encoded 0..1 in bmin/bsize), normal, tangent, object id, coverage"""
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
        geo = nt.nodes.new("ShaderNodeNewGeometry")
        return encode(nt, geo.outputs["Normal"])

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

    # object id: one bake per object into the same image, colour = id
    img = _float_image("bake_id", size)
    ident = np.zeros((size, size), dtype=np.int32)
    for k, o in enumerate(objs):
        def build_id(nt, k=k):
            rgb = nt.nodes.new("ShaderNodeRGB")
            rgb.outputs[0].default_value = (1.0, 1.0, 1.0, 1.0)
            return _emission(nt, rgb.outputs[0])
        mat = _bake_material("bake_id_mat", img, build_id)
        _bake([o], mat, "EMIT")
        px = _read(img)
        ident[(px[..., 0] > 0.5) & (px[..., 3] > 0.5)] = k + 1
        bpy.data.materials.remove(mat)
    maps["id"] = ident
    return maps


def dilate(arr, mask, levels=None):
    """pull-push fill: empty texels get a smooth blend of the nearest covered
    ones, so mips and bilinear filtering never pull black into the islands"""
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
    # normalized colour per level, then push the coarse colour into empty texels
    filled = vals[-1] / np.maximum(wts[-1], 1e-6)[..., None]
    for k in range(len(vals) - 2, -1, -1):
        up = np.repeat(np.repeat(filled, 2, axis=0), 2, axis=1)
        cur = vals[k] / np.maximum(wts[k], 1e-6)[..., None]
        has = (wts[k] > 0)[..., None]
        filled = np.where(has, cur, up)
    out = np.where(m[..., None] > 0, a, filled)
    return out[..., 0] if flat else out


# ---------------------------------------------------------------- glove
GLOVE_BLACK = srgb((0.125, 0.13, 0.135))
GLOVE_CUFF = srgb((0.11, 0.115, 0.12))
PALM_GREY = srgb((0.35, 0.355, 0.36))
PAD_GREY = srgb((0.3, 0.305, 0.31))
PATCH_GREY = srgb((0.24, 0.245, 0.25))
STRAP_BLACK = srgb((0.165, 0.17, 0.175))
TAB_RUBBER = srgb((0.085, 0.085, 0.09))
THREAD_DARK = srgb((0.17, 0.17, 0.175))
THREAD_LIGHT = srgb((0.27, 0.275, 0.28))


class GloveGeo:
    """surface coordinates of glove texels (hand frame, cm)"""

    def __init__(self, shape):
        self.shape = shape
        self.fingers = {}
        for name in P.FINGER_ORDER:
            pts, axis = P.finger_chain(name)
            dors = []
            for i in range(3):
                u = P.normalize(pts[i + 1] - pts[i])
                dors.append(P.normalize(np.cross(u, axis)))
            self.fingers[name] = dict(pts=pts, dors=dors, axis=axis, radii=P.finger_radii(name))
        tpts, tpads, taxis = P.thumb_chain()
        self.thumb = dict(pts=tpts, dors=[-np.asarray(x) for x in tpads], axis=taxis, radii=list(P.THUMB["r"]))

    @staticmethod
    def chain_coords(p, pts, dors, radii):
        """closest point on the chain: arc length t, cos to the dorsal dir,
        signed side (along the flex axis), local radius"""
        best = np.full(len(p), np.inf)
        t_out = np.zeros(len(p))
        c_out = np.zeros(len(p))
        s_out = np.zeros(len(p))
        r_out = np.zeros(len(p))
        acc = 0.0
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            ab = b - a
            L = float(np.linalg.norm(ab))
            u = ab / L
            raw = ((p - a) @ ab) / (L * L)
            lo = -np.inf if i == 0 else 0.0
            hi = np.inf if i == len(pts) - 2 else 1.0
            t = np.clip(raw, lo, hi)
            q = a + np.outer(np.clip(t, 0, 1), ab)
            rel = p - q
            d = np.linalg.norm(rel, axis=1)
            better = d < best - 1e-9
            dirn = rel / np.maximum(d, 1e-9)[:, None]
            side_axis = np.cross(dors[i], u)
            best = np.where(better, d, best)
            t_out = np.where(better, acc + t * L, t_out)
            c_out = np.where(better, dirn @ dors[i], c_out)
            s_out = np.where(better, dirn @ side_axis, s_out)
            r_out = np.where(better, radii[i] + (radii[i + 1] - radii[i]) * np.clip(t, 0, 1), r_out)
            acc += L
        return t_out, c_out, s_out, r_out, acc

    def context(self, p):
        sh = self.shape
        _, parts = sh.glove_fields(p, want_parts=True)
        names = list(parts.keys())
        D = np.stack([parts[n] for n in names], axis=1)
        D = D - D.min(axis=1, keepdims=True)
        Wt = np.exp(-D / 0.22)
        Wt /= Wt.sum(axis=1, keepdims=True)
        w = {n: Wt[:, i] for i, n in enumerate(names)}
        ctx = {"w": w, "p": p}
        x, y, z = p[:, 0], p[:, 1], p[:, 2]
        top, bot = sh.palm_top(x, y), sh.palm_bot(x, y)
        half = np.maximum((top - bot) * 0.5, 0.5)
        c_palm = np.clip((z - (top + bot) * 0.5) / half, -1, 1)
        c = w["palm"] * c_palm
        scale = w["palm"] * half
        along = w["palm"] * y
        dom = np.argmax(Wt, axis=1)
        fing = {}
        for n in P.FINGER_ORDER:
            f = self.fingers[n]
            t, cf, sf, rf, L = self.chain_coords(p, f["pts"], f["dors"], f["radii"])
            fing[n] = dict(t=t, c=cf, side=sf, r=rf, L=L)
            c = c + w[n] * cf
            scale = scale + w[n] * rf
        th = self.thumb
        t, cf, sf, rf, L = self.chain_coords(p, th["pts"], th["dors"], th["radii"])
        fing["thumb"] = dict(t=t, c=cf, side=sf, r=rf, L=L)
        c = c + w["thumb"] * cf
        scale = scale + w["thumb"] * rf
        # thenar: palm side of the thumb metacarpal
        c = c + w["thenar"] * np.minimum(cf, -0.2)
        scale = scale + w["thenar"] * 1.3
        c = c + w["cuff"] * 1.0
        scale = scale + w["cuff"] * 1.0
        ctx.update(c=c, scale=scale, fing=fing, dom=dom, names=names)
        ctx["seam"] = c * scale  # signed geodesic-ish distance to the side seam, <0 on the palm
        # along coordinate for seam stitches from the dominant part
        along_parts = {"palm": y, "thenar": fing["thumb"]["t"], "cuff": y, "thumb": fing["thumb"]["t"]}
        for n in P.FINGER_ORDER:
            along_parts[n] = fing[n]["t"]
        al = np.zeros(len(p))
        for i, n in enumerate(names):
            al = np.where(dom == i, along_parts[n], al)
        ctx["along"] = al
        # pads, cuff and strap coordinates
        ctx["kfoot"] = sh.knuckle_pad_foot(p)
        ctx["kpar"] = self._polyline_param(p, sh.knuckle_line)
        ctx["dorsal"] = z
        ffoot = np.full(len(p), 1e3)
        for n in P.FINGER_ORDER:
            ffoot = np.minimum(ffoot, sh.finger_pad_foot(p, n))
        ctx["ffoot"] = ffoot
        theta = np.mod(sh.cuff_angle(p) + 2 * math.pi, 2 * math.pi)
        ctx["theta"] = theta
        d_rad = sh.sd_cuff_radial(p)
        _, foot = sh.sd_strap(p, d_rad)
        ctx["strap_foot"] = foot
        t0, t1 = sh.STRAP_THETA
        ctx["strap_u"] = (theta - (t0 + t1) * 0.5) * 2.95
        ctx["strap_hu"] = (t1 - t0) * 0.5 * 2.95
        return ctx

    @staticmethod
    def _polyline_param(p, pts2):
        x, y = p[:, 0], p[:, 1]
        best = np.full(len(p), np.inf)
        par = np.zeros(len(p))
        acc = 0.0
        for i in range(len(pts2) - 1):
            ax, ay = pts2[i]
            bx, by = pts2[i + 1]
            ex, ey = bx - ax, by - ay
            L = math.hypot(ex, ey)
            t = np.clip(((x - ax) * ex + (y - ay) * ey) / (L * L), -0.6 if i == 0 else 0.0, 1.6 if i == len(pts2) - 2 else 1.0)
            dx, dy = x - (ax + ex * t), y - (ay + ey * t)
            d = np.sqrt(dx * dx + dy * dy)
            better = d < best
            best = np.where(better, d, best)
            par = np.where(better, acc + t * L, par)
            acc += L
        return par


def glove_surface(geo, p, want_color=True):
    ctx = geo.context(p)
    w = ctx["w"]
    x, y, z = p[:, 0], p[:, 1], p[:, 2]
    n = len(p)
    h = np.zeros(n)
    seam = ctx["seam"]
    along = ctx["along"]
    cuff = smoothstep(0.35, -0.05, y)  # 1 on the cuff panel
    hand = 1.0 - cuff

    # ---- panels
    palm_side = smoothstep(0.03, -0.03, seam) * hand
    kfoot = ctx["kfoot"]
    kpad = smoothstep(0.02, -0.02, kfoot) * smoothstep(0.1, 0.5, z) * hand
    fpad = smoothstep(0.02, -0.02, ctx["ffoot"]) * hand * (1 - kpad)
    # fingertip caps, curved on the back of the finger
    tipcap = np.zeros(n)
    tip_t = np.zeros(n)
    for name in P.FINGER_ORDER + ("thumb",):
        f = ctx["fing"][name]
        cap_len = 1.35 if name != "thumb" else 1.45
        tb = f["L"] - cap_len - 0.3 * (1 - f["c"])
        wpart = w[name]
        tipcap = np.maximum(tipcap, smoothstep(-0.02, 0.02, f["t"] - tb) * wpart)
        tip_t = np.where(wpart > 0.5, f["t"] - tb, tip_t)
    tipcap = tipcap * hand
    # palm reinforcement patches (palm side, projected from above)
    heel_poly = [(-0.6, 0.9), (3.6, 0.7), (4.9, 3.2), (5.25, 6.6), (3.3, 7.3), (0.9, 5.9), (-0.9, 3.1)]
    saddle_poly = [(-4.8, 5.2), (-2.9, 5.9), (-1.7, 8.4), (-2.3, 10.2), (-3.7, 9.9), (-5.4, 7.9)]
    d_heel = sdf.sd_polygon2(x, y, heel_poly)
    d_sad = sdf.sd_polygon2(x, y, saddle_poly)
    patch = np.maximum(smoothstep(0.02, -0.02, d_heel), smoothstep(0.02, -0.02, d_sad)) * smoothstep(0.1, -0.3, seam) * hand
    d_patch = np.minimum(d_heel, d_sad)
    # velcro strap on the cuff and its rubber tab
    sfoot = ctx["strap_foot"]
    strap = smoothstep(0.02, -0.02, sfoot) * smoothstep(-P.CUFF_END_S + 0.1, -P.CUFF_END_S + 0.35, y)
    su = ctx["strap_u"]
    hu = ctx["strap_hu"]
    yc = -2.225
    tab_q = np.maximum(np.abs(su - (hu - 1.15)) - 0.75, np.abs(y - yc) - 0.78)
    tab = smoothstep(0.02, -0.02, tab_q) * strap

    # ---- heights (cm)
    # side seam groove with puckered edges, stitches on the palm panel side
    sd = np.abs(seam)
    h += (-0.03 * line(sd, 0.035) + 0.01 * line(sd - 0.08, 0.04)) * hand
    st_side, _ = stitch(seam, -0.13, along)
    st_mask = st_side * hand * (1 - kpad)
    # wrist seam and cuff hem
    dw = y - 0.12
    h += -0.03 * line(dw, 0.035)
    st_w, _ = stitch(y, 0.02, ctx["theta"] * 2.9)
    st_mask = np.maximum(st_mask, st_w * cuff)
    dh = y + P.CUFF_END_S - 0.3
    st_hem1, _ = stitch(y, -P.CUFF_END_S + 0.22, ctx["theta"] * 2.9)
    st_hem2, _ = stitch(y, -P.CUFF_END_S + 0.38, ctx["theta"] * 2.9 + 0.14)
    st_mask = np.maximum(st_mask, np.maximum(st_hem1, st_hem2) * (1 - strap))
    h += -0.012 * line(dh, 0.05) * (1 - strap)
    # knuckle guard: border stitch, quilting grooves between the knuckles
    kb = smoothstep(0.1, 0.5, z) * hand
    h += -0.03 * line(kfoot, 0.03) * kb
    st_k, _ = stitch(kfoot, -0.15, ctx["kpar"] * 1.0)
    st_mask = np.maximum(st_mask, st_k * kb)
    groove = np.zeros(n)
    kl = geo.shape.knuckle_line
    seglen = [math.hypot(*(kl[i + 1] - kl[i])) for i in range(len(kl) - 1)]
    acc = 0.0
    for L in seglen:
        mid = acc + L * 0.5
        groove = np.maximum(groove, line(ctx["kpar"] - mid, 0.05))
        acc += L
    groove = np.maximum(groove, line(kfoot + 0.55, 0.035) * 0.8)
    h += -0.035 * groove * kpad
    # finger pads
    h += -0.025 * line(ctx["ffoot"], 0.03) * hand
    st_f, _ = stitch(ctx["ffoot"], -0.12, (y + x) * 1.0)
    st_mask = np.maximum(st_mask, st_f * hand * (1 - kpad))
    h += -0.02 * line(ctx["ffoot"] + 0.38, 0.03) * fpad
    # fingertip cap seam on the back, stitched
    h += -0.025 * line(tip_t, 0.03) * hand * smoothstep(-0.4, 0.1, seam)
    st_t, _ = stitch(tip_t, 0.12, ctx["seam"] * 1.0 + x * 0.3)
    st_mask = np.maximum(st_mask, st_t * hand * smoothstep(-0.3, 0.2, seam))
    # palm patches: raised with a stitched border
    h += 0.02 * patch - 0.02 * line(d_patch, 0.03) * smoothstep(0.1, -0.3, seam) * hand
    st_p, _ = stitch(d_patch, -0.13, (x - y) * 1.0)
    st_mask = np.maximum(st_mask, st_p * smoothstep(0.1, -0.3, seam) * hand)
    # strap: raised border stitch and ridged rubber tab
    st_s, _ = stitch(sfoot, -0.15, su + y)
    st_mask = np.maximum(st_mask, st_s * strap * (1 - tab))
    h += 0.025 * tab + 0.008 * np.sin(su * 2 * math.pi / 0.13) * tab
    h += -0.02 * line(sfoot, 0.03) * smoothstep(-3.9, -3.6, y)

    # joint wrinkles on the back of the fingers, flex creases on the palm side
    wr = np.zeros(n)
    for name in P.FINGER_ORDER + ("thumb",):
        f = ctx["fing"][name]
        if name == "thumb":
            L = [np.linalg.norm(geo.thumb["pts"][i + 1] - geo.thumb["pts"][i]) for i in range(3)]
        else:
            L = [np.linalg.norm(geo.fingers[name]["pts"][i + 1] - geo.fingers[name]["pts"][i]) for i in range(3)]
        joints = [L[0], L[0] + L[1]]
        wp = w[name] * hand
        dors = smoothstep(0.05, 0.5, f["c"])
        palm_c = smoothstep(-0.1, -0.5, f["c"])
        bend = 0.12 * (1 - f["c"])
        for tj in joints:
            for off, depth in ((-0.24, 0.6), (-0.06, 1.0), (0.14, 0.8), (0.32, 0.45)):
                wr += depth * line(f["t"] - tj - off - bend, 0.03) * dors * wp
            wr += 1.3 * line(f["t"] - tj, 0.035) * palm_c * wp
        # crease where the finger meets the palm
        wr += 1.1 * line(f["t"] - 0.95, 0.04) * palm_c * wp * (0.0 if name == "thumb" else 1.0)
    h += -0.02 * wr
    # palm creases through the leather
    creases = [
        [(-3.0, 9.35), (-1.0, 8.9), (1.5, 8.45), (3.5, 8.15), (5.3, 7.95)],
        [(-3.5, 7.3), (-1.2, 7.35), (1.6, 6.7), (4.0, 5.7)],
        [(-2.3, 8.3), (-1.4, 6.1), (-0.9, 3.6), (-0.7, 1.3)],
    ]
    cr = np.zeros(n)
    for pl in creases:
        d = np.full(n, 1e3)
        for (ax, ay), (bx, by) in zip(pl[:-1], pl[1:]):
            ex, ey = bx - ax, by - ay
            t = np.clip(((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey), 0, 1)
            d = np.minimum(d, np.hypot(x - ax - ex * t, y - ay - ey * t))
        cr = np.maximum(cr, line(d, 0.05))
    h += -0.02 * cr * palm_side * (1 - patch * 0.5)
    # compression wrinkles on the back of the hand above the wrist seam
    dorsal_hand = smoothstep(0.2, 0.6, ctx["c"]) * hand * (1 - kpad)
    wob = 0.18 * np.sin(x * 1.3 + 0.7) + 0.08 * np.sin(x * 3.1)
    for yc_, a_ in ((0.75, 1.0), (1.35, 0.8), (2.05, 0.55)):
        h += -0.016 * a_ * line(y - yc_ - wob, 0.05) * dorsal_hand

    # micro texture: pebbled leather on grey panels, knit wales on the back fabric
    grey = np.clip(palm_side + kpad + fpad + tipcap + patch, 0, 1)
    if want_color:
        pebble = value_noise(p, 0.07, seed=3)
    else:
        pebble = value_noise(p, 0.07, seed=3)
    h += 0.004 * (smoothstep(0.35, 0.75, pebble) - 0.5) * grey
    knit = np.sin((x * 0.8 + z * 0.6) * 2 * math.pi / 0.11) * 0.5 + np.sin(y * 2 * math.pi / 0.16) * 0.5
    fabric = (1 - grey) * (1 - strap)
    h += 0.0025 * knit * fabric
    h += 0.006 * (fbm(p, 0.6, 3, seed=5) - 0.5) * fabric
    # stitch threads sit proud of the fabric
    h += 0.011 * st_mask

    if not want_color:
        return h

    # ---- colour and roughness
    col = np.tile(GLOVE_BLACK, (n, 1))
    col = col * (1 - cuff)[:, None] + GLOVE_CUFF * cuff[:, None]
    col = col * (1 - palm_side)[:, None] + PALM_GREY * palm_side[:, None]
    col = col * (1 - tipcap)[:, None] + PALM_GREY * tipcap[:, None]
    col = col * (1 - patch)[:, None] + PATCH_GREY * patch[:, None]
    col = col * (1 - kpad)[:, None] + PAD_GREY * kpad[:, None]
    col = col * (1 - fpad)[:, None] + PAD_GREY * fpad[:, None]
    col = col * (1 - strap)[:, None] + STRAP_BLACK * strap[:, None]
    col = col * (1 - tab)[:, None] + TAB_RUBBER * tab[:, None]
    thread = np.where(grey[:, None] > 0.5, THREAD_DARK, THREAD_LIGHT)
    col = col * (1 - st_mask)[:, None] + thread * st_mask[:, None]
    # slight wear: lighter on raised pads, dirt in grooves
    grime = fbm(p, 1.2, 3, seed=9)
    col *= (0.93 + 0.12 * grime)[:, None]
    col *= (1.0 - 0.35 * np.clip(-h * 25, 0, 1))[:, None]
    rough = 0.9 * fabric + 0.62 * grey + 0.7 * strap + 0.5 * tab
    rough = rough / np.maximum(fabric + grey + strap + tab, 1e-6)
    rough = np.clip(rough + 0.06 * (pebble - 0.5) + 0.1 * st_mask, 0.3, 1.0)
    return h, col, rough


# ---------------------------------------------------------------- skin
SKIN_BASE = srgb((0.78, 0.59, 0.48))
SKIN_INNER = srgb((0.84, 0.66, 0.56))


def skin_surface(p, want_color=True):
    s = -p[:, 1]
    half_w, top, bot, n_ = P.forearm_section(s)
    cz = (top + bot) * 0.5
    theta = np.arctan2(p[:, 2] - cz, p[:, 0])
    dorsal = np.sin(theta)
    h = np.zeros(len(p))
    # pores and fine skin lines
    h += 0.003 * (value_noise(p, 0.05, seed=21) - 0.5)
    h += 0.004 * (fbm(p, 0.35, 3, seed=22) - 0.5)
    lines_ = np.sin((p[:, 0] * 0.7 + p[:, 1] * 0.3 + p[:, 2] * 0.64) * 2 * math.pi / 0.09)
    h += 0.0015 * lines_
    # a few veins on the back and thumb side of the forearm
    veins = np.zeros(len(p))
    for th0, drift, wob, w in ((1.35, 0.018, 0.12, 0.09), (2.2, -0.012, 0.1, 0.075), (0.75, 0.01, 0.09, 0.06)):
        path = th0 + drift * s + wob * np.sin(s * 0.55 + th0 * 3.0)
        dth = np.mod(theta - path + math.pi, 2 * math.pi) - math.pi
        r = half_w * 0.9
        veins = np.maximum(veins, line(dth * r, w) * smoothstep(1.0, 3.5, s) * (1 - smoothstep(12.0, 15.0, s)))
    h += 0.018 * veins
    if not want_color:
        return h
    t = smoothstep(-0.2, 0.9, -dorsal)
    col = SKIN_BASE * (1 - t)[:, None] + SKIN_INNER * t[:, None]
    mottling = fbm(p, 1.6, 4, seed=23)
    col *= (0.92 + 0.14 * mottling)[:, None]
    red = fbm(p, 2.5, 3, seed=24)
    col = col * np.stack([1.0 + 0.05 * red, 1.0 - 0.02 * red, 1.0 - 0.03 * red], axis=1)
    vein_tint = np.array([0.82, 0.86, 0.95])
    col = col * (1 - 0.35 * veins[:, None]) + col * vein_tint * 0.35 * veins[:, None]
    # arm hair reads as a faint darker, less shiny haze on the back of the forearm
    hair = fbm(np.stack([p[:, 0] * 2.5, p[:, 1] * 0.8, p[:, 2] * 2.5], axis=1), 0.5, 3, seed=25)
    hair = smoothstep(0.35, 0.75, hair) * smoothstep(0.0, 0.7, dorsal) * smoothstep(1.5, 4.0, s)
    col *= (1.0 - 0.07 * hair)[:, None]
    freckle = smoothstep(0.83, 0.9, value_noise(p, 0.12, seed=26))
    col *= (1.0 - 0.18 * freckle)[:, None]
    rough = 0.52 + 0.1 * (fbm(p, 0.8, 3, seed=27) - 0.5) + 0.08 * hair
    return h, col, rough


# ---------------------------------------------------------------- sleeve
SLEEVE_BASE = srgb((0.33, 0.35, 0.25))
SLEEVE_DARK = srgb((0.27, 0.29, 0.2))
THREAD_OLIVE = srgb((0.27, 0.285, 0.2))


def sleeve_surface(p, want_color=True):
    s = -p[:, 1]
    half_w, top, bot, n_ = A.core_section(s)
    cz = (top + bot) * 0.5
    theta = np.arctan2(p[:, 2] - cz, p[:, 0])
    circ_r = half_w * 1.15
    h = np.zeros(len(p))
    hem = P.SLEEVE_HEM_S
    # hem: two stitch rows and the fold line of the turned edge
    ahem = theta * circ_r
    st1, _ = stitch(s, hem + 0.55, ahem, period=0.33, width=0.03)
    st2, _ = stitch(s, hem + 0.85, ahem + 0.15, period=0.33, width=0.03)
    stitches = np.maximum(st1, st2)
    h += 0.008 * stitches
    h += -0.02 * line(s - (hem + 1.15), 0.05)
    # underarm seam along the palm side of the sleeve
    dseam = (np.mod(theta + 0.5 * math.pi + math.pi, 2 * math.pi) - math.pi) * circ_r
    h += -0.03 * line(dseam, 0.04) + 0.012 * line(np.abs(dseam) - 0.1, 0.05)
    st3, _ = stitch(dseam, 0.28, s, period=0.33, width=0.03)
    st4, _ = stitch(dseam, -0.28, s + 0.1, period=0.33, width=0.03)
    stitches = np.maximum(stitches, np.maximum(st3, st4) * smoothstep(hem + 1.3, hem + 1.8, s))
    h += 0.008 * np.maximum(st3, st4)
    # fine crinkles where the fabric bunches, following the folds
    bunch = smoothstep(hem + 1.0, hem + 2.0, s) * (1 - smoothstep(24.0, 28.0, s))
    crinkle = np.abs(fbm(np.stack([theta * 3.0, s * 0.9, np.zeros_like(s)], axis=1), 0.8, 3, seed=31) - 0.5)
    h += -0.02 * (0.5 - crinkle) * bunch
    # soft shell face: faint texture
    h += 0.003 * (value_noise(p, 0.06, seed=32) - 0.5)
    h += 0.004 * (fbm(p, 0.5, 3, seed=33) - 0.5)
    if not want_color:
        return h
    var = fbm(p, 2.0, 4, seed=34)
    col = SLEEVE_BASE * (0.9 + 0.18 * var)[:, None]
    col = col * (1 - stitches)[:, None] + THREAD_OLIVE * stitches[:, None]
    rough = 0.82 + 0.08 * (var - 0.5)
    return h, col, rough


def sleeve_analytic_normal(p, n_geom):
    """normal of the exact folded sleeve surface, so folds shade crisply even
    where the ring spacing of the mesh is coarse. the rolled hem keeps the
    mesh normal."""
    s = -p[:, 1]
    half_w, top, bot, n_ = A.core_section(s)
    theta = np.arctan2(p[:, 2] - (top + bot) * 0.5, p[:, 0])
    e = 0.004
    pa = np.stack(A.sleeve_outer_point(theta + e, s), axis=1)
    pb = np.stack(A.sleeve_outer_point(theta - e, s), axis=1)
    pc = np.stack(A.sleeve_outer_point(theta, s + 0.02), axis=1)
    pd = np.stack(A.sleeve_outer_point(theta, s - 0.02), axis=1)
    nn = np.cross(pa - pb, pc - pd)
    nn /= np.maximum(np.linalg.norm(nn, axis=1, keepdims=True), 1e-9)
    nn *= np.sign(np.sum(nn * n_geom, axis=1, keepdims=True) + 1e-9)
    w = smoothstep(A.SLEEVE_OUTER_START + 0.05, A.SLEEVE_OUTER_START + 0.4, s)[:, None]
    out = n_geom * (1 - w) + nn * w
    return out / np.maximum(np.linalg.norm(out, axis=1, keepdims=True), 1e-9)


# ---------------------------------------------------------------- assembly
def build_arm_textures(glove, skin, sleeve, shape, size, log):
    objs = [glove, skin, sleeve]
    os.makedirs(TEX_DIR, exist_ok=True)
    allco = []
    for o in objs:
        co = np.zeros(len(o.data.vertices) * 3)
        o.data.vertices.foreach_get("co", co)
        allco.append(co.reshape(-1, 3))
    allco = np.concatenate(allco)
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
    albedo = np.zeros(cover.shape + (3,))
    rough = np.full(cover.shape, 0.8)
    n_obj = np.zeros(cover.shape + (3,))
    eps = 0.012  # cm, finite difference step for the height gradient

    for k, fn in ((1, "glove"), (2, "skin"), (3, "sleeve")):
        sel = ident == k
        if not sel.any():
            continue
        p = (pos[sel] - P.WRIST_R) / P.CM
        n0 = nrm[sel]
        n0 /= np.maximum(np.linalg.norm(n0, axis=1, keepdims=True), 1e-9)
        if fn == "glove":
            geo = GloveGeo(shape)
            p = sdf.project_to_surface(shape.sdf, p, eps=0.01, iterations=2)
            g = sdf.gradient(shape.sdf, p, 0.01)
            n_base = g / np.maximum(np.linalg.norm(g, axis=1, keepdims=True), 1e-9)
            surf = lambda q, col=True: glove_surface(geo, q, col)
        elif fn == "skin":
            n_base = n0
            surf = skin_surface
        else:
            n_base = sleeve_analytic_normal(p, n0)
            surf = sleeve_surface
        h, col, rgh = surf(p, True)
        # tangent frame around the base normal
        t0 = tan[sel]
        t0 = t0 - n_base * np.sum(t0 * n_base, axis=1, keepdims=True)
        t0 /= np.maximum(np.linalg.norm(t0, axis=1, keepdims=True), 1e-9)
        b0 = np.cross(n_base, t0)
        hp = surf(p + t0 * eps, False)
        hm = surf(p - t0 * eps, False)
        dh_t = (hp - hm) / (2 * eps)
        hp = surf(p + b0 * eps, False)
        hm = surf(p - b0 * eps, False)
        dh_b = (hp - hm) / (2 * eps)
        nn = n_base - t0 * dh_t[:, None] - b0 * dh_b[:, None]
        nn /= np.linalg.norm(nn, axis=1, keepdims=True)
        n_obj[sel] = nn
        height[sel] = h
        albedo[sel] = col
        rough[sel] = rgh
        log(f"textured {fn}: {sel.sum()} texels")

    # object space normal -> tangent space through cycles (mikktspace exact)
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

    # ambient occlusion of the arm pieces on each other
    aimg = _float_image("bake_ao", size)
    world = bpy.context.scene.world or bpy.data.worlds.new("BakeWorld")
    bpy.context.scene.world = world
    world.light_settings.distance = 0.035
    mat = _bake_material("bake_ao_mat", aimg, lambda nt: nt.nodes.new("ShaderNodeBsdfDiffuse").outputs["BSDF"])
    # cpu: the metal ao bake is not bit exact from run to run, this keeps
    # rebuilds byte identical
    _bake(objs, mat, "AO", samples=96, device="CPU")
    ao = _read(aimg)[..., 0]
    bpy.data.materials.remove(mat)
    log("baked ambient occlusion")
    cavity = np.clip(1.0 + height * 18.0, 0.55, 1.0)
    ao = np.clip(ao, 0.0, 1.0) * cavity

    # images (bottom row first, like blender pixels)
    base = np.ones(cover.shape + (4,), dtype=np.float32)
    base[..., :3] = dilate(albedo * (0.72 + 0.28 * ao)[..., None], cover)
    orm = np.ones(cover.shape + (4,), dtype=np.float32)
    orm[..., 0] = dilate(ao, cover)
    orm[..., 1] = dilate(rough, cover)
    orm[..., 2] = 0.0
    nmap = np.ones(cover.shape + (4,), dtype=np.float32)
    nmap[..., :3] = dilate(ntan, cover)

    base_img = _byte_image("arms_basecolor", base, "sRGB")
    orm_img = _byte_image("arms_orm", orm, "Non-Color")
    n_img = _byte_image("arms_normal", nmap, "Non-Color")
    for img in (nimg, timg, aimg):
        bpy.data.images.remove(img)
    for key in ("pos", "nrm", "tan", "id"):
        im = bpy.data.images.get(f"bake_{key}")
        if im is not None:
            bpy.data.images.remove(im)
    # one atlas for all three; the normal strengths differ a little, which
    # also keeps the optimizer's dedup from folding them into one material
    mats = {
        "mat_glove": MAT.textured("mat_glove", base_img, orm_img, n_img, normal_strength=1.0),
        "mat_skin": MAT.textured("mat_skin", base_img, orm_img, n_img, normal_strength=0.85),
        "mat_sleeve": MAT.textured("mat_sleeve", base_img, orm_img, n_img, normal_strength=1.1),
    }
    return mats


def _byte_image(name, rgba_linear, colorspace):
    h, w = rgba_linear.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=False, float_buffer=False)
    img.colorspace_settings.name = colorspace
    data = np.clip(rgba_linear, 0, 1).astype(np.float64)
    if colorspace == "sRGB":
        c = data[..., :3]
        data[..., :3] = np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)
    data[..., 3] = 1.0
    img.pixels.foreach_set(data.astype(np.float32).ravel())
    img.filepath_raw = os.path.join(TEX_DIR, f"{name}.png")
    img.file_format = "PNG"
    img.save()
    return img
