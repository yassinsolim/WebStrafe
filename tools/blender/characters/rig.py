"""the player skeleton for the blender build, read from rig.json.

rig.json is written by tools/characters/export-rig.ts from
src/characters/skeleton.ts, so the joints here are exactly the runtime's.
positions are in three.js space (y up, faces +z, left on +x, metres).
"""

import json
import os

import numpy as np

import csdf as S

HERE = os.path.dirname(os.path.abspath(__file__))


class Rig:
    def __init__(self, path=os.path.join(HERE, "rig.json")):
        with open(path) as f:
            data = json.load(f)
        self.joints = {j["name"]: j for j in data["joints"]}
        self.order = [j["name"] for j in data["joints"]]
        self.knife = data["knife"]

    def p(self, name):
        """joint position"""
        return np.array(self.joints[name]["position"], dtype=np.float64)

    def axis(self, name):
        """direction the bone points (towards its child)"""
        return np.array(self.joints[name]["axis"], dtype=np.float64)

    def length(self, name):
        return float(self.joints[name]["length"])

    def parent(self, name):
        return self.joints[name]["parent"]

    def lerp(self, a, b, t):
        return self.p(a) * (1.0 - t) + self.p(b) * t

    def limb_frame(self, bone, child, forward=(0.0, 0.0, 1.0)):
        """frame for limb armor on the left side (the right side is a mirror copy):
        local x points away from the body (+x world), y runs down the limb from
        bone to child, z faces forward. it can be a reflection, which is fine for
        distance fields. returns (R, origin at the bone head)"""
        y = S.normalize(self.p(child) - self.p(bone))
        z = np.asarray(forward, dtype=np.float64)
        z = S.normalize(z - y * (z @ y))
        x = np.cross(y, z)
        if x[0] < 0:
            x = -x
        return np.stack([x, y, z], axis=1), self.p(bone)

    def knife_frame(self):
        """right fist frame around the knife handle: u along the handle (to the blade),
        w along the hand towards the knuckles, v towards the palm; origin at the grip"""
        g = np.array(self.knife["handleCenter"], dtype=np.float64)
        u = S.normalize(self.knife["handleAxis"])
        f = self.axis("hand_r")
        w = S.normalize(f - u * (f @ u))
        v = np.cross(u, w)
        wrist = self.p("hand_r")
        # v must point from the back of the hand to the palm (the grip sits palm side)
        if (g - wrist) @ v < 0:
            v = -v
        return np.stack([u, w, v], axis=1), g


def mirror(v):
    v = np.array(v, dtype=np.float64)
    v[..., 0] *= -1.0
    return v
