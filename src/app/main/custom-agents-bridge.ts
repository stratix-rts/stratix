/**
 * 文件职责：自定义 agent 注册端口（hud 侧 CustomAgentsPort）的**组合根接线件**（task_056）。
 *   与 cliChatIpcApi 同一手法：从 preload 暴露的 electronAPI.customAgents 取 IPC 面，
 *   包成 hud 屏能吃的形状注入（hud 不 import electron —— 铁律，见 custom-agents-port.ts）。
 *   非 Electron 环境（纯 vite dev / jest）没有 electronAPI → 返回 null，
 *   向导扫描步不显示「+ 添加自定义 agent」入口（降级而非报错）。
 * 输入：window.electronAPI.customAgents（preload 的 CustomAgentsIpcApi）。
 * 输出：hud 侧 CustomAgentsPort（形状做一层收口：IPC 返回的 any 在这里落到端口类型）。
 * 禁止事项：
 *   1. 在这里做业务校验 —— 白名单 / 查重 / 上限全在 core 纯校验 + 主进程 IPC 层（纵深防御）；
 *   2. 缓存结果 —— 每次调用现取（端口注入一次后长期持有，缓存无收益还多一层失效问题）。
 *
 * @since v3.32，task_056。
 */

import type { CustomAgentValidationCode } from '../../core/custom-agent';
import type {
  CustomAgentCreateResult,
  CustomAgentProbeResult,
  CustomAgentsPort,
  CustomAgentView,
} from '../../hud/screens/custom-agents-port';

/** preload 面的最小形状（这里的类型收口不 import electron/preload —— 两侧解耦）。 */
interface CustomAgentsIpcLike {
  list(): Promise<{ ok: boolean; agents?: unknown; error?: string }>;
  create(draft: unknown): Promise<{ ok: boolean; agent?: unknown; code?: string; error?: string }>;
  remove(id: string): Promise<{ ok: boolean; error?: string }>;
  probe(probeCmd: string): Promise<CustomAgentProbeResult & { ok: boolean }>;
}

/** 取 preload 上的注册面；非 Electron 环境（window 上没有 electronAPI）返回 null。 */
function customAgentsIpc(): CustomAgentsIpcLike | null {
  // globalThis 探测：node（jest）里 window 未定义，直接读会 ReferenceError。
  const scope: unknown = typeof window !== 'undefined' ? window : globalThis;
  const api = (scope as { electronAPI?: { customAgents?: CustomAgentsIpcLike } }).electronAPI;
  return api?.customAgents ?? null;
}

/** 把 preload 面包成 hud 端口（结果形状原地收口；失败路径透传错误码 / 文案）。 */
export function customAgentsIpcPort(): CustomAgentsPort | null {
  const api = customAgentsIpc();
  if (!api) return null;
  return {
    async list() {
      const result = await api.list();
      if (!result.ok || !Array.isArray(result.agents)) {
        return { ok: false, error: result.error ?? '读取自定义 agent 列表失败' };
      }
      return { ok: true, agents: result.agents as readonly CustomAgentView[] };
    },
    async create(draft) {
      const result = await api.create(draft);
      if (!result.ok) {
        return {
          ok: false,
          // 主进程的错误码就是 core 校验器的错误码（主进程直接回传 validateCustomAgentDraft 的 code）。
          code: result.code as CustomAgentValidationCode | undefined,
          error: result.error,
        } as CustomAgentCreateResult;
      }
      return { ok: true, agent: result.agent as CustomAgentView };
    },
    async remove(id) {
      return api.remove(id);
    },
    async probe(probeCmd) {
      return api.probe(probeCmd);
    },
  };
}
