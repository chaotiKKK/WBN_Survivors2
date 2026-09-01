#!/usr/bin/env python3
"""Rigged alle vorliegenden Kandidaten und waehlt automatisch den besten:
Bewertet Cutout-Qualitaet (Deckung, Beinbalance, Seitenverhaeltnis) und
erzeugt Sheets fuer models/sheets/<char>_{idle,walk,punch}.png.
Aufruf: python tools/batch_rig.py [char ...]   (ohne Argumente: alle)"""
import os, sys, glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cutout_rig import cutout, bbox_crop, normalize, split_parts, frames, sheet, ANIMS
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
PHOTOS = os.path.join(ROOT, 'models', 'photos')
SHEETS = os.path.join(ROOT, 'models', 'sheets')


def score(fig, parts):
    """Hoeher ist besser: ganze Figur, balancierte Beine, sinnvolle Masse.
    Straft graue Boden-Restslabs (unten breit + entsaettigt)."""
    n = {k: sum(1 for p in parts[k].getdata() if p[3] > 60) for k in parts}
    total = sum(n.values())
    fw0, fh0 = fig.size
    aw = sum(1 for x in range(fw0)
             if sum(1 for y in range(fh0) if fig.getpixel((x, y))[3] > 120) >= 3)
    if total < 350 or aw < 14: # leere/strummelige Reste (Cutout gefressen)
        return -1, n
    legBal = min(n['legL'], n['legR']) / max(1, max(n['legL'], n['legR']))
    headOK = 20 < n['head'] < 400
    a = fig.getchannel('A').point(lambda v: 255 if v > 40 else 0).getbbox()
    if not a:
        return -1, n
    ar = (a[2] - a[0]) / max(1, a[3] - a[1])   # Breite/Hoehe
    shape = 1.0 if 0.2 < ar < 0.75 else 0.0    # schlank = ganze Figur
    # Bodenslab-Penalty: untere 30% der Figur, entsaettigte (graue) Pixel
    w, h = fig.size
    y0 = round(h * .70)
    gray = 0
    for y in range(y0, h, 2):
        for x in range(0, w, 2):
            p = fig.getpixel((x, y))
            if p[3] > 60 and min(p[0], p[1], p[2]) > 70 \
                    and max(p[0], p[1], p[2]) - min(p[0], p[1], p[2]) < 40:
                gray += 1
    wedge = -min(2.0, gray / 250.0)
    # Grounding: die Fuesse muessen fast am Zellenboden liegen
    a2 = fig.getchannel('A')
    fw, fh = fig.size
    ap2 = a2.load()
    lastrow = max((y for y in range(fh)
                   if sum(1 for x in range(fw) if ap2[x, y] > 120) >= 3), default=-1)
    if lastrow < 88:
        wedge -= min(2.0, (88 - lastrow) / 10.0)
    elif lastrow >= 92:
        wedge += 0.4
    # Proportions-Penalty: Beine viel groesser als Torso -> Boden-/Glow-Slab
    prop = (n['legL'] + n['legR']) / max(1, n['torso'])
    if prop > 2.2:
        wedge -= min(1.5, (prop - 2.2) * 0.5)
    return legBal * 2 + shape + (0.5 if headOK else -1) + wedge, n


def rig(char, cand):
    raw = Image.open(cand)
    fig = normalize(bbox_crop(cutout(raw)))
    parts, pv = split_parts(fig)
    s, n = score(fig, parts)
    # Grounding-Metrik separat melden (fuer harte Vorauswahl)
    a2 = fig.getchannel('A')
    fw, fh = fig.size
    ap2 = a2.load()
    ground = max((y for y in range(fh)
                  if sum(1 for x in range(fw) if ap2[x, y] > 120) >= 3), default=-1)
    return s, fig, parts, pv, n, ground


if __name__ == '__main__':
    chars = sys.argv[1:] or sorted(os.listdir(PHOTOS))
    os.makedirs(SHEETS, exist_ok=True)
    for char in chars:
        cands = sorted(glob.glob(os.path.join(PHOTOS, char, 'kand_*.jpg')))
        if not cands:
            print(f'{char}: keine Kandidaten, uebersprungen')
            continue
        best = None
        grounded = []
        for c in cands:
            try:
                s, fig, parts, pv, n, ground = rig(char, c)
            except Exception as e:
                print(f'{char}: {os.path.basename(c)} FEHLER {e}')
                continue
            print(f'{char}: {os.path.basename(c)} score={s:.2f} ground={ground} parts={n}')
            if ground >= 90 and s >= 0:
                grounded.append((s, fig, parts, pv, c))
            if best is None or s > best[0]:
                best = (s, fig, parts, pv, c)
        if grounded:   # harte Vorauswahl: nur bodenverankerte Kandidaten
            best = max(grounded, key=lambda t: t[0])
        if not best or best[0] < 0:
            print(f'{char}: KEIN brauchbarer Kandidat')
            continue
        s, fig, parts, pv, c = best
        made = []
        for anim, (cols, rows, cnt) in ANIMS.items():
            fr = frames(anim, parts, pv)[:cnt]
            made.append(sheet(char, anim, fr, cols, rows, SHEETS))
        print(f'{char}: OK {os.path.basename(c)} score={s:.2f} -> {len(made)} Sheets')
