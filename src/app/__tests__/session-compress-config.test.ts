/**
 * 单测：**长会话压缩阈值**的配置链（@since v3.48 / task_106 / v3.2b-B7）。
 *
 * 链的三环：
 *   1. 环境变量 SX_SESSION_COMPRESS_THRESHOLD —— service 进程经 process.env 读；
 *      渲染层经 preload 白名单（dev-flags.sessionCompressThresholdRaw）拿**原始串**；
 *   2. 解析 —— resolveSessionCompressThreshold（纯函数，app/services/session-compress-config.ts）；
 *   3. 注入 —— createSessionManager({ compressThreshold })（core/session 的 manager）。
 *
 * 覆盖：解析口径（合法值 / 坏值回落缺省）+ env 来源读取 + 组合根注入贯通。
 * why 坏值必须回落缺省而不是"夹成另一个数"：阈值配错比没配更难查 ——
 *   夹成 0 意味着"每条事件都触发折叠"，那不是用户想要的，是系统骗了他。
 */

import { DEFAULT_SESSION_COMPRESS_THRESHOLD, createSessionManager } from '../../core/session';
import type { SessionEvent } from '../../core/session';
import { createStore } from '../../core/store';
import { sessionCompressThresholdRaw } from '../main/dev-flags';
import {
  resolveSessionCompressThreshold,
  SESSION_COMPRESS_THRESHOLD_ENV,
  sessionCompressThresholdFromEnv,
} from '../services/session-compress-config';

describe('长会话压缩阈值配置（task_106 / v3.2b-B7）', () => {
  it('env 键名就是 SX_SESSION_COMPRESS_THRESHOLD', () => {
    expect(SESSION_COMPRESS_THRESHOLD_ENV).toBe('SX_SESSION_COMPRESS_THRESHOLD');
  });

  it('解析：合法整数照用；没给 / 空串 / 坏值 / 小于 1 一律回落缺省 200', () => {
    expect(resolveSessionCompressThreshold('50')).toBe(50);
    expect(resolveSessionCompressThreshold(' 120 ')).toBe(120);
    expect(resolveSessionCompressThreshold('1')).toBe(1);

    expect(resolveSessionCompressThreshold(undefined)).toBe(DEFAULT_SESSION_COMPRESS_THRESHOLD);
    expect(resolveSessionCompressThreshold(null)).toBe(DEFAULT_SESSION_COMPRESS_THRESHOLD);
    expect(resolveSessionCompressThreshold('')).toBe(DEFAULT_SESSION_COMPRESS_THRESHOLD);
    expect(resolveSessionCompressThreshold('   ')).toBe(DEFAULT_SESSION_COMPRESS_THRESHOLD);
    expect(resolveSessionCompressThreshold('abc')).toBe(DEFAULT_SESSION_COMPRESS_THRESHOLD);
    expect(resolveSessionCompressThreshold('0')).toBe(DEFAULT_SESSION_COMPRESS_THRESHOLD);
    expect(resolveSessionCompressThreshold('-5')).toBe(DEFAULT_SESSION_COMPRESS_THRESHOLD);
  });

  it('env 来源：按 SESSION_COMPRESS_THRESHOLD_ENV 取值；没配 → 缺省', () => {
    expect(sessionCompressThresholdFromEnv({ SX_SESSION_COMPRESS_THRESHOLD: '80' })).toBe(80);
    expect(sessionCompressThresholdFromEnv({})).toBe(DEFAULT_SESSION_COMPRESS_THRESHOLD);
    expect(
      sessionCompressThresholdFromEnv({ SX_SESSION_COMPRESS_THRESHOLD: 'not-a-number' })
    ).toBe(DEFAULT_SESSION_COMPRESS_THRESHOLD);
  });

  it('组合根注入：阈值进 manager → 超阈值的会话真的会折叠', () => {
    const store = createStore();
    const events: SessionEvent[] = [];
    const manager = createSessionManager({
      store,
      compressThreshold: resolveSessionCompressThreshold('5'),
      compressKeepRecent: 2,
      persist: {
        persistSession: () => undefined,
        persistEvent: (event) => {
          events.push(event);
        },
      },
      // 读口复刻 DAO 窗口口径（最后 limit 条 / beforeSeq 之前的那一段）。
      read: {
        readSessionEvents: (
          sessionId: string,
          query: { readonly beforeSeq?: number; readonly limit: number }
        ) => {
          const hit = events
            .filter(
              (event) =>
                event.sessionId === sessionId &&
                (query.beforeSeq === undefined || event.seq < query.beforeSeq)
            )
            .sort((a, b) => a.seq - b.seq);
          return hit.slice(Math.max(0, hit.length - query.limit));
        },
      },
    });
    const session = manager.createSession({ kind: 'peer_chat', participants: ['alice'] })!;
    for (let i = 0; i < 6; i += 1) {
      manager.appendEvent(session.id, {
        type: 'message',
        payload: { author: 'alice', text: `m${i}` },
      });
    }
    // 阈值 5 → eventCount 7 > 5 → 触发折叠（至少有一条摘要事件）。
    const summaries = events.filter((event) => event.type === 'compressed');
    expect(summaries.length).toBeGreaterThan(0);
  });

  it('渲染层读口：没有 preload 通道时返回 null（= 没配 → 缺省）', () => {
    // jsdom 环境下没有 window.electronAPI → 运行时那一路读不到。
    expect(sessionCompressThresholdRaw()).toBeNull();
  });
});
