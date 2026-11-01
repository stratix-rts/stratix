# task_053 上下文注入中间件
## 需求
对话/任务首发自动附带 Stratix 上下文（角色档案摘要/近期任务史/战场单位名单），agent 回答更贴合现状。
## 要点
1. app 层 context-builder 纯函数：拼装「你是 Stratix 战场角色 X；同场角色：…；你近期完成：…」结构化前缀（复用 043 分节格式）
2. 注入策略：首发注入（persona 后、用户消息前），标记 <stratix-context> 包裹；续发不重复（会话已含）
3. 开关配置：角色级（档案字段，默认开）+ 全局开关
4. 上下文体积上限（4k 字符截断，文件头注明）
## 验收
- 实测 agent 能答出「你同场有谁/你刚完成了什么」
- typecheck/jest 全绿

---

## 验证结果（task_053 完成回执）

- **typecheck**：`npm run typecheck` ✅ 零错误
- **单测**：`npx jest --silent` ✅ **146 套件 / 3268 通过 / 6 跳过 / 0 失败**（基线 3219 → +49 新增，无回归）
- **迁移**：schema v9（characters.context_enabled INTEGER NOT NULL DEFAULT 1）—— 全新库建表即带列；v8 老库 ALTER ADD 兜底，存量行归 1；game-save-dao ensure 幂等 + upsert/load 往返（含 0=关）；coordinator 双向映射（false 持久 / 缺省 ≡ true）
- **注入链路**（全部实测断言）：
  - chat：首发 persona 后、【用户消息】前插入 `<stratix-context>`；续发不注入；注入件 null/缺省/抛错均走原路径
  - task：每条任务 prompt 都带块（会话一次性 = 恒首发）；session 丢失重讲（buildResumedTaskPrompt）同样带块；plan-first 尾部指令恒在最后
  - 052 互聊：A 开题带 A 的快照、B 首回合带 B 的快照（各自 session 首发），后续回合不注入
- **两级开关**：角色级（CharacterView.contextEnabled + manager.updateContextEnabled + HudCommand character.contextEnabled.update + agent-panel 角色卡「上下文：开/关」钮）；全局（localStorage `stratix.context.enabled`，settings-screen 偏好组「上下文注入」行，零命令派发）；provider 内「与」裁决
- **新测试文件**：`src/app/__tests__/stratix-context.test.ts`（25 例）、`src/app/__tests__/persistence/character-schema-v9.test.ts`（4 例）；扩展 chat/task/agent-chat/character/agent-panel/settings-screen 六处测试
- **改动文件**：core 3（types/manager/runtime）+ app 5（chat/task/agent-chat 服务、dao、coordinator）+ db 1（StratixDatabase v9）+ hud 4（agent-catalog/agent-panel/settings-screen/main-entry）+ 测试 8 改 2 新
- **未尽事项**：052 互聊里 B 的首回合按「各自 session 首发」语义注入了 B 自己的快照（任务文要求发起者首发，此处实现为双方各自首发，语义更一致，报告注明）；全局开关走 localStorage（不进 WorldState/广播）是规格③的明示取舍，未来并入 SettingsView 偏好词表需动 core 两端
