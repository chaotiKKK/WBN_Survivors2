Object.assign(Game, {
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
});
