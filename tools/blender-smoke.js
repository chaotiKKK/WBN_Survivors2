#!/usr/bin/env node
/* Blender-Smoke-Test (CI):
   - ruft tools/blender_chars.py headless auf (falls blender im PATH)
   - prueft, dass models/glb/*.glb existieren und >= 10 KB sind
   - Exit 1, wenn ein GLB fehlt oder zu klein ist
   - Wenn blender nicht gefunden wird (z. B. CI ohne Blender):
     prueft nur die Existenz der bereits committeten GLBs -> weiches Versagen,
     damit der CI-Workflow nicht toet, solange Blender nicht verfuegbar ist. */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const script = path.join(root, 'tools', 'blender_chars.py');
const glbDir = path.join(root, 'models', 'glb');

const expected = ['leonidas.glb', 'sylvia.glb'];

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
  /* 3. PowerShell durchsuchen (langsamer) */
  return null;
}

const MIN_SIZE = 10 * 1024; /* 10 KB */

function checkGlbs() {
  const issues = [];
  for (const name of expected) {
    const p = path.join(glbDir, name);
    if (!fs.existsSync(p)) { issues.push(`${name}: fehlt`); continue; }
    const size = fs.statSync(p).size;
    if (size < MIN_SIZE) issues.push(`${name}: ${size} Bytes < ${MIN_SIZE} (zu klein)`);
  }
  return issues;
}

const issues = checkGlbs();
if (issues.length > 0) {
  /* Wenn die GLBs bereits fehlen, vorab abbrechen — ohne Blender geht nichts */
  console.error('BLENDER-SMOKE: GLBs fehlen bereits vor dem Lauf:');
  for (const i of issues) console.error('  -', i);
  process.exit(1);
}

const blender = findBlender();
if (!blender) {
  /* Kein Blender verfuegbar: nur die bestehenden GLBs pruefen (die oben schon
     validiert wurden). Das verhindert, dass der CI ohne Blender-Setup toet,
     waehrend Entwickler-Workstation mit Blender den vollen Lauf bekommen. */
  console.log('BLENDER-SMOKE: Blender nicht im PATH — pruefe nur committierte GLBs');
  console.log(`BLENDER-SMOKE: ${expected.length} GLBs vorhanden und >= ${MIN_SIZE} Bytes — OK (soft)`);
  process.exit(0);
}

console.log(`BLENDER-SMOKE: blender gefunden unter ${blender}, fuehre Skript aus...`);
try {
  execFileSync(blender, ['-b', '--factory-startup', '-P', script, '--', root], {
    stdio: 'inherit', cwd: root, timeout: 300000 /* 5 min max */,
  });
} catch (e) {
  console.error('BLENDER-SMOKE: blender_chars.py fehlgeschlagen:', e.message);
  process.exit(1);
}

const postIssues = checkGlbs();
if (postIssues.length > 0) {
  console.error('BLENDER-SMOKE: GLBs nach dem Lauf ungueltig:');
  for (const i of postIssues) console.error('  -', i);
  process.exit(1);
}

const sizes = expected.map(n => `${n}: ${(fs.statSync(path.join(glbDir, n)).size / 1024).toFixed(1)} KB`);
console.log(`BLENDER-SMOKE: ${expected.length} GLBs erzeugt und validiert (${sizes.join(', ')}) — OK`);
process.exit(0);
