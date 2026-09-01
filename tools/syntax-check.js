#!/usr/bin/env node
/* Minimaler Syntax-Check: node --check über alle JS-Dateien in src/.
   Exit 1 bei dem ersten Syntaxfehler — läuft als prebuild-Hook vor dem Build. */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'src');
const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.js')).sort();

let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', path.join(srcDir, f)], { encoding: 'utf8' });
  if (r.status !== 0) {
    failed++;
    console.error('✗ ' + f + '\n' + (r.stderr || '').trim());
  }
}
if (failed) {
  console.error('syntax-check: ' + failed + ' Datei(en) mit Fehlern');
  process.exit(1);
}
console.log('syntax-check ok (' + files.length + ' Dateien)');
