# 本地 CLI Agent 能力矩阵（v3.x 首启引导调研）

> 调研时间：2026-10-22 · 用途：首启引导「本地 agent 检测 + 注册 + 对话桥」的设计输入
> 原则：只收录**本机可实际调用**（headless 非交互）且**对话可回收展示**的 CLI；无法回收输出的不进 T1/T2。

## T1 深度适配（流式 + 会话恢复 + 结构化输出）

| Agent | 检测命令 | headless 调用 | 会话恢复 | 结构化输出 | 备注 |
|-------|---------|--------------|---------|-----------|------|
| Claude Code | `which claude` / `claude --version` | `claude -p "<prompt>" --permission-mode bypassPermissions` | `--resume <session-id>` | `--output-format stream-json`（逐事件 JSONL） | 2026-10-21 全天实战验证；环境变量 `CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1` 规避代理模型警告 |
| Codex CLI | `which codex` | `codex exec "<prompt>"` | `codex exec resume <id>` / `codex resume` | `--json`（JSONL 事件流） | OpenAI 官方，⭐130k；exec 子命令即 headless 模式 |
| OpenCode | `which opencode` | `opencode run -m <model> "<prompt>"` | session 天然持久（server 管理） | `opencode serve` 本地 HTTP API（最佳路径） | 本机装过 v1.2.6；server 模式免 spawn，REST 天然适配 gateway |
| Kimi CLI | `which kimi` / `kimi --version` | `kimi --yolo --prompt "<prompt>"` | `--session <id>` / `-C` 继续 | 文本输出（结构化弱） | 本机 v1.39 实测；100 步上限后需 `--session` resume；Ralph Loop 模式可用 |
| OpenClaw | `which openclaw` / `openclaw status` | sessions API（本机 gateway） | 原生 session 体系 | REST/WS | 已有 `stratix-openclaw-adapter` 协议基础（task_007 参考源） |

## T2 基础适配（headless 可用，会话/结构化能力有限）

| Agent | 检测 | headless | 备注 |
|-------|------|----------|------|
| Gemini CLI | `which gemini` | `gemini -p "<prompt>" --output-format json` | `-c` 续聊；Google 账号鉴权 |
| Qwen Code | `which qwen` | `qwen -p "<prompt>"` | gemini-cli 分支，flags 基本同构 |
| Crush | `which crush` | `crush -m "<msg>"` | charmbracelet，⭐28.7k |
| Goose | `which goose` | `goose run "<prompt>" --json --session-id <id>` | block 出品，会话 ID 显式管理 |

## T3 仅探测注册（展示「即将支持」）

Aider（`which aider`，`--message` 单轮，历史走文件）、GitHub Copilot CLI（`which copilot`）、Amp 等。

## 集成要点（给 T-03 CLI transport 的输入）

1. **统一抽象**：`CliTransport.spawn(prompt, {session?}) → AsyncIterable<TransportEvent>`；事件归一化为 `{type: 'message'|'tool_use'|'done'|'error', ...}`，各家 adapter 负责翻译自家格式。
2. **Claude/Codex stream-json**：逐行 JSONL，`type` 字段区分 assistant/tool/result 事件，最易归一。
3. **OpenCode 特例**：优先走 `opencode serve` HTTP API（免子进程管理），检测 serve 端口失败再降级 `run` spawn。
4. **会话标识**：各家 session id 语义不同（claude uuid / codex rollup / kimi session id），AgentProfile 里存 `externalSessionId` 原样透传。
5. **超时与取消**：spawn 场景必须有 kill 路径（AbortSignal → tree-kill），参考 2026-10-21 worker 20min 超时管理经验。
6. **持久化**：ChatMessage 走 core bus → chat-drawer 展示 → gateway SQLite（stratix.db 已有数据层）。

## 开源参考

- **claude-code-sdk**（Anthropic 官方 TS/Python）：spawn + stream-json 解析的参考实现
- **sst/opencode**：provider/adapter 分层架构 + 本地 server 模式
- **claude-squad**：tmux 多 agent 会话管理（会话生命周期参考）
- **stravu/crystal**：多 agent 工作区编排

## 检测策略

- 启动时对名单逐个 `which` + `--version`（10s 超时），结果写 `WorldState.detectedAgents` + gateway 缓存
- 开发期：每次启动重扫；正式版：首启扫 + 设置屏「重新扫描」按钮
