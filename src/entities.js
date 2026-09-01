/* ============================ 12. SPATIAL HASH & POOL ============================ */
class SpatialHash {
  constructor(cell = 110) { this.cell = cell; this.map = new Map(); }
  clear() { this.map.clear(); }
  insert(e) {
    const gx = ((e.x / this.cell) | 0), gy = ((e.y / this.cell) | 0);
    let m = this.map.get(gx);
    if (!m) { m = new Map(); this.map.set(gx, m); }
    let a = m.get(gy);
    if (!a) { a = []; m.set(gy, a); }
    a.push(e);
  }
  query(x, y, r, out) {
    out.length = 0;
    const c = this.cell, x0 = ((x - r) / c) | 0, x1 = ((x + r) / c) | 0, y0 = ((y - r) / c) | 0, y1 = ((y + r) / c) | 0;
    for (let gx = x0; gx <= x1; gx++) {
      const m = this.map.get(gx); if (!m) continue;
      for (let gy = y0; gy <= y1; gy++) {
        const a = m.get(gy); if (a) for (let i = 0; i < a.length; i++) out.push(a[i]);
      }
    }
    return out;
  }
}
class Pool {
  constructor(factory) { this.factory = factory; this.free = []; this.active = []; }
  prefill(n) { while (this.free.length < n) this.free.push(this.factory()); }
  get() { const o = this.free.pop() || this.factory(); o.dead = false; this.active.push(o); return o; }
  update(fn, dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const o = this.active[i]; fn(o, dt);
      if (o.dead) {
        this.active[i] = this.active[this.active.length - 1];
        this.active.pop();
        this.free.push(o);
      }
    }
  }
  clear() { for (const o of this.active) this.free.push(o); this.active.length = 0; }
}

/* ============================ 13. ENTITIES ============================ */
class Player {
  constructor(index, charId) {
    this.index = index; this.char = CHAR_BY_ID[charId] || CHARS[0];
    this.profile = this.char.profile || CharacterProfiles.leonidas;
    this.moveSet = this.profile.moveSet;
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0; this.r = 14;
    this.face = 0; this.aim = 0; this.walkT = 0;
    this.level = 1; this.xp = 0; this.xpNext = this.xpFor(1);
    this.pendingLevels = 0; this.rerollUsed = false;
    this.weapons = []; this.items = []; this.itemCounts = {}; this.relics = [];
    this.base = zeroStats(); this.st = zeroStats();
    this.hp = 1; this.maxHp = 1; this.alive = true; this.downTimer = 0;
    this.invuln = 0; this.hitFlash = 0; this.popT = 0; this.regenAcc = 0;
    this.abilityCd = 0; this.abilityActive = 0; this.abilityData = {};
    this.rollerBattery = this.char.id === 'sunny' ? 100 : 0;
    this.rollerBoostT = 0;
    this.buffs = [];
    this.critStreak = 0; this.tookDamageThisWave = false; this.lowHpTime = 0;
    this.stats = { dmg: 0, kills: 0, taken: 0, healed: 0, crits: 0, byWeapon: {} };
    this.turrets = [];
    this.dashT = 0; this.dashDir = { x: 1, y: 0 }; this.raveT = 0; this.perfectT = 0; this.perfectBonus = 0; this.perfectBonusT = 0; this.manualAim = false;
    this.quoteT = 0; this.quoteText = ''; this.jumpT = 0;
    this.rollT = 0; this.rollCd = 0; this.rollDir = { x: 1, y: 0 }; this.rollSpin = 0;
    this.emoteT = 0; this.emoteType = 0; this.emoteList = ['wave', 'dance', 'thumbs'];
    this.activationPose = null; this.idleT = 0;
    this.runes = [];
    this.pet = null;
    this.applyChar();
  }
  xpFor(l) { return Math.floor(5 + l * 4 + l * l * 0.85); }
  applyChar() {
    const c = this.char;
    for (const k in c.stats) this.base[k] = (this.base[k] || 0) + c.stats[k];
    this.recalc(true); this.hp = this.maxHp;
  }
  addItem(item) {
    this.items.push(item.id);
    this.itemCounts[item.id] = (this.itemCounts[item.id] || 0) + 1;
    if (item.turret) this.spawnTurret();
    this.recalc();
  }
  spawnTurret() { this.turrets.push(new Turret(this)); AudioSys.sfx('drone'); }
  addWeapon(wid, tier = 0) {
    if (!WEAPON_BY_ID[wid]) return false;
    if (this.weapons.length >= BROTATO_RULES.maxWeapons) return false;
    const w = { id: wid, tier, cd: 0, angle: 0, charge: 0, kills: 0, ethereal: RAND() < .08, sub: 0, attach: [] };
    /* Erspielte Meisterschaft hängt kostenlos an der Waffe */
    const extra = Game.masteryAttachments(wid);
    for (const a of extra) w.attach.push(a);
    w.masteryAtt = extra.length;
    this.weapons.push(w);
    AudioSys.sfx('pick'); this.recalc(); return true;
  }
  sellWeapon(i) {
    const w = this.weapons[i]; if (!w) return 0;
    const val = Math.floor(tierData(WEAPON_BY_ID[w.id], w.tier).price * .55);
    this.weapons.splice(i, 1); this.recalc(); return val;
  }
  tryActivateRune() {
    const ready = this.runes.find(r => r.cd <= 0);
    if (!ready) { AudioSys.sfx('err'); UI.toast(this.char.name + ': Rune lädt noch'); return; }
    const def = RUNE_BY_ID[ready.id];
    if (!def) { this.runes.splice(this.runes.indexOf(ready), 1); return; }
    ready.cd = def.cd;
    applyRuneEffect(this, def);
    Save.prog('runesUsed', 1);
  }
  classCounts() {
    const c = {};
    for (const w of this.weapons) { const def = WEAPON_BY_ID[w.id]; if (!def) continue; for (const cl of def.cls) c[cl] = (c[cl] || 0) + 1; }
    return c;
  }
  recalc(initial) {
    const st = zeroStats();
    for (const k of STAT_KEYS) st[k] = this.base[k] || 0;
    for (const id of this.items) { const it = ITEM_BY_ID[id]; if (it) for (const k in it.stats) st[k] += it.stats[k]; }
    for (const rid of this.relics) { const r = RELIC_BY_ID[rid]; if (r) for (const k in r.stats) st[k] += r.stats[k]; }
    for (const s of RELIC_SETS) if (s.stats && s.members.every(id => this.relics.includes(id))) for (const k in s.stats) st[k] += s.stats[k];
    if (this.pet) { const pd = PET_BY_ID[this.pet.id]; if (pd && pd.stats) for (const k in pd.stats) st[k] += pd.stats[k]; }
    const mast = (Save.data.mastery && Save.data.mastery[this.char.id]) || 0;
    if (mast >= 10) {
      const tier = mast >= 20 ? .22 : mast >= 15 ? .12 : .05;
      for (const k of STAT_KEYS) st[k] += st[k] * tier;
    }
    const cc = this.classCounts();
    for (const cl in cc) {
      const table = CLASS_BONUS[cl]; if (!table) continue;
      let best = null;
      for (let n = 6; n >= 2; n--) if (cc[cl] >= n && table[n]) { best = table[n]; break; }
      if (best) for (const k in best) st[k] += best[k];
    }
    const syn = this.char.synergy;
    this.synActive = false;
    if (syn && (cc[syn.cls] || 0) >= syn.need) { this.synActive = true; for (const k in syn.stats) st[k] += syn.stats[k]; }
    for (const b of this.buffs) st[b.stat] += b.val;
    const preLvl = Math.min(PRESTIGE_MAX, Save.data.prestige || 0);
    if (preLvl) st.dmgP += preLvl * PRESTIGE_DMG_PCT;
    st.abilityRank = 1 + Math.floor((this.level - 1) / 5);
    this.st = st;
    const nm = Math.max(20, 120 + st.maxHp);
    if (initial) { this.maxHp = nm; this.hp = nm; }
    else { const d = nm - this.maxHp; this.maxHp = nm; if (d > 0) this.hp += d; this.hp = clamp(this.hp, 1, this.maxHp); }
  }
  addBuff(stat, val, t) { this.buffs.push({ stat, val, t, max: t }); this.recalc(); }
  activateRollerBoost() {
    if (this.char.id !== 'sunny' || this.rollerBattery < 20 || !this.alive) return false;
    this.rollerBattery -= 20; this.rollerBoostT = 2.2; this.invuln = Math.max(this.invuln, .18);
    this.dashT = Math.max(this.dashT, .12);
    AudioSys.sfx('dash');
    return true;
  }
  matMult() { let m = 1; for (const rid of this.relics) { const r = RELIC_BY_ID[rid]; if (r && r.matMult) m += r.matMult; }
    for (const s of RELIC_SETS) if (s.matMult && s.members.every(id => this.relics.includes(id))) m += s.matMult;
    return m; }
  masteryTier() { const m = (Save.data.mastery && Save.data.mastery[this.char.id]) || 0; return m >= 20 ? 3 : m >= 15 ? 2 : m >= 10 ? 1 : 0; }
  speed() { return 218 * this.moveSet.speed * (1 + this.st.speed / 100) * (Game.modActive && Game.modActive('adrenalin') ? 1.15 : 1); }
  heal(v, src) {
    if (this.wagerNoHeal) { FX.number(this.x, this.y - 22, 'KEINE HEILUNG', '#7f92b8', .8); return; }
    if (!this.alive || v <= 0) return;
    if (Game.modActive && Game.modActive('halbe_heilung')) v *= .5;
    const before = this.hp; this.hp = Math.min(this.maxHp, this.hp + v);
    const gained = this.hp - before; this.stats.healed += gained;
    if (src === 'needle') { Save.prog('needleHeal', gained); Game.run.track.needleHeal += gained; }
    if (gained > .4) FX.number(this.x, this.y - 20, '+' + Math.round(gained), '#5dff9b', .8);
  }
  damage(v, srcAngle) {
    if (!isFinite(v)) return;
    if (!this.alive || Game.state !== 'play') return;
    /* Perfektes Ausweichen: im Startfenster von Rolle oder Dash gestreift
       → Zeitlupe, Fähigkeitsaufladung und kurzer Schadensbonus */
    if (this.perfectT > 0) {
      this.perfectT = 0;
      this.perfectBonus = .35; this.perfectBonusT = 4;
      this.abilityCd = Math.max(0, this.abilityCd - 2.5);
      this.invuln = Math.max(this.invuln, .45);
      Game.feedback(null, null, 'gross');
      Game.perfectFlash = .5;
      FX.shockwave(this.x, this.y, 96, '#ffffff');
      FX.ripple(this.x, this.y, 150, this.char.col, .4);
      FX.light(this.x, this.y, 190, '#ffffff', .25, 1.2);
      FX.number(this.x, this.y - 30, 'PERFEKT!', '#ffffff', 1.35);
      for (let i = 0; i < 14; i++) FX.particle(this.x, this.y, crnd(TAU), crnd(120, 300), i % 2 ? '#ffffff' : this.char.col, .4, 2.4, { shape: 'streak', dg: .1, glow: 1 });
      AudioSys.sfx('rune');
      Input.rumble(Input.padMap[this.index], 120, .35, .55);
      Save.prog('perfectDodges', 1);
      return;
    }
    Combat.applyPlayerHit({ p: this, v, srcAngle });
  }
  down() {
    if (this.char.id === 'cyborg' && !this.notstromUsed) {
      this.notstromUsed = true; this.hp = this.maxHp * .3; this.invuln = 1.5;
      FX.shockwave(this.x, this.y, 240, '#c0f0ff'); AudioSys.sfx('notstrom');
      const list = Game.hash.query(this.x, this.y, 240, Game._tmp);
      for (const e of list) if (!e.dead) e.hurt(60 + this.st.elem, false, this, 'elem');
      UI.toast('NOTSTROM AKTIVIERT'); return;
    }
    this.alive = false; this.hp = 0; this.downTimer = 0;
    this.diedAt = Game.time;   /* fuer die Sterbeanimation: sie laeuft einmal, nicht in Schleife */
    FX.explosion(this.x, this.y, 90, '#ff4d5e');
    AudioSys.sfx('boom'); UI.toast(this.char.name + ' ist gefallen!');
  }
  update(dt) {
    for (let i = this.buffs.length - 1; i >= 0; i--) { this.buffs[i].t -= dt; if (this.buffs[i].t <= 0) { this.buffs.splice(i, 1); this.recalc(); } }
    if (!this.alive) { this.downTimer += dt; for (const t of this.turrets) t.update(dt); return; }
    this.invuln = Math.max(0, this.invuln - dt);
    this.perfectT = Math.max(0, this.perfectT - dt);
    this.rollerBoostT = Math.max(0, this.rollerBoostT - dt);
    if (this.char.id === 'sunny' && this.rollerBoostT <= 0) this.rollerBattery = Math.min(100, this.rollerBattery + dt * 8);
    if (this.perfectBonusT > 0) { this.perfectBonusT -= dt; if (this.perfectBonusT <= 0) this.perfectBonus = 0; }
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.popT = Math.max(0, this.popT - dt * 4);
    this.abilityCd = Math.max(0, this.abilityCd - dt);
    this.abilityActive = Math.max(0, this.abilityActive - dt);
    if (this.activationPose) { this.activationPose.t -= dt; if (this.activationPose.t <= 0) this.activationPose = null; }
    this.idleT = Math.hypot(this.vx, this.vy) < 8 ? this.idleT + dt : 0;
    for (let i = this.runes.length - 1; i >= 0; i--) { this.runes[i].cd = Math.max(0, this.runes[i].cd - dt); }
    if (this.pet) this.pet.update(dt, this);
    if (this.quoteT > 0) this.quoteT -= dt;
    if (this.jumpT > 0) this.jumpT -= dt;
    this.rollCd = Math.max(0, this.rollCd - dt);
    this.rollT = Math.max(0, this.rollT - dt);
    if (this.rollT > 0) this.rollSpin += dt * 22;
    if (this.emoteT > 0) this.emoteT -= dt;
    this.regenAcc += dt;
    if (this.regenAcc >= 1) { this.regenAcc -= 1; if (this.st.hpRegen) this.heal(this.st.hpRegen); }
    if (this.hp / this.maxHp < .10) this.lowHpTime += dt;
    const mv = Input.moveVec(this.index);
    this.lastMx = mv.x; this.lastMy = mv.y;
    let sp = this.speed() * (this.webSlow ? (1 - this.webSlow) : 1);
    if (this.rollerBoostT > 0) sp *= 1.65;
    this.webSlow = 0;
    const field = Game.level.fieldAt(this.x, this.y);
    if (field) { if (field.type === 'speed') sp *= field.mult; if (field.type === 'poison') this.damage(field.dps * dt * 3, 0); }
    if (this.rollT > 0) {
      this.invuln = Math.max(this.invuln, .05);
      this.x += this.rollDir.x * this.moveSet.rollSpeed * dt; this.y += this.rollDir.y * this.moveSet.rollSpeed * dt;
      if (Math.random() < .8) FX.particle(this.x - this.rollDir.x * 8, this.y - this.rollDir.y * 8, crnd(TAU), crnd(20, 60), this.char.col, .3, 3);
    } else if (this.dashT > 0) {
      this.dashT -= dt; this.invuln = Math.max(this.invuln, .05);
      this.x += this.dashDir.x * this.moveSet.dash * dt; this.y += this.dashDir.y * this.moveSet.dash * dt;
      FX.particle(this.x, this.y, crnd(TAU), crnd(20, 60), this.char.col, .35, 4);
      if (OPT().particles > 0 && Math.random() < .5) FX.line(this.x, this.y, this.x - this.dashDir.x * 30, this.y - this.dashDir.y * 30, this.char.col, .12);
      if (Math.random() < .4) FX.sparkle(this.x - this.dashDir.x * 6, this.y - this.dashDir.y * 6, Math.PI + Math.atan2(this.dashDir.y, this.dashDir.x), crnd(120, 220), this.char.col, .3, 2);
      if (Math.random() < .45) FX.flash(this.x - this.dashDir.x * 10, this.y - this.dashDir.y * 10, Math.atan2(this.dashDir.y, this.dashDir.x) + Math.PI, this.char.col, 2.5);
    } else {
      /* Regen macht den Asphalt rutschig, Hitze treibt an */
      const slip = Game.modIs('regen') ? .045 : .0001;
      if (Game.modIs('hitze')) sp *= 1.12;
      this.vx = lerp(this.vx, mv.x * sp, 1 - Math.pow(slip, dt));
      this.vy = lerp(this.vy, mv.y * sp, 1 - Math.pow(slip, dt));
      this.x += this.vx * dt; this.y += this.vy * dt;
    }
    if (mv.x || mv.y) { this.face = Math.atan2(mv.y, mv.x); this.walkT += dt * 9; }
    if (mv.x || mv.y) { this.stepAcc = (this.stepAcc || 0) - dt; if (this.stepAcc <= 0) { this.stepAcc = .34; AudioSys.sfx('step'); FX.particle(this.x - Math.cos(this.face) * 7, this.y + 11, -Math.PI / 2 + crnd(-.4, .4), crnd(12, 34), '#9db0c2', .45, 3); if (OPT().particles > 0 && Math.random() < .45) FX.particle(this.x - Math.cos(this.face) * 10, this.y + 12, -Math.PI / 2 + crnd(-.5, .5), crnd(16, 42), '#aebfd0', .5, 2.5); if (Game.level && Game.level.decals && Game.level.decals.length < 260) Game.level.decals.push({ x: this.x - Math.cos(this.face) * 5 + crnd(-1.5, 1.5), y: this.y + 10 + crnd(-1, 1), r: crnd(2.6, 3.8), c: 'rgba(10,14,26,.30)', t: 0, life: crnd(1.8, 3) }); } }
    Game.level.collide(this);
    const av = Input.aimVec(this.index);
    if (av.has) this.aim = Math.atan2(av.y, av.x);
    else if (OPT().aim === 'manual' && this.index === 0 && !Input.isTouch) {
      const w = Game.screenToWorld(Input.mouse.x, Input.mouse.y); this.aim = Math.atan2(w.y - this.y, w.x - this.x);
    }    else {
      const t = Game.nearestEnemy(this.x, this.y, 2000);
      this.autoTarget = t;
      if (t) this.aim = Math.atan2(t.y - this.y, t.x - this.x); else this.aim = this.face;
    }

    if (Input.skillDown(this.index) && this.abilityCd <= 0) this.useAbility();
    for (let i = 0; i < this.weapons.length; i++) WeaponSystem.update(this, this.weapons[i], i, dt);
    for (const t of this.turrets) t.update(dt);
    Game.magnet(this);
    if (this.raveT > 0) {
      this.raveT -= dt;
      const rr = 230;
      const cols = ['#ff5ce0', '#59e6ff', '#a06bff', '#ffe27a'];
      if (Math.random() < dt * 26) FX.particle(this.x + crnd(-rr, rr), this.y + crnd(-rr, rr), crnd(TAU), crnd(10, 70), cols[Math.floor(Math.random() * cols.length)], .4, 2.5);
      if (Math.random() < dt * 3) FX.shockwave(this.x, this.y, rr, '#59e6ff');
      for (const e of Game.enemies) if (!e.dead && dist(e.x, e.y, this.x, this.y) < rr) e.applySlow(.3, .35);
    }
  }
  useAbility() {
    if (this.abilityCd <= 0) Game.contractFail('noAbility');
    const a = this.char.ability, rank = 1 + Math.floor((this.level - 1) / 5) + (this.base.abilityRank || 0);
    this.abilityCd = a.cd * Math.max(.55, 1 - (rank - 1) * .07) * (1 + (this.st.abilityCdMod || 0) / 100);
    this.abilityActive = .6;
    this.activationPose = { type: a.id, t: 0.3 };
    FX.shockwave(this.x, this.y, 110, this.char.col);
    AudioSys.sfx('dash'); Input.rumble(Input.padMap[this.index], 140, .5, .3);
    const enemies = Game.enemies;
    switch (a.id) {
      case 'loeschstrahl': {
        const range = 300 + rank * 30, halfCone = .55, dmg = (28 + rank * 14) * (1 + this.st.dmgP / 100) + this.st.elem;
        FX.cone(this.x, this.y, this.aim, range, halfCone, '#59e6ff');
        for (const e of enemies) if (!e.dead) {
          const d = dist(e.x, e.y, this.x, this.y);
          if (d < range && Math.abs(angDiff(Math.atan2(e.y - this.y, e.x - this.x), this.aim)) < halfCone) {
            e.hurt(dmg, false, this, 'elem'); e.applyElement('ice', dmg, this);
            e.knockback(this.aim, 260);
          }
        }
        break;
      }
      case 'heilaura': {
        const r = 260 + rank * 20, heal = 25 + rank * 12;
        FX.shockwave(this.x, this.y, r, '#8affb0');
        for (const p of Game.players) if (p.alive && dist(p.x, p.y, this.x, this.y) < r * 1.6) {
          p.heal(heal); p.addBuff('armor', 4 + rank, 6); p.burnT = 0;
        }
        for (const e of enemies) if (!e.dead && dist(e.x, e.y, this.x, this.y) < r) { e.hurt(10 + rank * 6, false, this, 'elem'); e.applySlow(.35, 2); }
        AudioSys.sfx('heal'); break;
      }
      case 'phasendash': {
        this.dashT = .16; this.dashDir = { x: Math.cos(this.aim), y: Math.sin(this.aim) }; this.perfectT = .10;
        FX.shockwave(this.x, this.y, 160 + rank * 15, '#59e6ff');
        for (const e of enemies) if (!e.dead && dist(e.x, e.y, this.x, this.y) < 160 + rank * 15) {
          e.hurt((20 + rank * 12) + this.st.eng, false, this, 'elem'); e.applyElement('shock', (20 + rank * 12) + this.st.eng, this); e.knockback(Math.atan2(e.y - this.y, e.x - this.x), 320);
        }
        if (rank >= 2 && this.turrets.length < 6) { const t = new Turret(this); t.temp = 12; this.turrets.push(t); AudioSys.sfx('drone'); }
        break;
      }
      case 'markierung': {
        let n = 0;
        for (const e of enemies) if (!e.dead && dist(e.x, e.y, this.x, this.y) < 900) { e.marked = 5; n++; }
        UI.toast(n + ' Ziele markiert'); break;
      }
      case 'bollwerkstoss': {
        this.dashT = .22; this.dashDir = { x: Math.cos(this.aim), y: Math.sin(this.aim) }; this.perfectT = .12;
        for (const e of enemies) if (!e.dead && dist(e.x, e.y, this.x, this.y) < 190) {
          e.hurt(30 + rank * 18 + this.st.melee, false, this, 'melee'); e.stun = 1.2; e.knockback(Math.atan2(e.y - this.y, e.x - this.x), 480);
        }
        FX.shockwave(this.x, this.y, 190, '#9fb4d8'); break;
      }
      case 'overdrive': {
        this.addBuff('atkSpd', 80 + rank * 8, 4); this.addBuff('crit', 30, 4);
        FX.shockwave(this.x, this.y, 150, '#ff5ce0'); break;
      }
      case 'fuellhorn': {
        for (let i = 0; i < 10 + rank * 3; i++) Game.spawnMaterial(this.x + rnd(-90, 90), this.y + rnd(-90, 90), 1);
        Game.spawnPowerup(this.x + rnd(-70, 70), this.y + rnd(-70, 70));
        break;
      }
      case 'turret': {
        const t = new Turret(this); t.temp = 16 + rank * 3; this.turrets.push(t);
        AudioSys.sfx('drone'); UI.toast('Geschütz aufgestellt'); break;
      }
      case 'notstrom': {
        FX.shockwave(this.x, this.y, 250, '#c0f0ff'); AudioSys.sfx('notstrom');
        for (const e of enemies) if (!e.dead && dist(e.x, e.y, this.x, this.y) < 250) { e.hurt(35 + rank * 20 + this.st.elem, false, this, 'elem'); e.applyElement('shock', 35 + rank * 20 + this.st.elem, this); }
        this.notstromUsed = false; break;
      }
      case 'powerchord': {
        const r = 240 + rank * 20;
        FX.shockwave(this.x, this.y, r, '#ff8a3d');
        for (const e of enemies) if (!e.dead && dist(e.x, e.y, this.x, this.y) < r) {
          e.hurt(30 + rank * 16 + this.st.elem * .5, false, this, 'elem'); e.knockback(Math.atan2(e.y - this.y, e.x - this.x), 340);
        }
        for (const p of Game.players) if (p.alive) p.addBuff('speed', 20, 4);
        break;
      }
      case 'raveaura': {
        this.addBuff('atkSpd', 60 + rank * 10, 5); this.addBuff('speed', 25, 5);
        this.raveT = 5; this.abilityActive = 5;
        AudioSys.sfx('rave'); AudioSys.sfx('ui');
        break;
      }
      case 'schiedsgericht': {
        const r = 240 + rank * 20, dmg = (16 + rank * 10) * (1 + this.st.dmgP / 100);
        FX.shockwave(this.x, this.y, r, '#7dffb0');
        AudioSys.sfx('dash');
        for (const e of enemies) if (!e.dead && dist(e.x, e.y, this.x, this.y) < r) {
          e.hurt(dmg, false, this, 'melee');
          e.applySlow(.5, 2.5);
          e.knockback(Math.atan2(e.y - this.y, e.x - this.x), -240);
        }
        this.addBuff('armor', 8 + rank * 2, 4);
        UI.banner('SCHIEDSGERICHT', 1.2);
        break;
      }
      case 'kiosk': {
        Game.spawnMaterial(this.x + rnd(-80, 80), this.y + rnd(-80, 80), 1 + rank);
        for (let i = 0; i < 8 + rank * 2; i++) Game.spawnMaterial(this.x + rnd(-120, 120), this.y + rnd(-120, 120), 1);
        for (const p of Game.players) if (p.alive) p.heal(18 + rank * 8);
        Game.spawnPowerup(this.x + rnd(-60, 60), this.y + rnd(-60, 60));
        for (let i = 0; i < 10; i++) FX.particle(this.x + crnd(-90, 90), this.y + crnd(-90, 90), crnd(TAU), crnd(30, 120), '#ffb24a', .6, 3);
        UI.banner('KIOSK-STOSS', 1.2);
        AudioSys.sfx('heal');
        break;
      }
      case 'walla': {
        const r = 300 + rank * 26;
        const dmg = (22 + rank * 12) * (1 + this.st.dmgP / 100) + this.st.ranged * .4;
        FX.shockwave(this.x, this.y, r, '#ffd24a');
        FX.shockwave(this.x, this.y, r * .6, '#8a5cff');
        for (let i = 0; i < 10; i++) {
          const a = i / 10 * TAU;
          FX.particle(this.x + Math.cos(a) * 16, this.y + Math.sin(a) * 16, a, crnd(160, 320), i % 2 ? '#ffd24a' : '#8a5cff', .55, 3);
        }
        let n = 0;
        for (const e of enemies) if (!e.dead && dist(e.x, e.y, this.x, this.y) < r) {
          e.hurt(dmg, false, this, 'ranged');
          e.applySlow(.5, 3);
          e.stun = Math.max(e.stun, .55 + rank * .08);
          if (!e.boss) e.advice = (e.advice || 0) + 1;
          e.knockback(Math.atan2(e.y - this.y, e.x - this.x), 190);
          n++;
        }
        for (const p of Game.players) if (p.alive) { p.addBuff('atkSpd', 18 + rank * 3, 5); p.addBuff('luck', 12 + rank * 2, 5); }
        this.quoteText = 'Gute Ratschläge, walla!'; this.quoteT = 2.4;
        AudioSys.sfx('w_ratschlag');
        setTimeout(() => AudioSys.sfx('w_ratschlag'), 130);
        UI.banner('GUTE RATSCHLÄGE, WALLA!', 1.3);
        if (n >= 6) Save.prog('multiKillShot', 1);
        break;
      }
      case 'sprengsatz': {
        const tgt = Game.nearestEnemy(this.x, this.y, 600);
        const tx = tgt ? tgt.x : this.x + Math.cos(this.aim) * 260, ty = tgt ? tgt.y : this.y + Math.sin(this.aim) * 260;
        const dmg = (30 + rank * 18) * (1 + this.st.dmgP / 100);
        FX.flash(this.x + Math.cos(this.aim) * 26, this.y + Math.sin(this.aim) * 26, this.aim, '#ff8a3d', 20);
        setTimeout(() => {
          FX.explosion(tx, ty, 110 + this.st.expSize * .6, '#ff8a3d', .8);
          Game.feedback(tx, ty, 'mittel');
          AudioSys.sfx('boom');
          const list = Game.hash.query(tx, ty, 120 + this.st.expSize * .6, Game._tmp);
          for (const q of list) if (!q.dead && dist(q.x, q.y, tx, ty) < 120 + this.st.expSize * .6) {
            q.hurt(dmg, true, this, 'boom');
            q.knockback(Math.atan2(q.y - ty, q.x - tx), 420);
            q.applyElement('fire', dmg * .5, this);
          }
        }, 450);
        UI.banner('SPRENGSATZ', 1.2);
        break;
      }
      case 'luftschlag': {
        const tgt = Game.nearestEnemy(this.x, this.y, 720);
        const tx = tgt ? tgt.x : this.x + Math.cos(this.aim) * 320;
        const ty = tgt ? tgt.y : this.y + Math.sin(this.aim) * 320;
        const dmg = (36 + rank * 18) * (1 + this.st.dmgP / 100) + this.st.eng * .6;
        /* Laser-Beacon markiert das Ziel */
        FX.flash(tx, ty, -Math.PI / 2, '#a8c4e8', 40);
        FX.light(tx, ty - 30, 80, '#a8c4e8', .35, .6);
        AudioSys.sfx('drone');
        setTimeout(() => {
          FX.explosion(tx, ty, 120 + this.st.expSize * .6, '#a8c4e8', .9);
          Game.feedback(tx, ty, 'gross');
          AudioSys.sfx('boom');
          const list = Game.hash.query(tx, ty, 135 + this.st.expSize * .6, Game._tmp);
          for (const q of list) if (!q.dead && dist(q.x, q.y, tx, ty) < 135 + this.st.expSize * .6) {
            q.hurt(dmg, true, this, 'boom');
            q.stun = Math.max(q.stun, .9 + rank * .1);
            q.knockback(Math.atan2(q.y - ty, q.x - tx), 420);
            q.applyElement('shock', dmg * .35, this);
          }
        }, 420);
        UI.banner('PRÄZISIONS-LUFTSCHLAG', 1.2);
        break;
      }
      case 'festnahme': {
        const tgt = Game.nearestEnemy(this.x, this.y, 540);
        if (!tgt) { UI.toast('Kein Ziel in Sichtweite'); AudioSys.sfx('err'); break; }
        const a = Math.atan2(tgt.y - this.y, tgt.x - this.x);
        this.dashT = .18; this.dashDir = { x: Math.cos(a), y: Math.sin(a) }; this.perfectT = .12;
        FX.shockwave(tgt.x, tgt.y, 60, '#7d9dff');
        const dmg = (26 + rank * 14) * (1 + this.st.dmgP / 100) + this.st.ranged * .5;
        tgt.hurt(dmg, true, this, 'ranged');
        tgt.stun = Math.max(tgt.stun, 1.4 + rank * .1);
        tgt.marked = 5;
        tgt.knockback(a, 200);
        for (const e of enemies) if (!e.dead && e !== tgt && dist(e.x, e.y, tgt.x, tgt.y) < 120) {
          e.hurt(dmg * .4, false, this, 'ranged');
          e.stun = Math.max(e.stun, .7);
          e.marked = 3;
        }
        AudioSys.sfx('dash');
        UI.banner('FESTNAHME', 1.2);
        break;
      }
      case 'vollgas': {
        this.activateRollerBoost();
        this.dashT = .22; this.dashDir = { x: Math.cos(this.aim), y: Math.sin(this.aim) }; this.perfectT = .12;
        const r = 130 + rank * 10;
        const dmg = (18 + rank * 10) * (1 + this.st.dmgP / 100) + this.st.elem * .6;
        FX.shockwave(this.x, this.y, r, '#ffc93c');
        FX.shockwave(this.x, this.y, r * .6, '#8e7cff');
        for (let i = 0; i < 14; i++) FX.particle(this.x + crnd(-40, 40), this.y + crnd(-40, 40), crnd(TAU), crnd(140, 340), i % 2 ? '#ffc93c' : '#8e7cff', .5, 2.6);
        for (const e of enemies) if (!e.dead && dist(e.x, e.y, this.x, this.y) < r) {
          e.hurt(dmg, false, this, 'elem');
          e.applyElement('shock', dmg * .5, this);
          e.stun = Math.max(e.stun, .55 + rank * .06);
          e.knockback(Math.atan2(e.y - this.y, e.x - this.x), 400);
        }
        AudioSys.sfx('dash');
        UI.banner('VOLLGAS!', 1.15);
        break;
      }
    }
  }
  sayQuote() {
    if (!this.alive) return;
    const list = QUOTES[this.char.id] || QUOTES.leonidas;
    this.quoteText = list[Math.floor(Math.random() * list.length)];
    this.quoteT = 2.6;
    AudioSys.voiceChar(this.char.id);
    for (let i = 0; i < 6; i++) FX.particle(this.x, this.y - 16, crnd(TAU), crnd(30, 90), this.char.col, .5, 2);
  }
  jump() {
    if (!this.alive) return;
    this.jumpT = .45;
    AudioSys.sfx('step');
    for (let i = 0; i < 4; i++) FX.particle(this.x + crnd(-8, 8), this.y + 10, -Math.PI / 2 + crnd(-.5, .5), crnd(20, 50), '#9db0c2', .4, 2);
  }
  roll() {
    if (!this.alive || this.rollCd > 0 || this.dashT > 0) return;
    this.rollCd = this.moveSet.rollCd;
    const mv = Input.moveVec(this.index);
    this.rollDir = (mv.x || mv.y) ? mv : { x: Math.cos(this.aim), y: Math.sin(this.aim) };
    this.rollT = this.moveSet.rollDuration;
    this.invuln = Math.max(this.invuln, .34);
    this.perfectT = .12;   /* Fenster für perfektes Ausweichen */
    AudioSys.sfx('dash');
    Input.rumble(Input.padMap[this.index], 90, .45, .25);
    FX.shockwave(this.x, this.y, 40, this.char.col);
  }
  emote() {
    if (!this.alive) return;
    this.emoteType = (this.emoteType + 1) % this.emoteList.length;
    this.emoteT = 1.8;
    AudioSys.voiceChar(this.char.id, true);
  }
  emoteSymbol() {
    return ['👋', '🕺', '👍'][this.emoteType];
  }
  draw(ctx) {
    const c = this.char, sk = c.skin || {};
    /* Pixel-Sprites aus der main-Linie: haben Vorrang vor dem KayKit-Atlas. */
    const _spr = CHAR_SPR[c.id];
    if (_spr && _spr.idle && _spr.idle.img.complete && _spr.idle.img.naturalWidth) {
      _sprFrameSize(_spr.idle); if (_spr.walk) _sprFrameSize(_spr.walk); if (_spr.punch) _sprFrameSize(_spr.punch);
      ctx.save(); ctx.translate(this.x, this.y);
      if (!this.alive) ctx.globalAlpha = .35;
      const jy = this.jumpT > 0 ? -Math.sin(clamp(1 - this.jumpT / .45, 0, 1) * Math.PI) * 24 : 0;
      if (jy) ctx.translate(0, jy);
      const mov = Math.hypot(this.vx, this.vy);
      /* KEIN hitSq-Scale mehr: Treffer erzeugen nur noch ein Weißblinken (Alpha-
         Flackern). Das alte scale(hitSq, 1/hitSq) liess die Figur bei jedem
         Treffer/Spawn sichtbar auf und ab ploppen - genau der "wechselt Groesse"-
         Bug. Groesse ist jetzt konstant. */
      const hitFlicker = this.hitFlash > 0 ? (Math.sin(Game.time * 42) > 0 ? 0.55 : 1) : 1;
      let animName = 'idle';
      if (this.dashT > 0 || this.hitFlash > 0) animName = 'punch';
      else if (mov > 40) animName = 'walk';
      const anim = _spr[animName] || _spr.idle;
      let state = _sprState.get(this.index);
      if (!state) { state = { t: 0, frame: 0 }; _sprState.set(this.index, state); }
      state.t += 1 / 60;
      const fps = animName === 'idle' ? 3 : animName === 'walk' ? 10 : 12;
      state.frame = Math.floor(state.t * fps) % anim.n;
      const col = state.frame % anim.cols, row = Math.floor(state.frame / anim.cols);
      /* Zellgroessen sind gemischt (16x16, 32x32, 96x96, 128x128) - auf eine
         einheitliche Weltgroesse (96px) normalisieren. Frueher ganzzahlig
         (max(1, round)), damit die Pixelkunst-Platzhalter (16/32px) nicht
         flimmern; seit den Foto-Collage-Sprites sind 128px-Zellen im Spiel,
         die auf 96px Bildschirmgroesse weich herunterskaliert werden
         (0,75 - Bildschirmgroesse unveraendert, mehr Detail pro Figur). */
      const S = 96 / Math.max(anim.fw, anim.fh);
      const drawW = anim.fw * S, drawH = anim.fh * S;
      /* Bodenschatten: verankert die Figur im Feld. Der KayKit-Pfad hatte einen,
         dieser nicht - die Figuren schwebten. Vor dem Spiegeln zeichnen, damit
         er nicht mitkippt. */
      ctx.save();
      /* -jy hebt den Sprungversatz auf: der Schatten bleibt am Boden liegen,
         statt mit der Figur hochzuspringen. */
      ctx.translate(0, -jy);
      ctx.globalAlpha = (this.alive ? .34 : .12);
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(0, drawH * .06, drawW * .30, drawH * .085, 0, 0, TAU); ctx.fill();
      ctx.restore();
      /* NICHT rotieren: das sind Frontalansichten mit Gesicht und Fuessen unten.
         `rotate(aim + PI/2)` liess sie beim Zielen nach rechts auf der Seite
         liegen und nach unten kopfstehen - aufrecht standen sie nur nach oben.
         Blickrichtung wird gespiegelt. Die Umschaltung braucht eine tote Zone:
         beim Zielen genau nach oben oder unten ist cos(aim) rund 1e-17, dort
         wuerde schon Zielzittern die Figur in jedem Bild hin und her klappen. */
      const _cx = Math.cos(this.aim);
      if (Math.abs(_cx) > .15) state.flip = _cx < 0;
      if (state.flip) ctx.scale(-1, 1);
      ctx.globalAlpha = (this.alive ? 1 : .35) * hitFlicker;
      /* Hartes Sampling nur fuer diesen Zeichenaufruf: dasselbe Canvas traegt
         fotografische Bodentexturen, die weiter geglaettet werden muessen. */
      const _sm = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(anim.img, col * anim.fw, row * anim.fh, anim.fw, anim.fh, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.imageSmoothingEnabled = _sm;
      ctx.restore();
      this.drawQuote(ctx, jy);
      if (this.pet) { ctx.save(); ctx.translate(this.x, this.y + jy); this.pet.draw(ctx); ctx.restore(); }
      return;
    }
    // KayKit sprite path - if character has kaykit id, draw from atlas
    if(c.sprite && _charImgs[c.sprite] && _charImgs[c.sprite].complete && _charImgs[c.sprite].naturalWidth){
      const atlas=_charImgs[c.sprite];
      const mov=Math.hypot(this.vx,this.vy);
      let animRow=0;
      if(!this.alive) animRow=CHAR_ANIM_ROW.Death_A;
      else if(this.hitFlash>0) animRow=CHAR_ANIM_ROW.Hit_A;
      else if(this.abilityActive>0) animRow=CHAR_ANIM_ROW.Use_Item;
      else if(mov>150) animRow=CHAR_ANIM_ROW.Running_A;
      else if(mov>8) animRow=CHAR_ANIM_ROW.Walking_A;
      else animRow=CHAR_ANIM_ROW.Idle_A;
      const cols=CHAR_ATLAS_COLS, cell=CHAR_ATLAS_CELL;
      /* Umlaufende Bildwahl fuer alle Saetze — ausser Tod. Der lief sonst
         endlos: umfallen, aufstehen, umfallen. Sterben spielt einmal ab und
         haelt das letzte Bild. */
      let frame;
      if (animRow === CHAR_ANIM_ROW.Death_A) {
        const el = Game.time - (this.diedAt != null ? this.diedAt : Game.time);
        frame = Math.min(3, Math.floor(el * 7));
      } else {
        frame = Math.floor((Game.time * 4 + this.index * 1.7) % 4);
      }
      const sx=frame*cell, sy=animRow*cell;
      const sc=1.0;
      // shadow
      ctx.save(); ctx.translate(this.x, this.y);
      ctx.fillStyle='rgba(0,0,0,.42)';
      ctx.beginPath(); ctx.ellipse(0, 9, 15, 7, 0, 0, 2*Math.PI); ctx.fill();
      const jy=this.jumpT>0 ? -Math.sin(Math.min(1 - this.jumpT/.45,1)*Math.PI)*24 : 0;
      if(jy) ctx.translate(0, jy);
      // rotate to face aim
      ctx.rotate(this.aim + Math.PI/2);
      const hit=this.hitFlash>0?1:0;
      if(hit) ctx.globalAlpha=0.9;
      // draw sprite centered, feet at y
      const w=cell*sc, h=cell*sc;
      ctx.drawImage(atlas, sx, sy, cell, cell, -w/2, -h+12, w, h);
      ctx.restore();
      // still draw pet/quote/emote etc. (reuse tail of original draw)
      // For KayKit we skip procedural body but still need tail effects
      const t=Game.time;
      // quote/emote/pet/level ring etc. - call helper if exists
      // Simplified: just draw quote and pet via original tail
      // To avoid duplicating, we will run the tail part manually
      ctx.save(); ctx.translate(this.x, this.y + (jy||0));
      // pet
      if(this.pet) this.pet.draw(ctx);
      ctx.restore();
      // hit flash already handled, return
      // draw level/ability rings etc. - reuse original's tail after this point would be duplicated
      // Instead we just handle the minimal needed and return
      // Draw hit flash ring
      if(this.hitFlash>0){
        ctx.save(); ctx.translate(this.x, this.y);
        ctx.strokeStyle='#fff'; ctx.globalAlpha=this.hitFlash*0.6; ctx.lineWidth=2;
        ctx.beginPath(); ctx.arc(0,0,18,0,2*Math.PI); ctx.stroke(); ctx.restore();
      }
      /* Denselben Schluss zeichnen wie der prozedurale Weg — sonst traegt
         die Figur ihre Waffen unsichtbar. */
      this.drawOverlay(ctx, jy, this.walkT * this.profile.animationRate, sk);
      return;
    }
    ctx.save(); ctx.translate(this.x, this.y);
    ctx.fillStyle = 'rgba(0,0,0,.42)';
    ctx.beginPath(); ctx.ellipse(0, 9, sk.build === 'giant' ? 24 : sk.build === 'wide' ? 19 : 15, sk.build === 'giant' ? 9 : 7, 0, 0, TAU); ctx.fill();
    const jy = this.jumpT > 0 ? -Math.sin(clamp(1 - this.jumpT / .45, 0, 1) * Math.PI) * 24 : 0;
    if (jy) ctx.translate(0, jy);
    if (!this.alive) {
      ctx.globalAlpha = .5; ctx.rotate(1.2);
      ctx.fillStyle = '#4a5570'; ctx.fillRect(-13, -6, 26, 12); ctx.restore(); return;
    }
    const t = Game.time;
    const mov = Math.hypot(this.vx, this.vy);
    if (mov > 70 && this.dashT <= 0) {
      const smear = clamp((mov - 70) / 240, 0, .5);
      const ma = Math.atan2(this.vy, this.vx);
      ctx.save(); ctx.globalAlpha = smear * .38; ctx.fillStyle = c.col;
      ctx.translate(-Math.cos(ma) * 15 * smear, -Math.sin(ma) * 15 * smear);
      ctx.rotate(this.aim + Math.PI / 2);
      ctx.beginPath(); ctx.ellipse(0, 0, 9, 13, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
    const dashScale = this.dashT > 0 ? this.dashT / Math.max(.01, this.moveSet.rollDuration) : 0;
    if (dashScale > 0) {
      ctx.save(); ctx.globalAlpha = dashScale * .45;
      ctx.translate(-this.dashDir.x * 14 * dashScale, -this.dashDir.y * 14 * dashScale);
      ctx.fillStyle = c.col;
      ctx.beginPath(); ctx.ellipse(0, 0, 9, 13, this.aim, 0, TAU); ctx.fill();
      ctx.restore();
    }
    const ws = this.profile.walkStyle || {};
    const idle = mov < 8 ? Math.sin(t * 3 + this.index * 1.3) * .7 : 0;
    const animT = this.walkT * this.profile.animationRate;
    const bA = ws.bobAmp || 1, bF = ws.bobFreq || 1;
    const bob = Math.sin(animT * bF) * 2.4 * bA + idle;
    let kick = 0; for (const w of this.weapons) kick = Math.max(kick, w.kick || 0);
    const lean = mov > 8 ? (ws.lean || 0) : 0;
    ctx.rotate(this.aim + Math.PI / 2 + (mov > 8 ? Math.sin(this.walkT * 2) * .05 : 0) - kick * .05 + lean + (this.rollT > 0 ? this.rollSpin : 0));
    let Sx = 1, Sy = 1;
    if (sk.build === 'kid') { Sx = .8; Sy = .82; }
    else if (sk.build === 'wide') { Sx = 1.38; Sy = 1.06; }
    else if (sk.build === 'slim') { Sx = .86; Sy = .94; }
    else if (sk.build === 'square') { Sx = 1.12; Sy = 1.12; }
    else if (sk.build === 'giant') { Sx = 1.62; Sy = 1.52; }
    const breath = 1 + Math.sin(t * 3.2 + this.index * 1.3) * .025 * (mov < 8 ? 1 : .3);
    const hitSq = 1 + overshoot(this.hitFlash) * 1.1 + this.popT * .5;
    const dashStretch = this.dashT > 0 ? 1.14 : 1;
    Sx *= breath * hitSq / dashStretch;
    Sy *= breath / Math.sqrt(hitSq) * dashStretch;
    ctx.scale(Sx, Sy);
    this.drawProp(ctx, bob);
    if (this.activationPose) this.drawActivationPose(ctx, bob, t);
    if (this.idleT > 2) this.drawIdleAnim(ctx, bob, t);
    const amp = clamp(mov / 150, .35, 1);
    const ride = sk.prop === 'escooter' ? 0 : 1;
    const lS = ws.legSwing || 1, lL = ws.legLift || 1, sW = ws.stepWidth || 1;
    const sw = Math.sin(animT * 2) * 4.5 * lS * amp * ride;
    const legCol = this.index === 0 ? '#20283f' : '#173a4a';
    for (let s = 0; s < 2; s++) {
      const ph = s === 0 ? 0 : Math.PI;
      const lift = Math.max(0, Math.sin(animT * 2 + ph)) * 2.4 * lL * amp * ride;
      ctx.fillStyle = legCol;
      ctx.beginPath();
      ctx.moveTo(-6 * sW + s * 12 * sW, 6 + bob); ctx.lineTo(-6 * sW + s * 12 * sW + (s === 0 ? sw : -sw), 15 + bob - lift);
      ctx.lineTo(-2 * sW + s * 4 * sW, 15 + bob - lift); ctx.lineTo(-2 * sW + s * 4 * sW, 6 + bob); ctx.closePath(); ctx.fill();
      ctx.fillStyle = this.index === 0 ? '#141a2c' : '#0d2530';
      ctx.fillRect(-6 * sW + s * 12 * sW + (s === 0 ? sw : -sw) - 1.6, 14 + bob - lift, 4.4, 3.2);
    }
    const flash = this.hitFlash > 0 ? 1 : 0;
    ctx.fillStyle = flash ? '#fff' : c.col;
    ctx.beginPath(); ctx.moveTo(0, -14 + bob); ctx.lineTo(9, -4 + bob); ctx.lineTo(10, 8 + bob);
    ctx.lineTo(0, 5 + bob); ctx.lineTo(-10, 8 + bob); ctx.lineTo(-9, -4 + bob); ctx.closePath(); ctx.fill();
    ctx.fillStyle = flash ? '#fff' : c.col2;
    ctx.beginPath(); ctx.moveTo(0, -14 + bob); ctx.lineTo(5.5, -3 + bob); ctx.lineTo(-5.5, -3 + bob); ctx.closePath(); ctx.fill();
    ctx.fillStyle = flash ? '#fff' : shade(c.col, .3);
    ctx.beginPath(); ctx.arc(-9, -3 + bob, 2.8, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(9, -3 + bob, 2.8, 0, TAU); ctx.fill();
    ctx.fillStyle = flash ? '#fff' : (sk.chest || '#fff');
    ctx.beginPath(); ctx.arc(0, -1 + bob, 2.1, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.arc(0, -1 + bob, 1, 0, TAU); ctx.fill();
    ctx.lineCap = 'round'; ctx.lineWidth = 3.4; ctx.strokeStyle = flash ? '#fff' : '#d9b48a';
    const aS = ws.armSwing || 1;
    const armSw = amp > .4 ? Math.sin(animT * 2) * 1.8 * aS : 0;
    if (sk.prop === 'escooter') {
      /* Beide Hände am Lenker */
      ctx.beginPath(); ctx.moveTo(-7, 0 + bob); ctx.quadraticCurveTo(-3, -3 + bob, 6.2, -1 + bob); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(7, 0 + bob); ctx.quadraticCurveTo(9.5, -1 + bob, 12, 1.5 + bob); ctx.stroke();
      ctx.fillStyle = flash ? '#fff' : '#d9b48a';
      ctx.beginPath(); ctx.arc(6.4, -1 + bob, 1.9, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(12.2, 1.7 + bob, 1.9, 0, TAU); ctx.fill();
    } else {
      ctx.beginPath(); ctx.moveTo(-7, 0 + bob); ctx.quadraticCurveTo(-9, -8 + bob + armSw, -4, -13 + bob + armSw); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(7, 0 + bob); ctx.quadraticCurveTo(9, -8 + bob - armSw, 4, -13 + bob - armSw); ctx.stroke();
      ctx.fillStyle = flash ? '#fff' : '#d9b48a';
      ctx.beginPath(); ctx.arc(-4, -13.5 + bob, 2.2, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(4, -13.5 + bob, 2.2, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = flash ? '#fff' : (sk.head || '#f2d5b0'); ctx.beginPath(); ctx.arc(0, -5 + bob, 5.6, 0, TAU); ctx.fill();
    if (sk.build !== 'square') {
      const blink = (t * 1.4 + this.index * 7) % 3.8 < .09 ? .12 : 1;
      ctx.fillStyle = '#1c2233';
      ctx.fillRect(-3.2, -6.4 + bob, 1.8, 2.4 * blink);
      ctx.fillRect(1.9, -6.4 + bob, 1.8, 2.4 * blink);
      ctx.fillRect(-.5, -3.6 + bob, 1.1, 1);
    }
    this.drawHeadExtra(ctx, bob, t);
    this.drawFigureIdentity(ctx, bob, t);
    const mt = this.masteryTier();
    if (mt >= 2) {
      ctx.globalAlpha = .16 + .1 * Math.sin(t * 4);
      ctx.strokeStyle = mt >= 3 ? '#ffe27a' : '#e8b94a';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(0, -2, 15.5, 20, 0, 0, TAU); ctx.stroke();
      ctx.globalAlpha = .2 + .12 * Math.sin(t * 4 + 1.3);
      ctx.fillStyle = mt >= 3 ? '#ffe27a' : '#e8b94a';
      for (let i = 0; i < 3; i++) {
        const a2 = t * 2 + i * TAU / 3;
        ctx.beginPath(); ctx.arc(Math.cos(a2) * 19, -2 + Math.sin(a2) * 15, 1.4, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    this.drawOverlay(ctx, jy, animT, sk);
  }
  /* Gemeinsamer Schluss beider Zeichenwege: Sprechblase, Emote, Ringe,
     Spielerkennung, getragene Waffen und Auren. Frueher stand das fest im
     prozeduralen Weg — der Sprite-Weg sprang darueber hinweg und zeigte
     seine Figuren dadurch unbewaffnet. */
  drawOverlay(ctx, jy, animT, sk) {
    /* Beim Auslagern uebersehen: der Block greift auch auf den Charakter
       und die Spielzeit zu. */
    const c = this.char;
    const t = Game.time;
    sk = sk || (this.char.skin || {});
    animT = animT || (this.walkT * this.profile.animationRate);
    this.drawQuote(ctx, jy);
    if (this.emoteT > 0) {
      const p = clamp(1 - this.emoteT / 1.8, 0, 1);
      const scale = p < .15 ? p / .15 : p > .85 ? (1 - p) / .15 : 1;
      const ey = jy - 20 - Math.sin(p * Math.PI * 2) * 4;
      ctx.save();
      ctx.globalAlpha = this.emoteT > 1.2 ? (1.8 - this.emoteT) / .6 : clamp(this.emoteT / .6, 0, 1);
      ctx.translate(this.x, this.y + ey);
      ctx.scale(scale, scale);
      ctx.font = '26px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(this.emoteSymbol(), 0, 0);
      ctx.restore();
      ctx.textBaseline = 'alphabetic';
    }
    if (this.pet) this.pet.draw(ctx);
    if (this.pendingLevels > 0) {
      ctx.strokeStyle = '#ffe27a'; ctx.globalAlpha = .4 + .25 * Math.sin(t * 8); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(this.x, this.y, 21 + Math.sin(t * 8) * 2.5, 0, TAU); ctx.stroke();
      ctx.globalAlpha = .3 + .2 * Math.sin(t * 8 + 1); ctx.fillStyle = '#ffe27a';
      for (let i = 0; i < 3; i++) {
        const a2 = t * 2.2 + i * TAU / 3;
        ctx.beginPath(); ctx.arc(this.x + Math.cos(a2) * 26, this.y + Math.sin(a2) * 26, 1.8, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    if (this.abilityActive > 0) {
      ctx.strokeStyle = c.col; ctx.globalAlpha = .35 + .3 * Math.sin(t * 10); ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(this.x, this.y, 20 + Math.sin(t * 9) * 3, 0, TAU); ctx.stroke();
      ctx.globalAlpha = .1; ctx.fillStyle = c.col;
      ctx.beginPath(); ctx.arc(this.x, this.y, 18, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (!OPT().reduceFlicker && this.hp / this.maxHp < .25) {
      ctx.fillStyle = 'rgba(255,46,60,' + (.1 + .08 * Math.sin(t * 12)) + ')';
      ctx.beginPath(); ctx.arc(this.x, this.y, 15, 0, TAU); ctx.fill();
    }
    if (this.invuln > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,' + (.25 + .3 * Math.sin(Game.time * 30)) + ')'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(this.x, this.y, 20, 0, TAU); ctx.stroke();
    }
    ctx.fillStyle = this.index === 0 ? 'rgba(244,194,90,.9)' : 'rgba(57,230,255,.9)';
    ctx.font = '9px monospace'; ctx.textAlign = 'center';
    ctx.fillText('P' + (this.index + 1), this.x, this.y - 26);
    // VERBESSERTE WAFFENSPRITES
    for (let i = 0; i < this.weapons.length; i++) {
      const w = this.weapons[i], def = WEAPON_BY_ID[w.id];
      const a = w.angle + Math.sin(animT) * .1;
      const rr = (sk.build === 'giant' ? 30 : 22) - (w.kick || 0) * 5;
      const ox = this.x + Math.cos(a) * rr, oy = this.y + Math.sin(a) * rr;
      ctx.save(); ctx.translate(ox, oy); ctx.rotate(a);
      ctx.globalAlpha = w.ethereal ? .85 : 1;
      drawWeaponSprite(ctx, def, w, Game.time);
      if (w.ethereal) { ctx.strokeStyle = '#a06bff'; ctx.lineWidth = .8; ctx.strokeRect(-5, -4, 20, 8); }
      if (def.type !== 'aura') {
        const gx = def.type === 'melee' ? 7 : 8, gy = (w.kick || 0) > .5 ? 2.4 : 1.6;
        ctx.fillStyle = '#d9b48a'; ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = .6;
        ctx.beginPath(); ctx.arc(gx, gy, 2.2, 0, TAU); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    }
    // Vortex-Aura
    for (const w of this.weapons) if (WEAPON_BY_ID[w.id].type === 'aura') {
      const t = tierData(WEAPON_BY_ID[w.id], w.tier);
      const r = t.range * (1 + this.st.range / 100);
      ctx.strokeStyle = 'rgba(255,46,136,.30)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(this.x, this.y, r, 0, TAU); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,46,136,.14)';
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        for (let s = 0; s <= 24; s++) {
          const ang = s / 24 * TAU * 1.4 + Game.time * 2.2 + k * 2.1;
          const rr = r * (1 - s / 34);
          const px = this.x + Math.cos(ang) * rr, py = this.y + Math.sin(ang) * rr;
          s === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    }
  }
  /* Figuren-Identitaet: kleine, billige Canvas-Details statt eines zweiten
     Sprite-Systems. Jede Silhouette bekommt damit einen eigenen visuellen
     Anker, der auch bei niedriger Qualitaet sichtbar bleibt. */
  drawFigureIdentity(ctx, bob, t) {
    const f = this.profile.figure, pulse = .55 + .45 * Math.sin(t * 5);
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (f === 'firefighter-kid') {
      ctx.strokeStyle = '#ffcf4a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-8, -8 + bob); ctx.lineTo(-13, -12 + bob); ctx.lineTo(-16, -8 + bob); ctx.stroke();
      ctx.fillStyle = '#ffcf4a'; ctx.fillRect(-3, 3 + bob, 6, 2);
    } else if (f === 'red-cross-athlete') {
      ctx.fillStyle = '#fff'; ctx.fillRect(-3, -2 + bob, 6, 2); ctx.fillRect(-1, -4 + bob, 2, 6);
      ctx.strokeStyle = '#ff5d7a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, -1 + bob, 6, 0, TAU); ctx.stroke();
    } else if (f === 'techno-gadgeteer') {
      ctx.fillStyle = '#59e6ff'; ctx.globalAlpha = .75; ctx.fillRect(-12, 2 + bob, 3, 3); ctx.fillRect(9, 2 + bob, 3, 3); ctx.globalAlpha = 1;
      ctx.strokeStyle = '#a06bff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 1 + bob, 13, t * 2, t * 2 + 1.8); ctx.stroke();
    } else if (f === 'ranger-cloak') {
      ctx.fillStyle = '#2b8f5a'; ctx.globalAlpha = .7; ctx.beginPath(); ctx.moveTo(-9, 7 + bob); ctx.lineTo(0, 12 + bob); ctx.lineTo(9, 7 + bob); ctx.lineTo(5, 2 + bob); ctx.lineTo(-5, 2 + bob); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
    } else if (f === 'dj-stack') {
      ctx.strokeStyle = '#59e6ff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(-10, -1 + bob, 3 + pulse, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.arc(10, -1 + bob, 3 + pulse, 0, TAU); ctx.stroke();
    } else if (f === 'neon-glassblade') {
      ctx.strokeStyle = '#ff5ce0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-10, 7 + bob); ctx.lineTo(-14, -6 + bob); ctx.moveTo(10, 7 + bob); ctx.lineTo(14, -6 + bob); ctx.stroke();
    } else if (f === 'clover-scout') {
      ctx.fillStyle = '#5dff9b'; for (const [x, y] of [[-11, -10], [-7, -13], [-3, -10]]) { ctx.beginPath(); ctx.arc(x, y + bob, 2, 0, TAU); ctx.fill(); } ctx.fillRect(-7, -10 + bob, 1.5, 7);
    } else if (f === 'builder-rig') {
      ctx.strokeStyle = '#ffb24a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-12, -1 + bob); ctx.lineTo(-16, 5 + bob); ctx.moveTo(12, -1 + bob); ctx.lineTo(16, 5 + bob); ctx.stroke();
      ctx.fillStyle = '#ffb24a'; ctx.fillRect(-3, 5 + bob, 6, 2);
    } else if (f === 'servo-frame') {
      ctx.strokeStyle = '#c0f0ff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-12, -7 + bob); ctx.lineTo(-15, 5 + bob); ctx.lineTo(-9, 8 + bob); ctx.moveTo(12, -7 + bob); ctx.lineTo(15, 5 + bob); ctx.lineTo(9, 8 + bob); ctx.stroke();
    } else if (f === 'guitar-hero') {
      ctx.strokeStyle = '#ff8a3d'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-12, -9 + bob); ctx.lineTo(-15, -15 + bob); ctx.moveTo(12, -9 + bob); ctx.lineTo(15, -15 + bob); ctx.stroke();
      ctx.fillStyle = '#ffe45c'; ctx.globalAlpha = pulse; ctx.fillRect(-2, 6 + bob, 4, 2); ctx.globalAlpha = 1;
    } else if (f === 'referee-stance') {
      ctx.strokeStyle = '#7dffb0'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0 + bob, 15, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#ffe27a'; ctx.fillRect(-2, 7 + bob, 4, 2);
    } else if (f === 'kiosk-apron') {
      ctx.fillStyle = '#b24a2b'; ctx.fillRect(-7, 4 + bob, 14, 4); ctx.fillStyle = '#ffe08a'; ctx.fillRect(-4, 5 + bob, 2, 2); ctx.fillRect(1, 5 + bob, 2, 2);
    } else if (f === 'advice-notebook') {
      ctx.fillStyle = '#ffd24a'; ctx.fillRect(-15, -2 + bob, 5, 7); ctx.fillStyle = '#8a5cff'; ctx.fillRect(-14, -1 + bob, 3, 1); ctx.fillRect(-14, 1 + bob, 3, 1);
    } else if (f === 'demolition-rig') {
      ctx.strokeStyle = '#ffd23e'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, -1 + bob, 16, Math.PI * .15, Math.PI * .85); ctx.stroke();
      ctx.fillStyle = '#ff8a3d'; ctx.globalAlpha = pulse; ctx.beginPath(); ctx.arc(14, 4 + bob, 2, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
    } else if (f === 'excavator-harness') {
      ctx.strokeStyle = '#ffb24a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-10, -10 + bob); ctx.lineTo(-16, 6 + bob); ctx.moveTo(10, -10 + bob); ctx.lineTo(16, 6 + bob); ctx.stroke();
    } else if (f === 'police-tactical') {
      ctx.strokeStyle = '#7d9dff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0 + bob, 16, Math.PI * .15, Math.PI * .85); ctx.stroke();
      ctx.fillStyle = '#ffe08a'; ctx.fillRect(-2, 4 + bob, 4, 2);
    } else if (f === 'roller-ai') {
      ctx.strokeStyle = '#8e7cff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-13, 11 + bob); ctx.lineTo(-17, 11 + bob); ctx.moveTo(-10, 14 + bob); ctx.lineTo(-15, 14 + bob); ctx.stroke();
      ctx.fillStyle = '#fff2c0'; ctx.globalAlpha = .6 + pulse * .4; ctx.beginPath(); ctx.arc(14, 5 + bob, 2, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
  drawQuote(ctx, jy) {
    if (this.quoteT <= 0 || !this.alive) return;
    const t = Game.time;
    const age = 2.6 - this.quoteT;
    let alpha = 1, scale = 1;
    if (age < .18) { const p = age / .18; scale = .3 + .85 * (1 + Math.sin(p * Math.PI)) * .8; scale = clamp(scale, .3, 1.18); }
    if (this.quoteT < .4) alpha = this.quoteT / .4;
    const text = this.quoteText;
    const w = Math.min(158, Math.max(40, text.length * 6.2 + 16));
    const h = 22;
    const bx = this.x, by = this.y - 42 + (jy || 0) + Math.sin(t * 5 + this.index * 2) * 2;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(bx, by);
    ctx.scale(scale, scale);
    ctx.fillStyle = 'rgba(8,14,26,.93)';
    ctx.strokeStyle = this.char.col;
    ctx.lineWidth = 1.5;
    const r = 7;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-w / 2, -h, w, h, r); else ctx.rect(-w / 2, -h, w, h);
    ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-5, -1); ctx.lineTo(0, 6); ctx.lineTo(5, -1); ctx.closePath();
    ctx.fillStyle = 'rgba(8,14,26,.93)'; ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, -h / 2);
    ctx.restore();
  }
  drawProp(ctx, bob) {
    const sk = this.char.skin || {};
    const swing = Math.sin(this.walkT * 2) * .08;
    if (sk.prop === 'guitar') {
      ctx.save(); ctx.translate(0, 6 + bob); ctx.rotate(.3 + swing);
      ctx.fillStyle = '#2e7d32'; ctx.fillRect(-1.6, -13, 3.2, 13);
      ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.ellipse(0, 5, 5.5, 7.5, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#f4c25a'; ctx.beginPath(); ctx.arc(0, -13, 2.1, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = .8; ctx.strokeRect(-1.2, -12, 2.4, 10);
      ctx.restore();
    } else if (sk.prop === 'wrench') {
      ctx.save(); ctx.translate(0, 7 + bob); ctx.rotate(-.5 - swing);
      ctx.fillStyle = '#cfd2dc'; ctx.fillRect(-1.3, -3, 2.6, 14);
      ctx.beginPath(); ctx.arc(0, 12.5, 3.4, 0, TAU); ctx.fill();
      ctx.fillStyle = '#232a3d'; ctx.beginPath(); ctx.arc(0, 12.5, 1.6, 0, TAU); ctx.fill();
      ctx.restore();
    } else if (sk.prop === 'schrauber') {
      /* Denises Schlagschrauber: Oliv-Gehäuse mit rotierendem Futter und Technik-Glow */
      const spin = Math.sin(this.walkT * 3 + Game.time * 14) * 1.2;
      ctx.save(); ctx.translate(0, 7 + bob); ctx.rotate(.18 + swing * .6);
      ctx.fillStyle = '#3a4f3a'; ctx.fillRect(-2.4, -3, 4.8, 12);
      ctx.fillStyle = '#4a644a'; ctx.fillRect(-2.4, -3, 4.8, 2);
      ctx.fillStyle = '#2b3140'; ctx.fillRect(-3.2, 4, 2.2, 5);
      ctx.save(); ctx.translate(0, -5); ctx.rotate(spin);
      ctx.fillStyle = '#cfd2dc';
      ctx.beginPath(); ctx.arc(0, 0, 2.6, 0, TAU); ctx.fill();
      ctx.fillStyle = '#0d1220'; ctx.beginPath(); ctx.arc(0, 0, 1.2, 0, TAU); ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#a8c4e8'; ctx.globalAlpha = .5 + .4 * Math.sin(Game.time * 10);
      ctx.beginPath(); ctx.arc(0, -5, 3.2, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.restore();
    } else if (sk.prop === 'nunchaku') {
      const spin = Math.sin(this.walkT * 2.6) * .22;
      for (let i = 0; i < 2; i++) {
        const s = i ? 1 : -1;
        ctx.save(); ctx.translate(s * 5, 6 + bob); ctx.rotate(s * (1.1 + spin) + (i ? .5 : -.5));
        ctx.fillStyle = '#7a4a1a'; ctx.fillRect(-1.1, -10, 2.2, 10);
        ctx.fillStyle = '#efe9d8'; ctx.beginPath(); ctx.arc(0, -11.2, 2.3, 0, TAU); ctx.fill();
        ctx.fillStyle = '#7a4a1a'; ctx.beginPath(); ctx.arc(0, 0, 2.0, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#4a4a55'; ctx.lineWidth = .9;
        ctx.beginPath(); ctx.moveTo(0, -2); ctx.lineTo(s * 7, 4); ctx.stroke();
        ctx.restore();
      }
    } else if (sk.prop === 'escooter') {
      /* E-Roller: Deck unter den Füßen, Vorderrad + Lenker rechts vorn */
      const t = Game.time;
      const gy = Math.sin(this.walkT * 2) * .35;
      ctx.fillStyle = '#3d3a50';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-5.5, 13 + gy, 11, 5.6, 2.6); else ctx.fillRect(-5.5, 13 + gy, 11, 5.6);
      ctx.fill();
      ctx.fillStyle = '#2b2836'; ctx.beginPath(); ctx.arc(-4, 22 + gy, 3.3, 0, TAU); ctx.fill();
      ctx.fillStyle = '#8e7cff'; ctx.beginPath(); ctx.arc(-4, 22 + gy, 1.2, 0, TAU); ctx.fill();
      ctx.fillStyle = '#2b2836'; ctx.beginPath(); ctx.arc(9, 9 + gy, 3.1, 0, TAU); ctx.fill();
      ctx.fillStyle = '#8e7cff'; ctx.beginPath(); ctx.arc(9, 9 + gy, 1.1, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#4a4258'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(2.5, 14 + gy); ctx.lineTo(9.5, 2 + gy); ctx.stroke();
      ctx.strokeStyle = '#3d3a50'; ctx.lineWidth = 3.2;
      ctx.beginPath(); ctx.moveTo(6.5, -1 + gy); ctx.lineTo(12.5, 2 + gy); ctx.stroke();
      ctx.globalAlpha = .5 + .5 * Math.sin(t * 9);
      ctx.fillStyle = '#fff2c0'; ctx.beginPath(); ctx.arc(11.6, 1 + gy, 1.3, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
  drawActivationPose(ctx, bob, t) {
    const p = this.activationPose; if (!p) return;
    const pr = clamp(p.t / .3, 0, 1);
    const ease = 1 - (1 - pr) * (1 - pr);
    ctx.save();
    switch (p.type) {
      case 'loeschstrahl':
        ctx.rotate(-.15 * ease); ctx.translate(3 * ease, 0); break;
      case 'heilaura':
        ctx.translate(0, -2 * ease); break;
      case 'phasendash':
        ctx.scale(1 + .12 * ease, 1 - .08 * ease); break;
      case 'markierung':
        ctx.translate(2 * ease, -1 * ease); break;
      case 'raveaura':
        ctx.rotate(.08 * Math.sin(t * 12) * ease); break;
      case 'overdrive':
        ctx.translate(Math.sin(t * 20) * 1.5 * ease, 0); break;
      case 'fuellhorn':
        ctx.translate(0, -3 * ease); break;
      case 'turret':
        ctx.rotate(.1 * ease); ctx.translate(0, 2 * ease); break;
      case 'notstrom':
        ctx.scale(1 + .15 * ease, 1 + .15 * ease); break;
      case 'powerchord':
        ctx.rotate(-.12 * ease); break;
      case 'schiedsgericht':
        ctx.translate(0, -2 * ease); ctx.rotate(-.06 * ease); break;
      case 'kiosk':
        ctx.rotate(.2 * ease); ctx.translate(4 * ease, 0); break;
      case 'walla':
        ctx.translate(0, -1.5 * ease); break;
      case 'sprengsatz':
        ctx.rotate(.25 * ease); ctx.translate(5 * ease, -2 * ease); break;
      case 'luftschlag':
        ctx.rotate(-.2 * ease); ctx.translate(-3 * ease, 0); break;
      case 'festnahme':
        ctx.scale(1 + .1 * ease, 1 - .06 * ease); break;
      case 'vollgas':
        ctx.scale(1 + .08 * ease, 1 - .05 * ease); ctx.rotate(.05 * ease); break;
    }
    ctx.restore();
  }
  drawIdleAnim(ctx, bob, t) {
    if (this.idleT < 2) return;
    const it = (this.idleT - 2) % 8;
    const sk = this.char.skin || {};
    const idleType = this.profile.idleAnim;
    if (!idleType) return;
    ctx.save();
    const flash = this.hitFlash > 0;
    ctx.fillStyle = flash ? '#fff' : '#d9b48a';
    ctx.lineCap = 'round'; ctx.lineWidth = 2.4;
    ctx.strokeStyle = flash ? '#fff' : '#d9b48a';
    switch (idleType) {
      case 'check-belt':
        if (it < 1.5) { ctx.beginPath(); ctx.moveTo(7, -2 + bob); ctx.lineTo(10, 4 + bob + Math.sin(it * 8) * 2); ctx.stroke(); }
        break;
      case 'check-pulse':
        if (it < 1.5) { ctx.beginPath(); ctx.arc(-4, -6 + bob, 2, 0, TAU); ctx.fill(); ctx.globalAlpha = .3 + .3 * Math.sin(it * 6); ctx.beginPath(); ctx.arc(-4, -6 + bob, 3.5, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1; }
        break;
      case 'tap-gadget':
        if (it < 1.2) { ctx.beginPath(); ctx.moveTo(5, -8 + bob); ctx.lineTo(8 + Math.sin(it * 10) * 2, -10 + bob); ctx.stroke(); if (Math.sin(it * 12) > .7) { ctx.fillStyle = '#59e6ff'; ctx.beginPath(); ctx.arc(9, -11 + bob, 1, 0, TAU); ctx.fill(); } }
        break;
      case 'scan-horizon':
        if (it < 2) { const a = -.3 + it * .15; ctx.save(); ctx.translate(0, -8 + bob); ctx.rotate(a); ctx.fillStyle = flash ? '#fff' : '#d9b48a'; ctx.beginPath(); ctx.arc(0, 0, 2, 0, TAU); ctx.fill(); ctx.restore(); }
        break;
      case 'head-bop':
        ctx.translate(0, Math.abs(Math.sin(it * 5)) * -2); break;
      case 'tremble':
        ctx.translate(Math.sin(it * 18) * .8, Math.sin(it * 14) * .5); break;
      case 'pat-clover':
        if (it < 1.5) { ctx.beginPath(); ctx.moveTo(-5, -10 + bob); ctx.lineTo(-5, -14 + bob + Math.sin(it * 7) * 2); ctx.stroke(); }
        break;
      case 'twirl-wrench':
        if (it < 2) { ctx.save(); ctx.translate(6, -6 + bob); ctx.rotate(it * 4); ctx.fillRect(-1, -6, 2, 6); ctx.beginPath(); ctx.arc(0, -7, 2.5, 0, TAU); ctx.fill(); ctx.restore(); }
        break;
      case 'servo-check':
        if (it < 1.5) { ctx.globalAlpha = .5 + .3 * Math.sin(it * 10); ctx.fillStyle = '#39e6ff'; ctx.beginPath(); ctx.arc(-7, -4 + bob, 1.5, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; }
        break;
      case 'air-guitar':
        if (it < 2.5) { const s = Math.sin(it * 6); ctx.beginPath(); ctx.moveTo(-6, -2 + bob); ctx.quadraticCurveTo(-10, -10 + bob + s * 4, -4, -14 + bob + s * 3); ctx.stroke(); ctx.beginPath(); ctx.moveTo(6, -2 + bob); ctx.quadraticCurveTo(10, -10 + bob - s * 4, 4, -14 + bob - s * 3); ctx.stroke(); }
        break;
      case 'flip-notes':
        if (it < 2) { ctx.fillStyle = '#ffd24a'; ctx.fillRect(5, -10 + bob, 4, 5); ctx.fillStyle = '#8a5cff'; for (let i = 0; i < 3; i++) ctx.fillRect(6, -9 + i * 1.5 + bob, 2, .8); }
        break;
      case 'wipe-counter':
        if (it < 2) { ctx.beginPath(); ctx.moveTo(-4, 2 + bob); ctx.quadraticCurveTo(-4 + Math.sin(it * 5) * 6, 0 + bob, 4, 2 + bob); ctx.stroke(); }
        break;
      case 'meditate':
        if (it > .5 && it < 2.5) { ctx.globalAlpha = .4 * (1 - (it - .5) / 2); ctx.fillStyle = '#ffd24a'; ctx.beginPath(); ctx.arc(0, -18 + bob, 3, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; }
        break;
      case 'check-fuse':
        if (it < 1.5) { ctx.fillStyle = '#ff8a3d'; ctx.beginPath(); ctx.arc(8, -4 + bob, 1.2, 0, TAU); ctx.fill(); if (Math.sin(it * 15) > .5) { FX.spark(8, -4 + bob, '#ffa040'); } }
        break;
      case 'test-crane':
        if (it < 2) { const ext = Math.sin(it * 3) * 4; ctx.beginPath(); ctx.moveTo(8, -4 + bob); ctx.lineTo(12 + ext, -8 + bob); ctx.stroke(); }
        break;
      case 'rattle-cuffs':
        if (it < 1.2) { ctx.fillStyle = '#c0c8d4'; ctx.fillRect(-3, -8 + bob + Math.sin(it * 20) * 1, 2.5, 2.5); ctx.fillRect(1, -8 + bob + Math.sin(it * 20 + 1) * 1, 2.5, 2.5); }
        break;
      case 'check-phone':
        if (it < 2) { ctx.fillStyle = '#6c5ce7'; ctx.fillRect(3, -6 + bob, 5, 7); ctx.fillStyle = '#8e7cff'; ctx.fillRect(3.5, -5.5 + bob, 4, 5.5); }
        break;
    }
    ctx.restore();
  }
  drawHeadExtra(ctx, bob, t) {
    const sk = this.char.skin || {};
    const sway = Math.sin(this.walkT * 2) * 1.3;
    const flash = this.hitFlash > 0;
    switch (sk.hat) {
      case 'fire': {
        ctx.fillStyle = '#d43b2f';
        ctx.beginPath(); ctx.arc(0, -6 + bob, 6.4, Math.PI, 0); ctx.fill();
        ctx.fillRect(-6.4, -6.4 + bob, 12.8, 3);
        ctx.fillStyle = '#7a241c'; ctx.fillRect(-6.4, -6.4 + bob, 12.8, 1.2);
        ctx.fillStyle = '#ffd75e'; ctx.fillRect(-2, -12.6 + bob, 4, 3.4);
        break;
      }
      case 'pony': {
        ctx.fillStyle = '#ff3b4d';
        ctx.beginPath(); ctx.arc(0, -6 + bob, 6.2, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(0, -8 + bob, 4.2, Math.PI * .9, Math.PI * 2.1); ctx.fill();
        ctx.beginPath(); ctx.arc(-5.6 + sway * .5, -1 + bob, 2.4, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-5.6 + sway * .5, .5 + bob); ctx.lineTo(-10.5 + sway, 5 + bob); ctx.lineTo(-3.5 + sway * .7, 2.5 + bob); ctx.closePath(); ctx.fill();
        break;
      }
      case 'blond': {
        /* Sunny: langes blondes Haar, fällt beidseitig bis auf die Schultern (sexy Blondinen-Look) */
        const H = '#f2c86b', H2 = '#ffe6a8', H3 = '#d9a84e';
        const sw2 = Math.sin(this.walkT * 2 + 1) * .9;
        ctx.fillStyle = H;
        ctx.beginPath(); ctx.arc(0, -6 + bob, 7, Math.PI, 0); ctx.fill();
        ctx.fillRect(-7, -7 + bob, 14, 3.4);
        /* lange Strähnen links + rechts, bis zur Brust */
        ctx.beginPath(); ctx.moveTo(-6.8 + sw2 * .5, -3 + bob);
        ctx.quadraticCurveTo(-9.6 + sw2, 4 + bob, -7.8 + sw2 * .7, 10 + bob);
        ctx.quadraticCurveTo(-5.2 + sw2, 8.5 + bob, -5.6 + sw2 * .3, 3.5 + bob);
        ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(6.8 + sw2 * .5, -3 + bob);
        ctx.quadraticCurveTo(9.6 - sw2, 4 + bob, 7.8 - sw2 * .7, 10 + bob);
        ctx.quadraticCurveTo(5.2 - sw2, 8.5 + bob, 5.6 - sw2 * .3, 3.5 + bob);
        ctx.closePath(); ctx.fill();
        /* Pony & Scheitel, glänzende Strähnen */
        ctx.fillStyle = H2;
        ctx.beginPath(); ctx.arc(-2.4, -9.2 + bob, 2.7, Math.PI * .9, Math.PI * 2.05); ctx.fill();
        ctx.fillStyle = H3;
        ctx.beginPath(); ctx.moveTo(-6.2, -2 + bob); ctx.lineTo(-7.4 + sw2, 6 + bob); ctx.lineTo(-5.6 + sw2, 4.6 + bob); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(6.2, -2 + bob); ctx.lineTo(7.4 - sw2, 6 + bob); ctx.lineTo(5.6 - sw2, 4.6 + bob); ctx.closePath(); ctx.fill();
        break;
      }
      case 'goggles': {
        ctx.fillStyle = '#7d6bf0';
        for (let i = 0; i < 6; i++) {
          const a = i / 6 * TAU + Math.sin(t * 2 + i) * .25;
          ctx.beginPath(); ctx.arc(Math.cos(a) * 6, -6 + bob + Math.sin(a) * 5.6, 2, 0, TAU); ctx.fill();
        }
        ctx.fillStyle = '#141a2c'; ctx.fillRect(-5.4, -8 + bob, 10.8, 2.6);
        ctx.fillStyle = 'rgba(89,230,255,.75)'; ctx.fillRect(-5, -7.6 + bob, 4.2, 2.8); ctx.fillRect(.8, -7.6 + bob, 4.2, 2.8);
        break;
      }
      case 'hood': {
        ctx.fillStyle = '#2b8f5a';
        ctx.beginPath(); ctx.arc(0, -5 + bob, 7, Math.PI * .85, Math.PI * 2.15); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-6.8, -2 + bob); ctx.lineTo(-9.5, 7 + bob); ctx.lineTo(-2.5, 4 + bob); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(6.8, -2 + bob); ctx.lineTo(9.5, 7 + bob); ctx.lineTo(2.5, 4 + bob); ctx.closePath(); ctx.fill();
        break;
      }
      case 'helm': {
        ctx.fillStyle = '#6d7f9e';
        ctx.beginPath(); ctx.arc(0, -6 + bob, 6.8, Math.PI, 0); ctx.fill();
        ctx.fillRect(-6.8, -7 + bob, 13.6, 2.8);
        ctx.fillStyle = '#7e90b2'; ctx.fillRect(-6.8, -6.6 + bob, 13.6, 1.4);
        ctx.fillStyle = '#4a5a74'; ctx.fillRect(-3.4, -12.6 + bob, 6.8, 3);
        break;
      }
      case 'spiky': {
        ctx.fillStyle = '#ff5ce0';
        ctx.beginPath(); ctx.moveTo(0, -19 + bob); ctx.lineTo(3.2, -10.5 + bob); ctx.lineTo(-3.2, -10.5 + bob); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.arc(0, -6 + bob, 6, Math.PI, 0); ctx.fill();
        ctx.fillStyle = '#c230a8';
        ctx.beginPath(); ctx.moveTo(-1.5, -15 + bob); ctx.lineTo(-4, -9 + bob); ctx.lineTo(0, -8 + bob); ctx.closePath(); ctx.fill();
        break;
      }
      case 'cap': {
        ctx.fillStyle = '#3d8f2a';
        ctx.beginPath(); ctx.arc(0, -6 + bob, 6.2, Math.PI, 0); ctx.fill();
        ctx.fillRect(-6.2, -6.2 + bob, 12.4, 2.6);
        ctx.fillStyle = '#1f4a15'; ctx.fillRect(1.5, -6.8 + bob, 5, 1.6);
        ctx.fillStyle = '#5dff9b';
        ctx.beginPath(); ctx.arc(0, -12.4 + bob, 1.7, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(0, -15.6 + bob, 1.7, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(-1.5, -14 + bob, 1.7, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(1.5, -14 + bob, 1.7, 0, TAU); ctx.fill();
        break;
      }
      case 'military': {
        /* Denises Army-Barett: Oliv, schwarzer Bund, goldener Stern + Air-Force-Rundel */
        ctx.fillStyle = '#3a4f3a';
        ctx.beginPath(); ctx.ellipse(0, -7 + bob, 7.4, 3.6, 0, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-5, -9 + bob); ctx.quadraticCurveTo(0, -15 + bob + sway * .5, 5, -9 + bob);
        ctx.quadraticCurveTo(0, -11 + bob, -5, -9 + bob); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#1c2a1c'; ctx.fillRect(-5, -6.6 + bob, 10, 1.6);
        ctx.fillStyle = '#ffe27a';
        /* Stern */
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI / 2 + i * TAU / 5;
          const ax = Math.cos(a) * 1.7, ay = -7.6 + bob + Math.sin(a) * 1.7;
          i ? ctx.lineTo(ax, ay) : ctx.moveTo(ax, ay);
          const b = a + Math.PI / 5;
          ctx.lineTo(Math.cos(b) * .7, -7.6 + bob + Math.sin(b) * .7);
        }
        ctx.closePath(); ctx.fill();
        /* Air-Force-Rundel */
        ctx.fillStyle = '#6b8ab5'; ctx.beginPath(); ctx.arc(5, -6.2 + bob, 1.8, 0, TAU); ctx.fill();
        ctx.fillStyle = '#e8eef6'; ctx.beginPath(); ctx.arc(5, -6.2 + bob, 1.2, 0, TAU); ctx.fill();
        ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.arc(5, -6.2 + bob, .55, 0, TAU); ctx.fill();
        break;
      }
      case 'hard': {
        ctx.fillStyle = '#ffcf4a';
        ctx.beginPath(); ctx.arc(0, -6 + bob, 6.6, Math.PI, 0); ctx.fill();
        ctx.fillRect(-6.6, -6.6 + bob, 13.2, 2.8);
        ctx.fillStyle = '#ffe58a'; ctx.fillRect(-6.6, -6.2 + bob, 13.2, 1.2);
        ctx.fillStyle = '#b98a1a'; ctx.fillRect(-4, -6.2 + bob, 8, 2);
        break;
      }
      case 'antenna': {
        ctx.fillStyle = '#7e97a6';
        ctx.fillRect(-5.6, -12.6 + bob, 11.2, 13);
        ctx.fillStyle = flash ? '#fff' : 'rgba(57,230,255,.95)'; ctx.fillRect(-3.8, -10 + bob, 7.6, 3.2);
        ctx.strokeStyle = '#5a7a8a'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(0, -12.6 + bob); ctx.lineTo(0, -16.5 + bob); ctx.stroke();
        ctx.fillStyle = '#ff5ce0';
        ctx.globalAlpha = .6 + .4 * Math.sin(t * 8); ctx.beginPath(); ctx.arc(0, -17.5 + bob, 1.5, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        break;
      }
      case 'rock': {
        ctx.fillStyle = '#241a2e';
        ctx.beginPath(); ctx.arc(0, -6 + bob, 6.2, Math.PI, 0); ctx.fill();
        ctx.beginPath(); ctx.arc(0, -8.5 + bob, 4.6, Math.PI * .85, Math.PI * 2.15); ctx.fill();
        for (let i = 0; i < 3; i++) {
          const p = Math.sin(this.walkT * 2 + i * 2) * 3;
          ctx.beginPath(); ctx.moveTo(-5, -3 + bob); ctx.lineTo(-9 + p, 8 + bob + i * 1.6); ctx.lineTo(-1, 5.5 + bob); ctx.closePath(); ctx.fill();
          ctx.beginPath(); ctx.moveTo(5, -3 + bob); ctx.lineTo(9 - p, 8 + bob + i * 1.6); ctx.lineTo(1, 5.5 + bob); ctx.closePath(); ctx.fill();
        }
        ctx.fillStyle = '#11152a';
        ctx.fillRect(-4.6, -7.2 + bob, 4, 2.4); ctx.fillRect(.6, -7.2 + bob, 4, 2.4); ctx.fillRect(-.6, -7.2 + bob, 1.2, 2.4);
        break;
      }
      case 'headphones': {
        ctx.strokeStyle = '#1a2340'; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(0, -6 + bob, 6.4, Math.PI * .9, Math.PI * 2.1); ctx.stroke();
        ctx.fillStyle = '#1a2340';
        ctx.beginPath(); ctx.arc(0, -9 + bob, 6.6, Math.PI, 0); ctx.fill();
        ctx.fillRect(-6.6, -9.4 + bob, 13.2, 3.2);
        ctx.fillStyle = '#59e6ff';
        ctx.beginPath(); ctx.arc(-6, -3.2 + bob, 2.7, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(6, -3.2 + bob, 2.7, 0, TAU); ctx.fill();
        ctx.fillStyle = '#0e1526'; ctx.beginPath(); ctx.arc(-6, -3.2 + bob, 1.2, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(6, -3.2 + bob, 1.2, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ff5ce0';
        ctx.globalAlpha = .6 + .4 * Math.sin(t * 9);
        ctx.beginPath(); ctx.arc(0, -11.5 + bob, 1.4, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        break;
      }
      case 'beret': {
        ctx.fillStyle = '#2b8f5a';
        ctx.beginPath(); ctx.ellipse(0, -7 + bob, 7.4, 3.4, 0, 0, TAU); ctx.fill();
        ctx.fillRect(-5, -9 + bob, 10, 2.6);
        ctx.beginPath(); ctx.moveTo(-4, -10 + bob); ctx.quadraticCurveTo(0, -14.5 + bob + sway * .5, 5, -10 + bob); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#ffe27a'; ctx.beginPath(); ctx.arc(0, -8.2 + bob, 1.3, 0, TAU); ctx.fill();
        break;
      }
      case 'flatcap': {
        ctx.fillStyle = '#8a5a2a';
        ctx.beginPath(); ctx.ellipse(0, -6.5 + bob, 7, 4, 0, Math.PI * .8, Math.PI * 2.2); ctx.fill();
        ctx.fillRect(-7, -7.5 + bob, 14, 2.8);
        ctx.beginPath(); ctx.ellipse(0, -7.5 + bob, 7, 2.2, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#b24a2b'; ctx.fillRect(1.5, -7.5 + bob, 5.5, 1.4);
        break;
      }
      case 'lockenzopf': {
        const hair = '#6b4326', hair2 = '#8f5f38', tie = '#ff5ce0';
        /* Lockenkranz — dichte, runde Locken rund um den Kopf, kein Dutt */
        ctx.fillStyle = hair;
        const curls = [[-5.5, -6.4, 2.8], [-3.5, -9.4, 3.0], [0, -10.7, 3.2], [3.5, -9.4, 3.0], [5.5, -6.4, 2.8], [-6.2, -3.4, 2.4], [6.2, -3.4, 2.4]];
        for (const cu of curls) { ctx.beginPath(); ctx.arc(cu[0] + sway * .12, cu[1] + bob, cu[2], 0, TAU); ctx.fill(); }
        ctx.fillStyle = hair2;
        for (let i = 0; i < 5; i++) {
          const a = Math.PI + i * (Math.PI / 4.2) + Math.sin(t * 1.6 + i) * .05;
          ctx.beginPath(); ctx.arc(Math.cos(a) * 4.8, -6.8 + bob + Math.sin(a) * 3.6, 1.55, 0, TAU); ctx.fill();
        }
        /* Zopf — geflochten, fällt seitlich nach hinten und schwingt beim Laufen */
        const bx = -6.4 + sway * .45;
        ctx.fillStyle = hair;
        ctx.beginPath(); ctx.arc(bx, -1.6 + bob, 2.6, 0, TAU); ctx.fill();
        for (let i = 0; i < 3; i++) {
          const px = bx - 1.2 - i * 1.0 + Math.sin(this.walkT * 2 + i * .9) * .85;
          const py = 1.4 + bob + i * 3.0;
          ctx.fillStyle = i % 2 ? hair2 : hair;
          ctx.beginPath(); ctx.ellipse(px, py, 2.35 - i * .38, 2.05 - i * .3, .32, 0, TAU); ctx.fill();
        }
        ctx.fillStyle = tie;
        ctx.fillRect(bx - 4.4 + Math.sin(this.walkT * 2 + 1.8) * .85, 9.1 + bob, 3.2, 1.4);
        /* Brille — runde Gläser mit Steg und Bügeln */
        ctx.fillStyle = 'rgba(196,236,255,.55)';
        ctx.strokeStyle = '#1c2233'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(-2.5, -5.4 + bob, 2.55, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(2.5, -5.4 + bob, 2.55, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-.6, -5.8 + bob); ctx.lineTo(.6, -5.8 + bob); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-5.0, -5.9 + bob); ctx.lineTo(-6.4, -6.6 + bob); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(5.0, -5.9 + bob); ctx.lineTo(6.4, -6.6 + bob); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.6)';
        ctx.fillRect(-3.5, -6.6 + bob, 1.3, 1); ctx.fillRect(1.5, -6.6 + bob, 1.3, 1);
        break;
      }
      case 'gasmask': {
        ctx.fillStyle = '#5a6a4a';
        ctx.fillRect(-6.4, -9.4 + bob, 12.8, 8.4);
        ctx.beginPath(); ctx.arc(0, -6 + bob, 6.4, Math.PI, 0); ctx.fill();
        ctx.fillStyle = '#3a4a2a'; ctx.fillRect(-3.4, -10 + bob, 6.8, 2);
        ctx.fillStyle = 'rgba(255,210,80,.85)'; ctx.fillRect(-5.2, -6.6 + bob, 3.4, 2.4); ctx.fillRect(1.8, -6.6 + bob, 3.4, 2.4);
        ctx.fillStyle = '#2a3a1a'; ctx.fillRect(-2.4, -3.4 + bob, 4.8, 1.6);
        ctx.strokeStyle = '#8a9a6a'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(-5, -9 + bob); ctx.lineTo(-8, -13 + bob); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(5, -9 + bob); ctx.lineTo(8, -13 + bob); ctx.stroke();
        break;
      }
    }
  }
}

function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; }

class Turret {
  constructor(owner) {
    this.owner = owner; this.x = owner.x + rnd(-40, 40); this.y = owner.y + rnd(-40, 40);
    this.cd = 0; this.temp = 0; this.dead = false; this.angle = 0; this.hp = 100;
  }
  update(dt) {
    if (this.temp > 0) { this.temp -= dt; if (this.temp <= 0) { this.dead = true; const i = this.owner.turrets.indexOf(this); if (i >= 0) this.owner.turrets.splice(i, 1); return; } }
    this.cd -= dt;
    const eng = this.owner.st.eng;
    const range = 340 * (1 + this.owner.st.range / 100);
    const t = Game.nearestEnemy(this.x, this.y, range);
    if (t) {
      this.angle = Math.atan2(t.y - this.y, t.x - this.x);
      if (this.cd <= 0) {
        this.cd = .55 / (1 + this.owner.st.atkSpd / 100);
        const dmg = (5 + eng * 1.0) * (1 + this.owner.st.dmgP / 100);
        Game.spawnProjectile({
          x: this.x, y: this.y, angle: this.angle, speed: 520, dmg, owner: this.owner,
          col: '#ffb24a', life: range / 520, r: 4, source: 'turret', critC: this.owner.st.crit / 100, critM: 1.6
        });
        AudioSys.sfx('shoot'); AudioSys.sfx('drone');
      }
    }
    const d = dist(this.x, this.y, this.owner.x, this.owner.y);
    if (d > 420) { this.x = lerp(this.x, this.owner.x, .04); this.y = lerp(this.y, this.owner.y, .04); }
  }
  draw(ctx) {
    ctx.save(); ctx.translate(this.x, this.y);
    ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.ellipse(0, 6, 12, 5, 0, 0, TAU); ctx.fill();
    ctx.rotate(this.angle);
    ctx.fillStyle = '#8a5a1a'; ctx.fillRect(-9, -9, 18, 18);
    ctx.fillStyle = '#ffb24a'; ctx.fillRect(-6, -6, 12, 12); ctx.fillRect(4, -2, 12, 4);
    ctx.restore();
    if (this.temp > 0) {
      ctx.fillStyle = 'rgba(255,178,74,.8)'; ctx.fillRect(this.x - 10, this.y - 15, 20 * clamp(this.temp / 16, 0, 1), 2);
    }
  }
}

class Enemy {
  constructor() { this.dead = true; }
  spawn(def, x, y, wave, boss) {
    const D = DANGERS[Game.danger];
    this.def = def; this.x = x; this.y = y; this.vx = 0; this.vy = 0; this.dead = false;
    this.boss = boss || null;
    const waveScale = Math.pow(1.20, wave - 1);
    this.maxHp = (boss ? boss.hp : def.hp * waveScale) * D.hp * (Game.coop ? 1.55 : 1);
    this.hp = this.maxHp;
    this.r = boss ? boss.r : def.r;
    this.spd = (boss ? boss.spd : def.spd) * D.spd * (1 + Math.min(.35, wave * .012)) * (Game.wagerActive('hast') ? 1.25 : 1);
    this.dmg = (boss ? boss.dmg : def.dmg) * D.dmg * (1 + wave * .05);
    this.armor = (boss ? boss.armor : (def.armor || 0)) + Math.floor(wave / 6);
    this.col = boss ? boss.col : def.col;
    this.xp = boss ? boss.xp : def.xp; this.mat = boss ? boss.mat : def.mat;
    this.shotCd = rnd(.4, 1.6); this.healCd = rnd(.5, 1.5); this.summonCd = rnd(1, 3);
    this.state = 'idle'; this.chargeT = 0; this.stun = 0; this.slow = 0; this.slowT = 0;
    this.burn = 0; this.burnT = 0; this.poison = 0; this.poisonT = 0; this.marked = 0;
    this.freeze = 0; this.freezeT = 0; this.shockT = 0; this.reactionCd = 0;
    this.hitFlash = 0; this.phaseIdx = 0; this.attackCd = 1; this.spiralA = 0; this.wobble = rnd(TAU);
    this.armorBuff = 0; this.target = null; this.knockVx = 0; this.knockVy = 0; this.contactCd = 0;
    this.advice = 0; this.charmT = 0; this.charmSrc = null; this.buffT = 0; this.spdMul = 1; this.latched = false; this.railT = 0; this.railDir = 0; this.coreOpen = false; this.introHold = 0; this.squash = 0; this.squashAng = 0; this.lastHitWeapon = null; this.packT = rnd(.2, .8); this.packing = !!(def && def.pack);
    this.blinkT = 0; this.splitTier = 0; this.shieldHit = 0;
    this.elite = false; this.deathHandled = false;
    this.eState = 'approach'; this.eT = 0; this.eDir = 1;
    this.squash = 0; this.eliteTrait = null; this.traitCd = 0; this.warned = false;
    this.spawnScale = 0;
    this.deathAnim = 0; this.deathMax = .28;
    this._pullCounted = false; this._vortexCounted = false;
    return this;
  }
  makeElite() {
    this.elite = true; this.maxHp *= 2.4; this.hp = this.maxHp; this.r *= 1.25; this.dmg *= 1.35;
    this.mat = Math.ceil(this.mat * 2.5); this.xp = Math.ceil(this.xp * 2.2); this.armor += 5;
    const T = ['blitz', 'panzer', 'heiler', 'aggressiv', 'schnell', 'magnetisch', 'giftig', 'brennend', 'spiegelnd'];
    this.eliteTrait = pick(T);
    if (this.eliteTrait === 'panzer') this.armor += 6;
    else if (this.eliteTrait === 'aggressiv') this.dmg *= 1.3;
    else if (this.eliteTrait === 'schnell') this.spd *= 1.3;
    else if (this.eliteTrait === 'giftig') this.maxHp *= 1.15, this.hp = this.maxHp;
    else if (this.eliteTrait === 'brennend') this.dmg *= 1.15;
    else if (this.eliteTrait === 'spiegelnd') this.armor += 3;
    this.traitCd = rnd(1, 2.5);
  }
  applySlow(amount, time) { if (amount > this.slow || this.slowT < time) { this.slow = Math.max(this.slow, amount); this.slowT = Math.max(this.slowT, time); } }
  applyBurn(dps, t) { this.burn = Math.max(this.burn, dps); this.burnT = Math.max(this.burnT, t); }
  applyPoison(dps, t) { this.poison = Math.max(this.poison, dps); this.poisonT = Math.max(this.poisonT, t); }
  applyElement(elem, strength, src) { Combat.applyElement(this, elem, strength, src); }
  clearStatuses() { this.burn = 0; this.burnT = 0; this.poison = 0; this.poisonT = 0; this.slow = 0; this.slowT = 0; this.stun = 0; this.freeze = 0; this.freezeT = 0; this.shockT = 0; }
  knockback(angle, force) {
    if (this.def && this.def.noKnock) return;
    const f = force * (this.boss ? .12 : 1) * (this.elite ? .5 : 1);
    this.knockVx += Math.cos(angle) * f; this.knockVy += Math.sin(angle) * f;
  }
  hurt(dmg, isCrit, src, type, armorPierce, weapon) { return Combat.applyHit({ tgt: this, dmg, isCrit, src, type, armorPierce, weapon }); }
  die(src, type) {
    if (this.dead || this.deathHandled) return;
    if (type === 'melee') Game.contractProgress('meleeKill', 1);
    else if (type === 'boom') Game.contractProgress('boomKill', 1);
    else if (type === 'elem') Game.contractProgress('elemKill', 1);
    if (this.elite) Game.contractProgress('eliteKill', 1);
    this.deathHandled = true; this.dead = true; this.deathAnim = this.deathMax;
    if (this.boss) FX.shockwave(this.x, this.y, this.r * 2, this.col);
    const n = 7 + Math.floor(this.r * .4);
    for (let i = 0; i < n; i++) FX.shard(this.x, this.y, crnd(TAU), crnd(50, 300), this.col, crnd(.3, .75), crnd(3, 6));
    /* Zerplatzen: Fleischbrocken, Spritzer und Bodenfleck */
    FX.mud(this.x, this.y, crnd(TAU), this.boss ? 2.2 : 1.5);
    FX.debris(this.x, this.y, this.boss ? 12 : 4 + Math.floor(this.r * .2), shade(this.col, -.3), 260);
    FX.splashDrops(this.x, this.y, rnd(TAU), this.boss ? 16 : 7, shade(this.col, -.15));
    FX.ripple(this.x, this.y, this.r * (this.boss ? 5 : 2.6), this.col, .3);
    if (this.boss) for (let i = 0; i < 18; i++) FX.shard(this.x, this.y, crnd(TAU), crnd(120, 420), this.col, crnd(.5, 1.1), crnd(5, 9));
    if (OPT().particles > 0) FX.pixelBurst(this.x, this.y, this.col, this.boss ? 26 : 10 + Math.floor(this.r * .6), this.boss ? 240 : 150);
    AudioSys.sfxAt('shard', this.x, this.y);
    if (!this.boss && this.def.split && (this.splitTier || 0) < this.def.split.depth) {
      const child = ENEMY_BY_ID[this.def.split.id];
      for (let i = 0; i < this.def.split.n; i++) {
        const e = Game.spawnEnemyAt(child, this.x + rnd(-16, 16), this.y + rnd(-16, 16));
        if (e) { e.splitTier = (this.splitTier || 0) + 1; e.hp = Math.max(1, e.maxHp * .5); }
      }
    }
    const R = Game.run;
    R.kills++; Save.data.totalKills++; Save.prog('kills', 1);
    Game.combo++; Game.comboT = 2.5; Game.contractProgress('combo', Game.combo);
    if (this.lastHitWeapon) Game.addMasteryKill(this.lastHitWeapon);
    if (Game.run.track.maxCombo < Game.combo) Game.run.track.maxCombo = Game.combo;
    if (src && src.stats) src.stats.kills++;
    /* Kill-EP: jeder Abschuss bringt Erfahrung, Elite/Bosse deutlich mehr */
    if (this.xp > 0) {
      for (const q of Game.players) {
        if (!q.alive) continue;
        q.xp += this.xp * (1 + q.st.xpGain / 100);
        while (q.xp >= q.xpNext) { q.xp -= q.xpNext; q.level++; q.xpNext = q.xpFor(q.level); q.pendingLevels++; q.recalc(); }
      }
    }
    if (Game.level && Game.level.decals && Game.level.decals.length < 260) {
      Game.level.decals.push({ x: this.x, y: this.y, r: this.boss ? this.r * 2.6 : this.r * (1 + crnd(.2, .9)), c: this.boss ? this.col : shade(this.col, -.25), kind: 'blood', rot: crnd(TAU), t: 0, life: this.boss ? 14 : crnd(5, 9) });
      if (Math.random() < .4) Game.level.decals.push({ x: this.x + crnd(-this.r, this.r), y: this.y + crnd(-this.r, this.r), r: this.r * crnd(.3, .7), c: 'rgba(20,8,8,.35)', t: 0, life: crnd(4, 7) });
    }
    if (this.elite || this.boss) { Game.hitstop = Math.max(Game.hitstop, this.boss ? .15 : .12); Game.timeScale = Math.min(Game.timeScale, this.boss ? .25 : .3); Game.feedback(this.x, this.y, 'gross'); }
    if (Game.modActive('blutmond')) {
      const near = Game.hash.query(this.x, this.y, 260, Game._tmp3);
      for (const o of near) if (!o.dead && !o.boss) o.hp = Math.min(o.maxHp, o.hp + o.maxHp * .02);
    }
    if (type === 'burn') { Save.prog('burnKills', 1); R.track.burnKills++; }
    if (type === 'poison') { Save.prog('poisonKills', 1); R.track.poisonKills++; }
    if (type === 'boom') { Save.prog('boomKills', 1); R.track.boomKills++; }
    if (this.def.ai === 'exploder' && !this.boss) {
      const br = this.def.boom.r;
      FX.explosion(this.x, this.y, br, '#ff2e88');
      for (const p of Game.players) if (p.alive && dist(p.x, p.y, this.x, this.y) < br) p.damage(this.def.boom.dmg * DANGERS[Game.danger].dmg, 0);
      Game.explosionImpulse(this.x, this.y, br, 340);
      AudioSys.sfx('boom');
    }
    const comboMult = 1 + Math.min(Game.combo, 50) * .02;
    const relicMult = (src && src.matMult) ? src.matMult() : 1;
    /* NG+-Wirtschaft: Ab Gefahr 4 steigt der Materialertrag (+15% je Stufe),
       damit die Upgrade-Wirtschaft mit den wachsenden Gegner-LP mithalten kann.
       Vorher wurde der Ertrag bei Gefahr 4+ reduziert — bei gedeckelten Preisen
       (DANGER_PRICE_CAP 1.8) und bis zu 7x Gegner-LP lief die Ökonomie ins Leere. */
    const matDangerFactor = Game.danger >= 4 ? 1 + (Game.danger - 3) * .15 : 1;
    const mats = Math.max(1, Math.round(this.mat * matDangerFactor * (Game.modActive && Game.modActive('materialhagel') ? 1.4 : 1) * comboMult * relicMult));
    for (let i = 0; i < Math.min(mats, 12); i++)
      Game.spawnMaterial(this.x + rnd(-14, 14), this.y + rnd(-14, 14), Math.ceil(mats / Math.min(mats, 12)));
    if (RAND() < .012 + (src ? src.st.luck : 0) * .0004) Game.spawnPowerup(this.x, this.y);
    if (this.boss) Game.spawnRune(this.x, this.y);
    else if (RAND() < .003 + (src ? src.st.luck : 0) * .0002) Game.spawnRune(this.x, this.y);
    if (this.boss) { if (RAND() < .3) Game.spawnPetDrop(this.x, this.y); }
    else if (this.elite && RAND() < .03) Game.spawnPetDrop(this.x, this.y);
    else if (RAND() < .0008 + (src ? src.st.luck : 0) * .00005) Game.spawnPetDrop(this.x, this.y);
    if (this.boss) {
      Save.prog('bosses', 1); R.bosses++;
      FX.explosion(this.x, this.y, 220, this.col); Game.feedback(null, null, 'gross');
      AudioSys.sfx('boom'); UI.banner(this.boss.name + ' BESIEGT', 2.2);
      for (let i = 0; i < 26; i++) Game.spawnMaterial(this.x + rnd(-80, 80), this.y + rnd(-80, 80), 4);
    } else {
      FX.explosion(this.x, this.y, this.r * 2.2, this.col, .5);
    }
    AudioSys.sfxAt('kill', this.x, this.y);
  }
  update(dt) {
    if (this.dead) {
      if (this.deathAnim > 0) { this.deathAnim -= dt; if (this.deathAnim < 0) this.deathAnim = 0; }
      return;
    }
    if (this.spawnScale < 1) this.spawnScale = Math.min(1, this.spawnScale + dt / .26);
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    if (this.squash > 0) this.squash = Math.max(0, this.squash - dt * 3.2);
    /* Leerlauf-Laute: nur in Hörweite, mit Abstandsdämpfung und Panorama */
    if (this.buffT > 0) { this.buffT -= dt; if (this.buffT <= 0) { this.buffT = 0; this.spdMul = 1; } }
    this.voxT = (this.voxT || rnd(1, 7)) - dt;
    if (this.voxT <= 0) {
      this.voxT = rnd(this.boss ? 2.4 : 4.5, this.boss ? 5 : 12);
      if (RAND() < (this.boss ? .85 : .4) && Game.enemies.length < 90)
        AudioSys.sfxAt(this.boss ? 'e_roar' : enemyVox(this.def), this.x, this.y, this.boss ? 1 : .8);
    }
    this.marked = Math.max(0, this.marked - dt);
    this.contactCd = Math.max(0, this.contactCd - dt);
    if (this.shieldHit > 0) this.shieldHit -= dt;
    this.armorBuff = 0;
    if (this.stun > 0) { this.stun -= dt; }
    if (this.slowT > 0) { this.slowT -= dt; if (this.slowT <= 0) this.slow = 0; }
    if (this.freezeT > 0) { this.freezeT -= dt; if (this.freezeT <= 0) this.freeze = 0; }
    if (this.shockT > 0) {
      this.shockT -= dt;
      if (Math.random() < dt * 7) FX.spark(this.x, this.y, crnd(TAU), '#ffe27a');
    }
    if (this.reactionCd > 0) this.reactionCd -= dt;
    if (Combat.tickStatus(this, dt)) return;
    /* --- Ratschlag-Stapel: überzeugte Gegner wechseln kurz die Seiten --- */
    if (this.charmT > 0) {
      this.charmT -= dt;
      if (Math.random() < dt * 9) FX.px(this.x + crnd(-this.r, this.r), this.y - crnd(0, this.r), Math.random() < .5 ? '#ffd24a' : '#ffffff', crnd(1.4, 2.6), .35, { glow: 1, gy: -30 });
      if (this.charmT <= 0) { this.charmT = 0; this.advice = 0; FX.ripple(this.x, this.y, this.r * 3, '#8a5cff', .3); }
    }
    let tgt;
    if (this.charmT > 0) {
      tgt = Game.nearestEnemyTo(this.x, this.y, this);
      if (!tgt) tgt = Game.nearestPlayer(this.x, this.y);
    } else tgt = Game.nearestPlayer(this.x, this.y);
    this.target = tgt;
    let sp = this.spd * (1 - this.slow) * (this.stun > 0 ? 0 : 1) * (this.freezeT > 0 ? 0 : 1) * (this.spdMul || 1) * (this.spawnScale < .5 ? 0 : 1);
    if (tgt) {
      let ang = Math.atan2(tgt.y - this.y, tgt.x - this.x);
      const d = dist(this.x, this.y, tgt.x, tgt.y);
      /* Sichtpruefung gestaffelt statt pro Bild: rayHit laeuft ueber alle
         Waende, das mal Gegnerzahl mal 60 Hz waere teuer. Der Zufallsanteil
         verteilt die Pruefungen ueber die Bilder. */
      if (!this.def.fly && !this.boss) {
        this._losT = (this._losT || 0) - dt;
        if (this._losT <= 0) {
          this._losT = .16 + Math.random() * .12;
          this._blocked = !Game.level.losClear(this.x, this.y, tgt.x, tgt.y);
        }
        if (this._blocked) {
          const fa = Game.flow.dirAt(this.x, this.y);
          if (fa !== null) ang = fa;
        }
      }
      if (this.boss) this.bossAI(dt, tgt, ang, d, sp);
      /* Nahkampf-Eliten kaempfen taktisch; Schuetzen behalten ihr Distanzverhalten. */
      else if (this.elite && this.def.ai !== 'ranged' && this.def.ai !== 'exploder') this.eliteAI(dt, tgt, ang, d, sp);
      else switch (this.def.ai) {
        case 'chase': {
          /* Rudelverhalten: sammeln, auf Artgenossen warten, gemeinsam stürmen */
          if (this.def.pack) {
            this.packT -= dt;
            if (!this.packing && d > 130 && this.packT <= 0) {
              const near = Game.hash.query(this.x, this.y, 240, Game._tmp)
                .filter(e => !e.dead && e !== this && e.def.pack).length;
              if (near >= 1) { this.packing = true; this.packT = rnd(.5, 1.0); }
              else this.packT = .4;
            }
            if (this.packing) {
              this.packT -= dt;
              /* Sammeln: langsam seitlich versetzt heranrücken */
              this.moveTo(ang + Math.PI * .42 * (this.wobble > Math.PI ? 1 : -1), sp * .45, dt);
              if (Math.random() < dt * 5) FX.px(this.x, this.y - this.r, this.col, 2, .3, { glow: 1, gy: -30 });
              if (this.packT <= 0) {
                this.packing = false; this.packT = rnd(3.5, 6);
                this.spdMul = 1.75; this.buffT = 1.6;
                FX.ripple(this.x, this.y, this.r * 3, this.col, .3);
                if (Math.random() < .25) AudioSys.sfxAt(enemyVox(this.def), this.x, this.y, 1.1);
              }
              break;
            }
          }
          this.moveTo(ang, sp, dt);
          break;
        }
        case 'orbit': {
          const ideal = 130; const off = d > ideal ? 0 : Math.PI * .5;
          this.moveTo(ang + off + Math.sin(Game.time * 1.5 + this.wobble) * .4, sp, dt); break;
        }
        case 'ranged': {
          const keep = this.def.shot.range * .7;
          if (d > keep) this.moveTo(ang, sp, dt); else if (d < keep * .6) this.moveTo(ang + Math.PI, sp * .8, dt);
          else this.moveTo(ang + Math.PI / 2, sp * .5, dt);
          this.shotCd -= dt;
          if (this.shotCd <= 0 && d < this.def.shot.range && this.stun <= 0) {
            this.shotCd = this.def.shot.cd * rnd(.85, 1.15);
            Game.spawnEnemyBullet(this.x, this.y, ang, this.def.shot.spd, this.def.shot.dmg * DANGERS[Game.danger].dmg * (1 + Game.wave * .04), this.def.shot.col, this.def.shot.poison || 0, this.boss ? this.boss.name : (this.def.name || this.def.id));
            AudioSys.sfxAt('e_shot', this.x, this.y);
          }
          break;
        }
        case 'exploder': this.moveTo(ang, sp * 1.05, dt); if (d < this.r + 26) this.die(null, 'self'); break;
        case 'charger': {
          this.chargeT -= dt;
          if (this.state === 'charge') {
            this.x += Math.cos(this.chargeA) * sp * 3.4 * dt; this.y += Math.sin(this.chargeA) * sp * 3.4 * dt;
            FX.particle(this.x, this.y, crnd(TAU), crnd(10, 40), this.col, .25, 2);
            if (this.chargeT <= 0) { this.state = 'idle'; this.chargeT = rnd(1.4, 2.4); }
          } else {
            this.moveTo(ang, sp, dt);
            if (this.chargeT <= 0 && d < 420) { this.state = 'charge'; this.chargeA = ang; this.chargeT = .75; AudioSys.sfxAt('e_charge', this.x, this.y); }
          }
          break;
        }
        case 'healer': {
          this.moveTo(ang + Math.PI * .7, sp, dt);
          this.healCd -= dt;
          if (this.healCd <= 0) {
            this.healCd = this.def.heal.cd;
            const list = Game.hash.query(this.x, this.y, this.def.heal.r, Game._tmp);
            let healed = 0;
            for (const e of list) if (!e.dead && e !== this && e.hp < e.maxHp && dist(e.x, e.y, this.x, this.y) < this.def.heal.r) {
              e.hp = Math.min(e.maxHp, e.hp + this.def.heal.amt * (1 + Game.wave * .1)); healed++;
              FX.line(this.x, this.y, e.x, e.y, '#8affb0', .22);
            }
            if (healed) { FX.number(this.x, this.y - 20, '+HEAL', '#8affb0', .7); AudioSys.sfxAt('e_heal', this.x, this.y); }
          }
          break;
        }
        case 'aura': {
          this.moveTo(ang, sp, dt);
          const list = Game.hash.query(this.x, this.y, this.def.aura.r, Game._tmp);
          for (const e of list) if (!e.dead && e !== this && dist(e.x, e.y, this.x, this.y) < this.def.aura.r) e.armorBuff = Math.max(e.armorBuff, this.def.aura.armor);
          break;
        }
        case 'summoner': {
          if (d < 300) this.moveTo(ang + Math.PI, sp, dt); else this.moveTo(ang, sp * .7, dt);
          this.summonCd -= dt;
          if (this.summonCd <= 0) {
            this.summonCd = this.def.summon.cd;
            for (let i = 0; i < this.def.summon.n; i++)
              Game.spawnEnemyAt(ENEMY_BY_ID[this.def.summon.id], this.x + rnd(-40, 40), this.y + rnd(-40, 40));
            FX.shockwave(this.x, this.y, 70, '#a06bff');
            AudioSys.sfxAt('e_summon', this.x, this.y);
          }
          break;
        }
        case 'shielded': {
          this.moveTo(ang, sp, dt);
          break;
        }
        case 'spiral': {
          /* Kreisel: schraubt sich heran und feuert radiale Salven */
          this.spiralA += dt * 2.2;
          const ideal = 190;
          const inward = d > ideal ? .55 : d < ideal * .6 ? -.5 : 0;
          this.moveTo(ang + Math.PI * .5 - inward, sp, dt);
          this.shotCd -= dt;
          if (this.shotCd <= 0 && this.stun <= 0) {
            this.shotCd = this.def.shot.cd * rnd(.9, 1.1);
            const n = this.def.radial || 6;
            for (let i = 0; i < n; i++) {
              const a2 = this.spiralA + i / n * TAU;
              Game.spawnEnemyBullet(this.x + Math.cos(a2) * this.r, this.y + Math.sin(a2) * this.r, a2, this.def.shot.spd,
                this.def.shot.dmg * DANGERS[Game.danger].dmg * (1 + Game.wave * .04), this.def.shot.col, 0, this.def.name);
            }
            FX.ripple(this.x, this.y, this.r * 3.4, this.def.col, .3);
            AudioSys.sfxAt('e_shot', this.x, this.y);
          }
          break;
        }
        case 'mortar': {
          /* Mörser: hält Abstand und wirft Granaten mit angekündigtem Einschlag */
          const L = this.def.lob;
          if (d < L.range * .55) this.moveTo(ang + Math.PI, sp, dt);
          else if (d > L.range * .9) this.moveTo(ang, sp, dt);
          else this.moveTo(ang + Math.PI / 2, sp * .5, dt);
          this.shotCd -= dt;
          if (this.shotCd <= 0 && d < L.range && this.stun <= 0) {
            this.shotCd = L.cd * rnd(.85, 1.15);
            const tx = tgt.x + rnd(-30, 30), ty = tgt.y + rnd(-30, 30);
            Game.spawnMortar(this.x, this.y, tx, ty, L, this.def.name);
            AudioSys.sfxAt('e_charge', this.x, this.y, .7);
          }
          break;
        }
        case 'weaver': {
          /* Weber: schneller Zickzack, hinterlässt bremsende Netze */
          this.moveTo(ang + Math.sin(Game.time * 6 + this.wobble) * .75, sp, dt);
          this.healCd -= dt;
          if (this.healCd <= 0) {
            this.healCd = this.def.web.cd;
            Game.spawnWeb(this.x, this.y, this.def.web);
          }
          break;
        }
        case 'sentinel': {
          /* Wächter: steht fast still und feuert einen angekündigten Strahl */
          const B = this.def.beam;
          if (d > B.range) this.moveTo(ang, sp, dt);
          this.shotCd -= dt;
          if (this.state === 'aim') {
            this.chargeA += angDiff(ang, this.chargeA) * clamp(dt * 1.6, 0, 1);
            if (this.shotCd <= 0) {
              this.state = 'idle'; this.shotCd = B.cd * rnd(.85, 1.15);
              const ex = this.x + Math.cos(this.chargeA) * B.range, ey = this.y + Math.sin(this.chargeA) * B.range;
              FX.beam(this.x, this.y, ex, ey, this.def.col, 12);
              FX.bolt(this.x, this.y, ex, ey, '#ffffff', 7, 4);
              FX.light(this.x, this.y, 200, this.def.col, .2, 1);
              AudioSys.sfxAt('w_railgun', this.x, this.y, .8);
              for (const pl of Game.players) {
                if (!pl.alive) continue;
                const rel = Math.atan2(pl.y - this.y, pl.x - this.x);
                const dd = dist(pl.x, pl.y, this.x, this.y);
                if (dd < B.range && Math.abs(angDiff(rel, this.chargeA)) < Math.atan2(B.w, Math.max(20, dd)))
                  pl.damage(B.dmg * DANGERS[Game.danger].dmg, this.chargeA);
              }
            }
          } else if (this.shotCd <= 0 && d < B.range && this.stun <= 0) {
            this.state = 'aim'; this.chargeA = ang; this.shotCd = B.warn;
            AudioSys.sfxAt('telegraph', this.x, this.y, .8);
          }
          break;
        }
        case 'leech': {
          /* Blutegel: heftet sich an und saugt Leben ab */
          if (this.state === 'latch' && d < this.r + tgt.r + 12) {
            this.x += (tgt.x - this.x) * clamp(dt * 9, 0, 1);
            this.y += (tgt.y - this.y) * clamp(dt * 9, 0, 1);
            this.chargeT -= dt;
            this.attackCd -= dt;
            if (this.attackCd <= 0) {
              this.attackCd = .5;
              const dmgAmt = this.def.drain.dps * .5 * DANGERS[Game.danger].dmg;
              /* Überzeugte Blutegel saugen an Gegnern statt an Spielern */
              if (typeof tgt.damage === 'function') tgt.damage(dmgAmt, ang + Math.PI);
              else if (typeof tgt.hurt === 'function') tgt.hurt(dmgAmt * 2, false, Game.players[0], 'melee');
              this.hp = Math.min(this.maxHp, this.hp + this.def.drain.dps * this.def.drain.heal * .5);
              FX.line(this.x, this.y, tgt.x, tgt.y, '#ff2e88', .2);
              FX.splashDrops(this.x, this.y, ang, 3, '#a8324e');
            }
            if (this.chargeT <= 0) { this.state = 'idle'; this.shotCd = this.def.drain.cd; }
          } else {
            this.moveTo(ang, sp, dt);
            this.shotCd -= dt;
            if (this.shotCd <= 0 && d < this.r + tgt.r + 24) { this.state = 'latch'; this.chargeT = 2.2; AudioSys.sfxAt('e_chitter', this.x, this.y); }
          }
          break;
        }
        case 'bomber': {
          /* Bomberdrohne: überfliegt und wirft Haftminen ab */
          const keep = 210;
          if (d > keep) this.moveTo(ang, sp, dt);
          else this.moveTo(ang + Math.PI * .5 + Math.sin(Game.time * 1.2 + this.wobble) * .5, sp, dt);
          this.summonCd -= dt;
          if (this.summonCd <= 0 && d < 420) {
            this.summonCd = this.def.mine.cd * rnd(.85, 1.15);
            Game.spawnMine(this.x, this.y, this.def.mine, this.def.name);
            AudioSys.sfxAt('tick', this.x, this.y, .8);
          }
          break;
        }
        case 'mirror': {
          /* Spiegelgänger: spiegelt die Bewegung des Ziels und wirft Schüsse zurück */
          const mx = tgt.lastMx || 0, my = tgt.lastMy || 0;
          if (Math.abs(mx) + Math.abs(my) > .05 && d > 90) this.moveTo(Math.atan2(-my, -mx) + Math.PI, sp, dt);
          else this.moveTo(ang, sp * .9, dt);
          if (Math.random() < dt * 3) FX.px(this.x + crnd(-this.r, this.r), this.y + crnd(-this.r, this.r), '#ffffff', 2, .3, { glow: 1 });
          break;
        }
        case 'juggernaut': {
          /* Kolosswache: unaufhaltsam, stampft in regelmäßigen Abständen */
          this.moveTo(ang, sp, dt);
          this.traitCd -= dt;
          if (this.state === 'slam') {
            this.chargeT -= dt;
            if (this.chargeT <= 0) {
              this.state = 'idle';
              const S = this.def.slam;
              FX.shockwave(this.x, this.y, S.r, '#c0c8d8');
              FX.explosion(this.x, this.y, S.r * .5, '#9fb4d8');
              Game.feedback(this.x, this.y, 'mittel');
              AudioSys.sfxAt('boom', this.x, this.y);
              for (const pl of Game.players) if (pl.alive && dist(pl.x, pl.y, this.x, this.y) < S.r)
                pl.damage(S.dmg * DANGERS[Game.danger].dmg, Math.atan2(pl.y - this.y, pl.x - this.x));
            }
          } else if (this.traitCd <= 0 && d < this.def.slam.r * 1.1) {
            this.state = 'slam'; this.chargeT = this.def.slam.warn; this.traitCd = this.def.slam.cd;
            FX.telegraph(this.x, this.y, this.def.slam.r, '#ff8a5c', this.def.slam.warn, 'dot', this.def.slam.r);
            AudioSys.sfxAt('telegraph', this.x, this.y);
          }
          break;
        }
        case 'siren': {
          /* Sirene: hält Abstand, peitscht Verbündete auf und stört Fähigkeiten */
          if (d < 260) this.moveTo(ang + Math.PI, sp, dt); else this.moveTo(ang, sp * .8, dt);
          this.summonCd -= dt;
          if (this.summonCd <= 0) {
            const W = this.def.wail;
            this.summonCd = W.cd;
            FX.shockwave(this.x, this.y, W.r, '#ff5ce0');
            FX.ripple(this.x, this.y, W.r * 1.2, '#ffffff', .5);
            AudioSys.sfxAt('e_screech', this.x, this.y, 1.2);
            const list = Game.hash.query(this.x, this.y, W.r, Game._tmp);
            for (const e of list) if (!e.dead && e !== this && dist(e.x, e.y, this.x, this.y) < W.r) {
              e.spdMul = W.spd; e.buffT = W.dur;
              FX.px(e.x, e.y - e.r, '#ff5ce0', 3, .5, { glow: 1, gy: -40 });
            }
            for (const pl of Game.players) if (pl.alive && dist(pl.x, pl.y, this.x, this.y) < W.r) {
              pl.abilityCd += W.cdPenalty;
              FX.number(pl.x, pl.y - 30, 'GESTÖRT', '#ff5ce0', .9);
            }
          }
          break;
        }
        case 'teleport': {
          this.blinkT -= dt;
          if (this.blinkT <= 0 && d > this.def.blink.min && d < 900) {
            this.blinkT = this.def.blink.cd * rnd(.85, 1.2);
            const nb = this.def.blink;
            const da = rnd(TAU);
            const nx = this.x + Math.cos(da) * rnd(nb.min, nb.max), ny = this.y + Math.sin(da) * rnd(nb.min, nb.max);
            FX.shockwave(this.x, this.y, 60, '#c7a6ff');
            this.x = nx; this.y = ny;
            Game.level.clampWorld(this);
            FX.shockwave(this.x, this.y, 60, '#c7a6ff');
            AudioSys.sfx('blink');
          } else this.moveTo(ang, sp, dt);
          break;
        }
      }
      if (this.eliteTrait === 'blitz') {
        this.traitCd -= dt;
        if (tgt && this.traitCd <= 0 && dist(this.x, this.y, tgt.x, tgt.y) < 470) {
          this.traitCd = 2.4;
          FX.beam(this.x, this.y, tgt.x, tgt.y, '#ffe27a', 3);
          Game.spawnEnemyBullet(this.x, this.y, Math.atan2(tgt.y - this.y, tgt.x - this.x), 300, this.dmg * .9, '#ffe27a', 0, this.boss ? this.boss.name : (this.def.name || this.def.id));
          AudioSys.sfx('laser');
        }
      } else if (this.eliteTrait === 'magnetisch') {
        /* Magnetisch: zieht den Spieler langsam heran */
        this.traitCd -= dt;
        if (tgt && dist(this.x, this.y, tgt.x, tgt.y) < 330) {
          const a2 = Math.atan2(this.y - tgt.y, this.x - tgt.x);
          tgt.x += Math.cos(a2) * 52 * dt; tgt.y += Math.sin(a2) * 52 * dt;
          if (Math.random() < dt * 6) FX.px(tgt.x + crnd(-10, 10), tgt.y + crnd(-10, 10), '#c7a6ff', 2, .3, { glow: 1 });
        }
      } else if (this.eliteTrait === 'giftig') {
        /* Giftig: hinterlässt eine ätzende Spur */
        this.traitCd -= dt;
        if (this.traitCd <= 0) {
          this.traitCd = .55;
          const prevLen = Game.hazObjs.length;
          Game.spawnWeb(this.x, this.y, { r: 42, slow: .18, life: 4 });
          if (Game.hazObjs.length > prevLen) { const hz = Game.hazObjs[prevLen]; hz.poison = 5; hz.col = '#8dff5c'; }
        }
      } else if (this.eliteTrait === 'brennend') {
        /* Brennend: setzt alles in Reichweite in Brand */
        this.traitCd -= dt;
        if (Math.random() < dt * 14) FX.ember(this.x, this.y, 1, '#ff8a3d', 70);
        if (this.traitCd <= 0) {
          this.traitCd = 1.1;
          FX.ripple(this.x, this.y, this.r * 3.4, '#ff8a3d', .3);
          for (const pl of Game.players) if (pl.alive && dist(pl.x, pl.y, this.x, this.y) < this.r + 46)
            pl.damage(this.dmg * .35 * DANGERS[Game.danger].dmg, Math.atan2(pl.y - this.y, pl.x - this.x));
        }
      } else if (this.eliteTrait === 'heiler') {
        this.traitCd -= dt;
        if (this.traitCd <= 0) {
          this.traitCd = 3.2;
          const list = Game.hash.query(this.x, this.y, 190, Game._tmp);
          for (const e of list) if (!e.dead && e !== this && e.hp < e.maxHp) {
            e.hp = Math.min(e.maxHp, e.hp + 7 * (1 + Game.wave * .1));
            FX.line(this.x, this.y, e.x, e.y, '#8affb0', .22);
          }
          AudioSys.sfxAt('e_heal', this.x, this.y);
        }
      }
    }
    if (this.eliteTrait) {
      if (this.eliteTrait === 'schnell' && Math.random() < dt * 10) FX.particle(this.x, this.y, crnd(TAU), crnd(20, 60), '#39e6ff', .3, 2.5);
      else if (this.eliteTrait === 'aggressiv' && Math.random() < dt * 10) FX.particle(this.x, this.y, crnd(TAU), crnd(30, 90), '#ff8a5c', .35, 3);
      else if (this.eliteTrait === 'panzer' && Math.random() < dt * 6) FX.particle(this.x, this.y, crnd(TAU), crnd(10, 40), '#9fb4d8', .4, 2);
      else if (this.eliteTrait === 'blitz' && Math.random() < dt * 8) { const a = crnd(TAU); FX.line(this.x, this.y, this.x + Math.cos(a) * this.r * 2, this.y + Math.sin(a) * this.r * 2, '#ffe27a', .15); }
      else if (this.eliteTrait === 'heiler' && Math.random() < dt * 8) FX.particle(this.x, this.y, crnd(TAU), crnd(10, 40), '#8affb0', .45, 2.5);
      else if (this.eliteTrait === 'magnetisch' && Math.random() < dt * 8) FX.particle(this.x, this.y, crnd(TAU), crnd(20, 60), '#c7a6ff', .4, 2.2, { shape: 'pixel', glow: 1 });
      else if (this.eliteTrait === 'spiegelnd' && Math.random() < dt * 6) FX.px(this.x + crnd(-this.r, this.r), this.y + crnd(-this.r, this.r), '#bfe8ff', 2, .3, { glow: 1 });
    }
    this.x += this.knockVx * dt; this.y += this.knockVy * dt;
    this.knockVx *= Math.pow(.0008, dt); this.knockVy *= Math.pow(.0008, dt);
    if (!this.def.fly && !this.boss) Game.level.collide(this, true);
    Game.level.clampWorld(this);
    if (tgt && this.contactCd <= 0 && this.spawnScale >= .6) {
      const d = dist(this.x, this.y, tgt.x, tgt.y);
      if (this.charmT > 0 && tgt !== Game.players[0] && tgt.def && d < this.r + tgt.r && this.dmg > 0) {
        tgt.hurt(this.dmg * 1.6 + 4, RAND() < .2, Game.players[0], 'melee');
        this.contactCd = .5;
        this.knockback(Math.atan2(this.y - tgt.y, this.x - tgt.x), 90);
        FX.mud(tgt.x, tgt.y, Math.atan2(tgt.y - this.y, tgt.x - this.x), .9);
      }
      else if (d < this.r + tgt.r && this.dmg > 0 && this.charmT <= 0) { Game.lastHitBy = { name: this.boss ? this.boss.name : (this.def.name || this.def.id), t: Game.time }; Game.stealMaterial(); tgt.damage(this.dmg + (this.bossVariant === 'geifer' ? this.dmg * .35 : 0), 0); this.contactCd = .55; this.knockback(Math.atan2(this.y - tgt.y, this.x - tgt.x), 120); if (this.def.vamp) this.hp = Math.min(this.maxHp, this.hp + this.dmg * this.def.vamp); }
    }
  }
  /* Lenkung statt blossem Auseinanderdruecken: Abstand wird schon vor der
     Beruehrung gehalten (Komfortradius mit Abschwaechung), dazu ein Anteil in
     Richtung der Nachbarn. So flieszt die Horde, statt als Klumpen zu schieben. */
  moveTo(ang, sp, dt) {
    if (this.stun > 0) return;
    let sx = 0, sy = 0, ax = 0, ay = 0, nn = 0;
    const comfort = (this.r + 26) * 1.9;
    const near = Game.hash.query(this.x, this.y, comfort, Game._tmp2);
    for (let i = 0; i < near.length; i++) {
      const o = near[i]; if (o === this || o.dead) continue;
      const dx = this.x - o.x, dy = this.y - o.y, dd = dx * dx + dy * dy;
      if (dd <= 0) continue;
      const m = Math.sqrt(dd);
      const want = (this.r + o.r) * 1.35;
      if (m < want) { const f = (want - m) / want; sx += (dx / m) * f; sy += (dy / m) * f; }
      if (m < comfort) { ax += o.x; ay += o.y; nn++; }
    }
    let vx = Math.cos(ang) * sp, vy = Math.sin(ang) * sp;
    /* Zusammenhalt: leichter Zug zur Nachbarschaftsmitte - Gruppen bleiben Gruppen. */
    if (nn > 1) {
      const cx = ax / nn - this.x, cy = ay / nn - this.y, cm = Math.hypot(cx, cy) || 1;
      vx += (cx / cm) * sp * .10; vy += (cy / cm) * sp * .10;
    }
    /* Eigenes Schlingern: verhindert, dass alle exakt dieselbe Linie laufen. */
    const w = Math.sin(Game.time * 1.7 + this.wobble) * .22;
    const cw = Math.cos(w), sw = Math.sin(w);
    const rx = vx * cw - vy * sw, ry = vx * sw + vy * cw;
    this.x += (rx + sx * 62) * dt;
    this.y += (ry + sy * 62) * dt;
  }
  /* Eliten kaempfen taktisch statt stumpf vorwaerts: heran, umkreisen,
     bei schwerer Verwundung kurz zurueck und neu ansetzen. */
  eliteAI(dt, tgt, ang, d, sp) {
    const ring = 150 + (this.r * 1.5);
    this.eState = this.eState || 'approach';
    this.eT = (this.eT || 0) - dt;
    const frac = this.hp / this.maxHp;
    if (this.eState !== 'retreat' && frac < .35 && this.eT <= 0) {
      this.eState = 'retreat'; this.eT = rnd(.7, 1.1);
    }
    switch (this.eState) {
      case 'retreat':
        this.moveTo(ang + Math.PI + crnd(-.3, .3), sp * 1.05, dt);
        if (this.eT <= 0) { this.eState = 'circle'; this.eT = rnd(1.2, 2.2); this.eDir = Math.random() < .5 ? 1 : -1; }
        break;
      case 'circle':
        /* Seitlich halten und den Abstand zum Ring regeln. */
        this.moveTo(ang + this.eDir * Math.PI * .5 + (d > ring ? -.5 : d < ring * .7 ? .5 : 0), sp * .9, dt);
        if (this.eT <= 0) { this.eState = 'lunge'; this.eT = rnd(.45, .8); }
        break;
      case 'lunge':
        this.moveTo(ang, sp * 1.5, dt);
        if (this.eT <= 0 || d < this.r + 30) { this.eState = 'circle'; this.eT = rnd(1.0, 1.8); this.eDir = Math.random() < .5 ? 1 : -1; }
        break;
      default:
        this.moveTo(ang, sp, dt);
        if (d < ring) { this.eState = 'circle'; this.eT = rnd(1.0, 1.8); this.eDir = Math.random() < .5 ? 1 : -1; }
    }
  }
  bossAI(dt, tgt, ang, d, sp) {
    if (this.introHold > 0) { this.introHold -= dt; this.attackCd = Math.max(this.attackCd, .8); return; }
    const B = this.boss, frac = this.hp / this.maxHp;
    const v = this.bossVariant;
    const cdMul = v === 'wut' ? .78 : v === 'geifer' ? .85 : 1;
    const nMul = v === 'wut' ? 1.5 : v === 'geifer' ? 1.3 : 1;
    const idx = Combat.phaseIndex(this.hp, this.maxHp, B.phases);
    if (idx !== this.phaseIdx) {
      this.phaseIdx = idx; UI.banner('PHASE ' + (idx + 1), 1.4); AudioSys.sfx('boss');
      FX.shockwave(this.x, this.y, 300, this.col); Game.feedback(this.x, this.y, 'gross');
      Game.hitstop = Math.max(Game.hitstop, .15); Game.timeScale = Math.min(Game.timeScale, .3);
      for (const p of Game.players) if (p.alive) p.invuln = Math.max(p.invuln, .6);
    }
    const ph = B.phases[idx];
    this.phaseTelemetry = { index: idx, fraction: frac, pattern: ph.pattern, warning: this.attackCd > 0 && this.attackCd < .5 };
    /* Der Kern öffnet sich, sobald der Boss nachlädt — dort trifft es dreifach */
    const wasOpen = this.coreOpen;
    this.coreOpen = this.attackCd > ph.cd * .42 && this.stun <= 0 && this.railT <= 0;
    if (this.coreOpen && !wasOpen) {
      FX.ripple(this.x, this.y, this.r * 2.2, '#ffe27a', .35);
      AudioSys.sfxAt('telegraph', this.x, this.y, .5);
    }
    if (this.railT > 0) {
      /* Bergbahn rollt weiter auf ihrer Achse */
      this.railT -= dt;
      this.x += Math.cos(this.railDir) * 420 * dt;
      this.y += Math.sin(this.railDir) * 420 * dt;
      Game.level.clampWorld(this);
      FX.dust(this.x, this.y + this.r * .5, this.railDir + Math.PI, 3);
      for (const pl of Game.players) if (pl.alive && dist(pl.x, pl.y, this.x, this.y) < this.r + pl.r + 6)
        pl.damage(this.dmg * .9, this.railDir);
    } else this.moveTo(ang, ph.spd * DANGERS[Game.danger].spd * (1 - this.slow), dt);
    this.attackCd -= dt;
    if (this.attackCd < 1.0 && this.attackCd > 0 && !this.warned) {
      this.warned = true;
      FX.telegraph(this.x, this.y, 280, this.col, .8);
      AudioSys.sfx('telegraph');
    }
    if (this.attackCd >= 1.0) this.warned = false;
    if (this.attackCd <= 0 && this.stun <= 0) {
      this.attackCd = ph.cd * cdMul;
      const bd = ph.bd * DANGERS[Game.danger].dmg;
      const bn = Math.round(ph.n * nMul);
      if (ph.pattern === 'radial') {
        for (let i = 0; i < bn; i++) Game.spawnEnemyBullet(this.x, this.y, i / bn * TAU + this.spiralA, ph.bs, bd, this.col, 0, this.boss.name);
        this.spiralA += .3;
      } else if (ph.pattern === 'spiral') {
        for (let i = 0; i < bn; i++) Game.spawnEnemyBullet(this.x, this.y, this.spiralA + i / bn * TAU, ph.bs, bd, this.col, 0, this.boss.name);
        this.spiralA += .55;
      } else if (ph.pattern === 'shotgunBurst') {
        for (let i = 0; i < bn; i++) Game.spawnEnemyBullet(this.x, this.y, ang + (i - bn / 2) * .10, ph.bs * rnd(.85, 1.15), bd, this.col, 0, this.boss.name);
      } else if (ph.pattern === 'charge') {
        this.knockback(ang, 900);
        FX.punch(Game.cam);
        for (let i = 0; i < bn; i++) Game.spawnEnemyBullet(this.x, this.y, ang + rnd(-.7, .7), ph.bs * rnd(.7, 1.2), bd, this.col, 0, this.boss.name);
      } else if (ph.pattern === 'lasergrid') {
        const hor = this.spiralA % 2 < 1;
        const gap = Math.max(85, Math.floor(720 / bn));
        const start = -Math.floor(bn / 2) * gap;
        FX.shockwave(this.x, this.y, 220, this.col);
        if (hor) for (let i = 0; i < bn; i++) Game.spawnEnemyBullet(this.x + start + i * gap, this.y - 520, Math.PI / 2, ph.bs, bd, this.col, 0, this.boss.name);
        else for (let i = 0; i < bn; i++) Game.spawnEnemyBullet(this.x - 520, this.y + start + i * gap, 0, ph.bs, bd, this.col, 0, this.boss.name);
        this.spiralA += 1;
      } else if (ph.pattern === 'orbitMines') {
        for (let i = 0; i < bn; i++) {
          const a = i / bn * TAU + this.spiralA;
          Game.spawnEnemyBullet(this.x + Math.cos(a) * 70, this.y + Math.sin(a) * 70, 0, 0, bd, this.col, 0, this.boss.name, { orbit: { cx: this.x, cy: this.y, a: a, rr: 70, w: 2.2, out: 36 } });
        }
        this.spiralA += .4;
      } else if (ph.pattern === 'rails') {
        /* Bergbahn: kündigt eine Schienenachse an und pflügt hindurch */
        const horiz = Math.random() < .5;
        this.railDir = horiz ? (tgt.x > this.x ? 0 : Math.PI) : (tgt.y > this.y ? Math.PI / 2 : -Math.PI / 2);
        this.railT = .9;
        FX.telegraph(this.x, this.y, 900, this.col, .85, horiz ? 'bar' : 'bar', 60);
        for (let i = 0; i < bn; i++) {
          const off = (i - (bn - 1) / 2) * 46;
          Game.spawnEnemyBullet(this.x + (horiz ? 0 : off), this.y + (horiz ? off : 0), this.railDir, ph.bs, bd, this.col, 0, this.boss.name);
        }
        this.knockback(this.railDir, 1100);
        Game.feedback(this.x, this.y, 'mittel');
        AudioSys.sfxAt('e_roar', this.x, this.y);
      } else if (ph.pattern === 'waterjet') {
        /* Wasserstrahl: enger, schnell wandernder Fächer */
        this.spiralA += .8;
        for (let i = 0; i < bn; i++) {
          const a2 = ang + Math.sin(this.spiralA + i * .18) * .55;
          Game.spawnEnemyBullet(this.x, this.y, a2, ph.bs * rnd(.9, 1.15), bd, '#59e6ff', 0, this.boss.name);
        }
        AudioSys.sfxAt('w_loeschwasser', this.x, this.y);
      } else if (ph.pattern === 'cablewhip') {
        /* Seilpeitsche: rotierende Doppelkette aus Geschossen */
        this.spiralA += .5;
        for (let i = 0; i < bn; i++) {
          const t2 = i / bn;
          for (const side of [0, Math.PI]) {
            const a2 = this.spiralA + side;
            Game.spawnEnemyBullet(this.x + Math.cos(a2) * (40 + t2 * 180), this.y + Math.sin(a2) * (40 + t2 * 180),
              a2 + Math.PI / 2, ph.bs * (.5 + t2), bd, this.col, 0, this.boss.name);
          }
        }
        FX.ripple(this.x, this.y, 240, this.col, .35);
      } else if (ph.pattern === 'wailRings') {
        /* Sirenenchor: drei ineinander laufende Ringe */
        for (let ring = 0; ring < 3; ring++) {
          const cnt = Math.max(6, Math.round(bn / 3));
          for (let i = 0; i < cnt; i++)
            Game.spawnEnemyBullet(this.x, this.y, i / cnt * TAU + ring * .25 + this.spiralA, ph.bs * (1 + ring * .35), bd, ring % 2 ? '#ffffff' : this.col, 0, this.boss.name);
        }
        this.spiralA += .4;
        FX.shockwave(this.x, this.y, 300, this.col);
        AudioSys.sfxAt('e_screech', this.x, this.y, 1.3);
        for (const pl of Game.players) if (pl.alive && dist(pl.x, pl.y, this.x, this.y) < 320) pl.abilityCd += .8;
      } else if (ph.pattern === 'crossbeams') {
        /* Kreuzstrahlen: vier rotierende Speichen */
        this.spiralA += .35;
        for (let arm = 0; arm < 4; arm++) {
          const a2 = this.spiralA + arm * Math.PI / 2;
          for (let i = 0; i < bn; i++)
            Game.spawnEnemyBullet(this.x + Math.cos(a2) * (30 + i * 26), this.y + Math.sin(a2) * (30 + i * 26), a2, ph.bs, bd, this.col, 0, this.boss.name);
        }
        FX.bolt(this.x, this.y, this.x + Math.cos(this.spiralA) * 300, this.y + Math.sin(this.spiralA) * 300, '#ffffff', 6, 8);
      } else if (ph.pattern === 'geysers') {
        /* Geysire: Eruptionen unter den Spielern */
        for (let i = 0; i < bn; i++) {
          const base = Game.players[i % Game.players.length] || tgt;
          Game.spawnMortar(this.x, this.y, base.x + rnd(-90, 90), base.y + rnd(-90, 90),
            { dmg: bd * 1.4, cd: 0, range: 999, r: 86, flight: .95 + i * .12 }, this.boss.name);
        }
        AudioSys.sfxAt('steam', this.x, this.y, 1.2);
      } else if (ph.pattern === 'steamCone') {
        /* Dampfstoß: breiter, sehr schneller Kegel */
        FX.haze(this.x, this.y, ang, 320, .7, .4);
        for (let i = 0; i < bn; i++)
          Game.spawnEnemyBullet(this.x, this.y, ang + (i - bn / 2) * .075, ph.bs * rnd(.8, 1.3), bd, '#ffd9a0', 0, this.boss.name);
        for (const pl of Game.players) if (pl.alive) {
          const rel = Math.atan2(pl.y - this.y, pl.x - this.x);
          if (Math.abs(angDiff(rel, ang)) < .6 && dist(pl.x, pl.y, this.x, this.y) < 300) pl.damage(bd * .8, rel);
        }
        AudioSys.sfxAt('steam', this.x, this.y, 1.4);
      } else if (ph.pattern === 'boilRain') {
        /* Kochender Regen: Einschläge über die ganze Arena */
        for (let i = 0; i < bn; i++) {
          const L2 = Game.level;
          Game.spawnMortar(this.x, this.y, rnd(80, L2.w - 80), rnd(80, L2.h - 80),
            { dmg: bd, cd: 0, range: 999, r: 70, flight: rnd(1.0, 2.0) }, this.boss.name);
        }
      } else if (ph.pattern === 'bellwave') {
        /* Glockenschlag: drei langsame, dichte Druckwellen */
        for (let k = 0; k < 3; k++) {
          const cnt = Math.max(8, Math.round(bn / 2));
          for (let i = 0; i < cnt; i++)
            Game.spawnEnemyBullet(this.x, this.y, i / cnt * TAU + k * .22, ph.bs * (1 + k * .22), bd, k === 1 ? '#ffffff' : this.col, 0, this.boss.name);
        }
        FX.shockwave(this.x, this.y, 420, this.col);
        Game.feedback(this.x, this.y, 'gross');
        AudioSys.sfxAt('thunder', this.x, this.y, .9);
        for (const pl of Game.players) if (pl.alive && dist(pl.x, pl.y, this.x, this.y) < 220) pl.webSlow = Math.max(pl.webSlow || 0, .4);
      } else if (ph.pattern === 'spireLasers') {
        /* Turmstrahlen: diagonale Gitter aus zwei Richtungen */
        const gap = Math.max(80, Math.floor(760 / bn));
        const start = -Math.floor(bn / 2) * gap;
        const diag = this.spiralA % 2 < 1 ? Math.PI / 4 : -Math.PI / 4;
        for (let i = 0; i < bn; i++) {
          const px = this.x + Math.cos(diag + Math.PI / 2) * (start + i * gap) - Math.cos(diag) * 560;
          const py = this.y + Math.sin(diag + Math.PI / 2) * (start + i * gap) - Math.sin(diag) * 560;
          Game.spawnEnemyBullet(px, py, diag, ph.bs, bd, this.col, 0, this.boss.name);
        }
        this.spiralA += 1;
        FX.shockwave(this.x, this.y, 240, this.col);
      } else if (ph.pattern === 'stoneRain') {
        /* Steinschlag: gezielte Brocken plus Splitterkreis */
        for (let i = 0; i < bn; i++) {
          const base = Game.players[i % Game.players.length] || tgt;
          Game.spawnMortar(this.x, this.y, base.x + rnd(-140, 140), base.y + rnd(-140, 140),
            { dmg: bd * 1.2, cd: 0, range: 999, r: 78, flight: rnd(.9, 1.7) }, this.boss.name);
        }
        for (let i = 0; i < 10; i++) Game.spawnEnemyBullet(this.x, this.y, i / 10 * TAU + this.spiralA, ph.bs * .7, bd * .6, '#9fb4d8', 0, this.boss.name);
        this.spiralA += .3;
        FX.debris(this.x, this.y, 8, '#8a8f9c', 220);
      } else if (ph.pattern === 'shockwave') {
        FX.shockwave(this.x, this.y, 360, this.col);
        Game.feedback(this.x, this.y, 'mittel');
        for (let i = 0; i < bn; i++) Game.spawnEnemyBullet(this.x, this.y, i / bn * TAU, ph.bs, bd, this.col, 0, this.boss.name);
        this.spiralA += .25;
      } else if (ph.pattern === 'bulletHell') {
        const turns = Math.max(2, Math.floor(bn / 6));
        for (let t = 0; t < turns; t++) {
          const count = Math.max(4, Math.round(bn / turns));
          for (let i = 0; i < count; i++)
            Game.spawnEnemyBullet(this.x, this.y, this.spiralA + i / count * TAU, ph.bs * (1 + t * .15), bd, this.col, 0, this.boss.name);
          this.spiralA += .45;
        }
      } else if (ph.pattern === 'crossfire') {
        const gap = Math.max(70, Math.floor(680 / bn));
        const start = -Math.floor(bn / 2) * gap;
        for (let i = 0; i < bn; i++) {
          Game.spawnEnemyBullet(this.x + start + i * gap, this.y - 520, Math.PI / 2, ph.bs, bd, this.col, 0, this.boss.name);
          Game.spawnEnemyBullet(this.x - 520, this.y + start + i * gap, 0, ph.bs, bd, this.col, 0, this.boss.name);
        }
        FX.shockwave(this.x, this.y, 200, this.col);
      } else if (ph.pattern === 'arenaHazard') {
        const L2 = Game.level;
        for (let i = 0; i < Math.min(bn, 5); i++) {
          if (Game.hazObjs.length > 90) break;
          const hx = rnd(80, L2.w - 80), hy = rnd(80, L2.h - 80);
          Game.hazObjs.push({ kind: 'bossPool', x: hx, y: hy, r: 42, slow: .3, poison: bd * .15, life: 8, t: 0, col: this.col });
          FX.ripple(hx, hy, 50, this.col, .4);
        }
      }
      if (ph.summon && RAND() < .6) {
        const def = ENEMY_BY_ID[ph.summon];
        for (let i = 0; i < (Game.coop ? 4 : 3); i++) Game.spawnEnemyAt(def, this.x + rnd(-90, 90), this.y + rnd(-90, 90));
      }
      AudioSys.sfx('laser');
    }
  }
  draw(ctx) {
    if (this.dead) { this.drawDeath(ctx); return; }
    const s = this.def.shape || 'dot';
    ctx.save(); ctx.translate(this.x, this.y);
    /* Schatten: bei Q1 billiges Rechteck statt Ellipse (arc ist Canvas' teuerster Op) */
    ctx.fillStyle = 'rgba(0,0,0,.38)';
    if (Game.quality() < 2) {
      ctx.fillRect(-this.r * .95, this.r * .55 - this.r * .42, this.r * 1.9, this.r * .84);
    } else {
      ctx.beginPath(); ctx.ellipse(0, this.r * .55, this.r * .95, this.r * .42, 0, 0, TAU); ctx.fill();
    }
    const ang = this.target ? Math.atan2(this.target.y - this.y, this.target.x - this.x) : 0;
    ctx.rotate(ang + Math.PI / 2);
    const sq = this.hitFlash > 0 ? 1 + this.hitFlash * 2.2 : 1;
    ctx.scale(sq, 2 - sq);
    if (this.squash > 0) {
      const s2 = this.squash, rel = (this.squashAng || 0) - ang - Math.PI / 2;
      ctx.rotate(rel); ctx.scale(1 + s2 * .55, 1 - s2 * .42); ctx.rotate(-rel);
    }
    const ss = this.spawnScale;
    if (ss < 1) {
      const c1 = 1.70158, c3 = c1 + 1, sc = 1 + c3 * Math.pow(ss - 1, 3) + c1 * Math.pow(ss - 1, 2);
      ctx.scale(sc, sc);
    }
    let col = this.hitFlash > 0 ? '#ffffff' : this.col;
    if (this.marked > 0 && (OPT().reduceFlicker || Math.sin(Game.time * 18) > 0)) col = '#ff2e88';
    ctx.fillStyle = col;
    /* Farbenblind-Modus: weiße Kontur statt dunkler — die Formen bleiben die
       Hauptunterscheidung, der Umriss hebt sie vom Boden ab. */
    ctx.strokeStyle = OPT().colorblind ? 'rgba(255,255,255,.85)' : 'rgba(0,0,0,.55)'; ctx.lineWidth = OPT().colorblind ? 2.5 : 2;
    const r = this.r;
    ctx.beginPath();
    if (this.boss) {
      /* Individuelles Boss-Porträt statt Einheitspolygon */
      drawBossBody(ctx, this, r, Game.time, col);
      if (this.coreOpen) {
        ctx.globalAlpha = .25 + .15 * Math.sin(Game.time * 10);
        ctx.strokeStyle = '#ffe27a'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, r * 1.35, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.beginPath();
  } else if (s === 'tri') {
      ctx.moveTo(0, -r * 1.25); ctx.lineTo(r, r * .85); ctx.lineTo(-r, r * .85); ctx.closePath();
      const lw = Math.sin(Game.time * 8 + this.wobble) * .3;
      ctx.moveTo(-r * .5, r * .3); ctx.lineTo(-r * 1.2, r * 1.1 + Math.sin(lw) * 2);
      ctx.moveTo(r * .5, r * .3); ctx.lineTo(r * 1.2, r * 1.1 + Math.cos(lw) * 2);
      ctx.moveTo(-r * .2, -r * 1.25); ctx.lineTo(-r * .4, -r * 1.6 + Math.sin(Game.time * 6) * 1);
      ctx.moveTo(r * .2, -r * 1.25); ctx.lineTo(r * .4, -r * 1.6 + Math.cos(Game.time * 6) * 1);
    }
    else if (s === 'box') {
      ctx.rect(-r * .9, -r * .9, r * 1.8, r * 1.8);
      for (let i = 0; i < 3; i++) { const lx = -r * .6 + i * r * .6, sw = Math.sin(Game.time * 7 + i + this.wobble) * .25;
        ctx.moveTo(lx, r * .9); ctx.lineTo(lx - r * .2, r * 1.5 + Math.sin(sw) * 2);
        ctx.moveTo(lx + r * .1, r * .9); ctx.lineTo(lx + r * .3, r * 1.5 + Math.cos(sw) * 2); }
      ctx.moveTo(-r * .5, -r * .9); ctx.lineTo(-r * .7, -r * 1.3); ctx.moveTo(r * .5, -r * .9); ctx.lineTo(r * .7, -r * 1.3);
    }
    else if (s === 'diamond') {
      ctx.moveTo(0, -r * 1.2); ctx.lineTo(r * .9, 0); ctx.lineTo(0, r * 1.2); ctx.lineTo(-r * .9, 0); ctx.closePath();
      const wf = Math.sin(Game.time * 10 + this.wobble) * .3;
      ctx.moveTo(-r * .9, 0); ctx.lineTo(-r * 1.8, -r * .4 + Math.sin(wf) * 3);
      ctx.moveTo(r * .9, 0); ctx.lineTo(r * 1.8, -r * .4 + Math.cos(wf) * 3);
    }
    else if (s === 'hex') {
      for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; i ? ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.closePath();
      for (let i = 0; i < 4; i++) { const a = (i - 1.5) * .8, sw = Math.sin(Game.time * 7 + i + this.wobble) * .2;
        ctx.moveTo(Math.cos(a) * r * .6, Math.sin(a) * r * .6); ctx.lineTo(Math.cos(a) * r * 1.5, Math.sin(a) * r * 1.5 + Math.sin(sw) * 2); }
    }
    else if (s === 'star') {
      for (let i = 0; i < 10; i++) { const a = i / 10 * TAU, rr = i % 2 ? r * .5 : r * 1.2; i ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath();
      for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + Game.time * 1.5, len = r * 1.6;
        ctx.moveTo(Math.cos(a) * r * .8, Math.sin(a) * r * .8); ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len); }
    }
    else if (s === 'cross') {
      ctx.rect(-r * .35, -r, r * .7, r * 2); ctx.rect(-r, -r * .35, r * 2, r * .7);
      for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + Math.PI / 4, sw = Math.sin(Game.time * 6 + i + this.wobble) * .2;
        ctx.moveTo(Math.cos(a) * r * .3, Math.sin(a) * r * .3); ctx.lineTo(Math.cos(a) * r * 1.4, Math.sin(a) * r * 1.4 + Math.sin(sw) * 2); }
    }
    else if (s === 'gear') {
      const teeth = 8, sp2 = Game.time * 3 + this.wobble;
      for (let i = 0; i < teeth * 2; i++) { const a = sp2 + i / (teeth * 2) * TAU, rr = i % 2 ? r * .72 : r * 1.15;
        i ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath();
      for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + sp2 * .5;
        ctx.moveTo(Math.cos(a) * r * .3, Math.sin(a) * r * .3); ctx.lineTo(Math.cos(a) * r * .6, Math.sin(a) * r * .6); }
    }
    else if (s === 'turret') {
      ctx.rect(-r * .95, -r * .5, r * 1.9, r * 1.3);
      ctx.moveTo(-r * .28, -r * .5); ctx.lineTo(-r * .18, -r * 1.6); ctx.lineTo(r * .3, -r * 1.55); ctx.lineTo(r * .22, -r * .5); ctx.closePath();
      for (let i = 0; i < 2; i++) { const sx = -r * .5 + i * r * 1, sw = Math.sin(Game.time * 6 + i + this.wobble) * .2;
        ctx.moveTo(sx, r * .8); ctx.lineTo(sx - r * .15, r * 1.4 + Math.sin(sw) * 2); }
    }
    else if (s === 'spider') {
      ctx.ellipse(0, 0, r * .78, r * .95, 0, 0, TAU);
      for (let i = 0; i < 4; i++) { const a = (i - 1.5) * .5, sw = Math.sin(Game.time * 9 + i + this.wobble) * .22;
        ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a + sw) * r * 1.8, Math.sin(a + sw) * r * 1.4);
        ctx.moveTo(0, 0); ctx.lineTo(Math.cos(Math.PI - a + sw) * r * 1.8, Math.sin(Math.PI - a + sw) * r * 1.4); }
    }
    else if (s === 'eye') {
      ctx.ellipse(0, 0, r, r * .74, 0, 0, TAU);
      for (let i = 0; i < 3; i++) { const a = (i - 1) * .7, sw = Math.sin(Game.time * 5 + i + this.wobble) * .15;
        ctx.moveTo(Math.cos(a) * r * .8, Math.sin(a) * r * .8); ctx.lineTo(Math.cos(a) * r * 1.6, Math.sin(a) * r * 1.6 + Math.sin(sw) * 2); }
    }
    else if (s === 'worm') {
      const seg = 4;
      for (let i = 0; i < seg; i++) { const off = Math.sin(Game.time * 10 + i * .9 + this.wobble) * r * .3;
        ctx.moveTo(off + r * .5, -r + i * (r * .62)); ctx.arc(off, -r + i * (r * .62), r * .52, 0, TAU); }
      ctx.moveTo(-r * .3, -r * 1.2); ctx.lineTo(-r * .5, -r * 1.6 + Math.sin(Game.time * 8) * 1.5);
      ctx.moveTo(r * .3, -r * 1.2); ctx.lineTo(r * .5, -r * 1.6 + Math.cos(Game.time * 8) * 1.5);
    }
    else if (s === 'wing') {
      ctx.moveTo(0, -r * 1.1); ctx.lineTo(r * 1.5, r * .1); ctx.lineTo(r * .35, r * .2);
      ctx.lineTo(0, r * 1.05); ctx.lineTo(-r * .35, r * .2); ctx.lineTo(-r * 1.5, r * .1); ctx.closePath();
      const wf = Math.sin(Game.time * 12 + this.wobble) * .25;
      ctx.moveTo(-r * 1.5, r * .1); ctx.lineTo(-r * 2, r * .1 + Math.sin(wf) * 4);
      ctx.moveTo(r * 1.5, r * .1); ctx.lineTo(r * 2, r * .1 + Math.cos(wf) * 4);
    }
    else if (s === 'prism') {
      ctx.moveTo(0, -r * 1.25); ctx.lineTo(r * 1.05, r * .1); ctx.lineTo(0, r * .75); ctx.lineTo(-r * 1.05, r * .1); ctx.closePath();
      ctx.moveTo(-r * .4, -r * .3); ctx.lineTo(-r * .8, -r * .8 + Math.sin(Game.time * 4) * 2);
      ctx.moveTo(r * .4, -r * .3); ctx.lineTo(r * .8, -r * .8 + Math.cos(Game.time * 4) * 2);
    }
    else if (s === 'brick') {
      ctx.rect(-r * 1.05, -r * .8, r * 2.1, r * 1.6);
      ctx.rect(-r * .75, -r * 1.15, r * 1.5, r * .4);
      for (let i = 0; i < 4; i++) { const bx = -r * .7 + i * r * .5, sw = Math.sin(Game.time * 5 + i + this.wobble) * .15;
        ctx.moveTo(bx, r * .8); ctx.lineTo(bx - r * .1, r * 1.3 + Math.sin(sw) * 1.5); }
    }
    else if (s === 'wave') {
      ctx.moveTo(-r, r * .8);
      for (let i = 0; i <= 8; i++) { const t2 = i / 8;
        ctx.lineTo(-r + t2 * r * 2, r * .8 - Math.abs(Math.sin(t2 * Math.PI * 1.5 + Game.time * 5)) * r * 1.7); }
      ctx.lineTo(r, r * .8); ctx.closePath();
      for (let i = 0; i < 3; i++) { const ty = r * .3 - i * r * .4, sw = Math.sin(Game.time * 7 + i + this.wobble) * .2;
        ctx.moveTo(-r * .4, ty); ctx.lineTo(-r * .9, ty + Math.sin(sw) * 3);
        ctx.moveTo(r * .4, ty); ctx.lineTo(r * .9, ty + Math.cos(sw) * 3); }
    }
    else if (!this.boss) ctx.arc(0, 0, r, 0, TAU);
    if (!this.boss) { ctx.fill(); ctx.stroke(); }
    if (!this.boss && s !== 'eye') {
      ctx.fillStyle = this.hitFlash > 0 ? '#fff' : '#0a0e1a';
      const es = r * .13;
      if (s === 'tri' || s === 'charger' || s === 'vampire') {
        ctx.beginPath(); ctx.arc(-r * .2, -r * .3, es, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(r * .2, -r * .3, es, 0, TAU); ctx.fill();
      } else if (s === 'box' || s === 'spitter') {
        ctx.beginPath(); ctx.arc(-r * .3, -r * .3, es, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(r * .3, -r * .3, es, 0, TAU); ctx.fill();
      } else if (s === 'diamond' || s === 'ghost' || s === 'blinker') {
        ctx.beginPath(); ctx.arc(-r * .15, -r * .25, es * .9, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(r * .15, -r * .25, es * .9, 0, TAU); ctx.fill();
      } else if (s === 'hex' || s === 'shielder' || s === 'summoner' || s === 'spliter' || s === 'shielded') {
        ctx.beginPath(); ctx.arc(-r * .25, -r * .15, es, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(r * .25, -r * .15, es, 0, TAU); ctx.fill();
      } else if (s === 'star') {
        ctx.beginPath(); ctx.arc(0, -r * .15, es * 1.3, 0, TAU); ctx.fill();
      } else if (s === 'cross') {
        ctx.beginPath(); ctx.arc(0, -r * .15, es, 0, TAU); ctx.fill();
      } else if (s === 'gear') {
        ctx.beginPath(); ctx.arc(-r * .15, -r * .1, es * .8, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(r * .15, -r * .1, es * .8, 0, TAU); ctx.fill();
      } else if (s === 'spider') {
        ctx.beginPath(); ctx.arc(-r * .2, -r * .25, es, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(r * .2, -r * .25, es, 0, TAU); ctx.fill();
      } else if (s === 'worm' || s === 'leech') {
        ctx.beginPath(); ctx.arc(-r * .15, -r * .8, es * .8, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(r * .15, -r * .8, es * .8, 0, TAU); ctx.fill();
      } else if (s === 'wing' || s === 'bomber') {
        ctx.beginPath(); ctx.arc(0, -r * .4, es, 0, TAU); ctx.fill();
      } else if (s === 'prism') {
        ctx.beginPath(); ctx.arc(0, -r * .3, es, 0, TAU); ctx.fill();
      } else if (s === 'brick' || s === 'juggernaut') {
        ctx.beginPath(); ctx.arc(-r * .3, -r * .7, es, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(r * .3, -r * .7, es, 0, TAU); ctx.fill();
      } else if (s === 'wave') {
        ctx.beginPath(); ctx.arc(-r * .15, -r * .5, es * .9, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(r * .15, -r * .5, es * .9, 0, TAU); ctx.fill();
      } else if (s === 'dot' || s === 'swarm' || s === 'exploder' || s === 'shardling') {
        ctx.beginPath(); ctx.arc(-r * .2, -r * .15, es * .8, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(r * .2, -r * .15, es * .8, 0, TAU); ctx.fill();
      } else if (s === 'turret' || s === 'mortar') {
        ctx.beginPath(); ctx.arc(0, -r * .2, es, 0, TAU); ctx.fill();
      }
    }
    if (s === 'eye') {
      /* Wächter: Pupille folgt dem Ziel, Ladezustand färbt sie rot */
      const aiming = this.state === 'aim';
      ctx.fillStyle = aiming ? '#ff4d5e' : '#141a28';
      ctx.beginPath(); ctx.arc(0, -r * .18, r * .42, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(r * .12, -r * .3, r * .13, 0, TAU); ctx.fill();
      if (aiming) {
        ctx.strokeStyle = '#ff4d5e'; ctx.globalAlpha = .6; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -this.def.beam.range * .35); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    } else if (s === 'brick') {
      ctx.fillStyle = 'rgba(20,26,40,.6)';
      ctx.fillRect(-r * .8, -r * .5, r * .55, r * 1.0);
      ctx.fillRect(r * .25, -r * .5, r * .55, r * 1.0);
      if (this.state === 'slam') { ctx.fillStyle = '#ff8a5c'; ctx.fillRect(-r * .9, -r * 1.1, r * 1.8, r * .25); }
    } else if (s === 'wave') {
      ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1;
      for (let i = 1; i <= 2; i++) {
        ctx.globalAlpha = .35 / i;
        ctx.beginPath(); ctx.arc(0, 0, r * (1.3 + i * .45) + Math.sin(Game.time * 6) * 2, -1.2, 1.2); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } else if (s === 'turret') {
      ctx.fillStyle = 'rgba(20,26,40,.55)';
      ctx.fillRect(-r * .95, -r * .12, r * 1.9, r * .3);
    }
    if (ss < 1) {
      ctx.globalAlpha = (1 - ss) * .5; ctx.strokeStyle = col; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, r * (1 + (1 - ss) * .8), 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (this.elite) {
      const tc = { blitz: '#ffe27a', heiler: '#8affb0', panzer: '#9fb4d8', aggressiv: '#ff8a5c', schnell: '#39e6ff', magnetisch: '#c7a6ff', giftig: '#8dff5c', brennend: '#ff8a3d', spiegelnd: '#bfe8ff' }[this.eliteTrait] || '#ffe27a';
      const pulse = 1 + Math.sin(Game.time * 7 + this.wobble) * .15;
      ctx.strokeStyle = tc; ctx.globalAlpha = .55 + Math.sin(Game.time * 7 + this.wobble) * .3; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(0, 0, r * pulse + 5, 0, TAU); ctx.stroke();
      ctx.globalAlpha = .5;
      for (let i = 0; i < 2; i++) {
        const a = Game.time * (3 + i * 1.7) + this.wobble * 2;
        ctx.fillStyle = tc; ctx.beginPath(); ctx.arc(Math.cos(a) * (r + 10), Math.sin(a) * (r + 10), 2.4, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    if (this.bossVariant) {
      const vc = this.bossVariant === 'wut' ? '#ff2e88' : '#8affb0';
      ctx.strokeStyle = vc; ctx.globalAlpha = .4 + Math.sin(Game.time * 5) * .2; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, r * 1.5 + Math.sin(Game.time * 5) * 6, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (this.charmT > 0) {
      /* Überzeugter Gegner: goldener Ring, Sprechblase und Restzeit */
      ctx.globalAlpha = .55 + .3 * Math.sin(Game.time * 8);
      ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(0, 0, r * 1.45, 0, TAU); ctx.stroke();
      ctx.globalAlpha = .22; ctx.fillStyle = '#ffd24a';
      ctx.beginPath(); ctx.arc(0, 0, r * 1.45, 0, TAU); ctx.fill();
      ctx.globalAlpha = .9; ctx.fillStyle = '#ffd24a';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-7, -r - 15, 14, 9, 2); else ctx.rect(-7, -r - 15, 14, 9);
      ctx.fill();
      ctx.beginPath(); ctx.moveTo(-2, -r - 6.4); ctx.lineTo(-3, -r - 2.4); ctx.lineTo(2.4, -r - 6.4); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(24,16,4,.85)';
      ctx.fillRect(-4.6, -r - 12.4, 9.2, 1.4); ctx.fillRect(-4.6, -r - 10, 6.4, 1.4);
      ctx.globalAlpha = 1;
    }
    if (this.def.ai === 'shielded') {
      const arc = this.def.shieldArc || 1.1;
      ctx.globalAlpha = this.shieldHit > 0 ? .95 : .6;
      ctx.fillStyle = this.shieldHit > 0 ? '#ffffff' : '#5aa0dc';
      ctx.beginPath(); ctx.arc(0, -r * .2, r * 1.15, -arc, arc); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    if (this.eliteTrait) {
      ctx.fillStyle = 'rgba(0,0,0,.62)'; ctx.fillRect(this.x - 9, this.y - this.r - 24, 18, 12);
      ctx.fillStyle = { blitz: '#ffe27a', heiler: '#8affb0', panzer: '#9fb4d8', aggressiv: '#ff8a5c', schnell: '#39e6ff' }[this.eliteTrait];
      ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center';
      ctx.fillText({ blitz: 'BL', heiler: 'HE', panzer: 'PN', aggressiv: 'AG', schnell: 'SC' }[this.eliteTrait], this.x, this.y - this.r - 15);
    }
    if (this.burnT > 0) { ctx.fillStyle = '#ff7a3d'; ctx.fillRect(this.x - 12, this.y - this.r - 12, 4, 4); }
    if (this.poisonT > 0) { ctx.fillStyle = '#b8d98a'; ctx.fillRect(this.x - 6, this.y - this.r - 12, 4, 4); }
    if (this.slowT > 0) { ctx.fillStyle = '#9fe4ff'; ctx.fillRect(this.x, this.y - this.r - 12, 4, 4); }
    if (this.stun > 0) { ctx.fillStyle = '#ffe27a'; ctx.fillRect(this.x + 6, this.y - this.r - 12, 4, 4); }
    if (this.freezeT > 0) { ctx.fillStyle = '#bfefff'; ctx.fillRect(this.x + 12, this.y - this.r - 12, 4, 4); }
    if (this.shockT > 0) { ctx.fillStyle = '#ffe27a'; ctx.fillRect(this.x + 18, this.y - this.r - 12, 4, 4); }
    if (this.hp < this.maxHp) {
      const w = this.boss ? 130 : Math.max(20, this.r * 2);
      const frac = clamp(this.hp / this.maxHp, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,.62)'; ctx.fillRect(this.x - w / 2, this.y - this.r - 9, w, 4);
      ctx.fillStyle = this.boss ? '#ff2e88' : '#ff5d6e';
      if (this.boss) {
        const seg = 12;
        for (let i = 0; i < seg; i++) {
          if (i / seg <= frac) ctx.fillRect(this.x - w / 2 + i * (w / seg) + 1.2, this.y - this.r - 9, w / seg - 2.4, 4);
        }
      } else ctx.fillRect(this.x - w / 2, this.y - this.r - 9, w * frac, 4);
    }
    if (this.boss) {
      ctx.fillStyle = 'rgba(8,12,24,.8)';
      ctx.fillRect(this.x - 64, this.y - this.r - 28, 128, 14);
      ctx.strokeStyle = this.col; ctx.lineWidth = 1; ctx.strokeRect(this.x - 64, this.y - this.r - 28, 128, 14);
      ctx.fillStyle = '#ffe27a'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(this.boss.name.toUpperCase(), this.x, this.y - this.r - 21);
      ctx.textBaseline = 'alphabetic';
    }
  }
  drawDeath(ctx) {
    const p = this.deathAnim <= 0 ? 0 : clamp(this.deathAnim / this.deathMax, 0, 1);
    const grow = 1 + (1 - p) * .5, rot = (1 - p) * 1.4;
    ctx.save(); ctx.translate(this.x, this.y + (1 - p) * 8);
    ctx.globalAlpha = Math.min(1, p * 1.6);
    ctx.rotate(rot);
    ctx.scale(grow, grow);
    ctx.fillStyle = this.col; ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 2;
    const r = this.r;
    ctx.beginPath();
    if (this.boss) {
      for (let i = 0; i < 8; i++) { const a = i / 8 * TAU, rr = r * (i % 2 ? .7 : 1); i ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      ctx.closePath();
    } else {
      const s = this.def.shape || 'dot';
      if (s === 'tri') { ctx.moveTo(0, -r * 1.25); ctx.lineTo(r, r * .85); ctx.lineTo(-r, r * .85); ctx.closePath(); }
      else if (s === 'box') { ctx.rect(-r * .9, -r * .9, r * 1.8, r * 1.8); }
      else if (s === 'diamond') { ctx.moveTo(0, -r * 1.2); ctx.lineTo(r * .9, 0); ctx.lineTo(0, r * 1.2); ctx.lineTo(-r * .9, 0); ctx.closePath(); }
      else if (s === 'hex') { for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; i ? ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.closePath(); }
      else if (s === 'star') { for (let i = 0; i < 10; i++) { const a = i / 10 * TAU, rr = i % 2 ? r * .5 : r * 1.2; i ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath(); }
      else if (s === 'cross') { ctx.rect(-r * .35, -r, r * .7, r * 2); ctx.rect(-r, -r * .35, r * 2, r * .7); }
      else ctx.arc(0, 0, r, 0, TAU);
    }
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}

/* ============================ 14. FX-SYSTEM (VERBESSERT) ============================ */
const FX = {
  particles: new Pool(() => ({})), numbers: new Pool(() => ({})), rings: new Pool(() => ({})),
  lines: new Pool(() => ({})), cones: new Pool(() => ({})), beams: new Pool(() => ({})),
  shards: new Pool(() => ({})), telegraphs: new Pool(() => ({})), flashes: new Pool(() => ({})),
  qmul() { const q = Game.quality(); let m = q === 0 ? .35 : q === 1 ? .65 : 1; return m * (Game.autoQ || 1); },
  prefill() {
    this.particles.prefill(420); this.shards.prefill(90); this.numbers.prefill(50);
    this.rings.prefill(40); this.lines.prefill(30); this.cones.prefill(24);
    this.beams.prefill(24); this.telegraphs.prefill(12); this.flashes.prefill(16);
  },
  particle(x, y, ang, spd, col, life, size, o) {
    if (OPT().particles <= 0) return null;
    if (this.particles.active.length > 1500 * this.qmul()) return null;
    const p = this.particles.get();
    p.x = x; p.y = y; p.vx = Math.cos(ang) * spd; p.vy = Math.sin(ang) * spd;
    p.col = col; p.life = life; p.max = life; p.size = size || 3;
    p.rot = (o && o.rot != null) ? o.rot : crnd(TAU);
    p.vr = (o && o.vr != null) ? o.vr : crnd(-2, 2);
    p.shape = (o && o.shape) || (Math.random() < .3 ? 'tri' : 'rect');
    p.gy = (o && o.gy) || 0;
    p.dg = (o && o.dg != null) ? o.dg : .02;
    p.grow = (o && o.grow) || 0;
    p.flick = (o && o.flick) || 0;
    p.a0 = (o && o.alpha != null) ? o.alpha : 1;
    p.glow = (o && o.glow) || 0;
    p.fade = (o && o.fade) || 0;
    return p;
  },
  /* Ein einzelnes, gestochen scharfes Pixel */
  px(x, y, col, size, life, o) {
    const p = this.particle(x, y, 0, 0, col, life || .3, size || 2, o || {});
    if (p) { p.shape = 'pixel'; p.vx = (o && o.vx) || 0; p.vy = (o && o.vy) || 0; p.vr = 0; p.rot = 0; }
    return p;
  },
  /* Rauchwolke: langsam, wachsend, ausbleichend */
  smoke(x, y, ang, spd, n, col, size) {
    const q = OPT().particles; if (q <= 0) return;
    const c = Math.max(1, Math.round((n || 3) * q * this.qmul()));
    for (let i = 0; i < c; i++) {
      this.particle(x + crnd(-2, 2), y + crnd(-2, 2), ang + crnd(-.5, .5), crnd(spd * .3, spd), col || 'rgba(176,182,196,.55)',
        crnd(.5, 1.1), (size || 4) * crnd(.7, 1.4),
        { shape: 'smoke', dg: .55, gy: -12, grow: crnd(9, 20), alpha: crnd(.22, .45), vr: crnd(-.6, .6), fade: 1 });
    }
  },
  /* Glut: flackernde, fallende Funken */
  ember(x, y, n, col, spd) {
    const q = OPT().particles; if (q <= 0) return;
    const c = Math.max(1, Math.round((n || 5) * q * this.qmul()));
    for (let i = 0; i < c; i++) {
      this.particle(x, y, crnd(TAU), crnd((spd || 90) * .3, spd || 90), col || '#ff9a3d', crnd(.4, .95), crnd(1, 2.4),
        { shape: 'pixel', gy: crnd(60, 150), dg: .35, flick: crnd(14, 26), glow: 1 });
    }
  },
  /* Funkenregen: gestreckte Striche in Flugrichtung */
  sparkShower(x, y, ang, n, col, spd) {
    const q = OPT().particles; if (q <= 0) return;
    const c = Math.max(1, Math.round((n || 6) * q * this.qmul()));
    for (let i = 0; i < c; i++) {
      this.particle(x, y, ang + crnd(-.9, .9), crnd((spd || 240) * .35, spd || 240), col || '#ffd9a0', crnd(.14, .32), crnd(1.6, 3.2),
        { shape: 'streak', gy: crnd(120, 280), dg: .18, glow: 1 });
    }
  },
  /* Trümmerstücke mit Schwerkraft */
  debris(x, y, n, col, spd) {
    const q = OPT().particles; if (q <= 0) return;
    const c = Math.max(1, Math.round((n || 5) * q * this.qmul()));
    for (let i = 0; i < c; i++) {
      this.shard(x, y, crnd(TAU), crnd((spd || 160) * .35, spd || 160), col || '#8a8f9c', crnd(.35, .8), crnd(1.6, 3.6));
      const s = this.shards.active[this.shards.active.length - 1];
      if (s) s.gy = crnd(180, 340);
    }
  },
  /* Patronenhülse: dreht sich, fällt, bleibt kurz liegen */
  casing(x, y, ang) {
    const q = OPT().particles; if (q <= 0 || Math.random() > .85) return;
    this.particle(x, y, ang + Math.PI / 2 + crnd(-.4, .4), crnd(90, 170), '#d8b25a', crnd(.5, .9), 2.4,
      { shape: 'casing', gy: 340, dg: .5, vr: crnd(-16, 16), glow: 0 });
  },
  /* Staubwolke am Boden */
  dust(x, y, ang, n) {
    const q = OPT().particles; if (q <= 0) return;
    const c = Math.max(1, Math.round((n || 4) * q * this.qmul()));
    for (let i = 0; i < c; i++)
      this.particle(x, y, ang + crnd(-.8, .8), crnd(20, 70), 'rgba(150,140,120,.5)', crnd(.35, .7), crnd(2.4, 5),
        { shape: 'smoke', dg: .5, grow: crnd(6, 14), alpha: crnd(.16, .3), fade: 1 });
  },
  /* Dauerhafte Bodenspur: Blut, Ruß, Frost, Schmutz — mit Verblassungsstufen */
  decal(x, y, r, col, kind, life) {
    const L = Game.level;
    if (!L || !L.decals || OPT().particles <= 0) return;
    if (L.decals.length > 340) L.decals.splice(0, 24);
    L.decals.push({ x: x, y: y, r: r, c: col, kind: kind || 'dirt', rot: crnd(TAU), t: 0, life: life || 6 });
  },
  /* Feiner, schnell verblassender Ring */
  ripple(x, y, r, col, life) {
    const s = this.rings.get();
    s.x = x; s.y = y; s.r = Math.max(2, r * .25); s.max = r; s.col = col; s.life = life || .3; s.mx = life || .3; s.thin = true;
  },
  /* Blitzbogen zwischen zwei Punkten */
  bolt(x1, y1, x2, y2, col, segs, jag) {
    const n = segs || 5, off = jag != null ? jag : Math.min(26, Math.hypot(x2 - x1, y2 - y1) * .2);
    let px = x1, py = y1;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const jx = i === n ? 0 : crnd(-off, off), jy = i === n ? 0 : crnd(-off, off);
      const nx = x1 + (x2 - x1) * t + jx, ny = y1 + (y2 - y1) * t + jy;
      this.line(px, py, nx, ny, Math.random() < .45 ? '#ffffff' : col, .13);
      px = nx; py = ny;
    }
  },
  /* Spritzer (Wasser, Plasma, Gift) */
  splashDrops(x, y, ang, n, col) {
    const q = OPT().particles; if (q <= 0) return;
    const c = Math.max(1, Math.round((n || 5) * q * this.qmul()));
    for (let i = 0; i < c; i++)
      this.particle(x, y, ang + crnd(-1.4, 1.4), crnd(60, 240), col, crnd(.2, .5), crnd(1.4, 3),
        { shape: 'pixel', gy: crnd(90, 220), dg: .3 });
  },
  note(x, y, ang, spd, col, life) {
    if (OPT().particles <= 0) return;
    if (this.particles.active.length > 900 * this.qmul()) return;
    const p = this.particles.get();
    p.x = x; p.y = y; p.vx = Math.cos(ang) * spd; p.vy = Math.sin(ang) * spd;
    p.col = col; p.life = life; p.max = life; p.size = 4;
    p.rot = crnd(TAU); p.vr = crnd(-3, 3); p.shape = 'note';
  },
  number(x, y, txt, col, scale) {
    if (this.numbers.active.length > 160) return;
    const s = String(txt);
    /* Aggregation: dicht beieinander liegende Zahlen gleicher Farbe werden zu
       einer Summe mit xN zusammengefasst — verhindert Zahlen-Rauschen, wenn im
       Late-Game hunderte Treffer pro Sekunde landen. */
    if (/^[+-]?\d+$/.test(s)) {
      for (const o of this.numbers.active) {
        /* sum wird beim Anlegen gesetzt (siehe unten) — über diesen Marker
           mergen auch bereits aggregierte Floats weiter (12+7+3 → 22×3). */
        if (typeof o.sum === 'number' && isFinite(o.sum) && o.life > .45 && o.col === col &&
            Math.abs(o.x - x) < 18 && Math.abs(o.y - y) < 16) {
          o.sum += (+s); o.cnt++;
          o.x = (o.x + x) / 2; o.y = Math.min(o.y, y);
          o.txt = o.sum + '×' + o.cnt; o.life = .8;
          return;
        }
      }
    }
    const n = this.numbers.get();
    n.x = x; n.y = y; n.txt = s; n.col = col; n.life = .8; n.scale = scale || 1; n.vy = -46;
    /* Aggregations-Basis: nur für numerische Texte, damit Text-Floats
       ("AUSWEICH", "KEINE HEILUNG") nie als Summe fehlinterpretiert werden. */
    if (/^[+-]?\d+$/.test(s)) { n.sum = (+s); n.cnt = 1; } else { n.sum = NaN; n.cnt = 0; }
  },
  shockwave(x, y, r, col) { const s = this.rings.get(); s.x = x; s.y = y; s.r = 8; s.max = r; s.col = col; s.life = .45; s.mx = .45; s.thin = false; },
  explosion(x, y, r, col, mult) {
    this.shockwave(x, y, r, col);
    this.ripple(x, y, r * 1.5, '#ffffff', .26);
    this.light(x, y, r * 3.2, '#ffd9a0', .3, 1.2);
    this.light(x, y, r * 1.6, '#ffffff', .12, 1);
    AudioSys.bassPulse(Math.min(.3, r * .0015));
    const n = Math.min(34, r * .38) * OPT().particles * this.qmul();
    for (let i = 0; i < n; i++) {
      const ang = crnd(TAU), spd = crnd(70, 300);
      this.particle(x, y, ang, spd, Math.random() < .3 ? '#fff2c0' : col, crnd(.22, .58), crnd(2, 5),
        { shape: Math.random() < .45 ? 'tri' : 'pixel', dg: .12, glow: 1 });
    }
    this.ember(x, y, Math.round(4 + r * .07), '#ff9a3d', 180);
    this.smoke(x, y, -Math.PI / 2, 60, Math.round(3 + r * .04), 'rgba(60,58,62,.6)', 6);
    this.sparkShower(x, y, crnd(TAU), Math.round(3 + r * .05), '#ffd9a0', 320);
    this.debris(x, y, Math.round(2 + r * .03), shade(col, -.35), 220);
  },
  line(x1, y1, x2, y2, col, life) { const l = this.lines.get(); l.x1 = x1; l.y1 = y1; l.x2 = x2; l.y2 = y2; l.col = col; l.life = life; l.max = life; l.w = 2; },
  beam(x1, y1, x2, y2, col, w) { const b = this.beams.get(); b.x1 = x1; b.y1 = y1; b.x2 = x2; b.y2 = y2; b.col = col; b.life = .18; b.max = .18; b.w = w || 6; },
  cone(x, y, ang, r, half, col) { const c = this.cones.get(); c.x = x; c.y = y; c.a = ang; c.r = r; c.h = half; c.col = col; c.life = .18; c.max = .18; },
  spark(x, y, ang, col) { for (let i = 0; i < 5; i++) this.particle(x, y, ang + crnd(-.5, .5), crnd(40, 140), col, .25, 2); },
  shard(x, y, ang, spd, col, life, size) {
    const s = this.shards.get();
    s.x = x; s.y = y; s.vx = Math.cos(ang) * spd; s.vy = Math.sin(ang) * spd;
    s.rot = crnd(TAU); s.vr = crnd(-8, 8); s.col = col; s.life = life; s.max = life; s.size = size;
    s.shape = Math.random() < .3 ? 'tri' : 'rect'; s.gy = 0;
  },
  MUD_COLS: ['#6b4a2a', '#8a6438', '#4d3620', '#7b5c39', '#5a4126', '#3b2a17'],
  /* Matsch-Einschlag: Spritzer + Klumpen + Bodenfleck (passend zu den nassen Treffer-Sounds) */
  mud(x, y, ang, strength) {
    const q = OPT().particles;
    if (q <= 0) return;
    const s = clamp(strength || 1, .3, 2.2);
    const C = this.MUD_COLS;
    const n = Math.max(2, Math.round((3 + s * 5) * q));
    for (let i = 0; i < n; i++)
      this.particle(x, y, ang + crnd(-1.2, 1.2), crnd(45, 235) * s, C[Math.floor(Math.random() * C.length)], crnd(.2, .48), crnd(1.5, 3.4) * s);
    const m = Math.max(1, Math.round(2 * q * s));
    for (let i = 0; i < m; i++)
      this.shard(x, y, ang + crnd(-.95, .95), crnd(55, 195) * s, C[Math.floor(Math.random() * 3)], crnd(.28, .58), crnd(1.8, 4.2));
    const L = Game.level;
    if (L && L.decals && L.decals.length < 300 && Math.random() < .45 * q)
      L.decals.push({ x: x + crnd(-7, 7), y: y + crnd(-7, 7), r: crnd(2.6, 7) * s, c: C[Math.floor(Math.random() * C.length)], kind: 'blood', rot: crnd(TAU), t: 0, life: crnd(3, 6.5) });
  },
  sparkle(x, y, ang, spd, col, life, size) {
    const p = this.particle(x, y, ang, spd, col, life, size);
    if (p) p.shape = 'glint';
  },
  pixelBurst(x, y, col, n, spd) {
    if (OPT().particles <= 0) return;
    const c = Math.max(1, Math.round((n || 10) * OPT().particles * this.qmul()));
    for (let i = 0; i < c; i++) {
      const ang = crnd(TAU), v = crnd((spd || 140) * .4, (spd || 140));
      const p = this.particles.get();
      p.x = x; p.y = y; p.vx = Math.cos(ang) * v; p.vy = Math.sin(ang) * v;
      p.col = Math.random() < .3 ? '#ffffff' : col;
      p.life = crnd(.3, .6); p.max = p.life; p.size = crnd(2, 5);
      p.rot = crnd(TAU); p.vr = crnd(-6, 6);
      p.shape = Math.random() < .35 ? 'tri' : 'rect';
    }
  },
  /* Flugspur je Projektiltyp — Pixel, Funken, Rauch, Plasma, Frost … */
  projTrail(p, dt) {
    const q = OPT().particles;
    if (q <= 0) return;
    const F = projFx(p.source);
    const ang = Math.atan2(p.vy, p.vx), back = ang + Math.PI;
    p._tacc = (p._tacc || 0) + dt;
    const rate = F.trail === 'tracer' ? .012 : F.trail === 'plasma' || F.trail === 'fire' ? .022 : .032;
    if (p._tacc < rate / Math.max(.35, q)) return;
    p._tacc = 0;
    switch (F.trail) {
      case 'tracer':
        FX.light(p.x, p.y, 34, '#fff6c8', .05, .7);
        FX.px(p.x, p.y, '#fff6c8', 2, .16, { glow: 1 });
        FX.particle(p.x, p.y, back + crnd(-.12, .12), crnd(10, 40), p.col, .2, 2, { shape: 'streak', dg: .1, glow: 1 });
        break;
      case 'spark':
        FX.px(p.x + crnd(-1, 1), p.y + crnd(-1, 1), p.col, 2, .14, { glow: 1 });
        if (Math.random() < .35) FX.particle(p.x, p.y, back + crnd(-.5, .5), crnd(15, 55), '#ffd9a0', .18, 1.6, { shape: 'pixel', gy: 30, dg: .25 });
        break;
      case 'thin':
        FX.px(p.x, p.y, p.col, 1.6, .12, { glow: 1 });
        break;
      case 'plasma':
        FX.light(p.x, p.y, 60, p.col, .07, .8);
        FX.px(p.x + crnd(-2, 2), p.y + crnd(-2, 2), Math.random() < .4 ? '#ffffff' : p.col, crnd(1.6, 3), .22, { glow: 1, flick: 22 });
        if (Math.random() < .4) FX.smoke(p.x, p.y, back, 30, 1, 'rgba(120,90,190,.35)', 2.6);
        break;
      case 'fire':
        FX.light(p.x, p.y, 54, '#ff9a3d', .08, .9);
        FX.ember(p.x, p.y, 1, Math.random() < .5 ? '#ff7a3d' : '#ffcf4a', 60);
        if (Math.random() < .5) FX.smoke(p.x, p.y, back, 26, 1, 'rgba(70,60,55,.4)', 2.6);
        break;
      case 'frost':
        if (Math.random() < .08) FX.decal(p.x, p.y, crnd(3, 7), '#bfefff', 'frost', crnd(4, 8));
        FX.px(p.x + crnd(-2, 2), p.y + crnd(-2, 2), Math.random() < .5 ? '#bfefff' : '#ffffff', crnd(1, 2.2), .3, { gy: 26, dg: .5, glow: 1 });
        break;
      case 'spore':
        FX.particle(p.x, p.y, back + crnd(-.8, .8), crnd(8, 34), '#8dff5c', crnd(.3, .6), crnd(1.4, 2.8), { shape: 'smoke', dg: .5, grow: 5, alpha: .35, fade: 1 });
        break;
      case 'water':
        FX.particle(p.x, p.y, back + crnd(-.5, .5), crnd(10, 50), Math.random() < .5 ? '#59e6ff' : '#cff2ff', crnd(.18, .4), crnd(1.4, 2.6), { shape: 'pixel', gy: 90, dg: .4 });
        break;
      case 'elec':
        FX.light(p.x, p.y, 48, p.col, .06, 1);
        FX.px(p.x, p.y, '#ffffff', 2, .1, { glow: 1 });
        if (Math.random() < .4) { const a2 = ang + crnd(-1.6, 1.6); FX.bolt(p.x, p.y, p.x + Math.cos(a2) * crnd(6, 16), p.y + Math.sin(a2) * crnd(6, 16), p.col, 2, 4); }
        break;
      case 'light':
        FX.light(p.x, p.y, 52, '#fff6c8', .08, .9);
        FX.px(p.x, p.y, '#fff6c8', 2.2, .18, { glow: 1 });
        break;
      case 'feather':
        FX.particle(p.x, p.y, back + crnd(-.8, .8), crnd(8, 34), Math.random() < .5 ? '#dfe7f0' : '#9fb4d8', crnd(.4, .8), crnd(1.4, 2.6),
          { shape: 'pixel', gy: 34, dg: .55, vr: crnd(-3, 3) });
        break;
      case 'sparkle':
        FX.sparkle(p.x + crnd(-3, 3), p.y + crnd(-3, 3), crnd(TAU), crnd(10, 40), Math.random() < .5 ? '#ffe27a' : '#ffffff', .3, 1.6);
        break;
      case 'grav':
        for (let i = 0; i < 2; i++) {
          const a2 = crnd(TAU), r2 = crnd(8, 18);
          FX.particle(p.x + Math.cos(a2) * r2, p.y + Math.sin(a2) * r2, a2 + Math.PI, crnd(30, 90), '#a06bff', .22, 1.8, { shape: 'pixel', dg: .2, glow: 1 });
        }
        break;
      default:
        FX.px(p.x, p.y, p.col, 2, .16, { glow: 1 });
    }
  },
  /* Einschlag in Wand/Boden je Material */
  projImpact(x, y, ang, col, src, mat) {
    if (Math.random() < .2) this.decal(x, y, crnd(2, 4), mat === 'stone' ? 'rgba(30,32,40,.55)' : col, 'soot', crnd(4, 7));
    const q = OPT().particles;
    const F = projFx(src);
    if (q > 0) {
      FX.sparkShower(x, y, ang + Math.PI, 2, F.trail === 'elec' ? '#ffffff' : '#ffd9a0', 160);
      for (let i = 0; i < 2 * q; i++)
        FX.particle(x, y, ang + Math.PI + crnd(-1.2, 1.2), crnd(30, 120), col, crnd(.1, .2), crnd(1.2, 2.2), { shape: 'pixel', gy: 120, dg: .25 });
      FX.dust(x, y, ang + Math.PI, 1);
      FX.ripple(x, y, 8, col, .12);
      if (mat === 'stone') FX.debris(x, y, 1, '#8a8f9c', 100);
    }
    AudioSys.sfxAt(mat === 'stone' ? 'wall' : 'ric', x, y, .7);
  },
  /* ---- Lichtschicht: additive Lichtquellen für Mündungsfeuer, Explosionen, Projektile ---- */
  lights: [],
  light(x, y, r, col, life, power) {
    if (OPT().lights === false || Game.quality() < 1) return;
    if (this.lights.length > 90) return;
    if ((Game.autoQ || 1) < 1 && this.lights.length > 42) return;
    this.lights.push({ x: x, y: y, r: r, col: col || '#ffd9a0', life: life || .12, max: life || .12, p: power != null ? power : 1 });
  },
  updateLights(dt) {
    for (let i = this.lights.length - 1; i >= 0; i--) {
      const l = this.lights[i];
      l.life -= dt;
      if (l.life <= 0) this.lights.splice(i, 1);
    }
  },
  _lgrad(ctx, col, r) {
    if (!this._gcache) this._gcache = new Map();
    const key = col + '|' + Math.round(r / 8);
    let g = this._gcache.get(key);
    if (!g) {
      const rr = Math.max(8, Math.round(r / 8) * 8);
      g = ctx.createRadialGradient(0, 0, 0, 0, 0, rr);
      g.addColorStop(0, col);
      g.addColorStop(.45, hexA(col, .35));
      g.addColorStop(1, hexA(col, 0));
      this._gcache.set(key, g);
      if (this._gcache.size > 120) this._gcache.clear();
    }
    return g;
  },
  drawLights(ctx) {
    if (OPT().lights === false || Game.quality() < 1 || !this.lights.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const l of this.lights) {
      const a = clamp(l.life / l.max, 0, 1) * l.p;
      const rr = Math.max(8, Math.round(l.r / 8) * 8);
      ctx.globalAlpha = a * .75;
      ctx.save();
      ctx.translate(l.x, l.y);
      ctx.scale(l.r / rr, l.r / rr);
      ctx.fillStyle = this._lgrad(ctx, l.col, l.r);
      ctx.beginPath(); ctx.arc(0, 0, rr, 0, TAU); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  },
  /* ---- Hitzeflimmern über Flammen ---- */
  hazes: [],
  haze(x, y, ang, r, half, life) {
    if (OPT().particles <= 0 || Game.quality() < 1) return;
    if (this.hazes.length > 26) return;
    this.hazes.push({ x: x, y: y, a: ang, r: r, h: half, life: life || .22, max: life || .22, seed: crnd(TAU) });
  },
  updateHazes(dt) {
    for (let i = this.hazes.length - 1; i >= 0; i--) { this.hazes[i].life -= dt; if (this.hazes[i].life <= 0) this.hazes.splice(i, 1); }
  },
  drawHazes(ctx) {
    if (!this.hazes.length) return;
    ctx.save();
    for (const h of this.hazes) {
      const a = clamp(h.life / h.max, 0, 1);
      ctx.globalAlpha = a * .16;
      ctx.strokeStyle = '#ffd9a0';
      for (let i = 1; i <= 4; i++) {
        const rr = h.r * (i / 4);
        ctx.lineWidth = 2 + Math.sin(Game.time * 22 + h.seed + i) * 1.4;
        ctx.beginPath();
        ctx.arc(h.x, h.y, rr + Math.sin(Game.time * 17 + h.seed + i * 1.7) * 3, h.a - h.h * .9, h.a + h.h * .9);
        ctx.stroke();
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  },
  telegraph(x, y, maxR, col, dur, shape, size) {
    const t = this.telegraphs.get();
    t.x = x; t.y = y; t.r = 0; t.max = maxR; t.col = col; t.life = dur; t.mx = dur;
    t.shape = shape || null; t.size = size || 0;
  },
  flash(x, y, ang, col, size) { const f = this.flashes.get(); f.x = x; f.y = y; f.ang = ang; f.col = col; f.life = .09; f.max = .09; f.size = size || 16; },
  update(dt, bossAlive) {
    this.particles.update((p, d) => {
      p.life -= d; if (p.life <= 0) { p.dead = true; return; }
      if (p.gy) p.vy += p.gy * d;
      p.x += p.vx * d; p.y += p.vy * d;
      const dg = Math.pow(p.dg != null ? p.dg : .02, d);
      p.vx *= dg; p.vy *= dg;
      if (p.grow) p.size += p.grow * d;
      p.rot += p.vr * d;
    }, dt);
    this.numbers.update((n, d) => { n.life -= d; if (n.life <= 0) { n.dead = true; return; } n.y += n.vy * d; n.vy *= Math.pow(.2, d); }, dt);
    this.rings.update((s, d) => { s.life -= d; if (s.life <= 0) { s.dead = true; return; } s.r = lerp(s.r, s.max, 1 - Math.pow(.002, d)); }, dt);
    this.lines.update((l, d) => { l.life -= d; if (l.life <= 0) l.dead = true; }, dt);
    this.beams.update((b, d) => { b.life -= d; if (b.life <= 0) b.dead = true; }, dt);
    this.cones.update((c, d) => { c.life -= d; if (c.life <= 0) c.dead = true; }, dt);
    this.shards.update((s, d) => {
      s.life -= d; if (s.life <= 0) { s.dead = true; return; }
      if (s.gy) s.vy += s.gy * d;
      s.x += s.vx * d; s.y += s.vy * d;
      const k = s.gy ? Math.pow(.35, d) : .9;
      s.vx *= k; s.vy *= s.gy ? k : .9;
      s.rot += s.vr * d; s.vr *= .93;
    }, dt);
    this.telegraphs.update((t, d) => {
      t.life -= d; if (t.life <= 0) t.dead = true;
      else { t.r = lerp(t.r, t.max, 1 - Math.pow(.001, d)); if (bossAlive && t.life / t.mx < .3) Game.cam.punch = Math.max(Game.cam.punch || 0, .18); }
    }, dt);
    this.flashes.update((f, d) => { f.life -= d; if (f.life <= 0) f.dead = true; }, dt);
    this.updateLights(dt); this.updateHazes(dt);
  },
  punch(cam) { cam.punch = Math.max(cam.punch || 0, .22); cam.shakeT = .18; cam.shake = 8; },
  /* Zeichnet EIN Partikel (ohne Schatten-State — den verwaltet der Aufrufer
     in zwei Passes, damit shadowBlur nicht pro Partikel umgeschaltet wird). */
  /* mode === 'layer': Glow als zweite, größere, transparente Zeichnung statt
     shadowBlur — Shadow-Rendering ist auf Mobile-Canyvas 10-30x teurer als ein
     normaler Fill. Bei kleinen Partikeln ist der Halo optisch kaum vom
     Schatten-Glow zu unterscheiden. mode === 'shadow': Schatten ist aktiv, nur
     Kern zeichnen. mode === 0: ohne Glow. */
  _paintParticle(ctx, p, mode, fs) {
    const lifeF = clamp(p.life / p.max, 0, 1);
    let al = lifeF * (p.a0 != null ? p.a0 : 1);
    if (p.fade) al *= lifeF;
    if (p.flick) al *= .55 + .45 * Math.sin(Game.time * p.flick + p.rot);
    const a = clamp(al, 0, 1);
    if (fs.col !== p.col) { ctx.fillStyle = p.col; fs.col = p.col; }
    if (p.shape === 'pixel') {
      const s = Math.max(1, Math.round(p.size));
      if (mode === 'layer') { ctx.globalAlpha = a * .16; ctx.fillRect(Math.round(p.x - s * 1.3), Math.round(p.y - s * 1.3), s * 2.6, s * 2.6); }
      ctx.globalAlpha = a;
      ctx.fillRect(Math.round(p.x - s / 2), Math.round(p.y - s / 2), s, s);
      return;
    }
    if (p.shape === 'streak') {
      const sp = Math.hypot(p.vx, p.vy);
      const ang = Math.atan2(p.vy, p.vx);
      const len = clamp(sp * .022, 2, 16);
      ctx.globalAlpha = a;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(ang);
      ctx.fillRect(-len, -p.size * .22, len, Math.max(1, p.size * .44));
      ctx.restore();
      return;
    }
    if (p.shape === 'smoke') {
      if (mode === 'layer') { ctx.globalAlpha = a * .14; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 1.7, 0, TAU); ctx.fill(); }
      ctx.globalAlpha = a;
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(.5, p.size), 0, TAU); ctx.fill();
      return;
    }
    if (p.shape === 'casing') {
      ctx.globalAlpha = a;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = '#d8b25a'; ctx.fillRect(-1.6, -.9, 3.2, 1.8);
      ctx.fillStyle = '#a8842f'; ctx.fillRect(1, -.9, .8, 1.8);
      ctx.restore();
      return;
    }
    /* Unrotierte Formen (rect, glint): direkt in Weltkoordinaten zeichnen —
       spart pro Partikel save/translate/rotate/restore (teure Matrix-Ops). */
    if (p.shape !== 'tri' && p.shape !== 'note') {
      if (mode === 'layer') {
        const hs = p.size * 1.3;
        ctx.globalAlpha = a * .16;
        ctx.fillRect(p.x - hs, p.y - hs, hs * 2, hs * 2);
      }
      ctx.globalAlpha = a;
      if (p.shape === 'glint') {
        if (mode === 'layer') {
          ctx.globalAlpha = a * .15;
          ctx.fillRect(p.x - p.size * 1.9, p.y - p.size * .53, p.size * 3.8, p.size * 1.06);
          ctx.fillRect(p.x - p.size * .53, p.y - p.size * 1.9, p.size * 1.06, p.size * 3.8);
          ctx.globalAlpha = a;
        }
        ctx.fillRect(p.x - p.size, p.y - p.size * .28, p.size * 2, p.size * .56);
        ctx.fillRect(p.x - p.size * .28, p.y - p.size, p.size * .56, p.size * 2);
      } else {
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
      return;
    }
    /* Rotierte Formen (tri, note) behalten die lokale Transformation */
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot || 0);
    if (p.shape === 'tri') {
      ctx.beginPath(); ctx.moveTo(0, -p.size); ctx.lineTo(p.size, p.size); ctx.lineTo(-p.size, p.size); ctx.closePath(); ctx.fill();
    } else {
      ctx.beginPath(); ctx.ellipse(-2.3, 2.6, 2.1, 1.6, 0, 0, TAU); ctx.fill();
      ctx.fillRect(-1, -4.6, 1.25, 7.2);
      ctx.fillRect(.25, -4.6, 2.5, 1.2);
      ctx.beginPath(); ctx.arc(.25, -4.6, .9, 0, TAU); ctx.fill();
    }
    ctx.restore();
  },
  draw(ctx) {
    /* shadowBlur ist teuer: volle Glow-Größe nur auf Qualität 2, dezenter auf 1, aus auf 0 */
    const gq = Game.quality();
    const glowBlur = gq === 2 ? 7 : gq === 1 ? 4 : 0;
    /* Partikel außerhalb des Sichtbereichs gar nicht zeichnen (Culling wie bei Gegnern) */
    const _cw = Game.cam ? Game.W / 2 / (Game.cam.zoom || 1) + 40 : 0;
    const _ch = Game.cam ? Game.H / 2 / (Game.cam.zoom || 1) + 40 : 0;
    const _cx = Game.cam ? Game.cam.x : 0, _cy = Game.cam ? Game.cam.y : 0;
    const list = this.particles.active;
    const vis = (p) => !_cw || (Math.abs(p.x - _cx) <= _cw + p.size * 2 && Math.abs(p.y - _cy) <= _ch + p.size * 2);
    /* Zwei Glow-Modi: Volle Qualität (gq 2 + kein FPS-Schutz) zeichnet den Glow
       als echten Schatten — aber in EINEM Durchgang (shadowBlur nur einmal an/
       aus, shadowColor nur bei Farbwechsel; vorher ~2000 State-Wechsel/Frame).
       Sobald die Auto-Qualität greift (niedriges FPS) oder die Mittelstufe läuft,
       wird der Glow als billiger 2-Layer-Halo gezeichnet (kein Schatten-Rendering
       = 10-30x günstiger auf Mobile) — Optik bei kleinen Partikeln praktisch gleich. */
    const layerGlow = glowBlur > 0 && (gq === 1 || (Game.autoQ || 1) < 1);
    const isGlow = (p) => p.glow || p.shape === 'glint';
    const fs = { col: '' };
    if (glowBlur && !layerGlow) {
      let sc = '';
      ctx.shadowBlur = glowBlur;
      for (const p of list) {
        if (!vis(p) || !isGlow(p)) continue;
        if (sc !== p.col) { ctx.shadowColor = p.col; sc = p.col; }
        this._paintParticle(ctx, p, 'shadow', fs);
      }
      ctx.shadowBlur = 0;
    }
    const gmode = layerGlow ? 'layer' : 0;
    /* Performance: Partikel nach Farbe sortieren, um FillStyle-Wechsel zu minimieren */
    if (list.length > 60) {
      list.sort((a, b) => a.col < b.col ? -1 : a.col > b.col ? 1 : 0);
    }
    for (const p of list) {
      if (!vis(p) || (!layerGlow && glowBlur && isGlow(p))) continue;
      this._paintParticle(ctx, p, (layerGlow && isGlow(p)) ? 'layer' : 0, fs);
    }
    ctx.globalAlpha = 1;
    for (const s of this.rings.active) {
      ctx.globalAlpha = clamp(s.life / s.mx, 0, 1) * (s.thin ? .5 : .8); ctx.strokeStyle = s.col; ctx.lineWidth = s.thin ? 1.2 : 3;
      ctx.shadowColor = s.col; ctx.shadowBlur = s.thin ? 5 : 14;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.stroke();
      ctx.shadowBlur = 0;
    }
    for (const l of this.lines.active) {
      ctx.globalAlpha = clamp(l.life / l.max, 0, 1); ctx.strokeStyle = l.col; ctx.lineWidth = l.w;
      ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); ctx.stroke();
    }
    for (const b of this.beams.active) {
      const a = clamp(b.life / b.max, 0, 1);
      ctx.globalAlpha = a; ctx.strokeStyle = b.col; ctx.lineWidth = b.w * a;
      ctx.shadowColor = b.col; ctx.shadowBlur = 16;
      ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = a * .35; ctx.lineWidth = b.w * 2.5 * a; ctx.stroke();
    }
    for (const c of this.cones.active) {
      ctx.globalAlpha = clamp(c.life / c.max, 0, 1) * .35; ctx.fillStyle = c.col;
      ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.arc(c.x, c.y, c.r, c.a - c.h, c.a + c.h); ctx.closePath(); ctx.fill();
    }
    for (const s of this.shards.active) {
      ctx.globalAlpha = clamp(s.life / s.max, 0, 1);
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.rot);
      ctx.fillStyle = s.col;
      if (s.shape === 'tri') {
        ctx.beginPath(); ctx.moveTo(0, -s.size); ctx.lineTo(s.size, s.size); ctx.lineTo(-s.size, s.size); ctx.closePath(); ctx.fill();
      } else {
        ctx.fillRect(-s.size/2, -s.size/3, s.size, s.size * .66);
      }
      ctx.restore();
    }
    for (const t of this.telegraphs.active) {
      const a = clamp(t.life / t.mx, 0, 1);
      const grow = clamp(1 - t.r / Math.max(1, t.max), 0, 1);
      ctx.globalAlpha = a * .5; ctx.strokeStyle = t.col; ctx.lineWidth = 2.5;
      ctx.shadowColor = t.col; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, TAU); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = a * .12; ctx.fillStyle = t.col;
      ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, TAU); ctx.fill();
      if (t.shape) {
        const r = Math.max(3, (t.size || 12) * (.35 + .65 * grow));
        ctx.globalAlpha = a * .85 * (.3 + .7 * grow);
        ctx.fillStyle = t.col; ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        const sh = t.shape;
        if (sh === 'tri') { ctx.moveTo(0, -r * 1.25); ctx.lineTo(r, r * .85); ctx.lineTo(-r, r * .85); ctx.closePath(); }
        else if (sh === 'box') { ctx.rect(-r * .9, -r * .9, r * 1.8, r * 1.8); }
        else if (sh === 'diamond') { ctx.moveTo(0, -r * 1.2); ctx.lineTo(r * .9, 0); ctx.lineTo(0, r * 1.2); ctx.lineTo(-r * .9, 0); ctx.closePath(); }
        else if (sh === 'hex') { for (let i = 0; i < 6; i++) { const aa = i / 6 * TAU; i ? ctx.lineTo(Math.cos(aa) * r, Math.sin(aa) * r) : ctx.moveTo(Math.cos(aa) * r, Math.sin(aa) * r); } ctx.closePath(); }
        else if (sh === 'star') { for (let i = 0; i < 10; i++) { const aa = i / 10 * TAU, rr = i % 2 ? r * .5 : r * 1.2; i ? ctx.lineTo(Math.cos(aa) * rr, Math.sin(aa) * rr) : ctx.moveTo(Math.cos(aa) * rr, Math.sin(aa) * rr); } ctx.closePath(); }
        else if (sh === 'cross') { ctx.rect(-r * .35, -r, r * .7, r * 2); ctx.rect(-r, -r * .35, r * 2, r * .7); }
        else ctx.arc(0, 0, r, 0, TAU);
        ctx.fill(); ctx.stroke();
      }
    }
    for (const f of this.flashes.active) {
      const a = clamp(f.life / f.max, 0, 1);
      const r = f.size * (1 - a + .3);
      ctx.globalAlpha = a;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * a;
      ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, TAU); ctx.stroke();
      ctx.strokeStyle = f.col; ctx.lineWidth = 3 * a;
      ctx.beginPath();
      ctx.moveTo(f.x + Math.cos(f.ang) * r * 1.2, f.y + Math.sin(f.ang) * r * 1.2);
      ctx.lineTo(f.x - Math.cos(f.ang) * r, f.y - Math.sin(f.ang) * r);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },
  drawNumbers(ctx) {
    ctx.textAlign = 'center';
    for (const n of this.numbers.active) {
      const a = clamp(n.life / .8, 0, 1);
      ctx.globalAlpha = a; ctx.fillStyle = n.col;
      ctx.font = 'bold ' + Math.round(12 * n.scale) + 'px monospace';
      ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.lineWidth = 3;
      ctx.strokeText(n.txt, n.x, n.y); ctx.fillText(n.txt, n.x, n.y);
    }
    ctx.globalAlpha = 1;
  },
  clear() { this.particles.clear(); this.numbers.clear(); this.rings.clear(); this.lines.clear(); this.beams.clear(); this.cones.clear(); this.shards.clear(); this.telegraphs.clear(); this.flashes.clear(); this.lights.length = 0; this.hazes.length = 0; }
};

/* ============================ 14b. WAFFEN- & PROJEKTIL-EFFEKTE ============================
   Jede Waffe bekommt ein eigenes Mündungsprofil (Blitz, Rauch, Funken, Hülsen,
   Druckring, Hitze) und jedes Projektil ein eigenes Aussehen samt Flugverhalten
   und Partikelspur. Alle Werte sind bewusst pixelig gehalten.
   ========================================================================================= */
const WEAPON_FX = {
  /* --- ballistisch --- */
  pistol:       { kind: 'ballistic', flash: 8, fcol: '#ffe6a8', smoke: 1, sparks: 1, casing: 1, ring: 0,  shake: 1.6, heat: 0 },
  smg:          { kind: 'ballistic', flash: 6, fcol: '#ffe6a8', smoke: 1, sparks: 1, casing: 1, ring: 0,  shake: 1.2, heat: 0 },
  chaingun:     { kind: 'ballistic', flash: 7, fcol: '#ffd58a', smoke: 1, sparks: 2, casing: 1, ring: 0,  shake: 1.5, heat: 2 },
  shotgun:      { kind: 'ballistic', flash: 13, fcol: '#ffd07a', smoke: 2, sparks: 4, casing: 1, ring: 13, shake: 4.2, heat: 1 },
  sniper:       { kind: 'ballistic', flash: 15, fcol: '#fff0c0', smoke: 3, sparks: 3, casing: 1, ring: 17, shake: 4.8, heat: 1 },
  needle:       { kind: 'ballistic', flash: 5,  fcol: '#dff4ff', smoke: 0, sparks: 1, casing: 0, ring: 0,  shake: .8, heat: 0 },
  turret:       { kind: 'ballistic', flash: 7, fcol: '#ffc37a', smoke: 1, sparks: 1, casing: 1, ring: 0,  shake: .6, heat: 0 },
  /* --- Energie --- */
  railgun:      { kind: 'elec',  flash: 16, fcol: '#dff6ff', smoke: 1, sparks: 5, casing: 0, ring: 20, shake: 5.2, heat: 3 },
  plasma:       { kind: 'energy',flash: 11, fcol: '#c8a6ff', smoke: 1, sparks: 2, casing: 0, ring: 10, shake: 3.2, heat: 3 },
  photon:       { kind: 'light', flash: 9, fcol: '#fff6c8', smoke: 0, sparks: 2, casing: 0, ring: 7, shake: 2.0, heat: 1 },
  tesla:        { kind: 'elec',  flash: 8, fcol: '#ffe27a', smoke: 0, sparks: 3, casing: 0, ring: 6, shake: 2.2, heat: 0 },
  arc:          { kind: 'elec',  flash: 10, fcol: '#a6e6ff', smoke: 1, sparks: 4, casing: 0, ring: 9, shake: 2.8, heat: 1 },
  sonic:        { kind: 'sonic', flash: 12, fcol: '#ffb0e0', smoke: 0, sparks: 0, casing: 0, ring: 23, shake: 3.6, heat: 0 },
  gravgun:      { kind: 'grav',  flash: 10, fcol: '#a06bff', smoke: 1, sparks: 1, casing: 0, ring: 15, shake: 3.4, heat: 0 },
  vortex:       { kind: 'grav',  flash: 5, fcol: '#ff2e88', smoke: 1, sparks: 1, casing: 0, ring: 8, shake: 1.0, heat: 0 },
  starfall:     { kind: 'light', flash: 8, fcol: '#ffe27a', smoke: 0, sparks: 2, casing: 0, ring: 5, shake: 1.6, heat: 0 },
  /* --- Elementar --- */
  flamer:       { kind: 'fire',  flash: 10, fcol: '#ff9a3d', smoke: 3, sparks: 2, casing: 0, ring: 0,  shake: 1.4, heat: 6 },
  frost:        { kind: 'ice',   flash: 8, fcol: '#bfefff', smoke: 1, sparks: 2, casing: 0, ring: 6, shake: 1.4, heat: 0 },
  spore:        { kind: 'bio',   flash: 6, fcol: '#8dff5c', smoke: 1, sparks: 1, casing: 0, ring: 4,  shake: 1.2, heat: 0 },
  loeschwasser: { kind: 'water', flash: 6, fcol: '#8fd8ff', smoke: 1, sparks: 0, casing: 0, ring: 5, shake: 1.6, heat: 0 },
  musiknoten:   { kind: 'music', flash: 7, fcol: '#ff5ce0', smoke: 0, sparks: 1, casing: 0, ring: 5, shake: 1.0, heat: 0 },
  ratschlaege:  { kind: 'voice', flash: 7, fcol: '#ffd24a', smoke: 0, sparks: 1, casing: 0, ring: 4,  shake: .9, heat: 0 },
  medgun:       { kind: 'light', flash: 6, fcol: '#8affb0', smoke: 0, sparks: 1, casing: 0, ring: 4,  shake: .8, heat: 0 },
  shredder:     { kind: 'saw',   flash: 6, fcol: '#ffb24a', smoke: 1, sparks: 3, casing: 0, ring: 0,  shake: 1.6, heat: 1 },
  /* --- Nahkampf --- */
  knife:        { kind: 'melee', flash: 10, fcol: '#e8f2ff', smoke: 0, sparks: 1, casing: 0, ring: 0, shake: 1.2, heat: 0 },
  spear:        { kind: 'melee', flash: 12, fcol: '#d8ffb0', smoke: 0, sparks: 1, casing: 0, ring: 0, shake: 1.4, heat: 0 },
  hammer:       { kind: 'melee', flash: 15, fcol: '#ffd9a0', smoke: 2, sparks: 4, casing: 0, ring: 12, shake: 4.0, heat: 0 },
  wrench:       { kind: 'melee', flash: 12, fcol: '#ffe08a', smoke: 1, sparks: 3, casing: 0, ring: 0, shake: 1.8, heat: 0 },
  chopper:      { kind: 'melee', flash: 13, fcol: '#ffd7a1', smoke: 1, sparks: 2, casing: 0, ring: 0, shake: 2.0, heat: 0 },
  nunchaku:     { kind: 'melee', flash: 11, fcol: '#ffe08a', smoke: 0, sparks: 2, casing: 0, ring: 0, shake: 1.4, heat: 0 },
  /* --- neue Waffen --- */
  nagler:       { kind: 'ballistic', flash: 5, fcol: '#e8eef6', smoke: 1, sparks: 1, casing: 1, ring: 0,  shake: 1.0, heat: 0 },
  schrottkanone:{ kind: 'ballistic', flash: 14, fcol: '#ffcf8a', smoke: 3, sparks: 5, casing: 1, ring: 15, shake: 4.6, heat: 1 },
  bierwerfer:   { kind: 'melee',     flash: 8, fcol: '#ffd98a', smoke: 1, sparks: 1, casing: 0, ring: 6, shake: 2.2, heat: 0 },
  magnetmine:   { kind: 'elec',      flash: 9, fcol: '#ff9a5c', smoke: 1, sparks: 3, casing: 0, ring: 8, shake: 2.6, heat: 0 },
  taubenschwarm:{ kind: 'bio',       flash: 6, fcol: '#dfe7f0', smoke: 1, sparks: 0, casing: 0, ring: 5, shake: 1.0, heat: 0 },
  kettensaege:  { kind: 'saw',       flash: 7, fcol: '#ffb24a', smoke: 1, sparks: 4, casing: 0, ring: 0,  shake: 2.0, heat: 2 },
  laserzirkel:  { kind: 'light',     flash: 7, fcol: '#8ff0ff', smoke: 0, sparks: 1, casing: 0, ring: 6, shake: .8, heat: 0 },
  blitzableiter:{ kind: 'elec',      flash: 11, fcol: '#ffe27a', smoke: 0, sparks: 4, casing: 0, ring: 10, shake: 2.4, heat: 0 },
  klingel:      { kind: 'voice',     flash: 6, fcol: '#ffc93c', smoke: 0, sparks: 2, casing: 0, ring: 7, shake: .7, heat: 0 }
};
const weaponFx = (id, type) => WEAPON_FX[id] || WEAPON_FX[
  type === 'melee' ? 'knife' : type === 'chain' ? 'tesla' : type === 'hitscan' ? 'railgun' :
  type === 'cone' ? 'flamer' : type === 'charge' ? 'arc' : 'pistol'];

/* Projektil-Erscheinung: Form, Farbe, Spurtyp und Flugverhalten */
const PROJ_FX = {
  pistol:      { style: 'bullet',  trail: 'spark',  len: 9,  glow: .5 },
  smg:         { style: 'bullet',  trail: 'spark',  len: 7,  glow: .4 },
  chaingun:    { style: 'bullet',  trail: 'spark',  len: 8,  glow: .5 },
  shotgun:     { style: 'pellet',  trail: 'spark',  len: 5,  glow: .4 },
  sniper:      { style: 'tracer',  trail: 'tracer', len: 22, glow: .9 },
  needle:      { style: 'needle',  trail: 'thin',   len: 12, glow: .5 },
  turret:      { style: 'bullet',  trail: 'spark',  len: 8,  glow: .5 },
  plasma:      { style: 'orb',     trail: 'plasma', pulse: 1, glow: 1 },
  photon:      { style: 'lance',   trail: 'light',  len: 16, glow: 1 },
  frost:       { style: 'crystal', trail: 'frost',  spin: 5, glow: .7 },
  spore:       { style: 'blob',    trail: 'spore',  wob: 1.4, glow: .5 },
  gravgun:     { style: 'void',    trail: 'grav',   spin: 2, glow: .8 },
  starfall:    { style: 'star',    trail: 'sparkle', spin: 4, glow: .9 },
  shredder:    { style: 'saw',     trail: 'spark',  spin: 22, glow: .5 },
  loeschwasser:{ style: 'droplet', trail: 'water',  glow: .3 },
  medgun:      { style: 'orb',     trail: 'light',  pulse: 1, glow: .8 },
  vortex:      { style: 'void',    trail: 'grav',   spin: 3, glow: .7 },
  arc:         { style: 'lance',   trail: 'elec',   len: 14, glow: 1 },
  tesla:       { style: 'lance',   trail: 'elec',   len: 12, glow: 1 },
  leg_rheingold: { style: 'pellet', trail: 'spark', len: 6, glow: .6 },
  leg_neroberg:  { style: 'lance',  trail: 'elec',  len: 14, glow: 1 },
  leg_thermal:   { style: 'orb',    trail: 'fire',  pulse: 1, glow: 1 },
  nagler:        { style: 'needle', trail: 'thin',  len: 11, glow: .4 },
  schrottkanone: { style: 'pellet', trail: 'spark', len: 6,  glow: .4 },
  bierwerfer:    { style: 'crate',  trail: 'spark', spin: 7, glow: .3 },
  magnetmine:    { style: 'mine',   trail: 'elec',  spin: 4, glow: .8 },
  taubenschwarm: { style: 'bird',   trail: 'feather', wob: 1.1, glow: .3 },
  laserzirkel:   { style: 'lance',  trail: 'light', len: 14, glow: 1 },
  blitzableiter: { style: 'lance',  trail: 'elec',  len: 13, glow: 1 }
};
const projFx = (src) => PROJ_FX[src] || { style: 'bullet', trail: 'spark', len: 8, glow: .5 };

/* ---- Detaillierte Waffensprites in der Hand des Charakters ---- */
const WP_STATIC_IDS = new Set(['pistol', 'smg', 'shotgun', 'medgun', 'needle', 'knife', 'spear', 'hammer', 'wrench', 'chopper', 'nagler', 'schrottkanone', 'bierwerfer', 'musiknoten', 'ratschlaege', 'starfall']);
const WP_IMG_CACHE = {};
function drawWeaponBaseShape(ctx, def, w, t) {
  const c = def.col;
  const dark = shade(c, -.35), light = shade(c, .35);
  const metal = '#aeb6c4', metalD = '#6d7686', wood = '#8a5f34', grip = '#2b3140';
  const id = def.id;
  const heat = clamp((w.sub || 0) % 12 / 12, 0, 1);
  const bar = (x, y, ww, hh, col) => { ctx.fillStyle = col; ctx.fillRect(x, y, ww, hh); };
  const glowDot = (x, y, r, col, a) => { ctx.globalAlpha = a != null ? a : .85; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; };
  switch (id) {
    case 'pistol':
      bar(-3, -2.2, 13, 4.4, metal); bar(-3, -2.2, 4, 4.4, metalD);
      bar(8, -1.6, 4, 3.2, '#3a4150'); bar(-1, 1.6, 4, 5, grip);
      bar(2, -3.2, 5, 1.2, metalD);
      break;
    case 'smg':
      bar(-4, -2, 15, 4, '#3c4352'); bar(9, -1.4, 5, 2.8, metalD);
      bar(-1, 1.8, 3.4, 6, grip); bar(1, -3.4, 7, 1.4, metal);
      bar(-6, -1, 3, 2, '#2a3140');
      break;
    case 'shotgun':
      bar(-5, -2.8, 20, 5.6, wood); bar(3, -2.8, 14, 2.4, metalD);
      bar(3, .4, 14, 2.4, metal); bar(15, -3, 4, 6, '#2f3542');
      bar(-2, 2, 4, 4, grip);
      break;
    case 'chaingun': {
      bar(-6, -3.4, 12, 6.8, metalD);
      for (let i = 0; i < 4; i++) {
        const off = Math.sin(t * 22 + i * 1.6) * 1.6;
        bar(5, -2.6 + i * 1.5 + off * .2, 14, 1.2, i % 2 ? metal : '#8f97a6');
      }
      bar(-8, -2, 3, 4, '#242a37'); glowDot(4, 0, 1.6, '#ffb24a', .5 + heat * .5);
      break;
    }
    case 'sniper':
      bar(-7, -1.8, 26, 3.6, '#2f3542'); bar(10, -1.2, 12, 2.4, metalD);
      bar(-1, -5, 10, 2.6, '#1c2230'); glowDot(7, -3.7, 1, '#59e6ff', .8);
      bar(-4, 1.6, 4, 5, grip); bar(-9, -1.4, 3, 2.8, wood);
      break;
    case 'medgun':
      bar(-3, -2.4, 14, 4.8, '#e8f2ff'); bar(9, -1.6, 5, 3.2, '#8affb0');
      bar(-1, 1.8, 3.4, 5, '#7a8496');
      ctx.fillStyle = '#ff5d6e'; ctx.fillRect(1, -1.2, 4.4, 1.4); ctx.fillRect(2.5, -2.7, 1.4, 4.4);
      break;
    case 'shredder': {
      bar(-4, -2, 12, 4, metalD);
      ctx.save(); ctx.translate(12, 0); ctx.rotate(t * 16);
      ctx.fillStyle = metal;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) { const a = i / 8 * TAU, rr = i % 2 ? 3 : 5.4; i ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      ctx.closePath(); ctx.fill();
      ctx.restore();
      break;
    }
    case 'railgun':
      bar(-7, -3, 24, 6, '#2b3242'); bar(-7, -3, 24, 1.6, '#3d4658');
      bar(6, -4.6, 12, 1.4, metal); bar(6, 3.2, 12, 1.4, metal);
      glowDot(16, 0, 2 + Math.sin(t * 9) * .6, '#c0f0ff', .9);
      for (let i = 0; i < 3; i++) glowDot(2 + i * 5, -3.8, 1, '#59e6ff', .5 + .4 * Math.sin(t * 7 + i));
      break;
    case 'plasma':
      bar(-4, -3, 16, 6, '#39304a'); bar(10, -2.2, 5, 4.4, '#5a4a7a');
      glowDot(14, 0, 2.6 + Math.sin(t * 8) * .7, '#c8a6ff', .9);
      glowDot(-1, 0, 2, '#a06bff', .5 + .3 * Math.sin(t * 5));
      break;
    case 'sonic':
      bar(-4, -2.4, 12, 4.8, '#4a2f46');
      ctx.strokeStyle = '#ffb0e0'; ctx.lineWidth = 1.2;
      for (let i = 0; i < 3; i++) { ctx.globalAlpha = .8 - i * .22; ctx.beginPath(); ctx.arc(9, 0, 4 + i * 3 + Math.sin(t * 7) * .8, -.9, .9); ctx.stroke(); }
      ctx.globalAlpha = 1;
      break;
    case 'klingel': {
      bar(-4, -2.4, 10, 4.8, '#3a4150');
      ctx.fillStyle = '#ffc93c';
      ctx.beginPath(); ctx.arc(9.5, 0, 4.4, Math.PI, 0); ctx.fill();
      ctx.fillRect(5.1, -2.8, 4.4, 5.6);
      ctx.fillStyle = '#8e5a1a'; ctx.fillRect(8.6, -4.6, 1.8, 2.4);
      ctx.fillStyle = '#fff2c0'; ctx.beginPath(); ctx.arc(9.5, 3.2, 1.4, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = .9; ctx.globalAlpha = .5 + .3 * Math.sin(t * 12);
      ctx.beginPath(); ctx.arc(12.5, 0, 5 + Math.sin(t * 10) * .7, -.7, .7); ctx.stroke();
      ctx.globalAlpha = 1;
      glowDot(12, -3.6, 1.1, '#ffc93c', .6 + .3 * Math.sin(t * 8));
      break;
    }
    case 'gravgun':
      bar(-5, -3, 15, 6, '#2e2a44'); bar(9, -4, 4, 8, '#4a3f6e');
      ctx.strokeStyle = '#a06bff'; ctx.lineWidth = 1.4; ctx.globalAlpha = .8;
      ctx.beginPath(); ctx.arc(15, 0, 4.5 + Math.sin(t * 4) * 1.1, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
      glowDot(15, 0, 1.8, '#e0d0ff', .9);
      break;
    case 'tesla': case 'leg_neroberg': {
      bar(-4, -2.2, 12, 4.4, '#2f3542'); bar(8, -3, 3, 6, metalD);
      glowDot(13, 0, 2.2 + Math.sin(t * 14) * .8, '#ffe27a', .9);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = .8; ctx.globalAlpha = .7;
      for (let i = 0; i < 2; i++) {
        ctx.beginPath(); ctx.moveTo(11, 0);
        ctx.lineTo(14 + rnd(-2, 2), rnd(-3, 3)); ctx.lineTo(17 + rnd(-2, 2), rnd(-3, 3));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 'frost':
      bar(-4, -2.6, 15, 5.2, '#3a4d5c'); bar(9, -3.2, 5, 6.4, '#7fb6d0');
      glowDot(14, 0, 2.2, '#bfefff', .9);
      ctx.fillStyle = '#e8fbff';
      for (let i = 0; i < 3; i++) ctx.fillRect(2 + i * 3, -3.6 - Math.sin(t * 3 + i) * .6, 1.4, 1.4);
      break;
    case 'spore':
      bar(-4, -2.4, 13, 4.8, '#3d4a2e'); bar(8, -3.4, 6, 6.8, '#5c7a3a');
      glowDot(13, 0, 2.4 + Math.sin(t * 3) * .5, '#8dff5c', .85);
      glowDot(-2, -1, 1.6, '#b8d98a', .6);
      break;
    case 'photon':
      bar(-4, -2, 16, 4, '#e6e9f2'); bar(10, -1.4, 6, 2.8, '#fff6c8');
      glowDot(16, 0, 2.4 + Math.sin(t * 11) * .7, '#ffffff', .95);
      bar(-1, -3.4, 8, 1.2, '#ffe27a');
      break;
    case 'arc':
      bar(-5, -2.6, 15, 5.2, '#26323f');
      bar(9, -4, 2.4, 8, metalD); bar(13, -3, 2.4, 6, metalD);
      ctx.strokeStyle = '#a6e6ff'; ctx.lineWidth = 1; ctx.globalAlpha = .85;
      ctx.beginPath(); ctx.moveTo(10, -2 + rnd(-1, 1)); ctx.lineTo(14, rnd(-2, 2)); ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    case 'needle':
      bar(-3, -1.6, 14, 3.2, '#dfe7f0'); bar(11, -.8, 6, 1.6, metal);
      bar(-1, 1.4, 3, 4, '#8f97a6');
      break;
    case 'vortex':
      bar(-3, -2, 10, 4, '#3a2036');
      ctx.strokeStyle = '#ff2e88'; ctx.lineWidth = 1.4; ctx.globalAlpha = .75;
      for (let i = 0; i < 2; i++) { ctx.beginPath(); ctx.arc(8, 0, 4 + i * 3.2, t * 3 + i, t * 3 + i + 3.6); ctx.stroke(); }
      ctx.globalAlpha = 1;
      break;
    case 'starfall':
      bar(-6, -1.4, 14, 2.8, wood);
      ctx.strokeStyle = '#ffe27a'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(2, 0, 8, -1.25, 1.25); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = .7;
      ctx.beginPath(); ctx.moveTo(2 + Math.cos(-1.25) * 8, Math.sin(-1.25) * 8); ctx.lineTo(2 + Math.cos(1.25) * 8, Math.sin(1.25) * 8); ctx.stroke();
      break;
    case 'loeschwasser':
      bar(-4, -2.4, 14, 4.8, '#c0392b'); bar(10, -1.8, 6, 3.6, metal);
      bar(-6, -1.6, 3, 3.2, '#8a2a1e');
      glowDot(16, 0, 1.6, '#59e6ff', .8);
      break;
    case 'musiknoten':
      bar(-3, -2, 12, 4, '#3b2a52');
      ctx.fillStyle = '#ff5ce0';
      ctx.beginPath(); ctx.ellipse(11, 2, 2.6, 2, 0, 0, TAU); ctx.fill();
      ctx.fillRect(12.6, -4.4, 1.3, 6.4); ctx.fillRect(13.9, -4.4, 2.6, 1.2);
      break;
    case 'ratschlaege':
      bar(-3, -2, 11, 4, '#8a5cff');
      ctx.fillStyle = '#ffd24a';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(8, -3.6, 9, 6.4, 2); else ctx.rect(8, -3.6, 9, 6.4);
      ctx.fill();
      ctx.beginPath(); ctx.moveTo(9.5, 2.6); ctx.lineTo(9, 5.4); ctx.lineTo(12, 2.6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(30,20,4,.8)';
      ctx.fillRect(9.6, -1.8, 5.6, .9); ctx.fillRect(9.6, -.2, 4.2, .9);
      break;
    case 'flamer': case 'leg_thermal':
      bar(-5, -2.4, 15, 4.8, '#6a3a24'); bar(9, -3, 6, 6, '#2f3542');
      bar(-8, -3.4, 4, 6.8, '#8a2a1e');
      glowDot(16, 0, 2 + Math.sin(t * 18) * .9, Math.random() < .5 ? '#ff9a3d' : '#ffcf4a', .9);
      break;
    case 'knife':
      bar(-4, -1.2, 5, 2.4, grip);
      ctx.fillStyle = '#dfe7f0';
      ctx.beginPath(); ctx.moveTo(1, -1.8); ctx.lineTo(15, -.6); ctx.lineTo(15, .8); ctx.lineTo(1, 1.8); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.fillRect(3, -.7, 10, .7);
      break;
    case 'spear':
      bar(-6, -1.4, 20, 2.8, wood);
      ctx.fillStyle = '#cfe8a8';
      ctx.beginPath(); ctx.moveTo(13, -4); ctx.lineTo(21, 0); ctx.lineTo(13, 4); ctx.closePath(); ctx.fill();
      bar(11, -2.4, 2, 4.8, metalD);
      break;
    case 'hammer':
      bar(-5, -1.6, 17, 3.2, wood);
      bar(11, -5, 7, 10, metalD); bar(11, -5, 7, 2, metal);
      bar(17, -3.4, 2.4, 6.8, '#4a5464');
      break;
    case 'schrauber': {
      /* Denises Schlagschrauber: Air-Force-Oliv-Gehäuse, rotierendes Futter, Technik-Glow */
      bar(-4, -2.2, 13, 4.4, '#3a4f3a');
      bar(-4, -2.2, 13, 1.6, '#4a644a');
      bar(7, -1.4, 6, 2.8, metalD);
      bar(-2, 1.6, 3.4, 5, grip);
      ctx.save(); ctx.translate(13.5, 0); ctx.rotate(t * 14);
      ctx.fillStyle = metal;
      ctx.beginPath(); ctx.arc(0, 0, 2.6, 0, TAU); ctx.fill();
      ctx.fillStyle = '#0d1220';
      ctx.beginPath(); ctx.arc(0, 0, 1.3, 0, TAU); ctx.fill();
      ctx.restore();
      glowDot(13.5, 0, 1.7, '#a8c4e8', .55 + heat * .4);
      bar(1, -3.4, 6, 1.2, '#6a8a6a');
      break;
    }
    case 'wrench':
      bar(-4, -1.4, 15, 2.8, metal);
      bar(11, -3.4, 3, 6.8, metal);
      ctx.fillStyle = '#0d1220'; ctx.fillRect(13, -1.6, 3, 3.2);
      bar(-6, -1.2, 3, 2.4, '#8a5a1a');
      break;
    case 'chopper':
      bar(-4, -1.4, 10, 2.8, '#5a3a20');
      ctx.fillStyle = '#e8eef6';
      ctx.beginPath(); ctx.moveTo(6, -4.4); ctx.lineTo(19, -3); ctx.lineTo(19, 4); ctx.lineTo(6, 4.4); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#b6c2d0'; ctx.fillRect(7, -3.4, 10, 1.4);
      break;
    case 'nunchaku': {
      const sw = Math.sin(t * 9) * .6;
      bar(-2, -1.2, 8, 2.4, wood);
      ctx.save(); ctx.translate(7, 0); ctx.rotate(1.2 + sw);
      bar(0, -1.1, 8, 2.2, wood);
      ctx.restore();
      ctx.strokeStyle = '#c9ccd6'; ctx.lineWidth = .8;
      ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(8, 1.6); ctx.stroke();
      break;
    }
    case 'nagler':
      bar(-3, -1.8, 13, 3.6, metal); bar(10, -1.2, 5, 2.4, metalD);
      bar(-1, 1.6, 3.2, 5, grip);
      ctx.fillStyle = '#e8eef6';
      for (let i = 0; i < 3; i++) ctx.fillRect(2 + i * 2.4, -3.4, 1.2, 1.6);
      break;
    case 'schrottkanone':
      bar(-6, -3.2, 20, 6.4, '#6b5a3a');
      bar(4, -3.6, 13, 7.2, metalD);
      ctx.fillStyle = '#b08a4a';
      for (let i = 0; i < 4; i++) ctx.fillRect(5 + i * 3, -3.2 + (i % 2) * 3.4, 2.4, 2.4);
      bar(-2, 2.4, 4, 4.6, grip);
      break;
    case 'bierwerfer':
      bar(-5, -1.8, 12, 3.6, metalD);
      ctx.fillStyle = '#8a5f34'; ctx.fillRect(7, -5, 9, 10);
      ctx.fillStyle = '#e0a83a';
      for (let i = 0; i < 3; i++) ctx.fillRect(8, -4 + i * 3.2, 7, 2.2);
      ctx.fillStyle = '#5c3f22'; ctx.fillRect(7, -.6, 9, 1.2);
      break;
    case 'magnetmine':
      bar(-4, -2.4, 13, 4.8, '#3a2b24');
      ctx.fillStyle = '#ff6b3d';
      ctx.beginPath(); ctx.arc(13, 0, 3.6, 0, TAU); ctx.fill();
      ctx.fillStyle = '#8f97a6';
      for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + t * 2; ctx.fillRect(13 + Math.cos(a) * 4.6 - 1, Math.sin(a) * 4.6 - 1, 2, 2); }
      glowDot(13, 0, 1.4, '#ffdf9a', .9);
      break;
    case 'taubenschwarm':
      bar(-4, -2.6, 12, 5.2, '#5a6274');
      ctx.fillStyle = '#dfe7f0';
      for (let i = 0; i < 3; i++) {
        const fy = Math.sin(t * 6 + i * 1.4) * 1.4;
        ctx.beginPath();
        ctx.moveTo(11 + i * .6, fy); ctx.lineTo(15 + i * .6, fy - 2); ctx.lineTo(15 + i * .6, fy + 2);
        ctx.closePath(); ctx.fill();
      }
      break;
    case 'kettensaege': {
      bar(-5, -2.6, 11, 5.2, '#c0392b');
      bar(-2, 2.6, 4, 4, grip);
      ctx.fillStyle = metalD; ctx.fillRect(5, -2.2, 14, 4.4);
      ctx.fillStyle = '#e8eef6';
      const off = (t * 60) % 3;
      for (let i = 0; i < 6; i++) {
        const px2 = 6 + ((i * 3 + off) % 14);
        ctx.fillRect(px2, -3.4, 1.6, 1.4);
        ctx.fillRect(px2, 2, 1.6, 1.4);
      }
      glowDot(2, -3.4, 1, '#ff8a3d', .5 + .4 * Math.sin(t * 24));
      break;
    }
    case 'laserzirkel': {
      bar(-3, -2, 9, 4, '#26323f');
      ctx.strokeStyle = '#59e6ff'; ctx.lineWidth = 1.4;
      for (let i = 0; i < 2; i++) {
        const a = t * 5 + i * Math.PI;
        ctx.globalAlpha = .8;
        ctx.beginPath();
        ctx.moveTo(7, 0);
        ctx.lineTo(7 + Math.cos(a) * 11, Math.sin(a) * 11);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      glowDot(7, 0, 2, '#8ff0ff', .9);
      break;
    }
    case 'blitzableiter': {
      bar(-4, -1.4, 8, 2.8, '#4a5464');
      ctx.fillStyle = '#cfd6e2'; ctx.fillRect(4, -1.2, 12, 2.4);
      ctx.fillStyle = '#ffe27a';
      ctx.beginPath(); ctx.moveTo(16, -4); ctx.lineTo(20, 0); ctx.lineTo(16, 4); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = .8; ctx.globalAlpha = .7;
      ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(21 + rnd(-2, 2), rnd(-3, 3)); ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    }
    case 'leg_rheingold':
      bar(-5, -2.8, 20, 5.6, '#7a5a1a'); bar(3, -2.8, 14, 2.4, '#ffcf4a');
      bar(3, .4, 14, 2.4, '#e8b94a'); glowDot(17, 0, 1.8, '#fff2c0', .8);
      break;
    default:
      if (def.type === 'melee') {
        bar(-3, -1.4, 7, 2.8, grip);
        ctx.fillStyle = light;
        ctx.beginPath(); ctx.moveTo(4, -2.2); ctx.lineTo(15, -1); ctx.lineTo(15, 1); ctx.lineTo(4, 2.2); ctx.closePath(); ctx.fill();
      } else if (def.type === 'aura') {
        bar(-2, -2, 8, 4, c);
        ctx.strokeStyle = c; ctx.globalAlpha = .45; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(6, 0, 8 + Math.sin(t * 4) * 1.4, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
      } else {
        bar(-3, -2.4, 14, 4.8, c); bar(-3, -2.4, 4, 4.8, dark);
        bar(7, -1.8, 6, 3.6, light);
      }
  }
}
function drawWeaponSprite(ctx, def, w, t) {
  const kick = w.kick || 0;
  const id = def.id;
  if (WP_STATIC_IDS.has(id)) {
    let cv = WP_IMG_CACHE[id];
    if (!cv) {
      cv = document.createElement('canvas'); cv.width = 32; cv.height = 16;
      const x = cv.getContext('2d'); x.translate(10, 8);
      drawWeaponBaseShape(x, def, w, t);
      WP_IMG_CACHE[id] = cv;
    }
    ctx.drawImage(cv, -10, -8);
  } else {
    drawWeaponBaseShape(ctx, def, w, t);
  }
  /* Montierte Aufsätze sichtbar machen */
  if (w.attach && w.attach.length) {
    for (let i = 0; i < w.attach.length; i++) {
      const a = ATT_BY_ID[w.attach[i]];
      if (!a) continue;
      if (a.id === 'suppressor') { ctx.fillStyle = '#20242e'; ctx.fillRect(12, -2.6, 8, 5.2); ctx.fillStyle = '#39404e'; ctx.fillRect(12, -2.6, 8, 1.2); }
      else if (a.id === 'brake') { ctx.fillStyle = '#8a929f'; ctx.fillRect(12, -3, 5, 6); ctx.fillStyle = '#0d1220'; ctx.fillRect(13.4, -3, 1, 6); ctx.fillRect(15.2, -3, 1, 6); }
      else if (a.id === 'scope') { ctx.fillStyle = '#151b28'; ctx.fillRect(0, -5.4, 9, 2.6); ctx.fillStyle = a.col; ctx.fillRect(7.4, -5, 1.4, 1.8); }
      else if (a.id === 'extmag') { ctx.fillStyle = '#2c3444'; ctx.fillRect(1, 2.2, 4, 6); ctx.fillStyle = a.col; ctx.fillRect(1, 7, 4, 1.2); }
      else if (a.id === 'heavybarrel') { ctx.fillStyle = '#5d6675'; ctx.fillRect(6, -3.2, 10, 6.4); }
      else { ctx.fillStyle = a.col; ctx.globalAlpha = .9; ctx.fillRect(2 + i * 4, -5.2, 2.6, 2.6); ctx.globalAlpha = 1; }
    }
  }
  /* Ladeanzeige, Hitze und Rückstoß */
  if (def.type === 'charge' && w.charge > .25) {
    ctx.globalAlpha = w.charge * .6;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(16, 0, 3 + w.charge * 4, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (kick > .35) {
    ctx.globalAlpha = (kick - .35) * 1.3;
    ctx.fillStyle = def.type === 'melee' ? '#ffffff' : '#fff2c0';
    ctx.beginPath(); ctx.arc(def.type === 'melee' ? 11 : 15, 0, 2.5 + kick * 3, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }
}

/* ============================ 14c. WAFFEN-AUFSÄTZE ============================
   Aufsätze hängen an einem einzelnen Waffenplatz und verändern Werte,
   Klang und Optik. Pro Waffe maximal zwei, jeder Typ nur einmal.
   ============================================================================= */
const ATT_MAX = 2;
const ATTACHMENTS = [
  { id: 'suppressor', name: 'Schalldämpfer', icon: '▬', price: 26, col: '#9fb4d8',
    m: { dmg: .92, quiet: 1, aggro: .35, critC: .05 },
    desc: 'Dämpft den Schuss stark, Gegner orten dich schlechter.', st: '−8% Schaden · +5% Krit · leise · −35% Aufmerksamkeit' },
  { id: 'brake', name: 'Mündungsbremse', icon: '╪', price: 22, col: '#ffcf4a',
    m: { spread: .55, kick: 1.35, range: 1.06 },
    desc: 'Bündelt die Garbe, dafür schlägt die Waffe deutlich stärker aus.', st: '−45% Streuung · +6% Reichweite · +35% Rückstoß' },
  { id: 'extmag', name: 'Erweitertes Magazin', icon: '▮', price: 24, col: '#8affb0',
    m: { rate: 1.18, dmg: .95 },
    desc: 'Mehr Schuss in kürzerer Zeit, dafür etwas weniger Wucht.', st: '+18% Feuerrate · −5% Schaden' },
  { id: 'heavybarrel', name: 'Schwerer Lauf', icon: '█', price: 28, col: '#ff8a5c',
    m: { dmg: 1.17, rate: .90, range: 1.1 },
    desc: 'Massiver Lauf: härtere, langsamere Schüsse mit mehr Reichweite.', st: '+17% Schaden · +10% Reichweite · −10% Feuerrate' },
  { id: 'scope', name: 'Zielfernrohr', icon: '◎', price: 25, col: '#59e6ff',
    m: { range: 1.22, critC: .08, rate: .96 },
    desc: 'Deutlich mehr Reichweite und Präzision.', st: '+22% Reichweite · +8% Krit-Chance · −4% Feuerrate' },
  { id: 'hollow', name: 'Hohlspitzgeschosse', icon: '◇', price: 27, col: '#ff5d6e',
    m: { critM: 1.3, pierce: -1, dmg: 1.05 },
    desc: 'Zerlegt weiche Ziele, bleibt aber im ersten stecken.', st: '+30% Krit-Schaden · +5% Schaden · −1 Durchschlag' },
  { id: 'incend', name: 'Brandsatz', icon: '≈', price: 30, col: '#ff9a3d',
    m: { burn: 9, dmg: .97 },
    desc: 'Treffer entzünden das Ziel.', st: 'Treffer verbrennen (9/s) · −3% Schaden' },
  { id: 'cryo', name: 'Kühlmantel', icon: '❄', price: 29, col: '#bfefff',
    m: { slow: .3, slowT: 1.4, rate: 1.05 },
    desc: 'Kühlt Lauf und Ziel herunter.', st: 'Treffer verlangsamen 30% · +5% Feuerrate' },
  { id: 'penetrator', name: 'Panzerbrecher', icon: '➤', price: 32, col: '#cfd2dc',
    m: { pierce: 1, armorPierce: 6, dmg: 1.03 },
    desc: 'Durchschlägt ein Ziel mehr und ignoriert Panzerung.', st: '+1 Durchschlag · +6 Panzerbruch · +3% Schaden' },
  { id: 'resonator', name: 'Resonanzkammer', icon: '◉', price: 31, col: '#a06bff',
    m: { boom: 1.25, dmg: 1.06, rate: .95 },
    desc: 'Verstärkt Explosionen und Wucht der Waffe.', st: '+25% Explosionsradius · +6% Schaden · −5% Feuerrate' },
  { id: 'stabilisator', name: 'Gyro-Stabilisator', icon: '✦', price: 27, col: '#8fe0ff',
    m: { spread: .45, range: 1.06, rate: 1.04 },
    desc: 'Elektronischer Ausgleich hält die Waffe ruhig.', st: '−55% Streuung · +6% Reichweite · +4% Feuerrate' },
  { id: 'giftspitzen', name: 'Giftspitzen', icon: '✸', price: 30, col: '#7dffb0',
    m: { poison: 9, dmg: .96 },
    desc: 'Beschichtete Projektile vergiften ihre Ziele.', st: 'Treffer vergiften (9/s) · −4% Schaden' },
  { id: 'vampirbohrer', name: 'Vampir-Bohrer', icon: '◐', price: 33, col: '#ff5d6e',
    m: { ls: .06, dmg: 1.03, rate: .96 },
    desc: 'Bohrt sich fest und saugt bei jedem Treffer.', st: '+6% Lebensraub je Treffer · +3% Schaden · −4% Feuerrate' },
  { id: 'reaktorkern', name: 'A.M.S. Reaktorkern', icon: '☢', price: 36, col: '#a06bff',
    m: { boom: 1.35, critM: 1.15, rate: .93 },
    desc: 'Ein Mini-Reaktor glüht in deiner Hand.', st: '+35% Explosionsradius · +15% Krit-Schaden · −7% Feuerrate' }
];
const ATT_BY_ID = Data.register('attachments', ATTACHMENTS, {
  id: 'id', name: 'req|str', icon: 'str', price: 'num>0', col: 'str',
  m: (a) => { for (const k in (a.m || {})) if (typeof a.m[k] !== 'number') return 'Mod-Wert ' + k + ' ist keine Zahl'; return null; }
}).byId;
function attMod(w) {
  const m = { dmg: 1, rate: 1, range: 1, spread: 1, critC: 0, critM: 1, pierce: 0, boom: 1, kick: 1, quiet: 0, aggro: 0, burn: 0, slow: 0, slowT: 0, armorPierce: 0, poison: 0, ls: 0 };
  if (!w || !w.attach || !w.attach.length) return m;
  for (const id of w.attach) {
    const a = ATT_BY_ID[id];
    if (!a) continue;
    const s = a.m;
    if (s.dmg) m.dmg *= s.dmg;
    if (s.rate) m.rate *= s.rate;
    if (s.range) m.range *= s.range;
    if (s.spread) m.spread *= s.spread;
    if (s.boom) m.boom *= s.boom;
    if (s.kick) m.kick *= s.kick;
    if (s.critM) m.critM *= s.critM;
    if (s.critC) m.critC += s.critC;
    if (s.pierce) m.pierce += s.pierce;
    if (s.armorPierce) m.armorPierce += s.armorPierce;
    if (s.quiet) m.quiet = Math.max(m.quiet, s.quiet);
    if (s.aggro) m.aggro = Math.max(m.aggro, s.aggro);
    if (s.burn) m.burn = Math.max(m.burn, s.burn);
    if (s.poison) m.poison = Math.max(m.poison, s.poison);
    if (s.ls) m.ls = Math.max(m.ls, s.ls);
    if (s.slow) { m.slow = Math.max(m.slow, s.slow); m.slowT = Math.max(m.slowT, s.slowT || 1.2); }
  }
  return m;
}

/* ============================ 14d. BOSS-PORTRÄTS ============================
   Jeder Boss wird als eigenes Wesen gezeichnet — mehrteilig, animiert, mit
   sichtbarem Kern, der sich zwischen den Angriffen öffnet, und mit
   phasenabhängigen Beschädigungen. Alles im lokalen Koordinatensystem des
   Gegners: (0,0) ist die Mitte, -y zeigt in Blickrichtung.
   =========================================================================== */
function drawBossCore(ctx, r, open, col, t) {
  /* Der Schwachpunkt: geschlossene Panzerung → glühender Kern */
  const p = open ? 1 : 0;
  ctx.save();
  if (p) {
    const pulse = .8 + .2 * Math.sin(t * 12);
    ctx.globalAlpha = .35 * pulse;
    ctx.fillStyle = '#ffe27a';
    ctx.beginPath(); ctx.arc(0, 0, r * .62 * pulse, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff6c8';
    ctx.beginPath(); ctx.arc(0, 0, r * .3 * pulse, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#ffe27a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, r * .46, 0, TAU); ctx.stroke();
    for (let i = 0; i < 6; i++) {
      const a = t * 2 + i * TAU / 6;
      ctx.fillStyle = '#ffe27a';
      ctx.fillRect(Math.cos(a) * r * .72 - 1.5, Math.sin(a) * r * .72 - 1.5, 3, 3);
    }
  } else {
    ctx.fillStyle = shade(col, -.5);
    ctx.beginPath(); ctx.arc(0, 0, r * .42, 0, TAU); ctx.fill();
    ctx.strokeStyle = shade(col, -.25); ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.arc(0, 0, r * .42, 0, TAU); ctx.stroke();
    ctx.fillStyle = shade(col, -.62);
    for (let i = 0; i < 4; i++) {
      const a = i * TAU / 4 + Math.PI / 4;
      ctx.save(); ctx.rotate(a);
      ctx.fillRect(-r * .1, -r * .46, r * .2, r * .38);
      ctx.restore();
    }
  }
  ctx.restore();
}

function drawBossBody(ctx, e, r, t, col) {
  const B = e.boss, ph = e.phaseIdx || 0, dmgF = 1 - clamp(e.hp / Math.max(1, e.maxHp), 0, 1);
  const dark = shade(col, -.45), mid = shade(col, -.2), light = shade(col, .3);
  const open = !!e.coreOpen;
  switch (B.id) {

    /* ---------- KURHAUS-KOLOSS: wandelnde Säulenfassade mit Kuppel ---------- */
    case 'kurhaus': {
      ctx.fillStyle = dark;
      ctx.fillRect(-r * .95, -r * .1, r * 1.9, r * 1.15);              /* Sockel */
      /* sechs Säulen, die im Takt federn */
      for (let i = 0; i < 6; i++) {
        const x = -r * .78 + i * (r * .31);
        const bob = Math.sin(t * 3 + i * .7) * r * .05;
        ctx.fillStyle = i % 2 ? light : '#e9e3d2';
        ctx.fillRect(x - r * .07, -r * .95 + bob, r * .14, r * .9);
        ctx.fillStyle = mid;
        ctx.fillRect(x - r * .11, -r * 1.02 + bob, r * .22, r * .1);   /* Kapitell */
      }
      /* Giebel */
      ctx.fillStyle = '#efe7d4';
      ctx.beginPath();
      ctx.moveTo(-r * 1.05, -r * .95); ctx.lineTo(0, -r * 1.5); ctx.lineTo(r * 1.05, -r * .95);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = mid;
      ctx.fillRect(-r * 1.05, -r * .98, r * 2.1, r * .1);
      /* Kuppel mit Wetterfahne */
      ctx.fillStyle = light;
      ctx.beginPath(); ctx.arc(0, -r * 1.5, r * .38, Math.PI, TAU); ctx.fill();
      ctx.strokeStyle = '#ffd23e'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -r * 1.86); ctx.lineTo(0, -r * 2.1); ctx.stroke();
      ctx.fillStyle = '#ffd23e';
      ctx.fillRect(-1.5, -r * 2.15, 3, 3);
      /* Fenster als Augenreihe, glühen mit der Phase */
      for (let i = 0; i < 5; i++) {
        const x = -r * .6 + i * (r * .3);
        ctx.fillStyle = ph >= 1 ? (Math.sin(t * 9 + i) > 0 ? '#ff8a3d' : '#a03a10') : '#2a2f3d';
        ctx.fillRect(x - r * .07, -r * .72, r * .14, r * .3);
      }
      /* Trümmerrisse mit steigendem Schaden */
      if (dmgF > .35) {
        ctx.strokeStyle = 'rgba(20,16,10,.7)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-r * .5, -r * .1); ctx.lineTo(-r * .2, -r * .7); ctx.lineTo(-r * .35, -r * .95); ctx.stroke();
      }
      if (dmgF > .68) {
        ctx.beginPath(); ctx.moveTo(r * .6, r * .9); ctx.lineTo(r * .3, -r * .3); ctx.lineTo(r * .55, -r * .9); ctx.stroke();
      }
      ctx.save(); ctx.translate(0, -r * .38); drawBossCore(ctx, r * .78, open, col, t); ctx.restore();
      break;
    }

    /* ---------- NEROBERG-WURM: gegliederter Leib mit Beißzangen ---------- */
    case 'nerobahn': {
      /* Segmente hinter dem Kopf, die nachschwingen */
      for (let i = 5; i >= 1; i--) {
        const off = Math.sin(t * 4 - i * .55) * r * .32;
        const rr = r * (.82 - i * .09);
        ctx.fillStyle = i % 2 ? mid : dark;
        ctx.beginPath(); ctx.ellipse(off, r * (.5 + i * .55), rr, rr * .82, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = shade(col, -.6);
        ctx.beginPath(); ctx.ellipse(off, r * (.5 + i * .55), rr * .42, rr * .3, 0, 0, TAU); ctx.fill();
      }
      /* Kopf */
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.ellipse(0, 0, r * .92, r * 1.05, 0, 0, TAU); ctx.fill();
      /* Beißzangen, die mit der Phase weiter aufreißen */
      const bite = (.35 + ph * .25) + Math.sin(t * 5) * .12;
      ctx.fillStyle = '#e8f2ff';
      for (const sgn of [-1, 1]) {
        ctx.save();
        ctx.translate(sgn * r * .5, -r * .62);
        ctx.rotate(sgn * bite);
        ctx.beginPath();
        ctx.moveTo(0, 0); ctx.lineTo(sgn * r * .22, -r * .78); ctx.lineTo(sgn * r * .46, -r * .12);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      /* Maul */
      ctx.fillStyle = '#2a0d16';
      ctx.beginPath(); ctx.ellipse(0, -r * .35, r * .38, r * .3 * (1 + Math.sin(t * 5) * .2), 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ff5d6e';
      for (let i = 0; i < 5; i++) ctx.fillRect(-r * .3 + i * r * .15, -r * .5, r * .07, r * .16);
      /* Augenpaare */
      for (let i = 0; i < 3; i++) {
        const y = -r * .05 + i * r * .22;
        for (const sgn of [-1, 1]) {
          ctx.fillStyle = '#ffe27a';
          ctx.beginPath(); ctx.arc(sgn * r * (.45 - i * .07), y, r * .09, 0, TAU); ctx.fill();
        }
      }
      ctx.save(); ctx.translate(0, r * .35); drawBossCore(ctx, r * .7, open, col, t); ctx.restore();
      break;
    }

    /* ---------- KOCHBRUNNEN-GOLEM: Felsleib mit brodelnden Adern ---------- */
    case 'kochbrunnen': {
      /* Schultern und Arme */
      for (const sgn of [-1, 1]) {
        const swing = Math.sin(t * 2.2 + (sgn > 0 ? 0 : Math.PI)) * r * .18;
        ctx.fillStyle = dark;
        ctx.beginPath(); ctx.ellipse(sgn * r * .95, -r * .1 + swing, r * .42, r * .55, sgn * .3, 0, TAU); ctx.fill();
        ctx.fillStyle = mid;
        ctx.beginPath(); ctx.ellipse(sgn * r * 1.15, r * .55 + swing, r * .34, r * .42, 0, 0, TAU); ctx.fill();
      }
      /* Rumpf aus versetzten Blöcken */
      const blocks = [[-.55, -.75, .55, .5], [.05, -.85, .6, .55], [-.7, -.2, .7, .6], [.05, -.25, .72, .62], [-.45, .45, .95, .5]];
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        ctx.fillStyle = i % 2 ? mid : dark;
        ctx.fillRect(b[0] * r, b[1] * r, b[2] * r, b[3] * r);
        ctx.strokeStyle = 'rgba(10,8,6,.55)'; ctx.lineWidth = 1.4;
        ctx.strokeRect(b[0] * r, b[1] * r, b[2] * r, b[3] * r);
      }
      /* Glühende Adern, heller mit jeder Phase */
      ctx.strokeStyle = ph >= 2 ? '#ffd9a0' : ph >= 1 ? '#ff8a3d' : '#c0521f';
      ctx.lineWidth = 2 + ph * .6;
      ctx.globalAlpha = .6 + .4 * Math.sin(t * 6);
      ctx.beginPath();
      ctx.moveTo(-r * .5, r * .8); ctx.lineTo(-r * .2, r * .1); ctx.lineTo(-r * .38, -r * .4); ctx.lineTo(0, -r * .8);
      ctx.moveTo(r * .45, r * .75); ctx.lineTo(r * .2, r * .05); ctx.lineTo(r * .4, -r * .5);
      ctx.stroke();
      ctx.globalAlpha = 1;
      /* Dampf aus dem Rücken */
      ctx.fillStyle = 'rgba(220,230,240,.22)';
      for (let i = 0; i < 3; i++) {
        const yy = -r * 1.0 - ((t * 30 + i * 22) % 44);
        ctx.beginPath(); ctx.arc(Math.sin(t * 2 + i) * r * .3, yy, r * (.16 + i * .07), 0, TAU); ctx.fill();
      }
      /* Kopf: schwerer Brocken mit Glutaugen */
      ctx.fillStyle = light;
      ctx.fillRect(-r * .42, -r * 1.32, r * .84, r * .52);
      ctx.fillStyle = '#ff8a3d';
      ctx.fillRect(-r * .28, -r * 1.16, r * .18, r * .12);
      ctx.fillRect(r * .1, -r * 1.16, r * .18, r * .12);
      ctx.save(); ctx.translate(0, -r * .2); drawBossCore(ctx, r * .8, open, col, t); ctx.restore();
      break;
    }

    /* ---------- SEBBOS ROGUE-KI: schwebende Kerne im Rahmenkäfig ---------- */
    case 'rogueki': {
      /* Rotierende Außenringe */
      for (let ring = 0; ring < 3; ring++) {
        const a = t * (.6 + ring * .5) * (ring % 2 ? -1 : 1);
        ctx.save(); ctx.rotate(a);
        ctx.strokeStyle = ring === ph ? '#ffffff' : col;
        ctx.lineWidth = 3 - ring * .6;
        ctx.globalAlpha = .85 - ring * .18;
        ctx.beginPath();
        ctx.ellipse(0, 0, r * (1.35 - ring * .22), r * (.55 - ring * .1), 0, 0, TAU);
        ctx.stroke();
        /* Knoten auf dem Ring */
        for (let k = 0; k < 4; k++) {
          const ka = k * TAU / 4;
          ctx.fillStyle = ring === ph ? '#ffffff' : col;
          ctx.fillRect(Math.cos(ka) * r * (1.35 - ring * .22) - 2.5, Math.sin(ka) * r * (.55 - ring * .1) - 2.5, 5, 5);
        }
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      /* Innerer Käfig aus Streben */
      ctx.strokeStyle = shade(col, -.3); ctx.lineWidth = 2.4;
      for (let i = 0; i < 6; i++) {
        const a = i * TAU / 6 + t * .3;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * .38, Math.sin(a) * r * .38);
        ctx.lineTo(Math.cos(a) * r * .95, Math.sin(a) * r * .95);
        ctx.stroke();
      }
      /* Datenflimmern */
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 8; i++) {
        const a = rnd(TAU), rr = rnd(r * .4, r * 1.2);
        ctx.globalAlpha = rnd(.15, .5);
        ctx.fillRect(Math.cos(a) * rr, Math.sin(a) * rr, 2, 2);
      }
      ctx.globalAlpha = 1;
      /* Kern als Auge */
      ctx.fillStyle = '#12050e';
      ctx.beginPath(); ctx.arc(0, 0, r * .5, 0, TAU); ctx.fill();
      drawBossCore(ctx, r * .82, open, col, t);
      if (!open) {
        ctx.fillStyle = ph >= 2 ? '#ff2e88' : '#ff7ab8';
        ctx.beginPath();
        ctx.ellipse(0, 0, r * .3, r * .12 + Math.abs(Math.sin(t * 1.7)) * r * .16, 0, 0, TAU);
        ctx.fill();
      }
      break;
    }

    /* ---------- BERGBAHN-KOLOSS: Waggon auf Schienen ---------- */
    case 'bergbahn': {
      /* Schienenstück unter dem Wagen */
      ctx.strokeStyle = '#5d6675'; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-r * 1.5, r * 1.15); ctx.lineTo(r * 1.5, r * 1.15);
      ctx.moveTo(-r * 1.5, r * 1.42); ctx.lineTo(r * 1.5, r * 1.42);
      ctx.stroke();
      for (let i = -3; i <= 3; i++) {
        ctx.fillStyle = '#7a5f3a';
        ctx.fillRect(i * r * .45 - r * .07, r * 1.05, r * .14, r * .5);
      }
      /* Räder */
      for (const sgn of [-1, 1]) {
        ctx.fillStyle = '#2f3542';
        ctx.beginPath(); ctx.arc(sgn * r * .62, r * 1.28, r * .2, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#8f97a6'; ctx.lineWidth = 1.6;
        ctx.save(); ctx.translate(sgn * r * .62, r * 1.28); ctx.rotate(t * 7);
        ctx.beginPath(); ctx.moveTo(-r * .16, 0); ctx.lineTo(r * .16, 0); ctx.stroke();
        ctx.restore();
      }
      /* Wagenkasten, leicht schräg wie am Hang */
      ctx.save();
      ctx.rotate(-.09);
      ctx.fillStyle = col;
      ctx.fillRect(-r * .95, -r * .95, r * 1.9, r * 2.0);
      ctx.fillStyle = shade(col, -.3);
      ctx.fillRect(-r * .95, -r * .95, r * 1.9, r * .3);
      /* Fensterreihe */
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = ph >= 1 ? '#ffd9a0' : '#8fd0ff';
        ctx.fillRect(-r * .74, -r * .5 + i * r * .55, r * 1.48, r * .36);
        ctx.fillStyle = 'rgba(20,26,40,.35)';
        ctx.fillRect(-r * .04, -r * .5 + i * r * .55, r * .08, r * .36);
      }
      ctx.strokeStyle = shade(col, -.5); ctx.lineWidth = 2;
      ctx.strokeRect(-r * .95, -r * .95, r * 1.9, r * 2.0);
      ctx.restore();
      /* Seil nach oben, das mitschwingt */
      ctx.strokeStyle = '#c9ccd6'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.0);
      ctx.quadraticCurveTo(Math.sin(t * 2) * r * .3, -r * 1.7, 0, -r * 2.3);
      ctx.stroke();
      /* Wasserballast tropft in Phase 2 */
      if (ph >= 1) {
        ctx.fillStyle = 'rgba(89,230,255,.7)';
        for (let i = 0; i < 3; i++) {
          const yy = r * 1.0 + ((t * 60 + i * 30) % 60);
          ctx.fillRect(-r * .5 + i * r * .5, yy, 2, 5);
        }
      }
      ctx.save(); ctx.translate(0, r * .1); drawBossCore(ctx, r * .7, open, col, t); ctx.restore();
      break;
    }

    /* ---------- SIRENEN-KOLLEKTIV: drei Trichter um eine Nabe ---------- */
    case 'sirenkollektiv': {
      /* Verbindungsstreben */
      ctx.strokeStyle = shade(col, -.35); ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) {
        const a = t * 1.1 + i * TAU / 3;
        ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * r * .85, Math.sin(a) * r * .85);
        ctx.stroke();
      }
      /* Drei Sirenentrichter */
      for (let i = 0; i < 3; i++) {
        const a = t * 1.1 + i * TAU / 3;
        const cx2 = Math.cos(a) * r * .85, cy2 = Math.sin(a) * r * .85;
        ctx.save();
        ctx.translate(cx2, cy2);
        ctx.rotate(a);
        ctx.fillStyle = i === ph ? light : mid;
        ctx.beginPath();
        ctx.moveTo(-r * .12, -r * .3); ctx.lineTo(r * .55, -r * .48);
        ctx.lineTo(r * .55, r * .48); ctx.lineTo(-r * .12, r * .3);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#2a0d22';
        ctx.beginPath(); ctx.ellipse(r * .55, 0, r * .1, r * .48, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = dark;
        ctx.beginPath(); ctx.arc(-r * .18, 0, r * .22, 0, TAU); ctx.fill();
        /* Schallringe */
        ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1.4;
        for (let k = 1; k <= 2; k++) {
          ctx.globalAlpha = .5 / k * (.5 + .5 * Math.sin(t * 7 + i));
          ctx.beginPath(); ctx.arc(r * .58, 0, r * (.2 + k * .22), -.9, .9); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.restore();
      }
      /* Nabe */
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.arc(0, 0, r * .5, 0, TAU); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, r * .5, 0, TAU); ctx.stroke();
      drawBossCore(ctx, r * .72, open, col, t);
      break;
    }

    /* ---------- THERMALQUELLE: aufgerissener Quellschacht ---------- */
    case 'thermalquelle': {
      /* Beckenrand aus Bruchstein */
      ctx.fillStyle = '#6b5a48';
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = i / 16 * TAU;
        const rr = r * (1.02 + (i % 3 === 0 ? .12 : 0));
        i ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#463a2e'; ctx.lineWidth = 2; ctx.stroke();
      /* Kochendes Wasser mit wandernden Blasen */
      ctx.fillStyle = ph >= 2 ? '#ff9a3d' : ph >= 1 ? '#ffb24a' : '#e0a83a';
      ctx.beginPath(); ctx.arc(0, 0, r * .84, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,240,200,.55)';
      for (let i = 0; i < 7; i++) {
        const a = i * 1.9 + t * (1.2 + i * .1);
        const rr = (r * .2 + ((t * 22 + i * 17) % (r * .62)));
        ctx.beginPath(); ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, r * .07 * (1 - rr / (r * .9)) + 1.5, 0, TAU); ctx.fill();
      }
      /* Fontänen an den Rändern, Höhe nach Phase */
      for (let i = 0; i < 4; i++) {
        const a = i * TAU / 4 + t * .5;
        const h = r * (.5 + ph * .3) * (.6 + .4 * Math.sin(t * 6 + i * 1.4));
        ctx.strokeStyle = 'rgba(255,220,170,.6)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * .8, Math.sin(a) * r * .8);
        ctx.lineTo(Math.cos(a) * (r * .8 + h), Math.sin(a) * (r * .8 + h));
        ctx.stroke();
      }
      /* Dampfschwaden */
      ctx.fillStyle = 'rgba(240,240,235,.20)';
      for (let i = 0; i < 4; i++) {
        const yy = -((t * 26 + i * 30) % 110);
        ctx.beginPath(); ctx.arc(Math.sin(t * 1.4 + i * 2) * r * .5, yy - r * .4, r * (.22 + i * .1), 0, TAU); ctx.fill();
      }
      drawBossCore(ctx, r * .78, open, col, t);
      break;
    }

    /* ---------- MARKTKIRCHEN-TURM: Backsteinturm mit Glocke ---------- */
    case 'marktturm': {
      /* Turmschaft */
      ctx.fillStyle = '#7a3f52';
      ctx.beginPath();
      ctx.moveTo(-r * .55, -r * .5); ctx.lineTo(r * .55, -r * .5);
      ctx.lineTo(r * .72, r * 1.35); ctx.lineTo(-r * .72, r * 1.35);
      ctx.closePath(); ctx.fill();
      /* Backsteinlagen */
      ctx.strokeStyle = 'rgba(30,16,22,.45)'; ctx.lineWidth = 1;
      for (let i = 0; i < 7; i++) {
        const yy = -r * .5 + i * r * .26;
        ctx.beginPath(); ctx.moveTo(-r * (.55 + i * .024), yy); ctx.lineTo(r * (.55 + i * .024), yy); ctx.stroke();
      }
      /* Spitzhelm */
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.75); ctx.lineTo(r * .62, -r * .5); ctx.lineTo(-r * .62, -r * .5);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = shade(col, -.3);
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.75); ctx.lineTo(r * .62, -r * .5); ctx.lineTo(r * .1, -r * .5);
      ctx.closePath(); ctx.fill();
      /* Vier Ecktürmchen */
      for (const sgn of [-1, 1]) {
        ctx.fillStyle = shade(col, -.15);
        ctx.beginPath();
        ctx.moveTo(sgn * r * .62, -r * .5); ctx.lineTo(sgn * r * .78, -r * .95); ctx.lineTo(sgn * r * .9, -r * .5);
        ctx.closePath(); ctx.fill();
      }
      /* Schallöffnung mit schwingender Glocke */
      ctx.fillStyle = '#170a12';
      ctx.beginPath();
      ctx.moveTo(-r * .3, -r * .1); ctx.lineTo(r * .3, -r * .1); ctx.lineTo(r * .3, r * .55);
      ctx.quadraticCurveTo(0, r * .75, -r * .3, r * .55);
      ctx.closePath(); ctx.fill();
      const swing = Math.sin(t * (2.2 + ph * .8)) * .38;
      ctx.save();
      ctx.translate(0, -r * .05);
      ctx.rotate(swing);
      ctx.fillStyle = '#c8a24a';
      ctx.beginPath();
      ctx.moveTo(-r * .05, 0); ctx.lineTo(r * .05, 0);
      ctx.lineTo(r * .2, r * .4); ctx.lineTo(-r * .2, r * .4);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#8f6f22';
      ctx.fillRect(-r * .22, r * .38, r * .44, r * .07);
      ctx.restore();
      /* Zifferblatt */
      ctx.fillStyle = '#efe7d4';
      ctx.beginPath(); ctx.arc(0, -r * .78, r * .26, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#3a2b1c'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(0, -r * .78, r * .26, 0, TAU); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -r * .78); ctx.lineTo(Math.cos(t * .9) * r * .18, -r * .78 + Math.sin(t * .9) * r * .18);
      ctx.moveTo(0, -r * .78); ctx.lineTo(Math.cos(t * .3) * r * .12, -r * .78 + Math.sin(t * .3) * r * .12);
      ctx.stroke();
      /* Risse ab halbem Schaden */
      if (dmgF > .5) {
        ctx.strokeStyle = 'rgba(15,8,12,.8)'; ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(-r * .5, r * 1.3); ctx.lineTo(-r * .2, r * .5); ctx.lineTo(-r * .42, -r * .2); ctx.stroke();
      }
      ctx.save(); ctx.translate(0, r * .8); drawBossCore(ctx, r * .68, open, col, t); ctx.restore();
      break;
    }

    default: {
      ctx.fillStyle = col;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) { const a = i / 8 * TAU, rr = r * (i % 2 ? .7 : 1); i ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      ctx.closePath(); ctx.fill();
      drawBossCore(ctx, r * .8, open, col, t);
    }
  }
}

