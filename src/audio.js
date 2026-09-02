/* ============================ 3. AUDIO ============================ */
const AudioSys = {
  ctx: null, master: null, musicGain: null, sfxGain: null, started: false, musicTimer: 0, musicStep: 0, musicOn: false,
  ambientId: null, hum: null, birdTimer: 0, crackleT: 0, bossMode: false, _song: null, motor: [null, null],
  _voiceBudgetTime: null, _voiceBudgetCounts: {},
  resetVoiceBudget() { this._voiceBudgetTime = null; this._voiceBudgetCounts = {}; },
  maxSfxVoices() { return (OPT().quality != null ? OPT().quality : 2) <= 1 ? 12 : 18; },
  voiceBudget(kind, now) {
    if (kind !== 'sfx') return true;
    /* Beim Offline-Backen gilt kein Laufzeit-Budget: sonst fehlen dem
       fertigen Sample einzelne Schichten (und der Zaehler stammt aus der
       laufenden Sitzung, deren Zeitachse eine voellig andere ist). */
    if (this._baking) return true;
    const t = Number.isFinite(now) ? now : 0;
    if (this._voiceBudgetTime === null || t - this._voiceBudgetTime >= .08) {
      this._voiceBudgetTime = t; this._voiceBudgetCounts.sfx = 0;
    }
    if ((this._voiceBudgetCounts.sfx || 0) >= this.maxSfxVoices()) return false;
    this._voiceBudgetCounts.sfx = (this._voiceBudgetCounts.sfx || 0) + 1;
    return true;
  },
  init() {
    if (this.ctx) { try { if (this.ctx.state === 'suspended' && this.ctx.resume) this.ctx.resume(); } catch (e) { } return; }
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    try { if (this.ctx.state === 'suspended' && this.ctx.resume) this.ctx.resume(); } catch (e) { }
    this.master = this.ctx.createGain(); this.master.gain.value = OPT().master;
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.knee.value = 24; this.comp.ratio.value = 10;
    this.comp.attack.value = .003; this.comp.release.value = .25;
    this.presence = this.ctx.createBiquadFilter(); this.presence.type = 'peaking'; this.presence.frequency.value = 2600; this.presence.gain.value = 0.6; this.presence.Q.value = .5;
    this.limiter = this.ctx.createWaveShaper(); this.limiter.oversample = '2x'; this.limiter.curve = this._clipCurve(1.2);
    this.master.connect(this.comp); this.comp.connect(this.presence); this.presence.connect(this.limiter); this.limiter.connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain(); this.sfxGain.gain.value = OPT().sfx; this.sfxGain.connect(this.master);
    this.musicComp = this.ctx.createDynamicsCompressor();
    this.musicComp.threshold.value = -12; this.musicComp.knee.value = 6; this.musicComp.ratio.value = 8;
    this.musicComp.attack.value = .004; this.musicComp.release.value = .18;
    this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = OPT().music * .5;
    this.duck = this.ctx.createGain(); this.duck.gain.value = 1;
    this.musicFilter = this.ctx.createBiquadFilter(); this.musicFilter.type = 'lowpass'; this.musicFilter.frequency.value = 20000; this.musicFilter.Q.value = .8;
    /* musicDrive entfernt: per-voice drive reicht, doppelte Sättigung vermieden */
    this.pump = this.ctx.createGain(); this.pump.gain.value = 1;
    this.dangerFilter = this.ctx.createBiquadFilter(); this.dangerFilter.type = 'lowpass'; this.dangerFilter.frequency.value = 20000; this.dangerFilter.Q.value = .5;
    this.musicGain.connect(this.musicFilter); this.musicFilter.connect(this.dangerFilter); this.dangerFilter.connect(this.pump); this.pump.connect(this.musicComp); this.musicComp.connect(this.duck); this.duck.connect(this.master);
    const q = OPT().quality != null ? OPT().quality : 2;
    this.reverbSend = this.ctx.createGain(); this.reverbSend.gain.value = 1;
    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this._makeIR('default');
    this.reverbWet = this.ctx.createGain(); this.reverbWet.gain.value = q === 0 ? .3 : .42;
    this.reverbSend.connect(this.reverb); this.reverb.connect(this.reverbWet); this.reverbWet.connect(this.master);
    this.echoIn = this.ctx.createGain(); this.echoIn.gain.value = 1;
    const dl = this.ctx.createDelay(1); dl.delayTime.value = .21;
    const dFl = this.ctx.createBiquadFilter(); dFl.type = 'lowpass'; dFl.frequency.value = 2600;
    const dFb = this.ctx.createGain(); dFb.gain.value = .34;
    const dWet = this.ctx.createGain(); dWet.gain.value = .22;
    this.echoIn.connect(dl); dl.connect(dFl); dFl.connect(dFb); dFb.connect(dl); dFl.connect(dWet); dWet.connect(this.master);
    this.started = true;
    /* Ab hier laeuft Musik — auch im Menue. Frueher wurde musicOn erst in
       startRun() gesetzt, der Titelbildschirm blieb also stumm. */
    this.musicOn = true;
    /* Die Sample-Bank wird ab jetzt im Hintergrund gerendert. Bis ein Klang
       fertig ist, greift der (budgetierte) Synthese-Rueckfall. */
    try { this.startBaking(); } catch (e) { }
  },
  refresh() { if (!this.ctx) return; this.master.gain.value = OPT().master; this.sfxGain.gain.value = OPT().sfx; this.musicGain.gain.value = OPT().music * .5; },
  /* ============================================================
     ADAPTIVE GEFAHRENSCHICHT
     Sinkt die Lebensenergie, legt sich ein Sub-Drone unter die
     Musik, das Hauptsignal wird dunkler und ein langsamer Puls
     setzt ein — ohne die laufende Arrangement-Logik anzufassen.
     ============================================================ */
  setDanger(v) { this._dangerWant = clamp(v || 0, 0, 1); },
  _dangerTick(dt) {
    if (!this.started) return;
    const want = OPT().music > 0 ? (this._dangerWant || 0) : 0;
    this._dangerNow = lerp(this._dangerNow || 0, want, 1 - Math.pow(.12, dt));
    const d = this._dangerNow;
    const c = this.ctx, t = c.currentTime;
    if (d > .015 && !this.dangerVoice) {
      const mk = (type, f, det) => {
        const o = c.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = det || 0;
        return o;
      };
      const g = c.createGain(); g.gain.value = 0;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220; f.Q.value = 1.2;
      const o1 = mk('sawtooth', 32.7, -6), o2 = mk('sawtooth', 32.7, 7), o3 = mk('sine', 65.4, 0);
      const sh = c.createWaveShaper(); sh.oversample = '2x'; sh.curve = this._clipCurve(1.4);
      o1.connect(f); o2.connect(f); o3.connect(f);
      f.connect(sh); sh.connect(g); g.connect(this.musicGain);
      const lfo = c.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = .28;
      const lg = c.createGain(); lg.gain.value = 40;
      lfo.connect(lg); lg.connect(f.frequency);
      o1.start(); o2.start(); o3.start(); lfo.start();
      this.dangerVoice = { g: g, f: f, o: [o1, o2, o3, lfo] };
      this._pulseT = 0;
    }
    if (this.dangerVoice) {
      this.dangerVoice.g.gain.setTargetAtTime(d * .085, t, .35);
      this.dangerVoice.f.frequency.setTargetAtTime(180 + d * 190, t, .5);
      if (d < .01) {
        try { this.dangerVoice.o.forEach(o => o.stop(t + .3)); } catch (e) { }
        this.dangerVoice = null;
      }
    }
    if (this.dangerFilter) this.dangerFilter.frequency.setTargetAtTime(20000 - d * 17400, t, .4);
    /* langsamer Herzschlag ab hoher Gefahr */
    if (d > .45) {
      this._pulseT = (this._pulseT || 0) - dt;
      if (this._pulseT <= 0) {
        this._pulseT = 1.15 - d * .45;
        this.voice({ freq: 46, dur: .22, type: 'sine', vol: .05 * d, slide: -12, cutoff: 150, release: .16, sub: 1, dest: this.musicGain });
        this.voice({ freq: 44, dur: .16, type: 'sine', vol: .035 * d, slide: -10, cutoff: 140, release: .12, sub: 1, start: .17, dest: this.musicGain });
      }
    }
  },
  duckMusic(amt, dur) {
    if (!this.started || !this.duck) return;
    const t = this.ctx.currentTime;
    this.duck.gain.cancelScheduledValues(t);
    this.duck.gain.setValueAtTime(Math.max(.05, this.duck.gain.value), t);
    this.duck.gain.linearRampToValueAtTime(Math.max(.15, amt != null ? amt : .5), t + .02);
    this.duck.gain.setTargetAtTime(1, t + .02, (dur != null ? dur : .3));
  },
  _clipCurve(k) {
    if (!this._clipCache) this._clipCache = {};
    const key = Math.round(k * 100) / 100;
    if (this._clipCache[key]) return this._clipCache[key];
    const n = 1024, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * k); }
    this._clipCache[key] = c;
    return c;
  },
  voice(o) {
    if (!this.started) return;
    const c = this.ctx, t = c.currentTime + (o.start || 0);
    const dur = o.dur || .1;
    const dest = o.dest || this.sfxGain;
    if (dest === this.sfxGain && !this.voiceBudget('sfx', c.currentTime)) return;
    const posM = dest === this.sfxGain ? (this._sMul != null ? this._sMul : 1) : 1;
    const posP = dest === this.sfxGain ? (this._sPan || 0) : 0;
    const vol = (o.vol != null ? o.vol : .2) * posM;
    const attack = o.attack != null ? o.attack : .006;
    const rel = Math.min(o.release != null ? o.release : .07, dur + .2);
    const out = c.createGain();
    out.gain.setValueAtTime(.0001, t);
    out.gain.linearRampToValueAtTime(vol, t + attack);
    const hold = Math.max(0, dur - attack - rel * .5);
    if (hold > .001) out.gain.setValueAtTime(vol, t + attack + hold);
    out.gain.exponentialRampToValueAtTime(.0001, t + dur + rel);
    let bus = out;
    if (o.drive) { const sh = c.createWaveShaper(); sh.curve = this._clipCurve(o.drive); bus.connect(sh); bus = sh; }
    const pv = clamp((o.pan || 0) + posP, -1, 1);
    if (pv && c.createStereoPanner) { const pn = c.createStereoPanner(); pn.pan.value = pv; bus.connect(pn); bus = pn; }
    bus.connect(dest);
    if (o.verb) { const s = c.createGain(); s.gain.value = o.verb; out.connect(s); s.connect(this.reverbSend); }
    if (o.echo) { const s = c.createGain(); s.gain.value = o.echo; out.connect(s); s.connect(this.echoIn); }
    const filt = c.createBiquadFilter();
    filt.type = 'lowpass';
    const nyq = (c.sampleRate || 44100) / 2;
    filt.frequency.setValueAtTime(Math.min(nyq, Math.max(30, o.cutoff || 5000)), t);
    if (o.cutoffEnd) filt.frequency.exponentialRampToValueAtTime(Math.min(nyq, Math.max(40, o.cutoffEnd)), t + dur);
    filt.Q.value = o.q != null ? o.q : .5;
    const n = Math.max(1, Math.round(o.stack || 1));
    const jit = (o.jit != null ? o.jit : (dest === this.sfxGain ? 6 : 0)) * (Math.random() * 2 - 1);
    for (let i = 0; i < n; i++) {
      const osc = c.createOscillator();
      if (o.periodicWave) osc.setPeriodicWave(o.periodicWave); else osc.type = o.type || 'square';
      const det = (i - (n - 1) / 2) * ((o.detune || 0) + (o.spread || 0)) + jit;
      osc.frequency.setValueAtTime(Math.max(20, o.freq * Math.pow(2, det / 1200)), t);
      if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.freq + o.slide), t + dur);
      osc.connect(filt);
      osc.start(t); osc.stop(t + dur + rel + .05);
    }
    if (o.sub) {
      const so = c.createOscillator(); so.type = 'sine';
      const sf = Math.max(20, o.freq / 2);
      so.frequency.setValueAtTime(sf * Math.pow(2, jit / 1200), t);
      if (o.slide) so.frequency.exponentialRampToValueAtTime(Math.max(20, (o.freq + o.slide) / 2), t + dur);
      so.connect(filt);
      so.start(t); so.stop(t + dur + rel + .05);
    }
    if (o.noise) {
      /* Der Puffer kommt aus dem Cache — fruehere Fassungen erzeugten hier je
         Schuss bis zu 24000 Zufallswerte auf dem Hauptthread. */
      const ns = c.createBufferSource(); ns.buffer = this._nbuf('white', Math.min(dur + rel, .5));
      const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 2000; nf.Q.value = .8;
      const ng = c.createGain(); ng.gain.value = o.noise;
      ns.connect(nf); nf.connect(ng); ng.connect(out);
      ns.start(t);
    }
    filt.connect(out);
  },
  /* Einmalig erzeugter 2.4s-White-Noise-Buffer, von dem alle Geräusche mit Zufalls-Offset lesen */
  _noiseBuf() { return this._nbuf('white', 2.4); },
  noiseVoice(dur, vol, ftype, f0, f1, q, o) {
    if (!this.started) return;
    const c = this.ctx, t = c.currentTime + ((o && o.start) || 0);
    const _dst = (o && o.dest) || this.sfxGain;
    if (_dst === this.sfxGain) { vol *= (this._sMul != null ? this._sMul : 1); }
    const sr = c.sampleRate || 44100;
    const n = Math.max(1, Math.floor(sr * dur));
    const buf = this._noiseBuf();
    const off = Math.max(0, Math.min(1, ((Math.random() * (buf.length - n)) | 0) / sr));
    const src = c.createBufferSource(); src.buffer = buf;
    const fl = c.createBiquadFilter(); fl.type = ftype || 'lowpass';
    const hz = 1 + (Math.random() * 2 - 1) * .05;
    fl.frequency.setValueAtTime((f0 || 1000) * hz, t);
    if (f1) fl.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    fl.Q.value = q || .8;
    const g = c.createGain();
    const at = (o && o.attack) || .003;
    g.gain.setValueAtTime(.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + at);
    g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    src.connect(fl); fl.connect(g);
    let bus = g;
    if (o && o.drive) { const sh = c.createWaveShaper(); sh.curve = this._clipCurve(o.drive); bus.connect(sh); bus = sh; }
    const _pv = clamp(((o && o.pan) || 0) + (_dst === this.sfxGain ? (this._sPan || 0) : 0), -1, 1);
    if (_pv && c.createStereoPanner) { const pn = c.createStereoPanner(); pn.pan.value = _pv; bus.connect(pn); bus = pn; }
    bus.connect(_dst);
    if (o && o.verb) { const s = c.createGain(); s.gain.value = o.verb; g.connect(s); s.connect(this.reverbSend); }
    src.start(t, off, dur);
  },
  /* ---- Kettensaege: Zweitakter statt Einzelklang ----
     Ein Saegegeraeusch ist Dauerton mit Drehzahl, kein Schuss. Zwei verstimmte
     Saegezaehne bilden den Motor, gefiltertes Rauschen die Kette, ein LFO das
     Stottern im Leerlauf. `rev` zieht Drehzahl und Helligkeit hoch - damit
     laesst sich das Hochreissen der Saege hoerbar machen. */
  chainsaw(dur, vol) {
    if (!this.started || OPT().sfx <= 0) return null;
    const c = this.ctx, t = c.currentTime;
    const g = c.createGain();
    g.gain.setValueAtTime(.0001, t);
    g.gain.exponentialRampToValueAtTime((vol || .22) * (this._sMul != null ? this._sMul : 1), t + .12);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t); lp.Q.value = 1.4;
    const nodes = [];
    for (const det of [0, 7, -5]) {
      const osc = c.createOscillator(); osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(78, t); osc.detune.value = det;
      const og = c.createGain(); og.gain.value = det ? .30 : .55;
      osc.connect(og); og.connect(lp); osc.start(t); nodes.push(osc);
    }
    /* Kette: schmalbandiges Rauschen, das mit der Drehzahl mitgeht */
    const ns = c.createBufferSource(); ns.buffer = this._nbuf('white', Math.min(dur + .4, 3));
    ns.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2100, t); bp.Q.value = 3.2;
    const ng = c.createGain(); ng.gain.value = .16;
    ns.connect(bp); bp.connect(ng); ng.connect(lp); ns.start(t); nodes.push(ns);
    /* Stottern im Leerlauf */
    const lfo = c.createOscillator(); lfo.type = 'square'; lfo.frequency.setValueAtTime(11, t);
    const lg = c.createGain(); lg.gain.value = .16;
    lfo.connect(lg); lg.connect(g.gain); lfo.start(t); nodes.push(lfo);
    lp.connect(g); g.connect(this.sfxGain);
    const stop = () => {
      const e = c.currentTime;
      g.gain.cancelScheduledValues(e);
      g.gain.setValueAtTime(Math.max(.0001, g.gain.value), e);
      g.gain.exponentialRampToValueAtTime(.0001, e + .22);
      for (const n of nodes) { try { n.stop(e + .3); } catch (err) { } }
    };
    return {
      /* 0 = Leerlauf, 1 = Vollgas */
      rev(v) {
        const e = c.currentTime;
        const f = 78 + 118 * v;
        for (const n of nodes) if (n.frequency && n.type === 'sawtooth') n.frequency.linearRampToValueAtTime(f, e + .10);
        lp.frequency.linearRampToValueAtTime(900 + 3400 * v, e + .10);
        bp.frequency.linearRampToValueAtTime(2100 + 2600 * v, e + .10);
        lfo.frequency.linearRampToValueAtTime(11 + 26 * v, e + .10);
        lg.gain.linearRampToValueAtTime(.16 * (1 - v * .8), e + .10);
      },
      stop
    };
  },
  bassPulse(vol = .2) {
    this.voice({ freq: 55, dur: .5, type: 'sine', vol, slide: -20, cutoff: 240, release: .25, dest: this.musicGain });
    this.voice({ freq: 55, dur: .18, type: 'sawtooth', vol: vol * .35, cutoff: 200, cutoffEnd: 60, release: .12, dest: this.musicGain });
  },
  /* ============================================================
     REALISTISCHE SFX-ENGINE
     Statt einfacher Beeps: geschichtete Klangkörper aus
     Transiente (Crack) + Druckwelle (Blast) + Materialresonanz
     + Mechanik (Verschluss, Hülse) + Raumfahne (Tail).
     Rauschquellen: weiß / rosa / braun / Knister — gecacht.
     ============================================================ */
  _nbuf(kind, sec) {
    if (!this._bufs) this._bufs = {};
    const s = Math.min(2.4, Math.max(.05, sec || .3));
    const key = kind + '|' + Math.ceil(s * 20);
    if (this._bufs[key]) return this._bufs[key];
    const c = this.ctx, n = Math.max(128, Math.floor(c.sampleRate * (Math.ceil(s * 20) / 20)));
    const b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    if (kind === 'pink') {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        b0 = .99886 * b0 + w * .0555179; b1 = .99332 * b1 + w * .0750759; b2 = .96900 * b2 + w * .1538520;
        b3 = .86650 * b3 + w * .3104856; b4 = .55000 * b4 + w * .5329522; b5 = -.7616 * b5 - w * .0168980;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * .5362) * .11;
        b6 = w * .115926;
      }
    } else if (kind === 'brown') {
      let last = 0;
      for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; last = (last + .022 * w) / 1.022; d[i] = last * 3.4; }
    } else if (kind === 'crackle') {
      for (let i = 0; i < n; i++) d[i] = Math.random() < .022 ? (Math.random() * 2 - 1) : (Math.random() * 2 - 1) * .04;
    } else if (kind === 'grain') {
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (Math.random() < .35 ? 1 : .12);
    } else {
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    this._bufs[key] = b;
    return b;
  },
  /* Rausch-Stimme mit Mehrstufen-Filterhüllkurve, Sättigung, Panorama, Hall */
  nz(o) {
    if (!this.started) return;
    const c = this.ctx, t = c.currentTime + (o.start || 0);
    const dur = Math.max(.006, o.dur || .1);
    const _dst = o.dest || this.sfxGain;
    const vol = (o.vol != null ? o.vol : .1) * (_dst === this.sfxGain ? (this._sMul != null ? this._sMul : 1) : 1);
    const src = c.createBufferSource();
    src.buffer = this._nbuf(o.kind || 'white', dur + .06);
    src.playbackRate.value = o.rate || 1;
    if (o.rateEnd) src.playbackRate.exponentialRampToValueAtTime(Math.max(.05, o.rateEnd), t + dur);
    let node = src;
    const f = c.createBiquadFilter();
    f.type = o.filter || 'bandpass';
    f.frequency.setValueAtTime(Math.max(20, o.f0 || 1200), t);
    if (o.fMid) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.fMid), t + dur * (o.fMidAt || .22));
    if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + dur);
    f.Q.value = o.q != null ? o.q : 1;
    node.connect(f); node = f;
    if (o.filter2) {
      const f2 = c.createBiquadFilter(); f2.type = o.filter2;
      f2.frequency.setValueAtTime(Math.max(20, o.f2 || 300), t);
      if (o.f2End) f2.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2End), t + dur);
      f2.Q.value = o.q2 != null ? o.q2 : .7;
      node.connect(f2); node = f2;
    }
    const g = c.createGain();
    const at = o.attack != null ? o.attack : .0015;
    g.gain.setValueAtTime(.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + at);
    if (o.hold) g.gain.setValueAtTime(vol, t + at + o.hold);
    g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    node.connect(g); node = g;
    if (o.drive) { const sh = c.createWaveShaper(); sh.oversample = '2x'; sh.curve = this._clipCurve(o.drive); node.connect(sh); node = sh; }
    const _pv = clamp((o.pan || 0) + (_dst === this.sfxGain ? (this._sPan || 0) : 0), -1, 1);
    if (_pv && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = _pv; node.connect(p); node = p; }
    node.connect(_dst);
    if (o.verb) { const s = c.createGain(); s.gain.value = o.verb; g.connect(s); s.connect(this.reverbSend); }
    if (o.echo) { const s = c.createGain(); s.gain.value = o.echo; g.connect(s); s.connect(this.echoIn); }
    src.start(t); src.stop(t + dur + .06);
  },
  /* Materialresonanz: angeschlagener Körper (Holz, Metall, Stein, Knochen, Glas) */
  res(f, dur, vol, o) {
    o = o || {};
    if (!this.started) return;
    const c = this.ctx, t = c.currentTime + (o.start || 0);
    const partials = o.partials || [1, 2.42, 4.1];
    const decay = o.decay || [1, .55, .3];
    const _dst = o.dest || this.sfxGain;
    vol *= (_dst === this.sfxGain ? (this._sMul != null ? this._sMul : 1) : 1);
    const out = c.createGain();
    out.gain.value = 1;
    let node = out;
    if (o.drive) { const sh = c.createWaveShaper(); sh.oversample = '2x'; sh.curve = this._clipCurve(o.drive); node.connect(sh); node = sh; }
    const _pv = clamp((o.pan || 0) + (_dst === this.sfxGain ? (this._sPan || 0) : 0), -1, 1);
    if (_pv && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = _pv; node.connect(p); node = p; }
    node.connect(_dst);
    if (o.verb) { const s = c.createGain(); s.gain.value = o.verb; out.connect(s); s.connect(this.reverbSend); }
    const src = c.createBufferSource();
    src.buffer = this._nbuf('white', .05);
    const eg = c.createGain();
    eg.gain.setValueAtTime(1, t);
    eg.gain.exponentialRampToValueAtTime(.0001, t + Math.min(.03, dur * .4));
    src.connect(eg);
    partials.forEach((p, i) => {
      const bp = c.createBiquadFilter(); bp.type = 'bandpass';
      bp.frequency.value = Math.max(30, f * p * (1 + crnd(-.01, .01)));
      bp.Q.value = o.q || 18;
      const g = c.createGain();
      const d = dur * (decay[i] != null ? decay[i] : .3);
      g.gain.setValueAtTime(.0001, t);
      g.gain.linearRampToValueAtTime(vol * (1 / (1 + i * .9)), t + .002);
      g.gain.exponentialRampToValueAtTime(.0001, t + Math.max(.02, d));
      eg.connect(bp); bp.connect(g); g.connect(out);
    });
    src.start(t); src.stop(t + dur + .06);
  },
  /* Vokalisierung mit Formanten — Grundlage aller Kreaturlaute */
  _formant(o) {
    if (!this.started) return;
    const c = this.ctx, t = c.currentTime + (o.start || 0);
    const dur = o.dur || .3;
    const _dst = o.dest || this.sfxGain;
    const vol = (o.vol != null ? o.vol : .08) * (_dst === this.sfxGain ? (this._sMul != null ? this._sMul : 1) : 1);
    const out = c.createGain();
    out.gain.setValueAtTime(.0001, t);
    out.gain.linearRampToValueAtTime(vol, t + (o.attack || .02));
    out.gain.setValueAtTime(vol, t + dur * (o.holdTo || .55));
    out.gain.exponentialRampToValueAtTime(.0001, t + dur);
    let node = out;
    if (o.drive) { const sh = c.createWaveShaper(); sh.oversample = '2x'; sh.curve = this._clipCurve(o.drive); node.connect(sh); node = sh; }
    const _pv = clamp((o.pan || 0) + (_dst === this.sfxGain ? (this._sPan || 0) : 0), -1, 1);
    if (_pv && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = _pv; node.connect(p); node = p; }
    node.connect(_dst);
    if (o.verb) { const s = c.createGain(); s.gain.value = o.verb; out.connect(s); s.connect(this.reverbSend); }
    const bus = c.createGain(); bus.gain.value = 1;
    const osc = c.createOscillator(); osc.type = o.type || 'sawtooth';
    osc.frequency.setValueAtTime(Math.max(20, o.f), t);
    if (o.fMid) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.fMid), t + dur * .35);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + dur);
    if (o.vib) {
      const lo = c.createOscillator(); lo.type = 'sine'; lo.frequency.value = o.vibHz || 7;
      const lg = c.createGain(); lg.gain.value = o.vib;
      lo.connect(lg); lg.connect(osc.detune); lo.start(t); lo.stop(t + dur + .06);
    }
    osc.connect(bus); osc.start(t); osc.stop(t + dur + .06);
    if (o.sub) {
      const so = c.createOscillator(); so.type = 'sine'; so.frequency.setValueAtTime(Math.max(20, o.f * .5), t);
      if (o.f1) so.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1 * .5), t + dur);
      const sg = c.createGain(); sg.gain.value = o.sub;
      so.connect(sg); sg.connect(bus); so.start(t); so.stop(t + dur + .06);
    }
    if (o.breath) {
      const ns = c.createBufferSource(); ns.buffer = this._nbuf('pink', dur + .06);
      const ng = c.createGain(); ng.gain.value = o.breath;
      ns.connect(ng); ng.connect(bus); ns.start(t); ns.stop(t + dur + .06);
    }
    const F = o.formants || [620, 1180, 2500], A = o.famp || [1, .48, .2];
    F.forEach((ff, i) => {
      const bp = c.createBiquadFilter(); bp.type = 'bandpass';
      bp.frequency.setValueAtTime(ff, t);
      if (o.fSweep) bp.frequency.exponentialRampToValueAtTime(Math.max(60, ff * o.fSweep), t + dur);
      bp.Q.value = o.fq || 7;
      const g = c.createGain(); g.gain.value = A[i] != null ? A[i] : .25;
      bus.connect(bp); bp.connect(g); g.connect(out);
    });
  },
  /* ---- Raumfahne: Nachhall eines lauten Ereignisses ---- */
  rTail(size, vol, pan) {
    const s = clamp(size || .5, .1, 1);
    this.nz({ kind: 'pink', dur: .25 + s * 1.1, vol: (vol || .05) * s, filter: 'lowpass', f0: 2600, f1: 300 + s * 200, q: .6, attack: .01 + s * .03, verb: .55, pan: pan || 0 });
    this.nz({ kind: 'brown', dur: .35 + s * 1.4, vol: (vol || .05) * .6, filter: 'lowpass', f0: 500, f1: 90, q: .5, attack: .04, verb: .5 });
  },
  /* ---- Waffenmechanik: Verschluss, Abzug, Federn ---- */
  rMech(vol, heavy) {
    const v = vol || .05, p = crnd(-.16, .16);
    this.res(heavy ? 2100 : 3400, .05, v, { partials: [1, 1.87, 3.1], decay: [1, .5, .28], q: 22, pan: p, drive: 1.2 });
    this.nz({ kind: 'grain', dur: .03, vol: v * .8, filter: 'highpass', f0: 2600, f1: 5200, q: 1, attack: .0006, pan: p });
    if (heavy) this.res(1100, .09, v * .6, { partials: [1, 2.1], decay: [1, .5], q: 16, pan: -p, start: .022 });
  },
  /* ---- Patronenhülse fällt zu Boden ---- */
  rCasing(vol) {
    const v = vol || .028, p = crnd(-.3, .3), base = crnd(2600, 3800);
    for (let i = 0; i < 3; i++) {
      this.res(base * (1 + i * .17), .12 - i * .03, v * (1 - i * .28), {
        partials: [1, 2.76, 5.4], decay: [1, .5, .25], q: 26, pan: p + crnd(-.06, .06),
        start: .16 + i * crnd(.05, .11), verb: .18
      });
    }
  },
  /* ---- Schuss: Crack + Blast + Körper + Mechanik + Fahne ---- */
  rShot(o) {
    o = o || {};
    const cal = clamp(o.cal != null ? o.cal : .5, .05, 1);
    const v = (o.vol != null ? o.vol : .15) * (o.sup ? .42 : 1);
    const p = o.pan != null ? o.pan : crnd(-.12, .12);
    /* Entfernungsprofil: 0 = direkt am Ohr, 1 = weit weg */
    const far = clamp(this._sFar || 0, 0, 1.6);
    const near = 1 - clamp(far, 0, 1);
    if (!o.sup && near > .12)
      this.nz({ kind: 'white', dur: .009 + cal * .009, vol: v * 1.3 * near * near, filter: 'highpass', f0: (2400 - cal * 700) * (1 - far * .45), f1: 5400 * (1 - far * .5), q: .7, attack: .0005, drive: 2.2 + cal, pan: p });
    this.nz({
      kind: 'pink', dur: (.045 + cal * .14) * (1 + far * .55), vol: v * (1 - far * .25),
      filter: 'lowpass', f0: (1500 + cal * 1000) * (1 - far * .6), fMid: 620 * (1 - far * .45), fMidAt: .1,
      f1: 95 + cal * 55, q: .95, attack: .0008 + far * .004, drive: (1.7 + cal) * (1 - far * .35),
      pan: p, verb: o.sup ? .05 : .18 + far * .5
    });
    this.voice({ freq: 150 - cal * 62, dur: (.1 + cal * .22) * (1 + far * .3), type: 'sine', vol: v * 1.05 * (1 - far * .18), slide: -(38 + cal * 30), cutoff: 300, release: .12 + cal * .12, sub: .9, pan: p * .4 });
    this.res(180 + cal * 120, .08 + cal * .1, v * .35 * near, { partials: [1, 2.3, 3.8], decay: [1, .5, .3], q: 9, pan: p, drive: 1.4 });
    if (!o.sup) this.rTail(.25 + cal * .6 + far * .5, v * (.3 + far * .5), -p * .5);
    if (o.mech !== false && near > .3) this.rMech(v * .28 * near, cal > .55);
    if (o.casing !== false && near > .45 && Math.random() < .8) this.rCasing(v * .2 * near);
  },
  /* ---- Materialeinschlag (Wand, Boden, Objekt) ---- */
  rMat(mat, vol, pan) {
    const v = vol || .1, p = pan != null ? pan : crnd(-.2, .2);
    if (mat === 'stone') {
      this.nz({ kind: 'white', dur: .045, vol: v, filter: 'bandpass', f0: 2600, f1: 700, q: 1.1, attack: .0006, drive: 1.8, pan: p });
      this.res(340, .16, v * .7, { partials: [1, 2.7, 5.1], decay: [1, .5, .25], q: 12, pan: p, verb: .3, drive: 1.3 });
      this.nz({ kind: 'grain', dur: .18, vol: v * .3, filter: 'highpass', f0: 1800, f1: 3600, q: 1, attack: .01, start: .03, pan: -p });
    } else if (mat === 'wood') {
      this.res(210, .2, v, { partials: [1, 2.05, 3.6, 5.9], decay: [1, .6, .35, .2], q: 14, pan: p, verb: .22, drive: 1.3 });
      this.nz({ kind: 'grain', dur: .07, vol: v * .7, filter: 'bandpass', f0: 1400, f1: 400, q: 1.4, attack: .0008, drive: 1.5, pan: p });
    } else if (mat === 'metal') {
      this.res(1250, .5, v, { partials: [1, 2.76, 5.4, 8.9], decay: [1, .7, .45, .25], q: 26, pan: p, verb: .4 });
      this.nz({ kind: 'white', dur: .03, vol: v * .8, filter: 'highpass', f0: 3200, f1: 6800, q: .8, attack: .0004, drive: 2, pan: p });
    } else if (mat === 'glass') {
      for (let i = 0; i < 5; i++) this.res(crnd(2400, 5200), crnd(.12, .3), v * crnd(.3, .7), { partials: [1, 2.9], decay: [1, .5], q: 30, pan: crnd(-.3, .3), start: i * crnd(.01, .05), verb: .35 });
      this.nz({ kind: 'white', dur: .05, vol: v * .7, filter: 'highpass', f0: 4200, f1: 8200, q: .8, attack: .0005, pan: p });
    } else if (mat === 'water') {
      this.nz({ kind: 'pink', dur: .22, vol: v, filter: 'bandpass', f0: 900, f1: 2600, q: 1.1, attack: .004, pan: p, verb: .25 });
      for (let i = 0; i < 4; i++) this.voice({ freq: crnd(500, 1400), dur: .05, type: 'sine', vol: v * .3, slide: crnd(280, 700), cutoff: 3800, q: 2, start: crnd(.01, .12), pan: crnd(-.3, .3) });
    } else { /* dirt */
      this.nz({ kind: 'brown', dur: .09, vol: v, filter: 'lowpass', f0: 900, f1: 160, q: 1, attack: .001, drive: 1.5, pan: p });
      this.nz({ kind: 'grain', dur: .13, vol: v * .35, filter: 'bandpass', f0: 1200, f1: 500, q: 1.2, attack: .006, start: .02, pan: -p });
    }
  },
  /* ---- Nasser Fleischtreffer (Schlamm/Matsch — bleibt für Gegner) ---- */
  _gloop(f, vol, pan, start) {
    this.voice({ freq: f, dur: .1, type: 'sine', vol: vol, slide: -f * .62, cutoff: 480, cutoffEnd: 150, q: 1.6, release: .09, drive: 1.15, pan: pan || 0, start: start || 0 });
    this.voice({ freq: f * .5, dur: .16, type: 'triangle', vol: vol * .55, slide: -f * .22, cutoff: 300, cutoffEnd: 110, release: .12, pan: pan || 0, start: start || 0 });
  },
  _suck(vol, pan, start) {
    this.nz({ kind: 'brown', dur: .1, vol: vol, filter: 'bandpass', f0: 900, fMid: 480, f1: 200, q: 1.2, attack: .003, drive: 1.4, pan: pan || 0, start: start || 0 });
    this.nz({ kind: 'pink', dur: .06, vol: vol * .6, filter: 'lowpass', f0: 1700, f1: 380, q: .9, pan: pan || 0, start: start || 0 });
  },
  _spatter(n, vol, spread) {
    for (let i = 0; i < n; i++) {
      this.nz({
        kind: 'grain', dur: crnd(.02, .055), vol: vol * crnd(.5, 1), filter: 'bandpass',
        f0: crnd(600, 1700), f1: crnd(180, 460), q: 1.7, attack: .0008, drive: 1.25,
        pan: crnd(-.3, .3), start: Math.random() * (spread || .12)
      });
    }
  },
  _squelch(strength, pan) {
    const s = clamp(strength == null ? .5 : strength, .15, 1.4);
    const p = pan != null ? pan : crnd(-.16, .16);
    this._gloop(crnd(150, 230) * (1 + (1 - s) * .35), .12 * s, p, 0);
    this._suck(.13 * s, p, .006);
    this.nz({ kind: 'brown', dur: .06 * (1 + s), vol: .1 * s, filter: 'lowpass', f0: 760, f1: 130, q: 1.2, drive: 1.6, pan: p });
    this.res(120, .1, .05 * s, { partials: [1, 1.9], decay: [1, .45], q: 7, pan: p, drive: 1.2 });
    this.voice({ freq: crnd(60, 82), dur: .13, type: 'sine', vol: .1 * s, slide: -26, cutoff: 200, release: .1, sub: .8, pan: p * .5 });
    this._spatter(1 + Math.floor(s * 3), .045 * s, .05);
  },
  _splat(strength) {
    const s = clamp(strength == null ? 1 : strength, .3, 1.6);
    const p = crnd(-.12, .12);
    this._squelch(s * 1.05, p);
    this.nz({ kind: 'brown', dur: .24 * s, vol: .1 * s, filter: 'lowpass', f0: 1000, f1: 85, q: 1, attack: .002, drive: 1.9, pan: p, verb: .16 });
    this.voice({ freq: 52, dur: .26, type: 'sine', vol: .11 * s, slide: -16, cutoff: 170, release: .18, sub: 1, verb: .14 });
    this._gloop(crnd(95, 140), .07 * s, -p, .045);
    this._spatter(3 + Math.floor(s * 4), .05 * s, .16);
  },
  _drip(vol) {
    const v = vol || .03;
    this.voice({ freq: crnd(320, 520), dur: .07, type: 'sine', vol: v, slide: -180, cutoff: 1400, cutoffEnd: 300, q: 2.2, release: .05, pan: crnd(-.25, .25) });
    this.nz({ kind: 'white', dur: .03, vol: v * .6, filter: 'bandpass', f0: 900, f1: 300, q: 2, pan: crnd(-.25, .25) });
  },
  /* ---- Durchbrechen / Durchschlag: Reißen, Splittern, Knacken ---- */
  rPierce(strength, pan) {
    const s = clamp(strength || 1, .3, 2);
    const p = pan != null ? pan : crnd(-.18, .18);
    this.nz({ kind: 'grain', dur: .1 * s, vol: .1 * s, filter: 'bandpass', f0: 2800, fMid: 1500, f1: 520, q: 2.2, attack: .0008, drive: 1.9, pan: p });
    this.nz({ kind: 'crackle', dur: .16 * s, vol: .075 * s, filter: 'highpass', f0: 1400, f1: 3400, q: 1, attack: .004, rate: 1.15, drive: 1.5, pan: -p, start: .012 });
    this.res(430, .13, .07 * s, { partials: [1, 2.4, 4.7], decay: [1, .5, .25], q: 15, pan: p, drive: 1.4, verb: .2 });
    this.voice({ freq: 118, dur: .12, type: 'sine', vol: .07 * s, slide: -44, cutoff: 300, release: .08, sub: .7, pan: p * .4 });
    this._spatter(2, .035 * s, .07);
  },
  /* ---- Zerplatzen: nasser Bersteffekt mit Nachspritzern ---- */
  rBurst(strength) {
    const s = clamp(strength || 1, .3, 2);
    const p = crnd(-.12, .12);
    this.nz({ kind: 'white', dur: .022, vol: .12 * s, filter: 'highpass', f0: 1200, f1: 4200, q: .8, attack: .0005, drive: 2.2, pan: p });
    this.nz({ kind: 'brown', dur: .3 * s, vol: .13 * s, filter: 'lowpass', f0: 1500, fMid: 520, f1: 80, q: 1, attack: .001, drive: 2, pan: p, verb: .25 });
    this.voice({ freq: 88, dur: .34, type: 'sine', vol: .13 * s, slide: -46, cutoff: 220, release: .24, sub: 1, verb: .2 });
    this._gloop(crnd(180, 250), .1 * s, -p, .01);
    this._spatter(6 + Math.floor(s * 5), .05 * s, .28);
    for (let i = 0; i < 3; i++) this._drip(.02 * s);
  },
  /* ---- Trümmerregen ---- */
  rDebris(n, vol, mat) {
    for (let i = 0; i < n; i++) {
      const st = .05 + Math.random() * .55;
      if (mat === 'metal') this.res(crnd(900, 2400), crnd(.08, .2), vol * crnd(.3, .8), { partials: [1, 2.7], decay: [1, .45], q: 24, pan: crnd(-.35, .35), start: st, verb: .25 });
      else this.nz({ kind: 'grain', dur: crnd(.02, .06), vol: vol * crnd(.3, .9), filter: 'bandpass', f0: crnd(700, 2200), f1: crnd(200, 600), q: 1.8, attack: .0008, pan: crnd(-.35, .35), start: st, verb: .2 });
    }
  },
  /* ---- Explosion ---- */
  rBoom(size, vol) {
    const s = clamp(size || .6, .15, 1.4), v = vol || .2, p = crnd(-.08, .08);
    const far = clamp(this._sFar || 0, 0, 1.6), near = 1 - clamp(far, 0, 1);
    if (near > .1) this.nz({ kind: 'white', dur: .018, vol: v * 1.1 * near, filter: 'highpass', f0: 1800 * (1 - far * .5), f1: 6200 * (1 - far * .5), q: .7, attack: .0004, drive: 2.6, pan: p });
    this.nz({ kind: 'pink', dur: .12 + s * .3, vol: v * 1.15, filter: 'lowpass', f0: 2200, fMid: 700, fMidAt: .08, f1: 70, q: .9, attack: .001, drive: 2.2 + s, pan: p, verb: .35 });
    this.voice({ freq: 74 - s * 22, dur: .35 + s * .5, type: 'sine', vol: v * 1.2, slide: -(24 + s * 16), cutoff: 210, release: .3 + s * .25, sub: 1, verb: .4 });
    this.nz({ kind: 'brown', dur: .5 + s * .9, vol: v * .55, filter: 'lowpass', f0: 420, f1: 60, q: .6, attack: .03, verb: .5 });
    this.rTail(.5 + s * .5, v * .45, -p);
    this.rDebris(Math.round(4 + s * 8), v * .22);
  },
  /* ---- Luftzug / Schwung ---- */
  rWhoosh(spd, vol, pan) {
    const s = clamp(spd || .6, .1, 1.5), v = vol || .07, p = pan != null ? pan : crnd(-.25, .25);
    this.nz({ kind: 'pink', dur: .16 + s * .18, vol: v, filter: 'bandpass', f0: 420, fMid: 1500 + s * 900, fMidAt: .45, f1: 380, q: 1.3, attack: .03, pan: p, verb: .18 });
    this.nz({ kind: 'white', dur: .1, vol: v * .35, filter: 'highpass', f0: 1800, f1: 4200, q: .9, attack: .04, pan: -p * .6 });
  },
  /* ---- Kreaturlaute ---- */
  rVox(kind, vol, pan) {
    const v = vol || .08, p = pan != null ? pan : crnd(-.2, .2);
    if (kind === 'growl') {
      this._formant({ f: crnd(72, 96), fMid: crnd(60, 80), f1: crnd(48, 64), dur: crnd(.3, .48), vol: v, type: 'sawtooth', formants: [340, 780, 1650], famp: [1, .42, .14], fq: 6, vib: 22, vibHz: 18, breath: .18, sub: .5, drive: 1.6, pan: p, verb: .28 });
    } else if (kind === 'screech') {
      this._formant({ f: crnd(560, 820), fMid: crnd(900, 1300), f1: crnd(420, 620), dur: crnd(.22, .34), vol: v * .8, type: 'sawtooth', formants: [1200, 2600, 4200], famp: [1, .6, .3], fq: 9, vib: 45, vibHz: 24, breath: .3, drive: 1.8, pan: p, verb: .35 });
    } else if (kind === 'chitter') {
      for (let i = 0; i < 5; i++) this._formant({ f: crnd(380, 620), f1: crnd(280, 460), dur: .035, vol: v * .55, type: 'square', formants: [900, 2100, 3400], famp: [1, .5, .2], fq: 11, start: i * crnd(.035, .06), pan: p + crnd(-.1, .1) });
    } else if (kind === 'roar') {
      this._formant({ f: crnd(52, 68), fMid: crnd(78, 96), f1: crnd(40, 52), dur: crnd(.75, 1.05), vol: v * 1.25, type: 'sawtooth', formants: [260, 620, 1400], famp: [1, .5, .2], fq: 5, vib: 30, vibHz: 11, breath: .28, sub: .8, drive: 1.9, pan: p, verb: .45, holdTo: .7 });
      this.nz({ kind: 'brown', dur: .9, vol: v * .35, filter: 'lowpass', f0: 700, f1: 150, q: .8, attack: .12, verb: .4 });
    } else if (kind === 'mech') {
      this._formant({ f: crnd(96, 128), f1: crnd(70, 92), dur: .28, vol: v * .7, type: 'square', formants: [420, 980, 2400], famp: [1, .55, .3], fq: 14, vib: 60, vibHz: 34, drive: 2, pan: p });
      this.nz({ kind: 'crackle', dur: .2, vol: v * .3, filter: 'bandpass', f0: 2200, f1: 3600, q: 2, attack: .01, pan: -p });
    } else if (kind === 'hurt') {
      this._formant({ f: crnd(150, 210), fMid: crnd(120, 170), f1: crnd(80, 120), dur: .26, vol: v, type: 'sawtooth', formants: [560, 1180, 2400], famp: [1, .45, .18], fq: 7, vib: 24, vibHz: 15, breath: .22, drive: 1.4, pan: p, verb: .25 });
    } else if (kind === 'spawn') {
      this._formant({ f: crnd(120, 180), f1: crnd(240, 340), dur: .3, vol: v * .8, type: 'sawtooth', formants: [480, 1100, 2200], famp: [1, .5, .25], fq: 8, fSweep: 1.8, breath: .25, drive: 1.5, pan: p, verb: .3 });
      this.nz({ kind: 'grain', dur: .22, vol: v * .4, filter: 'bandpass', f0: 700, f1: 2200, q: 1.6, attack: .06, pan: -p });
    }
  },
  /* ---- Schritte auf Untergrund ---- */
  _footstep(vol, hard, mat) {
    const v = vol || .05;
    this._stepAlt = !this._stepAlt;
    const p = crnd(-.14, .14);
    const f = (this._stepAlt ? 106 : 126) * (hard ? 1.12 : 1);
    this.voice({ freq: f, dur: .085, type: 'sine', vol: v, slide: -f * .55, cutoff: 380, release: .07, pan: p });
    if (mat === 'stone' || hard) {
      this.nz({ kind: 'white', dur: .035, vol: v * .8, filter: 'bandpass', f0: 2200, f1: 900, q: 1.4, attack: .0008, drive: 1.4, pan: p });
      this.res(620, .08, v * .35, { partials: [1, 2.4], decay: [1, .4], q: 14, pan: p, verb: .22 });
    } else if (mat === 'water') {
      this.nz({ kind: 'pink', dur: .13, vol: v * .9, filter: 'bandpass', f0: 800, f1: 2200, q: 1.1, attack: .003, pan: p, verb: .2 });
    } else {
      this.nz({ kind: 'brown', dur: .055, vol: v * .75, filter: 'lowpass', f0: 620, f1: 170, q: 1, attack: .001, drive: 1.2, pan: p });
      this.nz({ kind: 'grain', dur: .04, vol: v * .4, filter: 'bandpass', f0: 1500, f1: 700, q: 1.6, attack: .001, pan: p });
    }
    if (Math.random() < .35) this.nz({ kind: 'grain', dur: .03, vol: v * .25, filter: 'highpass', f0: 3200, f1: 5400, q: 1.4, pan: p });
  },
  /* ---- Kompatibilitäts-Wrapper (alte Aufrufe) ---- */
  _click(vol) {
    const v = vol || .04, p = crnd(-.12, .12);
    this.res(3200, .035, v, { partials: [1, 2.1], decay: [1, .4], q: 24, pan: p });
    this.nz({ kind: 'grain', dur: .012, vol: v * .9, filter: 'highpass', f0: 2600, f1: 5400, q: 1, attack: .0004, pan: p });
  },
  _chime(freq, vol, verb, start) {
    this.res(freq, .5, vol, { partials: [1, 2.76, 5.4, 8.9], decay: [1, .6, .35, .2], q: 30, verb: verb || .3, start: start || 0 });
    this.voice({ freq: freq, dur: .3, type: 'sine', vol: vol * .5, attack: .002, release: .22, cutoff: 7000, verb: verb || .3, start: start || 0 });
  },
  _sweep(from, to, dur, vol) {
    this.voice({ freq: from, dur: dur, type: 'sawtooth', vol: vol, slide: to - from, stack: 2, detune: 9, cutoff: 2400, cutoffEnd: 500, q: 1.5, drive: 1.3, pan: crnd(-.1, .1) });
    this.nz({ kind: 'pink', dur: dur, vol: vol * .5, filter: 'bandpass', f0: from * 2, f1: to * 2, q: 2.2, attack: .004, pan: crnd(-.1, .1) });
  },
  /* ---- Elektrik / Energie ---- */
  rElectric(vol, dur, pan) {
    const v = vol || .09, d = dur || .12, p = pan != null ? pan : crnd(-.2, .2);
    this.nz({ kind: 'crackle', dur: d, vol: v, filter: 'bandpass', f0: 3200, f1: 1400, q: 3.5, attack: .0008, rate: 1.4, drive: 2, pan: p });
    this.nz({ kind: 'white', dur: d * .5, vol: v * .5, filter: 'highpass', f0: 4200, f1: 8600, q: 1, attack: .0006, drive: 1.8, pan: -p });
    this.voice({ freq: crnd(1700, 2400), dur: d * .4, type: 'square', vol: v * .35, slide: -900, cutoff: 6000, q: 4, drive: 1.6, pan: p });
  },
  /* ---- Flüssigkeit / Wasser ---- */
  rWater(vol, big, pan) {
    const v = vol || .1, p = pan != null ? pan : crnd(-.25, .25);
    this.nz({ kind: 'pink', dur: big ? .5 : .2, vol: v, filter: 'bandpass', f0: 700, fMid: 2100, f1: 900, q: 1, attack: .01, pan: p, verb: .3 });
    for (let i = 0; i < (big ? 8 : 4); i++) this.voice({ freq: crnd(450, 1500), dur: .05, type: 'sine', vol: v * .28, slide: crnd(250, 800), cutoff: 4200, q: 2.4, start: crnd(0, big ? .3 : .12), pan: crnd(-.3, .3) });
  },
  /* ---- Wind ---- */
  rWind(vol, dur, pan) {
    const v = vol || .05, d = dur || 2.2;
    this.nz({ kind: 'pink', dur: d, vol: v, filter: 'bandpass', f0: 380, fMid: 900, fMidAt: .45, f1: 320, q: 1.4, attack: d * .35, pan: pan || crnd(-.3, .3), verb: .4 });
    this.nz({ kind: 'brown', dur: d, vol: v * .6, filter: 'lowpass', f0: 300, f1: 160, q: .7, attack: d * .4, verb: .3 });
  },
  /* Positionsbezogener Sound: Entfernungsdämpfung, Panorama, Höhenverlust */
  sfxAt(name, x, y, volMul) {
    if (!this.started || OPT().sfx <= 0) return;
    if (!Number.isFinite(x) || !Number.isFinite(y) || (volMul != null && !Number.isFinite(volMul))) { this._sMul = 1; this._sPan = 0; this._sFar = 0; return; }
    const cam = Game && Game.cam;
    if (!cam || !Number.isFinite(cam.x) || !Number.isFinite(cam.y)) { this._sMul = 1; this._sPan = 0; this._sFar = 0; return; }
    const dx = x - cam.x, dy = y - cam.y;
    const d = Math.hypot(dx, dy);
    const far = 820;
    if (!Number.isFinite(d) || d > far * 1.9) { this._sMul = 1; this._sPan = 0; this._sFar = 0; return; }
    const att = Math.pow(clamp(1 - d / (far * 1.9), 0, 1), 1.4);
    const mul = (.18 + att * .82) * (volMul != null ? volMul : 1);
    const pan = clamp(dx / (far * .75), -.75, .75);
    const farLevel = clamp(d / far, 0, 1.6);
    if (!Number.isFinite(mul) || !Number.isFinite(pan) || !Number.isFinite(farLevel)) { this._sMul = 1; this._sPan = 0; this._sFar = 0; return; }
    this._sMul = mul; this._sPan = pan; this._sFar = farLevel;
    try {
      /* Entfernung verändert nicht nur den Pegel, sondern den Klang selbst:
         der scharfe Knall verschwindet zuerst, die Raumfahne bleibt übrig. */
      this.sfx(name);
    } finally {
      this._sMul = 1; this._sPan = 0; this._sFar = 0;
    }
  },
  /* ============================================================
     GEBACKENE SFX-BIBLIOTHEK  ("Sample Bank")
     ------------------------------------------------------------
     Bisher baute jeder Schuss und jeder Treffer zur Laufzeit einen
     kompletten Synthesegraphen auf: bis zu 120 AudioNodes und rund
     10 ms Hauptthread-Zeit fuer EINEN Klang. Bei Dauerfeuer mit
     Mehrfachtreffern kamen mehrere hundert Knoten pro Bild zusammen
     - genau das erzeugte das Ruckeln und die Tonaussetzer.

     Loesung wie in richtigen Engines: Der Klang wird EINMAL offline
     gerendert (OfflineAudioContext, laeuft neben dem Hauptthread)
     und danach nur noch als Sample abgespielt. Aus 120 Knoten
     werden 3 bis 5.

     Gebacken wird TROCKEN. Hall und Echo bleiben live, damit die
     Raumakustik jeder Arena (applyRoom) weiter greift und die
     Entfernungsdaempfung echt gefiltert wird statt nur leiser.
     ============================================================ */

  /* Reservierte Laenge je Klang in Sekunden (Messwerte + Reserve).
     Zu kurz = abgeschnittener Nachklang, zu lang = Rechenzeit. */
  BAKE_SLOT: {
   shoot: 0.8, w_suppressed: 0.45, w_pistol: 0.83, w_smg: 0.73, w_shotgun: 1.12, 
   w_chaingun: 1.14, w_sniper: 1.38, w_railgun: 1.01, w_needle: 0.33, laser: 0.3, 
   w_nagler: 0.68, w_schrott: 1.06, w_knife: 0.43, w_spear: 0.4, w_hammer: 0.5, w_wrench: 0.27, 
   w_chopper: 0.36, w_shredder: 0.3, w_flamer: 0.65, w_plasma: 0.37, w_sonic: 1.9, 
   w_gravgun: 0.55, w_tesla: 0.22, w_arc: 0.32, w_frost: 0.3, w_spore: 0.3, w_photon: 0.28, 
   w_vortex: 0.39, w_starfall: 0.32, w_medgun: 0.3, w_loeschwasser: 0.35, w_noten: 0.34, 
   w_bier: 0.31, w_mine: 0.95, w_tauben: 1.14, w_saege: 0.37, w_zirkel: 0.22, w_ableiter: 0.41, 
   w_ratschlag: 0.32, hit: 0.35, crit: 0.46, hitElem: 0.34, hitMelee: 0.51, pierce: 0.3, 
   burst: 0.67, kill: 0.65, shard: 0.65, clank: 0.32, wall: 0.33, wood: 0.13, metal: 0.13, 
   glass: 0.2, splash: 0.32, ric: 0.43, boom: 1.45, hurt: 0.33, step: 0.26, dash: 0.39, 
   blink: 0.37, chain: 0.2, e_shot: 0.95, e_charge: 0.5, e_summon: 0.4, e_heal: 0.68, 
   e_spawn: 0.44, e_growl: 0.55, e_screech: 0.48, e_chitter: 0.32, e_mech: 0.42, drone: 0.45, 
   tick: 0.1, pick: 0.68, ui: 0.23, ok: 0.68, err: 0.32, count: 1.52, telegraph: 0.82, 
   rune: 0.77, pet: 0.64, buy: 0.72, fuse: 1.33, crackle: 0.16, relay: 0.1
  },
  /* Wichtigkeit: bei Ueberlast wird von unten weggelassen. */
  SFX_PRIO: {
    boom: 9, kill: 8, crit: 8, boss: 10, e_roar: 9, thunder: 9, hurt: 10, level: 9, win: 10, over: 10,
    w_shotgun: 8, w_sniper: 8, w_railgun: 8, w_schrott: 8, w_sonic: 8,
    hit: 4, hitMelee: 4, hitElem: 4, pierce: 3, ric: 2, clank: 3, wall: 2, step: 1,
    bird: 1, wind: 1, leaves: 1, traffic: 1, voices: 1, water: 1, gull: 1, steam: 1,
    machine: 1, creak: 1, chainrattle: 1, crackle: 1, relay: 1
  },
  /* Musik-Ducking laeuft beim Sample-Pfad ueber diese Tabelle, weil der
     Synthese-Zweig (in dem duckMusic frueher stand) uebersprungen wird. */
  SFX_DUCK: {
    w_shotgun: [.6, .35], w_sniper: [.45, .5], w_railgun: [.4, .55], w_sonic: [.4, .3],
    w_schrott: [.65, .3], kill: [.55, .25], boom: [.5, .4]
  },
  /* Wie viele identische Instanzen duerfen im selben Moment klingen. */
  SFX_STACK: {
    hit: 2, hitMelee: 2, hitElem: 2, ric: 2, step: 1, clank: 2, pierce: 2, tick: 1,
    w_smg: 3, w_chaingun: 3, e_shot: 3, wall: 2
  },
  /* Hallanteil je Klang beim Sample-Pfad. */
  SFX_VERB: {
    w_shotgun: .3, w_sniper: .42, w_railgun: .3, boom: .4, kill: .26, crit: .2,
    step: .1, tick: .04, ui: .04, ok: .1, hit: .12, ric: .3, glass: .3, metal: .3,
    w_schrott: .3, hurt: .2, e_growl: .28, e_screech: .32
  },

  bank: {}, bankReady: false, _bakeQ: null, _bakeBusy: false, _active: 0, _coal: null,
  _frameStamp: -1, _frameSynth: 0, _coalBoost: 1, _baking: false,

  maxActiveVoices() { const q = OPT().quality != null ? OPT().quality : 2; return q === 0 ? 28 : q === 1 ? 48 : 80; },
  /* Drei Varianten nur dort, wo Wiederholung auffaellt (Dauerfeuer,
     Trefferserien). Alles andere kommt mit zweien aus - das halbiert
     Backzeit und Speicher fuer die lange Restliste. */
  BAKE_HOT: ['hit', 'hitMelee', 'hitElem', 'crit', 'step', 'ric', 'clank', 'pierce', 'shoot',
    'w_pistol', 'w_smg', 'w_chaingun', 'w_knife', 'w_needle', 'w_nagler', 'w_saege', 'w_shredder',
    'e_shot', 'kill', 'wall', 'tick'],
  bakeVariants(name, slot) {
    const q = OPT().quality != null ? OPT().quality : 2;
    if (q === 0) return this.BAKE_HOT.indexOf(name) >= 0 ? 2 : 1;
    if (slot > 1) return 2;
    return this.BAKE_HOT.indexOf(name) >= 0 ? 3 : 2;
  },

  /* Baut den trockenen Offline-Bus. Hall- und Echo-Sends laufen ins Leere,
     weil beide Effekte spaeter live und arenaabhaengig zugemischt werden. */
  _bakeBus(off) {
    const g = off.createGain(); g.gain.value = 1;
    const lim = off.createWaveShaper(); lim.oversample = '2x'; lim.curve = this._clipCurve(1.05);
    g.connect(lim); lim.connect(off.destination);
    const nul = off.createGain(); nul.gain.value = 0; nul.connect(off.destination);
    return { g: g, nul: nul };
  },

  /* Rendert eine Gruppe von (Name, Variante) in EINEM Offline-Durchlauf.
     Der Kniff ist die ueberschriebene currentTime: dadurch landet jeder
     Klang in seinem eigenen Zeitfenster statt alle bei t = 0. */
  _bakeGroup(list) {
    const sr = this.ctx.sampleRate;
    let total = 0;
    for (const it of list) total += it.slot;
    let off;
    try { off = new OfflineAudioContext(2, Math.max(256, Math.ceil(sr * total)), sr); }
    catch (e) { return Promise.reject(e); }
    let clock = 0;
    try { Object.defineProperty(off, 'currentTime', { configurable: true, get: () => clock }); }
    catch (e) { return Promise.reject(e); }
    const bus = this._bakeBus(off);
    const bak = {
      ctx: this.ctx, sfxGain: this.sfxGain, reverbSend: this.reverbSend, echoIn: this.echoIn,
      musicGain: this.musicGain, duck: this.duck, bufs: this._bufs,
      sMul: this._sMul, sPan: this._sPan, sFar: this._sFar
    };
    this.ctx = off; this.sfxGain = bus.g; this.reverbSend = bus.nul; this.echoIn = bus.nul;
    this.musicGain = bus.g; this.duck = null; this._bufs = {};
    this._sMul = 1; this._sPan = 0; this._sFar = 0;
    const vbT = this._voiceBudgetTime, vbC = this._voiceBudgetCounts;
    this._voiceBudgetTime = null; this._voiceBudgetCounts = {};
    this._baking = true;
    let at = 0;
    try {
      for (const it of list) { it.at = at; clock = at; try { this._synth(it.name); } catch (e) { } at += it.slot; }
    } finally {
      this._baking = false;
      this.ctx = bak.ctx; this.sfxGain = bak.sfxGain; this.reverbSend = bak.reverbSend;
      this.echoIn = bak.echoIn; this.musicGain = bak.musicGain; this.duck = bak.duck;
      this._bufs = bak.bufs; this._sMul = bak.sMul; this._sPan = bak.sPan; this._sFar = bak.sFar;
      this._voiceBudgetTime = vbT; this._voiceBudgetCounts = vbC;
    }
    return off.startRendering().then(rendered => {
      const L = rendered.getChannelData(0), R = rendered.getChannelData(1);
      for (const it of list) {
        const s = Math.floor(it.at * sr), e = Math.min(rendered.length, Math.floor((it.at + it.slot) * sr));
        let peak = 0, side = 0;
        for (let i = s; i < e; i++) {
          const a = L[i] < 0 ? -L[i] : L[i], b = R[i] < 0 ? -R[i] : R[i];
          if (a > peak) peak = a;
          if (b > peak) peak = b;
          const d = L[i] - R[i], ad = d < 0 ? -d : d;
          if (ad > side) side = ad;
        }
        if (peak < .0004) continue;                     /* stumm - nicht cachen */
        /* Der Schnitt liegt RELATIV zum Pegel dieses Klangs: 62 dB unter
           dem Maximum ist nicht mehr zu hoeren. Eine absolute Schwelle
           waere fuer leise Laute (Schritte, Knurren) viel zu hoch und
           haette ihnen hoerbar den Ausklang abgeschnitten. */
        const thr = Math.max(2e-5, peak * .0008);
        let end = s;
        for (let i = e - 1; i >= s; i--) {
          const a = L[i] < 0 ? -L[i] : L[i], b = R[i] < 0 ? -R[i] : R[i];
          if ((a > b ? a : b) > thr) { end = i; break; }
        }
        const n = Math.max(64, Math.min(e - s, end - s + Math.floor(sr * .01)));
        /* Ist der Klang praktisch mittig, reicht ein Kanal - halber Speicher. */
        const mono = side < peak * .02;
        const buf = this.ctx.createBuffer(mono ? 1 : 2, n, sr);
        const cl = L.slice(s, s + n), cr = mono ? null : R.slice(s, s + n);
        /* Sicherheitsausblendung ueber die letzten Millisekunden: selbst
           wenn das Zeitfenster den Klang doch einmal kappt, knackt es nicht. */
        const fade = Math.min(Math.floor(sr * .006), Math.floor(n * .25));
        for (let i = 0; i < fade; i++) {
          const g = .5 - .5 * Math.cos(Math.PI * (fade - i) / fade);
          const k = n - fade + i;
          cl[k] *= g; if (cr) cr[k] *= g;
        }
        buf.copyToChannel(cl, 0);
        if (cr) buf.copyToChannel(cr, 1);
        const slot = (this.bank[it.name] = this.bank[it.name] || { v: [], peak: 0 });
        slot.v.push(buf);
        if (peak > slot.peak) slot.peak = peak;
      }
    });
  },

  /* Backt im Hintergrund in kleinen Haeppchen, damit weder Ladezeit noch
     laufendes Spiel spuerbar einbrechen. */
  startBaking() {
    if (!this.started || this._bakeQ || this.bankReady) return;
    if (typeof OfflineAudioContext !== 'function') { this.bankReady = true; return; }
    const q = [];
    for (const name in this.BAKE_SLOT) {
      const sl = this.BAKE_SLOT[name];
      for (let v = 0; v < this.bakeVariants(name, sl); v++) q.push({ name: name, slot: sl });
    }
    /* Haeufigstes zuerst: was im Gefecht knallt, ist als Erstes fertig. */
    const hot = ['hit', 'w_smg', 'w_pistol', 'crit', 'hitMelee', 'step', 'w_chaingun', 'e_shot',
      'shoot', 'kill', 'w_shotgun', 'ric', 'clank', 'boom', 'pierce', 'w_knife', 'tick'];
    q.sort((a, b) => {
      const ia = hot.indexOf(a.name), ib = hot.indexOf(b.name);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    this._bakeQ = q;
    this._bakePump();
  },
  _bakePump() {
    if (this._bakeBusy) return;
    const q = this._bakeQ;
    if (!q || !q.length) {
      this._bakeQ = null; this.bankReady = true;
      this.bakeMs = Math.round(performance.now() - (this._bakeStart || performance.now()));
      return;
    }
    if (!this._bakeStart) this._bakeStart = performance.now();
    this._bakeBusy = true;
    const chunk = [];
    let sec = 0;
    while (q.length && sec < 2.2) { const it = q.shift(); chunk.push(it); sec += it.slot; }
    const done = () => {
      this._bakeBusy = false;
      this._bakeT0 = this._bakeT0 || performance.now();
      /* Bewusst setTimeout statt requestIdleCallback: Leerlauf-Rueckrufe
         werden in Hintergrund-Tabs stark gedrosselt, das Backen wuerde
         dort minutenlang haengen. */
      setTimeout(() => this._bakePump(), 24);
    };
    let p;
    try { p = this._bakeGroup(chunk); } catch (e) { p = null; }
    if (p && p.then) p.then(done, () => { this.bankReady = true; this._bakeQ = null; this._bakeBusy = false; });
    else done();
  },
  /* Ein einzelner Klang wird vorgezogen, sobald er wirklich gebraucht wird. */
  _wantBake(name) {
    const q = this._bakeQ;
    if (!q || !this.BAKE_SLOT[name] || this.bank[name]) return;
    const out = [];
    for (let i = q.length - 1; i >= 0; i--) if (q[i].name === name) out.push(q.splice(i, 1)[0]);
    for (const it of out) q.unshift(it);
  },

  /* ---- Sample-Wiedergabe: 3 bis 5 Knoten statt bis zu 120 ---- */
  playBaked(name, slot) {
    const c = this.ctx, t = c.currentTime;
    const buf = slot.v.length === 1 ? slot.v[0] : slot.v[(Math.random() * slot.v.length) | 0];
    const far = clamp(this._sFar || 0, 0, 1.6);
    const mul = (this._sMul != null ? this._sMul : 1) * (this._coalBoost || 1);
    const pan = clamp(this._sPan || 0, -1, 1);
    const src = c.createBufferSource();
    src.buffer = buf;
    /* leichte Tonhoehen-Streuung, damit Dauerfeuer nicht mechanisch klingt */
    src.playbackRate.value = 1 + (Math.random() * 2 - 1) * .035;
    let node = src;
    if (far > .06) {
      /* Luftdaempfung: Entfernung nimmt zuerst die Hoehen, nicht nur den Pegel */
      const lp = c.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.value = Math.max(650, 19000 * Math.pow(.05, far > 1 ? 1 : far));
      lp.Q.value = .4;
      node.connect(lp); node = lp;
    }
    const g = c.createGain();
    g.gain.value = mul;
    node.connect(g); node = g;
    if (pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; node.connect(p); node = p; }
    node.connect(this.sfxGain);
    /* Hall live und arenaabhaengig - Entfernung erhoeht den Anteil */
    if (this.reverbSend) {
      const w = (this.SFX_VERB[name] != null ? this.SFX_VERB[name] : .16) + far * .3;
      if (w > .02) { const sd = c.createGain(); sd.gain.value = (w > .9 ? .9 : w) * mul; g.connect(sd); sd.connect(this.reverbSend); }
    }
    this._active++;
    src.onended = () => { this._active--; src.onended = null; };
    src.start(t);
    const d = this.SFX_DUCK[name];
    if (d && far < .5) this.duckMusic(d[0], d[1]);
    return true;
  },

  /* ---- Zentraler Verteiler: Sample wenn vorhanden, sonst Synthese ---- */
  sfx(name) {
    if (!this.started || OPT().sfx <= 0) return;
    if (this._baking) { this._synth(name); return; }
    const now = this.ctx.currentTime;
    const fid = (typeof Game !== 'undefined' && Game._frameId) || 0;
    if (this._frameStamp !== fid) { this._frameStamp = fid; this._frameSynth = 0; }
    const prio = this.SFX_PRIO[name] != null ? this.SFX_PRIO[name] : 5;
    /* 1) Koaleszenz: dasselbe Geraeusch im selben Moment nur begrenzt oft.
          Sechs Schrotkugeln auf sechs Gegner ergaben bisher sechs volle
          Trefferklaenge im selben Bild - jetzt zwei, dafuer etwas lauter. */
    const co = (this._coal = this._coal || {});
    let e = co[name];
    if (!e || now - e.t > .07) { e = co[name] = { t: now, n: 0 }; }
    e.n++;
    const maxStack = this.SFX_STACK[name] != null ? this.SFX_STACK[name] : 4;
    if (e.n > maxStack) { this._coalBoost = 1; return; }
    this._coalBoost = 1 + (e.n - 1) * .12;
    /* 2) Stimmen-Budget */
    if (this._active > this.maxActiveVoices() && prio < 8) { this._coalBoost = 1; return; }
    /* 3) Sample-Pfad */
    const slot = this.bank[name];
    if (slot && slot.v.length) { this.playBaked(name, slot); this._coalBoost = 1; return; }
    /* 4) Synthese-Rueckfall - streng budgetiert, damit nie ein Bild platzt */
    this._wantBake(name);
    const budget = prio >= 8 ? 3 : 2;
    if (this._frameSynth >= budget) { this._coalBoost = 1; return; }
    this._frameSynth++;
    const bm = this._sMul != null ? this._sMul : 1;
    this._sMul = bm * this._coalBoost;
    try { this._synth(name); } finally { this._sMul = bm; this._coalBoost = 1; }
  },

  _synth(name) {
    if (!this.started || OPT().sfx <= 0) return;
    switch (name) {
      /* ---------- Schüsse ---------- */
      case 'shoot': this.rShot({ vol: .13, cal: .45 }); break;
      case 'w_suppressed': this.rShot({ vol: .08, cal: .3, sup: true, mech: true, casing: false }); break;
      case 'w_pistol': this.rShot({ vol: .14, cal: .4 }); break;
      case 'w_smg': this.rShot({ vol: .095, cal: .26, casing: Math.random() < .5 }); break;
      case 'w_shotgun':
        this.duckMusic(.6, .35);
        this.rShot({ vol: .21, cal: .95 });
        this.nz({ kind: 'grain', dur: .12, vol: .07, filter: 'bandpass', f0: 2600, f1: 900, q: 1.4, attack: .002, start: .01, pan: crnd(-.2, .2) });
        this.rMech(.05, true);
        break;
      case 'w_chaingun':
        this.rShot({ vol: .085, cal: .3, casing: false });
        this.rMech(.035, false);
        break;
      case 'w_sniper':
        this.duckMusic(.45, .5);
        this.rShot({ vol: .22, cal: 1 });
        this.rTail(1, .07);
        break;
      case 'w_railgun':
        this.duckMusic(.4, .55);
        this.rElectric(.09, .18);
        this.rShot({ vol: .2, cal: .85, mech: false, casing: false });
        this.voice({ freq: 2600, dur: .16, type: 'sawtooth', vol: .06, slide: -2100, cutoff: 7000, q: 5, drive: 1.7, verb: .3 });
        break;
      case 'w_needle':
        this.nz({ kind: 'white', dur: .03, vol: .06, filter: 'highpass', f0: 3200, f1: 6400, q: 1, attack: .0005, drive: 1.6, pan: crnd(-.12, .12) });
        this.rWhoosh(1.1, .035);
        break;
      case 'laser':
        this._sweep(crnd(900, 1100), crnd(300, 450), .12, .055);
        this.rElectric(.04, .05);
        break;
      /* ---------- Nahkampf / Schwung ---------- */
      case 'w_knife': this.rWhoosh(1.2, .07); this.nz({ kind: 'white', dur: .045, vol: .05, filter: 'bandpass', f0: 3400, f1: 900, q: 2.4, attack: .001, pan: crnd(-.15, .15) }); break;
      case 'w_spear': this.rWhoosh(.9, .075); this.rMat('wood', .045); break;
      case 'w_hammer': this.rWhoosh(.55, .08); this.rMat('stone', .13); this.voice({ freq: 78, dur: .22, type: 'sine', vol: .1, slide: -26, cutoff: 200, release: .16, sub: .9 }); break;
      case 'w_wrench': this.rWhoosh(.8, .06); this.rMat('metal', .09); break;
      case 'w_chopper': this.rWhoosh(1, .08); this.nz({ kind: 'grain', dur: .12, vol: .05, filter: 'bandpass', f0: 1300, f1: 380, q: 1.8, attack: .002, drive: 1.5, pan: crnd(-.15, .15) }); break;
      case 'w_shredder':
        this.nz({ kind: 'grain', dur: .14, vol: .08, filter: 'bandpass', f0: 900, f1: 260, q: 2, attack: .001, rate: 1.3, drive: 1.8, pan: crnd(-.15, .15) });
        this.voice({ freq: crnd(140, 175), dur: .12, type: 'sawtooth', vol: .05, slide: -70, cutoff: 1200, cutoffEnd: 340, q: 2, drive: 1.5 });
        break;
      /* ---------- Elementar- und Spezialwaffen ---------- */
      case 'w_flamer':
        this.nz({ kind: 'brown', dur: .5, vol: .09, filter: 'lowpass', f0: 1100, f1: 320, q: 1, attack: .02, drive: 1.7, pan: crnd(-.15, .15), verb: .12 });
        this.nz({ kind: 'crackle', dur: .4, vol: .045, filter: 'bandpass', f0: 2400, f1: 1500, q: 2, attack: .03, rate: .9, pan: crnd(-.2, .2) });
        this.voice({ freq: crnd(95, 120), dur: .4, type: 'sawtooth', vol: .04, slide: -25, cutoff: 700, cutoffEnd: 200, q: 2 });
        break;
      case 'w_plasma':
        this._sweep(crnd(200, 240), crnd(560, 620), .25, .075);
        this.rElectric(.05, .1);
        this.voice({ freq: 90, dur: .18, type: 'sine', vol: .11, slide: 40, cutoff: 500, sub: .6 });
        break;
      case 'w_sonic':
        this.duckMusic(.4, .3);
        this.rBoom(.4, .16);
        this.voice({ freq: 120, dur: .3, type: 'sine', vol: .09, slide: -60, cutoff: 400, release: .2, verb: .3 });
        break;
      case 'w_gravgun':
        this._sweep(crnd(90, 110), crnd(30, 40), .35, .085);
        this.nz({ kind: 'brown', dur: .35, vol: .06, filter: 'lowpass', f0: 400, f1: 90, q: 1.4, attack: .05, drive: 1.4 });
        this.voice({ freq: 55, dur: .3, type: 'sine', vol: .14, slide: -120, cutoff: 300, release: .2, verb: .25, sub: .8 });
        break;
      case 'w_tesla': this.rElectric(.11, .14); break;
      case 'w_arc': this.rElectric(.12, .2); this._sweep(crnd(500, 600), crnd(180, 220), .2, .07); break;
      case 'w_frost':
        this.nz({ kind: 'white', dur: .18, vol: .07, filter: 'highpass', f0: 2200, f1: 6200, q: 1, attack: .004, pan: crnd(-.12, .12), verb: .25 });
        for (let i = 0; i < 4; i++) this.res(crnd(2600, 4600), crnd(.1, .2), .025, { partials: [1, 2.9], decay: [1, .4], q: 28, start: i * .03, verb: .3, pan: crnd(-.25, .25) });
        break;
      case 'w_spore':
        this.nz({ kind: 'brown', dur: .16, vol: .07, filter: 'lowpass', f0: 900, f1: 240, q: 1.3, attack: .004, drive: 1.4, pan: crnd(-.15, .15) });
        this.voice({ freq: crnd(180, 220), dur: .12, type: 'triangle', vol: .06, slide: -110, cutoff: 900, cutoffEnd: 250, q: 2, drive: 1.3 });
        break;
      case 'w_photon':
        this._sweep(crnd(1000, 1200), crnd(500, 600), .16, .065);
        this.voice({ freq: crnd(1400, 1600), dur: .1, type: 'sine', vol: .045, slide: 300, cutoff: 5000, verb: .18 });
        break;
      case 'w_vortex':
        this._sweep(crnd(120, 150), crnd(280, 320), .2, .055);
        this.nz({ kind: 'pink', dur: .2, vol: .035, filter: 'bandpass', f0: 700, f1: 2100, q: 2.2, attack: .04, verb: .25 });
        break;
      case 'w_starfall':
        this.rWhoosh(.7, .05);
        this.res(crnd(1400, 2000), .3, .04, { partials: [1, 2.76, 5.4], decay: [1, .5, .25], q: 26, verb: .35 });
        break;
      case 'w_medgun':
        this.nz({ kind: 'pink', dur: .12, vol: .05, filter: 'bandpass', f0: 1400, f1: 3200, q: 1.6, attack: .006, verb: .2 });
        this.voice({ freq: 620, dur: .12, type: 'sine', vol: .05, slide: 260, cutoff: 3200, verb: .2 });
        break;
      case 'w_loeschwasser': this.rWater(.16, false); break;
      case 'w_noten': this._iMusicBox(crnd(500, 900), .14, .05, { verb: .12, pan: crnd(-.08, .08) }); break;
      case 'w_nagler':
        this.rShot({ vol: .085, cal: .18, casing: false });
        this.res(3200, .05, .035, { partials: [1, 2.4], decay: [1, .4], q: 24, pan: crnd(-.12, .12) });
        break;
      case 'w_schrott':
        this.duckMusic(.65, .3);
        this.rShot({ vol: .19, cal: .85 });
        this.rDebris(6, .045, 'metal');
        break;
      case 'w_bier':
        this.rWhoosh(.6, .06);
        this.res(240, .18, .05, { partials: [1, 2.1, 3.4], decay: [1, .5, .25], q: 12, drive: 1.3, verb: .2 });
        for (let i = 0; i < 3; i++) this.res(crnd(2200, 4200), .1, .02, { partials: [1, 2.9], decay: [1, .4], q: 28, start: .02 + i * .03, verb: .3 });
        break;
      case 'w_mine':
        this.rShot({ vol: .12, cal: .55, casing: false });
        this.res(1400, .2, .04, { partials: [1, 2.76, 5.4], decay: [1, .5, .25], q: 26, verb: .25 });
        this.voice({ freq: 900, dur: .08, type: 'square', vol: .03, slide: 400, cutoff: 3200, q: 3 });
        break;
      case 'w_tauben':
        for (let i = 0; i < 4; i++) this.nz({ kind: 'pink', dur: crnd(.05, .1), vol: .035, filter: 'bandpass', f0: crnd(900, 1800), f1: crnd(400, 900), q: 1.6, attack: .006, start: i * crnd(.02, .06), pan: crnd(-.3, .3) });
        this._formant({ f: crnd(320, 460), fMid: crnd(260, 380), dur: .2, vol: .035, type: 'sawtooth', formants: [700, 1500, 2600], famp: [1, .5, .2], fq: 9, vib: 40, vibHz: 16, breath: .3, pan: crnd(-.15, .15), verb: .3 });
        break;
      case 'w_saege':
        this.nz({ kind: 'grain', dur: .18, vol: .075, filter: 'bandpass', f0: 1200, fMid: 700, f1: 380, q: 2.2, attack: .004, rate: 1.5, drive: 2, pan: crnd(-.14, .14) });
        this.voice({ freq: crnd(115, 145), dur: .18, type: 'sawtooth', vol: .055, slide: crnd(-25, 25), cutoff: 1400, cutoffEnd: 500, q: 2.4, drive: 1.8 });
        this.voice({ freq: crnd(58, 72), dur: .16, type: 'square', vol: .035, cutoff: 700, q: 2, drive: 1.5 });
        break;
      case 'w_zirkel':
        this._sweep(crnd(700, 900), crnd(1400, 1700), .14, .045);
        this.nz({ kind: 'white', dur: .1, vol: .03, filter: 'bandpass', f0: 3400, f1: 6200, q: 2.4, attack: .004, verb: .25 });
        break;
      case 'w_ableiter':
        this.rElectric(.13, .22);
        this.voice({ freq: 120, dur: .18, type: 'sine', vol: .06, slide: -40, cutoff: 400, release: .12, sub: .8 });
        break;
      case 'w_ratschlag': {
        const f0 = crnd(155, 215), pn = crnd(-.1, .1);
        this._formant({ f: f0, fMid: f0 * 1.12, f1: f0 * .9, dur: .2, vol: .075, type: 'sawtooth', formants: [720, 1240, 2500], famp: [1, .55, .22], fq: 8, vib: 14, vibHz: 6, breath: .12, pan: pn, verb: .2 });
        this.nz({ kind: 'pink', dur: .04, vol: .02, filter: 'bandpass', f0: 2400, f1: 1400, q: 2, attack: .002, pan: pn });
        break;
      }
      /* ---------- Treffer: Gegner (nass), Welt (Material) ---------- */
      case 'hit': this._squelch(crnd(.45, .7)); break;
      case 'crit':
        this._splat(1.15);
        this.rPierce(.9);
        this._drip(.035);
        break;
      case 'hitElem':
        this._squelch(crnd(.55, .8));
        this.nz({ kind: 'crackle', dur: .16, vol: .045, filter: 'bandpass', f0: 1900, f1: 700, q: 2.2, attack: .006, drive: 1.5, pan: crnd(-.14, .14) });
        break;
      case 'hitMelee': this._splat(.9); this.rPierce(.7); break;
      case 'pierce': this.rPierce(1.1); break;
      case 'burst': this.rBurst(1); break;
      case 'kill':
        this.duckMusic(.55, .25);
        this.rBurst(1.25);
        break;
      case 'shard':
        this.rBurst(.95);
        this.rDebris(4, .035);
        break;
      case 'clank':
        this._squelch(.85);
        this.nz({ kind: 'brown', dur: .13, vol: .07, filter: 'lowpass', f0: 640, f1: 140, q: 1.3, attack: .001, drive: 1.9, verb: .12 });
        this.res(150, .12, .05, { partials: [1, 1.8, 3.2], decay: [1, .45, .25], q: 9, drive: 1.3 });
        break;
      case 'wall': this.rMat('stone', .09); break;
      case 'wood': this.rMat('wood', .1); break;
      case 'metal': this.rMat('metal', .09); break;
      case 'glass': this.rMat('glass', .1); break;
      case 'splash': this.rWater(.12, false); break;
      case 'ric':
        this.nz({ kind: 'white', dur: .05, vol: .05, filter: 'bandpass', f0: 3400, f1: 1200, q: 4, attack: .0006, drive: 1.6, pan: crnd(-.3, .3) });
        this.voice({ freq: crnd(1800, 2600), dur: .18, type: 'sine', vol: .035, slide: -1400, cutoff: 6000, q: 3, release: .12, verb: .35 });
        break;
      case 'boom': this.duckMusic(.5, .4); this.rBoom(.9, .2); break;
      case 'thunder':
        this.duckMusic(.5, .6);
        this.rBoom(1.3, .24);
        this.nz({ kind: 'brown', dur: 1.6, vol: .1, filter: 'lowpass', f0: 700, f1: 90, q: .6, attack: .12, verb: .55 });
        break;
      /* ---------- Spieler ---------- */
      case 'hurt':
        this._squelch(.9);
        this.rVox('hurt', .07);
        this.voice({ freq: 45, dur: .2, type: 'sine', vol: .07, slide: -12, cutoff: 140, dest: this.musicGain });
        break;
      case 'step': this._footstep(.05, false); break;
      case 'dash':
        this.rWhoosh(1.4, .1);
        this.nz({ kind: 'grain', dur: .1, vol: .04, filter: 'bandpass', f0: 1200, f1: 400, q: 1.6, attack: .004, pan: crnd(-.2, .2) });
        this.voice({ freq: 55, dur: .14, type: 'sine', vol: .035, slide: -20, cutoff: 200, dest: this.musicGain });
        break;
      case 'heal':
        [440, 660, 880].forEach(f => this._iBell(f, .5, .05, { start: (f - 440) / 2200, verb: .35 }));
        this.nz({ kind: 'pink', dur: .35, vol: .03, filter: 'bandpass', f0: 900, f1: 2800, q: 1.4, attack: .1, verb: .3 });
        break;
      case 'notstrom':
        this.duckMusic(.45, .5);
        this.rElectric(.12, .3);
        this._sweep(110, 450, .45, .08);
        this.voice({ freq: 55, dur: .75, type: 'sine', vol: .14, slide: -25, cutoff: 400, release: .3, verb: .4 });
        break;
      case 'blink':
        this.rWhoosh(1.3, .06);
        this.rElectric(.05, .1);
        this.voice({ freq: 90, dur: .12, type: 'sine', vol: .05, slide: -30, cutoff: 300 });
        break;
      case 'chain': this.rElectric(.08, .08); break;
      /* ---------- Gegner ---------- */
      case 'e_shot': this.rShot({ vol: .075, cal: .22, casing: false }); break;
      case 'e_charge':
        this.rVox('growl', .06);
        this._sweep(crnd(220, 260), crnd(520, 600), .35, .06);
        this.nz({ kind: 'pink', dur: .35, vol: .05, filter: 'bandpass', f0: 400, f1: 2400, q: 1.8, attack: .12, drive: 1.3 });
        break;
      case 'e_summon': this.rVox('screech', .07); this.nz({ kind: 'grain', dur: .2, vol: .05, filter: 'bandpass', f0: 700, f1: 2000, q: 2, attack: .05, verb: .25 }); break;
      case 'e_heal': this.rVox('chitter', .05); this._chime(crnd(400, 440), .04, .2); break;
      case 'e_spawn': this.rVox('spawn', .07); break;
      case 'e_growl': this.rVox('growl', .07); break;
      case 'e_screech': this.rVox('screech', .075); break;
      case 'e_chitter': this.rVox('chitter', .06); break;
      case 'e_roar': this.duckMusic(.6, .6); this.rVox('roar', .1); break;
      case 'e_mech': this.rVox('mech', .07); break;
      case 'drone':
        this._formant({ f: crnd(88, 104), f1: crnd(72, 86), dur: .3, vol: .05, type: 'square', formants: [420, 1100, 2200], famp: [1, .5, .25], fq: 12, vib: 40, vibHz: 28, drive: 1.6 });
        break;
      case 'boss':
        this.duckMusic(.5, .7);
        this.rBoom(1.1, .2);
        this.rVox('roar', .1);
        [55, 55.9].forEach(f => this.voice({ freq: f, dur: .9, type: 'sawtooth', vol: .13, attack: .02, release: .55, cutoff: 240, cutoffEnd: 85, q: 2, drive: 1.7, dest: this.musicGain, verb: .45 }));
        break;
      /* ---------- Welt & Ambiente ---------- */
      case 'bird': {
        const a = (OPT().amb != null ? OPT().amb : .7);
        const chirp = (f0, st) => this._formant({ f: f0, fMid: f0 * 1.5, f1: f0 * .8, dur: .1, vol: .035 * a, type: 'sine', formants: [f0 * 1.6, f0 * 2.6, f0 * 4], famp: [1, .4, .15], fq: 12, vib: 60, vibHz: 26, pan: crnd(-.3, .3), verb: .4, start: st });
        const bf = crnd(1500, 2100);
        chirp(bf, 0); chirp(bf * 1.12, .12);
        break;
      }
      case 'crackle': {
        const a = (OPT().amb != null ? OPT().amb : .7);
        this.nz({ kind: 'crackle', dur: .12, vol: .035 * a, filter: 'bandpass', f0: 1700, f1: 800, q: 2.4, attack: .004, rate: .9, pan: crnd(-.3, .3), verb: .25 });
        break;
      }
      case 'wind': { const a = (OPT().amb != null ? OPT().amb : .7); this.rWind(.05 * a, crnd(1.8, 3.2)); break; }
      case 'leaves': { const a = (OPT().amb != null ? OPT().amb : .7); this.nz({ kind: 'grain', dur: crnd(.5, 1.1), vol: .03 * a, filter: 'highpass', f0: 2600, f1: 4800, q: 1, attack: .2, rate: .8, pan: crnd(-.35, .35), verb: .35 }); break; }
      case 'traffic': {
        const a = (OPT().amb != null ? OPT().amb : .7);
        const p = Math.random() < .5 ? -.45 : .45;
        this.nz({ kind: 'brown', dur: 1.5, vol: .045 * a, filter: 'lowpass', f0: 900, fMid: 1400, fMidAt: .45, f1: 300, q: 1.1, attack: .5, pan: p, verb: .3 });
        this.voice({ freq: 88, dur: 1.4, type: 'sawtooth', vol: .022 * a, slide: -22, cutoff: 500, cutoffEnd: 200, attack: .5, release: .5, pan: -p, verb: .25 });
        break;
      }
      case 'siren': {
        const a = (OPT().amb != null ? OPT().amb : .7);
        for (let i = 0; i < 3; i++) this.voice({ freq: 620, dur: .45, type: 'sine', vol: .022 * a, slide: 240, cutoff: 2400, start: i * .9, verb: .5, pan: .4 });
        break;
      }
      case 'water': { const a = (OPT().amb != null ? OPT().amb : .7); this.rWater(.05 * a, true); break; }
      case 'gull': {
        const a = (OPT().amb != null ? OPT().amb : .7);
        this._formant({ f: 780, fMid: 1250, f1: 640, dur: .34, vol: .03 * a, type: 'sawtooth', formants: [1400, 2600, 3800], famp: [1, .5, .2], fq: 10, vib: 50, vibHz: 12, breath: .2, pan: crnd(-.4, .4), verb: .5 });
        break;
      }
      case 'relay': { const a = (OPT().amb != null ? OPT().amb : .7); this.res(2400, .06, .04 * a, { partials: [1, 2.4, 4.1], decay: [1, .4, .2], q: 26, pan: crnd(-.3, .3), verb: .3 }); this._click(.03 * a); break; }
      case 'steam': { const a = (OPT().amb != null ? OPT().amb : .7); this.nz({ kind: 'white', dur: crnd(.6, 1.4), vol: .035 * a, filter: 'highpass', f0: 3200, f1: 5600, q: .8, attack: .06, pan: crnd(-.35, .35), verb: .35 }); break; }
      case 'machine': {
        const a = (OPT().amb != null ? OPT().amb : .7);
        this.res(crnd(180, 320), .5, .035 * a, { partials: [1, 2.1, 3.7], decay: [1, .5, .25], q: 12, pan: crnd(-.3, .3), verb: .4, drive: 1.3 });
        this.nz({ kind: 'brown', dur: .5, vol: .025 * a, filter: 'lowpass', f0: 500, f1: 160, q: 1, attack: .1, verb: .3 });
        break;
      }
      case 'chainrattle': {
        const a = (OPT().amb != null ? OPT().amb : .7);
        for (let i = 0; i < 6; i++) this.res(crnd(1600, 3400), .09, .022 * a, { partials: [1, 2.76], decay: [1, .4], q: 28, start: i * crnd(.03, .09), pan: crnd(-.3, .3), verb: .35 });
        break;
      }
      case 'creak': {
        const a = (OPT().amb != null ? OPT().amb : .7);
        this._formant({ f: crnd(90, 140), fMid: crnd(150, 220), f1: crnd(70, 110), dur: crnd(.6, 1.2), vol: .03 * a, type: 'sawtooth', formants: [340, 900, 1800], famp: [1, .45, .2], fq: 16, vib: 25, vibHz: 4, drive: 1.4, pan: crnd(-.3, .3), verb: .45 });
        break;
      }
      case 'voices': {
        const a = (OPT().amb != null ? OPT().amb : .7);
        for (let i = 0; i < 3; i++) this._formant({ f: crnd(120, 220), f1: crnd(100, 190), dur: crnd(.2, .4), vol: .016 * a, type: 'sawtooth', formants: [620, 1200, 2400], famp: [1, .4, .12], fq: 7, breath: .2, start: i * crnd(.2, .5), pan: crnd(-.4, .4), verb: .55 });
        break;
      }
      /* ---------- UI & Meta ---------- */
      case 'pick': this._click(.045); this._chime(crnd(500, 700), .022, .2); break;
      case 'buy':
        [523, 784, 1046].forEach((f, i) => this._iMusicBox(f, .3, .07, { start: i * .06, verb: .25 }));
        this.res(2600, .06, .03, { partials: [1, 2.4], decay: [1, .4], q: 24 });
        break;
      case 'level':
        [392, 523, 659, 784].forEach((f, i) => this._iBell(f, .4, .07, { start: i * .09, verb: .3 }));
        this.voice({ freq: 100, dur: .4, type: 'sine', vol: .06, slide: -8, cutoff: 260, dest: this.musicGain });
        break;
      case 'wave':
        [392, 523, 659, 784, 1046].forEach((f, i) => this._iBell(f, .5, .08, { start: i * .11, verb: .35 }));
        this._iStrings(196, 1.6, .035, { start: .1, verb: .45 });
        this.voice({ freq: 45, dur: .55, type: 'sine', vol: .06, slide: -12, cutoff: 120, dest: this.musicGain });
        break;
      case 'ui': this._click(.04); this.voice({ freq: 760, dur: .06, type: 'sine', vol: .045, slide: 340, cutoff: 3400, q: 1.5 }); break;
      case 'ok': this._click(.05); this._chime(660, .035, .16); break;
      case 'err':
        this.rMat('wood', .07);
        this.voice({ freq: 200, dur: .14, type: 'triangle', vol: .07, slide: -90, cutoff: 800, cutoffEnd: 240, drive: 1.3, verb: .12 });
        break;
      case 'tick': this._click(.03); break;
      case 'fuse': [523, 659, 784, 1046, 1318].forEach((f, i) => this._iBell(f, .3, .07, { start: i * .065, verb: .25 })); break;
      case 'count': [392, 523, 659, 784].forEach((f, i) => this._iMusicBox(f, .25, .06, { start: i * .15, verb: .2 })); break;
      case 'telegraph': this._chime(620, .05, .3); this._chime(930, .035, .2, .12); break;
      case 'rumbleChest':
        this.rBoom(.4, .14);
        [523, 784, 1046].forEach((f, i) => this._iMusicBox(f, .3, .06, { start: i * .05, verb: .3 }));
        break;
      case 'rune':
        [520, 780, 1040, 1300].forEach((f, i) => this._iMusicBox(f, .3, .06, { start: i * .05, verb: .25, pan: i % 2 ? .1 : -.1 }));
        this.nz({ kind: 'pink', dur: .25, vol: .035, filter: 'bandpass', f0: 1400, f1: 3600, q: 2, attack: .08, verb: .35 });
        break;
      case 'pet': [440, 660, 880].forEach((f, i) => this._iBell(f, .25, .06, { start: i * .06, verb: .2 })); break;
      case 'rave':
        this.duckMusic(.45, .4);
        this.rBoom(.5, .16);
        [60, 90].forEach(f => this.voice({ freq: f, dur: .4, type: 'sine', vol: .15, slide: -30, cutoff: 320, release: .3, sub: 1, verb: .25 }));
        this.nz({ kind: 'white', dur: .14, vol: .1, filter: 'highpass', f0: 4200, f1: 7600, q: 1, attack: .002, verb: .35 });
        break;
      case 'over':
        [440, 349, 277, 196].forEach((f, i) => this._iBell(f, .8, .1, { start: i * .22, verb: .5 }));
        this._iStrings(196, 2, .04, { start: .2, verb: .5 });
        break;
      case 'win':
        [523, 659, 784, 1046, 1318].forEach((f, i) => this._iMusicBox(f, .6, .08, { start: i * .14, verb: .45 }));
        this._iStrings(262, 2.4, .04, { start: .1, verb: .5 });
        this.nz({ kind: 'pink', dur: 1.2, vol: .028, filter: 'highpass', f0: 4200, f1: 8200, q: .8, attack: .4, verb: .5 });
        break;
      case 'frohes_neues':
        [392, 523, 659, 784, 1046, 784, 659, 523].forEach((f, i) => this._iMusicBox(f, i === 7 ? .5 : .18, .07, { start: i * .115, verb: .25 }));
        this.voice({ freq: 60, dur: .7, type: 'sine', vol: .06, slide: -20, release: .4, dest: this.musicGain });
        break;
    }
  },
  /* ---- Arena-Ambiente: zufällige Weltgeräusche ---- */
  AMBIENT_EVENTS: {
    kurpark:     [['bird', 5, 12], ['leaves', 6, 14], ['wind', 12, 26], ['voices', 18, 40]],
    innenstadt:  [['traffic', 5, 13], ['voices', 12, 28], ['siren', 40, 90], ['wind', 16, 34]],
    rheinufer:   [['water', 4, 9], ['gull', 9, 22], ['wind', 10, 22], ['machine', 30, 70]],
    labor:       [['crackle', 1.2, 3.5], ['relay', 4, 11], ['steam', 8, 20], ['machine', 12, 28]],
    neroberg:    [['wind', 6, 15], ['leaves', 5, 13], ['bird', 9, 24], ['creak', 16, 38]],
    warmerdamm:  [['bird', 5, 13], ['water', 8, 18], ['leaves', 7, 16], ['voices', 20, 44]],
    schlachthof: [['machine', 5, 12], ['chainrattle', 7, 17], ['steam', 6, 15], ['creak', 10, 24], ['crackle', 3, 8]]
  },
  _ambTick(dt) {
    const id = this.ambientId;
    if (!id || !this.started) return;
    const list = this.AMBIENT_EVENTS[id];
    if (!list) return;
    if (!this._ambT || this._ambT.id !== id) {
      this._ambT = { id: id, next: list.map(e => crnd(e[1], e[2])) };
    }
    const amb = OPT().amb != null ? OPT().amb : .7;
    if (amb <= 0) return;
    for (let i = 0; i < list.length; i++) {
      this._ambT.next[i] -= dt;
      if (this._ambT.next[i] <= 0) {
        this._ambT.next[i] = crnd(list[i][1], list[i][2]);
        this.sfx(list[i][0]);
      }
    }
  },

  voiceChar(charId, emote) {
    if (!this.started) return;
    const base = { leonidas: 330, sylvia: 480, sebbo: 560, scharfschuetze: 390, bollwerk: 220, nova: 300, kleeblatt: 520, ingenieur: 360, cyborg: 440, rockstar: 300, greta: 400, manni: 260, blindgaenger: 280, oe: 470 }[charId] || 400;
    const st = emote ? 0 : [0, 3, 7, 5, 10][Math.floor(Math.random() * 5)];
    const f = base * Math.pow(2, st / 12);
    this.voice({ freq: f, dur: .12, type: 'square', vol: .05, slide: 60, stack: 2, detune: 8, spread: 8, cutoff: 2600, cutoffEnd: 900, q: 1.5, verb: .15, drive: 1.2, pan: crnd(-.06, .06) });
    this.voice({ freq: f * 2, dur: .14, type: 'triangle', vol: .03, slide: 90, cutoff: 3400, verb: .2, pan: crnd(-.05, .05) });
    if (!emote) {
      const f2 = base * Math.pow(2, (st + 4) / 12);
      setTimeout(() => this.voice({ freq: f2, dur: .16, type: 'square', vol: .042, slide: -40, stack: 2, detune: 7, cutoff: 2200, cutoffEnd: 800, q: 1.4, verb: .2, drive: 1.2, pan: crnd(-.06, .06) }), 110);
    }
  },
  /* ============================================================
     RAUMAKUSTIK — je Arena eine eigene Impulsantwort
     decay  = Nachhallzeit in Sekunden
     damp   = Höhendämpfung über die Zeit (0 hell … 1 sehr dunkel)
     early  = frühe Reflexionen [Verzögerung s, Pegel]
     metal  = metallische Resonanzen (Schlachthof, Labor)
     wet    = Anteil am Gesamtsignal
     ============================================================ */
  IR_PROFILES: {
    default:     { decay: 2.0, damp: .45, early: [[.011, .55], [.023, .38], [.041, .26]], metal: 0,   wet: .40, spread: .75 },
    kurpark:     { decay: 1.1, damp: .70, early: [[.017, .28], [.039, .16]],              metal: 0,   wet: .26, spread: .9 },
    warmerdamm:  { decay: 1.3, damp: .62, early: [[.015, .32], [.034, .19]],              metal: 0,   wet: .30, spread: .88 },
    neroberg:    { decay: 1.7, damp: .74, early: [[.021, .30], [.048, .20], [.079, .12]], metal: 0,   wet: .34, spread: .92 },
    innenstadt:  { decay: 2.3, damp: .38, early: [[.009, .62], [.019, .44], [.031, .30], [.052, .20]], metal: .08, wet: .44, spread: .7 },
    rheinufer:   { decay: 2.9, damp: .55, early: [[.027, .36], [.061, .24], [.105, .14]], metal: 0,   wet: .40, spread: .95 },
    labor:       { decay: 1.5, damp: .22, early: [[.006, .70], [.013, .52], [.021, .38], [.033, .26]], metal: .34, wet: .46, spread: .55 },
    schlachthof: { decay: 3.4, damp: .30, early: [[.008, .66], [.017, .48], [.029, .34], [.047, .24], [.071, .16]], metal: .55, wet: .50, spread: .62 }
  },
  _makeIR(id) {
    if (!this._irCache) this._irCache = {};
    if (this._irCache[id]) return this._irCache[id];
    const P = this.IR_PROFILES[id] || this.IR_PROFILES.default;
    const q = OPT().quality != null ? OPT().quality : 2;
    const sr = this.ctx.sampleRate;
    const secs = Math.min(4, P.decay * (q === 0 ? .55 : q === 1 ? .8 : 1));
    const n = Math.max(256, Math.floor(sr * secs));
    const chans = q === 0 ? 1 : 2;
    const buf = this.ctx.createBuffer(chans, n, sr);
    /* metallische Teiltöne für Hallen aus Stahl und Beton */
    const partials = [];
    if (P.metal > 0) for (let i = 0; i < 5; i++) partials.push({ f: 180 * Math.pow(1.61, i) * crnd(.94, 1.06), a: P.metal / (1 + i * 1.3), d: secs * crnd(.35, .8) });
    for (let ch = 0; ch < chans; ch++) {
      const d = buf.getChannelData(ch);
      const sideGain = ch ? P.spread : 1;
      let lp = 0;
      const damp = clamp(P.damp, .05, .95);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const env = Math.pow(1 - t, 2.2 + P.damp * 1.6);
        let v = (Math.random() * 2 - 1) * env;
        /* fortschreitende Höhendämpfung: einfacher Tiefpass, der zufährt */
        const k = 1 - damp * (.25 + .7 * t);
        lp += (v - lp) * clamp(k, .02, 1);
        v = lp;
        for (const p of partials) {
          const ts = i / sr;
          v += Math.sin(TAU * p.f * ts + ch * 1.3) * p.a * Math.exp(-ts / p.d) * .06;
        }
        d[i] = v * sideGain;
      }
      /* frühe Reflexionen als diskrete Einsätze */
      for (const [dl, amp] of P.early) {
        const pos = Math.floor(dl * sr * (ch ? 1.07 : 1));
        if (pos < n - 4) {
          d[pos] += amp * (ch ? .9 : 1);
          d[pos + 1] += amp * .5;
          d[pos + 2] -= amp * .22;
        }
      }
      d[0] += .9;
    }
    this._irCache[id] = buf;
    return buf;
  },
  applyRoom(id) {
    if (!this.started || !this.reverb) return;
    const P = this.IR_PROFILES[id] || this.IR_PROFILES.default;
    try {
      this.reverb.buffer = this._makeIR(this.IR_PROFILES[id] ? id : 'default');
      const q = OPT().quality != null ? OPT().quality : 2;
      this.reverbWet.gain.setTargetAtTime(P.wet * (q === 0 ? .75 : 1), this.ctx.currentTime, .25);
    } catch (e) { }
  },
  setAmbient(id) {
    this.ambientId = id || null; this.birdTimer = crnd(2, 6); this.crackleT = 0; this.musicStep = 0; this._song = null; this._nextTime = null;
    if (this.musicFilter) { try { this.musicFilter.frequency.cancelScheduledValues(this.ctx.currentTime); this.musicFilter.frequency.setValueAtTime(20000, this.ctx.currentTime); } catch (e) { } }
    if (this.pump) { try { this.pump.gain.cancelScheduledValues(this.ctx.currentTime); this.pump.gain.setValueAtTime(1, this.ctx.currentTime); } catch (e) { } }
    this.stopHum();
    if (this.started) this.applyRoom(this.ambientId);
    if (!this.started || !this.ambientId || OPT().music <= 0) return;
    const c = this.ctx;
    const mk = (type, freq, det, filt) => {
      const o = c.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = det || 0;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filt || 800; f.Q.value = .5;
      const g = c.createGain(); g.gain.value = 0;
      o.connect(f); f.connect(g); g.connect(this.musicGain); o.start();
      return { o, g };
    };
    this._humTarget = 0;
    if (id === 'labor') { this.hum = [mk('sawtooth', 55, 0, 320), mk('sawtooth', 55.7, 8, 320), mk('sine', 110, 0, 420)]; this._humTarget = .026; }
    else if (id === 'rheinufer') { this.hum = [mk('sine', 80, -5), mk('sine', 81.3, 5), mk('sawtooth', 40, 0, 220)]; this._humTarget = .028; }
    else if (id === 'neroberg') { this.hum = [mk('sawtooth', 58, 0, 260), mk('sine', 116, 0, 320)]; this._humTarget = .022; }
    else if (id === 'innenstadt') { this.hum = [mk('sine', 62, 0, 300), mk('sine', 124.6, 3, 400)]; this._humTarget = .02; }
    else if (id === 'kurpark') { this.hum = [mk('sine', 98, -6, 400), mk('sine', 99.3, 6, 400), mk('sine', 196, 0, 500)]; this._humTarget = .024; }
    else if (id === 'warmerdamm') { this.hum = [mk('sine', 92, -5, 420), mk('sine', 93.5, 5, 420), mk('sine', 184, 0, 520)]; this._humTarget = .022; }
    else if (id === 'schlachthof') { this.hum = [mk('sawtooth', 49, 0, 200), mk('sawtooth', 50.2, 9, 200), mk('sine', 98, 0, 260)]; this._humTarget = .03; }
    if (this.hum && this.hum.length > 1) {
      const lo = c.createOscillator(); lo.type = 'sine'; lo.frequency.value = crnd(.07, .13);
      const lg = c.createGain(); lg.gain.value = crnd(5, 9);
      lo.connect(lg); lg.connect(this.hum[1].o.detune); lo.start();
      this._humLfo = { o: lo, g: lg };
    }
  },
  stopHum() {
    if (this.hum) for (const h of this.hum) { try { h.o.stop(); } catch (e) { } h.o.disconnect(); h.g.disconnect(); }
    if (this._humLfo) { try { this._humLfo.o.stop(); } catch (e) { } this._humLfo.o.disconnect(); this._humLfo.g.disconnect(); this._humLfo = null; }
    this.hum = null; this._humTarget = 0;
  },
  ensureMotor(i) {
    if (!this.started || this.motor[i]) return;
    const c = this.ctx;
    const mk = (type, freq) => {
      const o = c.createOscillator(); o.type = type; o.frequency.value = freq;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 460; f.Q.value = .3;
      const g = c.createGain(); g.gain.value = 0;
      o.connect(f); f.connect(g); g.connect(this.musicGain); o.start();
      return { o, f, g };
    };
    const m = { sub: mk('sine', 26), saw1: mk('sawtooth', 52), saw2: mk('sawtooth', 104) };
    const lfo = c.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 8.6;
    const lg = c.createGain(); lg.gain.value = 5;
    lfo.connect(lg); lg.connect(m.saw1.o.frequency); lfo.start();
    m.lfo = { o: lfo, g: lg };
    this.motor[i] = m;
  },
  updateMotors(dt, players, active) {
    if (!this.started) return;
    if (OPT().music <= 0) active = false;
    for (let i = 0; i < 2; i++) {
      const p = players && players[i];
      if (!p) { if (this.motor[i]) this._motorGain(this.motor[i], 0, .2); continue; }
      this.ensureMotor(i);
      const M = this.motor[i];
      if (!M) continue;
      if (!active || !p.alive) { this._motorGain(M, 0, .2); continue; }
      const sp = Math.hypot(p.vx || 0, p.vy || 0);
      let rpm = clamp(sp / 230, .12, 1);
      if (p.dashT > 0) rpm = Math.min(1.3, rpm + .35);
      const base = 42 + rpm * 82;
      const t = this.ctx.currentTime;
      M.sub.o.frequency.setTargetAtTime(base * .5, t, .1);
      M.saw1.o.frequency.setTargetAtTime(base, t, .08);
      M.saw2.o.frequency.setTargetAtTime(base * 2, t, .08);
      M.sub.f.frequency.setTargetAtTime(300 + rpm * 500, t, .15);
      M.saw1.f.frequency.setTargetAtTime(400 + rpm * 900, t, .15);
      M.saw2.f.frequency.setTargetAtTime(900 + rpm * 2000, t, .15);
      const vol = .035 * (0.22 + rpm * 0.78);
      this._motorGain(M, vol, .12);
    }
  },
  _motorGain(M, vol, tc) {
    if (!M) return;
    const t = this.ctx.currentTime;
    M.sub.g.gain.setTargetAtTime(vol * .9, t, tc || .2);
    M.saw1.g.gain.setTargetAtTime(vol * .5, t, tc || .2);
    M.saw2.g.gain.setTargetAtTime(vol * .22, t, tc || .2);
  },
  /* ============================================================
     CHIPTUNE-ENGINE — Solar Striker / Star Fox Corneria Stil
     Vier Spielarten (Option "Musik-Stil"): pulse / snes / famicom / retro.
     NES/Pulse-Wellen fuer Melodie und Harmonie, Triangle fuer Bass,
     Noise fuer Drums. Alle Stimmen auf 16tel-Raster geplant.
     ============================================================ */
  CHIPTUNE_STYLES: {
    pulse:   { label: 'NES Pulse',    duty: .50, detune: 0,  delay: .08, padMix: .3, drive: 1.0 },
    snes:    { label: 'SNES FM',      duty: .25, detune: 8,  delay: .15, padMix: .5, drive: 1.05 },
    famicom: { label: 'Famicom',      duty: .50, detune: -5, delay: .05, padMix: .2, drive: 1.1 },
    retro:   { label: 'Retro Arcade', duty: .50, detune: 3,  delay: .12, padMix: .4, drive: 1.0 },
    orchestral: { label: 'Orchestral', duty: .35, detune: 12, delay: .18, padMix: .7, drive: 1.15 },
  },
  CHIPTUNE_DRUMS: {
    classic: { kick: [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0], snare: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0], hihat: [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0], fill: [0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1] },
    upbeat:  { kick: [1,0,0,1,0,0,1,0,1,0,0,1,0,0,1,0], snare: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0], hihat: [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0], fill: [0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1] },
    driving: { kick: [1,0,1,0,0,1,1,0,1,0,1,0,0,1,0,0], snare: [0,0,0,0,1,0,0,1,0,0,0,0,1,0,0,1], hihat: [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0], fill: [0,0,0,0,0,0,0,0,0,0,0,0,1,0,1,1] },
    boss:    { kick: [1,0,0,0,1,0,0,0,1,0,0,0,1,0,1,0], snare: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0], hihat: [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0], fill: [0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1] },
    /* Titelthema: getragener Marschpuls statt Gefechtsbeat — Kick auf 1 und 3,
       Snare als Antwort, Hi-Hat nur auf den Vierteln. Laesst der Fanfare Luft. */
    anthem:  { kick: [1,0,0,0,0,0,0,0,1,0,0,0,0,0,1,0], snare: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,1], hihat: [1,0,0,0,1,0,0,0,1,0,0,0,1,0,1,0], fill: [0,0,0,0,0,0,0,0,0,0,1,0,1,0,1,1] },
  },
  STYLE_ORDER: ['pulse', 'snes', 'famicom', 'retro'],
  /* ---- Songs: pro Arena Melodie, Harmonie, Bass ----
     Values = Halbton-Abstand von Root, -1 = Pause.
     16 Schritte pro Takt, 8 Takte = 128 Eintraege. ---- */
  CHIPTUNE_SONGS: {
    /* ------------------------------------------------------------------
       TITELTHEMA  "Anflug auf Wiesbaden"
       Eigenkomposition in d-Moll, heroischer Fanfarenduktus.
       8 Takte à 16 Sechzehntel = 128 Schritte je Spur.
       ------------------------------------------------------------------ */
    title: {
      title: 'Anflug auf Wiesbaden', bpm: 148, root: 293.66,   /* war 132 — gegen die Arena (156-176) wirkte das schleppend */
      drums: 'anthem', bossDrums: 'anthem',
      prog: [0, 0, 10, 10, 8, 8, 7, 7],
      chd: [[0, 3, 7], [0, 3, 7], [10, 14, 17], [10, 14, 17],
            [8, 12, 15], [8, 12, 15], [7, 11, 14], [7, 11, 14]],
      /* Melodie: Aufstieg zur Oktave, Beantwortung, dann die Kadenz hinab */
      mel: [
        0, -1, -1, -1, 7, -1, -1, -1, 12, -1, -1, 10, -1, -1, -1, -1,
        12, -1, -1, -1, 10, -1, 7, -1, -1, -1, -1, -1, 5, -1, 7, -1,
        10, -1, -1, -1, 14, -1, -1, -1, 17, -1, -1, 15, -1, -1, -1, -1,
        17, -1, -1, -1, 15, -1, 14, -1, -1, -1, -1, -1, 12, -1, 14, -1,
        8, -1, -1, -1, 12, -1, -1, -1, 15, -1, -1, 17, -1, -1, -1, -1,
        20, -1, -1, -1, 19, -1, 17, -1, -1, -1, -1, -1, 15, -1, 14, -1,
        7, -1, -1, 11, 14, -1, -1, 17, 19, -1, -1, -1, -1, -1, -1, -1,
        19, -1, 17, -1, 14, -1, 11, -1, 12, -1, -1, -1, -1, -1, -1, -1
      ],
      /* Gegenstimme: haelt die Akkordtoene in Vierteln */
      har: [
        0, -1, -1, -1, 3, -1, -1, -1, 7, -1, -1, -1, 3, -1, -1, -1,
        0, -1, -1, -1, 3, -1, -1, -1, 7, -1, -1, -1, 12, -1, -1, -1,
        10, -1, -1, -1, 14, -1, -1, -1, 17, -1, -1, -1, 14, -1, -1, -1,
        10, -1, -1, -1, 14, -1, -1, -1, 17, -1, -1, -1, 22, -1, -1, -1,
        8, -1, -1, -1, 12, -1, -1, -1, 15, -1, -1, -1, 12, -1, -1, -1,
        8, -1, -1, -1, 12, -1, -1, -1, 15, -1, -1, -1, 20, -1, -1, -1,
        7, -1, -1, -1, 11, -1, -1, -1, 14, -1, -1, -1, 11, -1, -1, -1,
        7, -1, -1, -1, 11, -1, -1, -1, 14, -1, -1, -1, 19, -1, -1, -1
      ],
      /* Bass: durchlaufende Achtel, jede zweite Vier als Oktavsprung */
      bas: [
        0, -1, 0, -1, 12, -1, 0, -1, 0, -1, 0, -1, 12, -1, 7, -1,
        0, -1, 0, -1, 12, -1, 0, -1, 0, -1, 7, -1, 10, -1, 11, -1,
        10, -1, 10, -1, 22, -1, 10, -1, 10, -1, 10, -1, 22, -1, 17, -1,
        10, -1, 10, -1, 22, -1, 10, -1, 10, -1, 17, -1, 14, -1, 12, -1,
        8, -1, 8, -1, 20, -1, 8, -1, 8, -1, 8, -1, 20, -1, 15, -1,
        8, -1, 8, -1, 20, -1, 8, -1, 8, -1, 15, -1, 12, -1, 10, -1,
        7, -1, 7, -1, 19, -1, 7, -1, 7, -1, 7, -1, 19, -1, 14, -1,
        7, -1, 7, -1, 19, -1, 14, -1, 11, -1, 7, -1, 7, -1, 7, -1
      ],
      arps: [
        0, 3, 7, 12, 7, 3, 0, 3, 0, 3, 7, 12, 7, 3, 0, 3,
        10, 14, 17, 22, 17, 14, 10, 14, 10, 14, 17, 22, 17, 14, 10, 14,
        8, 12, 15, 20, 15, 12, 8, 12, 8, 12, 15, 20, 15, 12, 8, 12,
        7, 11, 14, 19, 14, 11, 7, 11, 7, 11, 14, 19, 14, 11, 7, 11
      ]
    },
    kurpark: {
      title: 'Kurpark Sprint', bpm: 168, root: 293.66,
      drums: 'upbeat', bossDrums: 'boss',
      prog: [0,0,7,7,9,9,5,7],
      chd: [[0,4,7],[0,4,7],[7,11,14],[7,11,14],[9,12,16],[9,12,16],[5,9,12],[7,11,14]],
      mel: [
        7,-1,-1,9, 11,-1,12,-1, -1,-1,-1,-1, -1,-1,-1,-1,
        12,-1,-1,-1, 9,-1,7,-1, -1,-1,-1,-1, -1,-1,-1,-1,
        11,-1,-1,12, 14,-1,11,-1, -1,-1,-1,-1, -1,-1,-1,-1,
        12,-1,-1,-1, -1,-1,-1,-1, 7,-1,9,-1, 11,-1,-1,-1,
        14,-1,-1,12, 16,-1,17,-1, -1,-1,-1,-1, -1,-1,-1,-1,
        16,-1,-1,-1, 14,-1,12,-1, -1,-1,-1,-1, -1,-1,-1,-1,
        9,-1,-1,11, 12,-1,14,-1, -1,-1,-1,-1, -1,-1,-1,-1,
        16,-1,14,-1, 12,-1,11,-1, 12,-1,-1,-1, -1,-1,-1,-1,
      ],
      har: [
        0,-1,-1,-1, 4,-1,-1,-1, 7,-1,-1,-1, 4,-1,-1,-1,
        0,-1,-1,-1, 4,-1,-1,-1, 7,-1,-1,-1, 4,-1,-1,-1,
        7,-1,-1,-1, 11,-1,-1,-1, 14,-1,-1,-1, 11,-1,-1,-1,
        7,-1,-1,-1, 11,-1,-1,-1, 14,-1,-1,-1, 11,-1,-1,-1,
        9,-1,-1,-1, 12,-1,-1,-1, 16,-1,-1,-1, 12,-1,-1,-1,
        9,-1,-1,-1, 12,-1,-1,-1, 16,-1,-1,-1, 12,-1,-1,-1,
        5,-1,-1,-1, 9,-1,-1,-1, 12,-1,-1,-1, 9,-1,-1,-1,
        7,-1,-1,-1, 11,-1,-1,-1, 14,-1,-1,-1, 11,-1,-1,-1,
      ],
      bas: [
        0,-1,-1,-1, 7,-1,-1,-1, 0,-1,-1,-1, 7,-1,-1,-1,
        0,-1,-1,-1, 7,-1,-1,-1, 0,-1,-1,-1, 7,-1,-1,-1,
        7,-1,-1,-1, 14,-1,-1,-1, 7,-1,-1,-1, 14,-1,-1,-1,
        7,-1,-1,-1, 14,-1,-1,-1, 7,-1,-1,-1, 14,-1,-1,-1,
        9,-1,-1,-1, 16,-1,-1,-1, 9,-1,-1,-1, 16,-1,-1,-1,
        9,-1,-1,-1, 16,-1,-1,-1, 9,-1,-1,-1, 16,-1,-1,-1,
        5,-1,-1,-1, 12,-1,-1,-1, 5,-1,-1,-1, 12,-1,-1,-1,
        7,-1,-1,-1, 14,-1,-1,-1, 7,-1,-1,-1, 14,-1,-1,-1,
      ],
      arps: [0,7,12,16],
    },
    innenstadt: {
      title: 'Innenstadt Dunkelheit', bpm: 172, root: 220.00,
      drums: 'driving', bossDrums: 'boss',
      prog: [0,0,8,8,3,3,10,10],
      chd: [[0,3,7],[0,3,7],[8,12,15],[8,12,15],[3,7,10],[3,7,10],[10,14,17],[10,14,17]],
      mel: [
        0,-1,0,-1, 3,-1,2,-1, 0,-1,-1,-1, -1,-1,-1,-1,
        7,-1,8,-1, 7,-1,3,-1, 0,-1,-1,-1, -1,-1,-1,-1,
        8,-1,12,-1, 15,-1,12,-1, 8,-1,-1,-1, -1,-1,-1,-1,
        15,-1,-1,-1, -1,-1,12,-1, 8,-1,-1,-1, -1,-1,-1,-1,
        3,-1,7,-1, 10,-1,12,-1, -1,-1,-1,-1, -1,-1,-1,-1,
        12,-1,10,-1, 7,-1,10,-1, -1,-1,-1,-1, -1,-1,-1,-1,
        10,-1,14,-1, 17,-1,14,-1, -1,-1,-1,-1, -1,-1,-1,-1,
        12,-1,10,-1, 7,-1,3,-1, 0,-1,-1,-1, -1,-1,-1,-1,
      ],
      har: [
        0,-1,-1,-1, 3,-1,-1,-1, 7,-1,-1,-1, 3,-1,-1,-1,
        0,-1,-1,-1, 3,-1,-1,-1, 7,-1,-1,-1, 3,-1,-1,-1,
        8,-1,-1,-1, 12,-1,-1,-1, 15,-1,-1,-1, 12,-1,-1,-1,
        8,-1,-1,-1, 12,-1,-1,-1, 15,-1,-1,-1, 12,-1,-1,-1,
        3,-1,-1,-1, 7,-1,-1,-1, 10,-1,-1,-1, 7,-1,-1,-1,
        3,-1,-1,-1, 7,-1,-1,-1, 10,-1,-1,-1, 7,-1,-1,-1,
        10,-1,-1,-1, 14,-1,-1,-1, 17,-1,-1,-1, 14,-1,-1,-1,
        10,-1,-1,-1, 14,-1,-1,-1, 17,-1,-1,-1, 14,-1,-1,-1,
      ],
      bas: [
        0,-1,0,-1, 0,-1,0,-1, 7,-1,7,-1, 0,-1,0,-1,
        0,-1,0,-1, 0,-1,0,-1, 7,-1,7,-1, 0,-1,0,-1,
        8,-1,8,-1, 8,-1,8,-1, 15,-1,15,-1, 8,-1,8,-1,
        8,-1,8,-1, 8,-1,8,-1, 15,-1,15,-1, 8,-1,8,-1,
        3,-1,3,-1, 3,-1,3,-1, 10,-1,10,-1, 3,-1,3,-1,
        3,-1,3,-1, 3,-1,3,-1, 10,-1,10,-1, 3,-1,3,-1,
        10,-1,10,-1, 10,-1,10,-1, 17,-1,17,-1, 10,-1,10,-1,
        10,-1,10,-1, 10,-1,10,-1, 17,-1,17,-1, 10,-1,10,-1,
      ],
      arps: [0,3,7,12],
    },
    rheinufer: {
      title: 'Rheinufer Fluss', bpm: 166, root: 311.13,
      drums: 'classic', bossDrums: 'boss',
      prog: [0,0,4,4,5,5,7,7],
      chd: [[0,4,7],[0,4,7],[4,7,11],[4,7,11],[5,9,12],[5,9,12],[7,11,14],[7,11,14]],
      mel: [
        0,-1,4,-1, 7,-1,12,-1, 7,-1,4,-1, -1,-1,-1,-1,
        4,-1,7,-1, 11,-1,16,-1, 14,-1,11,-1, -1,-1,-1,-1,
        5,-1,9,-1, 12,-1,17,-1, 12,-1,9,-1, -1,-1,-1,-1,
        7,-1,11,-1, 14,-1,19,-1, 14,-1,11,-1, -1,-1,-1,-1,
        0,-1,4,-1, 7,-1,12,-1, 7,-1,4,-1, -1,-1,-1,-1,
        4,-1,7,-1, 11,-1,16,-1, 14,-1,11,-1, -1,-1,-1,-1,
        12,-1,14,-1, 16,-1,17,-1, 16,-1,14,-1, -1,-1,-1,-1,
        12,-1,11,-1, 9,-1,7,-1, 4,-1,0,-1, -1,-1,-1,-1,
      ],
      har: [
        0,-1,-1,-1, 4,-1,-1,-1, 7,-1,-1,-1, 4,-1,-1,-1,
        0,-1,-1,-1, 4,-1,-1,-1, 7,-1,-1,-1, 4,-1,-1,-1,
        4,-1,-1,-1, 7,-1,-1,-1, 11,-1,-1,-1, 7,-1,-1,-1,
        4,-1,-1,-1, 7,-1,-1,-1, 11,-1,-1,-1, 7,-1,-1,-1,
        5,-1,-1,-1, 9,-1,-1,-1, 12,-1,-1,-1, 9,-1,-1,-1,
        5,-1,-1,-1, 9,-1,-1,-1, 12,-1,-1,-1, 9,-1,-1,-1,
        7,-1,-1,-1, 11,-1,-1,-1, 14,-1,-1,-1, 11,-1,-1,-1,
        7,-1,-1,-1, 11,-1,-1,-1, 14,-1,-1,-1, 11,-1,-1,-1,
      ],
      bas: [
        0,-1,-1,-1, 7,-1,-1,-1, 0,-1,-1,-1, 7,-1,-1,-1,
        0,-1,-1,-1, 7,-1,-1,-1, 0,-1,-1,-1, 7,-1,-1,-1,
        4,-1,-1,-1, 11,-1,-1,-1, 4,-1,-1,-1, 11,-1,-1,-1,
        4,-1,-1,-1, 11,-1,-1,-1, 4,-1,-1,-1, 11,-1,-1,-1,
        5,-1,-1,-1, 12,-1,-1,-1, 5,-1,-1,-1, 12,-1,-1,-1,
        5,-1,-1,-1, 12,-1,-1,-1, 5,-1,-1,-1, 12,-1,-1,-1,
        7,-1,-1,-1, 14,-1,-1,-1, 7,-1,-1,-1, 14,-1,-1,-1,
        7,-1,-1,-1, 14,-1,-1,-1, 7,-1,-1,-1, 14,-1,-1,-1,
      ],
      arps: [0,4,7,12],
    },
    labor: {
      title: 'Labor Reaktor', bpm: 170, root: 220.00,
      drums: 'driving', bossDrums: 'boss',
      prog: [0,0,5,5,0,0,7,7],
      chd: [[0,3,7],[0,3,7],[5,8,12],[5,8,12],[0,3,7],[0,3,7],[7,11,14],[7,11,14]],
      mel: [
        0,-1,0,3, 0,-1,3,-1, 0,-1,0,3, 7,-1,3,-1,
        0,-1,0,3, 0,-1,3,-1, 0,-1,0,3, 7,-1,3,-1,
        5,-1,5,8, 5,-1,8,-1, 12,-1,8,-1, 5,-1,-1,-1,
        8,-1,7,-1, 5,-1,3,-1, 0,-1,-1,-1, -1,-1,-1,-1,
        0,-1,0,3, 0,-1,3,-1, 0,-1,0,3, 7,-1,3,-1,
        0,-1,0,3, 0,-1,3,-1, 0,-1,0,3, 7,-1,3,-1,
        7,-1,7,11, 7,-1,11,-1, 14,-1,11,-1, 7,-1,-1,-1,
        11,-1,12,-1, 11,-1,7,-1, 3,-1,-1,-1, -1,-1,-1,-1,
      ],
      har: [
        0,-1,-1,-1, 3,-1,-1,-1, 7,-1,-1,-1, 3,-1,-1,-1,
        0,-1,-1,-1, 3,-1,-1,-1, 7,-1,-1,-1, 3,-1,-1,-1,
        5,-1,-1,-1, 8,-1,-1,-1, 12,-1,-1,-1, 8,-1,-1,-1,
        5,-1,-1,-1, 8,-1,-1,-1, 12,-1,-1,-1, 8,-1,-1,-1,
        0,-1,-1,-1, 3,-1,-1,-1, 7,-1,-1,-1, 3,-1,-1,-1,
        0,-1,-1,-1, 3,-1,-1,-1, 7,-1,-1,-1, 3,-1,-1,-1,
        7,-1,-1,-1, 11,-1,-1,-1, 14,-1,-1,-1, 11,-1,-1,-1,
        7,-1,-1,-1, 11,-1,-1,-1, 14,-1,-1,-1, 11,-1,-1,-1,
      ],
      bas: [
        0,-1,0,-1, 0,-1,0,-1, 0,-1,0,-1, 0,-1,0,-1,
        0,-1,0,-1, 0,-1,0,-1, 0,-1,0,-1, 0,-1,0,-1,
        5,-1,5,-1, 5,-1,5,-1, 12,-1,12,-1, 5,-1,5,-1,
        5,-1,5,-1, 5,-1,5,-1, 12,-1,12,-1, 5,-1,5,-1,
        0,-1,0,-1, 0,-1,0,-1, 0,-1,0,-1, 0,-1,0,-1,
        0,-1,0,-1, 0,-1,0,-1, 0,-1,0,-1, 0,-1,0,-1,
        7,-1,7,-1, 7,-1,7,-1, 14,-1,14,-1, 7,-1,7,-1,
        7,-1,7,-1, 7,-1,7,-1, 14,-1,14,-1, 7,-1,7,-1,
      ],
      arps: [0,3,7,12],
    },
    neroberg: {
      title: 'Neroberg Gipfel', bpm: 164, root: 349.23,
      drums: 'classic', bossDrums: 'boss',
      prog: [0,0,5,0,9,5,0,7],
      chd: [[0,4,7],[0,4,7],[5,9,12],[0,4,7],[9,12,16],[5,9,12],[0,4,7],[7,11,14]],
      mel: [
        12,-1,-1,-1, -1,-1,7,-1, -1,-1,-1,-1, -1,-1,-1,-1,
        12,-1,-1,-1, -1,-1,7,-1, -1,-1,-1,-1, -1,-1,-1,-1,
        9,-1,-1,-1, -1,-1,12,-1, -1,-1,-1,-1, -1,-1,-1,-1,
        16,-1,-1,-1, -1,-1,12,-1, -1,-1,-1,-1, -1,-1,-1,-1,
        14,-1,-1,-1, 11,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1,
        12,-1,-1,-1, 9,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1,
        14,-1,-1,-1, 9,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1,
        11,-1,-1,-1, -1,-1,-1,-1, 7,-1,9,-1, 11,-1,12,-1,
      ],
      har: [
        0,-1,-1,-1, 4,-1,-1,-1, 7,-1,-1,-1, 4,-1,-1,-1,
        0,-1,-1,-1, 4,-1,-1,-1, 7,-1,-1,-1, 4,-1,-1,-1,
        5,-1,-1,-1, 9,-1,-1,-1, 12,-1,-1,-1, 9,-1,-1,-1,
        0,-1,-1,-1, 4,-1,-1,-1, 7,-1,-1,-1, 4,-1,-1,-1,
        9,-1,-1,-1, 12,-1,-1,-1, 16,-1,-1,-1, 12,-1,-1,-1,
        5,-1,-1,-1, 9,-1,-1,-1, 12,-1,-1,-1, 9,-1,-1,-1,
        0,-1,-1,-1, 4,-1,-1,-1, 7,-1,-1,-1, 4,-1,-1,-1,
        7,-1,-1,-1, 11,-1,-1,-1, 14,-1,-1,-1, 11,-1,-1,-1,
      ],
      bas: [
        0,-1,-1,-1, 7,-1,-1,-1, 0,-1,-1,-1, 7,-1,-1,-1,
        0,-1,-1,-1, 7,-1,-1,-1, 0,-1,-1,-1, 7,-1,-1,-1,
        5,-1,-1,-1, 12,-1,-1,-1, 5,-1,-1,-1, 12,-1,-1,-1,
        0,-1,-1,-1, 7,-1,-1,-1, 0,-1,-1,-1, 7,-1,-1,-1,
        9,-1,-1,-1, 16,-1,-1,-1, 9,-1,-1,-1, 16,-1,-1,-1,
        5,-1,-1,-1, 12,-1,-1,-1, 5,-1,-1,-1, 12,-1,-1,-1,
        0,-1,-1,-1, 7,-1,-1,-1, 0,-1,-1,-1, 7,-1,-1,-1,
        7,-1,-1,-1, 14,-1,-1,-1, 7,-1,-1,-1, 14,-1,-1,-1,
      ],
      arps: [0,4,7,12],
    },
    warmerdamm: {
      title: 'Warmer Damm Hitzewelle', bpm: 174, root: 196.00,
      drums: 'upbeat', bossDrums: 'boss',
      prog: [0,0,10,10,8,8,7,7],
      chd: [[0,3,7],[0,3,7],[10,14,17],[10,14,17],[8,12,15],[8,12,15],[7,11,14],[7,11,14]],
      mel: [
        0,3,-1,3, -1,0,3,-1, 7,-1,3,-1, 0,-1,-1,-1,
        12,-1,10,-1, 7,-1,10,-1, 12,-1,-1,-1, -1,-1,-1,-1,
        10,14,-1,14, -1,10,14,-1, 17,-1,14,-1, 10,-1,-1,-1,
        15,-1,14,-1, 12,-1,14,-1, 10,-1,-1,-1, -1,-1,-1,-1,
        8,12,-1,15, -1,12,8,-1, 12,-1,15,-1, 17,-1,-1,-1,
        15,-1,12,-1, 8,-1,12,-1, 15,-1,-1,-1, -1,-1,-1,-1,
        7,11,-1,14, -1,11,7,-1, 11,-1,14,-1, 14,-1,-1,-1,
        12,-1,11,-1, 7,-1,1,-1, 0,-1,-1,-1, -1,-1,-1,-1,
      ],
      har: [
        0,-1,-1,-1, 3,-1,-1,-1, 7,-1,-1,-1, 3,-1,-1,-1,
        0,-1,-1,-1, 3,-1,-1,-1, 7,-1,-1,-1, 3,-1,-1,-1,
        10,-1,-1,-1, 14,-1,-1,-1, 17,-1,-1,-1, 14,-1,-1,-1,
        10,-1,-1,-1, 14,-1,-1,-1, 17,-1,-1,-1, 14,-1,-1,-1,
        8,-1,-1,-1, 12,-1,-1,-1, 15,-1,-1,-1, 12,-1,-1,-1,
        8,-1,-1,-1, 12,-1,-1,-1, 15,-1,-1,-1, 12,-1,-1,-1,
        7,-1,-1,-1, 11,-1,-1,-1, 14,-1,-1,-1, 11,-1,-1,-1,
        7,-1,-1,-1, 11,-1,-1,-1, 14,-1,-1,-1, 11,-1,-1,-1,
      ],
      bas: [
        0,-1,0,-1, 0,-1,0,-1, 7,-1,7,-1, 0,-1,0,-1,
        0,-1,0,-1, 0,-1,0,-1, 7,-1,7,-1, 0,-1,0,-1,
        10,-1,10,-1, 10,-1,10,-1, 17,-1,17,-1, 10,-1,10,-1,
        10,-1,10,-1, 10,-1,10,-1, 17,-1,17,-1, 10,-1,10,-1,
        8,-1,8,-1, 8,-1,8,-1, 15,-1,15,-1, 8,-1,8,-1,
        8,-1,8,-1, 8,-1,8,-1, 15,-1,15,-1, 8,-1,8,-1,
        7,-1,7,-1, 7,-1,7,-1, 14,-1,14,-1, 7,-1,7,-1,
        7,-1,7,-1, 7,-1,7,-1, 14,-1,14,-1, 7,-1,7,-1,
      ],
      arps: [0,3,7,10],
    },
    schlachthof: {
      title: 'Schlachthof Schicht', bpm: 176, root: 246.94,
      drums: 'driving', bossDrums: 'boss',
      prog: [0,0,1,1,0,0,10,10],
      chd: [[0,3,7],[0,3,7],[1,5,8],[1,5,8],[0,3,7],[0,3,7],[10,14,17],[10,14,17]],
      mel: [
        0,-1,0,1, 3,-1,1,0, -1,-1,0,-1, 7,-1,-1,-1,
        0,-1,0,1, 3,-1,1,0, -1,-1,3,-1, 1,-1,0,-1,
        1,-1,1,2, 5,-1,3,1, -1,-1,1,-1, 8,-1,-1,-1,
        1,-1,5,-1, 3,-1,1,-1, 0,-1,-1,-1, -1,-1,-1,-1,
        0,-1,0,1, 3,-1,1,0, -1,-1,0,-1, 7,-1,-1,-1,
        0,-1,0,1, 3,-1,1,0, -1,-1,3,-1, 1,-1,0,-1,
        10,-1,8,10, 7,-1,10,-1, 14,-1,-1,-1, -1,-1,-1,-1,
        7,-1,8,-1, 10,-1,8,-1, 7,-1,3,-1, 1,-1,0,-1,
      ],
      har: [
        0,-1,-1,-1, 3,-1,-1,-1, 7,-1,-1,-1, 3,-1,-1,-1,
        0,-1,-1,-1, 3,-1,-1,-1, 7,-1,-1,-1, 3,-1,-1,-1,
        1,-1,-1,-1, 5,-1,-1,-1, 8,-1,-1,-1, 5,-1,-1,-1,
        1,-1,-1,-1, 5,-1,-1,-1, 8,-1,-1,-1, 5,-1,-1,-1,
        0,-1,-1,-1, 3,-1,-1,-1, 7,-1,-1,-1, 3,-1,-1,-1,
        0,-1,-1,-1, 3,-1,-1,-1, 7,-1,-1,-1, 3,-1,-1,-1,
        10,-1,-1,-1, 14,-1,-1,-1, 17,-1,-1,-1, 14,-1,-1,-1,
        10,-1,-1,-1, 14,-1,-1,-1, 17,-1,-1,-1, 14,-1,-1,-1,
      ],
      bas: [
        0,-1,0,-1, 0,-1,7,-1, 0,-1,0,-1, 7,-1,0,-1,
        0,-1,0,-1, 0,-1,7,-1, 0,-1,0,-1, 7,-1,0,-1,
        1,-1,1,-1, 1,-1,8,-1, 1,-1,1,-1, 8,-1,1,-1,
        1,-1,1,-1, 1,-1,8,-1, 1,-1,1,-1, 8,-1,1,-1,
        0,-1,0,-1, 0,-1,7,-1, 0,-1,0,-1, 7,-1,0,-1,
        0,-1,0,-1, 0,-1,7,-1, 0,-1,0,-1, 7,-1,0,-1,
        10,-1,10,-1, 10,-1,17,-1, 10,-1,10,-1, 17,-1,10,-1,
        10,-1,10,-1, 10,-1,17,-1, 10,-1,10,-1, 17,-1,10,-1,
      ],
      arps: [0,3,7,10],
    },
    rheingau: {
      title: 'Rheingau Terrassen', bpm: 160, root: 261.63,
      drums: 'upbeat', bossDrums: 'boss',
      prog: [0,0,9,9,5,5,7,7],
      chd: [[0,4,7],[0,4,7],[9,12,16],[9,12,16],[5,9,12],[5,9,12],[7,11,14],[7,11,14]],
      mel: [
        0,-1,2,-1, 4,-1,7,-1, -1,-1,-1,-1, -1,-1,-1,-1,
        9,-1,7,-1, 4,-1,2,-1, -1,-1,-1,-1, -1,-1,-1,-1,
        9,-1,12,-1, 16,-1,12,-1, 9,-1,-1,-1, -1,-1,-1,-1,
        7,-1,9,-1, 12,-1,9,-1, -1,-1,-1,-1, -1,-1,-1,-1,
        5,-1,7,-1, 9,-1,12,-1, 14,-1,-1,-1, -1,-1,-1,-1,
        16,-1,14,-1, 12,-1,9,-1, -1,-1,-1,-1, -1,-1,-1,-1,
        14,-1,16,-1, 14,-1,12,-1, -1,-1,-1,-1, -1,-1,-1,-1,
        9,-1,7,-1, 4,-1,2,-1, 0,-1,-1,-1, -1,-1,-1,-1,
      ],
      har: [
        0,-1,-1,-1, 4,-1,-1,-1, 7,-1,-1,-1, 4,-1,-1,-1,
        0,-1,-1,-1, 4,-1,-1,-1, 7,-1,-1,-1, 4,-1,-1,-1,
        9,-1,-1,-1, 12,-1,-1,-1, 16,-1,-1,-1, 12,-1,-1,-1,
        9,-1,-1,-1, 12,-1,-1,-1, 16,-1,-1,-1, 12,-1,-1,-1,
        5,-1,-1,-1, 9,-1,-1,-1, 12,-1,-1,-1, 9,-1,-1,-1,
        5,-1,-1,-1, 9,-1,-1,-1, 12,-1,-1,-1, 9,-1,-1,-1,
        7,-1,-1,-1, 11,-1,-1,-1, 14,-1,-1,-1, 11,-1,-1,-1,
        7,-1,-1,-1, 11,-1,-1,-1, 14,-1,-1,-1, 11,-1,-1,-1,
      ],
      bas: [
        0,-1,-1,-1, 7,-1,-1,-1, 0,-1,-1,-1, 7,-1,-1,-1,
        0,-1,-1,-1, 7,-1,-1,-1, 0,-1,-1,-1, 7,-1,-1,-1,
        9,-1,-1,-1, 16,-1,-1,-1, 9,-1,-1,-1, 16,-1,-1,-1,
        9,-1,-1,-1, 16,-1,-1,-1, 9,-1,-1,-1, 16,-1,-1,-1,
        5,-1,-1,-1, 12,-1,-1,-1, 5,-1,-1,-1, 12,-1,-1,-1,
        5,-1,-1,-1, 12,-1,-1,-1, 5,-1,-1,-1, 12,-1,-1,-1,
        7,-1,-1,-1, 14,-1,-1,-1, 7,-1,-1,-1, 14,-1,-1,-1,
        7,-1,-1,-1, 14,-1,-1,-1, 7,-1,-1,-1, 14,-1,-1,-1,
      ],
      arps: [0,4,7,12],
    },
  },
  /* ---- Chiptune-Varianten: B-Seite (gerade Wellen & Bosse) ---- */
  CHIPTUNE_SONGS_B: {
    kurpark:    { base: 'kurpark',    title: 'Kurpark Nacht',     bpm: 164, root: 261.63, prog: [0,0,7,7,9,9,5,7], chd: [[0,4,7],[0,4,7],[7,11,14],[7,11,14],[9,12,16],[9,12,16],[5,9,12],[7,11,14]] },
    innenstadt: { base: 'innenstadt', title: 'Innenstadt Schicht', bpm: 168, root: 196.00, prog: [0,0,8,8,3,3,10,10], chd: [[0,3,7],[0,3,7],[8,12,15],[8,12,15],[3,7,10],[3,7,10],[10,14,17],[10,14,17]] },
    rheinufer:  { base: 'rheinufer',  title: 'Rheinufer Nebel',   bpm: 162, root: 293.66, prog: [0,0,4,4,5,5,7,7], chd: [[0,4,7],[0,4,7],[4,7,11],[4,7,11],[5,9,12],[5,9,12],[7,11,14],[7,11,14]] },
    labor:      { base: 'labor',      title: 'Labor Nachtschicht', bpm: 166, root: 207.65, prog: [0,0,5,5,0,0,7,7], chd: [[0,3,7],[0,3,7],[5,8,12],[5,8,12],[0,3,7],[0,3,7],[7,11,14],[7,11,14]] },
    neroberg:   { base: 'neroberg',   title: 'Neroberg Sternfahrt', bpm: 160, root: 329.63, prog: [0,0,5,0,9,5,0,7], chd: [[0,4,7],[0,4,7],[5,9,12],[0,4,7],[9,12,16],[5,9,12],[0,4,7],[7,11,14]] },
    warmerdamm: { base: 'warmerdamm', title: 'Warmer Damm Afterhour', bpm: 170, root: 185.00, prog: [0,0,10,10,8,8,7,7], chd: [[0,3,7],[0,3,7],[10,14,17],[10,14,17],[8,12,15],[8,12,15],[7,11,14],[7,11,14]] },
    schlachthof:{ base: 'schlachthof',title: 'Schlachthof Spaetschicht', bpm: 172, root: 220.00, prog: [0,0,1,1,0,0,10,10], chd: [[0,3,7],[0,3,7],[1,5,8],[1,5,8],[0,3,7],[0,3,7],[10,14,17],[10,14,17]] },
    rheingau:   { base: 'rheingau',   title: 'Rheingau Abendrot', bpm: 156, root: 246.94, prog: [0,0,9,9,5,5,7,7], chd: [[0,4,7],[0,4,7],[9,12,16],[9,12,16],[5,9,12],[5,9,12],[7,11,14],[7,11,14]] },
  },
  _chipV() { return this.CHIPTUNE_STYLES[this._style()] || this.CHIPTUNE_STYLES.pulse; },
  _style() {
    const raw = OPT().musicStyle || 'pulse';
    const legacy = { club: 'pulse', acid: 'snes', rave: 'famicom', chip: 'retro', real: 'pulse', synth: 'snes', '8bit': 'famicom', gb: 'retro', dub: 'pulse', indus: 'famicom', trance: 'snes', breaks: 'retro' };
    const s = legacy[raw] || raw;
    return this.STYLE_ORDER.indexOf(s) >= 0 ? s : 'pulse';
  },
  _songTable(boss) {
    if (boss) return this.CHIPTUNE_SONGS_B;
    const w = (Game && Game.wave) ? Game.wave : 1;
    return (w % 2 === 0) ? this.CHIPTUNE_SONGS_B : this.CHIPTUNE_SONGS;
  },
  previewStyle() {
    if (!this.started || OPT().music <= 0 || !this.ctx) return;
    const V = this._chipV();
    const t0 = this.ctx.currentTime + .02;
    const spb = 60 / 140 / 4;
    const root = 261.63;
    const M = (n, oct) => root * Math.pow(2, n / 12) * (oct || 1);
    /* Sub-Bass */
    this._chipTriangle(M(0), spb * 8, .16, { at: t0 });
    /* Kick + Clap */
    for (let b = 0; b < 4; b++) {
      const t = t0 + b * spb * 4;
      this._chipKick(.22, t);
      if (b === 1 || b === 3) this._chipClap(.06, t + spb * 2);
    }
    /* Hats */
    for (let s = 1; s < 16; s += 2) this._chipHat(s === 15 ? .018 : .012, s === 15, t0 + s * spb);
    /* Melodie */
    const riff = [0, 0, 4, 7, 4, 7, 10, 12, 10, 7, 4, 0, 7, 4, -1, 0];
    for (let s = 0; s < 16; s++) {
      if (riff[s] >= 0) this._chipPulse(M(riff[s], 5), spb * 1.1, .024, { at: t0 + s * spb, pan: (s % 4 === 2) ? .1 : -.1 });
    }
    /* Arp */
    for (let s = 0; s < 8; s++) this._chipArp(M([0,4,7,12][s % 4], 6), spb * .9, .014, { at: t0 + s * spb * 2, pan: (s % 2) ? .15 : -.15 });
  },
  /* ---- Chiptune-Stimmen (NES-Kanal-Modelle) ---- */
  _chipKick(v, at) {
    const g = this.musicGain;
    this.voice({ freq: 176, dur: .1, type: 'sine', vol: v, slide: -126, cutoff: 460, release: .05, start: at, dest: g });
    this.voice({ freq: 62, dur: .12, type: 'sine', vol: v * .9, slide: -18, cutoff: 190, release: .08, start: at, dest: g });
    this.noiseVoice(.01, v * .35, 'highpass', 1400, 4600, 1, { start: at, attack: .001, dest: g });
  },
  _chipClap(v, at) {
    const g = this.musicGain;
    this.noiseVoice(.02, v * .7, 'bandpass', 1500, 1250, 1.3, { start: at, attack: .001, dest: g });
    this.noiseVoice(.02, v * .8, 'bandpass', 1600, 1300, 1.3, { start: at + .011, attack: .001, dest: g });
    this.noiseVoice(.025, v, 'bandpass', 1700, 1350, 1.2, { start: at + .022, attack: .001, dest: g });
    this.noiseVoice(.14, v * .4, 'bandpass', 1200, 950, .9, { start: at + .032, attack: .004, dest: g, verb: .3 });
  },
  _chipHat(v, open, at) {
    if (v <= 0) return;
    this.noiseVoice(open ? .1 : .022, v, 'highpass', open ? 6200 : 7600, open ? 4200 : 8600, .8, { start: at, dest: this.musicGain });
  },
  _chipPulse(f, dur, v, o) {
    o = o || {};
    const V = this._chipV();
    /* Pulse-Width-Modulation: duty bestimmt das Pulsverhaeltnis (NES: 50%)
       Per PeriodicWave als custom-Typ, damit die Web-Audio-Oscillator
       die korrekte Wellenform erzeugt. duty=0.5 = klassisches Square. */
    const duty = V.duty != null ? V.duty : .5;
    const pwType = duty === .5 ? 'square' : null;
    this.voice({
      freq: f, dur: dur, type: pwType || 'square', vol: v,
      attack: .003, release: dur * .6, cutoff: 3200, cutoffEnd: 1800,
      q: .8, drive: V.drive || 1, start: o.at, pan: o.pan || 0,
      dest: this.musicGain, verb: V.delay || .12,
      periodicWave: pwType ? null : this._pwmWave(duty)
    });
  },
  _pwmWave(duty) {
    /* Erzeugt eine PeriodicWave fuer Pulse-Width-Modulation.
       duty = Pulsverhaeltnis (0..1), 0.5 = Square-Welle. */
    const n = 64;
    const re = new Float32Array(n + 1), im = new Float32Array(n + 1);
    re[0] = 0; im[0] = 0;
    for (let k = 1; k <= n; k++) {
      re[k] = 0;
      im[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
    }
    return this.ctx.createPeriodicWave(re, im, { disableNormalization: true });
  },
  _chipTriangle(f, dur, v, o) {
    o = o || {};
    this.voice({
      freq: f, dur: dur, type: 'triangle', vol: v,
      attack: .001, release: dur * .45, cutoff: 1800,
      start: o.at, pan: o.pan || 0, dest: this.musicGain
    });
  },
  _chipNoise(dur, v, open, at) {
    this.noiseVoice(dur, v, 'highpass', open ? 5200 : 7200, open ? 3800 : 8200, .7, { start: at, dest: this.musicGain });
  },
  _chipArp(f, dur, v, o) {
    o = o || {};
    this.voice({
      freq: f, dur: dur * .75, type: 'triangle', vol: v,
      attack: .002, release: dur * .3, cutoff: 4000, cutoffEnd: 2000,
      q: .7, start: o.at, pan: o.pan || 0, dest: this.musicGain, verb: .2
    });
  },
  _chipChord(freqs, dur, v, at) {
    const start = (at && typeof at === 'object') ? (at.at || 0) : (at || 0);
    freqs.forEach((f, i) => {
      this.voice({
        freq: f, dur: dur, type: 'triangle', vol: v / freqs.length,
        attack: .004, release: dur * .5, cutoff: 2800, cutoffEnd: 1200,
        q: .8, drive: 1, start: start,
        pan: (i - (freqs.length - 1) / 2) * .1, dest: this.musicGain, verb: .25
      });
    });
  },
  /* ---- Arrangement: ein 16tel-Schritt des 8-Takt-Loops ---- */  /* ============================================================
     REALISTISCHE INSTRUMENTEN-MODELLE (Synthese / FM / Noise)
     Alle nehmen (f, dur, vol, o) mit o = { dest, pan, verb, start }.
     ============================================================ */
  _iStrings(f, dur, vol, o) {
    const dest = (o && o.dest) || this.musicGain, st = o && o.start, pan = o && o.pan;
    const d = Math.min(dur || 2, 4);
    this.voice({ freq: f, dur: d, type: 'sawtooth', vol: vol, attack: .25, release: .5, slide: 3, cutoff: 1800, cutoffEnd: 2400, q: .8, stack: 3, detune: 10, spread: 9, start: st, pan: pan, dest: dest, verb: .45 });
    this.voice({ freq: f * 1.5, dur: d, type: 'triangle', vol: vol * .5, attack: .3, release: .5, cutoff: 2400, cutoffEnd: 2800, stack: 2, detune: 8, spread: 7, start: st, pan: pan, dest: dest, verb: .4 });
  },
  _iBell(f, dur, vol, o) {
    const dest = (o && o.dest) || this.musicGain, st = o && o.start, pan = o && o.pan;
    const d = Math.min(dur || .6, 1.2);
    this.voice({ freq: f, dur: d, type: 'sine', vol: vol, attack: .002, release: d * .7, cutoff: 9000, q: 1, start: st, pan: pan, dest: dest, verb: .45 });
    this.voice({ freq: f * 2.76, dur: d * .6, type: 'sine', vol: vol * .45, attack: .001, release: d * .5, cutoff: 9000, start: st, pan: pan, dest: dest, verb: .4 });
    this.voice({ freq: f * 5.4, dur: d * .4, type: 'sine', vol: vol * .2, attack: .001, release: d * .3, cutoff: 9000, start: st, pan: pan, dest: dest, verb: .3 });
  },
  _iMusicBox(f, dur, vol, o) {
    const dest = (o && o.dest) || this.musicGain, st = o && o.start, pan = o && o.pan;
    const d = Math.min(dur || .5, 1);
    this.voice({ freq: f, dur: d, type: 'triangle', vol: vol, attack: .001, release: d * .65, cutoff: 8000, start: st, pan: pan, dest: dest, verb: .4 });
    this.voice({ freq: f * 2, dur: d * .8, type: 'sine', vol: vol * .5, attack: .001, release: d * .55, cutoff: 9000, start: st, pan: pan, dest: dest, verb: .35 });
    this.voice({ freq: f * 4, dur: d * .5, type: 'sine', vol: vol * .22, attack: .001, release: d * .35, cutoff: 9000, start: st, pan: pan, dest: dest, verb: .3 });
  },
  /* ---- Arrangement: ein 16tel-Schritt des 8-Takt-Loops (Chiptune) ---- */
  _chipTick(s16, bar, boss, intensity, spb, at) {
    const TB = this._songTable(boss);
    const S0 = TB[this.ambientId] || TB.kurpark || this.CHIPTUNE_SONGS.kurpark;
    let S = S0;
    if (S0.base && this.CHIPTUNE_SONGS[S0.base]) {
      if (this._songCache && this._songCache.ref === S0) S = this._songCache.song;
      else { S = Object.assign({}, this.CHIPTUNE_SONGS[S0.base], S0); this._songCache = { ref: S0, song: S }; }
    }
    const V = this._chipV();
    const D = this.CHIPTUNE_DRUMS[boss ? (S.bossDrums || 'boss') : (S.drums || 'classic')] || this.CHIPTUNE_DRUMS.classic;
    /* Stufe der Akkordfolge — wird NUR noch als Rueckfallebene gebraucht,
       wenn ein Stueck keine ausgeschriebenen Akkorde (chd) mitbringt.
       Die Notenspuren transponiert sie nicht mehr: sie enthalten die
       Akkordfolge bereits. */
    const semi = S.prog[bar] || 0;
    const M = (n, oct) => S.root * Math.pow(2, n / 12) * (oct || 1);
    const I = boss ? 1 : clamp(intensity, 0, 1);
    const DB = boss ? 1.1 : 1;
    const build = (bar === 7);
    const drop = (bar === 0 && s16 === 0);
    const muted = build && s16 >= 12;
    /* Intensitaets-Gates */
    const L = {
      /* Vier Schichten (har, arp, chord, pad) sagen alle dasselbe
         harmonisch. Sie erst spaeter zuschalten haelt den Satz durchhoerbar;
         Melodie, Bass und Schlagwerk tragen ohnehin. */
      drum: I >= .05, mel: I >= .10, har: I >= .18, bas: I >= .12,
      arp: I >= .46, chord: I >= .58, pad: I >= .74
    };
    const dv = .095 * DB, mv = .062 * DB, hv = .022 * DB, bv = .038 * DB, av = .013 * DB;
    const drumsOnly = false;

    /* --- Drop & Build-Up --- */
    if (drop) { this._chipKick(.05 * DB, at); this._chipNoise(.15, .03 * DB, false, at); }
    if (build && s16 === 0) { this._chipNoise(.6, .02 * DB, true, at); }
    if (s16 === 0 && bar === 4 && I >= .5) this._chipNoise(.08, .025 * DB, false, at);

    /* --- Kick --- */
    if (L.drum && D.kick[s16] && !muted) {
      this._chipKick(dv * (s16 % 4 === 0 ? 1 : .85), at);
    }
    if (boss && !muted && (s16 === 7 || s16 === 15)) {
      this._chipKick(dv * .5, at);
    }

    /* --- Hi-Hats --- */
    if (L.drum && D.hihat[s16]) this._chipHat(.014 * DB, false, at);

    /* --- Clap / Snare --- */
    if (L.drum && D.snare[s16] && !muted) this._chipClap(.06 * DB, at);

    /* --- Fill --- */
    if (build && s16 >= 8) this._chipNoise(.03, .04 * DB, false, at);
    if (D.fill && D.fill[s16] && I >= .6 && !muted) this._chipNoise(.025, .035 * DB, false, at);

    /* --- Melodie (Pulse 1) --- */
    if (L.mel && S.mel && !muted) {
      const idx = bar * 16 + s16;
      const n = S.mel[idx];
      if (n != null && n >= 0) {
        /* Naechster Schritt: wenn Pause, Note laenger */
        const nextN = S.mel[(idx + 1) % S.mel.length];
        const dur = (nextN != null && nextN < 0) ? spb * 1.8 : spb * 1.05;
        this._chipPulse(M(n, 5), dur, mv * DB, {
          at: at, pan: (s16 % 8 < 4) ? -.08 : .08
        });
      }
    }

    /* --- Harmonie (Pulse 2) --- */
    if (L.har && S.har && !muted) {
      const idx = bar * 16 + s16;
      const n = S.har[idx];
      if (n != null && n >= 0) {
        const nextN = S.har[(idx + 1) % S.har.length];
        const dur = (nextN != null && nextN < 0) ? spb * 1.8 : spb * 1.05;
        this._chipPulse(M(n, 4), dur, hv * DB, {
          at: at, pan: (s16 % 8 < 4) ? .1 : -.1
        });
      }
    }

    /* --- Bass (Triangle) --- */
    if (L.bas && S.bas && !muted) {
      const idx = bar * 16 + s16;
      const n = S.bas[idx];
      if (n != null && n >= 0) {
        const nextN = S.bas[(idx + 1) % S.bas.length];
        const dur = (nextN != null && nextN < 0) ? spb * 1.5 : spb * 1.05;
        this._chipTriangle(M(n, 2), dur, bv * DB, { at: at });
      }
    }

    /* --- Arpeggio --- */
    if (L.arp && S.arps && S.arps.length && s16 % 2 === 0 && !muted) {
      const arpIdx = (bar * 8 + Math.floor(s16 / 2)) % S.arps.length;
      const note = S.arps[arpIdx];
      const next = S.arps[(arpIdx + 1) % S.arps.length];
      this._chipArp(M(note, 6), spb * .9, av * DB, { at: at, pan: (s16 % 4 === 0) ? -.15 : .15 });
    }

    /* --- Akkord-Stab (bei hoher Intensitaet) --- */
    if (L.chord && s16 === 0 && bar % 2 === 0 && !muted && !drumsOnly) {
      const ch = (S.chd && S.chd[bar]) ? S.chd[bar] : [semi, semi + (semi > 7 ? 3 : 4), semi + 7];
      this._chipChord(ch.map(n => M(n, 3)), spb * 3, .008 * DB * (V.padMix || .3), at);
    }

    /* --- Pad: langgezogene Akkorde (ab sehr hoher Intensitaet) --- */
    if (s16 === 0 && L.pad && !muted && !drumsOnly) {
      const ch = (S.chd && S.chd[bar]) ? S.chd[bar] : [semi, semi + (semi > 7 ? 3 : 4), semi + 7];
      this._chipChord(ch.map(n => M(n, 2)), spb * 14, .006 * DB * (V.padMix || .3), at);
    }

  },
  /* ---- Jingles: Level-Up / Shop / Sieg / Niederlage (Chiptune) ---- */
  jingle(kind) {
    if (!this.started || OPT().music <= 0) return;
    const r = 261.63;
    const M = (n, o) => r * Math.pow(2, n / 12) * (o || 1);
    if (kind === 'level') {
      this._chipKick(.18, 0);
      [0,5,7,12].forEach((n, i) => this._chipArp(M(n, 6), .14, .024, { at: .04 + i * .08 }));
      this._chipChord([M(0, 4), M(5, 4), M(7, 4)], .35, .03, { at: .28 });
    } else if (kind === 'shop') {
      this._chipKick(.15, 0);
      [0,5,9,12].forEach((n, i) => this._chipArp(M(n, 6), .12, .02, { at: .05 + i * .08 }));
    } else if (kind === 'win') {
      this._chipNoise(.12, .06, true, 0);
      [[0,5,9],[5,9,12],[7,12,14],[0,7,12]].forEach((ch, i) => {
        const t0 = i * .28;
        this._chipKick(.2, t0);
        this._chipChord(ch.map(n => M(n, 5)), .24, .03, { at: t0 });
      });
      this._chipChord([M(0, 5), M(7, 5), M(12, 5)], 1, .03, { at: 1.12 });
    } else if (kind === 'lose') {
      this._chipNoise(.15, .08, false, 0);
      this._chipChord([M(0, 4), M(3, 4), M(6, 4)], 1.4, .03, { at: .08 });
    } else if (kind === 'frohes_neues') {
      [0,5,7,12,14,12,7,5].forEach((n, i) => this._chipArp(M(n, 6), .16, .02, { at: i * .1 }));
      this._chipChord([M(0, 5), M(5, 5), M(7, 5)], .7, .03, { at: .6 });
    }
  },
  tickMusic(dt, intensity) {
    this._dangerTick(dt);
    if (!this.started || OPT().music <= 0 || !this.musicOn) { this._nextTime = null; return; }
    if (Game.state === 'paused') {
      this._nextTime = null;
      const c = this.ctx;
      if (this.hum) for (const h of this.hum) h.g.gain.setTargetAtTime(0, c.currentTime, .2);
      if (this.dangerVoice) { try { this.dangerVoice.o.forEach(o => o.stop(c.currentTime + .25)); } catch (e) { } this.dangerVoice = null; }
      return;
    }
    /* ---- Ambiente ---- */
    if (this.ambientId) {
      const amb = OPT().amb != null ? OPT().amb : .7;
      const want = (this._humTarget || 0) * (0.3 + intensity * 0.45) * amb;
      if (this.hum) for (const h of this.hum) h.g.gain.setTargetAtTime(want, this.ctx.currentTime, .8);
      this._ambTick(dt);
    }
    /* ---- Sequencer ---- */
    const boss = this.bossMode;
    const V = this._chipV();
    const TB = this._songTable(boss);
    /* Menuemusik laeuft, solange KEIN Lauf aktiv ist — unabhaengig davon,
       welcher Menuebildschirm offen ist. Frueher hing das an
       UI.cur === 'scTitle': schon ein Klick auf Optionen machte die
       Bedingung falsch und riss von 132 auf 168 BPM samt anderem Stueck. */
    const onTitle = Game.state === 'title' || Game.state === 'end';
    const S = onTitle ? this.CHIPTUNE_SONGS.title
      : (TB[this.ambientId] || TB.kurpark || this.CHIPTUNE_SONGS.kurpark);
    /* Im Menue keine Intensitaets-Beschleunigung: das Titelthema soll
       ruhig stehen, nicht mit der Wellenzahl hochdrehen. */
    const bpm = (S.bpm || 140) * (onTitle ? 1 : (boss ? 1.07 : 1) * (1 + Math.pow(clamp(intensity, 0, 1), 1.6) * .055));
    const spb = 60 / bpm / 4;
    const now = this.ctx.currentTime;
    if (this._nextTime == null || this._nextTime < now - .3 || this._nextTime > now + 1.5) this._nextTime = now + .05;
    if (this._lastBpm) {
      const diff = bpm - this._lastBpm;
      if (diff > .5 || diff < -.5) {
        const nspb = 60 / (this._lastBpm + diff * .2) / 4;
        this._nextTime = Math.max(this._nextTime, this._lastNextTime != null ? this._lastNextTime + nspb : this._nextTime);
      }
    }
    this._lastBpm = bpm;
    this._lastNextTime = this._nextTime;
    let guard = 0;
    while (this._nextTime < now + .16 && guard++ < 8) {
      const at = Math.max(0, this._nextTime - now);
      this._chipTick(this.musicStep % 16, Math.floor(this.musicStep / 16) % 8, boss, intensity, spb, at);
      this.musicStep++;
      this._nextTime += spb;
    }
    this.musicTimer = spb;
  }
};

