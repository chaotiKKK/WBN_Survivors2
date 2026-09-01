#!/usr/bin/env node
/* Build: WBNS-BUILD — inlined src/* into src/index.template.html → index.html
   Marker-Zeilen im Template: <!--INLINE:<datei>-->  (.css → <style>, .js → <script>)
   Ausgabe ist ein einziges, offline lauffähiges index.html (Distribution). */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'src');
const tplPath = path.join(root, 'src', 'index.template.html');
const outPath = path.join(root, 'index.html');

function build() {
  const tpl = fs.readFileSync(tplPath, 'utf8');

  const out = tpl.replace(/^<!--INLINE:([^>]+)-->\s*$/gm, (m, rel) => {
    const file = path.join(root, 'src', rel.trim());
    const ext = path.extname(file).toLowerCase();
    /* bundle.json = geordnete Modulliste; Verkettung muss exakt dem ehemaligen
       src/main.js entsprechen (byte-kompatibler Single-File-Build). */
    if (rel.trim() === 'bundle.json') {
      const mods = JSON.parse(fs.readFileSync(file, 'utf8'));
      const body = mods.map(f => fs.readFileSync(path.join(root, 'src', f), 'utf8')).join('');
      return '<script>\n' + body.replace(/\n$/, '') + '\n</script>';
    }
    const body = fs.readFileSync(file, 'utf8').replace(/\n$/, '');
    if (ext === '.css') return '<style>\n' + body + '\n</style>';
    if (ext === '.js') return '<script>\n' + body + '\n</script>';
    throw new Error('INLINE: unbekannter Typ ' + ext + ' (' + rel + ')');
  });

  if (/<!--INLINE:/.test(out)) throw new Error('Es sind unaufgeloeste INLINE-Marker uebrig.');

  fs.writeFileSync(outPath, out, 'utf8');
  const kb = (Buffer.byteLength(out, 'utf8') / 1024 / 1024).toFixed(2);
  console.log('build ok → index.html (' + kb + ' MB)');
}

build();

/* --watch: bei Aenderungen in src/ neu bauen (entprellt; Fehler beenden den
   Watcher nicht, damit ein Tippfehler nicht den Dev-Flow abreisst). */
if (process.argv.includes('--watch')) {
  let timer = null;
  const run = (evt, file) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try { build(); } catch (e) { console.error('build failed:', e.message); }
    }, 100);
  };
  fs.watch(srcDir, { recursive: true }, (evt, file) => {
    if (!file || (!file.endsWith('.js') && !file.endsWith('.css') && !file.endsWith('.html'))) return;
    run(evt, file);
  });
  console.log('watching src/ … (Strg+C zum Beenden)');
}
