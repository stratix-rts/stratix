# task_026

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_026.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: 代码 + 测试

## 描述

app: 首启触发逻辑 + 全链路联调验收-模块

## requirements

main-entry.ts 首启判定（WorldState.characters 为空且检测到 ≥1 个已装 agent → 进 onboarding；开发期开关 STRATIX_ONBOARDING_FORCE=1 每次触发）。全链路验收：typecheck+全量 jest+build；dev 起动走完向导创建 1 个角色出现在战场/角色屏。

## design

依赖 021/022/025。手测步骤写进 PR 描述或 commit message。

## acceptance

- typecheck 零错误
- jest 全量通过
- npm run build 成功
- dev 手测向导全流程留截图路径记录

## 交付物

按 design 落地的新增/修改文件 + 对应测试

## 验证证据（完成前必填）

- [x] **实现证明**:
  - **首启判定（纯函数）** `src/app/main/onboarding-trigger.ts`：`shouldStartOnboarding({characters, detectedAgents, force})`
    → 强制开关开 → 挂；已有角色 → 不挂；角色为空且 **已装 agent（`DetectedAgent.installed === true`）≥1** → 挂；否则不挂。
  - **覆盖层挂载（宿主）** `src/app/main/onboarding-host.ts`：`createOnboardingHost` 跟随 core 广播 `evaluate(state)`，
    幂等挂载 `mountOnboardingScreen`；监听 `onboarding-complete` / `onboarding-skipped` 收起覆盖层并置 `settled`（一次会话只弹一次）。
  - **开发期开关** `src/app/main/dev-flags.ts`：构建期 vite define 常量 `__STRATIX_ONBOARDING_FORCE__` + preload 透传的运行时
    `electronAPI.env.STRATIX_ONBOARDING_FORCE`，严格等于 `'1'` 才算开。
  - **接线** `src/app/main/main-entry.ts`：runtime 起来后 `onState(...)` → `onboarding.evaluate(state)`；
    `index.html` 预留 `#onboarding-host` 覆盖层容器；向导走完 → `ui.navigate('character')` 停在角色屏。
  - **角色入战场** `src/core/character/unit-projection.ts`：`character.create` 同一次 setState 里投影出 `UnitView`
    （带 `characterId` / `skinId`），于是「建了角色」与「战场多了单位」是一次广播里的同一件事。
  - **战场染色** `src/world/theme.ts` + `unit-layer.ts`：单位按皮肤徽标色上色（无皮肤回落业务态色）；
    皮肤登记表下沉到 `core/theme/skin-registry.ts`（world 不 import hud）。

- [x] **测试验证**: typecheck + 全量 jest 输出原样贴出（见下方「验证结果」）。

- [x] **影响范围**:
  - 不改 core 状态机语义，只在 `character.create` 成功时**同一次**广播里多写一个单位（既有建档流程的返回值结构不变）。
  - `UnitView` 新增可选字段 `skinId`（契约增补，不破既有构造点）。
  - 皮肤登记表从 `src/hud/theme/` 移到 `src/core/theme/`（hud 与 world 共用底座），hud 侧引用同步改名。
  - world 落位规则从「左上角逐格铺开」改为「以战场中心为轴左右交替铺开」，相机 `syncViewport` 改为视口变化也重写 scroll。

### 验证结果

**typecheck**
```
$ npm run typecheck

> stratix@0.1.0 typecheck
> tsc --noEmit

TYPECHECK_EXIT=0
```

**jest 全量**
```
$ npx jest --silent
Test Suites: 100 passed, 100 total
Tests:       6 skipped, 2359 passed, 2365 total
Snapshots:   0 total
Time:        22.429 s
```

**build**
```
$ npm run build

> stratix@0.1.0 build
> npm run build:backend && npm run build:frontend

> stratix@0.1.0 build:backend
> tsc && tsc-alias

> stratix@0.1.0 build:frontend
> vite build

vite v7.3.1 building client environment for production...
✓ 58 modules transformed.
dist/frontend/src/app/main/index.html        3.54 kB │ gzip:   1.72 kB
dist/frontend/assets/main-BPVcMKo6.js      158.11 kB │ gzip:  41.28 kB │ map: 670.97 kB
dist/frontend/assets/phaser-DaAX4wSk.js  1,208.13 kB │ gzip: 332.21 kB │ map: 10,129.22 kB
✓ built in 2m
```

**dev 手测（真实 Electron + 真检测，非 mock）**

脚本：`scripts/smoke-onboarding.ts`（`npx tsx scripts/smoke-onboarding.ts`，Playwright 拉起 Electron，
主进程真跑本机 CLI agent 检测 → IPC → core 状态 → 向导屏）。

```
[smoke] 扫描报告行数：11
[smoke] 可建档的 agent 数：4
[smoke] 角色屏卡片数：4
[smoke] 战场单位计数：4
[smoke] 视口：null，战场画布：{"x":0,"y":0,"width":1016,"height":972}
[smoke] 全流程通过：扫描 → 起名 → 人设 → 建档 → 战场出现单位 → 角色屏可见
```

自然首启（**不带** `STRATIX_ONBOARDING_FORCE`，纯靠「角色为空 + 探到已装 agent」触发）：

```
✓ 自然首启：向导覆盖层已挂载（未加任何强制开关）
  扫描摘要： 探测到 4 个 agent · 确认已装 3 个 · 可建档 3 个
  已装 agent 数：3（≥1 → 满足首启条件）
```

开发期开关的两条路径都单独验过：

```
# ① 构建期常量（vite define）：纯浏览器（无 Electron preload → 探不到任何 agent）也照样挂向导
$ STRATIX_ONBOARDING_FORCE=1 npx vite --port 7524 --strictPort
无 Electron preload（探不到 agent）时，向导是否挂载： true
扫描状态文案： 扫描中…（已探测 0/11 项）

# ② 运行时环境变量（preload 透传）：已打包 / 已启动的 Electron 也能按环境变量触发
#    —— smoke 脚本就是带 STRATIX_ONBOARDING_FORCE=1 起的 Electron，全流程通过（见上）
```

截图路径记录（`docs/screenshots/task_026/`，由上面的脚本生成）：

| 步骤 | 路径 |
|------|------|
| 00 自然首启（无强制开关，向导自动挂载） | `docs/screenshots/task_026/00-natural-first-launch.png` |
| 01 扫描报告 | `docs/screenshots/task_026/01-scan.png` |
| 02 起名 + 皮肤 | `docs/screenshots/task_026/02-identity.png` |
| 03 人设问卷 | `docs/screenshots/task_026/03-persona.png` |
| 04 确认页 | `docs/screenshots/task_026/04-confirm.png` |
| 05 建档完成 → 角色屏 | `docs/screenshots/task_026/05-character-screen.png` |
| 06 战场（4 个带皮肤色的 agent 单位） | `docs/screenshots/task_026/06-battlefield.png` |
| 07 强制开关（纯浏览器，无 preload 也挂向导） | `docs/screenshots/task_026/07-force-flag-browser.png` |

**未尽事项**

- `docs/screenshots/task_026/` 的 6 张手测截图在仓库里约 1.4 MB；如需瘦身可只留 01/05/06 三张。
- `tests/screenshots/`（脚本默认输出目录）已被 `.gitignore` 忽略，仓库里的证据是 `docs/screenshots/task_026/` 的拷贝。
- 本轮只做了 Electron 端手测；`STRATIX_ONBOARDING_FORCE` 在**已打包产物**里的生效路径（preload 运行时 env）未做打包态验证。
