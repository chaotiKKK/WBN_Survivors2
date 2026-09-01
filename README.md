# Wiesbaden Survivors — Arena 1984

Retro-futurismus Survivor-like 浏览器游戏（Wiesbaden 主题，德语 UI）。
**单文件、零依赖、完全离线可玩**：`index.html` 即全部（字体 base64 内嵌）。

## 运行

浏览器直接打开 `index.html`，或：

```bash
npx serve .          # 或任何静态服务器
```

## 版本策略（重要）

- `index.html` — **唯一 canonical 构建**（源自 WBNS-BUILD v1，字体内嵌 → 100% 离线）。
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
