# Baut pro Arena eine Blockout-Map unter /Game/WBN/Maps/LVL_<id>.
# Nutzt die volle Editor-API (new_level/spawn) — headless lauffaehig, da kein
# C++-World-Hack noetig ist. Massstab: PX2UU=5 (Kurpark 1100px -> 55m).
# Aufruf: -run=pythonscript -script="tools/ue_build_arena.py"
import json
import os
import random
import unreal

OUT = os.path.join(os.path.dirname(__file__), 'build_arena_out.txt')
LINES = []
PX2UU = 5.0


def note(s):
    LINES.append(s)
    unreal.log(f'[wbn_arena] {s}')


def spawn_box(world, cube, pos, size, label, folder):
    actor = unreal.EditorLevelLibrary.spawn_actor_from_class(
        unreal.StaticMeshActor, unreal.Vector(*pos), unreal.Rotator(0, 0, 0))
    actor.set_actor_label(label)
    actor.set_folder_path(folder)
    comp = actor.get_component_by_class(unreal.StaticMeshComponent)
    comp.set_static_mesh(cube)
    comp.set_world_scale3d(unreal.Vector(size[0] / 100.0, size[1] / 100.0, size[2] / 100.0))
    comp.set_mobility(unreal.ComponentMobility.STATIC)
    return actor


def build_one(arena):
    aid = arena['id']
    w = float(arena.get('w', 1000)) * PX2UU
    h = float(arena.get('h', 850)) * PX2UU
    path = f'/Game/WBN/Maps/LVL_{aid}'
    unreal.EditorLevelLibrary.new_level(path)
    world = unreal.EditorLevelLibrary.get_editor_world()
    cube = unreal.load_asset('/Engine/BasicShapes/Cube.Cube')
    sun = unreal.EditorLevelLibrary.spawn_actor_from_class(
        unreal.DirectionalLight, unreal.Vector(0, 0, 0), unreal.Rotator(-50, -30, 0))
    sun.set_actor_label('Sun')
    start = unreal.EditorLevelLibrary.spawn_actor_from_class(
        unreal.PlayerStart, unreal.Vector(0, 0, 50), unreal.Rotator(0, 0, 0))
    start.set_actor_label('PlayerStart')

    spawn_box(world, cube, (0, 0, -50), (w, h, 100), 'Floor', 'Arena')
    wh, wt = 400.0, 100.0
    spawn_box(world, cube, (0, -h / 2, wh / 2), (w + wt * 2, wt, wh), 'Wall_N', 'Arena/Bounds')
    spawn_box(world, cube, (0, h / 2, wh / 2), (w + wt * 2, wt, wh), 'Wall_S', 'Arena/Bounds')
    spawn_box(world, cube, (-w / 2, 0, wh / 2), (wt, h, wh), 'Wall_W', 'Arena/Bounds')
    spawn_box(world, cube, (w / 2, 0, wh / 2), (wt, h, wh), 'Wall_E', 'Arena/Bounds')

    rng = random.Random(hash(aid) & 0xFFFFFFFF)

    def rxy(margin):
        return (rng.uniform(-w / 2 + margin, w / 2 - margin),
                rng.uniform(-h / 2 + margin, h / 2 - margin))

    n = 0
    for i in range(int(arena.get('buildings', 0))):
        x, y = rxy(900)
        spawn_box(world, cube, (x, y, rng.uniform(300, 1000)),
                  (rng.uniform(400, 1200), rng.uniform(400, 1200), rng.uniform(600, 2000)),
                  f'Building_{i}', 'Arena/Buildings')
        n += 1
    for i in range(int(arena.get('cover', 0))):
        x, y = rxy(500)
        spawn_box(world, cube, (x, y, rng.uniform(75, 250)),
                  (rng.uniform(150, 400), rng.uniform(150, 400), rng.uniform(150, 500)),
                  f'Cover_{i}', 'Arena/Cover')
        n += 1
    for i in range(int(arena.get('poison', 0))):
        x, y = rxy(600)
        spawn_box(world, cube, (x, y, 10),
                  (rng.uniform(300, 700), rng.uniform(300, 700), 20),
                  f'Poison_{i}', 'Arena/Hazards')
        n += 1
    for i in range(int(arena.get('speedField', 0))):
        x, y = rxy(600)
        spawn_box(world, cube, (x, y, 10),
                  (rng.uniform(300, 700), rng.uniform(300, 700), 20),
                  f'Speed_{i}', 'Arena/Hazards')
        n += 1
    for i in range(int(arena.get('movingWalls', 0))):
        x, y = rxy(800)
        spawn_box(world, cube, (x, y, 250),
                  (rng.uniform(800, 1500), 100, 500),
                  f'MovingWall_{i}', 'Arena/Hazards')
        n += 1
    unreal.EditorLevelLibrary.save_current_level()
    note(f'{aid}: {n} Boxen -> {path}')
    return True


def main():
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    try:
        with open(os.path.join(root, 'Unreal', 'Data', 'arenas.json'), encoding='utf-8') as f:
            arenas = json.load(f)
        count = 0
        for a in arenas:
            if build_one(a):
                count += 1
        note(f'OK: {count}/{len(arenas)} Maps gebaut')
    except Exception as e:
        unreal.log_error(f'[wbn_arena] FEHLER: {e}')
        note(f'FEHLER: {e}')
    finally:
        with open(OUT, 'w', encoding='utf-8') as f:
            f.write('\n'.join(LINES) + '\n')


main()
