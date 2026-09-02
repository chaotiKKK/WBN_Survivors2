/* ============================ 21. GAME ENGINE ============================ */
const SPAWN_ANNOUNCE = 0.3;
const SPAWN_TELEGRAPH = 0.4;
const Game = {
  cv: null, ctx: null, W: 0, H: 0, dpr: 1,
  state: 'title', coop: false, danger: 0, sel: ['leonidas', 'sylvia'],
  players: [], enemies: [], materials: 0, wave: 1, waveTimer: 0, waveDuration: 25,
  time: 0, fps: 60, lastT: 0, acc: 0, hudAcc: 0, autoQ: 1, _aqT: 0,
  cam: { x: 0, y: 0, zoom: 1, sx: 0, sy: 0, shake: 0, shakeT: 0, punch: 0, trauma: 0, shakeT2: 0 },
  /* ---- Flussfeld ----------------------------------------------------------
     Gegner liefen bisher stur auf den Spieler zu. `Level.collide` drueckt sie
     entlang der Wandnormalen heraus, was Gleiten erlaubt — aber nur, wenn die
     Wunschrichtung einen Tangentialanteil hat. Steht ein Gegner exakt hinter
     einer Wand, ist der null: er drueckt frontal und bleibt dort liegen.

     Statt A* je Gegner laeuft EIN Dijkstra-Durchlauf vom Spieler nach aussen
     ueber ein grobes Raster; alle Gegner lesen daraus das Gefaelle. Bei einer
     Horde mit gemeinsamem Ziel ist das die billigere Ordnung: eine Suche statt
     n Suchen. Arena ~1000x850 bei 24er-Zellen sind rund 1500 Felder — die
     feine Teilung ist noetig, weil konservativ gesperrt wird und grobe Zellen
     sonst Durchgaenge zumauern.

     Es ersetzt die Lenkung NICHT — es liefert nur die Wunschrichtung, und auch
     die nur, wenn die Sichtlinie verstellt ist. Im Freien bleibt alles beim
     bisherigen Verhalten samt Schwarm und Schlingern. */
  flow: {
    cs: 24, cw: 0, ch: 0, dist: null, blocked: null,
    tcx: -1, tcy: -1, t: 0, ready: false,
    reset() { this.cw = this.ch = 0; this.dist = null; this.blocked = null; this.ready = false; this.tcx = this.tcy = -1; },
    /* Sperrmaske: je Zellmitte einmal gegen die Waende pruefen. Nur wenn sich
       das Raster oder die Waende geaendert haben — nicht pro Bild. */
    _mask(L) {
      const cw = Math.max(1, Math.ceil(L.w / this.cs)), ch = Math.max(1, Math.ceil(L.h / this.cs));
      if (cw === this.cw && ch === this.ch && this.blocked && !L._flowDirty) return;
      this.cw = cw; this.ch = ch;
      this.blocked = new Uint8Array(cw * ch);
      this.dist = new Int32Array(cw * ch);
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++)
        this.blocked[y * cw + x] = L.rectBlocked(x * this.cs, y * this.cs, this.cs, this.cs) ? 1 : 0;
      L._flowDirty = false;
      this._q = new Int32Array(cw * ch);
    },
    build(L, px, py) {
      this._mask(L);
      const cw = this.cw, ch = this.ch, n = cw * ch, D = this.dist, B = this.blocked, Q = this._q;
      D.fill(-1);
      let cx = clamp(Math.floor(px / this.cs), 0, cw - 1), cy = clamp(Math.floor(py / this.cs), 0, ch - 1);
      /* Steht der Spieler selbst in einer Sperrzelle, die naechste freie nehmen. */
      if (B[cy * cw + cx]) {
        let best = -1, bd = 1e9;
        for (let i = 0; i < n; i++) {
          if (B[i]) continue;
          const dx = (i % cw) - cx, dy = ((i / cw) | 0) - cy, d2 = dx * dx + dy * dy;
          if (d2 < bd) { bd = d2; best = i; }
        }
        if (best < 0) { this.ready = false; return; }
        cx = best % cw; cy = (best / cw) | 0;
      }
      let head = 0, tail = 0;
      const start = cy * cw + cx;
      D[start] = 0; Q[tail++] = start;
      while (head < tail) {
        const cur = Q[head++], x = cur % cw, y = (cur / cw) | 0, nd = D[cur] + 1;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          const nx = x + ox, ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
          const ni = ny * cw + nx;
          if (B[ni] || D[ni] !== -1) continue;
          /* Diagonalen nur, wenn beide Nachbarfelder frei sind — sonst
             schneiden Gegner durch Mauerecken. */
          if (ox && oy && (B[y * cw + nx] || B[ny * cw + x])) continue;
          D[ni] = nd; Q[tail++] = ni;
        }
      }
      this.tcx = cx; this.tcy = cy; this.ready = true;
    },
    update(dt, L, px, py) {
      if (!L) { this.ready = false; return; }
      this.t -= dt;
      const cx = clamp(Math.floor(px / this.cs), 0, Math.max(0, this.cw - 1));
      const cy = clamp(Math.floor(py / this.cs), 0, Math.max(0, this.ch - 1));
      /* Neu rechnen, wenn das Ziel die Zelle wechselt — sonst hoechstens 4x/s. */
      if (!this.ready || cx !== this.tcx || cy !== this.tcy || this.t <= 0) {
        this.t = .25; this.build(L, px, py);
      }
    },
    /* Richtung zum Nachbarfeld mit der kleinsten Entfernung. */
    dirAt(x, y) {
      if (!this.ready) return null;
      const cw = this.cw, ch = this.ch, D = this.dist;
      const cx = clamp(Math.floor(x / this.cs), 0, cw - 1), cy = clamp(Math.floor(y / this.cs), 0, ch - 1);
      const here = D[cy * cw + cx];
      if (here < 0) return null;          /* eingemauert — kein Weg bekannt */
      let bx = 0, by = 0, bd = here;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        const nx = cx + ox, ny = cy + oy;
        if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
        const v = D[ny * cw + nx];
        if (v >= 0 && v < bd) { bd = v; bx = ox; by = oy; }
      }
      if (!bx && !by) return null;        /* schon am Ziel */
      return Math.atan2(by, bx);
    }
  },
  level: null, hash: new SpatialHash(110), _tmp: [], _tmp2: [], _tmp3: [],
  pickups: [], powerups: [], runes: [], petDrops: [], spawnQueue: [], spawnAcc: 0, _maxSimultaneous: 50, run: null,
  levelQueue: [], relicQueue: [], newUnlocks: [], charSelIdx: 0, waveEnding: false, enemyPool: [],
  rng: null, seed: 0, daily: false, mods: [], bossAlive: false, _tutI: null,
  endless: false, manualSeed: 0, combo: 0, comboT: 0, timeScale: 1, hitstop: 0, speedBase: 1,
  deathInfo: null, lastHitBy: null, swapT: 0, _shakeAngled: false, epilog: null, speedMul: 1, sepToggle: false,

};
