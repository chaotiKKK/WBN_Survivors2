#!/usr/bin/env python3
# Blender-Headless-Pipeline fuer Leonidas + Sylvia:
#   - Low-Poly-Figuren aus Primitiven, Vertexfarben, ein Material
#   - Smart-UV + Diffuse-Color-Bake -> echte Textur
#   - Ortho-Frontal-Render: idle(4) / walk(6) / punch(4) Frames -> 96px-Sheets
#   - GLB-Export (statisch, texturiert) + .blend-Ablage
# Aufruf: blender.exe -b --factory-startup -P tools/blender_chars.py -- <repo-root>
import bpy, bmesh, math, os, sys
import numpy as np

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ROOT = ARGS[0] if ARGS else os.getcwd()
MODELS = os.path.join(ROOT, 'models')
RENDERS = os.path.join(MODELS, 'renders')
SHEETS = os.path.join(MODELS, 'sheets')
BAKES = os.path.join(MODELS, 'bakes')
GLBS = os.path.join(MODELS, 'glb')
for d in (MODELS, RENDERS, SHEETS, BAKES, GLBS):
    os.makedirs(d, exist_ok=True)

CELL = 96          # Sheet-Zelle in px (Spiel normalisiert auf 96 -> S=1, kein Upscale-Flackern)
ORTHO = 2.4        # Welt-Einheiten pro Zelle -> ~40 px/Einheit, Figur ~62-66 px hoch
BAKE_RES = 512

def log(*a):
    print('[blender_chars]', *a)

# ---------------------------------------------------------------- Szene-Setup
def setup_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scn = bpy.context.scene
    scn.render.engine = 'CYCLES'
    scn.cycles.device = 'CPU'
    scn.cycles.samples = 32
    scn.cycles.use_denoising = False
    scn.cycles.max_bounces = 0
    scn.render.resolution_x = CELL
    scn.render.resolution_y = CELL
    scn.render.resolution_percentage = 100
    scn.render.film_transparent = True
    scn.render.image_settings.file_format = 'PNG'
    scn.render.image_settings.color_mode = 'RGBA'
    scn.view_settings.view_transform = 'Standard'

    cam_data = bpy.data.cameras.new('FrontCam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = ORTHO
    cam = bpy.data.objects.new('FrontCam', cam_data)
    scn.collection.objects.link(cam)
    # Numpad-1-Frontalansicht: von -Y auf die Figur schauen, Up = +Z.
    # Zentrum bei ORTHO/2 => untere Bildkante = z 0 = Fuesse (Boden-Verankerung).
    cam.location = (0, -4, ORTHO / 2)
    cam.rotation_euler = (math.radians(90), 0, 0)
    scn.camera = cam

    world = bpy.data.worlds.new('W')
    scn.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs[0].default_value = (1, 1, 1, 1)
    bg.inputs[1].default_value = 0.75   # >1.0 + Sonne klammert alles auf Weiss
    sun_data = bpy.data.lights.new('Sun', 'SUN')
    sun_data.energy = 0.45
    sun_data.angle = math.radians(40)
    sun = bpy.data.objects.new('Sun', sun_data)
    scn.collection.objects.link(sun)
    sun.location = (2, -3, 5)
    d = sun.location
    sun.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return scn

# ---------------------------------------------------------------- Bau-Helfer
def make_mat():
    mat = bpy.data.materials.new('CharMat')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.9
    # Vertexfarben (pro Kante/Ecke gesetzt) als Base Color — Grundlage fuer den Bake.
    vc = nt.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'col'
    nt.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
    return mat

def paint(obj, rgb):
    mesh = obj.data
    ca = mesh.color_attributes.new(name='col', type='BYTE_COLOR', domain='CORNER')
    n = len(mesh.loops)
    buf = np.empty(n * 4, dtype=np.float32)
    buf[0::4] = rgb[0]; buf[1::4] = rgb[1]; buf[2::4] = rgb[2]; buf[3::4] = 1.0
    ca.data.foreach_set('color', buf)
    mesh.update()

def new_obj(name, color, mat):
    obj = bpy.data.objects.new(name, bpy.data.meshes.new(name))
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(mat)
    paint(obj, color)
    return obj

def cube(name, color, size, loc, mat, bevel=0.035):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (size[0], size[1], size[2])
    bpy.ops.object.transform_apply(scale=True)
    if bevel > 0:
        mod = obj.modifiers.new('bev', 'BEVEL')
        mod.width = bevel; mod.segments = 3; mod.limit_method = 'ANGLE'; mod.angle_limit = math.radians(50)
    for p in obj.data.polygons: p.use_smooth = True
    paint(obj, color)
    obj.data.materials.append(mat)
    return obj

def cyl(name, color, r, depth, loc, mat, verts=24):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, vertices=verts, location=loc)
    obj = bpy.context.active_object
    obj.name = name
    for p in obj.data.polygons: p.use_smooth = True
    paint(obj, color)
    obj.data.materials.append(mat)
    return obj

def sphere(name, color, r, loc, mat, scale=(1, 1, 1), segments=20, rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=segments, ring_count=rings, location=loc)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    for p in obj.data.polygons: p.use_smooth = True
    paint(obj, color)
    obj.data.materials.append(mat)
    return obj

def torus(name, color, major, minor, loc, mat):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, location=loc)
    obj = bpy.context.active_object
    obj.name = name
    for p in obj.data.polygons: p.use_smooth = True
    paint(obj, color)
    obj.data.materials.append(mat)
    return obj

def hemisphere_up(obj, z_cut):
    bm = bmesh.new(); bm.from_mesh(obj.data)
    for v in [v for v in bm.verts if v.co.z < z_cut]:
        bm.verts.remove(v)
    bm.to_mesh(obj.data); bm.free()
    obj.data.update()

def uv_project(obj):
    if not obj.data.uv_layers:
        obj.data.uv_layers.new(name='UVMap')
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT')

def join(dst, src):
    bpy.ops.object.select_all(action='DESELECT')
    dst.select_set(True); src.select_set(True)
    bpy.context.view_layer.objects.active = dst
    bpy.ops.object.join()
    return dst

def limb(name, color, mat, r, length, pivot, hand=None, hand_color=None):
    """Arm/Bein: Zylinder mit Ursprung im Pivot, Hand/Knauf unten."""
    obj = cyl(name, color, r, length, (0, 0, 0), mat)
    mesh = obj.data
    mesh.transform(__import__('mathutils', fromlist=['Matrix']).Matrix.Translation((0, 0, -length / 2)))
    if hand:
        hand_obj = sphere(name + '_hand', hand_color or color, hand, (0, 0, -length), mat)
        obj = join(obj, hand_obj)
    obj.location = pivot
    return obj

# ---------------------------------------------------------------- Figuren
def build_leonidas(mat):
    SKIN   = (0.98, 0.85, 0.72)
    RED    = (0.85, 0.20, 0.17)
    DRED   = (0.72, 0.14, 0.12)
    YEL    = (1.00, 0.78, 0.18)
    NAVY   = (0.16, 0.20, 0.32)
    DARK   = (0.09, 0.09, 0.12)
    P = {}
    root = bpy.data.objects.new('root', None)
    bpy.context.scene.collection.objects.link(root)

    def leg(side):
        l = limb(f'leg{side}', NAVY, mat, 0.078, 0.50, (0.115 * side, 0, 0.55))
        boot = cube(f'boot{side}', DARK, (0.17, 0.24, 0.10), (0, -0.012, -0.49), mat, bevel=0.02)
        join(l, boot)
        l.parent = root
        return l
    P['legL'] = leg(-1); P['legR'] = leg(1)

    torso = cube('torso', RED, (0.52, 0.34, 0.55), (0, 0, 0.83), mat, bevel=0.05)
    torso.parent = root; P['torso'] = torso
    stripe = torus('stripe', YEL, 0.275, 0.032, (0, 0, 0.86), mat)
    stripe.parent = torso; P['stripe'] = stripe
    tank = cyl('tank', DRED, 0.088, 0.30, (0, 0.235, 0.84), mat)
    tank.parent = torso; P['tank'] = tank
    collar = torus('collar', YEL, 0.115, 0.022, (0, 0, 1.11), mat)
    collar.parent = torso; P['collar'] = collar

    head = sphere('head', SKIN, 0.20, (0, 0, 1.30), mat)
    head.parent = torso; P['head'] = head
    helmet = sphere('helmet', DRED, 0.25, (0, 0, 1.44), mat, scale=(1, 1, 0.72), rings=10)
    hemisphere_up(helmet, 1.44)
    helmet.parent = torso; P['helmet'] = helmet
    brim = torus('brim', YEL, 0.252, 0.030, (0, 0, 1.44), mat)
    brim.parent = torso; P['brim'] = brim
    badge = cube('badge', YEL, (0.07, 0.015, 0.10), (0, -0.185, 0.95), mat, bevel=0.01)
    badge.parent = torso; P['badge'] = badge

    def arm(side):
        a = limb(f'arm{side}', RED, mat, 0.062, 0.42, (0.285 * side, 0, 1.04), hand=0.066, hand_color=SKIN)
        a.parent = torso
        return a
    P['armL'] = arm(-1); P['armR'] = arm(1)
    return P, root

def build_sylvia(mat):
    SKIN   = (0.99, 0.87, 0.76)
    PINK   = (0.98, 0.44, 0.56)
    ROSE   = (0.66, 0.22, 0.32)
    HAIR   = (0.93, 0.76, 0.42)
    WHITE  = (0.92, 0.92, 0.94)
    CROSS  = (0.90, 0.18, 0.24)
    P = {}
    root = bpy.data.objects.new('root', None)
    bpy.context.scene.collection.objects.link(root)

    def leg(side):
        l = limb(f'leg{side}', ROSE, mat, 0.066, 0.55, (0.10 * side, 0, 0.58))
        shoe = cube(f'shoe{side}', WHITE, (0.15, 0.21, 0.07), (0, -0.015, -0.545), mat, bevel=0.015)
        join(l, shoe)
        l.parent = root
        return l
    P['legL'] = leg(-1); P['legR'] = leg(1)

    skirt = cyl('skirt', ROSE, 0.26, 0.16, (0, 0, 0.655), mat, verts=20)
    skirt.parent = root; P['skirt'] = skirt
    torso = cube('torso', PINK, (0.44, 0.28, 0.50), (0, 0, 0.97), mat, bevel=0.045)
    torso.parent = root; P['torso'] = torso

    head = sphere('head', SKIN, 0.19, (0, 0, 1.40), mat)
    head.parent = torso; P['head'] = head
    hair = sphere('hair', HAIR, 0.215, (0, 0.05, 1.425), mat, rings=10)
    hair.parent = torso; P['hair'] = hair
    bun = sphere('bun', HAIR, 0.088, (0, 0.03, 1.64), mat)
    bun.parent = torso; P['bun'] = bun

    satchel = cube('satchel', WHITE, (0.17, 0.14, 0.17), (0.20, 0.03, 0.80), mat, bevel=0.015)
    satchel.parent = root; P['satchel'] = satchel
    ch = cube('crossH', CROSS, (0.11, 0.012, 0.032), (0.20, -0.073, 0.805), mat, bevel=0.004)
    ch.parent = root; P['crossH'] = ch
    cv = cube('crossV', CROSS, (0.032, 0.012, 0.11), (0.20, -0.073, 0.805), mat, bevel=0.004)
    cv.parent = root; P['crossV'] = cv

    def arm(side):
        a = limb(f'arm{side}', PINK, mat, 0.056, 0.44, (0.26 * side, 0, 1.14), hand=0.060, hand_color=SKIN)
        a.parent = torso
        return a
    P['armL'] = arm(-1); P['armR'] = arm(1)
    return P, root

# ---------------------------------------------------------------- Bake
def bake_texture(parts, mat, cid):
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts.values():
        if o.type == 'MESH':
            uv_project(o); o.select_set(True)
    bpy.context.view_layer.objects.active = list(parts.values())[0]
    scn = bpy.context.scene
    scn.cycles.samples = 1
    img = bpy.data.images.new(f'bake_{cid}', BAKE_RES, BAKE_RES, alpha=False)
    nt = mat.node_tree
    img_node = nt.nodes.new('ShaderNodeTexImage')
    img_node.image = img
    img_node.select = True
    nt.nodes.active = img_node
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, margin=8, use_clear=True)
    img.filepath_raw = os.path.join(BAKES, f'{cid}_bake.png')
    img.file_format = 'PNG'
    img.save()
    # Material auf gebackene Textur umschalten (Vertexfarben-Link loesen)
    vc_node = next((n for n in nt.nodes if n.type == 'VERTEX_COLOR'), None)
    for l in list(nt.links):
        if l.to_node == nt.nodes['Principled BSDF'] and l.to_socket.name == 'Base Color':
            nt.links.remove(l)
    nt.links.new(img_node.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])
    scn.cycles.samples = 32
    log(f'bake ok: {img.filepath_raw}')
    return img

# ---------------------------------------------------------------- Posen
def lerp_keys(keys, t):
    for (t0, v0), (t1, v1) in zip(keys, keys[1:]):
        if t0 <= t <= t1:
            k = 0 if t1 == t0 else (t - t0) / (t1 - t0)
            return v0 + (v1 - v0) * k
    return keys[-1][1]

TAU = math.tau
def pose(parts, root, anim, t, kind):
    s = math.sin(TAU * t)
    for o in parts.values():
        o.rotation_euler = (0, 0, 0)
    root.location = (0, 0, 0)
    if anim == 'idle':
        root.location.z = 0.012 * s
        parts['armL'].rotation_euler.x = 0.05 * s
        parts['armR'].rotation_euler.x = -0.05 * s
        parts['head'].rotation_euler.x = 0.05 * s
        parts['torso'].rotation_euler.y = 0.02 * s
    elif anim == 'walk':
        amp = 0.55 if kind == 'leonidas' else 0.46
        parts['legL'].rotation_euler.x = amp * s
        parts['legR'].rotation_euler.x = -amp * s
        parts['armL'].rotation_euler.x = -0.62 * amp * s
        parts['armR'].rotation_euler.x = 0.62 * amp * s
        root.location.z = 0.028 * abs(math.cos(TAU * t)) - 0.008
        parts['torso'].rotation_euler.x = 0.055
        parts['torso'].rotation_euler.y = 0.05 * s
        parts['head'].rotation_euler.x = -0.03
    else:  # punch
        if kind == 'leonidas':
            arm = lerp_keys([(0, 0.55), (0.25, -1.25), (0.60, -1.25), (0.92, 0.0), (1, 0.55)], t)
            parts['armR'].rotation_euler.x = arm
            parts['armL'].rotation_euler.x = lerp_keys([(0, -0.35), (0.25, 0.25), (0.60, 0.25), (0.92, -0.1), (1, -0.35)], t)
        else:
            arm = lerp_keys([(0, 0.30), (0.25, -1.35), (0.60, -1.35), (0.92, 0.0), (1, 0.30)], t)
            parts['armL'].rotation_euler.x = arm
            parts['armR'].rotation_euler.x = arm
        parts['torso'].rotation_euler.x = lerp_keys([(0, 0.0), (0.25, 0.16), (0.60, 0.16), (0.92, 0.02), (1, 0.0)], t)
        root.location.z = -0.01

# ---------------------------------------------------------------- Render + Sheets
def load_px(path):
    im = bpy.data.images.load(path)
    im.colorspace_settings.name = 'Non-Color'
    w, h = im.size
    buf = np.empty(w * h * 4, dtype=np.float32)
    im.pixels.foreach_get(buf)
    bpy.data.images.remove(im)
    return buf.reshape(h, w, 4)

def write_sheet(frames, cols, rows, path):
    W, H = cols * CELL, rows * CELL
    out = np.zeros((H, W, 4), dtype=np.float32)
    for i, arr in enumerate(frames):
        c, r = i % cols, i // cols
        out[(rows - 1 - r) * CELL:(rows - r) * CELL, c * CELL:(c + 1) * CELL] = arr
    im = bpy.data.images.new('sheet', W, H, alpha=True)
    im.colorspace_settings.name = 'Non-Color'
    im.pixels.foreach_set(out.ravel())
    im.filepath_raw = path
    im.file_format = 'PNG'
    im.save()
    bpy.data.images.remove(im)

ANIMS = {'idle': (4, 4, 1), 'walk': (6, 3, 2), 'punch': (4, 4, 1)}

def render_anim(scn, parts, root, cid, anim, n, cols, rows, kind):
    rdir = os.path.join(RENDERS, cid, anim)
    os.makedirs(rdir, exist_ok=True)
    frames = []
    for i in range(n):
        t = i / n
        pose(parts, root, anim, t, kind)
        scn.render.filepath = os.path.join(rdir, f'{i}.png')
        bpy.ops.render.render(write_still=True)
        frames.append(load_px(scn.render.filepath))
    write_sheet(frames, cols, rows, os.path.join(SHEETS, f'{cid}_{anim}.png'))
    log(f'sheet ok: {cid}_{anim} ({cols}x{rows}, {n} frames)')

# ---------------------------------------------------------------- Hauptprogramm
def run_character(cid, builder, kind):
    scn = setup_scene()
    mat = make_mat()
    parts, root = builder(mat)
    bpy.context.view_layer.update()
    bake_texture(parts, mat, cid)
    for anim, (n, cols, rows) in ANIMS.items():
        render_anim(scn, parts, root, cid, anim, n, cols, rows, kind)
    # GLB (statisch, texturiert)
    try:
        bpy.ops.object.select_all(action='DESELECT')
        for o in parts.values():
            o.select_set(True)
        bpy.context.view_layer.objects.active = list(parts.values())[0]
        bpy.ops.export_scene.gltf(filepath=os.path.join(GLBS, f'{cid}.glb'),
                                  export_format='GLB', use_selection=True,
                                  export_apply=True, export_materials='EXPORT')
        log(f'glb ok: {cid}.glb')
    except Exception as e:
        log(f'glb failed ({cid}): {e}')
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(MODELS, f'{cid}.blend'), compress=True)
    log(f'blend saved: {cid}.blend')

run_character('leonidas', build_leonidas, 'leonidas')
run_character('sylvia', build_sylvia, 'sylvia')
log('DONE')
