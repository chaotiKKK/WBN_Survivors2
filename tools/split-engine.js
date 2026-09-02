#!/usr/bin/env node
/* split-engine.js — Robuste Variante 2.
   Zerlegt das grosse `const Game = { ... }`-Objekt aus src/engine.js in mehrere
   Modul-Dateien. Statt fragiler Zeilennummern + Methoden-Umschreibung per
   Klammer-Tiefe (die bei jeder Groessenaenderung von engine.js brach) werden die
   Abschnitte ueber ANKER-Membernamen gefunden und die Member VERBATIM in
   `Object.assign(Game, { ... })` gewickelt. Kein Umschreiben, kein Depth-Tracking:
   solange jeder Abschnitt an einem echten Member-Anfang beginnt, ist das Ergebnis
   syntaktisch gueltig.

   - engine-base.js : `const Game = { ...Properties... };`  (Objekt wird geschlossen)
   - engine-*.js    : `Object.assign(Game, { ...Member des Abschnitts... });`
   - engine-legacy.js: alles NACH `};` von Game (standalone: TUNE, MqttWire, Net, SelfTest)

   Anker sind Membernamen; verschiebt sich engine.js, findet der Split sie trotzdem. */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const enginePath = path.join(root, 'src', 'engine.js');
const outDir = path.join(root, 'src');
const src = fs.readFileSync(enginePath, 'utf8');
const lines = src.split('\n');

/* Abschnitte in Reihenfolge; startAnchor = erster Member des Abschnitts. */
const SECTIONS = [
  { name: 'engine-init.js',    anchor: 'init',            desc: 'Init, Intro, UI, Quality, Musik' },
  { name: 'engine-run.js',     anchor: 'setRunSeed',      desc: 'Run-Management, Wellen, Upgrades' },
  { name: 'engine-spawn.js',   anchor: 'spawnEnemyAt',    desc: 'Spawning, Enemies, Pickups' },
  { name: 'engine-arena.js',   anchor: 'ARENA_MODS',      desc: 'Wager, Endless, Arena-Mods, Contracts' },
  { name: 'engine-boss.js',    anchor: 'bossIntro',       desc: 'Boss, Parallax, Shadows' },
  { name: 'engine-hazards.js', anchor: 'hazObjs',         desc: 'Hazards, Queries' },
  { name: 'engine-loop.js',    anchor: 'loop',            desc: 'Game-Loop, Input, Update' },
  { name: 'engine-physics.js', anchor: 'updateProjectile', desc: 'Projektil-Physics, Detonation' },
  { name: 'engine-render.js',  anchor: 'render',          desc: 'Rendering, Minimap, HUD' },
];

/* Zeilenindex (0-basiert) des Member-Anfangs `  name(` oder `  name:` finden. */
function memberLine(name) {
  const re = new RegExp('^  ' + name + '\\s*[(:]');
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) return i;
  return -1;
}

/* Game-Objekt-Grenzen */
const gameOpen = lines.findIndex(l => /^const Game = \{/.test(l));
if (gameOpen < 0) { console.error('FEHLER: `const Game = {` nicht gefunden'); process.exit(1); }
/* erster column-0 `};` NACH gameOpen schliesst Game (alles darin ist eingerueckt) */
let gameClose = -1;
for (let i = gameOpen + 1; i < lines.length; i++) { if (/^\};/.test(lines[i])) { gameClose = i; break; } }
if (gameClose < 0) { console.error('FEHLER: schliessendes `};` von Game nicht gefunden'); process.exit(1); }

/* Anker-Zeilen bestimmen und validieren */
const anchors = SECTIONS.map(s => {
  const ln = memberLine(s.anchor);
  if (ln < 0) { console.error(`FEHLER: Anker-Member "${s.anchor}" (${s.name}) nicht gefunden`); process.exit(1); }
  return { ...s, line: ln };
});
for (let i = 1; i < anchors.length; i++) {
  if (anchors[i].line <= anchors[i - 1].line) {
    console.error(`FEHLER: Anker "${anchors[i].anchor}" liegt nicht nach "${anchors[i - 1].anchor}" — Reihenfolge stimmt nicht`);
    process.exit(1);
  }
}

/* 1. engine-base.js: von Dateianfang bis zum ersten Member, Objekt schliessen. */
const base = lines.slice(0, anchors[0].line).join('\n') + '\n};\n';
fs.writeFileSync(path.join(outDir, 'engine-base.js'), base, 'utf8');
console.log(`  engine-base.js: Konstanten + Game-Properties → const Game = {...};`);

/* 2. Methoden-Abschnitte: [anchor .. naechster anchor bzw. Game-Close) in Object.assign wickeln. */
for (let i = 0; i < anchors.length; i++) {
  const from = anchors[i].line;
  const to = (i + 1 < anchors.length) ? anchors[i + 1].line : gameClose; /* Game-Close NICHT mitnehmen */
  const body = lines.slice(from, to).join('\n').replace(/\s+$/, '');
  const code = 'Object.assign(Game, {\n' + body + '\n});\n';
  fs.writeFileSync(path.join(outDir, anchors[i].name), code, 'utf8');
  console.log(`  ${anchors[i].name}: ${anchors[i].desc}`);
}

/* 3. engine-legacy.js: alles NACH dem Game-`};` (standalone consts). */
const legacy = lines.slice(gameClose + 1).join('\n').replace(/^\n+/, '');
fs.writeFileSync(path.join(outDir, 'engine-legacy.js'), legacy, 'utf8');
console.log(`  engine-legacy.js: standalone (TUNE, MqttWire, Net, SelfTest …)`);

/* bundle.json: engine.js (oder alte engine-* Liste) durch die neue Liste ersetzen. */
const bundlePath = path.join(outDir, 'bundle.json');
let bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
const engineMods = ['engine-base.js', ...SECTIONS.map(s => s.name), 'engine-legacy.js'];
bundle = bundle.filter(f => f === 'engine.js' ? false : !/^engine-.*\.js$/.test(f));
/* engine-Module an die Stelle setzen, wo vorher ui.js kommt (danach die Engine) */
const uiIdx = bundle.indexOf('ui.js');
const at = uiIdx >= 0 ? uiIdx + 1 : bundle.length;
bundle.splice(at, 0, ...engineMods);
fs.writeFileSync(bundlePath, JSON.stringify(bundle, null, 2) + '\n', 'utf8');
console.log('\nBundle:', bundle.join(', '));

/* Backup */
fs.copyFileSync(enginePath, path.join(root, 'src', 'engine.js.bak'));
console.log('Backup: engine.js.bak\nCheck: npm run check && npm run build && npm test');
