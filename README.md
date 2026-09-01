# Wiesbaden Survivors — Arena 1984

Retro-futurismus Survivor-like 浏览器游戏（Wiesbaden 主题，德语 UI）。
**单文件、零依赖、完全离线可玩**：`index.html` 即全部（字体 base64 内嵌）。

## 运行

浏览器直接打开 `index.html`，或：

```bash
npm run serve        # http://127.0.0.1:8642（PWA/Service-Worker 需要 HTTP）
```

## 源码结构与构建

- `src/index.template.html` — HTML 骨架；内嵌点用 `<!--INLINE:style.css-->` 等标记行。
- `src/style.css` — 全部样式（含 base64 字体）。
- `src/main.js` — 游戏引擎（约 16k 行）。
- `src/sw-register.js` — Service-Worker 注册。
- `tools/build.js` — 把 src 内嵌进模板，产出单文件 `index.html`。

```bash
npm run build        # 重新生成 index.html（逐字节等于旧版基线，已验证）
```

**`index.html` 是生成物——不要直接改它**；改 `src/`，然后 `npm run build`。

## 版本策略（重要）

- `index.html` — **唯一 canonical 构建**（由 src/ + build 生成，字体内嵌 → 100% 离线）。
- `archive/` — 历史版本快照，**只读归档，不在此上开发**：
  - `wiesbaden_survivors_wbns_v3_cdn.html`（v3，Google-Fonts CDN，需联网加载字体）
  - `WS-backup - Kopie.html`、`wiesbaden_survivors_ORIGINAL_backup.html`（更早期版本）

新功能/修复一律基于 `index.html`；禁止再新建 `*_backup_*.html` 副本，历史由 Git 管理。

## 主要系统（源码内分节注释）

- 1.UTIL / 2.SAVE-META / 3.AUDIO（含 MIDI 导入）
- 4.INPUT（键盘+触屏）  5/6/7/8/9.数据表（Stats/角色/武器/物品/敌人）
- 12.SPATIAL HASH & POOL  13.ENTITIES  14.FX  15.武器系统
- 17.关卡生成  18.商店  19.Level-up  20.UI  21.游戏引擎
- 21b.Selftest（`?selftest`）  21c.联机（MQTT+WebRTC，LAN/互联网/离线码）
- 22.参数工坊（Parameter-Werkstatt）

## 联机说明

ONLINE-KOOP 基于 WebRTC P2P（Canvas/音频流由 Host 推给 Guest）。
信令经公共 MQTT broker（`broker.emqx.io` / `test.mosquitto.org`），
也支持无网络的离线码交换。无 TURN，严格 NAT 环境可能无法直连。
