Object.assign(Game, {
  render() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#05070d'; ctx.fillRect(0, 0, this.W, this.H);
    if (!this.level || this.state === 'title') { this.renderTitleBg(ctx); return; }
    ctx.save();
    ctx.translate(this.W / 2 + this.cam.sx, this.H / 2 + this.cam.sy);
    ctx.scale(this.cam.zoom, this.cam.zoom);
    ctx.translate(-this.cam.x, -this.cam.y);
    if (this.buildParallaxPending) { this.buildParallaxPending = false; this.buildParallax(); }
    this.drawParallax(ctx);
    this.level.draw(ctx, this.cam);
    const pvw = this.W / 2 / this.cam.zoom + 30, pvh = this.H / 2 / this.cam.zoom + 30;
    for (const m of this.pickups) {
      if (Math.abs(m.x - this.cam.x) > pvw || Math.abs(m.y - this.cam.y) > pvh) continue;
      const s = 5 + Math.sin(this.time * 6 + m.t * 3) * 1.2;
      ctx.fillStyle = '#f4c25a'; ctx.globalAlpha = .95;
      ctx.beginPath(); ctx.moveTo(m.x, m.y - s); ctx.lineTo(m.x + s, m.y); ctx.lineTo(m.x, m.y + s); ctx.lineTo(m.x - s, m.y); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
    }
    for (const pu of this.powerups) {
      const s = 12 + Math.sin(this.time * 5) * 2;
      ctx.strokeStyle = pu.col; ctx.lineWidth = 2.5; ctx.globalAlpha = .9;
      ctx.beginPath(); ctx.arc(pu.x, pu.y, s, 0, TAU); ctx.stroke();
      ctx.fillStyle = pu.col; ctx.globalAlpha = .35; ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff'; ctx.font = '8px monospace'; ctx.textAlign = 'center';
      ctx.fillText(pu.name.slice(0, 8).toUpperCase(), pu.x, pu.y - 18);
    }
    for (const ru of this.runes) {
      const s = 13 + Math.sin(this.time * 4 + ru.x) * 1.5;
      ctx.save();
      ctx.translate(ru.x, ru.y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = ru.col; ctx.globalAlpha = .9;
      ctx.beginPath(); ctx.rect(-s, -s, s * 2, s * 2); ctx.fill();
      ctx.rotate(-Math.PI / 4);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.strokeRect(-s + 3, -s + 3, s * 2 - 6, s * 2 - 6);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center';
      ctx.fillText(RUNE_BY_ID[ru.type].name.slice(6, 7), 0, 4);
      ctx.restore();
    }
    for (const pd of this.petDrops) {
      const s = 12 + Math.sin(this.time * 3 + pd.x) * 1.5;
      ctx.save();
      ctx.translate(pd.x, pd.y + Math.sin(this.time * 5) * 3);
      ctx.fillStyle = pd.col; ctx.globalAlpha = .95;
      ctx.beginPath(); ctx.ellipse(0, 0, s, s * .9, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#222';
      ctx.beginPath(); ctx.arc(-s * .4, -s * .3, 2, 0, TAU); ctx.arc(s * .4, -s * .3, 2, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff'; ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center';
      ctx.fillText('BEGLEITER', 0, -s - 6);
      ctx.restore();
    }
    for (const p of this.players) for (const t of p.turrets) t.draw(ctx);
    for (const e of this.enemies) {
      if (!e.boss && (Math.abs(e.x - this.cam.x) > pvw + e.r + 40 || Math.abs(e.y - this.cam.y) > pvh + e.r + 40)) continue;
      e.draw(ctx);
    }
    for (const p of Projectiles.active) {
      ctx.fillStyle = p.col;
      ctx.globalAlpha = .95;
      if (p.shape === 'advice') {
        const s = p.size || 11;
        const w = Math.max(s * 1.9, (p.word || '').length * 3.6 + 7), h = s * 1.05;
        ctx.save();
        ctx.translate(p.x, p.y + Math.sin(p.rot * 2.2) * 1.4);
        ctx.rotate(Math.sin(p.rot) * .09);
        if (this.quality() >= 1) {
          ctx.globalAlpha = .22; ctx.fillStyle = p.col;
          ctx.beginPath(); ctx.arc(0, 0, w * .62, 0, TAU); ctx.fill();
        }
        ctx.globalAlpha = .95; ctx.fillStyle = p.col;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(-w / 2, -h / 2, w, h, 3.2); else ctx.rect(-w / 2, -h / 2, w, h);
        ctx.fill();
        ctx.beginPath(); ctx.moveTo(-3, h / 2 - .6); ctx.lineTo(-.4, h / 2 + 4.2); ctx.lineTo(2.6, h / 2 - .6); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(18,12,4,.55)'; ctx.lineWidth = 1;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(-w / 2, -h / 2, w, h, 3.2); else ctx.rect(-w / 2, -h / 2, w, h);
        ctx.stroke();
        if (p.word) {
          ctx.fillStyle = 'rgba(22,16,6,.92)';
          ctx.font = 'bold 6px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(p.word, 0, .3);
          ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
        }
        ctx.restore();
      } else if (p.shape === 'note') {
        const s = p.size || 9;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        if (this.quality() >= 1) {
          ctx.globalAlpha = .3;
          ctx.beginPath(); ctx.arc(0, 0, s * 1.25, 0, TAU); ctx.fill();
          ctx.globalAlpha = .95;
        }
        ctx.beginPath(); ctx.ellipse(-s * .55, s * .6, s * .5, s * .38, 0, 0, TAU); ctx.fill();
        ctx.fillRect(-s * .24, -s * 1.1, s * .3, s * 1.72);
        ctx.fillRect(s * .06, -s * 1.1, s * .62, s * .28);
        ctx.beginPath(); ctx.arc(s * .06, -s * 1.1, s * .22, 0, TAU); ctx.fill();
        ctx.restore();
      } else {
        /* ---- Projektil-Erscheinung je Waffentyp (pixelig, mit Kern & Korona) ---- */
        const F = projFx(p.source);
        const ang = Math.atan2(p.vy, p.vx);
        const hi = OPT().highContrast;
        const qual = this.quality();
        const puls = F.pulse ? .82 + .18 * Math.sin(p.pulse || 0) : 1;
        ctx.save();
        ctx.translate(p.x, p.y);
        if (qual >= 1 && F.glow) {
          ctx.globalAlpha = .15 * F.glow * puls;
          ctx.fillStyle = p.col;
          ctx.beginPath(); ctx.arc(0, 0, p.r * (2.0 + (F.glow || 0) * .8) * puls, 0, TAU); ctx.fill();
        }
        /* ---- Geschwindigkeits-Schweif: additiver Kometenstrich hinter jedem
           Projektil, weiss-heiss am Kopf, zur Farbe hin auslaufend. Skaliert mit
           dem Tempo - langsame Wuerfe (Kiste, Klecks) bekommen ihn kaum, schnelle
           Runden einen kraeftigen Zug. Liegt unter der scharfen Form. ---- */
        if (qual >= 1) {
          const sp = Math.hypot(p.vx, p.vy);
          const sf = clamp((sp - 220) / 680, 0, 1);
          if (sf > .04) {
            ctx.save();
            ctx.rotate(ang);
            ctx.globalCompositeOperation = 'lighter';
            const La = 6 + p.r * 1.2 + sf * (24 + (F.len || 8) * .55);
            const seg = 4;
            for (let i = 0; i < seg; i++) {
              const f0 = i / seg, f1 = (i + 1) / seg;
              ctx.globalAlpha = (.14 + .22 * (F.glow || .5)) * (1 - f0) * sf * puls;
              ctx.fillStyle = i === 0 ? '#fff6e0' : p.col;
              const h = p.r * (1.05 - f0 * .72);
              ctx.fillRect(-La * f1, -h, La * (f1 - f0) + .7, h * 2);
            }
            ctx.restore();
          }
        }
        ctx.globalAlpha = .97;
        ctx.fillStyle = p.col;
        switch (F.style) {
          case 'bullet': case 'pellet': {
            ctx.rotate(ang);
            const L = (F.len || 8) * (F.style === 'pellet' ? .7 : 1), H = Math.max(2, p.r * .9);
            ctx.fillStyle = shade(p.col, -.25);
            ctx.fillRect(-L * .7, -H / 2, L * .7, H);
            ctx.fillStyle = p.col;
            ctx.fillRect(-L * .15, -H / 2, L * .5, H);
            ctx.fillStyle = '#fff6d0';
            ctx.fillRect(L * .28, -H * .3, L * .26, H * .6);
            break;
          }
          case 'tracer': {
            ctx.rotate(ang);
            const L = F.len || 20;
            ctx.globalAlpha = .20; ctx.fillStyle = p.col;
            ctx.fillRect(-L, -1, L, 2);
            ctx.globalAlpha = .85; ctx.fillStyle = '#fff6c8';
            ctx.fillRect(-L * .3, -1.4, L * .45, 2.8);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(L * .1, -1.8, 4, 3.6);
            break;
          }
          case 'needle': {
            ctx.rotate(ang);
            const L = F.len || 12;
            ctx.fillStyle = shade(p.col, .3);
            ctx.beginPath(); ctx.moveTo(L * .5, 0); ctx.lineTo(-L * .5, -1.6); ctx.lineTo(-L * .5, 1.6); ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#ffffff'; ctx.fillRect(L * .2, -.6, L * .3, 1.2);
            break;
          }
          case 'lance': {
            ctx.rotate(ang);
            const L = F.len || 14;
            ctx.globalAlpha = .5; ctx.fillStyle = p.col;
            ctx.fillRect(-L * .8, -p.r * .8, L * 1.4, p.r * 1.6);
            ctx.globalAlpha = .98; ctx.fillStyle = '#ffffff';
            ctx.fillRect(-L * .35, -p.r * .32, L * .9, p.r * .64);
            for (let i = 0; i < 3; i++) {
              const o = (i - 1) * p.r * .9;
              ctx.fillStyle = p.col;
              ctx.fillRect(L * .45 + Math.abs(o) * .4, o - .7, 2, 1.4);
            }
            break;
          }
          case 'orb': {
            const r = p.r * puls;
            ctx.fillStyle = p.col;
            ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.beginPath(); ctx.arc(0, 0, r * .45, 0, TAU); ctx.fill();
            if (qual >= 1) {
              ctx.globalAlpha = .55;
              for (let i = 0; i < 4; i++) {
                const a2 = (p.rot || 0) * 1.6 + i * TAU / 4;
                ctx.fillStyle = p.col;
                ctx.fillRect(Math.cos(a2) * r * 1.7 - 1, Math.sin(a2) * r * 1.7 - 1, 2, 2);
              }
            }
            break;
          }
          case 'crystal': {
            ctx.rotate(p.rot || 0);
            const r = p.r * 1.25;
            ctx.fillStyle = p.col;
            ctx.beginPath();
            ctx.moveTo(0, -r); ctx.lineTo(r * .55, 0); ctx.lineTo(0, r); ctx.lineTo(-r * .55, 0);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,.85)';
            ctx.fillRect(-.8, -r * .6, 1.6, r * 1.2);
            break;
          }
          case 'blob': {
            const r = p.r * (1 + .12 * Math.sin((p.wobT || 0) * 2));
            ctx.fillStyle = p.col;
            ctx.beginPath(); ctx.ellipse(0, 0, r * 1.15, r * .85, p.rot || 0, 0, TAU); ctx.fill();
            ctx.fillStyle = shade(p.col, -.3);
            ctx.beginPath(); ctx.arc(r * .3, -r * .2, r * .35, 0, TAU); ctx.fill();
            ctx.fillStyle = shade(p.col, .35);
            ctx.beginPath(); ctx.arc(-r * .35, r * .25, r * .25, 0, TAU); ctx.fill();
            break;
          }
          case 'saw': {
            ctx.rotate(p.rot || 0);
            const r = p.r * 1.3;
            ctx.fillStyle = p.col;
            ctx.beginPath();
            for (let i = 0; i < 8; i++) {
              const a2 = i / 8 * TAU, rr = i % 2 ? r * .58 : r;
              i ? ctx.lineTo(Math.cos(a2) * rr, Math.sin(a2) * rr) : ctx.moveTo(Math.cos(a2) * rr, Math.sin(a2) * rr);
            }
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#2a2f3d';
            ctx.beginPath(); ctx.arc(0, 0, r * .3, 0, TAU); ctx.fill();
            break;
          }
          case 'star': {
            ctx.rotate(p.rot || 0);
            const r = p.r * 1.5;
            ctx.fillStyle = p.col;
            ctx.beginPath();
            for (let i = 0; i < 8; i++) {
              const a2 = i / 8 * TAU, rr = i % 2 ? r * .38 : r;
              i ? ctx.lineTo(Math.cos(a2) * rr, Math.sin(a2) * rr) : ctx.moveTo(Math.cos(a2) * rr, Math.sin(a2) * rr);
            }
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(-1, -1, 2, 2);
            break;
          }
          case 'void': {
            const r = p.r * 1.2;
            ctx.fillStyle = '#0a0713';
            ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
            ctx.strokeStyle = p.col; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(0, 0, r * (1.25 + .12 * Math.sin((p.rot || 0) * 3)), 0, TAU); ctx.stroke();
            ctx.globalAlpha = .6;
            for (let i = 0; i < 5; i++) {
              const a2 = (p.rot || 0) * 2 + i * TAU / 5;
              ctx.fillStyle = p.col;
              ctx.fillRect(Math.cos(a2) * r * 1.7 - 1, Math.sin(a2) * r * 1.7 - 1, 2, 2);
            }
            break;
          }
          case 'crate': {
            ctx.rotate(p.rot || 0);
            const r = p.r * 1.4;
            ctx.fillStyle = '#8a5f34'; ctx.fillRect(-r, -r * .8, r * 2, r * 1.6);
            ctx.fillStyle = '#e0a83a';
            for (let i = 0; i < 3; i++) ctx.fillRect(-r + 1.4 + i * (r * .62), -r * .55, r * .34, r * 1.1);
            ctx.fillStyle = '#5c3f22'; ctx.fillRect(-r, -r * .12, r * 2, r * .24);
            break;
          }
          case 'mine': {
            ctx.rotate(p.rot || 0);
            const r = p.r * 1.1;
            ctx.fillStyle = '#3a2118';
            ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
            ctx.fillStyle = p.col;
            for (let i = 0; i < 4; i++) {
              const a2 = i / 4 * TAU;
              ctx.fillRect(Math.cos(a2) * r * 1.25 - 1.4, Math.sin(a2) * r * 1.25 - 1.4, 2.8, 2.8);
            }
            ctx.fillStyle = '#ffdf9a';
            ctx.beginPath(); ctx.arc(0, 0, r * .38, 0, TAU); ctx.fill();
            break;
          }
          case 'bird': {
            ctx.rotate(ang);
            const r = p.r * 1.2;
            const flap = Math.sin((p.wobT || 0) * 3) * .7;
            ctx.fillStyle = p.col;
            ctx.beginPath();
            ctx.moveTo(r * 1.2, 0);
            ctx.lineTo(-r * .3, -r * .5); ctx.lineTo(-r * .9, 0); ctx.lineTo(-r * .3, r * .5);
            ctx.closePath(); ctx.fill();
            ctx.strokeStyle = shade(p.col, -.25); ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(-r * .1, 0); ctx.lineTo(-r * .6, -r * (1.1 + flap));
            ctx.moveTo(-r * .1, 0); ctx.lineTo(-r * .6, r * (1.1 - flap));
            ctx.stroke();
            ctx.fillStyle = '#ffcf4a';
            ctx.fillRect(r * .9, -.6, 2, 1.2);
            break;
          }
          case 'droplet': {
            ctx.rotate(ang);
            ctx.fillStyle = p.col;
            ctx.beginPath();
            ctx.moveTo(p.r * 1.5, 0);
            ctx.quadraticCurveTo(0, -p.r, -p.r, 0);
            ctx.quadraticCurveTo(0, p.r, p.r * 1.5, 0);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,.7)';
            ctx.fillRect(-p.r * .2, -p.r * .35, p.r * .5, p.r * .3);
            break;
          }
          default:
            ctx.fillStyle = p.col;
            ctx.beginPath(); ctx.arc(0, 0, p.r, 0, TAU); ctx.fill();
        }
        if (hi) {
          ctx.globalAlpha = 1; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(0, 0, p.r + 1.4, 0, TAU); ctx.stroke();
        }
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
    for (const b of EnemyBullets.active) {
      /* Culling: Kugeln außerhalb des Sichtbereichs nicht zeichnen (wie bei Gegnern) */
      if (Math.abs(b.x - this.cam.x) > pvw + b.r || Math.abs(b.y - this.cam.y) > pvh + b.r) continue;
      const ba = Math.atan2(b.vy, b.vx);
      ctx.save(); ctx.translate(b.x, b.y);
      if (this.quality() >= 1) {
        ctx.globalAlpha = .3; ctx.fillStyle = b.col;
        ctx.beginPath(); ctx.arc(0, 0, b.r * 2.4, 0, TAU); ctx.fill();
        /* Tempo-Schweif auch fuer Gegnerkugeln, dezenter als bei Spielerschuessen */
        const sp = Math.hypot(b.vx, b.vy), sf = clamp((sp - 160) / 520, 0, 1);
        if (sf > .05) {
          ctx.save(); ctx.rotate(ba); ctx.globalCompositeOperation = 'lighter';
          const La = b.r * 1.4 + sf * 16;
          for (let i = 0; i < 3; i++) {
            const f0 = i / 3, f1 = (i + 1) / 3;
            ctx.globalAlpha = .22 * (1 - f0) * sf;
            ctx.fillStyle = i === 0 ? '#ffffff' : b.col;
            const h = b.r * (.9 - f0 * .55);
            ctx.fillRect(-La * f1, -h, La * (f1 - f0) + .6, h * 2);
          }
          ctx.restore();
        }
      }
      ctx.globalAlpha = .95; ctx.fillStyle = b.col;
      ctx.rotate(ba);
      ctx.beginPath(); ctx.ellipse(0, 0, b.r * 1.35, b.r * .8, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.globalAlpha = .8;
      ctx.fillRect(b.r * .2, -b.r * .22, b.r * .7, b.r * .44);
      if (OPT().highContrast) { ctx.globalAlpha = 1; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(0, 0, b.r + 1.2, 0, TAU); ctx.stroke(); }
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    this.drawShadows(ctx);
    this.drawArenaMod(ctx);
    this.drawHazObjs(ctx);
    FX.draw(ctx);
    for (const p of this.players) p.draw(ctx);
    FX.drawHazes(ctx);
    FX.drawLights(ctx);
    FX.drawNumbers(ctx);
    ctx.restore();
    if (this.quality() >= 1) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const p of this.players) {
        if (!p.alive) continue;
        const sxp = p.x - this.cam.x, syp = p.y - this.cam.y;
        const sx = (sxp) * this.cam.zoom + this.W / 2 + this.cam.sx, sy = (syp) * this.cam.zoom + this.H / 2 + this.cam.sy;
        const g = ctx.createRadialGradient(sx, sy, 30, sx, sy, 300);
        g.addColorStop(0, 'rgba(244,194,90,.12)'); g.addColorStop(1, 'rgba(244,194,90,0)');
        ctx.fillStyle = g; ctx.fillRect(sx - 300, sy - 300, 600, 600);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
    }
    this.drawArenaModOverlay(ctx);
    if (this.modActive('dunkelheit')) {
      const g = ctx.createRadialGradient(this.W / 2, this.H / 2, this.H * .22, this.W / 2, this.H / 2, this.H * .75);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.78)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, this.W, this.H);
    }
    this.drawSplats(ctx);
    this.drawBossIntro(ctx);
    if (this.perfectFlash > 0) { ctx.save(); ctx.globalAlpha = this.perfectFlash * .35; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, this.W, this.H); ctx.restore(); }
    this.renderScreenAid(ctx);
    if (OPT().minimap) this.renderMinimap(ctx);
  },
  renderMinimap(ctx) {
    const L = this.level, mw = 150, mh = mw * (L.h / L.w);
    const x0 = this.W - mw - 12, y0 = this.H - mh - 12;
    ctx.globalAlpha = .78;
    ctx.fillStyle = '#070a12'; ctx.fillRect(x0, y0, mw, mh);
    ctx.strokeStyle = '#25406b'; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, mw, mh);
    ctx.fillStyle = '#dbe6ff'; ctx.font = '9px monospace'; ctx.textAlign = 'left';
    ctx.fillText(L.a.name.toUpperCase(), x0 + 4, y0 + 10);
    ctx.fillStyle = 'rgba(219,230,255,.4)'; ctx.font = '8px monospace';
    ctx.fillText('W' + Game.wave + (Game.mods.length ? ' · ' + Game.mods[0].name : ''), x0 + 4, y0 + 20);
    const sx = mw / L.w, sy = mh / L.h;
    ctx.fillStyle = '#25406b';
    for (const r of L.allWalls()) ctx.fillRect(x0 + r.x * sx, y0 + r.y * sy, r.w * sx, r.h * sy);
    /* Gegner nach Art eingefärbt, Elite und Boss hervorgehoben */
    for (const e of this.enemies) {
      if (e.dead) continue;
      const mx = x0 + e.x * sx, my = y0 + e.y * sy;
      if (e.boss) {
        ctx.fillStyle = e.col;
        ctx.fillRect(mx - 3, my - 3, 6, 6);
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
        ctx.strokeRect(mx - 4, my - 4, 8, 8);
      } else if (e.charmT > 0) { ctx.fillStyle = '#ffd24a'; ctx.fillRect(mx - 1.5, my - 1.5, 3, 3); }
      else if (e.elite) { ctx.fillStyle = '#c7a6ff'; ctx.fillRect(mx - 2, my - 2, 4, 4); }
      else { ctx.fillStyle = e.col; ctx.fillRect(mx - 1, my - 1, 2, 2); }
    }
    /* Fässer und Gefahrenobjekte auf der Karte */
    ctx.fillStyle = '#ff8a3d';
    if (L.barrels) for (const b of L.barrels) if (!b.dead) ctx.fillRect(x0 + b.x * sx - 1, y0 + b.y * sy - 1, 2, 2);
    for (const p of this.players) {
      if (!p.alive) continue;
      ctx.fillStyle = p.index === 0 ? '#f4c25a' : '#39e6ff';
      ctx.fillRect(x0 + p.x * sx - 2, y0 + p.y * sy - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
    /* Bosspfeil am Bildschirmrand, wenn der Boss außerhalb der Sicht ist */
    const boss = this.enemies.find(e => !e.dead && e.boss);
    if (boss) {
      const bx = (boss.x - this.cam.x) * this.cam.zoom + this.W / 2 + this.cam.sx;
      const by = (boss.y - this.cam.y) * this.cam.zoom + this.H / 2 + this.cam.sy;
      const m = 46;
      if (bx < m || bx > this.W - m || by < m || by > this.H - m) {
        const a = Math.atan2(by - this.H / 2, bx - this.W / 2);
        const px = this.W / 2 + Math.cos(a) * (Math.min(this.W, this.H) / 2 - m);
        const py = this.H / 2 + Math.sin(a) * (Math.min(this.W, this.H) / 2 - m);
        ctx.save();
        ctx.translate(px, py); ctx.rotate(a);
        ctx.globalAlpha = .55 + .35 * Math.sin(this.time * 6);
        ctx.fillStyle = boss.col;
        ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-10, -11); ctx.lineTo(-4, 0); ctx.lineTo(-10, 11); ctx.closePath(); ctx.fill();
        ctx.restore();
        ctx.globalAlpha = 1;
      }
    }
  },
  /* ---- Bildschirmkanten-Spritzer bei Nahtreffern ---- */
  splats: [],
  addSplat(ang, amount, who) {
    if (OPT().splatter === false || this.quality() < 1) return;
    const n = Math.round(3 + amount * 9);
    for (let i = 0; i < n; i++) {
      const a = ang + rnd(-.9, .9);
      const edge = .5 + Math.random() * .55;
      this.splats.push({
        x: .5 + Math.cos(a) * edge, y: .5 + Math.sin(a) * edge,
        r: rnd(6, 26) * (.6 + amount), a: rnd(TAU),
        life: rnd(2.2, 4.5), max: 4.5, drip: rnd(6, 26), who: who || 0
      });
    }
    if (this.splats.length > 90) this.splats.splice(0, this.splats.length - 90);
  },
  updateSplats(dt) {
    for (let i = this.splats.length - 1; i >= 0; i--) {
      const s = this.splats[i];
      s.life -= dt;
      s.y += dt * .004 * s.drip / Math.max(1, s.r);
      if (s.life <= 0) this.splats.splice(i, 1);
    }
  },
  drawSplats(ctx) {
    if (!this.splats.length) return;
    ctx.save();
    for (const s of this.splats) {
      const f = clamp(s.life / s.max, 0, 1);
      const px = s.x * this.W, py = s.y * this.H;
      ctx.globalAlpha = .55 * f;
      ctx.fillStyle = s.who === 1 ? '#5a1030' : '#6e0f18';
      ctx.beginPath(); ctx.ellipse(px, py, s.r, s.r * .72, s.a, 0, TAU); ctx.fill();
      ctx.globalAlpha = .35 * f;
      ctx.beginPath(); ctx.ellipse(px + s.r * .3, py + s.r * .55, s.r * .3, s.r * .5, s.a, 0, TAU); ctx.fill();
      ctx.globalAlpha = .22 * f;
      ctx.fillStyle = '#2a0409';
      ctx.beginPath(); ctx.ellipse(px, py, s.r * .55, s.r * .4, s.a, 0, TAU); ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  },
  renderScreenAid(ctx) {
    const hw = this.W / 2, hh = this.H / 2;
    const cx = this.cam.x, cy = this.cam.y, z = this.cam.zoom;
    const vw = hw / z, vh = hh / z;
    const cands = [];
    let boss = null;
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (e.boss) { boss = e; continue; }
      const dx = e.x - cx, dy = e.y - cy;
      if (Math.abs(dx) > vw + 20 || Math.abs(dy) > vh + 20) cands.push({ e, d: dx * dx + dy * dy });
    }
    cands.sort((a, b) => a.d - b.d);
    const drawArrow = (e, col) => {
      const dx = e.x - cx, dy = e.y - cy;
      let sx = dx * z + hw + this.cam.sx, sy = dy * z + hh + this.cam.sy;
      if (sx > -14 && sx < this.W + 14 && sy > -14 && sy < this.H + 14) return;
      const a = Math.atan2(sy - hh, sx - hw);
      const rr = Math.min(hw, hh) * .44;
      let px = hw + Math.cos(a) * rr, py = hh + Math.sin(a) * rr;
      px = clamp(px, 26, this.W - 26); py = clamp(py, 26, this.H - 26);
      ctx.save(); ctx.translate(px, py); ctx.rotate(a);
      ctx.fillStyle = col; ctx.globalAlpha = .92;
      ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-5, -6.5); ctx.lineTo(-5, 6.5); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1; ctx.restore();
    };
    for (let i = 0; i < Math.min(3, cands.length); i++) drawArrow(cands[i].e, '#ff5d6e');
    if (boss) drawArrow(boss, '#ff2e88');
    if (boss) {
      const bw = Math.min(620, this.W * .62);
      const bx = hw - bw / 2, by = 30;
      const frac = clamp(boss.hp / boss.maxHp, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(bx - 4, by - 4, bw + 8, 22);
      const g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      g.addColorStop(0, boss.col); g.addColorStop(1, boss.col);
      ctx.fillStyle = g; ctx.fillRect(bx, by, bw * frac, 14);
      ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.fillRect(bx + bw * frac, by, 2, 14);
      ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 1; ctx.strokeRect(bx, by, bw, 14);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'left';
      const tag = boss.boss.name + (boss.bossVariant ? ' · ' + (boss.bossVariant === 'wut' ? 'WUT' : 'GEIFER') : '');
      ctx.fillText(tag, bx, by - 7);
    }
  },
  /* Der Held im Titelbild: nearest-neighbour vergroessert, damit die
     Pixel Pixel bleiben. Groesse und Lage haengen am Schriftzug, damit
     es auf jeder Bildschirmgroesse zusammenpasst. */
  renderTitleBg(ctx) {
    const t = performance.now() / 1000;
    const g = ctx.createLinearGradient(0, 0, 0, this.H);
    g.addColorStop(0, '#0a1024'); g.addColorStop(.55, '#131b33'); g.addColorStop(1, '#1b1026');
    ctx.fillStyle = g; ctx.fillRect(0, 0, this.W, this.H);
    for (let i = 0; i < 90; i++) {
      const x = (i * 137.5) % this.W, y = (i * 71.3) % (this.H * .6);
      ctx.globalAlpha = .25 + .25 * Math.sin(t * 2 + i);
      ctx.fillStyle = '#dbe6ff'; ctx.fillRect(x, y, 2, 2);
    }
    ctx.globalAlpha = 1;
    const baseY = this.H * .82;
    for (let layer = 0; layer < 3; layer++) {
      const off = t * (6 + layer * 5) % 220;
      ctx.fillStyle = ['#141d33', '#101728', '#0b1020'][layer];
      for (let i = -1; i < this.W / 110 + 2; i++) {
        const x = i * 110 - off + layer * 30;
        const h = 60 + ((i * 37 + layer * 13) % 9) * 22;
        ctx.fillRect(x, baseY - h + layer * 26, 92, h + 200);
        ctx.fillStyle = 'rgba(244,194,90,.12)';
        for (let wy = baseY - h + layer * 26 + 10; wy < baseY + layer * 26; wy += 22)
          for (let wx = x + 8; wx < x + 84; wx += 20)
            if ((wx * wy + layer) % 5 < 2) ctx.fillRect(wx, wy, 8, 10);
        ctx.fillStyle = ['#141d33', '#101728', '#0b1020'][layer];
      }
    }
    for (let l = 0; l < 3; l++) {
      const off = t * (14 + l * 9) % (this.W + 300);
      ctx.fillStyle = 'rgba(160,210,255,' + (.03 + l * .015) + ')';
      for (let i = -1; i < this.W / 200 + 2; i++) {
        const x = i * 200 - off + l * 40;
        ctx.beginPath(); ctx.ellipse(x, this.H * (.5 + l * .13), 90 + l * 22, 26 + l * 6, 0, 0, TAU); ctx.fill();
      }
    }
    ctx.strokeStyle = 'rgba(255,46,136,.5)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, baseY + 78); ctx.lineTo(this.W, baseY + 78); ctx.stroke();
    /* Die Figur steht jetzt als DOM-Element neben dem Schriftzug — auf der
       Leinwand waere sie hinter der fast deckenden Menueflaeche unsichtbar. */
  }
});
