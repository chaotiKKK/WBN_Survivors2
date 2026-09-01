#!/usr/bin/env node
/* Betten die Blender-Sprite-Sheets (models/sheets/) als Base64 in die
   CHAR_SPR-Eintraege von leonidas + sylvia in src/main.js ein.
   Deterministisch & idempotent: gleiche Sheets -> gleiche Datei. */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SHEETS = path.join(ROOT, 'models', 'sheets');
const MAIN = path.join(ROOT, 'src', 'main.js');

const ANIMS = { idle: [4, 1, 4], walk: [3, 2, 6], punch: [4, 1, 4] }; // [cols, rows, n]

function b64(file) {
  return fs.readFileSync(path.join(SHEETS, file)).toString('base64');
}

function entry(cid) {
  const lines = [`  ${cid}: {`];
  for (const [anim, [cols, rows, n]] of Object.entries(ANIMS)) {
    const src = `'data:image/png;base64,${b64(`${cid}_${anim}.png`)}'`;
    lines.push(`    ${anim}: { img: Object.assign(new Image(), {src:${src}}), cols: ${cols}, rows: ${rows}, fw: 96, fh: 96, n: ${n} },`);
  }
  lines.push('  },');
  return lines.join('\n');
}

/* Blockgrenzen: "\n  key: {\n" (Blockkopf gefolgt von Zeilenumbruch) trifft
   nur die CHAR_SPR-Eintraege — die CharacterProfiles-Eintraege sind Einzeiler
   ("leonidas: { figure: ..."). */
const BOUNDS = [
  { cid: 'leonidas', next: 'sylvia' },
  { cid: 'sylvia', next: 'titan' },
];

let src = fs.readFileSync(MAIN, 'utf8');
let changed = 0;
for (const b of BOUNDS) {
  const start = `\n  ${b.cid}: {\n`;
  const end = `\n  ${b.next}: {\n`;
  const s = src.indexOf(start);
  if (s < 0) throw new Error(`Blockanfang fuer ${b.cid} nicht gefunden`);
  const e = src.indexOf(end, s + 1);
  if (e < 0) throw new Error(`Blockende fuer ${b.cid} (naechster: ${b.next}) nicht gefunden`);
  const replacement = `\n${entry(b.cid)}\n`;
  if (src.slice(s, e) !== replacement) {
    src = src.slice(0, s) + replacement + src.slice(e);
    changed++;
  }
}
fs.writeFileSync(MAIN, src);
console.log(`embed_char_sprites: ${changed} Block(s) aktualisiert (leonidas, sylvia)`);
