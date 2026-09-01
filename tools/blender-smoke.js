#!/usr/bin/env node
/* Blender-Smoke-Test (CI):
   - prueft, dass die produktiven models/glb/*.glb existieren und >= 10 KB sind
   - wenn Blender verfuegbar ist: rendert die Pipeline in ein TEMP-Verzeichnis
     (blender_chars.py -- <temp>) und prueft die dort erzeugten GLBs. Die
     produktiven models/ - insbesondere models/sheets/ mit der echten
     Foto-Pipeline-Kunst - werden dabei NIE ueberschrieben.
   - Wenn Blender nicht gefunden wird (z. B. CI ohne Blender): weiches Versagen,
     nur die committeten GLBs werden geprueft. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const script = path.join(root, 'tools', 'blender_chars.py');
const glbDir = path.join(root, 'models', 'glb');

const expected = ['leonidas.glb', 'sylvia.glb'];
const MIN_SIZE = 10 * 1024; /* 10 KB */

function findBlender() {
  /* 1. PATH */
  try { execFileSync('blender', ['--version'], { stdio: 'pipe' }); return 'blender'; } catch (e) { }
  /* 2. Windows-Default-Location */
  const dirs = [
    'C:\\Program Files\\Blender Foundation\\Blender 5.2',
    'C:\\Program Files\\Blender Foundation\\Blender 5.1',
    'C:\\Program Files\\Blender Foundation\\Blender 5.0',
    'C:\\Program Files\\Blender Foundation\\Blender 4.2',
  ];
  for (const d of dirs) {
    const exe = path.join(d, 'blender.exe');
    if (fs.existsSync(exe)) return exe;
  }
  return null;
}

function checkGlbs(dir) {
  const issues = [];
  for (const name of expected) {
    const p = path.join(dir, name);
    if (!fs.existsSync(p)) { issues.push(`${name}: fehlt`); continue; }
    const size = fs.statSync(p).size;
    if (size < MIN_SIZE) issues.push(`${name}: ${size} Bytes < ${MIN_SIZE} (zu klein)`);
  }
  return issues;
}

function sizeList(dir) {
  return expected.map(n => `${n}: ${(fs.statSync(path.join(dir, n)).size / 1024).toFixed(1)} KB`);
}

/* 1. Produktive (committete) GLBs pruefen - das, was ausgeliefert wird. */
const prodIssues = checkGlbs(glbDir);
if (prodIssues.length > 0) {
  console.error('BLENDER-SMOKE: committete GLBs ungueltig:');
  for (const i of prodIssues) console.error('  -', i);
  process.exit(1);
}

const blender = findBlender();
if (!blender) {
  /* Kein Blender: nur die bestehenden GLBs pruefen (oben schon validiert). */
  console.log('BLENDER-SMOKE: Blender nicht gefunden — pruefe nur committete GLBs');
  console.log(`BLENDER-SMOKE: ${expected.length} GLBs vorhanden und >= ${MIN_SIZE} Bytes — OK (soft, ${sizeList(glbDir).join(', ')})`);
  process.exit(0);
}

/* 2. Pipeline in ein Temp-Verzeichnis rendern. blender_chars.py leitet ALLE
   Ausgaben (glb, sheets, renders, bakes, blend) vom uebergebenen Root ab -
   also schreibt der Lauf nur nach <temp>/models/, nie in die produktiven
   models/. So bleibt models/sheets/ (echte Foto-Pipeline-Kunst) unberuehrt. */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wbns-blender-'));
let ok = true;
try {
  console.log(`BLENDER-SMOKE: rendere Pipeline in Temp (${tmp}) ...`);
  execFileSync(blender, ['-b', '--factory-startup', '-P', script, '--', tmp], {
    stdio: 'inherit', cwd: root, timeout: 300000 /* 5 min max */,
  });
  const tmpGlb = path.join(tmp, 'models', 'glb');
  const tmpIssues = checkGlbs(tmpGlb);
  if (tmpIssues.length > 0) {
    console.error('BLENDER-SMOKE: Temp-GLBs nach dem Lauf ungueltig:');
    for (const i of tmpIssues) console.error('  -', i);
    ok = false;
  } else {
    console.log(`BLENDER-SMOKE: Pipeline OK — ${expected.length} GLBs in Temp erzeugt (${sizeList(tmpGlb).join(', ')}); produktive models/ unberuehrt`);
  }
} catch (e) {
  console.error('BLENDER-SMOKE: blender_chars.py fehlgeschlagen:', e.message);
  ok = false;
}
/* Temp immer aufraeumen (process.exit wuerde ein finally ueberspringen). */
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { }

process.exit(ok ? 0 : 1);
