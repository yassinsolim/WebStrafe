"""the undersuit body every character wears under its armor, plus the smooth
skin weights for it and for cloth.

proportions follow the runtime skeleton: about 1.8 m to the top of the head,
broad chest, long arms in the a-pose bind. hands and feet are left to the
arms and legs pieces (gloves, boots), the head to the helmet.
"""

import numpy as np

import csdf as S


def torso_core(rig):
    """chest, waist and hips without limbs, reused as the base armor sits on"""
    rib = S.SuperEllipsoid((0, 1.305, -0.02), (0.163, 0.172, 0.112), 2.6)
    pecs = S.Ellipsoid((0.068, 1.335, 0.052), (0.074, 0.058, 0.042)).mirror_x()
    abdomen = S.SuperEllipsoid((0, 1.125, -0.018), (0.132, 0.12, 0.098), 2.4)
    pelvis = S.SuperEllipsoid((0, 0.955, -0.03), (0.162, 0.108, 0.112), 2.7)
    glutes = S.Ellipsoid((0.066, 0.905, -0.085), (0.078, 0.09, 0.068)).mirror_x()
    t = rib.su(pecs, 0.045).su(abdomen, 0.07).su(pelvis, 0.07).su(glutes, 0.05)
    return t


def body_sdf(rig):
    torso = torso_core(rig)
    trap = S.Capsule((0.045, 1.462, -0.07), (0.15, 1.438, -0.07), 0.052).mirror_x()
    delt = S.Sphere(rig.p("arm_upper_l") + (0.004, -0.004, 0.0), 0.062).mirror_x()
    # the neck stops inside the helmet; every helmet closes over it, so no head
    neck = S.RoundCone((0, 1.43, -0.058), (0, 1.615, -0.036), 0.062, 0.05)
    upper = S.RoundCone(rig.p("arm_upper_l"), rig.p("arm_lower_l"), 0.055, 0.043).mirror_x()
    fore_end = rig.p("hand_l") + rig.axis("arm_lower_l") * 0.012
    fore = S.RoundCone(rig.p("arm_lower_l"), fore_end, 0.046, 0.033).mirror_x()
    thigh = S.RoundCone(rig.p("leg_upper_l") + (0.005, 0.02, -0.005), rig.p("leg_lower_l"), 0.09, 0.056).mirror_x()
    calf = S.Ellipsoid(rig.lerp("leg_lower_l", "ankle_l", 0.3) + (0.0, 0.0, -0.022), (0.05, 0.11, 0.05)).mirror_x()
    shin = S.RoundCone(rig.p("leg_lower_l"), rig.p("ankle_l") + (0, -0.015, 0.0), 0.054, 0.036).mirror_x()
    b = torso.su(trap, 0.05).su(delt, 0.035).su(neck, 0.04)
    b = b.su(upper, 0.03).su(fore, 0.02).su(thigh, 0.06).su(shin, 0.025).su(calf, 0.03)
    return b


# bone segments and rough limb radii for the smooth weights
def _segments(rig):
    segs = {
        "pelvis": (rig.p("pelvis") + (0, -0.08, 0.0), rig.p("spine_0"), 0.12),
        "spine_0": (rig.p("spine_0"), rig.p("spine_1"), 0.12),
        "spine_1": (rig.p("spine_1"), rig.p("spine_2"), 0.12),
        "spine_2": (rig.p("spine_2"), rig.p("spine_3"), 0.13),
        "spine_3": (rig.p("spine_3"), rig.p("neck_0"), 0.13),
        "neck_0": (rig.p("neck_0"), rig.p("head_0"), 0.055),
        "head_0": (rig.p("head_0"), rig.p("head_0") + (0, 0.16, 0.02), 0.085),
    }
    for s in ("l", "r"):
        segs[f"clavicle_{s}"] = (rig.p(f"clavicle_{s}"), rig.p(f"arm_upper_{s}"), 0.05)
        segs[f"arm_upper_{s}"] = (rig.p(f"arm_upper_{s}"), rig.p(f"arm_lower_{s}"), 0.05)
        segs[f"arm_lower_{s}"] = (rig.p(f"arm_lower_{s}"), rig.p(f"hand_{s}"), 0.04)
        segs[f"hand_{s}"] = (rig.p(f"hand_{s}"), rig.p(f"weapon_hand_{s}"), 0.035)
        segs[f"leg_upper_{s}"] = (rig.p(f"leg_upper_{s}"), rig.p(f"leg_lower_{s}"), 0.075)
        segs[f"leg_lower_{s}"] = (rig.p(f"leg_lower_{s}"), rig.p(f"ankle_{s}"), 0.045)
        segs[f"ankle_{s}"] = (rig.p(f"ankle_{s}"), rig.p(f"ball_{s}"), 0.04)
        segs[f"ball_{s}"] = (rig.p(f"ball_{s}"), rig.p(f"ball_{s}") + (0, 0, 0.06), 0.03)
    return segs


def _seg_dist(p, a, b):
    ba = b - a
    t = np.clip(((p - a) @ ba) / float(ba @ ba), 0.0, 1.0)
    return S.length(p - (a + np.outer(t, ba)))


def body_weights(rig, co, power=5.0, only=None):
    """inverse surface-distance weights to the bone segments, 4 strongest kept by bind()"""
    segs = _segments(rig)
    names = [n for n in segs if only is None or n in only]
    out = {}
    for name in names:
        a, b, r = segs[name]
        d = np.maximum(_seg_dist(co, a, b) - r, 0.004)
        out[name] = 1.0 / d ** power
    # keep limbs from pulling the far side of the body: zero weights across the midline
    for name in names:
        if name.endswith("_l"):
            out[name] = np.where(co[:, 0] < -0.02, 0.0, out[name])
        elif name.endswith("_r"):
            out[name] = np.where(co[:, 0] > 0.02, 0.0, out[name])
    return out


def chain_weights(rig, co, chain, root, root_blend=0.08):
    """weights down a hanging cloth chain by height, the top blends into `root`"""
    ys = [rig.p(b)[1] for b in chain]
    out = {b: np.zeros(len(co)) for b in chain}
    out[root] = np.zeros(len(co))
    y = co[:, 1]
    for i, bone in enumerate(chain):
        top = ys[i]
        bottom = ys[i + 1] if i + 1 < len(chain) else ys[i] - 0.3
        mid_next = bottom
        # tent function centred on each bone head, reaching zero at the neighbours
        up = ys[i - 1] if i > 0 else top + root_blend
        rise = np.clip((up - y) / max(up - top, 1e-3), 0.0, 1.0)
        fall = np.clip((y - mid_next) / max(top - mid_next, 1e-3), 0.0, 1.0)
        w = np.where(y >= top, rise, fall)
        if i == len(chain) - 1:
            w = np.where(y < top, 1.0, w)
        out[bone] = w
    # above the first bone the root takes over
    out[root] = np.clip((y - ys[0]) / root_blend, 0.0, 1.0)
    out[chain[0]] = np.where(y > ys[0], 1.0 - out[root], out[chain[0]])
    return out
