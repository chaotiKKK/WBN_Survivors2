#!/usr/bin/env node
/* Performance-Regressionstest (CI):
   - serviert Repo-Root ueber localhost-HTTP
   - oeffnet index.html in headless Chromium (Playwright)
   - startet einen echten Run (Leonidas), laesst N Frames laufen
   - misst die Render-Zeit pro Frame (performance.now um Game.render)
   - Alarm bei P99 > 5 ms (Schwellwert ueber ENV PERF_THRESHOLD_MS anpassbar)
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

    /* Instrumentierung: Game.render timen, N Frames sammeln */
    const results = await page.evaluate(async (N) => {
      return new Promise((resolve) => {
        const times = [];
        const orig = Game.render.bind(Game);
        let collected = 0;
        Game.render = function () {
          const t0 = performance.now();
          const r = orig();
          times.push(performance.now() - t0);
          collected++;
          if (collected >= N) {
            Game.render = orig;
            resolve(times);
          }
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
        setTimeout(() => { clearInterval(move); resolve(times); }, (N / 60 + 4) * 1000);
      });
    }, FRAMES);

    await browser.close();
    server.close();

    if (!results || results.length === 0) {
      console.error('PERF: keine Frame-Zeiten gesammelt — Spiel lief nicht');
      process.exit(1);
    }
    const sorted = results.slice().sort((a, b) => a - b);
    const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];
    const max = sorted[sorted.length - 1];
    const over = results.filter(t => t > THRESHOLD_MS).length;

    const out = {
      frames: results.length, avg_ms: +avg.toFixed(3),
      p50_ms: +p50.toFixed(3), p99_ms: +p99.toFixed(3), max_ms: +max.toFixed(3),
      threshold_ms: THRESHOLD_MS, frames_over_threshold: over,
      errors: errors.slice(0, 10),
    };
    console.log('PERF:', JSON.stringify(out, null, 2));

    /* Bericht unter test-results/ ablegen */
    const tr = path.join(root, 'test-results');
    try { fs.mkdirSync(tr, { recursive: true }); } catch (e) { }
    fs.writeFileSync(path.join(tr, 'perf-bench.json'), JSON.stringify(out, null, 2));

    if (p99 > THRESHOLD_MS) {
      console.error(`PERF: P99 ${p99.toFixed(2)} ms > Schwellwert ${THRESHOLD_MS} ms — PERFORMANCE-REGRESSION`);
      process.exit(1);
    }
    console.log(`PERF: P99 ${p99.toFixed(2)} ms <= ${THRESHOLD_MS} ms — OK`);
    process.exit(0);
  }).catch(e => {
    console.error('PERF-Fehler:', e.message);
    try { server.close(); } catch (_) { }
    process.exit(1);
  });
}
main();
