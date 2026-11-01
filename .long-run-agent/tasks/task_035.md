# task_035: 对话回路接线（chat-drawer ↔ CliTransport）

## 描述
组合根接线：抽屉发消息 → CliTransport（023 已交付五家 adapter）→ 流式回显。真·对话打通。

## 需求
1. app 层新服务 `chat-service`：管理 characterId→transport 会话映射（claude 用 --resume session，其余按各自 adapter 语义），组合根注入抽屉所需接口
2. 流程：用户发送 → 抽屉显示 user 气泡 → transport 发送 → 流式 chunk 回显 → finalize
3. 错误/中断：transport 失败 → 气泡内错误态+重试按钮；用户可中断（adapter 支持则 kill 进程，不支持则忽略后续 chunk）
4. agent 未检出/未安装的角色：发送时提示不可用
5. 单测：chat-service 会话映射/流式转发/错误重试（transport 打桩）；真机冒烟不强制（claude 在本机可选跑一次 pong 级验证）

## 上下文
- transport：`src/app/services/cli-transport/`（023，五家 adapter，注入 execFn 可测）
- 事件链：抽屉公开方法（034）由组合根桥接 chat-service

## 验收标准
- [ ] tsc 零错误；npx jest --silent 全绿
- [ ] 发送→流式回显→finalize 全链路单测覆盖
- [ ] 组合根接线完成，dev 下可真实对话（手测记录写任务文件）

## 验证方式
npm run typecheck && npx jest --silent

---

## 验证结果（2026-10-24，执行者：task_035 会话）

### 自动化
- `npm run typecheck`：0 错误（含 tests 工程 `typecheck:tests`）
- `npx jest --silent`：**115 套件 / 2622 通过 / 6 skipped / 0 失败**（基线 2598 → +24，无回归）
- 新增用例：
  - `src/app/__tests__/chat-service.test.ts`（19）：会话映射（首发 persona / 续发 sessionId / 回写恰一次）、
    流式转发顺序与 finalize 时机、空回复占位、错误气泡+retry 重发、transport 抛异常防御、
    中断（stop→AbortSignal→aborted→部分保留+标注）、未检出/未绑/无档案拦截、全局单飞锁、纯函数
  - `src/app/__tests__/chat-transport-bridge.test.ts`（5）：IPC 桥事件顺序/end 收尾/invoke 被拒降级/
    abort 按 runId 路由/跨轮次信封隔离/环境探测
  - `src/hud/__tests__/character-chat-drawer.test.ts` 追加（3）：错误气泡渲染+重试回调（含恶意 id 转义）、
    停止钮显隐+onStop、error 标记随消息落库

### 真机冒烟（claude，未跳过）
- `npm run smoke:chat-service`（新脚本，scripts/smoke-chat-service.ts）：claude 2.1.270 在机
- 输出：回复 `pong`；`finalize=true` `sending平衡=0` `回写=1` → **PASS**
- 覆盖路径：守门（detectedAgents 放行）→ persona 首发拼装 → 真 claude CLI → 流式转发 →
  finalize → session id 回写（恰好一次）。IPC 那一跳只在 Electron 内有意义，node 直连同一服务代码。

### dev 手测说明
- Electron dev（`npm run electron:dev`）下渲染层经 `electronAPI.cliChat`（新 IPC：chat:run / chat:abort /
  chat:event 信封）到主进程跑 transport，抽屉即可真实对话；
- 纯 vite dev（无 Electron）无 IPC 面 → 抽屉不接服务（hud-dev-entry 的 DEMO 假流仍覆盖该路径）。
