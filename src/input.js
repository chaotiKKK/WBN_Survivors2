const Input = {
  keys: {}, pressed: {}, mouse: { x: 0, y: 0, down: false, wx: 0, wy: 0 },
  pads: [null, null], padPrev: [{}, {}], padMap: [0, 1],
  touch: { p1: { x: 0, y: 0, act: false, id: null, bx: 0, by: 0 }, p2: { x: 0, y: 0, act: false, id: null, bx: 0, by: 0 }, skill: false, skill2: false, pause: false },
  isTouch: false, anyGamepad: false, _rebind: null,
  key(action) { const k = OPT().keys || DEFAULT_KEYS; return k[action] || DEFAULT_KEYS[action]; },
  kDown(action) { return !!this.keys[this.key(action)]; },
  startRebind(action) { this._rebind = action; },
  cancelRebind() { this._rebind = null; },
  init() {
    addEventListener('keydown', e => {
      if (this._rebind) {
        if (e.code === 'Escape') { this._rebind = null; try { UI.renderOptions(); } catch (err) { } return; }
        const k = OPT().keys;
        for (const a in DEFAULT_KEYS) if (k[a] === e.code) k[a] = null;
        k[this._rebind] = e.code;
        this._rebind = null;
        Save.save();
        try { UI.renderOptions(); UI.toast('Taste gesetzt: ' + KEY_ACTIONS_NAME[this._rebind]); } catch (err) { }
        AudioSys.sfx('ok');
        e.preventDefault();
        return;
      }
      if (!this.keys[e.code]) this.pressed[e.code] = true;
      this.keys[e.code] = true;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Enter'].includes(e.code)) e.preventDefault();
      AudioSys.init();
    });
    addEventListener('keyup', e => { this.keys[e.code] = false; });
    addEventListener('blur', () => { this.keys = {}; });
    const cv = document.getElementById('game');
    addEventListener('mousemove', e => {
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      if (UI.navVisible && !this.anyGamepad) { UI.navVisible = false; UI.paintNav(); }
    });
    addEventListener('mousedown', e => { this.mouse.down = true; AudioSys.init(); });
    addEventListener('mouseup', () => { this.mouse.down = false; });
    addEventListener('gamepadconnected', e => { this.gamepadBlocked = false; this.anyGamepad = true; UI.toast('Controller verbunden: ' + (e.gamepad.id || '').slice(0, 26)); });
    addEventListener('gamepaddisconnected', () => { UI.toast('Controller getrennt'); });
    this.isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    const stick = (el, st) => {
      const r = () => el.getBoundingClientRect();
      const set = (t) => {
        const b = r(), cx = b.left + b.width / 2, cy = b.top + b.height / 2;
        let dx = t.clientX - cx, dy = t.clientY - cy; const m = Math.hypot(dx, dy), max = b.width / 2;
        if (m > max) { dx = dx / m * max; dy = dy / m * max; }
        st.x = dx / max; st.y = dy / max; st.act = true;
        el.querySelector('i').style.transform = `translate(${dx}px,${dy}px)`;
      };
      el.addEventListener('touchstart', e => { e.preventDefault(); st.id = e.changedTouches[0].identifier; set(e.changedTouches[0]); AudioSys.init(); }, { passive: false });
      el.addEventListener('touchmove', e => {
        e.preventDefault();
        for (const t of e.changedTouches) if (t.identifier === st.id) set(t);
      }, { passive: false });
      const end = e => {
        for (const t of e.changedTouches) if (t.identifier === st.id) { st.x = st.y = 0; st.act = false; st.id = null; el.querySelector('i').style.transform = ''; }
      };
      el.addEventListener('touchend', end); el.addEventListener('touchcancel', end);
    };
    stick(document.getElementById('tp1'), this.touch.p1);
    stick(document.getElementById('tp2'), this.touch.p2);
    document.getElementById('tab1').addEventListener('touchstart', e => { e.preventDefault(); this.touch.skill = true; }, { passive: false });
    document.getElementById('tab3').addEventListener('touchstart', e => { e.preventDefault(); this.touch.skill2 = true; }, { passive: false });
    document.getElementById('tab2').addEventListener('touchstart', e => { e.preventDefault(); this.touch.pause = true; }, { passive: false });
    addEventListener('touchstart', () => {
      if (!this.isTouch) {
        this.isTouch = true;
        const t = document.getElementById('touch'); if (t) t.classList.remove('hidden');
      }
    }, { passive: true });
  },
  gamepadBlocked: false,
  poll() {
    this.pads = [null, null];
    if (this.gamepadBlocked) { this.anyGamepad = false; return; }
    let gps = [];
    try { gps = (navigator.getGamepads ? navigator.getGamepads() : []) || []; }
    catch (e) {
      this.gamepadBlocked = true; this.anyGamepad = false;
      if (!this._gpWarned) { this._gpWarned = true; try { UI.toast('Controller in dieser Ansicht gesperrt — Datei lokal öffnen'); } catch (e2) { } }
      return;
    }
    let idx = 0;
    for (const g of gps) { if (g && g.connected) { if (idx < 2) this.pads[idx++] = g; } }
    this.anyGamepad = !!this.pads[0];
  },
  padBtn(p, i) { const g = this.pads[p]; return !!(g && g.buttons[i] && g.buttons[i].pressed); },
  padPressed(p, i) {
    const now = this.padBtn(p, i), was = this.padPrev[p][i];
    this.padPrev[p][i] = now; return now && !was;
  },
  padAxis(p, i) { const g = this.pads[p]; if (!g) return 0; const v = g.axes[i] || 0; return Math.abs(v) < .22 ? 0 : v; },
  rumble(p, dur = 120, strong = .4, weak = .2) {
    if (!OPT().rumble || this.gamepadBlocked) return;
    const g = this.pads[p]; if (!g) return;
    try {
      if (g.vibrationActuator && g.vibrationActuator.playEffect)
        g.vibrationActuator.playEffect('dual-rumble', { duration: dur, strongMagnitude: strong, weakMagnitude: weak, startDelay: 0 });
      else if (g.hapticActuators && g.hapticActuators[0]) g.hapticActuators[0].pulse(strong, dur);
    } catch (e) { }
  },
  rumbleWeapon(kind, p = 0) {
    const W = WEAPON_BY_ID && WEAPON_BY_ID[kind];
    const ty = W && W.type;
    const heavy = W && ((W.tiers && W.tiers[0][0] >= 28) || ty === 'shockwave' || ty === 'vortex' || ty === 'rocket' || ty === 'grenade' || ty === 'landmine' || ty === 'blast' || ty === 'orb');
    if (heavy) this.rumble(p, 150, .8, .5);
    else if (W && (ty === 'cone' || ty === 'beam')) this.rumble(p, 90, .5, .3);
    else this.rumble(p, 50, .25, .12);
  },
  moveVec(pi) {
    let x = 0, y = 0;
    if (pi === 0) {
      if (this.kDown('left')) x--; if (this.kDown('right')) x++; if (this.kDown('up')) y--; if (this.kDown('down')) y++;
      x += this.touch.p1.x; y += this.touch.p1.y;
    } else {
      if (this.kDown('p2left')) x--; if (this.kDown('p2right')) x++; if (this.kDown('p2up')) y--; if (this.kDown('p2down')) y++;
      if (Game.coop) { x += this.touch.p2.x; y += this.touch.p2.y; }
      /* Online-Koop: Spieler 2 wird vom entfernten Geraet bewegt. */
      if (Net.isHost()) { x += Net.remote.mx; y += Net.remote.my; }
    }
    const gi = this.padMap[pi];
    x += this.padAxis(gi, 0); y += this.padAxis(gi, 1);
    if (this.padBtn(gi, 14)) x--; if (this.padBtn(gi, 15)) x++;
    if (this.padBtn(gi, 12)) y--; if (this.padBtn(gi, 13)) y++;
    const m = Math.hypot(x, y);
    return m > 1 ? { x: x / m, y: y / m } : { x, y };
  },
  aimVec(pi) {
    const gi = this.padMap[pi];
    const ax = this.padAxis(gi, 2), ay = this.padAxis(gi, 3);
    if (Math.abs(ax) + Math.abs(ay) > .3) return { x: ax, y: ay, has: true };
    if (pi === 0 && this.isTouch && !Game.coop && this.touch.p2.act) return { x: this.touch.p2.x, y: this.touch.p2.y, has: true };
    if (pi === 1 && Game.coop && this.touch.p2.act) return { x: this.touch.p2.x, y: this.touch.p2.y, has: true };
    if (pi === 1 && Net.isHost() && Net.remote.aim) return { x: Net.remote.ax, y: Net.remote.ay, has: true };
    return { x: 0, y: 0, has: false };
  },
  skillDown(pi) {
    const gi = this.padMap[pi];
    if (this.padBtn(gi, 5) || this.padBtn(gi, 7) || this.padBtn(gi, 0)) return true;
    if (pi === 0) return !!this.keys[this.key('skill1')] || this.touch.skill;
    return !!this.keys[this.key('skill2')] || !!this.keys.NumpadEnter || this.touch.skill2 || (Net.isHost() && !!Net.remote.sk);
  },
  endFrame() { this.pressed = {}; this.touch.skill = false; this.touch.skill2 = false; this.touch.pause = false; }
};

