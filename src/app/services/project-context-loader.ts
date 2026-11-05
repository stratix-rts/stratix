/**
 * 文件职责：`.stratix` 项目契约的**读盘半**（@since v3.3，task_169 / docs/DESIGN-workspace.md §8 M0-05）。
 *   读项目根下的 `.stratix/` 契约文件 → 组装 `ProjectContextInput`（**纯数据**）→
 *   交给 `src/app/services/project-context.ts` 的三段式（builder / provider / resolve）消费。
 *
 * ============ 为什么读盘半要单独一个文件（分层铁律）============
 *   `project-context.ts` 的文件头写着「禁止 import fs / electron / DAO —— 本文件零 IO」：
 *   它是**渲染层也能引**的纯模块（拼串）。而读 `.stratix` 必须是 IO。
 *   ⇒ 两者分家：本文件（**Node 侧**）负责读，纯模块负责拼。
 *   core / world / hud **零 IO**（DESIGN-project-map §3.3.4）⇒ 本文件只在 app 侧被引。
 *
 * ============ 本文件只能被 Node 侧组合根引用（硬约束）============
 *   本文件 import `fs` / `path` ⇒ **禁止**被渲染层模块引用
 *   （`src/app/main/main-entry.ts` / `src/app/services/task-service.ts` / `chat-service.ts` /
 *    `src/hud` / `src/world`）—— 渲染层引它会把 node 内建模块打进浏览器 bundle。
 *   真正的装配点有两个，都是 Node 侧：
 *     ① Electron main / service 进程（`src/stratix-gateway/service/`）；
 *     ② 组合根 `src/app/main/main-entry.ts` —— ⚠️ 它是**渲染进程**入口（浏览器环境），
 *        故**不能**在这里直接引本文件；渲染侧的装配要走 IPC（Electron main 读 → 传纯数据）。
 *   注入点接线（把块塞进派单 prompt）是 M0-06 的范围；本条只交付**读数口**。
 *
 * ============ 只读白名单字段（验收③）============
 *   `.stratix` 随 git 传播 ⇒ 内容**不可信**。本文件**只取**下面这张表里的字段，
 *   其余字段（persona / capabilities.tools / capabilities.commands / state / engines / links /
 *   未知扩展字段 / 任何凭据形状的键）**一律不读、不转述**：
 *
 *   | 源文件 | 取的字段 | 落到 ProjectContextInput 的哪一项 |
 *   |---|---|---|
 *   | `.stratix/project.json` | `id` / `name` / `description` | `projectId` / `projectName` / `projectDescription` |
 *   | `.stratix/roster/_index.json` | 角色 id + 顺序（+ 索引里的默认角色，仅作兜底） | `roles[].id` 的顺序来源 |
 *   | `.stratix/roster/<role-id>.json` | `id` / `name` / `bindings.agentKind` / `capabilities.systemPrompt` | `roles[]` 的四项 |
 *   | `.stratix/config/stratix.json` | `agent.defaultRoleId` / `agent.maxConcurrentWorkers` / `agent.permissionPreset` | `defaultRoleId` / `maxConcurrentWorkers` / `permissionPreset` |
 *   | `.stratix/skills/<skill-name>/SKILL.md` | **目录名**（不读 SKILL.md 全文） | `skills[]` |
 *   | 项目根的 `AGENTS.md` / `CLAUDE.md` | **存在性** | `instructionFiles[]` |
 *
 *   `capabilities.systemPrompt`（仓库里的追加 system prompt 段）**降级为「仓库建议片段」**
 *   （`roles[].systemPromptSuggestion`）—— 它是**数据**，不进 system prompt 层
 *   （权威 system prompt 只允许来自本地用户设置；DESIGN-project-map §3.3.3 裁决②）。
 *
 * ============ 契约缺失 ⇒ 空输入（验收②）============
 *   `.stratix` 目录不存在 / 文件缺失 / JSON 坏 / 文件超限 ⇒ **该部分当没有**，
 *   全部部分都没有 ⇒ 返回**空输入**（`{}`）⇒ 渲染成空块（无块）⇒ **全程不抛错**。
 *   why 不抛：契约是**增强**不是**依赖**（与 resolveProjectContextBlock 的吞错口径同源）——
 *   坏掉的 `.stratix` 不该让派单回路失败。
 *
 * ============ 体积与规模护栏（性能 + 契约自带的尺寸上限）============
 *   文件大小上限照抄 DESIGN-workspace 的契约面尺寸预算：
 *   `project.json` ≤ 64 KiB、单个 `roster/*.json` ≤ 256 KiB、`config/*.json` ≤ 64 KiB
 *   —— 超限**拒绝加载并记原因**（不静默截断半个文件）。
 *   角色 / 技能读盘条数有上限（`STRATIX_PROJECT_CONTEXT_MAX_ROLES_READ` /
 *   `STRATIX_PROJECT_CONTEXT_MAX_SKILLS_READ`）⇒ 恶意仓库塞 10 万个角色也读不完。
 *
 * ============ dsh 双面向（§8 M0-05 行）============
 *   - **用**：dsh 的 `agent-instructions` 用 `projectRootMarkers`（可配）认项目根；
 *     Stratix 侧生成 patch 时显式设 `['.stratix', '.git']` ⇒ dsh 认得 `.stratix`（本条不产出 patch，
 *     patch 属 dsh 桥接件 M3；本文件只保证 `.stratix` 的**读取口径**与之一致）。
 *   - **暴露**：`.stratix` 是 Stratix 插件形态下**唯一**的契约载体 ⇒ **不进 dsh 的部署面**
 *     （D1/D7：profile/bundle 属部署概念，项目元数据不进）。本文件即该契约面的读取入口。
 *
 * 禁止事项：
 *   1. import electron / sqlite / persistence —— 只读普通文件，不碰库；
 *   2. 抛错 —— 对外函数全部不抛（读盘失败一律降级为空输入）；
 *   3. 读白名单以外的字段 —— 尤其 `persona` / `capabilities.tools` / 任何凭据形状的键；
 *   4. 读 `SKILL.md` 全文 / `roster/history/` —— 两级注入（目录进 prompt，全文按需取）。
 *
 * @since v3.3，task_169（M0-05）。设计依据：docs/DESIGN-workspace.md §8「M0-05」行 +
 * docs/DESIGN-project-map.md §3.3.3（内容契约）/ §3.3.4（谁来读 `.stratix`）。
 */

import * as fs from 'fs';
import * as path from 'path';

import type { ProjectContextInput, ProjectContextLoader, ProjectRoleInput } from './project-context';

// ============================================================================
// 契约常量（尺寸上限照抄 DESIGN-workspace §1.3 的契约面尺寸预算）
// ============================================================================

/** `project.json` 尺寸上限（字节）—— 超限拒绝加载并记原因。 */
export const STRATIX_PROJECT_JSON_MAX_BYTES = 64 * 1024;
/** 单个 `roster/*.json` 尺寸上限（字节）。 */
export const STRATIX_ROSTER_JSON_MAX_BYTES = 256 * 1024;
/** `config/*.json` 尺寸上限（字节）。 */
export const STRATIX_CONFIG_JSON_MAX_BYTES = 64 * 1024;

/** 单次装配最多读多少个角色文件（规模护栏：恶意仓库塞 10 万个角色也读不完）。 */
export const STRATIX_PROJECT_CONTEXT_MAX_ROLES_READ = 50;
/** 单次装配最多列多少个项目技能（规模护栏）。 */
export const STRATIX_PROJECT_CONTEXT_MAX_SKILLS_READ = 100;

/** 项目根的指令文件候选名（只报存在性；dsh 的候选清单）。 */
export const STRATIX_PROJECT_INSTRUCTION_FILES: readonly string[] = ['AGENTS.md', 'CLAUDE.md'];

/** 契约面目录名（项目根下）。 */
const STRATIX_CONTRACT_DIR = '.stratix';

// ============================================================================
// 小工具（纯函数，读盘之外的一切都在这里）
// ============================================================================

/** 日志口（缺省静默）。 */
type Logger = (line: string) => void;

const silentLogger: Logger = (): void => {
  /* 缺省静默 */
};

/** 值是不是「普通对象」（排除数组 / null）。 */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** 取非空字符串（去空白）；不是字符串 / 空 ⇒ undefined。 */
function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** 取有限数字；不是数字 / 非有限 ⇒ undefined。 */
function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}

/** 路径存在且是普通文件？ */
function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/** 路径存在且是目录？ */
function isDirectory(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 读一份契约 JSON（**只读，不抛**）。
 * 文件不存在 / 不是普通文件 / 超尺寸上限 / JSON 坏 ⇒ 返回 null（= 没有这份契约）。
 */
function readContractJson(filePath: string, maxBytes: number, logger: Logger): unknown {
  let raw: string;
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    if (stat.size > maxBytes) {
      logger(
        `[ProjectContextLoader] 契约文件超尺寸上限，拒绝加载：${filePath}（${stat.size} > ${maxBytes} 字节）`
      );
      return null;
    }
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    // 文件不存在 / 读不了 ⇒ 当没有这份契约（不抛、不吵）。
    return null;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    logger(
      `[ProjectContextLoader] 契约文件 JSON 损坏，当作没有这份契约：${filePath}（${
        error instanceof Error ? error.message : String(error)
      }）`
    );
    return null;
  }
}

// ============================================================================
// 逐个契约文件的读取（各自独立：一个坏的不影响别的）
// ============================================================================

/** `project.json` 的白名单部分。 */
interface IdentityPart {
  readonly projectId?: string;
  readonly projectName?: string;
  readonly projectDescription?: string;
}

/** 读 `.stratix/project.json`（只取 id / name / description）。 */
function readIdentity(contractDir: string, logger: Logger): IdentityPart {
  const record = asRecord(
    readContractJson(path.join(contractDir, 'project.json'), STRATIX_PROJECT_JSON_MAX_BYTES, logger)
  );
  if (!record) return {};
  const projectId = asString(record.id);
  const projectName = asString(record.name);
  const projectDescription = asString(record.description);
  return {
    ...(projectId ? { projectId } : {}),
    ...(projectName ? { projectName } : {}),
    ...(projectDescription ? { projectDescription } : {}),
  };
}

/** `roster/_index.json` 里的一个条目（id 必填；name / agentKind 可缺）。 */
interface RosterIndexEntry {
  readonly id: string;
  readonly name?: string;
  readonly agentKind?: string;
}

/** `roster/_index.json` 的解析结果。 */
interface RosterIndex {
  readonly entries: readonly RosterIndexEntry[];
  readonly defaultRoleId?: string;
}

/** 从记录里挑出「角色数组」—— 索引文件的形状未冻结 ⇒ 宽容读（多种键名都认）。 */
function pickRosterArray(record: Record<string, unknown>): unknown[] | null {
  for (const key of ['roles', 'entries', 'roster', 'items']) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return null;
}

/** 解析 `roster/_index.json`（数组 / {roles|entries|roster|items:[…]} 都认；坏 ⇒ 空）。 */
function parseRosterIndex(raw: unknown): RosterIndex {
  const list = Array.isArray(raw) ? raw : (asRecord(raw) ? pickRosterArray(asRecord(raw)!) : null);
  const entries: RosterIndexEntry[] = [];
  const seen = new Set<string>();
  if (list) {
    for (const item of list) {
      let id: string | undefined;
      let name: string | undefined;
      let agentKind: string | undefined;
      if (typeof item === 'string') {
        id = asString(item);
      } else {
        const record = asRecord(item);
        if (!record) continue;
        id = asString(record.id) ?? asString(record.roleId) ?? asString(record.role);
        name = asString(record.name) ?? asString(record.displayName);
        agentKind =
          asString(record.agentKind) ?? asString(asRecord(record.bindings)?.agentKind);
      }
      if (!id || seen.has(id)) continue;
      seen.add(id);
      entries.push({
        id,
        ...(name ? { name } : {}),
        ...(agentKind ? { agentKind } : {}),
      });
    }
  }
  const record = asRecord(raw);
  const defaultRoleId = record
    ? asString(record.defaultRoleId) ?? asString(record.defaultRole) ?? asString(record.default)
    : undefined;
  return { entries, ...(defaultRoleId ? { defaultRoleId } : {}) };
}

/**
 * `roster/_index.json` 不可用时的兜底：直接枚举 `roster/*.json`（按文件名排序，顺序确定）。
 * why 需要兜底：索引文件未冻结形状，作者可能只写了角色文件 —— 此时契约**不算缺失**。
 */
function listRosterFiles(rosterDir: string): RosterIndexEntry[] {
  try {
    return fs
      .readdirSync(rosterDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && !entry.name.startsWith('_'))
      .map((entry) => ({ id: entry.name.slice(0, -'.json'.length) }))
      .sort((a, b) => a.id.localeCompare(b.id));
  } catch {
    return [];
  }
}

/**
 * 读一个角色文件（只取白名单四项）。
 * `capabilities.systemPrompt` → **建议片段**（降级为数据，不进 system prompt 层）。
 */
function readRole(rosterDir: string, entry: RosterIndexEntry, logger: Logger): ProjectRoleInput | null {
  const record = asRecord(
    readContractJson(
      path.join(rosterDir, `${entry.id}.json`),
      STRATIX_ROSTER_JSON_MAX_BYTES,
      logger
    )
  );
  const id = (record ? asString(record.id) : undefined) ?? entry.id;
  const declaredName = (record ? asString(record.name) : undefined) ?? entry.name;
  const bindings = record ? asRecord(record.bindings) : null;
  const agentKind = (bindings ? asString(bindings.agentKind) : undefined) ?? entry.agentKind;
  const capabilities = record ? asRecord(record.capabilities) : null;
  const suggestion = capabilities ? asString(capabilities.systemPrompt) : undefined;
  // 角色文件读不到且索引也没给名字/绑定 ⇒ 这份角色契约不存在 ⇒ 不产出幽灵角色。
  if (!record && !declaredName && !agentKind) return null;
  // 显示名缺省回落到逻辑 id（不填空串；空串会让渲染层出现「（）」这种空壳行）。
  const name = declaredName ?? id;
  return {
    id,
    name,
    ...(agentKind ? { agentKind } : {}),
    ...(suggestion ? { systemPromptSuggestion: suggestion } : {}),
  };
}

/** 读全部角色（索引优先，索引缺失 ⇒ 目录枚举兜底）。 */
function readRoles(contractDir: string, logger: Logger): ProjectRoleInput[] {
  const rosterDir = path.join(contractDir, 'roster');
  const index = parseRosterIndex(
    readContractJson(path.join(rosterDir, '_index.json'), STRATIX_ROSTER_JSON_MAX_BYTES, logger)
  );
  const entries = index.entries.length > 0 ? index.entries : listRosterFiles(rosterDir);
  const roles: ProjectRoleInput[] = [];
  for (const entry of entries.slice(0, STRATIX_PROJECT_CONTEXT_MAX_ROLES_READ)) {
    const role = readRole(rosterDir, entry, logger);
    if (role) roles.push(role);
  }
  return roles;
}

/** `config/stratix.json` 的白名单部分。 */
interface ConventionPart {
  readonly defaultRoleId?: string;
  readonly maxConcurrentWorkers?: number;
  readonly permissionPreset?: string;
}

/** 读 `.stratix/config/stratix.json`（只取 `agent.*` 三项）。 */
function readConvention(contractDir: string, logger: Logger): ConventionPart {
  const record = asRecord(
    readContractJson(
      path.join(contractDir, 'config', 'stratix.json'),
      STRATIX_CONFIG_JSON_MAX_BYTES,
      logger
    )
  );
  if (!record) return {};
  const agent = asRecord(record.agent);
  if (!agent) return {};
  const defaultRoleId = asString(agent.defaultRoleId);
  const maxConcurrentWorkers = asFiniteNumber(agent.maxConcurrentWorkers);
  const permissionPreset = asString(agent.permissionPreset);
  return {
    ...(defaultRoleId ? { defaultRoleId } : {}),
    ...(maxConcurrentWorkers !== undefined ? { maxConcurrentWorkers } : {}),
    ...(permissionPreset ? { permissionPreset } : {}),
  };
}

/**
 * 读项目技能名列表（**只列目录名，不读 SKILL.md 全文** —— 两级注入）。
 * 只认「目录里有 SKILL.md」的条目（照 dsh 的 skill 形状）。
 */
function readSkillNames(contractDir: string): string[] {
  const skillsDir = path.join(contractDir, 'skills');
  try {
    const names = fs
      .readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => isFile(path.join(skillsDir, name, 'SKILL.md')))
      .sort((a, b) => a.localeCompare(b))
      .slice(0, STRATIX_PROJECT_CONTEXT_MAX_SKILLS_READ);
    return names;
  } catch {
    return [];
  }
}

/** 项目根的指令文件（只报存在性：AGENTS.md / CLAUDE.md）。 */
function readInstructionFiles(projectRoot: string): string[] {
  return STRATIX_PROJECT_INSTRUCTION_FILES.filter((name) => isFile(path.join(projectRoot, name)));
}

// ============================================================================
// 对外：读 `.stratix` → 组装 ProjectContextInput
// ============================================================================

/** 读盘选项。 */
export interface ReadProjectContextOptions {
  /**
   * 当前分支（**运行态事实**，不在契约文件里）—— 由调用方（组合根）给。
   * 读不到 ⇒ 整项省略（不填占位值）。
   */
  readonly branch?: string | null;
  /** 日志口（缺省静默）。 */
  readonly logger?: Logger;
}

/**
 * 读 `<projectRoot>/.stratix` → 组装 `ProjectContextInput`（**纯数据**）。
 *
 * 契约缺失 / 损坏 ⇒ 返回空输入（`{}`），**不抛错**（验收②）。
 * 只取白名单字段（验收③）；返回的对象里没有第二个来源的字段。
 */
export function readProjectContextInput(
  projectRoot: string,
  options: ReadProjectContextOptions = {}
): ProjectContextInput {
  const logger = options.logger ?? silentLogger;
  try {
    const root = path.resolve(projectRoot);
    const contractDir = path.join(root, STRATIX_CONTRACT_DIR);
    // 契约面目录都没有 ⇒ 空输入（不报错）。
    if (!isDirectory(contractDir)) return {};

    const identity = readIdentity(contractDir, logger);
    const roles = readRoles(contractDir, logger);
    const convention = readConvention(contractDir, logger);
    const skills = readSkillNames(contractDir);
    const instructionFiles = readInstructionFiles(root);

    // 一个契约字段都没读到 ⇒ 契约**实质缺失** ⇒ 空输入（连根目录也不报，避免空壳块）。
    const hasContractData =
      identity.projectId !== undefined ||
      identity.projectName !== undefined ||
      identity.projectDescription !== undefined ||
      roles.length > 0 ||
      convention.defaultRoleId !== undefined ||
      convention.maxConcurrentWorkers !== undefined ||
      convention.permissionPreset !== undefined ||
      skills.length > 0 ||
      instructionFiles.length > 0;
    if (!hasContractData) return {};

    const branch = asString(options.branch);
    return {
      ...identity,
      rootPath: root,
      ...(branch ? { branch } : {}),
      ...(roles.length > 0 ? { roles } : {}),
      ...convention,
      ...(skills.length > 0 ? { skills } : {}),
      ...(instructionFiles.length > 0 ? { instructionFiles } : {}),
    };
  } catch (error) {
    // 防御：读盘不该抛（内部各处已兜底）——真抛了也降级为空输入，不绑架派单回路。
    logger(
      `[ProjectContextLoader] 读 .stratix 失败，本轮不注入：${error instanceof Error ? error.message : String(error)}`
    );
    return {};
  }
}

// ============================================================================
// provider 侧：把「项目根」接成 M0-04 的读数口
// ============================================================================

/** 项目根供给口（= 活跃实例的项目根）；给不出 ⇒ 无快照（不注入）。 */
export type ProjectRootProvider = () => string | null | undefined;

/** 缺省项目根供给：恒给不出（活跃实例注册表 S6b 未接 ⇒ 行为与今天一致）。 */
export const defaultProjectRootProvider: ProjectRootProvider = (): string | null | undefined =>
  undefined;

/** 读数口的依赖。 */
export interface ProjectContextLoaderDeps {
  /** 项目根供给口（缺省恒给不出）。 */
  readonly root?: ProjectRootProvider;
  /** 当前分支供给口（运行态事实；缺省没有）。 */
  readonly branch?: () => string | null | undefined;
  /** 日志口（缺省静默）。 */
  readonly logger?: Logger;
}

/**
 * 组装 M0-04 provider 的读数口（`ProjectContextLoader` 形状 ⇒ 直接塞进
 * `createProjectContextProvider({ load })`）。
 *
 * 语义：项目根给不出 ⇒ 返回 null（= 不注入）；给得出但契约缺失 / 契约无内容 ⇒ 同样返回 null
 *   （无可注入内容 ⇒ 不注入；渲染层拿到 null 与空块等价）。全程不抛。
 */
export function createProjectContextLoader(
  deps: ProjectContextLoaderDeps = {}
): ProjectContextLoader {
  const rootProvider = deps.root ?? defaultProjectRootProvider;
  const logger = deps.logger ?? silentLogger;
  return (): ProjectContextInput | null => {
    let root: string | null | undefined;
    try {
      root = rootProvider();
    } catch (error) {
      logger(
        `[ProjectContextLoader] 项目根供给口抛错，本轮不注入：${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
    if (!root || root.trim().length === 0) return null;

    let branch: string | null = null;
    try {
      branch = deps.branch?.() ?? null;
    } catch {
      branch = null;
    }
    const input = readProjectContextInput(root, { branch, logger });
    return Object.keys(input).length > 0 ? input : null;
  };
}
