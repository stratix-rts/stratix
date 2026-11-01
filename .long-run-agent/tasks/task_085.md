# task_085 docs: 拓扑定稿——OpenClaw 式架构文档+旧路径 @deprecated 标记

## 描述

前后端分离 C2 收尾单。迁移完成后把新拓扑写成正式文档，旧路径标记退役（不删代码）。方案：docs/SERVICE-SPLIT-PLAN.md 第 7 节「明确不做」清单。

## Requirements

1. README.md 与 docs/MCP-SPEC.md 更新架构：service 常驻 / Electron 可选 / 三外面（MCP + REST + WS world-sync）——含**新旧拓扑对比图**（ASCII）。
2. 旧路径打 `@deprecated` 注释标记（不删代码）：electron/main.ts 的 CLI spawn 职责段、渲染进程本地直连装配（main-entry.ts 本地模式开关）、mcp context.ts 里已过时的拓扑说明段。
3. 迁移期双模式说明写进 docs/SERVICE-SPLIT-PLAN.md 收尾节：本地 dev 回退怎么开（开关名/环境变量）、何时用（B 轨联调前的纯前端开发）、何时禁。
4. 标记不得影响构建：@deprecated 只是注释语义。

## Acceptance

- [x] README 与 MCP-SPEC 含新旧拓扑对比图
- [x] 三处旧路径 @deprecated 标记齐全（贴行号进 md）
- [x] 双模式说明完整（开关名 + 适用场景）
- [x] `npx tsc --noEmit` 0 错 + `npm run build` 通过

## @deprecated 标记行号（C2 落地实况）

| # | 位置 | 行号 | 标记内容 |
|---|------|------|---------|
| ① | `src/electron/main.ts` | **L138**（`chatRuns` 声明段 —— CLI spawn 职责段） + **L663**（`chat:run` / `chat:abort` IPC 段） | Electron main 不再是 CLI spawn 的归宿；新归属 = service 进程直接 spawn（`src/stratix-gateway/service/task-execution.ts`）。只保留给本地直连 dev 回退模式 |
| ② | `src/app/main/main-entry.ts` | **L237** | 渲染进程「本地直连装配 / 开关段」整体退役中；迁移指引含 `STRATIX_REMOTE=1` 开远程、不设即本地回退 |
| ③ | `src/stratix-gateway/mcp/context.ts` | **L73** | 已过时的跨进程拓扑说明段（现在是同进程真态）；旧口径作历史记录保留 |

> 全部**只注不删**（铁律 7）；每处标记都写了指向新路径的迁移指引。

## 文档产出

| 文件 | 变更 |
|------|------|
| `README.md` | 新增「🏗️ 架构拓扑（前后端分离 · OpenClaw 式）」节：新拓扑 ASCII 图 + 旧拓扑 ASCII 图 + 七维前后对比表 |
| `docs/MCP-SPEC.md` | 新增 §0.5「拓扑定位（新旧拓扑对比）」（含两张 ASCII 图 + 对比表）；§0.2 权威依据增列 SERVICE-SPLIT-PLAN；§4.4 增注指回 §0.5；§5.5 增记 v1.2（纯文档，工具面零变更） |
| `docs/SERVICE-SPLIT-PLAN.md` | 新增 §8「收尾节（迁移期双模式）」：两模式对照表 + 开关名与开法 + 适用场景 + **何时禁** + 退役路线 |

## 验证输出

- `npx tsc --noEmit` → 0 错（无输出）
- `npm run build` → 通过（backend `tsc && tsc-alias` + frontend vite build ✓ built in 2m 1s）
- `npx jest --silent --maxWorkers=2` → **Test Suites: 186 passed, 186 total；Tests: 6 skipped, 3870 passed, 3876 total**

## deliverables

- README.md、docs/MCP-SPEC.md、docs/SERVICE-SPLIT-PLAN.md 增量
- 三处 @deprecated 标记
