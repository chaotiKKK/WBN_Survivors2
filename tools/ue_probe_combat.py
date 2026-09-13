# Headless-Verifikation des Kampf-Slices in LVL_kurpark (Editor-Welt, kein PIE).
# Gegner: FetchData/ApplyDamage/HP. Waffe: SetWeapon/FireAt -> Projektile erzeugt.
import os
import unreal

OUT = os.path.join(os.path.dirname(__file__), 'probe_combat_out.txt')
LINES = []
FAILS = []


def note(s):
    LINES.append(s)
    unreal.log(f'[wbn_combat] {s}')


def check(name, cond, extra=''):
    note(f'{"PASS" if cond else "FAIL"} {name}' + (f' ({extra})' if extra else ''))
    if not cond:
        FAILS.append(name)


def main():
    try:
        unreal.EditorLevelLibrary.new_level('/Game/WBN/Maps/LVL_kurpark')
        world = unreal.EditorLevelLibrary.get_editor_world()
        check('map-kurpark', world is not None)

        enemy_asset = unreal.load_asset('/Game/WBN/Data/Enemies/DA_Enemy_runner.DA_Enemy_runner')
        check('enemy-asset', enemy_asset is not None, str(enemy_asset))

        if enemy_asset is not None:
            enemy = unreal.EditorLevelLibrary.spawn_actor_from_class(
                unreal.WBNEnemyNPC, unreal.Vector(0, 60, 90), unreal.Rotator(0, 0, 0))
            check('enemy-spawn', enemy is not None)
            if enemy is not None:
                enemy.fetch_data(enemy_asset)
                hp0 = enemy.get_hp()
                check('enemy-hp>0', hp0 > 0, f'hp={hp0}')
                got_hit = enemy.apply_damage(1.0, unreal.Vector(1, 0, 0))
                hp1 = enemy.get_hp()
                check('enemy-not-dead-on-1dmg', not got_hit, f'hp nach 1dmg={hp1}')
                check('enemy-hp-lowered', hp1 == hp0 - 1, f'{hp0}->{hp1}')
                killed = enemy.apply_damage(hp1 + 999.0, unreal.Vector(1, 0, 0))
                check('enemy-killed', killed, 'Die() ausgeloest')

        player = unreal.EditorLevelLibrary.spawn_actor_from_class(
            unreal.WBNPlayerCharacter, unreal.Vector(0, 0, 90), unreal.Rotator(0, 0, 0))
        check('player-spawn', player is not None)
        wpn = None
        if player is not None:
            comps = player.get_components_by_class(unreal.WBNWeaponComponent)
            check('weapon-component', len(comps) == 1, f'{len(comps)}')
            if comps:
                wpn = comps[0]
            check('assembler-component', len(player.get_components_by_class(unreal.WBNCharAssembler)) == 1)

        pistol = unreal.load_asset('/Game/WBN/Data/Weapons/DA_Weapon_pistol.DA_Weapon_pistol')
        check('weapon-asset', pistol is not None, str(pistol))
        proj_before = len(unreal.EditorLevelLibrary.get_all_level_actors())
        if wpn is not None and pistol is not None:
            wpn.set_weapon(pistol, 0)
            w = wpn.get_weapon()
            check('weapon-set', w is not None and w.get_name() == 'DA_Weapon_pistol', str(w))
            wpn.fire_at(unreal.Vector(1, 0, 0))
            proj_after = len(unreal.EditorLevelLibrary.get_all_level_actors())
            check('projectile-spawned', proj_after > proj_before, f'{proj_before}->{proj_after}')
    except Exception as e:
        unreal.log_error(f'[wbn_combat] FEHLER: {e}')
        note(f'FEHLER: {e}')
        FAILS.append('exception')

    note(f'RESULTAT: {"ALL PASS" if not FAILS else "FEHLER: " + ", ".join(FAILS)}')
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('\n'.join(LINES) + '\n')


main()