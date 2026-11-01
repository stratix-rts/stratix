# task_055 会话续接增强
## 需求
各家 CLI resume 语义校准：kimi 解析 JSON 拿 session id；openclaw 无 id 报错兜底；external_session_id 重启后透传策略复核。
## 要点
1. kimi adapter：--output-format json（或等价）模式解析 session id（035 差异表遗留）
2. openclaw adapter：无 meta.id 时的降级策略（--session-id 生成或每次新会话，实测定）
3. 重启恢复策略统一：有有效 id→透传 resume；无效→重建（重拼 persona+context）
4. 会话连续性验证用例进单测（各家 adapter 打桩）
## 验收
- kimi 两轮对话命中同一 session（实测日志证实）
- typecheck/jest 全绿

---

## 验证结果（2026-10-25，task_055 执行者）

### 各家实测结论表

| CLI | 实测方式 | 结论 |
|-----|---------|------|
| claude | 真机两轮（`-p <p> --resume <id> --output-format stream-json --verbose --permission-mode bypassPermissions`） | 两轮同 session id（078b6fff-1790-4f78-a13f-cb07ad1bb599）+ 暗号「红旗」记忆命中；adapter 命令拼写/参数顺序实证正确，**零改动** |
| codex | `which codex` 未检出 | 本机未装，无实证问题，**不臆改**（buildArgs 拼写与 --help 文档口径一致，单测钉死） |
| opencode | `opencode run --help` | `-s, --session <id>`「session id to continue」与 adapter 拼写一致，**零改动** |
| kimi | `kimi --help` + CLI 源码（cli/__init__.py、ui/print/visualize.py）+ 真机实跑 | ①`--print --output-format stream-json` 存在但**会话 id 不进 stdout**（JsonPrinter 只打内容/工具）；②id 唯一出口是 **stderr 尾行** `To resume this session: kimi -r <uuid>`（`_print_resume_hint`，成功/失败都打）；③真机两轮：r1 收割 id 6cf2a28d → r2 `--session` 透传回显**同一 id**（resume 命中）；④凭证过期（401，2026-07-22 过期）无法验证内容记忆——环境限制，链路证据闭环 |
| openclaw | 真机两轮（transport 全链路 + 手工） | ①`--session-id <id>` 支持自选 id：uuid 首发即建同名 session；②**实证 bug**：真实信封是 `{runId,status,result:{payloads,meta:{agentMeta:{sessionId}}}}`，旧 parser 只认顶层扁平信封 → 文本和 id 都解析不到（已修）；③两轮同 id + 暗号「蓝鲸号」记忆命中；④无路由参数时裸命令落 gateway 主会话（副作用）→ prepare 生成 uuid 隔离 |

### 真机日志摘录

```
===== kimi round 1 =====
[kimi-r1] message: Authorization failed. Your session may h…
[kimi-r1] session: 6cf2a28d-aaee-4793-957b-235750037c91   ← stderr 收割
[kimi-r1] error: …（401，非 0 退出，stderr 尾巴）
===== kimi round 2（--session 续接）=====
[kimi-r2] message: Authorization failed. …
[kimi-r2] error: To resume this session: kimi -r 6cf2a28d-aaee-4793-957b-2357…
→ r2 sessionId 与 r1 相同 = resume 命中

===== openclaw round 1（prepare 生成 uuid）=====
[oc-r1] message: 记住了
[oc-r1] done: 3f05d382-4b31-4a1f-b21d-1605578a3ddc        ← 生成的 uuid 回执
===== openclaw round 2（--session-id 续接）=====
[oc-r2] message: 蓝鲸号                                    ← 暗号记忆命中
[oc-r2] done: 3f05d382-4b31-4a1f-b21d-1605578a3ddc        ← 同一 session
```

### 改动文件

| 文件 | 改动 |
|------|------|
| src/app/services/cli-transport/transport.ts | CliAdapter 契约加可选 `parseStderrLine` 钩子（只许 session/error 事件） |
| src/app/services/cli-transport/runtime.ts | stderr 收割：泵里喂 parseStderrLine；exit 后先排干 stderr 再上送 session 事件（先于收尾 done/error） |
| src/app/services/cli-transport/adapters/kimi.ts | `parseKimiStderrLine`（正则收尾提示行）；头注释记调研结论（为何保持 text 模式） |
| src/app/services/cli-transport/adapters/openclaw.ts | parser 认 gateway 实测 result 包裹信封（文本 + agentMeta.sessionId）；prepare 无 sessionId/agentId 时生成 uuid 种子；头注释记实测依据 |
| src/app/services/cli-transport/index.ts | 出口加 parseKimiStderrLine |
| src/app/services/chat-service.ts | 重启恢复：runRound 首见角色时用档案 externalSessionId 种子（有效→透传 resume；空→首发重建）；差异表 + 统一口径注释 |
| src/app/services/agent-chat-service.ts | 头注释补互聊分支口径（回执与聊天共用字段不共享续接，重启首发重建）+ 单测钉死 |
| src/app/services/task-service.ts | 头注释复核注记（审批门两分支即统一口径，已有单测，零改动） |
| src/app/__tests__/cli-transport-adapters.test.ts | +7：kimi JSON 容错 / stderr 提示行 / openclaw result 信封 ×2 / prepare uuid ×2 / 三家 resume 回归 |
| src/app/__tests__/cli-transport.test.ts | +2：kimi stderr 收割端到端（成功轮 session 先于 done；失败轮 session 先于 error） |
| src/app/__tests__/chat-service.test.ts | 重写重启分支 ×2 + 种子一次性自愈（+1） |
| src/app/__tests__/agent-chat-service.test.ts | +1：互聊不种回执（首发重建口径钉死） |
| docs/AGENT-MATRIX.md | T1 表 Kimi/OpenClaw 行更新（task_055 实测结论） |

### 验证输出

```
npm run typecheck → tsc --noEmit（零输出，干净）
npx jest --silent  → Test Suites: 148 passed, 148 total
                    Tests: 6 skipped, 3321 passed, 3327 total
                    （基线 3309 → 3321，+12 新测试，零回归）
```

### 未尽事项

1. **kimi 凭证过期（401）**：无法完成成功对话的两轮内容记忆验证（环境限制，需 `kimi` 重新登录）；会话 id 链路已用失败轮真机闭环（stderr 收割 → 透传 → 同 id 回显）。
2. **codex 本机未装**：无法真机复核，保持文档口径（不臆改）。
3. **openclaw `--local` 路径**：--session-id 旗标被 CLI 接受但内嵌 agent 行为未实测（注释已注明，最坏退化每轮新会话，不劣于现状）。
4. **kimi 失败轮的 session 持久化**：401 失败轮的 session 事件照常入内存/回写（该 session 已在 CLI 侧建立且含首发指令），重试续发原文正确；若 CLI 未落上下文，下一轮新 id 自动自愈（chat-service 头注释已记）。
