# task_040: 养成曲线（exp/等级/解锁门槛）

## 描述
exp 权重表、等级曲线、外观解锁门槛数据；exp.gained 事件驱动角色升级，广播 level.up。

## 需求
1. core 新增 `src/core/progression/`：纯函数模块——EXP_TABLE（等级曲线：前快后慢，L1→2 需 100，约 ×1.5 递增至 L20 封顶）、EXP_SOURCES 权重表（task_completed=50 / chat_round=5 / task_failed=10 安慰奖）、UNLOCKS（按等级解锁部件类别：L1 body/head/hair/eyes/ears/facial 基础五类，L3 torso/legs/feet 服装，L5 hat/backpack，L8 weapon/shield/cape 武装，L12 全部稀有变体——门槛数据单文件常量，后续好调）
2. app 层订阅 exp.gained → 累加 → 升级判定 → level.up 广播 + 角色档案更新（走 033 落库）
3. 单测：曲线计算/升级边界（临界经验）/权重累计/解锁表完整性（等级单调、无空洞）

## 依赖
- 039（事件源）、033（落库）

## 验收标准
- [ ] tsc 零错误；npx jest 全绿
- [ ] progression 模块零依赖纯函数（core 内可测性优先）

## 验证方式
npm run typecheck && npx jest src/core --silent

---

## 验证结果（2026-10-24，执行：task_040 编码 agent）

- `npm run typecheck` ✅ 零错误
- `npx jest --silent` ✅ **126 suites / 2830 passed + 6 skipped（2836 total），0 失败**（039 基线 2775 → 净增 55：progression 41 + progression-service 14 + runtime level.up 接地 1 + world 词表对拍 2 − 移除/合并若干；无回归）
- 改动文件 `npx eslint --no-cache` 干净（main-entry.ts 的 15 条 import/order 为存量问题，前后数量不变）

### 落地内容
1. **src/core/progression/**（零依赖纯函数，ExpSource 为 type-only 引用）：
   - `curve.ts`：EXP_TABLE（L1→L19 跨度，round5(100×1.5^(L-1))：100/150/225/340/505/760/1140/1710/2565/3845/5765/8650/12975/19460/29195/43790/65685/98525/147790）、MAX_LEVEL=20、totalExpForLevel（L20 累计 443175）、expSpanForLevel、levelForExperience、experienceIntoLevel/ToNextLevel（随曲线迁入）、isMaxLevel、**levelUpCheck(level, exp) → {level, exp, leveledUp}**（跨多级一次结算、封顶溢出、对账降级）
   - `weights.ts`：EXP_WEIGHTS（50/10/5）+ expWeightFor（组合根注入件）
   - `unlocks.ts`：UNLOCK_KEYS（22 部件类别 + rare_variants 标记位）、UNLOCKS（L1 基础六件套 / L3 torso·legs·feet / L5 hat·backpack / L8 weapon·shield·cape / L12 补全 8 类 + rare_variants）、unlockedCategoriesAt（累计查询，顺序稳定）
   - `index.ts` 统一出口（同 character/index 惯例）
2. **WorldEvent 增 `level.up`**（characterId/fromLevel/toLevel；先落库后广播时序契约；runtime.handleWorldEvent 显式接地）；exp.gained 注释更新为「消费者已落地」
3. **app 层 progression-service**：订阅 exp.gained → character manager grantExperience（数值结算在 core：growth → progression.levelUpCheck）→ levelUps>0 则广播一条 level.up；不碰 IO，033 协调器 diff 落库自动跟随
4. **组合根（main-entry）**：character manager 显式创建注入 runtime + progression-service（同 taskManager 模式）；chat-service/task-service 注入 expWeight: expWeightFor（两服务零改动 ✅）；exp-config.ts 降级为**转发层**（选「转发」注明于文件头，退役时机已注明）
5. **growth.ts 瘦身**：只保留 CharacterView 状态机（grantExperience/错误码），数值全部委托 progression；HUD character-catalog 进度条分母按等级查表（expSpanForLevel）
6. 单测：`src/core/__tests__/progression.test.ts`（公式对拍/首档中段封顶溢出/跨多级/权重/解锁表完整性）、`src/app/__tests__/progression-service.test.ts`（累加落库/广播时机/时序/边角/迁移等价）、`src/world/__tests__/progression-unlocks.test.ts`（词表 ↔ PART_CATEGORIES 对拍防漂移）、runtime/character/character-screen 测试更新到新曲线口径

### 遗留/未尽事项
- 旧线性模型存档（Lv.5=400exp）下次加经验时被对账到新曲线档位（400→L3），对账机制自动处理、无迁移脚本（growth 文件头已注明）
- level.up 的 UI 消费（解锁 toast / 选择器灰显）归 task_041；本任务只交付数据与事件
