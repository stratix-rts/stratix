# task_071 app: chatHistoryApi 与 preload 方法名错配——聊天落库/历史读取全断

## 描述

**P0**。全回路走查实证：在 UI 里和 Kimi 聊天**发送/回复/流式渲染全部正常**（IPC transport 通道好），但消息**永远不落库、历史永远读不到**，且 console 报：

```
[Renderer error]: Uncaught TypeError: chatHistory.loadMessages is not a function
```

根因（前后端字段错配，System Zone 同款教训）：preload 的 `gameSave` 暴露的是 `saveChatMessage / loadChatMessages`（src/electron/preload.ts:305-306），而渲染层 `ChatHistoryApi` 接口叫 `saveMessage / loadMessages`（src/app/services/persistence/chat-history.ts:61-67）。`chatHistoryApi()` 把 gameSave 原样 `as ChatHistoryApi` 返回——两边名字对不上，调用即 TypeError。同域已核对：task-record（saveTask/loadTasks/loadTaskStats）与 exp-record（saveExpEvent/loadExpEvents/growthOverview）与 preload **完全匹配，仅聊天这一对错配**。落库侧（makeChatMessagePersister → api.saveMessage）同断，只是 fire-and-forget 吞掉了报错。

## 需求（requirements）

1. 修 `src/app/services/persistence/chat-history.ts` 的 `chatHistoryApi()`：不再原样透传，加适配层——
   - 探测 `electronAPI.gameSave` 是否有 `saveChatMessage` 与 `loadChatMessages`（preload 侧真名）
   - 有 → 返回适配对象：`{ saveMessage: (m) => raw.saveChatMessage(m), loadMessages: (id, limit) => raw.loadChatMessages(id, limit) }`
   - 没有（非 Electron / 面不全）→ 返回 null（维持既有降级语义）
   - 注释说明错配背景与适配原因
2. 补测试：现有 chat-history 测试文件里加用例——mock 出 preload 形状（saveChatMessage/loadChatMessages）的 `window.electronAPI.gameSave`，断言 `chatHistoryApi()` 非 null 且 `saveMessage`/`loadMessages` 正确委托到 preload 真名方法；面缺失时返回 null
3. 不动 preload / electron main / core（preload 的名字是对外契约，已在跑的 dist 不用重建）
4. 最小改动：只动 chat-history.ts + 对应测试文件

## 验收标准（acceptance）

- [ ] chatHistoryApi() 适配层落地 + 注释
- [ ] 委托与降级两路测试通过
- [ ] `npm run typecheck` 零错误
- [ ] `npx jest --silent` 全绿（3656 基线不回归）
- [ ] 不动 preload/main/core

## 交付物

- `src/app/services/persistence/chat-history.ts`：适配层
- 对应测试文件：委托 + 降级用例

## 禁止事项

- 不改 preload / src/electron（避免重建 dist 链）
- 不改 ChatHistoryApi 接口形状（消费方多）
- 不 mock 数据绕过、不引入新依赖

## 验证方式

```bash
npm run typecheck && npx jest --silent
```

## 验证证据（完成前必填）

- [x] **实现证明**: `src/app/services/persistence/chat-history.ts` 新增 `ChatHistoryRawFace`（描述 preload 真名
  `saveChatMessage` / `loadChatMessages`），`chatHistoryApi()` 改为探测原始面：两条通道都是函数 → 返回委托适配器
  （`saveMessage → rawSave.call(gameSave, message)`、`loadMessages → rawLoad.call(gameSave, characterId, limit)`）；
  gameSave 不存在 / 面不全（只有写或只有读）→ 返回 null（维持非 Electron 降级语义）。
  `ChatHistoryApi` 端口形状未改，`makeChatMessagePersister` 与组合根 main-entry.ts 的调用点零改动。
- [x] **测试验证**: 命令输出见下（typecheck 零错误；jest 168 suites / 3662 passed / 6 skipped，无回归）
- [x] **影响范围**: 仅 2 个文件 —— `src/app/services/persistence/chat-history.ts`（适配层 + 注释）、
  `src/app/__tests__/persistence/chat-history.test.ts`（委托 + 降级两路用例）。未动 preload / electron main / core；
  未改接口形状；未引入新依赖；无 mock 数据绕过（用例 mock 的是 preload 真实方法名）。

### 测试步骤
1. npm run typecheck
2. npx jest --silent

### 验证结果

```
> stratix@0.1.0 typecheck
> tsc --noEmit
（零错误）

Test Suites: 168 passed, 168 total
Tests:       6 skipped, 3662 passed, 3668 total
Snapshots:   0 total
Time:        23.098 s

# 定向（chat-history.test.ts）
  chatHistoryApi：preload 面适配（task_071）
    ✓ 无 electronAPI（node / 纯 vite dev）→ null；窗口常量 50
    ✓ preload 形状（saveChatMessage / loadChatMessages）→ 端口方法一一委托到原始面
    ✓ loadMessages 不带 limit → 透传 undefined（主进程按缺省 50 兜底）
    ✓ 面缺失 → null（非 Electron 降级语义）：无 gameSave / 只有写通道 / 只有读通道
Tests:       13 passed, 13 total
```

补充说明（运行时生效路径）：渲染层在 `electron:dev` 下由 vite dev server 直接供源，改动即时生效；
`dist/` 是 gitignore 的本地产物，本任务未触碰 `src/electron`，无需重建 dist/electron。
