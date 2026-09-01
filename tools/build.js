#!/usr/bin/env node
/* Build: WBNS-BUILD — inlined src/* into src/index.template.html → index.html
   Marker-Zeilen im Template: <!--INLINE:<datei>-->  (.css → <style>, .js → <script>)
   Ausgabe ist ein einziges, offline lauffähiges index.html (Distribution). */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const tplPath = path.join(root, 'src', 'index.template.html');
const outPath = path.join(root, 'index.html');

const tpl = fs.readFileSync(tplPath, 'utf8');

const out = tpl.replace(/^<!--INLINE:([^>]+)-->\s*$/gm, (m, rel) => {
  const file = path.join(root, 'src', rel.trim());
  const body = fs.readFileSync(file, 'utf8').replace(/\n$/, '');
  const ext = path.extname(file).toLowerCase();
  if (ext === '.css') return '<style>\n' + body + '\n</style>';
  if (ext === '.js') return '<script>\n' + body + '\n</script>';
  throw new Error('INLINE: unbekannter Typ ' + ext + ' (' + rel + ')');
});

if (/<!--INLINE:/.test(out)) throw new Error('Es sind unaufgeloeste INLINE-Marker uebrig.');

fs.writeFileSync(outPath, out, 'utf8');
const kb = (Buffer.byteLength(out, 'utf8') / 1024 / 1024).toFixed(2);
console.log('build ok → index.html (' + kb + ' MB)');
