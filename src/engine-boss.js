Object.assign(Game, {
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
});
