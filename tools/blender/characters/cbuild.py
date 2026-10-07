"""blender side of the character build: turning sdf parts into decimated,
shaded, skinned mesh objects with lods, plus the armature and materials.

geometry arrives in three.js space and is converted here, (x, y, z) three ->
(x, -z, y) blender, so the gltf exporter's y-up conversion lands it back
exactly where the runtime skeleton expects it.
"""

import time

import bpy
import numpy as np
from mathutils import Vector

import csdf as S

# material slots, the runtime reads the slot from the material name
SLOTS = ["primary", "secondary", "accent", "suit", "dark", "light", "visor", "metal", "cloth", "trim", "muscle", "glow"]
SLOT_PREVIEW = {
    "primary": ((0.52, 0.45, 0.33), 0.5, 0.1),
    "secondary": ((0.12, 0.14, 0.09), 0.6, 0.0),
    "accent": ((0.45, 0.14, 0.05), 0.4, 0.2),
    "suit": ((0.05, 0.05, 0.055), 0.85, 0.0),
    "dark": ((0.025, 0.025, 0.028), 0.6, 0.3),
    "light": ((1.0, 0.4, 0.08), 0.3, 0.0),
    "visor": ((0.01, 0.012, 0.015), 0.08, 0.6),
    "metal": ((0.55, 0.56, 0.58), 0.3, 1.0),
    "cloth": ((0.1, 0.12, 0.08), 0.9, 0.0),
    "trim": ((0.4, 0.12, 0.05), 0.85, 0.0),
    "muscle": ((0.03, 0.032, 0.036), 0.45, 0.05),
    "glow": ((1.0, 0.2, 0.1), 0.4, 0.0),
}

T0 = time.time()


def log(msg):
    print(f"[characters {time.time() - T0:6.1f}s] {msg}", flush=True)


def to_blender(v):
    v = np.asarray(v, dtype=np.float64)
    out = np.empty_like(v)
    out[..., 0] = v[..., 0]
    out[..., 1] = -v[..., 2]
    out[..., 2] = v[..., 1]
    return out


def to_three(v):
    v = np.asarray(v, dtype=np.float64)
    out = np.empty_like(v)
    out[..., 0] = v[..., 0]
    out[..., 1] = v[..., 2]
    out[..., 2] = -v[..., 1]
    return out


def slot_material(slot):
    name = f"char_{slot}"
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        color, rough, metal = SLOT_PREVIEW[slot]
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = (*color, 1.0)
        bsdf.inputs["Roughness"].default_value = rough
        bsdf.inputs["Metallic"].default_value = metal
        if slot in ("light", "glow"):
            bsdf.inputs["Emission Color"].default_value = (*color, 1.0)
            bsdf.inputs["Emission Strength"].default_value = 4.0
    return mat


# ------------------------------------------------------------------ mesh io
def mesh_object(name, verts_three, faces):
    me = bpy.data.meshes.new(name)
    faces = np.asarray(faces, dtype=np.int64)
    me.from_pydata(to_blender(verts_three).tolist(), [], faces.tolist())
    me.validate(clean_customdata=False)
    me.update()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def get_co(obj):
    co = np.zeros(len(obj.data.vertices) * 3)
    obj.data.vertices.foreach_get("co", co)
    return to_three(co.reshape(-1, 3))


def set_co(obj, co_three):
    obj.data.vertices.foreach_set("co", to_blender(co_three).ravel())
    obj.data.update()


def get_tris(obj):
    me = obj.data
    me.calc_loop_triangles()
    tris = np.zeros(len(me.loop_triangles) * 3, dtype=np.int64)
    me.loop_triangles.foreach_get("vertices", tris)
    return tris.reshape(-1, 3)


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def apply_modifiers(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    new_me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    old = obj.data
    obj.modifiers.clear()
    obj.data = new_me
    bpy.data.meshes.remove(old)


def copy_object(obj, name):
    dup = obj.copy()
    dup.data = obj.data.copy()
    dup.name = name
    bpy.context.scene.collection.objects.link(dup)
    return dup


def transfer_normals(dst, src):
    """custom split normals from the full-resolution piece onto a decimated copy"""
    mod = dst.modifiers.new("normals", "DATA_TRANSFER")
    mod.object = src
    mod.use_loop_data = True
    mod.data_types_loops = {"CUSTOM_NORMAL"}
    mod.loop_mapping = "POLYINTERP_NEAREST"
    apply_modifiers(dst)


def decimate(obj, target_tris, symmetric=False):
    tris = tri_count(obj)
    if tris <= target_tris:
        return
    mod = obj.modifiers.new("decimate", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = max(0.0005, min(1.0, target_tris / tris))
    mod.use_collapse_triangulate = True
    if symmetric:
        mod.use_symmetry = True
        mod.symmetry_axis = "X"
    apply_modifiers(obj)


def relax(obj, fn, iterations=3, strength=0.45):
    """tangential smoothing reprojected onto the sdf, evens out decimated triangles"""
    me = obj.data
    n = len(me.vertices)
    edges = np.zeros(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get("vertices", edges)
    edges = edges.reshape(-1, 2)
    co = get_co(obj)
    deg = np.bincount(edges.ravel(), minlength=n).astype(np.float64)
    for _ in range(iterations):
        acc = np.zeros_like(co)
        np.add.at(acc, edges[:, 0], co[edges[:, 1]])
        np.add.at(acc, edges[:, 1], co[edges[:, 0]])
        avg = acc / np.maximum(deg, 1)[:, None]
        nrm = S.normals(fn, co)
        delta = avg - co
        delta -= nrm * np.sum(delta * nrm, axis=1, keepdims=True)
        co = S.project(fn, co + strength * delta, iterations=2)
    set_co(obj, co)


def set_normals(obj, normals_three):
    me = obj.data
    me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    me.normals_split_custom_set_from_vertices(to_blender(normals_three).tolist())
    me.update()


def set_colors(obj, rgba):
    me = obj.data
    for attr in list(me.color_attributes):
        me.color_attributes.remove(attr)
    attr = me.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
    attr.data.foreach_set("color", np.asarray(rgba, dtype=np.float32).ravel())
    me.color_attributes.active_color = attr
    me.color_attributes.render_color_index = 0


def set_material(obj, slot):
    obj.data.materials.clear()
    obj.data.materials.append(slot_material(slot))


# ------------------------------------------------------------------ armature
def build_armature(rig, name="CharacterRig"):
    arm_data = bpy.data.armatures.new(name)
    arm_obj = bpy.data.objects.new(name, arm_data)
    bpy.context.scene.collection.objects.link(arm_obj)
    bpy.context.view_layer.objects.active = arm_obj
    arm_obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    ebones = {}
    for jname in rig.order:
        eb = arm_data.edit_bones.new(jname)
        head = rig.p(jname)
        tail = head + rig.axis(jname) * max(rig.length(jname), 0.02)
        eb.head = Vector(to_blender(head).tolist())
        eb.tail = Vector(to_blender(tail).tolist())
        eb.use_deform = True
        ebones[jname] = eb
    for jname in rig.order:
        parent = rig.parent(jname)
        if parent:
            ebones[jname].parent = ebones[parent]
            ebones[jname].use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    arm_data.display_type = "STICK"
    return arm_obj


def bind(obj, arm_obj, weights):
    """weights: {bone: array per vertex} or a bone name for a rigid part"""
    obj.parent = arm_obj
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm_obj
    n = len(obj.data.vertices)
    if isinstance(weights, str):
        vg = obj.vertex_groups.new(name=weights)
        vg.add(list(range(n)), 1.0, "REPLACE")
        return
    # keep the 4 strongest per vertex and normalize
    names = list(weights.keys())
    W = np.stack([np.asarray(weights[k], dtype=np.float64) for k in names], axis=1)
    if W.shape[1] > 4:
        idx = np.argsort(-W, axis=1)[:, 4:]
        np.put_along_axis(W, idx, 0.0, axis=1)
    W /= np.maximum(W.sum(axis=1, keepdims=True), 1e-9)
    for j, bone in enumerate(names):
        col = W[:, j]
        nz = np.nonzero(col > 1e-4)[0]
        if len(nz) == 0:
            continue
        vg = obj.vertex_groups.new(name=bone)
        # group equal weights so the python loop stays short
        q = np.round(col[nz], 3)
        for value in np.unique(q):
            members = nz[q == value]
            vg.add(members.tolist(), float(value), "REPLACE")
