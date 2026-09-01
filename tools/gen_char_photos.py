#!/usr/bin/env python3
"""Charakter-Basisfotos via pollinations.ai (frei, ohne Key).
Erzeugt mehrere Kandidaten pro Charakter in models/photos/<char>/kand_<seed>.jpg
Prompt erzwingt A-Pose + einfarbiger Hintergrund (fuer Cutout)."""
import os, sys, urllib.request, urllib.parse, time

ROOT = os.path.join(os.path.dirname(__file__), '..')
OUT = os.path.join(ROOT, 'models', 'photos')

CHARS = {
    'leonidas': 'photorealistic full body photo of a 7 year old boy with long blonde hair, '
                'junior firefighter kid, wearing a bright red and yellow firefighter jacket, '
                'standing upright in A-pose, arms slightly away from body, legs straight, '
                'facing camera, entire body visible from head to feet, plain solid light gray studio background, sharp focus',
    'sylvia': 'photorealistic full body photo of a sporty young polish woman with long red hair, '
              'friendly therapist, wearing a white sports top and dark leggings, '
              'standing upright in A-pose, arms slightly away from body, legs straight, '
              'facing camera, entire body visible from head to feet, plain solid light gray studio background, sharp focus',
}

def gen(char, prompt, seed, w=768, h=1024):
    d = os.path.join(OUT, char)
    os.makedirs(d, exist_ok=True)
    fp = os.path.join(d, f'kand_{seed}.jpg')
    if os.path.exists(fp) and os.path.getsize(fp) > 5000:
        print(f'skip {char} seed={seed} (exists)')
        return
    url = ('https://image.pollinations.ai/prompt/' + urllib.parse.quote(prompt)
           + f'?width={w}&height={h}&seed={seed}&nologo=true')
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=90) as r:
                data = r.read()
            if len(data) > 5000 and data[:2] == b'\xff\xd8':
                with open(fp, 'wb') as f:
                    f.write(data)
                print(f'ok {char} seed={seed} bytes={len(data)}')
                return
        except Exception as e:
            print(f'retry {char} seed={seed} attempt={attempt}: {e}')
            time.sleep(4)
    print(f'FAIL {char} seed={seed}')

if __name__ == '__main__':
    chars = sys.argv[1:] or list(CHARS)
    seeds = [11, 42, 77]
    for c in chars:
        for s in seeds:
            gen(c, CHARS[c], s)
