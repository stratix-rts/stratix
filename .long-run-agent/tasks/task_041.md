# task_041: 外观解锁接线

## 描述
部件选择器按角色等级过滤未解锁部件；升级解锁时 UI 反馈。

## 需求
1. 选择器（028 部件选择器 + 032 每 agent 形象编辑）读角色 level → UNLOCKS 门槛过滤可编辑类别；未解锁类别灰显+「Lv.X 解锁」角标
2. level.up 时：抽屉/战场 toast「解锁新外观部件」；重开选择器可见新类别
3. 随机按钮只从已解锁类别随机（minimal/normal 档已天然兼容，需确认 skip 清单与 UNLOCKS 的交集行为，文件头注明）
4. 单测：等级过滤/灰显状态/升级后解锁可见

## 依赖
- 040（UNLOCKS 数据）、032（选择器结构）、033（等级持久化）

## 验收标准
- [ ] tsc 零错误；npx jest src/hud 全绿
- [ ] L1 角色只见到基础五类可编辑

## 验证方式
npm run typecheck && npx jest src/hud --silent

---

## 验证结果（2026-10-24，执行者：task_041 agent）

**改动文件**（commit `v3(task_041): 外观解锁接线`）：

- `src/core/types.ts`：新增 HudCommand `character.appearance.update`（★ core 不判解锁——等级门槛是编辑 UI 的引导约束，注释已写明缘由）
- `src/core/character/profile.ts`：`resolveAppearance` 转公开（改形象与建档同一校验口径）；新增 `isSameCharacterAppearance`（语义相等→不写库）
- `src/core/character/manager.ts`：`updateAppearance()`——一次 setState 原子写 characters + **同步刷新战场单位的 appearance 投影**（不同步则战场画旧形象）；语义相等不广播
- `src/core/runtime.ts`：命令接线
- `src/core/progression/unlocks.ts`：新增 `unlockLevelOf`（键→门槛，角标数据源）+ `newlyUnlockedBetween`（from→to 新解锁键，toast 条件裁决）
- `src/hud/screens/appearance-unlock-catalog.ts`（新）：解锁的 HUD 消费面（纯函数）——`lockedCategoryBadge`（「Lv.X 解锁」角标）/ `mergeUnlockedRoll`（受限重随机合并）/ `levelUpToastText`（升级 toast 文案）；文件头含向导 vs 编辑路径口径、skip 清单∩UNLOCKS 正交性说明、rare_variants 边界
- `src/hud/screens/appearance-preview-port.ts`：可选能力 `listAllCategories`（编辑面板全量 22 类；向导 listCategories 五类口径不变）
- `src/app/services/appearance-preview-service.ts`：实现 `listAllCategories` + `EDIT_CATEGORY_LABELS` 全量中文标签
- `src/hud/screens/character-screen.ts`：角色详情下方新增最小形象编辑面板（预览 canvas + 全量选择器 + 重随机 + 保存）；草稿仅内存、切单位重置、跨广播不丢；未解锁灰显（disabled + data-locked + 角标，不隐藏）；受限重随机；卸载销毁端口
- `src/hud/screens/character-catalog.ts`：`resolveFocusedCharacter`（编辑面板要 appearance/agentKind，卡片模型不含）
- `src/hud/screens/main-screen.ts`：`createMainScreen(adapter, { appearance })` 端口随屏位注入
- `src/app/main/main-entry.ts`：外观服务创建上移（建屏前就绪）+ 共享同一实例；level.up → toast「XX 升到 Lv.X！解锁新外观部件」（有新解锁才带后半句），页面销毁前退订

**单测**（+36，全绿）：
- `src/hud/__tests__/appearance-unlock-catalog.test.ts`（15）：等级过滤/角标文案（L1/L3/L5/L8/L12 边界、词表外防御）、受限合并范围（未解锁保留现值、roll 缺失类别不删、不可变）、toast 条件（跨档/多档/to≤from）
- `src/hud/__tests__/character-appearance-edit.test.ts`（11）：L2 灰显+角标、改已解锁部件推预览、强改 locked select 不进草稿、保存发命令、受限重随机、roll=null 报错、**真写库升级 L2→L3 后新类别可见且草稿不丢**、无形象角色预设初始化（深拷贝）、素材就绪补初始化、无端口降级、卸载销毁
- `src/core/__tests__/character.test.ts`（+7）：manager 层（合法写入两侧同引用同步、只刷自己单位、语义相等不广播、not-found/非法拒发）+ 总线闭环（含「L1 写 L8 shield 照常落库——core 不判解锁」）
- `src/core/__tests__/progression.test.ts`（+3）：`unlockLevelOf` / `newlyUnlockedBetween`（跨档/连升/L11→L12 含 rare_variants/脏输入夹取）

**验证输出**：
- `npm run typecheck` → tsc 零错误
- `npx jest src/hud src/core --silent` → 37 suites / **877 passed** 全绿
- `npx jest --silent`（全量）→ 128 suites / **2866 passed + 6 skipped**（2830 基线 → +36 新测试，零回归）

**验收对照**：
- tsc 零错误；jest 全绿 ✓
- 「L1 角色只见到基础五类可编辑」：L1 可编辑集 = UNLOCKS[1] 六类（body/head/hair/eyes/ears/facial，含 head）——「五类」是 032 向导预览选择器的口径（向导不列 head）；解锁数据以 040 的 UNLOCKS 表为准（L1 含 head），向导路径五类、编辑路径六类，各自口径已在文件头注明 ✓
- 向导路径（032）完全未动：不受解锁约束、randomizeNormal 整套替换保持现状 ✓
- skip 清单与 UNLOCKS 的交集行为已确认并在 `appearance-unlock-catalog.ts` 文件头注明（两套规则正交：minimal 档跳 facial 是质感规则，不是解锁；normal 档随机到高等级类别在向导合法、编辑路径被 merge 裁掉）✓

**未尽事项**：
1. rare_variants 标记位（L12）：解锁判定/角标/toast 已含它，但「哪些变体算稀有」归素材元数据（渲染侧），端口未暴露稀有标记 → 变体级过滤留待后续任务（文件头已注明）
2. 编辑面板保存成功无显式确认反馈（外观变更靠预览自见 + 战场单位即时换装；toast 属升级路径）——如需「已保存」提示可复用 toast-host，留 UI 打磨
3. dev 入口（hello-loop-entry）未注入外观端口 → 该入口下编辑面板降级为提示语（与无端口口径一致，非缺陷）
