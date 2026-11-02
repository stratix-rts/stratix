/**
 * 文件职责：**LLM 自动起名实现**（@since v3.47，task_104 / v3.2b-B5）——
 *   用 OpenAI 兼容的 chat completions 端点起一条会话标题；失败**静默回退**规则版。
 * 方案来源：docs/SESSION-PLAN.md §8「title provider 端口注入：LLM 实现（OpenAI 兼容，
 *   env：SX_TITLE_LLM_URL/SX_TITLE_LLM_KEY/SX_TITLE_LLM_MODEL，任一缺失回退规则版）——不引入硬依赖」。
 * 输入：TitleSeed（起名素材）+ env 配置（URL / Key / 模型）。
 * 输出：标题字符串（≤ 标题上限）。
 * 禁止事项：
 *   1. 引入新依赖 —— 只用全局 fetch（不引 SDK：不引依赖是方案明写的要求）；
 *   2. 在起名失败时抛异常 —— 起名是**旁路**：起不出名不该打断互聊开场 / 任务执行
 *      （失败静默回退规则版并记一行日志）；
 *   3. 直接写 WorldState —— 写面在 core/session 的 manager（service 独占写铁律）；
 *   4. 绕开 env 口径硬编码端点 / Key —— 端点与凭据一律来自 env（本地配置，不进仓库）。
 *
 * ============ 三态口径 ============
 *   env 三件套**齐全** → LlmTitleProvider（失败静默回退规则版）；
 *   env 三件套**缺任一** → RulesTitleProvider（行为与 2a 完全一致，一个字节都不差）。
 *   why 缺一即回退而不是"缺一就用其余的"：三件套是一组（端点 + 凭据 + 模型），
 *   少任何一件都说明用户**没打算**启用 LLM 起名（多半是只配了其中一个），
 *   硬着头皮发请求只会得到一串 401/404，然后静默回退 —— 白花一次网络往返。
 *
 * ============ 端点口径 ============
 *   SX_TITLE_LLM_URL 可以给**完整 chat completions 端点**（推荐，如
 *   `https://api.openai.com/v1/chat/completions`）；
 *   若给的是 base URL 且以 `/v1` 结尾，则自动补 `/chat/completions`
 *   （少写一段是这类配置最常见的错法；补全只是**拼路径**，不改变端点语义）。
 *
 * @since v3.47，task_104（v3.2b-B5）。
 */

import {
  capSessionTitle,
  createRulesTitleProvider,
  sessionKindLabel,
  type TitleProvider,
  type TitleSeed,
} from '../../core/session';

/** env 键名：chat completions 端点。 */
export const TITLE_LLM_URL_ENV = 'SX_TITLE_LLM_URL';
/** env 键名：凭据（Bearer）。 */
export const TITLE_LLM_KEY_ENV = 'SX_TITLE_LLM_KEY';
/** env 键名：模型名。 */
export const TITLE_LLM_MODEL_ENV = 'SX_TITLE_LLM_MODEL';

/** 请求超时（ms）。why 8s：起名是后台旁路，宁可慢一点也不许把会话卡住。 */
export const DEFAULT_TITLE_LLM_TIMEOUT_MS = 8_000;

/** 送给模型的素材长度上限（码点）—— 首条消息可能很长，截了再送（省 token 也防超长 prompt）。 */
const MAX_PROMPT_BODY_LEN = 400;

/** 提示词里的模型名（不改配置，只说明是"中文优先"的会话标题）。 */
const TITLE_SYSTEM_PROMPT = [
  '你是一个会话标题生成器。根据用户给出的会话素材，起一个**不超过 20 个字**的标题。',
  '要求：',
  '1) 只输出标题本身，不要解释、不要前后缀引号、不要以句号/问号结尾；',
  '2) 用与素材相同的语言；',
  '3) 概括会话正在聊的主题，具体到能一眼认出是哪件事，不要写“会话”“对话”之类的空词；',
  '4) 素材太少时，用素材里已有的信息起一个保守但具体的标题，不要编造内容。',
].join('\n');

/** LLM 起名的配置（三件套齐全才有 LLM 版）。 */
export interface TitleLlmConfig {
  /** chat completions 端点。 */
  readonly url: string;
  /** 凭据（Bearer）。 */
  readonly key: string;
  /** 模型名。 */
  readonly model: string;
}

/**
 * 解析 env 里的 LLM 起名配置 —— **三件套齐全才返回配置**，缺任一返回 null（回退规则版）。
 *
 * why 要 trim：env 里常见的坑是 `SX_TITLE_LLM_URL=" "`（引号没去掉 / 换行残留），
 *   那种"有值"其实是没配 —— 按没配处理（回退规则版）才是对的。
 */
export function resolveTitleLlmConfig(
  env: Record<string, string | undefined>
): TitleLlmConfig | null {
  const url = env[TITLE_LLM_URL_ENV]?.trim() ?? '';
  const key = env[TITLE_LLM_KEY_ENV]?.trim() ?? '';
  const model = env[TITLE_LLM_MODEL_ENV]?.trim() ?? '';
  if (url.length === 0 || key.length === 0 || model.length === 0) return null;
  return { url, key, model };
}

/** fetch 替身的形状（单测注入用；与 app/services/session-history 同一口径）。 */
export type TitleFetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

export interface LlmTitleProviderOptions {
  /** 配置（三件套齐全）。 */
  readonly config: TitleLlmConfig;
  /** fetch 替身（单测注入）；缺省用全局 fetch。 */
  readonly fetchImpl?: TitleFetchImpl;
  /** 日志口；缺省静默。 */
  readonly logger?: (line: string) => void;
  /** 请求超时（ms）；缺省 DEFAULT_TITLE_LLM_TIMEOUT_MS。 */
  readonly timeoutMs?: number;
  /** 失败回退的实现；缺省 = 规则版。 */
  readonly fallback?: TitleProvider;
}

/**
 * 端点补全：base URL（以 /v1 结尾）→ 补 /chat/completions；其余原样使用。
 */
function chatCompletionsUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed.includes('/chat/completions')) return trimmed;
  return trimmed.endsWith('/v1') ? `${trimmed}/chat/completions` : trimmed;
}

/**
 * 收拾模型给的标题：压空白 → 去首尾引号 → 去句末标点 → 截到上限。
 * why 要收拾：模型爱给「"北门加固方案"。」这种带壳的输出，直接用会带着壳进界面。
 */
export function cleanLlmTitle(raw: string): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  const unquoted = collapsed.replace(/^["'“”‘’「」`]+/, '').replace(/["'“”‘’「」`]+$/, '').trim();
  const withoutTail = unquoted.replace(/[。．.，,；;：:！!？?、\s]+$/u, '').trim();
  const title = withoutTail.length > 0 ? withoutTail : unquoted;
  if (title.length === 0) return '';
  return capSessionTitle(title);
}

/**
 * 造给模型的素材（人类可读的短文本）。
 */
function buildUserPrompt(seed: TitleSeed): string {
  const body = resolvePromptBody(seed);
  const participants = (seed.participants ?? [])
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .slice(0, 8)
    .join('、');
  return [
    `会话类型：${sessionKindLabel(seed.kind)}`,
    participants.length > 0 ? `参与者：${participants}` : '',
    body.length > 0 ? `内容：${body}` : '内容：（暂无内容）',
  ]
    .filter((line) => line.length > 0)
    .join('\n');
}

/** 素材主体（截到上限）。 */
function resolvePromptBody(seed: TitleSeed): string {
  const raw = seed.firstUserMessage?.trim() || seed.taskTitle?.trim() || '';
  return raw.slice(0, MAX_PROMPT_BODY_LEN);
}

/** chat completions 响应里我们关心的那一小块。 */
interface LlmChatResponse {
  readonly choices?: readonly {
    readonly message?: { readonly content?: string | null };
  }[];
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 造 LLM 版起名实现。
 *
 * 失败口径（**静默回退**）：网络失败 / 非 2xx / 响应形状不对 / 模型给了空标题
 *   —— 一律记一行日志并回退规则版标题，**不抛异常**（起名是旁路，不能打断主流程）。
 */
export function createLlmTitleProvider(options: LlmTitleProviderOptions): TitleProvider {
  const logger = options.logger ?? ((): void => { /* 缺省静默 */ });
  const fallback = options.fallback ?? createRulesTitleProvider();
  const fetchImpl = options.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TITLE_LLM_TIMEOUT_MS;

  /** 问模型要一条标题；失败抛错（由上层统一回退）。 */
  const requestTitle = async (seed: TitleSeed): Promise<string> => {
    const controller = new AbortController();
    // 定时器必须清理（性能铁律：资源要回收）—— finally 里 clearTimeout。
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(chatCompletionsUrl(options.config.url), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${options.config.key}`,
        },
        body: JSON.stringify({
          model: options.config.model,
          messages: [
            { role: 'system', content: TITLE_SYSTEM_PROMPT },
            { role: 'user', content: buildUserPrompt(seed) },
          ],
          temperature: 0.3,
          max_tokens: 64,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as LlmChatResponse;
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.trim().length === 0) {
        throw new Error('模型没有返回标题内容');
      }
      return cleanLlmTitle(content);
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    id: 'llm',
    async generate(seed: TitleSeed): Promise<string> {
      try {
        const title = await requestTitle(seed);
        if (title.length > 0) return title;
        logger('[title-llm] 模型给的标题是空的，回退规则版');
      } catch (error) {
        logger(`[title-llm] 起名失败，回退规则版：${describe(error)}`);
      }
      return fallback.generate(seed);
    },
  };
}

export interface TitleProviderFactoryOptions {
  /** env 来源；缺省读进程 env（渲染层读不到 → 视为"没配" → 规则版）。 */
  readonly env?: Record<string, string | undefined>;
  /** fetch 替身（单测注入）。 */
  readonly fetchImpl?: TitleFetchImpl;
  /** 日志口；缺省静默。 */
  readonly logger?: (line: string) => void;
  /** 请求超时（ms）。 */
  readonly timeoutMs?: number;
}

/**
 * 读 env（防御式）：渲染层 bundle 里 process.env 被 vite define 替换成空对象
 * （与 app/services/task-session-recorder.ts 的 safeEnv 同一口径）—— 那里读到的就是"没配"。
 */
function safeEnv(): Record<string, string | undefined> {
  return typeof process !== 'undefined' && process.env ? process.env : {};
}

/**
 * 按 env 造起名实现（**组合根的注入口**）——
 *   三件套齐全 → LLM 版；缺任一 → 规则版（与 2a 逐字一致）。
 */
export function createTitleProviderFromEnv(
  options: TitleProviderFactoryOptions = {}
): TitleProvider {
  const config = resolveTitleLlmConfig(options.env ?? safeEnv());
  if (!config) return createRulesTitleProvider();
  return createLlmTitleProvider({
    config,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.logger ? { logger: options.logger } : {}),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
}
