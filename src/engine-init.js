Object.assign(Game, {
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
    let t0 = null, saege = null, abgebrochen = false, schnitt = null, fetzen = null, funkenSpur = null;
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

    /* Funkenspritzer entlang der ganzen Schnittkante - einmal beim Aufprall
       gesetzt, spruehen dann nach aussen und verglimmen, bevor die Fetzen weg
       sind. Parametrisch in fs (Fortschritt der Schnittphase), damit sie bei
       rAF-Aussetzern nicht springen. */
    const baueFunken = () => {
      funkenSpur = [];
      const N = 64, cols = ['#fff3b0', '#ffd24a', '#ff8a3d', '#ffffff'];
      for (let i = 0; i < N; i++) {
        const fx = i / (N - 1);
        const ang = Math.random() * Math.PI * 2, spd = 60 + Math.random() * 190;
        funkenSpur.push({
          ox: fx * W + (Math.random() - .5) * 6, oy: linieY(fx) + (Math.random() - .5) * 6,
          vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd - 50, g: 130 + Math.random() * 160,
          col: cols[i % 4], sz: 1.4 + Math.random() * 1.8, life: .45 + Math.random() * .3
        });
      }
    };

    const zeichneFunken = (fs) => {
      x.save();
      x.globalCompositeOperation = 'lighter';
      for (const s of funkenSpur) {
        const a = 1 - fs / s.life;
        if (a <= 0) continue;
        const px = s.ox + s.vx * fs, py = s.oy + s.vy * fs + s.g * fs * fs;
        x.globalAlpha = a; x.fillStyle = s.col;
        x.fillRect(px - s.sz / 2, py - s.sz / 2, s.sz, s.sz);
        x.globalAlpha = a * .5;   /* kurzer Schweif hinter dem Funken */
        x.fillRect(px - s.vx * .02 - s.sz / 2, py - s.vy * .02 - s.sz / 2, s.sz * .7, s.sz * .7);
      }
      x.restore();
    };

    const zeichneFetzen = (f) => {
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
      if (!schnitt) { schnappschuss(); baueFetzen(); baueFunken(); }
      const fs = ts / T_SCHNITT;
      /* Leichte Kameraerschuetterung beim Aufprall, klingt in ~35% der Phase ab. */
      const sAmp = 8 * Math.pow(1 - Math.min(1, fs / .35), 2);
      const shx = Math.sin(fs * 46) * sAmp, shy = Math.cos(fs * 53) * sAmp * .8;
      x.clearRect(0, 0, W, H);
      x.save();
      x.translate(shx, shy);
      zeichneFetzen(fs);
      zeichneFunken(fs);
      x.restore();
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
});
