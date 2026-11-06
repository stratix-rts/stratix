/**
 * `.stratix` 契约读盘半（task_169 / M0-05）单测。
 * 覆盖：① 契约缺失 ⇒ 空输入不抛 / ② 只读白名单字段（persona、凭据形状的键一律不读）/
 *      ③ skills 只列目录名（不读全文）/ ④ 分支是运行态事实而非契约字段 /
 *      ⑤ 尺寸上限拒绝加载 / ⑥ 读数口（createProjectContextLoader）三种供给情形 /
 *      ⑦ 分层铁律：core 零 IO（静态扫描）。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { buildProjectContextBlock } from '../services/project-context';
import {
  createProjectContextLoader,
  defaultProjectRootProvider,
  readProjectContextInput,
  readRosterRoleDefinitions,
  STRATIX_PROJECT_CONTEXT_MAX_ROLES_READ,
  STRATIX_PROJECT_JSON_MAX_BYTES,
} from '../services/project-context-loader';

// ============================================================================
// 夹具
// ============================================================================

/** 临时项目根（每个用例一个，afterEach 清理）。 */
let tmpRoot = '';

/** 建一个临时项目根（不含 .stratix）。 */
function makeRoot(): string {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-project-contract-'));
  return tmpRoot;
}

/** 往临时根里写一个 JSON 契约文件（相对路径）。 */
function writeJson(relPath: string, value: unknown): void {
  const filePath = path.join(tmpRoot, relPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

/** 往临时根里写一个纯文本文件（相对路径）。 */
function writeText(relPath: string, content: string): void {
  const filePath = path.join(tmpRoot, relPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

/** 一份完整的契约（各用例按需覆盖）。 */
function writeFullContract(): void {
  writeJson('.stratix/project.json', {
    $schema: 'https://stratix.dev/schemas/project/v1.json',
    formatVersion: 1,
    id: 'spx_9f3c2a1b7d4e5f60',
    name: '雨林哨站',
    description: '一句话说明这个项目要做成什么',
    createdAt: '2026-11-05T12:00:00.000Z',
    agents: { defaultRoleId: 'scout', defaultProfile: 'stratix-default' },
    engines: { stratix: '>=3.3.0' },
    links: { dsh: 'dsh/profile.json' },
    // 白名单外的字段：凭据形状的键 / 未知扩展 —— 一律不该进输入
    apiKey: 'sk-should-never-be-read',
    secretToken: 'never',
  });
  writeJson('.stratix/roster/_index.json', {
    roles: [{ id: 'scout' }, { id: 'builder' }],
    defaultRoleId: 'scout',
  });
  writeJson('.stratix/roster/scout.json', {
    id: 'scout',
    name: '斥候',
    persona: 'PERSONA-FULL-TEXT-MUST-NOT-LEAK',
    bindings: { agentKind: 'claude', model: null },
    capabilities: {
      tools: ['read', 'edit'],
      commands: ['/status'],
      skills: ['scout-recon'],
      systemPrompt: 'SYSTEM-PROMPT-SUGGESTION-ONLY',
    },
    state: { level: 1, experience: 0 },
  });
  writeJson('.stratix/roster/builder.json', {
    id: 'builder',
    name: '工匠',
    bindings: { agentKind: 'claude-code' },
    capabilities: { systemPrompt: null },
  });
  writeJson('.stratix/config/stratix.json', {
    agent: {
      defaultRoleId: 'scout',
      maxConcurrentWorkers: 2,
      permissionPreset: 'project-safe',
    },
    dsh: { profile: 'sdk', cwdStrategy: 'project-root' },
    history: { retentionMonths: 6 },
  });
  writeText('.stratix/skills/scout-recon/SKILL.md', '# scout-recon\n\n正文不注入\n');
  writeText('.stratix/skills/build-order/SKILL.md', '# build-order\n');
  writeText('.stratix/skills/empty-dir/README.md', '没有 SKILL.md ⇒ 不算技能\n');
  writeText('AGENTS.md', '# agents\n');
}

afterEach(() => {
  if (tmpRoot) {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    tmpRoot = '';
  }
});

// ============================================================================
// ① 契约缺失 ⇒ 空输入，不抛
// ============================================================================

describe('readProjectContextInput —— 契约缺失 ⇒ 空输入（不抛）', () => {
  it('没有 .stratix 目录 ⇒ 空输入，渲染成空块', () => {
    makeRoot();

    const input = readProjectContextInput(tmpRoot);

    expect(input).toEqual({});
    expect(buildProjectContextBlock(input)).toBe('');
  });

  it('.stratix 目录存在但没有契约文件 ⇒ 空输入', () => {
    makeRoot();
    fs.mkdirSync(path.join(tmpRoot, '.stratix', 'roster'), { recursive: true });

    expect(readProjectContextInput(tmpRoot)).toEqual({});
  });

  it('project.json 损坏（JSON 坏）⇒ 空输入，不抛', () => {
    makeRoot();
    writeText('.stratix/project.json', '{ 不是合法 JSON ');

    expect(() => readProjectContextInput(tmpRoot)).not.toThrow();
    expect(readProjectContextInput(tmpRoot)).toEqual({});
  });

  it('部分契约缺失 ⇒ 其余部分照常读出（缺的不填占位值）', () => {
    makeRoot();
    writeJson('.stratix/project.json', { id: 'spx_1', name: '半份契约' });

    const input = readProjectContextInput(tmpRoot);

    expect(input.projectId).toBe('spx_1');
    expect(input.projectName).toBe('半份契约');
    expect(input.projectDescription).toBeUndefined();
    expect(input.roles).toBeUndefined();
    expect(input.skills).toBeUndefined();
    expect(input.defaultRoleId).toBeUndefined();
  });

  it('roster/_index.json 缺失但角色文件在 ⇒ 目录枚举兜底（契约不算缺失）', () => {
    makeRoot();
    writeJson('.stratix/project.json', { id: 'spx_1', name: '有角色' });
    writeJson('.stratix/roster/scout.json', { id: 'scout', name: '斥候' });

    const input = readProjectContextInput(tmpRoot);

    expect(input.roles).toEqual([{ id: 'scout', name: '斥候' }]);
  });
});

// ============================================================================
// ② 只读白名单字段
// ============================================================================

describe('readProjectContextInput —— 只读白名单字段', () => {
  it('project.json：只取 id / name / description', () => {
    makeRoot();
    writeFullContract();

    const input = readProjectContextInput(tmpRoot);

    expect(input.projectId).toBe('spx_9f3c2a1b7d4e5f60');
    expect(input.projectName).toBe('雨林哨站');
    expect(input.projectDescription).toBe('一句话说明这个项目要做成什么');
    // 白名单外的键（凭据形状 / 未知扩展 / agents / engines / links）不进输入
    expect(Object.keys(input)).not.toContain('apiKey');
    expect(Object.keys(input)).not.toContain('secretToken');
    expect(Object.keys(input)).not.toContain('agents');
    expect(Object.keys(input)).not.toContain('engines');
    expect(Object.keys(input)).not.toContain('links');
    expect(JSON.stringify(input)).not.toContain('sk-should-never-be-read');
  });

  it('角色文件：只取 id / name / bindings.agentKind / capabilities.systemPrompt', () => {
    makeRoot();
    writeFullContract();

    const input = readProjectContextInput(tmpRoot);
    const scout = input.roles?.find((role) => role.id === 'scout');

    expect(scout).toBeDefined();
    expect(scout?.name).toBe('斥候');
    expect(scout?.agentKind).toBe('claude');
    // systemPrompt 降级为「建议片段」（数据），不是 system prompt 层
    expect(scout?.systemPromptSuggestion).toBe('SYSTEM-PROMPT-SUGGESTION-ONLY');
    // persona 全文 / tools / commands / skills / state 一律不读
    expect(Object.keys(scout ?? {})).toEqual(
      expect.arrayContaining(['id', 'name', 'agentKind', 'systemPromptSuggestion'])
    );
    expect(Object.keys(scout ?? {})).not.toContain('persona');
    expect(JSON.stringify(input)).not.toContain('PERSONA-FULL-TEXT-MUST-NOT-LEAK');
    expect(JSON.stringify(input)).not.toContain('"read"');
    expect(JSON.stringify(input)).not.toContain('/status');
  });

  it('config/stratix.json：只取 agent.* 三项', () => {
    makeRoot();
    writeFullContract();

    const input = readProjectContextInput(tmpRoot);

    expect(input.defaultRoleId).toBe('scout');
    expect(input.maxConcurrentWorkers).toBe(2);
    expect(input.permissionPreset).toBe('project-safe');
    expect(JSON.stringify(input)).not.toContain('project-root');
    expect(JSON.stringify(input)).not.toContain('retentionMonths');
  });

  it('systemPrompt 为 null ⇒ 不产出建议片段（不留空壳字段）', () => {
    makeRoot();
    writeFullContract();

    const input = readProjectContextInput(tmpRoot);
    const builder = input.roles?.find((role) => role.id === 'builder');

    expect(builder?.name).toBe('工匠');
    expect(builder?.systemPromptSuggestion).toBeUndefined();
  });
});

// ============================================================================
// ③ 技能 / 指令文件
// ============================================================================

describe('readProjectContextInput —— 技能只列目录名，指令文件只报存在性', () => {
  it('技能 = 含 SKILL.md 的目录名（不读全文，空壳目录不算）', () => {
    makeRoot();
    writeFullContract();

    const input = readProjectContextInput(tmpRoot);

    expect(input.skills).toEqual(['build-order', 'scout-recon']);
    expect(input.skills).not.toContain('empty-dir');
  });

  it('指令文件：AGENTS.md / CLAUDE.md 存在才列', () => {
    makeRoot();
    writeFullContract();

    const input = readProjectContextInput(tmpRoot);

    expect(input.instructionFiles).toEqual(['AGENTS.md']);
  });
});

// ============================================================================
// ④ 分支是运行态事实，不是契约字段
// ============================================================================

describe('readProjectContextInput —— 分支来自运行态，不来自契约', () => {
  it('传入 branch ⇒ 进输入；契约里的 branch 字段不被采纳', () => {
    makeRoot();
    writeJson('.stratix/project.json', { id: 'spx_1', name: '项目', branch: '契约里的假分支' });

    const input = readProjectContextInput(tmpRoot, { branch: 'demo/v3.3' });

    expect(input.branch).toBe('demo/v3.3');
    expect(input.branch).not.toBe('契约里的假分支');
  });

  it('没传 branch ⇒ 整项省略（不填占位值）', () => {
    makeRoot();
    writeJson('.stratix/project.json', { id: 'spx_1', name: '项目' });

    const input = readProjectContextInput(tmpRoot);

    expect(input.branch).toBeUndefined();
  });
});

// ============================================================================
// ⑤ 尺寸上限：超限拒绝加载并报原因
// ============================================================================

describe('readProjectContextInput —— 尺寸上限', () => {
  it('project.json 超 64 KiB ⇒ 拒绝加载（该项目字段为空）并记日志', () => {
    makeRoot();
    const big = 'x'.repeat(STRATIX_PROJECT_JSON_MAX_BYTES + 100);
    writeText(
      '.stratix/project.json',
      JSON.stringify({ id: 'spx_1', name: '超限项目', description: big })
    );
    const lines: string[] = [];

    const input = readProjectContextInput(tmpRoot, { logger: (line) => lines.push(line) });

    expect(input.projectName).toBeUndefined();
    expect(lines.join('\n')).toContain('超尺寸上限');
  });
});

// ============================================================================
// ⑥ 读数口（createProjectContextLoader）
// ============================================================================

describe('createProjectContextLoader —— 读数口', () => {
  it('项目根给不出 ⇒ 返回 null（= 不注入）', () => {
    const load = createProjectContextLoader();

    expect(load()).toBeNull();
  });

  it('缺省项目根供给口恒给不出', () => {
    expect(defaultProjectRootProvider()).toBeUndefined();
  });

  it('项目根给出 + 契约存在 ⇒ 返回组装好的输入', () => {
    makeRoot();
    writeFullContract();
    const load = createProjectContextLoader({ root: () => tmpRoot, branch: () => 'demo/v3.3' });

    const input = load();

    expect(input?.projectName).toBe('雨林哨站');
    expect(input?.branch).toBe('demo/v3.3');
    expect(input?.roles).toHaveLength(2);
  });

  it('项目根给出但契约缺失 ⇒ 无可注入内容（返回 null，渲染成空块）', () => {
    makeRoot();
    const load = createProjectContextLoader({ root: () => tmpRoot });

    expect(load()).toBeNull();
    expect(buildProjectContextBlock(load())).toBe('');
  });

  it('项目根供给口抛错 ⇒ 返回 null，不抛', () => {
    const load = createProjectContextLoader({
      root: () => {
        throw new Error('供给口坏了');
      },
    });

    expect(() => load()).not.toThrow();
    expect(load()).toBeNull();
  });
});

// ============================================================================
// ⑦ 分层铁律：core 零 IO（静态扫描）
// ============================================================================

/** 递归列出目录下所有 .ts 文件。 */
function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      out.push(...listTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('分层铁律 —— 读文件只发生在 app 侧', () => {
  const repoRoot = process.cwd();

  it('core 层零 import fs / sqlite / persistence', () => {
    const offenders = listTsFiles(path.join(repoRoot, 'src', 'core')).filter((file) => {
      const source = fs.readFileSync(file, 'utf8');
      return (
        /from\s+'(node:)?fs'/.test(source) ||
        /from\s+'(node:)?sqlite3?'/.test(source) ||
        /from\s+'[^']*persistence[^']*'/.test(source)
      );
    });

    expect(offenders).toEqual([]);
  });

  it('拼串模块 project-context.ts 保持零 IO（渲染层要引它）', () => {
    const source = fs.readFileSync(
      path.join(repoRoot, 'src', 'app', 'services', 'project-context.ts'),
      'utf8'
    );

    expect(/from\s+'(node:)?fs'/.test(source)).toBe(false);
    expect(/from\s+'(node:)?sqlite3?'/.test(source)).toBe(false);
  });

  it('读盘半独立成文件（project-context-loader.ts 才碰 fs）', () => {
    const source = fs.readFileSync(
      path.join(repoRoot, 'src', 'app', 'services', 'project-context-loader.ts'),
      'utf8'
    );

    expect(/from\s+'(node:)?fs'/.test(source)).toBe(true);
  });
});

// ============================================================================
// 规模护栏
// ============================================================================

describe('规模护栏 —— 角色读盘条数有上限', () => {
  it('角色文件超上限时只读前 N 个（不让恶意仓库拖垮装配）', () => {
    makeRoot();
    writeJson('.stratix/project.json', { id: 'spx_1', name: '多角色' });
    const ids = Array.from({ length: STRATIX_PROJECT_CONTEXT_MAX_ROLES_READ + 20 }, (_, i) => `r${i}`);
    writeJson('.stratix/roster/_index.json', { roles: ids.map((id) => ({ id })) });
    for (const id of ids) {
      writeJson(`.stratix/roster/${id}.json`, { id, name: id });
    }

    const input = readProjectContextInput(tmpRoot);

    expect(input.roles).toHaveLength(STRATIX_PROJECT_CONTEXT_MAX_ROLES_READ);
  });
});

// ============================================================================
// 物化视图（步 N6 / task_202）—— 与上下文块是**两套不同的白名单**
// ============================================================================

describe('readRosterRoleDefinitions —— 物化视图（契约 → 运行层）', () => {
  it('读到契约自有字段（id / name / persona / agentKind）+ 运行态初值', () => {
    makeRoot();
    writeFullContract();

    const roles = readRosterRoleDefinitions(tmpRoot);

    expect(roles.map((r) => r.id)).toEqual(['scout', 'builder']);
    const scout = roles[0];
    expect(scout.name).toBe('斥候');
    expect(scout.persona).toBe('PERSONA-FULL-TEXT-MUST-NOT-LEAK');
    expect(scout.agentKind).toBe('claude');
    expect(scout.level).toBe(1);
    expect(scout.experience).toBe(0);
    expect(scout.contextEnabled).toBe(true);
    // 契约里没写的项：缺省而不是编造。
    const builder = roles[1];
    expect(builder.persona).toBe('');
    expect(builder.level).toBe(1);
  });

  it('没有 .stratix / 没有 roster ⇒ 空清单，不抛', () => {
    makeRoot();
    expect(readRosterRoleDefinitions(tmpRoot)).toEqual([]);

    writeJson('.stratix/project.json', { id: 'spx_1' });
    expect(readRosterRoleDefinitions(tmpRoot)).toEqual([]);
  });

  it('索引缺失 ⇒ 目录枚举兜底（口径与上下文读出口同款）', () => {
    makeRoot();
    writeJson('.stratix/roster/scout.json', { id: 'scout', name: '斥候' });

    const roles = readRosterRoleDefinitions(tmpRoot);

    expect(roles.map((r) => r.id)).toEqual(['scout']);
  });

  it('角色文件读不到 ⇒ 不产出幽灵角色', () => {
    makeRoot();
    writeJson('.stratix/roster/_index.json', { roles: [{ id: 'ghost' }] });

    expect(readRosterRoleDefinitions(tmpRoot)).toEqual([]);
  });

  it('规模护栏：角色条数有上限（恶意仓库也读不完）', () => {
    makeRoot();
    const ids = Array.from({ length: STRATIX_PROJECT_CONTEXT_MAX_ROLES_READ + 20 }, (_, i) => `r${i}`);
    writeJson('.stratix/roster/_index.json', { roles: ids.map((id) => ({ id })) });
    for (const id of ids) {
      writeJson(`.stratix/roster/${id}.json`, { id, name: id });
    }

    expect(readRosterRoleDefinitions(tmpRoot)).toHaveLength(
      STRATIX_PROJECT_CONTEXT_MAX_ROLES_READ
    );
  });
});
