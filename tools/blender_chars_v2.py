#!/usr/bin/env python3
# Blender-Rig-Pipeline v2 (WBN Survivors 2, UE-Port):
#   - Kid-Body (Leonidas-Proportionen aus blender_chars.py) als EIN deformierbares
#     Mesh + Humphanoide Armature (.L/.R-Suffixe) + Automatic Weights (Heat)
#   - Hut (Helm+Krempe) als separates, starr an 'head' geparentetes Mesh
#     -> UE: 2 Skeletal Meshes, 1 Skeleton (MasterPose-fähig)
#   - Export FBX (global_scale=100 -> cm für UE), .blend-Ablage
# Konventionen: Figur schaut Blender -Y (wie v1-Frontalrenders). Facing-Offset
#   wird in UE per MeshYawOffset korrigiert (Top-down egal, 10-Sekunden-Fix).
#   A-Pose/Animationen kommen aus Retargeting (T2), hier nur Skinning-Basis.
# Aufruf: blender.exe -b --factory-startup -P tools/blender_chars_v2.py -- <repo-root>
import bpy, math, os, sys

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ROOT = ARGS[0] if ARGS else os.getcwd()
FBXD = os.path.join(ROOT, 'models', 'fbx')
os.makedirs(FBXD, exist_ok=True)

def log(*a):
    print('[rig_v2]', *a)

# ---------------------------------------------------------------- Helfer
def mat_simple():
    mat = bpy.data.materials.new('RigMat')
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.9
    return mat

def paint(obj, color):
    mesh = obj.data
    if not mesh.color_attributes:
        mesh.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    ca = mesh.color_attributes[0]
    for i in range(len(mesh.vertices)):
        ca.data[i].color = (*color, 1.0)

def prim_sphere(name, color, mat, r, loc, rings=12, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=rings, radius=r, location=loc, scale=scale)
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(mat)
    paint(o, color)
    return o

def prim_cube(name, color, mat, size, loc, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = (size[0], size[1], size[2])
    bpy.ops.object.transform_apply(scale=True)
    if bevel > 0:
        mod = o.modifiers.new('bev', 'BEVEL')
        mod.width = bevel
        mod.segments = 2
        bpy.ops.object.modifier_apply(modifier=mod.name)
    o.data.materials.append(mat)
    paint(o, color)
    return o

def prim_cyl(name, color, mat, r, length, loc):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=length, location=(0, 0, 0), vertices=12)
    o = bpy.context.active_object
    o.name = name
    from mathutils import Matrix
    o.data.transform(Matrix.Translation((0, 0, -length / 2)))
    o.data.materials.append(mat)
    paint(o, color)
    o.location = loc
    return o

def prim_torus(name, color, mat, major, minor, loc):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(mat)
    paint(o, color)
    return o

def select_only(*objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0] if objs else None

def join_all(dst, parts):
    select_only(dst, *parts)
    bpy.context.view_layer.objects.active = dst
    bpy.ops.object.join()
    return dst

def apply_tr(o):
    select_only(o)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# ---------------------------------------------------------------- Body (Leonidas-Proportionen)
def build_body(mat):
    SKIN = (0.98, 0.85, 0.72)
    RED = (0.85, 0.20, 0.17)
    DRED = (0.72, 0.14, 0.12)
    YEL = (1.00, 0.78, 0.18)
    NAVY = (0.16, 0.20, 0.32)
    DARK = (0.09, 0.09, 0.12)
    parts = []
    for side in (-1, 1):
        leg = prim_cyl(f'leg_{side}', NAVY, mat, 0.078, 0.50, (0.115 * side, 0, 0.55))
        boot = prim_cube(f'boot_{side}', DARK, mat, (0.17, 0.24, 0.10), (0.115 * side, -0.012, 0.06), bevel=0.02)
        parts += [leg, boot]
        arm = prim_cyl(f'arm_{side}', RED, mat, 0.062, 0.42, (0.285 * side, 0, 1.04))
        hand = prim_sphere(f'hand_{side}', SKIN, mat, 0.066, (0.285 * side, 0, 0.62))
        parts += [arm, hand]
    parts.append(prim_cube('torso', RED, mat, (0.52, 0.34, 0.55), (0, 0, 0.83), bevel=0.05))
    parts.append(prim_torus('stripe', YEL, mat, 0.275, 0.032, (0, 0, 0.86)))
    parts.append(prim_cyl('tank', DRED, mat, 0.088, 0.30, (0, 0.235, 0.84)))
    parts.append(prim_torus('collar', YEL, mat, 0.115, 0.022, (0, 0, 1.11)))
    parts.append(prim_sphere('head', SKIN, mat, 0.20, (0, 0, 1.30)))
    parts.append(prim_cube('badge', YEL, mat, (0.07, 0.015, 0.10), (0, -0.185, 0.95), bevel=0.01))
    body = join_all(parts[0], parts[1:])
    body.name = 'Body'
    apply_tr(body)
    return body

def build_hat(mat):
    DRED = (0.72, 0.14, 0.12)
    YEL = (1.00, 0.78, 0.18)
    helm = prim_sphere('helmet', DRED, mat, 0.25, (0, 0, 1.44), rings=10, scale=(1, 1, 0.72))
    brim = prim_torus('brim', YEL, mat, 0.252, 0.030, (0, 0, 1.44))
    hat = join_all(helm, [brim])
    hat.name = 'Hat_helmet'
    apply_tr(hat)
    return hat

# ---------------------------------------------------------------- Armature
BONES = [  # (name, head, tail, parent)
    ('root', (0, 0, 0), (0, 0, 0.10), None),
    ('pelvis', (0, 0, 0.72), (0, 0, 0.90), 'root'),
    ('spine', (0, 0, 0.90), (0, 0, 1.02), 'pelvis'),
    ('chest', (0, 0, 1.02), (0, 0, 1.16), 'spine'),
    ('neck', (0, 0, 1.16), (0, 0, 1.24), 'chest'),
    ('head', (0, 0, 1.24), (0, 0, 1.48), 'neck'),
    ('clavicle.L', (0, 0, 1.12), (0.20, 0, 1.10), 'chest'),
    ('clavicle.R', (0, 0, 1.12), (-0.20, 0, 1.10), 'chest'),
    ('upperarm.L', (0.22, 0, 1.08), (0.285, 0, 0.84), 'clavicle.L'),
    ('upperarm.R', (-0.22, 0, 1.08), (-0.285, 0, 0.84), 'clavicle.R'),
    ('forearm.L', (0.285, 0, 0.84), (0.29, 0, 0.63), 'upperarm.L'),
    ('forearm.R', (-0.285, 0, 0.84), (-0.29, 0, 0.63), 'upperarm.R'),
    ('hand.L', (0.29, 0, 0.63), (0.29, 0, 0.53), 'forearm.L'),
    ('hand.R', (-0.29, 0, 0.63), (-0.29, 0, 0.53), 'forearm.R'),
    ('thigh.L', (0.115, 0, 0.55), (0.115, 0, 0.30), 'pelvis'),
    ('thigh.R', (-0.115, 0, 0.55), (-0.115, 0, 0.30), 'pelvis'),
    ('shin.L', (0.115, 0, 0.30), (0.115, 0, 0.06), 'thigh.L'),
    ('shin.R', (-0.115, 0, 0.30), (-0.115, 0, 0.06), 'thigh.R'),
    ('foot.L', (0.115, 0, 0.06), (0.115, -0.16, 0.06), 'shin.L'),
    ('foot.R', (-0.115, 0, 0.06), (-0.115, -0.16, 0.06), 'shin.R'),
]

def build_armature():
    bpy.ops.object.armature_add(enter_editmode=True, location=(0, 0, 0))
    rig = bpy.context.active_object
    rig.name = 'Rig'
    eb = rig.data.edit_bones
    eb.remove(eb[0])
    created = {}
    for name, head, tail, parent in BONES:
        b = eb.new(name)
        b.head = head
        b.tail = tail
        created[name] = b
    for name, head, tail, parent in BONES:
        if parent:
            created[name].parent = created[parent]
    bpy.ops.object.mode_set(mode='OBJECT')
    return rig

def repair_weights(body, rig, radius=0.30):
    """Heat lässt Bones ohne nahes Volumen ohne Group (z.B. spine im Torso).
    Fehlende Deform-Bones bekommen distanzbasierte Weights, danach Normalize."""
    import numpy as np
    # Heat legt oft LEERE Groups an -> als fehlend werten (max Weight < 1%).
    maxw = {}
    for v in body.data.vertices:
        for g in v.groups:
            if g.weight > maxw.get(g.group, 0.0):
                maxw[g.group] = g.weight
    have = {g.name for g in body.vertex_groups if maxw.get(g.index, 0.0) >= 0.01}
    bones = rig.data.bones
    verts = body.data.vertices
    co = np.empty(len(verts) * 3)
    body.data.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    fixed = []
    for b in bones:
        if b.name in have or b.use_deform is False:
            continue
        h = np.array(b.head_local)
        t = np.array(b.tail_local)
        seg = t - h
        L2 = float(np.dot(seg, seg)) or 1e-9
        proj = np.clip(((co - h) @ seg) / L2, 0.0, 1.0)
        d = np.linalg.norm(co - (h + proj[:, None] * seg), axis=1)
        w = np.clip(1.0 - d / radius, 0.0, 1.0)
        idx = np.where(w > 0.01)[0]
        if len(idx) == 0:
            continue
        grp = body.vertex_groups.get(b.name) or body.vertex_groups.new(name=b.name)
        for i in idx:
            grp.add([int(i)], float(w[i]), 'REPLACE')
        fixed.append(b.name)
    if fixed:
        select_only(body)
        bpy.ops.object.vertex_group_normalize_all()
        log('repair:', ', '.join(fixed))
    return fixed

def skin(body, rig, hat):
    select_only(body, rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    repair_weights(body, rig)
    hat.parent = rig
    hat.parent_type = 'BONE'
    hat.parent_bone = 'head'
    log('skinned:', body.name, '+ hat@head')

# ---------------------------------------------------------------- Main
def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mat = mat_simple()
    body = build_body(mat)
    hat = build_hat(mat)
    rig = build_armature()
    skin(body, rig, hat)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, 'models', 'leonidas_rig.blend'))
    select_only(rig, body, hat)
    bpy.context.view_layer.objects.active = rig
    fbx = os.path.join(FBXD, 'leonidas_rig.fbx')
    bpy.ops.export_scene.fbx(filepath=fbx, use_selection=True, add_leaf_bones=False,
                              primary_bone_axis='Y', secondary_bone_axis='X',
                              bake_anim=False, global_scale=100.0)
    log('FBX ok:', fbx)

main()
