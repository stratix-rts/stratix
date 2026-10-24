# task_030: 恢复规则化随机形象生成器

## 描述
移植旧代码三档随机逻辑到新架构，并扩展 appearance 模型支持 itemId 精度。解决「随机形象可能很丑」的根因：旧随机是 itemId 级白名单/过滤，新模型只有 category+variant。

## 需求
1. **模型扩展**：`src/core/types.ts` 的 appearance 部件选择支持可选 `itemId`（每类别 `{ variant: string; itemId?: string }` 或兼容旧 Record<category, variant> 的并集形态——以现有 027 实现为准设计，向后兼容：无 itemId 时行为不变，resolveSelections 优先用 itemId 精确定位）
2. **规则化随机器**：`src/world/appearance/` 新增 `appearance-randomizer.ts`，移植旧三档逻辑（源码参考：`git show a9498ae~1:src/components/character-creator/v3/composables/usePartSelection.ts` 185-330 行）：
   - **minimal**：跳过 RANDOMIZATION_SKIP_CATEGORIES（照抄清单并按新分类名对齐），head 只选 itemId 以 `Human` 开头的，可选类全空 → 平民脸
   - **normal**（默认档）：盾 70% 空 + 只从 ALLOWED_SHIELDS=['shield_heater_revised_wood','shield_heater_wood'] 选，可选类 50% 空 → 冒险者
   - **full**：全随机无空概率
   - 旧逻辑逐类随机 itemId + 从该 item 的 variants 随机 variant；输出带 itemId 的新格式
3. **组合根接线**：随机器所需的 parts 元数据经 PartRegistry 提供（注入式，不新增依赖）
4. 单测：三档各档跳过/白名单/空概率行为（Math.random 打桩）

## 验收标准
- [ ] tsc 零错误
- [ ] appearance 模型带 itemId 后，旧数据（纯 variant）解析不回归（027 的 415 测试不破，允许修正断言但需注明）
- [ ] 随机器三档单测覆盖跳过清单/白名单/空概率
- [ ] npx jest src/world src/core 全绿
- [ ] 新文件头部契约注释（职责/输入输出/禁止事项）

## 验证方式
npm run typecheck && npx jest src/world src/core --silent

## 验证结果（2026-10-24）

### 改动文件
| 文件 | 改动 |
|------|------|
| `src/core/types.ts` | 新增 `AppearancePartSelection` / `AppearancePartValue` 并集形态 + `isAppearancePartSelection` / `appearancePartVariant` / `appearancePartItemId` 读取 helper + `MAX_APPEARANCE_ITEM_ID_LEN`；`CharacterAppearance.parts` 值类型扩展为并集（纯串旧数据不变形） |
| `src/core/character/profile.ts` | `resolveAppearance` 支持两种形态的校验（旧串形态原样保留；新对象形态校验 variant/itemId 长度与类型） |
| `src/world/appearance/appearance-randomizer.ts` | **新文件**：三档规则化随机器（minimal / normal / full），常量逐条照抄旧码（跳过清单 92 项 / 盾白名单 / Human 头前缀 / 0.3 盾空率 / 0.5 可选空率）+ 新素材对齐补充（`MINIMAL_ALIGNED_SKIP_ITEMS` 条目级、`MINIMAL_SKIP_VARIANTS` 怪物肤色变体级、`MATERIAL_OWNING_CATEGORY` 素材正主） |
| `src/world/appearance/part-registry.ts` | `resolveSelections` 支持精确形态：带 itemId 先精确定位（存在 + 属于该类别 + 变体对齐），失败回落变体反查 |
| `src/world/objects/unit-object.ts` | `appearanceKey` 比较键带上 itemId（同变体不同素材 = 两张脸） |
| `src/hud/screens/onboarding-screen.ts` | **仅类型兼容最小修正**（两处读 `parts[...]` 处改走 `appearancePartVariant` helper），无功能改动 —— task_032 的功能改造不在此做 |
| `src/world/appearance/index.ts` | 出口补 `appearance-randomizer` |
| 测试 | `src/core/__tests__/appearance.test.ts`（+8 用例：两形态解析/校验/helper）、`src/world/appearance/__tests__/part-registry.test.ts`（+6 用例：itemId 精确定位/回落/变体对齐）、`src/world/appearance/__tests__/appearance-randomizer.test.ts`（**新**，21 用例） |

### 验证输出摘要
- `npm run typecheck` → **0 错误**
- `npx jest src/world src/core --silent` → **23 套件 / 459 测试全绿**（027 基线 415，本次 +44；无既有断言被修改 —— 旧形态行为不变，全部为新增用例）
- `npx jest --silent`（全仓）→ **109 套件 / 2473 通过**，零回归
- eslint（改动文件）→ 0 错误（repo 既有 1 个 lint error 在 `src/hud/screens/onboarding-screen.ts:55` import 分组，HEAD 上已存在，非本次引入，留给 task_032）

### 旧清单分类名 → 新元数据分类名映射
旧 `RANDOMIZATION_SKIP_CATEGORIES`（92 项）与新元数据 `item-metadata.json` 的 typeName 对照（脚本核对）：
- **直接命中 typeName：90 项**（wings / tail / weapon / shield / hat / beard / armour / gloves / dress / socks / wound_* / prosthesis_* / wrinkes[原拼写如此] 等）—— 名字原样保留，无映射转换
- **不存在于新元数据 typeName：2 项**
  - `sideburn` → 新素材无此类别（连腮胡并入 `beard`），清单保留无害（无命中）
  - `facial` → 它是**代码侧类别名**（PART_CATEGORIES 之一），新素材侧对应 typeName 为 `beard` / `mustache` / `eyebrows`（均在清单内）；`facial` 保留在清单里用于整类跳过（MINIMAL_SKIP_CATEGORIES）
- **新增对齐（旧清单没有，按新素材补）：**
  - 条目级 `MINIMAL_ALIGNED_SKIP_ITEMS`：`body_skeleton` / `body_zombie`（typeName 均为 body，类别级拦不住）、`eyes_cyclops`（typeName eyes）
  - 变体级 `MINIMAL_SKIP_VARIANTS`：`zombie` / `zombie_green` / `fur_*` 9 个（普通 `body` / `head_ears_*` 等人形素材的变体清单里混着怪物肤色，条目级拦不住）
  - 头部前缀：旧 `Human` → 新 `['Human', 'heads_human']`（新素材命名带 `heads_` 前缀）

### 口径说明（与旧码的三处有意差异）
1. 旧码把跳过清单跟**代码类别名**比，92 项里只有 9 项（cape/backpack/neck/shoulders/hat/quiver/shield/weapon/facial）真正生效，其余 83 项从未生效；新实现按 **typeName** 过滤让全清单生效（这才是"minimal = 平民脸"的本意），9 项交集另作整类跳过双保险。
2. normal 档盾牌空率照抄旧码 `Math.random() < 0.3 即空`（= 70% 带盾）；任务描述中"盾 70% 空"为笔误，以旧码为准。
3. minimal 档 `optionalEmptyChance=1` 在旧码是冗余（6 个可选类全在跳过清单里），新实现保留该值并同样冗余（行为一致）。

### 未尽事项
- 随机器尚未接线到组合根/任何 UI（onboarding 的"随机"按钮属 task_032；本任务只交付模块 + 注入式 API）
- `src/hud/screens/onboarding-screen.ts:55` 的既有 lint error（import 分组空行）未修 —— 属 task_032 范围
- 真实元数据里有 107 条素材带怪物变体（fur_*/zombie*），minimal 档已挡；normal/full 档按旧码口径不过滤变体（保持"全随机"语义）
