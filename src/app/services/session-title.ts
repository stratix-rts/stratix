/**
 * 文件职责：**会话自动起名的服务实现与组合根注入口**（@since v3.47，task_104 / v3.2b-B5）——
 *   把"起名素材 → 起名实现 → 会话标题写回"这条链串起来，且**不阻塞主流程**。
 * 方案来源：docs/SESSION-PLAN.md §8「peer_chat 首轮 / task_run 创建时异步起名接线」。
 * 输入：TitleProvider（起名实现）+ SessionManager（会话写入面）/ env（起名后端配置）。
 * 输出：会话标题被更新（WorldState.sessions 里的那条记录）。
 * 禁止事项：
 *   1. 直接写 WorldState —— 写面在 core/session 的 manager.updateTitle
 *      （service 独占写铁律：一份写面）；
 *   2. 让起名**阻塞**调用方 —— 调用方是互聊开场 / 任务开工，那两条路都不该为一条标题等网络
 *      （本模块的 retitle 是"点火即走"，调用方 `void` 掉即可）；
 *   3. 抛异常打断主流程 —— 起名失败只记日志（起名是旁路，不是主角）。
 *
 * ============ 三态口径（见 llm-title-provider.ts）============
 *   env 三件套齐全 → LLM 版起名；缺任一 → 规则版（行为与 2a 逐字一致）。
 *
 * @since v3.47，task_104（v3.2b-B5）。
 */

import type { SessionManager, SessionTitleService, TitleProvider, TitleSeed } from '../../core/session';

import { createTitleProviderFromEnv, type TitleProviderFactoryOptions } from './llm-title-provider';

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 造自动起名服务（起名实现 + 会话写入面 → 一个口）。
 */
export function createSessionTitleService(options: {
  /** 会话写入面（改标题的唯一写面）。 */
  readonly sessions: SessionManager;
  /** 起名实现（规则版 / LLM 版）。 */
  readonly provider: TitleProvider;
  /** 日志口；缺省静默。 */
  readonly logger?: (line: string) => void;
}): SessionTitleService {
  const { sessions, provider } = options;
  const logger = options.logger ?? ((): void => { /* 缺省静默 */ });

  return {
    async retitle(sessionId: string, seed: TitleSeed): Promise<void> {
      try {
        const title = await provider.generate(seed);
        if (typeof title !== 'string' || title.trim().length === 0) return;
        // 写回走会话域的显式方法（同名不改 → 无 env 配置时这里等于什么都没发生）。
        sessions.updateTitle(sessionId, title);
      } catch (error) {
        logger(`[session-title] 自动起名失败（${sessionId}）：${describe(error)}`);
      }
    },
  };
}

/**
 * 组合根的注入口（@since v3.47，task_104）—— 按 env 选起名实现，再组装成服务口。
 *
 * why 收在一个函数里：组合根只该知道"配没配 LLM 起名"，不该知道有几种实现、
 *   也不该自己拼 provider 与 service 两层（那是两份真相：起名实现与写回逻辑各写一遍必然漂移）。
 */
export function createSessionTitleServiceFromEnv(options: {
  /** 会话写入面。 */
  readonly sessions: SessionManager;
  /** env 来源；缺省读进程 env（渲染层读不到 → 视为"没配" → 规则版）。 */
  readonly env?: Record<string, string | undefined>;
  /** fetch 替身（单测注入）。 */
  readonly fetchImpl?: TitleProviderFactoryOptions['fetchImpl'];
  /** 日志口；缺省静默。 */
  readonly logger?: (line: string) => void;
  /** 请求超时（ms）。 */
  readonly timeoutMs?: number;
}): SessionTitleService {
  const provider = createTitleProviderFromEnv({
    ...(options.env ? { env: options.env } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.logger ? { logger: options.logger } : {}),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
  return createSessionTitleService({
    sessions: options.sessions,
    provider,
    ...(options.logger ? { logger: options.logger } : {}),
  });
}
