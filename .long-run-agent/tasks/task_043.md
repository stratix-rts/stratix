# task_043 人设生成 2.0——结构化拼装+预设库+局部修改

## 需求来源
用户验收反馈（2026-10-25 14:21）：「人设生成这一步没有按照结构化提示词的最佳实践来拼接」+「小白友好，有能力的人可以提升更多，项目里之前有 agent 提示词集合的，可以匹配给用户选择，用户可以局部修改」。

## 需求
1. buildPersona 输出结构化人设：分节 markdown（借鉴 src/stratix-agent/templates/partials/layers/ 的分节体系精神：角色定位/使命/沟通风格/自主程度/交付习惯/行为规则），不是朴素 join('\n')
2. 问卷快速路径保留（小白 4 题生成）
3. 预设库：src/hud/screens/persona-presets.ts 手写 6-8 个高质量结构化预设（资深架构师/严格审阅者/研究分析师/全栈交付等），每个标注适配 agent kind 与说明；向导④加「选预设」入口，选中回填 textarea
4. 局部修改：textarea 编辑已有，加脏保护——用户手改后问卷重选/重生成不覆盖已编辑文本（提供「重新生成」显式按钮覆盖）
5. chat-service buildFirstPrompt 不需要大改（persona 自带结构），但验证兼容

## 设计要点
- 结构分节格式统一：`# 分节名（中文）EN` + 空行 + 内容，节间空行；行为规则用列表
- DEFAULT_PERSONA_TEMPLATE 语义保留进「行为规则」节（core 侧 profile.ts 不动， hud 侧 buildPersona 自行组织结构；core 的 DEFAULT_PERSONA_TEMPLATE 仍作为空兜底）
- 预设与问卷共存：预设选中 → textarea 填充 + 问卷答案清空显示「已用预设」；再答问卷 → 提示会覆盖（或显式重新生成）
- PERSONA_MAX_LEN 32k 上限不变
- 文件头注明与 stratix-agent 10 层模板体系的血缘（结构对齐、语义面向战场角色）

## 验收标准
- [x] buildPersona 输出含全部分节头，规则节是列表
- [x] 预设 6-8 个、每个有 kind 标注与一句话说明、内容完整结构化
- [x] 选预设回填 + 手改脏保护（重选问卷不覆盖）+ 显式重新生成可覆盖
- [x] typecheck 零错误，npx jest 全绿不回归（2866 基线）
- [x] 不引入新依赖；hud 不 import world/app 服务层

---

## 验证结果（2026-10-25）

### 改动文件
- `src/hud/screens/onboarding-catalog.ts`：人设分节体系（PersonaSectionId / PERSONA_SECTION_TITLES / personaRulesLines / composePersonaSections）；问卷选项 fragment → sections（role 题同时供给 ROLE+MISSION 两节）；buildPersona 改为结构化分节输出（没答的题整节省略，RULES 节恒在末尾）
- `src/hud/screens/persona-presets.ts`（新增）：7 个预设（architect/strict-reviewer/research-analyst/fullstack-deliverer/night-watch/mentor/rapid-prototyper），RULES 节与问卷路径共用 personaRulesLines（core DEFAULT_PERSONA_TEMPLATE 派生，单一来源）；文件头注明与 stratix-agent 10 层体系的血缘
- `src/hud/screens/onboarding-screen.ts`：③步骤加预设卡片行 + 「已用预设」徽标 + 「按问卷重新生成」按钮；selectPreset（清问卷+回填+清脏）/ regeneratePersona（显式覆写+清脏）/ 脏保护不变式；validatePersonaStep 预设路径免答；对外新增 personaPresetId / personaDirty getter
- `src/hud/__tests__/onboarding-screen.test.ts`：旧 fragment 断言改为分节结构断言（已注明）；新增预设库纯数据 2 测 + 预设/脏保护 UI 6 测

### 验证输出
- `npm run typecheck` ✅ 零错误；`npm run typecheck:tests` ✅ 零错误
- `npx jest src/hud --silent` ✅ 21 suites / 480 tests 全绿
- `npx jest --silent`（全量）✅ 128 suites / 2875 passed + 6 skipped（基线 2866 + 新增 9，无回归）
- chat-service 兼容：buildFirstPrompt 只做外层包裹，结构化 persona 作为纯文本嵌入，chat-service.test.ts 原断言全绿，无需改动

### 行为口径摘要
- 预设选中 = 显式覆写（清脏、清问卷、标「已用预设：xx」）
- 预设态答任一题 → 退出预设模式，预览换问卷结果（小白主路径）
- 手改（input）→ 置脏；脏态答题只记答案不覆写；「按问卷重新生成」显式覆写并清脏
- 预设路径免答问卷即可下一步；问卷路径仍要求答全 4 题；PERSONA_MAX_LEN=32000 校验口径不变

### 未尽事项
- 预设 suitableKinds 目前仅 night-watch 指定 ['openclaw']，其余 'any'；后续可按实测能力细化各 CLI 适配度
- 预设文案为初版手写，后续可根据用户反馈迭代内容（结构不动、内容可换）
