# 架构铁律静态扫描（QA-02 · task_222）

> 状态：**已落地**（2026-11-07，task_222）。
> 目的：把「架构铁律」从口头约定变成**机器可判定、可进 CI** 的检查 —— 违规 = 测试失败，不是 warning。
> 交付物：扫描器 `src/architecture/law-scanner.ts` + 豁免账本 `src/architecture/law-waivers.ts` +
> 测试套件 `src/architecture/__tests__/architecture-laws.test.ts` + CLI `scripts/arch-scan.ts`。

---

## 1. 五条铁律与判定口径

| # | 铁律 | 判定口径（扫描器实际怎么查） |
|---|------|------------------------------|
| LAW-1 | **hud ↔ world 互不 import** | 扫 `src/hud/**` 与 `src/world/**` 的全部 import（静态 import / `export from` / `import()` / `require()`），解析到仓内文件后判断落点：hud → world 或 world → hud 即违规。解析走 TypeScript AST —— 注释掉的 import 不算数。 |
| LAW-2 | **core 零 IO** | 扫 `src/core/**`（**排除** `__tests__/` 与 `*.test.ts` —— 单测本来就要读夹具）：① import 了文件 / 网络 / 落库一族的模块（`fs`/`fs-extra`/`net`/`http`/`https`/`child_process`/`os`/`axios`/`ws`/`better-sqlite3`/`lowdb`…，按**前缀**判定）；② `process.env` 直读；③ 用了 DOM / 网络全局（`document`/`window`/`localStorage`/`navigator`/`fetch`/`WebSocket`/`XMLHttpRequest`…）。**局部变量同名不算**（用类型检查器判作用域：`compress.ts` 里的局部 `window` 不是 DOM 全局）。 |
| LAW-3 | **pixelfx 的名字不出现在 core** | `src/core/**` 全文出现 `pixelfx`（不分大小写）即违规 —— 含注释（铁律按字面口径）。 |
| LAW-4 | **pixelfx 管线 ↔ CharacterComposer 管线互不引用** | ① 管线实现互引（pixelfx 侧引 composer 侧、或反之）；② 同一文件同时认识两条管线（**双知文件**）。**组合根豁免**：`src/app/main/main-entry.ts` 是装配点，同时认识两条管线是它的职责。 |
| LAW-5 | **契约单一事实源** | `src/core/types.ts`（总线契约面）与 `src/core/**` 其余模块导出的名字，在仓库内**只能有一处定义**。**转发不算漂移** —— 从 core import 后原样再导出（`export { X }` / `export const Y = X`）是同一个事实源；自己另写一份才算。 |

> 口径出处：`docs/REFACTOR_PLAN_V3.md` §1「通信规则（铁律）」、`docs/DESIGN-dsh-bridge.md`「core 是零 IO 纯逻辑层」、
> `CLAUDE.md`「core 域零 IO / 契约全在 `src/core/types.ts`」。

---

## 2. 怎么跑

```bash
npm run arch:scan          # 棘轮模式：未豁免违规 > 0 ⇒ 退出码 1；报告照实打全部违规
npm run arch:scan:strict   # 严格模式：有任何违规（含已豁免）⇒ 退出码 1
npm run test:arch          # jest 套件（含扫描器自测）
npm test                   # 全仓 jest（本套件是其中一部分）
```

**挂 CI**（仓内暂无 CI 配置，命令已就绪）：

```yaml
- run: npm run arch:scan        # 或 npm test（套件里已含同样的断言）
```

---

## 3. 豁免账本（棘轮机制）

`src/architecture/law-waivers.ts` 是**现存历史债的账本**：

- 账本里有、扫描器也扫到 → 记为「已豁免」，报告里照实打出来（**违规照样可见**），但不红；
- 扫描器扫到、账本里没有 → **未豁免违规** → 测试失败、CI 红（棘轮：只许变少不许变多）；
- 账本里有、扫描器扫不到 → 过期豁免 → **测试失败**，提示去账本里删掉这一条（账实必须一致）。

每条豁免必须写清「为什么豁免」与「后续怎么修」——修债是别的单的事，本单只记账。

---

## 4. 首跑结果（2026-11-07，HEAD 86694b4）

**结论：5 条铁律中 3 条直接通过，2 条有现存历史债（9 条），全部登记在豁免账本里；未豁免违规 0 条。**

| 铁律 | 结果 |
|------|------|
| LAW-1 hud ↔ world 互不 import | ✅ **通过**（0 违规） |
| LAW-2 core 零 IO | ⚠️ 2 条（均豁免） |
| LAW-3 pixelfx 名字不出现在 core | ⚠️ 1 条（豁免） |
| LAW-4 双管线互不引用 | ✅ **通过**（0 违规） |
| LAW-5 契约单一事实源 | ⚠️ 6 条（均豁免） |

### 4.1 违规清单（9 条 · 全部已登记豁免账本）

| 编号 | 铁律 | 位置 | 性质 | 后续处置 |
|------|------|------|------|---------|
| W-01 | LAW-2 | `src/core/agent-link/gateway-transport.ts:85` | core 内直连网关的 transport 实现用全局 `fetch` 打 IO | 另开单：transport 实现下沉到 app 层，core 只留端口 + 协议 |
| W-02 | LAW-2 | `src/core/agent-link/gateway-transport.ts:206` | 同上，WS 通道工厂回落 `globalThis.WebSocket` | 随 W-01 一起下沉 |
| W-03 | LAW-3 | `src/core/theme/visual-spec.ts:555` | **仅注释**里提到 pixelfx（二期代码路由成本实测出处），非依赖泄漏 | 另开单：注释改成中性表述（如「代码路由」） |
| W-04 | LAW-5 | `src/stratix-core/agent/types.ts:6` | 遗留包（deprecated）自带 `TaskStatus`，与 `core/types.ts` 同名不同义 | 随 legacy 退役删除该包 |
| W-05 | LAW-5 | `src/stratix-agent/types.ts:268` | 遗留包自带 `AgentProfile`，同名不同义 | 随 legacy 退役删除该包 |
| W-06 | LAW-5 | `src/stratix-agent/core/SessionManager.ts:9` | 遗留包自带 `SessionManager`，同名不同义 | 随 legacy 退役删除该包 |
| W-07 | LAW-5 | `src/hud/screens/onboarding-catalog.ts:481` | **真漂移**：HUD 预览侧自有一套 `PersonaErrorCode`（`persona-too-long`），与 `core/character/persona.ts`（`empty`/`not-a-string`/`too-long`）同名不同义 | 另开单：HUD 侧复用 core 的码表或改名区分 |
| W-08 | LAW-5 | `src/app/services/persistence/session-event-dao.ts:124` | DAO 写库函数与 `core/session/machine.ts` 的纯状态机函数同名不同义 | 另开单：DAO 侧改名或统一到 core 命名 |
| W-09 | LAW-5 | `src/stratix-gateway/api/routes/session-storage.ts:47` | **真漂移**：网关 HTTP 段自己声明了一份 `SessionReadPort`，没复用 `core/session/types.ts` | 另开单：网关路由改 import core 契约 |

### 4.2 LAW-4 的组合根豁免是真的在起作用

把 `COMPOSITION_ROOTS` 清空后，扫描器立刻报出
`src/app/main/main-entry.ts:174 同一文件同时引用 pixelfx 管线与 CharacterComposer 管线` ——
即**全仓唯一的「双知文件」就是组合根**，它同时认识两条管线是职责所在，不是越界。

### 4.3 扫描器自测（它真的会红）

测试套件第一组用例在临时目录里**注入**违规（hud 引 world / core 读 `fs` / core 出现 `pixelfx` /
双管线互引 / 契约名重复定义），要求扫描器逐条抓出来；另有一条正向用例要求「转发（re-export）不算漂移」，
防误报。**只会通过的扫描器等于没有扫描器** —— 它得先证明自己会红。

---

## 5. 边界与已知取舍

1. **不改产品代码**：本单只做扫描器 + 曝光。9 条历史债全部记账，修债另开单。
2. **豁免不是 warning**：豁免只对**已登记**的现存债生效；账本之外任何新违规一律测试失败。
3. **测试文件不算 core IO 违规**：单测读夹具是正常操作，`src/core/**/__tests__/` 与 `*.test.ts` 被排除。
4. **LAW-3 按字面口径**：注释里出现 `pixelfx` 也算违规（W-03 便是），保证「core 里连名字都不出现」这条口径可判定。
5. **扫描范围**：`src/**` + `scripts/**`；`vendor/pixelfx/**` 是第三方源码，不在扫描面内（只作为管线引用方被查）。
