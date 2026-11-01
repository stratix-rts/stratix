# task_046 任务实时输出流
## 需求
任务 running 时点击单位（或任务面板）可实时查看 CLI 流式输出（tail 视图），不是黑盒等结果。
## 要点
1. task-service 已有流式 chunk（复用 chat IPC 管道），新增 world/任务面板消费：busy 单位点击 → 底部/侧边输出面板实时滚动
2. 输出面板：自动滚底+暂停跟随按钮+行数上限（防内存爆）
3. 任务完成后面板显示「已完成」并可展开全文（与 📋 报告一致）
4. busy 单位头顶加「查看进度」暗示（点击行为优先级高于抽屉，看 034 冲突裁决）
## 验收
- 派任务后点击干活单位能看到实时输出流
- 完成后输出保留可回看
- typecheck/jest 全绿（2914 基线）

---

## 实施记录（task_046，2026-10-25）

### 改动文件
| 文件 | 变更 |
|------|------|
| `src/hud/components/task-output/task-output-catalog.ts` | 新增：纯逻辑 —— 每角色输出缓冲（32k 截头保尾常量 `MAX_TASK_OUTPUT_BUFFER_CHARS`）、begin/append/clear、`latestTaskFor`/`resolveTaskOutputDisplay` 视图模型合成、相位词表 |
| `src/hud/components/task-output/task-output-panel.ts` | 新增：`<strat-task-output-panel>` Web Component —— 折叠区（头部徽标/截断提示/跟随钮 + 滚动输出区）、`appendTaskOutput(characterId, chunk)` 流式端口、开工对账清空重开、跟随/追平、textContent 直写零 XSS |
| `src/hud/components/chat-drawer/chat-drawer.ts` | 修改：头部与消息区之间嵌挂任务输出面板（rail 行 `auto auto 1fr auto`）、转发 subscribe、open/setCharacter 同步 showFor、公开 `taskOutput` 引用 |
| `src/app/services/task-service.ts` | 修改：新端口 `onTaskChunk(characterId, chunk)` —— message 事件文本原序转发，fire-and-forget（抛错只记日志） |
| `src/app/main/main-entry.ts` | 修改：组合根接线 `onTaskChunk → taskOutputView.appendTaskOutput`（无 Electron 时端口不接，行为退回 038） |
| `src/hud/README.md` | 修改：components 清单补 task-output 条目 |
| `src/hud/__tests__/task-output-catalog.test.ts` | 新增：20 例（顺序/截断/完成保留/清空时机/视图模型合成） |
| `src/hud/__tests__/task-output-panel.test.ts` | 新增：18 例（可见性/默认展开/实时流/XSS/暂停跟随不丢数据+追平/完成保留/清空重开/卸载退订） |
| `src/hud/__tests__/character-chat-drawer.test.ts` | 修改：订阅计数 1→2（嵌挂面板同源订阅）+ 嵌挂集成 1 例 |
| `src/app/__tests__/task-service.test.ts` | 修改：新增 5 例（原序转发/事件过滤/多角色归属/回调抛错不绑架/守门零转发） |

### 关键裁决
- **冲突裁决（需求①）**：不另开面板抢「点单位」语义 —— 034 抽屉头部下挂折叠区，嵌挂 Web Component（`<strat-task-output-panel>`）在 chat-drawer 的 shadow DOM 内，流式渲染只动输出区 textContent（与 chat-drawer 的 updateStreamBubble 同一 perf 口径）。
- **两份真相分工**：相位读 WorldState.tasks（core 单一真相源）；流文本不进状态（状态只存 ≤2k 摘要），由面板持有的 TaskOutputStore 缓冲（32k 截头保尾，全文在 SQLite tasks 表）。
- **开工对账**：状态里出现 running 且缓冲 taskId 对不上 → `begin` 清空重开（需求③「下次派发」落点）；同 taskId 重复广播不清；chunk 先到的占位缓冲被认领不清（时序防御）。
- **完成态回看**：completed/failed 后缓冲原样保留 + 徽标换代；守门失败（从未 running、无缓冲）回落状态里的失败原因文本。
- **暂停跟随**：暂停期间缓冲照收 DOM 照更（不丢数据），恢复即追平滚底一次（scrollSyncs 观察口可断言）；新任务开工时跟随/展开复位。

### 验证结果
```
$ npm run typecheck
> tsc --noEmit
（无输出，退出码 0）

$ npx jest --silent
Test Suites: 131 passed, 131 total   （基线 129 + 新增 2）
Tests:       6 skipped, 2958 passed, 2964 total   （基线 2914 → +44，无回归）
```

### 未尽事项
- 需求④（world 侧头顶环脉动）：按任务指令明确不做，038 现状保持。
- 完成态的「全文」回看是流式尾部窗口（≤32k）；跨会话（应用重启后）的完整全文走 SQLite tasks 表 + 📋 报告消息，面板回落 ≤2k 摘要 —— 如需跨会话全文回看可后续接 task-record DAO 按需加载。
- 按需向后翻页（滚动到顶加载更早输出）未做：缓冲本身截头保尾，翻页需读库，与 chat 历史分页（036 后置项）同一后置口径。
