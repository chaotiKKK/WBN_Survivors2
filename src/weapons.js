/* ===== KAMPF-REGELN (Combat) — purer Kern + Effekt-Schale =====  COMBAT_MODULE_V1
   Vertiefung: Treffer-Mathe (war Enemy.hurt), Element-Reaktionen (waren
   Game.elem*) und der Reaktions-Dispatch (war Enemy.applyElement) lagen über
   drei Module verstreut — die Balance lebte im Call-Graphen. Jetzt:
     - resolveHit / resolveReaction: reiner, deterministischer Kern (kein
       FX/Audio/Statistik) — Tests und BalanceSim nutzen dieselben Regeln.
     - applyHit / applyReaction / applyElement / tickStatus: Effekt-Schale,
       mutiert die Welt.
   Welt-Zugriff ausschliesslich über den injizierten Kontext (setWorld):
   im Spiel Game, im Headless-Test ein Stub. */
const Combat = {
  W: null,               /* Welt-Kontext (setWorld) */
  _lastElem: null,
  _tmp: [], _tmp2: [],   /* Scratch-Arrays fuer Hash-Queries (wie Game._tmp) */

  setWorld(g) { this.W = g; },

  phaseIndex(hp, maxHp, phases) {
    const frac = hp / Math.max(1, maxHp);
    let index = 0;
    for (let i = 0; i < (phases || []).length; i++) if (frac <= phases[i].at) index = i;
    return index;
  },

  /* ---------- Reiner Kern: Treffer-Mathe (deterministisch) ---------- */
  mitigation(armor, armorBuff, armorPierce, marked, dmg) {
    const eff = Math.max(0, (armor + armorBuff) * (1 - (armorPierce || 0)));
    let d = dmg * (18 / (18 + eff));
    if (marked > 0) d *= 1.35;
    return Math.max(1, d);
  },
  /* Treffer-Ausgang ohne jede Mutation: {dmg, crit, died, tier, core, shield} */
  resolveHit(h) {
    const tgt = h.tgt;
    if (!isFinite(h.dmg)) return { dmg: 0, crit: !!h.isCrit, died: false, tier: 0, core: false, shield: false };
    let d = h.dmg, crit = !!h.isCrit, core = false, shield = false;
    if (tgt.boss && tgt.coreOpen && h.type !== 'poison' && h.type !== 'burn') { d *= 3; crit = true; core = true; }
    if (tgt.def && tgt.def.ai === 'shielded' && tgt.def.shieldArc && h.src && h.src.x !== undefined && tgt.target) {
      const toSrc = Math.atan2(tgt.y - h.src.y, tgt.x - h.src.x);
      const facing = Math.atan2(tgt.target.y - tgt.y, tgt.target.x - tgt.x);
      if (Math.abs(angDiff(toSrc, facing)) < tgt.def.shieldArc) { d *= .12; shield = true; }
    }
    d = this.mitigation(tgt.armor, tgt.armorBuff, h.armorPierce, tgt.marked, d);
    return { dmg: d, crit, died: tgt.hp - d <= 0, tier: d / Math.max(1, tgt.maxHp), core, shield };
  },

  /* ---------- Reiner Kern: Spieler-Treffer-Mathe (deterministisch) ---------- */
  /* h: {p, v}; rng injizierbar (Default Math.random) — liefert {valid, dodged, dmg, died} */
  resolvePlayerHit(h) {
    const p = h.p;
    if (!isFinite(h.v)) return { valid: false, dodged: false, dmg: 0, died: false };
    const rng = h.rng || Math.random;
    if (rng() * 100 < Math.min(60, p.st.dodge)) return { valid: true, dodged: true, dmg: 0, died: false };
    const armor = p.st.armor;
    const mult = armor >= 0 ? 15 / (15 + armor) : 1 + Math.abs(armor) * .06;
    const dmg = Math.max(1, h.v * mult) * (p.wagerFragile ? 2 : 1);
    return { valid: true, dodged: false, dmg, died: p.hp - dmg <= 0 };
  },

  /* ---------- Reiner Kern: Spiegelungs-Entscheidung (deterministisch, rng injizierbar) ---------- */
  resolveMirror(h, rng) {
    if (h.tgt.eliteTrait !== 'spiegelnd') return { reflected: false };
    if (!h.src || typeof h.src.damage !== 'function') return { reflected: false };
    if ((rng || Math.random)() >= .22) return { reflected: false };
    if (h.type === 'thorns') return { reflected: false };
    return { reflected: true, reflectedDmg: h.dmg * .12, angle: Math.atan2(h.src.y - h.tgt.y, h.src.x - h.tgt.x) };
  },

  /* ---------- Reiner Kern: Reaktions-Ausgang (deterministisch via W.hash) ---------- */
  /* Entscheidet, welche Ziele eine Reaktion trifft und mit welchem Schaden —
     mutiert nichts. liefert { list:[{t,dmg,knock,status}], field, fx } */
  resolveReaction(kind, e, s, src) {
    const W = this.W;
    const list = [];
    if (kind === 'chain') {
      let cur = e, n = 3;
      const seen = new Set();
      while (cur && n > 0) {
        seen.add(cur);
        list.push({ t: cur, dmg: s * .32 });
        n--;
        const near = W.hash.query(cur.x, cur.y, 190, this._tmp).filter(t => !t.dead && !seen.has(t));
        if (!near.length) break;
        cur = near[0];
      }
      return { list, field: null, fx: 'chain' };
    }
    if (kind === 'boom') {
      const r = 130;
      const near = W.hash.query(e.x, e.y, r + 40, this._tmp2);
      for (const t of near) if (!t.dead && dist(t.x, t.y, e.x, e.y) < r + t.r) {
        list.push({ t, dmg: s * .6 * clamp(1 - dist(t.x, t.y, e.x, e.y) / (r + t.r), .35, 1), knock: 260 });
      }
      return { list, field: null, fx: 'boom', r };
    }
    if (kind === 'vapor') {
      const near = W.hash.query(e.x, e.y, 104, this._tmp2);
      for (const t of near) if (!t.dead && t !== e) list.push({ t, dmg: s * .5 });
      return { list, field: null, fx: 'vapor' };
    }
    if (kind === 'shatter') {
      list.push({ t: e, dmg: s * 1.35 });
      return { list, field: null, fx: 'shatter' };
    }
    if (kind === 'smoke') {
      const r = 120;
      const near = W.hash.query(e.x, e.y, r, this._tmp2);
      for (const t of near) if (!t.dead) list.push({ t, dmg: 0, status: true });
      return { list, field: { type: 'poison', x: e.x, y: e.y, r, dps: s * .22, temp: 3 }, fx: 'smoke' };
    }
    return { list, field: null, fx: kind };
  },

  /* ---------- Effekt-Schale: Treffer anwenden ---------- */
  applyHit(h) {
    const tgt = h.tgt;
    if (!isFinite(h.dmg)) return 0;
    const W = this.W;
    /* Spiegelnde Elite — pure Entscheidung (resolveMirror) + Effekt */
    const mirror = this.resolveMirror(h, Math.random);
    if (mirror.reflected) {
      h.src.damage(mirror.reflectedDmg, mirror.angle);
      FX.line(tgt.x, tgt.y, h.src.x, h.src.y, '#bfe8ff', .18);
    }
    if (tgt.dead) return 0;
    if (h.weapon) tgt.lastHitWeapon = h.weapon;
    const r = this.resolveHit(h);
    const d = r.dmg, isCrit = r.crit, tier = r.tier;
    /* Bosskern-Treffer: Sonder-FX (war im alten hurt-Block) */
    if (r.core && Math.random() < .5) {
      FX.number(tgt.x, tgt.y - tgt.r - 12, 'KERNTREFFER', '#ffe27a', 1.1);
      FX.sparkShower(tgt.x, tgt.y, crnd(TAU), 6, '#ffe27a', 300);
      FX.light(tgt.x, tgt.y, 140, '#ffe27a', .16, 1);
      AudioSys.sfxAt('crit', tgt.x, tgt.y, 1.2);
    }
    /* Schild-Absorption: visueller Zustand + Funken */
    if (r.shield) {
      tgt.shieldHit = .15;
      const facing = Math.atan2(tgt.target.y - tgt.y, tgt.target.x - tgt.x);
      FX.spark(tgt.x + Math.cos(facing) * tgt.r, tgt.y + Math.sin(facing) * tgt.r, facing + Math.PI, '#9fb4d8');
      AudioSys.sfxAt('clank', tgt.x, tgt.y);
    }
    tgt.hp -= d;
    /* Trefferwucht gestaffelt: Blitz, Stauchung, bei schweren Treffern Hitstop */
    tgt.hitFlash = tier > .12 ? .26 : tier > .04 ? .18 : .12;
    tgt.squash = clamp(.14 + tier * 2.4, .14, .55);
    tgt.squashAng = (h.src && typeof h.src.x === 'number') ? Math.atan2(tgt.y - h.src.y, tgt.x - h.src.x) : rnd(TAU);
    if (tier > .10 && !tgt.boss && !tgt.dead) { W.hitstop = Math.max(W.hitstop, .05); W.timeScale = Math.min(W.timeScale, .5); }
    if (h.src && h.src.stats) { h.src.stats.dmg += d; if (W.run) W.run.dmg += d; }
    if (h.type === 'elem' && W.run) { W.run.track.elemDmg += d; Save.progMax('elemDmgRun', Math.round(W.run.track.elemDmg)); }
    if (OPT().dmgNumbers) {
      const sc = isCrit ? 1.35 + Math.min(.9, tier * 3) : .8 + Math.min(.8, tier * 3.4);
      const col = isCrit ? '#ffe27a' : tier > .12 ? '#ffb24a' : tier > .04 ? '#ffffff' : '#c9d3e4';
      FX.number(tgt.x + crnd(-6, 6), tgt.y - tgt.r - 4, Math.round(d), col, sc);
    }
    if (isCrit) { AudioSys.sfxAt('crit', tgt.x, tgt.y); W.contractProgress('crit', 1); }
    else if (h.type === 'elem') { if (Math.random() < .6) AudioSys.sfxAt('hitElem', tgt.x, tgt.y); }
    else if (h.type === 'melee') { if (Math.random() < .7) AudioSys.sfxAt('hitMelee', tgt.x, tgt.y); }
    else if (h.type !== 'boom' && Math.random() < .55) AudioSys.sfxAt('hit', tgt.x, tgt.y);
    for (let i = 0; i < (isCrit ? 6 : 2) * OPT().particles; i++)
      FX.particle(tgt.x, tgt.y, crnd(TAU), crnd(40, 150), tgt.col, .3, 2.5);
    if (h.type === 'melee' || h.type === 'elem') FX.mud(tgt.x, tgt.y, h.src ? Math.atan2(tgt.y - h.src.y, tgt.x - h.src.x) : crnd(TAU), isCrit ? 1.3 : .8);
    if (isCrit && OPT().particles > 0) {
      FX.shockwave(tgt.x, tgt.y, 34, '#ffe27a');
      for (let i = 0; i < 4; i++) FX.sparkle(tgt.x, tgt.y, crnd(TAU), crnd(90, 210), Math.random() < .5 ? '#ffe27a' : '#ffffff', crnd(.3, .45), 2);
    }
    if (W.level && W.level.decals && W.level.decals.length < 260 && Math.random() < .16 * OPT().particles)
      W.level.decals.push({ x: tgt.x, y: tgt.y, r: tgt.r * crnd(.4, .9), c: shade(tgt.col, -.3), t: 0, life: crnd(2.5, 5) });
    if (tgt.hp <= 0) tgt.die(h.src, h.type);
    return d;
  },

  /* ---------- Effekt-Schale: Spieler-Treffer anwenden (Gegner→Spieler) ---------- */
  applyPlayerHit(h) {
    const p = h.p;
    if (p.invuln > 0) return;
    const r = this.resolvePlayerHit(h);
    if (!r.valid) return;
    if (r.dodged) { FX.number(p.x, p.y - 22, 'AUSWEICH', '#39e6ff', .9); return; }
    const W = this.W;
    const dmg = r.dmg;
    p.hp -= dmg; p.stats.taken += dmg; p.tookDamageThisWave = true;
    W.combo = 0; W.comboT = 0;
    p.invuln = .45; p.hitFlash = .25; p.critStreak = 0;
    W.feedback(null, null, 'klein');
    AudioSys.sfx('hurt'); Input.rumble(Input.padMap[p.index], 180, .7, .4);
    FX.number(p.x, p.y - 24, '-' + Math.round(dmg), '#ff4d5e', 1.1);
    for (let i = 0; i < 8; i++) FX.particle(p.x, p.y, crnd(TAU), crnd(60, 180), '#ff4d5e', .45, 3);
    FX.splashDrops(p.x, p.y, h.srcAngle != null ? h.srcAngle : rnd(TAU), 8, '#a01824');
    FX.decal(p.x, p.y + 8, rnd(4, 9), '#7a1420', 'blood', rnd(6, 11));
    FX.light(p.x, p.y, 90, '#ff4d5e', .18, .7);
    W.addSplat(h.srcAngle != null ? h.srcAngle + Math.PI : rnd(TAU), clamp(dmg / Math.max(1, p.maxHp), .12, .8), p.index);
    const thorns = p.items.reduce((a, id) => a + ((ITEM_BY_ID[id] && ITEM_BY_ID[id].thorns) || 0), 0);
    if (thorns) {
      const list = W.hash.query(p.x, p.y, 90, W._tmp);
      for (const e of list) if (!e.dead && dist(e.x, e.y, p.x, p.y) < 90) e.hurt(thorns, false, p, 'thorns');
    }
    if (p.hp <= 0) p.down();
  },

  /* ---------- Effekt-Schale: Element-Anwendung (Dispatch-Tabelle) ---------- */
  applyElement(e, elem, strength, src) {
    if (e.dead) return;
    const W = this.W;
    const s = Math.max(1, strength || 1);
    this._lastElem = elem;
    const react = () => { if (e.reactionCd > 0) return false; e.reactionCd = .45; return true; };
    switch (elem) {
      case 'fire':
        if (e.freezeT > 0 && react()) { e.freezeT = 0; e.freeze = 0; this.applyReaction('vapor', e, s, src); return; }
        if (e.poisonT > 0 && react()) { this.applyReaction('smoke', e, s, src); return; }
        e.applyBurn(s, W.modIs('regen') ? 2 : 3);
        FX.spark(e.x, e.y, crnd(TAU), '#ff7a3d');
        break;
      case 'ice':
        if (e.burnT > 0 && react()) { e.burn = 0; e.burnT = 0; this.applyReaction('vapor', e, s, src); return; }
        if (e.shockT > 0 && react()) { e.shockT = 0; this.applyReaction('shatter', e, s, src); return; }
        e.applySlow(.5, 1.6);
        /* Hitze lässt Eis schneller schmelzen */
        const ft = Math.min(2, .45 + s * .02) * (W.modIs('hitze') ? .5 : 1);
        e.freezeT = Math.max(e.freezeT, ft);
        if (e.freezeT >= 1 && e.freeze <= 0) FX.shockwave(e.x, e.y, e.r + 8, '#bfefff');
        break;
      case 'shock':
        if (e.freezeT > 0 && react()) { e.freezeT = 0; e.freeze = 0; this.applyReaction('shatter', e, s, src); return; }
        e.shockT = Math.max(e.shockT, 2.2);
        this.applyReaction('chain', e, s, src);
        break;
      case 'poison':
        if (e.burnT > 0 && react()) { this.applyReaction('smoke', e, s, src); return; }
        e.applyPoison(s, 3);
        break;
      case 'boom':
        this.applyReaction('boom', e, s, src);
        break;
    }
  },

  /* ---------- Effekt-Schale: Reaktion anwenden ---------- */
  applyReaction(kind, e, s, src) {
    const W = this.W;
    const R = this.resolveReaction(kind, e, s, src);
    if (kind === 'vapor') {
      AudioSys.sfx('w_loeschwasser');
      FX.shockwave(e.x, e.y, 96, '#cfe8ff');
      FX.flash(e.x, e.y, crnd(TAU), '#cfe8ff', 22);
      for (const h of R.list) h.t.hurt(h.dmg, false, src, 'elem');
      e.applySlow(.45, 2);
      for (let i = 0; i < 12; i++) FX.particle(e.x, e.y, crnd(TAU), crnd(40, 200), '#eaf6ff', .45, 2);
    } else if (kind === 'shatter') {
      AudioSys.sfx('shard');
      FX.shockwave(e.x, e.y, 72, '#bfefff');
      for (const h of R.list) h.t.hurt(h.dmg, false, src, 'elem');
      for (let i = 0; i < 10; i++) FX.shard(e.x, e.y, crnd(TAU), crnd(120, 320), '#bfefff', .5, 4);
    } else if (kind === 'chain') {
      for (const h of R.list) {
        W._elemBolt(e.x, e.y, h.t.x, h.t.y, '#ffe27a');
        h.t.hurt(h.dmg, false, src, 'elem');
      }
      AudioSys.sfx('chain');
    } else if (kind === 'smoke') {
      AudioSys.sfx('w_spore');
      const r = 120;
      FX.shockwave(e.x, e.y, r, '#b8d98a');
      if (R.field) W.level.fields.push(R.field);
      for (const h of R.list) if (h.status) h.t.applyPoison(s * .22, 3);
      setTimeout(() => { const i = W.level.fields.indexOf(R.field); if (i >= 0) W.level.fields.splice(i, 1); }, 3000);
    } else if (kind === 'boom') {
      const r = R.r || 130;
      FX.explosion(e.x, e.y, r, '#ff8a3d');
      AudioSys.sfx('boom');
      W.feedback(e.x, e.y, 'klein');
      for (const h of R.list) {
        h.t.hurt(h.dmg, false, src, 'boom');
        h.t.knockback(Math.atan2(h.t.y - e.y, h.t.x - e.x), h.knock || 260);
      }
    }
    this.countReaction(e, src);
  },

  /* Statistik/Progress einer Reaktion (Effekt) */
  countReaction(e, src) {
    const W = this.W;
    if (src && src.stats) src.stats.reactions = (src.stats.reactions || 0) + 1;
    if (W.run) W.run.track.reactions++;
    Save.prog('reactions', 1);
    if (e && Math.random() < .25) FX.number(e.x, e.y - e.r - 14, 'REAKTION', ELEMENTS[this._lastElem] ? ELEMENTS[this._lastElem].color : '#ffffff', .7);
  },

  /* ---------- Effekt-Schale: Status-Ticks (aus Enemy.update) ---------- */
  /* Liefert true, wenn der Gegner durch Burn/Poison gestorben ist. */
  tickStatus(e, dt) {
    const W = this.W;
    if (e.burnT > 0) {
      e.burnT -= dt;
      /* Wetter-Interaktion: Regen löscht Feuer, Hitze facht es an */
      let bdps = e.burn;
      if (W.modIs('regen')) bdps *= .7; else if (W.modIs('hitze')) bdps *= 1.2;
      e.hp -= bdps * dt;
      if (Math.random() < dt * 12) FX.particle(e.x, e.y, crnd(TAU), crnd(20, 60), '#ff7a3d', .3, 2);
      if (Math.random() < dt * 5) FX.sparkle(e.x + crnd(-e.r, e.r), e.y - crnd(0, e.r), -Math.PI / 2 + crnd(-.5, .5), crnd(30, 90), '#ffb24a', .45, 1.6);
      if (e.hp <= 0) { e.die(W.players[0], 'burn'); return true; }
    }
    if (e.poisonT > 0) {
      e.poisonT -= dt; e.hp -= e.poison * dt;
      if (Math.random() < dt * 8) FX.particle(e.x, e.y, crnd(TAU), crnd(10, 40), '#b8d98a', .4, 2);
      if (e.hp <= 0) { e.die(W.players[0], 'poison'); return true; }
    }
    return false;
  },

  /* ---------- BalanceSim-Kopplung: simulierter Treffer-Ertrag ---------- */
  /* Basis-Treffer je Waffe (NUR der direkte Treffer — Reaktions-Ertrag kommt
     aus den puren Funktionen unten, damit die Sim die echten Regeln rechnet
     statt pauschaler Multiplikatoren). */
  hitsPerAttack(def, x) {
    switch (def.type) {
      case 'projectile': {
        let h = (x.pellets || 1) * (1 + (x.pierce ? Math.min(x.pierce, 4) * .45 : 0));
        if (x.cloud) h *= 2.4; if (x.bounce) h *= 1.25;
        return h;
      }
      case 'hitscan': return 3.2 + (x.perHit || 0) * 8;
      case 'cone': return 1.4 + (x.cone || 1) * 1.15;
      case 'chain': return 1;
      case 'charge': return 2.6;
      case 'aura': return 3.6;
      case 'melee': return 1.1 + (x.arc || 1) * .95;
      default: return 1;
    }
  },

  /* ---------- Reiner Kern: Reaktions-Ertrag aus den ECHTEN Regeln ---------- */
  /* Waffen-Kette (chain-Typ, WeaponSystem.fire): d *= .88 je Sprung —
     geometrische Reihe Σ .88^i über x.chain Sprünge. */
  chainFactor(x) {
    const n = x.chain || 3;
    let s = 0, d = 1;
    for (let i = 0; i < n; i++) { s += d; d *= .88; }
    return s;
  },
  /* Explosion (Projectiles.detonate): Direkttreffer 1 + .9 * E[falloff] * Dichte.
     E[falloff] ≈ .58 (Mittel der Falloff-Kurve über den Radius), Dichte 2 =
     erwartete weitere Gegner im Explosionsradius. */
  boomFactor() { return 1 + .9 * .58 * 2; },
  /* Burn (applyElement('fire') -> applyBurn(s,3)): s = burn*(1+elem/100) DPS
     je brennendem Ziel; bei Dauerfeuer wird aufgefrischt -> DPS-Zuschlag. */
  burnDps(x, st, hits) { return (x.burn || 0) * (1 + ((st && st.elem) || 0) / 100) * Math.max(1, hits); },
  /* Klingel-Reaktions-Kette: applyElement('shock', dd*.3) -> resolveReaction
     chain: 3 Ziele à s*.32 -> Zuschlag .3*.32*3 = .288 je Kegel-Treffer. */
  chainReact() { return .3 * .32 * 3; },
};

/* ============================ 15. WAFFENSYSTEM ============================ */
const WeaponSystem = {
  damage(p, w) {
    const def = WEAPON_BY_ID[w.id], t = tierData(def, w.tier);
    let d = t.dmg;
    for (const k in def.scaling) d += (p.st[k] || 0) * def.scaling[k];
    d *= (1 + p.st.dmgP / 100);
    d *= attMod(w).dmg;
    d *= (1 + (p.perfectBonus || 0));
    if (p.manualAim && (WEAPON_BY_ID[w.id].cls || []).indexOf('precise') >= 0) d *= 1.15;
    else if (p.manualAim) d *= 1.07;
    if (w.ethereal) d *= (1.15 + Math.min(1.5, w.kills * .006));
    if (Game.modActive('umschaltung') && Game.swapIdx === 0) d *= 1.2;
    return d;
  },
  range(p, w) { const t = tierData(WEAPON_BY_ID[w.id], w.tier); return t.range * (1 + p.st.range / 100) * attMod(w).range; },
  stealthOf(p) {
    let s = 0;
    for (const w of p.weapons) s = Math.max(s, attMod(w).aggro);
    return s;
  },
  cooldown(p, w) { const t = tierData(WEAPON_BY_ID[w.id], w.tier); let c = Math.max(.045, t.as / ((1 + p.st.atkSpd / 100) * attMod(w).rate)); if (Game.modActive('umschaltung') && Game.swapIdx === 1) c *= .8; return c; },
  critInfo(p, w) {
    const t = tierData(WEAPON_BY_ID[w.id], w.tier);
    const A = attMod(w);
    return { c: clamp(t.critC + p.st.crit / 100 + A.critC + (Game.modActive('umschaltung') && Game.swapIdx === 2 ? .1 : 0), 0, .95), m: t.critM * (1 + p.st.critDmg / 100) * A.critM };
  },
  update(p, w, slot, dt) {
    const def = WEAPON_BY_ID[w.id];
    if (w.kick) w.kick = Math.max(0, w.kick - dt * 7);
    const targetAngle = p.aim + (slot - (p.weapons.length - 1) / 2) * .34;
    w.angle = w.angle + angDiff(targetAngle, w.angle) * clamp(dt * 14, 0, 1);
    const rng = this.range(p, w);
    if (def.type === 'aura') { this.auraTick(p, w, dt); return; }
    w.cd -= dt;
    if (def.type === 'charge') {
      const t = tierData(def, w.tier);
      w.charge = Math.min(1, w.charge + dt / t.x.chargeT);
    }
    if (w.cd > 0) return;
    /* Manuelles Zielen: in Blickrichtung feuern und das Ziel darin suchen */
    let target, ang;
    if (p.manualAim) {
      target = Game.enemyInCone(p.x, p.y, p.aim, rng, .5) || Game.nearestEnemy(p.x, p.y, rng);
      ang = p.aim;
      if (!target && !Game.enemyInCone(p.x, p.y, p.aim, rng * 1.4, .9)) return;
    } else {
      target = Game.nearestEnemy(p.x, p.y, rng);
      if (!target) return;
      ang = Math.atan2(target.y - p.y, target.x - p.x);
    }
    w.cd = this.cooldown(p, w);
    this.fire(p, w, ang, target, rng);
  },
  /* Aufsätze verändern auch den Klang: der Schalldämpfer nimmt dem Schuss den Knall */
  weaponSfx(w, name, A) {
    A = A || attMod(w);
    if (A.quiet) {
      const bak = AudioSys._sMul != null ? AudioSys._sMul : 1;
      AudioSys._sMul = bak * .45;
      AudioSys.sfx('w_suppressed');
      AudioSys._sMul = bak;
      return;
    }
    AudioSys.sfx(name);
  },
  fire(p, w, ang, target, rng) {
    const def = WEAPON_BY_ID[w.id], t = tierData(def, w.tier), x = t.x;
    const dmg = this.damage(p, w), crit = this.critInfo(p, w);
    const A = attMod(w);
    Input.rumbleWeapon(w.id, p.index);
    const off = (p.char && p.char.skin && p.char.skin.build === 'giant') ? 30 : 22;
    const ox = p.x + Math.cos(w.angle) * off, oy = p.y + Math.sin(w.angle) * off;
    const elemental = !!x.elemental;
    switch (def.type) {
      case 'projectile': {
        const n = x.pellets || 1, spread = (x.spread || (n > 1 ? .3 : .05)) * A.spread;
        const isNote = w.id === 'musiknoten';
        const isAdvice = !!x.advice;
        const noteCols = ['#ff5ce0', '#59e6ff', '#a06bff', '#ffe27a'];
        const adviceCols = ['#ffd24a', '#ffe89a', '#c9a6ff', '#8ff0d0'];
        for (let i = 0; i < n; i++) {
          const a = ang + (n > 1 ? (i - (n - 1) / 2) * (spread / Math.max(1, n - 1)) * 2 + rnd(-.03, .03) : rnd(-.02, .02));
          Game.spawnProjectile({
            x: ox, y: oy, angle: a, speed: 700 + (x.boom ? -180 : 0), dmg, owner: p, weapon: w,
            col: isNote ? noteCols[Math.floor(Math.random() * noteCols.length)] : isAdvice ? adviceCols[Math.floor(Math.random() * adviceCols.length)] : def.col,
            life: rng / (700 + (x.boom ? -180 : 0)), r: isNote ? 6 : isAdvice ? 7 : (x.boom ? 6 : 4),
            shape: isNote ? 'note' : isAdvice ? 'advice' : '', size: isNote ? 9 : isAdvice ? 11 : 0,
            word: isAdvice ? ADVICE_WORDS[Math.floor(Math.random() * ADVICE_WORDS.length)] : '',
            critC: crit.c, critM: crit.m, pierce: Math.max(0, (x.pierce || 0) + p.st.pierce + A.pierce),
            bounce: (x.bounce || 0) + p.st.bounce, boom: x.boom ? x.boom * (1 + p.st.expSize / 100) * A.boom : 0,
    slow: Math.max(x.slow || 0, A.slow), slowT: Math.max(x.slowT || 0, A.slowT), poison: Math.max(x.poison || 0, A.poison), poisonT: x.poisonT, cloud: x.cloud,
    armorPierce: (x.armorPierce || 0) + A.armorPierce, lifesteal: x.lifesteal || 0, ls: A.ls || 0, healHit: x.healHit || 0,
            pull: x.pull, elemental: elemental || !!A.burn, burn: Math.max(x.burn || 0, A.burn), source: def.id, starfall: x.arcRain,
            homing: x.homing || 0, stick: x.stick || 0
          });
        }
        this.weaponSfx(w, WEAPON_SFX[w.id] || (x.boom ? 'w_plasma' : 'w_pistol'), A);
        break;
      }
      case 'hitscan': {
        const ex = p.x + Math.cos(ang) * rng, ey = p.y + Math.sin(ang) * rng;
        FX.beam(ox, oy, ex, ey, def.col, 8);
        FX.bolt(ox, oy, ex, ey, '#ffffff', 6, 5);
        if (OPT().particles > 0) {
          const steps = Math.min(26, Math.floor(rng / 24));
          for (let i = 1; i < steps; i++) {
            const tt = i / steps;
            const bx = ox + (ex - ox) * tt, by = oy + (ey - oy) * tt;
            FX.px(bx + crnd(-2, 2), by + crnd(-2, 2), Math.random() < .4 ? '#ffffff' : def.col, crnd(1.4, 2.6), crnd(.1, .3), { glow: 1 });
            if (Math.random() < .18) FX.particle(bx, by, ang + Math.PI / 2 * (Math.random() < .5 ? 1 : -1), crnd(40, 130), def.col, .22, 1.8, { shape: 'pixel', dg: .2, glow: 1 });
          }
          FX.ripple(ex, ey, 22, def.col, .22);
          FX.sparkShower(ex, ey, ang + Math.PI, 5, '#ffffff', 240);
        }
        Game.feedback(null, null, 'klein');
        const hits = Game.raycastEnemies(p.x, p.y, ang, rng, 22);
        let mult = 1, n = 0;
        for (const e of hits) {
          const isCrit = RAND() < crit.c;
          const d = dmg * mult * (isCrit ? crit.m : 1);
          e.hurt(d, isCrit, p, 'ranged', p.st.pierce > 0 ? .1 : 0, w);
          this.onHit(p, w, e, d, isCrit, {});
          mult += (x.perHit || 0); n++;
        }
        if (n >= 3) Save.prog('railMulti', 1);
        AudioSys.sfx(WEAPON_SFX[w.id] || 'w_railgun');
        break;
      }
      case 'cone': {
        const half = (x.cone || 1) / 2, r = rng;
        if (w.id !== 'loeschwasser') FX.cone(p.x, p.y, ang, r, half, def.col);
        if (OPT().particles > 0 && w.id !== 'loeschwasser') {
          const fire = !!x.burn;
          const n = Math.min(34, Math.floor(r / 12));
          for (let i = 0; i < n; i++) {
            const a2 = ang + rnd(-half, half), sp = rnd(260, 720);
            const d0 = rnd(0, r);
            const px2 = ox + Math.cos(a2) * d0 * .3, py2 = oy + Math.sin(a2) * d0 * .3;
            if (fire) {
              if (i === 0) { FX.haze(ox, oy, ang, r, half, .24); FX.light(ox + Math.cos(ang) * r * .4, oy + Math.sin(ang) * r * .4, r * 1.3, '#ff9a3d', .12, 1); }
              FX.particle(px2, py2, a2, sp, Math.random() < .5 ? '#ff7a3d' : '#ffcf4a', crnd(.2, .45), crnd(2, 4.4), { shape: 'pixel', dg: .25, flick: 20, glow: 1 });
              if (Math.random() < .3) FX.smoke(px2, py2, a2, 120, 1, 'rgba(70,60,55,.45)', 3.6);
            } else {
              FX.particle(px2, py2, a2, sp, def.col, crnd(.18, .4), crnd(1.6, 3.4), { shape: 'pixel', dg: .25, glow: 1 });
            }
          }
          FX.ember(ox, oy, fire ? 3 : 0, '#ff8a3d', 160);
        }
        if (w.id === 'loeschwasser') {
          const n = Math.min(38, Math.floor(r / 13));
          for (let i = 0; i < n; i++) {
            const a = ang + rnd(-.1, .1), sp = rnd(620, 940);
            const t0 = rnd(0, .55), dist0 = Math.min(r, t0 * sp);
            FX.particle(ox + Math.cos(ang) * dist0, oy + Math.sin(ang) * dist0, a, sp, Math.random() < .6 ? '#59e6ff' : '#cff2ff', crnd(.3, .55), crnd(2.2, 3.6));
          }
          for (let i = 0; i < 9; i++) {
            const a = ang + rnd(-.17, .17);
            FX.particle(ox, oy, a, crnd(300, 540), Math.random() < .5 ? '#59e6ff' : '#7db8e8', crnd(.28, .5), crnd(2.6, 4.2));
          }
        }
        let n = 0;
        /* Nur Gegner im Kegel-Radius prüfen (Spatial-Hash) statt über alle zu loopen.
           Kopie (.slice), weil applyElement im Loop eigene Hash-Queries auf _tmp macht. */
        const hits = Game.hash.query(p.x, p.y, r + 40, Game._tmp).slice();
        for (const e of hits) {
          if (e.dead) continue;
          const d = dist(e.x, e.y, p.x, p.y);
          if (d < r + e.r && Math.abs(angDiff(Math.atan2(e.y - p.y, e.x - p.x), ang)) < half) {
            const isCrit = RAND() < crit.c;
            const dd = dmg * (isCrit ? crit.m : 1);
            e.hurt(dd, isCrit, p, elemental || x.burn ? 'elem' : 'ranged', 0, w);
            if (w.id === 'loeschwasser') e.knockback(ang, 180);
            if (w.id === 'klingel') { e.applyElement('shock', dd * .3, p); e.knockback(ang, 300); }
            if (x.burn) e.applyElement('fire', x.burn * (1 + p.st.elem / 100), p);
            this.onHit(p, w, e, dd, isCrit, {}); n++;
          }
        }
        if (n >= 3) { Save.prog('multiKillShot', 1); }
        AudioSys.sfx(WEAPON_SFX[w.id] || 'w_sonic');
        break;
      }
      case 'chain': {
        let cur = target, prev = { x: ox, y: oy }, used = new Set(), n = x.chain, hits = 0;
        let d = dmg;
        const bolt = (x1, y1, x2, y2) => {
          const segs = 5, off = Math.min(24, Math.hypot(x2 - x1, y2 - y1) * .22);
          let px = x1, py = y1;
          for (let i = 1; i <= segs; i++) {
            const t = i / segs, j = i === segs ? 0 : rnd(-off, off), k = i === segs ? 0 : rnd(-off, off);
            const nx = x1 + (x2 - x1) * t + j, ny = y1 + (y2 - y1) * t + k;
            FX.line(px, py, nx, ny, Math.random() < .5 ? def.col : '#ffffff', .16);
            px = nx; py = ny;
          }
        };
        while (cur && n > 0) {
          used.add(cur);
          const isCrit = RAND() < crit.c;
          const dd = d * (isCrit ? crit.m : 1);
          bolt(prev.x, prev.y, cur.x, cur.y, def.col);
          if (OPT().particles > 0) {
            for (let i = 0; i < 4; i++) FX.particle(prev.x + (cur.x - prev.x) * crnd(0, 1), prev.y + (cur.y - prev.y) * crnd(0, 1), crnd(TAU), crnd(50, 170), Math.random() < .5 ? def.col : '#ffffff', crnd(.15, .3), 2);
            FX.spark(cur.x, cur.y, crnd(TAU), def.col);
          }
          FX.sparkShower(cur.x, cur.y, Math.atan2(cur.y - prev.y, cur.x - prev.x) + Math.PI, 4, '#ffffff', 220);
          FX.ripple(cur.x, cur.y, 18, def.col, .2);
          cur.hurt(dd, isCrit, p, 'elem', 0, w); this.onHit(p, w, cur, dd, isCrit, {});
          hits++; prev = { x: cur.x, y: cur.y }; n--; d *= .88;
          cur = Game.nearestEnemyExcept(prev.x, prev.y, 240, used);
        }
        if (hits >= 2) Game.feedback(null, null, 'klein');
        if (hits >= 10) { Save.prog('chain10', 1); Game.run.track.chain10 = 1; }
        Game.run.track.maxChain = Math.max(Game.run.track.maxChain, hits);
        AudioSys.sfx(WEAPON_SFX[w.id] || 'w_tesla');
        break;
      }
      case 'charge': {
        const full = w.charge >= 1;
        const mult = full ? x.chargeMax : (1 + w.charge);
        if (full) { Save.prog('fullCharges', 1); Game.run.track.fullCharges++; }
        w.charge = 0;
        const ex = p.x + Math.cos(ang) * rng, ey = p.y + Math.sin(ang) * rng;
        FX.beam(ox, oy, ex, ey, def.col, full ? 12 : 5);
        const hits = Game.raycastEnemies(p.x, p.y, ang, rng, full ? 30 : 18);
        for (const e of hits) {
          const isCrit = RAND() < crit.c;
          const dd = dmg * mult * (isCrit ? crit.m : 1);
          e.hurt(dd, isCrit, p, 'elem', 0, w); this.onHit(p, w, e, dd, isCrit, {});
          if (full) e.applySlow(.4, 1.5);
        }
        AudioSys.sfx(WEAPON_SFX[w.id] || 'w_arc');
        break;
      }
      case 'melee': {
        const arc = x.arc || 1.2, r = rng;
        FX.cone(p.x, p.y, ang, r, arc / 2, def.col);
        if (OPT().particles > 0) {
          const steps = 12;
          for (let i = 0; i <= steps; i++) {
            const a2 = ang - arc / 2 + (arc * i / steps);
            const rr = r * rnd(.72, .98);
            FX.px(p.x + Math.cos(a2) * rr, p.y + Math.sin(a2) * rr, i % 3 ? def.col : '#ffffff', crnd(1.6, 3), crnd(.1, .22), { glow: 1 });
          }
          FX.dust(p.x + Math.cos(ang) * r * .6, p.y + Math.sin(ang) * r * .6 + 6, ang, 2);
        }
        for (const e of Game.enemies) {
          if (e.dead) continue;
          const d = dist(e.x, e.y, p.x, p.y);
          if (d < r + e.r && Math.abs(angDiff(Math.atan2(e.y - p.y, e.x - p.x), ang)) < arc / 2) {
            const isCrit = RAND() < crit.c;
            const dd = dmg * (isCrit ? crit.m : 1);
            e.hurt(dd, isCrit, p, 'melee', 0, w);
            e.knockback(ang, (x.knock || 90) * (1 + p.st.knock / 100));
            if (x.stun) e.stun = Math.max(e.stun, x.stun);
            if (x.engSpark) { e.applyElement('fire', p.st.eng * .12 + x.engSpark, p); }
            this.onHit(p, w, e, dd, isCrit, {});
          }
        }
        AudioSys.sfx(WEAPON_SFX[w.id] || 'w_knife');
        break;
      }
    }
    w.kick = 1;
    this.muzzleFx(p, w, ox, oy, ang, def, x);
    w.sub++;
  },
  muzzleFx(p, w, ox, oy, ang, def, x) {
    const F = weaponFx(def.id, def.type);
    const q = OPT().particles;
    const back = ang + Math.PI;
    /* Mündungsblitz — Kern, Korona und seitliche Zungen */
    FX.flash(ox, oy, ang, F.fcol, F.flash);
    FX.light(ox + Math.cos(ang) * 6, oy + Math.sin(ang) * 6, F.flash * 4.5, F.fcol, .1, 1);
    if (q > 0) {
      const core = Math.max(2, F.flash * .22);
      FX.px(ox + Math.cos(ang) * 3, oy + Math.sin(ang) * 3, '#ffffff', core, .06, { glow: 1 });
      for (let i = 0; i < 3; i++)
        FX.particle(ox, oy, ang + crnd(-.35, .35), crnd(120, 320), F.fcol, crnd(.05, .1), crnd(1.6, 3.4), { shape: 'streak', dg: .05, glow: 1 });
    }
    if (F.ring) FX.ripple(ox, oy, F.ring, F.fcol, .22);
    /* Rauch, Funken, Hülse, Hitze */
    if (F.smoke) FX.smoke(ox + Math.cos(ang) * 4, oy + Math.sin(ang) * 4, ang + crnd(-.4, .4), 70, F.smoke, 'rgba(178,182,190,.5)', 3.4);
    if (F.sparks) FX.sparkShower(ox, oy, ang, F.sparks, F.kind === 'elec' ? '#ffffff' : '#ffd9a0', 260);
    if (F.casing) FX.casing(ox - Math.cos(ang) * 4, oy - Math.sin(ang) * 4, ang);
    if (F.heat) FX.ember(ox, oy, F.heat, F.kind === 'fire' ? '#ff8a3d' : '#ffb24a', 120);
    /* Charakter je Waffenart */
    switch (F.kind) {
      case 'elec':
        for (let i = 0; i < 3; i++) {
          const l = rnd(14, 30), a2 = ang + rnd(-.8, .8);
          FX.bolt(ox, oy, ox + Math.cos(a2) * l, oy + Math.sin(a2) * l, F.fcol, 3, 6);
        }
        break;
      case 'energy': case 'light':
        FX.ripple(ox, oy, 16, '#ffffff', .18);
        for (let i = 0; i < 4 * q; i++) FX.px(ox + crnd(-5, 5), oy + crnd(-5, 5), F.fcol, crnd(1, 2.4), crnd(.1, .26), { glow: 1, vx: Math.cos(ang) * crnd(40, 140), vy: Math.sin(ang) * crnd(40, 140) });
        break;
      case 'fire':
        FX.ember(ox, oy, 5, '#ff7a3d', 190);
        FX.smoke(ox, oy, ang, 120, 3, 'rgba(70,60,55,.5)', 4);
        break;
      case 'ice':
        for (let i = 0; i < 5 * q; i++) FX.particle(ox, oy, ang + crnd(-.5, .5), crnd(80, 240), Math.random() < .5 ? '#bfefff' : '#ffffff', crnd(.2, .4), crnd(1.4, 2.6), { shape: 'pixel', gy: 40, dg: .3, glow: 1 });
        break;
      case 'bio':
        FX.splashDrops(ox, oy, ang, 4, '#8dff5c');
        break;
      case 'water':
        FX.splashDrops(ox, oy, ang, 7, Math.random() < .5 ? '#59e6ff' : '#cff2ff');
        break;
      case 'grav':
        for (let i = 0; i < 8 * q; i++) {
          const a2 = rnd(TAU), r2 = rnd(14, 30);
          FX.particle(ox + Math.cos(a2) * r2, oy + Math.sin(a2) * r2, a2 + Math.PI, crnd(60, 170), '#a06bff', crnd(.15, .3), 2, { shape: 'pixel', dg: .2, glow: 1 });
        }
        break;
      case 'sonic':
        FX.ripple(ox, oy, 30, '#ffb0e0', .3);
        FX.ripple(ox, oy, 52, '#ffffff', .38);
        break;
      case 'saw':
        FX.sparkShower(ox, oy, back, 5, '#ffb24a', 200);
        break;
      case 'melee':
        for (let i = 0; i < 5 * q; i++) FX.particle(ox, oy, ang + crnd(-.8, .8), crnd(120, 300), F.fcol, crnd(.12, .26), crnd(1.6, 3), { shape: 'streak', dg: .12, glow: 1 });
        FX.dust(ox, oy + 8, back, 2);
        break;
      case 'music':
        for (let i = 0; i < 3 * q; i++) FX.note(ox, oy, ang + rnd(-.9, .9), rnd(60, 180), ['#ff5ce0', '#59e6ff', '#a06bff'][i % 3], .5);
        break;
      case 'voice':
        FX.ripple(ox, oy, 14, '#ffd24a', .24);
        break;
    }
    Game.shake(F.shake * (attMod(w).kick || 1), .09);
  },
  auraTick(p, w, dt) {
    const def = WEAPON_BY_ID[w.id], t = tierData(def, w.tier), x = t.x;
    w.cd -= dt;
    const r = this.range(p, w);
    const list = Game.hash.query(p.x, p.y, r, Game._tmp);
    for (const e of list) {
      if (e.dead) continue;
      const d = dist(e.x, e.y, p.x, p.y);
      if (d < r) {
        const a = Math.atan2(p.y - e.y, p.x - e.x);
        e.x += Math.cos(a) * x.pull * dt * .55; e.y += Math.sin(a) * x.pull * dt * .55;
        if (!e._vortexCounted) { e._vortexCounted = true; Save.prog('vortexPulled', 1); Save.prog('pulled', 1); Game.run.track.pulled++; }
      }
    }
    if (w.cd <= 0) {
      w.cd = this.cooldown(p, w);
      const dmg = this.damage(p, w), crit = this.critInfo(p, w);
      for (const e of list) {
        if (e.dead) continue;
        if (dist(e.x, e.y, p.x, p.y) < r) {
          const isCrit = RAND() < crit.c;
          const dd = dmg * (isCrit ? crit.m : 1);
          e.hurt(dd, isCrit, p, 'ranged', 0, w); this.onHit(p, w, e, dd, isCrit, {});
        }
      }
      AudioSys.sfx('w_vortex');
    }
  },
  onHit(p, w, e, dmg, isCrit, opt) {
    if (isCrit) {
      p.critStreak++; p.stats.crits++;
      Save.progMax('critStreak', p.critStreak);
      Game.run.track.critStreak = Math.max(Game.run.track.critStreak, p.critStreak);
    } else p.critStreak = 0;
    const def = w ? WEAPON_BY_ID[w.id] : null;
    if (w) { p.stats.byWeapon[w.id] = (p.stats.byWeapon[w.id] || 0) + dmg; if (e.dead) w.kills++; }
    if (w && w.ethereal && e.dead) { Save.prog('etherealKills', 1); }
    const t = def ? tierData(def, w.tier) : null;
    let ls = p.st.lifesteal / 100 + (t && t.x.lifesteal ? t.x.lifesteal : 0);
    if (ls > 0) {
      const heal = dmg * ls * .18;
      p.heal(heal);
      if (def && def.id === 'medgun' && Game.coop) { const o = Game.players[1 - p.index]; if (o && o.alive && dist(o.x, o.y, p.x, p.y) < 400) o.heal(heal * .6); }
    }
    if (t && t.x.healHit) p.heal(t.x.healHit, 'needle');
  }
};

function makeProjectile() { return { dead: true }; }
const Projectiles = new Pool(makeProjectile);
const EnemyBullets = new Pool(() => ({ dead: true }));

