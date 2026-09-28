"""shared pieces for the surf map scripts (build_surf_*.py).

a surf map here is a chain of stages. each stage has a frame (origin on its
start platform, x lateral, y forward, z up from the platform top), a platform
with a drop gate in its front wall, a chain of prism ramps and a landing
platform that is the next stage's start (or the finish). this module has the
parts every one of those maps shares, the look stays in the build scripts:

  - prism ramps whose two long faces are single planar quads, the exact same
    faces go into the render and the collision mesh
  - walls with collision, platform slabs, stage numbers
  - trigger volumes (start, checkpoint, finish, stage teleports, void)
  - the layout file tools/blender/maps/layouts/<id>.json the tests ride

prismline predates this file and keeps its own copies of the same ideas.
"""

import math

import bmesh
import bpy
from mathutils import Vector

import maplib as M

GATE_DROP = 4.5       # first ridge of a stage sits this far under its platform top
GATE_TUCK = 4.0       # and starts this far back under the platform's front edge
LANDING_GAP = 2.0     # last ramp end to the landing platform edge


# ---------------------------------------------------------------------------
# frames and ramps


class Frame:
    """stage frame: x lateral (right), y forward, z up from the stage platform top"""

    def __init__(self, origin, z, heading):
        self.origin = Vector((origin[0], origin[1], 0.0))
        self.z = z
        self.heading = heading
        self.rot = -math.radians(heading)
        self.f = M.heading_vec(heading)
        self.r = M.heading_vec(heading + 90)

    def p(self, lat, fwd, z=0.0):
        w = self.origin + self.r * lat + self.f * fwd
        return (w.x, w.y, self.z + z)

    def loc(self):
        return (self.origin.x, self.origin.y, self.z)


class Ramp:
    """triangular prism along a frame: ridge at (lateral, ridge_z) from s0 to s1,
    both long faces at `angle` down to ridge_z - height. `tilt` lowers the far
    end, each face stays one planar quad. `branch` marks the two halves of a
    fork (a transfer where the line splits around a valley and rejoins)."""

    def __init__(self, stage, index, frame, s0, s1, lateral, ridge_z, height, angle, tilt=0.0, branch=None):
        self.stage = stage
        self.index = index
        self.frame = frame
        self.s0 = s0
        self.s1 = s1
        self.lateral = lateral
        self.ridge_z = ridge_z
        self.height = height
        self.angle = angle
        self.tilt = tilt
        self.branch = branch

    @property
    def length(self):
        return self.s1 - self.s0

    @property
    def half_width(self):
        return self.height / math.tan(math.radians(self.angle))

    def end_ridge(self):
        return self.ridge_z - self.tilt

    def end_bottom(self):
        return self.ridge_z - self.tilt - self.height

    def ridge_at(self, s):
        t = (s - self.s0) / self.length
        return self.ridge_z - self.tilt * t

    def quad(self, side):
        """world corners of one face: ridge start, ridge end, foot end, foot start"""
        fr = self.frame
        w = self.half_width * (1 if side > 0 else -1)
        return [
            fr.p(self.lateral, self.s0, self.ridge_z),
            fr.p(self.lateral, self.s1, self.end_ridge()),
            fr.p(self.lateral + w, self.s1, self.end_bottom()),
            fr.p(self.lateral + w, self.s0, self.ridge_z - self.height),
        ]

    def mesh(self):
        fr = self.frame
        profile = M.prism_points(self.s0, self.s1, self.lateral, self.ridge_z, self.ridge_z - self.height, self.angle, self.angle)
        return M.bm_sweep(profile, self.s0, self.s1, rot_z=fr.rot, loc=fr.loc(), drop=self.tilt)


def chain(stage, frame, specs, s_start, ridge_start):
    """lays out one stage's ramps. the first spec starts at s_start with its ridge
    at ridge_start, every later one `gap` metres after the previous end with its
    ridge `drop` under the previous ridge end. a spec with `fork` makes two mirrored
    ramps at lateral -fork and +fork sharing that slot."""
    ramps = []
    prev = None
    for index, spec in enumerate(specs):
        s = s_start if prev is None else prev.s1 + spec["gap"]
        ridge = ridge_start if prev is None else prev.end_ridge() - spec["drop"]
        if spec.get("fork"):
            slots = [(-spec["fork"], "left"), (spec["fork"], "right")]
        else:
            slots = [(spec.get("lateral", 0.0), None)]
        made = [Ramp(stage, index, frame, s, s + spec["length"], lat, ridge, spec["height"], spec["angle"],
                     spec.get("tilt", 0.0), branch) for lat, branch in slots]
        ramps += made
        prev = made[0]
    return ramps


def split_faces(bm, keep):
    """copies bm into two bmeshes: faces where keep(face) and the rest"""
    a = bm.copy()
    b = bm.copy()
    bmesh.ops.delete(a, geom=[f for f in a.faces if not keep(f)], context="FACES")
    bmesh.ops.delete(b, geom=[f for f in b.faces if keep(f)], context="FACES")
    bm.free()
    return a, b


def build_ramp(b, ramp, chunk, face_mat, under_mat):
    """the prism into collision, its two surf faces into `face_mat` (name must start
    with ramp_ so the render test finds them) and the rest into `under_mat`"""
    fr = ramp.frame
    bm = ramp.mesh()
    b.collide(bm.copy())
    faces, rest = split_faces(bm, lambda f: 0.3 < f.normal.z < 0.95)
    b.add(faces, chunk, face_mat, rot_z=fr.rot, uv_hint=fr.f, fit_v=True)
    b.add(rest, chunk, under_mat, rot_z=fr.rot)


def edge_strip(b, ramp, side, chunk, mat, size=0.16, inset=0.12, below=0.09, pieces=2):
    """glow strip hugging the underside of one bottom edge of a ramp (render only)"""
    fr = ramp.frame
    lat = ramp.lateral + side * (ramp.half_width - inset)
    for seg in range(pieces):
        t0 = seg / pieces
        t1 = (seg + 1) / pieces
        f0 = ramp.s0 + ramp.length * t0
        f1 = ramp.s0 + ramp.length * t1
        z0 = ramp.ridge_z - ramp.height - ramp.tilt * t0 - below
        z1 = ramp.ridge_z - ramp.height - ramp.tilt * t1 - below
        h = size / 2
        prof = [(lat - h, z0 - h), (lat + h, z0 - h), (lat + h, z0 + h), (lat - h, z0 + h)]
        b.add(M.bm_sweep(prof, f0, f1, rot_z=fr.rot, loc=fr.loc(), drop=z0 - z1), chunk, mat)


def bm_ring_arch(center, rot_z, r_in, r_out, spring, depth, base_z, segments=16, legs=True):
    """round arch: two legs from base_z up to `spring`, then a half ring between
    r_in and r_out, in the local x/z plane and extruded along local y"""
    arc_in = [(r_in * math.cos(math.pi - math.pi * i / segments), spring + r_in * math.sin(math.pi - math.pi * i / segments))
              for i in range(1, segments)]
    arc_out = [(r_out * math.cos(math.pi * i / segments), spring + r_out * math.sin(math.pi * i / segments))
               for i in range(1, segments)]
    if legs:
        pts = [(-r_out, 0.0), (-r_in, 0.0), (-r_in, spring)] + arc_in + [(r_in, spring), (r_in, 0.0), (r_out, 0.0), (r_out, spring)]
    else:
        pts = [(-r_in, spring)] + arc_in + [(r_in, spring), (r_out, spring)]
    pts += arc_out + [(-r_out, spring)]
    bm = bmesh.new()
    front = [bm.verts.new((x, -depth / 2, z)) for x, z in pts]
    back = [bm.verts.new((x, depth / 2, z)) for x, z in pts]
    bm.faces.new(front)
    bm.faces.new(list(reversed(back)))
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((front[i], back[i], back[j], front[j]))
    M._outward(bm)
    return M._transform(bm, rot_z, (center[0], center[1], base_z))


def ridge_cap(b, ramp, chunk, mat, width=0.34, rise=0.05):
    """thin glowing bar along the ridge, just above the collision (render only)"""
    fr = ramp.frame
    h = width / 2
    z = ramp.ridge_z + rise
    prof = [(ramp.lateral - h, z - 0.02), (ramp.lateral + h, z - 0.02), (ramp.lateral, z + 0.08)]
    b.add(M.bm_sweep(prof, ramp.s0 + 0.3, ramp.s1 - 0.3, rot_z=fr.rot, loc=fr.loc(), drop=ramp.tilt), chunk, mat)


# ---------------------------------------------------------------------------
# platforms and walls


def slab(b, frame, half_lat, half_fwd, chunk, mat, thick=1.6, bevel=0.08, center=(0.0, 0.0), rim=None):
    """walkable slab whose top is the frame's z, collision included. `rim` is an
    optional (material, height) band around the top edge"""
    c = frame.p(center[0], center[1], -thick / 2)
    size = (half_lat * 2, half_fwd * 2, thick)
    b.add(M.bm_box(c, size, rot_z=frame.rot, bevel=bevel, segments=2), chunk, mat, rot_z=frame.rot)
    b.collide(M.bm_box(c, size, rot_z=frame.rot))
    if rim:
        rim_mat, rim_h = rim
        b.add(M.bm_band(frame.p(center[0], center[1], -rim_h / 2 - 0.02), (half_lat * 2 + 0.06, half_fwd * 2 + 0.06, rim_h),
                        rot_z=frame.rot), chunk, rim_mat, rot_z=frame.rot)


def wall(b, frame, lat0, lat1, fwd0, fwd1, height, chunk, mat, thick=0.8, cap=None, base=None, bevel=0.05):
    """straight wall between two points of a frame, standing on its platform top,
    collision included. cap / base are optional (material, height) trim bands"""
    a = Vector(frame.p(lat0, fwd0))
    c = Vector(frame.p(lat1, fwd1))
    mid = (a + c) / 2
    length = (c - a).length
    along = (c - a).normalized()
    rot = math.atan2(along.y, along.x)
    center = (mid.x, mid.y, frame.z + height / 2)
    b.add(M.bm_box(center, (length, thick, height), rot_z=rot, bevel=bevel), chunk, mat, rot_z=rot)
    b.collide(M.bm_box(center, (length, thick, height), rot_z=rot))
    if cap:
        cap_mat, cap_h = cap
        b.add(M.bm_band((mid.x, mid.y, frame.z + height - cap_h / 2 - 0.08), (length + 0.04, thick + 0.04, cap_h), rot_z=rot),
              chunk, cap_mat, rot_z=rot)
    if base:
        base_mat, base_h = base
        b.add(M.bm_box((mid.x, mid.y, frame.z + 0.3), (max(0.1, length - 0.6), thick + 0.06, base_h), rot_z=rot),
              chunk, base_mat, rot_z=rot)
    return (a, c)


def platform_walls(b, frame, hl, hf, kind, chunk, mat, turn=1, gate_half=6.0, height=2.6, far_height=6.0,
                   end_height=7.0, thick=0.8, cap=None, base=None, open_back=None):
    """walls around a platform centred on the frame origin, returns the segments.
    kind 'start': back, both sides and a gated front
    kind 'corner': the previous stage's landing. that stage came in from the side
       (turn +1: it turns right into this one, -1: left), so a tall far wall
       catches fast arrivals, then a back wall and a gated front, arrival side open
    kind 'finish': both sides and a tall far end, arrival side open
    open_back: (lat0, lat1) doorway left in the back wall of a start platform.
    wall ends stop 2 cm short of each other so corner faces never z-fight."""
    t = thick
    e = 0.02
    segs = []

    def add(lat0, lat1, fwd0, fwd1, h):
        segs.append(wall(b, frame, lat0, lat1, fwd0, fwd1, h, chunk, mat, thick=t, cap=cap, base=base))

    back = -hf + t / 2
    front = hf - t / 2
    if kind == "start":
        if open_back:
            o0, o1 = open_back
            if o0 > -hl + t:
                add(-hl + e, o0, back, back, height)
            if o1 < hl - t:
                add(o1, hl - e, back, back, height)
        else:
            add(-hl + e, hl - e, back, back, height)
        add(-hl + t / 2, -hl + t / 2, -hf + t, hf - e, height)
        add(hl - t / 2, hl - t / 2, -hf + t, hf - e, height)
        gate_from, gate_to = -hl + t, hl - t
    elif kind == "corner":
        far = -turn * (hl - t / 2)
        add(far, far, -hf + e, hf - e, far_height)
        # inner ends butt against the far wall, outer ends stop at the open arrival side
        lo, hi = (-hl + t, hl - e) if turn > 0 else (-hl + e, hl - t)
        add(lo, hi, back, back, height)
        gate_from, gate_to = lo, hi
    elif kind == "finish":
        add(-hl + t / 2, -hl + t / 2, -hf + e, hf - t, height)
        add(hl - t / 2, hl - t / 2, -hf + e, hf - t, height)
        add(-hl + e, hl - e, front, front, end_height)
        return segs
    else:
        raise ValueError(kind)
    add(gate_from, -gate_half - 0.6, front, front, height)
    add(gate_half + 0.6, gate_to, front, front, height)
    return segs


DIGITS = {
    0: "abcdef", 1: "bc", 2: "abged", 3: "abgcd", 4: "fgbc", 5: "afgcd", 6: "afgedc", 7: "abc", 8: "abcdefg", 9: "abcdfg",
}


def digit(b, frame, value, lat, fwd, z, height, mat, chunk, depth=0.12, normal_sign=-1):
    """seven segment number standing in the frame's lateral/up plane (render only)"""
    w = height * 0.5
    t = height * 0.12
    pos = {
        "a": (0, height, w, t), "g": (0, height / 2, w, t), "d": (0, 0, w, t),
        "b": (w / 2, height * 0.75, t, height / 2), "c": (w / 2, height * 0.25, t, height / 2),
        "f": (-w / 2, height * 0.75, t, height / 2), "e": (-w / 2, height * 0.25, t, height / 2),
    }
    for s in DIGITS[value]:
        dx, dz, sx, sz = pos[s]
        c = frame.p(lat + dx, fwd, z + dz)
        b.add(M.bm_box(c, (sx, depth, sz), rot_z=frame.rot, bevel=0.02), chunk, mat, rot_z=frame.rot)


# ---------------------------------------------------------------------------
# lighting


def add_fill_light(fill):
    """a second, soft sun lamp for the bake only, from roughly opposite the main
    light. low suns and night skies leave every face turned away from the key
    light almost black, which you can't surf. the game draws lit meshes from the
    lightmap alone, so this needs no runtime counterpart."""
    direction = M.sun_vector(fill["azimuth"], fill["elevation"])
    data = bpy.data.lights.new("Fill", "SUN")
    data.energy = fill["strength"]
    data.color = M.lin(fill["color"])
    data.angle = math.radians(fill.get("angle", 10.0))
    ob = bpy.data.objects.new("Fill", data)
    ob.rotation_euler = (-direction).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.collection.objects.link(ob)
    return ob


# ---------------------------------------------------------------------------
# triggers


def aabb_of_points(points, pad_xy=0.0, z0=None, z1=None):
    """three.js aabb around blender points"""
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    zs = [p[2] for p in points]
    mn = (min(xs) - pad_xy, min(ys) - pad_xy, z0 if z0 is not None else min(zs))
    mx = (max(xs) + pad_xy, max(ys) + pad_xy, z1 if z1 is not None else max(zs))
    return M.aabb_three(mn, mx)


def platform_volume(frame, lat0, lat1, fwd0, fwd1, z0=-0.5, z1=3.0):
    return aabb_of_points([frame.p(lat0, fwd0), frame.p(lat1, fwd1)], z0=frame.z + z0, z1=frame.z + z1)


def target(frame, lat, fwd):
    return {"position": M.to_three(frame.p(lat, fwd, 0.05)), "yawDeg": M.yaw_deg(*frame.f[:2])}


def fall_volume(ramps, lateral_pad=22.0, back=6.0, ahead=7.0, below=60.0, clear=4.0):
    """box under a group of ramps (all in one frame), from `clear` metres under
    their lowest point down `below` metres. it only reaches `ahead` metres past
    the last ramp so it never gets under the next stage"""
    fr = ramps[0].frame
    low = min(fr.z + r.end_bottom() for r in ramps)
    pts = []
    for r in ramps:
        w = r.half_width + lateral_pad
        pts += [fr.p(r.lateral - w, r.s0 - back), fr.p(r.lateral + w, r.s1 + ahead)]
    return aabb_of_points(pts, z0=low - below, z1=low - clear)


def void_volume(b, pad=400.0, below=60.0, depth=400.0):
    xs = [v[0] for v in b.col_verts]
    ys = [v[1] for v in b.col_verts]
    lowest = min(v[2] for v in b.col_verts)
    return M.aabb_three((min(xs) - pad, min(ys) - pad, lowest - below - depth), (max(xs) + pad, max(ys) + pad, lowest - below))


# ---------------------------------------------------------------------------
# layout file (three.js coordinates, y up) for the tests


def _three_dir(v):
    return [round(x, 4) for x in M.to_three((v.x, v.y, 0.0), 4)]


def layout_json(map_id, script, frames, platforms, landings, ramps, turns, extra=None):
    """frames[k] / platforms[k] (half_lat, half_fwd) describe stage k's start,
    landings[k] = (s0, length, top, half_lat) its landing in its own frame,
    turns[k] the turn into stage k + 1 (+1 right, -1 left, 0 for the finish)"""
    out = {
        "id": map_id,
        "note": f"generated by {script}. positions in three.js coordinates (y up)",
        "stages": [],
        "ramps": [],
    }
    for k, fr in enumerate(frames):
        s0, length, top, half_lat = landings[k]
        hl, hf = platforms[k]
        out["stages"].append({
            "index": k + 1,
            "origin": M.to_three(fr.p(0, 0)),
            "forward": _three_dir(fr.f),
            "right": _three_dir(fr.r),
            "heading": fr.heading,
            "platform": {"halfLat": hl, "halfFwd": hf},
            "gate": {"fwd": hf, "halfWidth": 6.0},
            "landing": {"s0": round(s0, 3), "s1": round(s0 + length, 3), "top": round(fr.z + top, 3), "halfLat": half_lat},
            "turn": turns[k],
        })
    for r in ramps:
        fr = r.frame
        for side in (-1, 1):
            entry = {
                "stage": r.stage + 1, "index": r.index + 1, "side": "right" if side > 0 else "left",
                "angleDeg": r.angle, "length": round(r.length, 3), "height": r.height,
                "s0": round(r.s0, 3), "s1": round(r.s1, 3), "lateral": r.lateral, "halfWidth": round(r.half_width, 4),
                "ridgeStart": round(fr.z + r.ridge_z, 3), "ridgeEnd": round(fr.z + r.end_ridge(), 3),
                "forward": _three_dir(fr.f),
                "quad": [M.to_three(q) for q in r.quad(side)],
            }
            if r.branch:
                entry["branch"] = r.branch
            out["ramps"].append(entry)
    if extra:
        out.update(extra)
    return out
