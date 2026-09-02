Object.assign(Game, {
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
});
