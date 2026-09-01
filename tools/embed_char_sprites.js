#!/usr/bin/env node
/* Verknuepft die Foto-Collage-Sprite-Sheets (models/sheets/<char>_{idle,walk,punch}.png)
   mit den CHAR_SPR-Eintraegen. Die Sheets werden als echte Dateien nach src/assets/
   kopiert und im Code nur ueber Sentinels @@ASSET:<char>_<anim>.png@@ referenziert;
   der Build (tools/build.js) inlined sie beim Distributions-Schritt wieder ein. So
   bleibt src/data.js schlank und diffbar. Ziel ist die Modul-Datei aus src/bundle.json,
   die CHAR_SPR enthaelt (momentan src/data.js).
   Gilt automatisch fuer jeden Charakter, fuer den Sheets vorliegen.
   Deterministisch & idempotent: gleiche Sheets -> keine Aenderung. */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SHEETS = path.join(ROOT, 'models', 'sheets');
const SRC = path.join(ROOT, 'src');
const ASSETS = path.join(SRC, 'assets');

const bundle = JSON.parse(fs.readFileSync(path.join(SRC, 'bundle.json'), 'utf8'));
const MAIN_FILE = bundle.find(f => /\bconst CHAR_SPR\b/.test(fs.readFileSync(path.join(SRC, f), 'utf8')));
if (!MAIN_FILE) throw new Error('Keine Bundle-Datei mit CHAR_SPR gefunden');
const MAIN = path.join(SRC, MAIN_FILE);

const ANIMS = { idle: [4, 1, 4], walk: [3, 2, 6], punch: [4, 1, 4] }; // [cols, rows, n]

fs.mkdirSync(ASSETS, { recursive: true });

/* Sheet als echte Datei nach src/assets/ spiegeln (nur wenn abweichend, damit
   der Build-Watch nicht unnoetig feuert). */
function mirror(file) {
  const from = path.join(SHEETS, file), to = path.join(ASSETS, file);
  const cur = fs.existsSync(to) ? fs.readFileSync(to) : null;
  const buf = fs.readFileSync(from);
  if (!cur || !cur.equals(buf)) fs.writeFileSync(to, buf);
}

function entry(cid) {
  const lines = [`  ${cid}: {`];
  for (const [anim, [cols, rows, n]] of Object.entries(ANIMS)) {
    const sheet = `${cid}_${anim}.png`;
    mirror(sheet);
    const src = `'@@ASSET:${sheet}@@'`;
    lines.push(`    ${anim}: { img: Object.assign(new Image(), {src:${src}}), cols: ${cols}, rows: ${rows}, fw: 128, fh: 128, n: ${n} },`);
  }
  lines.push('  },');
  return lines.join(NL);
}

/* Vorhandene Charaktere = Sheet-Tripel im models/sheets-Verzeichnis */
const chars = fs.readdirSync(SHEETS)
  .filter(f => /^.+_idle\.png$/.test(f))
  .map(f => f.replace(/_idle\.png$/, ''));

let src = fs.readFileSync(MAIN, 'utf8');
/* Zeilenende der Datei uebernehmen (Windows-Checkout = CRLF), sonst schlaegt
   das Matching fehl und die Ersetzung mischt die Zeilenenden. */
const NL = src.includes('\r\n') ? '\r\n' : '\n';
let changed = 0, missing = [];
for (const cid of chars) {
  /* Eintrag: "  cid: {" ... bis zur ersten Zeile genau "  }," (CRLF-tolerant) */
  const re = new RegExp(`\\r?\\n  ${cid}: \\{\\r?\\n(?:.*\\r?\\n)*?  \\},`);
  const m = src.match(re);
  if (!m) { missing.push(cid); continue; }
  const replacement = `${NL}${entry(cid)}`;
  if (m[0] !== replacement) {
    src = src.replace(re, replacement);
    changed++;
  }
}
fs.writeFileSync(MAIN, src);
console.log(`embed_char_sprites: ${changed} Block(s) aktualisiert (${chars.join(', ')})`);
if (missing.length) console.log(`ACHTUNG, kein CHAR_SPR-Eintrag fuer: ${missing.join(', ')}`);
