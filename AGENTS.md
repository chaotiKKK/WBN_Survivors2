# AGENTS.md — Wiesbaden Survivors

## Build & Bundle-Architektur
- `src/bundle.json` listet die Module in **Ausführungsreihenfolge** — die Module teilen sich einen Scope (keine imports/exports). Reihenfolge ist semantisch, nicht umbauen ohne Grund.
- `index.html` ist Build-Artefakt und muss **byte-identisch** bleiben: `npm run build` && `git diff --quiet index.html` ist der Akzeptanztest. Deshalb: keine Header-/Kommentarzeilen in Moduldateien ergänzen, die den Originaltext verändern.
- Moduldateien müssen zusammen mit `src/index.template.html` (Marker `<!--INLINE:bundle.json-->`) und `src/bundle.json` gesehen werden — ein neuer Modul-File ohne Bundle-Eintrag landet schweigend nicht im Build.
- Nach jeder Änderung an `index.html`-Quellen: **SW-Cache-Version in `sw.js` bumpen** (`wbns-vN`), sonst behalten Clients den alten Build.
- `tools/embed_char_sprites.js` schreibt Base64-Sheets in die Bundle-Datei mit `CHAR_SPR` (momentan `data.js`) — CI prüft danach `git diff --exit-code -- src/` (Embed-Idempotenz + Sprite-Audit via `tools/sprite_audit.py`, braucht Pillow).

## Befehle (nicht alle im README)
- `npm test` = Headless-Chromium-Selftest (`tools/selftest-headless.js`, 98 Checks) — braucht echten HTTP-Origin wegen Service Worker; Repo wird dabei selbst serviert.
- Dev-Server-Konvention: Port **8642** (`npx http-server -p 8642 -c-1 .`).
- `npm run check` = `node --check` über `src/*.js` (läuft als prebuild automatisch); `npm run build:watch` = entprellter Rebuild bei src-Änderungen.

## Debugging-Fallen (Fehlerbilder täuschen)
- Verdeckter/inaktiver Preview-Tab **friert rAF ein** und pausiert das Spiel: Perf-Messungen und Animationschecks liefern dann falsche „anim:false"-Ergebnisse. Workaround: rAF auf Timer shimmen oder synchrone CPU-Zeit pro Draw messen.
- Spieler-Sprites animieren **nur bei Bewegung** (`walkT` steigt nur mit Input) — stehende Figur = identische Pixel, kein Animationsbeweis. Für Scripted-Runs: Key-Events injizieren.
- Level-Up- und Shop-Masken **frieren den Loop ein**; in Scripted-Runs per `Game.chooseUpgrade(...)` bzw. Shop-Bestätigung wegwählen. AFK-Spieler stirbt in Welle 1–2.
- In-Game-Verifikation über vorhandene Hookpoints: `Game.sel[0]=id; Game.startRun()`, Freischaltung per `Save.data.unlockedChars` (rockstar/cyborg sind hinter Erfolgen gesperrt); Walk-Animation per Pixel-Hash des Canvas-Ausschnitts an der Spielerposition beweisen.
- Konsolen-`BiquadFilter`-Clamp-Warnungen sind Altlast der Audio-Engine, harmlos — NICHT durch aktuelle Änderungen verursacht.

## Offene bekannte Bugs (nicht yet gefixt)
- Audio-Engine: 1) Filter-Clamp-Warnungen >24 kHz, 2) doppelte Sättigung (musicDrive + per-voice drive), 3) Presence-Peaking zu scharf, 4) `duty`-Parameter in `CHIPTUNE_STYLES` wird nie genutzt.

## Sprite-Pipeline
- Kette: `tools/gen_char_photos.py` (KI-Fotos, ~90 s/Bild, API) → `tools/cutout_rig.py` (CELL=128) → `tools/batch_rig.py` (Kandidaten-Scoring) → `embed_char_sprites.js`. Fotos liegen in `models/photos/` (Repo-Binary, regenerierbar).
- Cutout-Gotchas: adaptiver Flood-Fill (mittlaufende Seed-Farbe) hat Ergebnisse verschlechtert — fester globaler Seed behalten; BBox-Boden braucht „zwei aufeinanderfolgende substanzielle Zeilen"; Scorer nutzt Wedge-/Proportions-/Grounding-Strafwerte, Grounding ist harter Filter.
- Char-Zeichnung skaliert fraktional `S = 96/max(fw,fh)`: 128px-Zellen rendern auf 96 Bildschirm-Pixel; Performance-Delta vernachlässigbar (~0,0003 ms/Draw).
- `titan`/`marathon`/`nachtfalter` in `CHAR_SPR` sind **Relikt-IDs ohne Render-Referenz** — keine spielbaren Charaktere, In-Game-Run-Tests dafür unmöglich (nur Decode-Check).

## Repo & Publishing
- **Kein Remote** konfiguriert — PRs bleiben lokal committet. `gh`-CLI ist installiert (winget, User-PATH); Device-Flow-Login läuft regelmäßig in das 15-Minuten-Timeout. PR-Body-Entwurf (Charakter-Rollout, deutsch) existiert aus früherer Session.
- Git-Identity ist nicht konfiguriert: Commits brauchen `git -c user.name="HP" -c user.email="hp@local"`.
- LF→CRLF-Warnungen bei `git add` sind eol-Normalisierungsrauschen — `git diff --quiet` bleibt die Wahrheit.

## User-Präferenzen
- Antworten auf **Deutsch**, knapp („dont overthink") — direkt arbeiten, nicht lange theoretisieren.
- Verifikation über echte Runs im Live-Preview erwartet, nicht nur Audit/Decode-Checks.
