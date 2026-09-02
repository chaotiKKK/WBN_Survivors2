Object.assign(Game, {
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
});
