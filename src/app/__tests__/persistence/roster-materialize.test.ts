/**
 * 集成测试：**步 N6 —— 新实例的 roster 物化**（@since v3.3，task_202 / M2-05）。
 *
 * 权威依据：docs/DESIGN-project-map.md §1.3.2 步 **N6**
 *   （「新实例创建时，其 roster 的角色物化进该实例的 `characters` 行
 *     —— 契约 → 运行层的单向 reconcile，task_159 D3」）。
 *
 * 四条验收逐条落到可执行的断言：
 *   ① **新实例创建 ⇒ roster 角色物化有测试**：物化出行（role_id + instance_id + 派生 id），
 *      且**进入该副本时读得到**（进入链 = InstanceLoaderPort.load 路径）；
 *   ② **幂等**：同一 roster 重复物化 ⇒ **零重复行**（复合唯一索引兜底）；
 *   ③ **沙盒不被物化误伤**：沙盒存量行（`instance_id IS NULL`）一个字节都不改，
 *      且沙盒本身**不被物化**（沙盒是历史数据的 catch-all）；
 *   ④ **单向**：运行层改动**绝不回写契约**（契约文件字节不变），
 *      且契约的 reconcile **不覆盖运行层拥有的字段**（level / exp 不被打回初值）。
 *
 * 驱动：真实 sql.js 适配器 + 临时文件库 + 临时项目根（契约文件是真的写进磁盘再读回来）——
 *   mock 掉库或磁盘等于把被测对象一起 mock 掉（与其它持久化单测同口径）。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { Database } from '@/stratix-database/sqlite-adapter';

import { DEFAULT_INSTANCE_ID } from '../../../core/types';
import {
  ensureGameSaveTables,
  loadCharacters,
} from '../../services/persistence/game-save-dao';
import { createSqliteInstanceDataSource } from '../../services/persistence/instance-loader-node';
import {
  materializeInstanceRoster,
  materializeRosterCharacters,
} from '../../services/persistence/roster-materializer';

// ============================================================================
// 夹具
// ============================================================================

/** 非沙盒的副本 id（新副本）。 */
const INSTANCE = 'wsp_x';
/** 另一个副本 id（用来验「不串副本」）。 */
const OTHER_INSTANCE = 'wsp_y';

let tmpDir = '';
let projectRoot = '';
let dbPath = '';
let db: Database;

function writeJson(relPath: string, value: unknown): void {
  const filePath = path.join(projectRoot, relPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

/** 写一份最小契约：project.json + roster/_index.json + 两个角色文件。 */
function writeContract(): void {
  writeJson('.stratix/project.json', {
    formatVersion: 1,
    id: 'spx_9f3c2a1b7d4e5f60',
    name: '雨林哨站',
    description: '一句话说明这个项目要做成什么',
  });
  writeJson('.stratix/roster/_index.json', {
    roles: [{ id: 'scout' }, { id: 'builder' }],
    defaultRoleId: 'scout',
  });
  writeJson('.stratix/roster/scout.json', {
    id: 'scout',
    name: '斥候',
    persona: '你负责在项目里到处看，先摸清地形再动手。',
    bindings: { agentKind: 'claude-code', model: null },
    capabilities: { tools: ['read', 'edit'], commands: ['/status'], skills: [], systemPrompt: null },
    state: { level: 2, experience: 30, contextEnabled: true },
  });
  writeJson('.stratix/roster/builder.json', {
    id: 'builder',
    name: '工匠',
    persona: '你负责把想法变成能跑的东西。',
    bindings: { agentKind: 'codex', model: null },
    capabilities: { tools: ['read', 'edit', 'write'], commands: [], skills: [], systemPrompt: null },
    state: { level: 1, experience: 0 },
  });
}

/** 插一行「默认沙盒的存量行」（`instance_id IS NULL` + `role_id IS NULL` = 迁移前的老行）。 */
function insertLegacySandboxRow(id: string, name: string): void {
  db.prepare(
    `INSERT INTO characters (id, name, kind, persona, level, exp, appearance, body_type, skin_id,
       external_session_id, context_enabled, created_at, updated_at, instance_id, role_id)
     VALUES (?, ?, 'claude-code', '老档案的人设', 5, 700, NULL, NULL, NULL, NULL, 1, 1000, 1000, NULL, NULL)`
  ).run(id, name);
}

/** 读某副本的全部角色行（不限字段，纯计数用）。 */
function countRows(instanceId: string | null): number {
  const row = instanceId
    ? (db.prepare('SELECT COUNT(*) AS n FROM characters WHERE instance_id = ?').get(instanceId) as {
        n?: number;
      })
    : (db.prepare('SELECT COUNT(*) AS n FROM characters').get() as { n?: number });
  return Number(row?.n ?? 0);
}

/** 读一行角色的原始字段（断言用）。 */
function rawCharacter(id: string): Record<string, unknown> | undefined {
  return db.prepare('SELECT * FROM characters WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-roster-materialize-'));
  projectRoot = path.join(tmpDir, 'project');
  fs.mkdirSync(projectRoot, { recursive: true });
  writeContract();

  dbPath = path.join(tmpDir, 'game.sqlite');
  db = new Database(dbPath);
  await db.initialize();
  ensureGameSaveTables(db);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ============================================================================
// ① 新实例创建 ⇒ roster 角色物化
// ============================================================================
describe('步 N6：新实例的 roster 物化（task_202 / M2-05）', () => {
  test('物化出行：role_id + instance_id + 派生 id（roleId_instanceId），字段取自契约', () => {
    const result = materializeInstanceRoster(db, { instanceId: INSTANCE, projectRoot });

    expect(result.skipped).toBe(false);
    expect(result.created).toEqual(['scout_wsp_x', 'builder_wsp_x']);

    const scout = rawCharacter('scout_wsp_x');
    expect(scout).toBeDefined();
    expect(String(scout?.role_id)).toBe('scout');
    expect(String(scout?.instance_id)).toBe(INSTANCE);
    expect(String(scout?.name)).toBe('斥候');
    expect(String(scout?.persona)).toBe('你负责在项目里到处看，先摸清地形再动手。');
    expect(String(scout?.kind)).toBe('claude-code');
    // 契约的 state.* 只在**建行**时当初值。
    expect(Number(scout?.level)).toBe(2);
    expect(Number(scout?.exp)).toBe(30);
    expect(Number(scout?.context_enabled)).toBe(1);
    // 运行层独有的列：物化不编造。
    expect(scout?.appearance ?? null).toBeNull();
    expect(scout?.skin_id ?? null).toBeNull();
    expect(scout?.external_session_id ?? null).toBeNull();
  });

  test('进入副本时读得到物化出来的角色（进入链 = InstanceLoaderPort.load 路径）', async () => {
    const source = createSqliteInstanceDataSource(db, {
      resolveInstanceRoot: () => projectRoot,
    });

    const snapshot = await source.read(INSTANCE);

    // 读口按 `created_at ASC, id ASC` 排序 ⇒ 同批建行按 id 排（builder < scout）。
    expect(snapshot.characters.map((c) => c.id)).toEqual(['builder_wsp_x', 'scout_wsp_x']);
    expect(snapshot.characters.every((c) => c.instanceId === INSTANCE)).toBe(true);
    // 单位由角色投影而来 ⇒ 物化出来的角色在战场上有单位。
    expect(snapshot.units.map((u) => u.id)).toEqual(['unit_builder_wsp_x', 'unit_scout_wsp_x']);
  });

  test('同一份 roster 在两个副本各有一行（副本独立养成：id 与归属都按副本分）', async () => {
    materializeInstanceRoster(db, { instanceId: INSTANCE, projectRoot });
    materializeInstanceRoster(db, { instanceId: OTHER_INSTANCE, projectRoot });

    expect(rawCharacter('scout_wsp_x')?.role_id).toBe('scout');
    expect(rawCharacter('scout_wsp_y')?.role_id).toBe('scout');
    expect(String(rawCharacter('scout_wsp_y')?.instance_id)).toBe(OTHER_INSTANCE);
    // 两行是两个世界：改 A 的等级不影响 B。
    db.prepare('UPDATE characters SET level = 9 WHERE id = ?').run('scout_wsp_x');
    expect(Number(rawCharacter('scout_wsp_x')?.level)).toBe(9);
    expect(Number(rawCharacter('scout_wsp_y')?.level)).toBe(2);
  });

  test('没有契约 / 没有 roster ⇒ 不物化、不抛', () => {
    const emptyRoot = path.join(tmpDir, 'empty');
    fs.mkdirSync(emptyRoot, { recursive: true });

    const result = materializeInstanceRoster(db, { instanceId: INSTANCE, projectRoot: emptyRoot });

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('no-roster');
    expect(countRows(INSTANCE)).toBe(0);
  });
});

// ============================================================================
// ② 幂等：重复物化零重复
// ============================================================================
describe('幂等：同一 roster 重复物化零重复行', () => {
  test('物化两次 ⇒ 行数不变，第二次一条也不建', () => {
    materializeInstanceRoster(db, { instanceId: INSTANCE, projectRoot });
    expect(countRows(INSTANCE)).toBe(2);

    const second = materializeInstanceRoster(db, { instanceId: INSTANCE, projectRoot });

    expect(second.created).toEqual([]);
    expect(second.refreshed).toEqual([]);
    expect(second.unchanged).toEqual(['scout_wsp_x', 'builder_wsp_x']);
    expect(countRows(INSTANCE)).toBe(2);
  });

  test('复合唯一索引 (role_id, instance_id) 兜底：重复行插不进去', () => {
    materializeInstanceRoster(db, { instanceId: INSTANCE, projectRoot });

    expect(() =>
      db
        .prepare(
          `INSERT INTO characters (id, name, kind, persona, level, exp, appearance, body_type, skin_id,
             external_session_id, context_enabled, created_at, updated_at, instance_id, role_id)
           VALUES ('scout_dup', '斥候', 'claude-code', '', 1, 0, NULL, NULL, NULL, NULL, 1, 1, 1, ?, 'scout')`
        )
        .run(INSTANCE)
    ).toThrow();
    expect(countRows(INSTANCE)).toBe(2);
  });
});

// ============================================================================
// ③ 沙盒不被物化误伤
// ============================================================================
describe('沙盒不被物化误伤', () => {
  test('物化到别的副本 ⇒ 沙盒的存量行一个字节都不改', () => {
    insertLegacySandboxRow('legacy-1', '老角色');
    const before = rawCharacter('legacy-1');

    materializeInstanceRoster(db, { instanceId: INSTANCE, projectRoot });

    const after = rawCharacter('legacy-1');
    expect(after).toEqual(before);
    expect(after?.instance_id ?? null).toBeNull();
    expect(after?.role_id ?? null).toBeNull();
    expect(Number(after?.level)).toBe(5);
    expect(Number(after?.exp)).toBe(700);
  });

  test('沙盒本身不被物化（默认沙盒是历史数据的 catch-all）', () => {
    insertLegacySandboxRow('legacy-1', '老角色');

    const result = materializeInstanceRoster(db, {
      instanceId: DEFAULT_INSTANCE_ID,
      projectRoot,
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('sandbox');
    // 一个字节都没写：沙盒里仍然只有那一条老行。
    expect(countRows(null)).toBe(1);
  });

  test('读口按副本隔离：进沙盒读不到别的副本的行，反之亦然', async () => {
    insertLegacySandboxRow('legacy-1', '老角色');
    materializeInstanceRoster(db, { instanceId: INSTANCE, projectRoot });

    const source = createSqliteInstanceDataSource(db, {
      resolveInstanceRoot: () => projectRoot,
    });

    const sandbox = await source.read(DEFAULT_INSTANCE_ID);
    expect(sandbox.characters.map((c) => c.id)).toEqual(['legacy-1']);

    const other = await source.read(INSTANCE);
    expect(other.characters.map((c) => c.id)).toEqual(['builder_wsp_x', 'scout_wsp_x']);

    // 库这一层的归属口径也一致。
    expect(loadCharacters(db, { instanceId: DEFAULT_INSTANCE_ID }).map((c) => c.id)).toEqual([
      'legacy-1',
    ]);
    expect(loadCharacters(db, { instanceId: INSTANCE }).map((c) => c.id)).toEqual([
      'builder_wsp_x',
      'scout_wsp_x',
    ]);
  });
});

// ============================================================================
// ④ 单向：运行层改动不回写契约
// ============================================================================
describe('单向：契约 → 运行层，永不反向', () => {
  test('运行层改了角色 ⇒ 契约文件字节不变（运行层不回写契约）', () => {
    const rosterFile = path.join(projectRoot, '.stratix/roster/scout.json');
    const before = fs.readFileSync(rosterFile, 'utf8');

    materializeInstanceRoster(db, { instanceId: INSTANCE, projectRoot });
    db.prepare("UPDATE characters SET level = 9, exp = 999, name = '运行时改的名' WHERE id = ?").run(
      'scout_wsp_x'
    );
    materializeInstanceRoster(db, { instanceId: INSTANCE, projectRoot });

    expect(fs.readFileSync(rosterFile, 'utf8')).toBe(before);
  });

  test('契约的 reconcile 不覆盖运行层拥有的字段（level / exp 不被打回初值）', () => {
    materializeInstanceRoster(db, { instanceId: INSTANCE, projectRoot });
    db.prepare('UPDATE characters SET level = 9, exp = 999 WHERE id = ?').run('scout_wsp_x');

    const second = materializeInstanceRoster(db, { instanceId: INSTANCE, projectRoot });

    // 运行层字段：不动（契约里的 state.* 只是**建行初值**，不是每次 reconcile 都刷）。
    expect(Number(rawCharacter('scout_wsp_x')?.level)).toBe(9);
    expect(Number(rawCharacter('scout_wsp_x')?.exp)).toBe(999);
    // 契约字段这次没变 ⇒ 不动它（unchanged）。
    expect(second.unchanged).toContain('scout_wsp_x');
    expect(second.refreshed).toEqual([]);
  });

  test('契约拥有的字段按契约刷新（名字 / 人设 / agent 绑定 = 契约的真相源）', () => {
    materializeInstanceRoster(db, { instanceId: INSTANCE, projectRoot });
    db.prepare("UPDATE characters SET name = '运行时改的名', persona = '运行时改的人设' WHERE id = ?").run(
      'scout_wsp_x'
    );

    const second = materializeInstanceRoster(db, { instanceId: INSTANCE, projectRoot });

    expect(second.refreshed).toEqual(['scout_wsp_x']);
    expect(String(rawCharacter('scout_wsp_x')?.name)).toBe('斥候');
    expect(String(rawCharacter('scout_wsp_x')?.persona)).toBe('你负责在项目里到处看，先摸清地形再动手。');
  });

  test('物化全程不写契约目录（.stratix 下没有多出任何文件）', () => {
    const before = fs.readdirSync(path.join(projectRoot, '.stratix/roster')).sort();

    materializeInstanceRoster(db, { instanceId: INSTANCE, projectRoot });
    materializeInstanceRoster(db, { instanceId: INSTANCE, projectRoot });

    expect(fs.readdirSync(path.join(projectRoot, '.stratix/roster')).sort()).toEqual(before);
  });

  test('DB 半：直接喂角色清单也能物化（读盘半与写盘半解耦）', () => {
    const result = materializeRosterCharacters(db, {
      instanceId: INSTANCE,
      roles: [
        {
          id: 'scout',
          name: '斥候',
          persona: '人设',
          agentKind: 'claude-code',
          level: 1,
          experience: 0,
          contextEnabled: true,
        },
      ],
    });

    expect(result.created).toEqual(['scout_wsp_x']);
    expect(String(rawCharacter('scout_wsp_x')?.persona)).toBe('人设');
  });
});
