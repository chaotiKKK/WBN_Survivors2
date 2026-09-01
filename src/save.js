/* ============================ 2. SAVE / META ============================ */
const SAVE_KEY = 'wiesbaden_survivors_v1';
const DEFAULT_KEYS = {
  up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD',
  p2up: 'ArrowUp', p2down: 'ArrowDown', p2left: 'ArrowLeft', p2right: 'ArrowRight',
  skill1: 'Space', skill2: 'Enter', quote: 'KeyQ', jump: 'KeyJ', dash: 'ShiftLeft',
  turbo: 'KeyT', pause: 'Escape', menu: 'Enter', emote: 'KeyE', rune: 'KeyF', music: 'KeyM', aimMode: 'KeyV'
};
const KEY_ACTIONS = [
  ['up', 'Bewegen hoch'], ['down', 'Bewegen runter'], ['left', 'Bewegen links'], ['right', 'Bewegen rechts'],
  ['p2up', 'Bewegen hoch (P2)'], ['p2down', 'Bewegen runter (P2)'], ['p2left', 'Bewegen links (P2)'], ['p2right', 'Bewegen rechts (P2)'],
  ['skill1', 'Fähigkeit (P1)'], ['skill2', 'Fähigkeit (P2)'],
  ['quote', 'Spruch (P1+P2)'], ['jump', 'Springen (P1+P2)'], ['dash', 'Ausweichen (P1+P2)'],
  ['turbo', 'Turbo-Tempo'], ['pause', 'Pause / Menü'], ['menu', 'Bestätigen / OK'], ['emote', 'Emote'], ['rune', 'Rune aktivieren (P1)'],
  ['music', 'Musikmodus wechseln (Umschalt = stumm)'],
  ['aimMode', 'Zielmodus umschalten (auto / manuell)']
];
const KEY_ACTIONS_NAME = {};
KEY_ACTIONS.forEach(k => KEY_ACTIONS_NAME[k[0]] = k[1]);
/* camDist: Faktor auf die berechnete Kameradistanz. 1 = Referenz. */
const DEFAULT_SAVE = {
  unlockedChars: ['leonidas', 'sylvia', 'sebbo'],
  contractLog: {},
  unlockedWeapons: ['pistol', 'smg', 'shotgun', 'knife', 'wrench', 'spear', 'medgun', 'chopper'],
  unlockedItems: [],
  achievements: {},
  progress: {},
  bestWave: 0, wins: 0, runs: 0, totalKills: 0, maxDanger: 0,
  dailyRuns: {},
  mastery: {},
  glory: 0, prestige: 0, startTier: 0, startItem: '',
  perks: {},
  charQuests: {},
  stats: {
    kills: 0, dmg: 0, time: 0, waves: 0, mats: 0, wins: 0, runs: 0, endlessBest: 0,
    weapons: {}, chars: {}
  },
  opts: {
    master: .7, sfx: .8, music: .5, musicStyle: 'pulse', pump: 1, lights: true, splatter: true, uiScale: 'auto', uiMinScale: .58, readable: true, amb: .7, shake: 1, particles: 1, dmgNumbers: true,
    aim: 'auto', difficulty: 0, gameSpeed: 5, rumble: true, showFps: true, coopRevive: true, crt: true, tutorial: true, autoPause: true,
    reduceFlicker: false, highContrast: false, quality: 2, minimap: true, autoQuality: true, colorblind: false, camDist: 1,
    keys: Object.assign({}, DEFAULT_KEYS)
  }
};
const Save = {
  data: null,
  _slotKeys: [SAVE_KEY, SAVE_KEY + '_slot1', SAVE_KEY + '_slot2'],
  _read(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } },
  load() {
    let r = null, used = SAVE_KEY;
    for (const k of this._slotKeys) { const v = this._read(k); if (v && v.unlockedChars) { r = v; used = k; break; } }
    this.data = Object.assign(JSON.parse(JSON.stringify(DEFAULT_SAVE)), r || {});
    if (r) this.data.opts = Object.assign({}, DEFAULT_SAVE.opts, r.opts || {});
    this.data.opts.keys = Object.assign({}, DEFAULT_KEYS, (r && r.opts && r.opts.keys) || {});
    if (this.data.opts.keys.aimMode === 'KeyQ') this.data.opts.keys.aimMode = 'KeyV';
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches && !this.data.opts.reduceFlicker) this.data.opts.reduceFlicker = true;
    if (used !== SAVE_KEY && r) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.data)); } catch (e) { } }
    this.data.mastery = this.data.mastery || {};
    this.data.perks = this.data.perks || {};
    this.data.charQuests = this.data.charQuests || {};
    this.data.contractLog = this.data.contractLog || {};
    this.data.stats = Object.assign({ kills: 0, dmg: 0, time: 0, waves: 0, mats: 0, wins: 0, runs: 0, endlessBest: 0, weapons: {}, chars: {} }, this.data.stats || {});
    const styleMap = { real: 'club', synth: 'acid', '8bit': 'rave', gb: 'chip' };
    if (styleMap[this.data.opts.musicStyle]) this.data.opts.musicStyle = styleMap[this.data.opts.musicStyle];
    if (['pulse', 'snes', 'famicom', 'retro', 'club', 'acid', 'rave', 'chip', 'dub', 'indus', 'trance', 'breaks'].indexOf(this.data.opts.musicStyle) < 0) this.data.opts.musicStyle = 'pulse';
    return this.data;
  },
  save() {
    const json = JSON.stringify(this.data);
    try {
      localStorage.setItem(this._slotKeys[0], json);
    } catch (e) { }
  },
  wipe() {
    for (const k of this._slotKeys) { try { localStorage.removeItem(k); } catch (e) { } }
    this.load();
  },
  prog(key, amount = 1) { const p = this.data.progress; p[key] = (p[key] || 0) + amount; return p[key]; },
  progMax(key, v) { const p = this.data.progress; if ((p[key] || 0) < v) p[key] = v; return p[key]; },
  exportCode() {
    let code = '';
    try { code = btoa(unescape(encodeURIComponent(JSON.stringify(this.data)))); } catch (e) { code = ''; }
    return 'WS1:' + code;
  },
  importCode(code) {
    if (!code || code.indexOf('WS1:') !== 0) return 'Ungültiger Code';
    try {
      const json = decodeURIComponent(escape(atob(code.slice(4))));
      const d = JSON.parse(json);
      if (!d || typeof d !== 'object' || !('unlockedChars' in d)) return 'Kein gültiger Spielstand';
      this.data = Object.assign(JSON.parse(JSON.stringify(DEFAULT_SAVE)), d);
      this.data.opts = Object.assign({}, DEFAULT_SAVE.opts, (d && d.opts) || {});
      this.data.opts.keys = Object.assign({}, DEFAULT_KEYS, (d && d.opts && d.opts.keys) || {});
      if (this.data.opts.keys.aimMode === 'KeyQ') this.data.opts.keys.aimMode = 'KeyV';
      this.data.mastery = this.data.mastery || {};
      this.data.perks = this.data.perks || {};
      this.data.charQuests = this.data.charQuests || {};
      this.data.stats = Object.assign({ kills: 0, dmg: 0, time: 0, waves: 0, mats: 0, wins: 0, runs: 0, endlessBest: 0, weapons: {}, chars: {} }, this.data.stats || {});
      this.save();
      return null;
    } catch (e) { return 'Ungültiger Code'; }
  }
};
Save.load();
const OPT = () => Save.data.opts;

