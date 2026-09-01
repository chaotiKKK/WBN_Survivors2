#!/usr/bin/env node
/* Einmalige Migration: lagert alle eingebetteten Base64-Bild-Assets aus der
   CHAR_SPR/Atlas-Modul-Datei (src/data.js) in echte Dateien unter src/assets/
   aus und ersetzt sie durch kurze Sentinels @@ASSET:<name>@@. Der Build
   (tools/build.js) inlined sie beim Distributions-Schritt wieder, sodass
   index.html eine Einzeldatei bleibt.

   Namensgebung:
   - CHAR_SPR-Sheets werden per Content-Hash gegen models/sheets/*.png gematcht
     und bekommen deren Namen (<char>_<anim>.png) - so bleibt embed_char_sprites.js
     kompatibel (schreibt denselben Sentinel).
   - Benannte Konstanten (PROP_ATLAS_SRC, SEBBO_SRC ...) bekommen sprechende Namen.
   - Alles andere: <praefix>_<hash8>.<ext> aus dem naechstliegenden Schluessel.
   Gleicher Inhalt -> gleiche Datei (Dedup). Idempotent: ohne data-URIs passiert nichts. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const ASSETS = path.join(SRC, 'assets');
const SHEETS = path.join(ROOT, 'models', 'sheets');

const bundle = JSON.parse(fs.readFileSync(path.join(SRC, 'bundle.json'), 'utf8'));
const targetFile = bundle.find(f => /data:image\/[a-z]+;base64,/.test(fs.readFileSync(path.join(SRC, f), 'utf8')));
if (!targetFile) { console.log('extract-assets: keine eingebetteten data-URIs gefunden - nichts zu tun'); process.exit(0); }
const TARGET = path.join(SRC, targetFile);

const EXT = { png: 'png', webp: 'webp', jpeg: 'jpeg', jpg: 'jpeg', gif: 'gif', 'svg+xml': 'svg' };

/* Hash -> Sheet-Basisname, damit CHAR_SPR-Sheets ihre sprechenden Namen behalten. */
const sheetByHash = {};
if (fs.existsSync(SHEETS)) {
  for (const f of fs.readdirSync(SHEETS).filter(f => /\.png$/i.test(f))) {
    const h = crypto.createHash('sha256').update(fs.readFileSync(path.join(SHEETS, f))).digest('hex');
    sheetByHash[h] = f;
  }
}

fs.mkdirSync(ASSETS, { recursive: true });
let src = fs.readFileSync(TARGET, 'utf8');

/* Der data:-URI steht hinter einem oeffnenden Anfuehrungszeichen - das beim
   Kontext-Matching ueberspringen. */
/* Sentinel aus benannter Konstante: const PROP_ATLAS_SRC = 'data:...' -> prop_atlas */
function constName(before) {
  const m = before.match(/(?:const|let|var)\s+([A-Za-z0-9_]+)\s*=\s*['"]?$/);
  if (!m) return null;
  return m[1].replace(/_SRC$/i, '').toLowerCase();
}
/* naechstliegender Objekt-Schluessel als Praefix: grass: '...' -> grass,
   {src:'...'} -> der Schluessel davor. 'src'/'img' sind zu generisch -> ueberspringen. */
function keyName(before) {
  const keys = [...before.matchAll(/([A-Za-z0-9_]+)\s*:\s*(?:\{\s*)?(?:(?:src|img)\s*:\s*)?['"]?$/g)];
  for (let i = keys.length - 1; i >= 0; i--) {
    const k = keys[i][1].toLowerCase();
    if (k !== 'src' && k !== 'img') return k;
  }
  return 'asset';
}

const re = /data:image\/([a-z+]+);base64,([A-Za-z0-9+/]+={0,2})/g;
const used = new Set();
let count = 0, dedup = 0, moved = 0, sheetHits = 0;
const manifest = [];

src = src.replace(re, (full, sub, b64, offset) => {
  const ext = EXT[sub] || sub.replace(/[^a-z0-9]/g, '');
  const buf = Buffer.from(b64, 'base64');
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  let name;
  if (sheetByHash[hash]) { name = sheetByHash[hash]; sheetHits++; }
  else {
    const before = src.slice(Math.max(0, offset - 80), offset);
    const base = constName(before) || keyName(before);
    name = `${base}_${hash.slice(0, 8)}.${ext}`;
  }
  const file = path.join(ASSETS, name);
  if (!fs.existsSync(file)) { fs.writeFileSync(file, buf); moved += buf.length; }
  else dedup++;
  used.add(name);
  count++;
  manifest.push({ name, bytes: buf.length, sub });
  return `@@ASSET:${name}@@`;
});

fs.writeFileSync(TARGET, src);
console.log(`extract-assets: ${count} URIs -> ${used.size} Dateien in src/assets/ (${(moved / 1048576).toFixed(2)} MB), ${sheetHits} Sheet-Treffer, ${dedup} Dubletten uebersprungen`);
console.log(`Ziel-Modul: ${targetFile} (jetzt ${(fs.statSync(TARGET).size / 1048576).toFixed(2)} MB)`);
