# task_090 fix: 互聊超时三连修——CLI env 代理注入 + 回合超时可配 + 网络兜底指引

## 描述

用户实测互聊（Claude Code × OpenCode 聊「近期哪个模型更强」）触发 `调用超时:120000ms 无输出`。根因三连：① spawn 的 CLI 进程无代理 env（WebFetch/curl 外网黑洞，agent 空转重试零输出）② 互聊回合看门狗 120s 硬编码，研究型话题不够 ③ 开场 prompt 无「网络不可用凭已知作答」兜底。证据链：src/app/services/agent-chat-service.ts:136（DEFAULT_PEER_TURN_TIMEOUT_MS=120_000）、cli-transport/runtime.ts:68（env 原样透传 effective.env，无注入点配置）、adapters/claude.ts:149（bypassPermissions 已开，WebFetch 被拦是网络不是权限）。

## Requirements

1. **CLI env 注入（主修）**：cli-transport 的 spawn env 增加可配置注入口——按优先级：环境变量 `STRATIX_CLI_ENV`（JSON 串，如 `{"https_proxy":"http://127.0.0.1:7890","http_proxy":"http://127.0.0.1:7890"}`）> 主进程 env 的 https_proxy/http_proxy/all_proxy 透传 > 现状。改动点在 transport.ts 的 spawn options 组装层（CliSpawnOptions.env 已有字段，补一个统一的 env 组装函数），各 adapter 不动。**注意：只透传代理类变量，不无脑全量透传**（避免污染 CLI 自身配置）。单测：注入优先级三路径。
2. **回合超时可配**：DEFAULT_PEER_TURN_TIMEOUT_MS 保持 120s 为缺省，但接受 deps/配置覆盖（对齐 chat-service 的 timeoutMs 注入模式）；互聊组合根接线处暴露 `STRATIX_PEER_TURN_TIMEOUT_MS` 环境变量覆盖。单测：缺省值回归 + 覆盖生效。
3. **prompt 兜底指引**：互聊开场 prompt 模板加一条「若网络检索不可用或超时，直接凭你已有的知识作答并注明知识截止时间，不要反复重试网络」——改 agent-chat-service 的 prompt 组装处，一处改动。
4. **验证互聊恢复**：用 fake adapter 单测覆盖「首轮超时→标注→收束」既有行为不回归（__tests__/agent-chat-service.test.ts:436 用例不许破）。

## Acceptance

- [ ] env 注入三优先级单测绿；只透传代理类变量（grep 验证无 process.env 全量展开）
- [ ] timeoutMs 覆盖链单测绿；缺省 120s 回归绿
- [ ] 开场 prompt 含兜底指引（快照或断言）
- [ ] 既有互聊超时用例（agent-chat-service.test.ts:436）零回归
- [ ] npx tsc --noEmit 0 错 + npx jest 全绿

## deliverables

- src/app/services/cli-transport/（env 组装函数 + 单测）
- src/app/services/agent-chat-service.ts（超时注入 + prompt 指引）
- 组合根接线（main-entry 或等价处，STRATIX_PEER_TURN_TIMEOUT_MS）
