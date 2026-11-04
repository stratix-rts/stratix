# task_153

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_153.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: 请在项目根目录或适当子目录创建交付物

**这是配置文件**，不是最终产出！

## 描述

默认连本地网关：world-sync默认开+断连降级-模块

## 交付物

### 1. 默认反转（`src/app/main/dev-flags.ts`）

`isRemoteModeEnabled()` 的默认值从「关」翻成「**开**」：

- 缺省（构建期常量与运行时环境变量都没给）→ **开** —— 连本地网关是默认（`ws://127.0.0.1:7524/ws/world-sync`，
  即 `remote-store` 的 `DEFAULT_WORLD_SYNC_URL`，指向本机 gateway 的 world-sync 通道）。
- 显式关：`'0'` / `'off'` / `'false'` / `'no'`（大小写与首尾空白不敏感）→ 关 = **本地直连旧路径**
  （铁律 7 的旧路径全程可用；一行 `STRATIX_REMOTE=0 npm run dev` 即可回退）。
- 显式开：`'1'`（其余非空值也算开）。
- 新增 **URL 覆盖口** `?stratix-remote=0|1`：优先级最高（URL > 运行时 env > 构建期常量 > 缺省）。
  why 需要它：默认反转后，依赖「本地直连形态」的 e2e 剧本（空战场 / 首启向导：本地模式才 0 角色）
  不该靠重启 dev 实例改环境变量来跑 —— 同一台 dev server 上按 URL 切模式，谁也不打扰谁。

### 2. 端点默认值

`remoteWorldSyncUrl(fallback)` 不改（运行时 env > 构建期常量 > 缺省），
缺省仍是 `DEFAULT_WORLD_SYNC_URL` = **本机网关**；`STRATIX_WORLD_SYNC_URL` 覆盖依然优先。

### 3. 连接生命周期

**不动 task_083 的装配**（只动默认值与生命周期口径）：

- 启动即连：`createRemoteStore()` 构造即建连（main-entry 的 `remote` 常量在 boot 期建）。
- 连上 → 全量快照覆盖本地投影 → 角色 / 编组 / 任务同步进场（B1 上场管线）。
- 断连 → 保留最后一份快照 + `isStale()` 为真（铁律 4「绝不假装成功」），**不返回空态**。
- 自动重连：指数退避 500ms 起、×2、封顶 10s（≤ 任务要求的 30s 上限）；收到快照即重置退避。
- 横幅：127 的三级态（`app/services/gateway-link.ts` 探 `/health` + 探 WS）——
  远程模式下探测基址从 world-sync 端点换协议得出，故「端点不可达」= 离线横幅；「HTTP 通、WS 断」= 降级横幅。
- 不阻塞 UI 其余部分：建连是异步的，HUD / 战场照常装配。

### 4. 双环境一致

纯浏览器（vite 7523）与 Electron dev 走**同一份** `main-entry` 装配：

- 构建期：vite `define` 注入 `__STRATIX_REMOTE__`（未设置 = '' → 缺省开）。
- 运行时：Electron preload 透传 `process.env.STRATIX_REMOTE`（未设置 = null → 缺省开）。
- 两路都没给 → 开（连本地网关）。

### 5. 改动文件

| 文件 | 改动 |
|------|------|
| `src/app/main/dev-flags.ts` | 默认反转 + 关值词表 + URL 覆盖口 + 注释 |
| `src/app/main/main-entry.ts` | 只改注释（默认口径变了，装配没动） |
| `src/app/__tests__/dev-flags-remote.test.ts` | **新增**：开关口径单测（4 条） |
| `tests/e2e/world-sync-default.spec.ts` | **新增**：四场景 e2e |
| `tests/e2e/playwright.world-sync.config.ts` | **新增**：专用配置 |
| `tests/e2e/global-setup.world-sync.ts` | **新增**：起「端点指向死端口」的第二个 vite（7543），跑完收干净 |
| `tests/e2e/empty-state.spec.ts` | 改 URL：`?stratix-remote=0`（本地直连形态才有空战场） |
| `tests/e2e/onboarding-tour.spec.ts` | 同上 |
| `tests/e2e/onboarding-tour-dismiss.spec.ts` | 同上 |

### 6. 明确未动

- world-sync **五型词表**与 MCP 工具层：零改动。
- task_144–152 的成果结构：零改动。
- 网关（7524）：全程不碰（进程不重启、不改代码）。
- 依赖：零新依赖。

## 验证证据（完成前必填）

- [x] **实现证明**: 见上「交付物」。核心是一处默认值语义（`isRemoteModeEnabled` 缺省即开）+ 一个测试口
      （URL 覆盖），**没有重写 task_083 的装配**。
- [x] **测试验证**: 见下（tsc 0 错；jest 97 套 / 1558 条全绿；playwright 四场景全绿）。
- [x] **影响范围**: 见下「影响范围」。

### 测试步骤

1. `npx tsc --noEmit` → 0 错。
2. `npx jest src/app src/core --maxWorkers=2` → 97 套 / 1558 条全绿。
3. `npx playwright test --config=tests/e2e/playwright.world-sync.config.ts` → 四场景全绿
   （① 缺省即连 ② MCP 新建→上场→删除 ③ 断连降级→自动重连 ④ 死端口→离线横幅 + UI 不死）。
4. 截图：`reports/shots/world-sync-r11-*.png`（connected / mcp-created / degraded / reconnected / offline-dead-endpoint）。

### 验证结果

```
npx tsc --noEmit                → TSC=0（无输出）
npx jest src/app src/core       → Test Suites: 97 passed, 97 total
                                   Tests:       1558 passed, 1558 total

npx playwright test --config=tests/e2e/playwright.world-sync.config.ts
  ✓ ① 缺省即连：≤5s 连上网关，网关名册里的角色带形象上场 (817ms)
  ✓ ② MCP 侧新建角色 → 浏览器 ≤3s 上场；character_delete 后下场 (804ms)
  ✓ ③ 断连 → 降级横幅（数据可用）；通道恢复 → 自动重连 → 角色重新上场 (3.3s)
  ✓ ④ 端点指向死端口 → 横幅「未连接」+ UI 不死 (506ms)
  4 passed (8.0s)
```

截图里能看到的东西（`reports/shots/world-sync-r11-connected.png`）：
顶栏「1 单位」；左栏「任务确认」卡片 **加固城墙-133 / 工头-133**；战场上有一个蓝色彩色角色精灵；
右栏态势总览「单位总数 1」。

### 影响范围

- **默认形态变了**：浏览器开 7523 现在是**视图客户端**（状态来自网关），本地 core runtime 不再启动、
  本地落库 / 本地 agent 探测不再跑（真相唯一，铁律 1）。要回本地直连：`STRATIX_REMOTE=0`（或 `?stratix-remote=0`）。
- **依赖「本地直连形态」的 e2e 已逐个调整**（空战场 / 首启向导三类）：改用 URL 覆盖口切本地直连，
  调整后 `playwright.empty.config.ts` 3/4 绿、`playwright.onboarding-tour.config.ts` 9/9 绿。
- **空态剧本残留的 1 条失败与本单无关**：「面板空态统一」在点完顶栏「更多」→ 聊天抽屉后，
  第二次点「更多」被抽屉遮挡（元素解析得到但点不动）。已在 **HEAD 基线**（独立 worktree + 独立 vite）
  复现同样失败 → **既有失败，非本单引入**。
- 测试数据清理：MCP 造的「十测-甲」已在 e2e 里 `character_delete` 掉；名册现只剩原有的「工头-133」。
