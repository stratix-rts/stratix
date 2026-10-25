# task_044 向导逐个配置化——勾选导入 + per-agent 人设/形象

## 需求来源
用户验收反馈（2026-10-25 14:55）：「生成角色的时候一次性把所有的 agent 都用同一份提示词生成了，这是肯定不对的，每个工具特长不同，应该独立生成。这个流程中一直是一个批量的概念，从皮肤生成界面-填写提示词，都应该是逐个配置。用户勾选需要导入的 agent，然后可以逐个初始化。」

## 需求
1. ①扫描步：检出列表每行加勾选（默认全选），只导入勾选的 agent
2. ②identity 与 ③persona 步骤逐个配置化：顶部 agent 切换条（头像/名称/已配置✓），选中哪个配置哪个；形象（032 已 per-agent）与名字本就独立，人设改为 per-agent 独立草稿 Map<agentKey, persona>
3. per-agent 人设初始值：按 kind 匹配预设（suitableKinds 命中的优先展示/推荐），未命中给 any 预设列表+问卷路径；每 agent 独立脏保护与「按问卷重新生成」
4. ④确认：只列勾选的 agent，逐个显示名字/形象摘要/人设预览（人设可折叠或截断）
5. 建档：逐 agent character.create（032 已是，确认不回归）

## 设计要点
- 状态结构改造：_answers/_persona 单份 → Map<agentKey, {answers, persona, dirty, presetId}>（032 _appearanceDrafts 同模式）
- agent 切换条两步骤共用一个渲染函数；当前选中 agent 存 _activeAgentKey
- 扫描步勾选状态 _selectedKinds: Set<agentKey>；后续步骤 identities/persona 只含勾选集合
- 已有角色（重复名）在确认时按既有重复名校验走 Notice，不新增逻辑
- 皮肤（HUD 全局主题）保持全局一步不动

## 验收标准
- [ ] 扫描步可勾选/取消，只导入勾选项
- [ ] identity/persona 均为逐个配置（切换条+每 agent 独立状态），人设不再全员共用
- [ ] 预设按 kind 匹配推荐（openclaw 见 night-watch 优先）
- [ ] per-agent 脏保护与重新生成独立
- [ ] 确认页只列勾选 agent，逐个含人设摘要
- [ ] typecheck 零错误；jest 全绿（2875 基线，向导测试改断言允许并注明）
- [ ] 不引入新依赖；hud 不 import world/app

## 实施记录（v3.14，2026-10-25）

### 改动文件
- `src/hud/screens/persona-presets.ts`：新增纯函数 `presetMatchingKind(kind)`（专属预设取值口径：
  只有 suitableKinds **点名**该 kind 的才算，如 openclaw→夜间值守；any 不预填）、
  `presetsForKind(kind)`（卡片展示序：专属命中排前 + recommended 标记，any 照常在列 —— 排序而非过滤，保住选择面）。
- `src/hud/screens/onboarding-screen.ts`：
  - ①扫描步：可导入行（已装∩可建档）勾选框，默认全选；`_selectedKinds`/`_knownKinds`（新探到的默认勾上，
    用户明确取消的保持取消）；一个没勾→拦在原地给提示；「勾选导入 N / M」摘要行。
  - ②③共用 agent 切换条（`_activeAgentKey` 并入原 `_previewKind` 职责）：kind 徽标（皮肤色点+显示名+改过的名字）
    + 已配置✓（identity=名字合法；persona=预设生效或问卷答全）；identity 步改为当前 agent 单卡（原「预览形象」
    按钮退役，切换条即预览切换）；改名/答题后切换条轻量刷新（不重画保焦点）。
  - ③人设 per-agent：`_personaDrafts: Map<kind, PersonaDraft{answers,persona,dirty,presetId}>`（032 的
    _appearanceDrafts 同模式）；043 的问卷/预设/脏保护/重新生成全部作用于 active agent 草稿；预设卡片区按
    active agent 的 kind 推荐排序（推荐角标）；初始人设：专属预设命中→预填（免问卷直接✓），否则留空+提示。
  - 校验逐 agent：错误键带 kind（answer:kind:qid / persona:kind / name:kind）；别的 agent 没配置好而屏上看的
    是别人 → 自动切到第一个未配置的（错误直接可见）。
  - ④确认：只列勾选 agent；每 agent 一段可折叠人设（details：摘要=分节头列表「角色定位 ROLE · …」，展开看全文）。
  - 建档：逐 agent character.create 带**各自** persona（032 已有各自 appearance）。
- `src/hud/__tests__/onboarding-screen.test.ts`：+13 测试（扫描勾选 4 / 切换条 2 / per-agent 人设 5 / 确认预览 1 /
  预设匹配纯函数 1）；既有断言适配均已注明【task_044】（错误键带 kind；多卡渲染改单卡+切换条；跨 agent 输入先切 tab）。
- `src/hud/__tests__/onboarding-appearance.test.ts`：既有断言适配【task_044】：原「预览形象」按钮→切换条
  select-agent；「重随机」先切到目标 agent 再点（屏上只有当前 agent 的卡片）。

### 验证结果（2026-10-25）
- `npm run typecheck`：零错误 ✅
- `npx jest --silent`：128 suites / 2888 passed, 6 skipped, 2894 total（基线 2875 → +13 新测试，全绿）✅
- `npx eslint`（改动源文件）：0 errors 0 warnings ✅
- 未引入新依赖；hud 未 import world/app（persona-presets 为纯数据，onboarding-screen 仅新增本目录 import）✅
