# Prueft die importierten Leonidas-Assets (headless lesbar):
# Body/Hut ladbar, gleiches Skeleton, 21 Bones, Koerpergroesse plausibel.
# HINWEIS: Bone-Namen sind per Python nicht lesbar (FBoneNode opak);
# der Assembler prueft sie zur Laufzeit (Warnung bei Mismatch, sichtbarer
# Fallback auf Root). Blender-Seite: 21 exakte Namen per Check verifiziert.
# Aufruf wie ue_import_rig.py.
import os
import unreal

OUT = os.path.join(os.path.dirname(__file__), 'verify_rig_out.txt')
LINES = []
FAILS = []


def check(cond, msg):
    line = f'[{"PASS" if cond else "FAIL"}]  {msg}'
    LINES.append(line)
    unreal.log(f'[wbn_verify] {line}')
    if not cond:
        FAILS.append(msg)


def main():
    base = '/Game/WBN/Chars/Leonidas'
    body = unreal.load_asset(f'{base}/leonidas_body.leonidas_body')
    hat = unreal.load_asset(f'{base}/leonidas_hat_helmet.leonidas_hat_helmet')
    check(body is not None, 'Body ladbar')
    check(hat is not None, 'Hut ladbar')
    if body and hat:
        same = (body.get_editor_property('skeleton') ==
                hat.get_editor_property('skeleton'))
        check(same, 'Body+Hut teilen ein Skeleton')
        tree = body.get_editor_property('skeleton').get_editor_property('bone_tree')
        check(len(tree) == 21, f'Skeleton hat 21 Bones ({len(tree)})')
        h = body.get_bounds().box_extent.z * 2.0 / 100.0
        check(1.2 < h < 1.9, f'Koerpergroesse plausibel ({h:.2f} m)')
    if FAILS:
        unreal.log_error(f'[wbn_verify] {len(FAILS)} FEHLER')
    else:
        unreal.log('[wbn_verify] OK')
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('\n'.join(LINES) + '\n')


main()
