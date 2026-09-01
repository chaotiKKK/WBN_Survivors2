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
    'scharfschuetze': 'photorealistic full body photo of a lean marksman ranger of a city watch, '
              'wearing a dark green hooded cloak and tactical vest, hood up, '
              'standing upright in A-pose, arms slightly away from body, legs straight, '
              'facing camera, entire body visible from head to feet, plain solid light gray studio background',
    'bollwerk': 'photorealistic full body photo of an extremely tall giant man, 2.2 meters, '
              'techno DJ, wearing large black headphones around neck and a cyan and purple rave jacket, '
              'standing upright in A-pose, arms slightly away from body, legs straight, '
              'facing camera, entire body visible from head to feet, plain solid light gray studio background',
    'nova': 'photorealistic full body photo of a slim agile young woman with spiky pink hair, '
              'wearing a futuristic pink and magenta combat outfit, '
              'standing upright in A-pose, arms slightly away from body, legs straight, '
              'facing camera, entire body visible from head to feet, plain solid light gray studio background',
    'kleeblatt': 'photorealistic full body photo of a cheerful lucky scavenger man, '
              'wearing green clothes with four-leaf clover patches and a green cap, '
              'standing upright in A-pose, arms slightly away from body, legs straight, '
              'facing camera, entire body visible from head to feet, plain solid light gray studio background',
    'ingenieur': 'photorealistic full body photo of a sturdy craftsman engineer in orange work overalls '
              'with a tool belt, short beard, '
              'standing upright in A-pose, arms slightly away from body, legs straight, '
              'facing camera, entire body visible from head to feet, plain solid light gray studio background',
    'cyborg': 'photorealistic full body photo of a cyborg human with visible robotic servo arms, '
              'pale blue and chrome body parts, one glowing blue eye, futuristic android hybrid, '
              'standing upright in A-pose, arms slightly away from body, legs straight, '
              'facing camera, entire body visible from head to feet, plain solid light gray studio background',
    'rockstar': 'photorealistic full body photo of a young rock musician boy with long hair, '
              'wearing an orange flame-patterned rockstar jacket and dark jeans, '
              'standing upright in A-pose, arms slightly away from body, legs straight, '
              'facing camera, entire body visible from head to feet, plain solid light gray studio background',
    'greta': 'photorealistic full body photo of a stern confident teenage girl, schoolyard peacemaker, '
              'wearing a green jacket with crossed arms posture but standing straight, dark trousers, '
              'standing upright in A-pose, arms slightly away from body, legs straight, '
              'facing camera, entire body visible from head to feet, plain solid light gray studio background',
    'manni': 'photorealistic full body photo of a friendly middle-aged kiosk owner man, '
              'wearing a yellow-brown apron over a shirt and trousers, balding with mustache, '
              'standing upright in A-pose, arms slightly away from body, legs straight, '
              'facing camera, entire body visible from head to feet, plain solid light gray studio background',
    'oe': 'photorealistic full body photo of a warm middle-aged life advisor woman, '
              'curly hair with a braid, round glasses, wearing a yellow cardigan and long skirt, '
              'standing upright in A-pose, arms slightly away from body, legs straight, '
              'facing camera, entire body visible from head to feet, plain solid light gray studio background',
    'blindgaenger': 'photorealistic full body photo of an eccentric demolition expert man, '
              'wearing a gas mask around neck, brown dusty work clothes and safety gear, '
              'standing upright in A-pose, arms slightly away from body, legs straight, '
              'facing camera, entire body visible from head to feet, plain solid light gray studio background',
    'petra': 'photorealistic full body photo of a strong german-american female ex-army engineer, '
              'wearing olive green military work uniform, hair in a tight bun, wrench on belt, '
              'standing upright in A-pose, arms slightly away from body, legs straight, '
              'facing camera, entire body visible from head to feet, plain solid light gray studio background',
    'kobra': 'photorealistic full body photo of a female police patrol officer, '
              'wearing a dark blue police uniform and a police cap, duty belt, confident stance, '
              'standing upright in A-pose, arms slightly away from body, legs straight, '
              'facing camera, entire body visible from head to feet, plain solid light gray studio background',
    'sunny': 'photorealistic full body photo of a friendly young woman with long blonde hair, '
              'wearing a purple futuristic jacket and white sneakers, cheerful smile, '
              'standing upright in A-pose, arms slightly away from body, legs straight, '
              'facing camera, entire body visible from head to feet, plain solid light gray studio background',
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
