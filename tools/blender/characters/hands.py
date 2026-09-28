"""armored gloves: a right fist closed around the knife handle and a relaxed
left hand, both built in the fist frame from rig.knife_frame():
  u along the handle (towards the blade), w from the wrist to the knuckles,
  v from the back of the hand to the palm; origin at the grip centre.
the left hand uses the mirrored frame, so the same local numbers describe it.
"""

import math

import numpy as np

import csdf as S
from rig import mirror

# finger u positions and radii: index, middle, ring, pinky
FINGERS = [(0.031, 0.0098), (0.010, 0.0102), (-0.011, 0.0096), (-0.030, 0.0086)]


def _ring(theta_deg, r):
    t = math.radians(theta_deg)
    return np.array([r * math.cos(t), r * math.sin(t)])


def _finger(u, rad, joints, k=0.003):
    """capsule chain through (w, v) joints at height u, tapering"""
    pts = [np.array([u, j[0], j[1]]) for j in joints]
    shape = None
    for i in range(len(pts) - 1):
        r0 = rad * (1.0 - 0.07 * i)
        r1 = rad * (1.0 - 0.07 * (i + 1))
        seg = S.RoundCone(pts[i], pts[i + 1], r0, r1)
        shape = seg if shape is None else shape.su(seg, k)
    return shape


def fist_joints():
    """(w, v) of knuckle, first joint, second joint, tip around the handle"""
    return [(-0.006, -0.026), tuple(_ring(-20, 0.024)), tuple(_ring(66, 0.0235)), tuple(_ring(132, 0.021))]


def relaxed_joints():
    return [(-0.006, -0.026), (0.027, -0.019), (0.045, -0.002), (0.049, 0.018)]


def hand_parts(rig, side, bulk=1.0):
    """returns dict of local-space sdfs placed on the hand: glove (fabric), palm,
    fingers, thumb, back plate slot, knuckle bar, cuff, plus the frame"""
    R, g = rig.knife_frame()
    if side == "l":
        R = mirror(R.T).T  # mirror each axis vector
        g = mirror(g)
    joints = fist_joints() if side == "r" else relaxed_joints()
    fingers = None
    for u, rad in FINGERS:
        f = _finger(u, rad * bulk, joints)
        fingers = f if fingers is None else fingers | f
    # back of the hand: from the wrist centre to the knuckles
    wrist_local = (g - rig.p(f"hand_{side}")) @ R * -1.0
    back_axis = S.normalize(np.array([0.0, -0.006 - wrist_local[1], -0.022 - wrist_local[2]]))
    back_len = float(np.linalg.norm(np.array([-0.006, -0.022]) - wrist_local[1:]))
    back_mid = np.array([0.004, (wrist_local[1] - 0.006) * 0.5, (wrist_local[2] - 0.022) * 0.5])
    Rb = S.frame_from(y=back_axis, x=np.array([1.0, 0.0, 0.0]))
    back = S.Box((0, 0, 0), (0.041 * bulk, back_len * 0.5 + 0.004, 0.0145 * bulk), 0.011).place(Rb, back_mid)
    palm = S.Box((0.004, -0.047, 0.003), (0.04 * bulk, 0.032, 0.017), 0.012)
    if side == "r":
        # the handle channel stays open
        palm = palm - S.Cylinder((-0.1, 0, 0), (0.1, 0, 0), 0.0135)
    thenar = S.Ellipsoid((0.034, -0.05, 0.01), (0.021, 0.03, 0.016))
    if side == "r":
        thumb_pts = [(0.03, -0.074, 0.0), (0.047, -0.036, 0.022), (0.044, -0.009, 0.032), (0.03, 0.011, 0.031)]
    else:
        thumb_pts = [(0.03, -0.074, 0.0), (0.05, -0.04, 0.012), (0.058, -0.013, 0.018), (0.056, 0.008, 0.02)]
    thumb = None
    for i in range(3):
        seg = S.RoundCone(thumb_pts[i], thumb_pts[i + 1], (0.0118 - 0.001 * i) * bulk, (0.0108 - 0.001 * i) * bulk)
        thumb = seg if thumb is None else thumb.su(seg, 0.003)
    cuff = S.RoundCone(
        wrist_local + np.array([0.0, -0.035, 0.0]),
        wrist_local + np.array([0.0, 0.012, 0.0]),
        0.041 * bulk,
        0.038 * bulk,
    )
    glove = back.su(palm, 0.012).su(thenar, 0.01).su(thumb, 0.006).su(fingers, 0.007).su(cuff, 0.01)

    # armor bits, local space
    plate_center = back_mid + np.array([0.0, 0.004, -0.0165 * bulk])
    back_plate = S.Box((0, 0, 0), (0.037 * bulk, back_len * 0.42, 0.005), 0.004).place(Rb, plate_center)
    knuckles = S.Capsule((-0.036, -0.009, -0.035 * bulk), (0.04, -0.009, -0.035 * bulk), 0.0105 * bulk)
    finger_plates = None
    for u, rad in FINGERS:
        a = np.array([u, joints[0][0], joints[0][1]])
        b = np.array([u, joints[1][0], joints[1][1]])
        mid = (a + b) * 0.5
        out = S.normalize(np.array([0.0, mid[1], mid[2]]))
        seg = S.RoundCone(a + out * rad * 0.55, b + out * rad * 0.55, rad * 0.62, rad * 0.55)
        finger_plates = seg if finger_plates is None else finger_plates | seg
    place = lambda s: s.place(R, g)  # noqa: E731
    return {
        "glove": place(glove),
        "back_plate": place(back_plate),
        "knuckles": place(knuckles),
        "finger_plates": place(finger_plates),
        "cuff_local": wrist_local,
        "R": R,
        "g": g,
    }
