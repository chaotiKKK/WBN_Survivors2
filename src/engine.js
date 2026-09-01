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

  init() {
    Combat.setWorld(this);
    this.cv = $('game'); this.ctx = this.cv.getContext('2d', { alpha: false });
    this.resize(); addEventListener('resize', () => this.resize());
    try { TUNE.init(); UI.initTune(); } catch (e) { }
    Input.init();
    FX.prefill(); Projectiles.prefill(150); EnemyBullets.prefill(200);
    UI.renderTitle(); UI.show('scTitle');
    this.applyQuality();
    this.danger = OPT().difficulty;
    this.bindUI();
    if (Input.isTouch) $('touch').classList.remove('hidden');
    document.addEventListener('visibilitychange', () => { if (document.hidden && OPT().autoPause) this.autoPause(); });
    addEventListener('blur', () => { if (OPT().autoPause) this.autoPause(); });
    UI.initFit();
    AudioSys.init();
    AudioSys.musicOn = true;
    this.playIntro();
    requestAnimationFrame(t => this.loop(t));
  },
  /* ---- Studio-Vorspann: laeuft einmal beim Start, jederzeit ueberspringbar ---- */
  playIntro() {
    const el = document.getElementById('intro');
    if (!el) return;
    let weg = false;
    const schliessen = () => {
      if (weg) return;
      weg = true;
      el.style.transition = 'opacity .35s ease-in';
      el.style.opacity = '0';
      setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 380);
      removeEventListener('keydown', schliessen, true);
      removeEventListener('pointerdown', schliessen, true);
      /* Der Vorspann ist zugleich die Nutzergeste, die Ton erlaubt. */
      try { AudioSys.init(); AudioSys.musicOn = true; } catch (e) { }
      /* Direkt im Anschluss: Sebbo laeuft rein und zersaegt den Bildschirm. */
      setTimeout(() => { try { Game.sebboIntro(); } catch (e) { } }, 260);
    };
    addEventListener('keydown', schliessen, true);
    addEventListener('pointerdown', schliessen, true);
    setTimeout(schliessen, 11400);   /* dreifache Standzeit, jederzeit ueberspringbar */
  },
  /* ---- Sebbos Auftritt: reinlaufen, ausholen, den Bildschirm zersaegen ----
     Laeuft einmal nach dem Studio-Vorspann. Die Leinwand liegt ueber allem und
     zeigt eine eigene Fassung des Titelhintergrunds. Sebbo rennt von links rein,
     reisst die Kettensaege sofort hoch und zersaegt das Bild entlang einer
     gezackten Linie; im Aufprall zerfaellt der Schnappschuss in viele Fetzen, die
     mit Flugbahn, Drehung und Schwerkraft auseinanderfliegen - darunter liegt das
     echte Menue, auf das am Ende weichgeblendet wird. Jederzeit ueberspringbar. */
  sebboIntro(fertig) {
    const cv = document.getElementById('sawfx');
    const ende = () => { if (cv) { cv.classList.remove('on'); cv.style.transition = ''; cv.style.opacity = ''; } if (fertig) fertig(); };
    if (!cv || OPT().reduceFlicker) { ende(); return; }   /* reduzierte Bewegung: ueberspringen */
    /* Erst sichtbar schalten, dann messen: bei display:none liefert
       clientWidth 0, und der Notnagel innerWidth stimmt nur zufaellig. */
    cv.classList.add('on');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cv.clientWidth || innerWidth, H = cv.clientHeight || innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const x = cv.getContext('2d');
    /* Ohne Zeichenkontext sofort zurueck: `.on` steht schon, und der Aufrufer
       faengt Ausnahmen ab - die Blende bliebe sonst ueber dem Menue liegen. */
    if (!x) { ende(); return; }
    x.setTransform(dpr, 0, 0, dpr, 0, 0);

    /* Kuerzere Laufzeit -> die Saege geht "sofort" hoch; die Schnittphase laeuft
       laenger, damit die Fetzen sichtbar wegfliegen. */
    const T_LAUF = 0.90, T_HIEB = 0.62, T_SCHNITT = 0.92;
    const AUFPRALL = 0.55;                 /* Anteil des Hiebs, ab dem es schneidet */
    const bodenY = H * 0.78, hoehe = Math.max(150, Math.min(H * 0.52, 300));
    const zielX = W * 0.62;
    let t0 = null, saege = null, abgebrochen = false, schnitt = null, fetzen = null;
    let saegeVersucht = false, vollgas = false, gekracht = false;

    const raus = (sofort) => {
      removeEventListener('keydown', ueber, true);
      removeEventListener('pointerdown', ueber, true);
      removeEventListener('resize', ueber);
      if (saege) { try { saege.stop(); } catch (e) { } }
      if (sofort || !cv) { ende(); return; }
      /* Blende auf den Titelscreen: die Leinwand liegt noch ueber dem Menue und
         wird weichgeblendet, statt hart zu verschwinden. */
      cv.style.transition = 'opacity .34s ease-in';
      cv.style.opacity = '0';
      setTimeout(ende, 360);
    };
    const ueber = () => { abgebrochen = true; };
    addEventListener('keydown', ueber, true);
    addEventListener('pointerdown', ueber, true);
    /* Schnittlinie und Figurenmasse werden beim Start berechnet; nach einer
       Groessenaenderung passen sie nicht mehr - dann lieber sauber abbrechen. */
    addEventListener('resize', ueber);

    /* Gezackte Schnittlinie - einmal gewuerfelt, damit sie ruhig steht. */
    const zacken = [];
    for (let i = 0; i <= 26; i++) {
      zacken.push({ fx: i / 26, dy: (i % 2 ? -1 : 1) * (5 + Math.random() * 13) });
    }
    const linieY = (fx) => bodenY - hoehe * 0.42 + (fx - 0.5) * H * 0.16;
    const pfad = (g, bis) => {
      g.moveTo(0, linieY(0) + zacken[0].dy);
      for (const z of zacken) { if (z.fx > bis) break; g.lineTo(z.fx * W, linieY(z.fx) + z.dy); }
    };

    /* `g` ist Parameter, weil der Schnappschuss auf eine zweite Leinwand geht. */
    const zeichneFigur = (g, img, bild, px, py, h) => {
      if (!img.complete || !img.naturalWidth) return;
      g.save(); g.translate(px, py);
      g.drawImage(img, bild * SEBBO_CELL, 0, SEBBO_CELL, SEBBO_CELL, -h / 2, -h, h, h);
      g.restore();
    };

    const funken = (fx, n) => {
      for (let i = 0; i < n; i++) {
        const f = Math.max(0, fx - Math.random() * .06), sx = f * W, sy = linieY(f);
        x.fillStyle = ['#ffd24a', '#fff3b0', '#ff8a3d'][i % 3];
        const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 22;
        x.fillRect(sx + Math.cos(a) * r, sy + Math.sin(a) * r * .5, 2, 2);
      }
    };

    /* Schnappschuss (Titelbild + Sebbo im Endbild) - einmal beim Aufprall. */
    const schnappschuss = () => {
      schnitt = document.createElement('canvas');
      schnitt.width = cv.width; schnitt.height = cv.height;
      const sg = schnitt.getContext('2d');
      sg.setTransform(dpr, 0, 0, dpr, 0, 0);
      Game.renderTitleBg(sg);
      zeichneFigur(sg, _sebboChop, 9, zielX, bodenY, hoehe);
    };

    /* Spalten ober- und unterhalb der Schnittlinie werden zu Fetzen mit eigener
       Flugbahn (vx/vy), Schwerkraft (g) und Drehung (rot). Die Bahn ist rein
       parametrisch in f (0..1) - so bleibt sie bei Frame-Aussetzern (verdecktes
       Tab friert rAF ein) formstabil statt zu springen. */
    const baueFetzen = () => {
      fetzen = [];
      const NCOL = 16, colW = W / NCOL;
      for (let i = 0; i < NCOL; i++) {
        const sx = i * colW, cx = sx + colW / 2;
        const cutY = Math.max(1, Math.min(H - 1, linieY((i + .5) / NCOL)));
        const rel = (cx - W / 2) / (W / 2);          /* -1 links, +1 rechts */
        const drift = rel * W * .42 + (Math.random() - .5) * W * .08;
        fetzen.push({                                 /* oberer Fetzen: fliegt hoch-raus */
          sx, sy: 0, sw: colW, sh: cutY, cx, cyc: cutY / 2,
          vx: drift, vy: -H * .26 - Math.random() * H * .08, g: H * .62,
          rot: (Math.random() - .5) * 2.2
        });
        fetzen.push({                                 /* unterer Fetzen: fliegt tief-raus */
          sx, sy: cutY, sw: colW, sh: H - cutY, cx, cyc: cutY + (H - cutY) / 2,
          vx: drift, vy: H * .22 + Math.random() * H * .08, g: H * .55,
          rot: (Math.random() - .5) * 2.2
        });
      }
    };

    const zeichneFetzen = (f) => {
      x.clearRect(0, 0, W, H);
      for (const p of fetzen) {
        const a = 1 - f * 1.12;                       /* Fetzen faden aus -> Menue scheint durch */
        if (a <= 0) continue;
        const dx = p.vx * f, dy = p.vy * f + p.g * f * f;
        x.save();
        x.globalAlpha = a;
        x.translate(p.cx + dx, p.cyc + dy);
        x.rotate(p.rot * f);
        x.drawImage(schnitt, p.sx * dpr, p.sy * dpr, p.sw * dpr, p.sh * dpr, -p.sw / 2, -p.sh / 2, p.sw, p.sh);
        x.restore();
      }
    };

    /* Die Schnittphase zeichnet aus dem Schnappschuss und braucht den
       Hintergrund nicht - deshalb steht er in den Phasen, nicht davor. */
    const bild = (t) => {
      if (t < T_LAUF) {                                  /* --- reinlaufen --- */
        x.clearRect(0, 0, W, H); Game.renderTitleBg(x);
        const f = t / T_LAUF, e = 1 - Math.pow(1 - f, 2);
        const px = -hoehe * .6 + (zielX + hoehe * .6) * e;
        zeichneFigur(x, _sebboRun, Math.floor(t * 13) % 8, px, bodenY, hoehe);
        return false;
      }
      const th = t - T_LAUF;
      if (th < T_HIEB) {                                 /* --- ausholen und Hieb --- */
        x.clearRect(0, 0, W, H); Game.renderTitleBg(x);
        const f = th / T_HIEB;
        const b = Math.min(9, Math.floor(f * 10));
        zeichneFigur(x, _sebboChop, b, zielX, bodenY, hoehe);
        if (f >= AUFPRALL) {
          const fx = (f - AUFPRALL) / (1 - AUFPRALL);
          x.save(); x.strokeStyle = '#fff3b0'; x.lineWidth = 3; x.globalAlpha = .9;
          x.beginPath(); pfad(x, fx); x.stroke(); x.restore();
          funken(fx, 16);
        }
        return false;
      }
      /* --- die Fetzen fliegen --- */
      const ts = th - T_HIEB;
      if (ts >= T_SCHNITT) return true;
      if (!schnitt) { schnappschuss(); baueFetzen(); }
      zeichneFetzen(ts / T_SCHNITT);
      return false;
    };

    const schlag = (ts) => {
      if (t0 === null) t0 = ts;
      const t = (ts - t0) / 1000;
      if (abgebrochen) { raus(true); return; }
      /* Nur ein Versuch: chainsaw() gibt bei abgeschaltetem Ton null zurueck,
         ohne Flagge liefe der Versuch in jedem Bild neu. */
      if (!saegeVersucht && t > T_LAUF - .45) {
        saegeVersucht = true;
        saege = AudioSys.chainsaw(T_HIEB + T_SCHNITT + .5, .30);
        if (saege) saege.rev(0);
      }
      /* Sofort hochreissen: Vollgas genau dann, wenn Sebbo sich aufstellt.
         rev() setzt sieben Rampen (drei Saegezahn-Oszillatoren plus Tiefpass,
         Bandpass, LFO, LFO-Tiefe). */
      if (saege && !vollgas && t > T_LAUF - .12) { vollgas = true; saege.rev(1); }
      /* Krachender Aufprall genau beim Schnitt: Explosion + Luftzug + Splitter. */
      if (!gekracht && t > T_LAUF + T_HIEB) {
        gekracht = true;
        try { AudioSys.rBoom(1.05, .5); AudioSys.rWhoosh(1.2, .12); AudioSys.rDebris(10, .3); } catch (e) { }
      }
      /* Ein Zeichenfehler wuerde sonst den rAF-Faden toeten: Blende bliebe
         ueber dem Menue liegen, die Saege liefe weiter. */
      let fertigJetzt;
      try { fertigJetzt = bild(t); }
      catch (e) { raus(true); return; }
      if (fertigJetzt) { raus(false); return; }
      requestAnimationFrame(schlag);
    };
    /* Data-URIs dekodieren asynchron. Ohne Warten laeuft die Sequenz zwar
       ab, aber ohne sichtbare Figur - der Betrachter saehe nur den Schnitt.
       Hoechstens eine halbe Sekunde warten, danach trotzdem starten. */
    const bereit = () => (_sebboRun.complete && _sebboRun.naturalWidth &&
                          _sebboChop.complete && _sebboChop.naturalWidth);
    if (bereit()) { requestAnimationFrame(schlag); return; }
    let gewartet = 0;
    const warten = () => {
      if (abgebrochen) { raus(true); return; }
      gewartet += 1;
      if (bereit() || gewartet > 30) { requestAnimationFrame(schlag); return; }
      requestAnimationFrame(warten);
    };
    requestAnimationFrame(warten);
  },
  /* ---- Musikmodus umschalten ---- */
  cycleMusicMode(dir) {
    AudioSys.init();
    const styles = AudioSys.STYLE_ORDER;
    const total = styles.length;
    let cur = Math.max(0, styles.indexOf(AudioSys._style()));
    cur = (cur + (dir || 1) + total) % total;
    OPT().musicStyle = styles[cur];
    AudioSys._nextTime = null;
    UI.toast('Musikmodus ' + (cur + 1) + '/' + total + ': ' + AudioSys.CHIPTUNE_STYLES[styles[cur]].label);
    Save.save();
    AudioSys.sfx('ui');
    if (UI.cur === 'scOptions') UI.renderOptions();
    if (UI.cur === 'scMusic') { UI.renderMusicBar(); AudioSys.previewStyle(); }
  },
  toggleMusicMute() {
    const o = OPT();
    if (o.music > 0) { this._musicVolBak = o.music; o.music = 0; UI.toast('Musik stumm'); }
    else { o.music = this._musicVolBak || .5; UI.toast('Musik an (' + Math.round(o.music * 100) + '%)'); }
    AudioSys.refresh(); Save.save(); AudioSys.sfx('ui');
    if (UI.cur === 'scOptions') UI.renderOptions();
  },
  resize() {
    const d = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = Math.min(this.qualityProfile().dpr, d);
    this.W = this.cv.clientWidth; this.H = this.cv.clientHeight;
    this.cv.width = Math.floor(this.W * this.dpr); this.cv.height = Math.floor(this.H * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  },
  quality() { return (Save.data && Save.data.opts && Save.data.opts.quality != null) ? Save.data.opts.quality : 2; },
  qualityProfile() {
    const q = this.quality();
    return q <= 0 ? { name: 'Mobil', particles: 0, lights: false, shadows: false, glow: false, dpr: 1 } : q === 1 ? { name: 'Standard', particles: .55, lights: true, shadows: false, glow: true, dpr: 1.5 } : { name: 'Hoch', particles: 1, lights: true, shadows: true, glow: true, dpr: 2 };
  },
  applyQuality() {
    this.resize();
    const o = OPT();
    document.querySelector('.scan').style.display = o.crt && !o.reduceFlicker ? '' : 'none';
    document.body.classList.toggle('cb', !!o.colorblind);
    document.body.dataset.qualityProfile = this.qualityProfile().name;
  },
  bindUI() {
    document.body.addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const a = b.dataset.act; AudioSys.init(); AudioSys.sfx('ok');
      switch (a) {
        case 'play': this.daily = false; this.coop = false; this.charSelIdx = 0; this.danger = OPT().difficulty; this.manualSeed = 0; UI.renderChars(0); UI.show('scChar'); break;
        case 'coop': this.daily = false; this.coop = true; this.charSelIdx = 0; this.danger = OPT().difficulty; this.manualSeed = 0; UI.renderChars(0); UI.show('scChar'); break;
        /* --- Online-Koop --- */
        case 'netOpen': UI.netMode = 'none'; UI.renderNet(); UI.show('scNet'); break;
        case 'netBack': UI.renderTitle(); UI.show('scTitle'); break;
        case 'netHost': UI.netMode = 'none'; Net.hostRoom(); UI.renderNet(); break;
        case 'netJoinMode': UI.netMode = UI.netMode === 'join' ? 'none' : 'join'; UI.renderNet(); break;
        case 'netJoinGo': Net.joinRoom($('netCodeIn').value); break;
        case 'netManualMode': UI.netMode = UI.netMode === 'manual' ? 'none' : 'manual'; UI.renderNet(); break;
        case 'netManualCreate': Net.run(Net.manualCreate(), 'Host-Code konnte nicht erzeugt werden'); break;
        case 'netManualJoin': Net.run(Net.manualJoin($('netManualIn').value), 'Antwort auf den Host-Code fehlgeschlagen'); break;
        case 'netManualAccept': Net.run(Net.manualAccept($('netManualIn').value), 'Antwort-Code nicht angenommen'); break;
        case 'netCopyCode': UI.copyText(Net.code || ''); break;
        case 'netCopyManual': UI.copyText($('netManualOut').value); break;
        case 'netHangUp': Net.hangUp(); UI.renderNet(); break;
        case 'daily': this.daily = true; this.coop = false; this.charSelIdx = 0; this.danger = OPT().difficulty; this.manualSeed = 0; UI.renderChars(0); UI.show('scChar'); break;
        case 'tutSkip': this.hideTutorial(); break;
        case 'options': UI.renderOptions(); UI.push('scOptions'); break;
        case 'pauseOptions': UI.renderOptions(); UI.push('scOptions'); break;
        case 'optBack': UI.back('scTitle'); break;
        case 'openTune': UI.renderTune(); UI.show('scTune'); break;
        case 'tuneBack': UI.show('scOptions'); UI.renderOptions(); break;
        case 'tuneTab': TUNE.tab = b.dataset.val; TUNE.sel = null; UI.renderTune(); break;
        case 'tuneSel': TUNE.sel = b.dataset.val; UI.renderTune(); break;
        case 'tuneResetOne':
          if (TUNE.sel) { TUNE.resetOne(TUNE.tab, TUNE.sel); UI.renderTune(); UI.toast('Zurückgesetzt'); AudioSys.sfx('ok'); }
          break;
        case 'tuneResetAll':
          TUNE.resetAll(); UI.renderTune(); UI.toast('Alle Werte auf Werkseinstellung'); AudioSys.sfx('ok');
          break;
        case 'tuneExport':
          $('tuneIO').value = TUNE.exportJson();
          try { $('tuneIO').select(); document.execCommand('copy'); UI.toast('In die Zwischenablage kopiert'); }
          catch (e) { UI.toast('Ausgegeben — Text markieren und kopieren'); }
          AudioSys.sfx('ok');
          break;
        case 'tuneImport': {
          const err = TUNE.importJson($('tuneIO').value);
          if (err) { UI.toast(err); AudioSys.sfx('err'); }
          else { UI.renderTune(); UI.toast('Werte eingespielt'); AudioSys.sfx('level'); }
          break;
        }
        case 'achv': UI.renderAchv(); UI.show('scAchv'); break;
        case 'achvBack': UI.renderTitle(); UI.show('scTitle'); break;
        case 'jingle': AudioSys.sfx('frohes_neues'); AudioSys.jingle('frohes_neues'); UI.toast('Frohes neues Jahr aus Wiesbaden!'); break;
        case 'codex': UI.renderCodex(); UI.show('scCodex'); break;
        case 'codexBack': UI.renderTitle(); UI.show('scTitle'); break;
        case 'codexTab': UI.codexTab = b.dataset.val; UI.renderCodex(); break;
        case 'wipe': if (confirm('Speicherstand wirklich löschen? Alle Freischaltungen gehen verloren.')) { Save.wipe(); UI.renderTitle(); UI.toast('Speicher gelöscht'); } break;
        case 'dangerUp': this.danger = clamp(this.danger + 1, 0, Game.dangerMax()); UI.renderChars(this.charSelIdx); break;
        case 'dangerDown': this.danger = clamp(this.danger - 1, 0, Game.dangerMax()); UI.renderChars(this.charSelIdx); break;
        case 'cycleMusic': this.cycleMusicMode(1); break;
        case 'setMusicStyle': UI.setMusicStyle(parseInt(b.dataset.val, 10) || 0); break;
        case 'openMusic': UI.renderMusicBar(); UI.push('scMusic'); break;
        case 'musicBack': UI.back('scChar'); break;
        case 'musicPreview':
          AudioSys.previewStyle();
          UI.toast('Vorschau: ' + AudioSys.CHIPTUNE_STYLES[AudioSys._style()].label);
          break;
        case 'charBack':
          if (this.coop && this.charSelIdx === 1) { this.charSelIdx = 0; UI.renderChars(0); }
          else { UI.renderTitle(); UI.show('scTitle'); }
          break;
        case 'charConfirm':
          if (this.coop && this.charSelIdx === 0) { this.charSelIdx = 1; UI.renderChars(1); }
          else { UI.renderControls(); UI.show('scControls'); }
          break;
        case 'controlsOK': this.startRun(); break;
        case 'controlsBack': UI.renderChars(this.charSelIdx); UI.show('scChar'); break;
        case 'speedSet': {
          const lv = clamp(parseInt(b.dataset.val, 10) || 5, 1, 10);
          if (OPT().gameSpeed !== lv) {
            OPT().gameSpeed = lv; Save.save(); AudioSys.sfx('ui');
            if (this.state === 'play') { this.speedBase = SPEED_MULT(lv); UI.renderHud(); }
            UI.renderControls();
          }
          break;
        }
        case 'diffSet': {
          const dv = clamp(parseInt(b.dataset.val, 10) || 0, 0, 5);
          if (OPT().difficulty !== dv) { OPT().difficulty = dv; Save.save(); AudioSys.sfx('ui'); UI.renderControls(); }
          break;
        }
        case 'seedReroll':
          this.manualSeed = (Math.random() * 0xffffffff) >>> 0;
          Save.save(); AudioSys.sfx('ui');
          UI.renderControls();
          UI.toast('Seed: ' + this.manualSeed);
          break;
        case 'reroll': ShopSystem.reroll(this.wave, this.players); break;
        case 'wager': this.acceptWager(); UI.renderShop(); break;
        case 'dangerMidRun': this.dangerMidRun(); break;
        case 'relicSkip': this.skipRelic(); break;
        case 'nextWave': this.startWave(this.wave + 1); break;
        case 'resume': this.state = 'play'; UI.show(null); $('hud').classList.remove('hidden'); break;
        case 'quit': this.endRun(false); break;
        case 'prestige':
          if ((Save.data.glory || 0) >= 100 && (Save.data.prestige || 0) < PRESTIGE_MAX) {
            Save.data.glory -= 100; Save.data.prestige = (Save.data.prestige || 0) + 1; Save.save();
            AudioSys.sfx('ui');
            const pl = Math.min(PRESTIGE_MAX, Save.data.prestige);
            UI.toast(`PRESTIGE ${Save.data.prestige}/${PRESTIGE_MAX} — dauerhaft +${pl * PRESTIGE_MAT_PCT}% Material & +${pl * PRESTIGE_DMG_PCT}% Schaden`);
            UI.renderEnd(Game._endWon === true);
          } else { AudioSys.sfx('err'); UI.toast((Save.data.prestige || 0) >= PRESTIGE_MAX ? `Maximal ${PRESTIGE_MAX} Prestige-Stufen erreicht` : 'Mindestens 100 Ruhm nötig'); }
          break;
        case 'startPerk': {
          const pv = b.dataset.val;
          if (pv === 'tier') {
            const cur = Math.min(2, Save.data.startTier || 0);
            if (cur < 2 && (Save.data.glory || 0) >= 150) {
              Save.data.glory -= 150; Save.data.startTier = cur + 1; Save.save(); AudioSys.sfx('ok');
              UI.toast('Start-Waffen-Tier +1 — künftige Runs starten mit Stufe ' + (Save.data.startTier + 1));
            } else { AudioSys.sfx('err'); UI.toast(cur >= 2 ? 'Start-Stufe 3 ist das Maximum' : 'Mindestens 150 Ruhm nötig'); }
          } else {
            if (Save.data.startItem) { AudioSys.sfx('err'); UI.toast('Start-Item bereits aktiv: ' + ITEM_BY_ID[Save.data.startItem].name); }
            else if ((Save.data.glory || 0) >= 150) {
              Save.data.glory -= 150; Save.data.startItem = 'kaffee'; Save.save(); AudioSys.sfx('ok');
              UI.toast('Start-Item aktiv: Kurhaus-Kaffee (+6% Tempo, +4% Angriffstempo)');
            } else { AudioSys.sfx('err'); UI.toast('Mindestens 150 Ruhm nötig'); }
          }
          UI.renderEnd(Game._endWon === true);
          break;
        }
        case 'again': this.charSelIdx = 0; UI.renderChars(0); UI.show('scChar'); break;
        case 'toTitle':
          if (UI.cur === 'scEndless') this.endRun(true);
          UI.renderTitle(); UI.show('scTitle'); this.state = 'title'; break;
        case 'seedPlay':
          const sv = $('seedInput').value.trim();
          this.manualSeed = (parseInt(sv, 10) || 0) >>> 0;
          if (!/^[0-9]{1,10}$/.test(sv)) { UI.toast('Bitte eine Zahl als Seed eingeben (0-9)'); break; }
          this.daily = false; this.coop = false; this.charSelIdx = 0; this.danger = OPT().difficulty;
          UI.renderChars(0); UI.show('scChar');
          break;
        case 'stats': UI.renderStats(); UI.show('scStats'); break;
        case 'statsBack': UI.renderTitle(); UI.show('scTitle'); break;
        case 'code': UI.renderCode(); UI.show('scCode'); break;
        case 'codeBack': UI.renderTitle(); UI.show('scTitle'); break;
        case 'codeExport': $('codeBox').value = Save.exportCode(); break;
        case 'codeCopy':
          const tb = $('codeBox');
          if (!tb.value) { UI.toast('Erst einen Code erzeugen'); break; }
          tb.select(); tb.setSelectionRange(0, 999999);
          try { document.execCommand('copy'); UI.toast('Code kopiert'); }
          catch (e2) { UI.toast('Code markiert — manuell kopieren'); }
          break;
        case 'codeImport': {
          const err = Save.importCode($('codeBox').value.trim());
          if (err) { AudioSys.sfx('err'); UI.toast(err); }
          else { AudioSys.sfx('level'); UI.renderCode(); UI.renderTitle(); UI.toast('Spielstand importiert'); }
          break;
        }
        case 'winNow': this.wave = 20; this.endRun(true); break;
        case 'continueEndless': this.endless = true; this.state = 'play'; UI.show(null); $('hud').classList.remove('hidden'); this.startWave(this.wave); break;
        case 'lvlReroll': this.rerollLevelChoices(); break;
        case 'sim': UI.toast('Simulation läuft …'); setTimeout(() => BalanceSim.run(parseInt(b.dataset.val, 10) || 2000), 30); break;
        case 'simClear': $('simOut').classList.add('hidden'); UI.refreshNav(); break;
        case 'simJson':
          if (BalanceSim._lastJson) {
            const box = $('codeBox'); box.value = BalanceSim._lastJson;
            $('codeInfo').textContent = 'Balance-Sim-Bericht als JSON — kopieren und speichern (die Zahlen entsprechen exakt dem Bericht im Kompendium).';
            UI.show('scCode');
          } else { AudioSys.sfx('err'); UI.toast('Erst eine Simulation ausführen (Kompendium → Balance-Simulation)'); }
          break;
        case 'fb': Feedback.submit(b.dataset.val); break;
      }
    });
  },
  setRunSeed(seed) {
    this.seed = (seed >>> 0) || 1;
    this.manualSeed = this.seed;
    this.rng = new RNG(this.seed);
    RAND = this.rng.next.bind(this.rng);
    return this.seed;
  },
  startRun() {
    AudioSys.init(); AudioSys.musicOn = true;
    if (Net.isHost()) this.coop = true;   /* Online-Koop laeuft immer zu zweit */
    this.setRunSeed(this.daily ? this.dailySeed() : (this.manualSeed || (Math.random() * 0xffffffff) >>> 0));
    this.mods = shuffle(MODS.slice()).slice(0, 2);
    this.endless = false; this.combo = 0; this.comboT = 0; this.timeScale = 1; this.hitstop = 0; this.speedMul = 1; this.speedBase = SPEED_MULT(OPT().gameSpeed);
    this.lastHitBy = null; this.deathInfo = null; this.swapT = 0; this.epilog = null; this._curBoss = null;
    this.banished = []; ShopSystem.locked = {};
    this.players = [new Player(0, this.sel[0])];
    if (this.coop) this.players.push(new Player(1, this.sel[1]));
    if (Input.isTouch) $('tab3').classList.toggle('hidden', !this.coop);
    for (const p of this.players) p.addWeapon(p.char.startWeapon, 0);
    /* Ruhm-Perks: Start-Waffen-Tier +1/+2 und Start-Item aus dem Kurhaus */
    const stTier = Math.min(2, Save.data.startTier || 0);
    if (stTier > 0) for (const p of this.players) { const w = p.weapons[0]; if (w) { w.tier = Math.min(3, stTier); p.recalc(); } }
    if (Save.data.startItem) for (const p of this.players) { const it = ITEM_BY_ID[Save.data.startItem]; if (it && !p.itemCounts[it.id]) p.addItem(it); }
    this.materials = 0; this.wave = 0; this.newUnlocks = [];
    this.run = {
      kills: 0, bosses: 0, dmg: 0, materials: 0, time: 0,
      track: {
        elemDmg: 0, chain10: 0, maxChain: 0, pulled: 0, fullCharges: 0, needleHeal: 0,
        critStreak: 0, burnKills: 0, poisonKills: 0, boomKills: 0, cursed: 0, flawless: true, starfall3: 0, lowHpWaves: 0, reactions: 0, maxCombo: 0
      }
    };
    Save.data.runs++; Save.save();
    this.arena = pick(ARENAS);
    this.applyContractBonuses();
    this.startWave(1);
  },
  startWave(n) {
    this.wave = n;
    for (const p of this.players) { p.wagerFragile = false; p.wagerNoHeal = false; }
    this.rollWager(n);
    this.endlessSetup(n);
    this.rollContract(n);
    this.rollArenaMod(n);
    this.hazObjs.length = 0;
    this.splats.length = 0;
    this.magnetSweep = 0;
    if (n > 20 && !this.endless) { this.state = 'paused'; UI.navIdx = 0; UI.show('scEndless'); return; }
    this.state = 'play'; this.waveEnding = false; this.bossAlive = false;
    this.otT = 0; this.otLevel = 0; this.otTick = 0;
    UI.show(null); $('hud').classList.remove('hidden');
    if (n >= 5 && n % 5 === 0) {
      const qp = this.players.filter(p => p.alive);
      if (qp.length) { const sp = pick(qp); sp.sayQuote(); }
    }
    if (n % 5 === 0) {
      const tier = clamp(Math.floor(n / 5) - 1, 0, 3);
      const pool = [BOSSES[tier], BOSSES[4 + tier]].filter(Boolean);
      this._curBoss = (n > 20 || this.endless) ? pick(BOSSES) : (pool.length ? pool[(this.seed + n) % pool.length] : BOSSES[tier]);
      this.arena = ARENAS.find(a => a.id === this._curBoss.arena) || ARENAS[4];
    }
    else { this._curBoss = null; if (n === 1 || n % 5 === 1) this.arena = pick(ARENAS.slice(0, 8)); }
    this.level = new Level(this.arena, n);
    this.buildParallaxPending = true;
    this.level.spawnBarrels(clamp(3 + Math.floor(n / 3) + (this.endless && n > 20 ? this.endlessTier(n) * 2 : 0), 3, 18));
    this.level.announce = SPAWN_ANNOUNCE;
    this.runes.length = 0;
    this.petDrops.length = 0;
    AudioSys.setAmbient(this.arena.id);
    this.waveDuration = clamp(18 + n * .8, 18, 35) * (this.modActive('zeitdruck') ? .8 : 1);
    this.spawnMul = 1;
    this.waveTimer = this.waveDuration;
    this.enemies.length = 0; this.enemyPool.length = 0;
    Projectiles.clear(); EnemyBullets.clear(); FX.clear();
    this.pickups.length = 0; this.powerups.length = 0;
    this.players.forEach((p, i) => {
      p.x = this.level.w / 2 + (i === 0 ? -40 : 40); p.y = this.level.h / 2;
      p.tookDamageThisWave = false; p.notstromUsed = false;
      if (!p.alive && (OPT().coopRevive || !this.coop)) { p.alive = true; p.hp = p.maxHp * .5; UI.toast(p.char.name + ' ist zurück im Einsatz'); }
      for (const t of p.turrets) { t.x = p.x + rnd(-30, 30); t.y = p.y + rnd(-30, 30); }
    });
    this.cam.x = this.level.w / 2; this.cam.y = this.level.h / 2;
    this.buildSpawnPlan(n);
    UI.banner(n % 5 === 0 ? 'BOSS-WELLE ' + n : 'WELLE ' + n, 1.6);
    if (n % 5 === 0) AudioSys.sfx('boss'); else AudioSys.sfx('count');
    if (n === 1) this.showTutorial();
    UI.renderHud();
  },
  buildSpawnPlan(n) {
    const D = DANGERS[this.danger];
    this.spawnQueue = []; this.spawnAcc = 0;
    const pool = ENEMIES.filter(e => n >= e.minW);
    const usePool = pool.length > 0 ? pool : ENEMIES;
    /* Gruppen von 3-8 Gegnern, ueber die GESAMTE Welle verteilt */
    const groupSize = clamp(3 + Math.floor(n / 3), 3, 8);
    const totalBudget = Math.round((20 + n * 10 + Math.pow(n, 1.7)) * D.cnt * (this.coop ? 1.5 : 1) * (this.wagerActive('horde') ? 2 : 1));
    const numGroups = Math.max(4, Math.ceil(totalBudget / groupSize));
    const dirs = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
    const L = this.level;
    const waveEnd = this.waveDuration;
    const groupInterval = (waveEnd - SPAWN_ANNOUNCE) / numGroups;
    for (let g = 0; g < numGroups; g++) {
      const dir = dirs[g % 4];
      const sideOff = (RAND() - .5) * 80;
      const edgeX = dir === 0 ? L.w + 40 : dir === Math.PI ? -40 : L.w / 2 + sideOff;
      const edgeY = dir === Math.PI / 2 ? L.h + 40 : dir === -Math.PI / 2 ? -40 : L.h / 2 + sideOff;
      const t = SPAWN_ANNOUNCE + g * groupInterval + RAND() * .5;
      for (let i = 0; i < groupSize; i++) {
        const def = weightedPick(usePool, e => e.w * (1 + (n - e.minW) * .05));
        if (!def) continue;
        const off = (i - (groupSize - 1) / 2) * 36;
        const px = dir === 0 || dir === Math.PI ? edgeX : clamp(edgeX + off, 40, L.w - 40);
        const py = dir === Math.PI / 2 || dir === -Math.PI / 2 ? edgeY : clamp(edgeY + off, 40, L.h - 40);
        const elite = this.danger >= 2 && n >= 6 && RAND() < (.04 + n * .004) * (this.modActive('elite_doppel') ? 2 : 1);
        this.spawnQueue.push({ def, elite, t: t + i * .04, pt: { x: px, y: py } });
      }
    }
    this.spawnQueue.sort((a, b) => a.t - b.t);
    this._maxSimultaneous = 50;
    if (n % 5 === 0) {
      const b = this._curBoss || BOSSES[Math.min(3, Math.floor(n / 5) - 1)];
      this.spawnQueue.push({ boss: b, t: SPAWN_ANNOUNCE + .8 });
      this.spawnQueue.sort((a, b2) => a.t - b2.t);
    }
  },
  endWave() {
    if (this.waveEnding) return;
    this.waveEnding = true;
    /* Abschluss-Moment: kurze Zeitlupe, dann zieht alles Material heran */
    this.hitstop = Math.max(this.hitstop, .12);
    this.timeScale = Math.min(this.timeScale, .3);
    this.magnetSweep = 1.4;
    FX.ripple(this.players[0] ? this.players[0].x : 0, this.players[0] ? this.players[0].y : 0, 320, '#f4c25a', .5);
    AudioSys.duckMusic(.5, .6);
    if (this.wager) {
      const bonusMat = Math.round((12 + this.wave * 3) * this.wager.mat * DANGERS[this.danger].price);
      const bonusXp = Math.round((6 + this.wave * 1.6) * this.wager.xp);
      this.materials += bonusMat; this.run.materials += bonusMat;
      for (const p of this.players) {
        if (!p.alive) continue;
        p.xp += bonusXp;
        while (p.xp >= p.xpNext) { p.xp -= p.xpNext; p.level++; p.xpNext = p.xpFor(p.level); p.pendingLevels++; p.recalc(); }
      }
      UI.toast('Wette gewonnen: ' + this.wager.name + ' — +' + bonusMat + ' Material, +' + bonusXp + ' EP');
      Save.prog('wagers', 1);
      this.wager = null;
    }
    this.contractCheckEnd();
    for (const e of this.enemies) if (!e.dead) { for (let i = 0; i < Math.min(3, e.mat); i++) this.spawnMaterial(e.x, e.y, 1); e.dead = true; }
    const pre = Math.min(PRESTIGE_MAX, Save.data.prestige || 0);
    const waveStart = this.materials;
    for (const m of this.pickups) { this.materials += m.v; this.run.materials += m.v; Save.prog('materials', m.v); }
    this.pickups.length = 0;
    const bonus = Math.floor((this.materials - waveStart) * pre * PRESTIGE_MAT_PCT / 100);
    if (bonus > 0) { this.materials += bonus; this.run.materials += bonus; }
    for (const p of this.players) {
      const inc = Math.round(p.st.harvest * (1 + this.wave * .12));
      if (inc > 0) { this.materials += inc; UI.toast(`${p.char.name}: +${inc} Material (Ernte)`); }
      if (!p.tookDamageThisWave && this.wave === 10) { Save.prog('flawless10', 1); this.unlockCheck(); }
      if (p.alive && p.hp / p.maxHp < .10) { Save.prog('lowHpWaves', 1); }
    }
    Save.progMax('maxMaterialsHeld', this.materials);
    Save.prog('wavesCleared', 1);
    Save.progMax('bestWave', this.wave);
    if (this.coop) Save.prog('coopWaves', 1);
    if (Save.data.bestWave < this.wave) Save.data.bestWave = this.wave;
    if (this.danger >= 3 && this.wave >= 10) Save.prog('danger3wave10', 1);
    if (this.wave >= 15 && this.players.some(p => p.char.id === 'scharfschuetze')) Save.prog('rangerWave15', 1);
    this.unlockCheck(); Save.save();
    for (const p of this.players) if (p.relics) for (const rid of p.relics) { const r = RELIC_BY_ID[rid]; if (r && r.healWave) { p.heal(Math.round(p.maxHp * r.healWave)); p.addBuff('armor', 2, 8); } }
    if (this.endless && this.wave > Save.data.stats.endlessBest) Save.data.stats.endlessBest = this.wave;
    if (this.endless && this.wave >= 30 && this.wave % 10 === 0) {
      /* WERKBANK: jede 10. Endlos-Welle gibt gratis ein Waffen-Tier, einen
         Aufsatz und einen permanenten Buff — hält den Endlos-Fortschritt am
         Laufen, nachdem Shop und Stufen nicht mehr mithalten.
         LÄUFT VOR der Ruhmesruhe: Wellen 30/40/50… sind zugleich %5-Wellen,
         deren Relikt-Wahl per return endet — sonst würde die Werkbank nie greifen. */
      for (const p of this.players) {
        if (!p.alive) continue;
        const wup = p.weapons.filter(w => w.tier < 3).sort((a, b) => a.tier - b.tier)[0];
        if (wup) { wup.tier++; p.recalc(); UI.toast('WERKBANK: ' + WEAPON_BY_ID[wup.id].name + ' → Stufe ' + (wup.tier + 1)); }
        const free = p.weapons.some(w => ((w.attach || []).length - (w.masteryAtt || 0)) < ATT_MAX);
        if (free) {
          const attCand = ATTACHMENTS.filter(a => !p.weapons.every(w => (w.attach || []).includes(a.id)));
          if (attCand.length) {
            const a = pick(attCand);
            const slot = p.weapons.find(w => ((w.attach || []).length - (w.masteryAtt || 0)) < ATT_MAX && !(w.attach || []).includes(a.id)) || p.weapons.find(w => ((w.attach || []).length - (w.masteryAtt || 0)) < ATT_MAX);
            if (slot) { slot.attach = (slot.attach || []).concat([a.id]); p.recalc(); UI.toast('WERKBANK: ' + a.icon + ' ' + a.name + ' montiert'); }
          }
        }
        const B = pick(BUFF_CHESTS);
        if (B.stat === 'maxHp') { p.addBuff('maxHp', B.val, 1e9); p.heal(B.val); }
        else p.addBuff(B.stat, B.val, 1e9);
        UI.toast(p.char.name + ': ' + B.label);
      }
      UI.banner('WERKBANK · Welle ' + this.wave, 2.4);
      AudioSys.jingle('shop');
      Save.prog('buffChests', 1);
    }
    if (this.endless && this.wave >= 25 && this.wave % 5 === 0) {
      /* Ruhmesruhe: Relikt-Wahl, sofern noch Platz ist — sonst Buff-Ruhe */
      const names = [];
      this.relicQueue = [];
      for (const p of this.players) {
        const cand = RELICS.filter(r => !p.relics.includes(r.id));
        if (p.relics.length < RELIC_MAX && cand.length) { this.relicQueue.push(p); continue; }
        const B = pick(BUFF_CHESTS);
        if (B.stat === 'maxHp') { p.addBuff('maxHp', B.val, 1e9); p.heal(B.val); }
        else p.addBuff(B.stat, B.val, 1e9);
        names.push(`${p.char.name}: ${B.label}`);
      }
      if (names.length) UI.toast('Permanente Buffs: ' + names.join(' | '));
      AudioSys.jingle('level');
      Save.prog('buffChests', 1);
      if (this.relicQueue.length) { UI.banner('RUHMESTRUHE · RELIKT-WAHL · Welle ' + this.wave, 2.6); this.nextLevelOrShop(); return; }
      UI.banner('RUHMESTRUHE · Welle ' + this.wave, 2.6);
    }
    this.levelQueue = [];
    for (const p of this.players) for (let i = 0; i < p.pendingLevels; i++) this.levelQueue.push(p);
    for (const p of this.players) p.pendingLevels = 0;
    this.nextLevelOrShop();
  },
  nextLevelOrShop() {
    if (this.levelQueue.length) {
      const p = this.levelQueue[0];
      p.rerollUsed = false;
      this._curChoices = rollUpgrades(p);
      this.state = 'levelup';
      UI.show('scLevel'); UI.renderLevelUp(p, this._curChoices);
      AudioSys.sfx('level');
      AudioSys.jingle('level');
    } else if (this.relicQueue && this.relicQueue.length) {
      const p = this.relicQueue[0];
      const cand = RELICS.filter(r => !p.relics.includes(r.id));
      const pool = cand.slice(), choices = [];
      for (let i = 0; i < 3 && pool.length; i++) choices.push(pool.splice(Math.floor(RAND() * pool.length), 1)[0]);
      this._curRelics = choices;
      this.state = 'relic';
      UI.show('scRelic'); UI.renderRelic(p);
      AudioSys.sfx('rune');
    } else {
      this.state = 'shop';
      ShopSystem.rerolls = 0;
      ShopSystem.generate(this.wave, this.players);
      UI.shopPlayer = 0;
      UI.show('scShop'); UI.renderShop();
      AudioSys.jingle('shop');
    }
  },
  banished: [],
  banishUpgrade(p, c) {
    this.banished = this.banished || [];
    if (this.banished.indexOf(c.name) < 0) this.banished.push(c.name);
    UI.toast('Verbannt: ' + c.name);
    AudioSys.sfx('err');
    this._curChoices = rollUpgrades(p);
    UI.renderLevelUp(p, this._curChoices);
  },
  rerollLevelChoices() {
    const p = this.levelQueue[0]; if (!p || p.rerollUsed) { AudioSys.sfx('err'); return; }
    p.rerollUsed = true; this._curChoices = rollUpgrades(p);
    UI.renderLevelUp(p, this._curChoices); AudioSys.sfx('ui');
  },
  chooseUpgrade(p, c) {
    if (c.kind === 'wup') {
      let best = null;
      for (const w of p.weapons) if (w.tier < 3 && (!best || w.tier < best.tier)) best = w;
      if (best) {
        best.tier++; p.recalc();
        UI.toast(WEAPON_BY_ID[best.id].name + ' → Stufe ' + (best.tier + 1));
      } else { p.base.maxHp = (p.base.maxHp || 0) + 12; p.recalc(); }
    } else if (c.kind === 'item') {
      const cand = ITEMS.filter(it => !p.itemCounts[it.id]);
      const pool2 = cand.length ? cand : ITEMS;
      const it = weightedPick(pool2, e => (6 - e.r) * (e.cursed ? .25 : 1));
      p.addItem(it);
      UI.toast('Fundstück: ' + it.name + (it.cursed ? ' (verflucht!)' : ''));
    } else if (c.kind === 'wnew') {
      const pool2 = ShopSystem.weaponPool();
      const def = pool2.length ? pick(pool2) : null;
      if (def && p.weapons.length < BROTATO_RULES.maxWeapons) {
        const tier = Math.min(1, Math.floor(Game.wave / 6));
        p.addWeapon(def.id, tier);
        UI.toast('Neue Waffe: ' + def.name + (tier ? ' (Stufe ' + (tier + 1) + ')' : ''));
      } else { p.base.maxHp = (p.base.maxHp || 0) + 12; p.recalc(); }
    } else {
      p.base[c.stat] = (p.base[c.stat] || 0) + c.val; p.recalc();
    }
    Save.progMax('maxSpeed', Math.round(218 * (1 + p.st.speed / 100)));
    this.levelQueue.shift();
    AudioSys.sfx('ok');
    this.nextLevelOrShop();
  },
  chooseRelic(p, rid) {
    const r = RELIC_BY_ID[rid];
    if (!r || p.relics.includes(rid)) { AudioSys.sfx('err'); return; }
    p.relics.push(rid); p.recalc();
    const done = RELIC_SETS.filter(s => s.members.every(id => p.relics.includes(id)));
    AudioSys.sfx('rune');
    UI.toast(`${p.char.name}: ${r.name} erhalten — ${r.fl}${done.length ? ' · SET: ' + done.map(s => s.name).join(' + ') : ''}`);
    if (this.relicQueue && this.relicQueue.length) this.relicQueue.shift();
    this.nextLevelOrShop();
  },
  skipRelic() {
    if (this.relicQueue && this.relicQueue.length) this.relicQueue.shift();
    AudioSys.sfx('ui');
    this.nextLevelOrShop();
  },
  endRun(won) {
    this.state = 'end';
    this._endWon = won;
    RAND = Math.random; this.rng = null;
    AudioSys.sfx(won ? 'win' : 'over');
    AudioSys.jingle(won ? 'win' : 'lose');
    this.gloryEarned = Math.max(0, this.wave - 15) * (won ? 2 : 1) + (won ? this.danger : 0);
    Save.data.glory = (Save.data.glory || 0) + this.gloryEarned;
    if (this.endless) Save.data.stats.endlessBest = Math.max(Save.data.stats.endlessBest, this.wave);
    for (const p of this.players) Save.data.mastery[p.char.id] = Math.max(Save.data.mastery[p.char.id] || 0, this.wave);
    if (won) {
      Save.data.wins++; Save.prog('wavesWon', 1);
      if (this.coop) Save.prog('coopWin', 1);
      if (this.danger >= 5) Save.prog('danger5win', 1);
      Save.data.maxDanger = Math.max(Save.data.maxDanger, this.danger);
    }
    for (const p of this.players) Save.progMax('maxLevel', p.level);
    if (!won && !this.deathInfo) {
      let last = null, maxT = -1;
      for (const e of this.enemies) if (e.lastHitBy && e.lastHitBy.t > maxT) { maxT = e.lastHitBy.t; last = e.lastHitBy; }
      this.deathInfo = last || this.lastHitBy || { name: 'unbekannt' };
    }
    const st = Save.data.stats;
    st.kills += this.run.kills; st.dmg += this.run.dmg; st.time += Math.round(this.run.time);
    st.waves += this.wave; st.mats += this.run.materials; st.runs++;
    if (won) st.wins++;
    for (const p of this.players) st.chars[p.char.id] = (st.chars[p.char.id] || 0) + 1;
    for (const p of this.players) for (const w of p.weapons) st.weapons[w.id] = (st.weapons[w.id] || 0) + 1;
    this.epilog = this.makeEpilog(won);
    if (this.daily) {
      const d = this.dailyStamp();
      const fr = Save.data.dailyRuns = Save.data.dailyRuns || {};
      const prev = fr[d] || {};
      const myWave = won ? 21 : this.wave;
      if (!prev.seed || (prev.wave || 0) < myWave) { fr[d] = { wave: myWave, seed: this.seed, mode: this.coop ? 'koop' : 'solo', won: !!won }; }
      Save.save();
    }
    this.unlockCheck(); Save.save();
    this.hideTutorial();
    UI.renderEnd(won); UI.show('scEnd');
    $('hud').classList.add('hidden');
  },
  makeEpilog(won) {
    if (!won) return null;
    const t = this.run.time;
    const vers = ['ERSTLING', 'HELD', 'VOLKSHELD', 'LEGENDE', 'HALBGOTT', 'RETTER WIESBADENS'][Math.min(5, this.danger)];
    return `<b>${vers}</b> — Die ROGUE-KI ist besiegt. Die Nacht über Wiesbaden lichtet sich.
      ${t > 600 ? 'Der Kampf dauerte Stunden, aber die Stadt atmet wieder.' : t > 300 ? 'Ein langer Abend — die Kurhaus-Lichter brennen wieder.' : 'Ein blitzschneller Sieg — kaum Zeit für ein Bierchen.'}
      ${this.mods.length ? 'Getrotzt wurde außerdem: ' + this.mods.map(m => m.name).join(', ') + '.' : ''}
      Bis zum nächsten Run. #WIESBADENLEBT`;
  },
  dailyStamp() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); },
  dailySeed() { const s = this.dailyStamp(); let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; },
  dailyStreak() {
    const d = new Date(); const R = Save.data.dailyRuns || {};
    const fmt = x => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
    let s = 0, i = R[fmt(d)] ? 0 : 1;
    for (; i < 366; i++) { const k = fmt(new Date(d.getTime() - i * 864e5)); if (R[k]) s++; else break; }
    return s;
  },
  dangerMax() { return Save.data.wins > 0 ? 8 : 5; },
  /* Erschuetterungen ADDIEREN sich zu einem Trauma 0..1 - zehn kleine Treffer
     gleichzeitig muessen sich anders anfuehlen als einer. Der Barrierefreiheits-
     Regler wird hier zentral verrechnet, damit ihn kein Aufrufer vergessen kann. */
  /* ---- Wichtigkeitsstufen fuer Trefferfeedback ----
     Vorher lagen 18 verschiedene Zahlenpaare im Code verstreut, von (2, .08)
     bis (22, .7) — jedes einzeln geraten. Damit war weder das Verhaeltnis
     untereinander gehalten noch irgendetwas zentral nachstellbar.

     Drei Stufen, jedes Ereignis bekommt eine. `trauma` ist der Rohbetrag fuer
     addTrauma (dort durch 26 geteilt und quadriert), `stop` die Standzeit des
     Einfrierens in Sekunden.

     Die Standzeiten sind bewusst bei 0,15 s gedeckelt: laenger blockiert das
     Einfrieren spuerbar die Eingabe. Boss- und Elitetreffer lagen vorher bei
     0,22 bzw. 0,30 s. */
  FEEL: {
    klein:  { trauma: 4,  dauer: .12, stop: 0,    scale: 1   },
    mittel: { trauma: 12, dauer: .32, stop: .05,  scale: .5  },
    gross:  { trauma: 20, dauer: .55, stop: .12,  scale: .3  }
  },
  /* Ein Aufruf je Ereignis. x/y duerfen fehlen — dann wackelt es ungerichtet. */
  feedback(x, y, stufe) {
    const F = this.FEEL[stufe] || this.FEEL.mittel;
    if (x == null) this.shake(F.trauma, F.dauer);
    else this.shakeAt(x, y, F.trauma, F.dauer);
    if (F.stop > 0) {
      /* Einmal je Einschlag, nicht je Bild: max/min statt Zuweisung, sonst
         verlaengert ein gehaltener Angriff das Einfrieren endlos. */
      this.hitstop = Math.max(this.hitstop, F.stop);
      this.timeScale = Math.min(this.timeScale, F.scale);
    }
  },
  addTrauma(amount, t) {
    const m = (OPT().reduceFlicker ? .45 : 1) * (OPT().shake != null ? OPT().shake : 1);
    this.cam.trauma = clamp(this.cam.trauma + (amount || 8) * m / 26, 0, 1);
    this.cam.shakeT = Math.max(this.cam.shakeT, t || .3);
  },
  shakeAt(x, y, amount, t) {
    this.addTrauma(amount, t);
    this.cam.shakeDX = x; this.cam.shakeDY = y; this._shakeAngled = true;
  },
  stealMaterial() {
    if (!this.modActive('ressourcen_dieb') || this.materials <= 0) return;
    const n = Math.min(2, this.materials);
    this.materials -= n; this.run.materials -= n;
    FX.number(this.players[0].x, this.players[0].y - 26, '-' + n + ' M', '#f4c25a', .8);
    AudioSys.sfx('tick');
  },
  autoPause() {
    if (this.state === 'play') { this.state = 'paused'; UI.navIdx = 0; UI.show('scPause'); AudioSys.sfx('ui'); }
  },
  modActive(id) { return (this.mods || []).some(m => m.id === id); },
  showTutorial() {
    if (!OPT().tutorial || this._tutI !== null || !this.players.length) return;
    const steps = [
      { t: 3.5, html: 'WASD / Sticks — BEWEGUNG<br><span style="font-size:14px;color:var(--dim)">Weiche den Feinden aus!</span>' },
      { t: 3.5, html: 'ANGRIFFE FEUERN AUTOMATISCH<br><span style="font-size:14px;color:var(--dim)">Dein Arsenal zielt auf den nächsten Feind.</span>' },
      { t: 3.5, html: 'MATERIAL EINSAMMELN<br><span style="font-size:14px;color:var(--gold)">Der goldene Staub — damit kaufst du im Shop.</span>' },
      { t: 4, html: 'FÄHIGKEIT: ' + this.players[0].char.ability.name + '<br><span style="font-size:14px;color:var(--dim)">' + this.players[0].char.ability.desc + '</span>' }
    ];
    this._tutSteps = steps; this._tutI = 0; this._tutT = steps[0].t;
    const el = $('tutHint'); el.classList.remove('hidden'); el.innerHTML = steps[0].html + this._tutSkipBtn();
  },
  hideTutorial() { const el = $('tutHint'); if (el) el.classList.add('hidden'); this._tutI = null; },
  _tutSkipBtn() { return '<button class="btn small" style="pointer-events:auto;margin-top:8px;display:block;margin-left:auto;margin-right:auto" data-act="tutSkip">Überspringen</button>'; },
  unlockCheck() {
    const p = Save.data.progress; this.newUnlocks = this.newUnlocks || [];
    p.bestWave = Math.max(p.bestWave || 0, Save.data.bestWave);
    p.allChars = Save.data.unlockedChars.length >= CHARS.length ? 1 : 0;
    p.allWeapons = WEAPONS.every(w => w.unlockDefault || Save.data.unlockedWeapons.includes(w.id)) ? 1 : 0;
    for (const a of ACHIEVEMENTS) {
      if (Save.data.achievements[a.id]) continue;
      if ((p[a.key] || 0) >= a.need) {
        Save.data.achievements[a.id] = 1;
        this.newUnlocks.push('Erfolg: ' + a.name);
        UI.toast('ERFOLG: ' + a.name); AudioSys.sfx('level');
      }
    }
    for (const c of CHARS) {
      if (!c.unlock || Save.data.unlockedChars.includes(c.id)) continue;
      if ((p[c.unlock.key] || 0) >= c.unlock.need) {
        Save.data.unlockedChars.push(c.id); this.newUnlocks.push('Charakter ' + c.name);
        UI.toast('FREIGESCHALTET: ' + c.name); AudioSys.sfx('level');
      }
    }
    for (const w of WEAPONS) {
      if (w.unlockDefault || !w.unlock || Save.data.unlockedWeapons.includes(w.id)) continue;
      if ((p[w.unlock.key] || 0) >= w.unlock.need) {
        Save.data.unlockedWeapons.push(w.id); this.newUnlocks.push('Waffe ' + w.name);
        UI.toast('FREIGESCHALTET: ' + w.name); AudioSys.sfx('level');
      }
    }
    Save.save();
  },
  spawnEnemyAt(def, x, y, boss) {
    const e = this.enemyPool.pop() || new Enemy();
    e.spawn(def || ENEMIES[0], x, y, this.wave, boss);
    this.endlessBuff(e, this.wave);
    this.enemies.push(e);
    if (boss) this.startBossIntro(e);
    if (!boss && this.time - (this._lastSpawnSfx || 0) > .15) {
      this._lastSpawnSfx = this.time;
      AudioSys.sfx('e_spawn');
    }
    return e;
  },
  resolveSpawnPoint() {
    const L = this.level;
    const p = this.players.find(q => q.alive) || this.players[0];
    const pcx = p ? p.x : L.w / 2, pcy = p ? p.y : L.h / 2;
    const vis = Math.min(this.W, this.H) / 2 / Math.max(this.cam.zoom || 1, .4);
    const rad = clamp(vis * (0.65 + rnd(-.1, .16)), 150, 400);
    for (let tries = 0; tries < 5; tries++) {
      const ang = rnd(TAU);
      let x = clamp(pcx + Math.cos(ang) * rad, 60, L.w - 60);
      let y = clamp(pcy + Math.sin(ang) * rad, 60, L.h - 60);
      const probe = { x, y, r: 16 };
      L.collide(probe); L.collide(probe);
      if (!L.blocksRay(probe.x, probe.y)) return { x: probe.x, y: probe.y };
    }
    return { x: clamp(pcx, 60, L.w - 60), y: clamp(pcy, 60, L.h - 60) };
  },
  spawnAtPoint(def, elite, boss, fixedPt) {
    const L = this.level;
    if (!L.spawnPoints || !L.spawnPoints.length) return this.spawnEnemyAt(def, L.w / 2, L.h / 2, boss);
    let pt;
    if (fixedPt) pt = { x: fixedPt.x, y: fixedPt.y };
    else {
      pt = L.spawnPoints[L.spawnIdx % L.spawnPoints.length];
      L.spawnIdx++;
      for (const p of this.players) {
        if (!p.alive) continue;
        const d = dist(pt.x, pt.y, p.x, p.y);
        if (d < 200) { const a = Math.atan2(pt.y - p.y, pt.x - p.x); pt = { x: pt.x + Math.cos(a) * 200, y: pt.y + Math.sin(a) * 200 }; break; }
      }
    }
    const x = clamp(pt.x + (fixedPt ? 0 : rnd(-40, 40)), 50, L.w - 50), y = clamp(pt.y + (fixedPt ? 0 : rnd(-40, 40)), 50, L.h - 50);
    const e = this.spawnEnemyAt(def, x, y, boss);
    if (elite) e.makeElite();
    if (boss) {
      this.bossAlive = true; UI.banner(boss.name, 2.4); this.feedback(null, null, 'gross');
      if (this.wave >= 15) {
        e.bossVariant = this.wave >= 20 ? 'wut' : 'geifer';
        if (e.bossVariant === 'geifer') { e.spd *= 1.18; e.dmg *= 1.15; e.maxHp *= 1.12; e.hp = e.maxHp; e.poison = 4 + this.wave * .4; }
        else { e.spd *= 1.28; e.dmg *= 1.25; e.maxHp *= 1.25; e.hp = e.maxHp; e.armor += 4; }
        UI.banner(boss.name + ' — ' + (e.bossVariant === 'geifer' ? 'GEIFER' : 'WUT'), 2.4);
      }
    }
    for (let i = 0; i < 8; i++) FX.particle(x, y, crnd(TAU), crnd(50, 150), L.a.accent, .35, 3);
    return e;
  },
  spawnProjectile(o) {
    const p = Projectiles.get();
    Object.assign(p, {
      x: o.x, y: o.y, vx: Math.cos(o.angle) * o.speed, vy: Math.sin(o.angle) * o.speed,
      dmg: o.dmg, owner: o.owner, weapon: o.weapon || null, col: o.col, life: o.life || 1.2, r: o.r || 4,
      critC: o.critC || 0, critM: o.critM || 1.5, pierce: o.pierce || 0, bounce: o.bounce || 0,
      boom: o.boom || 0, slow: o.slow || 0, slowT: o.slowT || 0, poison: o.poison || 0, poisonT: o.poisonT || 0,
      cloud: o.cloud || 0, armorPierce: o.armorPierce || 0, lifesteal: o.lifesteal || 0, healHit: o.healHit || 0,
      pull: o.pull || 0, elemental: !!o.elemental, burn: o.burn || 0, source: o.source || '', hitSet: new Set(),
      shape: o.shape || '', size: o.size || 0, word: o.word || '', homing: o.homing || 0, stick: o.stick || 0, reflected: false, rot: Math.random() * TAU,
      starfall: o.starfall || 0, dead: false, trail: 0
    });
    return p;
  },
  spawnEnemyBullet(x, y, ang, spd, dmg, col, poison, src, ext) {
    const b = EnemyBullets.get();
    b.x = x; b.y = y; b.vx = Math.cos(ang) * spd; b.vy = Math.sin(ang) * spd;
    b.dmg = dmg; b.col = col || '#ff5d6e'; b.life = 4.5; b.r = 6; b.poison = poison || 0; b.dead = false; b.srcName = src || 'Feind';
    b.orbit = ext && ext.orbit || null;
  },
  spawnMaterial(x, y, v) {
    if (this.modIs('nacht')) v = Math.max(v, Math.round(v * 1.5));
    this.pickups.push({ x, y, vx: rnd(-60, 60), vy: rnd(-60, 60), v: v || 1, t: 0, r: 6 });
  },
  spawnPowerup(x, y) {
    const types = [
      { id: 'heal', col: '#5dff9b', name: 'Heilung' },
      { id: 'speed', col: '#39e6ff', name: 'Tempo-Schub' },
      { id: 'dmg', col: '#ff2e88', name: 'Schadensrausch' },
      { id: 'invuln', col: '#ffe27a', name: 'Schild' },
      { id: 'nuke', col: '#ff8a3d', name: 'Schockwelle' },
      { id: 'mats', col: '#f4c25a', name: 'Materialregen' }
    ];
    const t = pick(types);
    this.powerups.push({ x, y, type: t.id, col: t.col, name: t.name, t: 0, r: 12 });
  },
  spawnRune(x, y, id) {
    const def = RUNE_BY_ID[id] || pick(RUNES);
    this.runes.push({ x, y, type: def.id, col: def.col, name: def.name, t: 0, r: 13, vx: rnd(-40, 40), vy: rnd(-40, 40) });
  },
  spawnPetDrop(x, y, id) {
    const def = PET_BY_ID[id] || pick(PETS);
    this.petDrops.push({ x, y, type: def.id, col: def.col, name: def.name, t: 0, r: 13, vx: rnd(-40, 40), vy: rnd(-40, 40) });
  },
  magnet(p) {
    const rad = 110 + p.st.harvest * 4 + p.st.luck * .4;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const m = this.pickups[i];
      const d = dist(m.x, m.y, p.x, p.y);
      if (d < rad) {
        const a = Math.atan2(p.y - m.y, p.x - m.x);
        const pull = 240 + (rad - d) * 3.4;
        m.vx += Math.cos(a) * pull * .06; m.vy += Math.sin(a) * pull * .06;
      }
      if (d < p.r + 10) {
        this.materials += m.v; this.run.materials += m.v; Save.prog('materials', m.v);
        p.popT = Math.min(.35, p.popT + .18);   /* kurzer Pop beim Aufsammeln */
        if (OPT().particles > 0 && m.v >= 3) {
          for (let k = 0; k < 2; k++) FX.sparkle(p.x, p.y, Math.atan2(m.y - p.y, m.x - p.x) + crnd(-.4, .4), crnd(80, 150), '#ffe08a', .35, 2);
        }
        for (const q of this.players) {
          q.xp += m.v * (1 + q.st.xpGain / 100);
          while (q.xp >= q.xpNext) { q.xp -= q.xpNext; q.level++; q.xpNext = q.xpFor(q.level); q.pendingLevels++; q.recalc(); AudioSys.sfx('pick'); if (OPT().particles > 0) FX.shockwave(q.x, q.y, 90, q.char.col); }
        }
        this.pickups[i] = this.pickups[this.pickups.length - 1]; this.pickups.pop();
        if (Math.random() < .25) AudioSys.sfx('pick');
      }
    }
    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const pu = this.powerups[i];
      if (dist(pu.x, pu.y, p.x, p.y) < p.r + pu.r + 4) {
        this.applyPowerup(p, pu); this.powerups.splice(i, 1);
      }
    }
    for (let i = this.runes.length - 1; i >= 0; i--) {
      const ru = this.runes[i];
      const d = dist(ru.x, ru.y, p.x, p.y);
      if (d < 120) { const a = Math.atan2(p.y - ru.y, p.x - ru.x); ru.x += Math.cos(a) * 260 * .06; ru.y += Math.sin(a) * 260 * .06; }
      if (d < p.r + ru.r + 4) {
        if (p.runes.length < 3) {
          p.runes.push({ id: ru.type, cd: 0 });
          AudioSys.sfx('rune');
          UI.toast(`${p.char.name}: ${RUNES.find(r => r.id === ru.type).name} erhalten (${Input.key('rune').replace('Key', '')} aktiviert)`);
          Save.prog('runesGot', 1);
        } else {
          this.materials += 8; this.run.materials += 8; Save.prog('materials', 8);
          UI.toast('Rune voll — +8 Material');
        }
        this.runes.splice(i, 1);
      }
    }
    for (let i = this.petDrops.length - 1; i >= 0; i--) {
      const pd = this.petDrops[i];
      const d = dist(pd.x, pd.y, p.x, p.y);
      if (d < 130) { const a = Math.atan2(p.y - pd.y, p.x - pd.x); pd.x += Math.cos(a) * 270 * .06; pd.y += Math.sin(a) * 270 * .06; }
      if (d < p.r + pd.r + 4) {
        if (p.pet) { this.materials += 12; this.run.materials += 12; Save.prog('materials', 12); UI.toast('Begleiter bereits da — +12 Material'); }
        else {
          p.pet = new Pet(pd.type, p);
          p.recalc();
          AudioSys.sfx('pet');
          UI.toast(`${p.char.name}: ${PET_BY_ID[pd.type].name} schließt sich an!`);
          Save.prog('petsGot', 1);
        }
        this.petDrops.splice(i, 1);
      }
    }
  },
  applyPowerup(p, pu) {
    AudioSys.sfx('level'); UI.toast(pu.name + '!');
    switch (pu.type) {
      case 'heal': p.heal(p.maxHp * .3); break;
      case 'speed': p.addBuff('speed', 40, 8); break;
      case 'dmg': p.addBuff('dmgP', 50, 8); break;
      case 'invuln': p.invuln = 5; p.addBuff('armor', 15, 6); break;
      case 'nuke': {
        FX.shockwave(p.x, p.y, 520, '#ff8a3d'); this.feedback(null, null, 'gross');
        for (const e of this.enemies) if (!e.dead && dist(e.x, e.y, p.x, p.y) < 520) e.hurt(60 + this.wave * 14, false, p, 'boom');
        break;
      }
      case 'mats': for (let i = 0; i < 24; i++) this.spawnMaterial(p.x + rnd(-120, 120), p.y + rnd(-120, 120), 2); break;
    }
  },
  nearestEnemy(x, y, maxR) {
    /* Zuerst die besten Kandidaten nach Abstand sammeln, dann unter ihnen
       das erste Ziel mit freier Schusslinie waehlen. Steht ueberall eine
       Wand im Weg, wird trotzdem gefeuert (auf das naechste Ziel) — sonst
       stuenden Spieler hinter Deckung ohne Ausweg da. */
    const cand = this._tmpCand || (this._tmpCand = []);
    cand.length = 0;
    const consider = e => {
      if (!e || e.dead) return;
      const d = dist2(x, y, e.x, e.y);
      if (d > maxR * maxR) return;
      /* Boss/Elite bleiben bei Auto-Aim priorisiert, ohne Ziele
         ausserhalb der Reichweite zu waehlen. */
      const priority = e.boss ? 260 : e.elite ? 90 : 0;
      cand.push({ e: e, s: Math.sqrt(d) - priority });
    };
    const list = this.hash.query(x, y, maxR, this._tmp3);
    for (let i = 0; i < list.length; i++) consider(list[i]);
    if (!cand.length && maxR > 400) for (const e of this.enemies) consider(e);
    if (!cand.length) return null;
    cand.sort((a, b) => a.s - b.s);
    const L = this.level;
    if (L && L.allWalls().length) {
      /* Sichtlinie geht als ZUSCHLAG in die Bewertung, nicht als
         Ausschluss. Eine harte Bevorzugung sichtbarer Ziele liess das
         Auto-Ziel an einem nahen Gegner hinter einer Mauerecke vorbei
         auf einen weit entfernten schiessen - der nahe Gegner kam dann
         ungestoert durch. In der Messreihe kostete das zwei Charaktere
         (Nova 14.4 -> 4.7, Kleeblatt 18.4 -> 12.7 Wellen).
         170 entspricht etwa der Strecke, die ein Gegner in einer Sekunde
         zuruecklegt: verdeckte Ziele werden gemieden, aber nur solange
         eine echte Alternative in aehnlicher Naehe steht. */
      const n = cand.length < 8 ? cand.length : 8;
      let best = cand[0], bs = cand[0].s + (L.losClear(x, y, cand[0].e.x, cand[0].e.y) ? 0 : 170);
      for (let i = 1; i < n; i++) {
        const sc = cand[i].s + (L.losClear(x, y, cand[i].e.x, cand[i].e.y) ? 0 : 170);
        if (sc < bs) { bs = sc; best = cand[i]; }
      }
      return best.e;
    }
    return cand[0].e;
  },
  nearestEnemyExcept(x, y, maxR, exclude) {
    let best = null, bd = maxR * maxR;
    const list = this.hash.query(x, y, maxR, this._tmp3);
    for (const e of list) { if (e.dead || exclude.has(e)) continue; const d = dist2(x, y, e.x, e.y); if (d < bd) { bd = d; best = e; } }
    return best;
  },
  /* ============================================================
     GEFAHRENOBJEKTE der neuen Gegner
     'shell' = Mörsergranate mit Flugbahn und angekündigtem Einschlag
     'mine'  = Haftmine mit Zündverzögerung
     'web'   = bremsendes Netz des Webers
     ============================================================ */
  /* ============================================================
     WELLENAUFTRÄGE
     Jede Welle bringt eine optionale Zusatzaufgabe. Erfüllt man
     sie, gibt es Material, EP und einen Eintrag in der Statistik.
     ============================================================ */
  /* ============================================================
     ARENA-MODIFIKATOREN
     Ab Welle 3 bekommt jede Welle mit steigender Wahrscheinlichkeit
     eine Wetter- oder Stadtlage, die bekannte Arenen neu anfühlen
     lässt: Regen mit Rutschphysik, Stromausfall, Feierabendverkehr,
     Nebel, Hitze, Nacht und Sturm.
     ============================================================ */
  ARENA_MODS: [
    { id: 'regen', name: 'REGEN', desc: 'Nasser Asphalt: Trägheit beim Bremsen, Sicht leicht getrübt.', col: '#59e6ff', minW: 3 },
    { id: 'stromausfall', name: 'STROMAUSFALL', desc: 'Nur der eigene Lichtkegel bleibt — der Rest liegt im Dunkeln.', col: '#7f92b8', minW: 5 },
    { id: 'feierabend', name: 'FEIERABENDVERKEHR', desc: 'Querende Fahrzeuge walzen alles nieder, was im Weg steht.', col: '#ffd23e', minW: 4 },
    { id: 'nebel', name: 'NEBELBANK', desc: 'Dichte Schwaden ziehen durch: kurze Sicht, gedämpfter Schall.', col: '#dbe6ff', minW: 4 },
    { id: 'hitze', name: 'HITZEWELLE', desc: 'Der Boden glüht auf: wandernde Brandherde, aber mehr Tempo.', col: '#ff8a3d', minW: 6 },
    { id: 'sturm', name: 'STURMBÖEN', desc: 'Windstöße schieben alles seitlich weg, auch Projektile.', col: '#a6e6ff', minW: 6 },
    { id: 'nacht', name: 'TIEFE NACHT', desc: 'Gedämpftes Licht, dafür bringt jeder Abschuss mehr Material.', col: '#a06bff', minW: 5 }
  ],
  arenaMod: null,
  /* ============================================================
     RISIKO-WETTE
     Vor jeder Welle darf man freiwillig eine Verschärfung annehmen
     und bekommt dafür deutlich mehr Material und EP.
     ============================================================ */
  WAGERS: [
    { id: 'horde', name: 'Übermacht', desc: 'Doppelte Gegnerdichte', mat: .7, xp: .35 },
    { id: 'blind', name: 'Blindflug', desc: 'Halbe Sichtweite', mat: .55, xp: .3 },
    { id: 'wache', name: 'Bosswache', desc: 'Zwei zusätzliche Elite-Gegner', mat: .6, xp: .4 },
    { id: 'zerbrechlich', name: 'Dünnes Eis', desc: 'Du hältst nur die Hälfte aus', mat: .85, xp: .45 },
    { id: 'hast', name: 'Hetzjagd', desc: 'Gegner sind 25 % schneller', mat: .5, xp: .3 },
    { id: 'ebbe', name: 'Ebbe', desc: 'Keine Heilung in dieser Welle', mat: .6, xp: .35 }
  ],
  wager: null,
  wagerOffer: null,
  rollWager(wave) {
    /* Die im Shop angenommene Wette bleibt für diese Welle bestehen */
    if (!this._wagerTaken) this.wager = null;
    this._wagerTaken = false;
    this.wagerOffer = wave < 1 ? null : pick(this.WAGERS);
  },
  acceptWager() {
    if (!this.wagerOffer || this.wager) return;
    this.wager = this.wagerOffer;
    this._wagerTaken = true;
    UI.banner('WETTE: ' + this.wager.name.toUpperCase(), 2);
    UI.toast(this.wager.name + ' — ' + this.wager.desc + ' · +' + Math.round(this.wager.mat * 100) + ' % Material');
    AudioSys.sfx('rune');
    if (this.wager.id === 'wache') {
      for (let i = 0; i < 2; i++) {
        const def = pick(ENEMIES.filter(e => (e.minW || 1) <= this.wave));
        const p = this.players[0];
        const a = rnd(TAU), r = 420;
        const e = this.spawnEnemyAt(def, clamp(p.x + Math.cos(a) * r, 60, this.level.w - 60), clamp(p.y + Math.sin(a) * r, 60, this.level.h - 60));
        if (e) e.makeElite();
      }
    }
    if (this.wager.id === 'zerbrechlich') for (const p of this.players) p.wagerFragile = true;
    if (this.wager.id === 'ebbe') for (const p of this.players) p.wagerNoHeal = true;
  },
  wagerActive(id) { return !!(this.wager && this.wager.id === id); },
  dangerUpCost() { return Math.round(25 + (this.danger || 0) * 20); },
  dangerMidRun() {
    if (this.state !== 'shop') return;
    const maxD = this.dangerMax();
    if (this.danger >= maxD) { AudioSys.sfx('err'); UI.toast('Maximale Gefahrenstufe erreicht'); return; }
    const cost = this.dangerUpCost();
    if (this.materials < cost) { AudioSys.sfx('err'); UI.toast('Nicht genug Material'); return; }
    this.materials -= cost; this.danger++;
    Save.progMax('maxDanger', this.danger);
    AudioSys.sfx('rune');
    UI.banner('GEFAHRENSTUFE ' + this.danger + ' — ' + DANGERS[this.danger].desc, 2);
    ShopSystem.generate(this.wave, this.players);
    UI.renderShop();
  },
  /* ============================================================
     ENDLOSMODUS ab Welle 21
     Jede Welle bekommt garantiert eine Stadtlage, alle fünf Wellen
     tritt ein Elite-Boss an, die Fassdichte und die Auftragsprämien
     steigen mit.
     ============================================================ */
  endlessTier(wave) { return Math.max(0, Math.floor((wave - 20) / 5) + (wave > 20 ? 1 : 0)); },
  endlessSetup(n) {
    if (!this.endless || n <= 20) return;
    const tier = this.endlessTier(n);
    UI.toast('ENDLOS-STUFE ' + tier + ' — Stadtlage garantiert, Gegner verstärkt');
    if (n % 5 === 0) {
      /* Elite-Boss: verstärkte Fassung eines zufälligen Bosses */
      const B = pick(BOSSES);
      this._curBoss = B;
      this._endlessBoss = { tier: tier };
      UI.banner('ELITE-BOSS · ' + B.name, 2.6);
    }
  },
  endlessBuff(e, n) {
    if (!this.endless || n <= 20) return;
    const tier = this.endlessTier(n);
    const k = 1 + tier * .22;
    e.maxHp *= k; e.hp = e.maxHp;
    e.dmg *= 1 + tier * .12;
    e.armor += tier * 2;
    e.mat = Math.ceil(e.mat * (1 + tier * .18));
    e.xp = Math.ceil(e.xp * (1 + tier * .15));
    if (e.boss && this._endlessBoss) {
      /* Endlos-Bosse skalieren mit der Trash-Kurve statt pauschal x1.5 — vorher
         wurden sie relativ zu den normalen Gegnern mit der Zeit immer leichter. */
      e.maxHp *= (1 + tier * .22) * 1.08; e.hp = e.maxHp;
      e.dmg *= 1 + tier * .15;
      e.armor += 2 + tier * 2;
      e.spd *= 1.08;
      e.bossVariant = e.bossVariant || pick(['wut', 'geifer']);
    }
  },
  rollArenaMod(wave) {
    this.arenaMod = null;
    this.modVehicles = [];
    this.modWind = { a: rnd(TAU), s: 0 };
    if (wave < 3) return;
    const chance = (this.endless && wave > 20) ? 1 : clamp(.18 + wave * .035, 0, .72);
    if (RAND() > chance) return;
    const cand = this.ARENA_MODS.filter(m => wave >= m.minW);
    if (!cand.length) return;
    const m = pick(cand);
    this.arenaMod = { id: m.id, name: m.name, desc: m.desc, col: m.col, t: 0 };
    if (m.id === 'sturm') this.modWind = { a: rnd(TAU), s: 1 };
    if (m.id === 'feierabend') for (let i = 0; i < 3; i++) this.spawnVehicle(true);
    UI.banner(m.name, 2.2);
    UI.toast(m.name + ' — ' + m.desc);
    AudioSys.sfx(m.id === 'sturm' || m.id === 'regen' ? 'wind' : m.id === 'feierabend' ? 'traffic' : 'telegraph');
  },
  modIs(id) { return !!(this.arenaMod && this.arenaMod.id === id); },
  spawnVehicle(initial) {
    const L = this.level;
    if (!L) return;
    const horiz = RAND() < .6;
    const spd = rnd(280, 420);
    const v = horiz
      ? { x: RAND() < .5 ? -120 : L.w + 120, y: rnd(120, L.h - 120), vx: 0, vy: 0, w: 92, h: 40 }
      : { x: rnd(120, L.w - 120), y: RAND() < .5 ? -120 : L.h + 120, vx: 0, vy: 0, w: 40, h: 92 };
    if (horiz) v.vx = (v.x < 0 ? 1 : -1) * spd; else v.vy = (v.y < 0 ? 1 : -1) * spd;
    v.warn = initial ? rnd(.5, 2.5) : 1.1;
    v.col = pick(['#ffd23e', '#59e6ff', '#ff5d6e', '#dbe6ff']);
    this.modVehicles.push(v);
  },
  updateArenaMod(dt) {
    const M = this.arenaMod;
    if (!M) return;
    M.t += dt;
    const L = this.level;
    if (M.id === 'regen') {
      if (OPT().particles > 0) for (let i = 0; i < 6; i++) {
        const x = this.cam.x + rnd(-this.W, this.W) * .6, y = this.cam.y + rnd(-this.H, this.H) * .6;
        FX.particle(x, y - 60, Math.PI / 2 + .3, crnd(700, 950), 'rgba(150,200,235,.5)', .22, 1.6, { shape: 'streak', dg: .9 });
      }
      if (Math.random() < dt * 1.4) FX.decal(this.cam.x + rnd(-500, 500), this.cam.y + rnd(-350, 350), rnd(6, 14), 'rgba(70,110,140,.5)', 'dirt', 3);
    } else if (M.id === 'hitze') {
      if (Math.random() < dt * 1.1 && L && this.hazObjs.length <= 90) {
        const x = rnd(80, L.w - 80), y = rnd(80, L.h - 80);
        FX.telegraph(x, y, 70, '#ff8a3d', .8, 'dot', 70);
        this.hazObjs.push({ kind: 'mine', x: x, y: y, t: 0, fuse: .85, r: 84, dmg: 9, name: 'Hitzewelle' });
      }
      for (const p of this.players) if (p.alive) p.damage(dt * 2, 0);
    } else if (M.id === 'sturm') {
      this.modWind.a += dt * .35;
      const wx = Math.cos(this.modWind.a) * 46, wy = Math.sin(this.modWind.a) * 46;
      for (const p of this.players) if (p.alive) { p.x += wx * dt; p.y += wy * dt; }
      for (const pr of Projectiles.active) { pr.x += wx * .45 * dt; pr.y += wy * .45 * dt; }
      if (OPT().particles > 0) for (let i = 0; i < 3; i++)
        FX.particle(this.cam.x + crnd(-600, 600), this.cam.y + crnd(-400, 400), this.modWind.a, crnd(200, 420), 'rgba(200,225,245,.35)', .5, 2, { shape: 'streak', dg: .8 });
    } else if (M.id === 'nebel') {
      if (OPT().particles > 0 && Math.random() < dt * 8)
        FX.smoke(this.cam.x + crnd(-620, 620), this.cam.y + crnd(-420, 420), crnd(TAU), 22, 2, 'rgba(190,205,230,.22)', 26);
    } else if (M.id === 'feierabend') {
      this.modCarT = (this.modCarT || 0) - dt;
      if (this.modCarT <= 0) { this.modCarT = rnd(2.2, 4.5); this.spawnVehicle(false); }
      for (let i = this.modVehicles.length - 1; i >= 0; i--) {
        const v = this.modVehicles[i];
        if (v.warn > 0) { v.warn -= dt; continue; }
        v.x += v.vx * dt; v.y += v.vy * dt;
        for (const p of this.players) if (p.alive && Math.abs(p.x - v.x) < v.w / 2 + p.r && Math.abs(p.y - v.y) < v.h / 2 + p.r) {
          this.lastHitBy = { name: 'Feierabendverkehr', t: this.time };
          p.damage(16 * DANGERS[this.danger].dmg, Math.atan2(v.vy, v.vx));
          p.x += Math.sign(v.vx) * 26; p.y += Math.sign(v.vy) * 26;
        }
        const list = this.hash.query(v.x, v.y, 90, this._tmp);
        for (const e of list) if (!e.dead && !e.boss && Math.abs(e.x - v.x) < v.w / 2 + e.r && Math.abs(e.y - v.y) < v.h / 2 + e.r) {
          e.hurt(38 + this.wave * 3, true, this.players[0], 'boom');
          e.knockback(Math.atan2(v.vy, v.vx), 320);
          FX.mud(e.x, e.y, Math.atan2(v.vy, v.vx), 1.4);
        }
        if (OPT().particles > 0 && Math.random() < .4) FX.dust(v.x - Math.sign(v.vx) * 40, v.y - Math.sign(v.vy) * 40, Math.atan2(-v.vy, -v.vx), 2);
        if (L && (v.x < -260 || v.x > L.w + 260 || v.y < -260 || v.y > L.h + 260)) this.modVehicles.splice(i, 1);
      }
    }
  },
  drawArenaMod(ctx) {
    const M = this.arenaMod;
    if (!M) return;
    if (M.id === 'feierabend') {
      for (const v of this.modVehicles) {
        if (v.warn > 0) {
          ctx.globalAlpha = .35 + .3 * Math.sin(Game.time * 14);
          ctx.strokeStyle = '#ffd23e'; ctx.lineWidth = 3;
          ctx.setLineDash([12, 10]);
          ctx.beginPath();
          if (v.vx) { ctx.moveTo(0, v.y); ctx.lineTo(this.level.w, v.y); }
          else { ctx.moveTo(v.x, 0); ctx.lineTo(v.x, this.level.h); }
          ctx.stroke(); ctx.setLineDash([]);
          ctx.globalAlpha = 1;
          continue;
        }
        ctx.fillStyle = 'rgba(0,0,0,.4)';
        ctx.fillRect(v.x - v.w / 2 + 4, v.y - v.h / 2 + 6, v.w, v.h);
        ctx.fillStyle = v.col;
        ctx.fillRect(v.x - v.w / 2, v.y - v.h / 2, v.w, v.h);
        ctx.fillStyle = 'rgba(20,26,40,.75)';
        if (v.vx) ctx.fillRect(v.x - v.w * .18, v.y - v.h / 2 + 4, v.w * .36, v.h - 8);
        else ctx.fillRect(v.x - v.w / 2 + 4, v.y - v.h * .18, v.w - 8, v.h * .36);
        ctx.fillStyle = '#fff6c8';
        if (v.vx) ctx.fillRect(v.x + Math.sign(v.vx) * (v.w / 2 - 5), v.y - v.h / 2 + 4, 5, 7);
        else ctx.fillRect(v.x - v.w / 2 + 4, v.y + Math.sign(v.vy) * (v.h / 2 - 5), 7, 5);
      }
    }
  },
  drawArenaModOverlay(ctx) {
    if (this.wagerActive('blind')) {
      /* Blindflug: der Blick reicht nur halb so weit */
      ctx.save();
      ctx.fillStyle = 'rgba(3,5,12,.82)';
      ctx.fillRect(0, 0, this.W, this.H);
      ctx.globalCompositeOperation = 'destination-out';
      for (const p of this.players) {
        if (!p.alive) continue;
        const sx = (p.x - this.cam.x) * this.cam.zoom + this.W / 2 + this.cam.sx;
        const sy = (p.y - this.cam.y) * this.cam.zoom + this.H / 2 + this.cam.sy;
        const rad = 250 * this.cam.zoom;
        const g = ctx.createRadialGradient(sx, sy, rad * .3, sx, sy, rad);
        g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(sx - rad, sy - rad, rad * 2, rad * 2);
      }
      ctx.restore();
    }
    const M = this.arenaMod;
    if (!M) return;
    if (M.id === 'stromausfall' || M.id === 'nacht') {
      const dark = M.id === 'stromausfall' ? .88 : .55;
      ctx.save();
      ctx.fillStyle = 'rgba(2,4,10,' + dark + ')';
      ctx.fillRect(0, 0, this.W, this.H);
      ctx.globalCompositeOperation = 'destination-out';
      for (const p of this.players) {
        if (!p.alive) continue;
        const sx = (p.x - this.cam.x) * this.cam.zoom + this.W / 2 + this.cam.sx;
        const sy = (p.y - this.cam.y) * this.cam.zoom + this.H / 2 + this.cam.sy;
        const rad = (M.id === 'stromausfall' ? 210 : 320) * this.cam.zoom;
        const g = ctx.createRadialGradient(sx, sy, rad * .25, sx, sy, rad);
        g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(sx - rad, sy - rad, rad * 2, rad * 2);
      }
      ctx.restore();
    } else if (M.id === 'nebel') {
      ctx.save();
      ctx.globalAlpha = .30 + .05 * Math.sin(Game.time * .7);
      ctx.fillStyle = '#c8d4ea';
      ctx.fillRect(0, 0, this.W, this.H);
      ctx.globalCompositeOperation = 'destination-out';
      for (const p of this.players) {
        if (!p.alive) continue;
        const sx = (p.x - this.cam.x) * this.cam.zoom + this.W / 2 + this.cam.sx;
        const sy = (p.y - this.cam.y) * this.cam.zoom + this.H / 2 + this.cam.sy;
        const rad = 300 * this.cam.zoom;
        const g = ctx.createRadialGradient(sx, sy, rad * .2, sx, sy, rad);
        g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(sx - rad, sy - rad, rad * 2, rad * 2);
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    } else if (M.id === 'regen') {
      ctx.save();
      ctx.globalAlpha = .12;
      ctx.fillStyle = '#4a7fa8';
      ctx.fillRect(0, 0, this.W, this.H);
      ctx.restore();
    } else if (M.id === 'hitze') {
      ctx.save();
      ctx.globalAlpha = .10 + .03 * Math.sin(Game.time * 2);
      ctx.fillStyle = '#ff8a3d';
      ctx.fillRect(0, 0, this.W, this.H);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  },
  CONTRACTS: [
    { id: 'nohit', t: 'Ohne Treffer durch die Welle', kind: 'end', need: 1, mat: 14, xp: 6, minW: 2, bStat: 'armor', bPer: 1, bName: 'Panzerung' },
    { id: 'meleeKill', t: 'Gegner im Nahkampf erledigen', kind: 'count', base: 6, per: .8, mat: 12, xp: 5, minW: 3, bStat: 'melee', bPer: 3, bName: 'Nahkampfschaden' },
    { id: 'boomKill', t: 'Gegner durch Explosionen zerlegen', kind: 'count', base: 5, per: .7, mat: 13, xp: 5, minW: 4, bStat: 'expSize', bPer: 4, bName: 'Explosionsradius' },
    { id: 'crit', t: 'Kritische Treffer landen', kind: 'count', base: 14, per: 2.2, mat: 11, xp: 4, minW: 2, bStat: 'crit', bPer: 2, bName: 'Krit-Chance' },
    { id: 'eliteKill', t: 'Elite-Gegner ausschalten', kind: 'count', base: 1, per: .12, mat: 18, xp: 8, minW: 6, bStat: 'dmgP', bPer: 2, bName: 'Gesamtschaden' },
    { id: 'combo', t: 'Kombo-Kette erreichen', kind: 'max', base: 12, per: 1.6, mat: 12, xp: 5, minW: 3, bStat: 'atkSpd', bPer: 2, bName: 'Angriffstempo' },
    { id: 'noAbility', t: 'Welle ohne Spezialfähigkeit', kind: 'end', need: 1, mat: 15, xp: 6, minW: 5, bStat: 'maxHp', bPer: 6, bName: 'Maximales Leben' },
    { id: 'elemKill', t: 'Gegner mit Elementarschaden erledigen', kind: 'count', base: 8, per: 1.1, mat: 12, xp: 5, minW: 4, bStat: 'elem', bPer: 3, bName: 'Elementarschaden' },
    { id: 'barrel', t: 'Explosive Fässer zünden', kind: 'count', base: 2, per: .18, mat: 10, xp: 4, minW: 3, bStat: 'harvest', bPer: 1, bName: 'Ernte' }
  ],
  contract: null,
  rollContract(wave) {
    const cand = this.CONTRACTS.filter(c => wave >= (c.minW || 1));
    if (!cand.length) { this.contract = null; return; }
    const c = pick(cand);
    const need = c.kind === 'end' ? 1 : Math.max(1, Math.round((c.base || 5) + (c.per || 0) * wave));
    this.contract = {
      id: c.id, t: c.t, kind: c.kind, need: need, prog: 0, done: false, failed: false,
      mat: Math.round(c.mat * (1 + wave * .09) * DANGERS[this.danger].price * (this.endless && wave > 20 ? 1 + this.endlessTier(wave) * .25 : 1)),
      xp: Math.round(c.xp * (1 + wave * .12) * (this.endless && wave > 20 ? 1 + this.endlessTier(wave) * .2 : 1))
    };
  },
  contractProgress(id, n) {
    const c = this.contract;
    if (!c || c.done || c.failed || c.id !== id) return;
    if (c.kind === 'count') { c.prog += (n || 1); if (c.prog >= c.need) this.contractDone(); }
    else if (c.kind === 'max') { c.prog = Math.max(c.prog, n || 0); if (c.prog >= c.need) this.contractDone(); }
  },
  contractFail(id) {
    const c = this.contract;
    if (c && c.id === id && !c.done) c.failed = true;
  },
  /* ============================================================
     WAFFEN-MEISTERSCHAFT
     Kills mit einer Waffe zählen dauerhaft. Bei 150 / 500 / 1200
     Kills gibt es je einen kostenlosen Aufsatz, der ab dem nächsten
     Run automatisch an dieser Waffe hängt.
     ============================================================ */
  MASTERY_STEPS: [150, 500, 1200],
  MASTERY_ATT: ['extmag', 'scope', 'heavybarrel'],
  masteryRank(id) {
    const n = (Save.data.mastery && Save.data.mastery[id]) || 0;
    let r = 0;
    for (const th of this.MASTERY_STEPS) if (n >= th) r++;
    return r;
  },
  masteryAttachments(id) {
    return this.MASTERY_ATT.slice(0, this.masteryRank(id));
  },
  addMasteryKill(id) {
    if (!id) return;
    Save.data.mastery = Save.data.mastery || {};
    const before = Save.data.mastery[id] || 0;
    const after = before + 1;
    Save.data.mastery[id] = after;
    for (let i = 0; i < this.MASTERY_STEPS.length; i++) {
      const th = this.MASTERY_STEPS[i];
      if (before < th && after >= th) {
        const att = ATT_BY_ID[this.MASTERY_ATT[i]];
        const wname = WEAPON_BY_ID[id] ? WEAPON_BY_ID[id].name : id;
        UI.banner('MEISTERSCHAFT: ' + wname, 2.4);
        UI.toast('Meisterschaft ' + (i + 1) + ' für ' + wname + ' — ' + (att ? att.name : '') + ' ab jetzt dauerhaft montiert');
        AudioSys.jingle('level');
        Save.save();
      }
    }
    if (after % 25 === 0) Save.save();
  },
  CONTRACT_RANKS: [5, 15, 40],
  contractRank(id) {
    const n = (Save.data.contractLog && Save.data.contractLog[id]) || 0;
    let r = 0;
    for (const th of this.CONTRACT_RANKS) if (n >= th) r++;
    return r;
  },
  contractBonuses() {
    const out = {};
    for (const c of this.CONTRACTS) {
      const r = this.contractRank(c.id);
      if (r > 0 && c.bStat) out[c.bStat] = (out[c.bStat] || 0) + r * (c.bPer || 1);
    }
    return out;
  },
  contractDone() {
    const c = this.contract;
    if (!c || c.done) return;
    c.done = true;
    Save.data.contractLog = Save.data.contractLog || {};
    Save.data.contractLog[c.id] = (Save.data.contractLog[c.id] || 0) + 1;
    const def = this.CONTRACTS.find(x => x.id === c.id);
    const before = (Save.data.contractLog[c.id] - 1), after = Save.data.contractLog[c.id];
    for (const th of this.CONTRACT_RANKS) if (before < th && after >= th && def) {
      UI.banner('AUFTRAGSBUCH: NEUE STUFE', 2.2);
      UI.toast('Auftragsbuch „' + def.t + '" — dauerhaft +' + (def.bPer || 1) + ' ' + (def.bName || def.bStat));
    }
    Save.save();
    this.materials += c.mat;
    this.run.materials += c.mat;
    for (const p of this.players) {
      if (!p.alive) continue;
      p.xp += c.xp;
      while (p.xp >= p.xpNext) { p.xp -= p.xpNext; p.level++; p.xpNext = p.xpFor(p.level); p.pendingLevels++; p.recalc(); }
    }
    Save.prog('contracts', 1);
    UI.banner('AUFTRAG ERFÜLLT · +' + c.mat + ' MATERIAL', 1.8);
    UI.toast('Auftrag: ' + c.t + ' — geschafft (+' + c.mat + ' Material, +' + c.xp + ' EP)');
    AudioSys.jingle('shop');
  },
  applyContractBonuses() {
    const b = this.contractBonuses();
    let any = false;
    for (const k in b) {
      for (const p of this.players) p.addBuff(k, b[k], 1e9);
      any = true;
    }
    if (any) {
      const txt = Object.keys(b).map(k => (STAT_NAME[k] || k) + ' +' + b[k]).join(' · ');
      UI.toast('Auftragsbuch-Boni aktiv: ' + txt);
    }
  },
  contractCheckEnd() {
    const c = this.contract;
    if (!c || c.done || c.kind !== 'end') return;
    if (c.failed) { UI.toast('Auftrag verfehlt: ' + c.t); return; }
    if (c.id === 'nohit' && this.players.some(p => p.tookDamageThisWave)) { UI.toast('Auftrag verfehlt: ' + c.t); return; }
    this.contractDone();
  },
  bossIntro: 0, bossIntroMax: 3.4, bossIntroTarget: null, bossIntroName: '',
  /* ------------------------------------------------------------------
     UEBERZEIT: der Boss zieht an, bis der Kampf entschieden ist.
     Stufe 1-2  nur der Boss wird staerker und schneller
     ab Stufe 3  zusaetzlich Stoerfeuer ueber die gesamte Arena
     Deckel bei 10 Stufen — spaetestens dann faellt die Entscheidung.
     ------------------------------------------------------------------ */
  OVERTIME_STEP: 12,
  OVERTIME_MAX: 10,
  bossOvertime(dt) {
    this.otT = (this.otT || 0) + dt;
    const want = Math.min(this.OVERTIME_MAX, Math.floor(this.otT / this.OVERTIME_STEP) + 1);
    if (want > (this.otLevel || 0)) {
      const prev = this.otLevel || 0;
      this.otLevel = want;
      /* Der Zuwachs wird auf den lebenden Boss gerechnet, nicht auf eine
         Basis — so wirkt jede Stufe unabhaengig von der Reihenfolge. */
      const k = want - prev;
      for (const e of this.enemies) {
        if (e.dead || !e.boss) continue;
        e.dmg *= Math.pow(1.13, k);
        e.spd *= Math.pow(1.05, k);
        e.otSpeed = Math.pow(1.06, want);          /* kuerzere Abklingzeiten */
      }
      UI.banner('ÜBERZEIT ' + want + ' · DER BOSS DREHT AUF', 1.8);
      AudioSys.sfx('telegraph');
      if (want === 3) UI.toast('Störfeuer über der Arena — beende den Kampf!');
      this.feedback(null, null, 'klein');
    }
    /* Stoerfeuer: trifft ueberall, damit Dauerkiten kein Ausweg bleibt. */
    const lv = this.otLevel || 0;
    if (lv >= 3) {
      const dps = (lv - 2) * 1.6 * DANGERS[this.danger].dmg;
      this.otTick = (this.otTick || 0) + dt;
      if (this.otTick >= .5) {
        this.otTick = 0;
        for (const p of this.players) {
          if (!p.alive) continue;
          p.damage(dps * .5, rnd(TAU), { overtime: true });
        }
        if (OPT().particles > 0) {
          const L = this.level;
          for (let i = 0; i < 3; i++) FX.particle(crnd(0, L.w), crnd(0, L.h), crnd(TAU), crnd(40, 120), '#ff6a3d', .5, 3);
        }
      }
    }
  },
  startBossIntro(e) {
    if (!e || !e.boss) return;
    this.bossIntro = this.bossIntroMax;
    this.bossIntroTarget = e;
    this.bossIntroName = e.boss.name;
    e.introHold = this.bossIntroMax * .8;
    AudioSys.sfxAt('boss', e.x, e.y, 1.2);
    AudioSys.duckMusic(.45, 1.4);
  },
  /* ============================================================
     PARALLAXE
     Eine Hintergrundschicht mit halber Scrollgeschwindigkeit gibt der
     flachen Arena Tiefe: Silhouetten, Sterne, Dunst. Wird im Weltraum
     gezeichnet, aber gegen die Kamera versetzt.
     ============================================================ */
  buildParallax() {
    const L = this.level;
    if (!L) return;
    const a = L.a;
    const rng = new RNG((this.seed ^ (this.wave * 2654435761)) >>> 0);
    const R = () => rng.next();
    this.parallax = { far: [], near: [], stars: [] };
    for (let i = 0; i < 26; i++) {
      const w = 60 + R() * 190, h = 90 + R() * 320;
      this.parallax.far.push({ x: R() * L.w * 1.6 - L.w * .3, y: R() * L.h * 1.6 - L.h * .3, w: w, h: h, c: shade(a.grid, -.28) });
    }
    for (let i = 0; i < 16; i++) {
      const w = 40 + R() * 120, h = 60 + R() * 200;
      this.parallax.near.push({ x: R() * L.w * 1.4 - L.w * .2, y: R() * L.h * 1.4 - L.h * .2, w: w, h: h, c: shade(a.grid, -.12) });
    }
    for (let i = 0; i < 90; i++) this.parallax.stars.push({ x: R() * L.w * 1.8 - L.w * .4, y: R() * L.h * 1.8 - L.h * .4, r: .6 + R() * 1.6, a: .18 + R() * .5 });
  },
  drawParallax(ctx) {
    if (!this.parallax || this.quality() < 1) return;
    const L = this.level, cam = this.cam;
    const night = this.modIs('nacht') || this.modIs('stromausfall');
    ctx.save();
    /* Sichtfeld in Weltkoordinaten — die Parallaxebenen streuen ueber das
       1,6- bis 1,8-fache der Arena, es liegt also der Grossteil daneben.
       Gemessen: 70 % der Sterne bei Zoom 1, 87 % bei Zoom 1,5. */
    const vw = this.W / 2 / cam.zoom, vh = this.H / 2 / cam.zoom;
    /* Farben einmal statt je Element: shade() lief 116-mal je Bild fuer
       schleifeninvariante Ergebnisse. */
    const starCol = night ? '#dfe7f0' : shade(L.a.accent, .3);
    const winCol = shade(L.a.accent, -.55);
    /* Sterne / Lichter ganz hinten (0,15 Geschwindigkeit) */
    const o3x = cam.x * .85, o3y = cam.y * .85;
    ctx.globalAlpha = night ? .85 : .35;
    ctx.fillStyle = starCol;
    /* Rand deckt Sternradius und Kamerawackeln ab (sx/sy sind Bildpunkte,
       also durch zoom in Weltmass), sonst poppen Sterne am Bildrand. */
    const sm = 4 + Math.abs(cam.sx || 0) / Math.max(.4, cam.zoom);
    for (const st of this.parallax.stars) {
      const sx = st.x + o3x, sy = st.y + o3y;
      if (Math.abs(sx - cam.x) > vw + sm || Math.abs(sy - cam.y) > vh + sm) continue;
      ctx.globalAlpha = st.a * (night ? 1 : .45) * (.7 + .3 * Math.sin(this.time * 2 + st.x));
      ctx.fillRect(sx, sy, st.r, st.r);
    }
    /* Ferne Silhouetten (0,45 Geschwindigkeit) */
    const o1x = cam.x * .55, o1y = cam.y * .55;
    ctx.globalAlpha = .5;
    for (const b of this.parallax.far) {
      const bx = b.x + o1x, by = b.y + o1y;
      if (Math.abs(bx - cam.x) > vw + b.w || Math.abs(by - cam.y) > vh + b.h) continue;
      ctx.fillStyle = b.c;
      ctx.fillRect(bx, by - b.h, b.w, b.h);
      ctx.fillStyle = winCol;
      for (let r = 0; r < 3; r++) ctx.fillRect(bx + 6, by - b.h + 12 + r * 26, b.w - 12, 6);
    }
    /* Nähere Silhouetten (0,75 Geschwindigkeit) */
    const o2x = cam.x * .25, o2y = cam.y * .25;
    ctx.globalAlpha = .62;
    for (const b of this.parallax.near) {
      const bx = b.x + o2x, by = b.y + o2y;
      if (Math.abs(bx - cam.x) > vw + b.w || Math.abs(by - cam.y) > vh + b.h) continue;
      ctx.fillStyle = b.c;
      ctx.fillRect(bx, by - b.h, b.w, b.h);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  },
  /* Schatten aus der stärksten Lichtquelle */
  drawShadows(ctx) {
    if (OPT().lights === false || this.quality() < 2) return;
    let lx = null, ly = null, best = 0;
    for (const l of FX.lights) {
      const w = l.r * (l.life / l.max);
      if (w > best) { best = w; lx = l.x; ly = l.y; }
    }
    ctx.save();
    ctx.globalAlpha = .3;
    ctx.fillStyle = '#05070d';
    const cast = (x, y, r) => {
      let ang, len;
      if (lx == null) { ang = Math.PI * .5; len = r * 1.5; }
      else {
        ang = Math.atan2(y - ly, x - lx);
        len = clamp(r * 2.6 - dist(x, y, lx, ly) * .01, r * .9, r * 3.4);
      }
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.ellipse(len * .35, 0, len * .55, r * .5, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    };
    for (const p of this.players) if (p.alive) cast(p.x, p.y, p.r);
    let n = 0;
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (++n > 60) break;
      cast(e.x, e.y, e.r * .9);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  },
  drawBossIntro(ctx) {
    if (this.bossIntro <= 0) return;
    const t = 1 - this.bossIntro / this.bossIntroMax;
    const bar = clamp(t < .12 ? t / .12 : t > .88 ? (1 - t) / .12 : 1, 0, 1) * this.H * .12;
    ctx.save();
    ctx.fillStyle = '#05070d';
    ctx.fillRect(0, 0, this.W, bar);
    ctx.fillRect(0, this.H - bar, this.W, bar);
    const fade = clamp(t < .18 ? t / .18 : t > .82 ? (1 - t) / .18 : 1, 0, 1);
    ctx.globalAlpha = fade;
    const B = this.bossIntroTarget && this.bossIntroTarget.boss;
    const col = B ? B.col : '#ffe27a';
    ctx.textAlign = 'center';
    ctx.fillStyle = col;
    ctx.font = 'bold ' + Math.round(this.H * .062) + 'px system-ui, sans-serif';
    const slide = (1 - fade) * 40;
    ctx.fillText(this.bossIntroName, this.W / 2 + slide, this.H * .46);
    ctx.font = Math.round(this.H * .022) + 'px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(219,230,255,.85)';
    ctx.fillText('WELLE ' + this.wave + ' · ' + (this.level ? this.level.a.name : ''), this.W / 2 - slide, this.H * .53);
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.globalAlpha = fade * .8;
    const wLine = this.W * .18 * fade;
    ctx.beginPath(); ctx.moveTo(this.W / 2 - wLine, this.H * .49); ctx.lineTo(this.W / 2 + wLine, this.H * .49); ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1; ctx.textAlign = 'left';
  },
  hazObjs: [],
  spawnMortar(sx, sy, tx, ty, L, name) {
    if (this.hazObjs.length > 90) return;
    this.hazObjs.push({ kind: 'shell', x: sx, y: sy, sx: sx, sy: sy, tx: tx, ty: ty, t: 0, flight: L.flight, r: L.r, dmg: L.dmg, name: name });
    FX.telegraph(tx, ty, L.r, '#ffb24a', L.flight, 'dot', L.r);
  },
  spawnMine(x, y, M, name) {
    if (this.hazObjs.length > 90) return;
    this.hazObjs.push({ kind: 'mine', x: x, y: y, t: 0, fuse: M.fuse, r: M.r, dmg: M.dmg, name: name });
  },
  spawnWeb(x, y, W) {
    if (this.hazObjs.length > 90) return;
    this.hazObjs.push({ kind: 'web', x: x, y: y, r: W.r, t: 0, life: W.life, slow: W.slow, seed: rnd(TAU) });
  },
  hazBoom(h) {
    FX.explosion(h.x, h.y, h.r, '#ffb24a');
    this.feedback(h.x, h.y, 'mittel');
    AudioSys.sfxAt('boom', h.x, h.y);
    for (const p of this.players) if (p.alive && dist(p.x, p.y, h.x, h.y) < h.r) {
      this.lastHitBy = { name: h.name || 'Sprengsatz', t: this.time };
      p.damage(h.dmg * DANGERS[this.danger].dmg, Math.atan2(p.y - h.y, p.x - h.x));
    }
    for (const e of this.enemies) if (!e.dead && e.charmT > 0 && dist(e.x, e.y, h.x, h.y) < h.r) e.hurt(h.dmg, false, this.players[0], 'boom');
  },
  updateHazObjs(dt) {
    for (let i = this.hazObjs.length - 1; i >= 0; i--) {
      const h = this.hazObjs[i];
      h.t += dt;
      if (h.kind === 'shell') {
        const f = clamp(h.t / h.flight, 0, 1);
        h.x = lerp(h.sx, h.tx, f);
        h.y = lerp(h.sy, h.ty, f);
        h.arc = Math.sin(f * Math.PI) * 60;
        if (OPT().particles > 0 && Math.random() < .5) FX.px(h.x, h.y - h.arc, '#ffb24a', 2, .2, { glow: 1 });
        if (f >= 1) { this.hazBoom(h); this.hazObjs.splice(i, 1); }
      } else if (h.kind === 'mine') {
        const f = clamp(h.t / h.fuse, 0, 1);
        if (OPT().particles > 0 && Math.random() < f * .6) FX.px(h.x + crnd(-4, 4), h.y + crnd(-4, 4), '#ff4d5e', 2, .2, { glow: 1 });
        if (h.t > h.fuse * .55 && !h._warned) { h._warned = true; FX.telegraph(h.x, h.y, h.r, '#ff4d5e', h.fuse * .45, 'dot', h.r); }
        if (f >= 1) { this.hazBoom(h); this.hazObjs.splice(i, 1); }
      } else {
        for (const p of this.players) if (p.alive && dist(p.x, p.y, h.x, h.y) < h.r) {
          p.webSlow = Math.max(p.webSlow || 0, h.slow);
          if (h.poison) p.damage(h.poison * dt, 0);
        }
        if (h.t > h.life) this.hazObjs.splice(i, 1);
      }
    }
  },
  drawHazObjs(ctx) {
    for (const h of this.hazObjs) {
      if (h.kind === 'shell') {
        const y = h.y - (h.arc || 0);
        ctx.save(); ctx.globalAlpha = .38; ctx.strokeStyle = '#ffcf5c'; ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.arc(h.tx, h.ty, h.r, 0, TAU); ctx.stroke(); ctx.setLineDash([]); ctx.restore();
        ctx.globalAlpha = .35; ctx.fillStyle = '#000';
        ctx.beginPath(); ctx.ellipse(h.x, h.y, 5, 2.6, 0, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1; ctx.fillStyle = '#c0a06b';
        ctx.beginPath(); ctx.ellipse(h.x, y, 5.2, 4, h.t * 6, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ffb24a'; ctx.fillRect(h.x - 1, y - 6, 2, 3);
      } else if (h.kind === 'mine') {
        const f = clamp(h.t / h.fuse, 0, 1);
        ctx.save(); ctx.globalAlpha = .25 + f * .25; ctx.strokeStyle = '#ff4d5e'; ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, TAU); ctx.stroke(); ctx.setLineDash([]); ctx.restore();
        const blink = Math.sin(h.t * (6 + f * 26)) > 0;
        ctx.fillStyle = '#2f3542';
        ctx.beginPath(); ctx.arc(h.x, h.y, 6, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(h.x, h.y, 8.5, 0, TAU); ctx.stroke();
        for (let i = 0; i < 4; i++) {
          const a = i / 4 * TAU + h.t;
          ctx.fillStyle = '#8f97a6';
          ctx.fillRect(h.x + Math.cos(a) * 8 - 1, h.y + Math.sin(a) * 8 - 1, 2.4, 2.4);
        }
        if (blink) { ctx.fillStyle = '#ff4d5e'; ctx.beginPath(); ctx.arc(h.x, h.y, 2.6, 0, TAU); ctx.fill(); }
      } else if (h.kind === 'bossPool') {
        const f = clamp(1 - h.t / h.life, 0, 1);
        ctx.globalAlpha = .25 * f;
        ctx.fillStyle = h.col || '#ff5d6e';
        ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, TAU); ctx.fill();
        ctx.globalAlpha = .5 * f;
        ctx.strokeStyle = h.col || '#ff5d6e'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
      } else {
        const f = clamp(1 - h.t / h.life, 0, 1);
        ctx.globalAlpha = .30 * f;
        ctx.fillStyle = h.col || '#dcd0ff';
        ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, TAU); ctx.fill();
        ctx.globalAlpha = .55 * f;
        ctx.strokeStyle = '#efe8ff'; ctx.lineWidth = 1;
        for (let i = 0; i < 6; i++) {
          const a = h.seed + i / 6 * TAU;
          ctx.beginPath(); ctx.moveTo(h.x, h.y);
          ctx.lineTo(h.x + Math.cos(a) * h.r, h.y + Math.sin(a) * h.r);
          ctx.stroke();
        }
        for (let ring = 1; ring <= 3; ring++) {
          ctx.beginPath(); ctx.arc(h.x, h.y, h.r * ring / 3, 0, TAU); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }
    ctx.globalAlpha = 1;
  },
  enemyInCone(x, y, ang, range, half) {
    const list = this.hash.query(x, y, range, this._tmp);
    let best = null, bd = 1e9;
    for (const e of list) {
      if (e.dead || e.charmT > 0) continue;
      const d = dist(e.x, e.y, x, y);
      if (d > range) continue;
      const rel = Math.atan2(e.y - y, e.x - x);
      if (Math.abs(angDiff(rel, ang)) > half) continue;
      const score = d + Math.abs(angDiff(rel, ang)) * 120;
      if (score < bd) { bd = score; best = e; }
    }
    return best;
  },
  nearestEnemyTo(x, y, self) {
    let best = null, bd = 1e9;
    const list = this.hash.query(x, y, 460, this._tmp);
    for (const e of list) {
      if (e === self || e.dead || e.charmT > 0) continue;
      const d = dist2(e.x, e.y, x, y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  },
  nearestPlayer(x, y) {
    /* Tarnung durch Schalldämpfer: getarnte Spieler ziehen weniger Aufmerksamkeit */
    if (this.players.length > 1) {
      let best = null, bd = 1e9;
      for (const p of this.players) {
        if (!p.alive) continue;
        const st = WeaponSystem.stealthOf(p);
        const d = dist2(p.x, p.y, x, y) * (1 + st * .9);
        if (d < bd) { bd = d; best = p; }
      }
      if (best) return best;
    }
    let best = null, bd = Infinity;
    for (const p of this.players) { if (!p.alive) continue; const d = dist2(x, y, p.x, p.y); if (d < bd) { bd = d; best = p; } }
    return best;
  },
  raycastEnemies(x, y, ang, len, width) {
    const hits = [], dx = Math.cos(ang), dy = Math.sin(ang);
    /* Der Strahl endet an der ersten Wand — vorher schossen Scharfschuetze
       und Railgun quer durch ganze Haeuserzeilen. */
    if (this.level) len *= this.level.rayHit(x, y, x + dx * len, y + dy * len);
    for (const e of this.enemies) {
      if (e.dead) continue;
      const ex = e.x - x, ey = e.y - y;
      const t = ex * dx + ey * dy;
      if (t < 0 || t > len) continue;
      const px = ex - dx * t, py = ey - dy * t;
      if (px * px + py * py < (width + e.r) * (width + e.r)) hits.push({ e, t });
    }
    hits.sort((a, b) => a.t - b.t);
    return hits.map(h => h.e);
  },
  screenToWorld(sx, sy) {
    return { x: (sx - this.W / 2) / this.cam.zoom + this.cam.x, y: (sy - this.H / 2) / this.cam.zoom + this.cam.y };
  },
  shake(amt, t) { this.addTrauma(amt, t); this._shakeAngled = false; },
  loop(t) {
    const dt = Math.min(.05, (t - this.lastT) / 1000 || 0);
    this.lastT = t;
    this._frameId = (this._frameId || 0) + 1;
    this.fps = lerp(this.fps, 1 / Math.max(.0001, dt), .08);
    /* Adaptive Qualität: bei dauerhaft niedrigem FPS werden Effekte/Lichter
       automatisch reduziert, statt das Spiel in Zeitlupe weiterlaufen zu lassen. */
    if (OPT().autoQuality) {
      this._aqT += dt;
      if (this._aqT > 2) {
        this._aqT = 0;
        const want = this.fps < 38 ? .55 : this.fps > 52 ? 1 : this.autoQ;
        if (want !== this.autoQ) {
          this.autoQ = want;
          UI.toast(want < 1 ? 'Auto-Qualität: Effekte reduziert' : 'Auto-Qualität: volle Effekte');
        }
      }
    }
    Input.poll();
    this.handleGlobalInput();
    Net.tick(dt);
    if (UI.cur === 'scControls') UI.updateGpStatus();
    if (this.state === 'play') {
      if (this.hitstop > 0) this.hitstop -= dt; else this.timeScale = lerp(this.timeScale, 1, 1 - Math.pow(.0001, dt));
      const sdt = dt * this.timeScale * this.speedMul * this.speedBase;
      this.update(sdt);
      this.time += sdt; this.run.time += sdt;
    }
    else { FX.update(dt); }
    AudioSys.tickMusic(dt, this.state === 'play' ? clamp(this.wave / 20, 0, 1) : 0.55);
    AudioSys.updateMotors(dt, this.players, this.state === 'play');
    /* Im Gast-Modus zeigt ein <video> das Bild des Hosts - eigenes Rendern waere reine Last. */
    if (!Net.isGuest()) this.render();
    Input.endFrame();
    requestAnimationFrame(tt => this.loop(tt));
  },
  handleGlobalInput() {
    /* Der Gast simuliert nichts: seine Tasten werden nur als Ereignisse verschickt. */
    if (Net.isGuest()) { Net.clientInput(); return; }
    const P = Input.pressed;
    const padStart = Input.padPressed(0, 9) || Input.padPressed(1, 9);
    if ((P[Input.key('pause')] || padStart || Input.touch.pause)) {
      if (this.state === 'play') { this.state = 'paused'; UI.navIdx = 0; UI.show('scPause'); AudioSys.sfx('ui'); }
      else if (this.state === 'paused' && UI.cur === 'scPause') { this.state = 'play'; UI.show(null); $('hud').classList.remove('hidden'); }
      else if (UI.cur === 'scOptions') { UI.back('scTitle'); }
    }
    if (P[Input.key('aimMode')]) {
      for (const p of this.players) p.manualAim = !p.manualAim;
      const on = this.players[0] && this.players[0].manualAim;
      UI.toast(on ? 'Manuelles Zielen AN — +7 % Schaden, Präzisionswaffen +15 %' : 'Automatisches Zielen AN');
      AudioSys.sfx('ui');
    }
    if (P[Input.key('music')] || Input.padPressed(0, 10) || Input.padPressed(1, 10)) {
      if (Input.keys.ShiftLeft || Input.keys.ShiftRight) this.toggleMusicMute();
      else this.cycleMusicMode(1);
    }
    if (P[Input.key('turbo')] && this.state === 'play') {
      this.speedMul = this.speedMul === 2 ? 1 : 2;
      UI.toast(this.speedMul === 2 ? 'TURBO: ×2 TEMPO — erneut ' + Input.key('turbo').replace('Key', '') + ' zum Stoppen' : 'Normal-Tempo');
      AudioSys.sfx('ui');
    }
    if ((P.BracketLeft || P.BracketRight) && this.state === 'play') {
      const lv = clamp(OPT().gameSpeed + (P.BracketRight ? 1 : -1), 1, 10);
      if (lv !== OPT().gameSpeed) {
        OPT().gameSpeed = lv; Save.save();
        this.speedBase = SPEED_MULT(lv);
        AudioSys.sfx('ui');
        UI.renderHud();
        UI.toast('Tempo-Stufe ' + lv + ' · ×' + SPEED_MULT(lv).toFixed(1));
      }
    }
    if ((P[Input.key('quote')] || Input.padPressed(0, 8) || Input.padPressed(1, 8)) && this.state === 'play') {
      let said = false;
      for (const p of this.players) if (p.alive) { p.sayQuote(); said = true; }
      if (said) AudioSys.sfx('ui');
    }
    if ((P[Input.key('jump')] || Input.padPressed(0, 11) || Input.padPressed(1, 11)) && this.state === 'play') {
      for (const p of this.players) if (p.alive) p.jump();
    }
    if ((P[Input.key('dash')] || Input.padPressed(0, 4) || Input.padPressed(1, 4)) && this.state === 'play') {
      for (const p of this.players) if (p.alive) p.roll();
    }
    if ((P[Input.key('emote')] || Input.padPressed(0, 2) || Input.padPressed(1, 2)) && this.state === 'play') {
      for (const p of this.players) if (p.alive) p.emote();
    }
    if ((P[Input.key('rune')] || Input.padPressed(0, 7) || Input.padPressed(1, 7)) && this.state === 'play') {
      const p = this.players[0];
      if (p && p.alive) p.tryActivateRune();
    }
    /* Aktionen des entfernten Mitspielers wirken ausschliesslich auf Spieler 2. */
    if (Net.isHost()) {
      const p2 = this.players[1];
      if (p2 && p2.alive && this.state === 'play') {
        if (Net.takeAct('dash')) p2.roll();
        if (Net.takeAct('jump')) p2.jump();
        if (Net.takeAct('rune')) p2.tryActivateRune();
      } else Net.acts = {};
    }
    if (UI.cur === 'scTitle') {
      if (P[Input.key('menu')]) $('scTitle').querySelector('[data-act="play"]').click();
      if (P.KeyO) $('scTitle').querySelector('[data-act="options"]').click();
      if (P.KeyE) $('scTitle').querySelector('[data-act="achv"]').click();
      if (P.KeyC) $('scTitle').querySelector('[data-act="codex"]').click();
      if (P.KeyS) { const s = $('scTitle').querySelector('[data-act="stats"]'); if (s) s.click(); }
      if (P.KeyX) { const c = $('scTitle').querySelector('[data-act="code"]'); if (c) c.click(); }
      if (P.KeyN) { const n = $('scTitle').querySelector('[data-act="netOpen"]'); if (n) n.click(); }
    }
    if (UI.cur === 'scShop') {
      if (P.KeyR) ShopSystem.reroll(this.wave, this.players);
      if (P[Input.key('menu')] || P.Space) this.startWave(this.wave + 1);
      const el = document.getElementById(UI.cur);
      if (el) {
        const cards = el.querySelectorAll('[data-buy]');
        if (P.Digit1 && cards[0]) cards[0].click();
        if (P.Digit2 && cards[1]) cards[1].click();
        if (P.Digit3 && cards[2]) cards[2].click();
        if (P.Digit4 && cards[3]) cards[3].click();
        if (P.Digit5 && cards[4]) cards[4].click();
        if (P.Digit6 && cards[5]) cards[5].click();
      }
      if (P.Tab && this.coop) { UI.shopPlayer = 1 - UI.shopPlayer; UI.renderShop(); }
      if (Input.padPressed(0, 4) || Input.padPressed(0, 5)) { if (this.coop) { UI.shopPlayer = 1 - UI.shopPlayer; UI.renderShop(); } }
      if (Input.padPressed(0, 3)) ShopSystem.reroll(this.wave, this.players);
      if (Input.padPressed(0, 9)) this.startWave(this.wave + 1);
    }
    if (UI.cur === 'scEndless') {
      if (P.KeyE) { const b = $('scEndless').querySelector('[data-act="continueEndless"]'); if (b) b.click(); }
      if (P.KeyW) { const b = $('scEndless').querySelector('[data-act="winNow"]'); if (b) b.click(); }
    }
    if (UI.cur === 'scStats' && P[Input.key('pause')]) { const b = $('scStats').querySelector('[data-act="statsBack"]'); if (b) b.click(); }
    if (UI.cur) {
      const dpadU = Input.padPressed(0, 12) || Input.padPressed(1, 12);
      const dpadD = Input.padPressed(0, 13) || Input.padPressed(1, 13);
      const dpadL = Input.padPressed(0, 14) || Input.padPressed(1, 14);
      const dpadR = Input.padPressed(0, 15) || Input.padPressed(1, 15);
      this._stickCd = Math.max(0, (this._stickCd || 0) - .016);
      let sy = Input.padAxis(0, 1), sx = Input.padAxis(0, 0);
      if (this.coop) { sy = sy || Input.padAxis(1, 1); sx = sx || Input.padAxis(1, 0); }
      let mv = 0;
      if (dpadD || dpadR) mv = 1; else if (dpadU || dpadL) mv = -1;
      else if (Math.abs(sy) > .6 && this._stickCd <= 0) { mv = sy > 0 ? 1 : -1; this._stickCd = .18; }
      else if (Math.abs(sx) > .6 && this._stickCd <= 0) { mv = sx > 0 ? 1 : -1; this._stickCd = .18; }
      if (mv) UI.navMove(mv);
      if (Input.padPressed(0, 0) || Input.padPressed(1, 0)) UI.navActivate();
      if (Input.padPressed(0, 1) || Input.padPressed(1, 1)) {
        const back = $(UI.cur).querySelector('[data-act$="Back"],[data-act="resume"],[data-act="toTitle"]');
        if (back) back.click();
      }
      if (P.ArrowDown) UI.navMove(1);
      if (P.ArrowUp) UI.navMove(-1);
      if (P.Enter && UI.cur !== 'scShop') UI.navActivate();
    }
  },
  update(dt) {
    const L = this.level;
    L.update(dt);
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) this.combo = 0; }
    if (this.modActive('umschaltung')) {
      this.swapT -= dt;
      if (this.swapT <= 0) {
        this.swapT = 15;
        this.swapIdx = ((this.swapIdx || 0) + 1) % 3;
        UI.toast(this.swapIdx === 0 ? 'UMSCHALTUNG: +20% Waffenschaden' : this.swapIdx === 1 ? 'UMSCHALTUNG: +25% Angriffstempo' : 'UMSCHALTUNG: +10% Krit-Chance');
      }
    }
    if (L.hazards) {
      for (const hz of L.hazards) {
        if (hz.type === 'tram' && hz.warn <= 0) {
          for (const p of this.players) if (p && p.alive && p.invuln <= 0 && Math.abs(p.x - hz.x) < hz.w / 2 + 18 && Math.abs(p.y - hz.y) < hz.h / 2 + 18) p.damage(26, Math.atan2(p.y - hz.y, p.x - hz.x));
          for (const e of this.enemies) if (!e.dead && Math.abs(e.x - hz.x) < hz.w / 2 && Math.abs(e.y - hz.y) < hz.h / 2) { e.hurt(95, false, null, 'tram'); e.knockback(Math.atan2(e.y - hz.y, e.x - hz.x), 460); }
        }
        if (hz.type === 'steam' && hz.t > hz.warn) {
          for (const p of this.players) if (p && p.alive && p.invuln <= 0 && dist(p.x, p.y, hz.x, hz.y) < 66 + hz.t * 6) p.damage(13, 0);
          for (const e of this.enemies) if (!e.dead && dist(e.x, e.y, hz.x, hz.y) < 80) e.hurt(42, false, null, 'tram');
        }
      }
    }
    for (let i = L.drops.length - 1; i >= 0; i--) {
      const pd = L.drops[i];
      pd.t = (pd.t || 0) + dt;
      if (pd.t > 1.2) { this.spawnMaterial(pd.x, pd.y, 1); L.drops.splice(i, 1); }
    }
    if (this._tutI !== null && this._tutSteps) {
      this._tutT -= dt;
      if (this._tutT <= 0) {
        this._tutI++;
        if (this._tutI < this._tutSteps.length) { this._tutT = this._tutSteps[this._tutI].t; $('tutHint').innerHTML = this._tutSteps[this._tutI].html + this._tutSkipBtn(); }
        else this.hideTutorial();
      }
    }
    this.spawnAcc += dt;
    const elapsed = this.waveDuration - this.waveTimer;
    if (this.spawnQueue.length) {
      const s = this.spawnQueue[0];
      if (!s._tel && s.t - elapsed <= SPAWN_TELEGRAPH) {
        if (!s.pt) s.pt = this.resolveSpawnPoint();
        s._tel = true;
        const col = s.boss ? '#ff2e88' : s.def.col;
        FX.telegraph(s.pt.x, s.pt.y, (s.boss ? 62 : s.def.r + 30), col, SPAWN_TELEGRAPH * .9, s.boss ? 'star' : (s.def.shape || 'dot'), s.boss ? 46 : s.def.r);
        FX.particle(s.pt.x, s.pt.y, crnd(TAU), crnd(40, 110), col, .4, 2.5);
      }
    }
    while (this.spawnQueue.length && this.spawnQueue[0].t <= elapsed) {
      const s = this.spawnQueue.shift();
      /* Max. Gegner gleichzeitig auf dem Feld */
      if (!s.boss && this.enemies.length >= (this._maxSimultaneous || 50)) { this.spawnQueue.unshift(s); break; }
      if (s.boss) this.spawnAtPoint(null, false, s.boss, s.pt);
      else this.spawnAtPoint(s.def, s.elite, false, s.pt);
    }
    this.hash.clear();
    for (const e of this.enemies) if (!e.dead) this.hash.insert(e);
    { const fp = this.players[0]; if (fp) this.flow.update(dt, L, fp.x, fp.y); }
    const spx = this.W / 2 / this.cam.zoom + 70, spy = this.H / 2 / this.cam.zoom + 70;
    for (const p of this.players) p.update(dt);
    this.sepToggle = !this.sepToggle;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (L.fogSlowAt && !e.dead) { if (L.fogSlowAt(e.x, e.y)) e.spdMul = Math.min(e.spdMul || 1, .55); else e.spdMul = 1; }
      e.update(dt);
      if (e.dead && !e.deathAnim) {
        this.enemies[i] = this.enemies[this.enemies.length - 1];
        this.enemies.pop();
        if (this.enemyPool.length < 400) this.enemyPool.push(e);
      }
      else if (!e.dead && this.sepToggle && Math.abs(e.x - this.cam.x) < spx && Math.abs(e.y - this.cam.y) < spy) this.separateEnemy(e);
    }
    Projectiles.update((p, d) => this.updateProjectile(p, d), dt);
    EnemyBullets.update((b, d) => {
      b.life -= d; if (b.life <= 0) { b.dead = true; return; }
      if (b.orbit) {
        b.orbit.a += d * b.orbit.w;
        b.orbit.rr += d * b.orbit.out;
        b.x = b.orbit.cx + Math.cos(b.orbit.a) * b.orbit.rr;
        b.y = b.orbit.cy + Math.sin(b.orbit.a) * b.orbit.rr;
        if (b.orbit.rr < 12) { b.dead = true; return; }
      } else {
        b.x += b.vx * d; b.y += b.vy * d;
      }
      b._tt = (b._tt || 0) + d;
      if (b._tt > .035 && OPT().particles > 0) {
        b._tt = 0;
        FX.px(b.x + crnd(-1, 1), b.y + crnd(-1, 1), b.col, 2, .18, { glow: 1 });
        if (b.poison && Math.random() < .5) FX.particle(b.x, b.y, Math.atan2(b.vy, b.vx) + Math.PI, crnd(10, 40), '#b8d98a', .35, 2, { shape: 'smoke', dg: .5, grow: 4, alpha: .3, fade: 1 });
      }
      if (b.x < 0 || b.y < 0 || b.x > L.w || b.y > L.h) { b.dead = true; return; }
      if (L.blocksRay(b.x, b.y)) {
        b.dead = true;
        FX.projImpact(b.x, b.y, Math.atan2(b.vy, b.vx), b.col, 'enemy', 'stone');
        return;
      }
      for (const p of this.players) {
        if (!p.alive) continue;
        if (dist2(b.x, b.y, p.x, p.y) < (p.r + b.r) * (p.r + b.r)) {
          Game.lastHitBy = { name: b.srcName || 'Feind', t: Game.time };
          Game.stealMaterial();
          p.damage(b.dmg, 0); b.dead = true;
          if (b.poison) { p.damage(b.poison * .2, 0); }
          return;
        }
      }
    }, dt);
    for (const m of this.pickups) {
      m.t += dt; m.x += m.vx * dt; m.y += m.vy * dt;
      m.vx *= Math.pow(.02, dt); m.vy *= Math.pow(.02, dt);
      m.x = clamp(m.x, 8, L.w - 8); m.y = clamp(m.y, 8, L.h - 8);
    }
    for (const ru of this.runes) {
      ru.t += dt; ru.x += ru.vx * dt; ru.y += ru.vy * dt;
      ru.vx *= Math.pow(.02, dt); ru.vy *= Math.pow(.02, dt);
      ru.x = clamp(ru.x, 8, L.w - 8); ru.y = clamp(ru.y, 8, L.h - 8);
    }
    for (const pd of this.petDrops) {
      pd.t += dt; pd.x += pd.vx * dt; pd.y += pd.vy * dt;
      pd.vx *= Math.pow(.02, dt); pd.vy *= Math.pow(.02, dt);
      pd.x = clamp(pd.x, 8, L.w - 8); pd.y = clamp(pd.y, 8, L.h - 8);
    }
    for (const pu of this.powerups) pu.t += dt;
    const bossAlive = this.enemies.some(e => !e.dead && e.boss);
    this.bossAlive = bossAlive;
    /* Sanfter Übergang: Music-Reset bei Boss-Wechsel vermeiden */
    if (AudioSys.bossMode !== bossAlive) {
      AudioSys.bossMode = bossAlive;
      AudioSys._nextTime = null; /* Timing-Reset für sauberen Übergang */
    }
    this.updateSplats(dt);
    if (this.magnetSweep > 0) {
      /* Magnetsog: alles Material fliegt zum nächsten Spieler */
      this.magnetSweep -= dt;
      for (const m of this.pickups) {
        const p = this.nearestPlayer(m.x, m.y);
        if (!p) continue;
        const a = Math.atan2(p.y - m.y, p.x - m.x);
        const sp = 420 + (1.4 - this.magnetSweep) * 500;
        m.x += Math.cos(a) * sp * dt; m.y += Math.sin(a) * sp * dt;
        if (OPT().particles > 0 && Math.random() < .25) FX.px(m.x, m.y, '#f4c25a', 2, .2, { glow: 1 });
      }
      if (this.magnetSweep <= 0) this.magnetSweep = 0;
    }
    this.updateHazObjs(dt);
    this.updateArenaMod(dt);
    if (this.bossIntro > 0) this.bossIntro = Math.max(0, this.bossIntro - dt);
    if (this.perfectFlash > 0) this.perfectFlash = Math.max(0, this.perfectFlash - dt * 2);
    /* Gefahrenschicht: niedrigste Lebensenergie aller lebenden Spieler */
    let lowHp = 1;
    for (const p of this.players) if (p.alive) lowHp = Math.min(lowHp, clamp(p.hp / Math.max(1, p.maxHp), 0, 1));
    const dangerLvl = this.state === 'play' ? clamp((.45 - lowHp) / .40, 0, 1) : 0;
    AudioSys.setDanger(dangerLvl);
    FX.update(dt, bossAlive);
    let cx = 0, cy = 0, n = 0;
    for (const p of this.players) { if (!p.alive && this.players.some(q => q.alive)) continue; cx += p.x; cy += p.y; n++; }
    if (n) { cx /= n; cy /= n; }
    /* Referenzfenster: so viel Spielfeld soll sichtbar sein. 1130 x 640
       entspricht dem, was auf 1080p bisher zu sehen war — der Wert, der
       sich als richtig erwiesen hat. Ueber die Flaeche gerechnet gilt er
       fuer jedes Seitenverhaeltnis und jede Aufloesung gleichermassen. */
    const base = Math.sqrt((this.W * this.H) / (1130 * 640));
    let zoom = clamp(base * (OPT().camDist != null ? OPT().camDist : 1), .45, 4.5);
    /* Bei dichtem Gedränge etwas herauszoomen, im Bosskampf näher heran */
    const aliveN = this.enemies.reduce((a, e) => a + (e.dead ? 0 : 1), 0);
    const dense = clamp((aliveN - 22) / 55, 0, 1);
    zoom *= 1 - dense * .16;
    if (bossAlive) zoom *= 1.06;
    if (this.bossIntro > 0) zoom *= 1.22;
    zoom *= 1 + (this.cam.punch || 0);
    /* Blickführung: die Kamera schiebt sich leicht in Zielrichtung */
    const lead = (this.players.length === 1 && this.players[0].alive) ? this.players[0] : null;
    if (lead) {
      const lx = Math.cos(lead.aim) * 74, ly = Math.sin(lead.aim) * 74;
      this.cam.lx = lerp(this.cam.lx || 0, lx, 1 - Math.pow(.05, dt));
      this.cam.ly = lerp(this.cam.ly || 0, ly, 1 - Math.pow(.05, dt));
      cx += this.cam.lx; cy += this.cam.ly;
    } else { this.cam.lx = lerp(this.cam.lx || 0, 0, 1 - Math.pow(.05, dt)); this.cam.ly = lerp(this.cam.ly || 0, 0, 1 - Math.pow(.05, dt)); }
    if (this.bossIntro > 0 && this.bossIntroTarget) {
      const k = 1 - Math.pow(.02, dt);
      cx = lerp(cx, this.bossIntroTarget.x, k * .9);
      cy = lerp(cy, this.bossIntroTarget.y, k * .9);
    }
    if (this.coop) {
      const a = this.players[0], b = this.players[1];
      if (a && b && a.alive && b.alive) {
        const sep = dist(a.x, a.y, b.x, b.y);
        zoom = clamp(Math.min(zoom, (Math.min(this.W, this.H * 1.5) * .62) / Math.max(300, sep)), .40, 1.5);
      }
    }
    this.cam.zoom = lerp(this.cam.zoom, zoom, 1 - Math.pow(.02, dt));
    this.cam.x = lerp(this.cam.x, clamp(cx, this.W / 2 / this.cam.zoom, L.w - this.W / 2 / this.cam.zoom), 1 - Math.pow(.0005, dt));
    this.cam.y = lerp(this.cam.y, clamp(cy, this.H / 2 / this.cam.zoom, L.h - this.H / 2 / this.cam.zoom), 1 - Math.pow(.0005, dt));
    if (L.w * this.cam.zoom < this.W) this.cam.x = L.w / 2;
    if (L.h * this.cam.zoom < this.H) this.cam.y = L.h / 2;
    if (this.cam.trauma > 0) {
      this.cam.shakeT -= dt;
      this.cam.trauma = Math.max(0, this.cam.trauma - dt * 1.15);
      /* Quadratisch: kleine Treffer bewegen kaum, grosse schlagen durch. */
      const amp = 26 * this.cam.trauma * this.cam.trauma;
      /* Zwei unterschiedliche Frequenzen statt rnd() pro Bild - sonst rauscht es. */
      this.cam.shakeT2 = (this.cam.shakeT2 || 0) + dt * 34;   /* cam wird an anderer Stelle neu gesetzt - Feld kann fehlen */
      const t2 = this.cam.shakeT2;
      let ox = Math.sin(t2 * 1.7) * amp, oy = Math.sin(t2 * 2.3 + 1.1) * amp;
      if (this._shakeAngled && this.cam.shakeT > 0) {
        /* Richtungsanteil: der Stoss kommt spuerbar aus der Richtung des Ereignisses. */
        const a = Math.atan2(this.cam.shakeDY - cy, this.cam.shakeDX - cx);
        ox = Math.cos(a) * amp * .8 + ox * .45;
        oy = Math.sin(a) * amp * .8 + oy * .45;
      }
      this.cam.sx = ox; this.cam.sy = oy;
      this.cam.shake = amp;
      if (this.cam.shakeT <= 0) this._shakeAngled = false;
    } else { this.cam.sx = this.cam.sy = 0; this.cam.shake = 0; this.cam.trauma = 0; }
    this.cam.punch = Math.max(0, (this.cam.punch || 0) - dt * 2);
    this.waveTimer -= dt;
    if (this.waveTimer <= 0 && !this.bossAlive) this.endWave();
    else if (this.waveTimer <= 0 && this.bossAlive) { this.waveTimer = 0; this.bossOvertime(dt); }
    if (this.players.every(p => !p.alive)) this.endRun(false);
    /* HUD-Throttling: DOM-Schreibzugriffe nur ~10x/s statt jeden Frame —
       die größte Jank-Quelle auf Mobilgeräten. */
    this.hudAcc += dt;
    if (this.hudAcc >= .1) { this.hudAcc = 0; UI.renderHud(); }
  },
  updateProjectile(p, dt) {
    const L = this.level;
    p.life -= dt; if (p.life <= 0) { if (p.boom) this.detonate(p); p.dead = true; return; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (L.barrels && L.barrels.length && L.hitBarrel(p.x, p.y, p.dmg)) {
      if (p.boom) this.detonate(p);
      p.dead = true; return;
    }
    if (p.shape === 'advice') {
      p.rot += dt * 3.4;
      const spd = Math.hypot(p.vx, p.vy);
      if (spd > 1) {
        const ux = -p.vy / spd, uy = p.vx / spd;
        const target = Math.sin(p.rot * 1.15) * 7;
        const move = target - (p.zigOff || 0);
        p.x += ux * move; p.y += uy * move;
        p.zigOff = target;
      }
    }
    if (p.shape === 'note') {
      p.rot += dt * 7;
      p.zigT = (p.zigT || 0) + dt * 9;
      const spd = Math.hypot(p.vx, p.vy);
      if (spd > 1) {
        const ux = -p.vy / spd, uy = p.vx / spd;
        const target = Math.sin(p.zigT) * 24;
        const move = target - (p.zigOff || 0);
        p.x += ux * move; p.y += uy * move;
        p.zigOff = target;
      }
    }
    /* Zielsuchende Projektile (Taubenschwarm) */
    if (p.homing) {
      const tgt = Game.nearestEnemy(p.x, p.y, 460);
      if (tgt) {
        const want = Math.atan2(tgt.y - p.y, tgt.x - p.x);
        const cur = Math.atan2(p.vy, p.vx);
        const na = cur + angDiff(want, cur) * clamp(dt * p.homing, 0, 1);
        const sp2 = Math.hypot(p.vx, p.vy);
        p.vx = Math.cos(na) * sp2; p.vy = Math.sin(na) * sp2;
      }
    }
    /* Eigenverhalten je Projektiltyp: Drall, Taumeln, Pulsieren */
    const PF = projFx(p.source);
    if (PF.spin) p.rot += dt * PF.spin;
    else p.rot += dt * 1.2;
    if (PF.pulse) p.pulse = (p.pulse || 0) + dt * 9;
    if (PF.wob) {
      p.wobT = (p.wobT || rnd(TAU)) + dt * 7;
      const sp = Math.hypot(p.vx, p.vy);
      if (sp > 1) {
        const ux = -p.vy / sp, uy = p.vx / sp;
        const target = Math.sin(p.wobT) * 6 * PF.wob;
        const move = target - (p.wobOff || 0);
        p.x += ux * move; p.y += uy * move;
        p.wobOff = target;
      }
    }
    FX.projTrail(p, dt);
    if (p.x < 0 || p.y < 0 || p.x > L.w || p.y > L.h || L.blocksRay(p.x, p.y)) {
      if (p.bounce > 0) {
        p.bounce--;
        if (p.x < 0 || p.x > L.w) p.vx *= -1; else if (p.y < 0 || p.y > L.h) p.vy *= -1;
        else { p.vx *= -1; p.vy *= -1; }
        p.x = clamp(p.x, 2, L.w - 2); p.y = clamp(p.y, 2, L.h - 2);
      } else {
        if (!p.boom) FX.projImpact(p.x, p.y, Math.atan2(p.vy, p.vx), p.col, p.source, L.blocksRay(p.x, p.y) ? 'stone' : 'dirt');
        if (p.boom) this.detonate(p); p.dead = true; return;
      }
    }
    const list = this.hash.query(p.x, p.y, p.r + 30, this._tmp);
    for (const e of list) {
      if (e.dead || p.hitSet.has(e)) continue;
      if (dist2(p.x, p.y, e.x, e.y) < (p.r + e.r) * (p.r + e.r)) {
        p.hitSet.add(e);
        const isCrit = Math.random() < p.critC;
        const d = p.dmg * (isCrit ? p.critM : 1);
        FX.mud(p.x, p.y, Math.atan2(p.vy, p.vx), isCrit ? 1.5 : 1);
        const type = p.elemental ? 'elem' : (p.source === 'turret' ? 'ranged' : 'ranged');
        e.hurt(d, isCrit, p.owner, type, p.armorPierce);
        if (p.slow) e.applySlow(p.slow, p.slowT);
        if (p.burn) e.applyElement('fire', p.burn, p.owner);
        if (p.poison) e.applyElement('poison', p.poison / p.poisonT, p.owner);
        if (p.owner && p.ls) p.owner.heal(d * p.ls, 'ls');
        if (p.owner && p.weapon) WeaponSystem.onHit(p.owner, p.weapon, e, d, isCrit, {});
        else if (p.owner && p.healHit) p.owner.heal(p.healHit, 'needle');
        e.knockback(Math.atan2(p.vy, p.vx), 90 * (1 + (p.owner ? p.owner.st.knock : 0) / 100));
        if (p.starfall && p.hitSet.size >= 3) { Save.prog('starfall3', 1); this.run.track.starfall3 = 1; }
        if (p.boom) { this.detonate(p); p.dead = true; return; }
        if (p.cloud) { this.spawnCloud(p); p.dead = true; return; }
        if (e.def && e.def.reflect && Math.random() < e.def.reflect && !p.reflected) {
          /* Spiegelgänger wirft das Geschoss zurück */
          p.reflected = true;
          p.vx = -p.vx; p.vy = -p.vy;
          p.hitSet.clear();
          p.owner = null;
          Game.spawnEnemyBullet(p.x, p.y, Math.atan2(p.vy, p.vx), Math.hypot(p.vx, p.vy) * .8,
            p.dmg * .6 * DANGERS[Game.danger].dmg, '#bfe8ff', 0, e.def.name);
          FX.ripple(e.x, e.y, e.r * 3, '#bfe8ff', .3);
          FX.sparkShower(p.x, p.y, Math.atan2(p.vy, p.vx), 5, '#ffffff', 240);
          AudioSys.sfxAt('clank', e.x, e.y, .9);
          p.dead = true;
          return;
        }
        if (p.source === 'ratschlaege' && !e.boss) {
          e.advice = (e.advice || 0) + 1;
          const need = e.elite ? 5 : 3;
          if (e.advice >= 2) FX.number(e.x, e.y - 26, 'RATSCHLAG ' + Math.min(e.advice, need) + '/' + need, '#ffd24a', .7);
          if (e.advice >= need && e.charmT <= 0) {
            e.charmT = 5.5;
            e.advice = 0;
            FX.ripple(e.x, e.y, e.r * 5, '#ffd24a', .4);
            FX.shockwave(e.x, e.y, e.r * 4, '#8a5cff');
            FX.light(e.x, e.y, 120, '#ffd24a', .3, 1);
            FX.number(e.x, e.y - 34, 'ÜBERZEUGT!', '#8a5cff', 1.1);
            AudioSys.sfxAt('w_ratschlag', e.x, e.y, 1.2);
            AudioSys.sfxAt('rune', e.x, e.y, .8);
          }
        }
        if (p.stick && p.boom) {
          /* Magnetmine haftet am Ziel und reißt es mit in die Menge */
          Game.spawnMine(e.x, e.y, { fuse: p.stick, r: p.boom, dmg: p.dmg * .8 }, 'Magnetmine');
          FX.ripple(e.x, e.y, 22, '#ff6b3d', .25);
          AudioSys.sfxAt('tick', e.x, e.y);
          p.dead = true;
          return;
        }
        if (p.pierce > 0) {
          p.pierce--; p.dmg *= .88;
          const a0 = Math.atan2(p.vy, p.vx);
          FX.mud(p.x, p.y, a0, 1.1);
          FX.sparkShower(p.x, p.y, a0, 3, p.col, 160);
          FX.ripple(p.x, p.y, 16, p.col, .2);
          if (Math.random() < .5) AudioSys.sfxAt('pierce', p.x, p.y, .8);
        }
        else {
          if (OPT().particles > 0) {
            const n = p.elemental ? 6 : 4;
            const a0 = Math.atan2(p.vy, p.vx);
            for (let i = 0; i < n; i++) FX.particle(p.x, p.y, a0 + crnd(-1.2, 1.2), crnd(60, 220), p.col, .18, 2.2, { shape: 'pixel', gy: 60, dg: .2, glow: 1 });
            FX.sparkShower(p.x, p.y, a0 + Math.PI, 3, p.col, 180);
            FX.ripple(p.x, p.y, 14, p.col, .16);
          }
          p.dead = true; return;
        }
      }
    }
    if (p.pull) {
      for (const e of list) if (!e.dead) {
        const d = dist(e.x, e.y, p.x, p.y);
        if (d < p.pull) {
          const a = Math.atan2(p.y - e.y, p.x - e.x);
          e.x += Math.cos(a) * 160 * dt; e.y += Math.sin(a) * 160 * dt;
          if (!e._pullCounted) { e._pullCounted = true; Save.prog('pulled', 1); this.run.track.pulled++; }
        }
      }
    }
  },
  detonate(p) {
    if (this.level && this.level.barrels) {
      for (const b of this.level.barrels) if (!b.dead && dist(b.x, b.y, p.x, p.y) < (p.boom || 60) + b.r) this.level.blowBarrel(b);
    }
    const r = p.boom;
    FX.explosion(p.x, p.y, r, p.col);
    FX.flash(p.x, p.y, crnd(TAU), p.col, 24);
    AudioSys.sfxAt('boom', p.x, p.y); this.feedback(p.x, p.y, 'klein');
    const list = this.hash.query(p.x, p.y, r + 40, this._tmp2);
    for (const e of list) {
      if (e.dead) continue;
      const d = dist(e.x, e.y, p.x, p.y);
      if (d < r + e.r) {
        const falloff = clamp(1 - d / (r + e.r), .35, 1);
        const dd = p.dmg * .9 * falloff;
        e.hurt(dd, false, p.owner, 'boom', p.armorPierce, p.weapon);
        e.knockback(Math.atan2(e.y - p.y, e.x - p.x), 200);
        if (p.owner && p.weapon) WeaponSystem.onHit(p.owner, p.weapon, e, dd, false, {});
      }
    }
    if (p.pull) {
      for (const e of list) if (!e.dead && dist(e.x, e.y, p.x, p.y) < p.pull * 1.4) {
        const a = Math.atan2(p.y - e.y, p.x - e.x);
        e.knockback(a, 420);
        if (!e._pullCounted) { e._pullCounted = true; Save.prog('pulled', 1); this.run.track.pulled++; }
      }
      FX.shockwave(p.x, p.y, p.pull, '#a06bff');
    }
  },
  spawnCloud(p) {
    const f = { type: 'poison', x: p.x, y: p.y, r: p.cloud * (1 + (p.owner ? p.owner.st.expSize : 0) / 100), dps: p.poison / p.poisonT, temp: p.poisonT + 2 };
    this.level.fields.push(f);
    FX.shockwave(p.x, p.y, f.r, '#b8d98a');
    const list = this.hash.query(p.x, p.y, f.r, this._tmp2);
    for (const e of list) if (!e.dead && dist(e.x, e.y, p.x, p.y) < f.r) e.applyPoison(f.dps, p.poisonT);
    setTimeout(() => { const i = this.level.fields.indexOf(f); if (i >= 0) this.level.fields.splice(i, 1); }, f.temp * 1000);
  },
  /* ---- Elementar-Reaktionen ---- */
  _elemBolt(x1, y1, x2, y2, col) {
    const segs = 5, off = Math.min(20, Math.hypot(x2 - x1, y2 - y1) * .2);
    let px = x1, py = y1;
    for (let i = 1; i <= segs; i++) {
      const t = i / segs, j = i === segs ? 0 : rnd(-off, off), k = i === segs ? 0 : rnd(-off, off);
      const nx = x1 + (x2 - x1) * t + j, ny = y1 + (y2 - y1) * t + k;
      FX.line(px, py, nx, ny, Math.random() < .5 ? col : '#ffffff', .16);
      px = nx; py = ny;
    }
  },
  explosionImpulse(x, y, r, force) {
    const list = this.hash.query(x, y, r + 60, this._tmp2);
    for (const t of list) if (!t.dead && !t.boss) {
      const d = dist(t.x, t.y, x, y);
      if (d < r + t.r) t.knockback(Math.atan2(t.y - y, t.x - x), force * clamp(1 - d / (r + t.r), .3, 1));
    }
  },
  separateEnemy(e) {
    const near = this.hash.query(e.x, e.y, e.r + 26, this._tmp2);
    for (let i = 0; i < near.length; i++) {
      const o = near[i];
      if (o === e || o.dead || o.boss) continue;
      const dx = e.x - o.x, dy = e.y - o.y, dd = dx * dx + dy * dy;
      const min = (e.r + o.r) * .7;
      if (dd > .01 && dd < min * min) {
        const d = Math.sqrt(dd), push = (min - d) * .35;
        const nx = dx / d, ny = dy / d;
        e.x += nx * push; e.y += ny * push;
        o.x -= nx * push * .55; o.y -= ny * push * .55;
      }
    }
  },
  render() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#05070d'; ctx.fillRect(0, 0, this.W, this.H);
    if (!this.level || this.state === 'title') { this.renderTitleBg(ctx); return; }
    ctx.save();
    ctx.translate(this.W / 2 + this.cam.sx, this.H / 2 + this.cam.sy);
    ctx.scale(this.cam.zoom, this.cam.zoom);
    ctx.translate(-this.cam.x, -this.cam.y);
    if (this.buildParallaxPending) { this.buildParallaxPending = false; this.buildParallax(); }
    this.drawParallax(ctx);
    this.level.draw(ctx, this.cam);
    const pvw = this.W / 2 / this.cam.zoom + 30, pvh = this.H / 2 / this.cam.zoom + 30;
    for (const m of this.pickups) {
      if (Math.abs(m.x - this.cam.x) > pvw || Math.abs(m.y - this.cam.y) > pvh) continue;
      const s = 5 + Math.sin(this.time * 6 + m.t * 3) * 1.2;
      ctx.fillStyle = '#f4c25a'; ctx.globalAlpha = .95;
      ctx.beginPath(); ctx.moveTo(m.x, m.y - s); ctx.lineTo(m.x + s, m.y); ctx.lineTo(m.x, m.y + s); ctx.lineTo(m.x - s, m.y); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
    }
    for (const pu of this.powerups) {
      const s = 12 + Math.sin(this.time * 5) * 2;
      ctx.strokeStyle = pu.col; ctx.lineWidth = 2.5; ctx.globalAlpha = .9;
      ctx.beginPath(); ctx.arc(pu.x, pu.y, s, 0, TAU); ctx.stroke();
      ctx.fillStyle = pu.col; ctx.globalAlpha = .35; ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff'; ctx.font = '8px monospace'; ctx.textAlign = 'center';
      ctx.fillText(pu.name.slice(0, 8).toUpperCase(), pu.x, pu.y - 18);
    }
    for (const ru of this.runes) {
      const s = 13 + Math.sin(this.time * 4 + ru.x) * 1.5;
      ctx.save();
      ctx.translate(ru.x, ru.y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = ru.col; ctx.globalAlpha = .9;
      ctx.beginPath(); ctx.rect(-s, -s, s * 2, s * 2); ctx.fill();
      ctx.rotate(-Math.PI / 4);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.strokeRect(-s + 3, -s + 3, s * 2 - 6, s * 2 - 6);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center';
      ctx.fillText(RUNE_BY_ID[ru.type].name.slice(6, 7), 0, 4);
      ctx.restore();
    }
    for (const pd of this.petDrops) {
      const s = 12 + Math.sin(this.time * 3 + pd.x) * 1.5;
      ctx.save();
      ctx.translate(pd.x, pd.y + Math.sin(this.time * 5) * 3);
      ctx.fillStyle = pd.col; ctx.globalAlpha = .95;
      ctx.beginPath(); ctx.ellipse(0, 0, s, s * .9, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#222';
      ctx.beginPath(); ctx.arc(-s * .4, -s * .3, 2, 0, TAU); ctx.arc(s * .4, -s * .3, 2, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff'; ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center';
      ctx.fillText('BEGLEITER', 0, -s - 6);
      ctx.restore();
    }
    for (const p of this.players) for (const t of p.turrets) t.draw(ctx);
    for (const e of this.enemies) {
      if (!e.boss && (Math.abs(e.x - this.cam.x) > pvw + e.r + 40 || Math.abs(e.y - this.cam.y) > pvh + e.r + 40)) continue;
      e.draw(ctx);
    }
    for (const p of Projectiles.active) {
      ctx.fillStyle = p.col;
      ctx.globalAlpha = .95;
      if (p.shape === 'advice') {
        const s = p.size || 11;
        const w = Math.max(s * 1.9, (p.word || '').length * 3.6 + 7), h = s * 1.05;
        ctx.save();
        ctx.translate(p.x, p.y + Math.sin(p.rot * 2.2) * 1.4);
        ctx.rotate(Math.sin(p.rot) * .09);
        if (this.quality() >= 1) {
          ctx.globalAlpha = .22; ctx.fillStyle = p.col;
          ctx.beginPath(); ctx.arc(0, 0, w * .62, 0, TAU); ctx.fill();
        }
        ctx.globalAlpha = .95; ctx.fillStyle = p.col;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(-w / 2, -h / 2, w, h, 3.2); else ctx.rect(-w / 2, -h / 2, w, h);
        ctx.fill();
        ctx.beginPath(); ctx.moveTo(-3, h / 2 - .6); ctx.lineTo(-.4, h / 2 + 4.2); ctx.lineTo(2.6, h / 2 - .6); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(18,12,4,.55)'; ctx.lineWidth = 1;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(-w / 2, -h / 2, w, h, 3.2); else ctx.rect(-w / 2, -h / 2, w, h);
        ctx.stroke();
        if (p.word) {
          ctx.fillStyle = 'rgba(22,16,6,.92)';
          ctx.font = 'bold 6px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(p.word, 0, .3);
          ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
        }
        ctx.restore();
      } else if (p.shape === 'note') {
        const s = p.size || 9;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        if (this.quality() >= 1) {
          ctx.globalAlpha = .3;
          ctx.beginPath(); ctx.arc(0, 0, s * 1.25, 0, TAU); ctx.fill();
          ctx.globalAlpha = .95;
        }
        ctx.beginPath(); ctx.ellipse(-s * .55, s * .6, s * .5, s * .38, 0, 0, TAU); ctx.fill();
        ctx.fillRect(-s * .24, -s * 1.1, s * .3, s * 1.72);
        ctx.fillRect(s * .06, -s * 1.1, s * .62, s * .28);
        ctx.beginPath(); ctx.arc(s * .06, -s * 1.1, s * .22, 0, TAU); ctx.fill();
        ctx.restore();
      } else {
        /* ---- Projektil-Erscheinung je Waffentyp (pixelig, mit Kern & Korona) ---- */
        const F = projFx(p.source);
        const ang = Math.atan2(p.vy, p.vx);
        const hi = OPT().highContrast;
        const qual = this.quality();
        const puls = F.pulse ? .82 + .18 * Math.sin(p.pulse || 0) : 1;
        ctx.save();
        ctx.translate(p.x, p.y);
        if (qual >= 1 && F.glow) {
          ctx.globalAlpha = .15 * F.glow * puls;
          ctx.fillStyle = p.col;
          ctx.beginPath(); ctx.arc(0, 0, p.r * (2.0 + (F.glow || 0) * .8) * puls, 0, TAU); ctx.fill();
        }
        /* ---- Geschwindigkeits-Schweif: additiver Kometenstrich hinter jedem
           Projektil, weiss-heiss am Kopf, zur Farbe hin auslaufend. Skaliert mit
           dem Tempo - langsame Wuerfe (Kiste, Klecks) bekommen ihn kaum, schnelle
           Runden einen kraeftigen Zug. Liegt unter der scharfen Form. ---- */
        if (qual >= 1) {
          const sp = Math.hypot(p.vx, p.vy);
          const sf = clamp((sp - 220) / 680, 0, 1);
          if (sf > .04) {
            ctx.save();
            ctx.rotate(ang);
            ctx.globalCompositeOperation = 'lighter';
            const La = 6 + p.r * 1.2 + sf * (24 + (F.len || 8) * .55);
            const seg = 4;
            for (let i = 0; i < seg; i++) {
              const f0 = i / seg, f1 = (i + 1) / seg;
              ctx.globalAlpha = (.14 + .22 * (F.glow || .5)) * (1 - f0) * sf * puls;
              ctx.fillStyle = i === 0 ? '#fff6e0' : p.col;
              const h = p.r * (1.05 - f0 * .72);
              ctx.fillRect(-La * f1, -h, La * (f1 - f0) + .7, h * 2);
            }
            ctx.restore();
          }
        }
        ctx.globalAlpha = .97;
        ctx.fillStyle = p.col;
        switch (F.style) {
          case 'bullet': case 'pellet': {
            ctx.rotate(ang);
            const L = (F.len || 8) * (F.style === 'pellet' ? .7 : 1), H = Math.max(2, p.r * .9);
            ctx.fillStyle = shade(p.col, -.25);
            ctx.fillRect(-L * .7, -H / 2, L * .7, H);
            ctx.fillStyle = p.col;
            ctx.fillRect(-L * .15, -H / 2, L * .5, H);
            ctx.fillStyle = '#fff6d0';
            ctx.fillRect(L * .28, -H * .3, L * .26, H * .6);
            break;
          }
          case 'tracer': {
            ctx.rotate(ang);
            const L = F.len || 20;
            ctx.globalAlpha = .20; ctx.fillStyle = p.col;
            ctx.fillRect(-L, -1, L, 2);
            ctx.globalAlpha = .85; ctx.fillStyle = '#fff6c8';
            ctx.fillRect(-L * .3, -1.4, L * .45, 2.8);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(L * .1, -1.8, 4, 3.6);
            break;
          }
          case 'needle': {
            ctx.rotate(ang);
            const L = F.len || 12;
            ctx.fillStyle = shade(p.col, .3);
            ctx.beginPath(); ctx.moveTo(L * .5, 0); ctx.lineTo(-L * .5, -1.6); ctx.lineTo(-L * .5, 1.6); ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#ffffff'; ctx.fillRect(L * .2, -.6, L * .3, 1.2);
            break;
          }
          case 'lance': {
            ctx.rotate(ang);
            const L = F.len || 14;
            ctx.globalAlpha = .5; ctx.fillStyle = p.col;
            ctx.fillRect(-L * .8, -p.r * .8, L * 1.4, p.r * 1.6);
            ctx.globalAlpha = .98; ctx.fillStyle = '#ffffff';
            ctx.fillRect(-L * .35, -p.r * .32, L * .9, p.r * .64);
            for (let i = 0; i < 3; i++) {
              const o = (i - 1) * p.r * .9;
              ctx.fillStyle = p.col;
              ctx.fillRect(L * .45 + Math.abs(o) * .4, o - .7, 2, 1.4);
            }
            break;
          }
          case 'orb': {
            const r = p.r * puls;
            ctx.fillStyle = p.col;
            ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.beginPath(); ctx.arc(0, 0, r * .45, 0, TAU); ctx.fill();
            if (qual >= 1) {
              ctx.globalAlpha = .55;
              for (let i = 0; i < 4; i++) {
                const a2 = (p.rot || 0) * 1.6 + i * TAU / 4;
                ctx.fillStyle = p.col;
                ctx.fillRect(Math.cos(a2) * r * 1.7 - 1, Math.sin(a2) * r * 1.7 - 1, 2, 2);
              }
            }
            break;
          }
          case 'crystal': {
            ctx.rotate(p.rot || 0);
            const r = p.r * 1.25;
            ctx.fillStyle = p.col;
            ctx.beginPath();
            ctx.moveTo(0, -r); ctx.lineTo(r * .55, 0); ctx.lineTo(0, r); ctx.lineTo(-r * .55, 0);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,.85)';
            ctx.fillRect(-.8, -r * .6, 1.6, r * 1.2);
            break;
          }
          case 'blob': {
            const r = p.r * (1 + .12 * Math.sin((p.wobT || 0) * 2));
            ctx.fillStyle = p.col;
            ctx.beginPath(); ctx.ellipse(0, 0, r * 1.15, r * .85, p.rot || 0, 0, TAU); ctx.fill();
            ctx.fillStyle = shade(p.col, -.3);
            ctx.beginPath(); ctx.arc(r * .3, -r * .2, r * .35, 0, TAU); ctx.fill();
            ctx.fillStyle = shade(p.col, .35);
            ctx.beginPath(); ctx.arc(-r * .35, r * .25, r * .25, 0, TAU); ctx.fill();
            break;
          }
          case 'saw': {
            ctx.rotate(p.rot || 0);
            const r = p.r * 1.3;
            ctx.fillStyle = p.col;
            ctx.beginPath();
            for (let i = 0; i < 8; i++) {
              const a2 = i / 8 * TAU, rr = i % 2 ? r * .58 : r;
              i ? ctx.lineTo(Math.cos(a2) * rr, Math.sin(a2) * rr) : ctx.moveTo(Math.cos(a2) * rr, Math.sin(a2) * rr);
            }
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#2a2f3d';
            ctx.beginPath(); ctx.arc(0, 0, r * .3, 0, TAU); ctx.fill();
            break;
          }
          case 'star': {
            ctx.rotate(p.rot || 0);
            const r = p.r * 1.5;
            ctx.fillStyle = p.col;
            ctx.beginPath();
            for (let i = 0; i < 8; i++) {
              const a2 = i / 8 * TAU, rr = i % 2 ? r * .38 : r;
              i ? ctx.lineTo(Math.cos(a2) * rr, Math.sin(a2) * rr) : ctx.moveTo(Math.cos(a2) * rr, Math.sin(a2) * rr);
            }
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(-1, -1, 2, 2);
            break;
          }
          case 'void': {
            const r = p.r * 1.2;
            ctx.fillStyle = '#0a0713';
            ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
            ctx.strokeStyle = p.col; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(0, 0, r * (1.25 + .12 * Math.sin((p.rot || 0) * 3)), 0, TAU); ctx.stroke();
            ctx.globalAlpha = .6;
            for (let i = 0; i < 5; i++) {
              const a2 = (p.rot || 0) * 2 + i * TAU / 5;
              ctx.fillStyle = p.col;
              ctx.fillRect(Math.cos(a2) * r * 1.7 - 1, Math.sin(a2) * r * 1.7 - 1, 2, 2);
            }
            break;
          }
          case 'crate': {
            ctx.rotate(p.rot || 0);
            const r = p.r * 1.4;
            ctx.fillStyle = '#8a5f34'; ctx.fillRect(-r, -r * .8, r * 2, r * 1.6);
            ctx.fillStyle = '#e0a83a';
            for (let i = 0; i < 3; i++) ctx.fillRect(-r + 1.4 + i * (r * .62), -r * .55, r * .34, r * 1.1);
            ctx.fillStyle = '#5c3f22'; ctx.fillRect(-r, -r * .12, r * 2, r * .24);
            break;
          }
          case 'mine': {
            ctx.rotate(p.rot || 0);
            const r = p.r * 1.1;
            ctx.fillStyle = '#3a2118';
            ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
            ctx.fillStyle = p.col;
            for (let i = 0; i < 4; i++) {
              const a2 = i / 4 * TAU;
              ctx.fillRect(Math.cos(a2) * r * 1.25 - 1.4, Math.sin(a2) * r * 1.25 - 1.4, 2.8, 2.8);
            }
            ctx.fillStyle = '#ffdf9a';
            ctx.beginPath(); ctx.arc(0, 0, r * .38, 0, TAU); ctx.fill();
            break;
          }
          case 'bird': {
            ctx.rotate(ang);
            const r = p.r * 1.2;
            const flap = Math.sin((p.wobT || 0) * 3) * .7;
            ctx.fillStyle = p.col;
            ctx.beginPath();
            ctx.moveTo(r * 1.2, 0);
            ctx.lineTo(-r * .3, -r * .5); ctx.lineTo(-r * .9, 0); ctx.lineTo(-r * .3, r * .5);
            ctx.closePath(); ctx.fill();
            ctx.strokeStyle = shade(p.col, -.25); ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(-r * .1, 0); ctx.lineTo(-r * .6, -r * (1.1 + flap));
            ctx.moveTo(-r * .1, 0); ctx.lineTo(-r * .6, r * (1.1 - flap));
            ctx.stroke();
            ctx.fillStyle = '#ffcf4a';
            ctx.fillRect(r * .9, -.6, 2, 1.2);
            break;
          }
          case 'droplet': {
            ctx.rotate(ang);
            ctx.fillStyle = p.col;
            ctx.beginPath();
            ctx.moveTo(p.r * 1.5, 0);
            ctx.quadraticCurveTo(0, -p.r, -p.r, 0);
            ctx.quadraticCurveTo(0, p.r, p.r * 1.5, 0);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,.7)';
            ctx.fillRect(-p.r * .2, -p.r * .35, p.r * .5, p.r * .3);
            break;
          }
          default:
            ctx.fillStyle = p.col;
            ctx.beginPath(); ctx.arc(0, 0, p.r, 0, TAU); ctx.fill();
        }
        if (hi) {
          ctx.globalAlpha = 1; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(0, 0, p.r + 1.4, 0, TAU); ctx.stroke();
        }
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
    for (const b of EnemyBullets.active) {
      /* Culling: Kugeln außerhalb des Sichtbereichs nicht zeichnen (wie bei Gegnern) */
      if (Math.abs(b.x - this.cam.x) > pvw + b.r || Math.abs(b.y - this.cam.y) > pvh + b.r) continue;
      const ba = Math.atan2(b.vy, b.vx);
      ctx.save(); ctx.translate(b.x, b.y);
      if (this.quality() >= 1) {
        ctx.globalAlpha = .3; ctx.fillStyle = b.col;
        ctx.beginPath(); ctx.arc(0, 0, b.r * 2.4, 0, TAU); ctx.fill();
        /* Tempo-Schweif auch fuer Gegnerkugeln, dezenter als bei Spielerschuessen */
        const sp = Math.hypot(b.vx, b.vy), sf = clamp((sp - 160) / 520, 0, 1);
        if (sf > .05) {
          ctx.save(); ctx.rotate(ba); ctx.globalCompositeOperation = 'lighter';
          const La = b.r * 1.4 + sf * 16;
          for (let i = 0; i < 3; i++) {
            const f0 = i / 3, f1 = (i + 1) / 3;
            ctx.globalAlpha = .22 * (1 - f0) * sf;
            ctx.fillStyle = i === 0 ? '#ffffff' : b.col;
            const h = b.r * (.9 - f0 * .55);
            ctx.fillRect(-La * f1, -h, La * (f1 - f0) + .6, h * 2);
          }
          ctx.restore();
        }
      }
      ctx.globalAlpha = .95; ctx.fillStyle = b.col;
      ctx.rotate(ba);
      ctx.beginPath(); ctx.ellipse(0, 0, b.r * 1.35, b.r * .8, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.globalAlpha = .8;
      ctx.fillRect(b.r * .2, -b.r * .22, b.r * .7, b.r * .44);
      if (OPT().highContrast) { ctx.globalAlpha = 1; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(0, 0, b.r + 1.2, 0, TAU); ctx.stroke(); }
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    this.drawShadows(ctx);
    this.drawArenaMod(ctx);
    this.drawHazObjs(ctx);
    FX.draw(ctx);
    for (const p of this.players) p.draw(ctx);
    FX.drawHazes(ctx);
    FX.drawLights(ctx);
    FX.drawNumbers(ctx);
    ctx.restore();
    if (this.quality() >= 1) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const p of this.players) {
        if (!p.alive) continue;
        const sxp = p.x - this.cam.x, syp = p.y - this.cam.y;
        const sx = (sxp) * this.cam.zoom + this.W / 2 + this.cam.sx, sy = (syp) * this.cam.zoom + this.H / 2 + this.cam.sy;
        const g = ctx.createRadialGradient(sx, sy, 30, sx, sy, 300);
        g.addColorStop(0, 'rgba(244,194,90,.12)'); g.addColorStop(1, 'rgba(244,194,90,0)');
        ctx.fillStyle = g; ctx.fillRect(sx - 300, sy - 300, 600, 600);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
    }
    this.drawArenaModOverlay(ctx);
    if (this.modActive('dunkelheit')) {
      const g = ctx.createRadialGradient(this.W / 2, this.H / 2, this.H * .22, this.W / 2, this.H / 2, this.H * .75);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.78)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, this.W, this.H);
    }
    this.drawSplats(ctx);
    this.drawBossIntro(ctx);
    if (this.perfectFlash > 0) { ctx.save(); ctx.globalAlpha = this.perfectFlash * .35; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, this.W, this.H); ctx.restore(); }
    this.renderScreenAid(ctx);
    if (OPT().minimap) this.renderMinimap(ctx);
  },
  renderMinimap(ctx) {
    const L = this.level, mw = 150, mh = mw * (L.h / L.w);
    const x0 = this.W - mw - 12, y0 = this.H - mh - 12;
    ctx.globalAlpha = .78;
    ctx.fillStyle = '#070a12'; ctx.fillRect(x0, y0, mw, mh);
    ctx.strokeStyle = '#25406b'; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, mw, mh);
    ctx.fillStyle = '#dbe6ff'; ctx.font = '9px monospace'; ctx.textAlign = 'left';
    ctx.fillText(L.a.name.toUpperCase(), x0 + 4, y0 + 10);
    ctx.fillStyle = 'rgba(219,230,255,.4)'; ctx.font = '8px monospace';
    ctx.fillText('W' + Game.wave + (Game.mods.length ? ' · ' + Game.mods[0].name : ''), x0 + 4, y0 + 20);
    const sx = mw / L.w, sy = mh / L.h;
    ctx.fillStyle = '#25406b';
    for (const r of L.allWalls()) ctx.fillRect(x0 + r.x * sx, y0 + r.y * sy, r.w * sx, r.h * sy);
    /* Gegner nach Art eingefärbt, Elite und Boss hervorgehoben */
    for (const e of this.enemies) {
      if (e.dead) continue;
      const mx = x0 + e.x * sx, my = y0 + e.y * sy;
      if (e.boss) {
        ctx.fillStyle = e.col;
        ctx.fillRect(mx - 3, my - 3, 6, 6);
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
        ctx.strokeRect(mx - 4, my - 4, 8, 8);
      } else if (e.charmT > 0) { ctx.fillStyle = '#ffd24a'; ctx.fillRect(mx - 1.5, my - 1.5, 3, 3); }
      else if (e.elite) { ctx.fillStyle = '#c7a6ff'; ctx.fillRect(mx - 2, my - 2, 4, 4); }
      else { ctx.fillStyle = e.col; ctx.fillRect(mx - 1, my - 1, 2, 2); }
    }
    /* Fässer und Gefahrenobjekte auf der Karte */
    ctx.fillStyle = '#ff8a3d';
    if (L.barrels) for (const b of L.barrels) if (!b.dead) ctx.fillRect(x0 + b.x * sx - 1, y0 + b.y * sy - 1, 2, 2);
    for (const p of this.players) {
      if (!p.alive) continue;
      ctx.fillStyle = p.index === 0 ? '#f4c25a' : '#39e6ff';
      ctx.fillRect(x0 + p.x * sx - 2, y0 + p.y * sy - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
    /* Bosspfeil am Bildschirmrand, wenn der Boss außerhalb der Sicht ist */
    const boss = this.enemies.find(e => !e.dead && e.boss);
    if (boss) {
      const bx = (boss.x - this.cam.x) * this.cam.zoom + this.W / 2 + this.cam.sx;
      const by = (boss.y - this.cam.y) * this.cam.zoom + this.H / 2 + this.cam.sy;
      const m = 46;
      if (bx < m || bx > this.W - m || by < m || by > this.H - m) {
        const a = Math.atan2(by - this.H / 2, bx - this.W / 2);
        const px = this.W / 2 + Math.cos(a) * (Math.min(this.W, this.H) / 2 - m);
        const py = this.H / 2 + Math.sin(a) * (Math.min(this.W, this.H) / 2 - m);
        ctx.save();
        ctx.translate(px, py); ctx.rotate(a);
        ctx.globalAlpha = .55 + .35 * Math.sin(this.time * 6);
        ctx.fillStyle = boss.col;
        ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-10, -11); ctx.lineTo(-4, 0); ctx.lineTo(-10, 11); ctx.closePath(); ctx.fill();
        ctx.restore();
        ctx.globalAlpha = 1;
      }
    }
  },
  /* ---- Bildschirmkanten-Spritzer bei Nahtreffern ---- */
  splats: [],
  addSplat(ang, amount, who) {
    if (OPT().splatter === false || this.quality() < 1) return;
    const n = Math.round(3 + amount * 9);
    for (let i = 0; i < n; i++) {
      const a = ang + rnd(-.9, .9);
      const edge = .5 + Math.random() * .55;
      this.splats.push({
        x: .5 + Math.cos(a) * edge, y: .5 + Math.sin(a) * edge,
        r: rnd(6, 26) * (.6 + amount), a: rnd(TAU),
        life: rnd(2.2, 4.5), max: 4.5, drip: rnd(6, 26), who: who || 0
      });
    }
    if (this.splats.length > 90) this.splats.splice(0, this.splats.length - 90);
  },
  updateSplats(dt) {
    for (let i = this.splats.length - 1; i >= 0; i--) {
      const s = this.splats[i];
      s.life -= dt;
      s.y += dt * .004 * s.drip / Math.max(1, s.r);
      if (s.life <= 0) this.splats.splice(i, 1);
    }
  },
  drawSplats(ctx) {
    if (!this.splats.length) return;
    ctx.save();
    for (const s of this.splats) {
      const f = clamp(s.life / s.max, 0, 1);
      const px = s.x * this.W, py = s.y * this.H;
      ctx.globalAlpha = .55 * f;
      ctx.fillStyle = s.who === 1 ? '#5a1030' : '#6e0f18';
      ctx.beginPath(); ctx.ellipse(px, py, s.r, s.r * .72, s.a, 0, TAU); ctx.fill();
      ctx.globalAlpha = .35 * f;
      ctx.beginPath(); ctx.ellipse(px + s.r * .3, py + s.r * .55, s.r * .3, s.r * .5, s.a, 0, TAU); ctx.fill();
      ctx.globalAlpha = .22 * f;
      ctx.fillStyle = '#2a0409';
      ctx.beginPath(); ctx.ellipse(px, py, s.r * .55, s.r * .4, s.a, 0, TAU); ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  },
  renderScreenAid(ctx) {
    const hw = this.W / 2, hh = this.H / 2;
    const cx = this.cam.x, cy = this.cam.y, z = this.cam.zoom;
    const vw = hw / z, vh = hh / z;
    const cands = [];
    let boss = null;
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (e.boss) { boss = e; continue; }
      const dx = e.x - cx, dy = e.y - cy;
      if (Math.abs(dx) > vw + 20 || Math.abs(dy) > vh + 20) cands.push({ e, d: dx * dx + dy * dy });
    }
    cands.sort((a, b) => a.d - b.d);
    const drawArrow = (e, col) => {
      const dx = e.x - cx, dy = e.y - cy;
      let sx = dx * z + hw + this.cam.sx, sy = dy * z + hh + this.cam.sy;
      if (sx > -14 && sx < this.W + 14 && sy > -14 && sy < this.H + 14) return;
      const a = Math.atan2(sy - hh, sx - hw);
      const rr = Math.min(hw, hh) * .44;
      let px = hw + Math.cos(a) * rr, py = hh + Math.sin(a) * rr;
      px = clamp(px, 26, this.W - 26); py = clamp(py, 26, this.H - 26);
      ctx.save(); ctx.translate(px, py); ctx.rotate(a);
      ctx.fillStyle = col; ctx.globalAlpha = .92;
      ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-5, -6.5); ctx.lineTo(-5, 6.5); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1; ctx.restore();
    };
    for (let i = 0; i < Math.min(3, cands.length); i++) drawArrow(cands[i].e, '#ff5d6e');
    if (boss) drawArrow(boss, '#ff2e88');
    if (boss) {
      const bw = Math.min(620, this.W * .62);
      const bx = hw - bw / 2, by = 30;
      const frac = clamp(boss.hp / boss.maxHp, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(bx - 4, by - 4, bw + 8, 22);
      const g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      g.addColorStop(0, boss.col); g.addColorStop(1, boss.col);
      ctx.fillStyle = g; ctx.fillRect(bx, by, bw * frac, 14);
      ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.fillRect(bx + bw * frac, by, 2, 14);
      ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 1; ctx.strokeRect(bx, by, bw, 14);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'left';
      const tag = boss.boss.name + (boss.bossVariant ? ' · ' + (boss.bossVariant === 'wut' ? 'WUT' : 'GEIFER') : '');
      ctx.fillText(tag, bx, by - 7);
    }
  },
  /* Der Held im Titelbild: nearest-neighbour vergroessert, damit die
     Pixel Pixel bleiben. Groesse und Lage haengen am Schriftzug, damit
     es auf jeder Bildschirmgroesse zusammenpasst. */
  renderTitleBg(ctx) {
    const t = performance.now() / 1000;
    const g = ctx.createLinearGradient(0, 0, 0, this.H);
    g.addColorStop(0, '#0a1024'); g.addColorStop(.55, '#131b33'); g.addColorStop(1, '#1b1026');
    ctx.fillStyle = g; ctx.fillRect(0, 0, this.W, this.H);
    for (let i = 0; i < 90; i++) {
      const x = (i * 137.5) % this.W, y = (i * 71.3) % (this.H * .6);
      ctx.globalAlpha = .25 + .25 * Math.sin(t * 2 + i);
      ctx.fillStyle = '#dbe6ff'; ctx.fillRect(x, y, 2, 2);
    }
    ctx.globalAlpha = 1;
    const baseY = this.H * .82;
    for (let layer = 0; layer < 3; layer++) {
      const off = t * (6 + layer * 5) % 220;
      ctx.fillStyle = ['#141d33', '#101728', '#0b1020'][layer];
      for (let i = -1; i < this.W / 110 + 2; i++) {
        const x = i * 110 - off + layer * 30;
        const h = 60 + ((i * 37 + layer * 13) % 9) * 22;
        ctx.fillRect(x, baseY - h + layer * 26, 92, h + 200);
        ctx.fillStyle = 'rgba(244,194,90,.12)';
        for (let wy = baseY - h + layer * 26 + 10; wy < baseY + layer * 26; wy += 22)
          for (let wx = x + 8; wx < x + 84; wx += 20)
            if ((wx * wy + layer) % 5 < 2) ctx.fillRect(wx, wy, 8, 10);
        ctx.fillStyle = ['#141d33', '#101728', '#0b1020'][layer];
      }
    }
    for (let l = 0; l < 3; l++) {
      const off = t * (14 + l * 9) % (this.W + 300);
      ctx.fillStyle = 'rgba(160,210,255,' + (.03 + l * .015) + ')';
      for (let i = -1; i < this.W / 200 + 2; i++) {
        const x = i * 200 - off + l * 40;
        ctx.beginPath(); ctx.ellipse(x, this.H * (.5 + l * .13), 90 + l * 22, 26 + l * 6, 0, 0, TAU); ctx.fill();
      }
    }
    ctx.strokeStyle = 'rgba(255,46,136,.5)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, baseY + 78); ctx.lineTo(this.W, baseY + 78); ctx.stroke();
    /* Die Figur steht jetzt als DOM-Element neben dem Schriftzug — auf der
       Leinwand waere sie hinter der fast deckenden Menueflaeche unsichtbar. */
  }
};

/* ============================ 22. PARAMETER-WERKSTATT ============================
   Ein Editor fuer alle Waffen- und Gegnerwerte zur Laufzeit: Reichweite,
   Streuung, Farbe, Bauart, Verhalten, Schaden, Tempo, Sonderwirkungen.

   Aufbau:
   - TUNE.base   unveraenderte Kopie aller Daten, beim Start gezogen.
   - TUNE.over   nur die Abweichungen, als Pfad -> Wert. Wird im
                 Spielstand gesichert und beim Laden wieder aufgelegt.
   - Aenderungen greifen sofort: Waffenwerte werden bei jedem Schuss aus
     der Tabelle gelesen, Gegnerwerte beim Erscheinen.
   ================================================================================ */
const TUNE = {
  base: null, over: {}, tab: 'weapons', sel: null, filter: '',

  /* Tier-Arrays sind positionell — hier bekommen sie Namen. */
  TIER_FIELDS: [
    ['dmg', 'Schaden', 0, 400, .1],
    ['as', 'Nachladezeit (s)', .02, 4, .01],
    ['range', 'Reichweite', 20, 1400, 5],
    ['critC', 'Kritchance (0-1)', 0, 1, .01],
    ['critM', 'Kritfaktor', 1, 6, .05],
    ['price', 'Preis', 1, 900, 1]
  ],
  /* Sonderwirkungen im 7. Feld eines Tiers. Nur was hier steht, wird als
     Regler angeboten; unbekannte Schluessel erscheinen trotzdem als Zahl. */
  X_FIELDS: {
    cone: ['Kegelbreite (rad)', 0, 3.2, .01], spread: ['Streuung (rad)', 0, 1.6, .005],
    pellets: ['Projektile', 1, 24, 1], pierce: ['Durchschlag', 0, 12, 1],
    bounce: ['Abpraller', 0, 8, 1], boom: ['Explosionsradius', 0, 320, 2],
    burn: ['Brand', 0, 80, 1], slow: ['Verlangsamung', 0, 1, .02],
    slowT: ['Verlangsamung (s)', 0, 8, .1], poison: ['Gift', 0, 80, 1],
    poisonT: ['Gift (s)', 0, 12, .1], homing: ['Zielsuche', 0, 12, .1],
    stick: ['Haftet (s)', 0, 8, .1], armorPierce: ['Ruestungsbruch', 0, 1, .02],
    lifesteal: ['Lebensraub', 0, 1, .01], healHit: ['Heilung je Treffer', 0, 40, .5],
    chargeMax: ['Aufladung max', 1, 8, .1], chargeT: ['Ladezeit (s)', .1, 5, .05],
    perHit: ['Zuwachs je Treffer', 0, 2, .01], expSize: ['Explosionsgroesse', 0, 3, .05],
    elemental: ['Elementar (0/1)', 0, 1, 1], arcRain: ['Sternenregen', 0, 1, 1],
    advice: ['Ratschlag (0/1)', 0, 1, 1], cloud: ['Wolke', 0, 1, 1],
    pull: ['Sog', 0, 400, 5]
  },
  ENEMY_FIELDS: [
    ['hp', 'Leben', 1, 400, 1], ['dmg', 'Schaden', 0, 120, .5],
    ['spd', 'Tempo', 0, 400, 2], ['r', 'Radius', 4, 60, 1],
    ['armor', 'Ruestung', 0, 40, 1], ['xp', 'Erfahrung', 0, 60, 1],
    ['mat', 'Material', 0, 40, 1], ['minW', 'Ab Welle', 1, 20, 1],
    ['w', 'Haeufigkeit', 0, 60, 1]
  ],
  BOSS_FIELDS: [
    ['hp', 'Leben', 50, 20000, 10], ['dmg', 'Schaden', 0, 200, 1],
    ['spd', 'Tempo', 0, 300, 2], ['r', 'Radius', 10, 140, 1],
    ['armor', 'Ruestung', 0, 60, 1], ['xp', 'Erfahrung', 0, 400, 5],
    ['mat', 'Material', 0, 300, 5]
  ],
  NEST_FIELDS: {
    shot: [['dmg', 'Schaden', 0, 120, .5], ['spd', 'Geschosstempo', 20, 800, 5], ['cd', 'Takt (s)', .1, 8, .05], ['range', 'Reichweite', 40, 1200, 10], ['poison', 'Gift', 0, 60, 1]],
    boom: [['dmg', 'Schaden', 0, 200, 1], ['r', 'Radius', 10, 400, 5]],
    heal: [['amt', 'Heilung', 0, 80, 1], ['cd', 'Takt (s)', .2, 8, .05], ['r', 'Radius', 20, 500, 5]],
    aura: [['armor', 'Ruestung', 0, 40, 1], ['r', 'Radius', 20, 500, 5]],
    summon: [['n', 'Anzahl', 1, 10, 1], ['cd', 'Takt (s)', .5, 15, .1]]
  },
  AI_LIST: ['chase', 'orbit', 'ranged', 'exploder', 'charger', 'healer', 'aura', 'summoner', 'blinker', 'latcher', 'splitter', 'sniper', 'swarmer'],
  SHAPE_LIST: ['tri', 'box', 'dot', 'diamond', 'hex', 'cross', 'star', 'blob', 'crab', 'ghost'],
  TYPE_LIST: ['projectile', 'hitscan', 'cone', 'melee', 'charge', 'orbit', 'aura', 'summon'],

  /* ---- Grunddaten einmalig sichern ---- */
  init() {
    if (this.base) return;
    const clone = o => JSON.parse(JSON.stringify(o));
    this.base = {
      weapons: clone(WEAPONS.map(w => ({ id: w.id, col: w.col, type: w.type, cls: w.cls, tiers: w.tiers, scaling: w.scaling }))),
      enemies: clone(ENEMIES.map(e => ({ id: e.id, col: e.col, ai: e.ai, shape: e.shape, hp: e.hp, dmg: e.dmg, spd: e.spd, r: e.r, armor: e.armor || 0, xp: e.xp, mat: e.mat, minW: e.minW, w: e.w, fly: !!e.fly, shot: e.shot, boom: e.boom, heal: e.heal, aura: e.aura, summon: e.summon }))),
      bosses: clone(BOSSES.map(b => ({ id: b.id, col: b.col, hp: b.hp, dmg: b.dmg, spd: b.spd, r: b.r, armor: b.armor || 0, xp: b.xp, mat: b.mat })))
    };
    this.over = (Save.data && Save.data.tuning) || {};
    this.applyAll();
  },
  target(kind, id) {
    return kind === 'weapons' ? WEAPON_BY_ID[id] : kind === 'enemies' ? ENEMY_BY_ID[id] : BOSSES.find(b => b.id === id);
  },
  list(kind) { return kind === 'weapons' ? WEAPONS : kind === 'enemies' ? ENEMIES : BOSSES; },
  key(kind, id, path) { return kind + '/' + id + '/' + path; },

  /* Pfad in ein Objekt schreiben: 'tiers.2.0' oder 'shot.dmg' */
  poke(obj, path, val) {
    const p = path.split('.');
    let o = obj;
    for (let i = 0; i < p.length - 1; i++) {
      const k = /^\d+$/.test(p[i]) ? +p[i] : p[i];
      if (o[k] == null) o[k] = /^\d+$/.test(p[i + 1]) ? [] : {};
      o = o[k];
    }
    const last = /^\d+$/.test(p[p.length - 1]) ? +p[p.length - 1] : p[p.length - 1];
    o[last] = val;
  },
  peek(obj, path) {
    const p = path.split('.');
    let o = obj;
    for (const k of p) { if (o == null) return undefined; o = o[/^\d+$/.test(k) ? +k : k]; }
    return o;
  },
  baseOf(kind, id) { return this.base[kind].find(x => x.id === id); },

  set(kind, id, path, val) {
    const t = this.target(kind, id);
    if (!t) return;
    this.poke(t, path, val);
    const b = this.baseOf(kind, id);
    const orig = b ? this.peek(b, path) : undefined;
    const k = this.key(kind, id, path);
    if (orig !== undefined && orig === val) delete this.over[k];
    else this.over[k] = val;
    Save.data.tuning = this.over;
    Save.save();
    /* Waffenwerte wirken sofort — die Spieler rechnen ihre Werte neu. */
    if (Game.players) for (const p of Game.players) { try { p.recalc(); } catch (e) { } }
  },
  applyAll() {
    for (const k in this.over) {
      const i = k.indexOf('/'), j = k.indexOf('/', i + 1);
      const kind = k.slice(0, i), id = k.slice(i + 1, j), path = k.slice(j + 1);
      const t = this.target(kind, id);
      if (t) this.poke(t, path, this.over[k]);
    }
  },
  resetOne(kind, id) {
    const b = this.baseOf(kind, id), t = this.target(kind, id);
    if (!b || !t) return;
    for (const k in this.over) if (k.indexOf(kind + '/' + id + '/') === 0) delete this.over[k];
    for (const f in b) if (f !== 'id') t[f] = JSON.parse(JSON.stringify(b[f]));
    Save.data.tuning = this.over; Save.save();
    if (Game.players) for (const p of Game.players) { try { p.recalc(); } catch (e) { } }
  },
  resetAll() {
    this.over = {};
    for (const kind of ['weapons', 'enemies', 'bosses'])
      for (const b of this.base[kind]) {
        const t = this.target(kind, b.id);
        if (t) for (const f in b) if (f !== 'id') t[f] = JSON.parse(JSON.stringify(b[f]));
      }
    Save.data.tuning = {}; Save.save();
    if (Game.players) for (const p of Game.players) { try { p.recalc(); } catch (e) { } }
  },
  changedCount(kind, id) {
    let n = 0;
    const pre = kind + '/' + id + '/';
    for (const k in this.over) if (k.indexOf(pre) === 0) n++;
    return n;
  },
  exportJson() { return JSON.stringify(this.over, null, 1); },
  importJson(txt) {
    let o;
    try { o = JSON.parse(txt); } catch (e) { return 'Kein gueltiges JSON'; }
    if (!o || typeof o !== 'object') return 'Kein gueltiges JSON';
    this.resetAll();
    this.over = o;
    this.applyAll();
    Save.data.tuning = this.over; Save.save();
    return null;
  }
};

/* ============================ 21c. ONLINE-KOOP (LAN + INTERNET) ============================
   Remote-Play statt State-Sync: Der HOST simuliert und rendert wie bisher allein und
   streamt Canvas-Bild + Spielton per WebRTC an den GAST; zurueck kommen nur dessen
   Eingaben. Beide teilen die vorhandene Koop-Kamera - es gibt hier also keine Desyncs.

   Verbindung (zwei Wege, gleiche Peer-Logik, Non-Trickle-ICE):
     Raumcode - SDP-Austausch ueber einen oeffentlichen MQTT-Broker; nur der Handshake
                laeuft darueber, danach direkt P2P. Im LAN bleibt alles lokal.
     Offline  - Host-Code und Antwort-Code von Hand austauschen, ganz ohne Internet.

   Kanaele: 'ctl' zuverlaessig (Menues, Aktionen, HUD, Ping) und 'input' unzuverlaessig
   mit 30 Hz (Achsen). Ohne TURN koennen sehr strikte NATs im Internet scheitern.
   ========================================================================================= */
const NET_ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
const NET_BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];
const NET_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   /* ohne I/O/0/1 - vorlesbar */
const NET_HZ = 30;
const NET_NO_P2P = 'Direktverbindung kam nicht zustande - vermutlich blockt eine Firewall oder ein strenges NAT. '
  + 'Im selben WLAN klappt es fast immer; sonst den Offline-Weg nutzen.';

/* --- Minimaler MQTT-3.1.1-Draht (nur was der Handshake braucht) --- */
const MqttWire = {
  enc(s) { return new TextEncoder().encode(s); },
  varint(n) {
    const out = [];
    do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 128; out.push(b); } while (n > 0);
    return out;
  },
  readVarint(b, i) {
    let mult = 1, val = 0, byte, used = 0;
    do {
      if (i + used >= b.length || used > 3) return null;
      byte = b[i + used]; used++;
      val += (byte & 127) * mult; mult *= 128;
    } while (byte & 128);
    return { val: val, next: i + used };
  },
  str(s) { const b = this.enc(s); return [(b.length >> 8) & 255, b.length & 255].concat(Array.from(b)); },
  packet(type, flags, body) { return new Uint8Array([(type << 4) | flags].concat(this.varint(body.length), body)); },
  connect(id) { return this.packet(1, 0, this.str('MQTT').concat([4, 2, 0, 60], this.str(id))); },
  subscribe(topic) { return this.packet(8, 2, [0, 1].concat(this.str(topic), [0])); },
  publish(topic, payload) { return this.packet(3, 0, this.str(topic).concat(Array.from(this.enc(payload)))); },
  ping() { return new Uint8Array([0xC0, 0x00]); },
  /* Zerlegt einen Bytestrom in vollstaendige Pakete; ein angeschnittenes bleibt als Rest. */
  parse(buf) {
    const msgs = []; let i = 0;
    while (i < buf.length) {
      const type = buf[i] >> 4;
      const rl = this.readVarint(buf, i + 1);
      if (!rl || rl.next + rl.val > buf.length) break;
      const body = buf.subarray(rl.next, rl.next + rl.val);
      if (type === 3) {
        const tl = (body[0] << 8) | body[1];
        msgs.push({ type: type, payload: new TextDecoder().decode(body.subarray(2 + tl)) });
      } else msgs.push({ type: type });
      i = rl.next + rl.val;
    }
    return { msgs: msgs, rest: buf.subarray(i) };
  }
};

const Net = {
  role: null,             /* null | 'host' | 'client' */
  phase: 'idle',          /* idle | signaling | connecting | connected | closed | error */
  code: null,
  pc: null, ctl: null, inp: null,
  ws: null, wsBuf: null, wsIdx: 0, myId: null, peerId: null,
  audioDest: null,
  remote: { mx: 0, my: 0, ax: 0, ay: 0, aim: 0, sk: 0, t: 0 },
  acts: {},
  ping: 0, lastRx: 0,
  _inpAcc: 0, _pingAcc: 0, _lastMenu: '', _wd: 0, _ka: 0,
  status: 'Nicht verbunden',

  isHost() { return this.role === 'host' && this.phase === 'connected'; },
  isGuest() { return this.role === 'client' && this.phase === 'connected'; },

  roomCode() {
    const a = crypto.getRandomValues(new Uint8Array(6));
    let s = '';
    for (let i = 0; i < 6; i++) s += NET_ALPHABET[a[i] % NET_ALPHABET.length];
    return s;
  },
  normCode(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); },

  /* ---------- Code fuer den Offline-Weg: deflate + base64 ---------- */
  b64(u8) { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s).replace(/=+$/, ''); },
  unb64(s) {
    const bin = atob(s + '==='.slice(0, (4 - s.length % 4) % 4));
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  },
  async pack(sdp) {
    const cs = new CompressionStream('deflate-raw');
    const w = cs.writable.getWriter(); w.write(new TextEncoder().encode(sdp)); w.close();
    return this.b64(new Uint8Array(await new Response(cs.readable).arrayBuffer()));
  },
  async unpack(code) {
    const ds = new DecompressionStream('deflate-raw');
    const w = ds.writable.getWriter(); w.write(this.unb64(String(code).trim().replace(/\s+/g, ''))); w.close();
    return new TextDecoder().decode(new Uint8Array(await new Response(ds.readable).arrayBuffer()));
  },

  /* Wachhund: bleibt eine Phase haengen, wird sie abgeraeumt und begruendet. */
  arm(sec, why) { clearTimeout(this._wd); this._wd = setTimeout(() => this.fail(why), sec * 1000); },
  fail(why) { this.reset(); this.role = null; this.setStatus(why, 'error'); AudioSys.sfx('err'); },
  /* Fehler aus asynchronen Schritten sichtbar machen statt still verschlucken. */
  run(p, what) { p.catch(e => { this.setStatus(what + ': ' + e.message, 'error'); AudioSys.sfx('err'); }); },
  setStatus(msg, phase) {
    this.status = msg;
    if (phase) this.phase = phase;
    UI.renderNet();
  },

  /* ---------- Peer ---------- */
  makePeer() {
    const pc = new RTCPeerConnection({ iceServers: NET_ICE });
    this.pc = pc;
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'connected') this.onOpen();
      else if (s === 'failed' || s === 'closed') this.onDrop(s === 'failed' ? 'Verbindung fehlgeschlagen' : 'Verbindung beendet');
      else if (s === 'disconnected') this.setStatus('Verbindung unterbrochen - warte ...');
    };
    pc.ontrack = ev => {
      const v = $('netVideo');
      if (v && ev.streams[0]) { v.srcObject = ev.streams[0]; v.play().catch(() => { }); }
    };
    pc.ondatachannel = ev => {
      if (ev.channel.label === 'ctl') this.bindCtl(ev.channel);
      else this.bindInp(ev.channel);
    };
    return pc;
  },
  bindCtl(ch) {
    this.ctl = ch;
    ch.onmessage = e => { this.lastRx = Date.now(); this.onCtl(JSON.parse(e.data)); };
    ch.onclose = () => this.onDrop('Datenkanal geschlossen');
  },
  bindInp(ch) {
    this.inp = ch;
    ch.onmessage = e => {
      this.lastRx = Date.now();
      const d = JSON.parse(e.data);
      /* Unordered: ein aelteres Paket darf ein neueres nicht ueberschreiben. */
      if (d.t > this.remote.t) {
        this.remote.mx = d.m[0]; this.remote.my = d.m[1];
        this.remote.ax = d.a[0]; this.remote.ay = d.a[1];
        this.remote.aim = d.h; this.remote.sk = d.s; this.remote.t = d.t;
      }
    };
  },
  /* Non-Trickle: erst wenn ICE fertig ist, ist das SDP vollstaendig - damit sind
     Raumcode-Weg und Offline-Weg exakt derselbe Codepfad. */
  waitIce(pc) {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise(res => {
      const done = () => { pc.removeEventListener('icegatheringstatechange', chk); clearTimeout(to); res(); };
      const chk = () => { if (pc.iceGatheringState === 'complete') done(); };
      const to = setTimeout(done, 6000);
      pc.addEventListener('icegatheringstatechange', chk);
    });
  },
  async makeOffer() {
    const pc = this.makePeer();
    this.bindCtl(pc.createDataChannel('ctl', { ordered: true }));
    this.bindInp(pc.createDataChannel('input', { ordered: false, maxRetransmits: 0 }));
    /* Bild + Ton anhaengen, bevor das Angebot entsteht. */
    AudioSys.init();
    const st = $('game').captureStream(NET_HZ);
    for (const tr of st.getTracks()) pc.addTrack(tr, st);
    if (AudioSys.ctx) {
      this.audioDest = AudioSys.ctx.createMediaStreamDestination();
      AudioSys.limiter.connect(this.audioDest);
      for (const tr of this.audioDest.stream.getAudioTracks()) pc.addTrack(tr, this.audioDest.stream);
    }
    await pc.setLocalDescription(await pc.createOffer());
    await this.waitIce(pc);
    return pc.localDescription.sdp;
  },
  async makeAnswer(sdp) {
    const pc = this.makePeer();
    await pc.setRemoteDescription({ type: 'offer', sdp: sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await this.waitIce(pc);
    return pc.localDescription.sdp;
  },

  /* ---------- Weg A: Raumcode ueber oeffentlichen Broker ---------- */
  /* Meldet sich an, abonniert und ruft onReady erst nach dem SUBACK: vorher ist das
     Abo beim Broker nicht aktiv und eine sofortige Antwort des Gegenuebers ginge
     verloren. Kommt der Broker nicht durch, uebernimmt der naechste; ein Keepalive
     haelt die Sitzung offen, waehrend der Host auf einen Mitspieler wartet. */
  brokerConnect(dir, onReady) {
    this.setStatus('Verbinde mit Vermittlung ... (' + (this.wsIdx + 1) + '/' + NET_BROKERS.length + ')', 'signaling');
    const ws = new WebSocket(NET_BROKERS[this.wsIdx], 'mqtt');
    ws.binaryType = 'arraybuffer';
    this.ws = ws; this.wsBuf = new Uint8Array(0);
    const to = setTimeout(() => ws.close(), 9000);
    ws.onopen = () => ws.send(MqttWire.connect('wbns' + this.myId));
    ws.onclose = () => {
      clearTimeout(to); clearInterval(this._ka);
      if (this.phase !== 'signaling') return;
      if (++this.wsIdx < NET_BROKERS.length) this.brokerConnect(dir, onReady);
      else this.fail('Keine Vermittlung erreichbar. Bei blockiertem WebSocket oder ohne Internet den Offline-Weg nutzen.');
    };
    ws.onmessage = ev => {
      const chunk = new Uint8Array(ev.data);
      const merged = new Uint8Array(this.wsBuf.length + chunk.length);
      merged.set(this.wsBuf); merged.set(chunk, this.wsBuf.length);
      const r = MqttWire.parse(merged);
      this.wsBuf = r.rest;
      for (const m of r.msgs) {
        if (m.type === 2) {
          ws.send(MqttWire.subscribe(this.topic(dir)));
          this._ka = setInterval(() => ws.send(MqttWire.ping()), 30000);
        } else if (m.type === 9) { clearTimeout(to); onReady(); }
        else if (m.type === 3) {
          /* Auf einem oeffentlichen Broker kann Fremdverkehr liegen - der darf die
             Vermittlung nicht abschiessen. */
          let s = null;
          try { s = JSON.parse(m.payload); } catch (e) { }
          if (s) this.run(this.onSignal(s), 'Verbindungsaufbau fehlgeschlagen');
        }
      }
    };
  },
  topic(dir) { return 'wbns/' + this.code + '/' + dir; },
  pub(dir, obj) { this.ws.send(MqttWire.publish(this.topic(dir), JSON.stringify(obj))); },

  hostRoom() {
    this.reset();
    this.role = 'host'; this.myId = Math.random().toString(36).slice(2, 8);
    this.code = this.roomCode(); this.wsIdx = 0;
    this.brokerConnect('c2h', () => {
      this.setStatus('Raum offen - Code an den Mitspieler geben.', 'signaling');
      this.arm(180, 'Es ist niemand beigetreten (3 Minuten). Raum neu oeffnen - oder den Offline-Weg nutzen.');
    });
  },
  joinRoom(code) {
    const c = this.normCode(code);
    if (c.length !== 6) { UI.toast('Bitte den 6-stelligen Raumcode eingeben'); return; }
    this.reset();
    this.role = 'client'; this.myId = Math.random().toString(36).slice(2, 8);
    this.code = c; this.wsIdx = 0;
    this.brokerConnect('h2c', () => {
      this.pub('c2h', { t: 'hello', id: this.myId });
      this.setStatus('Suche Raum ' + c + ' ...', 'signaling');
      this.arm(20, 'Raum ' + c + ' antwortet nicht. Code pruefen - oder der Host hat den Raum noch nicht geoeffnet.');
    });
  },
  async onSignal(m) {
    if (this.role === 'host') {
      if (m.t === 'hello' && !this.peerId) {
        this.peerId = m.id;
        this.setStatus('Mitspieler gefunden - baue Verbindung auf ...', 'connecting');
        this.arm(30, NET_NO_P2P);
        this.pub('h2c', { t: 'offer', to: m.id, sdp: await this.makeOffer() });
      } else if (m.t === 'answer' && m.from === this.peerId && !this.pc.currentRemoteDescription) {
        await this.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp });
      }
    } else if (m.t === 'offer' && m.to === this.myId && !this.pc) {
      this.setStatus('Angebot erhalten - antworte ...', 'connecting');
      this.arm(30, NET_NO_P2P);
      this.pub('c2h', { t: 'answer', from: this.myId, sdp: await this.makeAnswer(m.sdp) });
    }
  },

  /* ---------- Weg B: Offline / Code von Hand ---------- */
  async manualCreate() {
    this.reset();
    this.role = 'host';
    this.setStatus('Erzeuge Host-Code ...', 'connecting');
    $('netManualOut').value = await this.pack(await this.makeOffer());
    this.setStatus('Host-Code erzeugt - verschicken, dann die Antwort unten einfuegen.', 'signaling');
  },
  async manualJoin(code) {
    const sdp = await this.unpack(code);
    this.reset();
    this.role = 'client';
    this.setStatus('Erzeuge Antwort-Code ...', 'connecting');
    $('netManualOut').value = await this.pack(await this.makeAnswer(sdp));
    this.setStatus('Antwort-Code erzeugt - zurueck an den Host schicken.', 'connecting');
  },
  async manualAccept(code) {
    if (this.role !== 'host' || !this.pc) { UI.toast('Zuerst einen Host-Code erzeugen'); return; }
    await this.pc.setRemoteDescription({ type: 'answer', sdp: await this.unpack(code) });
    this.setStatus('Antwort angenommen - verbinde ...', 'connecting');
  },

  /* ---------- Auf-/Abbau ---------- */
  onOpen() {
    if (this.phase === 'connected') return;
    this.phase = 'connected';
    clearTimeout(this._wd);
    if (this.ws) { this.ws.close(); this.ws = null; }
    this.lastRx = Date.now();
    this.setStatus('Verbunden' + (this.role === 'host' ? ' - Mitspieler ist Spieler 2.' : ' - du bist Spieler 2.'));
    AudioSys.sfx('level');
    if (this.role === 'host') {
      Game.coop = true;
      UI.toast('Online-Koop verbunden - Mitspieler steuert Spieler 2');
      this.syncMenu(true);
    } else {
      UI.hideAll();
      $('hud').classList.add('hidden');
      $('netStage').classList.remove('hidden');
      Game.state = 'net';
      UI.toast('Verbunden - du spielst Spieler 2');
    }
  },
  onDrop(why) {
    /* Eigenes Abraeumen setzt phase vorher auf idle - das ist kein Abbruch. */
    if (this.phase === 'idle' || this.phase === 'closed' || this.phase === 'error') return;
    if (this.phase !== 'connected') { this.fail(why + ' - ' + NET_NO_P2P); return; }
    this.phase = 'closed';
    this.setStatus(why + ' - erneut verbinden moeglich.');
    if (this.role === 'host') {
      if (Game.state === 'play') { Game.state = 'paused'; UI.navIdx = 0; UI.show('scPause'); }
      UI.toast('Mitspieler getrennt - Spiel pausiert');
    } else {
      UI.toast('Verbindung zum Host verloren');
      this.toMenu();
    }
  },
  reset() {
    this.phase = 'idle';   /* zuerst: sonst gilt unser eigenes close() als Verbindungsabbruch */
    clearTimeout(this._wd); clearInterval(this._ka);
    if (this.pc) this.pc.close();
    if (this.audioDest) AudioSys.limiter.disconnect(this.audioDest);
    if (this.ws) { this.ws.close(); this.ws = null; }
    this.pc = null; this.ctl = null; this.inp = null; this.peerId = null; this.audioDest = null;
    this.acts = {}; this.remote = { mx: 0, my: 0, ax: 0, ay: 0, aim: 0, sk: 0, t: 0 };
    this._lastMenu = ''; this.ping = 0;
  },
  hangUp() {
    const wasGuest = this.role === 'client';
    this.reset();
    this.role = null;
    if (wasGuest) this.toMenu();
    this.setStatus('Nicht verbunden', 'idle');
  },
  /* Gast zurueck aus der Video-Buehne ins Menue */
  toMenu() {
    $('netStage').classList.add('hidden');
    $('netVideo').srcObject = null;
    Game.state = 'title';
    UI.renderTitle(); UI.show('scTitle');
  },

  send(obj, viaInput) {
    const ch = viaInput ? this.inp : this.ctl;
    if (!ch || ch.readyState !== 'open') return false;
    ch.send(JSON.stringify(obj));
    return true;
  },
  act(name) { this.send({ t: 'act', a: name }); },
  takeAct(name) { if (this.acts[name]) { this.acts[name] = 0; return true; } return false; },

  onCtl(m) {
    if (m.t === 'act') { this.acts[m.a] = 1; if (m.a === 'pause') this.hostPause(); }
    else if (m.t === 'pick') this.applyPick(m.id);
    else if (m.t === 'ping') this.send({ t: 'pong', s: m.s });
    else if (m.t === 'pong') this.ping = Math.max(0, Date.now() - m.s);
    else if (m.t === 'menu') UI.renderNetMenu(m);
    else if (m.t === 'hud') UI.renderNetHud(m);
    else if (m.t === 'toast') UI.toast(m.m);
  },
  hostPause() {
    if (Game.state === 'play') { Game.state = 'paused'; UI.navIdx = 0; UI.show('scPause'); AudioSys.sfx('ui'); }
    else if (Game.state === 'paused' && UI.cur === 'scPause') { Game.state = 'play'; UI.show(null); $('hud').classList.remove('hidden'); }
  },

  tick(dt) {
    if (this.phase !== 'connected') return;
    this._pingAcc += dt;
    if (this._pingAcc > 1) {
      this._pingAcc = 0;
      this.send({ t: 'ping', s: Date.now() });
      /* HUD auch ausserhalb von 'play' frisch halten (Shop, Pause, Level-Up). */
      if (this.role === 'host') this.send(this.hudSnapshot());
    }
    if (this.role === 'client') {
      this._inpAcc += dt;
      if (this._inpAcc >= 1 / NET_HZ) {
        this._inpAcc = 0;
        const mv = Input.moveVec(0), av = Input.aimVec(0);
        this.send({
          m: [+mv.x.toFixed(3), +mv.y.toFixed(3)],
          a: [+av.x.toFixed(3), +av.y.toFixed(3)],
          h: av.has ? 1 : 0, s: Input.skillDown(0) ? 1 : 0, t: Date.now()
        }, true);
      }
    } else if (Date.now() - this.lastRx > 900) {
      /* Achsen altern aus, falls der Gast verstummt - sonst laeuft P2 endlos weiter. */
      this.remote.mx = 0; this.remote.my = 0; this.remote.aim = 0; this.remote.sk = 0;
    }
  },
  /* Gast-Tasten werden nur als Ereignisse verschickt, nie lokal simuliert. */
  clientInput() {
    const P = Input.pressed;
    if (P[Input.key('dash')] || Input.padPressed(0, 4)) this.act('dash');
    if (P[Input.key('jump')] || Input.padPressed(0, 11)) this.act('jump');
    if (P[Input.key('rune')] || Input.padPressed(0, 7)) this.act('rune');
    if (P[Input.key('pause')] || Input.padPressed(0, 9) || Input.touch.pause) this.act('pause');
  },

  /* ---------- Menue-Spiegelung (Host -> Gast) ----------
     DOM-Bildschirme liegen nicht im Canvas-Stream. Der Gast bekommt daher eine reine
     Beschreibung (Karten + Knoepfe mit IDs) und schickt nur die geklickte ID zurueck -
     kein State-Duplikat, der Host bleibt die einzige Wahrheit. */
  buildMenu() {
    const G = Game, p2 = G.players[1];
    if (UI.cur === 'scChar' && G.charSelIdx === 1) {
      return {
        t: 'menu', title: 'Spieler 2 - Charakter', sub: 'Waehle deinen Helden. Der Host startet die Runde.',
        items: CHARS.filter(c => Save.data.unlockedChars.includes(c.id) || !c.unlock).map(c => ({
          id: 'char:' + c.id, label: c.name, sub: c.role, desc: c.desc, col: c.col, on: G.sel[1] === c.id
        }))
      };
    }
    if (G.state === 'levelup') {
      const p = G.levelQueue[0];
      if (!p || p.index !== 1) return { t: 'menu', title: 'Spieler 1 waehlt ...', sub: 'Gleich geht es weiter.', items: [] };
      return {
        t: 'menu', title: 'Stufe ' + p.level, sub: p.char.name + ' - waehle eine Verbesserung',
        items: (G._curChoices || []).map((c, i) => ({
          id: 'lvl:' + i, label: c.name,
          sub: c.kind ? (c.kind === 'wup' ? 'Waffe verbessern' : c.kind === 'wnew' ? 'Neue Waffe' : 'Fundstueck') : (sign(c.val) + (STAT_UNIT[c.stat] || '')),
          desc: c.d, col: ['#dbe6ff', '#5dff9b', '#39e6ff'][c.tier]
        }))
      };
    }
    if (G.state === 'relic') {
      const p = G.relicQueue && G.relicQueue[0];
      if (!p || p.index !== 1) return { t: 'menu', title: 'Spieler 1 waehlt ein Relikt ...', sub: '', items: [] };
      return {
        t: 'menu', title: 'Relikt waehlen', sub: p.char.name + ' - gilt fuer den Rest des Runs',
        items: (G._curRelics || []).map(r => ({ id: 'relic:' + r.id, label: r.name, sub: 'Relikt', desc: r.fl, col: r.col })),
        acts: [{ id: 'relicSkip', label: 'Ueberspringen' }]
      };
    }
    if (G.state === 'shop' && p2) {
      const acts = [{ id: 'reroll', label: 'Neuwurf (' + ShopSystem.rerollCost(G.wave) + ' MAT)' }];
      p2.weapons.forEach((w, i) => acts.push({ id: 'sell:' + i, label: 'verkaufen: ' + WEAPON_BY_ID[w.id].name + ' T' + (w.tier + 1) }));
      acts.push({ id: 'next', label: 'Bereit - naechste Welle' });
      return {
        t: 'menu', title: 'Shop - Welle ' + G.wave,
        sub: 'Material: ' + G.materials + ' - deine Waffen: ' + p2.weapons.length + '/' + BROTATO_RULES.maxWeapons,
        items: ShopSystem.offers.map((o, i) => {
          let label, sub, desc, col = '#dbe6ff';
          if (o.kind === 'weapon') { const d = WEAPON_BY_ID[o.id]; label = d.name; sub = RARITY_NAME[o.tier] + ' - T' + (o.tier + 1); desc = d.special; col = d.col; }
          else if (o.kind === 'attach') { const a = ATT_BY_ID[o.id]; label = a.icon + ' ' + a.name; sub = 'Waffen-Aufsatz'; desc = a.desc; col = a.col; }
          else if (o.kind === 'relic') { const r = RELIC_BY_ID[o.id]; label = r.name; sub = 'Relikt'; desc = r.fl; col = '#ffd75e'; }
          else { const it = ITEM_BY_ID[o.id]; label = it.name; sub = RARITY_NAME[it.r - 1]; desc = it.fl; }
          return {
            id: 'buy:' + i, label: label, sub: sub + ' - ' + o.price + ' MAT', desc: desc, col: col,
            dis: !!ShopSystem.bought[i] || G.materials < o.price
          };
        }),
        acts: acts
      };
    }
    return { t: 'menu', title: '', items: [] };
  },
  syncMenu(force) {
    if (this.role !== 'host' || this.phase !== 'connected') return;
    const m = this.buildMenu();
    const key = JSON.stringify(m);
    if (!force && key === this._lastMenu) return;
    /* Erst merken, wenn es wirklich rausging - sonst verschluckt der Cache ein
       Menue, das beim noch nicht offenen Kanal verlorenging. */
    if (this.send(m)) this._lastMenu = key;
  },
  applyPick(id) {
    const G = Game, p2 = G.players[1];
    const cut = String(id).split(':'), k = cut[0], v = cut[1];
    if (k === 'char') {
      if (!CHARS.some(c => c.id === v)) return;
      G.sel[1] = v; AudioSys.sfx('ok'); UI.renderChars(1);
      return;
    }
    if (k === 'lvl') {
      const p = G.levelQueue[0], c = (G._curChoices || [])[+v];
      if (p && p.index === 1 && c) G.chooseUpgrade(p, c);
      return;
    }
    if (k === 'relic' || k === 'relicSkip') {
      const p = G.relicQueue && G.relicQueue[0];
      if (p && p.index === 1) { if (k === 'relic') G.chooseRelic(p, v); else G.skipRelic(); }
      return;
    }
    if (G.state !== 'shop' || !p2) return;
    if (k === 'buy') ShopSystem.buy(+v, p2);
    else if (k === 'sell') { if (p2.weapons[+v]) { G.materials += p2.sellWeapon(+v); AudioSys.sfx('buy'); UI.renderShop(); } }
    else if (k === 'reroll') ShopSystem.reroll(G.wave, G.players);
    else if (k === 'next') { G.startWave(G.wave + 1); return; }
    this.syncMenu(true);
  },
  hudSnapshot() {
    const box = p => p ? { n: p.char.name, hp: Math.round(p.hp), mx: Math.round(p.maxHp), a: p.alive ? 1 : 0 } : null;
    return {
      t: 'hud', w: Game.wave, mat: Game.materials,
      en: Game.enemies ? Game.enemies.filter(e => !e.dead).length : 0,
      p1: box(Game.players[0]), p2: box(Game.players[1])
    };
  }
};

/* ============================ 21b. SELFTEST (?selftest) ============================
   Läuft mit URL-Parameter ?selftest: prüft reine Funktionen und Seams
   (RNG-Determinismus, Save-Roundtrip, Combat, Data, Netz, Perf-Guard)
   und zeigt PASS/FAIL in einem Dev-Panel. Kein Build, kein Test-Runner nötig.
   ============================================================================ */
const SelfTest = {
  results: [],
  _ok(cond, name) { this.results.push({ ok: !!cond, name }); },
  run() {
    this.results = [];
    try { this._rng(); } catch (e) { this._ok(false, 'RNG-Determinismus (Fehler: ' + e.message + ')'); }
    try { this._save(); } catch (e) { this._ok(false, 'Save-Roundtrip (Fehler: ' + e.message + ')'); }
    try { this._perf(); } catch (e) { this._ok(false, 'Perf-Guard (Fehler: ' + e.message + ')'); }
    try { this._combat(); } catch (e) { this._ok(false, 'Combat (Fehler: ' + e.message + ')'); }
    try { this._playerDamage(); } catch (e) { this._ok(false, 'PlayerDamage (Fehler: ' + e.message + ')'); }
    try { this._data(); } catch (e) { this._ok(false, 'Data (Fehler: ' + e.message + ')'); }
    try { this._runtimeContracts(); } catch (e) { this._ok(false, 'RuntimeContracts (Fehler: ' + e.message + ')'); }
    try { this._reflect(); } catch (e) { this._ok(false, 'Reflect (Fehler: ' + e.message + ')'); }
    try { this._elementDps(); } catch (e) { this._ok(false, 'ElementDps (Fehler: ' + e.message + ')'); }
    try { this._systemLoop(); } catch (e) { this._ok(false, 'SystemLoop (Fehler: ' + e.message + ')'); }
    try { this._extendedSystems(); } catch (e) { this._ok(false, 'ExtendedSystems (Fehler: ' + e.message + ')'); }
    try { this._audioBudget(); } catch (e) { this._ok(false, 'AudioBudget (Fehler: ' + e.message + ')'); }
    try { this._longRunContracts(); } catch (e) { this._ok(false, 'LongRun (Fehler: ' + e.message + ')'); }
    try { this._qualityContracts(); } catch (e) { this._ok(false, 'QualityContracts (Fehler: ' + e.message + ')'); }
    try { this._characterContracts(); } catch (e) { this._ok(false, 'CharacterContracts (Fehler: ' + e.message + ')'); }
    try { this._brotatoContracts(); } catch (e) { this._ok(false, 'BrotatoContracts (Fehler: ' + e.message + ')'); }
    try { this._net(); } catch (e) { this._ok(false, 'Net (Fehler: ' + e.message + ')'); }
    this._render();
  },
  _rng() {
    const a = new RNG(12345), b = new RNG(12345);
    let same = true;
    for (let i = 0; i < 100; i++) if (a.next() !== b.next()) same = false;
    this._ok(same, 'RNG-Determinismus: gleicher Seed → 100 identische Werte');
    const c = new RNG(999);
    this._ok(c.next() !== new RNG(12345).next(), 'RNG: verschiedene Seeds → verschiedene Werte');
  },
  _save() {
    const key = '__selftest__';
    Save.data[key] = { a: 1, b: 'x' };
    Save.save();
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    const back = raw ? (raw.data ? raw.data[key] : raw[key]) : null;
    this._ok(!!(back && back.a === 1 && back.b === 'x'), 'Save-Roundtrip: Wert übersteht save()/localStorage');
    delete Save.data[key];
    Save.save();
  },
  /* Perf-Guard: Glow-Rendering darf nicht in die teuren Pfade zurückfallen.
     Qualität 1 / FPS-Schutz müssen OHNE Schatten-Rendering zeichnen (2-Layer-
     Halo), volle Qualität nutzt Schatten-Glow mit minimalem State-Wechsel. */
  _perf() {
    const cv = document.createElement('canvas');
    const c2 = cv.getContext('2d');
    if (!c2 || typeof c2.fillRect !== 'function') { this._ok(true, 'Perf-Guard: Canvas nicht verfügbar (übersprungen)'); return; }
    let shadowed = 0, shadowSets = 0, _sb = 0, saves = 0;
    const wrap = (orig) => function () { if (_sb > 0) shadowed++; return orig.apply(this, arguments); };
    c2.fillRect = wrap(c2.fillRect); c2.fill = wrap(c2.fill); c2.strokeRect = wrap(c2.strokeRect);
    c2.save = () => { saves++; }; c2.restore = () => { saves++; };
    Object.defineProperty(c2, 'shadowBlur', {
      get() { return _sb; }, set(v) { if (_sb !== v) shadowSets++; _sb = v; }, configurable: true,
    });
    const oldCtx = Game.ctx, oldQ = Save.data.opts.quality, oldAutoQ = Game.autoQ;
    const spark20 = () => { FX.clear(); for (let i = 0; i < 20; i++) FX.particle(0, 0, i, 30, '#ff7a3d', .5, 2, { shape: 'pixel', glow: 1 }); };
    Game.ctx = c2; Save.data.opts.quality = 1; Game.autoQ = 1;
    spark20(); FX.draw(c2);
    this._ok(shadowed === 0, 'Perf-Guard: Qualität 1 rendert Glow ohne Schatten (' + shadowed + ' shadowed fills)');
    this._ok(saves < 5, 'Perf-Guard: unrotierte Partikel ohne Matrix-Save (' + saves + ' save/restore)');
    shadowed = 0; shadowSets = 0; _sb = 0;
    Save.data.opts.quality = 2; Game.autoQ = 1;
    spark20(); FX.draw(c2);
    this._ok(shadowed > 0 && shadowSets < 20, 'Perf-Guard: Qualität 2 nutzt Schatten-Glow mit minimalem State-Wechsel (' + shadowed + ' shadowed, ' + shadowSets + ' Sets)');
    Game.ctx = oldCtx; Save.data.opts.quality = oldQ; Game.autoQ = oldAutoQ;
  },
  _combat() {
    /* Combat-Modul: purer Kern ohne Welt/FX/Audio — Regeln deterministisch */
    Combat.setWorld(Game);
    this._ok(Math.abs(Combat.mitigation(18, 0, 0, 0, 100) - 50) < 1e-9, 'Combat: Ruestung 18 halbiert Schaden (18/(18+18))');
    this._ok(Math.abs(Combat.mitigation(0, 0, 0, 1, 100) - 135) < 1e-9, 'Combat: Marked x1.35');
    this._ok(Combat.mitigation(99999, 0, 0, 0, 1) === 1, 'Combat: Mindestschaden 1');
    const tgt = { hp: 100, maxHp: 100, armor: 18, armorBuff: 0, marked: 0, boss: false, coreOpen: false, dead: false, def: {}, target: null, x: 0, y: 0 };
    const r = Combat.resolveHit({ tgt, dmg: 100, isCrit: false, src: { x: 0, y: 0 }, type: 'elem' });
    this._ok(Math.abs(r.dmg - 50) < 1e-9 && !r.died && Math.abs(r.tier - .5) < 1e-9, 'Combat: resolveHit Ruestung/Tier korrekt (50 Schaden toetet 100 HP nicht)');
    const r3 = Combat.resolveHit({ tgt: { hp: 30, maxHp: 100, armor: 0, armorBuff: 0, marked: 0, boss: false, coreOpen: false, dead: false, def: {}, target: null }, dmg: 100, isCrit: false, src: { x: 0, y: 0 }, type: 'elem' });
    this._ok(r3.died === true, 'Combat: resolveHit erkennt Tod (30 HP - 100 Schaden)');
    const r2 = Combat.resolveHit({ tgt: { hp: 100, maxHp: 100, armor: 0, armorBuff: 0, marked: 0, boss: true, coreOpen: true, dead: false, def: {}, target: null }, dmg: 10, isCrit: false, src: { x: 1, y: 1 }, type: 'boom' });
    this._ok(r2.crit && Math.abs(r2.dmg - 30) < 1e-9, 'Combat: offener Bosskern x3 zaehlt als Krit');
    /* Reaktion: Kettenblitz trifft Gegner im Radius, nicht weiter entfernte */
    const near = [
      { x: 0, y: 0, dead: false },
      { x: 30, y: 0, dead: false },
      { x: 60, y: 0, dead: false },
      { x: 500, y: 500, dead: false }
    ];
    const chainW = { hash: { query: (x, y, r) => near.filter(t => Math.hypot(t.x - x, t.y - y) < r) } };
    const oldW = Combat.W;
    Combat.setWorld(chainW);
    const R = Combat.resolveReaction('chain', near[0], 100, {});
    this._ok(R.list.length === 3 && R.list.every(h => Math.abs(h.dmg - 32) < 1e-9), 'Combat: Kettenblitz 3 Spruenge a 32 %, ferner Gegner unberuehrt');
    /* BalanceSim konsumiert Combat: Hits-Schaetzung delegiert */
    const hpA = BalanceSim.hitsPerAttack({ type: 'projectile' }, { pellets: 2 });
    const hpB = Combat.hitsPerAttack({ type: 'projectile' }, { pellets: 2 });
    this._ok(hpA === hpB && hpA === 2, 'Combat: BalanceSim.hitsPerAttack delegiert an Combat (2 Pellets = 2)');
    /* Status-Tick: Burn-Mathe deterministisch */
    const e = { burn: 10, burnT: 1, poison: 0, poisonT: 0, hp: 100, x: 0, y: 0, r: 5, col: '#fff', die: () => {} };
    Combat.setWorld({ modIs: () => false, players: [{}] });
    Combat.tickStatus(e, .5);
    this._ok(Math.abs(e.hp - 95) < 1e-9 && Math.abs(e.burnT - .5) < 1e-9, 'Combat: tickStatus Burn 10 DPS x 0.5 s = 5 Schaden');
    Combat.setWorld(oldW || Game);
  },
  _playerDamage() {
    /* Spieler-Treffer-Mathe: handgerechnete Literale (15/(15+armor), Negativ-Armor, Min-1, wagerFragile, Dodge-Cap) */
    Combat.setWorld(Game);
    const mk = (hp, armor, dodge, fragile) => ({ hp, maxHp: 100, st: { armor, dodge }, wagerFragile: fragile });
    const r1 = Combat.resolvePlayerHit({ p: mk(100, 15, 0, false), v: 100, rng: () => .99 });
    this._ok(!r1.dodged && Math.abs(r1.dmg - 50) < 1e-9 && !r1.died, 'Combat: Spieler-Ruestung 15 halbiert Schaden (15/(15+15)=0.5)');
    const r2 = Combat.resolvePlayerHit({ p: mk(100, 0, 0, false), v: 100, rng: () => .99 });
    this._ok(Math.abs(r2.dmg - 100) < 1e-9, 'Combat: Spieler ohne Ruestung erhaelt vollen Schaden');
    const r3 = Combat.resolvePlayerHit({ p: mk(100, -10, 0, false), v: 100, rng: () => .99 });
    this._ok(Math.abs(r3.dmg - 160) < 1e-9, 'Combat: Negativ-Ruestung -10 verstaerkt auf 1.6x (100*1.6=160)');
    const r4 = Combat.resolvePlayerHit({ p: mk(100, 0, 0, false), v: .05, rng: () => .99 });
    this._ok(Math.abs(r4.dmg - 1) < 1e-9, 'Combat: Mindestschaden 1 beim Spieler');
    const r5 = Combat.resolvePlayerHit({ p: mk(100, 0, 0, true), v: 100, rng: () => .99 });
    this._ok(Math.abs(r5.dmg - 200) < 1e-9, 'Combat: wagerFragile verdoppelt Schaden (100*2=200)');
    const r6 = Combat.resolvePlayerHit({ p: mk(30, 0, 0, false), v: 100, rng: () => .99 });
    this._ok(r6.died === true && Math.abs(r6.dmg - 100) < 1e-9, 'Combat: resolvePlayerHit erkennt Tod (30 HP - 100 Schaden)');
    const r7 = Combat.resolvePlayerHit({ p: mk(100, 0, 40, false), v: 100, rng: () => 0 });
    this._ok(r7.dodged === true && r7.dmg === 0, 'Combat: Dodge 40 mit rng 0 weicht aus (0 Schaden)');
    const r8 = Combat.resolvePlayerHit({ p: mk(100, 0, 40, false), v: 100, rng: () => .99 });
    this._ok(r8.dodged === false, 'Combat: Dodge 40 mit rng .99 trifft');
    const r9 = Combat.resolvePlayerHit({ p: mk(100, 0, 100, false), v: 10, rng: () => .6 });
    this._ok(r9.dodged === false, 'Combat: Dodge-Cap 60 — rng exakt 0.6 trifft (60 < 60 ist falsch)');
  },
  _data() {
    /* Data-Modul: Schema-Validierung ueber alle Spiel-Tabellen + Index */
    const errs = Data.validate();
    this._ok(errs.length === 0, 'Data: validate() liefert 0 Fehler (' + errs.length + (errs.length ? ': ' + errs.slice(0, 3).join('; ') : '') + ')');
    /* Modul-Einheit: register baut byId, validate faengt doppelte id und hp<=0 */
    const fake = Data.register('_test_fake', [{ id: 'a', hp: 10 }, { id: 'a', hp: -5 }, { id: 'b', hp: 0 }], { id: 'id', hp: 'num>0' });
    const ferr = Data.validate().filter(e => e.indexOf('_test_fake') === 0);
    this._ok(!!fake.byId.a && !!fake.byId.b && !fake.byId.c, 'Data: register baut byId-Index');
    this._ok(ferr.some(e => e.indexOf('doppelte id') >= 0) && ferr.some(e => e.indexOf('.hp') >= 0), 'Data: validate faengt doppelte id und hp<=0');
    delete Data._tables['_test_fake'];
    this._ok(WEAPONS.length > 0 && ENEMIES.length > 0 && CHARS.length > 0 && ATTACHMENTS.length > 0, 'Data: Kerntabellen nicht leer');
  },
  _runtimeContracts() {
    /* TDD-RED: Runtime-Buffs duerfen nur bekannte Stats schreiben. */
    const oldBanner = UI.banner, oldSfx = AudioSys.sfx;
    UI.banner = () => {}; AudioSys.sfx = () => {};
    const seen = [];
    const p = { addBuff: (stat, val, t) => seen.push({ stat, val, t }) };
    applyRuneEffect(p, RUNE_BY_ID.sturm);
    UI.banner = oldBanner; AudioSys.sfx = oldSfx;
    this._ok(seen.length === 3 && seen.every(b => STAT_KEYS.includes(b.stat)), 'Runtime: RUNEN-STURM schreibt nur bekannte Stats');
    this._ok(seen.some(b => b.stat === 'dmgP' && b.val === 20), 'Runtime: RUNEN-STURM gibt +20% Schaden ueber dmgP');
    /* TDD-RED: Auch die bisher losen Tabellen muessen zentral registriert sein. */
    const loose = ['groundTextures', 'groundTexturesArena', 'weaponSfx', 'quotes', 'classBonus', 'statDefinitions'];
    this._ok(loose.every(name => Data._tables[name]), 'Data: lose Tabellen zentral registriert (' + loose.join(', ') + ')');
    this._ok(Data.validate().length === 0, 'Data: lose Tabellen ohne Validierungsfehler');
  },
  _reflect() {
    /* Reflect-Pfad: Spiegelnder Elite (resolveMirror) + Dornen (stachel-Item) */
    Combat.setWorld(Game);
    const mkHit = (o) => ({ src: { x: 50, y: 100, damage: () => {} }, tgt: { eliteTrait: 'spiegelnd', x: 100, y: 100 }, dmg: 100, isCrit: false, type: 'projectile', ...o });
    /* Pure: resolveMirror — hier noch NICHT implementiert -> Rot */
    const r1 = Combat.resolveMirror(mkHit({}), () => 0.1);
    this._ok(r1.reflected && Math.abs(r1.reflectedDmg - 12) < 1e-9, 'Combat: resolveMirror reflektiert 12% bei rng 0.1');
    const r2 = Combat.resolveMirror(mkHit({}), () => 0.5);
    this._ok(!r2.reflected, 'Combat: resolveMirror kein Reflect bei rng 0.5');
    const r3 = Combat.resolveMirror(mkHit({type: 'thorns'}), () => 0.1);
    this._ok(!r3.reflected, 'Combat: resolveMirror kein Reflect bei type=thorns');
    const r4 = Combat.resolveMirror(mkHit({tgt: {eliteTrait: 'panzer', x: 100, y: 100}}), () => 0.1);
    this._ok(!r4.reflected, 'Combat: resolveMirror kein Reflect bei Elite-Trait panzer');
    const r5 = Combat.resolveMirror(mkHit({src: {x: 50, y: 100}}), () => 0.1);
    this._ok(!r5.reflected, 'Combat: resolveMirror kein Reflect ohne damage()');
    /* Full path: Spiegelnder Elite nimmt Schaden, reflektiert auf Spieler */
    Game.hash = new SpatialHash(110); Game.run = { kills: 0, track: {}, dmg: 0 }; Game.state = 'play';
    const oldMA = Game.modActive; Game.modActive = () => false;
    const oldShake = Game.shakeAt; Game.shakeAt = () => {};
    Input.padMap = []; Input.rumble = () => {};
    const p = new Player(0, 'sunny'); p.maxHp = 100; p.hp = 100; p.st.armor = 0; p.st.dodge = 0; p.invuln = 0;
    const e = new Enemy(); e.spawn(ENEMY_BY_ID.elite, 100, 100, 1, null); e.eliteTrait = 'spiegelnd';
    const hpP = p.hp, hpE = e.hp;
    const origR = Math.random; Math.random = () => 0.1;
    Combat.applyHit({ tgt: e, dmg: 50, isCrit: false, src: p, type: 'projectile' });
    Math.random = origR;
    this._ok(hpE - e.hp >= 20, 'Combat: Spiegelnder Elite nimmt Schaden (Ruestung 12, erwartet ~30)');
    this._ok(hpP - p.hp > 0, 'Combat: Spiegelnder Elite reflektiert Schaden auf Spieler');
    /* Thorns: Spieler mit Stachelpanzer, Gegner in Reichweite */
    const p2 = new Player(0, 'sylvia'); p2.maxHp = 100; p2.hp = 100; p2.st.armor = 0; p2.st.dodge = 0; p2.invuln = 0;
    p2.items = ['stachel']; p2.x = 0; p2.y = 0;
    Game.hash.clear();
    const e2 = new Enemy(); e2.spawn(ENEMY_BY_ID.runner, 30, 30, 1, null);
    Game.hash.insert(e2);
    const hpE2 = e2.hp;
    Combat.applyPlayerHit({ p: p2, v: 30, srcAngle: 0 });
    this._ok(hpE2 - e2.hp >= 5, 'Combat: Stachelpanzer reflektiert Schaden auf Gegner');
    Game.modActive = oldMA; Game.shakeAt = oldShake;
  },
  _elementDps() {
    /* Element-/Reaktions-DPS aus den ECHTEN Combat-Regeln statt Hits-Multiplikatoren.
       Die Funktionen chainFactor/boomFactor/burnDps/chainReact existieren hier NOCH
       NICHT -> Rot. Erwartungen handgerechnet aus den echten Regeln:
       - Waffen-Kette (chain-Typ): d *= .88 je Sprung -> geometrische Reihe
       - Reaktions-Kette (Klingel): applyElement('shock', dd*.3) -> 3 Ziele à .32 -> .288
       - Explosion (detonate): dmg * .9 * falloff, E[falloff] ≈ .58, Dichte 4 -> 2.09
       - Burn (applyBurn s,3): s = burn*(1+elem/100) DPS je brennendem Ziel */
    const phaseA = Combat.phaseIndex(64, 100, [{ at: 1 }, { at: .65 }, { at: .3 }]);
    const phaseB = Combat.phaseIndex(29, 100, [{ at: 1 }, { at: .65 }, { at: .3 }]);
    this._ok(phaseA === 1 && phaseB === 2, 'Combat: Boss-Phase wird aus HP-Schwellen deterministisch gewaehlt');
    const cf3 = Combat.chainFactor({ chain: 3 });
    this._ok(Math.abs(cf3 - 2.6544) < 1e-3, 'Combat: chainFactor(3) = 1+.88+.88² = 2.6544 (Waffen-Kette)');
    const cf5 = Combat.chainFactor({ chain: 5 });
    this._ok(Math.abs(cf5 - 3.9356) < 1e-3, 'Combat: chainFactor(5) = geometrische Reihe .88 = 3.9356');
    const bf = Combat.boomFactor({ boom: 60 });
    this._ok(Math.abs(bf - 2.044) < .02, 'Combat: boomFactor = 1 + .9*.58*2 = 2.044 (Explosion aus detonate-Regeln)');
    const bd = Combat.burnDps({ burn: 10 }, { elem: 50 }, 2);
    this._ok(Math.abs(bd - 30) < 1e-9, 'Combat: burnDps = burn*(1+elem/100)*Ziele = 10*1.5*2 = 30');
    const cr = Combat.chainReact();
    this._ok(Math.abs(cr - .288) < 1e-9, 'Combat: chainReact = .3(shock)*.32(chain)*3 Ziele = .288 (Klingel)');
    this._ok(Combat.hitsPerAttack({ type: 'chain' }, { chain: 4 }) === 1, 'Combat: hitsPerAttack chain = 1 (Kette kommt aus chainFactor)');
    this._ok(Combat.hitsPerAttack({ type: 'projectile' }, { boom: 60 }) === 1, 'Combat: hitsPerAttack projectile ohne boom-Multiplikator = 1');
    /* BalanceSim delegiert weiterhin, aber die Konstanten kommen aus Combat */
    this._ok(Math.abs(BalanceSim.hitsPerAttack({ type: 'chain' }, { chain: 5 }) - 1) < 1e-9, 'BalanceSim: hitsPerAttack delegiert chainFactor-Basis an Combat');
    /* Korridor-Messung muss PFADUNABHAENGIG sein: eine Aenderung an Waffe A
       (z.B. RNG-Verbrauch der boom-Logik) darf Waffe B nicht verschieben.
       weaponSeed liefert je Waffe einen stabilen, isolierten Seed. */
    const s1 = BalanceSim.weaponSeed('nagler'), s2 = BalanceSim.weaponSeed('nagler');
    this._ok(s1 === s2 && s1 !== BalanceSim.weaponSeed('plasma'), 'BalanceSim: weaponSeed stabil je Waffe, verschieden zwischen Waffen');
  },
  _systemLoop() {
    /* Systemtest: treibt die ECHTE Game.update-Loop ueber viele Frames mit
       vollem Setup (Level, Player mit Waffe, gespawnte Gegner) und assertiert,
       dass Schaden, Reaktionen, Status-Ticks und Tode im Zusammenspiel korrekt
       fliessen — kein Crash, Zahlen konsistent. */
    Combat.setWorld(Game); /* wie Game.init() — applyHit/tickStatus lesen W */
    const D0 = Game.danger; const M0 = Game.mods;
    Game.danger = 1; Game.mods = [];
    /* HUD-Rendering braucht echtes DOM (Node-Harness hat keins) — die Loop-Logik
       (Schaden/Reaktionen/Status/Tode) ist davon unabhaengig. Abklemmen und
       am Ende (auch bei Fehler) wiederherstellen. */
    const oldRenderHud = UI.renderHud; UI.renderHud = () => {};
    Game.state = 'play'; Game.time = 0; Game.timeScale = 1; Game.hitstop = 0;
    Game.speedMul = 1; Game.speedBase = 1; Game.combo = 0; Game.comboT = 0;
    Game.wave = 1; Game.waveDuration = 1000; Game.waveTimer = 1000;
    Game.bossAlive = false; Game.bossIntro = 0; Game._curBoss = null; Game._tutI = null;
    Game.sepToggle = false; Game.hudAcc = 0; Game.magnetSweep = 0; Game.spawnAcc = 0;
    Game.spawnQueue = []; Game.waveEnding = false;
    Game.lastHitBy = null; Game.perfectFlash = 0; Game.bossIntroTarget = null;
    Game.run = {
      kills: 0, bosses: 0, dmg: 0, materials: 0, time: 0,
      track: { elemDmg: 0, chain10: 0, maxChain: 0, pulled: 0, fullCharges: 0, needleHeal: 0,
        critStreak: 0, burnKills: 0, poisonKills: 0, boomKills: 0, cursed: 0, flawless: true, starfall3: 0, lowHpWaves: 0, reactions: 0, maxCombo: 0 }
    };
    Game.cam = { x: 0, y: 0, zoom: 1, punch: 0, shake: 0, shakeT: 0, shakeDX: 0, shakeDY: 0, sx: 0, sy: 0, lx: 0, ly: 0, trauma: 0, shakeT2: 0 };
    Game.level = new Level(ARENAS[0], 1);
    Game.hash = new SpatialHash(110);
    Game.enemies = []; Game.enemyPool = [];
    Game.pickups = []; Game.powerups = []; Game.runes = []; Game.petDrops = [];
    Game.splats = []; Game.hazObjs = [];
    Projectiles.clear(); EnemyBullets.clear(); FX.clear();
    const p = new Player(0, 'sunny');
    p.x = Game.level.w / 2; p.y = Game.level.h / 2;
    p.hp = 999; p.maxHp = 999;
    p.addWeapon('klingel', 0);
    Game.players = [p];
    /* Gegner: 4 in Waffenreichweite (Klingel cone, ~560-660 Range) */
    const mkEnemy = (defId, dx, dy, hpMul) => {
      const e = new Enemy();
      e.spawn(ENEMY_BY_ID[defId], p.x + dx, p.y + dy, 1, null);
      if (hpMul) { e.maxHp *= hpMul; e.hp = e.maxHp; }
      Game.enemies.push(e);
      return e;
    };
    const e1 = mkEnemy('runner', 150, 0, 1);
    mkEnemy('runner', 180, 60, 1);
    mkEnemy('runner', 200, -50, 1);
    mkEnemy('runner', 240, 30, 1);
    /* Manueller Status-Träger: Burn auf einem Gegner, damit tickStatus geprüft wird */
    const eBurn = mkEnemy('runner', 300, -120, 1);
    eBurn.burn = 8; eBurn.burnT = 2; /* 8 DPS ueber 2 s */
    Game.hash.clear();
    for (const e of Game.enemies) if (!e.dead) Game.hash.insert(e);
    /* Frames treiben: 6 s bei 60 Hz */
    const frames = 360, dt = 1 / 60;
    let minHp = Infinity, negHp = 0;
    for (let i = 0; i < frames; i++) {
      Game.update(dt);
      for (const e of Game.enemies) {
        if (!e.dead) {
          if (e.hp < minHp) minHp = e.hp;
          if (e.hp < 0) negHp++;
          if (!isFinite(e.hp) || !isFinite(e.x) || !isFinite(e.y)) {
            this._ok(false, 'Loop: kein NaN/Inf in hp/x/y (Frame ' + i + ', ' + e.def.id + ')');
            Game.danger = D0; Game.mods = M0; UI.renderHud = oldRenderHud;
            return;
          }
        }
      }
    }
    /* 1. Schaden floss: Gesamtschaden > 0, Gegner haben verloren */
    this._ok(Game.run.dmg > 0, 'Loop: run.dmg > 0 (' + Math.round(Game.run.dmg) + ' Schaden in 6 s)');
    const alive = Game.enemies.filter(e => !e.dead).length;
    const spawned = 5;
    this._ok(alive < spawned, 'Loop: mindestens ein Gegner starb (lebend: ' + alive + '/' + spawned + ')');
    /* 2. Reaktionen flossen: Klingel wendet shock an -> Ketten-Reaktion */
    this._ok(Game.run.track.reactions > 0, 'Loop: Ketten-Reaktionen ausgeloest (' + Game.run.track.reactions + ')');
    /* 3. Status-Ticks flossen: Burn senkte HP des Traegers */
    this._ok(eBurn.burnT < 2 && eBurn.hp < eBurn.maxHp, 'Loop: Burn-Tick senkte HP (burnT ' + eBurn.burnT.toFixed(2) + ', hp ' + Math.round(eBurn.hp) + '/' + Math.round(eBurn.maxHp) + ')');
    /* 4. Konsistenz: keine negative HP im Lauf, kills == enemies entfernt */
    this._ok(negHp === 0, 'Loop: keine negativen HP waehrend des Laufs (' + negHp + ')');
    this._ok(Game.run.kills + alive === spawned, 'Loop: kills + lebend = gespawnt (' + Game.run.kills + '+' + alive + '=' + spawned + ')');
    Game.danger = D0; Game.mods = M0; UI.renderHud = oldRenderHud;
  },
  _extendedSystems() {
    /* Deterministischer Run-Seed, Sunny-Roller und spielerzentriertes Targeting. */
    const oldRand = RAND, oldEnemies = Game.enemies, oldHash = Game.hash;
    const a = Game.setRunSeed(0x12345678), seqA = [RAND(), RAND(), RAND(), RAND()];
    const b = Game.setRunSeed(0x12345678), seqB = [RAND(), RAND(), RAND(), RAND()];
    this._ok(a === b && seqA.every((v, i) => v === seqB[i]), 'Game: gleicher Run-Seed erzeugt identischen Zufallsstrom');
    const p = new Player(0, 'sunny');
    p.rollerBattery = 100;
    const boosted = p.activateRollerBoost();
    this._ok(boosted && p.rollerBoostT > 0 && p.rollerBattery < 100, 'Sunny: E-Roller-Boost startet und verbraucht Akku');
    const normal = new Enemy(); normal.spawn(ENEMY_BY_ID.runner, 12, 0, 1, null);
    const boss = new Enemy(); boss.spawn(ENEMY_BY_ID.elite, 220, 0, 1, null); boss.boss = true;
    Game.enemies = [normal, boss]; Game.hash = new SpatialHash(110); Game.hash.insert(normal); Game.hash.insert(boss);
    const target = Game.nearestEnemy(0, 0, 400);
    this._ok(target === boss, 'Game: Auto-Ziel priorisiert Boss vor normalem Gegner');
    Game.enemies = oldEnemies; Game.hash = oldHash; RAND = oldRand;
  },
  _audioBudget() {
    /* Reiner Audio-Vertrag: SFX-Stimmen werden begrenzt, Musik bleibt frei. */
    AudioSys.resetVoiceBudget();
    let accepted = 0;
    for (let i = 0; i < 40; i++) if (AudioSys.voiceBudget('sfx', 0)) accepted++;
    this._ok(accepted === AudioSys.maxSfxVoices(), 'Audio: SFX-Voice-Limit wird eingehalten (' + accepted + ')');
    this._ok(AudioSys.voiceBudget('music', 0), 'Audio: Musik-Voice wird nicht vom SFX-Limit blockiert');
    AudioSys.resetVoiceBudget();
    this._ok(AudioSys.voiceBudget('sfx', .2), 'Audio: neues Zeitfenster nimmt SFX wieder an');
    const oldMul = AudioSys._sMul, oldPan = AudioSys._sPan, oldFar = AudioSys._sFar, oldSfx = AudioSys.sfx, oldAudioStarted = AudioSys.started, oldCam = Game.cam, oldSfxOpt = Save.data.opts.sfx;
    let called = false;
    AudioSys.started = true; Save.data.opts.sfx = 1; Game.cam = { x: 0, y: 0 };
    AudioSys._sMul = NaN; AudioSys._sPan = NaN; AudioSys._sFar = NaN;
    AudioSys.sfx = () => { called = true; };
    AudioSys.sfxAt('e_roar', NaN, 0, NaN);
    this._ok(!called && Number.isFinite(AudioSys._sMul) && Number.isFinite(AudioSys._sPan) && Number.isFinite(AudioSys._sFar), 'Audio: ungueltige Positionsdaten vergiften keinen SFX-Zustand');
    AudioSys.sfx = oldSfx; AudioSys.started = oldAudioStarted; Game.cam = oldCam; Save.data.opts.sfx = oldSfxOpt; AudioSys._sMul = oldMul; AudioSys._sPan = oldPan; AudioSys._sFar = oldFar;
    const oldQ = Save.data.opts.quality; Save.data.opts.quality = 0;
    this._ok(AudioSys.maxSfxVoices() === 12, 'Audio: Mobilprofil begrenzt SFX staerker');
    const oldAudioCtx = AudioSys.ctx, oldIRCache = AudioSys._irCache, oldStarted = AudioSys.started, oldReverb = AudioSys.reverb, oldReverbWet = AudioSys.reverbWet;
    let mobileWet = null;
    AudioSys.ctx = { sampleRate: 1000, currentTime: 0, createBuffer(chans, n) { return { numberOfChannels: chans, length: n, getChannelData: () => new Float32Array(n) }; } };
    AudioSys._irCache = {};
    const mobileIR = AudioSys._makeIR('default');
    this._ok(mobileIR.numberOfChannels === 1, 'Audio: Mobilprofil erzeugt einkanaligen Raumklang');
    AudioSys.started = true; AudioSys.reverb = {}; AudioSys.reverbWet = { gain: { setTargetAtTime(v) { mobileWet = v; } } };
    AudioSys.applyRoom('default');
    this._ok(Math.abs(mobileWet - .3) < 1e-9, 'Audio: Mobilprofil reduziert Raumklang auf 75 Prozent');
    AudioSys.ctx = oldAudioCtx; AudioSys._irCache = oldIRCache; AudioSys.started = oldStarted; AudioSys.reverb = oldReverb; AudioSys.reverbWet = oldReverbWet;
    Save.data.opts.quality = oldQ;
    this._ok(Game.qualityProfile().name === 'Hoch' && Game.qualityProfile().shadows === true, 'Qualitaet: Hoch aktiviert Schattenprofil');
  },
  _longRunContracts() {
    const oldState = { state: Game.state, mods: Game.mods, level: Game.level, players: Game.players, enemies: Game.enemies, hash: Game.hash, wave: Game.wave, waveTimer: Game.waveTimer, waveDuration: Game.waveDuration, run: Game.run, renderHud: UI.renderHud };
    const oldRand = RAND;
    Combat.setWorld(Game); Game.state = 'play'; Game.mods = []; Game.wave = 1; Game.waveDuration = 1; Game.waveTimer = .04;
    Game.run = { kills: 0, bosses: 0, dmg: 0, materials: 0, time: 0, track: { reactions: 0, elemDmg: 0, maxChain: 0 } };
    Game.level = new Level(ARENAS[0], 1); Game.hash = new SpatialHash(110); Game.enemies = []; Game.players = [new Player(0, 'sunny')];
    Game.players[0].x = Game.level.w / 2; Game.players[0].y = Game.level.h / 2; Game.players[0].addWeapon('klingel', 0);
    UI.renderHud = () => {};
    const seenWaves = [];
    const oldEnd = Game.endWave, oldNext = Game.nextLevelOrShop;
    Game.endWave = function () { seenWaves.push(this.wave); this.waveEnding = false; this.waveTimer = 0; this.wave++; if (this.wave <= 3) this.waveTimer = .04; };
    Game.nextLevelOrShop = () => {};
    for (let i = 0; i < 180; i++) { Game.update(1 / 60); if (!isFinite(Game.waveTimer) || !isFinite(Game.wave)) this._ok(false, 'LongRun: Wellenwerte bleiben endlich'); }
    this._ok(seenWaves.length >= 2 && Game.wave >= 3, 'LongRun: echte Game.update ueberquert mindestens zwei Wellen');
    this._ok(Game.players[0].rollerBattery >= 0 && Game.players[0].rollerBattery <= 100, 'LongRun: Sunny-Akku bleibt im gueltigen Bereich');
    Game.endWave = oldEnd; Game.nextLevelOrShop = oldNext; UI.renderHud = oldState.renderHud; Object.assign(Game, oldState); RAND = oldRand;
  },
  _qualityContracts() {
    const old = Save.data.opts.quality;
    Save.data.opts.quality = 0;
    const q0 = Game.qualityProfile();
    Save.data.opts.quality = 2;
    const q2 = Game.qualityProfile();
    Save.data.opts.quality = old;
    this._ok(q0.name === 'Mobil' && q0.particles === 0 && q0.shadows === false, 'Qualitaet: Stufe 0 bleibt erreichbar und schaltet Effekte ab');
    this._ok(q2.name === 'Hoch' && q2.shadows === true, 'Qualitaet: Stufe 2 bleibt voll aktiv');
  },
  _characterContracts() {
    const ids = CHARS.map(c => c.id);
    const profiles = ids.map(id => CharacterProfiles[id]);
    this._ok(profiles.every(Boolean), 'Charaktere: jeder Held besitzt ein Profil');
    this._ok(profiles.every(p => p.figure && p.animation && p.moveSet), 'Charaktere: Figur, Animation und Moveset sind vollständig');
    this._ok(new Set(profiles.map(p => p.figure)).size === ids.length, 'Charaktere: jede Figur hat eine eigene Silhouette');
    this._ok(new Set(profiles.map(p => p.animation)).size === ids.length, 'Charaktere: jede Animation hat einen eigenen Stil');
    this._ok(new Set(profiles.map(p => p.moveSet.id)).size === ids.length, 'Charaktere: jedes Moveset ist eigenständig');
    this._ok(profiles.every(p => p.moveSet.speed > 0 && p.moveSet.dash > 0 && p.moveSet.rollCd > 0), 'Charaktere: Moveset-Werte sind spielbar');
    const p = new Player(0, 'sunny');
    this._ok(p.profile === CharacterProfiles.sunny && p.profile.moveSet.id === 'sunny-roller', 'Charaktere: Player übernimmt Sunnys eigenes Moveset');
    this._ok(typeof Player.prototype.drawFigureIdentity === 'function', 'Charaktere: Player besitzt eine eigene Figuren-Render-Schicht');
  },
  _brotatoContracts() {
    this._ok(BROTATO_RULES.maxWeapons === 6 && BROTATO_RULES.shopOffers === 6, 'Brotato-Regeln: sechs Waffenplätze und sechs Shop-Angebote');
    this._ok(BROTATO_RULES.autoFire === true && BROTATO_RULES.shopBetweenWaves === true, 'Brotato-Regeln: Auto-Fire und Shop zwischen Wellen');
    this._ok(typeof BROTATO_RULES.rerollCost === 'function' && BROTATO_RULES.rerollCost(1) < BROTATO_RULES.rerollCost(10), 'Brotato-Regeln: Reroll-Kosten skalieren mit der Welle');
    const shopPlayer = new Player(0, 'leonidas');
    ShopSystem.generate(1, [shopPlayer]);
    this._ok(ShopSystem.offers.length === BROTATO_RULES.shopOffers, 'Brotato-Regeln: echter Shop erzeugt genau sechs Angebote');
    const p = new Player(0, 'nova');
    for (let i = 0; i < BROTATO_RULES.maxWeapons; i++) p.addWeapon('pistol', 0);
    this._ok(p.weapons.length === BROTATO_RULES.maxWeapons && !p.addWeapon('smg', 0), 'Brotato-Regeln: Waffenlimit wird im echten Player eingehalten');
    let emptyShopOk = true;
    try {
      ShopSystem.generate(20, []);
      emptyShopOk = ShopSystem.offers.length === BROTATO_RULES.shopOffers && ShopSystem.offers.every(o => Number.isFinite(o.price) && (o.kind !== 'weapon' || Number.isFinite(o.tier)));
    } catch (e) { emptyShopOk = false; }
    this._ok(emptyShopOk, 'Brotato-Grenze: leerer Spieler-Pool erzeugt endliche, normal skalierte Angebote');
    const oldMaterials = Game.materials, oldRerolls = ShopSystem.rerolls;
    const oldOffers = ShopSystem.offers, oldBought = ShopSystem.bought, oldLocked = ShopSystem.locked;
    ShopSystem.generate(1, [shopPlayer]);
    ShopSystem.locked = { 0: 1 }; ShopSystem.generate(2, [shopPlayer]);
    this._ok(Object.keys(ShopSystem.locked).length === 0, 'Brotato-State: neue Welle übernimmt keine alten Shop-Sperren');
    ShopSystem.generate(1, [shopPlayer]);
    const lockedOffer = ShopSystem.offers[2];
    ShopSystem.locked = { 2: 1 }; ShopSystem.bought = {}; ShopSystem.rerolls = 0; Game.materials = 9999;
    ShopSystem.reroll(1, [shopPlayer]);
    this._ok(ShopSystem.offers[2] === lockedOffer && ShopSystem.locked[2] === 1, 'Brotato-Ordering: gesperrtes Angebot bleibt auf seinem Slot');
    ShopSystem.locked = { 0: 1 }; ShopSystem.bought = { 0: 1 }; ShopSystem.reroll(1, [shopPlayer]);
    this._ok(Object.keys(ShopSystem.locked).length === 0, 'Brotato-State: gekaufte Sperre bleibt nach Reroll nicht hängen');
    ShopSystem.offers = oldOffers; ShopSystem.bought = oldBought; ShopSystem.locked = oldLocked; ShopSystem.rerolls = oldRerolls; Game.materials = oldMaterials;
  },
  /* Online-Koop: was ohne Gegenstelle pruefbar ist - Codec, MQTT-Draht und die
     Zusicherung, dass Ferneingaben nur mit Verbindung bei Spieler 2 ankommen. */
  _net() {
    const code = Net.roomCode();
    this._ok(code.length === 6 && /^[A-Z0-9]+$/.test(code) && !/[IO01]/.test(code), 'Net: Raumcode 6 Zeichen ohne I/O/0/1');
    this._ok(Net.normCode(' k7-m 2x abcd ') === 'K7M2XA', 'Net: normCode saeubert und kuerzt auf 6');
    const bytes = new Uint8Array([0, 1, 127, 128, 255, 65, 66]);
    this._ok(Array.from(Net.unb64(Net.b64(bytes))).join() === Array.from(bytes).join(), 'Net: base64 Roundtrip inkl. fehlendem Padding');
    /* Nutzlast > 127 Byte erzwingt einen mehrbyte-Varint - genau der Fall echter SDPs. */
    const big = 'x'.repeat(500);
    const pub = MqttWire.publish('wbns/ABC123/h2c', big);
    const one = MqttWire.parse(pub);
    this._ok(one.msgs.length === 1 && one.msgs[0].payload === big, 'MQTT: PUBLISH mit mehrbyte-Laenge ueberlebt den Parser');
    const conn = MqttWire.connect('abc');
    this._ok(conn[0] === 0x10 && conn.length === 2 + conn[1], 'MQTT: CONNECT-Kopf und Restlaenge stimmen');
    const frame = new Uint8Array(pub.length + 5);
    frame.set(pub); frame.set(pub.subarray(0, 5), pub.length);
    const mixed = MqttWire.parse(frame);
    this._ok(mixed.msgs.length === 1 && mixed.rest.length === 5, 'MQTT: ganzes Paket kommt an, angeschnittenes bleibt gepuffert');
    const role = Net.role, phase = Net.phase, remote = Net.remote, acts = Net.acts;
    Net.remote = { mx: 1, my: 1, ax: 0, ay: 0, aim: 0, sk: 0, t: 1 };
    Net.role = null; Net.phase = 'idle';
    const idle = Input.moveVec(1);
    Net.role = 'host'; Net.phase = 'connected';
    const live = Input.moveVec(1);
    this._ok(idle.x === 0 && idle.y === 0 && live.x > 0 && live.y > 0, 'Net: Ferneingabe erreicht Spieler 2 nur mit Verbindung');
    Net.acts = { dash: 1 };
    this._ok(Net.takeAct('dash') === true && Net.takeAct('dash') === false, 'Net: Aktion wird genau einmal eingeloest');
    this._ok(MqttWire.ping().length === 2 && MqttWire.ping()[0] === 0xC0 && MqttWire.ping()[1] === 0,
      'MQTT: PINGREQ ist C0 00 - haelt die Broker-Sitzung offen');
    const status = Net.status;
    Net.fail('Testgrund');
    this._ok(Net.phase === 'error' && Net.role === null && Net.status === 'Testgrund' && Net.pc === null,
      'Net: fail() raeumt ab, vergisst die Rolle und meldet den Grund');
    Net.status = status; Net.phase = 'idle';
    Net.role = role; Net.phase = phase; Net.remote = remote; Net.acts = acts;
  },
  _render() {
    let el = $('selfTestPanel');
    if (!el) {
      el = document.createElement('div');
      el.id = 'selfTestPanel';
      el.style.cssText = 'position:fixed;top:12px;right:12px;z-index:99999;background:rgba(5,10,20,.95);border:1px solid #334155;border-radius:12px;padding:14px 16px;font:12px/1.6 ui-monospace,monospace;color:#dbe4f0;max-width:430px;box-shadow:0 8px 30px rgba(0,0,0,.6)';
      document.body.appendChild(el);
    }
    const pass = this.results.filter(r => r.ok).length;
    const fail = this.results.length - pass;
    const rows = this.results.map(r => '<div style="color:' + (r.ok ? '#4ade80' : '#f87171') + '">' + (r.ok ? '✔' : '✘') + ' ' + r.name + '</div>').join('');
    el.innerHTML = '<div style="font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin-bottom:8px">Selftest ' + pass + '/' + this.results.length + (fail ? ' · <span style="color:#f87171">FAIL</span>' : ' · <span style="color:#4ade80">PASS</span>') + '</div>' + rows + '<div style="margin-top:8px;color:#94a3b8">Seite mit ?selftest öffnen</div>';
  }
};
window.addEventListener('DOMContentLoaded', () => { Game.init(); if (location.search.indexOf('selftest') >= 0) setTimeout(() => SelfTest.run(), 300); });
if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(() => { if (!Game.ctx) { Game.init(); if (location.search.indexOf('selftest') >= 0) setTimeout(() => SelfTest.run(), 300); } }, 0);
