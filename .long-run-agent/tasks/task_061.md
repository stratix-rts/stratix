# task_061 角色成长看板
## 需求
数据可视化：exp 曲线/任务完成率/对话统计/成长履历时间线。
## 要点
1. 看板屏（hud 新 screen 或角色屏扩展）：单角色视图+全场总览
2. 数据源：characters/character_tasks/character_chat_messages 聚合查询（SQL DAO 扩展）
3. 图表纯 canvas/WebComponents 实现（不引库）：exp 折线/任务状态分布条/近 7 天活动热力
4. 履历时间线：建档→升级→任务里程碑（取 character_tasks 完成记录）
## 验收
- 看板数据与库一致（打桩测试）；空数据显示引导语不空白
- typecheck/jest 全绿

## 实施记录（2026-10-26）
### 落地形态
角色屏编辑中心第四 tab「成长」（三 tab → 四 tab，059 结构迁移成本最低）+ 全场总览排行（角色卡区升级：四键排序切换 + 卡面统计行）。

### 数据真相源（规格钦点的新表）
- **exp_events 表（schema v12）**：exp 变更此前无历史表（characters 只有当前快照），曲线 / 热力 / 时间线需要时间序真相源。写入面 = progression-service 新增 persistExpEvent 注入件（每条 exp.gained 落来源行；升级结算补 level_up 里程碑行 delta=0/level=升级后等级）；渲染侧端口 exp-record.ts（fire-and-forget，落库失败只警告不打断养成回路）。
- **全场总览**：DAO aggregateCharacterActivity（character_chat_messages ∪ character_tasks ∪ exp_events 三源 UNION ALL 按 character_id GROUP BY，LEFT JOIN characters 补建档时刻）；任务六态计数复用既有 game:taskStats（task_050），不新开真相源。

### 改动文件
新增：
- src/app/services/persistence/exp-event-dao.ts（DAO：建表/插入/近窗读/全场聚合）
- src/app/services/persistence/exp-record.ts（渲染侧 IPC 端口 + persister + makeGrowthStatsPort）
- src/hud/screens/growth-catalog.ts（纯函数目录：exp 曲线逐日桶/里程碑/热力/四键排行/时间线/相对时刻）
- src/hud/components/growth-chart/growth-chart.ts（纯 canvas 折线组件：网格+折线+里程碑标记+悬浮值，057 minimap 同范式）
- 测试 ×7：exp-event-dao / exp-schema-v12 / exp-record / progression-exp-persist（app）；growth-catalog / growth-chart / character-growth-tab（hud，jsdom canvas mock 同 minimap）
修改：
- src/stratix-database/StratixDatabase.ts（TARGET_SCHEMA_VERSION 12 + migrateExpEvents）
- src/electron/main.ts（game:saveExpEvent / game:loadExpEvents / game:growthOverview 三通道，形状校验从严）
- src/electron/preload.ts（gameSave 扩展三条）
- src/app/services/progression-service.ts（persistExpEvent 可选注入件，先落库后广播）
- src/app/main/main-entry.ts（persister 注入 + growth 口注入主屏）
- src/hud/screens/character-screen.ts（成长 tab 四区块：曲线/六态分布条/7 天热力/时间线；排行切换；统计行三档降级；空态引导语；ensureGrowthData 节流取数，首败即停防死循环）
- src/hud/screens/main-screen.ts（options.growth 透传）
- 6 个既有 schema 测试的目标版本断言 11→12（版本号随目标 schema 走的既有惯例）

### 数据源说明
- 曲线：exp_events 近 30 天逐日桶（本地时区日历日；窗口内累计增量，跨窗口积累不体现在曲线起点）
- 里程碑：exp_events reason='level_up' 行；热力：近 7 天逐日事件条数（任务终态与成功对话轮权重恒>0 必落事件，计条数即计活动）
- 时间线：characters.created_at（建档）+ level_up + character_tasks 终态（endedAt）
- 存量数据（v12 前的历史）不在 exp_events 里：曲线 / 热力自升级后开始积累（规格确认的轻量方案）；六态计数 / 排行覆盖全部历史（走 character_tasks / characters）

### 验证结果
- `npm run typecheck`：通过（0 错误）
- `npx jest --silent`：**167 suites 全绿，3620 passed / 6 skipped，0 failed**（基线 3568 → 3620，新增 52 测试，无回归）
- 已知取舍：里程碑单日多次升级在曲线上同格标记；热力选日粒度（规格允许 7×24 或日粒度二选一）；overview 首败即停（避免 null→forceRerender→重拉死循环，换端口才重试）
