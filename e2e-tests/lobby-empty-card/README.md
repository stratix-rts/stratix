# 大厅空卡探针（task_213 / M2-12）

复现并验证「大厅里啥也没有、没有沙盒卡片」这个缺陷的两支探针。
两支都是**纯 JS（.mjs）**，只用 node 内置的 `WebSocket` + 仓库已装的 `playwright`，
不引新 npm 依赖、不进 `tsc` 编译。

---

## 缺陷与根因（先看这段，才看得懂探针在验什么）

用户实机现象（2026-11-06 15:50-15:53）：Electron 起来后**大厅里啥也没有**，
没有默认沙盒卡片 ⇒ 进不去任何副本（大厅卡片是唯一的入口）。

根因在**真相层**（不是数据源、不是过滤层、不是挂载层）：

```
service 开机 → WorldState.activeInstanceId 从未被写过 ⇒ core 初始态里它**缺省**（undefined）
              ↓
HUD 的大厅判据只认**显式 null**（缺省 = 未知，见 src/app/main/main-entry.ts:579）
              ↓
<strat-lobby-panel> 永不挂载 ⇒ 大厅空卡
```

叠加传输：`undefined` 会被 `JSON.stringify` 丢掉 ⇒ world-sync 快照里**连字段都没有**
⇒ 前端拿到的永远是 undefined。

修在**真相持有者**（service 进程，`src/stratix-gateway/service/boot.ts`）：
开机显式写 `activeInstanceId = null`（＝大厅态），且**排在实例清单发布之后**
（不变量：谁看见 `activeInstanceId === null`，谁就看得见卡片清单）。

另有一处**渲染层**缺陷（M1-14 起潜伏）：`.empty { display: flex }` 会盖掉 UA 样式表的
`[hidden] { display: none }` ⇒ 有卡时空态照样露脸（一张卡 + 「没有可用副本」同屏）。
修在 `src/hud/screens/lobby-panel.ts`（补一条 `.empty[hidden] { display: none }`）。

---

## 探针一：快照探针（真相层）

连上某个 service 的 world-sync 通道，打印快照里「大厅卡片数据链」的关键字段。

```bash
node e2e-tests/lobby-empty-card/probe-snapshot.mjs [port]   # 缺省 7524
```

关注两行：

- `有 activeInstanceId 字段吗` —— **false** = 缺陷在场（字段被 JSON 丢了）；
  **true** 且值为 `null` = 已修。
- `projectInstances 数量` —— 恒 ≥ 1（默认沙盒）。这一项证明**数据源没坏**
  ⇒ 排除「注册表 / 物化 / 容量」三条嫌疑。

## 探针二：DOM 探针（渲染层，验收口径）

用 Playwright 起一个**独立的无头 Chromium**，打开前端页面，断言大厅卡片**真的画出来了**。

```bash
# 只断言（大厅有卡 + 空态不可见）
node e2e-tests/lobby-empty-card/probe-dom.mjs <worldSyncUrl> [appUrl] [waitMs]

# 再点一次卡片上的「进入」，断言面板退场（卡片不是摆件）
node e2e-tests/lobby-empty-card/probe-dom.mjs <worldSyncUrl> [appUrl] 12000 --click
```

- `<worldSyncUrl>`：service 的 world-sync 端点，如 `ws://127.0.0.1:7524/ws/world-sync`。
- `[appUrl]`：前端页面，缺省 `http://127.0.0.1:7523/`（vite dev）。

**why 用 `addInitScript` 注入 world-sync 地址**：渲染层的 world-sync 端点在 Electron 里
来自 preload 的 `window.electronAPI.env.STRATIX_WORLD_SYNC_URL`
（见 `src/app/main/dev-flags.ts`）；纯浏览器没有 preload ⇒ 注入一个最小 stub ⇒
**同一个前端页面**可以对不同 service 说话 ⇒「真相层」成为唯一变量
（前后端代码完全一致 ⇒ A/B 对照干净）。

退出码：0 = 大厅有卡；1 = 大厅空卡。

---

## A/B 复现（自带隔离实例，不碰用户正在跑的服务）

```bash
# ① 修复前：另起一份 HEAD 的 service（临时 worktree + 独立端口 + 独立 DATA_DIR）
git worktree add --detach /tmp/stratix-pre213 134066f
ln -s "$PWD/node_modules" /tmp/stratix-pre213/node_modules
cd /tmp/stratix-pre213 && PORT=7724 WS_PORT=7725 DATA_DIR=/tmp/stratix-data-pre213 \
  BIND_ADDRESS=127.0.0.1 npx tsx src/stratix-gateway/index.ts &

# ② 修复后：当前工作树的 service
PORT=7726 WS_PORT=7727 DATA_DIR=/tmp/stratix-data-post213 BIND_ADDRESS=127.0.0.1 \
  npx tsx src/stratix-gateway/index.ts &

# ③ A/B 对照（前端同一个）
node e2e-tests/lobby-empty-card/probe-dom.mjs ws://127.0.0.1:7724/ws/world-sync  # ⇒ 大厅空卡 ❌
node e2e-tests/lobby-empty-card/probe-dom.mjs ws://127.0.0.1:7726/ws/world-sync  # ⇒ 大厅有卡 ✅
```

收干净：

```bash
git worktree remove /tmp/stratix-pre213 --force
kill %1 %2   # 或 kill -9 <PID>
```

---

## 已知噪声（与本缺陷**无关**，别误判）

dev 态没有发布期烘焙产物 `fx-bake-manifest.json`，vite 的 SPA 回落把 `index.html`
返给 Phaser 的 JSON loader ⇒ 控制台一条 `Uncaught SyntaxError: Unexpected token '<'`。
Phaser 的 `JSONFile.onProcess` 先调 `onProcessError()`（推进加载队列）**再**重抛
⇒ 场景照样启动，**不会**截断初始化链（探针输出里 HUD 正常渲染即是证据）。
这是 task_211 已记账的 dev 态缺口。
