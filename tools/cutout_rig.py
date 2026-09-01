#!/usr/bin/env python3
"""Fotocollage-Sprite-Pipeline: Cutout + Paper-Doll-Animation.

Schritte:
  1. Hintergrund-Entfernung (Flood-Fill von den Ecken, Gradienten-tolerant)
  2. Normalisierung: Fuesse unten, Figur fuellt die Zelle, zentriert
  3. Paper-Doll: Kopf/Arme/Beine an Proportionsgelenken vom Torso trennen
  4. Animationen: idle (4), walk (6), punch (4) -> Sheets mit 96px-Zellen
     Layouts wie tools/embed_char_sprites.js erwartet:
       idle 4x1, walk 3x2, punch 4x1

Aufruf:  python tools/cutout_rig.py <char> <kandidat.jpg> [outDir]
Ergebnis: models/sheets/<char>_{idle,walk,punch}.png + Vorschau-HTML
"""
import os, sys, math
from collections import deque
from PIL import Image, ImageFilter

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
CELL = 96
ANIMS = {'idle': (4, 1, 4), 'walk': (3, 2, 6), 'punch': (4, 1, 4)}

# Proportionen (Anteile der Figur-Hoehe nach dem Zuschnitt)
P = dict(neck=0.13, shoulder=0.22, hip=0.50, knee=0.72)


# ---------- 1. Cutout ----------
def cutout(img):
    """Flood-Fill vom Rand: Gradienten-Hintergrund wird ueber lokale
    Farbdifferenz-Toleranz entfernt; Rueckstand weich geantialiaset."""
    rgb = img.convert('RGB')
    w, h = rgb.size
    px = rgb.load()
    bg = [[False] * w for _ in range(h)]
    q = deque()

    def near(c1, c2, tol):
        return abs(c1[0] - c2[0]) + abs(c1[1] - c2[1]) + abs(c1[2] - c2[2]) < tol

    def push(x, y, ref):
        if 0 <= x < w and 0 <= y < h and not bg[y][x] and near(px[x, y], ref, 85):
            bg[y][x] = True
            q.append((x, y, ref))

    for x in range(w):
        push(x, 0, px[x, 0]); push(x, h - 1, px[x, h - 1])
    for y in range(h):
        push(0, y, px[0, y]); push(w - 1, y, px[w - 1, y])
    while q:
        x, y, ref = q.popleft()
        push(x + 1, y, ref); push(x - 1, y, ref)
        push(x, y + 1, ref); push(x, y - 1, ref)

    # Zweiter Durchgang: hellgraue Bodenreste in der unteren Bildhaelfte
    # entfernen (geringe Saettigung + Helligkeit; dunkle Hosen/Schuhe bleiben)
    # — trifft auch die eingeschlossene Bodenflaeche zwischen den Beinen
    for y in range(round(h * .50), h):
        for x in range(w):
            if not bg[y][x]:
                r, g, b = px[x, y]
                if min(r, g, b) > 100 and max(r, g, b) - min(r, g, b) < 28:
                    bg[y][x] = True

    mask = Image.new('L', (w, h), 255)
    mp = mask.load()
    for y in range(h):
        for x in range(w):
            if bg[y][x]:
                mp[x, y] = 0
    mask = mask.filter(ImageFilter.GaussianBlur(1.0))
    out = img.convert('RGBA')
    out.putalpha(mask)
    return out


def bbox_crop(img, alpha_thr=40):
    a = img.getchannel('A').point(lambda v: 255 if v > alpha_thr else 0)
    return img.crop(a.getbbox())


# ---------- 2. Normalisierung ----------
def normalize(img, figure_h=86):
    """Fuesse unten, Figur auf figure_h Pixel, horizontal zentriert.
    Liefert RGBA-Canvas CELL x CELL mit Ankerpunkt unten-mitte."""
    im = bbox_crop(img)
    f = figure_h / im.height
    im = im.resize((max(1, round(im.width * f)), figure_h), Image.LANCZOS)
    cv = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0))
    cv.paste(im, ((CELL - im.width) // 2, CELL - figure_h), im)
    return cv


# ---------- 3. Paper-Doll-Zerlegung ----------
def split_parts(fig):
    """Zerlegt die normalisierte Figur in Kopf, ArmL, ArmR, BeinL, BeinR, Torso.
    Gibt dict mit RGBA-Teilen gleicher Canvasgroesse zurueck."""
    w, h = fig.size
    px = fig.load()
    opaque = [[px[x, y][3] > 60 for x in range(w)] for y in range(h)]

    def opaque_frac_row(y):
        return sum(opaque[y]) / w

    # Taille: Zeile mit starkem Einbruch der Deckung zwischen hip-10% und hip+10%
    hipY = round(P['hip'] * (CELL - 10)) + 10   # Figuren stehen auf CELL-1
    top = CELL - 1 - 86                          # oberer Figurenrand
    hipY = top + round(86 * P['hip'])
    neckY = top + round(86 * P['neck'])
    shY = top + round(86 * P['shoulder'])

    # x-Schwerpunkt der Beine (untere 25%)
    xs = [x for y in range(top + round(86 * .75), CELL) for x in range(w) if opaque[y][x]]
    cx = round(sum(xs) / max(1, len(xs)))

    # Echte Beintrennung suchen: unterste 20 Reihen auf Deckungsluecke nahe cx pruefen
    gap = None
    for y in range(CELL - 20, CELL):
        run = []
        runStart = None
        for x in range(max(0, cx - 12), min(w, cx + 13)):
            if not opaque[y][x]:
                if runStart is None:
                    runStart = x
            else:
                if runStart is not None:
                    run.append((runStart, x - runStart))
                    runStart = None
        if runStart is not None:
            run.append((runStart, min(w, cx + 13) - runStart))
        for (gx, glen) in run:
            if glen >= 2:
                gap = (gx, glen)
                break
        if gap:
            break
    if gap:
        cx = gap[0] + gap[1] // 2   # echte Beintrennung

    # schulterbreite: maximale Breite im Brustbereich
    brY = top + round(86 * .30)
    brow = [x for x in range(w) if opaque[brY][x]]
    bl = min(brow) if brow else cx - 20
    br = max(brow) if brow else cx + 20

    parts = {k: Image.new('RGBA', fig.size, (0, 0, 0, 0)) for k in
             ('head', 'armL', 'armR', 'legL', 'legR', 'torso')}
    take = {k: [[False] * w for _ in range(h)] for k in parts}
    armW = max(4, round((br - bl) * .22))       # Arm-Dicke

    for y in range(h):
        for x in range(w):
            if not opaque[y][x]:
                continue
            if y < neckY:
                take['head'][y][x] = True
            elif y < hipY:
                if x < bl + armW and y >= shY - 2:
                    take['armL'][y][x] = True
                elif x > br - armW and y >= shY - 2:
                    take['armR'][y][x] = True
                else:
                    take['torso'][y][x] = True
            else:
                # Die Luecke zwischen den Beinen ist transparent; daher
                # genuegt die Mittellinie als Trenner.
                if x < cx:
                    take['legL'][y][x] = True
                else:
                    take['legR'][y][x] = True
    for k, t in take.items():
        pm = parts[k].load()
        for y in range(h):
            for x in range(w):
                if t[y][x]:
                    pm[x, y] = px[x, y]
    pivots = dict(neck=(cx, neckY), shL=(bl + armW // 2, shY), shR=(br - armW // 2, shY),
                  hip=(cx, hipY))
    return parts, pivots


def rot_paste(base, part, pivot, deg, dx=0, dy=0):
    """Rotiert Teil um Pivot und setzt es zurueck auf die Base."""
    r = part.rotate(deg, resample=Image.BICUBIC, center=pivot)
    base.alpha_composite(r, (dx, dy))


# ---------- 4. Animationen ----------
def pose(parts, pv, walk=0.0, punch=0.0, bob=0, idleT=0.0):
    """Komponiert einen Frame. walk/punch in [0..1] (Phasenwinkel intern)."""
    cv = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0))
    aL = math.sin(walk * math.pi * 2) * 16
    aR = -math.sin(walk * math.pi * 2) * 16
    lL = math.sin(walk * math.pi * 2) * 14
    lR = -math.sin(walk * math.pi * 2) * 14
    rot_paste(cv, parts['legL'], pv['hip'], lL, dy=bob)
    rot_paste(cv, parts['legR'], pv['hip'], lR, dy=bob)
    rot_paste(cv, parts['torso'], pv['hip'], math.sin(walk * math.pi * 2) * 2, dy=bob)
    rot_paste(cv, parts['armL'], pv['shL'], aL - idleT * 2, dy=bob)
    rot_paste(cv, parts['armR'], pv['shR'], aR + idleT * 2, dy=bob)
    # Punch: rechter Arm dreht nach innen-oben, Arm wird gestosst
    if punch > 0:
        rot_paste(cv, parts['armR'], pv['shR'], -70 * punch, dx=round(6 * punch), dy=bob)
    rot_paste(cv, parts['head'], pv['neck'], math.sin(walk * math.pi * 2) * 2, dy=bob)
    return cv


def frames(anim, parts, pv):
    out = []
    if anim == 'idle':
        for i in range(4):
            t = i / 4
            out.append(pose(parts, pv, idleT=t, bob=[0, -1, 0, -1][i]))
    elif anim == 'walk':
        for i in range(6):
            out.append(pose(parts, pv, walk=i / 6, bob=[0, -1, 0, 0, -1, 0][i]))
    elif anim == 'punch':
        for i, p in enumerate([0, .55, 1, .25]):
            out.append(pose(parts, pv, punch=p, bob=-1 if p > .5 else 0))
    return out


def sheet(char, anim, fr, cols, rows, outdir):
    sh = Image.new('RGBA', (cols * CELL, rows * CELL), (0, 0, 0, 0))
    for i, f in enumerate(fr):
        sh.alpha_composite(f, ((i % cols) * CELL, (i // cols) * CELL))
    fp = os.path.join(outdir, f'{char}_{anim}.png')
    sh.save(fp)
    return fp


# ---------- Vorschau ----------
def preview_html(files, out):
    import base64
    html = ['<html><body style="background:#111;color:#fff;font-family:monospace">']
    for fp in files:
        b = base64.b64encode(open(fp, 'rb').read()).decode()
        html.append(f'<h3>{os.path.basename(fp)}</h3>'
                    f'<img src="data:image/png;base64,{b}" style="image-rendering:pixelated" width="576">'
                    f'<img src="data:image/png;base64,{b}" style="image-rendering:pixelated" width="288">')
    html.append('</body></html>')
    open(out, 'w').write(''.join(html))


if __name__ == '__main__':
    char, src = sys.argv[1], sys.argv[2]
    outdir = sys.argv[3] if len(sys.argv) > 3 else os.path.join(ROOT, 'models', 'sheets')
    os.makedirs(outdir, exist_ok=True)
    raw = Image.open(src)
    cut = bbox_crop(cutout(raw))
    cut.save(os.path.join(ROOT, 'models', 'photos', char, 'cutout.png'))
    fig = normalize(cut)
    parts, pv = split_parts(fig)
    made = []
    for anim, (cols, rows, n) in ANIMS.items():
        fr = frames(anim, parts, pv)[:n]
        made.append(sheet(char, anim, fr, cols, rows, outdir))
    preview_html(made, os.path.join(outdir, f'preview_{char}.html'))
    print('ok:', ', '.join(os.path.basename(m) for m in made))
