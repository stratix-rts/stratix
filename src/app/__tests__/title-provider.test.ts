/**
 * 单测：**LLM 自动起名**（@since v3.47，task_104 / v3.2b-B5）——
 *   env 三态（缺 / 全 / 半）+ 成功 / 失败回退 + 异步不阻塞主流程。
 *
 * 覆盖验收口径：
 *   1. **缺 env**（三件套缺任一）→ 规则版实现（行为与 2a 完全一致，一个字节都不差）；
 *   2. **env 齐全** → LLM 版实现（OpenAI 兼容 chat completions；用注入的 fetch 替身验证请求与结果）；
 *   3. **失败静默回退**（网络失败 / 非 2xx / 空内容）→ 回退规则版并记一行日志（不抛异常）；
 *   4. **异步起名不阻塞主流程** —— 起名 promise 未决时主流程已经走完，标题稍后才被写回。
 *
 * fetch 替身只用于**单测**（生产走全局 fetch，见 app/services/llm-title-provider.ts）。
 */

import { createSessionManager, type SessionManager, type TitleProvider } from '../../core/session';
import { createStore, type CoreStore } from '../../core/store';
import { titleLlmEnv } from '../main/dev-flags';
import {
  createLlmTitleProvider,
  createTitleProviderFromEnv,
  resolveTitleLlmConfig,
  TITLE_LLM_KEY_ENV,
  TITLE_LLM_MODEL_ENV,
  TITLE_LLM_URL_ENV,
} from '../services/llm-title-provider';
import { createSessionTitleService } from '../services/session-title';

const FULL_ENV = {
  [TITLE_LLM_URL_ENV]: 'https://llm.example.com/v1/chat/completions',
  [TITLE_LLM_KEY_ENV]: 'sk-test-key',
  [TITLE_LLM_MODEL_ENV]: 'test-model',
};

/** 造一个 fetch 替身：记录请求，返回给定的响应。 */
function stubFetch(
  handler: (url: string, init?: RequestInit) => { ok: boolean; status: number; body: unknown }
): { fetchImpl: (input: string, init?: RequestInit) => Promise<Response>; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  return {
    calls,
    fetchImpl: async (input: string, init?: RequestInit): Promise<Response> => {
      calls.push({ url: input, init });
      const result = handler(input, init);
      return {
        ok: result.ok,
        status: result.status,
        json: async () => result.body,
      } as unknown as Response;
    },
  };
}

interface Harness {
  readonly store: CoreStore;
  readonly sessions: SessionManager;
}

function harness(): Harness {
  const store = createStore();
  let ids = 0;
  const sessions = createSessionManager({
    store,
    now: () => Date.now(),
    createId: (prefix: string) => `${prefix}_${++ids}`,
  });
  return { store, sessions };
}

// ============================================================================
// 1. env 三态
// ============================================================================

describe('createTitleProviderFromEnv：env 三态', () => {
  test('三件套齐全 → LLM 版', () => {
    expect(createTitleProviderFromEnv({ env: FULL_ENV }).id).toBe('llm');
  });

  test('缺任一 → 规则版（缺 URL / 缺 Key / 缺模型各测一遍）', () => {
    const { [TITLE_LLM_URL_ENV]: _url, ...noUrl } = FULL_ENV;
    const { [TITLE_LLM_KEY_ENV]: _key, ...noKey } = FULL_ENV;
    const { [TITLE_LLM_MODEL_ENV]: _model, ...noModel } = FULL_ENV;
    expect(createTitleProviderFromEnv({ env: noUrl }).id).toBe('rules');
    expect(createTitleProviderFromEnv({ env: noKey }).id).toBe('rules');
    expect(createTitleProviderFromEnv({ env: noModel }).id).toBe('rules');
    expect(createTitleProviderFromEnv({ env: {} }).id).toBe('rules');
  });

  test('空白值算"没配"（env 里常见的引号残留 / 换行残留）', () => {
    expect(resolveTitleLlmConfig({ ...FULL_ENV, [TITLE_LLM_URL_ENV]: '   ' })).toBeNull();
    expect(resolveTitleLlmConfig({ ...FULL_ENV, [TITLE_LLM_KEY_ENV]: '' })).toBeNull();
  });

  test('三件套齐全时解析出配置（端点 / 凭据 / 模型）', () => {
    const config = resolveTitleLlmConfig(FULL_ENV);
    expect(config?.url).toBe(FULL_ENV[TITLE_LLM_URL_ENV]);
    expect(config?.key).toBe(FULL_ENV[TITLE_LLM_KEY_ENV]);
    expect(config?.model).toBe(FULL_ENV[TITLE_LLM_MODEL_ENV]);
  });

  test('规则版算出的标题与建会话时那条逐字一致（无 env 配置 = 2a 行为）', () => {
    const provider = createTitleProviderFromEnv({ env: {} });
    const { sessions } = harness();
    const created = sessions.createSession({
      kind: 'peer_chat',
      participants: ['alice', 'bob'],
      firstMessage: '互聊第一句话，先把分工说清楚',
    });
    expect(provider.generate({
      kind: 'peer_chat',
      participants: ['alice', 'bob'],
      firstUserMessage: '互聊第一句话，先把分工说清楚',
    })).toBe(created?.title);
  });
});

// ============================================================================
// 2. LLM 版：成功 / 失败回退
// ============================================================================

describe('LlmTitleProvider：成功与回退', () => {
  const seed = {
    kind: 'peer_chat' as const,
    participants: ['alice', 'bob'],
    firstUserMessage: '我们聊聊北门的加固方案',
  };

  test('成功：用模型给的标题（去掉引号与句末标点）', async () => {
    const stub = stubFetch(() => ({
      ok: true,
      status: 200,
      body: { choices: [{ message: { content: '"北门加固方案讨论。"' } }] },
    }));
    const provider = createLlmTitleProvider({
      config: { url: FULL_ENV[TITLE_LLM_URL_ENV], key: 'sk-test', model: 'test-model' },
      fetchImpl: stub.fetchImpl,
    });
    const title = await provider.generate(seed);
    expect(title).toBe('北门加固方案讨论');
  });

  test('成功：请求是 OpenAI 兼容的 chat completions（端点 / 模型 / 凭据 / prompt）', async () => {
    const stub = stubFetch(() => ({
      ok: true,
      status: 200,
      body: { choices: [{ message: { content: '标题' } }] },
    }));
    const provider = createLlmTitleProvider({
      config: { url: FULL_ENV[TITLE_LLM_URL_ENV], key: 'sk-test', model: 'test-model' },
      fetchImpl: stub.fetchImpl,
    });
    await provider.generate(seed);
    expect(stub.calls).toHaveLength(1);
    const call = stub.calls[0]!;
    expect(call.url).toBe(FULL_ENV[TITLE_LLM_URL_ENV]);
    const init = call.init as RequestInit;
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(String(init.body)) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe('test-model');
    expect(body.messages[1]?.content).toContain('我们聊聊北门的加固方案');
  });

  test('失败（非 2xx）→ 静默回退规则版 + 记一行日志', async () => {
    const stub = stubFetch(() => ({ ok: false, status: 500, body: {} }));
    const logs: string[] = [];
    const provider = createLlmTitleProvider({
      config: { url: FULL_ENV[TITLE_LLM_URL_ENV], key: 'sk-test', model: 'test-model' },
      fetchImpl: stub.fetchImpl,
      logger: (line) => logs.push(line),
    });
    const title = await provider.generate(seed);
    expect(title).toBe('互聊：我们聊聊北门的加固方案');
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('回退规则版');
  });

  test('失败（网络异常）→ 回退规则版，不抛异常', async () => {
    const provider = createLlmTitleProvider({
      config: { url: FULL_ENV[TITLE_LLM_URL_ENV], key: 'sk-test', model: 'test-model' },
      fetchImpl: async () => {
        throw new Error('network down');
      },
    });
    await expect(provider.generate(seed)).resolves.toBe('互聊：我们聊聊北门的加固方案');
  });

  test('失败（模型给空内容）→ 回退规则版', async () => {
    const stub = stubFetch(() => ({
      ok: true,
      status: 200,
      body: { choices: [{ message: { content: '   ' } }] },
    }));
    const provider = createLlmTitleProvider({
      config: { url: FULL_ENV[TITLE_LLM_URL_ENV], key: 'sk-test', model: 'test-model' },
      fetchImpl: stub.fetchImpl,
    });
    await expect(provider.generate(seed)).resolves.toBe('互聊：我们聊聊北门的加固方案');
  });
});

// ============================================================================
// 3. 异步起名不阻塞主流程
// ============================================================================
describe('SessionTitleService：异步起名不阻塞主流程', () => {
  test('起名 promise 未决时主流程已经走完，标题稍后才被写回', async () => {
    const { store, sessions } = harness();
    const created = sessions.createSession({ kind: 'peer_chat', participants: ['alice', 'bob'] });
    const before = created!.title;
    let release: (title: string) => void = () => undefined;
    const provider: TitleProvider = {
      id: 'slow',
      generate: () => new Promise<string>((resolve) => { release = resolve; }),
    };
    const service = createSessionTitleService({ sessions, provider });

    const pending = service.retitle(created!.id, {
      kind: 'peer_chat',
      participants: ['alice', 'bob'],
      firstUserMessage: '慢慢起名',
    });
    // 主流程没被卡住：标题此刻还是原来那条（起名还没回来）
    expect(store.getState().sessions?.[0]?.title).toBe(before);

    release('慢慢起出来的标题');
    await pending;
    expect(store.getState().sessions?.[0]?.title).toBe('慢慢起出来的标题');
  });

  test('起名失败只记日志，不影响会话（标题保持原样）', async () => {
    const { store, sessions } = harness();
    const created = sessions.createSession({ kind: 'peer_chat', participants: ['alice'] });
    const before = created!.title;
    const logs: string[] = [];
    const provider: TitleProvider = {
      id: 'boom',
      generate: () => {
        throw new Error('起名炸了');
      },
    };
    const service = createSessionTitleService({ sessions, provider, logger: (line) => logs.push(line) });
    await service.retitle(created!.id, { kind: 'peer_chat' });
    expect(store.getState().sessions?.[0]?.title).toBe(before);
    expect(logs).toHaveLength(1);
  });

  test('规则版起名（无 env）写回时同名不改 —— 状态原样（与 2a 完全一致）', async () => {
    const { store, sessions } = harness();
    const created = sessions.createSession({
      kind: 'peer_chat',
      participants: ['alice', 'bob'],
      firstMessage: '我们开始吧',
    });
    const recordBefore = store.getState().sessions?.[0];
    const service = createSessionTitleService({
      sessions,
      provider: createTitleProviderFromEnv({ env: {} }),
    });
    await service.retitle(created!.id, {
      kind: 'peer_chat',
      participants: ['alice', 'bob'],
      firstUserMessage: '我们开始吧',
    });
    expect(store.getState().sessions?.[0]?.title).toBe(created!.title);
    // 同名 → 没写 store（引用没换）
    expect(store.getState().sessions?.[0]).toBe(recordBefore);
  });
});

// ============================================================================
// 4. env 读取口（渲染层拿环境变量的唯一通道：Electron preload 白名单）
// ============================================================================

describe('titleLlmEnv：env 读取口', () => {
  /** 装一个 window.electronAPI.env 桩（渲染层拿环境变量的唯一通道）。 */
  function withRuntimeEnv(env: Record<string, string | null>): () => void {
    const scope = globalThis as unknown as { window?: unknown };
    const previous = scope.window;
    scope.window = { electronAPI: { env } };
    return () => {
      if (previous === undefined) delete scope.window;
      else scope.window = previous;
    };
  }

  test('运行时通道（preload 白名单）拿到三个键', () => {
    const restore = withRuntimeEnv({
      SX_TITLE_LLM_URL: 'https://llm.example.com/v1/chat/completions',
      SX_TITLE_LLM_KEY: 'sk-runtime',
      SX_TITLE_LLM_MODEL: 'runtime-model',
    });
    try {
      const env = titleLlmEnv();
      expect(env.SX_TITLE_LLM_URL).toBe('https://llm.example.com/v1/chat/completions');
      expect(env.SX_TITLE_LLM_KEY).toBe('sk-runtime');
      expect(env.SX_TITLE_LLM_MODEL).toBe('runtime-model');
    } finally {
      restore();
    }
  });

  test('未设置 → 键不出现（调用方按"没配"处理 → 规则版）', () => {
    const restore = withRuntimeEnv({});
    try {
      const env = titleLlmEnv();
      expect(env.SX_TITLE_LLM_URL).toBeUndefined();
      expect(env.SX_TITLE_LLM_KEY).toBeUndefined();
      expect(env.SX_TITLE_LLM_MODEL).toBeUndefined();
    } finally {
      restore();
    }
  });

  test('运行时读到的三件套齐全 → 起名实现是 LLM 版', () => {
    const restore = withRuntimeEnv({
      SX_TITLE_LLM_URL: 'https://llm.example.com/v1/chat/completions',
      SX_TITLE_LLM_KEY: 'sk-runtime',
      SX_TITLE_LLM_MODEL: 'runtime-model',
    });
    try {
      expect(createTitleProviderFromEnv({ env: titleLlmEnv() }).id).toBe('llm');
    } finally {
      restore();
    }
  });
});
