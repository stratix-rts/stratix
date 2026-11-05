/**
 * 单测：切副本的 `ProjectArchivePort` 实现（app/services/persistence/project-archive.ts
 * + project-archive-node.ts，task_180 / M1-06）。
 *
 * 驱动说明：与既有持久化单测同一策略 —— **不 mock fs**（归档的语义全在「真写文件」上，
 *   mock 掉 fs 等于把实现一起 mock 掉了）。故障路径用**注入的低阶写盘口**制造
 *   「写到一半失败」（真实 fs 造不出这种错），其余走真实 node fs。
 *
 * 覆盖（design §7.1 M1-06 行的三条验收 + 失败语义）：
 *   ① 归档文件**只追加不重写**（同一会话两次退出 ⇒ 两行，不覆盖）；
 *   ② 归档失败时**不产生半份文件**（写失败 ⇒ 文件回到写入前的样子）；
 *   ③ 归档内容里的 `missionId` 与契约一致；
 *   ＋ 只归档**未终结**的 mission（终态 done / cancelled 不进归档）；
 *   ＋ 没有未终结 mission ⇒ 不制造空文件；＋ 实例查不到 ⇒ 拒绝归档。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  DEFAULT_INSTANCE_ID,
  type MissionView,
  type ProjectInstanceView,
} from '../../../core/types';
import { createInMemoryInstanceRegistry } from '../../services/persistence/instance-loader';
import {
  ARCHIVE_EVENT_KIND,
  ARCHIVE_LINE_VERSION,
  archiveFileName,
  createProjectArchive,
  type ArchiveLine,
} from '../../services/persistence/project-archive';
import {
  createInstanceRootResolver,
  createNodeArchiveAppender,
  nodeArchiveFileOps,
  type ArchiveFileOps,
} from '../../services/persistence/project-archive-node';

// ============================================================================
// 夹具
// ============================================================================

/** 固定时刻（本地 2026-11-15 12:00 ⇒ 分片 = missions-202611.jsonl，与时区无关）。 */
const FIXED_NOW = new Date(2026, 10, 15, 12, 0, 0).getTime();
const FIXED_FILE_NAME = 'missions-202611.jsonl';

function mission(patch: Partial<MissionView> = {}): MissionView {
  return {
    id: 'mission-1',
    title: '守住北门',
    phase: 'running',
    unitIds: ['unit_ch-1'],
    createdAt: 1700000000000,
    // 归属：缺省 = 未归属 = 默认沙盒（COALESCE 口径，design §1.2.1）
    //   ⇒ 归到别的副本的 mission 不进本副本的归档。
    instanceId: 'wsp_x',
    ...patch,
  };
}

function instanceView(patch: Partial<ProjectInstanceView> = {}): ProjectInstanceView {
  return {
    instanceId: 'wsp_x',
    projectId: 'spx_1',
    path: '/tmp/stratix-demo-wsp-x',
    title: '副本 X',
    lastOpenedAt: 1700000000000,
    pinned: false,
    archived: false,
    status: 'idle',
    ...patch,
  };
}

/** 读归档文件的所有行（JSON 解析后）。 */
function readArchiveLines(filePath: string): ArchiveLine[] {
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as ArchiveLine);
}

describe('ProjectArchivePort 实现（task_180 / M1-06）', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-project-archive-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  /** 造一个归档端口（真实 fs 落盘 + 固定时刻 + 内存注册表）。 */
  function makeArchive(
    missions: readonly MissionView[],
    options: {
      appender?: ReturnType<typeof createNodeArchiveAppender>;
      instanceId?: string;
      resolveInstanceRoot?: (instanceId: string) => string | undefined;
    } = {}
  ) {
    const registry = createInMemoryInstanceRegistry([
      instanceView({ path: root, instanceId: options.instanceId ?? 'wsp_x' }),
    ]);
    return createProjectArchive({
      missions: () => missions,
      resolveInstanceRoot:
        options.resolveInstanceRoot ?? createInstanceRootResolver(registry, { fallbackRoot: root }),
      appender: options.appender ?? createNodeArchiveAppender(),
      now: () => FIXED_NOW,
    });
  }

  const archiveFile = () => path.join(root, '.stratix', 'history', FIXED_FILE_NAME);

  // ── 验收①：只追加不重写 ──────────────────────────────────────────────
  it('① 同一会话两次退出 ⇒ 两行，不覆盖（append-only）', async () => {
    const archive = makeArchive([mission()]);

    const first = await archive.archive('wsp_x');
    expect(first).toEqual({
      ok: true,
      archivedCount: 1,
      archivePath: `.stratix/history/${FIXED_FILE_NAME}`,
    });

    const filePath = archiveFile();
    expect(fs.existsSync(filePath)).toBe(true);
    const afterFirst = fs.readFileSync(filePath, 'utf8');
    expect(afterFirst.split('\n').filter(Boolean)).toHaveLength(1);

    // 第二次退出（同一会话）⇒ 再追加一行，**第一行原封不动**
    const second = await archive.archive('wsp_x');
    expect(second.ok).toBe(true);

    const afterSecond = fs.readFileSync(filePath, 'utf8');
    const lines = afterSecond.split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    // 首行未被改写（只追加的硬证据）
    expect(afterSecond.startsWith(afterFirst)).toBe(true);
    expect(lines[0]).toBe(afterFirst.split('\n')[0]);
    expect(readArchiveLines(filePath)).toHaveLength(2);
  });

  it('① 分片文件名按月算（missions-YYYYMM.jsonl）', () => {
    expect(archiveFileName(FIXED_NOW)).toBe(FIXED_FILE_NAME);
  });

  // ── 验收③：missionId 与契约一致 ──────────────────────────────────────
  it('③ 归档内容里的 missionId 与契约一致（逐字取自 MissionView.id）', async () => {
    const missions = [mission({ id: 'mission-a' }), mission({ id: 'mission-b', phase: 'pending' })];
    const archive = makeArchive(missions);

    const result = await archive.archive('wsp_x');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.archivedCount).toBe(2);

    const lines = readArchiveLines(archiveFile());
    expect(lines.map((line) => line.payload.missionId)).toEqual(['mission-a', 'mission-b']);
    // 行格式照 DESIGN-workspace.md §1.3（v / ts / kind / ignorable / payload）
    for (const line of lines) {
      expect(line.v).toBe(ARCHIVE_LINE_VERSION);
      expect(line.kind).toBe(ARCHIVE_EVENT_KIND);
      expect(line.ignorable).toBe(false);
      expect(line.ts).toBe(FIXED_NOW);
    }
    // 未终结 mission 的相位 / 标题 / 单位 一并留档
    expect(lines[0].payload.phase).toBe('running');
    expect(lines[0].payload.title).toBe('守住北门');
    expect(lines[0].payload.unitIds).toEqual(['unit_ch-1']);
  });

  // ── 未终结 vs 终态 ──────────────────────────────────────────────────
  it('只归档未终结的 mission（done / cancelled 不进归档）', async () => {
    const archive = makeArchive([
      mission({ id: 'm-running', phase: 'running' }),
      mission({ id: 'm-done', phase: 'done' }),
      mission({ id: 'm-cancelled', phase: 'cancelled' }),
    ]);

    const result = await archive.archive('wsp_x');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.archivedCount).toBe(1);

    const lines = readArchiveLines(archiveFile());
    expect(lines).toHaveLength(1);
    expect(lines[0].payload.missionId).toBe('m-running');
  });

  it('没有未终结 mission ⇒ 不制造空文件', async () => {
    const archive = makeArchive([mission({ phase: 'done' })]);

    const result = await archive.archive('wsp_x');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.archivedCount).toBe(0);
    expect(fs.existsSync(archiveFile())).toBe(false);
  });

  it('别副本的 mission 不写进本副本的归档（按 instance 过滤）', async () => {
    const archive = makeArchive([mission({ id: 'm-other', instanceId: 'wsp_other' })]);

    const result = await archive.archive('wsp_x');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.archivedCount).toBe(0);
    expect(fs.existsSync(archiveFile())).toBe(false);
  });

  // ── 验收②：失败不留半份文件 ─────────────────────────────────────────
  it('② 写到一半失败 ⇒ 不产生半份文件（文件回到写入前的样子）', async () => {
    // 注入「写到一半就炸」的写盘口：真实 fs 造不出这种故障（磁盘满了才会）。
    const failingOps: ArchiveFileOps = {
      ...nodeArchiveFileOps,
      write: (fd, payload) => {
        nodeArchiveFileOps.write(fd, payload.slice(0, 12));
        throw new Error('EIO: 磁盘炸了');
      },
    };
    const archive = makeArchive([mission()], {
      appender: createNodeArchiveAppender({ ops: failingOps }),
    });

    const result = await archive.archive('wsp_x');
    expect(result).toEqual({ ok: false, reason: 'archive-failed' });

    // 原本不存在 ⇒ 失败后**不留文件**（新建出来的半份被回滚删掉）
    expect(fs.existsSync(archiveFile())).toBe(false);
  });

  it('② 写到一半失败 ⇒ 已有归档内容原封不动（不截断旧内容）', async () => {
    const filePath = archiveFile();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'previous-line\n', 'utf8');
    const before = fs.readFileSync(filePath, 'utf8');

    const failingOps: ArchiveFileOps = {
      ...nodeArchiveFileOps,
      write: (fd, payload) => {
        nodeArchiveFileOps.write(fd, payload.slice(0, 12));
        throw new Error('EIO: 磁盘炸了');
      },
    };
    const archive = makeArchive([mission()], {
      appender: createNodeArchiveAppender({ ops: failingOps }),
    });

    const result = await archive.archive('wsp_x');
    expect(result).toEqual({ ok: false, reason: 'archive-failed' });
    expect(fs.readFileSync(filePath, 'utf8')).toBe(before);
  });

  it('② 归档位置被目录占住 ⇒ 失败且不写坏任何东西', async () => {
    // 占位：把归档文件的位置先建成一个目录（写不进去 ⇒ 失败）
    const filePath = archiveFile();
    fs.mkdirSync(filePath, { recursive: true });

    const archive = makeArchive([mission()]);
    const result = await archive.archive('wsp_x');
    expect(result).toEqual({ ok: false, reason: 'archive-failed' });
    // 占位目录原样（没被写成文件，也没被删）
    expect(fs.statSync(filePath).isDirectory()).toBe(true);
  });

  it('实例查不到 ⇒ 拒绝归档（不猜路径、不写到别处）', async () => {
    const archive = makeArchive([mission()], {
      resolveInstanceRoot: () => undefined,
    });

    const result = await archive.archive('wsp_x');
    expect(result).toEqual({ ok: false, reason: 'instance-missing' });
    expect(fs.existsSync(path.join(root, '.stratix'))).toBe(false);
  });

  // ── 根目录解析 ──────────────────────────────────────────────────────
  it('默认沙盒回落进程 cwd（M1-07 之前注册表还没有它的记录）', () => {
    const registry = createInMemoryInstanceRegistry([]);
    const resolve = createInstanceRootResolver(registry, { fallbackRoot: '/tmp/sandbox-root' });

    expect(resolve(DEFAULT_INSTANCE_ID)).toBe('/tmp/sandbox-root');
    expect(resolve('wsp_unknown')).toBeUndefined();
  });
});
