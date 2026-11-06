# agent_task_222 —— QA-02 架构铁律静态扫描进 CI · 工作文档

> 任务：v3.3 QA-02（task_222）—— 五条架构铁律的自动化静态检查（jest + npm script，违规 = 测试失败）。
> 权威定义：`.long-run-agent/tasks/task_222.md`。
> 日期：2026-11-07。分支：`demo/v3.3`（基线 HEAD 86694b4）。
> 口径文档：`docs/ARCH-LAWS-STATIC-SCAN.md`。

---

## 1. 交付物

| 文件 | 职责 |
|---|---|
| `src/architecture/law-scanner.ts` | 扫描器本体：五条铁律的判定实现（TypeScript AST 解析，不靠正则硬啃 import） |
| `src/architecture/law-waivers.ts` | 豁免账本：现存历史债逐条登记（理由 + 后续处置） |
| `src/architecture/__tests__/architecture-laws.test.ts` | 测试套件：①扫描器自测（注入违规必须被抓到）②本仓现状（未豁免违规 = 0）③账实一致 |
| `scripts/arch-scan.ts` | CLI：`npm run arch:scan`（棘轮）/ `npm run arch:scan:strict`（严格） |
| `docs/ARCH-LAWS-STATIC-SCAN.md` | 口径文档：五条铁律怎么判、怎么跑、首跑结果与违规清单 |
| `package.json` | 新增 `arch:scan` / `arch:scan:strict` / `test:arch` 三个脚本 |

**未改任何产品代码** —— 本单只做扫描器 + 曝光，9 条历史债只记账不修。

---

## 2. 关键设计决策

1. **五条铁律逐条落成可判定规则**，而不是「跑个 lint 看看」：
   LAW-1 hud↔world 互引 / LAW-2 core 零 IO / LAW-3 core 里无 pixelfx / LAW-4 双管线互引 / LAW-5 契约唯一事实源。
   每条都在文档里写清**判定口径**（扫哪些文件、什么算违规、什么不算）。
2. **解析走 TypeScript AST，不用正则**：
   正则会把注释掉的 import、字符串里的路径、类型位置的名字统统算进去（踩过坑：类型字面量里的
   `WebSocket` 被当成全局使用；局部变量 `window` 被当成 DOM 全局）。
   LAW-2 更进一步用**类型检查器**判作用域 —— 局部 `window` 不算全局（`core/session/compress.ts:594` 的局部变量）。
   why：扫描器一旦误报，第一次误报就会被当成噪音忽略，工具就废了。
3. **豁免账本 = 棘轮**：
   任务要求「检查失败 = 测试失败」且「现有违规如实列出、修复另开单」——两条同时满足只能是账本制：
   账本里登记过的历史债照实打出来（违规照样可见）但不红；**账本之外的新违规一律测试失败**。
   这样 CI 立刻可用（不欠债就不红），同时新债无处可藏。
   账本条目过期（对应违规已被修掉）也判失败 —— 账实必须一致，修债的人顺手删一条即可。
4. **扫描器必须有自测**：
   测试第一组在临时目录**注入**六类违规（hud 引 world / core 读 fs / core 出现 pixelfx / 双管线互引 /
   契约名重复定义 / 转发误报），要求逐条被抓出来。
   why：只会通过的扫描器等于没有扫描器 —— 它得先证明自己会红。
5. **LAW-4 给组合根留口子，且口子要真的在用**：
   `src/app/main/main-entry.ts` 是装配点（同时接 core 契约 + world 渲染 + hud 面板），
   同时认识 pixelfx 与 CharacterComposer 是它的职责。
   验证过这个豁免是**承重**的：把 `COMPOSITION_ROOTS` 清空，扫描器立刻报出 main-entry 是全仓唯一的「双知文件」。
6. **LAW-5 区分「漂移」与「转发」**：
   `hud/theme/motion-tokens.ts` 的 `MOTION_TOKENS_CSS = CORE_MOTION_TOKENS_CSS` 是**同一个事实源**的转发，
   不是第二份定义 —— 不该报。扫描器识别 `export { X }` / `export { X as Y }` / `export const Y = X` 三种转发形态。
   真正的漂移（自己另写一份）才报。

---

## 3. 首跑结果（HEAD 86694b4）

- LAW-1 ✅ 通过（0 违规）
- LAW-2 ⚠️ 2 条（core 内 gateway transport 用全局 fetch / WebSocket）
- LAW-3 ⚠️ 1 条（core 注释里提到 pixelfx）
- LAW-4 ✅ 通过（0 违规）
- LAW-5 ⚠️ 6 条（2 条遗留包同名 + 1 条 HUD 码表同名 + 1 条 DAO 函数同名 + 1 条网关端口同名 + 1 条遗留包类同名）

合计 9 条现存历史债 → 全部登记豁免账本（W-01 … W-09）→ 未豁免违规 0 条 → 测试绿。
其中 **W-07（HUD 的 `PersonaErrorCode`）与 W-09（网关自己声明 `SessionReadPort`）是真漂移**，优先修。

---

## 4. 验证

- `npx tsx scripts/arch-scan.ts` —— 首跑报告（9 条豁免 / 0 条未豁免 / 退出码 0）
- `npx jest src/architecture` —— 14 passed（6 条自测 + 8 条本仓现状）
- `npx tsc --noEmit` —— 0 error
- `npx eslint --cache src/architecture` —— 0 error
- `npx jest`（全仓）—— 见交付说明

---

## 5. 后续建议（不在本单范围）

1. 修 W-07 / W-09（真漂移，改名或复用 core 契约即可，影响面小）。
2. 修 W-01 / W-02（gateway transport 下沉 app 层 —— core 纯逻辑层的最后一块网络出口）。
3. 修 W-03（注释中性化）+ 随 legacy 退役消掉 W-04 / W-05 / W-06。
4. 豁免清零后把 CI 切到 `arch:scan:strict`。
