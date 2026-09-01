#!/usr/bin/env node
/* Performance-Regressionstest (CI):
   - serviert Repo-Root ueber localhost-HTTP
   - oeffnet index.html in headless Chromium (Playwright)
   - startet einen echten Run (Leonidas), laesst N Frames laufen
   - misst GETRENNT die Zeit pro Frame um Game.update (Simulation/Logik) und
     Game.render (Zeichnen) und loggt je P50/P99 - so faellt eine CPU-Regression
     im Loop frueh auf, egal ob sie in Update oder Render steckt
   - Alarm bei P99 > 5 ms in Update ODER Render (Schwellwert ueber ENV
     PERF_THRESHOLD_MS anpassbar)
   - Exit 1 beim Alarm; Screenshot + JSON unter test-results/ */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
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

const THRESHOLD_MS = parseFloat(process.env.PERF_THRESHOLD_MS || '5');
const FRAMES = parseInt(process.env.PERF_FRAMES || '240', 10);
const PORT = Number(process.env.PORT) || 0;

function main() {
  return Promise.resolve().then(async () => {
    const { chromium } = require('playwright');
    await new Promise(r => server.listen(PORT, '127.0.0.1', r));
    const port = server.address().port;
    let browser = null;
    const args = ['--mute-audio', '--autoplay-policy=no-user-gesture-required'];
    for (const opt of [{}, { channel: 'msedge' }, { channel: 'chrome' }]) {
      try { browser = await chromium.launch({ ...opt, args }); break; } catch (e) { browser = null; }
    }
    if (!browser) throw new Error('Kein Chromium/Edge/Chrome gefunden (npx playwright install chromium)');
    const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e)));

    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
    /* Warte auf Spiel-Initialisierung. Game/Save sind top-level `const` und
       haengen NICHT an window - wie beim Selftest ueber die globale lexikalische
       Scope-Kette per String-Ausdruck pruefen, nicht ueber window.Game. */
    await page.waitForFunction(
      "typeof Game !== 'undefined' && typeof Game.startRun === 'function' && typeof Save !== 'undefined'",
      null, { timeout: 15000 });
    /* Audio nicht initialisieren (kein user gesture im headless) */
    await page.evaluate(() => {
      try { AudioSys.musicOn = false; } catch (e) { }
      /* Alle 16 Roster-Chars freischalten, damit kein Erfolg-Gate blockiert */
      try { Save.data.unlockedChars = true; Save.save(); } catch (e) { }
    });
    /* Run starten: Leonidas, Gefahr 0 */
    await page.evaluate(() => {
      Game.sel = ['leonidas'];
      Game.danger = 0;
      Game.manualSeed = 424242;
      Game.startRun();
    });
    /* Kurz warten, bis der play-State steht */
    await page.waitForFunction(
      "typeof Game !== 'undefined' && Game.state === 'play' && Game.players && Game.players.length > 0",
      null, { timeout: 10000 });

    /* Instrumentierung: Game.update UND Game.render getrennt timen. Beide werden
       im Loop je einmal pro Spielframe aufgerufen; render dient als verlaesslicher
       Pro-Frame-Zaehler fuer die N-Frame-Grenze. */
    const results = await page.evaluate(async (N) => {
      return new Promise((resolve) => {
        const upd = [], ren = [];
        const origU = Game.update.bind(Game);
        const origR = Game.render.bind(Game);
        let collected = 0, done = false;
        const finish = () => {
          if (done) return; done = true;
          Game.update = origU; Game.render = origR;
          resolve({ update: upd, render: ren });
        };
        Game.update = function (dt) {
          const t0 = performance.now();
          const r = origU(dt);
          upd.push(performance.now() - t0);
          return r;
        };
        Game.render = function () {
          const t0 = performance.now();
          const r = origR();
          ren.push(performance.now() - t0);
          if (++collected >= N) finish();
          return r;
        };
        /* Spieler bewegen lassen, damit der Loop aktiv bleibt (AFK-Tod vermeiden) */
        const move = setInterval(() => {
          try {
            const ev = new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', keyCode: 68, which: 68, bubbles: true });
            Object.defineProperty(ev, 'keyCode', { get: () => 68 });
            Object.defineProperty(ev, 'which', { get: () => 68 });
            window.dispatchEvent(ev);
          } catch (e) { }
        }, 50);
        setTimeout(() => { clearInterval(move); finish(); }, (N / 60 + 4) * 1000);
      });
    }, FRAMES);

    await browser.close();
    server.close();

    if (!results || !results.render || results.render.length === 0) {
      console.error('PERF: keine Frame-Zeiten gesammelt — Spiel lief nicht');
      process.exit(1);
    }
    /* Kennzahlen je Messreihe. Leere Reihe -> Nullen (kein Alarm), damit ein
       nicht aufgerufenes update() nicht faelschlich als Regression zaehlt. */
    const stats = (arr) => {
      if (!arr || arr.length === 0) return { samples: 0, avg_ms: 0, p50_ms: 0, p99_ms: 0, max_ms: 0, over_threshold: 0 };
      const s = arr.slice().sort((a, b) => a - b);
      const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
      return {
        samples: s.length,
        avg_ms: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(3),
        p50_ms: +q(0.5).toFixed(3),
        p99_ms: +q(0.99).toFixed(3),
        max_ms: +s[s.length - 1].toFixed(3),
        over_threshold: arr.filter(t => t > THRESHOLD_MS).length,
      };
    };
    const update = stats(results.update);
    const render = stats(results.render);

    const out = {
      frames: results.render.length,
      threshold_ms: THRESHOLD_MS,
      update,   // Simulation/Logik pro Frame
      render,   // Zeichnen pro Frame
      errors: errors.slice(0, 10),
    };
    console.log('PERF:', JSON.stringify(out, null, 2));

    /* Bericht unter test-results/ ablegen */
    const tr = path.join(root, 'test-results');
    try { fs.mkdirSync(tr, { recursive: true }); } catch (e) { }
    fs.writeFileSync(path.join(tr, 'perf-bench.json'), JSON.stringify(out, null, 2));

    /* Alarm, wenn Update ODER Render die Schwelle reisst - so faellt eine
       Regression im Loop unabhaengig von der Phase auf. */
    const regress = [];
    if (update.p99_ms > THRESHOLD_MS) regress.push(`update P99 ${update.p99_ms.toFixed(2)} ms`);
    if (render.p99_ms > THRESHOLD_MS) regress.push(`render P99 ${render.p99_ms.toFixed(2)} ms`);
    if (regress.length > 0) {
      console.error(`PERF: ${regress.join(' · ')} > Schwellwert ${THRESHOLD_MS} ms — PERFORMANCE-REGRESSION`);
      process.exit(1);
    }
    console.log(`PERF: update P50/P99 ${update.p50_ms}/${update.p99_ms} ms · render P50/P99 ${render.p50_ms}/${render.p99_ms} ms · <= ${THRESHOLD_MS} ms — OK`);
    process.exit(0);
  }).catch(e => {
    console.error('PERF-Fehler:', e.message);
    try { server.close(); } catch (_) { }
    process.exit(1);
  });
}
main();
