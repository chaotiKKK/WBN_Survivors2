Object.assign(Game, {
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
});
