"""texture atlases for the whole-body skins (system python 3 with pillow + numpy).

  python3 tools/characters/skin_textures.py <skin id> [--stats]

reads the atlas plan build_skins.py wrote (.blender-tmp/characters/skins/<id>_atlas.json)
and the source glb's textures, and fills every material's cell:

  <id>_color.png   srgb albedo (texture x base colour factor)
  <id>_normal.png  tangent space normals
  <id>_data.png    r glow (emission strength), g roughness, b metalness (three's channels)
  <id>_mask.png    r primary paint, g secondary paint, b accent paint

the paint masks pick the skin's colour zones (PAINT below): the main plates,
the second colour and the small coloured details, so a player's colours land
there while lights, decals and the rest keep the artist's colours. each zone's
mean colour and luminance go to <id>_paint.json (catalog.ts SKIN_INFO).
--stats prints the main albedo clusters to choose the zones.
"""

import io
import json
import os
import struct
import sys

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
TMP = os.path.join(ROOT, ".blender-tmp", "characters", "skins")
SRC = os.path.join(os.path.expanduser(os.environ.get("WEBSTRAFE_ASSETS", "~/Assets/webstrafe")), "sketchfab")

# per skin: materials that glow whole, and the paint zones. a zone takes the
# pixels of its materials inside a lightness band (cie L) that are either
# near grey (chroma under `grey`) or near a hue (`ab` with `reach`), soft edged
ARMOR = ["head", "torss", "material_6", "material_4", "material", "material_7"]
PAINT = {
    "ronin": {
        "glow": [],
        "zones": [
            # gunmetal plates
            {"channel": 0, "materials": ARMOR, "L": (22, 101), "grey": 9},
            # the near black undersuit and joints
            {"channel": 1, "materials": ARMOR, "L": (-1, 22), "grey": 9},
            # ochre straps, olive cloth and the red markings
            {"channel": 2, "materials": ARMOR, "L": (-1, 101), "chroma": 12},
        ],
    },
    "sentinel": {
        "glow": ["Glow"],
        # the source leans on KHR_materials_specular to keep its shell from going
        # chrome; without it, less metal gives the same white plastic and rubber gloves
        "metal": {"Secondary": 0.3, "Head": 0.35, "Body": 0.6},
        # rubbery gloves: the grunge in their normals caught the sky in blotches up close
        "rough": {"Head": 1.4},
        # and that grunge is far deeper than the other materials' (mean tilt 0.5 vs 0.2),
        # it read as camo on the first-person gloves
        "normal": {"Head": 0.35, "Body": 0.45},
        "zones": [
            # white plates
            {"channel": 0, "materials": ["Secondary", "Body"], "L": (44, 101), "grey": 8},
            # the teal helmet and gloves
            {"channel": 1, "materials": ["Head"], "L": (-1, 101), "ab": (-22, -16), "reach": 18},
            # the dark undersuit (its orange piping and the shell's stripes keep their colours)
            {"channel": 2, "materials": ["Body", "Secondary"], "L": (-1, 40), "grey": 14},
        ],
    },
}


def read_glb(path):
    data = open(path, "rb").read()
    n = struct.unpack("<I", data[12:16])[0]
    gltf = json.loads(data[20:20 + n])
    rest = data[20 + n:]
    bn = struct.unpack("<I", rest[0:4])[0]
    binary = rest[8:8 + bn]
    return gltf, binary


def load_image(gltf, binary, tex_index):
    tex = gltf["textures"][tex_index]
    src = tex.get("source")
    if src is None:
        for ext in tex.get("extensions", {}).values():
            src = ext.get("source", src)
    img = gltf["images"][src]
    view = gltf["bufferViews"][img["bufferView"]]
    start = view.get("byteOffset", 0)
    return Image.open(io.BytesIO(binary[start:start + view["byteLength"]]))


def to_linear(c):
    c = np.asarray(c, dtype=np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def to_srgb(c):
    c = np.clip(np.asarray(c, dtype=np.float32), 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def lab(srgb):
    """srgb (0..1) -> cie lab, d65"""
    rgb = to_linear(srgb)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]], dtype=np.float32)
    xyz = rgb @ M.T / np.array([0.95047, 1.0, 1.08883], dtype=np.float32)
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], axis=-1)


def material_maps(gltf, binary, mat, size):
    """albedo (srgb rgb), normal (rgb), rough, metal, glow at size x size, all float 0..1"""
    pbr = mat.get("pbrMetallicRoughness", {})

    def tex(info, mode):
        if not info:
            return None
        im = load_image(gltf, binary, info["index"]).convert(mode)
        return np.asarray(im.resize((size, size), Image.LANCZOS), dtype=np.float32) / 255.0

    base = tex(pbr.get("baseColorTexture"), "RGB")
    factor = np.array(pbr.get("baseColorFactor", [1, 1, 1, 1])[:3], dtype=np.float32)
    if base is None:
        albedo = np.broadcast_to(to_srgb(factor), (size, size, 3)).copy()
    else:
        albedo = to_srgb(to_linear(base) * factor)
    mr = tex(pbr.get("metallicRoughnessTexture"), "RGB")
    rf = pbr.get("roughnessFactor", 1.0)
    mf = pbr.get("metallicFactor", 1.0)
    rough = (mr[..., 1] if mr is not None else np.ones((size, size), np.float32)) * rf
    metal = (mr[..., 2] if mr is not None else np.ones((size, size), np.float32)) * mf
    normal = tex(mat.get("normalTexture"), "RGB")
    if normal is None:
        normal = np.broadcast_to(np.array([0.5, 0.5, 1.0], np.float32), (size, size, 3)).copy()
    em = tex(mat.get("emissiveTexture"), "RGB")
    ef = np.array(mat.get("emissiveFactor", [0, 0, 0]), dtype=np.float32)
    if em is None:
        emission = np.broadcast_to(ef, (size, size, 3)).copy()
    else:
        emission = to_linear(em) * ef
    return albedo, normal, rough, metal, emission


def place(atlas, img, x, y, size, pad):
    """img (inner size) into the cell with its border pixels repeated into the padding"""
    padded = np.pad(img, [(pad, pad), (pad, pad)] + [(0, 0)] * (img.ndim - 2), mode="edge")
    atlas[y:y + size, x:x + size] = padded


def build(skin_id, stats=False):
    plan = json.load(open(os.path.join(TMP, f"{skin_id}_atlas.json")))
    gltf, binary = read_glb(os.path.join(SRC, plan["source"]))
    mats = {m.get("name"): m for m in gltf["materials"]}
    N = plan["size"]
    color = np.zeros((N, N, 3), np.float32)
    normal = np.zeros((N, N, 3), np.float32)
    normal[...] = (0.5, 0.5, 1.0)
    data = np.zeros((N, N, 3), np.float32)
    used = np.zeros((N, N), bool)
    owner = np.full((N, N), "", dtype=object)
    glow_rgb = np.zeros(3)
    glow_w = 0.0
    cfg = PAINT.get(skin_id, {"glow": [], "zones": []})
    for cell in plan["cells"]:
        x, y, size = (int(v) for v in cell["rect"])
        pad = int(cell["pad"])
        inner = size - 2 * pad
        mat = mats[cell["material"]]
        albedo, nrm, rough, metal, emission = material_maps(gltf, binary, mat, inner)
        metal = metal * cfg.get("metal", {}).get(cell["material"], 1.0)
        rough = np.clip(rough * cfg.get("rough", {}).get(cell["material"], 1.0), 0, 1)
        flatten = cfg.get("normal", {}).get(cell["material"], 1.0)
        if flatten != 1.0:
            xy = (nrm[..., :2] - 0.5) * 2.0 * flatten
            z = np.sqrt(np.clip(1.0 - (xy ** 2).sum(axis=-1), 0, 1))
            nrm = np.concatenate([xy * 0.5 + 0.5, (z * 0.5 + 0.5)[..., None]], axis=-1)
        glow = emission.max(axis=-1)
        if cell["material"] in cfg["glow"]:
            glow = np.ones_like(glow)
            emission = to_linear(albedo)
        glow_rgb += (emission * glow[..., None]).reshape(-1, 3).sum(axis=0)
        glow_w += float(glow.sum())
        place(color, albedo, x, y, size, pad)
        place(normal, nrm, x, y, size, pad)
        place(data, np.stack([np.clip(glow, 0, 1), rough, metal], axis=-1), x, y, size, pad)
        used[y:y + size, x:x + size] = True
        owner[y:y + size, x:x + size] = cell["material"]

    if stats:
        cluster_stats(color, used, data[..., 0])

    mask = np.zeros((N, N, 3), np.float32)
    L = lab(color)
    chroma = np.hypot(L[..., 1], L[..., 2])

    def soft(x, lo, hi, edge):
        return np.clip((x - lo) / edge + 0.5, 0, 1) * np.clip((hi - x) / edge + 0.5, 0, 1)

    for zone in cfg["zones"]:
        w = soft(L[..., 0], zone["L"][0], zone["L"][1], 4.0)
        if "grey" in zone:
            w *= np.clip((zone["grey"] - chroma) / 4.0 + 0.5, 0, 1)
        if "ab" in zone:
            d = np.hypot(L[..., 1] - zone["ab"][0], L[..., 2] - zone["ab"][1])
            w *= np.clip((zone["reach"] - d) / 6.0 + 0.5, 0, 1)
        if "chroma" in zone:
            w *= np.clip((chroma - zone["chroma"]) / 4.0 + 0.5, 0, 1)
        w *= np.isin(owner, zone["materials"])
        # lights keep their colour
        w *= np.clip(1 - data[..., 0] * 4, 0, 1)
        c = zone["channel"]
        mask[..., c] = np.maximum(mask[..., c], w)
    # paint never sums past one
    total = mask.sum(axis=-1, keepdims=True)
    mask = np.where(total > 1, mask / np.maximum(total, 1e-6), mask)
    # soften the zone borders a touch so lower mips don't fringe
    m8 = Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0))

    os.makedirs(TMP, exist_ok=True)
    Image.fromarray((color * 255 + 0.5).astype(np.uint8)).save(os.path.join(TMP, f"{skin_id}_color.png"))
    Image.fromarray((normal * 255 + 0.5).astype(np.uint8)).save(os.path.join(TMP, f"{skin_id}_normal.png"))
    Image.fromarray((np.clip(data, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(TMP, f"{skin_id}_data.png"))
    m8.save(os.path.join(TMP, f"{skin_id}_mask.png"))
    glow_avg = to_srgb(glow_rgb / max(glow_w, 1e-6) / max((glow_rgb / max(glow_w, 1e-6)).max(), 1e-6))
    info = {
        "glow": "#" + "".join(f"{int(round(c * 255)):02x}" for c in glow_avg),
        "zones": [],
    }
    lum = to_linear(color) @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    for zone in cfg["zones"]:
        w = mask[..., zone["channel"]]
        mean = float((lum * w).sum() / max(w.sum(), 1e-6))
        mean_rgb = (to_linear(color) * w[..., None]).reshape(-1, 3).sum(axis=0) / max(w.sum(), 1e-6)
        info["zones"].append({
            "channel": zone["channel"],
            "mean": "#" + "".join(f"{int(round(c * 255)):02x}" for c in to_srgb(mean_rgb)),
            "luminance": round(mean, 5),
            "share": round(float(w[used].mean()), 4),
        })
    json.dump(info, open(os.path.join(TMP, f"{skin_id}_paint.json"), "w"), indent=1)
    print(f"[skin_textures] {skin_id}: {json.dumps(info)}")


def cluster_stats(color, used, glow, k=8, iters=12):
    rng = np.random.default_rng(1)
    px = color[used & (glow < 0.2)]
    sample = px[rng.choice(len(px), size=min(60000, len(px)), replace=False)]
    L = lab(sample)
    centers = L[rng.choice(len(L), size=k, replace=False)]
    for _ in range(iters):
        d = ((L[:, None, :] - centers[None]) ** 2).sum(-1)
        lbl = d.argmin(1)
        for i in range(k):
            if (lbl == i).any():
                centers[i] = L[lbl == i].mean(0)
    order = np.argsort(-np.bincount(lbl, minlength=k))
    for i in order:
        share = (lbl == i).mean()
        rgb = sample[lbl == i].mean(0)
        hexc = "#" + "".join(f"{int(round(c * 255)):02x}" for c in rgb)
        print(f"  cluster {hexc} share {share:.3f} lab {np.round(centers[i], 1).tolist()}")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    for sid in args:
        build(sid, stats="--stats" in sys.argv)
