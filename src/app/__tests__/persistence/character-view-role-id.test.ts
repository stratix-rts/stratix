/**
 * 集成测试：**N1 —— `CharacterView.roleId` 入契约 + 生产侧填充**（@since v3.3，task_225 / QA-05）。
 *
 * 权威依据：docs/DESIGN-project-map.md §1.2.3
 *   （`CharacterView` 增 `readonly roleId?: string | null;` = 「对应的**逻辑角色 id**
 *   （= `.stratix/roster/<role-id>.json` 的 id）」，缺省 / null = 未绑定到契约角色）
 *   与 §1.3.2 N4b **规则①**（「禁止解析 id 字符串判断身份，一律用 `role_id` 列」）。
 *
 * 四条验收逐条落到可执行的断言：
 *   ① **契约字段**：CharacterView 上有 `roleId`（可选增补 —— 老构造点照旧编译）；
 *   ② **生产填充**：roster 物化写下的 `role_id` 列 ⇒ 读口带出 ⇒ 视图上的 `roleId`；
 *   ③ **身份不靠解析 id**：`role_id` 与行 id **不一致**的行，视图的 roleId 仍以列为准
 *      （这正是「解析 id 字符串判身份」会判错的情形）；
 *   ④ **缺省语义**：`role_id` 未回填的行 ⇒ 视图**不带** roleId 键（未绑定到契约角色，
 *      core 不替它编一个）。
 *
 * 驱动：真实 sql.js 适配器 + 临时文件库（与其它持久化单测同口径 ——
 *   「真 SQL 兼容性」恰是被测对象，mock 掉连接等于把被测对象一起 mock 掉）。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { Database } from '@/stratix-database/sqlite-adapter';

import { DEFAULT_INSTANCE_ID } from '../../../core/types';
import { recordToCharacterView } from '../../services/persistence/character-record';
import {
  ensureGameSaveTables,
  loadCharacters,
  upsertCharacters,
  type PersistedCharacterRecord,
} from '../../services/persistence/game-save-dao';
import { materializeInstanceRoster } from '../../services/persistence/roster-materializer';

// ============================================================================
// 夹具
// ============================================================================

/** 非沙盒的副本 id（新副本）。 */
const INSTANCE = 'wsp_x';

let tmpDir = '';
let projectRoot = '';
let db: Database;

function writeJson(relPath: string, value: unknown): void {
  const filePath = path.join(projectRoot, relPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

/** 写一份最小契约（一个 roster 角色 `scout`）。 */
function writeContract(): void {
  writeJson('.stratix/project.json', {
    formatVersion: 1,
    id: 'spx_9f3c2a1b7d4e5f60',
    name: '雨林哨站',
    description: '一句话说明这个项目要做成什么',
  });
  writeJson('.stratix/roster/_index.json', {
    roles: [{ id: 'scout' }],
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
}

/** 插一行角色（绕过 DAO 写入口：写侧不认 role_id —— 那是 roster 物化的活）。 */
function insertCharacterRow(
  id: string,
  patch: { roleId?: string | null; instanceId?: string | null } = {}
): void {
  db.prepare(
    `INSERT INTO characters (id, name, kind, persona, level, exp, appearance, body_type, skin_id,
       external_session_id, context_enabled, created_at, updated_at, instance_id, role_id)
     VALUES (?, '测试角色', 'codex', '', 1, 0, NULL, NULL, NULL, NULL, 1, 1000, 1000, ?, ?)`
  ).run(id, patch.instanceId ?? null, patch.roleId ?? null);
}

/** 一条最小的持久化记录（upsert 用）。 */
function aRecord(id: string, patch: Partial<PersistedCharacterRecord> = {}): PersistedCharacterRecord {
  return {
    id,
    name: '测试角色',
    agentKind: 'codex',
    persona: '',
    level: 1,
    exp: 0,
    appearanceJson: null,
    bodyType: null,
    skinId: null,
    externalSessionId: null,
    contextEnabled: true,
    createdAt: 1000,
    ...patch,
  };
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-character-role-id-'));
  projectRoot = path.join(tmpDir, 'project');
  fs.mkdirSync(projectRoot, { recursive: true });
  writeContract();

  db = new Database(path.join(tmpDir, 'game.sqlite'));
  await db.initialize();
  ensureGameSaveTables(db);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ============================================================================
// ① 契约字段 + ② 生产侧填充
// ============================================================================
describe('N1：CharacterView.roleId 入契约 + 生产侧从 role_id 列填充（task_225 / QA-05）', () => {
  test('roster 物化写下的 role_id ⇒ 视图上的 roleId（生产侧填充到位）', () => {
    materializeInstanceRoster(db, { instanceId: INSTANCE, projectRoot });

    // 读口按副本取行 —— 物化行带 role_id（= 'scout'）。
    const records = loadCharacters(db, { instanceId: INSTANCE });
    expect(records).toHaveLength(1);
    expect(records[0]?.roleId).toBe('scout');

    // 视图层带上 roleId（= 契约 §1.2.3 的字段）。
    const view = recordToCharacterView(records[0] as PersistedCharacterRecord);
    expect(view?.roleId).toBe('scout');
    // 归属字段与身份字段**并存**（缺一不可：只有 roleId 不知道住在哪个副本，只有 instanceId 不知道是谁）。
    expect(view?.instanceId).toBe(INSTANCE);
  });

  test('默认沙盒的存量行（role_id 未回填）⇒ 视图不带 roleId 键（未绑定到契约角色）', () => {
    insertCharacterRow('chr_legacy_1', { instanceId: DEFAULT_INSTANCE_ID });

    const records = loadCharacters(db, { instanceId: DEFAULT_INSTANCE_ID });
    expect(records).toHaveLength(1);
    // 记录形状：未回填的行**不带** roleId 键（往返保真）。
    expect(records[0] && 'roleId' in records[0]).toBe(false);

    const view = recordToCharacterView(records[0] as PersistedCharacterRecord);
    // 视图形状：缺省 / null = 未绑定到契约角色 ⇒ 不编造。
    expect(view && 'roleId' in view).toBe(false);
  });
});

// ============================================================================
// ③ 身份不靠解析 id 字符串
// ============================================================================
describe('N1：身份只看 role_id 列，不解析行 id 字符串（N4b 规则①）', () => {
  test('行 id 与 role_id 不一致时，视图的 roleId 以 role_id 列为准', () => {
    // 历史 id 里带下划线（'chr_legacy_1'）⇒ 解析 id 字符串会得到 'chr' ⇒ 判错。
    insertCharacterRow('chr_legacy_1', { roleId: 'scout', instanceId: INSTANCE });

    const records = loadCharacters(db, { instanceId: INSTANCE });
    const view = recordToCharacterView(records[0] as PersistedCharacterRecord);

    expect(view?.id).toBe('chr_legacy_1');
    expect(view?.roleId).toBe('scout'); // 列说了算，不是 id 说了算
    // 派生 id 的行同理：id = '<roleId>_<instanceId>'，roleId 仍是列上的值。
    expect(view?.roleId?.startsWith('chr')).toBe(false);
  });

  test('roster 物化出的行：id 是派生值，roleId 仍是列上的 roster 角色 id', () => {
    materializeInstanceRoster(db, { instanceId: INSTANCE, projectRoot });

    const records = loadCharacters(db, { instanceId: INSTANCE });
    const view = recordToCharacterView(records[0] as PersistedCharacterRecord);

    expect(view?.id).toBe('scout_wsp_x');
    expect(view?.roleId).toBe('scout');
  });
});

// ============================================================================
// ④ 只读镜像：档案回写不冲掉归属
// ============================================================================
describe('N1：role_id 是只读镜像 —— 档案回写不抹掉 roster 写下的归属', () => {
  test('upsert 角色档案不写 role_id 列 ⇒ 既有归属原样保留', () => {
    materializeInstanceRoster(db, { instanceId: INSTANCE, projectRoot });

    // 回写同一行（模拟渲染层改名字后回写档案）。
    upsertCharacters(db, [aRecord('scout_wsp_x', { name: '改名后的斥候', instanceId: INSTANCE })]);

    const raw = db.prepare('SELECT name, role_id FROM characters WHERE id = ?').get('scout_wsp_x') as
      | { name?: string; role_id?: string | null }
      | undefined;
    expect(String(raw?.name)).toBe('改名后的斥候');
    // 归属没被回写冲掉。
    expect(String(raw?.role_id)).toBe('scout');

    const records = loadCharacters(db, { instanceId: INSTANCE });
    expect(records[0]?.roleId).toBe('scout');
  });
});
