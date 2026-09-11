# WBN_Survivors2 — Port-Plan (Web → UE 5.8)

Stand: UE-Projekt aus TP_TopDown-Template läuft, Editor-Build verifiziert.
Basis: TwinStick-Variante (Bewegen + Zielen, Spawner, Projektile, Pickups).

## Klon-Daten (`src/data.js`, per Node-Dump verifiziert)

| Tabelle       | Anzahl | UE-Ziel                              |
|---------------|--------|--------------------------------------|
| CHARS         | 23     | DataAsset `UWBNCharacterData`        |
| WEAPONS       | 42     | DataAsset `UWBNWeaponData` (4 Tiers) |
| ITEMS         | 44     | DataAsset `UWBNItemData`             |
| ENEMIES       | 28     | `ATwinStickNPC`-Ableitungen + Data  |
| BOSSES        | 8      | Boss-AIs mit Phasen (`phases[]`)    |
| ARENAS        | 8      | Maps (Kurpark zuerst)                |
| ACHIEVEMENTS  | 36     | SaveGame / Online-Subsystem          |
| DANGERS/MODS  | 9/9    | GameMode-Skalierung                  |
| RUNES/PETS    | 8/4    | Begleiter-Komponenten                |
| RELICS        | 16     | Endlos-Modus                         |
| STAT_DEF      | 24     | `FWBNStats`-Struct                   |

Charaktere: leonidas, sylvia, sebbo, scharfschuetze, bollwerk, nova,
kleeblatt, ingenieur, cyborg, rockstar, greta, manni, oe, blindgaenger,
petra, kobra, sunny + 6 kaykit-Platzhalter.
Sprites: `models/sheets/*_{idle,walk,punch}.png` (19 Chars) → Paper2D-Flipbooks.
Bosse: kurhaus, nerobahn, kochbrunnen, rogueki, bergbahn, sirenkollektiv,
thermalquelle, marktturm (je 3 Phasen: radial/spiral/bulletHell/charge/...).
Arenen: kurpark, innenstadt, rheinufer, labor, neroberg, warmerdamm,
schlachthof, rheingau.

## Schlüssel-Mechaniken (aus `src/*.js`)

- Wellen-System (`engine-spawn.js`): `minW` pro Gegner, Gewicht `w`, Packs.
- Waffen-Tiers: `[dmg, cd, spd, crit, mult, preis, opts]` + scaling-Stats.
- Gegner-KI-Typen: chase, orbit, ranged, exploder, charger, healer, aura,
  summoner, teleport, spiral, mortar, weaver, sentinel, leech, bomber,
  mirror, juggernaut, siren (+fly/phase/split/reflect-Flags).
- Stats: 24 Werte (maxHp, dmgP, atkSpd, crit, armor, dodge, speed, luck, ...).
- Koop lokal (2 Spieler) + Online (WebRTC) — UE: Listen-Server + Replication.

## Nächste Schritte

1. `FWBNStats`-Struct + `UWBNCharacterData`/`UWBNWeaponData`-DataAssets.
2. CHARS/WEAPONS als DataAssets importieren (JSON-Export aus data.js).
3. Kurpark-Arena-Blockout auf LVL_TwinStick-Basis.
4. Wellen-Spawner an `minW`/`w`-Tabellen anbinden.
