#!/usr/bin/env python3
"""Sprite-Drift-Audit (CI): prueft alle Sheet-Tripel in models/sheets gegen
die Layout-Vorgaben von tools/embed_char_sprites.js.

Regeln:
  1. Layout: idle 4x1, walk 3x2, punch 4x1 — Zellen exakt 128x128 px
     (CELL in tools/cutout_rig.py), Sheets exakt Zellen * Spalten/Zeilen.
  2. Inhalt: jede Zelle hat genug opake Pixel (>60 Alpha), keine leeren
     oder halb gefressen Zellen.
  3. Grounding: Fuesse muessen in die untersten 10 % der Zelle reichen.
     Walk-Zyklen duerfen in genau EINEM Frame (Mid-Stride) abheben.

Exit 1 bei jedem Verstoess — im CI direkt nach dem Build-Sync-Check.
Aufruf: python tools/sprite_audit.py [sheet-dir]
"""
import glob
import os
import sys

from PIL import Image

EXPECT = {'idle': (4, 1), 'walk': (3, 2), 'punch': (4, 1)}
CELL = 128          # muss CELL aus cutout_rig.py entsprechen
MIN_OPAQUE = 500    #Minimum echte Pixel pro 128er-Zelle
FOOT_ROWS = max(4, round(CELL * 0.10))   # unterste 10% = Fusszone
WALK_LIFT_ALLOWANCE = 1                  # ein Mid-Stride-Frame darf abheben


def audit_sheet(path, anim):
    """Liefert Liste von Fehlern fuer ein Sheet."""
    cols, rows = EXPECT[anim]
    errors = []
    im = Image.open(path).convert('RGBA')
    cw, ch = im.width // cols, im.height // rows
    if (cw, ch) != (CELL, CELL) or im.size != (cw * cols, ch * rows):
        return [f'{path}: Groesse {im.size}, erwartet '
                f'{CELL * cols}x{CELL * rows} ({cols}x{rows} Zellen a {CELL}px)']
    lifted = 0
    for i in range(cols * rows):
        x0, y0 = (i % cols) * cw, (i // cols) * ch
        cell = im.crop((x0, y0, x0 + cw, y0 + ch))
        px = list(cell.getdata())
        opaque = sum(1 for q in px if q[3] > 60)
        if opaque < MIN_OPAQUE:
            errors.append(f'{path} Zelle {i}: nur {opaque} opake Pixel '
                          f'(min {MIN_OPAQUE}) — leere/kaputte Zelle')
            continue
        feet = sum(1 for q in px[-FOOT_ROWS * cw:] if q[3] > 60)
        if feet == 0:
            lifted += 1
    allowed = WALK_LIFT_ALLOWANCE if anim == 'walk' else 0
    if lifted > allowed:
        errors.append(f'{path}: {lifted} Zelle(n) ohne Fusskontakt '
                      f'(erlaubt: {allowed} Mid-Stride-Frame(s))')
    return errors


def main():
    sheet_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.dirname(os.path.abspath(__file__)), '..', 'models', 'sheets')
    chars = sorted({os.path.basename(f)[:-9]
                    for f in glob.glob(os.path.join(sheet_dir, '*_idle.png'))})
    if not chars:
        print('sprite_audit: keine Sheets gefunden in', sheet_dir)
        return 1
    errors = []
    for c in chars:
        for a in EXPECT:
            p = os.path.join(sheet_dir, f'{c}_{a}.png')
            if not os.path.exists(p):
                errors.append(f'{p}: FEHLT (Sheet-Tripel unvollstaendig)')
                continue
            errors.extend(audit_sheet(p, a))
    status = 'OK' if not errors else 'FEHLER'
    print(f'sprite_audit: {len(chars)} Charaktere, '
          f'{len(chars) * 3} Sheets — {status}')
    for e in errors:
        print('  ' + e)
    return 0 if not errors else 1


if __name__ == '__main__':
    sys.exit(main())
