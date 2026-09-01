#!/usr/bin/env node
/* Betten die Foto-Collage-Sprite-Sheets (models/sheets/<char>_{idle,walk,punch}.png)
   als Base64 in die CHAR_SPR-Eintraege ein. Ziel ist die Modul-Datei aus
   src/bundle.json, die CHAR_SPR enthaelt (momentan src/data.js).
   Gilt automatisch fuer jeden Charakter, fuer den Sheets vorliegen.
   Deterministisch & idempotent: gleiche Sheets -> keine Aenderung. */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SHEETS = path.join(ROOT, 'models', 'sheets');
const SRC = path.join(ROOT, 'src');

const bundle = JSON.parse(fs.readFileSync(path.join(SRC, 'bundle.json'), 'utf8'));
const MAIN_FILE = bundle.find(f => /\bconst CHAR_SPR\b/.test(fs.readFileSync(path.join(SRC, f), 'utf8')));
if (!MAIN_FILE) throw new Error('Keine Bundle-Datei mit CHAR_SPR gefunden');
const MAIN = path.join(SRC, MAIN_FILE);

const ANIMS = { idle: [4, 1, 4], walk: [3, 2, 6], punch: [4, 1, 4] }; // [cols, rows, n]

function b64(file) {
  return fs.readFileSync(path.join(SHEETS, file)).toString('base64');
}

function entry(cid) {
  const lines = [`  ${cid}: {`];
  for (const [anim, [cols, rows, n]] of Object.entries(ANIMS)) {
    const src = `'data:image/png;base64,${b64(`${cid}_${anim}.png`)}'`;
    lines.push(`    ${anim}: { img: Object.assign(new Image(), {src:${src}}), cols: ${cols}, rows: ${rows}, fw: 128, fh: 128, n: ${n} },`);
  }
  lines.push('  },');
  return lines.join('\n');
}

/* Vorhandene Charaktere = Sheet-Tripel im models/sheets-Verzeichnis */
const chars = fs.readdirSync(SHEETS)
  .filter(f => /^.+_idle\.png$/.test(f))
  .map(f => f.replace(/_idle\.png$/, ''));

let src = fs.readFileSync(MAIN, 'utf8');
let changed = 0, missing = [];
for (const cid of chars) {
  /* Eintrag: "  cid: {" ... bis zur ersten Zeile genau "  }," */
  const re = new RegExp(`\\n  ${cid}: \\{\\n(?:.*\\n)*?  \\},`);
  const m = src.match(re);
  if (!m) { missing.push(cid); continue; }
  const replacement = `\n${entry(cid)}`;
  if (m[0] !== replacement) {
    src = src.replace(re, replacement);
    changed++;
  }
}
fs.writeFileSync(MAIN, src);
console.log(`embed_char_sprites: ${changed} Block(s) aktualisiert (${chars.join(', ')})`);
if (missing.length) console.log(`ACHTUNG, kein CHAR_SPR-Eintrag fuer: ${missing.join(', ')}`);
