/* ============================ 20. UI-MANAGER ============================ */
const $ = id => document.getElementById(id);
const UI = {
  screens: ['scTitle', 'scChar', 'scControls', 'scOptions', 'scMusic', 'scTune', 'scAchv', 'scCodex', 'scLevel', 'scRelic', 'scShop', 'scPause', 'scEnd', 'scEndless', 'scStats', 'scCode', 'scNet', 'scNetMenu'],
  cur: 'scTitle', navIdx: 0, navEls: [], shopPlayer: 0, codexTab: 'weapons',
  show(id) {
    for (const s of this.screens) $(s).classList.toggle('hidden', s !== id);
    this.cur = id || null;
    if (id === 'scTitle' && typeof AudioSys !== 'undefined' && AudioSys.started) AudioSys.setAmbient(null);
    $('hud').classList.toggle('hidden', !(Game.state === 'play' || id === 'scPause' || id === 'scLevel' || id === 'scRelic'));
    /* Anfangsfokus: ohne diesen Reset trug navIdx den Wert des vorigen
       Bildschirms weiter — wer im Charakterraster auf Feld 7 stand, landete
       im Shop auf einem willkuerlichen Eintrag. Nur 2 von 18 Bildschirmen
       tragen [data-default], die uebrigen brauchen die 0. */
    this.navIdx = 0;
    this.refreshNav();
    const def = id && $(id).querySelector('[data-default]');
    if (def) { const i = this.navEls.indexOf(def); if (i >= 0) { this.navIdx = i; this.paintNav(); } }
    this.fit();
    Net.syncMenu();
  },
  /* ============================================================
     BILDSCHIRM-ANPASSUNG
     Jeder Menübildschirm wird so skaliert, dass er komplett auf
     eine Bildschirmhöhe passt. Erst wenn die Mindestgröße (für die
     Lesbarkeit) erreicht ist, wird zusätzlich gescrollt.
     ============================================================ */
  initTune() {
    const sc = $('scTune');
    if (!sc) return;
    /* Regler und Felder wirken sofort, Liste wird dabei nicht neu gebaut
       (sonst verloere der Regler unter dem Finger den Fokus). */
    sc.addEventListener('input', e => {
      const el = e.target;
      if (el && el.dataset && el.dataset.tune) UI.tuneInput(el);
      else if (el && el.id === 'tuneSearch') { TUNE.filter = el.value; UI.renderTune(); $('tuneSearch').focus(); }
    });
    sc.addEventListener('change', e => {
      const el = e.target;
      if (el && el.dataset && el.dataset.tune) UI.tuneInput(el);
    });
  },
  initFit() {
    for (const id of this.screens) {
      const sc = $(id);
      if (!sc || sc.querySelector(':scope > .fitouter')) continue;
      const outer = document.createElement('div'); outer.className = 'fitouter';
      const wrap = document.createElement('div'); wrap.className = 'fitwrap';
      [...sc.childNodes].forEach(ch => {
        if (ch.nodeType === 1 && ch.getAttribute && ch.getAttribute('data-fixed')) return;
        wrap.appendChild(ch);
      });
      outer.appendChild(wrap);
      sc.appendChild(outer);
      sc.classList.add('fitted');
    }
    if (!this._fitBound) {
      this._fitBound = true;
      addEventListener('resize', () => this.fit());
      addEventListener('orientationchange', () => setTimeout(() => this.fit(), 120));
    }
    this.applyReadable();
  },
  applyReadable() {
    try { document.body.classList.toggle('readable', OPT().readable !== false); } catch (e) { }
  },
  minScale() {
    const m = OPT().uiMinScale;
    return typeof m === 'number' ? clamp(m, .4, 1) : .58;
  },
  fitScreen(sc) {
    if (!sc || sc.classList.contains('hidden')) return;
    const outer = sc.querySelector(':scope > .fitouter');
    if (!outer) return;
    const wrap = outer.firstElementChild;
    if (!wrap) return;
    const mode = OPT().uiScale || 'auto';
    wrap.style.transform = 'none';
    outer.style.height = 'auto';
    /* clientHeight enthaelt die Polsterung. Sie zu raten geht schief, sobald
       Safe-Area-Abstaende dazukommen - auf einem Geraet mit Notch sind das oben
       bis zu 59 px. Zu grosses availH meldet keinen Ueberlauf, die zentrierte
       Flex-Box schneidet den Inhalt dann oben unerreichbar ab. */
    const cs = getComputedStyle(sc);
    const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const availH = Math.max(120, sc.clientHeight - padY);
    const availW = Math.max(200, sc.clientWidth - padX);
    const h = wrap.scrollHeight || 1, w = wrap.scrollWidth || 1;
    let k;
    if (mode === 'auto') {
      k = Math.min(1, availH / h, availW / w);
      k = Math.max(k, this.minScale());
    } else {
      k = clamp(parseFloat(mode) || 1, .5, 1.4);
    }
    if (Math.abs(k - 1) > .004) wrap.style.transform = 'scale(' + k.toFixed(4) + ')';
    outer.style.height = Math.ceil(h * k) + 'px';
    const overflow = h * k > availH + 4;
    sc.style.alignItems = overflow ? 'flex-start' : 'center';
    outer.style.alignItems = 'flex-start';
    outer.style.marginTop = overflow ? '0' : Math.max(0, Math.round((availH - h * k) / 2)) + 'px';
    return { k: k, overflow: overflow };
  },
  fit() {
    if (!this.cur) { const n = $('fitNote'); if (n) n.classList.add('hidden'); return; }
    const sc = $(this.cur);
    const r = this.fitScreen(sc);
    const note = $('fitNote');
    if (note) {
      if (r && (r.overflow || r.k < .995)) {
        note.textContent = (r.k < .995 ? 'Ansicht ' + Math.round(r.k * 100) + '%' : '') + (r.overflow ? (r.k < .995 ? ' · ' : '') + 'scrollen für mehr' : '');
        note.classList.remove('hidden');
      } else note.classList.add('hidden');
    }
    return r;
  },
  hideAll() { for (const s of this.screens) $(s).classList.add('hidden'); this.cur = null; this.navEls = []; this.stack = []; },
  /* Bildschirme als Stapel: push legt den aktuellen ab, back holt ihn zurueck.
     Vorher merkte sich jeder Unterbildschirm seine Herkunft in einer eigenen
     Variablen - das skaliert bei 18 Bildschirmen nicht. */
  stack: [],
  push(id) { if (this.cur) this.stack.push(this.cur); this.show(id); },
  back(fallback) {
    const prev = this.stack.pop() || fallback || 'scTitle';
    if (prev === 'scTitle') this.renderTitle();
    else if (prev === 'scOptions') this.renderOptions();
    else if (prev === 'scChar') this.renderChars(Game.charSelIdx);
    this.show(prev);
  },
  scheduleFit() {
    if (this._fitPending) return;
    this._fitPending = true;
    const run = () => { this._fitPending = false; this.fit(); };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run); else setTimeout(run, 0);
  },
  refreshNav() {
    this.scheduleFit();
    this.navEls = [];
    if (!this.cur) return;
    const root = $(this.cur);
    this.navEls = Array.from(root.querySelectorAll('.nav,.card:not(.lock),.item:not(.bought),.lvlCard,.opt,.wrow'));
    this.navIdx = clamp(this.navIdx, 0, Math.max(0, this.navEls.length - 1));
    this.paintNav();
  },
  /* Die Markierung haengt an der zuletzt benutzten Eingabeart, nicht am
     Vorhandensein eines Gamepads: wer mit Pfeiltasten navigiert, sah sonst
     ueberhaupt nichts. Maus blendet sie wieder aus. */
  navVisible: false,
  paintNav() {
    const show = this.navVisible || Input.anyGamepad;
    this.navEls.forEach((e, i) => e.classList.toggle('focus', i === this.navIdx && show));
    const el = this.navEls[this.navIdx];
    if (el && show) el.scrollIntoView({ block: 'nearest' });
  },
  navMove(d) {
    if (!this.navEls.length) return;
    this.navVisible = true;
    this.navIdx = (this.navIdx + d + this.navEls.length) % this.navEls.length;
    this.paintNav(); AudioSys.sfx('ui');
  },
  navActivate() { this.navVisible = true; const el = this.navEls[this.navIdx]; if (el) { el.click(); AudioSys.sfx('ok'); } },
  toast(msg) {
    /* Meldungen des Hosts erreichen den Gast, der ja nur den Videostream sieht. */
    if (Net.isHost()) Net.send({ t: 'toast', m: msg });
    const d = document.createElement('div'); d.className = 'toast'; d.textContent = msg;
    $('toasts').appendChild(d);
    setTimeout(() => { d.style.transition = 'opacity .4s'; d.style.opacity = '0'; setTimeout(() => d.remove(), 420); }, 2200);
  },
  banner(msg, t) {
    const b = $('banner'); b.textContent = msg; b.classList.remove('hidden');
    clearTimeout(this._bt); this._bt = setTimeout(() => b.classList.add('hidden'), (t || 1.6) * 1000);
  },
  renderTitle() {
    const d = Save.data;
    const streak = Game.dailyStreak();
    const today = d.dailyRuns && d.dailyRuns[Game.dailyStamp()];
    const now = new Date();
    const festive = (now.getMonth() === 11 && now.getDate() >= 23) || (now.getMonth() === 0 && now.getDate() <= 6);
    $('titleMeta').innerHTML =
      `<span class="az">AZ ${Game.dailySeed()}</span> · Beste Welle: <b>${d.bestWave}</b> · Siege: <b>${d.wins}</b> · Runs: ${d.runs} · Kills: ${d.totalKills.toLocaleString('de-DE')}<br>
       Charaktere ${d.unlockedChars.length}/${CHARS.length} · Waffen ${WEAPONS.filter(w => w.unlockDefault || d.unlockedWeapons.includes(w.id)).length}/${WEAPONS.length} · Erfolge ${Object.keys(d.achievements).length}/${ACHIEVEMENTS.length}<br>
       Tages-Streak: <b>${streak}</b>${today ? ` · Heute: Welle <b>${today.wave}</b>` : ''}
       ${festive ? '<br><button class="btn small nav" data-act="jingle" style="margin-top:6px">🎆 Saison-Jingle</button>' : ''}`;
  },
  /* ---------- Online-Koop: Verbindungsbildschirm + Gast-Ansichten ---------- */
  netMode: 'none',
  renderNet() {
    if (!$('netStatus')) return;
    $('netStatus').textContent = Net.status;
    $('netRoomBox').classList.toggle('hidden', !(Net.role === 'host' && Net.code));
    $('netCodeOut').textContent = Net.code || '------';
    $('netJoinBox').classList.toggle('hidden', this.netMode !== 'join');
    $('netManualBox').classList.toggle('hidden', this.netMode !== 'manual');
    $('netHangUp').classList.toggle('hidden', Net.phase === 'idle');
    this.scheduleFit();
  },
  copyText(t) {
    if (navigator.clipboard) { navigator.clipboard.writeText(t); this.toast('Kopiert'); return; }
    /* Ohne sicheren Kontext (Datei per file:// im LAN geoeffnet) gibt es die Zwischenablage-API nicht. */
    const ta = document.createElement('textarea');
    ta.value = t; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
    this.toast('Kopiert');
  },
  /* Der Gast bekommt vom Host nur eine Menue-Beschreibung und schickt die geklickte ID
     zurueck. Fremdtexte gehen ueber textContent ins DOM, nie ueber innerHTML. */
  renderNetMenu(m) {
    if (!m.title) { if (this.cur === 'scNetMenu') this.show(null); return; }   /* leerer Titel = kein Menue */
    $('netMenuTitle').textContent = m.title;
    $('netMenuSub').textContent = m.sub;
    const line = (cls, txt, col) => {
      const d = document.createElement('div');
      d.className = cls; d.textContent = txt || '';
      if (col) d.style.color = col;
      return d;
    };
    const box = $('netMenuCards'); box.innerHTML = '';
    m.items.forEach(it => {
      const el = document.createElement('div');
      el.className = 'lvlCard' + (it.dis ? ' netoff' : ' nav') + (it.on ? ' netsel' : '');
      el.appendChild(line('v', it.label, it.col));
      el.appendChild(line('n', it.sub));
      el.appendChild(line('d', it.desc));
      if (!it.dis) el.addEventListener('click', () => { Net.send({ t: 'pick', id: it.id }); AudioSys.sfx('ok'); });
      box.appendChild(el);
    });
    const ab = $('netMenuActs'); ab.innerHTML = '';
    (m.acts || []).forEach(a => {
      const b = document.createElement('button');
      b.className = 'btn small nav';
      b.textContent = a.label;
      b.addEventListener('click', () => { Net.send({ t: 'pick', id: a.id }); AudioSys.sfx('ui'); });
      ab.appendChild(b);
    });
    this.navIdx = 0;
    this.show('scNetMenu');
  },
  renderNetHud(m) {
    const chip = txt => { const d = document.createElement('div'); d.className = 'hbox'; d.textContent = txt; return d; };
    const el = $('netHud'); el.innerHTML = '';
    el.appendChild(chip('WELLE ' + m.w));
    if (m.p2) el.appendChild(chip(m.p2.n + ' ' + m.p2.hp + '/' + m.p2.mx + (m.p2.a ? '' : ' — AUSSER GEFECHT')));
    if (m.p1) el.appendChild(chip('P1 ' + m.p1.hp + '/' + m.p1.mx));
    el.appendChild(chip(m.mat + ' MATERIAL'));
    el.appendChild(chip('GEGNER ' + m.en));
    el.appendChild(chip('PING ' + Net.ping + ' ms'));
  },
  renderChars(playerIdx) {
    $('charTitle').textContent = Game.coop ? `Spieler ${playerIdx + 1} — Charakter` : 'Charakterwahl';
    $('dangerVal').textContent = Game.danger;
    $('dangerDesc').textContent = DANGERS[Game.danger].desc;
    const grid = $('charGrid'); grid.innerHTML = '';
    for (const c of CHARS) {
      const unlocked = Save.data.unlockedChars.includes(c.id) || !c.unlock;
      const el = document.createElement('div');
      el.className = 'card' + (unlocked ? '' : ' lock') + (Game.sel[playerIdx] === c.id ? ' sel' : '');
      const pros = [], cons = [];
      for (const k in c.stats) (c.stats[k] > 0 ? pros : cons).push(`${sign(c.stats[k])}${STAT_UNIT[k]} ${STAT_NAME[k]}`);
      el.innerHTML =
        `<canvas class="port" width="230" height="86"></canvas>
         <h3>${c.name}</h3><div class="role">${c.role}</div>
         <div class="desc">${c.desc}</div>
         <div class="pro">${pros.join(' · ') || '—'}</div>
         <div class="con">${cons.join(' · ') || 'Kein Malus'}</div>
         <div class="desc" style="margin-top:6px"><b style="color:var(--cyan)">${(c.ability && c.ability.name) || '—'}</b> (${(c.ability && c.ability.cd) || 0}s): ${(c.ability && c.ability.desc) || ''}</div>
         <div class="desc" style="color:var(--gold)">Start: ${(WEAPON_BY_ID[c.startWeapon] || {}).name || c.startWeapon} · Synergie: ${(c.synergy && c.synergy.text) || 'keine'}</div>
         <div class="desc" style="color:var(--cyan)">Figur: ${(c.profile && c.profile.figure) || '—'} · Animation: ${(c.profile && c.profile.animation) || '—'} · Moveset: ${(c.profile && c.profile.moveSet && c.profile.moveSet.id) || '—'}</div>
         ${(Save.data.mastery[c.id] || 0) >= 20 ? '<div class="desc" style="color:var(--gold)">★★★ Meisterlegende (Welle 20+)</div>' : (Save.data.mastery[c.id] || 0) >= 15 ? '<div class="desc" style="color:var(--gold)">★★ Meisterheld (Welle 15+)</div>' : (Save.data.mastery[c.id] || 0) >= 10 ? '<div class="desc" style="color:var(--gold)">★ Meisterschaft</div>' : (Save.data.mastery[c.id] ? `<div class="desc" style="color:var(--dim)">Beste Welle: ${Save.data.mastery[c.id]}</div>` : '')}
         ${unlocked ? '' : `<div class="lockmsg">🔒 ${c.unlock.text}</div>`}`;
      if (unlocked) el.addEventListener('click', () => { Game.sel[playerIdx] = c.id; AudioSys.sfx('ok'); this.renderChars(playerIdx); });
      grid.appendChild(el);
      this.drawPortrait(el.querySelector('canvas'), c);
    }
    this.refreshNav();
    Net.syncMenu(true);
  },
  renderMusicBar() {
    const modeEl = $('musicMode'); const chipsEl = $('musicChips'); if (!chipsEl) return;
    const styles = AudioSys.STYLE_ORDER;
    const total = styles.length;
    const cur = Math.max(0, styles.indexOf(AudioSys._style()));
    const label = AudioSys.CHIPTUNE_STYLES[styles[cur]].label;
    if (modeEl) modeEl.textContent = `${cur + 1}/${total} — ${label}`;
    chipsEl.innerHTML = styles.map((s, i) =>
      `<button class="btn small nav mchip${i === cur ? ' on' : ''}" data-act="setMusicStyle" data-val="${i}">${AudioSys.CHIPTUNE_STYLES[s].label.split(' (')[0]}</button>`).join('');
  },
  renderControls() {
    const root = $('controlsBody'); if (!root) return;
    const k = a => UI.keyLabel(Input.key(a));
    const kbd = a => `<span class="kbd">${k(a)}</span>`;
    root.innerHTML =
      `<div class="pad">
         <div class="pad-top">
           <div class="bt"><b>LB</b>Ausweichen</div>
           <div class="bt"><b>RB</b>Fähigkeit</div>
           <div class="bt"><b>RT</b>Rune</div>
         </div>
         <div class="pad-body">
           <div class="dpad">
             <i class="up">▲</i><i class="left">◀</i><i class="lbl">Bewegen</i><i class="right">▶</i><i class="down">▼</i>
           </div>
           <div class="pad-mid">
             <div class="pill"><b>L3</b> Musikmodus</div>
             <div class="pill"><b>R3</b> Springen</div>
             <div class="pill"><b>VIEW</b> Spruch</div>
             <div class="pill"><b>START</b> Pause</div>
           </div>
           <div class="face">
             <div class="fbtn top"><b>Y</b>Shop-<br>Reroll</div>
             <div class="fbtn left"><b>X</b>Emote</div>
             <div class="fbtn right"><b>B</b>Zurück</div>
             <div class="fbtn bottom"><b>A</b>Fähigkeit</div>
           </div>
         </div>
         <div class="pad-legend">Bewegen: linker Stick / D-Pad · Zielen: rechter Stick (manueller Modus)</div>
       </div>
       <div class="klist">
         <div class="kcol">
           <h4>Spieler 1</h4>
           <div class="krow"><span>Bewegen</span>${kbd('up')} ${kbd('down')} ${kbd('left')} ${kbd('right')}</div>
           <div class="krow"><span>Fähigkeit</span>${kbd('skill1')}</div>
           <div class="krow"><span>Spruch</span>${kbd('quote')}</div>
           <div class="krow"><span>Springen</span>${kbd('jump')}</div>
           <div class="krow"><span>Ausweichen</span>${kbd('dash')}</div>
           <div class="krow"><span>Rune</span>${kbd('rune')}</div>
           <div class="krow"><span>Turbo</span>${kbd('turbo')}</div>
           <div class="krow"><span>Zielmodus</span>${kbd('aimMode')}</div>
           <div class="krow"><span>Musik</span>${kbd('music')}</div>
           <div class="krow"><span>Pause</span>${kbd('pause')}</div>
         </div>
         <div class="kcol">
           <h4>Spieler 2</h4>
           <div class="krow"><span>Bewegen</span>${kbd('p2up')} ${kbd('p2down')} ${kbd('p2left')} ${kbd('p2right')}</div>
           <div class="krow"><span>Fähigkeit</span>${kbd('skill2')}</div>
           <div class="krow"><span>Spruch</span>${kbd('quote')}</div>
           <div class="krow"><span>Springen</span>${kbd('jump')}</div>
           <div class="krow"><span>Ausweichen</span>${kbd('dash')}</div>
           <div class="krow"><span>Musik</span>${kbd('music')}</div>
           <div class="knote">P2 bewegt sich mit Pfeiltasten, Fähigkeit mit ${k('skill2')}. Spruch / Springen / Ausweichen / Musik sind gemeinsame Tasten beider Spieler — oder einfach Gamepad P2 anschließen.</div>
         </div>
       </div>
       <div class="speedsec">
         <div class="speedlbl">Spielgeschwindigkeit · Stufe <b>${OPT().gameSpeed}</b> = <b>×${+SPEED_MULT(OPT().gameSpeed).toFixed(2)}</b></div>
         <div class="speedchips">${Array.from({ length: 10 }, (_, i) => `<button class="spchip${OPT().gameSpeed === i + 1 ? ' on' : ''}" data-act="speedSet" data-val="${i + 1}">${i + 1}<i>×${+SPEED_MULT(i + 1).toFixed(2)}</i></button>`).join('')}</div>
         <div class="speedhint">Stufe 5 = Normaltempo · 1 = ×0.6 · 10 = ×1.5</div>
       </div>
       <div class="speedsec">
         <div class="speedlbl">Gefahrenstufe</div>
         <div class="speedchips">${Array.from({ length: 6 }, (_, i) => `<button class="spchip${OPT().difficulty === i ? ' on' : ''}" data-act="diffSet" data-val="${i}">${i}</button>`).join('')}</div>
         <div class="speedhint">0 = entspannt · 3 = Standard · 5 = höllisch (bessere Belohnungen)</div>
       </div>
       <div class="seedrow"><span class="seedlbl">Seed</span><span class="seedval" id="seedVal">${Game.manualSeed ? Game.manualSeed : 'Zufall'}</span><button class="btn small" data-act="seedReroll">Neuer Seed</button></div>
       <div class="gpstat" id="gpStat"></div>`;
    this.updateGpStatus();
  },
  updateGpStatus() {
    const el = $('gpStat'); if (!el) return;
    let pads = [];
    try { pads = (navigator.getGamepads ? navigator.getGamepads() : []) || []; } catch (e) { pads = []; }
    const list = pads.filter(g => g && g.connected);
    el.classList.toggle('ok', list.length > 0);
    if (list.length === 0) el.innerHTML = '<b>Kein Gamepad</b> — Tastatur: P1 WASD · P2 Pfeiltasten';
    else el.innerHTML = '<b>Gamepad erkannt:</b> ' + list.map(g => (g.id || 'Controller').replace(/\s*\(.*$/, '').slice(0, 24)).join(' · ');
  },
  setMusicStyle(i) {
    const styles = AudioSys.STYLE_ORDER;
    if (i < 0 || i >= styles.length) return;
    OPT().musicStyle = styles[i];
    AudioSys._nextTime = null;
    Save.save();
    AudioSys.sfx('ui');
    UI.toast('Musikmodus ' + (i + 1) + '/' + styles.length + ': ' + AudioSys.CHIPTUNE_STYLES[styles[i]].label);
    if (UI.cur === 'scMusic') { UI.renderMusicBar(); AudioSys.previewStyle(); }
  },
  drawPortrait(cv, c) {
    const x = cv.getContext('2d'), W = cv.width, H = cv.height;
    const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#0b1424'); g.addColorStop(1, '#16243d');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.strokeStyle = 'rgba(255,255,255,.05)';
    for (let i = 0; i < W; i += 12) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, H); x.stroke(); }
    x.save(); x.translate(W / 2, H - 8);
    x.fillStyle = 'rgba(0,0,0,.4)'; x.beginPath(); x.ellipse(0, 0, 26, 7, 0, 0, TAU); x.fill();
    if (c.skin && c.skin.prop === 'escooter') {
      /* E-Roller im Portrait (Sunny) */
      x.fillStyle = '#3d3a50';
      x.beginPath(); x.ellipse(0, -11, 16, 3.6, 0, 0, TAU); x.fill();
      for (const wx of [-11, 9]) {
        x.fillStyle = '#2b2836'; x.beginPath(); x.arc(wx, -3, 5, 0, TAU); x.fill();
        x.fillStyle = '#8e7cff'; x.beginPath(); x.arc(wx, -3, 1.8, 0, TAU); x.fill();
      }
      x.strokeStyle = '#4a4258'; x.lineWidth = 4; x.lineCap = 'round';
      x.beginPath(); x.moveTo(9, -11); x.lineTo(15, -24); x.stroke();
      x.strokeStyle = '#3d3a50'; x.lineWidth = 4.5;
      x.beginPath(); x.moveTo(11, -25); x.lineTo(20, -22); x.stroke();
      x.fillStyle = '#fff2c0'; x.beginPath(); x.arc(19, -22.5, 1.6, 0, TAU); x.fill();
    }
    x.fillStyle = c.col; x.beginPath(); x.moveTo(0, -62); x.lineTo(20, -4); x.lineTo(0, -12); x.lineTo(-20, -4); x.closePath(); x.fill();
    x.fillStyle = c.col2; x.beginPath(); x.moveTo(0, -62); x.lineTo(11, -30); x.lineTo(-11, -30); x.closePath(); x.fill();
    x.fillStyle = '#f2d5b0'; x.beginPath(); x.arc(0, -46, 10, 0, TAU); x.fill();
    x.save(); x.translate(0, -46); x.scale(2, 2);
    const sk = c.skin || {};
    switch (sk.hat) {
      case 'fire': x.fillStyle = '#d43b2f'; x.beginPath(); x.arc(0, 0, 3.1, Math.PI, 0); x.fill(); x.fillRect(-3.1, -.2, 6.2, 1.4); x.fillStyle = '#ffd75e'; x.fillRect(-1, -3.2, 2, 1.7); break;
      case 'pony': x.fillStyle = '#ff3b4d'; x.beginPath(); x.arc(0, 0, 3, 0, TAU); x.fill(); x.beginPath(); x.moveTo(-2.6, 1); x.lineTo(-5, 4.4); x.lineTo(-1.4, 2.6); x.closePath(); x.fill(); break;
      case 'blond': x.fillStyle = '#f2c86b'; x.beginPath(); x.arc(0, 0, 3.4, Math.PI, 0); x.fill(); x.fillRect(-3.4, -.6, 6.8, 1.7); x.beginPath(); x.moveTo(-3.1, .5); x.lineTo(-4.8, 4.8); x.lineTo(-1.9, 3.2); x.closePath(); x.fill(); x.beginPath(); x.moveTo(3.1, .5); x.lineTo(4.8, 4.8); x.lineTo(1.9, 3.2); x.closePath(); x.fill(); x.fillStyle = '#ffe6a8'; x.beginPath(); x.arc(-1.1, -1.9, 1.2, Math.PI * .9, Math.PI * 2.1); x.fill(); x.fillStyle = '#d9a84e'; x.beginPath(); x.moveTo(-3, 1.2); x.lineTo(-3.8, 4); x.lineTo(-2.4, 3.2); x.closePath(); x.fill(); break;
      case 'goggles': x.fillStyle = '#141a2c'; x.fillRect(-2.6, -1, 5.2, 1.3); x.fillStyle = 'rgba(89,230,255,.8)'; x.fillRect(-2.4, -.8, 2, 1.3); x.fillRect(.4, -.8, 2, 1.3); break;
      case 'hood': x.fillStyle = '#2b8f5a'; x.beginPath(); x.arc(0, 0, 3.4, Math.PI * .9, Math.PI * 2.1); x.fill(); x.fillStyle = '#0f3a26'; x.fillRect(-2, -.6, 4, 2.2); break;
      case 'helm': x.fillStyle = '#6d7f9e'; x.beginPath(); x.arc(0, 0, 3.2, Math.PI, 0); x.fill(); x.fillRect(-3.2, -.6, 6.4, 1.2); x.fillRect(-1.6, -3.2, 3.2, 1.5); break;
      case 'spiky': x.fillStyle = '#ff5ce0'; x.beginPath(); x.moveTo(0, -4.6); x.lineTo(1.5, -1); x.lineTo(-1.5, -1); x.closePath(); x.fill(); x.beginPath(); x.arc(0, 0, 3, Math.PI, 0); x.fill(); break;
      case 'cap': x.fillStyle = '#3d8f2a'; x.beginPath(); x.arc(0, 0, 3, Math.PI, 0); x.fill(); x.fillRect(-3, -.3, 6, 1.1); x.fillStyle = '#5dff9b'; x.beginPath(); x.arc(0, -2.2, .9, 0, TAU); x.fill(); break;
      case 'military': x.fillStyle = '#3a4f3a'; x.beginPath(); x.ellipse(0, -.6, 3.6, 1.7, 0, 0, TAU); x.fill(); x.fillStyle = '#1c2a1c'; x.fillRect(-2.4, .5, 4.8, .8); x.fillStyle = '#ffe27a'; x.fillRect(-.3, -1.2, .6, 1.9); x.fillStyle = '#6b8ab5'; x.beginPath(); x.arc(2.3, -.2, 1, 0, TAU); x.fill(); x.fillStyle = '#e8eef6'; x.beginPath(); x.arc(2.3, -.2, .65, 0, TAU); x.fill(); break;
      case 'hard': x.fillStyle = '#ffcf4a'; x.beginPath(); x.arc(0, 0, 3.2, Math.PI, 0); x.fill(); x.fillRect(-3.2, -.4, 6.4, 1.3); x.fillStyle = '#b98a1a'; x.fillRect(-2, -.2, 4, .9); break;
      case 'antenna': x.fillStyle = '#7e97a6'; x.fillRect(-2.8, -3.2, 5.6, 6.4); x.fillStyle = '#39e6ff'; x.fillRect(-1.8, -1.4, 3.6, 1.6); break;
      case 'rock': x.fillStyle = '#241a2e'; x.beginPath(); x.arc(0, 0, 3, Math.PI, 0); x.fill(); x.beginPath(); x.moveTo(-2.4, -.5); x.lineTo(-4, 3); x.lineTo(-.6, 1.6); x.closePath(); x.fill(); x.beginPath(); x.moveTo(2.4, -.5); x.lineTo(4, 3); x.lineTo(.6, 1.6); x.closePath(); x.fill(); x.fillStyle = '#11152a'; x.fillRect(-2.2, -.6, 1.9, 1.1); x.fillRect(.3, -.6, 1.9, 1.1); break;
      case 'lockenzopf': {
        x.fillStyle = '#6b4326';
        [[-2.8, -.5, 1.55], [-1.7, -2.5, 1.65], [0, -3.2, 1.75], [1.7, -2.5, 1.65], [2.8, -.5, 1.55]].forEach(cu => { x.beginPath(); x.arc(cu[0], cu[1], cu[2], 0, TAU); x.fill(); });
        x.beginPath(); x.arc(-3.3, .9, 1.35, 0, TAU); x.fill();
        x.fillStyle = '#8f5f38'; x.beginPath(); x.ellipse(-4.1, 3.3, 1.15, 1.85, .32, 0, TAU); x.fill();
        x.fillStyle = '#ff5ce0'; x.fillRect(-4.9, 4.6, 1.6, .7);
        x.strokeStyle = '#1c2233'; x.lineWidth = .5; x.fillStyle = 'rgba(196,236,255,.6)';
        x.beginPath(); x.arc(-1.35, .1, 1.3, 0, TAU); x.fill(); x.stroke();
        x.beginPath(); x.arc(1.35, .1, 1.3, 0, TAU); x.fill(); x.stroke();
        x.beginPath(); x.moveTo(-.2, -.1); x.lineTo(.2, -.1); x.stroke();
        break;
      }
      case 'headphones': x.fillStyle = '#1a2340'; x.beginPath(); x.arc(0, 0, 3, Math.PI, 0); x.fill(); x.fillRect(-3, -.3, 6, 1.3); x.fillStyle = '#59e6ff'; x.beginPath(); x.arc(-2.7, 1.2, .9, 0, TAU); x.fill(); x.beginPath(); x.arc(2.7, 1.2, .9, 0, TAU); x.fill(); x.fillStyle = '#ff5ce0'; x.beginPath(); x.arc(0, -1.8, .6, 0, TAU); x.fill(); break;
    }
    x.restore();
    x.restore();
    x.fillStyle = 'rgba(244,194,90,.55)'; x.font = '9px monospace'; x.fillText('ID-' + c.id.toUpperCase().slice(0, 8), 6, 12);
  },
  optDefs: [
    { k: 'master', t: 'Gesamtlautstärke', type: 'range', step: .1 },
    { k: 'sfx', t: 'Effektlautstärke', type: 'range', step: .1 },
    { k: 'music', t: 'Musiklautstärke', type: 'range', step: .1 },
    { k: 'amb', t: 'Umgebungslautstärke', type: 'range', step: .1 },
    { k: 'shake', t: 'Bildschirmwackeln', type: 'range', step: .25 },
    { k: 'particles', t: 'Partikeldichte', type: 'range', step: .25 },
    { k: 'dmgNumbers', t: 'Schadenszahlen', type: 'bool' },
    { k: 'showFps', t: 'FPS-Anzeige', type: 'bool' },
    { k: 'crt', t: 'CRT-Overlay', type: 'bool' },
    { k: 'rumble', t: 'Controller-Vibration', type: 'bool' },
    { k: 'coopRevive', t: 'Koop: Wiederbelebung pro Welle', type: 'bool' },
    { k: 'minimap', t: 'Minimap (HUD)', type: 'bool' },
    { k: 'aim', t: 'Zielmodus', type: 'enum', opts: ['auto', 'manual'], labels: { auto: 'Automatisch (nächster Feind)', manual: 'Manuell (Maus/Stick)' } },
    { k: 'tutorial', t: 'Tutorial-Hinweise', type: 'bool' },
    { k: 'autoPause', t: 'Auto-Pause (Tab wechseln)', type: 'bool' },
    { k: 'reduceFlicker', t: 'Reduziertes Blinken & Wackeln', type: 'bool' },
    { k: 'highContrast', t: 'Projektile mit Kontrastumriss', type: 'bool' },
    { k: 'colorblind', t: 'Farbenblind-Modus (Konturen & Kontraste)', type: 'bool' },
      { k: 'uiScale', t: 'Menü-Größe', type: 'enum', opts: ['auto', '1', '0.9', '0.8', '0.7', '1.15'], labels: { 'auto': 'Automatisch einpassen', '1': '100 %', '0.9': '90 %', '0.8': '80 %', '0.7': '70 %', '1.15': '115 % (groß)' } },
      { k: 'uiMinScale', t: 'Kleinste Menü-Größe (Auto)', type: 'enum', opts: [0.7, 0.62, 0.58, 0.5, 0.45], labels: { 0.7: '70 % — sehr gut lesbar', 0.62: '62 %', 0.58: '58 % (Standard)', 0.5: '50 %', 0.45: '45 % — maximal einpassen' } },
      { k: 'readable', t: 'Lesbarkeitsmodus (größere Schrift)', type: 'bool' },
      { k: 'lights', t: 'Dynamische Lichter', type: 'bool' },
      { k: 'splatter', t: 'Bildschirm-Spritzer bei Treffern', type: 'bool' },
      { k: 'musicStyle', t: 'Musik-Stil (Taste M)', type: 'enum', opts: ['club', 'acid', 'rave', 'chip', 'dub', 'indus', 'trance', 'breaks'], labels: { 'club': 'NES Pulse', 'acid': 'SNES FM', 'rave': 'Famicom', 'chip': 'Retro Arcade', 'dub': 'Dub-Techno (tief & weit)', 'indus': 'Industrial-Techno', 'trance': 'Hypnotic Trance-Techno', 'breaks': 'Breakbeat-Techno' } },
      { k: 'pump', t: 'Pump / Sidechain-Intensität', type: 'range', min: 0, max: 1, step: .1 },
    { k: 'camDist', t: 'Kameradistanz', type: 'enum', opts: [0.78, 0.88, 1, 1.14, 1.3], labels: { 0.78: 'Weit — mehr Überblick', 0.88: 'Etwas weiter', 1: 'Standard (Brotato-Nähe)', 1.14: 'Etwas näher', 1.3: 'Nah — mehr Detail' } },
    { k: 'quality', t: 'Grafik-Preset', type: 'enum', opts: [0, 1, 2], labels: { 0: 'Niedrig (FPS)', 1: 'Mittel', 2: 'Hoch' } },
    { k: 'autoQuality', t: 'Auto-Qualität (FPS-Schutz)', type: 'bool' },
    { k: 'difficulty', t: 'Standard-Gefahrenstufe', type: 'int', min: 0, max: 5 },
    { k: 'gameSpeed', t: 'Spielgeschwindigkeit (Stufe 1-10)', type: 'int', min: 1, max: 10 }
  ],
  keyLabel(code) {
    if (!code) return '—';
    const M = {
      Space: '␣', Enter: '↵', Escape: 'ESC', Tab: '⇥', Backspace: '⌫',
      ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Strg', ControlRight: 'R-Strg',
      AltLeft: 'L-Alt', AltRight: 'R-Alt', MetaLeft: 'Win', MetaRight: 'Win',
      ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
      CapsLock: 'Caps', Delete: 'Del', Insert: 'Ins', Home: 'Pos1', End: 'Ende', PageUp: 'PgUp', PageDown: 'PgDn'
    };
    if (M[code]) return M[code];
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit\d$/.test(code)) return code.slice(5);
    return code.replace(/^(Key|Digit|Numpad)/, '');
  },
  /* ============================================================
     PARAMETER-WERKSTATT — Oberflaeche
     Links die Liste (Waffen / Gegner / Bosse, filterbar), rechts alle
     Werte des gewaehlten Eintrags als Regler. Aenderungen greifen
     sofort und werden im Spielstand gesichert.
     ============================================================ */
  renderTune() {
    TUNE.init();
    const listEl = $('tuneList'), bodyEl = $('tuneBody');
    const kind = TUNE.tab;
    /* --- Reiter --- */
    for (const b of document.querySelectorAll('#scTune [data-act="tuneTab"]'))
      b.classList.toggle('prim', b.dataset.val === kind);
    /* --- Liste --- */
    const f = (TUNE.filter || '').toLowerCase();
    const items = TUNE.list(kind).filter(o => !f || (o.id + ' ' + (o.name || '')).toLowerCase().indexOf(f) >= 0);
    if (!items.find(o => o.id === TUNE.sel)) TUNE.sel = items.length ? items[0].id : null;
    listEl.innerHTML = items.map(o => {
      const n = TUNE.changedCount(kind, o.id);
      return `<button class="btn small tuneitem${o.id === TUNE.sel ? ' prim' : ''}" data-act="tuneSel" data-val="${o.id}">
        <span style="color:${o.col || '#fff'};overflow:hidden;text-overflow:ellipsis">${o.name || o.id}</span>
        <b class="k">${n ? '● ' + n : ''}</b></button>`;
    }).join('') || '<div class="fl">Nichts gefunden</div>';
    /* --- Werte --- */
    bodyEl.innerHTML = TUNE.sel ? this._tuneFields(kind, TUNE.sel) : '';
    this.refreshNav();
  },
  _tuneRow(label, kind, id, path, min, max, step, val) {
    const changed = TUNE.over[TUNE.key(kind, id, path)] !== undefined;
    const v = (val == null ? 0 : val);
    return `<div class="trow${changed ? ' ch' : ''}">
      <span class="tlab">${label}</span>
      <input type="range" class="tsl" min="${min}" max="${max}" step="${step}" value="${v}"
             data-tune="${path}" data-kind="${kind}" data-id="${id}">
      <input type="number" class="tnum" min="${min}" max="${max}" step="${step}" value="${v}"
             data-tune="${path}" data-kind="${kind}" data-id="${id}">
    </div>`;
  },
  _tuneColor(label, kind, id, path, val) {
    const changed = TUNE.over[TUNE.key(kind, id, path)] !== undefined;
    return `<div class="trow${changed ? ' ch' : ''}">
      <span class="tlab">${label}</span>
      <input type="color" class="tcol" value="${val || '#ffffff'}" data-tune="${path}" data-kind="${kind}" data-id="${id}" data-type="color">
      <input type="text" class="tnum wide" value="${val || ''}" data-tune="${path}" data-kind="${kind}" data-id="${id}" data-type="text">
    </div>`;
  },
  _tuneSelect(label, kind, id, path, val, opts) {
    const changed = TUNE.over[TUNE.key(kind, id, path)] !== undefined;
    const list = opts.indexOf(val) < 0 && val != null ? opts.concat([val]) : opts;
    return `<div class="trow${changed ? ' ch' : ''}">
      <span class="tlab">${label}</span>
      <select class="tsel" data-tune="${path}" data-kind="${kind}" data-id="${id}" data-type="select">
        ${list.map(o => `<option value="${o}"${o === val ? ' selected' : ''}>${o}</option>`).join('')}
      </select></div>`;
  },
  _tuneText(label, kind, id, path, val) {
    const changed = TUNE.over[TUNE.key(kind, id, path)] !== undefined;
    return `<div class="trow${changed ? ' ch' : ''}">
      <span class="tlab">${label}</span>
      <input type="text" class="tnum wide2" value="${val == null ? '' : val}" data-tune="${path}" data-kind="${kind}" data-id="${id}" data-type="csv">
    </div>`;
  },
  _tuneBool(label, kind, id, path, val) {
    const changed = TUNE.over[TUNE.key(kind, id, path)] !== undefined;
    return `<div class="trow${changed ? ' ch' : ''}">
      <span class="tlab">${label}</span>
      <input type="checkbox" class="tchk" ${val ? 'checked' : ''} data-tune="${path}" data-kind="${kind}" data-id="${id}" data-type="bool">
    </div>`;
  },
  _tuneFields(kind, id) {
    const o = TUNE.target(kind, id);
    if (!o) return '';
    const R = this._tuneRow.bind(this);
    let h = `<div class="thead"><b style="color:${o.col}">${o.name || o.id}</b>
      <span class="fl">${kind === 'weapons' ? (o.special || '') : (o.desc || '')}</span></div>`;
    h += `<div class="tsec">Darstellung &amp; Bauart</div>`;
    h += this._tuneColor('Farbe', kind, id, 'col', o.col);
    if (kind === 'weapons') {
      h += this._tuneSelect('Verhalten', kind, id, 'type', o.type, TUNE.TYPE_LIST);
      h += this._tuneText('Bauart / Material (Komma)', kind, id, 'cls', (o.cls || []).join(','));
      h += `<div class="tsec">Mitskalierung mit Spielerwerten</div>`;
      for (const k in (o.scaling || {}))
        h += R('je Punkt ' + (STAT_NAME[k] || k), kind, id, 'scaling.' + k, 0, 2, .01, o.scaling[k]);
      for (let t = 0; t < (o.tiers || []).length; t++) {
        h += `<div class="tsec">Stufe ${t + 1}</div>`;
        for (let i = 0; i < TUNE.TIER_FIELDS.length; i++) {
          const F = TUNE.TIER_FIELDS[i];
          h += R(F[1], kind, id, 'tiers.' + t + '.' + i, F[2], F[3], F[4], o.tiers[t][i]);
        }
        const x = o.tiers[t][6] || {};
        for (const k in x) {
          if (typeof x[k] !== 'number') continue;
          const F = TUNE.X_FIELDS[k];
          h += R(F ? F[0] : k, kind, id, 'tiers.' + t + '.6.' + k, F ? F[1] : 0, F ? F[2] : 100, F ? F[3] : .01, x[k]);
        }
      }
    } else if (kind === 'enemies') {
      h += this._tuneSelect('Verhalten (KI)', kind, id, 'ai', o.ai, TUNE.AI_LIST);
      h += this._tuneSelect('Form', kind, id, 'shape', o.shape, TUNE.SHAPE_LIST);
      h += this._tuneBool('Fliegt (ignoriert Waende)', kind, id, 'fly', !!o.fly);
      h += `<div class="tsec">Grundwerte</div>`;
      for (const F of TUNE.ENEMY_FIELDS) h += R(F[1], kind, id, F[0], F[2], F[3], F[4], o[F[0]] || 0);
      for (const nk in TUNE.NEST_FIELDS) {
        if (!o[nk]) continue;
        h += `<div class="tsec">${({ shot: 'Schuss', boom: 'Explosion', heal: 'Heilung', aura: 'Aura', summon: 'Beschwoerung' })[nk]}</div>`;
        for (const F of TUNE.NEST_FIELDS[nk])
          if (typeof o[nk][F[0]] === 'number') h += R(F[1], kind, id, nk + '.' + F[0], F[2], F[3], F[4], o[nk][F[0]]);
        if (o[nk].col) h += this._tuneColor('Farbe', kind, id, nk + '.col', o[nk].col);
      }
    } else {
      h += `<div class="tsec">Grundwerte</div>`;
      for (const F of TUNE.BOSS_FIELDS) h += R(F[1], kind, id, F[0], F[2], F[3], F[4], o[F[0]] || 0);
    }
    return h;
  },
  /* Ein Regler wurde bewegt / ein Feld geaendert */
  tuneInput(el) {
    const kind = el.dataset.kind, id = el.dataset.id, path = el.dataset.tune;
    const t = el.dataset.type;
    let v;
    if (t === 'bool') v = el.checked;
    else if (t === 'csv') v = el.value.split(',').map(s => s.trim()).filter(Boolean);
    else if (t === 'select' || t === 'text' || t === 'color') v = el.value;
    else v = parseFloat(el.value);
    if (t !== 'bool' && t !== 'csv' && t !== 'select' && t !== 'text' && t !== 'color' && !isFinite(v)) return;
    TUNE.set(kind, id, path, v);
    /* Partner-Feld (Regler <-> Zahl, Farbwaehler <-> Text) mitziehen */
    const box = el.closest('.trow');
    if (box) for (const other of box.querySelectorAll('[data-tune]')) if (other !== el) other.value = el.value;
    if (box) box.classList.toggle('ch', TUNE.over[TUNE.key(kind, id, path)] !== undefined);
    /* Waffen-Sprites werden aus den Werten gebacken — Cache leeren */
    if (kind === 'weapons' && typeof WP_IMG_CACHE === 'object') for (const k in WP_IMG_CACHE) delete WP_IMG_CACHE[k];
  },
  renderOptions() {
    const list = $('optList'); list.innerHTML = '';
    for (const o of this.optDefs) {
      const el = document.createElement('div'); el.className = 'opt nav';
      const v = OPT()[o.k];
      let valHtml = '';
      if (o.type === 'range') valHtml = `<div class="slider"><i style="width:${Math.round(v * 100)}%"></i></div><span style="margin-left:8px">${Math.round(v * 100)}%</span>`;
      else if (o.type === 'bool') valHtml = v ? 'AN' : 'AUS';
      else if (o.type === 'enum') valHtml = o.labels[v] != null ? o.labels[v] : String(v);
      else if (o.k === 'gameSpeed') valHtml = `${v} · ×${(+SPEED_MULT(v).toFixed(2))}`;
      else valHtml = v;
      el.innerHTML = `<div><div class="lbl">${o.t}</div></div><div class="val" style="display:flex;align-items:center;justify-content:flex-end">${valHtml}</div>`;
      el.addEventListener('click', () => { this.cycleOpt(o, 1); });
      el.addEventListener('contextmenu', e => { e.preventDefault(); this.cycleOpt(o, -1); });
      list.appendChild(el);
    }
    const keys = OPT().keys || DEFAULT_KEYS;
    for (const [action, label] of KEY_ACTIONS) {
      const el = document.createElement('div'); el.className = 'opt nav';
      const rebinding = Input._rebind === action;
      el.innerHTML = `<div><div class="lbl">${label}</div></div><div class="val">${rebinding ? '<span style="color:var(--green)">TASTE DRÜCKEN…</span>' : '<span class="kbd">' + this.keyLabel(keys[action]) + '</span>'}</div>`;
      el.addEventListener('click', () => {
        if (Input._rebind) { Input.cancelRebind(); this.renderOptions(); return; }
        AudioSys.sfx('ui');
        Input.startRebind(action);
        UI.toast('Drücke eine Taste für: ' + label + ' (ESC = abbrechen)');
        this.renderOptions();
      });
      list.appendChild(el);
    }
    this.refreshNav();
    const foot = $('scOptions').querySelector('.credits');
    if (foot) {
      const K = a => `<span class="kbd">${this.keyLabel(keys[a])}</span>`;
      foot.innerHTML =
        `Steuerung P1: ${K('left')} ${K('up')} ${K('down')} ${K('right')} bewegen · <span class="kbd">Maus</span> zielen · ${K('skill1')} Fähigkeit · ${K('dash')} Ausweichen · ${K('quote')} Spruch · ${K('jump')} Springen · ${K('emote')} Emote · ${K('turbo')} Turbo · ${K('pause')} Pause<br>
         Steuerung P2: ${K('p2left')} ${K('p2up')} ${K('p2down')} ${K('p2right')} bewegen · ${K('skill2')} Fähigkeit · <span class="kbd">Q</span>/<span class="kbd">J</span> Spruch/Springen<br>
         Gamepad (Xbox): Linker Stick bewegen · Rechter Stick zielen · <span class="kbd">A</span> bestätigen · <span class="kbd">B</span> zurück · <span class="kbd">RB</span> Fähigkeit · <span class="kbd">LB</span> Ausweichen · <span class="kbd">R3</span> Springen · <span class="kbd">View</span> Spruch · <span class="kbd">X</span> Emote · <span class="kbd">Start</span> Pause · <span class="kbd">L3</span> Musikmodus`;
    }
  },
  cycleOpt(o, dir) {
    const opt = OPT();
    if (o.type === 'range') opt[o.k] = clamp(Math.round((opt[o.k] + o.step * dir) * 100) / 100, 0, 1);
    else if (o.type === 'bool') opt[o.k] = !opt[o.k];
    else if (o.type === 'enum') { const i = o.opts.indexOf(opt[o.k]); opt[o.k] = o.opts[(i + dir + o.opts.length) % o.opts.length]; }
    else if (o.type === 'int') opt[o.k] = clamp(opt[o.k] + dir, o.min, o.max);
    if (o.k === 'gameSpeed' && Game && Game.state === 'play') { Game.speedBase = SPEED_MULT(opt[o.k]); UI.renderHud(); }
    AudioSys.refresh(); AudioSys.sfx('ui'); Save.save();
    if (Game && Game.applyQuality) Game.applyQuality();
    document.querySelector('.scan').style.display = opt.crt && !opt.reduceFlicker ? '' : 'none';
    if (o.k === 'readable') this.applyReadable();
    this.renderOptions();
    this.fit();
  },
  renderAchv() {
    const p = Save.data.progress;
    p.allChars = Save.data.unlockedChars.length >= CHARS.length ? 1 : 0;
    p.allWeapons = WEAPONS.every(w => w.unlockDefault || Save.data.unlockedWeapons.includes(w.id)) ? 1 : 0;
    p.bestWave = Save.data.bestWave;
    const list = $('achvList'); list.innerHTML = '';
    let done = 0;
    for (const a of ACHIEVEMENTS) {
      const cur = p[a.key] || 0, ok = cur >= a.need;
      if (ok) { done++; if (!Save.data.achievements[a.id]) Save.data.achievements[a.id] = 1; }
      const el = document.createElement('div'); el.className = 'ach' + (ok ? ' done' : '');
      el.innerHTML = `<div class="t">${ok ? '★ ' : '☆ '}${a.name}</div><div>${a.desc}</div>
        <div class="c">${Math.min(cur, a.need).toLocaleString('de-DE')} / ${a.need.toLocaleString('de-DE')}</div>`;
      list.appendChild(el);
    }
    const locked = [];
    for (const c of CHARS) if (c.unlock && !Save.data.unlockedChars.includes(c.id)) locked.push('Charakter ' + c.name + ': ' + c.unlock.text);
    for (const w of WEAPONS) if (w.unlock && !w.unlockDefault && !Save.data.unlockedWeapons.includes(w.id)) locked.push('Waffe ' + w.name + ': ' + w.unlock.text);
    /* ---- Auftragsbuch ---- */
    const cb = $('cbookList');
    if (cb) {
      cb.innerHTML = '';
      const log = Save.data.contractLog || {};
      let ranksTotal = 0, doneTotal = 0;
      for (const c of Game.CONTRACTS) {
        const n = log[c.id] || 0;
        const rank = Game.contractRank(c.id);
        ranksTotal += rank; doneTotal += n;
        const names = ['—', 'BRONZE', 'SILBER', 'GOLD'];
        const cols = ['var(--dim)', '#c8874a', '#c9d3e4', '#f4c25a'];
        const next = Game.CONTRACT_RANKS.find(th => n < th);
        const el = document.createElement('div');
        el.className = 'ach' + (rank >= 3 ? ' done' : '');
        el.innerHTML = `<div class="t" style="color:${cols[rank]}">${rank ? '◆' : '◇'} ${c.t}</div>
          <div>${n.toLocaleString('de-DE')}× erfüllt · Stufe ${names[rank]}</div>
          <div class="c">Dauerhaft: +${rank * (c.bPer || 1)} ${c.bName || c.bStat}${next ? ' · nächste Stufe bei ' + next : ' · Maximalstufe'}</div>`;
        cb.appendChild(el);
      }
      const cs = $('cbookSum');
      if (cs) cs.textContent = doneTotal.toLocaleString('de-DE') + ' Aufträge erfüllt · ' + ranksTotal + '/' + (Game.CONTRACTS.length * 3) + ' Buchstufen';
    }
    $('achvSum').innerHTML = `${done}/${ACHIEVEMENTS.length} Erfolge · ${locked.length} offene Freischaltungen`
      + (locked.length ? '<div style="margin-top:6px;color:var(--dim);text-transform:none;letter-spacing:0">' + locked.slice(0, 8).join('<br>') + '</div>' : '');
    Save.save(); this.refreshNav();
  },
  renderCodex() {
    const tabs = $('codexTabs');
    if (tabs) for (const b of tabs.querySelectorAll('[data-act="codexTab"]')) b.style.borderColor = b.dataset.val === this.codexTab ? 'var(--gold)' : '';
    const list = $('codexList'); list.innerHTML = '';
    const add = (html) => { const el = document.createElement('div'); el.className = 'item'; el.innerHTML = html; list.appendChild(el); };
    if (this.codexTab === 'weapons') {
      for (const w of WEAPONS) {
        const unlocked = w.unlockDefault || Save.data.unlockedWeapons.includes(w.id);
        let rows = '';
        for (let t = 0; t < 4; t++) {
          const d = tierData(w, t);
          rows += `<div style="color:var(--dim)">T${t + 1}: <b style="color:var(--gold2)">${d.dmg}</b> Schaden · ${d.as}s · ${d.range}px · ${Math.round(d.critC * 100)}%/x${d.critM} · ${d.price} Mat.</div>`;
        }
        const sc = Object.keys(w.scaling).map(k => `${Math.round(w.scaling[k] * 100)}% ${STAT_NAME[k]}`).join(', ');
        add(`<div class="nm"><span>${unlocked ? '' : '🔒 '}${w.name}${w.legendary ? ' <span style="color:var(--gold)">★ LEGENDÄR</span>' : ''}</span></div>
          <div style="margin:4px 0">${w.cls.map(c => `<span class="tag ${c}">${CLASS_NAME[c]}</span>`).join(' ')}</div>
          <div class="st" style="color:var(--txt)">${w.special}</div>
          <div style="margin-top:5px;font-size:11px">${rows}</div>
          <div class="fl">Skalierung: ${sc}${w.unlock ? ' · Freischaltung: ' + w.unlock.text : ''}${w.legendary ? ' · Nur per 3er-Fusion' : ''}</div>`);
      }
    } else if (this.codexTab === 'enemies') {
      for (const e of ENEMIES) {
        add(`<div class="nm"><span style="color:${e.col}">${e.name}</span></div>
          <div style="font-size:11px">HP <b>${e.hp}</b> · Schaden <b>${e.dmg}</b> · Tempo <b>${e.spd}</b> · Rüstung <b>${e.armor || 0}</b> · Material <b>${e.mat}</b></div>
          <div class="fl">KI: ${e.ai}${e.minW ? ' · ab Welle ' + e.minW : ''}${e.special ? ' · ' + e.special : ''}</div>`);
      }
      for (const b of BOSSES) {
        const ar = ARENAS.find(a => a.id === b.arena);
        add(`<div class="nm"><span style="color:${b.col}">☠ ${b.name}</span></div>
          <div style="font-size:11px">HP <b>${b.hp}</b> · Schaden <b>${b.dmg}</b> · Rüstung <b>${b.armor}</b> · Arena: <b>${ar ? ar.name : b.arena}</b></div>
          <div class="fl">Phasen: ${b.phases.map((p, i) => 'P' + (i + 1) + ' (' + Math.round(p.at * 100) + '% HP · ' + p.pattern + ')').join(' · ')}</div>`);
      }
    } else if (this.codexTab === 'chars') {
      for (const c of CHARS) {
        const unlocked = Save.data.unlockedChars.includes(c.id) || !c.unlock;
        const mast = (Save.data.mastery && Save.data.mastery[c.id]) || 0;
        add(`<div class="nm"><span>${unlocked ? '' : '🔒 '}${c.name} <span style="color:${c.col}">(${c.role})</span></span>${mast ? ' <b style="color:var(--gold)">Meisterschaft ' + mast + '</b>' : ''}</div>
          <div class="st" style="color:var(--txt)">${c.desc}</div>
          <div style="font-size:11px">Fähigkeit: <b style="color:var(--cyan)">${c.ability.name}</b> (${c.ability.cd}s) — ${c.ability.desc}</div>
          <div class="fl">Start: ${WEAPON_BY_ID[c.startWeapon].name} · Synergie (${c.synergy.cls} ×${c.synergy.need}): ${c.synergy.text}</div>`);
      }
    } else if (this.codexTab === 'items') {
      add('<div class="nm"><span>Items</span></div>');
      for (const it of ITEMS) {
        const st = Object.keys(it.stats).map(k => `+${it.stats[k]} ${STAT_NAME[k]}`).join(' · ');
        add(`<div style="font-size:12px"><b style="color:${RARITY_NAME[it.r - 1] === 'Legendär' ? 'var(--gold)' : 'var(--txt)'}">${it.name}</b> (${RARITY_NAME[it.r - 1]}) · ${it.price} Mat — ${st} — <span style="color:var(--dim)">${it.fl}</span>${it.cursed ? ' <span style="color:var(--red)">VERFLUCHT</span>' : ''}</div>`);
      }
      add('<div class="nm" style="margin-top:8px"><span>Relikte &amp; Sets</span></div>');
      for (const r of RELICS) {
        const st = Object.keys(r.stats || {}).map(k => `+${r.stats[k]} ${STAT_NAME[k]}`).join(' · ');
        add(`<div style="font-size:12px"><b style="color:${r.col}">${r.name}</b> — ${r.fl}${st ? ' <span style="color:var(--dim)">(' + st + ')</span>' : ''}${r.matMult ? ' +Material' : ''}</div>`);
      }
      for (const s of RELIC_SETS) {
        add(`<div style="font-size:12px;color:var(--gold)"><b>${s.name}</b>: ${s.members.map(id => (RELIC_BY_ID[id] || { name: id }).name).join(' + ')}</div>`);
      }
    } else if (this.codexTab === 'runes') {
      add('<div class="nm"><span>Runen (aktivierbar mit <b>' + Input.key('rune').replace('Key', '') + '</b>)</span></div>');
      for (const r of RUNES) {
        add(`<div style="font-size:12px"><b style="color:${r.col}">${r.name}</b> — CD ${r.cd}s — ${r.desc}</div>`);
      }
      add('<div class="nm" style="margin-top:8px"><span>Element-Reaktionen</span></div>');
      add('<div style="font-size:12px;color:var(--dim)">Feuer + Eis = Dampf · Eis + Schock = Splitter · Schock = Kettenblitz · Feuer + Gift = Rauch · Explosion = Flächenschaden</div>');
      add('<div class="nm" style="margin-top:8px"><span>Begleiter</span></div>');
      for (const p of PETS) {
        const st = Object.keys(p.stats || {}).map(k => `+${p.stats[k]} ${STAT_NAME[k]}`).join(' · ');
        add(`<div style="font-size:12px"><b style="color:${p.col}">${p.name}</b> — ${p.desc}${st ? ' <span style="color:var(--dim)">(' + st + ')</span>' : ''}</div>`);
      }
      add(`<div style="font-size:11px;color:var(--dim);margin-top:6px">Bosse droppen Begleiter (30%), Elites selten. Runes droppen Bosse und sehr selten normale Gegner.</div>`);
      if (Game.players && Game.players[0] && Game.players[0].char.id === 'sunny') add(`<div style="font-size:11px;color:var(--cyan);margin-top:6px">Sunny-Akku: ${Math.round(Game.players[0].rollerBattery || 0)}% · Roller-Boost: 20 Akku, 2,2 s Vollgas</div>`);
    } else if (this.codexTab === 'arenas') {
      const WX = { kurpark: 'Pollen', rheinufer: 'Nebel', labor: 'Funken', neroberg: 'Glut', innenstadt: '—', warmerdamm: 'Blüten', schlachthof: 'Dunst' };
      for (const a of ARENAS) {
        add(`<div class="nm"><span style="color:${a.accent}">${a.name}</span></div>
          <div class="st" style="color:var(--txt)">${a.desc}</div>
          <div class="fl">${a.w}×${a.h} · Basis-Wetter: ${WX[a.id] || '—'} · Gebäude ${a.buildings} · Deckung ${a.cover} · Gefahrenfelder ${a.poison} · Tempo-Felder ${a.speedField} · Wände ${a.movingWalls}</div>`);
      }
      add('<div style="font-size:11px;color:var(--dim);margin-top:6px">Ab Welle 3 kann pro Welle ein Sonderwetter ziehen: Regen, Schnee, Hagel oder (ab Welle 8) Gewitter mit Blitzeinschlägen.</div>');
    } else if (this.codexTab === 'fusions') {
      add('<div class="nm"><span>Zweier-Fusionen</span></div>');
      for (const key in ShopSystem.fusionRecipes) {
        const parts = key.split('_').map(id => (WEAPON_BY_ID[id] || { name: id }).name);
        add(`<div style="font-size:12px">${parts[0]} + ${parts[1]} → <b style="color:var(--gold2)">${WEAPON_BY_ID[ShopSystem.fusionRecipes[key]].name}</b></div>`);
      }
      add('<div class="nm" style="margin-top:8px"><span>Legendäre 3er-Fusionen</span></div>');
      for (const key in ShopSystem.legendaryRecipes) {
        const parts = key.split('_').map(id => (WEAPON_BY_ID[id] || { name: id }).name);
        add(`<div style="font-size:12px">${parts.join(' + ')} → <b style="color:var(--gold)">★ ${WEAPON_BY_ID[ShopSystem.legendaryRecipes[key]].name}</b></div>`);
      }
      add('<div style="font-size:11px;color:var(--dim);margin-top:6px">Drei beliebige Waffen ergeben bei der 3er-Fusion eine zufällige legendäre Waffe, wenn kein Rezept passt.</div>');
    }
    this.refreshNav();
  },
  renderHud() {
    if (Net.isHost()) Net.send(Net.hudSnapshot());
    const modsHud = Game.wave >= 10 ? Game.mods.map(m => `<span class="tag" style="color:${m.col};border-color:${m.col}">${m.name}</span>`).join(' ') : '';
        const _spd = SPEED_MULT(OPT().gameSpeed) * (Game.speedMul === 2 ? 2 : 1);
    const _spdTag = _spd !== 1 ? `<span class="tag" style="color:#7cf;border-color:#7cf">TEMPO ×${+_spd.toFixed(1)}</span>` : '';
const waveFull = 'WELLE ' + Game.wave + ' · ' + (Game.bossAlive ? (Game.otLevel ? 'BOSS · ÜBERZEIT ' + Game.otLevel : 'BOSS') : Math.max(0, Math.ceil(Game.waveTimer)) + 's') + (Game.wave % 5 === 0 ? ' ☠' : '') + (Game.endless ? ' ∞' : '') + (Game.speedMul === 2 ? '<span class="tag" style="color:#ff8a3d;border-color:#ff8a3d">×2 TURBO</span>' : '') + _spdTag + (modsHud ? `<div style="margin-top:2px;font-size:10px">${modsHud}</div>` : '');
    const waveEl = $('hudWave');
    if (waveEl._k !== waveFull) { waveEl.innerHTML = waveFull; waveEl._k = waveFull; }
    $('hudTimer').style.width = clamp(Game.waveTimer / Game.waveDuration, 0, 1) * 100 + '%';
    $('hudArena').textContent = Game.level ? Game.level.a.name + ' · GEFAHR ' + Game.danger : '';
    const mel = $('hudArenaMod');
    if (mel) {
      const M = Game.arenaMod;
      if (!M) mel.textContent = '';
      else { mel.style.color = M.col; mel.textContent = '◆ ' + M.name; }
    }
    const wel = $('hudWager');
    if (wel) wel.textContent = Game.wager ? '⚑ WETTE: ' + Game.wager.name.toUpperCase() : '';
    const cel = $('hudContract');
    if (cel) {
      const c = Game.contract;
      if (!c) cel.textContent = '';
      else if (c.done) { cel.style.color = 'var(--green)'; cel.textContent = '✔ AUFTRAG: ' + c.t; }
      else if (c.failed) { cel.style.color = 'var(--red)'; cel.textContent = '✘ AUFTRAG: ' + c.t; }
      else {
        cel.style.color = 'var(--cyan)';
        cel.textContent = 'AUFTRAG: ' + c.t + (c.kind === 'end' ? '' : ' (' + Math.min(c.prog, c.need) + '/' + c.need + ')') + ' · +' + c.mat + ' MAT';
      }
    }
    $('hudSeed').textContent = 'SEED ' + Game.seed;
    const comboEl = $('hudCombo');
    comboEl.textContent = Game.combo > 1 ? `COMBO ${Game.combo} · ×${(1 + Math.min(Game.combo, 50) * .02).toFixed(2)}` : '';
    comboEl.style.display = Game.combo > 1 ? '' : 'none';
    $('hudMat').textContent = Game.materials;
    let live = 0; for (let i = 0; i < Game.enemies.length; i++) if (!Game.enemies[i].dead) live++;
    $('hudEnemies').textContent = 'GEGNER ' + live;
    const fpsEl = $('hudFps');
    fpsEl.style.display = OPT().showFps ? '' : 'none';
    fpsEl.textContent = Math.round(Game.fps) + ' FPS';
    for (let i = 0; i < 2; i++) {
      const box = $('hudP' + (i + 1)), p = Game.players[i];
      if (!p) { if (box.style.display !== 'none') box.style.display = 'none'; continue; }
      if (box.style.display === 'none') box.style.display = '';
      const ab = p.char.ability;
      const abCd = ab ? ab.cd : 1;
      const structKey = [
        p.char.id, p.level, p.manualAim ? 1 : 0, p.alive ? 1 : 0,
        p.weapons.map(w => w.id + ':' + w.tier + ':' + ((w.attach || []).length - (w.masteryAtt || 0))).join('|'),
        p.synActive ? 1 : 0,
        p.buffs.map(b => b.stat + ':' + b.val + ':' + Math.round(b.max * 100)).join('|'),
        p.runes.map(r => r.id).join('|'),
        ab ? ab.id : ''
      ].join(';');
      if (box._structKey !== structKey) {
        box._structKey = structKey;
        this._buildHudBox(box, p, i, ab);
      }
      this._updateHudBox(box, p, ab, abCd);
    }
  },
  _buildHudBox(box, p, i, ab) {
    const dyn = box._dyn = {};
    let slots = '';
    for (let s = 0; s < 6; s++) {
      const w = p.weapons[s];
      /* Ätherische Waffen (+15% bis +150% Schaden) bekommen ein sichtbares Badge
         statt nur eines dünnen Rahmens. */
      slots += `<div class="slot" style="${w ? 'border-color:' + (w.ethereal ? '#a06bff' : WEAPON_BY_ID[w.id].col) : ''}${w && w.ethereal ? ';color:#d9c3ff' : ''}">${w ? (w.ethereal ? 'Ä·' : '') + WEAPON_BY_ID[w.id].name.slice(0, 5) : '—'}${w ? '<b>T' + (w.tier + 1) + '</b>' : ''}</div>`;
    }
    let effs = ab ? `<div class="eff aeff"><span>${ab.name}</span><b class="aeT">BEREIT</b><div class="mic"><i class="aeB"></i></div></div>` : '';
    for (const b of p.buffs) {
      effs += `<div class="eff beff"><span>${STAT_NAME[b.stat]} ${sign(b.val)}</span><b class="bT">${b.t.toFixed(1)}s</b><div class="mic"><i class="bB"></i></div></div>`;
    }
    if (p.synActive) effs += `<div class="eff" style="border-color:var(--green);color:var(--green)">SYNERGIE</div>`;
    for (const r of p.runes) {
      const def = RUNE_BY_ID[r.id];
      effs += `<div class="eff reff" style="border-color:${def.col}" title="${def.desc}"><span style="color:${def.col}">${def.name}</span><b class="rT">BEREIT</b><div class="mic"><i class="rB"></i></div></div>`;
    }
    let ringHtml = '';
    for (const w of p.weapons) {
      const def = WEAPON_BY_ID[w.id];
      const att = (w.attach || []).length;
      ringHtml += `<div class="wslot wring" title="${def.name} T${w.tier + 1}" style="background:conic-gradient(${def.col} 360deg, rgba(255,255,255,.10) 360deg)">
        <b style="color:${def.col}">${def.name.slice(0, 2).toUpperCase()}</b>
        <i>${w.tier + 1}</i>${att ? '<u>' + att + '</u>' : ''}</div>`;
    }
    const abHtml = `<div class="wslot ability aring" title="${ab ? ab.name : ''}"
      style="background:conic-gradient(#f4c25a 360deg, rgba(255,255,255,.10) 360deg)">
      <b style="color:#f4c25a">✦</b><i class="arT"></i></div>`;
    box.innerHTML = `<div class="nm" style="color:${p.char.col}">P${i + 1} ${p.char.name} <span style="color:var(--dim);font-size:11px">LV ${p.level}</span>${p.manualAim ? ' <span style="color:var(--cyan);font-size:10px">MANUELL</span>' : ''}</div>
      <div class="wslots">${ringHtml}${abHtml}</div>
      <div class="bar hp"><i class="hpB"></i><span class="hpTxt"></span></div>
      <div class="bar xp"><i class="xpB"></i></div>
      <div class="slots">${slots}</div><div class="effs">${effs}</div>
      ${!p.alive ? '<div style="color:var(--red);font-size:11px;margin-top:3px">AUSGEFALLEN — Rückkehr nach der Welle</div>' : ''}`;
    dyn.aeff = box.querySelector('.aeff');
    dyn.aeT = box.querySelector('.aeT');
    dyn.aeB = box.querySelector('.aeB');
    dyn.rings = box.querySelectorAll('.wring');
    dyn.aring = box.querySelector('.aring');
    dyn.arT = box.querySelector('.arT');
    dyn.hpB = box.querySelector('.hpB');
    dyn.hpTxt = box.querySelector('.hpTxt');
    dyn.xpB = box.querySelector('.xpB');
    dyn.bT = Array.prototype.slice.call(box.querySelectorAll('.bT'));
    dyn.bB = Array.prototype.slice.call(box.querySelectorAll('.bB'));
    dyn.rT = Array.prototype.slice.call(box.querySelectorAll('.rT'));
    dyn.rB = Array.prototype.slice.call(box.querySelectorAll('.rB'));
  },
  _updateHudBox(box, p, ab, abCd) {
    const dyn = box._dyn;
    if (!dyn) return;
    dyn.hpB.style.width = clamp(p.hp / p.maxHp, 0, 1) * 100 + '%';
    dyn.hpTxt.textContent = Math.ceil(p.hp) + ' / ' + Math.round(p.maxHp);
    dyn.xpB.style.width = clamp(p.xp / p.xpNext, 0, 1) * 100 + '%';
    let wi = 0;
    for (const w of p.weapons) {
      const def = WEAPON_BY_ID[w.id];
      const cdMax = Math.max(.05, WeaponSystem.cooldown(p, w));
      const frac = clamp(1 - (w.cd || 0) / cdMax, 0, 1);
      const deg = Math.round(frac * 360);
      dyn.rings[wi].style.background = `conic-gradient(${def.col} ${deg}deg, rgba(255,255,255,.10) ${deg}deg)`;
      wi++;
    }
    const abFrac = clamp(1 - (p.abilityCd || 0) / Math.max(.1, abCd), 0, 1);
    const abDeg = Math.round(abFrac * 360);
    const abReady = abFrac >= 1;
    dyn.aring.classList.toggle('ready', abReady);
    dyn.aring.style.background = `conic-gradient(${abReady ? '#f4c25a' : '#5dff9b'} ${abDeg}deg, rgba(255,255,255,.10) ${abDeg}deg)`;
    const abIcon = dyn.aring && dyn.aring.querySelector('b');
    if (abIcon) abIcon.style.color = abReady ? '#f4c25a' : '#5dff9b';
    dyn.arT.textContent = abReady ? '' : Math.ceil(p.abilityCd);
    dyn.aeff.classList.toggle('ready', p.abilityCd <= 0);
    dyn.aeT.textContent = p.abilityCd > 0 ? p.abilityCd.toFixed(1) + 's' : 'BEREIT';
    dyn.aeB.style.width = Math.round(clamp(1 - p.abilityCd / Math.max(.01, abCd), 0, 1) * 100) + '%';
    let bi = 0;
    for (const b of p.buffs) {
      const bt = b.max > 0 ? clamp(b.t / b.max, 0, 1) : 0;
      dyn.bT[bi].textContent = b.t.toFixed(1) + 's';
      dyn.bB[bi].style.width = Math.round(bt * 100) + '%';
      bi++;
    }
    let ri = 0;
    for (const r of p.runes) {
      const def = RUNE_BY_ID[r.id];
      const rc = clamp(1 - r.cd / def.cd, 0, 1);
      dyn.rT[ri].textContent = r.cd <= 0 ? 'BEREIT' : r.cd.toFixed(1) + 's';
      dyn.rB[ri].style.width = Math.round(rc * 100) + '%';
      ri++;
    }
  },
  renderLevelUp(p, choices) {
    $('lvlTitle').textContent = 'Stufe ' + p.level;
    $('lvlWho').textContent = `${p.char.name} (Spieler ${p.index + 1}) wählt eine Verbesserung`;
    const box = $('lvlCards'); box.innerHTML = '';
    choices.forEach((c, i) => {
      const el = document.createElement('div'); el.className = 'lvlCard';
      el.style.position = 'relative';
      const col = ['#dbe6ff', '#5dff9b', '#39e6ff'][c.tier];
      const vHtml = c.kind ? (c.kind === 'wup' ? '⬆' : c.kind === 'wnew' ? '＋' : '✦') : (sign(c.val) + (STAT_UNIT[c.stat] || ''));
      el.innerHTML = `<div class="v" style="color:${col}">${vHtml}</div>
        <div class="n">${c.name}</div><div class="d">${c.d}</div>`;
      /* Verbannen: diese Aufwertung taucht im ganzen Run nicht mehr auf */
      const ban = document.createElement('button');
      ban.className = 'btn small';
      ban.textContent = 'verbannen';
      ban.title = 'Entfernt diese Aufwertung für den Rest des Runs';
      ban.style.cssText = 'position:absolute;right:5px;bottom:5px;font-size:9.5px;padding:1px 5px;letter-spacing:.06em';
      ban.addEventListener('click', e => { e.stopPropagation(); Game.banishUpgrade(p, c); });
      el.appendChild(ban);
      el.addEventListener('click', () => Game.chooseUpgrade(p, c));
      box.appendChild(el);
    });
    const info = document.createElement('div');
    info.style.cssText = 'font-size:11px;color:var(--dim);letter-spacing:.06em;margin-top:6px';
    info.textContent = 'Verbannt: ' + ((Game.banished && Game.banished.length) || 0) + ' Aufwertungen';
    box.appendChild(info);
    this.navIdx = 0; this.refreshNav();
    Net.syncMenu(true);
  },
  renderRelic(p) {
    $('relicWho').textContent = `${p.char.name} (Spieler ${p.index + 1}) wählt ein Relikt für den Rest des Runs`;
    const box = $('relicCards'); box.innerHTML = '';
    (Game._curRelics || []).forEach(r => {
      const el = document.createElement('div'); el.className = 'lvlCard';
      el.innerHTML = `<div class="v" style="color:${r.col}">${r.name}</div>
        <div class="n">Relikt</div><div class="d">${r.fl}</div>`;
      el.addEventListener('click', () => Game.chooseRelic(p, r.id));
      box.appendChild(el);
    });
    this.navIdx = 0; this.refreshNav();
    Net.syncMenu(true);
  },
  renderShop() {
    $('shopWave').textContent = Game.wave + ' · Gefahr ' + Game.danger;
    $('shopMat').textContent = Game.materials;
    $('rerollCost').textContent = ShopSystem.rerollCost(Game.wave);
    /* Gefahrenstufe mitten im Run anheben (Selbstherausforderung) */
    const db = $('btnDangerUp');
    if (db) {
      if (Game.state !== 'shop') db.classList.add('hidden');
      else {
        db.classList.remove('hidden');
        const maxD = Game.dangerMax();
        const cost = Game.dangerUpCost();
        db.textContent = 'GEFAHR ▲ (' + cost + ' MAT)';
        db.title = 'Gefahr ' + Game.danger + ' → ' + (Game.danger + 1) + ': ' + (DANGERS[Game.danger + 1] || {}).desc + ' — Gegner werden stärker, der Ruhm am Ende wächst.';
        db.disabled = Game.danger >= maxD || Game.materials < cost;
        db.style.opacity = db.disabled ? .45 : 1;
      }
    }
    /* Risiko-Wette für die nächste Welle */
    const wb = $('btnWager');
    if (wb) {
      const W = Game.wagerOffer;
      if (!W) wb.classList.add('hidden');
      else {
        wb.classList.remove('hidden');
        if (Game.wager) {
          wb.textContent = '✓ ' + Game.wager.name + ' angenommen';
          wb.style.color = 'var(--gold)'; wb.style.borderColor = 'var(--gold)';
          wb.disabled = true;
        } else {
          wb.textContent = 'Wette: ' + W.name + ' (+' + Math.round(W.mat * 100) + ' % Material)';
          wb.title = W.desc;
          wb.style.color = ''; wb.style.borderColor = '';
          wb.disabled = false;
        }
      }
    }
    const tabs = $('shopTabs'); tabs.innerHTML = '';
    if (Game.coop) {
      Game.players.forEach((p, i) => {
        const b = document.createElement('button');
        b.className = 'btn small nav' + (this.shopPlayer === i ? ' act' : '');
        b.textContent = `P${i + 1} ${p.char.name}`;
        b.addEventListener('click', () => { this.shopPlayer = i; ShopSystem.fusionSel = []; this.renderShop(); });
        tabs.appendChild(b);
      });
    }
    const P = Game.players[this.shopPlayer] || Game.players[0];
    const box = $('shopItems'); box.innerHTML = '';
    ShopSystem.offers.forEach((o, i) => {
      const el = document.createElement('div');
      const afford = Game.materials >= o.price;
      if (o.kind === 'weapon') {
        const def = WEAPON_BY_ID[o.id], t = tierData(def, o.tier);
        el.className = 'item r' + (o.tier + 1) + (ShopSystem.bought[i] ? ' bought' : '');
        const sc = Object.keys(def.scaling).map(k => `${Math.round(def.scaling[k] * 100)}% ${STAT_NAME[k]}`).join(', ');
        const dps = (WeaponSystem.damage(P, { id: o.id, tier: o.tier, kills: 0 }) / Math.max(.05, t.as / (1 + P.st.atkSpd / 100)));
        const owned = P.weapons.filter(w => w.id === o.id && w.tier === o.tier).length;
        el.innerHTML = `<div class="nm"><span>${def.name}</span><span class="pr ${afford ? '' : 'no'}">${o.price}</span></div>
          <div style="margin:3px 0">${def.cls.map(c => `<span class="tag ${c}">${CLASS_NAME[c]}</span>`).join(' ')} <span class="tag">${RARITY_NAME[o.tier]} · T${o.tier + 1}</span></div>
          <div class="st">${t.dmg} Schaden · ${t.as}s · ${t.range}px
Krit ${Math.round(t.critC * 100)}% · x${t.critM}
≈ ${fmt(dps)} DPS für ${P.char.name}</div>
          <div class="fl">${def.special}
Skalierung: ${sc}${owned ? '\nFUSION: kombiniert zu Stufe ' + (o.tier + 2) : ''}</div>`;
      } else if (o.kind === 'attach') {
        const a = ATT_BY_ID[o.id];
        el.className = 'item r3' + (ShopSystem.bought[i] ? ' bought' : '');
        const selSlot = ShopSystem.attachTarget >= 0 && P.weapons[ShopSystem.attachTarget] ? ShopSystem.attachTarget : -1;
        const tgt = selSlot >= 0 && P.weapons[selSlot] ? WEAPON_BY_ID[P.weapons[selSlot].id].name : 'erste freie Waffe';
        el.innerHTML = `<div class="nm"><span style="color:${a.col}">${a.icon} ${a.name}</span><span class="pr ${afford ? '' : 'no'}">${o.price}</span></div>
          <div style="margin:3px 0"><span class="tag" style="color:${a.col};border-color:${a.col}">Waffen-Aufsatz</span><span class="tag">max. ${ATT_MAX} pro Waffe</span></div>
          <div class="st">${a.st}</div>
          <div class="fl">${a.desc}\nMontage an: ${tgt}\n(Waffe im Inventar anwählen, um das Ziel zu bestimmen)</div>`;
      } else if (o.kind === 'relic') {
        const rl = RELIC_BY_ID[o.id];
        el.className = 'item relic r2' + (ShopSystem.bought[i] ? ' bought' : '');
        el.innerHTML = `<div class="nm"><span>◈ ${rl.name}</span><span class="pr ${afford ? '' : 'no'}">${o.price}</span></div>
          <div style="margin:3px 0"><span class="tag" style="color:#ffd75e;border-color:#7a5a1e">Relikt · ${P.relics.length}/${RELIC_MAX}</span></div>
          <div class="st">${rl.fl}</div>`;
      } else {
        const it = ITEM_BY_ID[o.id];
        el.className = 'item r' + it.r + (it.cursed ? ' cursed' : '') + (ShopSystem.bought[i] ? ' bought' : '');
        const lines = statLine(it.stats).map(s => s.startsWith('-') ? `<span class="neg">${s}</span>` : s).join('\n');
        el.innerHTML = `<div class="nm"><span>${it.cursed ? '☠ ' : ''}${it.name}</span><span class="pr ${afford ? '' : 'no'}">${o.price}</span></div>
          <div style="margin:3px 0"><span class="tag">${RARITY_NAME[it.r - 1]}</span>${it.cursed ? '<span class="tag" style="color:#a06bff;border-color:#5a3f9c">Verflucht</span>' : ''}${it.turret ? '<span class="tag support">Geschütz</span>' : ''}${it.thorns ? '<span class="tag heavy">Dornen ' + it.thorns + '</span>' : ''}</div>
          <div class="st">${lines}</div><div class="fl">${it.fl}</div>`;
      }
      /* Angebot für den nächsten Neuwurf sperren */
      if (!ShopSystem.bought[i]) {
        if (ShopSystem.locked[i]) el.style.outline = '1px solid var(--cyan)';
        el.style.position = 'relative';
        const lockBtn = document.createElement('button');
        lockBtn.className = 'btn small';
        lockBtn.textContent = ShopSystem.locked[i] ? 'gesperrt' : 'sperren';
        lockBtn.style.cssText = 'position:absolute;right:5px;bottom:5px;font-size:9.5px;padding:1px 5px;letter-spacing:.06em' + (ShopSystem.locked[i] ? ';color:var(--cyan);border-color:var(--cyan)' : '');
        lockBtn.addEventListener('click', e => { e.stopPropagation(); ShopSystem.toggleLock(i); });
        el.appendChild(lockBtn);
      }
      el.addEventListener('click', () => ShopSystem.buy(i, Game.players[this.shopPlayer] || Game.players[0]));
      if (i < 6) el.dataset.buy = '';
      box.appendChild(el);
    });
    const inv = $('invWeapons'); inv.innerHTML = '';
    $('invCount').textContent = `${P.weapons.length}/6`;
    P.weapons.forEach((w, i) => {
      const def = WEAPON_BY_ID[w.id];
      const row = document.createElement('div'); row.className = 'wrow';
      const atts = (w.attach || []).map(id => ATT_BY_ID[id]).filter(Boolean);
      const attHtml = atts.map(a => `<span class="tag" style="color:${a.col};border-color:${a.col}">${a.icon} ${a.name}</span>`).join(' ');
      row.innerHTML = `<span style="color:${def.col}">${def.name} <span class="t">T${w.tier + 1}</span>${w.ethereal ? ' <span style="color:#a06bff">ÄTHERISCH ' + w.kills + '</span>' : ''} ${attHtml}</span>
        <span><button class="btn small">Verkaufen +${Math.floor(tierData(def, w.tier).price * .55)}</button></span>`;
      if (ShopSystem.attachTarget === i) {
        row.style.outline = '1px solid var(--gold)';
        row.style.background = 'rgba(244,194,90,.08)';
      }
      row.style.cursor = 'pointer';
      row.title = 'Anklicken: Ziel für Waffen-Aufsätze';
      row.addEventListener('click', () => {
        ShopSystem.attachTarget = (ShopSystem.attachTarget === i) ? -1 : i;
        AudioSys.sfx('ui'); this.renderShop();
      });
      row.querySelector('button').addEventListener('click', e => {
        e.stopPropagation(); Game.materials += P.sellWeapon(i); AudioSys.sfx('buy'); this.renderShop();
      });
      inv.appendChild(row);
    });
    const sg = $('invStats'); sg.innerHTML = '';
    for (const k of STAT_KEYS) {
      if (k === 'maxHp') { sg.innerHTML += `<div><span>Leben</span><b>${Math.round(P.hp)}/${Math.round(P.maxHp)}</b></div>`; continue; }
      if (!P.st[k]) continue;
      sg.innerHTML += `<div><span>${STAT_NAME[k]}</span><b>${sign(P.st[k])}${STAT_UNIT[k]}</b></div>`;
    }
    const cc = P.classCounts(); let cls = [];
    for (const c in cc) cls.push(`${CLASS_NAME[c]} ×${cc[c]}`);
    const items = {};
    for (const id of P.items) items[id] = (items[id] || 0) + 1;
    $('invItems').innerHTML = (cls.length ? '<b style="color:var(--cyan)">Klassen:</b> ' + cls.join(' · ') + '<br>' : '')
      + (P.synActive ? `<b style="color:var(--green)">Synergie aktiv:</b> ${P.char.synergy.text}<br>` : '')
      + (P.relics.length ? '<b style="color:var(--gold)">Relikte:</b> ' + P.relics.map(id => RELIC_BY_ID[id].name).join(' · ') + '<br>' : '')
      + Object.keys(items).map(id => `${ITEM_BY_ID[id].name}${items[id] > 1 ? ' ×' + items[id] : ''}`).join(', ');
    const fb = $('fusionBody'); fb.innerHTML = '';
    const selIdx = ShopSystem.fusionSel;
    P.weapons.forEach((w, i) => {
      const def = WEAPON_BY_ID[w.id];
      const sel = selIdx.includes(i);
      const row = document.createElement('div');
      row.className = 'fselect' + (sel ? ' sel' : '');
      row.innerHTML = `<span style="color:${def.col}">${def.name} T${w.tier + 1}</span><span class="pr" style="font-size:11px">${P.weapons.length >= 6 ? 'Voll' : (sel ? 'gewählt' : 'wählen')}</span>`;
      row.addEventListener('click', e => {
        e.stopPropagation();
        if (selIdx.includes(i)) { ShopSystem.fusionSel = selIdx.filter(x => x !== i); }
        else { if (selIdx.length >= 3) selIdx.shift(); ShopSystem.fusionSel = selIdx.concat(i); }
        this.renderShop();
      });
      fb.appendChild(row);
    });
    ShopSystem.sanitizeFusion(P);
    const selIdx2 = ShopSystem.fusionSel;
    const threeRaw = selIdx2.length === 3 ? selIdx2.map(i => P.weapons[i]).filter(Boolean) : null;
    const three = threeRaw && threeRaw.length === 3 ? threeRaw : null;
    const pairRaw = selIdx2.length === 2 ? [P.weapons[selIdx2[0]], P.weapons[selIdx2[1]]] : null;
    const pair = pairRaw && pairRaw[0] && pairRaw[1] ? pairRaw : null;
    let resultHtml = '<div style="color:var(--dim);font-size:11px;margin:4px 0">Zwei Waffen kombinieren — drei Waffen ergeben eine <b style="color:var(--gold)">LEGENDAERE</b> Fusion. Der Aufwand wächst pro Welle und Tier.</div>';
    if (three) {
      const key = three.map(w => w.id).sort().join('_');
      const rid = ShopSystem.legendaryRecipes[key];
      const tier = Math.min(3, Math.max.apply(null, three.map(w => w.tier)) + 1);
      let od = rid && WEAPON_BY_ID[rid];
      if (!od) {
        const cand = WEAPONS.filter(w => w.legendary && !P.weapons.some(x => x.id === w.id && x.tier >= tier));
        if (cand.length) od = pick(cand);
      }
      if (od) {
        const cost = Math.round((140 + tier * 60 + Game.wave * 8) * DANGERS[Game.danger].price);
        resultHtml = `<div class="fresult" style="border-color:var(--gold)">${three.map(w => WEAPON_BY_ID[w.id].name).join(' + ')}
          <div style="color:var(--gold);margin:4px 0">→ <b style="color:${od.col}">★ ${od.name} T${tier + 1}</b></div>
          <div style="color:var(--dim);font-size:11px">${od.special}</div>
          <div class="pr ${Game.materials >= cost ? '' : 'no'}" style="margin-top:6px">${cost} Material</div>
          <button class="btn" style="margin-top:6px">LEGENDAER FUSIONIEREN</button></div>`;
      } else resultHtml = '<div style="color:var(--red);font-size:11px">Keine legendäre Fusion möglich.</div>';
    } else if (pair) {
      const key = [pair[0].id, pair[1].id].sort().join('_');
      const rid = ShopSystem.fusionRecipes[key];
      const tier = Math.min(3, Math.max(pair[0].tier, pair[1].tier) + 1);
      const cand = !rid ? ShopSystem.weaponPool().filter(w => !P.weapons.some(x => x.id === w.id && x.tier >= tier)) : null;
      const outW = rid ? { id: rid, tier } : (cand && cand.length ? { id: weightedPick(cand, e => tierData(e, tier).price).id, tier } : null);
      if (outW) {
        const od = WEAPON_BY_ID[outW.id];
        const cost = Math.round((50 + tier * 45 + Game.wave * 5) * DANGERS[Game.danger].price);
        resultHtml = `<div class="fresult">${pair[0].name} T${pair[0].tier + 1} + ${pair[1].name} T${pair[1].tier + 1}
          <div style="color:var(--gold);margin:4px 0">→ <b style="color:${od.col}">${od.name} T${outW.tier + 1}</b></div>
          <div style="color:var(--dim);font-size:11px">${od.special}</div>
          <div class="pr ${Game.materials >= cost ? '' : 'no'}" style="margin-top:6px">${cost} Material</div>
          <button class="btn" style="margin-top:6px">FUSIONIEREN</button></div>`;
      } else resultHtml = '<div style="color:var(--red);font-size:11px">Kein Fusionsziel verfügbar — Arsenal ist vollständig.</div>';
    }
    if (resultHtml) {
      const d = document.createElement('div'); d.innerHTML = resultHtml;
      const b = d.querySelector('button');
      if (b) b.addEventListener('click', () => ShopSystem.fusion());
      fb.appendChild(d);
    }
    this.refreshNav();
  },
  renderEnd(won) {
    $('endTitle').textContent = won ? 'WIESBADEN GERETTET' : 'RUN BEENDET';
    $('endTitle').style.color = won ? 'var(--green)' : 'var(--red)';
    const R = Game.run;
    let html = `<div class="l"><span>Erreichte Welle</span><b>${Game.wave}${won ? ' (Sieg)' : ''}${Game.endless ? ' ∞ Endlos' : ''}</b></div>
      ${Game.endless ? `<div class="l"><span>Endlos-Rekord</span><b>${Save.data.stats.endlessBest}</b></div>` : ''}
      <div class="l"><span>Gefahrenstufe</span><b>${Game.danger}</b></div>
      <div class="l"><span>Arena</span><b>${Game.level ? Game.level.a.name : '—'}</b></div>
      <div class="l"><span>Combo (max.)</span><b>${R.track.maxCombo || 0}</b></div>
      <div class="l"><span>Getötete Gegner</span><b>${R.kills}</b></div>
      <div class="l"><span>Besiegte Bosse</span><b>${R.bosses}</b></div>
      <div class="l"><span>Gesamtschaden</span><b>${fmt(R.dmg)}</b></div>
      <div class="l"><span>Gesammeltes Material</span><b>${R.materials}</b></div>
      <div class="l"><span>Spielzeit</span><b>${Math.floor(R.time / 60)}:${String(Math.floor(R.time % 60)).padStart(2, '0')}</b></div>`;
    for (const p of Game.players) {
      const best = Object.keys(p.stats.byWeapon).sort((a, b) => p.stats.byWeapon[b] - p.stats.byWeapon[a])[0];
      html += `<div class="l" style="margin-top:8px;border-bottom:1px solid var(--line2)"><span style="color:${p.char.col}">P${p.index + 1} ${p.char.name}</span><b>Stufe ${p.level}</b></div>
        <div class="l"><span>Schaden</span><b>${fmt(p.stats.dmg)}</b></div>
        <div class="l"><span>Kills</span><b>${p.stats.kills}</b></div>
        <div class="l"><span>Erlittener Schaden</span><b>${fmt(p.stats.taken)}</b></div>
        <div class="l"><span>Geheilt</span><b>${fmt(p.stats.healed)}</b></div>
        <div class="l"><span>Kritische Treffer</span><b>${p.stats.crits}</b></div>
        <div class="l"><span>Meistgenutzte Waffe</span><b>${best ? WEAPON_BY_ID[best].name : '—'}</b></div>
        <div class="l"><span>Waffen</span><b>${p.weapons.map(w => WEAPON_BY_ID[w.id].name + ' T' + (w.tier + 1)).join(', ') || '—'}</b></div>`;
    }
    if (Game.newUnlocks.length) html += `<div class="l" style="margin-top:8px"><span style="color:var(--gold)">Neu freigeschaltet</span><b>${Game.newUnlocks.join(', ')}</b></div>`;
    if (Game.mods.length) html += `<div class="l"><span>Wellen-Mods</span><b>${Game.mods.map(m => '<span style="color:' + m.col + '">' + m.name + '</span>').join(' · ')}</b></div>`;
    if (!won && Game.deathInfo) html += `<div class="l" style="margin-top:8px"><span style="color:var(--red)">Ursache</span><b>${Game.deathInfo.name}</b></div>`;
    html += `<div class="l"><span>Seed</span><b>${Game.seed}</b></div>`;
    $('endStats').innerHTML = html;
    const ep = $('endEpilog');
    if (Game.epilog) { ep.classList.remove('hidden'); ep.innerHTML = Game.epilog; }
    else ep.classList.add('hidden');
    const preBox = $('endPrestige');
    const showPre = (Game.gloryEarned || 0) > 0 || (Save.data.glory || 0) >= 100 || (Save.data.prestige || 0) > 0;
    preBox.classList.toggle('hidden', !showPre);
    if (showPre) {
      $('prestigeInfo').innerHTML = `Ruhm verdient: <b style="color:var(--gold)">+${Game.gloryEarned || 0}</b> · Ruhm gesamt: <b style="color:var(--gold)">${Save.data.glory || 0}</b> · Prestige-Stufe: <b>${Save.data.prestige || 0} / ${PRESTIGE_MAX}</b> · Bonus je Stufe: +${PRESTIGE_MAT_PCT}% Material, +${PRESTIGE_DMG_PCT}% Schaden`;
      const ok = (Save.data.glory || 0) >= 100 && (Save.data.prestige || 0) < PRESTIGE_MAX;
      $('prestigeBtn').disabled = !ok;
      $('prestigeBtn').style.opacity = ok ? 1 : .45;
      /* Ruhm-Ausgaben: Start-Vorteile für den nächsten Run */
      const sp = $('startPerks');
      if (sp) {
        const tierCur = Math.min(2, Save.data.startTier || 0);
        const it = Save.data.startItem || '';
        const canTier = tierCur < 2 && (Save.data.glory || 0) >= 150;
        const canItem = !it && (Save.data.glory || 0) >= 150;
        sp.innerHTML =
          `<button class="btn small nav" data-act="startPerk" data-val="tier" style="${canTier ? '' : 'opacity:.5'}">Start-Waffen-Tier +1 (150 Ruhm) — aktuell ${tierCur + 1}/3${tierCur >= 2 ? ' · MAX' : ''}</button>` +
          `<button class="btn small nav" data-act="startPerk" data-val="item" style="${canItem ? '' : 'opacity:.5'}">Start-Item: Kurhaus-Kaffee (150 Ruhm)${it ? ' · aktiv' : ''}</button>`;
      }
    }
    Feedback.render();
    this.navIdx = 0; this.refreshNav();
  },
  renderStats() {
    const st = Save.data.stats, d = Save.data;
    const sec = $('statsAll'); sec.innerHTML = '';
    const rows = [
      ['Runs gesamt', st.runs], ['Siege', st.wins], ['Siegrate', st.runs ? Math.round(st.wins / st.runs * 100) + '%' : '—'],
      ['Kills', st.kills.toLocaleString('de-DE')], ['Gesamtschaden', fmt(st.dmg)],
      ['Gespielte Wellen', st.waves], ['Gesammeltes Material', st.mats.toLocaleString('de-DE')],
      ['Spielzeit', Math.floor(st.time / 3600) + 'h ' + Math.floor(st.time % 3600 / 60) + 'm'],
      ['Endlos-Rekord', st.endlessBest], ['Beste Welle', d.bestWave],
      ['Ruhm', (d.glory || 0).toLocaleString('de-DE')], ['Prestige', (d.prestige || 0) + ' / ' + PRESTIGE_MAX],
      ['Meister-Charaktere (Welle 10+)', Object.keys(d.mastery).filter(id => d.mastery[id] >= 10).length + ' / ' + CHARS.length]
    ];
    for (const [k, v] of rows) { const el = document.createElement('div'); el.className = 'l'; el.innerHTML = `<span>${k}</span><b>${v}</b>`; sec.appendChild(el); }
    const wb = $('statsWeapons'); wb.innerHTML = '<div class="l" style="border:none"><span style="color:var(--gold)">Meistgetragene Waffen</span><b>Anzahl</b></div>';
    const weapons = Object.keys(st.weapons).sort((a, b) => st.weapons[b] - st.weapons[a]).slice(0, 12);
    if (!weapons.length) wb.innerHTML += '<div style="color:var(--dim);padding:4px 0">Noch keine Waffen getragen.</div>';
    for (const id of weapons) {
      const el = document.createElement('div'); el.className = 'l';
      el.innerHTML = `<span style="color:${WEAPON_BY_ID[id].col}">${WEAPON_BY_ID[id].name}</span><b>${st.weapons[id]}</b>`;
      wb.appendChild(el);
    }
    const cb = $('statsChars'); cb.innerHTML = '<div class="l" style="border:none"><span style="color:var(--gold)">Charaktere</span><b>Runs · Beste Welle</b></div>';
    for (const c of CHARS) {
      const el = document.createElement('div'); el.className = 'l';
      const runs = st.chars[c.id] || 0, best = d.mastery[c.id] || 0;
      el.innerHTML = `<span style="color:${c.col}">${c.name}</span><b>${runs} Runs · Welle ${best}${best >= 10 ? ' ★' : ''}</b>`;
      cb.appendChild(el);
    }
    this.navIdx = 0; this.refreshNav();
  },
  renderCode() {
    const d = Save.data;
    $('codeInfo').innerHTML = `Aktuell: <b>${d.unlockedChars.length}/${CHARS.length}</b> Charaktere · <b>${d.totalKills.toLocaleString('de-DE')}</b> Kills · Beste Welle <b>${d.bestWave}</b> · Erfolge <b>${Object.keys(d.achievements).length}</b>`;
    $('codeBox').value = '';
    this.navIdx = 0; this.refreshNav();
  }
};

