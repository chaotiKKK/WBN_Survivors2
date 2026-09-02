Object.assign(Game, {
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
});
