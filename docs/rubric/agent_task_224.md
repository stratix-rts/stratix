# agent_task_224 —— QA-04 文档与代码整理（工作文档）

> 任务：`task_224` / QA-04 文档与代码整理（QA 轮收口单）。
> 权威定义：`.long-run-agent/tasks/task_224.md`。
> 基线：分支 `demo/v3.3`，HEAD `5a083c2`（QA-03 已落地：lint 153→0 + 豁免账本 + 死代码清理 51 项）。

---

## 0. 范围与判据

| 项 | 口径 |
|---|---|
| 改动面 | v3.3 **191~223** 区间新增的代码文件（`git diff --name-status 19d424c~1 5a083c2` 里状态为 `A` 的 `.ts/.mjs`） |
| 生产类文件 | **四段契约**齐全才计通过：职责 / 输入 / 输出 / 禁止事项 |
| 测试类文件 | **职责头**齐全才计通过（本文件测什么 / 是什么夹具）—— 测试按仓库既有惯例用「单测：/ 集成测试：/ 夹具职责：」开头，**不强塞四段**（那只会产出空注释，与「不为凑覆盖率写空注释」冲突） |
| 扫描器 | 一次性工具 `tmp/qa04/contract-scan.mjs`（**不入仓**，`tmp/` 已 gitignore）；判据 = 文件头 100 行内命中各段标记 |

> 为什么测试类只判「职责头」：全仓测试文件的四段覆盖率是 36/400（9%）——
> **仓库既有惯例就不是四段**。把测试拉进四段口径等于要求写 400 份空注释，
> 与任务书「有实质才写」直接冲突。故测试按其自身惯例判，并如实报出这一口径。

---

## 1. ① 契约注释覆盖（检查输出 + 补注结果）

**初始覆盖**：生产类 22/50、测试类 5/47（合计 27/97）。
**终态覆盖**：**生产类 50/50、测试类 47/47（合计 97/97）**。

### 1.1 生产类补注（28 个文件）

| 组 | 文件 | 补的段 |
|---|---|---|
| scripts（10） | `arch-scan.ts` | 输入 / 输出 |
| | `bake-fx-release.ts` | 输入 / 输出 |
| | `dead-code-scan.ts` | 输入 / 输出 |
| | `lib/fx-pipeline.ts` | 输入 / 输出 |
| | `lib/fx-release-bake.ts` | 输入 / 输出 |
| | `lib/fx-snapshot-manifest.ts` | 输入 / 输出 |
| | `migrate-n4b-character-ids.ts` | 输入 / 输出 / 禁止事项（新增编号段） |
| | `migrate-n7-attribution.ts` | 输入 / 输出 / 禁止事项（新增编号段） |
| | `rehearse-n4b-character-ids.ts` | 输入 / 输出 / 禁止事项（新增编号段） |
| | `verify-n4b-character-ids.ts` | 输入 / 输出 / 禁止事项（新增编号段） |
| e2e-tests（7） | `lobby-empty-card/probe-dom.mjs` | 职责 / 输入 / 输出 / 禁止事项 |
| | `lobby-empty-card/probe-snapshot.mjs` | 职责 / 输入 / 输出 / 禁止事项 |
| | `m2-end-to-end.e2e.mjs` | 输入 / 输出 |
| | `m2-end-to-end/m2-scenario.ts` | 输入 / 禁止事项 |
| | `qa-full-flow.e2e.mjs` | 输入 / 输出 |
| | `qa-full-flow/qa-service-process.ts` | 输入 |
| | `qa-full-flow/vite-server.ts` | 输入 |
| src + tests（11） | `src/app/fx/code-fx-sources.ts` | 输入 / 输出 |
| | `src/app/services/persistence/character-id-map-dao.ts` | 输入 / 输出 |
| | `src/app/services/persistence/instance-attribution-ledger-dao.ts` | 输入 / 输出 |
| | `src/app/services/persistence/instance-attribution-migration.ts` | 输入 / 输出（**禁止事项原本就在** —— 未重复添加） |
| | `src/app/services/persistence/session-external-ref-dao.ts` | 输入 / 输出 |
| | `src/architecture/law-waivers.ts` | 输入 / 输出 |
| | `src/architecture/lint-waivers.ts` | 输入 / 输出 |
| | `src/world/appearance/code-fx-routing.ts` | 输入 / 输出 |
| | `src/world/appearance/code-fx-sources.ts` | 输入 / 输出 |
| | `src/world/appearance/fx-variants.ts` | 输入 / 输出 |
| | `tests/asset-pipeline/png-decode.ts` | 输入 / 输出 |

**纪律遵守情况**：
- **只补不缺** —— 已有段落一字未改、未重排（`git diff` 逐文件核对：改动行全部以 `*` 开头）。
- **有实质才写** —— 每条输入/输出都落到具体参数名 / 表名 / 文件名 / 端口 / 退出码；
  每条禁止事项都带 why（例如「不带 --confirm 就改库」「world 层只认 core」）。
- **零代码改动** —— 补注只发生在文件头块注释内。

### 1.2 测试类（47 个文件）

**终态 47/47 有职责头**，无需补注（`单测：` / `集成测试：` / `回归测试：` / `夹具职责：` / `测试夹具：` / `测试辅助：`）。
本轮**未对测试文件做任何改动**。

---

## 2. ② README/docs 差异更新列表（不重写，只补差异）

| 文件 | 补的差异 | 依据 |
|---|---|---|
| `README.md` | **新增「v3.3 现状速览」章节**：① 多副本（项目=副本实例、COALESCE 隔离口径、N6/N7/N4b 三步、容量上限、验收入口）② 资产管线（pixelfx 烘焙 / CharacterComposer 缓存键 / 静默降级 / 双路由像素一致性 / 两条管线禁止互卷）③ 画布交互（单击选中 / 双击开聊天框 / 右击移动 / 键击归属优先级链 / reduced-motion）④ QA 轮命令速查 | DESIGN-project-map / DESIGN-asset-pipelines / DESIGN-canvas-interactions / ARCH-LAWS-STATIC-SCAN |
| `README.md` | 快速开始处加**「本仓实际用 npm」**提示（原文写的 `pnpm gateway:start` 等脚本在本仓不存在） | `package.json` scripts 实况 |
| `DEV.md` | 新增「QA 与资产管线命令（v3.3 新增）」小节（`arch:scan` / `dead:scan` / `test:arch` / `fx:bake` / `fx:bake:verify` / `typecheck` / `test`） | `package.json` scripts 实况 |
| `docs/README.md` | 新增「v3.3 当前有效文档」索引表（12 条）；把三条**已删除**的 Zone 文档从「需核对/有效」改为「❌ 已退役」并指向 REFACTOR_PLAN_V3 §4 D5 | 文件实况（Zone 已退役）+ D5 冻结决策 |
| `e2e-tests/README.md` | 目录树重画（含 `probes/` 与四支新剧本）；走查探针用法改新路径 + **旧路径失效提示**；新增 5 支剧本的说明段（m1-instance-switch / m2-end-to-end / qa-full-flow / demo-flow / session-capabilities）；环境变量表补新端口与「qa-full-flow 动态挑端口 / m1、m2 不监听端口」；「与构建体系的关系」补 e2e-tests **进 lint** 的事实 | 各剧本文件头 + `package.json` + `tsconfig.eslint.json` |
| `docs/UNIT-STATE-FLOW.md` | 截图引用改名同步（`task142-latency-working.png` → `latency-r142-working.png`） | ③ 的改名连带引用 |
| `reports/README.md`（新增） | 目录说明 + **shots 命名规范** + 旧名对照表 + 三条纪律 | ③ |

---

## 3. ③ 目录整理 diff

### 3.1 e2e-tests/ —— 探针脚本分目录

```
e2e-tests/probe.mjs        → e2e-tests/probes/probe.mjs        （走查探针）
e2e-tests/assign.mjs       → e2e-tests/probes/assign.mjs
e2e-tests/mission.mjs      → e2e-tests/probes/mission.mjs
e2e-tests/session-capabilities.e2e.mjs
                           → e2e-tests/session-domain/session-capabilities.e2e.mjs
```

连带修正（路径跟着动，**功能零变化**）：
- `probes/*.mjs` 的 `from './lib/cdp.mjs'` → `'../lib/cdp.mjs'`；文件头「用法」行同步。
- `session-domain/session-capabilities.e2e.mjs`：`from './lib/service-harness.mjs'` → `'../lib/...'`；
  `REPO = path.resolve(HERE, '..')` → `'..', '..'`；`path.join(HERE,'session-domain','service-process.ts')`
  → `path.join(HERE,'service-process.ts')`；文件头「跑法」「与老剧本的关系」两处路径同步。

**归整后的目录约定**（写进 `e2e-tests/README.md`）：
- 走查探针（驱动已在跑的实例）→ `probes/`；
- 与某剧本绑定的探针 → 留在该剧本目录（如 `lobby-empty-card/`）；
- 每个剧本 = 一个顶层驱动 `*.e2e.mjs` + 一个同名目录（夹具 / helper / 替身）；
- `lib/` 与 `fixtures/` 是横切面。

### 3.2 reports/shots/ —— 命名规范统一（32 个改名，121 张全部合规）

统一规范：**`<主题>-r<批次>-<变体>.png`**
（主题 = 画面对象；批次 = 出图所属评审/验收批次，`r4`…`r11` 或单任务号 `r142/r161/r162`；变体 = 该批次内的具体状态，可含序号 `z-01` / 时点 `0000ms` / 校验号 `ck154`）。

| 旧名类别 | 例子 | 新名 | 为什么改 |
|---|---|---|---|
| 缺主题段 | `-r9-cmdk-list-default-ck.png` | `cmdk-r9-list-default-ck.png` | 文件名以 `-` 开头 |
| 连字符代替批次位 | `fx-161-celebrate.png` | `fx-r161-celebrate.png` | 批次位必须是 `-r<批次>-` |
| 任务号占主题位 | `task142-latency-working.png` | `latency-r142-working.png` | 与全仓「主题在前」相反 |
| 批次位夹在中间 | `task154-r11-bottom-taskbar-ck154.png` | `bottom-taskbar-r11-ck154.png` | 主题位是任务号 |
| 整段缺批次 | `world-sync-event-forward-click.png` | `world-sync-r11-event-forward-click.png` | 批次位缺失 |

**连带改引用**（截图路径写在 Playwright 脚本里 ⇒ 不改就会重新长出旧名）：
`tests/e2e/command-palette.spec.ts`、`task154-single-input-and-character-entry.spec.ts`、
`task155-input-semantics.spec.ts`、`world-sync-event-forward.spec.ts`、
`fx-touchpoints.spec.ts`、`fx-code-route.spec.ts`（6 个文件）。
校验：e2e 里引用的 49 张截图**全部指向存在的文件**（0 悬空引用）。

---

## 4. ④ 冻结文档只读确认

`docs/DESIGN-workspace.md`、`docs/DESIGN-project-map.md` —— **本单零改动**
（`git status` 无这两个文件；`docs/UNIT-STATE-FLOW.md` 改的是截图引用，不是冻结设计）。

---

## 5. ⑤ 验证（命令与输出原样）

```
$ npx tsc --noEmit
（无输出）            TSC_EXIT=0

$ npx jest --maxWorkers=2 --silent
Test Suites: 364 passed, 364 total
Tests:       6 skipped, 6177 passed, 3 total
Snapshots:   0 total
Time:        37.178 s

$ npm run lint          # src 口径
✖ 14 problems (0 errors, 14 warnings)      # 0 error；14 warning 全是既有的 import/no-named-as-default 类

$ node --check e2e-tests/probes/*.mjs e2e-tests/session-domain/session-capabilities.e2e.mjs
OK ×4（语法通过）

$ node tmp/qa04/contract-scan.mjs tmp/qa04/added.txt
生产类四段覆盖: 50/50
测试类职责头覆盖: 47/47
合计: 97/97
```

**e2e-tests 的 lint 说明**：`lobby-empty-card/probe-dom.mjs` 有 8 条 `no-undef`
（`window` / `document` 未声明）—— **是既有债，不是本单引入**：把 HEAD 版同文件放到同目录
再 lint，报的是**同一组 8 条**（仅行号因头注释变长而位移）。
本单只补注释、不改代码，故不动它；修它属另一单（e2e-tests 树的浏览器 env 口径）。
其余 e2e-tests 文件的 1 条 `import/no-named-as-default` warning 同理为既有债。
`scripts/`、`tests/` 整树在 `.eslintrc.cjs` 的 `ignorePatterns` 里（豁免账本 L-03 / L-05），
故不在 lint 覆盖内 —— 棘轮测试（`src/architecture/__tests__/lint-waivers.test.ts`）全仓 jest 里已绿。

---

## 6. 未做 / 明确不做

| 项 | 原因 |
|---|---|
| 不重写 README | 任务书要求「不重写只补差异」；README 的产品定位 / 架构拓扑段原样保留 |
| 不给测试文件强塞四段 | 会产出空注释（任务书禁止）；测试按仓库既有惯例判「职责头」 |
| 不修 e2e-tests 的既有 lint 债 | 属「改代码」，超出本单「只补注释」范围 |
| 不动 `docs/DESIGN-workspace.md` / `docs/DESIGN-project-map.md` | 冻结文档（只读） |
| 不动 `.long-run-agent/` / `HEARTBEAT.md` / `lra.md` | 任务书禁止 |
| 不新增 npm 依赖 | 全程零新增（只用 node 内建 + 仓内已有） |
