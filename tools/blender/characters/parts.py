"""shared armor building blocks and the Part record every set module returns."""

import numpy as np

import csdf as S


class Part:
    """one mesh in the library.

    slot/set/name name it (`helmet.strafe.shell`), `sdf` is its shape in
    three.js space, `material` one of cbuild.SLOTS. skin with `bone` (rigid)
    or `weights` (callable co -> {bone: w}). `mirror` makes a right-side copy
    bound to the mirrored bone names. `tris` is the triangle budget per lod,
    `lods` which lods include it (small details drop out of lod 2).
    """

    def __init__(self, slot, set_id, name, sdf, material, bone=None, weights=None, voxel=0.0028,
                 tris=(900, 360, 120), lods=(0, 1, 2), mirror=False, symmetric=False, ao_extra=None):
        self.slot = slot
        self.set = set_id
        self.name = name
        self.sdf = sdf
        self.material = material
        self.bone = bone
        self.weights = weights
        self.voxel = voxel
        self.tris = tris
        self.lods = lods
        self.mirror = mirror
        self.symmetric = symmetric
        self.ao_extra = ao_extra


class Anchor:
    """a decal spot (emblem or callsign) on a chest piece, left side unless mirrored"""

    def __init__(self, set_id, kind, bone, position, normal, up, size):
        self.set = set_id
        self.kind = kind
        self.bone = bone
        self.position = np.asarray(position, dtype=np.float64)
        self.normal = S.normalize(normal)
        self.up = S.normalize(up)
        self.size = size


def mirror_bone(name):
    if name.endswith("_l"):
        return name[:-2] + "_r"
    if name.endswith("_r"):
        return name[:-2] + "_l"
    return name


class TaperTube(S.SDF):
    """tube along local y from y0 to y1 with elliptical cross sections (rx, rz)
    lerping from the start to the end, flat caps. first order distance."""

    def __init__(self, y0, y1, rx0, rz0, rx1, rz1, cx=0.0, cz=0.0):
        self.y0, self.y1 = float(y0), float(y1)
        self.r0 = np.array([rx0, rz0], dtype=np.float64)
        self.r1 = np.array([rx1, rz1], dtype=np.float64)
        self.cx, self.cz = float(cx), float(cz)
        m = max(rx0, rz0, rx1, rz1)
        self.lo = np.array([cx - m, min(y0, y1), cz - m])
        self.hi = np.array([cx + m, max(y0, y1), cz + m])

    def __call__(self, p):
        t = np.clip((p[:, 1] - self.y0) / (self.y1 - self.y0), 0.0, 1.0)
        rx = self.r0[0] + (self.r1[0] - self.r0[0]) * t
        rz = self.r0[1] + (self.r1[1] - self.r0[1]) * t
        x = (p[:, 0] - self.cx) / rx
        z = (p[:, 2] - self.cz) / rz
        k = np.sqrt(x * x + z * z)
        d2 = (k - 1.0) * np.minimum(rx, rz)
        mid = (self.y0 + self.y1) * 0.5
        half = abs(self.y1 - self.y0) * 0.5
        dy = np.abs(p[:, 1] - mid) - half
        wx = np.maximum(d2, 0.0)
        wy = np.maximum(dy, 0.0)
        return np.minimum(np.maximum(d2, dy), 0.0) + np.sqrt(wx * wx + wy * wy)


def plate(surface, thickness, region, round_k=0.004):
    """a plate that hugs `surface` (an offset body shape) cut to `region`"""
    return surface.shell(thickness).si(region, round_k)


def slab_y(y0, y1, lo=(-1, -1, -1), hi=(1, 1, 1)):
    """y0 <= y <= y1"""
    mid = (y0 + y1) * 0.5
    half = abs(y1 - y0) * 0.5
    return S.Fn(lambda p: np.abs(p[:, 1] - mid) - half, (lo[0], min(y0, y1), lo[2]), (hi[0], max(y0, y1), hi[2]))


def box_region(lo, hi, r=0.0):
    lo = np.asarray(lo, dtype=np.float64)
    hi = np.asarray(hi, dtype=np.float64)
    return S.Box((lo + hi) * 0.5, (hi - lo) * 0.5, r)
