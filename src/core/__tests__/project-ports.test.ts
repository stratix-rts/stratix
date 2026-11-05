/**
 * 单测：切副本端口契约（core/types.ts，task_176 / M1-02）。
 * 覆盖：① 端口形状可用（inspect 同步 / load·unload·archive 异步）；
 *      ② **失败用返回值表达**（`ok: false` + 分类 reason），不靠异常；
 *      ③ 失败结果可被穷尽分派（core 裁决侧必须显式处理失败分支）。
 */

import type {
  ArchiveResult,
  InstanceInspection,
  InstanceLoaderPort,
  PortFailureReason,
  PortResult,
  ProjectArchivePort,
} from '../types';

/** 测试替身：按脚本回答的端口实现（只用来验契约形状，不含任何 IO）。 */
function makeLoader(answers: {
  inspection: InstanceInspection;
  load: PortResult;
  unload: PortResult;
}): InstanceLoaderPort {
  return {
    inspect: () => answers.inspection,
    load: async () => answers.load,
    unload: async () => answers.unload,
  };
}

describe('InstanceLoaderPort', () => {
  test('inspect 同步返回勘察快照，load / unload 异步返回结果', async () => {
    const loader = makeLoader({
      inspection: { exists: true, archived: false, pathOk: true },
      load: { ok: true },
      unload: { ok: true },
    });

    const inspection = loader.inspect('wsp_sandbox');
    expect(inspection.exists).toBe(true);
    expect(inspection.archived).toBe(false);
    expect(inspection.pathOk).toBe(true);

    await expect(loader.load('wsp_sandbox')).resolves.toEqual({ ok: true });
    await expect(loader.unload('wsp_sandbox')).resolves.toEqual({ ok: true });
  });

  test('失败用返回值表达（不抛异常）—— 裁决侧据此拒绝、状态保持不变', async () => {
    const loader = makeLoader({
      inspection: { exists: false, archived: false, pathOk: false },
      load: { ok: false, reason: 'load-failed' },
      unload: { ok: false, reason: 'unload-failed' },
    });

    await expect(loader.load('wsp_x')).resolves.toEqual({ ok: false, reason: 'load-failed' });
    await expect(loader.unload('wsp_x')).resolves.toEqual({ ok: false, reason: 'unload-failed' });
  });
});

describe('ProjectArchivePort', () => {
  test('归档失败 ⇒ ok: false + 分类 reason（core 据此拒绝退出）', async () => {
    const archive: ProjectArchivePort = {
      archive: async (): Promise<ArchiveResult> => ({ ok: false, reason: 'archive-failed' }),
    };

    await expect(archive.archive('wsp_x')).resolves.toEqual({ ok: false, reason: 'archive-failed' });
  });

  test('归档成功 ⇒ ok: true 携带成功载荷', async () => {
    const archive: ProjectArchivePort = {
      archive: async (): Promise<ArchiveResult> => ({
        ok: true,
        archivedCount: 2,
        archivePath: '.stratix/history/missions-202611.jsonl',
      }),
    };

    const result = await archive.archive('wsp_x');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.archivedCount).toBe(2);
    }
  });
});

describe('失败分类', () => {
  test('reason 是可穷尽的枚举 —— core 裁决分支写漏就在编译期暴露', () => {
    const reasons: readonly PortFailureReason[] = [
      'instance-missing',
      'instance-archived',
      'path-unreachable',
      'load-failed',
      'unload-failed',
      'archive-failed',
    ];

    for (const reason of reasons) {
      const failure: PortResult = { ok: false, reason };
      expect(failure.ok).toBe(false);
    }
  });
});
