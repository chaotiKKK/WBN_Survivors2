"use strict";
/* =========================================================================================
   WIESBADEN SURVIVORS — Single-File Roguelite Arena Shooter
   Überarbeitete Version: Waffensprites, Partikeleffekte, Sounds und Stabilität optimiert.
   Freeze nach Welle 2 behoben durch defensive Prüfungen in buildSpawnPlan, weightedPick
   und korrekte Timer-Initialisierung.
   ========================================================================================= */

/* ============================ 1. UTIL ============================ */
const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const SPEED_MULT = l => .6 + (clamp(l | 0 || 5, 1, 10) - 1) * .1;
const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
let RAND = Math.random;
class RNG {
  constructor(seed) { this.s = (seed >>> 0) || 1; }
  next() {
    let t = (this.s += 0x6D2B79F5) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a = 1, b) { return b === undefined ? this.next() * a : a + this.next() * (b - a); }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
}
const rnd = (a = 1, b) => b === undefined ? RAND() * a : a + RAND() * (b - a);
/* Kosmetischer Zufall fuer Ton und Effekte: bewusst Math.random, damit der
   geseedete Lauf davon unberuehrt bleibt. Siehe Patch 23. */
const crnd = (a = 1, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
const rndi = (a, b) => Math.floor(rnd(a, b + 1));
const pick = arr => arr[Math.floor(RAND() * arr.length)];
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(RAND() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; };
const fmt = n => (Math.round(n * 10) / 10).toLocaleString('de-DE');
const sign = n => (n >= 0 ? '+' : '') + fmt(n);

function weightedPick(list, wKey = 'w') {
  if (!list || list.length === 0) return null;
  let tot = 0; for (const e of list) tot += (typeof wKey === 'function' ? wKey(e) : e[wKey]) || 0;
  if (tot <= 0) return list[Math.floor(RAND() * list.length)];
  let r = RAND() * tot;
  for (const e of list) { r -= (typeof wKey === 'function' ? wKey(e) : e[wKey]) || 0; if (r <= 0) return e; }
  return list[list.length - 1];
}

