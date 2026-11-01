# task_083 client: Electron remote store——CoreStore 远程实现，hud/world 零改动

## 描述

前后端分离 B3。Electron 壳的数据源从「进程内直连 core store」换成「world-sync 远程实现」。**总线铁律的兑现时刻**：hud/world 只依赖 core/types 契约，所以换数据源时它们源码零改动——若做不到，说明接口抽象有漏洞，停下来在任务 md 记录而不是硬改 hud/world。方案：docs/SERVICE-SPLIT-PLAN.md B3 节、铁律 3。

## Requirements

1. 新建 `createRemoteStore(wsUrl)`（落位 src/app/services/remote-store/ 或等价位置）：
   - 实现 CoreStore 同接口（`getState()` / `subscribe(listener)`）——类型上就是 `CoreStore`
   - `emitCommand` 远程化：转 `command.forward` 信封（复用 task_081 协议）
2. 断线：指数退避重连；重连成功后收全量 snapshot 覆盖本地缓存。
3. 未连接时：`getState()` 返回最后快照并暴露 `stale` 标志（只读接口上可加 `isStale()` 查询）——不抛错、不返回空态（铁律 4）。
4. main-entry.ts 加装配开关（如 `VITE_STRATIX_REMOTE=1` 或 config 位）：本地直连 dev 模式保留、远程模式新增，**默认关**（本单不切默认，C1 剧本里显式开）。
5. hud/ 与 world/ 目录**零改动**（git diff 验证为空）。

## Acceptance

- [x] mock WS 单测：快照覆盖 / 断线重连 / 命令发送 / stale 标志四路径
- [x] `git diff --stat src/hud src/world` 为空
- [x] main-entry.ts 仅有装配开关增量（diff 可审）
- [x] `npx tsc --noEmit` 0 错 + `npx jest` 全绿

## deliverables

- src/app/services/remote-store/（实现+单测）
- main-entry.ts 装配开关

---

## 实施记录（B3 落地于本单）

### 产物

| 文件 | 职责 |
|------|------|
| `src/app/services/remote-store/remote-store.ts` | `createRemoteStore(wsUrl, options?)`：远程 store 实现（读侧 + 命令面 + 存活性） |
| `src/app/services/remote-store/index.ts` | 模块公开出口（再导出） |
| `src/app/services/remote-store/__tests__/remote-store.test.ts` | 4 例单测（内存 WebSocket 替身，不起真端口） |
| `scripts/smoke-remote-store.ts` | 真端口冒烟（默认连接工厂 = 真 WebSocket，单测的内存替身覆盖不到这一条） |
| `src/app/main/dev-flags.ts` | 装配开关读取：`isRemoteModeEnabled()` / `remoteWorldSyncUrl(fallback)` |
| `src/app/main/main-entry.ts` | **装配开关增量**（数据源二选一 + 6 处 guard，见下） |
| `src/electron/preload.ts` | 环境变量白名单 +2（`STRATIX_REMOTE` / `STRATIX_WORLD_SYNC_URL`） |
| `vite.config.ts` | 构建期 define +2（同上两个变量） |

### 远程 store 的契约（与 CoreStore 的关系）

- **读侧同形**：`RemoteStore extends Pick<CoreStore, 'getState' | 'subscribe'>` —— 类型上就是 CoreStore 的读侧。
- **写侧不做**：`CoreStore` 的写方法（`setState` / `patch` / `pushNotice` / `setPreference` / …）语义是「就地改本地真相」；
  远程模式下本地**没有**真相（真相在 service 的 core store），照搬会造出**第二份真相**（铁律 1）。
  故远程侧只给 `emitCommand`（→ `command.forward` → service 的 core 裁决，铁律 2）+ `isStale()` + `getSeq()` + `dispose()`。
  写面因此**只有一条路**（协议 §1.1「客户端只经 command.forward 写」）。
- **断线语义**：断开 → `isStale()` 转 true + **保留最后一份快照**（不返回空态、不抛错，铁律 4）；
  指数退避重连（500ms 起 ×2、封顶 10s；收到快照即重置退避）；重连后 hello → 全量 snapshot → **整体覆盖**（协议 §1.2，不做增量合并）。
- **未回执的命令不补发**（协议 §1.2：那条命令可能已在旧连接上落地）—— 断连时在飞命令如实报失败。

### 装配开关口径（默认关）

- `STRATIX_REMOTE=1` → 开远程模式（构建期 vite define + 运行时 Electron preload env 两处都读，与既有 `STRATIX_ONBOARDING_FORCE` 同姿势）。
- `STRATIX_WORLD_SYNC_URL` → world-sync 端点地址（缺省 `ws://127.0.0.1:7524/ws/world-sync` = gateway 的 HTTP server + 协议路径）。
- **默认仍是本地直连**（铁律 7：旧路径全程可用；C1 剧本显式开）。

### main-entry.ts 的装配增量（diff 可审）

1. `remote = isRemoteModeEnabled() ? createRemoteStore(url) : null` —— 数据源二选一。
2. hud adapter 的 `emitCommand`：远程模式转 `remote.emitCommand`（`command.forward`），本地模式照旧走 `core/bus.emitCommand`。
3. 快照 → `worldStore.setState(() => state)`（**投影缓存**：本文件各处现读它）+ `emitState(state)`（广播给 hud / world）。
4. 本地 core runtime **不启动**（远程模式）—— 真相唯一（铁律 1）：本地再裁决一遍就是第二份真相。
5. 远程模式跳过：读档**写入**（角色/单位由快照给出）、本地 agent 探测（service 侧自己探）、存档落库（SQLite 由 service 独占写，铁律 6）。
6. 远程模式不发 POST_RENDER 那一帧空状态（未连接 ≠ 战场为空，铁律 4）—— 等第一份快照。
7. pagehide：`stopRemoteFeed()` + `remote.dispose()`（资源必须可清理）。

### 契约缺口记录（发现即记，**本单未改 protocol.ts / B2 服务端**）

1. **`CoreStore` 的写侧在远程侧无对应物**（见上「远程 store 的契约」）。这不是缺口而是设计取舍，但记一笔：
   任何「本地直接改状态」的调用点在远程模式下都**没有落点** —— main-entry 里现有的三处本地写（读档注入 / 检测结果 / 对话会话 id）
   在远程模式下分别被 guard 掉或被快照覆盖。
2. **world 事件面不在 world-sync 协议内**（协议 v1 冻结，只承载状态面 + 命令面）。故远程模式下：
   - **战场点选单位失效**：`unit.click` 是 world 事件（world → core），选中集属 core 真相 —— 事件回不去 service，
     远程模式下选中集只能停在 service 侧的值；
   - **toast / 音效类事件反馈失效**：`level.up` / `agent.online` / `task.*` / `unit.speaking` 都在事件面，远程模式收不到。
   要补齐需给协议加一条 world 事件通道（或把选中/移动等改成 HudCommand）—— **属协议变更，本单不动**，留给后续单。
3. **坐标不进状态面**（core 的 `WorldState` 没有坐标字段）→ 远程模式下单位位置只能靠本地读档的站位种子 + 网格落位，
   service 侧的坐标无法同步（协议 §5.1 同一口径：坐标属世界层）。
4. **对话执行环尚未迁到 service**（service 侧没有 chat-service；`chat.send` 在 service 侧无人接管 → 回执 `internal_error`）：
   远程模式下渲染进程的本地 chat-service 照跑，但它写的是**本地投影**（远程模式没有本地广播出口）→ 对话内容不会出现在视图里。
   同理 **流水线编排**（pipeline-service）仍在渲染进程本地编排。两者都是 A 轨遗留缺口（执行环迁 service），不是 B3 能收的。
5. **落库读侧仍在 Electron**（`loadChatMessages` 等 IPC 读通道保留）—— A3 §3.1 记的过渡项，B 轨收尾项（与本单同批未做）。

### 验证输出

```
$ npx tsc --noEmit
（0 错，无输出）

$ npx jest src/app/services/remote-store --silent
PASS src/app/services/remote-store/__tests__/remote-store.test.ts
  createRemoteStore（前后端分离 B3：Electron 远程 store）
    ✓ ① 快照覆盖：收到 snapshot 就整体替换本地视图（不做增量合并）并广播给订阅者
    ✓ ② 断线重连：断开后保留最后快照并标记 stale，退避后重连并重新 hello
    ✓ ③ 命令发送：emitCommand 转 command.forward，回执按 commandId 结算
    ✓ ④ stale 标志：未连上 / 收到快照 / 再断开 三态如实切换

$ npx jest --silent
Test Suites: 186 passed, 186 total
Tests:       6 skipped, 3870 passed, 3876 total

$ git diff --stat src/hud src/world
（空 —— 铁律 3 兑现：hud / world 源码零改动）

$ npx tsx scripts/smoke-remote-store.ts
[smoke-remote-store] listening on 127.0.0.1:7798/ws/world-sync
[world-sync] 接入一条连接（当前 1 条）
[remote-store] 已连上 service：本地视图恢复为可信
[smoke-remote-store] ① hello → snapshot(seq=1) ok
[world-sync] 接入一条连接（当前 2 条）
[smoke-remote-store] ② forward → ack ok(seq=2) + 状态落地 ok
[remote-store] 连接断开：本地视图标记为 stale（保留最后一份快照）
[smoke-remote-store] ③ 断连 → stale + 保留快照 ok
[smoke-remote-store] ④ 收干净 ok
[smoke-remote-store] OK
```

