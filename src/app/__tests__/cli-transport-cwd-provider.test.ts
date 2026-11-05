/**
 * 单测：`cwdProvider` 端口（@since v3.44，task_165 / docs/DESIGN-workspace.md §8 M0-01）。
 *
 * 覆盖三块：
 *   1. 缺省 provider ⇒ 子进程 cwd 与今天**逐字节一致**（不注入 = undefined = 继承进程 cwd；
 *      调用方显式给的 SpawnOptions.cwd 照旧生效）；
 *   2. 端口可注入且**被 transport 使用**（注入的 provider 的值真的进了 ProcessFactory 的 spawn 选项）；
 *   3. 缺省实现（defaultCwdProvider）恒返回 undefined。
 *
 * 假工厂 = 注入桩（见 helpers/fake-process.ts），不真调外部二进制。
 */

import { createClaudeAdapter, defaultCwdProvider, createCliTransport } from '../services/cli-transport';
import type { CwdProvider } from '../services/cli-transport';
import { collect, createFakeProcessFactory } from './helpers/fake-process';

// ============================================================================
// 1. 缺省 provider：行为与今天一致
// ============================================================================

describe('cwdProvider：缺省实现', () => {
  test('defaultCwdProvider 恒返回 undefined（= 继承当前进程 cwd）', () => {
    expect(defaultCwdProvider()).toBeUndefined();
  });

  test('不注入 provider：子进程 cwd 是 undefined（与今天逐字节一致）', async () => {
    const fake = createFakeProcessFactory({ stdout: [] });
    const transport = createCliTransport(createClaudeAdapter(), { factory: fake.factory });

    await collect(transport.spawn('在哪儿跑？'));

    expect(fake.spawnOptions).toHaveLength(1);
    expect(fake.spawnOptions[0].cwd).toBeUndefined();
  });

  test('不注入 provider：调用方显式给的 SpawnOptions.cwd 照旧生效', async () => {
    const fake = createFakeProcessFactory({ stdout: [] });
    const transport = createCliTransport(createClaudeAdapter(), { factory: fake.factory });

    await collect(transport.spawn('在哪儿跑？', { cwd: '/tmp/explicit' }));

    expect(fake.spawnOptions[0].cwd).toBe('/tmp/explicit');
  });
});

// ============================================================================
// 2. 端口可注入并被 transport 使用
// ============================================================================

describe('cwdProvider：注入', () => {
  test('注入的 provider 的值进了 ProcessFactory 的 spawn 选项', async () => {
    const fake = createFakeProcessFactory({ stdout: [] });
    const transport = createCliTransport(createClaudeAdapter(), {
      factory: fake.factory,
      cwdProvider: (): string => '/tmp/instance-root',
    });

    await collect(transport.spawn('在哪儿跑？'));

    expect(fake.spawnOptions[0].cwd).toBe('/tmp/instance-root');
  });

  test('provider 优先于 SpawnOptions.cwd（端口才是工作目录的供给方）', async () => {
    const fake = createFakeProcessFactory({ stdout: [] });
    const transport = createCliTransport(createClaudeAdapter(), {
      factory: fake.factory,
      cwdProvider: (): string => '/tmp/instance-root',
    });

    await collect(transport.spawn('在哪儿跑？', { cwd: '/tmp/explicit' }));

    expect(fake.spawnOptions[0].cwd).toBe('/tmp/instance-root');
  });

  test('provider 返回 undefined ⇒ 回落到 SpawnOptions.cwd', async () => {
    const fake = createFakeProcessFactory({ stdout: [] });
    const transport = createCliTransport(createClaudeAdapter(), {
      factory: fake.factory,
      cwdProvider: (): undefined => undefined,
    });

    await collect(transport.spawn('在哪儿跑？', { cwd: '/tmp/explicit' }));

    expect(fake.spawnOptions[0].cwd).toBe('/tmp/explicit');
  });

  test('每次 spawn 都问一次 provider（活跃实例可换）', async () => {
    const fake = createFakeProcessFactory({ stdout: [] });
    let asked = 0;
    const provider: CwdProvider = (): string => {
      asked += 1;
      return asked === 1 ? '/tmp/first' : '/tmp/second';
    };
    const transport = createCliTransport(createClaudeAdapter(), {
      factory: fake.factory,
      cwdProvider: provider,
    });

    await collect(transport.spawn('第一轮'));
    await collect(transport.spawn('第二轮'));

    expect(asked).toBe(2);
    expect(fake.spawnOptions.map((options) => options.cwd)).toEqual(['/tmp/first', '/tmp/second']);
  });

  test('provider 抛错 ⇒ 降级（不炸，cwd 回落 undefined），这一轮照常跑完', async () => {
    const fake = createFakeProcessFactory({ stdout: [] });
    const transport = createCliTransport(createClaudeAdapter(), {
      factory: fake.factory,
      cwdProvider: (): string => {
        throw new Error('provider 坏了');
      },
    });

    const events = await collect(transport.spawn('在哪儿跑？'));

    expect(fake.spawnOptions[0].cwd).toBeUndefined();
    expect(events.map((event) => event.type)).toEqual(['done']);
  });
});
