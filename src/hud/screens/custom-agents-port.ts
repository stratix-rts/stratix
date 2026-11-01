/**
 * 文件职责：自定义 agent 注册的**hud 侧端口**（task_056）—— 向导扫描步「+ 添加自定义 agent」
 *   表单与设置屏注册管理需要的最小 IPC 能力面（list / create / remove / probe）。
 *   与 appearance-preview-port 同一手法：hud 不 import electron/app（铁律），组合根
 *   （app/main/main-entry）拿 preload 的 customAgents 面拼出这个形状注入进来。
 *   非 Electron 环境没有这个面 —— 缺省不注入 = 向导不显示注册入口 / 设置不显示注册组
 *   （降级而非报错：纯 vite dev 里向导照常能走完内置五家的流程）。
 *
 * 端口形状与 preload 的 CustomAgentsIpcApi 语义一致但**不共享类型**：两边本就该解耦
 *   （preload 依赖 electron 模块，hud 侧类型重复一份反而更清楚 —— 与 main-entry 的
 *   AgentDetectionApi 同一口径）。注册草案的合法性校验（core/custom-agent.ts）在 hud
 *   侧先拦一道（表单内联提示），主进程侧再拦一道（纵深防御）。
 *
 * @since v3.32（task_056）。
 */

import type { CustomAgentOutputParser, CustomAgentValidationCode } from '../../core/custom-agent';

/** 一条注册的展示行（list 的返回元素；kind = `custom:<id>` 由 id 派生）。 */
export interface CustomAgentView {
  readonly id: string;
  readonly name: string;
  readonly probeCmd: string;
  readonly runCmdTemplate: string;
  readonly outputParser: CustomAgentOutputParser;
  readonly createdAt: number;
}

/** 注册草案（表单收集值；合法性由 core 的 validateCustomAgentDraft 裁决）。 */
export interface CustomAgentDraftInput {
  readonly name: string;
  readonly probeCmd: string;
  readonly runCmdTemplate: string;
  readonly outputParser: CustomAgentOutputParser;
}

/** create 的结果：成功带注册行；失败带机器可读错误码（表单映射内联提示）或人话 error。 */
export type CustomAgentCreateResult =
  | { readonly ok: true; readonly agent: CustomAgentView }
  | { readonly ok: false; readonly code?: CustomAgentValidationCode; readonly error?: string };

/** 「测试」按钮的结果：命令跑通与否 + 退出码 + 输出摘要（表单里回显给用户看）。 */
export interface CustomAgentProbeResult {
  readonly ok: boolean;
  readonly installed?: boolean;
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly error?: string;
}

/** 向导 / 设置屏消费的注册面。 */
export interface CustomAgentsPort {
  list(): Promise<{ readonly ok: boolean; readonly agents?: readonly CustomAgentView[]; readonly error?: string }>;
  create(draft: CustomAgentDraftInput): Promise<CustomAgentCreateResult>;
  remove(id: string): Promise<{ readonly ok: boolean; readonly error?: string }>;
  probe(probeCmd: string): Promise<CustomAgentProbeResult>;
}
