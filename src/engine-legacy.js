/* ============================ 22. PARAMETER-WERKSTATT ============================
   Ein Editor fuer alle Waffen- und Gegnerwerte zur Laufzeit: Reichweite,
   Streuung, Farbe, Bauart, Verhalten, Schaden, Tempo, Sonderwirkungen.

   Aufbau:
   - TUNE.base   unveraenderte Kopie aller Daten, beim Start gezogen.
   - TUNE.over   nur die Abweichungen, als Pfad -> Wert. Wird im
                 Spielstand gesichert und beim Laden wieder aufgelegt.
   - Aenderungen greifen sofort: Waffenwerte werden bei jedem Schuss aus
     der Tabelle gelesen, Gegnerwerte beim Erscheinen.
   ================================================================================ */
const TUNE = {
  base: null, over: {}, tab: 'weapons', sel: null, filter: '',

  /* Tier-Arrays sind positionell — hier bekommen sie Namen. */
  TIER_FIELDS: [
    ['dmg', 'Schaden', 0, 400, .1],
    ['as', 'Nachladezeit (s)', .02, 4, .01],
    ['range', 'Reichweite', 20, 1400, 5],
    ['critC', 'Kritchance (0-1)', 0, 1, .01],
    ['critM', 'Kritfaktor', 1, 6, .05],
    ['price', 'Preis', 1, 900, 1]
  ],
  /* Sonderwirkungen im 7. Feld eines Tiers. Nur was hier steht, wird als
     Regler angeboten; unbekannte Schluessel erscheinen trotzdem als Zahl. */
  X_FIELDS: {
    cone: ['Kegelbreite (rad)', 0, 3.2, .01], spread: ['Streuung (rad)', 0, 1.6, .005],
    pellets: ['Projektile', 1, 24, 1], pierce: ['Durchschlag', 0, 12, 1],
    bounce: ['Abpraller', 0, 8, 1], boom: ['Explosionsradius', 0, 320, 2],
    burn: ['Brand', 0, 80, 1], slow: ['Verlangsamung', 0, 1, .02],
    slowT: ['Verlangsamung (s)', 0, 8, .1], poison: ['Gift', 0, 80, 1],
    poisonT: ['Gift (s)', 0, 12, .1], homing: ['Zielsuche', 0, 12, .1],
    stick: ['Haftet (s)', 0, 8, .1], armorPierce: ['Ruestungsbruch', 0, 1, .02],
    lifesteal: ['Lebensraub', 0, 1, .01], healHit: ['Heilung je Treffer', 0, 40, .5],
    chargeMax: ['Aufladung max', 1, 8, .1], chargeT: ['Ladezeit (s)', .1, 5, .05],
    perHit: ['Zuwachs je Treffer', 0, 2, .01], expSize: ['Explosionsgroesse', 0, 3, .05],
    elemental: ['Elementar (0/1)', 0, 1, 1], arcRain: ['Sternenregen', 0, 1, 1],
    advice: ['Ratschlag (0/1)', 0, 1, 1], cloud: ['Wolke', 0, 1, 1],
    pull: ['Sog', 0, 400, 5]
  },
  ENEMY_FIELDS: [
    ['hp', 'Leben', 1, 400, 1], ['dmg', 'Schaden', 0, 120, .5],
    ['spd', 'Tempo', 0, 400, 2], ['r', 'Radius', 4, 60, 1],
    ['armor', 'Ruestung', 0, 40, 1], ['xp', 'Erfahrung', 0, 60, 1],
    ['mat', 'Material', 0, 40, 1], ['minW', 'Ab Welle', 1, 20, 1],
    ['w', 'Haeufigkeit', 0, 60, 1]
  ],
  BOSS_FIELDS: [
    ['hp', 'Leben', 50, 20000, 10], ['dmg', 'Schaden', 0, 200, 1],
    ['spd', 'Tempo', 0, 300, 2], ['r', 'Radius', 10, 140, 1],
    ['armor', 'Ruestung', 0, 60, 1], ['xp', 'Erfahrung', 0, 400, 5],
    ['mat', 'Material', 0, 300, 5]
  ],
  NEST_FIELDS: {
    shot: [['dmg', 'Schaden', 0, 120, .5], ['spd', 'Geschosstempo', 20, 800, 5], ['cd', 'Takt (s)', .1, 8, .05], ['range', 'Reichweite', 40, 1200, 10], ['poison', 'Gift', 0, 60, 1]],
    boom: [['dmg', 'Schaden', 0, 200, 1], ['r', 'Radius', 10, 400, 5]],
    heal: [['amt', 'Heilung', 0, 80, 1], ['cd', 'Takt (s)', .2, 8, .05], ['r', 'Radius', 20, 500, 5]],
    aura: [['armor', 'Ruestung', 0, 40, 1], ['r', 'Radius', 20, 500, 5]],
    summon: [['n', 'Anzahl', 1, 10, 1], ['cd', 'Takt (s)', .5, 15, .1]]
  },
  AI_LIST: ['chase', 'orbit', 'ranged', 'exploder', 'charger', 'healer', 'aura', 'summoner', 'blinker', 'latcher', 'splitter', 'sniper', 'swarmer'],
  SHAPE_LIST: ['tri', 'box', 'dot', 'diamond', 'hex', 'cross', 'star', 'blob', 'crab', 'ghost'],
  TYPE_LIST: ['projectile', 'hitscan', 'cone', 'melee', 'charge', 'orbit', 'aura', 'summon'],

  /* ---- Grunddaten einmalig sichern ---- */
  init() {
    if (this.base) return;
    const clone = o => JSON.parse(JSON.stringify(o));
    this.base = {
      weapons: clone(WEAPONS.map(w => ({ id: w.id, col: w.col, type: w.type, cls: w.cls, tiers: w.tiers, scaling: w.scaling }))),
      enemies: clone(ENEMIES.map(e => ({ id: e.id, col: e.col, ai: e.ai, shape: e.shape, hp: e.hp, dmg: e.dmg, spd: e.spd, r: e.r, armor: e.armor || 0, xp: e.xp, mat: e.mat, minW: e.minW, w: e.w, fly: !!e.fly, shot: e.shot, boom: e.boom, heal: e.heal, aura: e.aura, summon: e.summon }))),
      bosses: clone(BOSSES.map(b => ({ id: b.id, col: b.col, hp: b.hp, dmg: b.dmg, spd: b.spd, r: b.r, armor: b.armor || 0, xp: b.xp, mat: b.mat })))
    };
    this.over = (Save.data && Save.data.tuning) || {};
    this.applyAll();
  },
  target(kind, id) {
    return kind === 'weapons' ? WEAPON_BY_ID[id] : kind === 'enemies' ? ENEMY_BY_ID[id] : BOSSES.find(b => b.id === id);
  },
  list(kind) { return kind === 'weapons' ? WEAPONS : kind === 'enemies' ? ENEMIES : BOSSES; },
  key(kind, id, path) { return kind + '/' + id + '/' + path; },

  /* Pfad in ein Objekt schreiben: 'tiers.2.0' oder 'shot.dmg' */
  poke(obj, path, val) {
    const p = path.split('.');
    let o = obj;
    for (let i = 0; i < p.length - 1; i++) {
      const k = /^\d+$/.test(p[i]) ? +p[i] : p[i];
      if (o[k] == null) o[k] = /^\d+$/.test(p[i + 1]) ? [] : {};
      o = o[k];
    }
    const last = /^\d+$/.test(p[p.length - 1]) ? +p[p.length - 1] : p[p.length - 1];
    o[last] = val;
  },
  peek(obj, path) {
    const p = path.split('.');
    let o = obj;
    for (const k of p) { if (o == null) return undefined; o = o[/^\d+$/.test(k) ? +k : k]; }
    return o;
  },
  baseOf(kind, id) { return this.base[kind].find(x => x.id === id); },

  set(kind, id, path, val) {
    const t = this.target(kind, id);
    if (!t) return;
    this.poke(t, path, val);
    const b = this.baseOf(kind, id);
    const orig = b ? this.peek(b, path) : undefined;
    const k = this.key(kind, id, path);
    if (orig !== undefined && orig === val) delete this.over[k];
    else this.over[k] = val;
    Save.data.tuning = this.over;
    Save.save();
    /* Waffenwerte wirken sofort — die Spieler rechnen ihre Werte neu. */
    if (Game.players) for (const p of Game.players) { try { p.recalc(); } catch (e) { } }
  },
  applyAll() {
    for (const k in this.over) {
      const i = k.indexOf('/'), j = k.indexOf('/', i + 1);
      const kind = k.slice(0, i), id = k.slice(i + 1, j), path = k.slice(j + 1);
      const t = this.target(kind, id);
      if (t) this.poke(t, path, this.over[k]);
    }
  },
  resetOne(kind, id) {
    const b = this.baseOf(kind, id), t = this.target(kind, id);
    if (!b || !t) return;
    for (const k in this.over) if (k.indexOf(kind + '/' + id + '/') === 0) delete this.over[k];
    for (const f in b) if (f !== 'id') t[f] = JSON.parse(JSON.stringify(b[f]));
    Save.data.tuning = this.over; Save.save();
    if (Game.players) for (const p of Game.players) { try { p.recalc(); } catch (e) { } }
  },
  resetAll() {
    this.over = {};
    for (const kind of ['weapons', 'enemies', 'bosses'])
      for (const b of this.base[kind]) {
        const t = this.target(kind, b.id);
        if (t) for (const f in b) if (f !== 'id') t[f] = JSON.parse(JSON.stringify(b[f]));
      }
    Save.data.tuning = {}; Save.save();
    if (Game.players) for (const p of Game.players) { try { p.recalc(); } catch (e) { } }
  },
  changedCount(kind, id) {
    let n = 0;
    const pre = kind + '/' + id + '/';
    for (const k in this.over) if (k.indexOf(pre) === 0) n++;
    return n;
  },
  exportJson() { return JSON.stringify(this.over, null, 1); },
  importJson(txt) {
    let o;
    try { o = JSON.parse(txt); } catch (e) { return 'Kein gueltiges JSON'; }
    if (!o || typeof o !== 'object') return 'Kein gueltiges JSON';
    this.resetAll();
    this.over = o;
    this.applyAll();
    Save.data.tuning = this.over; Save.save();
    return null;
  }
};

/* ============================ 21c. ONLINE-KOOP (LAN + INTERNET) ============================
   Remote-Play statt State-Sync: Der HOST simuliert und rendert wie bisher allein und
   streamt Canvas-Bild + Spielton per WebRTC an den GAST; zurueck kommen nur dessen
   Eingaben. Beide teilen die vorhandene Koop-Kamera - es gibt hier also keine Desyncs.

   Verbindung (zwei Wege, gleiche Peer-Logik, Non-Trickle-ICE):
     Raumcode - SDP-Austausch ueber einen oeffentlichen MQTT-Broker; nur der Handshake
                laeuft darueber, danach direkt P2P. Im LAN bleibt alles lokal.
     Offline  - Host-Code und Antwort-Code von Hand austauschen, ganz ohne Internet.

   Kanaele: 'ctl' zuverlaessig (Menues, Aktionen, HUD, Ping) und 'input' unzuverlaessig
   mit 30 Hz (Achsen). Ohne TURN koennen sehr strikte NATs im Internet scheitern.
   ========================================================================================= */
const NET_ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
const NET_BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];
const NET_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   /* ohne I/O/0/1 - vorlesbar */
const NET_HZ = 30;
const NET_NO_P2P = 'Direktverbindung kam nicht zustande - vermutlich blockt eine Firewall oder ein strenges NAT. '
  + 'Im selben WLAN klappt es fast immer; sonst den Offline-Weg nutzen.';

/* --- Minimaler MQTT-3.1.1-Draht (nur was der Handshake braucht) --- */
const MqttWire = {
  enc(s) { return new TextEncoder().encode(s); },
  varint(n) {
    const out = [];
    do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 128; out.push(b); } while (n > 0);
    return out;
  },
  readVarint(b, i) {
    let mult = 1, val = 0, byte, used = 0;
    do {
      if (i + used >= b.length || used > 3) return null;
      byte = b[i + used]; used++;
      val += (byte & 127) * mult; mult *= 128;
    } while (byte & 128);
    return { val: val, next: i + used };
  },
  str(s) { const b = this.enc(s); return [(b.length >> 8) & 255, b.length & 255].concat(Array.from(b)); },
  packet(type, flags, body) { return new Uint8Array([(type << 4) | flags].concat(this.varint(body.length), body)); },
  connect(id) { return this.packet(1, 0, this.str('MQTT').concat([4, 2, 0, 60], this.str(id))); },
  subscribe(topic) { return this.packet(8, 2, [0, 1].concat(this.str(topic), [0])); },
  publish(topic, payload) { return this.packet(3, 0, this.str(topic).concat(Array.from(this.enc(payload)))); },
  ping() { return new Uint8Array([0xC0, 0x00]); },
  /* Zerlegt einen Bytestrom in vollstaendige Pakete; ein angeschnittenes bleibt als Rest. */
  parse(buf) {
    const msgs = []; let i = 0;
    while (i < buf.length) {
      const type = buf[i] >> 4;
      const rl = this.readVarint(buf, i + 1);
      if (!rl || rl.next + rl.val > buf.length) break;
      const body = buf.subarray(rl.next, rl.next + rl.val);
      if (type === 3) {
        const tl = (body[0] << 8) | body[1];
        msgs.push({ type: type, payload: new TextDecoder().decode(body.subarray(2 + tl)) });
      } else msgs.push({ type: type });
      i = rl.next + rl.val;
    }
    return { msgs: msgs, rest: buf.subarray(i) };
  }
};

const Net = {
  role: null,             /* null | 'host' | 'client' */
  phase: 'idle',          /* idle | signaling | connecting | connected | closed | error */
  code: null,
  pc: null, ctl: null, inp: null,
  ws: null, wsBuf: null, wsIdx: 0, myId: null, peerId: null,
  audioDest: null,
  remote: { mx: 0, my: 0, ax: 0, ay: 0, aim: 0, sk: 0, t: 0 },
  acts: {},
  ping: 0, lastRx: 0,
  _inpAcc: 0, _pingAcc: 0, _lastMenu: '', _wd: 0, _ka: 0,
  status: 'Nicht verbunden',

  isHost() { return this.role === 'host' && this.phase === 'connected'; },
  isGuest() { return this.role === 'client' && this.phase === 'connected'; },

  roomCode() {
    const a = crypto.getRandomValues(new Uint8Array(6));
    let s = '';
    for (let i = 0; i < 6; i++) s += NET_ALPHABET[a[i] % NET_ALPHABET.length];
    return s;
  },
  normCode(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); },

  /* ---------- Code fuer den Offline-Weg: deflate + base64 ---------- */
  b64(u8) { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s).replace(/=+$/, ''); },
  unb64(s) {
    const bin = atob(s + '==='.slice(0, (4 - s.length % 4) % 4));
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  },
  async pack(sdp) {
    const cs = new CompressionStream('deflate-raw');
    const w = cs.writable.getWriter(); w.write(new TextEncoder().encode(sdp)); w.close();
    return this.b64(new Uint8Array(await new Response(cs.readable).arrayBuffer()));
  },
  async unpack(code) {
    const ds = new DecompressionStream('deflate-raw');
    const w = ds.writable.getWriter(); w.write(this.unb64(String(code).trim().replace(/\s+/g, ''))); w.close();
    return new TextDecoder().decode(new Uint8Array(await new Response(ds.readable).arrayBuffer()));
  },

  /* Wachhund: bleibt eine Phase haengen, wird sie abgeraeumt und begruendet. */
  arm(sec, why) { clearTimeout(this._wd); this._wd = setTimeout(() => this.fail(why), sec * 1000); },
  fail(why) { this.reset(); this.role = null; this.setStatus(why, 'error'); AudioSys.sfx('err'); },
  /* Fehler aus asynchronen Schritten sichtbar machen statt still verschlucken. */
  run(p, what) { p.catch(e => { this.setStatus(what + ': ' + e.message, 'error'); AudioSys.sfx('err'); }); },
  setStatus(msg, phase) {
    this.status = msg;
    if (phase) this.phase = phase;
    UI.renderNet();
  },

  /* ---------- Peer ---------- */
  makePeer() {
    const pc = new RTCPeerConnection({ iceServers: NET_ICE });
    this.pc = pc;
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'connected') this.onOpen();
      else if (s === 'failed' || s === 'closed') this.onDrop(s === 'failed' ? 'Verbindung fehlgeschlagen' : 'Verbindung beendet');
      else if (s === 'disconnected') this.setStatus('Verbindung unterbrochen - warte ...');
    };
    pc.ontrack = ev => {
      const v = $('netVideo');
      if (v && ev.streams[0]) { v.srcObject = ev.streams[0]; v.play().catch(() => { }); }
    };
    pc.ondatachannel = ev => {
      if (ev.channel.label === 'ctl') this.bindCtl(ev.channel);
      else this.bindInp(ev.channel);
    };
    return pc;
  },
  bindCtl(ch) {
    this.ctl = ch;
    ch.onmessage = e => { this.lastRx = Date.now(); this.onCtl(JSON.parse(e.data)); };
    ch.onclose = () => this.onDrop('Datenkanal geschlossen');
  },
  bindInp(ch) {
    this.inp = ch;
    ch.onmessage = e => {
      this.lastRx = Date.now();
      const d = JSON.parse(e.data);
      /* Unordered: ein aelteres Paket darf ein neueres nicht ueberschreiben. */
      if (d.t > this.remote.t) {
        this.remote.mx = d.m[0]; this.remote.my = d.m[1];
        this.remote.ax = d.a[0]; this.remote.ay = d.a[1];
        this.remote.aim = d.h; this.remote.sk = d.s; this.remote.t = d.t;
      }
    };
  },
  /* Non-Trickle: erst wenn ICE fertig ist, ist das SDP vollstaendig - damit sind
     Raumcode-Weg und Offline-Weg exakt derselbe Codepfad. */
  waitIce(pc) {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise(res => {
      const done = () => { pc.removeEventListener('icegatheringstatechange', chk); clearTimeout(to); res(); };
      const chk = () => { if (pc.iceGatheringState === 'complete') done(); };
      const to = setTimeout(done, 6000);
      pc.addEventListener('icegatheringstatechange', chk);
    });
  },
  async makeOffer() {
    const pc = this.makePeer();
    this.bindCtl(pc.createDataChannel('ctl', { ordered: true }));
    this.bindInp(pc.createDataChannel('input', { ordered: false, maxRetransmits: 0 }));
    /* Bild + Ton anhaengen, bevor das Angebot entsteht. */
    AudioSys.init();
    const st = $('game').captureStream(NET_HZ);
    for (const tr of st.getTracks()) pc.addTrack(tr, st);
    if (AudioSys.ctx) {
      this.audioDest = AudioSys.ctx.createMediaStreamDestination();
      AudioSys.limiter.connect(this.audioDest);
      for (const tr of this.audioDest.stream.getAudioTracks()) pc.addTrack(tr, this.audioDest.stream);
    }
    await pc.setLocalDescription(await pc.createOffer());
    await this.waitIce(pc);
    return pc.localDescription.sdp;
  },
  async makeAnswer(sdp) {
    const pc = this.makePeer();
    await pc.setRemoteDescription({ type: 'offer', sdp: sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await this.waitIce(pc);
    return pc.localDescription.sdp;
  },

  /* ---------- Weg A: Raumcode ueber oeffentlichen Broker ---------- */
  /* Meldet sich an, abonniert und ruft onReady erst nach dem SUBACK: vorher ist das
     Abo beim Broker nicht aktiv und eine sofortige Antwort des Gegenuebers ginge
     verloren. Kommt der Broker nicht durch, uebernimmt der naechste; ein Keepalive
     haelt die Sitzung offen, waehrend der Host auf einen Mitspieler wartet. */
  brokerConnect(dir, onReady) {
    this.setStatus('Verbinde mit Vermittlung ... (' + (this.wsIdx + 1) + '/' + NET_BROKERS.length + ')', 'signaling');
    const ws = new WebSocket(NET_BROKERS[this.wsIdx], 'mqtt');
    ws.binaryType = 'arraybuffer';
    this.ws = ws; this.wsBuf = new Uint8Array(0);
    const to = setTimeout(() => ws.close(), 9000);
    ws.onopen = () => ws.send(MqttWire.connect('wbns' + this.myId));
    ws.onclose = () => {
      clearTimeout(to); clearInterval(this._ka);
      if (this.phase !== 'signaling') return;
      if (++this.wsIdx < NET_BROKERS.length) this.brokerConnect(dir, onReady);
      else this.fail('Keine Vermittlung erreichbar. Bei blockiertem WebSocket oder ohne Internet den Offline-Weg nutzen.');
    };
    ws.onmessage = ev => {
      const chunk = new Uint8Array(ev.data);
      const merged = new Uint8Array(this.wsBuf.length + chunk.length);
      merged.set(this.wsBuf); merged.set(chunk, this.wsBuf.length);
      const r = MqttWire.parse(merged);
      this.wsBuf = r.rest;
      for (const m of r.msgs) {
        if (m.type === 2) {
          ws.send(MqttWire.subscribe(this.topic(dir)));
          this._ka = setInterval(() => ws.send(MqttWire.ping()), 30000);
        } else if (m.type === 9) { clearTimeout(to); onReady(); }
        else if (m.type === 3) {
          /* Auf einem oeffentlichen Broker kann Fremdverkehr liegen - der darf die
             Vermittlung nicht abschiessen. */
          let s = null;
          try { s = JSON.parse(m.payload); } catch (e) { }
          if (s) this.run(this.onSignal(s), 'Verbindungsaufbau fehlgeschlagen');
        }
      }
    };
  },
  topic(dir) { return 'wbns/' + this.code + '/' + dir; },
  pub(dir, obj) { this.ws.send(MqttWire.publish(this.topic(dir), JSON.stringify(obj))); },

  hostRoom() {
    this.reset();
    this.role = 'host'; this.myId = Math.random().toString(36).slice(2, 8);
    this.code = this.roomCode(); this.wsIdx = 0;
    this.brokerConnect('c2h', () => {
      this.setStatus('Raum offen - Code an den Mitspieler geben.', 'signaling');
      this.arm(180, 'Es ist niemand beigetreten (3 Minuten). Raum neu oeffnen - oder den Offline-Weg nutzen.');
    });
  },
  joinRoom(code) {
    const c = this.normCode(code);
    if (c.length !== 6) { UI.toast('Bitte den 6-stelligen Raumcode eingeben'); return; }
    this.reset();
    this.role = 'client'; this.myId = Math.random().toString(36).slice(2, 8);
    this.code = c; this.wsIdx = 0;
    this.brokerConnect('h2c', () => {
      this.pub('c2h', { t: 'hello', id: this.myId });
      this.setStatus('Suche Raum ' + c + ' ...', 'signaling');
      this.arm(20, 'Raum ' + c + ' antwortet nicht. Code pruefen - oder der Host hat den Raum noch nicht geoeffnet.');
    });
  },
  async onSignal(m) {
    if (this.role === 'host') {
      if (m.t === 'hello' && !this.peerId) {
        this.peerId = m.id;
        this.setStatus('Mitspieler gefunden - baue Verbindung auf ...', 'connecting');
        this.arm(30, NET_NO_P2P);
        this.pub('h2c', { t: 'offer', to: m.id, sdp: await this.makeOffer() });
      } else if (m.t === 'answer' && m.from === this.peerId && !this.pc.currentRemoteDescription) {
        await this.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp });
      }
    } else if (m.t === 'offer' && m.to === this.myId && !this.pc) {
      this.setStatus('Angebot erhalten - antworte ...', 'connecting');
      this.arm(30, NET_NO_P2P);
      this.pub('c2h', { t: 'answer', from: this.myId, sdp: await this.makeAnswer(m.sdp) });
    }
  },

  /* ---------- Weg B: Offline / Code von Hand ---------- */
  async manualCreate() {
    this.reset();
    this.role = 'host';
    this.setStatus('Erzeuge Host-Code ...', 'connecting');
    $('netManualOut').value = await this.pack(await this.makeOffer());
    this.setStatus('Host-Code erzeugt - verschicken, dann die Antwort unten einfuegen.', 'signaling');
  },
  async manualJoin(code) {
    const sdp = await this.unpack(code);
    this.reset();
    this.role = 'client';
    this.setStatus('Erzeuge Antwort-Code ...', 'connecting');
    $('netManualOut').value = await this.pack(await this.makeAnswer(sdp));
    this.setStatus('Antwort-Code erzeugt - zurueck an den Host schicken.', 'connecting');
  },
  async manualAccept(code) {
    if (this.role !== 'host' || !this.pc) { UI.toast('Zuerst einen Host-Code erzeugen'); return; }
    await this.pc.setRemoteDescription({ type: 'answer', sdp: await this.unpack(code) });
    this.setStatus('Antwort angenommen - verbinde ...', 'connecting');
  },

  /* ---------- Auf-/Abbau ---------- */
  onOpen() {
    if (this.phase === 'connected') return;
    this.phase = 'connected';
    clearTimeout(this._wd);
    if (this.ws) { this.ws.close(); this.ws = null; }
    this.lastRx = Date.now();
    this.setStatus('Verbunden' + (this.role === 'host' ? ' - Mitspieler ist Spieler 2.' : ' - du bist Spieler 2.'));
    AudioSys.sfx('level');
    if (this.role === 'host') {
      Game.coop = true;
      UI.toast('Online-Koop verbunden - Mitspieler steuert Spieler 2');
      this.syncMenu(true);
    } else {
      UI.hideAll();
      $('hud').classList.add('hidden');
      $('netStage').classList.remove('hidden');
      Game.state = 'net';
      UI.toast('Verbunden - du spielst Spieler 2');
    }
  },
  onDrop(why) {
    /* Eigenes Abraeumen setzt phase vorher auf idle - das ist kein Abbruch. */
    if (this.phase === 'idle' || this.phase === 'closed' || this.phase === 'error') return;
    if (this.phase !== 'connected') { this.fail(why + ' - ' + NET_NO_P2P); return; }
    this.phase = 'closed';
    this.setStatus(why + ' - erneut verbinden moeglich.');
    if (this.role === 'host') {
      if (Game.state === 'play') { Game.state = 'paused'; UI.navIdx = 0; UI.show('scPause'); }
      UI.toast('Mitspieler getrennt - Spiel pausiert');
    } else {
      UI.toast('Verbindung zum Host verloren');
      this.toMenu();
    }
  },
  reset() {
    this.phase = 'idle';   /* zuerst: sonst gilt unser eigenes close() als Verbindungsabbruch */
    clearTimeout(this._wd); clearInterval(this._ka);
    if (this.pc) this.pc.close();
    if (this.audioDest) AudioSys.limiter.disconnect(this.audioDest);
    if (this.ws) { this.ws.close(); this.ws = null; }
    this.pc = null; this.ctl = null; this.inp = null; this.peerId = null; this.audioDest = null;
    this.acts = {}; this.remote = { mx: 0, my: 0, ax: 0, ay: 0, aim: 0, sk: 0, t: 0 };
    this._lastMenu = ''; this.ping = 0;
  },
  hangUp() {
    const wasGuest = this.role === 'client';
    this.reset();
    this.role = null;
    if (wasGuest) this.toMenu();
    this.setStatus('Nicht verbunden', 'idle');
  },
  /* Gast zurueck aus der Video-Buehne ins Menue */
  toMenu() {
    $('netStage').classList.add('hidden');
    $('netVideo').srcObject = null;
    Game.state = 'title';
    UI.renderTitle(); UI.show('scTitle');
  },

  send(obj, viaInput) {
    const ch = viaInput ? this.inp : this.ctl;
    if (!ch || ch.readyState !== 'open') return false;
    ch.send(JSON.stringify(obj));
    return true;
  },
  act(name) { this.send({ t: 'act', a: name }); },
  takeAct(name) { if (this.acts[name]) { this.acts[name] = 0; return true; } return false; },

  onCtl(m) {
    if (m.t === 'act') { this.acts[m.a] = 1; if (m.a === 'pause') this.hostPause(); }
    else if (m.t === 'pick') this.applyPick(m.id);
    else if (m.t === 'ping') this.send({ t: 'pong', s: m.s });
    else if (m.t === 'pong') this.ping = Math.max(0, Date.now() - m.s);
    else if (m.t === 'menu') UI.renderNetMenu(m);
    else if (m.t === 'hud') UI.renderNetHud(m);
    else if (m.t === 'toast') UI.toast(m.m);
  },
  hostPause() {
    if (Game.state === 'play') { Game.state = 'paused'; UI.navIdx = 0; UI.show('scPause'); AudioSys.sfx('ui'); }
    else if (Game.state === 'paused' && UI.cur === 'scPause') { Game.state = 'play'; UI.show(null); $('hud').classList.remove('hidden'); }
  },

  tick(dt) {
    if (this.phase !== 'connected') return;
    this._pingAcc += dt;
    if (this._pingAcc > 1) {
      this._pingAcc = 0;
      this.send({ t: 'ping', s: Date.now() });
      /* HUD auch ausserhalb von 'play' frisch halten (Shop, Pause, Level-Up). */
      if (this.role === 'host') this.send(this.hudSnapshot());
    }
    if (this.role === 'client') {
      this._inpAcc += dt;
      if (this._inpAcc >= 1 / NET_HZ) {
        this._inpAcc = 0;
        const mv = Input.moveVec(0), av = Input.aimVec(0);
        this.send({
          m: [+mv.x.toFixed(3), +mv.y.toFixed(3)],
          a: [+av.x.toFixed(3), +av.y.toFixed(3)],
          h: av.has ? 1 : 0, s: Input.skillDown(0) ? 1 : 0, t: Date.now()
        }, true);
      }
    } else if (Date.now() - this.lastRx > 900) {
      /* Achsen altern aus, falls der Gast verstummt - sonst laeuft P2 endlos weiter. */
      this.remote.mx = 0; this.remote.my = 0; this.remote.aim = 0; this.remote.sk = 0;
    }
  },
  /* Gast-Tasten werden nur als Ereignisse verschickt, nie lokal simuliert. */
  clientInput() {
    const P = Input.pressed;
    if (P[Input.key('dash')] || Input.padPressed(0, 4)) this.act('dash');
    if (P[Input.key('jump')] || Input.padPressed(0, 11)) this.act('jump');
    if (P[Input.key('rune')] || Input.padPressed(0, 7)) this.act('rune');
    if (P[Input.key('pause')] || Input.padPressed(0, 9) || Input.touch.pause) this.act('pause');
  },

  /* ---------- Menue-Spiegelung (Host -> Gast) ----------
     DOM-Bildschirme liegen nicht im Canvas-Stream. Der Gast bekommt daher eine reine
     Beschreibung (Karten + Knoepfe mit IDs) und schickt nur die geklickte ID zurueck -
     kein State-Duplikat, der Host bleibt die einzige Wahrheit. */
  buildMenu() {
    const G = Game, p2 = G.players[1];
    if (UI.cur === 'scChar' && G.charSelIdx === 1) {
      return {
        t: 'menu', title: 'Spieler 2 - Charakter', sub: 'Waehle deinen Helden. Der Host startet die Runde.',
        items: CHARS.filter(c => Save.data.unlockedChars.includes(c.id) || !c.unlock).map(c => ({
          id: 'char:' + c.id, label: c.name, sub: c.role, desc: c.desc, col: c.col, on: G.sel[1] === c.id
        }))
      };
    }
    if (G.state === 'levelup') {
      const p = G.levelQueue[0];
      if (!p || p.index !== 1) return { t: 'menu', title: 'Spieler 1 waehlt ...', sub: 'Gleich geht es weiter.', items: [] };
      return {
        t: 'menu', title: 'Stufe ' + p.level, sub: p.char.name + ' - waehle eine Verbesserung',
        items: (G._curChoices || []).map((c, i) => ({
          id: 'lvl:' + i, label: c.name,
          sub: c.kind ? (c.kind === 'wup' ? 'Waffe verbessern' : c.kind === 'wnew' ? 'Neue Waffe' : 'Fundstueck') : (sign(c.val) + (STAT_UNIT[c.stat] || '')),
          desc: c.d, col: ['#dbe6ff', '#5dff9b', '#39e6ff'][c.tier]
        }))
      };
    }
    if (G.state === 'relic') {
      const p = G.relicQueue && G.relicQueue[0];
      if (!p || p.index !== 1) return { t: 'menu', title: 'Spieler 1 waehlt ein Relikt ...', sub: '', items: [] };
      return {
        t: 'menu', title: 'Relikt waehlen', sub: p.char.name + ' - gilt fuer den Rest des Runs',
        items: (G._curRelics || []).map(r => ({ id: 'relic:' + r.id, label: r.name, sub: 'Relikt', desc: r.fl, col: r.col })),
        acts: [{ id: 'relicSkip', label: 'Ueberspringen' }]
      };
    }
    if (G.state === 'shop' && p2) {
      const acts = [{ id: 'reroll', label: 'Neuwurf (' + ShopSystem.rerollCost(G.wave) + ' MAT)' }];
      p2.weapons.forEach((w, i) => acts.push({ id: 'sell:' + i, label: 'verkaufen: ' + WEAPON_BY_ID[w.id].name + ' T' + (w.tier + 1) }));
      acts.push({ id: 'next', label: 'Bereit - naechste Welle' });
      return {
        t: 'menu', title: 'Shop - Welle ' + G.wave,
        sub: 'Material: ' + G.materials + ' - deine Waffen: ' + p2.weapons.length + '/' + BROTATO_RULES.maxWeapons,
        items: ShopSystem.offers.map((o, i) => {
          let label, sub, desc, col = '#dbe6ff';
          if (o.kind === 'weapon') { const d = WEAPON_BY_ID[o.id]; label = d.name; sub = RARITY_NAME[o.tier] + ' - T' + (o.tier + 1); desc = d.special; col = d.col; }
          else if (o.kind === 'attach') { const a = ATT_BY_ID[o.id]; label = a.icon + ' ' + a.name; sub = 'Waffen-Aufsatz'; desc = a.desc; col = a.col; }
          else if (o.kind === 'relic') { const r = RELIC_BY_ID[o.id]; label = r.name; sub = 'Relikt'; desc = r.fl; col = '#ffd75e'; }
          else { const it = ITEM_BY_ID[o.id]; label = it.name; sub = RARITY_NAME[it.r - 1]; desc = it.fl; }
          return {
            id: 'buy:' + i, label: label, sub: sub + ' - ' + o.price + ' MAT', desc: desc, col: col,
            dis: !!ShopSystem.bought[i] || G.materials < o.price
          };
        }),
        acts: acts
      };
    }
    return { t: 'menu', title: '', items: [] };
  },
  syncMenu(force) {
    if (this.role !== 'host' || this.phase !== 'connected') return;
    const m = this.buildMenu();
    const key = JSON.stringify(m);
    if (!force && key === this._lastMenu) return;
    /* Erst merken, wenn es wirklich rausging - sonst verschluckt der Cache ein
       Menue, das beim noch nicht offenen Kanal verlorenging. */
    if (this.send(m)) this._lastMenu = key;
  },
  applyPick(id) {
    const G = Game, p2 = G.players[1];
    const cut = String(id).split(':'), k = cut[0], v = cut[1];
    if (k === 'char') {
      if (!CHARS.some(c => c.id === v)) return;
      G.sel[1] = v; AudioSys.sfx('ok'); UI.renderChars(1);
      return;
    }
    if (k === 'lvl') {
      const p = G.levelQueue[0], c = (G._curChoices || [])[+v];
      if (p && p.index === 1 && c) G.chooseUpgrade(p, c);
      return;
    }
    if (k === 'relic' || k === 'relicSkip') {
      const p = G.relicQueue && G.relicQueue[0];
      if (p && p.index === 1) { if (k === 'relic') G.chooseRelic(p, v); else G.skipRelic(); }
      return;
    }
    if (G.state !== 'shop' || !p2) return;
    if (k === 'buy') ShopSystem.buy(+v, p2);
    else if (k === 'sell') { if (p2.weapons[+v]) { G.materials += p2.sellWeapon(+v); AudioSys.sfx('buy'); UI.renderShop(); } }
    else if (k === 'reroll') ShopSystem.reroll(G.wave, G.players);
    else if (k === 'next') { G.startWave(G.wave + 1); return; }
    this.syncMenu(true);
  },
  hudSnapshot() {
    const box = p => p ? { n: p.char.name, hp: Math.round(p.hp), mx: Math.round(p.maxHp), a: p.alive ? 1 : 0 } : null;
    return {
      t: 'hud', w: Game.wave, mat: Game.materials,
      en: Game.enemies ? Game.enemies.filter(e => !e.dead).length : 0,
      p1: box(Game.players[0]), p2: box(Game.players[1])
    };
  }
};

/* ============================ 21b. SELFTEST (?selftest) ============================
   Läuft mit URL-Parameter ?selftest: prüft reine Funktionen und Seams
   (RNG-Determinismus, Save-Roundtrip, Combat, Data, Netz, Perf-Guard)
   und zeigt PASS/FAIL in einem Dev-Panel. Kein Build, kein Test-Runner nötig.
   ============================================================================ */
const SelfTest = {
  results: [],
  _ok(cond, name) { this.results.push({ ok: !!cond, name }); },
  run() {
    this.results = [];
    try { this._rng(); } catch (e) { this._ok(false, 'RNG-Determinismus (Fehler: ' + e.message + ')'); }
    try { this._save(); } catch (e) { this._ok(false, 'Save-Roundtrip (Fehler: ' + e.message + ')'); }
    try { this._perf(); } catch (e) { this._ok(false, 'Perf-Guard (Fehler: ' + e.message + ')'); }
    try { this._combat(); } catch (e) { this._ok(false, 'Combat (Fehler: ' + e.message + ')'); }
    try { this._playerDamage(); } catch (e) { this._ok(false, 'PlayerDamage (Fehler: ' + e.message + ')'); }
    try { this._data(); } catch (e) { this._ok(false, 'Data (Fehler: ' + e.message + ')'); }
    try { this._runtimeContracts(); } catch (e) { this._ok(false, 'RuntimeContracts (Fehler: ' + e.message + ')'); }
    try { this._reflect(); } catch (e) { this._ok(false, 'Reflect (Fehler: ' + e.message + ')'); }
    try { this._elementDps(); } catch (e) { this._ok(false, 'ElementDps (Fehler: ' + e.message + ')'); }
    try { this._systemLoop(); } catch (e) { this._ok(false, 'SystemLoop (Fehler: ' + e.message + ')'); }
    try { this._extendedSystems(); } catch (e) { this._ok(false, 'ExtendedSystems (Fehler: ' + e.message + ')'); }
    try { this._audioBudget(); } catch (e) { this._ok(false, 'AudioBudget (Fehler: ' + e.message + ')'); }
    try { this._longRunContracts(); } catch (e) { this._ok(false, 'LongRun (Fehler: ' + e.message + ')'); }
    try { this._qualityContracts(); } catch (e) { this._ok(false, 'QualityContracts (Fehler: ' + e.message + ')'); }
    try { this._characterContracts(); } catch (e) { this._ok(false, 'CharacterContracts (Fehler: ' + e.message + ')'); }
    try { this._brotatoContracts(); } catch (e) { this._ok(false, 'BrotatoContracts (Fehler: ' + e.message + ')'); }
    try { this._net(); } catch (e) { this._ok(false, 'Net (Fehler: ' + e.message + ')'); }
    this._render();
  },
  _rng() {
    const a = new RNG(12345), b = new RNG(12345);
    let same = true;
    for (let i = 0; i < 100; i++) if (a.next() !== b.next()) same = false;
    this._ok(same, 'RNG-Determinismus: gleicher Seed → 100 identische Werte');
    const c = new RNG(999);
    this._ok(c.next() !== new RNG(12345).next(), 'RNG: verschiedene Seeds → verschiedene Werte');
  },
  _save() {
    const key = '__selftest__';
    Save.data[key] = { a: 1, b: 'x' };
    Save.save();
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    const back = raw ? (raw.data ? raw.data[key] : raw[key]) : null;
    this._ok(!!(back && back.a === 1 && back.b === 'x'), 'Save-Roundtrip: Wert übersteht save()/localStorage');
    delete Save.data[key];
    Save.save();
  },
  /* Perf-Guard: Glow-Rendering darf nicht in die teuren Pfade zurückfallen.
     Qualität 1 / FPS-Schutz müssen OHNE Schatten-Rendering zeichnen (2-Layer-
     Halo), volle Qualität nutzt Schatten-Glow mit minimalem State-Wechsel. */
  _perf() {
    const cv = document.createElement('canvas');
    const c2 = cv.getContext('2d');
    if (!c2 || typeof c2.fillRect !== 'function') { this._ok(true, 'Perf-Guard: Canvas nicht verfügbar (übersprungen)'); return; }
    let shadowed = 0, shadowSets = 0, _sb = 0, saves = 0;
    const wrap = (orig) => function () { if (_sb > 0) shadowed++; return orig.apply(this, arguments); };
    c2.fillRect = wrap(c2.fillRect); c2.fill = wrap(c2.fill); c2.strokeRect = wrap(c2.strokeRect);
    c2.save = () => { saves++; }; c2.restore = () => { saves++; };
    Object.defineProperty(c2, 'shadowBlur', {
      get() { return _sb; }, set(v) { if (_sb !== v) shadowSets++; _sb = v; }, configurable: true,
    });
    const oldCtx = Game.ctx, oldQ = Save.data.opts.quality, oldAutoQ = Game.autoQ;
    const spark20 = () => { FX.clear(); for (let i = 0; i < 20; i++) FX.particle(0, 0, i, 30, '#ff7a3d', .5, 2, { shape: 'pixel', glow: 1 }); };
    Game.ctx = c2; Save.data.opts.quality = 1; Game.autoQ = 1;
    spark20(); FX.draw(c2);
    this._ok(shadowed === 0, 'Perf-Guard: Qualität 1 rendert Glow ohne Schatten (' + shadowed + ' shadowed fills)');
    this._ok(saves < 5, 'Perf-Guard: unrotierte Partikel ohne Matrix-Save (' + saves + ' save/restore)');
    shadowed = 0; shadowSets = 0; _sb = 0;
    Save.data.opts.quality = 2; Game.autoQ = 1;
    spark20(); FX.draw(c2);
    this._ok(shadowed > 0 && shadowSets < 20, 'Perf-Guard: Qualität 2 nutzt Schatten-Glow mit minimalem State-Wechsel (' + shadowed + ' shadowed, ' + shadowSets + ' Sets)');
    Game.ctx = oldCtx; Save.data.opts.quality = oldQ; Game.autoQ = oldAutoQ;
  },
  _combat() {
    /* Combat-Modul: purer Kern ohne Welt/FX/Audio — Regeln deterministisch */
    Combat.setWorld(Game);
    this._ok(Math.abs(Combat.mitigation(18, 0, 0, 0, 100) - 50) < 1e-9, 'Combat: Ruestung 18 halbiert Schaden (18/(18+18))');
    this._ok(Math.abs(Combat.mitigation(0, 0, 0, 1, 100) - 135) < 1e-9, 'Combat: Marked x1.35');
    this._ok(Combat.mitigation(99999, 0, 0, 0, 1) === 1, 'Combat: Mindestschaden 1');
    const tgt = { hp: 100, maxHp: 100, armor: 18, armorBuff: 0, marked: 0, boss: false, coreOpen: false, dead: false, def: {}, target: null, x: 0, y: 0 };
    const r = Combat.resolveHit({ tgt, dmg: 100, isCrit: false, src: { x: 0, y: 0 }, type: 'elem' });
    this._ok(Math.abs(r.dmg - 50) < 1e-9 && !r.died && Math.abs(r.tier - .5) < 1e-9, 'Combat: resolveHit Ruestung/Tier korrekt (50 Schaden toetet 100 HP nicht)');
    const r3 = Combat.resolveHit({ tgt: { hp: 30, maxHp: 100, armor: 0, armorBuff: 0, marked: 0, boss: false, coreOpen: false, dead: false, def: {}, target: null }, dmg: 100, isCrit: false, src: { x: 0, y: 0 }, type: 'elem' });
    this._ok(r3.died === true, 'Combat: resolveHit erkennt Tod (30 HP - 100 Schaden)');
    const r2 = Combat.resolveHit({ tgt: { hp: 100, maxHp: 100, armor: 0, armorBuff: 0, marked: 0, boss: true, coreOpen: true, dead: false, def: {}, target: null }, dmg: 10, isCrit: false, src: { x: 1, y: 1 }, type: 'boom' });
    this._ok(r2.crit && Math.abs(r2.dmg - 30) < 1e-9, 'Combat: offener Bosskern x3 zaehlt als Krit');
    /* Reaktion: Kettenblitz trifft Gegner im Radius, nicht weiter entfernte */
    const near = [
      { x: 0, y: 0, dead: false },
      { x: 30, y: 0, dead: false },
      { x: 60, y: 0, dead: false },
      { x: 500, y: 500, dead: false }
    ];
    const chainW = { hash: { query: (x, y, r) => near.filter(t => Math.hypot(t.x - x, t.y - y) < r) } };
    const oldW = Combat.W;
    Combat.setWorld(chainW);
    const R = Combat.resolveReaction('chain', near[0], 100, {});
    this._ok(R.list.length === 3 && R.list.every(h => Math.abs(h.dmg - 32) < 1e-9), 'Combat: Kettenblitz 3 Spruenge a 32 %, ferner Gegner unberuehrt');
    /* BalanceSim konsumiert Combat: Hits-Schaetzung delegiert */
    const hpA = BalanceSim.hitsPerAttack({ type: 'projectile' }, { pellets: 2 });
    const hpB = Combat.hitsPerAttack({ type: 'projectile' }, { pellets: 2 });
    this._ok(hpA === hpB && hpA === 2, 'Combat: BalanceSim.hitsPerAttack delegiert an Combat (2 Pellets = 2)');
    /* Status-Tick: Burn-Mathe deterministisch */
    const e = { burn: 10, burnT: 1, poison: 0, poisonT: 0, hp: 100, x: 0, y: 0, r: 5, col: '#fff', die: () => {} };
    Combat.setWorld({ modIs: () => false, players: [{}] });
    Combat.tickStatus(e, .5);
    this._ok(Math.abs(e.hp - 95) < 1e-9 && Math.abs(e.burnT - .5) < 1e-9, 'Combat: tickStatus Burn 10 DPS x 0.5 s = 5 Schaden');
    Combat.setWorld(oldW || Game);
  },
  _playerDamage() {
    /* Spieler-Treffer-Mathe: handgerechnete Literale (15/(15+armor), Negativ-Armor, Min-1, wagerFragile, Dodge-Cap) */
    Combat.setWorld(Game);
    const mk = (hp, armor, dodge, fragile) => ({ hp, maxHp: 100, st: { armor, dodge }, wagerFragile: fragile });
    const r1 = Combat.resolvePlayerHit({ p: mk(100, 15, 0, false), v: 100, rng: () => .99 });
    this._ok(!r1.dodged && Math.abs(r1.dmg - 50) < 1e-9 && !r1.died, 'Combat: Spieler-Ruestung 15 halbiert Schaden (15/(15+15)=0.5)');
    const r2 = Combat.resolvePlayerHit({ p: mk(100, 0, 0, false), v: 100, rng: () => .99 });
    this._ok(Math.abs(r2.dmg - 100) < 1e-9, 'Combat: Spieler ohne Ruestung erhaelt vollen Schaden');
    const r3 = Combat.resolvePlayerHit({ p: mk(100, -10, 0, false), v: 100, rng: () => .99 });
    this._ok(Math.abs(r3.dmg - 160) < 1e-9, 'Combat: Negativ-Ruestung -10 verstaerkt auf 1.6x (100*1.6=160)');
    const r4 = Combat.resolvePlayerHit({ p: mk(100, 0, 0, false), v: .05, rng: () => .99 });
    this._ok(Math.abs(r4.dmg - 1) < 1e-9, 'Combat: Mindestschaden 1 beim Spieler');
    const r5 = Combat.resolvePlayerHit({ p: mk(100, 0, 0, true), v: 100, rng: () => .99 });
    this._ok(Math.abs(r5.dmg - 200) < 1e-9, 'Combat: wagerFragile verdoppelt Schaden (100*2=200)');
    const r6 = Combat.resolvePlayerHit({ p: mk(30, 0, 0, false), v: 100, rng: () => .99 });
    this._ok(r6.died === true && Math.abs(r6.dmg - 100) < 1e-9, 'Combat: resolvePlayerHit erkennt Tod (30 HP - 100 Schaden)');
    const r7 = Combat.resolvePlayerHit({ p: mk(100, 0, 40, false), v: 100, rng: () => 0 });
    this._ok(r7.dodged === true && r7.dmg === 0, 'Combat: Dodge 40 mit rng 0 weicht aus (0 Schaden)');
    const r8 = Combat.resolvePlayerHit({ p: mk(100, 0, 40, false), v: 100, rng: () => .99 });
    this._ok(r8.dodged === false, 'Combat: Dodge 40 mit rng .99 trifft');
    const r9 = Combat.resolvePlayerHit({ p: mk(100, 0, 100, false), v: 10, rng: () => .6 });
    this._ok(r9.dodged === false, 'Combat: Dodge-Cap 60 — rng exakt 0.6 trifft (60 < 60 ist falsch)');
  },
  _data() {
    /* Data-Modul: Schema-Validierung ueber alle Spiel-Tabellen + Index */
    const errs = Data.validate();
    this._ok(errs.length === 0, 'Data: validate() liefert 0 Fehler (' + errs.length + (errs.length ? ': ' + errs.slice(0, 3).join('; ') : '') + ')');
    /* Modul-Einheit: register baut byId, validate faengt doppelte id und hp<=0 */
    const fake = Data.register('_test_fake', [{ id: 'a', hp: 10 }, { id: 'a', hp: -5 }, { id: 'b', hp: 0 }], { id: 'id', hp: 'num>0' });
    const ferr = Data.validate().filter(e => e.indexOf('_test_fake') === 0);
    this._ok(!!fake.byId.a && !!fake.byId.b && !fake.byId.c, 'Data: register baut byId-Index');
    this._ok(ferr.some(e => e.indexOf('doppelte id') >= 0) && ferr.some(e => e.indexOf('.hp') >= 0), 'Data: validate faengt doppelte id und hp<=0');
    delete Data._tables['_test_fake'];
    this._ok(WEAPONS.length > 0 && ENEMIES.length > 0 && CHARS.length > 0 && ATTACHMENTS.length > 0, 'Data: Kerntabellen nicht leer');
  },
  _runtimeContracts() {
    /* TDD-RED: Runtime-Buffs duerfen nur bekannte Stats schreiben. */
    const oldBanner = UI.banner, oldSfx = AudioSys.sfx;
    UI.banner = () => {}; AudioSys.sfx = () => {};
    const seen = [];
    const p = { addBuff: (stat, val, t) => seen.push({ stat, val, t }) };
    applyRuneEffect(p, RUNE_BY_ID.sturm);
    UI.banner = oldBanner; AudioSys.sfx = oldSfx;
    this._ok(seen.length === 3 && seen.every(b => STAT_KEYS.includes(b.stat)), 'Runtime: RUNEN-STURM schreibt nur bekannte Stats');
    this._ok(seen.some(b => b.stat === 'dmgP' && b.val === 20), 'Runtime: RUNEN-STURM gibt +20% Schaden ueber dmgP');
    /* TDD-RED: Auch die bisher losen Tabellen muessen zentral registriert sein. */
    const loose = ['groundTextures', 'groundTexturesArena', 'weaponSfx', 'quotes', 'classBonus', 'statDefinitions'];
    this._ok(loose.every(name => Data._tables[name]), 'Data: lose Tabellen zentral registriert (' + loose.join(', ') + ')');
    this._ok(Data.validate().length === 0, 'Data: lose Tabellen ohne Validierungsfehler');
  },
  _reflect() {
    /* Reflect-Pfad: Spiegelnder Elite (resolveMirror) + Dornen (stachel-Item) */
    Combat.setWorld(Game);
    const mkHit = (o) => ({ src: { x: 50, y: 100, damage: () => {} }, tgt: { eliteTrait: 'spiegelnd', x: 100, y: 100 }, dmg: 100, isCrit: false, type: 'projectile', ...o });
    /* Pure: resolveMirror — hier noch NICHT implementiert -> Rot */
    const r1 = Combat.resolveMirror(mkHit({}), () => 0.1);
    this._ok(r1.reflected && Math.abs(r1.reflectedDmg - 12) < 1e-9, 'Combat: resolveMirror reflektiert 12% bei rng 0.1');
    const r2 = Combat.resolveMirror(mkHit({}), () => 0.5);
    this._ok(!r2.reflected, 'Combat: resolveMirror kein Reflect bei rng 0.5');
    const r3 = Combat.resolveMirror(mkHit({type: 'thorns'}), () => 0.1);
    this._ok(!r3.reflected, 'Combat: resolveMirror kein Reflect bei type=thorns');
    const r4 = Combat.resolveMirror(mkHit({tgt: {eliteTrait: 'panzer', x: 100, y: 100}}), () => 0.1);
    this._ok(!r4.reflected, 'Combat: resolveMirror kein Reflect bei Elite-Trait panzer');
    const r5 = Combat.resolveMirror(mkHit({src: {x: 50, y: 100}}), () => 0.1);
    this._ok(!r5.reflected, 'Combat: resolveMirror kein Reflect ohne damage()');
    /* Full path: Spiegelnder Elite nimmt Schaden, reflektiert auf Spieler */
    Game.hash = new SpatialHash(110); Game.run = { kills: 0, track: {}, dmg: 0 }; Game.state = 'play';
    const oldMA = Game.modActive; Game.modActive = () => false;
    const oldShake = Game.shakeAt; Game.shakeAt = () => {};
    Input.padMap = []; Input.rumble = () => {};
    const p = new Player(0, 'sunny'); p.maxHp = 100; p.hp = 100; p.st.armor = 0; p.st.dodge = 0; p.invuln = 0;
    const e = new Enemy(); e.spawn(ENEMY_BY_ID.elite, 100, 100, 1, null); e.eliteTrait = 'spiegelnd';
    const hpP = p.hp, hpE = e.hp;
    const origR = Math.random; Math.random = () => 0.1;
    Combat.applyHit({ tgt: e, dmg: 50, isCrit: false, src: p, type: 'projectile' });
    Math.random = origR;
    this._ok(hpE - e.hp >= 20, 'Combat: Spiegelnder Elite nimmt Schaden (Ruestung 12, erwartet ~30)');
    this._ok(hpP - p.hp > 0, 'Combat: Spiegelnder Elite reflektiert Schaden auf Spieler');
    /* Thorns: Spieler mit Stachelpanzer, Gegner in Reichweite */
    const p2 = new Player(0, 'sylvia'); p2.maxHp = 100; p2.hp = 100; p2.st.armor = 0; p2.st.dodge = 0; p2.invuln = 0;
    p2.items = ['stachel']; p2.x = 0; p2.y = 0;
    Game.hash.clear();
    const e2 = new Enemy(); e2.spawn(ENEMY_BY_ID.runner, 30, 30, 1, null);
    Game.hash.insert(e2);
    const hpE2 = e2.hp;
    Combat.applyPlayerHit({ p: p2, v: 30, srcAngle: 0 });
    this._ok(hpE2 - e2.hp >= 5, 'Combat: Stachelpanzer reflektiert Schaden auf Gegner');
    Game.modActive = oldMA; Game.shakeAt = oldShake;
  },
  _elementDps() {
    /* Element-/Reaktions-DPS aus den ECHTEN Combat-Regeln statt Hits-Multiplikatoren.
       Die Funktionen chainFactor/boomFactor/burnDps/chainReact existieren hier NOCH
       NICHT -> Rot. Erwartungen handgerechnet aus den echten Regeln:
       - Waffen-Kette (chain-Typ): d *= .88 je Sprung -> geometrische Reihe
       - Reaktions-Kette (Klingel): applyElement('shock', dd*.3) -> 3 Ziele à .32 -> .288
       - Explosion (detonate): dmg * .9 * falloff, E[falloff] ≈ .58, Dichte 4 -> 2.09
       - Burn (applyBurn s,3): s = burn*(1+elem/100) DPS je brennendem Ziel */
    const phaseA = Combat.phaseIndex(64, 100, [{ at: 1 }, { at: .65 }, { at: .3 }]);
    const phaseB = Combat.phaseIndex(29, 100, [{ at: 1 }, { at: .65 }, { at: .3 }]);
    this._ok(phaseA === 1 && phaseB === 2, 'Combat: Boss-Phase wird aus HP-Schwellen deterministisch gewaehlt');
    const cf3 = Combat.chainFactor({ chain: 3 });
    this._ok(Math.abs(cf3 - 2.6544) < 1e-3, 'Combat: chainFactor(3) = 1+.88+.88² = 2.6544 (Waffen-Kette)');
    const cf5 = Combat.chainFactor({ chain: 5 });
    this._ok(Math.abs(cf5 - 3.9356) < 1e-3, 'Combat: chainFactor(5) = geometrische Reihe .88 = 3.9356');
    const bf = Combat.boomFactor({ boom: 60 });
    this._ok(Math.abs(bf - 2.044) < .02, 'Combat: boomFactor = 1 + .9*.58*2 = 2.044 (Explosion aus detonate-Regeln)');
    const bd = Combat.burnDps({ burn: 10 }, { elem: 50 }, 2);
    this._ok(Math.abs(bd - 30) < 1e-9, 'Combat: burnDps = burn*(1+elem/100)*Ziele = 10*1.5*2 = 30');
    const cr = Combat.chainReact();
    this._ok(Math.abs(cr - .288) < 1e-9, 'Combat: chainReact = .3(shock)*.32(chain)*3 Ziele = .288 (Klingel)');
    this._ok(Combat.hitsPerAttack({ type: 'chain' }, { chain: 4 }) === 1, 'Combat: hitsPerAttack chain = 1 (Kette kommt aus chainFactor)');
    this._ok(Combat.hitsPerAttack({ type: 'projectile' }, { boom: 60 }) === 1, 'Combat: hitsPerAttack projectile ohne boom-Multiplikator = 1');
    /* BalanceSim delegiert weiterhin, aber die Konstanten kommen aus Combat */
    this._ok(Math.abs(BalanceSim.hitsPerAttack({ type: 'chain' }, { chain: 5 }) - 1) < 1e-9, 'BalanceSim: hitsPerAttack delegiert chainFactor-Basis an Combat');
    /* Korridor-Messung muss PFADUNABHAENGIG sein: eine Aenderung an Waffe A
       (z.B. RNG-Verbrauch der boom-Logik) darf Waffe B nicht verschieben.
       weaponSeed liefert je Waffe einen stabilen, isolierten Seed. */
    const s1 = BalanceSim.weaponSeed('nagler'), s2 = BalanceSim.weaponSeed('nagler');
    this._ok(s1 === s2 && s1 !== BalanceSim.weaponSeed('plasma'), 'BalanceSim: weaponSeed stabil je Waffe, verschieden zwischen Waffen');
  },
  _systemLoop() {
    /* Systemtest: treibt die ECHTE Game.update-Loop ueber viele Frames mit
       vollem Setup (Level, Player mit Waffe, gespawnte Gegner) und assertiert,
       dass Schaden, Reaktionen, Status-Ticks und Tode im Zusammenspiel korrekt
       fliessen — kein Crash, Zahlen konsistent. */
    Combat.setWorld(Game); /* wie Game.init() — applyHit/tickStatus lesen W */
    const D0 = Game.danger; const M0 = Game.mods;
    Game.danger = 1; Game.mods = [];
    /* HUD-Rendering braucht echtes DOM (Node-Harness hat keins) — die Loop-Logik
       (Schaden/Reaktionen/Status/Tode) ist davon unabhaengig. Abklemmen und
       am Ende (auch bei Fehler) wiederherstellen. */
    const oldRenderHud = UI.renderHud; UI.renderHud = () => {};
    Game.state = 'play'; Game.time = 0; Game.timeScale = 1; Game.hitstop = 0;
    Game.speedMul = 1; Game.speedBase = 1; Game.combo = 0; Game.comboT = 0;
    Game.wave = 1; Game.waveDuration = 1000; Game.waveTimer = 1000;
    Game.bossAlive = false; Game.bossIntro = 0; Game._curBoss = null; Game._tutI = null;
    Game.sepToggle = false; Game.hudAcc = 0; Game.magnetSweep = 0; Game.spawnAcc = 0;
    Game.spawnQueue = []; Game.waveEnding = false;
    Game.lastHitBy = null; Game.perfectFlash = 0; Game.bossIntroTarget = null;
    Game.run = {
      kills: 0, bosses: 0, dmg: 0, materials: 0, time: 0,
      track: { elemDmg: 0, chain10: 0, maxChain: 0, pulled: 0, fullCharges: 0, needleHeal: 0,
        critStreak: 0, burnKills: 0, poisonKills: 0, boomKills: 0, cursed: 0, flawless: true, starfall3: 0, lowHpWaves: 0, reactions: 0, maxCombo: 0 }
    };
    Game.cam = { x: 0, y: 0, zoom: 1, punch: 0, shake: 0, shakeT: 0, shakeDX: 0, shakeDY: 0, sx: 0, sy: 0, lx: 0, ly: 0, trauma: 0, shakeT2: 0 };
    Game.level = new Level(ARENAS[0], 1);
    Game.hash = new SpatialHash(110);
    Game.enemies = []; Game.enemyPool = [];
    Game.pickups = []; Game.powerups = []; Game.runes = []; Game.petDrops = [];
    Game.splats = []; Game.hazObjs = [];
    Projectiles.clear(); EnemyBullets.clear(); FX.clear();
    const p = new Player(0, 'sunny');
    p.x = Game.level.w / 2; p.y = Game.level.h / 2;
    p.hp = 999; p.maxHp = 999;
    p.addWeapon('klingel', 0);
    Game.players = [p];
    /* Gegner: 4 in Waffenreichweite (Klingel cone, ~560-660 Range) */
    const mkEnemy = (defId, dx, dy, hpMul) => {
      const e = new Enemy();
      e.spawn(ENEMY_BY_ID[defId], p.x + dx, p.y + dy, 1, null);
      if (hpMul) { e.maxHp *= hpMul; e.hp = e.maxHp; }
      Game.enemies.push(e);
      return e;
    };
    const e1 = mkEnemy('runner', 150, 0, 1);
    mkEnemy('runner', 180, 60, 1);
    mkEnemy('runner', 200, -50, 1);
    mkEnemy('runner', 240, 30, 1);
    /* Manueller Status-Träger: Burn auf einem Gegner, damit tickStatus geprüft wird */
    const eBurn = mkEnemy('runner', 300, -120, 1);
    eBurn.burn = 8; eBurn.burnT = 2; /* 8 DPS ueber 2 s */
    Game.hash.clear();
    for (const e of Game.enemies) if (!e.dead) Game.hash.insert(e);
    /* Frames treiben: 6 s bei 60 Hz */
    const frames = 360, dt = 1 / 60;
    let minHp = Infinity, negHp = 0;
    for (let i = 0; i < frames; i++) {
      Game.update(dt);
      for (const e of Game.enemies) {
        if (!e.dead) {
          if (e.hp < minHp) minHp = e.hp;
          if (e.hp < 0) negHp++;
          if (!isFinite(e.hp) || !isFinite(e.x) || !isFinite(e.y)) {
            this._ok(false, 'Loop: kein NaN/Inf in hp/x/y (Frame ' + i + ', ' + e.def.id + ')');
            Game.danger = D0; Game.mods = M0; UI.renderHud = oldRenderHud;
            return;
          }
        }
      }
    }
    /* 1. Schaden floss: Gesamtschaden > 0, Gegner haben verloren */
    this._ok(Game.run.dmg > 0, 'Loop: run.dmg > 0 (' + Math.round(Game.run.dmg) + ' Schaden in 6 s)');
    const alive = Game.enemies.filter(e => !e.dead).length;
    const spawned = 5;
    this._ok(alive < spawned, 'Loop: mindestens ein Gegner starb (lebend: ' + alive + '/' + spawned + ')');
    /* 2. Reaktionen flossen: Klingel wendet shock an -> Ketten-Reaktion */
    this._ok(Game.run.track.reactions > 0, 'Loop: Ketten-Reaktionen ausgeloest (' + Game.run.track.reactions + ')');
    /* 3. Status-Ticks flossen: Burn senkte HP des Traegers */
    this._ok(eBurn.burnT < 2 && eBurn.hp < eBurn.maxHp, 'Loop: Burn-Tick senkte HP (burnT ' + eBurn.burnT.toFixed(2) + ', hp ' + Math.round(eBurn.hp) + '/' + Math.round(eBurn.maxHp) + ')');
    /* 4. Konsistenz: keine negative HP im Lauf, kills == enemies entfernt */
    this._ok(negHp === 0, 'Loop: keine negativen HP waehrend des Laufs (' + negHp + ')');
    this._ok(Game.run.kills + alive === spawned, 'Loop: kills + lebend = gespawnt (' + Game.run.kills + '+' + alive + '=' + spawned + ')');
    Game.danger = D0; Game.mods = M0; UI.renderHud = oldRenderHud;
  },
  _extendedSystems() {
    /* Deterministischer Run-Seed, Sunny-Roller und spielerzentriertes Targeting. */
    const oldRand = RAND, oldEnemies = Game.enemies, oldHash = Game.hash;
    const a = Game.setRunSeed(0x12345678), seqA = [RAND(), RAND(), RAND(), RAND()];
    const b = Game.setRunSeed(0x12345678), seqB = [RAND(), RAND(), RAND(), RAND()];
    this._ok(a === b && seqA.every((v, i) => v === seqB[i]), 'Game: gleicher Run-Seed erzeugt identischen Zufallsstrom');
    const p = new Player(0, 'sunny');
    p.rollerBattery = 100;
    const boosted = p.activateRollerBoost();
    this._ok(boosted && p.rollerBoostT > 0 && p.rollerBattery < 100, 'Sunny: E-Roller-Boost startet und verbraucht Akku');
    const normal = new Enemy(); normal.spawn(ENEMY_BY_ID.runner, 12, 0, 1, null);
    const boss = new Enemy(); boss.spawn(ENEMY_BY_ID.elite, 220, 0, 1, null); boss.boss = true;
    Game.enemies = [normal, boss]; Game.hash = new SpatialHash(110); Game.hash.insert(normal); Game.hash.insert(boss);
    const target = Game.nearestEnemy(0, 0, 400);
    this._ok(target === boss, 'Game: Auto-Ziel priorisiert Boss vor normalem Gegner');
    Game.enemies = oldEnemies; Game.hash = oldHash; RAND = oldRand;
  },
  _audioBudget() {
    /* Reiner Audio-Vertrag: SFX-Stimmen werden begrenzt, Musik bleibt frei. */
    AudioSys.resetVoiceBudget();
    let accepted = 0;
    for (let i = 0; i < 40; i++) if (AudioSys.voiceBudget('sfx', 0)) accepted++;
    this._ok(accepted === AudioSys.maxSfxVoices(), 'Audio: SFX-Voice-Limit wird eingehalten (' + accepted + ')');
    this._ok(AudioSys.voiceBudget('music', 0), 'Audio: Musik-Voice wird nicht vom SFX-Limit blockiert');
    AudioSys.resetVoiceBudget();
    this._ok(AudioSys.voiceBudget('sfx', .2), 'Audio: neues Zeitfenster nimmt SFX wieder an');
    const oldMul = AudioSys._sMul, oldPan = AudioSys._sPan, oldFar = AudioSys._sFar, oldSfx = AudioSys.sfx, oldAudioStarted = AudioSys.started, oldCam = Game.cam, oldSfxOpt = Save.data.opts.sfx;
    let called = false;
    AudioSys.started = true; Save.data.opts.sfx = 1; Game.cam = { x: 0, y: 0 };
    AudioSys._sMul = NaN; AudioSys._sPan = NaN; AudioSys._sFar = NaN;
    AudioSys.sfx = () => { called = true; };
    AudioSys.sfxAt('e_roar', NaN, 0, NaN);
    this._ok(!called && Number.isFinite(AudioSys._sMul) && Number.isFinite(AudioSys._sPan) && Number.isFinite(AudioSys._sFar), 'Audio: ungueltige Positionsdaten vergiften keinen SFX-Zustand');
    AudioSys.sfx = oldSfx; AudioSys.started = oldAudioStarted; Game.cam = oldCam; Save.data.opts.sfx = oldSfxOpt; AudioSys._sMul = oldMul; AudioSys._sPan = oldPan; AudioSys._sFar = oldFar;
    const oldQ = Save.data.opts.quality; Save.data.opts.quality = 0;
    this._ok(AudioSys.maxSfxVoices() === 12, 'Audio: Mobilprofil begrenzt SFX staerker');
    const oldAudioCtx = AudioSys.ctx, oldIRCache = AudioSys._irCache, oldStarted = AudioSys.started, oldReverb = AudioSys.reverb, oldReverbWet = AudioSys.reverbWet;
    let mobileWet = null;
    AudioSys.ctx = { sampleRate: 1000, currentTime: 0, createBuffer(chans, n) { return { numberOfChannels: chans, length: n, getChannelData: () => new Float32Array(n) }; } };
    AudioSys._irCache = {};
    const mobileIR = AudioSys._makeIR('default');
    this._ok(mobileIR.numberOfChannels === 1, 'Audio: Mobilprofil erzeugt einkanaligen Raumklang');
    AudioSys.started = true; AudioSys.reverb = {}; AudioSys.reverbWet = { gain: { setTargetAtTime(v) { mobileWet = v; } } };
    AudioSys.applyRoom('default');
    this._ok(Math.abs(mobileWet - .3) < 1e-9, 'Audio: Mobilprofil reduziert Raumklang auf 75 Prozent');
    AudioSys.ctx = oldAudioCtx; AudioSys._irCache = oldIRCache; AudioSys.started = oldStarted; AudioSys.reverb = oldReverb; AudioSys.reverbWet = oldReverbWet;
    Save.data.opts.quality = oldQ;
    this._ok(Game.qualityProfile().name === 'Hoch' && Game.qualityProfile().shadows === true, 'Qualitaet: Hoch aktiviert Schattenprofil');
  },
  _longRunContracts() {
    const oldState = { state: Game.state, mods: Game.mods, level: Game.level, players: Game.players, enemies: Game.enemies, hash: Game.hash, wave: Game.wave, waveTimer: Game.waveTimer, waveDuration: Game.waveDuration, run: Game.run, renderHud: UI.renderHud };
    const oldRand = RAND;
    Combat.setWorld(Game); Game.state = 'play'; Game.mods = []; Game.wave = 1; Game.waveDuration = 1; Game.waveTimer = .04;
    Game.run = { kills: 0, bosses: 0, dmg: 0, materials: 0, time: 0, track: { reactions: 0, elemDmg: 0, maxChain: 0 } };
    Game.level = new Level(ARENAS[0], 1); Game.hash = new SpatialHash(110); Game.enemies = []; Game.players = [new Player(0, 'sunny')];
    Game.players[0].x = Game.level.w / 2; Game.players[0].y = Game.level.h / 2; Game.players[0].addWeapon('klingel', 0);
    UI.renderHud = () => {};
    const seenWaves = [];
    const oldEnd = Game.endWave, oldNext = Game.nextLevelOrShop;
    Game.endWave = function () { seenWaves.push(this.wave); this.waveEnding = false; this.waveTimer = 0; this.wave++; if (this.wave <= 3) this.waveTimer = .04; };
    Game.nextLevelOrShop = () => {};
    for (let i = 0; i < 180; i++) { Game.update(1 / 60); if (!isFinite(Game.waveTimer) || !isFinite(Game.wave)) this._ok(false, 'LongRun: Wellenwerte bleiben endlich'); }
    this._ok(seenWaves.length >= 2 && Game.wave >= 3, 'LongRun: echte Game.update ueberquert mindestens zwei Wellen');
    this._ok(Game.players[0].rollerBattery >= 0 && Game.players[0].rollerBattery <= 100, 'LongRun: Sunny-Akku bleibt im gueltigen Bereich');
    Game.endWave = oldEnd; Game.nextLevelOrShop = oldNext; UI.renderHud = oldState.renderHud; Object.assign(Game, oldState); RAND = oldRand;
  },
  _qualityContracts() {
    const old = Save.data.opts.quality;
    Save.data.opts.quality = 0;
    const q0 = Game.qualityProfile();
    Save.data.opts.quality = 2;
    const q2 = Game.qualityProfile();
    Save.data.opts.quality = old;
    this._ok(q0.name === 'Mobil' && q0.particles === 0 && q0.shadows === false, 'Qualitaet: Stufe 0 bleibt erreichbar und schaltet Effekte ab');
    this._ok(q2.name === 'Hoch' && q2.shadows === true, 'Qualitaet: Stufe 2 bleibt voll aktiv');
  },
  _characterContracts() {
    const ids = CHARS.map(c => c.id);
    const profiles = ids.map(id => CharacterProfiles[id]);
    this._ok(profiles.every(Boolean), 'Charaktere: jeder Held besitzt ein Profil');
    this._ok(profiles.every(p => p.figure && p.animation && p.moveSet), 'Charaktere: Figur, Animation und Moveset sind vollständig');
    this._ok(new Set(profiles.map(p => p.figure)).size === ids.length, 'Charaktere: jede Figur hat eine eigene Silhouette');
    this._ok(new Set(profiles.map(p => p.animation)).size === ids.length, 'Charaktere: jede Animation hat einen eigenen Stil');
    this._ok(new Set(profiles.map(p => p.moveSet.id)).size === ids.length, 'Charaktere: jedes Moveset ist eigenständig');
    this._ok(profiles.every(p => p.moveSet.speed > 0 && p.moveSet.dash > 0 && p.moveSet.rollCd > 0), 'Charaktere: Moveset-Werte sind spielbar');
    const p = new Player(0, 'sunny');
    this._ok(p.profile === CharacterProfiles.sunny && p.profile.moveSet.id === 'sunny-roller', 'Charaktere: Player übernimmt Sunnys eigenes Moveset');
    this._ok(typeof Player.prototype.drawFigureIdentity === 'function', 'Charaktere: Player besitzt eine eigene Figuren-Render-Schicht');
  },
  _brotatoContracts() {
    this._ok(BROTATO_RULES.maxWeapons === 6 && BROTATO_RULES.shopOffers === 6, 'Brotato-Regeln: sechs Waffenplätze und sechs Shop-Angebote');
    this._ok(BROTATO_RULES.autoFire === true && BROTATO_RULES.shopBetweenWaves === true, 'Brotato-Regeln: Auto-Fire und Shop zwischen Wellen');
    this._ok(typeof BROTATO_RULES.rerollCost === 'function' && BROTATO_RULES.rerollCost(1) < BROTATO_RULES.rerollCost(10), 'Brotato-Regeln: Reroll-Kosten skalieren mit der Welle');
    const shopPlayer = new Player(0, 'leonidas');
    ShopSystem.generate(1, [shopPlayer]);
    this._ok(ShopSystem.offers.length === BROTATO_RULES.shopOffers, 'Brotato-Regeln: echter Shop erzeugt genau sechs Angebote');
    const p = new Player(0, 'nova');
    for (let i = 0; i < BROTATO_RULES.maxWeapons; i++) p.addWeapon('pistol', 0);
    this._ok(p.weapons.length === BROTATO_RULES.maxWeapons && !p.addWeapon('smg', 0), 'Brotato-Regeln: Waffenlimit wird im echten Player eingehalten');
    let emptyShopOk = true;
    try {
      ShopSystem.generate(20, []);
      emptyShopOk = ShopSystem.offers.length === BROTATO_RULES.shopOffers && ShopSystem.offers.every(o => Number.isFinite(o.price) && (o.kind !== 'weapon' || Number.isFinite(o.tier)));
    } catch (e) { emptyShopOk = false; }
    this._ok(emptyShopOk, 'Brotato-Grenze: leerer Spieler-Pool erzeugt endliche, normal skalierte Angebote');
    const oldMaterials = Game.materials, oldRerolls = ShopSystem.rerolls;
    const oldOffers = ShopSystem.offers, oldBought = ShopSystem.bought, oldLocked = ShopSystem.locked;
    ShopSystem.generate(1, [shopPlayer]);
    ShopSystem.locked = { 0: 1 }; ShopSystem.generate(2, [shopPlayer]);
    this._ok(Object.keys(ShopSystem.locked).length === 0, 'Brotato-State: neue Welle übernimmt keine alten Shop-Sperren');
    ShopSystem.generate(1, [shopPlayer]);
    const lockedOffer = ShopSystem.offers[2];
    ShopSystem.locked = { 2: 1 }; ShopSystem.bought = {}; ShopSystem.rerolls = 0; Game.materials = 9999;
    ShopSystem.reroll(1, [shopPlayer]);
    this._ok(ShopSystem.offers[2] === lockedOffer && ShopSystem.locked[2] === 1, 'Brotato-Ordering: gesperrtes Angebot bleibt auf seinem Slot');
    ShopSystem.locked = { 0: 1 }; ShopSystem.bought = { 0: 1 }; ShopSystem.reroll(1, [shopPlayer]);
    this._ok(Object.keys(ShopSystem.locked).length === 0, 'Brotato-State: gekaufte Sperre bleibt nach Reroll nicht hängen');
    ShopSystem.offers = oldOffers; ShopSystem.bought = oldBought; ShopSystem.locked = oldLocked; ShopSystem.rerolls = oldRerolls; Game.materials = oldMaterials;
  },
  /* Online-Koop: was ohne Gegenstelle pruefbar ist - Codec, MQTT-Draht und die
     Zusicherung, dass Ferneingaben nur mit Verbindung bei Spieler 2 ankommen. */
  _net() {
    const code = Net.roomCode();
    this._ok(code.length === 6 && /^[A-Z0-9]+$/.test(code) && !/[IO01]/.test(code), 'Net: Raumcode 6 Zeichen ohne I/O/0/1');
    this._ok(Net.normCode(' k7-m 2x abcd ') === 'K7M2XA', 'Net: normCode saeubert und kuerzt auf 6');
    const bytes = new Uint8Array([0, 1, 127, 128, 255, 65, 66]);
    this._ok(Array.from(Net.unb64(Net.b64(bytes))).join() === Array.from(bytes).join(), 'Net: base64 Roundtrip inkl. fehlendem Padding');
    /* Nutzlast > 127 Byte erzwingt einen mehrbyte-Varint - genau der Fall echter SDPs. */
    const big = 'x'.repeat(500);
    const pub = MqttWire.publish('wbns/ABC123/h2c', big);
    const one = MqttWire.parse(pub);
    this._ok(one.msgs.length === 1 && one.msgs[0].payload === big, 'MQTT: PUBLISH mit mehrbyte-Laenge ueberlebt den Parser');
    const conn = MqttWire.connect('abc');
    this._ok(conn[0] === 0x10 && conn.length === 2 + conn[1], 'MQTT: CONNECT-Kopf und Restlaenge stimmen');
    const frame = new Uint8Array(pub.length + 5);
    frame.set(pub); frame.set(pub.subarray(0, 5), pub.length);
    const mixed = MqttWire.parse(frame);
    this._ok(mixed.msgs.length === 1 && mixed.rest.length === 5, 'MQTT: ganzes Paket kommt an, angeschnittenes bleibt gepuffert');
    const role = Net.role, phase = Net.phase, remote = Net.remote, acts = Net.acts;
    Net.remote = { mx: 1, my: 1, ax: 0, ay: 0, aim: 0, sk: 0, t: 1 };
    Net.role = null; Net.phase = 'idle';
    const idle = Input.moveVec(1);
    Net.role = 'host'; Net.phase = 'connected';
    const live = Input.moveVec(1);
    this._ok(idle.x === 0 && idle.y === 0 && live.x > 0 && live.y > 0, 'Net: Ferneingabe erreicht Spieler 2 nur mit Verbindung');
    Net.acts = { dash: 1 };
    this._ok(Net.takeAct('dash') === true && Net.takeAct('dash') === false, 'Net: Aktion wird genau einmal eingeloest');
    this._ok(MqttWire.ping().length === 2 && MqttWire.ping()[0] === 0xC0 && MqttWire.ping()[1] === 0,
      'MQTT: PINGREQ ist C0 00 - haelt die Broker-Sitzung offen');
    const status = Net.status;
    Net.fail('Testgrund');
    this._ok(Net.phase === 'error' && Net.role === null && Net.status === 'Testgrund' && Net.pc === null,
      'Net: fail() raeumt ab, vergisst die Rolle und meldet den Grund');
    Net.status = status; Net.phase = 'idle';
    Net.role = role; Net.phase = phase; Net.remote = remote; Net.acts = acts;
  },
  _render() {
    let el = $('selfTestPanel');
    if (!el) {
      el = document.createElement('div');
      el.id = 'selfTestPanel';
      el.style.cssText = 'position:fixed;top:12px;right:12px;z-index:99999;background:rgba(5,10,20,.95);border:1px solid #334155;border-radius:12px;padding:14px 16px;font:12px/1.6 ui-monospace,monospace;color:#dbe4f0;max-width:430px;box-shadow:0 8px 30px rgba(0,0,0,.6)';
      document.body.appendChild(el);
    }
    const pass = this.results.filter(r => r.ok).length;
    const fail = this.results.length - pass;
    const rows = this.results.map(r => '<div style="color:' + (r.ok ? '#4ade80' : '#f87171') + '">' + (r.ok ? '✔' : '✘') + ' ' + r.name + '</div>').join('');
    el.innerHTML = '<div style="font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin-bottom:8px">Selftest ' + pass + '/' + this.results.length + (fail ? ' · <span style="color:#f87171">FAIL</span>' : ' · <span style="color:#4ade80">PASS</span>') + '</div>' + rows + '<div style="margin-top:8px;color:#94a3b8">Seite mit ?selftest öffnen</div>';
  }
};
window.addEventListener('DOMContentLoaded', () => { Game.init(); if (location.search.indexOf('selftest') >= 0) setTimeout(() => SelfTest.run(), 300); });
if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(() => { if (!Game.ctx) { Game.init(); if (location.search.indexOf('selftest') >= 0) setTimeout(() => SelfTest.run(), 300); } }, 0);
