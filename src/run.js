/* ============================ 17. LEVEL-GENERATOR ============================ */
class Level {
  constructor(arena, wave) {
    this.a = arena; this.w = arena.w; this.h = arena.h;
    this.walls = []; this.fields = []; this.moving = []; this.decor = [];
    this.wx = []; this.wxT = 0; this.weather = 'none';
    this.stormT = 0; this.stormFlash = 0;
    this.generate(wave);
    this.placeProps();
    this.buildTexture();
    this.bakeWalls();
    this.makeWeather(wave);
    this.hazards = []; this.drops = []; this.decals = []; this.hazT = rnd(4, 9); this.barrels = [];
    if (arena.id === 'innenstadt') for (const m of this.moving) m.spd *= 1.8;
  }
  /* Ueberabtastung: die Kamera zoomt bis 1.8x und rendert bis dpr 2 —
     ein Bodenbild in Arenagroesse waere dabei sichtbar weich. Auf hoher
     Stufe wird deshalb doppelt so gross gebacken und beim Zeichnen
     heruntergerechnet. */
  static groundScale() {
    const q = (typeof Game !== 'undefined' && Game.quality) ? Game.quality() : 2;
    if (q <= 0) return 1;
    if (q === 1) return 1.5;
    /* Auf grossen Bildschirmen steht der Boden unter starker Vergroesserung.
       Die Ueberabtastung folgt deshalb dem tatsaechlichen Bildmassstab,
       statt fest auf 2 zu stehen. */
    const G = typeof Game !== 'undefined' ? Game : null;
    if (!G || !G.W) return 2;
    const z = Math.sqrt((G.W * G.H) / (1130 * 640)) * (G.dpr || 1);
    return clamp(Math.round(z * 2) / 2, 2, 3);
  }
  buildTexture() {
    const gk = GROUND_TEX_ARENA[this.a.id];
    const gi = gk ? _groundImgs[gk] : null;
    const GS = Level.groundScale();
    const key = this.a.id + '@' + GS;
    Level.texCache = Level.texCache || {};
    if (Level.texCache[key] && (gi || !gk)) { this.tex = Level.texCache[key]; return; }
    const cv = document.createElement('canvas');
    cv.width = Math.round(this.w * GS); cv.height = Math.round(this.h * GS);
    const x = cv.getContext('2d'), a = this.a;
    x.setTransform(GS, 0, 0, GS, 0, 0);
    /* 1. Grundton der Arena — er bestimmt die Farbe, nicht die Textur. */
    x.fillStyle = a.ground; x.fillRect(0, 0, this.w, this.h);
    if (gi) {
      const pat = groundPattern(x, gk);
      if (pat) {
        /* 2. Materialstruktur ueber 'overlay': die Textur liefert Helligkeit
              und Korn, der Arena-Farbton bleibt erhalten. Frueher lag sie
              nur mit 34% Deckkraft darueber und wirkte wie Schmutzschleier. */
        x.save();
        x.globalCompositeOperation = 'overlay';
        x.globalAlpha = .72;
        x.fillStyle = pat; x.fillRect(0, 0, this.w, this.h);
        /* 3. Tiefe: dieselbe Struktur noch einmal multiplizierend, sehr
              schwach — das ergibt Fugen und Vertiefungen. */
        x.globalCompositeOperation = 'multiply';
        x.globalAlpha = .28;
        x.fillStyle = pat; x.fillRect(0, 0, this.w, this.h);
        x.restore();
      }
    }
    /* 5. Raster — jetzt dezenter, weil das Material die Struktur traegt */
    x.strokeStyle = a.grid; x.lineWidth = 1; x.globalAlpha = .30;
    const gs = 80;
    x.beginPath();
    for (let gx = 0; gx <= this.w; gx += gs) { x.moveTo(gx, 0); x.lineTo(gx, this.h); }
    for (let gy = 0; gy <= this.h; gy += gs) { x.moveTo(0, gy); x.lineTo(this.w, gy); }
    x.stroke(); x.globalAlpha = 1;
    /* 6. Flecken und Kratzer wie bisher */
    const n = Math.floor(this.w * this.h / 9000);
    for (let i = 0; i < n; i++) {
      const px = Math.random() * this.w, py = Math.random() * this.h, r = Math.random() * 4 + 6;
      x.globalAlpha = Math.random() * .14 + .04;
      x.fillStyle = Math.random() < .5 ? a.accent : '#000';
      x.beginPath(); x.arc(px, py, r, 0, TAU); x.fill();
      if (Math.random() < .3) {
        x.strokeStyle = '#000'; x.lineWidth = 1;
        x.beginPath(); x.moveTo(px - r, py); x.lineTo(px + r, py + r * .5); x.stroke();
      }
    }
    /* 7. Randabdunklung: haelt den Blick in der Mitte der Arena */
    const vg = x.createRadialGradient(this.w / 2, this.h / 2, Math.min(this.w, this.h) * .34, this.w / 2, this.h / 2, Math.max(this.w, this.h) * .72);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,.34)');
    x.globalAlpha = 1; x.fillStyle = vg; x.fillRect(0, 0, this.w, this.h);
    x.setTransform(1, 0, 0, 1, 0, 0);
    this.tex = cv; cv._gs = GS;
    /* Ueberabgetastete Bilder sind gross: bei 3x sind es rund 40 MB je
       Arena, dann bleibt nur eine im Speicher. */
    const keep = GS >= 3 ? 1 : 2;
    const keys = Object.keys(Level.texCache);
    while (keys.length >= keep) delete Level.texCache[keys.shift()];
    Level.texCache[key] = cv;
  }
  bakeWalls() {
    const a = this.a;
    for (const r of this.allWalls()) {
      if (r._cv || r.trunk) continue;         /* Baumstaemme haben schon ein Sprite */
      const hgt = r.height || 20;
      const cw = Math.ceil(r.w + 6), ch = Math.ceil(r.h + hgt * .35 + 6);
      const cv = document.createElement('canvas'); cv.width = Math.max(1, cw); cv.height = Math.max(1, ch);
      const x = cv.getContext('2d');
      x.fillStyle = 'rgba(0,0,0,.45)';
      x.fillRect(6, 6, r.w, r.h);
      const wt = WALL_TEX_ARENA[a.id] || ['brick', 'brick'];
      const topPat = groundPattern(x, wt[0]), sidePat = groundPattern(x, wt[1]);
      /* Flanke (die zum Betrachter zeigende Mauerseite) */
      x.fillStyle = shade(a.grid, -.35);
      x.beginPath();
      x.moveTo(0, r.h); x.lineTo(r.w, r.h);
      x.lineTo(r.w, r.h + hgt * .35); x.lineTo(0, r.h + hgt * .35); x.closePath(); x.fill();
      if (sidePat) {
        x.save(); x.clip();
        x.globalCompositeOperation = 'overlay'; x.globalAlpha = .42;
        x.fillStyle = sidePat; x.fillRect(0, r.h, r.w, hgt * .35 + 2);
        /* nach unten hin dunkler - die Flanke liegt im Schatten */
        x.globalCompositeOperation = 'source-over';
        const sg = x.createLinearGradient(0, r.h, 0, r.h + hgt * .35);
        sg.addColorStop(0, 'rgba(0,0,0,0)'); sg.addColorStop(1, 'rgba(0,0,0,.55)');
        x.globalAlpha = 1; x.fillStyle = sg; x.fillRect(0, r.h, r.w, hgt * .35 + 2);
        x.restore();
      }
      /* Oberseite. Bewusst dunkel gehalten: die Arena ist naechtlich, die
         Lesbarkeit kommt aus der Akzentkante, nicht aus einer hellen
         Flaeche - sonst leuchten die Bloecke wie Papierschnipsel. */
      x.fillStyle = r.cover ? shade(a.grid, -.10) : shade(a.grid, .12);
      x.fillRect(0, 0, r.w, r.h);
      if (topPat) {
        x.save();
        x.beginPath(); x.rect(0, 0, r.w, r.h); x.clip();
        x.globalCompositeOperation = 'overlay'; x.globalAlpha = r.cover ? .34 : .46;
        x.fillStyle = topPat; x.fillRect(0, 0, r.w, r.h);
        x.globalCompositeOperation = 'multiply'; x.globalAlpha = .34;
        x.fillStyle = topPat; x.fillRect(0, 0, r.w, r.h);
        x.restore();
        /* Kantenlicht: nur die Oberkante faengt das Streiflicht */
        x.globalAlpha = .13; x.fillStyle = '#ffffff';
        x.fillRect(0, 0, r.w, 1.5); x.globalAlpha = 1;
      }
      x.strokeStyle = a.accent; x.globalAlpha = r.cover ? .35 : .6; x.lineWidth = 1.5;
      x.strokeRect(0, 0, r.w, r.h); x.globalAlpha = 1;
      if (!r.cover) {
        x.fillStyle = 'rgba(244,194,90,.20)';
        for (let wx = r.x + 10; wx < r.x + r.w - 12; wx += 26)
          for (let wy = r.y + 10; wy < r.y + r.h - 12; wy += 26)
            if ((wx * wy) % 7 < 4) x.fillRect(wx - r.x, wy - r.y, 10, 12);
      }
      r._cv = cv;
    }
  }
  makeWeather(wave) {
    const W = this.w, H = this.h;
    const WX = { kurpark: 'pollen', rheinufer: 'fog', labor: 'sparks', neroberg: 'embers', innenstadt: 'none', warmerdamm: 'petals', schlachthof: 'mist' };
    const base = WX[this.a.id] || 'none';
    const specials = ['rain', 'rain', 'snow', 'hail', 'thunder'];
    const n = Math.max(1, wave || 1);
    let chosen;
    if (n >= 8 && RAND() < Math.min(.5, .12 + n * .02)) chosen = 'thunder';
    else if (n >= 5 && RAND() < .28) chosen = pick(specials);
    else if (n >= 3 && RAND() < .2) chosen = pick(['rain', 'snow', 'hail', 'mist']);
    else chosen = base;
    if (chosen === 'none' && n >= 3 && RAND() < .15) chosen = pick(specials);
    this.weather = chosen;
    this.wx = [];
    this.glows = [];
    if ((wave || 1) >= 16) for (let i = 0; i < 16; i++) this.glows.push({ x: Math.random() * W, y: Math.random() * H, vx: Math.random() * -9 + 4.5, vy: Math.random() * -7 - 3, r: Math.random() * 1.6 + 1, ph: Math.random() * TAU });
    const wx = this.wx;
    if (this.weather === 'pollen') for (let i = 0; i < 40; i++) wx.push({ x: Math.random() * W, y: Math.random() * H, vx: Math.random() * -20 + 5, vy: Math.random() * -18 - 4, r: Math.random() * 1.6 + .8, c: 'rgba(255,244,200,.35)', a: Math.random() * .5 + .5, ph: Math.random() * TAU });
    else if (this.weather === 'fog') for (let i = 0; i < 12; i++) wx.push({ x: Math.random() * W, y: Math.random() * H, w: Math.random() * 180 + 140, h: Math.random() * 50 + 40, vx: Math.random() * 22 + 18, c: 'rgba(160,210,255,.06)', ph: Math.random() * TAU, baseY: Math.random() * H });
    else if (this.weather === 'sparks') for (let i = 0; i < 16; i++) wx.push({ x: Math.random() * W, y: Math.random() * H, vx: Math.random() * -8 + 4, vy: Math.random() * -30 - 10, r: Math.random() * 1.4 + .8, c: '#7dffdc', a: Math.random() * .5 + .3, ph: Math.random() * TAU });
    else if (this.weather === 'embers') for (let i = 0; i < 26; i++) wx.push({ x: Math.random() * W, y: Math.random() * H, vx: Math.random() * -12 + 6, vy: Math.random() * -34 - 12, r: Math.random() * 1.8 + .8, c: '#ff8a3d', a: Math.random() * .5 + .3, ph: Math.random() * TAU });
    else if (this.weather === 'petals') { const cols = ['#ffd23e', '#ffb84d', '#fff3c4', '#ff9d5c']; for (let i = 0; i < 36; i++) wx.push({ x: Math.random() * W, y: Math.random() * H, vx: Math.random() * -14 + 8, vy: Math.random() * -22 - 8, r: Math.random() * 2.2 + 1.2, c: cols[i % 4], a: Math.random() * .5 + .35, ph: Math.random() * TAU, sway: Math.random() * .5 + .2 }); }
    else if (this.weather === 'mist') for (let i = 0; i < 10; i++) wx.push({ x: Math.random() * W, y: Math.random() * H, w: Math.random() * 200 + 160, h: Math.random() * 60 + 40, vx: Math.random() * 14 + 8, c: 'rgba(160,95,85,.06)', ph: Math.random() * TAU, baseY: Math.random() * H });
    else if (this.weather === 'rain') for (let i = 0; i < 70; i++) wx.push({ x: Math.random() * W, y: Math.random() * H, vx: Math.random() * -8 + 2, vy: Math.random() * 380 + 220, r: Math.random() * 1.2 + 1, c: 'rgba(150,200,255,.5)', ph: Math.random() * TAU });
    else if (this.weather === 'snow') for (let i = 0; i < 44; i++) wx.push({ x: Math.random() * W, y: Math.random() * H, vx: Math.random() * -14 + 8, vy: Math.random() * -24 - 8, r: Math.random() * 2 + 1, c: 'rgba(255,255,255,.85)', ph: Math.random() * TAU, sway: Math.random() * .5 + .2 });
    else if (this.weather === 'hail') for (let i = 0; i < 56; i++) wx.push({ x: Math.random() * W, y: Math.random() * H, vx: Math.random() * -10 + 4, vy: Math.random() * 420 + 240, r: Math.random() * 2.4 + 1.4, c: 'rgba(210,230,255,.85)', ph: Math.random() * TAU });
    else if (this.weather === 'thunder') {
      for (let i = 0; i < 46; i++) wx.push({ x: Math.random() * W, y: Math.random() * H, vx: Math.random() * -10 + 4, vy: Math.random() * 420 + 240, r: Math.random() * 1.4 + 1, c: 'rgba(140,160,255,.55)', ph: Math.random() * TAU });
      this.stormT = crnd(1.5, 3);
      this.stormFlash = 0;
    }
  }
  /* ------------------------------------------------------------------
     ARENA-ARCHITEKTUR
     Die Bauteile richten sich nach dem Thema der Arena. Drei Regeln
     halten das Ergebnis spielbar:
       1. Die Mitte bleibt frei  - dort starten die Spieler.
       2. Am Rand bleibt eine Bahn - sonst laesst sich nicht mehr kiten.
       3. Bauteile ueberlappen sich nicht und lassen ueberall Gassen.
     ------------------------------------------------------------------ */
  placeRect(list, x, y, w, h, o) {
    const W = this.w, H = this.h;
    const M = 74;                                  /* Randbahn */
    x = clamp(x, M, W - M - w); y = clamp(y, M, H - M - h);
    if (w > W - 2 * M || h > H - 2 * M) return null;
    const cx = W / 2, cy = H / 2;
    /* Startkreis in der Mitte freihalten */
    const nx = clamp(cx, x, x + w), ny = clamp(cy, y, y + h);
    if (dist2(cx, cy, nx, ny) < 190 * 190) return null;
    /* Gassen zwischen den Bauteilen: mindestens 62 px Abstand */
    const G = 62;
    for (const r of list) {
      if (x < r.x + r.w + G && x + w + G > r.x && y < r.y + r.h + G && y + h + G > r.y) return null;
    }
    const rect = Object.assign({ x: x, y: y, w: w, h: h, height: 20 }, o || {});
    list.push(rect);
    return rect;
  }
  generate(wave) {
    const a = this.a, W = this.w, H = this.h;
    this.walls = []; this.moving = [];
    const all = [];
    const theme = a.theme;
    const put = (x, y, w, h, o) => this.placeRect(all, x, y, w, h, o);

    /* ---- Bewegliche Waende zuerst: sie brauchen den breitesten Korridor
            und gingen sonst regelmaessig leer aus ---- */
    const nM = a.movingWalls | 0;
    for (let i = 0, tries = 0; i < nM && tries < nM * 40; tries++) {
      const horiz = RAND() < .5;
      const w = horiz ? rnd(120, 200) : rnd(26, 40);
      const h = horiz ? rnd(26, 40) : rnd(120, 200);
      const amp = rnd(55, 110);
      const bx = rnd(110 + amp, Math.max(120 + amp, W - 110 - amp - w));
      const by = rnd(110 + amp, Math.max(120 + amp, H - 110 - amp - h));
      const probe = horiz
        ? this.placeRect(all, bx - amp, by, w + amp * 2, h, {})
        : this.placeRect(all, bx, by - amp, w, h + amp * 2, {});
      if (!probe) continue;
      /* Der Platzhalter reserviert den Korridor; die Wand selbst ist kleiner. */
      probe.reserved = true;
      this.moving.push({
        x: horiz ? probe.x + amp : probe.x, y: horiz ? probe.y : probe.y + amp, w: w, h: h,
        phase: RAND() * TAU, spd: rnd(.5, .95), amp: amp, horiz: horiz, ox: 0,
        height: 26, moving: true
      });
      i++;
    }
    /* ---- Gebaeude: die grossen Sichtblocker ---- */
    const nB = a.buildings | 0;
    for (let i = 0, tries = 0; i < nB && tries < nB * 30; tries++) {
      let w, h;
      if (theme === 'raeume' || theme === 'räume') {
        /* Laborkammern: lange duenne Trennwaende */
        const horiz = RAND() < .5;
        w = horiz ? rnd(190, 330) : rnd(26, 40);
        h = horiz ? rnd(26, 40) : rnd(190, 330);
      } else if (theme === 'eng') {
        w = rnd(110, 210); h = rnd(90, 190);
      } else if (theme === 'boss') {
        w = rnd(150, 230); h = rnd(120, 190);
      } else {
        w = rnd(90, 180); h = rnd(80, 160);
      }
      const r = put(rnd(80, W - 80 - w), rnd(80, H - 80 - h), w, h, {
        height: theme === 'eng' ? rnd(30, 46) : rnd(20, 34)
      });
      if (r) i++;
    }
    /* ---- Deckung: kleine Bloecke, die Schuesse aufhalten ---- */
    const nC = a.cover | 0;
    for (let i = 0, tries = 0; i < nC && tries < nC * 30; tries++) {
      const w = rnd(46, 92), h = rnd(40, 84);
      const r = put(rnd(80, W - 80 - w), rnd(80, H - 80 - h), w, h, { cover: true, height: rnd(12, 20) });
      if (r) i++;
    }
    this.walls = all.filter(r => !r.reserved);
    this._flowDirty = true;   /* Sperrmaske des Flussfelds neu bestimmen */

    /* ---- Gefahren- und Tempofelder: nicht in Waende legen ---- */
    for (let i = 0; i < a.poison; i++) {
      const p = this.freeSpot(130);
      this.fields.push({ type: 'poison', x: p.x, y: p.y, r: rnd(70, 130), dps: 4 + wave * .35 });
    }
    for (let i = 0; i < a.speedField; i++) {
      const p = this.freeSpot(150);
      this.fields.push({ type: 'speed', x: p.x, y: p.y, r: rnd(80, 150), mult: RAND() < .65 ? 1.45 : .62 });
    }

    /* ---- Spawnpunkte am Rand, ausserhalb der Bauteile ---- */
    const cx = W / 2, cy = H / 2, maxR = Math.min(W, H) / 2 - 120;
    const N = clamp(Math.round(W * H / 450000), 5, 8);
    const pts = [];
    for (let i = 0; i < N; i++) {
      const ang = i / N * TAU + RAND() * .6;
      const rad = 400 + RAND() * Math.max(60, maxR - 400);
      let x = clamp(cx + Math.cos(ang) * rad, 110, W - 110);
      let y = clamp(cy + Math.sin(ang) * rad, 110, H - 110);
      if (dist(x, y, cx, cy) < 380) { const a2 = Math.atan2(y - cy, x - cx); x = clamp(cx + Math.cos(a2) * 380, 110, W - 110); y = clamp(cy + Math.sin(a2) * 380, 110, H - 110); }
      /* liegt der Punkt in einer Wand, ein Stueck nach aussen schieben */
      for (let t = 0; t < 12 && this.blocksRay(x, y); t++) {
        const a2 = Math.atan2(y - cy, x - cx) + .5;
        x = clamp(cx + Math.cos(a2) * (rad + t * 22), 110, W - 110);
        y = clamp(cy + Math.sin(a2) * (rad + t * 22), 110, H - 110);
      }
      pts.push({ x, y });
    }
    this.spawnPoints = pts; this.spawnIdx = 0; this.announce = 0;
    for (let i = 0; i < 90; i++) this.decor.push({ x: rnd(0, W), y: rnd(0, H), r: rnd(2, 6), c: RAND() < .5 ? a.grid : a.accent, a: rnd(.05, .2) });
  }
  /* Bewuchs setzen: nicht in Waenden, nicht im Startkreis, nicht
     aufeinander. Grosse Motive bekommen einen kleinen Stammkoerper,
     damit man nicht durch einen Baum hindurchlaeuft. */
  placeProps() {
    this.props = [];
    const cfg = ARENA_PROPS[this.a.id];
    if (!cfg || !cfg.n) return;
    const pick2 = list => {
      let tot = 0; for (const e of list) tot += e[1];
      let r = RAND() * tot;
      for (const e of list) { r -= e[1]; if (r <= 0) return e[0]; }
      return list[0][0];
    };
    const cx = this.w / 2, cy = this.h / 2;
    let trunks = 0;
    for (let i = 0, tries = 0; i < cfg.n && tries < cfg.n * 14; tries++) {
      const tall = cfg.tall.length && (!cfg.flat.length || RAND() < .55);
      const name = pick2(tall ? cfg.tall : cfg.flat);
      if (PROP_NAMES.indexOf(name) < 0) continue;
      const sc = rnd(cfg.scale[0], cfg.scale[1]) * (tall ? 1 : .72);
      const x = rnd(60, this.w - 60), y = rnd(60, this.h - 60);
      /* Startkreis der Spieler freihalten */
      if (dist2(x, y, cx, cy) < 210 * 210) continue;
      /* nicht in oder direkt an einer Wand */
      let bad = false;
      for (const r of this.allWalls()) {
        const nx = clamp(x, r.x, r.x + r.w), ny = clamp(y, r.y, r.y + r.h);
        if (dist2(x, y, nx, ny) < 46 * 46) { bad = true; break; }
      }
      if (bad) continue;
      /* nicht auf einem Spawnpunkt */
      for (const p of (this.spawnPoints || [])) if (dist2(x, y, p.x, p.y) < 90 * 90) { bad = true; break; }
      if (bad) continue;
      /* Abstand untereinander */
      for (const p of this.props) if (dist2(x, y, p.x, p.y) < (p.sc + sc) * .38 * (p.sc + sc) * .38) { bad = true; break; }
      if (bad) continue;
      const pr = { name: name, x: x, y: y, sc: sc, tall: tall, flip: RAND() < .5, sway: rnd(0, TAU) };
      this.props.push(pr);
      /* Nur die groessten Baeume bekommen einen Stamm als Hindernis —
         zu viele kleine Koerper wuerden die Wegfindung zusetzen. */
      if (tall && sc > 62 && trunks < 6 && /Tree|Palm/.test(name)) {
        const tw = 16, th = 12;
        this.walls.push({ x: x - tw / 2, y: y - th / 2 + sc * .12, w: tw, h: th, height: 10, cover: true, trunk: true });
        pr.trunk = true;
        trunks++;
      }
      i++;
    }
    this._wallsDirty = true;
  }
  /* Bewuchs zeichnen. Liegt unter den Figuren — genau wie die Waende,
     damit die Ebenen konsistent bleiben. */
  drawProps(ctx, cam, tall) {
    if (!PROP_READY || !this.props || !this.props.length) return;
    const atlas = propAtlasFor(this.a) || PROP_IMG;
    const pvw = Game.W / 2 / cam.zoom + 90, pvh = Game.H / 2 / cam.zoom + 110;
    const t = Game.time;
    const wind = Game.modIs('sturm') ? 2.2 : Game.modIs('regen') ? 1.4 : 1;
    for (const p of this.props) {
      if (!!p.tall !== tall) continue;
      if (Math.abs(p.x - cam.x) > pvw || Math.abs(p.y - cam.y) > pvh) continue;
      const b = PROP_BOX[p.name];
      if (!b) continue;
      const col = b.i % PROP_COLS, row = (b.i / PROP_COLS) | 0;
      const sx = col * PROP_CELL + b.x0, sy = row * PROP_CELL + b.y0;
      const sw = b.x1 - b.x0 + 1, sh = b.y1 - b.y0 + 1;
      const k = p.sc / PROP_CELL;
      const w = sw * k, h = sh * k;
      /* Der Fusspunkt liegt unten mittig im Rahmen. */
      const bx = p.x - w / 2, by = p.y - h + p.sc * .14;
      if (tall) {
        /* weicher Schlagschatten nach unten rechts, wie bei den Waenden */
        ctx.globalAlpha = .28;
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.ellipse(p.x + w * .10, p.y + p.sc * .09, w * .34, w * .15, 0, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      const swayX = tall ? Math.sin(t * 1.1 * wind + p.sway) * p.sc * .012 * wind : 0;
      ctx.save();
      ctx.translate(bx + w / 2 + swayX, by + h);
      if (p.flip) ctx.scale(-1, 1);
      ctx.drawImage(atlas, sx, sy, sw, sh, -w / 2, -h, w, h);
      ctx.restore();
    }
  }
  /* Freier Punkt mit Mindestabstand zu allen Bauteilen. */
  freeSpot(r) {
    for (let t = 0; t < 40; t++) {
      const x = rnd(120, this.w - 120), y = rnd(120, this.h - 120);
      let ok = true;
      for (const w of this.allWalls()) {
        const nx = clamp(x, w.x, w.x + w.w), ny = clamp(y, w.y, w.y + w.h);
        if (dist2(x, y, nx, ny) < r * r * .36) { ok = false; break; }
      }
      if (ok) return { x: x, y: y };
    }
    return { x: rnd(120, this.w - 120), y: rnd(120, this.h - 120) };
  }
  update(dt) {
    this.announce = Math.max(0, (this.announce || 0) - dt);
    for (const m of this.moving) {
      m.phase += dt * m.spd;
      const off = Math.sin(m.phase) * m.amp;
      if (m.horiz) { m.x += (off - m.ox); } else { m.y += (off - m.ox); }
      m.ox = off;
    }
    this.wxT += dt;
    if (this.glows) for (const g of this.glows) {
      g.x += g.vx * dt; g.y += g.vy * dt;
      if (g.x < 20 || g.x > this.w - 20) g.vx *= -1;
      if (g.y < 20 || g.y > this.h - 20) g.vy *= -1;
    }
    if (this.weather === 'thunder') {
      this.stormFlash = Math.max(0, this.stormFlash - dt * 3);
      this.stormT -= dt;
      if (this.stormT <= 0 && Game.state === 'play') {
        this.stormT = rnd(1.2, 2.6);
        this.stormFlash = 1;
        const tgt = Game.enemies.filter(e => !e.dead);
        if (tgt.length) {
          const e = pick(tgt);
          const dmg = Math.min(60, 18 + (Game.wave || 1) * 1.4) * DANGERS[Game.danger].dmg;
          e.hurt(dmg, true, null, 'lightning');
          FX.spark(e.x, e.y, -Math.PI / 2, '#bfe0ff');
          FX.explosion(e.x, e.y, 34, '#cfe4ff', .35);
          AudioSys.sfx('thunder');
          Game.feedback(e.x, e.y, 'mittel');
        }
      }
    }
    for (const p of this.wx) {
      if (p.vy) { p.x += (p.vx || 0) * dt; p.y += p.vy * dt; }
      else if (p.baseY !== undefined) { p.x += (p.vx || 0) * dt; p.y = p.baseY + Math.sin(this.wxT + p.ph) * 14; }
      /* Wetterpartikel am Bildrand neu setzen: reine Optik, deshalb
         Math.random. Mit RAND haetten sie den Lauf-Strom angezapft — und
         zwar unterschiedlich oft, je nachdem wo sie gestartet sind. */
      if (p.vy && p.y < -80) { p.y = this.h + 60; p.x = Math.random() * this.w; }
      if (p.vy && p.y > this.h + 80) { p.y = -40; p.x = Math.random() * this.w; }
      if (p.x < -p.w - 60) p.x = this.w + p.w + 60;
      if (p.x > this.w + p.w + 60) p.x = -p.w - 60;
    }
    this.hazT -= dt;
    if (this.hazT <= 0) {
      this.hazT = rnd(5, 11);
      if (this.a.id === 'labor') { const x = crnd(80, this.w - 80), y = crnd(80, this.h - 80); this.hazards.push({ type: 'spark', x, y, t: 0, life: .8 }); AudioSys.sfx('crackle'); for (let i = 0; i < 14; i++) FX.particle(x, y, crnd(TAU), crnd(40, 220), '#7dffdc', crnd(.2, .5), 2); }
      else if (this.a.id === 'rheinufer') { this.hazards.push({ type: 'fogbank', x: -320, y: rnd(120, this.h - 120), w: 300, h: 170, vx: rnd(160, 240), t: 0 }); }
      else if (this.a.id === 'kurpark') {
        const y = rnd(90, this.h - 90), n = 3 + rndi(0, 2);
        this.hazards.push({ type: 'birds', x: -60, y, t: 0, n });
        for (let i = 0; i < n; i++) this.drops.push({ x: rnd(200, this.w - 100), y: y + rnd(-80, 80) });
      }
      else if (this.a.id === 'warmerdamm') {
        const y = rnd(220, this.h - 220), dir = RAND() < .5 ? 1 : -1;
        this.hazards.push({ type: 'tram', x: dir > 0 ? -430 : this.w + 430, y, w: 320, h: 130, vx: (dir > 0 ? 1 : -1) * rnd(250, 340), t: 0, warn: 1.1 });
        AudioSys.sfx('w_vortex');
      }
      else if (this.a.id === 'schlachthof') {
        const x = rnd(110, this.w - 110), y = rnd(110, this.h - 110);
        this.hazards.push({ type: 'steam', x, y, t: 0, warn: .6, life: 3.4 });
      }
    }
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const hz = this.hazards[i];
      hz.t += dt;
      if (hz.type === 'fogbank') hz.x += hz.vx * dt;
      if (hz.type === 'birds') hz.x += 200 * dt;
      if (hz.type === 'tram') {
        if (hz.warn > 0) hz.warn -= dt;
        else hz.x += hz.vx * dt;
      }
      if (hz.t > 14 || (hz.type === 'fogbank' && hz.x > this.w + 340) || (hz.type === 'birds' && hz.x > this.w + 80) || (hz.type === 'tram' && (hz.x < -430 || hz.x > this.w + 430)) || (hz.type === 'steam' && hz.t > hz.life)) this.hazards.splice(i, 1);
    }
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const dc = this.decals[i];
      dc.t += dt;
      if (dc.t > dc.life) this.decals.splice(i, 1);
    }
  }
  /* Explosive Fässer: Deckung mit Nebenwirkung */
  spawnBarrels(n) {
    this.barrels = [];
    for (let i = 0; i < n; i++) {
      let x, y, tries = 0;
      do { x = rnd(90, this.w - 90); y = rnd(90, this.h - 90); tries++; }
      while (tries < 20 && this.blocksRay(x, y));
      this.barrels.push({ x: x, y: y, r: 13, hp: 26, max: 26, t: rnd(TAU), kind: RAND() < .25 ? 'gas' : 'fuel' });
    }
  }
  hitBarrel(x, y, dmg) {
    for (const b of this.barrels) {
      if (b.dead) continue;
      if (dist2(x, y, b.x, b.y) < b.r * b.r) {
        b.hp -= dmg;
        FX.sparkShower(x, y, crnd(TAU), 3, '#ffd9a0', 180);
        if (b.hp <= 0) this.blowBarrel(b);
        return true;
      }
    }
    return false;
  }
  blowBarrel(b) {
    if (b.dead) return;
    b.dead = true;
    const gas = b.kind === 'gas';
    const r = gas ? 150 : 118, dmg = gas ? 46 : 62;
    FX.explosion(b.x, b.y, r, gas ? '#8dff5c' : '#ff8a3d');
    FX.light(b.x, b.y, r * 3, gas ? '#8dff5c' : '#ffd9a0', .35, 1.3);
    FX.decal(b.x, b.y, r * .35, 'rgba(24,20,18,.7)', 'soot', 12);
    Game.feedback(b.x, b.y, 'mittel');
    AudioSys.sfxAt('boom', b.x, b.y);
    Game.contractProgress('barrel', 1);
    const list = Game.hash.query(b.x, b.y, r, Game._tmp);
    for (const e of list) if (!e.dead && dist(e.x, e.y, b.x, b.y) < r) {
      e.hurt(dmg * (1 + Game.wave * .12), RAND() < .3, Game.players[0], 'boom');
      e.knockback(Math.atan2(e.y - b.y, e.x - b.x), 260);
      if (gas) { e.poison = Math.max(e.poison, 9); e.poisonT = Math.max(e.poisonT, 4); }
      else { e.burn = Math.max(e.burn, 11); e.burnT = Math.max(e.burnT, 3.5); }
    }
    for (const p of Game.players) if (p.alive && dist(p.x, p.y, b.x, b.y) < r * .8)
      p.damage(gas ? 6 : 11, Math.atan2(p.y - b.y, p.x - b.x));
    if (gas) { const prevLen = Game.hazObjs.length; Game.spawnWeb(b.x, b.y, { r: 92, slow: .1, life: 5 }); if (Game.hazObjs.length > prevLen) { const hz = Game.hazObjs[prevLen]; hz.poison = 7; hz.col = '#8dff5c'; } }
  }
  drawBarrels(ctx) {
    for (const b of this.barrels) {
      if (b.dead) continue;
      const f = b.hp / b.max;
      const bob = Math.sin(Game.time * 2 + b.t) * .8;
      ctx.fillStyle = 'rgba(0,0,0,.4)';
      ctx.beginPath(); ctx.ellipse(b.x, b.y + b.r * .6, b.r * .9, b.r * .35, 0, 0, TAU); ctx.fill();
      const body = b.kind === 'gas' ? '#4c7a34' : '#a8442a';
      ctx.fillStyle = body;
      ctx.fillRect(b.x - b.r * .72, b.y - b.r + bob, b.r * 1.44, b.r * 1.9);
      ctx.fillStyle = shade(body, .22);
      ctx.fillRect(b.x - b.r * .72, b.y - b.r * .55 + bob, b.r * 1.44, b.r * .3);
      ctx.fillRect(b.x - b.r * .72, b.y + b.r * .35 + bob, b.r * 1.44, b.r * .3);
      ctx.fillStyle = b.kind === 'gas' ? '#dfffcf' : '#ffd9a0';
      ctx.fillRect(b.x - 2, b.y - b.r * .2 + bob, 4, 4);
      if (f < .6) {
        ctx.globalAlpha = (1 - f) * .9;
        ctx.fillStyle = '#ff4d5e';
        ctx.fillRect(b.x - b.r * .5, b.y - b.r * 1.35 + bob, b.r * (1 - f), 2.4);
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 1.4;
      ctx.strokeRect(b.x - b.r * .72, b.y - b.r + bob, b.r * 1.44, b.r * 1.9);
    }
  }
  fogSlowAt(x, y) {
    for (const hz of this.hazards) if (hz.type === 'fogbank' && Math.abs(x - hz.x) < hz.w / 2 && Math.abs(y - hz.y) < hz.h / 2) return true;
    return false;
  }
  /* Fruehere Fassung: `return this.walls.concat(this.moving)` — ein neues
     Array bei JEDEM Aufruf. collide() ruft das pro Gegner und Bild auf;
     bei 60 Gegnern also 60 Wegwerf-Arrays je Bild. Jetzt gepuffert und
     nur neu gebaut, wenn sich etwas geaendert hat. */
  allWalls() {
    const n = this.walls.length + this.moving.length;
    if (!this._wallBuf || this._wallsDirty || this._wallBuf.length !== n) {
      this._wallBuf = this.walls.concat(this.moving);
      this._wallsDirty = false;
    }
    return this._wallBuf;
  }
  fieldAt(x, y) {
    for (const f of this.fields) if (dist2(x, y, f.x, f.y) < f.r * f.r) return f;
    return null;
  }
  clampWorld(e) {
    e.x = clamp(e.x, e.r, this.w - e.r); e.y = clamp(e.y, e.r, this.h - e.r);
  }
  collide(e, soft) {
    this.clampWorld(e);
    for (const r of this.allWalls()) {
      const nx = clamp(e.x, r.x, r.x + r.w), ny = clamp(e.y, r.y, r.y + r.h);
      const dx = e.x - nx, dy = e.y - ny, d2 = dx * dx + dy * dy;
      if (d2 < e.r * e.r) {
        const d = Math.sqrt(d2) || .001;
        const push = (e.r - d);
        e.x += (dx / d) * push; e.y += (dy / d) * push;
      }
    }
  }
  /* Deckt ein Hindernis diese Zelle? Punktproben taugen dafuer nicht:
     eine Wand, die genau zwischen zwei Probepunkte faellt, waere
     unsichtbar. Exakte Rechteck-Ueberlappung, bewusst konservativ —
     lieber einmal zu viel gesperrt als ein Gegner, der durch Mauern geht. */
  rectBlocked(x, y, w, h) {
    const walls = this.allWalls();
    for (let i = 0; i < walls.length; i++) {
      const r = walls[i];
      if (x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y) return true;
    }
    return false;
  }
  blocksRay(x, y) {
    for (const r of this.allWalls()) if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) return true;
    return false;
  }
  /* Erste Wand auf der Strecke (x0,y0)->(x1,y1). Rueckgabe ist der
     Parameter t in [0,1] des Treffers, oder 1 wenn frei.
     Slab-Verfahren: fuer jede Achse das Eintritts-/Austrittsintervall
     schneiden — exakt und ohne Wurzel. */
  rayHit(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    let best = 1;
    const walls = this.allWalls();
    for (let i = 0; i < walls.length; i++) {
      const r = walls[i];
      let t0 = 0, t1 = best;
      if (dx === 0) { if (x0 <= r.x || x0 >= r.x + r.w) continue; }
      else {
        const ia = (r.x - x0) / dx, ib = (r.x + r.w - x0) / dx;
        const lo = ia < ib ? ia : ib, hi = ia < ib ? ib : ia;
        if (lo > t0) t0 = lo;
        if (hi < t1) t1 = hi;
        if (t0 > t1) continue;
      }
      if (dy === 0) { if (y0 <= r.y || y0 >= r.y + r.h) continue; }
      else {
        const ia = (r.y - y0) / dy, ib = (r.y + r.h - y0) / dy;
        const lo = ia < ib ? ia : ib, hi = ia < ib ? ib : ia;
        if (lo > t0) t0 = lo;
        if (hi < t1) t1 = hi;
        if (t0 > t1) continue;
      }
      if (t0 >= 0 && t0 < best) best = t0;
    }
    return best;
  }
  /* Freie Schusslinie? */
  losClear(x0, y0, x1, y1) { return this.rayHit(x0, y0, x1, y1) >= 1; }
  draw(ctx, cam) {
    const a = this.a;
    if (this.tex) ctx.drawImage(this.tex, 0, 0, this.tex.width, this.tex.height, 0, 0, this.w, this.h);
    else { ctx.fillStyle = a.ground; ctx.fillRect(0, 0, this.w, this.h); }
    /* Bodenleben: das Dekor bewegt sich, je nach Arena anders */
    const gt = Game.time, q = Game.quality();
    const kind = this.a.theme === 'weit' ? 'grass' : this.a.id === 'rheinufer' ? 'water' : this.a.id === 'labor' || this.a.id === 'schlachthof' ? 'steam' : 'grass';
    const wind = Game.modIs('sturm') ? 2.4 : Game.modIs('regen') ? 1.4 : 1;
    for (const d of this.decor) {
      ctx.globalAlpha = d.a;
      ctx.fillStyle = d.c;
      if (q < 1 || (Game.autoQ || 1) < 1) { ctx.fillRect(d.x, d.y, d.r, d.r); continue; }
      if (kind === 'grass') {
        /* Halme neigen sich im Wind und weichen dem Spieler aus (Performance: Dreieck statt Kurven) */
        let lean = Math.sin(gt * 1.6 + d.x * .03) * 1.6 * wind;
        for (const p of Game.players) {
          if (!p.alive) continue;
          const dx = d.x - p.x, dy = d.y - p.y, dd = dx * dx + dy * dy;
          if (dd < 2600) lean += (dx > 0 ? 1 : -1) * (1 - dd / 2600) * 4;
        }
        ctx.beginPath();
        ctx.moveTo(d.x, d.y + d.r);
        ctx.lineTo(d.x + lean, d.y - d.r * .6);
        ctx.lineTo(d.x + lean + Math.max(1, d.r * .35), d.y - d.r * .5);
        ctx.closePath(); ctx.fill();
      } else if (kind === 'water') {
        /* Schimmer auf der Wasseroberfläche */
        const sh = .5 + .5 * Math.sin(gt * 2.2 + d.x * .05 + d.y * .03);
        ctx.globalAlpha = d.a * (.4 + sh * .8);
        ctx.fillRect(d.x, d.y + Math.sin(gt * 1.4 + d.x * .04) * 1.5, d.r * (1 + sh), Math.max(1, d.r * .5));
      } else {
        /* Dampf, der langsam aufsteigt */
        const rise = (gt * 12 + d.x * .7) % 90;
        ctx.globalAlpha = d.a * clamp(1 - rise / 90, 0, 1) * .8;
        ctx.beginPath(); ctx.arc(d.x + Math.sin(gt + d.y * .05) * 4, d.y - rise, d.r * (.7 + rise / 60), 0, TAU); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    this.drawBarrels(ctx);
    for (const dc of this.decals) {
      /* Verblassungsstufen: frisch (satt) → angetrocknet → Schatten → weg */
      const f = clamp(1 - dc.t / dc.life, 0, 1);
      const stage = f > .72 ? 1 : f > .40 ? .68 : f > .16 ? .40 : .18;
      const k = dc.kind || 'dirt';
      ctx.globalAlpha = (k === 'frost' ? .42 : k === 'soot' ? .38 : .34) * stage * (.35 + f * .65);
      ctx.fillStyle = dc.c;
      ctx.beginPath(); ctx.ellipse(dc.x, dc.y, dc.r * (1 + (1 - f) * .18), dc.r * .62 * (1 + (1 - f) * .18), dc.rot || 0, 0, TAU); ctx.fill();
      if (k === 'blood' && f > .55) {
        ctx.globalAlpha = .26 * stage;
        ctx.fillStyle = shade(dc.c, -.35);
        ctx.beginPath(); ctx.ellipse(dc.x + dc.r * .25, dc.y + dc.r * .18, dc.r * .42, dc.r * .28, 0, 0, TAU); ctx.fill();
      } else if (k === 'frost') {
        ctx.globalAlpha = .3 * stage;
        ctx.strokeStyle = '#e8fbff'; ctx.lineWidth = .8;
        for (let i = 0; i < 3; i++) {
          const a2 = (dc.rot || 0) + i * TAU / 3;
          ctx.beginPath(); ctx.moveTo(dc.x, dc.y);
          ctx.lineTo(dc.x + Math.cos(a2) * dc.r * .9, dc.y + Math.sin(a2) * dc.r * .55);
          ctx.stroke();
        }
      } else if (k === 'soot' && f > .4) {
        ctx.globalAlpha = .2 * stage; ctx.fillStyle = '#000';
        ctx.beginPath(); ctx.ellipse(dc.x, dc.y, dc.r * .55, dc.r * .34, 0, 0, TAU); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    for (const f of this.fields) {
      ctx.globalAlpha = .22 + .05 * Math.sin(Game.time * 2 + f.x);
      ctx.fillStyle = f.type === 'poison' ? '#7cff4d' : (f.mult > 1 ? '#39e6ff' : '#ff2e88');
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, TAU); ctx.fill();
      ctx.globalAlpha = .55; ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 2; ctx.stroke();
      ctx.globalAlpha = 1;
    }
    const an = this.announce || 0;
    for (const pt of this.spawnPoints) {
      if (an > 0) {
        const pulse = .5 + .5 * Math.sin(Game.time * 9 + pt.x);
        ctx.globalAlpha = .28 + .22 * pulse;
        ctx.fillStyle = a.accent;
        ctx.beginPath(); ctx.arc(pt.x, pt.y, 22 + pulse * 10, 0, TAU); ctx.fill();
        ctx.globalAlpha = .8;
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(pt.x, pt.y, 26 + pulse * 12, 0, TAU); ctx.stroke();
      } else {
        ctx.globalAlpha = .18;
        ctx.fillStyle = a.accent;
        ctx.beginPath(); ctx.arc(pt.x, pt.y, 22, 0, TAU); ctx.fill();
        ctx.globalAlpha = .5;
        ctx.strokeStyle = a.accent; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(pt.x, pt.y, 26, 0, TAU); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    this.drawProps(ctx, cam, false);          /* flacher Bewuchs unter allem */
    ctx.strokeStyle = a.accent; ctx.lineWidth = 4; ctx.globalAlpha = .8;
    ctx.strokeRect(0, 0, this.w, this.h); ctx.globalAlpha = 1;
    for (const r of this.allWalls()) {
      if (r.trunk) continue;                  /* der Baum ist schon gezeichnet */
      const hgt = r.height || 20;
      /* Steht ein Spieler dahinter, wird die Wand durchscheinend */
      let occl = 1;
      for (const p of Game.players) {
        if (!p.alive) continue;
        if (p.x > r.x - 14 && p.x < r.x + r.w + 14 && p.y > r.y - 10 && p.y < r.y + r.h + hgt + 26) { occl = .42; break; }
      }
      if (r._cv) {
        ctx.globalAlpha = occl;
        ctx.drawImage(r._cv, r.x, r.y);
      } else {
        ctx.globalAlpha = occl;
        ctx.fillStyle = 'rgba(0,0,0,.45)';
        ctx.fillRect(r.x + 6, r.y + 6, r.w, r.h);
        ctx.fillStyle = shade(a.grid, -.35);
        ctx.beginPath();
        ctx.moveTo(r.x, r.y + r.h); ctx.lineTo(r.x + r.w, r.y + r.h);
        ctx.lineTo(r.x + r.w, r.y + r.h + hgt * .35); ctx.lineTo(r.x, r.y + r.h + hgt * .35); ctx.closePath(); ctx.fill();
        ctx.fillStyle = r.cover ? shade(a.grid, .25) : shade(a.grid, .55);
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = a.accent; ctx.globalAlpha = r.cover ? .35 : .6; ctx.lineWidth = 1.5;
        ctx.strokeRect(r.x, r.y, r.w, r.h); ctx.globalAlpha = 1;
        if (!r.cover) {
          ctx.fillStyle = 'rgba(244,194,90,.20)';
          for (let wx = r.x + 10; wx < r.x + r.w - 12; wx += 26)
            for (let wy = r.y + 10; wy < r.y + r.h - 12; wy += 26)
              if ((wx * wy) % 7 < 4) ctx.fillRect(wx, wy, 10, 12);
        }
      }
      if (occl < 1) {
        /* Umriss bleibt sichtbar, damit die Deckung lesbar bleibt */
        ctx.globalAlpha = 1;
        ctx.strokeStyle = a.accent; ctx.lineWidth = 1.2;
        ctx.setLineDash([6, 5]);
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;
    }
    this.drawProps(ctx, cam, true);           /* Baeume, Felsen, Buesche */
    for (const p of this.wx) {
      if (this.weather === 'pollen') { ctx.globalAlpha = p.a * (0.6 + 0.4 * Math.sin(this.wxT * 2 + p.ph)); ctx.fillStyle = p.c; ctx.fillRect(p.x, p.y, p.r, p.r); }
      else if (this.weather === 'fog') { ctx.globalAlpha = .8; ctx.fillStyle = p.c; ctx.beginPath(); ctx.ellipse(p.x, p.y, p.w / 2, p.h / 2, 0, 0, TAU); ctx.fill(); }
      else if (this.weather === 'sparks') { ctx.globalAlpha = p.a * (0.5 + 0.5 * Math.sin(this.wxT * 9 + p.ph)); ctx.fillStyle = p.c; ctx.fillRect(p.x, p.y, p.r, p.r); }
      else if (this.weather === 'embers') { ctx.globalAlpha = p.a * (0.5 + 0.5 * Math.sin(this.wxT * 5 + p.ph)); ctx.fillStyle = p.c; ctx.fillRect(p.x, p.y, p.r, p.r); }
      else if (this.weather === 'petals') { ctx.globalAlpha = p.a * (0.5 + 0.5 * Math.sin(this.wxT * 4 + p.ph)); ctx.fillStyle = p.c; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(this.wxT * (p.sway || 1)); ctx.fillRect(-p.r, -p.r * .6, p.r * 2, p.r * 1.2); ctx.restore(); }
      else if (this.weather === 'mist') { ctx.globalAlpha = .9; ctx.fillStyle = p.c; ctx.beginPath(); ctx.ellipse(p.x, p.y, p.w / 2, p.h / 2, 0, 0, TAU); ctx.fill(); }
      else if (this.weather === 'rain') { ctx.globalAlpha = p.r > 1.6 ? .65 : .4; ctx.strokeStyle = p.c; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * .05, p.y - 12); ctx.stroke(); }
      else if (this.weather === 'snow') { ctx.globalAlpha = p.a * (0.6 + 0.4 * Math.sin(this.wxT * 2 + p.ph)); ctx.fillStyle = p.c; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.sin(this.wxT * (p.sway || 1)) * .6); ctx.beginPath(); ctx.arc(0, 0, p.r, 0, TAU); ctx.fill(); ctx.restore(); }
      else if (this.weather === 'hail') { ctx.globalAlpha = p.a; ctx.fillStyle = p.c; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(.5); ctx.fillRect(-p.r, -p.r, p.r * 2, p.r * 1.2); ctx.restore(); }
      else if (this.weather === 'thunder') { ctx.globalAlpha = p.r > 1.5 ? .5 : .3; ctx.strokeStyle = p.c; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * .05, p.y - 16); ctx.stroke(); }
    }
    if (this.weather === 'thunder' && this.stormFlash > 0) {
      ctx.globalAlpha = this.stormFlash * .22;
      ctx.fillStyle = '#eef4ff';
      ctx.fillRect(cam.x - 900, cam.y - 600, 1800, 1200);
    }
    ctx.globalAlpha = 1;
    for (const hz of this.hazards) {
      if (hz.type === 'fogbank') {
        ctx.globalAlpha = .5;
        ctx.fillStyle = 'rgba(160,210,255,.12)';
        ctx.beginPath(); ctx.ellipse(hz.x, hz.y, hz.w / 2, hz.h / 2, 0, 0, TAU); ctx.fill();
        ctx.globalAlpha = .9;
        ctx.fillStyle = 'rgba(200,230,255,.25)';
        ctx.beginPath(); ctx.ellipse(hz.x, hz.y, hz.w / 2 - 40, hz.h / 2 - 40, 0, 0, TAU); ctx.fill();
      } else if (hz.type === 'spark') {
        ctx.globalAlpha = clamp(1 - hz.t / hz.life, 0, 1);
        ctx.fillStyle = '#7dffdc';
        ctx.beginPath(); ctx.arc(hz.x, hz.y, 4 + hz.t * 30, 0, TAU); ctx.fill();
      } else if (hz.type === 'birds') {
        ctx.globalAlpha = .9;
        ctx.fillStyle = '#1b2a40';
        for (let i = 0; i < hz.n; i++) {
          const bx = hz.x - i * 22, by = hz.y + Math.sin(hz.t * 3 + i * 1.7) * 14;
          ctx.beginPath(); ctx.moveTo(bx - 9, by); ctx.lineTo(bx, by - 6); ctx.lineTo(bx + 9, by); ctx.lineTo(bx, by + 3); ctx.closePath(); ctx.fill();
        }
      } else if (hz.type === 'tram') {
        if (hz.warn > 0) {
          ctx.globalAlpha = .5 + .4 * Math.sin(this.wxT * 16);
          ctx.fillStyle = '#ffd23e';
          ctx.beginPath(); ctx.arc(hz.x, hz.y, 26, 0, TAU); ctx.fill();
        }
        ctx.globalAlpha = .92;
        const dir = hz.vx > 0 ? 1 : -1;
        ctx.fillStyle = '#3a1d12';
        ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(hz.x - hz.w / 2, hz.y - hz.h / 2, hz.w, hz.h, 14); else ctx.rect(hz.x - hz.w / 2, hz.y - hz.h / 2, hz.w, hz.h); ctx.fill();
        ctx.fillStyle = '#6b3a1e';
        ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(hz.x - hz.w / 2 + 8, hz.y - hz.h / 2 + 8, hz.w - 16, 34, 8); else ctx.rect(hz.x - hz.w / 2 + 8, hz.y - hz.h / 2 + 8, hz.w - 16, 34); ctx.fill();
        ctx.fillStyle = '#c8e6ff';
        for (let i = 0; i < 4; i++) ctx.fillRect(hz.x - hz.w / 2 + 22 + i * (dir > 0 ? 44 : -44), hz.y - 20, 30, 20);
        ctx.fillStyle = '#ffe27a';
        ctx.beginPath(); ctx.arc(hz.x + dir * (hz.w / 2 - 14), hz.y - 40, 18, 0, TAU); ctx.fill();
      } else if (hz.type === 'steam') {
        const on = hz.t > hz.warn;
        if (!on) { ctx.globalAlpha = .6 + .4 * Math.sin(this.wxT * 12); ctx.fillStyle = '#ff6a3d'; ctx.beginPath(); ctx.arc(hz.x, hz.y, 30, 0, TAU); ctx.fill(); }
        else {
          const a = clamp(1 - (hz.t - hz.warn) / (hz.life - hz.warn), 0, 1);
          ctx.globalAlpha = .35 * a;
          ctx.fillStyle = '#d8c8c0';
          ctx.beginPath(); ctx.arc(hz.x, hz.y, 66 + hz.t * 6, 0, TAU); ctx.fill();
          ctx.globalAlpha = .5 * a;
          ctx.beginPath(); ctx.arc(hz.x, hz.y - 8, 40 + hz.t * 5, 0, TAU); ctx.fill();
          for (let i = 0; i < 5; i++) {
            const bx = hz.x + Math.cos(this.wxT * 3 + i * 1.26) * (70 + hz.t * 8);
            const by = hz.y + Math.sin(this.wxT * 4 + i * 2.1) * (60 + hz.t * 6);
            ctx.globalAlpha = .25 * a;
            ctx.beginPath(); ctx.arc(bx, by, 22 + hz.t * 3, 0, TAU); ctx.fill();
          }
        }
      }
    }
    ctx.globalAlpha = 1;
    if (this.glows) for (const g of this.glows) {
      const ga = .3 + .5 * Math.max(0, Math.sin(this.wxT * 2.2 + g.ph));
      ctx.globalAlpha = ga;
      ctx.fillStyle = '#d8ff8a';
      ctx.beginPath(); ctx.arc(g.x, g.y, g.r, 0, TAU); ctx.fill();
      ctx.globalAlpha = ga * .35;
      ctx.beginPath(); ctx.arc(g.x, g.y, g.r * 2.4, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    const wN = Game.wave || 1;
    if (wN >= 12) {
      const dark = clamp((wN - 11) / 8, 0, 1);
      ctx.globalAlpha = dark * (wN >= 16 ? .34 : .24);
      ctx.fillStyle = wN >= 16 ? '#0a0f2a' : '#2a1f4a';
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.globalAlpha = 1;
      if (wN >= 16 && OPT().particles > 0) {
        ctx.fillStyle = '#dfe6ff';
        for (let i = 0; i < 34; i++) {
          const sx = ((i * 137 + this.wxT * 3) % this.w), sy = ((i * 271 + this.wxT * 6 + Math.sin(this.wxT + i) * 4) % this.h);
          ctx.globalAlpha = .25 + .3 * Math.sin(this.wxT * 2 + i * 1.7);
          ctx.fillRect(sx, sy, 1.4, 1.4);
        }
        ctx.globalAlpha = 1;
      }
    }
  }
}
const hexACache = new Map();
const shadeCache = new Map();
function hexA(col, a) {
  if (!col) return 'rgba(255,255,255,' + a + ')';
  const key = col + '|' + a;
  const hit = hexACache.get(key);
  if (hit) return hit;
  let out;
  if (col.charAt(0) === '#') {
    const c = col.replace('#', '');
    const r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
    out = 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  } else {
    const m = col.match(/rgba?\(([^)]+)\)/);
    if (m) { const p = m[1].split(',').map(Number); out = 'rgba(' + (p[0] | 0) + ',' + (p[1] | 0) + ',' + (p[2] | 0) + ',' + a + ')'; }
    else out = 'rgba(255,255,255,' + a + ')';
  }
  if (hexACache.size > 2000) hexACache.clear();
  hexACache.set(key, out);
  return out;
}
function shade(hex, amt) {
  if (!hex || hex.charAt(0) !== '#') return hex || '#ffffff';
  const key = hex + '|' + amt;
  const hit = shadeCache.get(key);
  if (hit) return hit;
  const c = hex.replace('#', '');
  let r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
  if (amt > 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
  else { r *= (1 + amt); g *= (1 + amt); b *= (1 + amt); }
  const out = `rgb(${r | 0},${g | 0},${b | 0})`;
  if (shadeCache.size > 2000) shadeCache.clear();
  shadeCache.set(key, out);
  return out;
}
function applyRuneEffect(p, def) {
  const dmg = playerAtk(p);
  switch (def.id) {
    case 'nova':
      FX.explosion(p.x, p.y, 170, '#ff8a3d', .8);
      Game.feedback(null, null, 'gross');
      AudioSys.sfx('boom');
      for (const e of Game.enemies) if (!e.dead && dist(e.x, e.y, p.x, p.y) < 175) {
        const d = dmg * 1.6;
        e.hurt(d, true, p, 'boom');
        const a = Math.atan2(e.y - p.y, e.x - p.x);
        e.knockback(a, 420);
        e.applyElement('fire', d, p);
      }
      break;
    case 'blitz': {
      let cur = Game.enemies.filter(e => !e.dead).slice(0, 6);
      if (cur.length) {
        const first = pick(cur); cur = [first];
        const hit = new Set([first]);
        for (let i = 0; i < 5; i++) {
          const prev = cur[i];
          let best = null, bd = 1e9;
          for (const e of Game.enemies) if (!e.dead && !hit.has(e)) {
            const d = dist(e.x, e.y, prev.x, prev.y);
            if (d < bd) { bd = d; best = e; }
          }
          if (!best) break;
          hit.add(best); cur.push(best);
        }
        for (let i = 0; i < cur.length; i++) {
          const e = cur[i];
          setTimeout(() => {
            if (e.dead) return;
            const d = dmg * (i === 0 ? 1.3 : .7);
            e.hurt(d, i === 0, p, 'elem');
            e.applyElement('shock', d, p);
            FX.spark(e.x, e.y, -Math.PI / 2, '#ffe27a');
            AudioSys.sfx('thunder');
          }, i * 90);
        }
        UI.banner('KETTENBLITZ', 1.2);
      }
      break;
    }
    case 'sturm':
      p.addBuff('speed', 45, 4);
      p.addBuff('atkSpd', 35, 4);
      p.addBuff('dmgP', 20, 4);
      UI.banner('RUNEN-STURM', 1.2);
      AudioSys.sfx('w_vortex');
      break;
    case 'schild':
      p.invuln = Math.max(p.invuln, 3.5);
      p.addBuff('armor', 30, 3.5);
      p.abilityData.runeShield = 3.5;
      UI.banner('RUNEN-SCHILD', 1.2);
      AudioSys.sfx('rune');
      break;
    case 'heilung':
      p.heal(Math.round(p.maxHp * .45));
      if (p.clearStatuses) p.clearStatuses();
      else { p.burnT = 0; p.burn = 0; p.poisonT = 0; p.poison = 0; p.freezeT = 0; p.freeze = 0; p.stun = 0; }
      UI.banner('RUNEN-HEILUNG', 1.2);
      AudioSys.sfx('level');
      break;
    case 'eiswall':
      for (const e of Game.enemies) if (!e.dead && dist(e.x, e.y, p.x, p.y) < 260) {
        e.hurt(dmg * .5, false, p, 'elem');
        e.applyElement('ice', dmg, p);
        e.freezeT = 2.5; e.freeze = true;
        FX.particle(e.x, e.y, crnd(TAU), crnd(40, 120), '#9ad2ff', .6, 2);
      }
      AudioSys.sfx('rune');
      UI.banner('EWALL', 1.2);
      break;
    case 'magnet':
      p.addBuff('harvest', 30, 8);
      p.abilityData.magnetT = 8;
      Game.feedback(null, null, 'mittel');
      AudioSys.sfx('pet');
      UI.toast('Material-Magnet aktiv!');
      break;
    case 'meteor': {
      const foes = Game.enemies.filter(e => !e.dead);
      for (let i = 0; i < 3; i++) {
        const e = foes.length ? pick(foes) : null;
        const tx = e ? e.x : p.x + rnd(-200, 200), ty = e ? e.y : p.y + rnd(-200, 200);
        setTimeout(() => {
          FX.explosion(tx, ty, 92, '#ff2e88', .6);
          Game.feedback(tx, ty, 'mittel');
          AudioSys.sfx('thunder');
          for (const q of Game.enemies) if (!q.dead && dist(q.x, q.y, tx, ty) < 100) {
            q.hurt(dmg * 1.4, true, p, 'boom');
            q.applyElement('fire', dmg, p);
          }
        }, i * 140);
      }
      UI.banner('METEOR', 1.2);
      break;
    }
  }
}

/* ============================ 18. SHOP ============================ */
const ShopSystem = {
  offers: [], rerolls: 0, bought: {}, fusionSel: [], attachTarget: -1, locked: {},
  sanitizeFusion(P) {
    const max = P ? P.weapons.length : 0;
    const sel = Array.isArray(this.fusionSel) ? this.fusionSel : [];
    const s = sel.filter(i => Number.isInteger(i) && i >= 0 && i < max);
    if (s.length !== sel.length) this.fusionSel = s;
  },
  fusionRecipes: {
    'pistol_smg': 'chaingun', 'pistol_sniper': 'railgun', 'smg_shotgun': 'chaingun',
    'shredder_flamer': 'plasma', 'spore_shotgun': 'plasma', 'medgun_knife': 'needle',
    'wrench_medgun': 'needle', 'hammer_spear': 'chopper', 'tesla_frost': 'arc',
    'photon_sniper': 'railgun', 'sonic_medgun': 'medgun'
  },
  legendaryRecipes: {
    'chaingun_gravgun_shotgun': 'leg_rheingold',
    'arc_frost_tesla': 'leg_neroberg',
    'flamer_loeschwasser_sonic': 'leg_thermal'
  },
  weaponPool() {
    return WEAPONS.filter(w => !w.legendary && (w.unlockDefault || Save.data.unlockedWeapons.includes(w.id)));
  },
  rarityForWave(wave, luck) {
    const l = luck / 100;
    const w = [
      Math.max(4, 100 - wave * 5 - l * 20),
      35 + wave * 2 + l * 12,
      Math.max(0, wave * 2.6 - 3 + l * 14),
      Math.max(0, wave * 1.5 - 8 + l * 10)
    ];
    let tot = w.reduce((a, b) => a + b, 0), r = RAND() * tot;
    for (let i = 0; i < 4; i++) { r -= w[i]; if (r <= 0) return i + 1; }
    return 1;
  },
  generate(wave, players) {
    this.offers = []; this.bought = {}; this.locked = {}; this.fusionSel = []; this.attachTarget = -1;
    const luck = players.length ? players.reduce((a, p) => a + p.st.luck, 0) / players.length : 0;
    const wp = this.weaponPool();
    let weaponOffers = 0;
    for (let i = 0; i < BROTATO_RULES.shopOffers; i++) {
      const wantWeapon = RAND() < (i < 3 ? .55 : .32);
      if (wantWeapon && wp.length) {
        const def = pick(wp);
        let tier = 0;
        /* T4 ist ab Welle 12 möglich, wird aber ohne Glück seltener; die
           Schwelle ist bewusst tiefer als früher, damit Endgame-Shops nicht
           ewig auf Stufe 3 hängen bleiben. */
        const roll = Math.random() + wave * .026 + luck * .0045;
        if (roll > 1.42) tier = 3; else if (roll > 1.15) tier = 2; else if (roll > .82) tier = 1;
        tier = Math.min(tier, Math.floor(wave / 4));
        this.offers.push({ kind: 'weapon', id: def.id, tier: Math.max(0, tier), price: this.priceOf('weapon', def.id, tier, wave) });
        weaponOffers++;
      } else {
        const rar = this.rarityForWave(wave, luck);
        const cand = ITEMS.filter(it => it.r === rar);
        const it = cand.length ? pick(cand) : pick(ITEMS);
        this.offers.push({ kind: 'item', id: it.id, price: this.priceOf('item', it.id, 0, wave) });
      }
    }
    /* Pity: Mindestens ein Waffenangebot pro Shop — ein Waffen-loser Shop
       würde einen Run an Shop-RNG scheitern lassen. */
    if (weaponOffers === 0 && wp.length) {
      const def = pick(wp);
      let tier = 0;
      const roll = Math.random() + wave * .026 + luck * .0045;
      if (roll > 1.42) tier = 3; else if (roll > 1.15) tier = 2; else if (roll > .82) tier = 1;
      tier = Math.min(tier, Math.floor(wave / 4));
      this.offers[this.offers.length - 1] = { kind: 'weapon', id: def.id, tier: Math.max(0, tier), price: this.priceOf('weapon', def.id, tier, wave) };
      UI.toast('Pity-Angebot: ' + WEAPON_BY_ID[def.id].name + ' im Sortiment');
    }
    /* Aufsätze: nur anbieten, wenn überhaupt eine Waffe da ist, an die sie passen */
    const PA = players[0];
    if (PA && PA.weapons.length) {
      const free = PA.weapons.some(w => ((w.attach || []).length - (w.masteryAtt || 0)) < ATT_MAX);
      if (free) {
        const cand = ATTACHMENTS.filter(a => !PA.weapons.every(w => (w.attach || []).includes(a.id)));
        const cnt = wave >= 8 ? 2 : 1;
        for (let i = 0; i < cnt && cand.length && this.offers.length < BROTATO_RULES.shopOffers; i++) {
          const a = cand.splice(Math.floor(RAND() * cand.length), 1)[0];
          this.offers.push({ kind: 'attach', id: a.id, price: Math.max(6, Math.round(a.price * (1 + wave * .04) * dangerPriceMult())) });
        }
      }
    }
    const P = players[0];
    if (P && P.relics && P.relics.length < RELIC_MAX) {
      const cand = RELICS.filter(r => !P.relics.includes(r.id));
      if (cand.length && this.offers.length < BROTATO_RULES.shopOffers) { const rl = weightedPick(cand, r => r.w || 1); this.offers.push({ kind: 'relic', id: rl.id, price: Math.max(8, Math.round((24 + Game.wave * 2.4) * dangerPriceMult())) }); }
    }
  },
  priceOf(kind, id, tier, wave) {
    let base = kind === 'weapon' ? tierData(WEAPON_BY_ID[id], tier).price : ITEM_BY_ID[id].price;
    /* T4-Waffen sind über den Shop teuer erkämpft — 15% Nachlass, damit der
       Direktkauf gegenüber der Fusion (T3+T3 -> T4) konkurrenzfähig bleibt. */
    if (kind === 'weapon' && tier === 3) base *= .85;
    return Math.max(3, Math.round(base * (1 + wave * .045) * dangerPriceMult()));
  },
  reroll(wave, players) {
    const cost = this.rerollCost(wave);
    if (Game.materials < cost) { AudioSys.sfx('err'); UI.toast('Nicht genug Material'); return; }
    Game.materials -= cost; this.rerolls++;
    /* Gesperrte Angebote überleben den Neuwurf */
    const keep = {};
    for (const i in this.locked) if (this.locked[i] && this.offers[i] && !this.bought[i]) keep[i] = this.offers[i];
    this.generate(wave, players);
    for (const i in keep) if (this.offers[i]) { this.offers[i] = keep[i]; this.locked[i] = 1; }
    AudioSys.sfx('ui'); UI.renderShop();
  },
  toggleLock(i) {
    if (this.bought[i]) return;
    this.locked[i] = this.locked[i] ? 0 : 1;
    AudioSys.sfx('ui');
    UI.renderShop();
  },
  rerollCost(wave) {
    let n = 0;
    for (const i in this.locked) if (this.locked[i]) n++;
    return BROTATO_RULES.rerollCost(wave, this.rerolls, n);
  },
  buy(idx, player) {
    const o = this.offers[idx];
    if (!o || this.bought[idx]) return;
    if (Game.materials < o.price) { AudioSys.sfx('err'); UI.toast('Nicht genug Material'); return; }
    if (o.kind === 'weapon') {
      const same = player.weapons.findIndex(w => w.id === o.id && w.tier === o.tier && o.tier < 3);
      if (same >= 0) {
        player.weapons[same].tier++;
        Game.materials -= o.price; this.bought[idx] = true;
        UI.toast(WEAPON_BY_ID[o.id].name + ' → Stufe ' + (player.weapons[same].tier + 1));
        if (player.weapons[same].tier === 3) { Save.prog('tier4', 1); }
        AudioSys.sfx('buy'); player.recalc(); UI.renderShop(); return;
      }
      if (player.weapons.length >= BROTATO_RULES.maxWeapons) { AudioSys.sfx('err'); UI.toast('Alle ' + BROTATO_RULES.maxWeapons + ' Waffenplätze belegt — verkaufe zuerst eine Waffe'); return; }
      player.addWeapon(o.id, o.tier);
      if (player.weapons.length === BROTATO_RULES.maxWeapons) Save.prog('sixWeapons', 1);
    } else if (o.kind === 'attach') {
      const a = ATT_BY_ID[o.id];
      let slot = -1;
      if (ShopSystem.attachTarget >= 0) slot = ShopSystem.attachTarget;
      if (slot < 0 || !player.weapons[slot]) slot = player.weapons.findIndex(w => ((w.attach || []).length - (w.masteryAtt || 0)) < ATT_MAX && !(w.attach || []).includes(o.id));
      const wp = player.weapons[slot];
      if (!wp) { AudioSys.sfx('err'); UI.toast('Keine passende Waffe — alle Aufsatzplätze belegt'); return; }
      if ((wp.attach || []).includes(o.id)) { AudioSys.sfx('err'); UI.toast(a.name + ' ist an dieser Waffe schon montiert'); return; }
      if ((wp.attach || []).length - (wp.masteryAtt || 0) >= ATT_MAX) { AudioSys.sfx('err'); UI.toast('Diese Waffe hat schon ' + ATT_MAX + ' gekaufte Aufsätze'); return; }
      wp.attach = (wp.attach || []).concat([o.id]);
      ShopSystem.attachTarget = -1;
      UI.toast(a.name + ' montiert an ' + WEAPON_BY_ID[wp.id].name);
      player.recalc();
    } else if (o.kind === 'relic') {
      if (player.relics.length >= RELIC_MAX) { AudioSys.sfx('err'); UI.toast('Maximal 3 Relikte möglich'); return; }
      if (player.relics.includes(o.id)) { AudioSys.sfx('err'); UI.toast('Relikt bereits getragen'); return; }
      player.relics.push(o.id); player.recalc();
      const done = RELIC_SETS.filter(s => s.members.every(id => player.relics.includes(id)));
      UI.toast(RELIC_BY_ID[o.id].name + ' angelegt' + (done.length ? ' — SET-BONUS: ' + done.map(s => s.name).join(' + ') : ''));
    } else {
      const it = ITEM_BY_ID[o.id];
      player.addItem(it);
      if (it.cursed) { Save.prog('cursedBought', 1); Game.run.track.cursed++; }
    }
    Game.materials -= o.price; this.bought[idx] = true;
    AudioSys.sfx('buy'); UI.renderShop();
  },
  fusion() {
    const P = Game.players[UI.shopPlayer] || Game.players[0];
    this.sanitizeFusion(P);
    const n = this.fusionSel.length;
    if (n < 2 || n > 3) { AudioSys.sfx('err'); return; }
    const idxs = this.fusionSel.slice().sort((a, b) => b - a);
    const ws = idxs.map(i => P.weapons[i]);
    if (ws.some(w => !w)) return;
    const legendary = n === 3;
    const tier = Math.min(3, Math.max.apply(null, ws.map(w => w.tier)) + 1);
    let rid;
    let cost;
    if (legendary) {
      const key = ws.map(w => w.id).sort().join('_');
      rid = this.legendaryRecipes[key];
      if (!rid) {
        const cand = WEAPONS.filter(w => w.legendary && !P.weapons.some(x => x.id === w.id && x.tier >= tier));
        if (!cand.length) { UI.toast('Keine legendäre Fusion verfügbar'); AudioSys.sfx('err'); return; }
        rid = pick(cand).id;
      }
      cost = Math.round((140 + tier * 60 + Game.wave * 8) * DANGERS[Game.danger].price);
    } else {
      const a = ws[0], b = ws[1];
      const key = [a.id, b.id].sort().join('_');
      rid = this.fusionRecipes[key];
      if (!rid) {
        const cand = this.weaponPool().filter(w => !P.weapons.some(x => x.id === w.id && x.tier >= tier));
        if (!cand.length) { UI.toast('Kein Fusionsziel verfügbar'); AudioSys.sfx('err'); return; }
        rid = weightedPick(cand, e => tierData(e, tier).price).id;
      }
      cost = Math.round((50 + tier * 45 + Game.wave * 5) * DANGERS[Game.danger].price);
    }
    if (Game.materials < cost) { AudioSys.sfx('err'); UI.toast('Nicht genug Material'); return; }
    Game.materials -= cost;
    for (const i of idxs) P.weapons.splice(i, 1);
    P.addWeapon(rid, tier);
    this.fusionSel = [];
    AudioSys.sfx('fuse'); P.recalc(); UI.renderShop();
    if (legendary) { UI.banner('LEGENDAERE FUSION!', 2.2); Save.prog('legendaryFusions', 1); }
    UI.toast((legendary ? 'LEGENDAERE FUSION: ' : 'FUSION: ') + WEAPON_BY_ID[rid].name + ' T' + (tier + 1));
  }
};

/* ============================ 19. LEVEL-UP-OPTIONEN ============================ */
const UPGRADE_POOL = [
  { stat: 'maxHp', v: [8, 14, 20], name: 'Max. Leben', d: 'Mehr Puffer gegen Fehler.' },
  { stat: 'hpRegen', v: [1, 2, 3], name: 'HP-Regeneration', d: 'Leben pro Sekunde.' },
  { stat: 'lifesteal', v: [4, 7, 10], name: 'Lebensraub', d: 'Ein Teil des Schadens heilt dich.' },
  { stat: 'dmgP', v: [5, 8, 12], name: 'Schaden %', d: 'Multiplikativ auf alle Waffen.' },
  { stat: 'melee', v: [4, 7, 11], name: 'Nahkampfschaden', d: 'Skaliert Nahkampfwaffen.' },
  { stat: 'ranged', v: [4, 7, 11], name: 'Fernkampfschaden', d: 'Skaliert Schusswaffen.' },
  { stat: 'elem', v: [4, 7, 11], name: 'Elementarschaden', d: 'Skaliert Energie- und Feuerwaffen.' },
  { stat: 'atkSpd', v: [5, 8, 12], name: 'Angriffstempo %', d: 'Kürzere Abklingzeiten.' },
  { stat: 'crit', v: [3, 5, 8], name: 'Krit. Chance %', d: 'Häufiger kritische Treffer.' },
  { stat: 'critDmg', v: [10, 18, 28], name: 'Krit. Schaden %', d: 'Härtere Krits.' },
  { stat: 'eng', v: [4, 7, 11], name: 'Technik', d: 'Geschütze und Gadgets.' },
  { stat: 'range', v: [6, 10, 15], name: 'Reichweite %', d: 'Größerer Wirkungsradius.' },
  { stat: 'armor', v: [1, 2, 3], name: 'Rüstung', d: 'Reduziert erlittenen Schaden.' },
  { stat: 'dodge', v: [3, 5, 8], name: 'Ausweichen %', d: 'Chance, Treffer zu ignorieren.' },
  { stat: 'speed', v: [4, 7, 10], name: 'Tempo %', d: 'Schneller laufen = länger leben.' },
  { stat: 'luck', v: [8, 14, 22], name: 'Glück', d: 'Bessere Shop-Angebote und Drops.' },
  { stat: 'harvest', v: [2, 4, 6], name: 'Ernte', d: 'Material am Wellenende.' },
  { stat: 'xpGain', v: [6, 10, 15], name: 'EP-Gewinn %', d: 'Schneller aufsteigen.' },
  { stat: 'expSize', v: [8, 14, 22], name: 'Explosionsgröße %', d: 'Größere Detonationen.' },
  { stat: 'knock', v: [10, 18, 28], name: 'Rückstoß %', d: 'Feinde fliegen weiter.' },
  { stat: 'abilityRank', v: [1, 1, 1], name: 'Fähigkeit +1', d: 'Die Charakterfähigkeit wird eine Stufe stärker.', w: .35, ability: true },
  { stat: 'abilityCdMod', v: [-12, -12, -12], name: 'Fähigkeits-CD', d: '-12% Abklingzeit der Fähigkeit.', w: .35, ability: true },
  /* Sonderkarten: Waffen-/Item-Angebote beim Level-Up entkoppeln den Fortschritt
     vom Shop-RNG (Gewichte bewusst niedrig). */
  { kind: 'wup', stat: '', v: [0], name: 'Waffe aufwerten', d: 'Die am wenigsten aufgebaute Waffe steigt eine Stufe.', w: 1.6, fixTier: 2 },
  { kind: 'item', stat: '', v: [0], name: 'Fundstück', d: 'Ein zufälliges Item aus dem Kurpark wird dir geschenkt.', w: 1.0, fixTier: 1 },
  { kind: 'wnew', stat: '', v: [0], name: 'Neue Waffe', d: 'Ein zufälliges Waffenmodell wird deinem Arsenal hinzugefügt.', w: .8, fixTier: 2 }
];
function rollUpgrades(p) {
  const banned = Game.banished || [];
  const pool = UPGRADE_POOL.filter(u => banned.indexOf(u.name) < 0);
  if (pool.length < 4) pool.push.apply(pool, UPGRADE_POOL.slice(0, 4));
  const out = [];
  for (let i = 0; i < 4 && pool.length; i++) {
    const u = weightedPick(pool, e => (e.w || 1) * (1 + p.st.luck * .002));
    if (!u) break;
    pool.splice(pool.indexOf(u), 1);
    if (u.kind) {
      /* Sonderkarten sind bedingt: ohne aufwertbare Waffe bzw. freien Slot
         wird stattdessen neu gezogen. */
      if (u.kind === 'wup' && !p.weapons.some(w => w.tier < 3)) continue;
      if (u.kind === 'wnew' && p.weapons.length >= BROTATO_RULES.maxWeapons) continue;
      out.push({ kind: u.kind, stat: '', val: 0, name: u.name, d: u.d, tier: u.fixTier, ability: false });
      continue;
    }
    const roll = RAND() + p.st.luck * .002;
    const tier = u.ability ? 0 : (roll > 1.35 ? 2 : roll > .78 ? 1 : 0);
    out.push({ stat: u.stat, val: u.v[tier], name: u.name, d: u.d, tier, ability: !!u.ability });
  }
  // Fallback
  while (out.length < 4) {
    out.push({ stat: 'maxHp', val: 8, name: 'Max. Leben', d: 'Mehr Puffer gegen Fehler.', tier: 0, ability: false });
  }
  return out;
}

const BalanceSim = {
  _seed: 12345,
  /* Utility-Waffen tragen bewusst einen DPS-Abschlag (CC/Support), den der
     reine DPS-Vergleich nicht abbildet — sie bekommen einen weiteren Korridor. */
  _util: ['frost', 'spore', 'bierwerfer', 'medgun', 'needle', 'ratschlaege', 'taubenschwarm', 'shredder', 'vortex', 'gravgun', 'magnetmine', 'laserzirkel', 'loeschwasser', 'flamer', 'sonic', 'spear', 'hammer', 'blitzableiter', 'tesla', 'arc', 'musiknoten', 'plasma'],
  _mulberry32(seed) { let a = seed >>> 0; return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; },
  _rand(a, b) { return a + (b - a) * this._rng(); },
  /* Stabiler, isolierter Seed je Waffe: eine Aenderung an Waffe A (z.B.
     RNG-Verbrauch der Reaktions-Logik) darf die Messung von Waffe B nicht
     verschieben — sonst kippt ein Waffenwert nur wegen Stream-Artefakten. */
  weaponSeed(id) { let x = 0; for (let i = 0; i < id.length; i++) x = (x * 31 + id.charCodeAt(i)) >>> 0; return x || 1; },
  refStats(level) {
    const st = zeroStats();
    const s = level * 1.1;
    st.ranged = s * 2.2; st.melee = s * 2.2; st.elem = s * 2.0; st.eng = s * 1.6;
    st.dmgP = s * 2.4; st.atkSpd = s * 2.0; st.crit = 4 + s * .8; st.critDmg = s * 3;
    st.range = s * 1.2; st.armor = s * .25; st.hpRegen = s * .12;
    return st;
  },
  hitsPerAttack(def, x) { return Combat.hitsPerAttack(def, x); },
  /* An Messläufen kalibrierte effektive Team-DPS je Bosswelle
     (3 Waffensätze pro Welle, realistischer Aufwertungspfad) */
  BOSS_REF_DPS: { 5: 86, 10: 179, 15: 408, 20: 879 },
  bossRefDps(wave) {
    const k = this.BOSS_REF_DPS;
    if (k[wave]) return k[wave];
    return 86 * Math.pow(2.16, (wave - 5) / 5);
  },
  weaponDPS(def, tier, st, iters) {
    const t = tierData(def, tier), x = t.x;
    let base = t.dmg;
    for (const k in def.scaling) base += (st[k] || 0) * def.scaling[k];
    base *= (1 + st.dmgP / 100);
    if (def.type === 'charge') base *= (1 + (x.chargeMax || 2)) / 2;
    const critC = clamp(t.critC + st.crit / 100, 0, .95), critM = t.critM * (1 + st.critDmg / 100);
    const cd = Math.max(.045, t.as / (1 + st.atkSpd / 100));
    /* Basis-Treffer + Reaktions-Ertrag aus den ECHTEN Regeln (Combat-Kern).
       chain-Typ: Kette ersetzt den Einzel-Treffer (geometrische Reihe).
       boom: Explosions-Ertrag statt pauschalem *2.1-Multiplikator.
       cone+elemental (Klingel): Reaktions-Kette je Kegel-Treffer.
       burn: DoT-Zuschlag (DPS) additiv. */
    let hits = this.hitsPerAttack(def, x);
    let react = 1;
    if (def.type === 'chain') react = Combat.chainFactor(x);
    else if (x.boom) react = Combat.boomFactor();
    else if (def.type === 'cone' && x.elemental) react = 1 + Combat.chainReact();
    const dot = Combat.burnDps(x, st, hits);
    let total = 0;
    for (let i = 0; i < iters; i++) {
      let dmg = 0;
      for (let h = 0; h < Math.max(1, Math.round(hits)); h++) dmg += base * (this._rng() < critC ? critM : 1);
      dmg *= hits / Math.max(1, Math.round(hits));
      total += dmg * react / cd + dot;
    }
    return total / iters;
  },
  simulateRun(chr, danger) {
    const p = { st: zeroStats() };
    for (const k in chr.stats) p.st[k] = (p.st[k] || 0) + chr.stats[k];
    let hp = 120 + p.st.maxHp, maxHp = hp, power = 1, luckBonus = 1 + (p.st.luck || 0) / 260;
    const D = DANGERS[danger];
    for (let wave = 1; wave <= 20; wave++) {
      power *= 1.185 * luckBonus * (1 + ((p.st.harvest || 0) + (p.st.eng || 0) * .1) / 260) * this._rand(.87, 1.15);
      const wDmg = Math.pow(1.20, wave - 1) * D.hp;
      const offense = power * (1 + (p.st.dmgP || 0) / 100) * (1 + ((p.st.ranged || 0) + (p.st.melee || 0) + (p.st.elem || 0)) / 220)
        * (1 + (p.st.atkSpd || 0) / 190) * (1 + (p.st.crit || 0) / 240);
      const leak = clamp(Math.pow(wDmg / Math.max(.2, offense), .62), 0, 3.4);
      /* Der Spieler investiert unterwegs auch in Verteidigung */
      maxHp *= 1.062; hp = Math.min(maxHp, hp + maxHp * .045);
      const defGrow = 1 + wave * .062;
      const mitig = (1 - clamp((p.st.armor || 0) * .035, 0, .5)) * (1 - clamp((p.st.dodge || 0) / 100, 0, .5)) / defGrow;
      hp -= leak * 40 * mitig * D.dmg * (1 + wave * .03) * this._rand(.6, 1.45);
      hp += (maxHp * .155) + (p.st.hpRegen || 0) * 11 + (p.st.lifesteal || 0) * .85;
      hp = Math.min(maxHp, hp);
      if (hp <= 0) return wave;
    }
    return 21;
  },
  /* Reiner Rechenkern: keine DOM/UI-Nebenwirkungen, headless nutzbar
     (wird von run() gerendert und von Tests/Balance-Harness direkt aufgerufen). */
  compute(iters) {
    const t0 = performance.now();
    this._rng = this._mulberry32(this._seed);
    const st = this.refStats(14);
    /* Waffen-Messung braucht GENUG Iterationen: 500 je Tier-Wert sind bei
       Grenzfaellen (+-30%) stabil; mehr iters skalieren hier, nicht die
       Charakter-Laeufe (die haben ihre eigene, fixe Rate weiter unten). */
    const perWeapon = Math.max(500, Math.floor(iters / 3));
    const rows = [], legRows = [];
    for (const def of WEAPONS) {
      /* Isolierter Seed je Waffe: pfadunabhaengige Messung (s. weaponSeed) */
      this._rng = this._mulberry32(this.weaponSeed(def.id));
      const d = [0, 1, 2, 3].map(t => this.weaponDPS(def, t, st, perWeapon));
      const row = { def, d, t1: d[0], r2: d[1] / d[0], r3: d[2] / d[0], r4: d[3] / d[0], dps: d[2] };
      (def.legendary ? legRows : rows).push(row);
    }
    const avg = rows.reduce((a, r) => a + r.dps, 0) / rows.length;
    legRows.forEach(r => r.dev = (r.dps / avg - 1) * 100);
    /* Abweichung innerhalb der Bauart messen — Nahkampf und Fernkampf sind
       nicht direkt vergleichbar, ein gemeinsamer Korridor wäre irreführend. */
    const groups = {};
    for (const r of rows) (groups[r.def.type] = groups[r.def.type] || []).push(r);
    const gAvg = {};
    for (const g in groups) gAvg[g] = groups[g].reduce((a, r) => a + r.dps, 0) / groups[g].length;
    rows.forEach(r => r.dev = (r.dps / gAvg[r.def.type] - 1) * 100);
    rows.sort((a, b) => b.dev - a.dev);
    const runsPerChar = Math.max(120, Math.floor(iters / CHARS.length));
    const chars = CHARS.map(c => {
      /* Isolierter Seed je Charakter: Siegraten pfadunabhaengig von der Waffen-Schleife */
      this._rng = this._mulberry32(this.weaponSeed(c.id));
      let wins = 0, sum = 0;
      for (let i = 0; i < runsPerChar; i++) { const w = this.simulateRun(c, 2); if (w > 20) wins++; sum += Math.min(w, 20); }
      return { c, wr: wins / runsPerChar * 100, avgWave: sum / runsPerChar };
    }).sort((a, b) => b.wr - a.wr);
    const ms = Math.round(performance.now() - t0);

    /* ---- Aufsätze: DPS-Wirkung gemessen an einer Referenzwaffe ---- */
    const refW = WEAPON_BY_ID['smg'] || WEAPONS[0];
    this._rng = this._mulberry32(this.weaponSeed('smg'));
    const baseDps = this.weaponDPS(refW, 2, st, perWeapon);
    const attRows = ATTACHMENTS.map(a => {
      const w = { id: refW.id, tier: 2, attach: [a.id], kills: 0 };
      const A = attMod(w);
      const t = tierData(refW, 2);
      let base = t.dmg;
      for (const k in refW.scaling) base += (st[k] || 0) * refW.scaling[k];
      base *= (1 + st.dmgP / 100) * A.dmg;
      const critC = clamp(t.critC + st.crit / 100 + A.critC, 0, .95);
      const critM = t.critM * (1 + st.critDmg / 100) * A.critM;
      const cd = Math.max(.045, t.as / ((1 + st.atkSpd / 100) * A.rate));
      const hits = this.hitsPerAttack(refW, t.x) + Math.max(0, A.pierce) * .18;
      const dps = base * (1 + critC * (critM - 1)) * hits / cd;
      return { a: a, dps: dps, dev: (dps / baseDps - 1) * 100 };
    }).sort((a, b) => b.dev - a.dev);

    /* ---- Gegner: Bedrohungswert relativ zur Welle ---- */
    const thr = ENEMIES.map(e => {
      const hpS = e.hp * Math.pow(1.20, 9);
      const off = (e.dmg || 0) * 1.0 + (e.shot ? e.shot.dmg * (60 / Math.max(20, e.shot.cd * 60)) * 1.6 : 0)
        + (e.boom ? e.boom.dmg * .9 : 0) + (e.lob ? e.lob.dmg * 1.1 : 0) + (e.beam ? e.beam.dmg * 1.0 : 0)
        + (e.slam ? e.slam.dmg * .9 : 0) + (e.mine ? e.mine.dmg * .8 : 0) + (e.drain ? e.drain.dps * 1.4 : 0);
      const mob = (e.spd || 100) / 120;
      const score = (hpS * .012 + (e.armor || 0) * 1.4) * .5 + off * mob;
      return { e: e, score: score, value: (e.xp || 1) + (e.mat || 1) };
    });
    const thrAvg = thr.reduce((a, r) => a + r.score, 0) / thr.length;
    thr.forEach(r => r.dev = (r.score / thrAvg - 1) * 100);
    thr.sort((a, b) => b.dev - a.dev);

    /* ---- Bosse: Kampfdauer mit dem Build, den man zu dieser Welle wirklich hat ---- */
    const bossRows = BOSSES.map((B, bi) => {
      const bWave = (bi % 4 + 1) * 5;
      const ttk = B.hp * (1 + B.armor * .02) / Math.max(1, this.bossRefDps(bWave));
      return { B, bWave, ttk, ok: ttk >= 25 && ttk <= 90 };
    });

    /* ---- Charakter × Waffenklasse: beste und schlechteste Paarung ---- */
    const pairs = [];
    for (const c of CHARS) {
      const cst = zeroStats();
      for (const k in c.stats) cst[k] = (cst[k] || 0) + c.stats[k];
      for (const k in st) cst[k] = (cst[k] || 0) + st[k] * .6;
      let best = null, worst = null;
      for (const w of WEAPONS) {
        if (w.legendary) continue;
        this._rng = this._mulberry32(this.weaponSeed(w.id));
        const d = this.weaponDPS(w, 2, cst, 60);
        if (!best || d > best.d) best = { w: w, d: d };
        if (!worst || d < worst.d) worst = { w: w, d: d };
      }
      pairs.push({ c: c, best: best, worst: worst, spread: best.d / Math.max(1, worst.d) });
    }
    pairs.sort((a, b) => b.spread - a.spread);

    const outliers = rows.filter(r => this._util.includes(r.def.id) ? (r.dev < -45 || r.dev > 25) : (Math.abs(r.dev) > 30)).length;
    const attOut = attRows.filter(r => r.dev < 0 || r.dev > 32).length;
    const bossOut = bossRows.filter(r => !r.ok).length;
    const charOk = chars.filter(c => c.wr >= 20 && c.wr <= 80).length;

    const data = {
      meta: { iters, ms, perWeapon, runsPerChar, avg },
      groups, gAvg, rows, legRows, chars, attRows, thr,
      bossRows, pairs, outliers, attOut, bossOut, charOk
    };

    /* ---- JSON-Export: dieselben Ergebnisse als maschinenlesbarer Bericht ---- */
    try {
      this._lastJson = JSON.stringify({
        erzeugt: new Date().toISOString(),
        referenz: { level: 14, gefahr: 0, waffe: 'Stufe 3' },
        bauartMittel: gAvg,
        waffen: rows.map(r => ({ name: r.def.name, id: r.def.id, typ: r.def.type, dpsT3: r.dps, abweichungProzent: +r.dev.toFixed(1), tierFaktoren: [+(+r.r2.toFixed(2)), +(+r.r3.toFixed(2)), +(+r.r4.toFixed(2))] })),
        legendaere: legRows.map(r => ({ name: r.def.name, dpsT3: r.dps, ueberStandardProzent: +r.dev.toFixed(1) })),
        charaktere: chars.map(c => ({ name: c.c.name, siegrate: +c.wr.toFixed(1), durchschnittWelle: +c.avgWave.toFixed(1) })),
        aufsaetze: attRows.map(r => ({ name: r.a.name, wirkungProzent: +r.dev.toFixed(1) })),
        gegner: thr.map(r => ({ name: r.e.name, bedrohung: +r.score.toFixed(1), wert: r.value })),
        bosse: bossRows.map(r => ({ name: r.B.name, welle: r.bWave, lp: r.B.hp, kampfdauerSekunden: +r.ttk.toFixed(0) }))
      }, null, 1);
    } catch (e) { this._lastJson = null; }
    data.json = this._lastJson;
    return data;
  },
  /* DOM/UI-Effekt-Schale: rechnet via compute() und rendert in das Panel. */
  run(iters) {
    const data = this.compute(iters);
    const { meta, gAvg, groups, rows, legRows, chars, attRows, thr, bossRows, pairs, outliers, attOut, bossOut, charOk } = data;
    const ms = meta.ms, perWeapon = meta.perWeapon, runsPerChar = meta.runsPerChar, avg = meta.avg;
    let html = `<div class="l"><span>Simulationen</span><b>${(perWeapon * WEAPONS.length * 4 + runsPerChar * CHARS.length).toLocaleString('de-DE')} Durchläufe in ${ms} ms</b></div>
      <div class="l"><span>Referenz-Build</span><b>Stufe 14, Gefahr 0, Waffenstufe 3</b></div>
      <div class="l"><span>DPS-Durchschnitt (T3)</span><b>${fmt(avg)}</b></div>
      <div class="l" style="border-bottom:1px solid var(--line2);margin-top:6px"><span style="color:var(--gold)">Waffe</span><b>DPS T3 · Abweichung in der Bauart · T2/T3/T4-Faktor</b></div>`;
    for (const g in gAvg) html += `<div class="l"><span style="color:var(--dim)">Bauart ${g}</span><b>${groups[g].length} Waffen · Ø ${fmt(gAvg[g])} DPS</b></div>`;
    for (const r of rows) {
      const ok = this._util.includes(r.def.id) ? (r.dev >= -45 && r.dev <= 25) : (Math.abs(r.dev) <= 30);
      const tierOk = Math.abs(r.r2 - 1.8) < .55 && Math.abs(r.r3 - 3.0) < 1.0 && Math.abs(r.r4 - 5.0) < 1.8;
      html += `<div class="l"><span style="color:${r.def.col}">${ok ? '✔' : '⚠'} ${r.def.name}</span>
        <b style="color:${ok ? 'var(--green)' : 'var(--red)'}">${fmt(r.dps)} · ${sign(r.dev)}% · ${r.r2.toFixed(2)}x/${r.r3.toFixed(2)}x/${r.r4.toFixed(2)}x ${tierOk ? '' : '(Tier-Kurve prüfen)'}</b></div>`;
    }
    if (legRows.length) {
      html += `<div class="l" style="border-bottom:1px solid var(--line2);margin-top:8px"><span style="color:var(--gold)">Fusionswaffen</span><b>bewusst über dem Korridor (nur per Dreifach-Fusion)</b></div>`;
      for (const r of legRows.slice().sort((a, b) => b.dps - a.dps))
        html += `<div class="l"><span style="color:${r.def.col}">◆ ${r.def.name}</span><b style="color:var(--gold)">${fmt(r.dps)} · ${sign(r.dev)}% über Standard</b></div>`;
    }
    html += `<div class="l" style="border-bottom:1px solid var(--line2);margin-top:10px"><span style="color:var(--gold)">Charakter</span><b>Siegrate bei Gefahr 2 (Ziel 20–80%) · Ø Welle</b></div>`;
    for (const c of chars) {
      const ok = c.wr >= 20 && c.wr <= 80;
      html += `<div class="l"><span style="color:${c.c.col}">${ok ? '✔' : '⚠'} ${c.c.name}</span>
        <b style="color:${ok ? 'var(--green)' : 'var(--gold)'}">${c.wr.toFixed(1)}% · ${c.avgWave.toFixed(1)}</b></div>`;
    }
    html += `<div class="l" style="border-bottom:1px solid var(--line2);margin-top:10px"><span style="color:var(--gold)">Waffen-Aufsatz</span><b>DPS-Wirkung (Ziel +5 bis +25%)</b></div>`;
    for (const r of attRows) {
      const ok = r.dev >= 0 && r.dev <= 32;
      html += `<div class="l"><span style="color:${r.a.col}">${ok ? '✔' : '⚠'} ${r.a.icon} ${r.a.name}</span>
        <b style="color:${ok ? 'var(--green)' : 'var(--red)'}">${sign(r.dev)}%</b></div>`;
    }
    html += `<div class="l" style="border-bottom:1px solid var(--line2);margin-top:10px"><span style="color:var(--gold)">Gegner</span><b>Bedrohungswert (Welle 10) · Abweichung</b></div>`;
    for (const r of thr.slice(0, 6).concat(thr.slice(-4))) {
      const ok = Math.abs(r.dev) <= 120;
      html += `<div class="l"><span style="color:${r.e.col}">${ok ? '✔' : '⚠'} ${r.e.name}</span>
        <b style="color:${ok ? 'var(--green)' : 'var(--gold)'}">${fmt(r.score)} · ${sign(r.dev)}% · Beute ${r.value}</b></div>`;
    }
    html += `<div class="l" style="border-bottom:1px solid var(--line2);margin-top:10px"><span style="color:var(--gold)">Boss</span><b>Kampfdauer mit typischem Build der Welle (Ziel 25–90 s)</b></div>`;
    for (const r of bossRows) {
      const ok = r.ok;
      html += `<div class="l"><span style="color:${r.B.col}">${ok ? '✔' : '⚠'} ${r.B.name}</span>
        <b style="color:${ok ? 'var(--green)' : 'var(--gold)'}">${r.ttk.toFixed(0)} s · Welle ${r.bWave} · ${r.B.phases.length} Phasen · ${r.B.hp.toLocaleString('de-DE')} LP</b></div>`;
    }
    html += `<div class="l" style="border-bottom:1px solid var(--line2);margin-top:10px"><span style="color:var(--gold)">Charakter × Waffe</span><b>Beste Paarung · Spreizung</b></div>`;
    for (const p of pairs.slice(0, 6)) {
      const ok = p.spread < 6;
      html += `<div class="l"><span style="color:${p.c.col}">${ok ? '✔' : '⚠'} ${p.c.name}</span>
        <b style="color:${ok ? 'var(--green)' : 'var(--gold)'}">${p.best.w.name} · ${p.spread.toFixed(1)}× über ${p.worst.w.name}</b></div>`;
    }
    html += `<div class="l" style="margin-top:8px"><span>Ergebnis</span><b>${rows.length - outliers}/${rows.length} Waffen · ${attRows.length - attOut}/${attRows.length} Aufsätze · ${BOSSES.length - bossOut}/${BOSSES.length} Bosse · ${charOk}/${chars.length} Charaktere im Zielkorridor</b></div>`;
    const box = $('simOut'); box.innerHTML = html; box.classList.remove('hidden');
    UI.refreshNav();
  }
};
window.BalanceSim = BalanceSim;

const Feedback = {
  submit(kind) {
    Save.data.feedback = Save.data.feedback || [];
    Save.data.feedback.push({ k: kind, wave: Game.wave, danger: Game.danger, coop: Game.coop, chars: Game.players.map(p => p.char.id), t: Date.now() });
    if (Save.data.feedback.length > 200) Save.data.feedback.shift();
    Save.save(); AudioSys.sfx('ok');
    this.render();
  },
  render() {
    const f = Save.data.feedback || [];
    const c = { easy: 0, ok: 0, hard: 0, unfair: 0 };
    for (const e of f) c[e.k] = (c[e.k] || 0) + 1;
    const n = Math.max(1, f.length);
    $('fbOut').innerHTML = f.length
      ? `Deine bisherigen Rückmeldungen (${f.length}): zu leicht ${Math.round(c.easy / n * 100)}% · richtig ${Math.round(c.ok / n * 100)}% · zu schwer ${Math.round(c.hard / n * 100)}% · unfair ${Math.round(c.unfair / n * 100)}% — lokal gespeichert, beeinflusst die Empfehlung der Gefahrenstufe.`
      : 'Noch keine Rückmeldung abgegeben.';
    if (f.length >= 3) {
      const last3 = f.slice(-3);
      const easy = last3.filter(e => e.k === 'easy').length, hard = last3.filter(e => e.k === 'hard' || e.k === 'unfair').length;
      if (easy >= 2 && OPT().difficulty < 5) { OPT().difficulty = clamp(OPT().difficulty + 1, 0, 5); Save.save(); UI.toast('Empfohlene Gefahrenstufe erhöht auf ' + OPT().difficulty); }
      else if (hard >= 2 && OPT().difficulty > 0) { OPT().difficulty = clamp(OPT().difficulty - 1, 0, 5); Save.save(); UI.toast('Empfohlene Gefahrenstufe gesenkt auf ' + OPT().difficulty); }
    }
  }
};

