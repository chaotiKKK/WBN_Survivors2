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

        # XP / Level-Up: xpFor(l)=floor(5+l*4+l*l*0.85) -> L1:9, L2:16, L3:24
        if player is not None:
            check('xp-start', player.get_wbn_level() == 1 and player.get_xp() == 0, f"L{player.get_wbn_level()} xp={player.get_xp()}")
            check('xp-next-1', player.get_xp_next() == 9, f"{player.get_xp_next()}")
            player.add_xp(9)
            check('levelup-1', player.get_wbn_level() == 2 and player.get_xp() == 0 and player.get_xp_next() == 16,
                  f"L{player.get_wbn_level()} xp={player.get_xp()} next={player.get_xp_next()}")
            check('dmg-mult-2', abs(player.get_damage_mult() - 1.1) < 0.001, f"{player.get_damage_mult()}")
            check('dsync-on-player', wpn is not None and abs(wpn.get_damage_scale() - 1.1) < 0.001,
                  f"scale={wpn.get_damage_scale() if wpn else None}")
            player.add_xp(19)
            check('levelup-2', player.get_wbn_level() == 3 and player.get_xp() == 3 and player.get_xp_next() == 24,
                  f"L{player.get_wbn_level()} xp={player.get_xp()} next={player.get_xp_next()}")
            check('dmg-mult-3', abs(player.get_damage_mult() - 1.2) < 0.001, f"{player.get_damage_mult()}")

        # GrantKill: runner xp=1 auf frischem Spieler.
        p2 = unreal.EditorLevelLibrary.spawn_actor_from_class(
            unreal.WBNPlayerCharacter, unreal.Vector(100, 0, 90), unreal.Rotator(0, 0, 0))
        check('xp-player2', p2 is not None and p2.get_xp() == 0)
        if p2 is not None and enemy_asset is not None:
            p2.grant_kill(enemy_asset)
            check('grant-kill', p2.get_xp() == 1 and p2.get_wbn_level() == 1,
                  f"xp={p2.get_xp()} L={p2.get_wbn_level()}")
            p2.grant_kill(enemy_asset)
            p2.grant_kill(enemy_asset)
            check('grant-multi', p2.get_xp() == 3, f"xp={p2.get_xp()}")
    except Exception as e:
        unreal.log_error(f'[wbn_combat] FEHLER: {e}')
        note(f'FEHLER: {e}')
        FAILS.append('exception')

    note(f'RESULTAT: {"ALL PASS" if not FAILS else "FEHLER: " + ", ".join(FAILS)}')
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('\n'.join(LINES) + '\n')


main()