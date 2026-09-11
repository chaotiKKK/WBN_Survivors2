#!/usr/bin/env python3
# Verifiziert models/fbx/leonidas_rig.fbx per Frisch-Reimport:
# Armature + erwartete Bones, Body mit Skin-Weights, Hut vorhanden.
# Exit 0 = PASS, Exit 1 = FAIL. Aufruf wie blender_chars_v2.py.
import bpy, os, sys

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ROOT = ARGS[0] if ARGS else os.getcwd()
FBX = os.path.join(ROOT, 'models', 'fbx', 'leonidas_rig.fbx')

EXPECT_BONES = {'root', 'pelvis', 'spine', 'chest', 'neck', 'head',
                'clavicle.L', 'clavicle.R', 'upperarm.L', 'upperarm.R',
                'forearm.L', 'forearm.R', 'hand.L', 'hand.R',
                'thigh.L', 'thigh.R', 'shin.L', 'shin.R', 'foot.L', 'foot.R'}
DEFORM_MIN = {'upperarm.L', 'forearm.L', 'thigh.L', 'shin.L', 'spine', 'head'}

fails = []


def check(cond, msg):
    print(('PASS' if cond else 'FAIL') + '  ' + msg)
    if not cond:
        fails.append(msg)


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=FBX)

rigs = [o for o in bpy.data.objects if o.type == 'ARMATURE']
check(len(rigs) == 1, f'genau 1 Armature (gefunden: {len(rigs)})')
bones = set()
if rigs:
    bones = {b.name for b in rigs[0].data.bones}
    check(bones == EXPECT_BONES, f'21 Bones exakt (diff: {bones ^ EXPECT_BONES})')

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
check(len(meshes) >= 2, f'mind. 2 Meshes Body+Hut (gefunden: {len(meshes)})')
body = next((m for m in meshes if 'body' in m.name.lower()), None)
check(body is not None, 'Body-Mesh gefunden')
if body:
    nv = len(body.data.vertices)
    check(nv > 200, f'Body hat Substanz ({nv} Verts)')
    groups = {g.name for g in body.vertex_groups}
    check(DEFORM_MIN <= groups, f'Deform-Weights vorhanden (fehlt: {DEFORM_MIN - groups})')
    # min. ein Vert mit echtem Gewicht auf Kern-Bones
    vg_idx = {g.index: g.name for g in body.vertex_groups}
    used = set()
    for v in body.data.vertices:
        for g in v.groups:
            if g.weight > 0.01:
                used.add(vg_idx[g.group])
    check(DEFORM_MIN <= used, f'Weights aktiv genutzt (fehlt: {DEFORM_MIN - used})')

print(f'\nCheck: {"OK" if not fails else str(len(fails)) + " FEHLER"}')
sys.exit(1 if fails else 0)
