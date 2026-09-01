#!/usr/bin/env node
/* Headless-Selftest-Läufer (CI):
   - serviert Repo-Root über localhost-HTTP (Service-Worker braucht ein Origin)
   - öffnet index.html?selftest in headless Chromium (Playwright)
   - wartet auf SelfTest.results, druckt jede Zeile, Exit 1 bei FAIL
   - bei Fehlern: Screenshot + Konsol-Log unter test-results/ */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(root, p));
  if (!file.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
});

function main() {
  return Promise.resolve().then(async () => {
    const { chromium } = require('playwright');
    /* Port: ENV oder freien Port vom OS holen (Port 0 wäre unsafe) */
    await new Promise(r => server.listen(Number(process.env.PORT) || 0, '127.0.0.1', r));
    const PORT = server.address().port;
    /* Kanal-Fallback: Playwright-Chromium, sonst installierter Edge/Chrome
       (lokal ohne Browser-Download; in CI ist chromium nach `playwright install` da). */
    let browser = null;
    const args = ['--mute-audio', '--autoplay-policy=no-user-gesture-required'];
    for (const opt of [{}, { channel: 'msedge' }, { channel: 'chrome' }]) {
      try { browser = await chromium.launch({ ...opt, args }); break; } catch (e) { browser = null; }
    }
    if (!browser) throw new Error('Kein Chromium/Edge/Chrome gefunden (npx playwright install chromium)');
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const consoleLog = [];
    const pageErrors = [];
    page.on('console', m => consoleLog.push(`[${m.type()}] ${m.text()}`));
    page.on('pageerror', e => pageErrors.push(String(e && e.stack || e)));

    let ok = false, results = [];
    try {
      await page.goto(`http://127.0.0.1:${PORT}/index.html?selftest`, { waitUntil: 'load', timeout: 30000 });
      await page.waitForFunction(
        /* SelfTest ist top-level `const` → hängt NICHT an window, aber ist
           über die globale lexikalische Scope-Kette erreichbar. */
        "typeof SelfTest !== 'undefined' && Array.isArray(SelfTest.results) && SelfTest.results.length > 0",
        null, { timeout: 60000 }
      );
      results = await page.evaluate('SelfTest.results.slice()');
      ok = results.every(r => r.ok);
    } catch (e) {
      pageErrors.push('Runner: ' + (e && e.message || e));
    }

    const pass = results.filter(r => r.ok).length;
    for (const r of results) console.log((r.ok ? 'PASS' : 'FAIL') + '  ' + r.name);
    if (results.length) console.log(`\nSelftest: ${pass}/${results.length} PASS`);
    if (pageErrors.length) {
      console.log('\nPage-Errors:');
      for (const e of pageErrors) console.log('  ' + e);
    }

    if (!ok) {
      try {
        fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
        fs.writeFileSync(path.join(root, 'test-results', 'console.log'), consoleLog.join('\n'), 'utf8');
        await page.screenshot({ path: path.join(root, 'test-results', 'selftest-fail.png'), fullPage: false });
        console.log('\nArtifacts: test-results/console.log, test-results/selftest-fail.png');
      } catch (_) { /* Artifact-Speichern darf den Exit-Code nicht verschleiern */ }
    }

    await browser.close();
    server.close();
    process.exit(ok && pageErrors.length === 0 ? 0 : 1);
  }).catch(e => { console.error(e); process.exit(1); });
}

main();
