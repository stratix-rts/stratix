/**
 * 单测：CLI spawn env 组装（app/services/cli-transport/spawn-env.ts，@since v3.44 / task_090）。
 *
 * 覆盖四块：
 *   1. 三条优先级路径 —— STRATIX_CLI_ENV JSON > 主进程代理类变量透传 > 不注入（现状）；
 *   2. 白名单纪律 —— 只透传代理类变量，主进程其余环境（PATH / 凭据等）一律不灌进 CLI；
 *   3. 配置写错时不崩 —— 非法 JSON / 非字符串值 / 非对象 → 告警 + 退回上一级；
 *   4. runtime 接线 —— 组装结果真的进了 spawn options 的 env（假工厂观察得到）。
 */

import {
  assembleSpawnEnv,
  createClaudeAdapter,
  createCliTransport,
  CLI_ENV_JSON_VAR,
  PROXY_ENV_KEYS,
} from '../services/cli-transport';
import { collect, createFakeProcessFactory } from './helpers/fake-process';

// ============================================================================
// 1. 三条优先级路径
// ============================================================================

describe('spawn env 组装:三条优先级路径', () => {
  test('① STRATIX_CLI_ENV 的 JSON 赢过主进程代理变量', () => {
    const { env, warnings } = assembleSpawnEnv({
      hostEnv: { https_proxy: 'http://主进程:7890' },
      jsonEnv: JSON.stringify({ https_proxy: 'http://用户配置:7890' }),
    });
    expect(env.https_proxy).toBe('http://用户配置:7890');
    expect(warnings).toEqual([]);
  });

  test('② 没有 JSON 时透传主进程的代理类变量', () => {
    const { env } = assembleSpawnEnv({
      hostEnv: {
        https_proxy: 'http://127.0.0.1:7890',
        http_proxy: 'http://127.0.0.1:7891',
        all_proxy: 'socks5://127.0.0.1:7892',
      },
    });
    expect(env).toEqual({
      https_proxy: 'http://127.0.0.1:7890',
      http_proxy: 'http://127.0.0.1:7891',
      all_proxy: 'socks5://127.0.0.1:7892',
    });
  });

  test('③ 两处都没有 → 不注入任何 env（现状）', () => {
    const { env, warnings } = assembleSpawnEnv({ hostEnv: { PATH: '/usr/bin' } });
    expect(env).toEqual({});
    expect(warnings).toEqual([]);
  });

  test('调用方逐次显式的 env 最具体，赢过 JSON 与主进程', () => {
    const { env } = assembleSpawnEnv({
      extra: { https_proxy: 'http://调用方:7890' },
      hostEnv: { https_proxy: 'http://主进程:7890' },
      jsonEnv: JSON.stringify({ https_proxy: 'http://用户配置:7890' }),
    });
    expect(env.https_proxy).toBe('http://调用方:7890');
  });
});

// ============================================================================
// 2. 白名单纪律（不许全量透传）
// ============================================================================

describe('spawn env 组装:只透传代理类变量', () => {
  test('主进程的非代理变量（PATH / 凭据 / 内部开关）一律不灌进 CLI', () => {
    const { env } = assembleSpawnEnv({
      hostEnv: {
        PATH: '/usr/local/bin',
        HOME: '/Users/kingj',
        ANTHROPIC_API_KEY: 'sk-secret',
        STRATIX_REMOTE: '1',
        https_proxy: 'http://127.0.0.1:7890',
      },
    });
    expect(Object.keys(env)).toEqual(['https_proxy']);
    expect(env.PATH).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.STRATIX_REMOTE).toBeUndefined();
  });

  test('白名单就是这三个代理键（不多不少）', () => {
    expect([...PROXY_ENV_KEYS]).toEqual(['https_proxy', 'http_proxy', 'all_proxy']);
  });

  test('大写代理变体不自动透传（要自己写进 STRATIX_CLI_ENV）', () => {
    const { env } = assembleSpawnEnv({
      hostEnv: { HTTPS_PROXY: 'http://127.0.0.1:7890' },
      jsonEnv: JSON.stringify({ HTTPS_PROXY: 'http://127.0.0.1:7890' }),
    });
    // JSON 里显式给的照收（用户自己的决定）；主进程里的不自动带。
    expect(env.HTTPS_PROXY).toBe('http://127.0.0.1:7890');
    const { env: hostOnly } = assembleSpawnEnv({ hostEnv: { HTTPS_PROXY: 'http://127.0.0.1:7890' } });
    expect(hostOnly).toEqual({});
  });
});

// ============================================================================
// 3. 配置写错时不崩
// ============================================================================

describe('spawn env 组装:配置写错时告警而不崩', () => {
  test('非法 JSON → 告警 + 退回代理透传', () => {
    const { env, warnings } = assembleSpawnEnv({
      hostEnv: { https_proxy: 'http://127.0.0.1:7890' },
      jsonEnv: '{ 不是 JSON',
    });
    expect(env.https_proxy).toBe('http://127.0.0.1:7890');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(CLI_ENV_JSON_VAR);
  });

  test('JSON 不是对象 → 告警 + 不注入', () => {
    const { env, warnings } = assembleSpawnEnv({ jsonEnv: '["a"]' });
    expect(env).toEqual({});
    expect(warnings).toHaveLength(1);
  });

  test('JSON 里的非字符串值 / 空串 → 逐条告警并忽略', () => {
    const { env, warnings } = assembleSpawnEnv({
      jsonEnv: JSON.stringify({ https_proxy: 'http://127.0.0.1:7890', PORT: 8080, EMPTY: '' }),
    });
    expect(env).toEqual({ https_proxy: 'http://127.0.0.1:7890' });
    expect(warnings).toHaveLength(2);
  });
});

// ============================================================================
// 4. runtime 接线（组装结果真的进了 spawn options）
// ============================================================================

describe('runtime:env 组装进了 spawn options', () => {
  test('子进程拿到的 env = 组装结果（JSON 优先于主进程代理）', async () => {
    const fake = createFakeProcessFactory({ stdout: [] });
    const transport = createCliTransport(createClaudeAdapter(), { factory: fake.factory });

    // 主进程环境里有代理（本机 dev 常导出）→ 断言它进了子进程 env。
    const previous = process.env[CLI_ENV_JSON_VAR];
    process.env[CLI_ENV_JSON_VAR] = JSON.stringify({ https_proxy: 'http://注入:7890' });
    try {
      await collect(transport.spawn('列目录'));
    } finally {
      if (previous === undefined) delete process.env[CLI_ENV_JSON_VAR];
      else process.env[CLI_ENV_JSON_VAR] = previous;
    }

    expect(fake.calls).toHaveLength(1);
    const env = fake.spawnOptions[0].env ?? {};
    expect(env.https_proxy).toBe('http://注入:7890');
  });

  test('调用方逐次给的 env（SpawnOptions.env）也进 spawn options', async () => {
    const fake = createFakeProcessFactory({ stdout: [] });
    const transport = createCliTransport(createClaudeAdapter(), { factory: fake.factory });

    await collect(transport.spawn('列目录', { env: { https_proxy: 'http://逐次:7890' } }));

    const env = fake.spawnOptions[0].env ?? {};
    expect(env.https_proxy).toBe('http://逐次:7890');
  });
});
