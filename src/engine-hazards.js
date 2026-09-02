Object.assign(Game, {
  hazObjs: [],
  spawnMortar(sx, sy, tx, ty, L, name) {
    if (this.hazObjs.length > 90) return;
    this.hazObjs.push({ kind: 'shell', x: sx, y: sy, sx: sx, sy: sy, tx: tx, ty: ty, t: 0, flight: L.flight, r: L.r, dmg: L.dmg, name: name });
    FX.telegraph(tx, ty, L.r, '#ffb24a', L.flight, 'dot', L.r);
  },
  spawnMine(x, y, M, name) {
    if (this.hazObjs.length > 90) return;
    this.hazObjs.push({ kind: 'mine', x: x, y: y, t: 0, fuse: M.fuse, r: M.r, dmg: M.dmg, name: name });
  },
  spawnWeb(x, y, W) {
    if (this.hazObjs.length > 90) return;
    this.hazObjs.push({ kind: 'web', x: x, y: y, r: W.r, t: 0, life: W.life, slow: W.slow, seed: rnd(TAU) });
  },
  hazBoom(h) {
    FX.explosion(h.x, h.y, h.r, '#ffb24a');
    this.feedback(h.x, h.y, 'mittel');
    AudioSys.sfxAt('boom', h.x, h.y);
    for (const p of this.players) if (p.alive && dist(p.x, p.y, h.x, h.y) < h.r) {
      this.lastHitBy = { name: h.name || 'Sprengsatz', t: this.time };
      p.damage(h.dmg * DANGERS[this.danger].dmg, Math.atan2(p.y - h.y, p.x - h.x));
    }
    for (const e of this.enemies) if (!e.dead && e.charmT > 0 && dist(e.x, e.y, h.x, h.y) < h.r) e.hurt(h.dmg, false, this.players[0], 'boom');
  },
  updateHazObjs(dt) {
    for (let i = this.hazObjs.length - 1; i >= 0; i--) {
      const h = this.hazObjs[i];
      h.t += dt;
      if (h.kind === 'shell') {
        const f = clamp(h.t / h.flight, 0, 1);
        h.x = lerp(h.sx, h.tx, f);
        h.y = lerp(h.sy, h.ty, f);
        h.arc = Math.sin(f * Math.PI) * 60;
        if (OPT().particles > 0 && Math.random() < .5) FX.px(h.x, h.y - h.arc, '#ffb24a', 2, .2, { glow: 1 });
        if (f >= 1) { this.hazBoom(h); this.hazObjs.splice(i, 1); }
      } else if (h.kind === 'mine') {
        const f = clamp(h.t / h.fuse, 0, 1);
        if (OPT().particles > 0 && Math.random() < f * .6) FX.px(h.x + crnd(-4, 4), h.y + crnd(-4, 4), '#ff4d5e', 2, .2, { glow: 1 });
        if (h.t > h.fuse * .55 && !h._warned) { h._warned = true; FX.telegraph(h.x, h.y, h.r, '#ff4d5e', h.fuse * .45, 'dot', h.r); }
        if (f >= 1) { this.hazBoom(h); this.hazObjs.splice(i, 1); }
      } else {
        for (const p of this.players) if (p.alive && dist(p.x, p.y, h.x, h.y) < h.r) {
          p.webSlow = Math.max(p.webSlow || 0, h.slow);
          if (h.poison) p.damage(h.poison * dt, 0);
        }
        if (h.t > h.life) this.hazObjs.splice(i, 1);
      }
    }
  },
  drawHazObjs(ctx) {
    for (const h of this.hazObjs) {
      if (h.kind === 'shell') {
        const y = h.y - (h.arc || 0);
        ctx.save(); ctx.globalAlpha = .38; ctx.strokeStyle = '#ffcf5c'; ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.arc(h.tx, h.ty, h.r, 0, TAU); ctx.stroke(); ctx.setLineDash([]); ctx.restore();
        ctx.globalAlpha = .35; ctx.fillStyle = '#000';
        ctx.beginPath(); ctx.ellipse(h.x, h.y, 5, 2.6, 0, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1; ctx.fillStyle = '#c0a06b';
        ctx.beginPath(); ctx.ellipse(h.x, y, 5.2, 4, h.t * 6, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ffb24a'; ctx.fillRect(h.x - 1, y - 6, 2, 3);
      } else if (h.kind === 'mine') {
        const f = clamp(h.t / h.fuse, 0, 1);
        ctx.save(); ctx.globalAlpha = .25 + f * .25; ctx.strokeStyle = '#ff4d5e'; ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, TAU); ctx.stroke(); ctx.setLineDash([]); ctx.restore();
        const blink = Math.sin(h.t * (6 + f * 26)) > 0;
        ctx.fillStyle = '#2f3542';
        ctx.beginPath(); ctx.arc(h.x, h.y, 6, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(h.x, h.y, 8.5, 0, TAU); ctx.stroke();
        for (let i = 0; i < 4; i++) {
          const a = i / 4 * TAU + h.t;
          ctx.fillStyle = '#8f97a6';
          ctx.fillRect(h.x + Math.cos(a) * 8 - 1, h.y + Math.sin(a) * 8 - 1, 2.4, 2.4);
        }
        if (blink) { ctx.fillStyle = '#ff4d5e'; ctx.beginPath(); ctx.arc(h.x, h.y, 2.6, 0, TAU); ctx.fill(); }
      } else if (h.kind === 'bossPool') {
        const f = clamp(1 - h.t / h.life, 0, 1);
        ctx.globalAlpha = .25 * f;
        ctx.fillStyle = h.col || '#ff5d6e';
        ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, TAU); ctx.fill();
        ctx.globalAlpha = .5 * f;
        ctx.strokeStyle = h.col || '#ff5d6e'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
      } else {
        const f = clamp(1 - h.t / h.life, 0, 1);
        ctx.globalAlpha = .30 * f;
        ctx.fillStyle = h.col || '#dcd0ff';
        ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, TAU); ctx.fill();
        ctx.globalAlpha = .55 * f;
        ctx.strokeStyle = '#efe8ff'; ctx.lineWidth = 1;
        for (let i = 0; i < 6; i++) {
          const a = h.seed + i / 6 * TAU;
          ctx.beginPath(); ctx.moveTo(h.x, h.y);
          ctx.lineTo(h.x + Math.cos(a) * h.r, h.y + Math.sin(a) * h.r);
          ctx.stroke();
        }
        for (let ring = 1; ring <= 3; ring++) {
          ctx.beginPath(); ctx.arc(h.x, h.y, h.r * ring / 3, 0, TAU); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }
    ctx.globalAlpha = 1;
  },
  enemyInCone(x, y, ang, range, half) {
    const list = this.hash.query(x, y, range, this._tmp);
    let best = null, bd = 1e9;
    for (const e of list) {
      if (e.dead || e.charmT > 0) continue;
      const d = dist(e.x, e.y, x, y);
      if (d > range) continue;
      const rel = Math.atan2(e.y - y, e.x - x);
      if (Math.abs(angDiff(rel, ang)) > half) continue;
      const score = d + Math.abs(angDiff(rel, ang)) * 120;
      if (score < bd) { bd = score; best = e; }
    }
    return best;
  },
  nearestEnemyTo(x, y, self) {
    let best = null, bd = 1e9;
    const list = this.hash.query(x, y, 460, this._tmp);
    for (const e of list) {
      if (e === self || e.dead || e.charmT > 0) continue;
      const d = dist2(e.x, e.y, x, y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  },
  nearestPlayer(x, y) {
    /* Tarnung durch Schalldämpfer: getarnte Spieler ziehen weniger Aufmerksamkeit */
    if (this.players.length > 1) {
      let best = null, bd = 1e9;
      for (const p of this.players) {
        if (!p.alive) continue;
        const st = WeaponSystem.stealthOf(p);
        const d = dist2(p.x, p.y, x, y) * (1 + st * .9);
        if (d < bd) { bd = d; best = p; }
      }
      if (best) return best;
    }
    let best = null, bd = Infinity;
    for (const p of this.players) { if (!p.alive) continue; const d = dist2(x, y, p.x, p.y); if (d < bd) { bd = d; best = p; } }
    return best;
  },
  raycastEnemies(x, y, ang, len, width) {
    const hits = [], dx = Math.cos(ang), dy = Math.sin(ang);
    /* Der Strahl endet an der ersten Wand — vorher schossen Scharfschuetze
       und Railgun quer durch ganze Haeuserzeilen. */
    if (this.level) len *= this.level.rayHit(x, y, x + dx * len, y + dy * len);
    for (const e of this.enemies) {
      if (e.dead) continue;
      const ex = e.x - x, ey = e.y - y;
      const t = ex * dx + ey * dy;
      if (t < 0 || t > len) continue;
      const px = ex - dx * t, py = ey - dy * t;
      if (px * px + py * py < (width + e.r) * (width + e.r)) hits.push({ e, t });
    }
    hits.sort((a, b) => a.t - b.t);
    return hits.map(h => h.e);
  },
  screenToWorld(sx, sy) {
    return { x: (sx - this.W / 2) / this.cam.zoom + this.cam.x, y: (sy - this.H / 2) / this.cam.zoom + this.cam.y };
  },
  shake(amt, t) { this.addTrauma(amt, t); this._shakeAngled = false; },
});
