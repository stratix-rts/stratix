/**
 * 文件职责：`stratix_mission_create`（建编组任务）、`stratix_mission_status`（查编组任务）
 *   与 `stratix_mission_checkpoint`（记检查点）—— 战场编组域的三个工具。
 * 输入：create = title / units / auto_confirm / brief / depends_on；
 *      status = mission_id（缺省即列表）/ limit；checkpoint = mission_id / note。
 * 输出：受理回执（标识 + 相位 + 查法 poll）或编组任务与其名下角色任务的摘要。
 * 禁止事项：
 *   1. 绕过 core 总线直接写状态 —— 建任务只发 HudCommand.mission.*，由 core 状态机裁决；
 *   2. 自己判"能不能确认" —— confirm 只认 pending 相位是 core 的裁决，工具不另写一套；
 *      依赖是否满足也**调用 core 的判定**（findMissingDependencies），不在这里另写一份；
 *   3. 在工具里"直接置完成" —— 编组任务只能由 running 走到 done，MCP 不提供这种后门
 *      （docs/MCP-SPEC.md §3.2）；想收尾就派一条带 mission_id 的角色任务；
 *   4. 回灌任务输出全文 —— 只回状态与摘要。
 */

import { findMissingDependencies, isTerminalPhase } from '../../../core/mission/machine';
import {
  MAX_MISSIONS,
  MAX_MISSION_CHECKPOINTS,
  MAX_MISSION_DEPENDENCIES,
  MAX_SELECTION_SIZE,
  type MissionBrief,
  type WorldState,
} from '../../../core/types';
import {
  countCodePoints,
  optionalBoolean,
  optionalInteger,
  optionalObject,
  optionalStringArray,
  optionalStringOrNull,
  requireString,
} from '../args';
import { McpToolError, toToolResult } from '../envelope';
import type { ToolSpec } from '../types';

import { characterName } from './common';

/**
 * 任务标题的码点上限（MCP 侧自设）。
 * why core 只校验非空、超长上限是 MCP 侧自设的：防超长标题进状态广播（WorldState 全量广播，
 * 每个字段都得有界）。200 码点足够写清一件事，又不至于把广播体积撑起来。
 */
const MAX_MISSION_TITLE_LEN = 200;

/**
 * brief 单段的码点上限（MCP 侧自设）。
 * why 需要上限：brief 随 MissionView 进 WorldState 全量广播，而编组任务上限 100 条 ——
 * 四段无界的正文能把一次广播撑爆。每段 500 码点足够写清一条需求或一条验收标准。
 */
const MAX_BRIEF_FIELD_LEN = 500;

/**
 * 检查点 note 的码点上限（MCP 侧自设）。
 * why 需要上限：同上 —— checkpoints 随状态广播，core 只限条数（MAX_MISSION_CHECKPOINTS）不限字数，
 * 单条无界的 note 就能把广播体积撑起来。500 码点足够记一句"这一刻发生了什么"。
 */
const MAX_CHECKPOINT_NOTE_LEN = 500;

/** brief 的四段（契约词表见 core/types.ts 的 MissionBrief）—— 顺序即展示顺序。 */
const BRIEF_FIELDS = ['requirements', 'acceptance', 'deliverables', 'constraints'] as const;

/** 列表模式默认返回条数 / 上限（与 schema 同值；此处是代码侧兜底）。 */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export const missionCreateTool: ToolSpec = {
  name: 'stratix_mission_create',
  domain: 'mission',
  verb: 'create',
  order: 5,
  description: [
    '新建一条编组任务（mission）并指派给一组战场单位；默认一次性完成"建任务 → 指派 → 接单开工"，直接进入 running。',
    '何时用：需要多个角色协同完成一件事（一个写代码、一个审阅、一个出文档）。',
    '何时不用：只派一个人 —— 用 stratix_task_assign；只想查现有编组任务 —— 用 stratix_mission_status。',
    '边界：units 是战场单位 id 列表（可空；空 = 草稿任务，不会自己开工）。单位 id 不存在时**静默剔除**并在',
    'dropped_units 里报数（不猜、不报错）。auto_confirm=false 时任务停在 pending 待确认 —— 第一期 MCP 不提供确认工具，',
    '确认留给 UI 面板裁决（core 口径：confirm 只认 pending）。auto_confirm=true 时若有效名单为空（单位 id 全不存在），',
    '任务无法进入 running，返回 illegal_transition。编组任务上限 100 条，超限拒绝新建。',
    'brief 是这条任务的结构化正文契约：requirements 需求 / acceptance 验收标准 / deliverables 交付物 / constraints 约束，',
    '四段都可省，只记不校验。depends_on 是前置编组任务 id 列表（上限 32）：**带依赖的编组会在依赖满足前拒绝 confirm** ——',
    '任务停在 pending，回执的 blocked_by_dependencies 报出还差哪几个前置。',
    '错误：invalid_arguments（title 为空或超长 / brief 段名非法或超长 / depends_on 超 32 条）/',
    'mission_capacity_exceeded（可重试）/ illegal_transition。',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        minLength: 1,
        maxLength: MAX_MISSION_TITLE_LEN,
        description: '任务标题。core 只校验非空，200 码点上限是 MCP 侧自设（防超长标题进状态广播）。',
      },
      units: {
        type: 'array',
        items: { type: 'string' },
        maxItems: MAX_SELECTION_SIZE,
        description: '指派的战场单位 id 列表。上限 256（MAX_SELECTION_SIZE）。',
      },
      auto_confirm: {
        type: 'boolean',
        default: true,
        description:
          'true = 内部完成建任务→指派→接单开工（落到 running）；false = 停在 pending 待 UI 确认。',
      },
      brief: {
        type: 'object',
        properties: {
          requirements: {
            type: 'string',
            maxLength: MAX_BRIEF_FIELD_LEN,
            description: '需求：要做什么（做什么算满足需求）。',
          },
          acceptance: {
            type: 'string',
            maxLength: MAX_BRIEF_FIELD_LEN,
            description: '验收标准：怎样算做完 —— 这条任务"算不算做完"的判据。',
          },
          deliverables: {
            type: 'string',
            maxLength: MAX_BRIEF_FIELD_LEN,
            description: '交付物：交什么出来（文件 / 报告 / 结论）。',
          },
          constraints: {
            type: 'string',
            maxLength: MAX_BRIEF_FIELD_LEN,
            description: '约束：不能碰什么 / 必须怎么做。',
          },
        },
        additionalProperties: false,
        description: '任务本身的结构化正文契约（四段皆可选；只记不校验，不会自动写进派单 prompt）。',
      },
      depends_on: {
        type: 'array',
        items: { type: 'string' },
        maxItems: MAX_MISSION_DEPENDENCIES,
        description:
          '前置编组任务 id 列表（上限 32）。前置未收尾时本任务不被允许确认（core 守门）。',
      },
    },
    required: ['title'],
    additionalProperties: false,
  },
  errors: ['invalid_arguments', 'mission_capacity_exceeded', 'illegal_transition', 'internal_error'],
  readOnly: false,
  handler: (args, host) => {
    const title = requireString(args, 'title');
    if (countCodePoints(title) > MAX_MISSION_TITLE_LEN) {
      throw new McpToolError(
        'invalid_arguments',
        `title 超过 ${MAX_MISSION_TITLE_LEN} 码点上限`,
        { hint: '把标题写短一点（只写这件事是什么）' }
      );
    }
    const requestedUnits = optionalStringArray(args, 'units') ?? [];
    if (requestedUnits.length > MAX_SELECTION_SIZE) {
      throw new McpToolError(
        'invalid_arguments',
        `units 超过 ${MAX_SELECTION_SIZE} 条上限`,
        { hint: '拆成多条编组任务，或先收窄指派范围' }
      );
    }
    const autoConfirm = optionalBoolean(args, 'auto_confirm', true);
    const brief = readBrief(args);
    const dependsOn = readDependsOn(args);

    const state = host.getWorldState();
    if ((state.missions ?? []).length >= MAX_MISSIONS) {
      throw new McpToolError('mission_capacity_exceeded', `编组任务数已满（上限 ${MAX_MISSIONS}）`, {
        hint: '等在办编组任务收尾后重试',
      });
    }

    // ① 建任务 —— 只发命令，落库与相位由 core 裁决（core 会自行对账名单：去重、剔未知单位）。
    //    brief / dependsOn 原样透传：归一（trim / 丢空段 / 去重 / 丢自依赖）在 core 的 machine.ts 里做，
    //    MCP 不另写一份规则。
    const beforeIds = new Set((state.missions ?? []).map((mission) => mission.id));
    host.dispatchCommand({
      type: 'mission.create',
      title,
      unitIds: requestedUnits,
      ...(brief ? { brief } : {}),
      ...(dependsOn ? { dependsOn } : {}),
    });

    const created = (host.getWorldState().missions ?? []).find(
      (mission) => !beforeIds.has(mission.id)
    );
    if (!created) {
      throw new McpToolError(
        'internal_error',
        '编组任务未落地：本进程没有 core 运行时接管这条命令',
        { hint: '确认 Stratix 运行时在本进程已启动后再建任务' }
      );
    }

    // ② 指派 —— 用 core 对账后的名单再指一次（同一批人 = 无实质变更，不产生多余广播）。
    //    名单为空时这一步是空转（草稿任务本来就没有编组），仍然发出来是为了走同一条命令路径。
    host.dispatchCommand({
      type: 'mission.assign',
      missionId: created.id,
      unitIds: [...created.unitIds],
    });

    // ③ 接单开工 —— accept 在 core 内部合并 decide + start，落点即 running。
    if (autoConfirm) {
      host.dispatchCommand({
        type: 'mission.confirm',
        missionId: created.id,
        decision: 'accept',
      });
    }

    const finalState = host.getWorldState();
    const mission = (finalState.missions ?? []).find((item) => item.id === created.id);
    if (!mission) {
      throw new McpToolError('internal_error', '编组任务在操作过程中消失了（不应发生）', {
        hint: '查服务端日志确认 core 运行时是否异常',
      });
    }

    // 依赖未满足时 core 会拒绝 confirm（任务停在 pending）—— 这**不是失败**：任务已建成，
    // 只是还不能开工。判定用 core 的同一份函数（findMissingDependencies），不在这里另写依赖规则
    // （core 守门与 HUD 展示共用一份口径，MCP 抄第三份必然漂移）。
    const missingDependencies =
      autoConfirm && mission.phase === 'pending'
        ? findMissingDependencies(mission, finalState.missions ?? [])
        : [];

    if (autoConfirm && mission.phase !== 'running' && missingDependencies.length === 0) {
      // confirm 只认 pending 相位：名单为空（草稿）时确认不了，任务停在 draft。
      throw new McpToolError(
        'illegal_transition',
        `编组任务「${title}」没能进入 running（当前 ${mission.phase} 相位）`,
        {
          hint:
            '有效名单为空（单位 id 不存在）时无法接单开工 —— 用 stratix_registry 查战场单位 id 后重试，' +
            '或改传 auto_confirm=false 先立一条待指派的草稿任务',
        }
      );
    }

    // dropped_units：请求的去重名单 − core 实际采纳的名单（core 静默剔除了不存在的单位）。
    const droppedUnits = countUnique(requestedUnits) - mission.unitIds.length;

    return toToolResult({
      ok: true,
      data: {
        mission_id: mission.id,
        title: mission.title,
        phase: mission.phase,
        // auto_confirm **是否真的生效**（落到 running 才算生效）：依赖未满足时 core 拒绝了 confirm，
        // 这时它是 false —— 不糊报"已自动开工"。
        auto_confirm_applied: autoConfirm && mission.phase === 'running',
        units: mission.unitIds.map((unitId) => ({
          id: unitId,
          name: unitName(finalState, unitId),
        })),
        dropped_units: droppedUnits,
        created_at: mission.createdAt,
        // brief 只回"记了哪几段"（段名列表）—— 正文是调用方刚发来的，原样回灌是浪费上下文（§1.4）。
        ...(mission.brief ? { brief_fields: Object.keys(mission.brief) } : {}),
        // depends_on 回**core 实际记下的**那一份（归一后：去重 / 丢自依赖 / 截断到 32）。
        ...(mission.dependsOn ? { depends_on: [...mission.dependsOn] } : {}),
        // 还差哪几个前置（只在 confirm 被依赖守门拒绝时出现）。
        ...(missingDependencies.length > 0 ? { blocked_by_dependencies: missingDependencies } : {}),
        next:
          missingDependencies.length > 0
            ? {
                tool: 'stratix_mission_status',
                args: { mission_id: mission.id },
                hint: '前置任务收尾后这条才能被确认（第一期 MCP 不提供确认工具，确认留给 UI 面板）',
              }
            : {
                tool: 'stratix_task_assign',
                args: { mission_id: mission.id },
                hint: '派具体任务时带上 mission_id，任务终态会自动回报到这条编组任务',
              },
        poll: {
          tool: 'stratix_mission_status',
          args: { mission_id: mission.id },
        },
      },
    });
  },
};

export const missionStatusTool: ToolSpec = {
  name: 'stratix_mission_status',
  domain: 'mission',
  verb: 'status',
  order: 6,
  description: [
    '读取编组任务（mission）的状态；带 mission_id 读单条，不带则列出最近的编组任务。',
    '何时用：查一条编组任务的进展与它下面的角色任务；回话前确认"这件事推进到哪了"。',
    '何时不用：查单个角色的任务 —— 用 stratix_task_status；查全场忙闲 —— 用 stratix_world_snapshot。',
    '边界：只读。列模式默认返回最近 20 条（limit 可调，上限 100），按创建时间倒序；被截断时 truncated=true。',
    '单条模式附带该任务下的角色任务摘要（任务 id、承接角色、状态）。',
    '错误：mission_not_found / invalid_arguments。',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      mission_id: {
        type: ['string', 'null'],
        description: '缺省 = 列出最近若干条编组任务。',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_LIMIT,
        default: DEFAULT_LIMIT,
        description: '列模式最多返回几条（按创建时间倒序）。',
      },
    },
    additionalProperties: false,
  },
  errors: ['mission_not_found', 'invalid_arguments'],
  readOnly: true,
  handler: (args, host) => {
    const missionId = optionalStringOrNull(args, 'mission_id') ?? null;
    const limit = optionalInteger(args, 'limit', { min: 1, max: MAX_LIMIT }) ?? DEFAULT_LIMIT;

    const state = host.getWorldState();
    const missions = state.missions ?? [];

    if (missionId) {
      const mission = missions.find((item) => item.id === missionId);
      if (!mission) {
        throw new McpToolError('mission_not_found', `编组任务「${missionId}」不存在`, {
          hint: '用 stratix_world_snapshot 确认 mission id',
        });
      }
      const tasks = (state.tasks ?? []).filter((task) => task.missionId === mission.id);
      return toToolResult({
        ok: true,
        data: {
          mission: {
            id: mission.id,
            title: mission.title,
            phase: mission.phase,
            unit_count: mission.unitIds.length,
            created_at: mission.createdAt,
            units: mission.unitIds.map((unitId) => ({
              id: unitId,
              name: unitName(state, unitId),
            })),
          },
          tasks: tasks.map((task) => ({
            id: task.id,
            character: { id: task.characterId, name: characterName(state, task.characterId) },
            status: task.status,
          })),
          task_totals: {
            total: tasks.length,
            completed: tasks.filter((task) => task.status === 'completed').length,
            running: tasks.filter((task) => task.status === 'running').length,
            failed: tasks.filter((task) => task.status === 'failed').length,
          },
        },
      });
    }

    // 列模式：按创建时间倒序（同一毫秒内保持既有顺序 —— 排序稳定，不让同刻条目乱跳）。
    const ordered = [...missions].sort((a, b) => b.createdAt - a.createdAt);
    const total = ordered.length;
    const items = ordered.slice(0, limit);
    return toToolResult({
      ok: true,
      data: {
        missions: {
          returned: items.length,
          total,
          truncated: total > items.length,
          items: items.map((mission) => ({
            id: mission.id,
            title: mission.title,
            phase: mission.phase,
            unit_count: mission.unitIds.length,
            created_at: mission.createdAt,
          })),
        },
        limit,
      },
    });
  },
};

/**
 * `stratix_mission_checkpoint` —— 往一条编组任务上记一条检查点（append-only 记账行）。
 *
 * why 独立成工具而不是塞进 mission_status：状态机铁律是"一个工具只对应一个状态迁移或一个只读查询"
 * （MCP-SPEC §1.1）；记账是**写**动作、状态查询是**读**动作，混在一起就得加万能参数。
 * 也不并进 mission_create：记账发生在任务推进途中，创建早已发生（合并发生在工具内部是原则二，
 * 但合并的是"一次业务动作里的既有迁移"，不是"把不同动作压进一个工具"）。
 */
export const missionCheckpointTool: ToolSpec = {
  name: 'stratix_mission_checkpoint',
  domain: 'mission',
  verb: 'checkpoint',
  // 清单位次：mission 域聚在一起（§2 的条目号只作文档锚点，见 docs/MCP-SPEC.md §2.0）。
  order: 7,
  description: [
    '往一条编组任务上记一条检查点 —— append-only 的一行记账（这一刻发生了什么）。',
    '何时用：长任务推进过程中留下可追溯的痕迹 —— 派了谁、卡在哪一步、阶段性结论是什么。',
    '何时不用：想写任务本身的契约（需求 / 验收标准 / 交付物）—— 那是 brief（stratix_mission_create 的 brief 段），不是记账；',
    '只想看任务当前相位 —— 用 stratix_mission_status。',
    '边界：记账**不改相位**（draft / pending / confirmed / running 都能记）；终态（done / cancelled）拒绝，',
    '回 mission_terminal（终态不改写历史，与 core 的终态铁律同口径）。note 上限 500 码点（MCP 侧自设，',
    '防超长文本进状态广播）；每条任务最多留 64 条（core 的 MAX_MISSION_CHECKPOINTS，超限丢最旧）。',
    '记账是**静默**的（成功与否都不发通知 —— 记账是高频后台动作，逐条通知会冲垮通知队列）。',
    '错误：mission_not_found（任务不存在）/ mission_terminal（任务已收尾）/ invalid_arguments（note 为空或超长）。',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      mission_id: {
        type: 'string',
        minLength: 1,
        description: '编组任务 id（见 stratix_mission_status）。',
      },
      note: {
        type: 'string',
        minLength: 1,
        maxLength: MAX_CHECKPOINT_NOTE_LEN,
        description: '这一刻发生了什么（一行记账）。上限 500 码点（MCP 侧自设）。',
      },
    },
    required: ['mission_id', 'note'],
    additionalProperties: false,
  },
  errors: ['mission_not_found', 'mission_terminal', 'invalid_arguments', 'internal_error'],
  readOnly: false,
  handler: (args, host) => {
    const missionId = requireString(args, 'mission_id');
    const note = requireString(args, 'note');
    if (countCodePoints(note) > MAX_CHECKPOINT_NOTE_LEN) {
      throw new McpToolError(
        'invalid_arguments',
        `note 超过 ${MAX_CHECKPOINT_NOTE_LEN} 码点上限`,
        { hint: '把这次记账写短一点（只写这一刻发生了什么）' }
      );
    }

    const state = host.getWorldState();
    const mission = (state.missions ?? []).find((item) => item.id === missionId);
    if (!mission) {
      throw new McpToolError('mission_not_found', `编组任务「${missionId}」不存在`, {
        hint: '用 stratix_mission_status 或 stratix_world_snapshot 确认 mission id',
      });
    }
    // 终态拒绝：core 侧同样是静默拒绝（不改写历史），MCP 侧必须把"为什么没记上"说出来 ——
    // 静默失败会让调用方以为记上了。
    if (isTerminalPhase(mission.phase)) {
      throw new McpToolError(
        'mission_terminal',
        `编组任务「${mission.title}」已收尾（${mission.phase} 相位），不再接受记账`,
        { hint: '终态任务不改写历史；要继续就新建一条编组任务' }
      );
    }

    // 记账 —— 只发命令，落库由 core 裁决（append-only，超限丢最旧）。
    host.dispatchCommand({ type: 'mission.checkpoint', missionId, note });

    // 回读核对：core 的记账是**静默**的（成功与否都不发通知），所以回执必须自己核实 ——
    // 没记上就如实报错，绝不假装成功。
    const after = (host.getWorldState().missions ?? []).find((item) => item.id === missionId);
    if (!after) {
      throw new McpToolError('internal_error', '编组任务在记账过程中消失了（不应发生）', {
        hint: '查服务端日志确认 core 运行时是否异常',
      });
    }
    const checkpoints = after.checkpoints ?? [];
    const last = checkpoints[checkpoints.length - 1];
    if (!last || last.note !== note) {
      throw new McpToolError('internal_error', '检查点没有记上（core 未落地这条记账）', {
        hint: '确认 Stratix 运行时在本进程已启动后再记',
      });
    }

    return toToolResult({
      ok: true,
      data: {
        mission_id: after.id,
        title: after.title,
        phase: after.phase,
        note: last.note,
        at: last.at,
        // 计数即"这条任务记了多少条"（core 上限 64，超限丢最旧）。
        checkpoint_count: checkpoints.length,
        checkpoint_limit: MAX_MISSION_CHECKPOINTS,
        next: {
          tool: 'stratix_task_assign',
          args: { mission_id: after.id },
          hint: '派具体任务时带上 mission_id，任务终态会自动回报到这条编组任务',
        },
        poll: {
          tool: 'stratix_mission_status',
          args: { mission_id: after.id },
        },
      },
    });
  },
};

/**
 * 读 brief 入参 —— 形状与长度校验在此，归一（trim / 丢空段）在 core 的 normalizeBrief 里。
 * why 自己校验：运行期**没有** schema 校验器（§4.4 要求"入参一律走 schema 校验后再落命令"，
 * 这里的 schema 校验就是这一段手写代码）；宽松透传会让未知字段悄悄进状态。
 */
function readBrief(args: Readonly<Record<string, unknown>>): MissionBrief | undefined {
  const raw = optionalObject(args, 'brief');
  if (!raw) return undefined;

  const unknownField = Object.keys(raw).find(
    (key) => !BRIEF_FIELDS.includes(key as (typeof BRIEF_FIELDS)[number])
  );
  if (unknownField) {
    throw new McpToolError('invalid_arguments', `brief.${unknownField} 不是已知字段`, {
      hint: `brief 只接受这四段：${BRIEF_FIELDS.join(' / ')}`,
    });
  }

  const next: { -readonly [K in keyof MissionBrief]?: string } = {};
  for (const field of BRIEF_FIELDS) {
    const value = raw[field];
    if (value === undefined) continue;
    if (typeof value !== 'string') {
      throw new McpToolError('invalid_arguments', `brief.${field} 必须是字符串`);
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) continue; // 空段 = 该段无内容（与 core 的 normalizeBrief 同口径）
    if (countCodePoints(trimmed) > MAX_BRIEF_FIELD_LEN) {
      throw new McpToolError(
        'invalid_arguments',
        `brief.${field} 超过 ${MAX_BRIEF_FIELD_LEN} 码点上限`,
        { hint: '把这段写短一点（只写这件事的关键约束与判据）' }
      );
    }
    next[field] = trimmed;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

/**
 * 读 depends_on 入参 —— 只判形状与条数上限；去重 / 丢自依赖 / 截断在 core 的 normalizeDependsOn 里。
 * why 不静默截断：args.ts 的铁律是"字段给了但形状不对必须报错，不能悄悄当缺省处理"——
 * 悄悄丢一半依赖比报错危险得多（模型会以为依赖都在）。
 */
function readDependsOn(args: Readonly<Record<string, unknown>>): string[] | undefined {
  const dependsOn = optionalStringArray(args, 'depends_on');
  if (!dependsOn) return undefined;
  if (dependsOn.length > MAX_MISSION_DEPENDENCIES) {
    throw new McpToolError(
      'invalid_arguments',
      `depends_on 超过 ${MAX_MISSION_DEPENDENCIES} 条上限`,
      { hint: '拆成多条编组任务，或先收窄依赖链' }
    );
  }
  return dependsOn;
}

/** 去重后的名单长度（core 的 dropped 口径：按去重后的入参个数算）。 */
function countUnique(unitIds: readonly string[]): number {
  return new Set(unitIds.filter((id) => id.length > 0)).size;
}

/** 战场单位名（查不到就是 null —— 不编造）。 */
function unitName(state: WorldState, unitId: string): string | null {
  const unit = state.units.find((item) => item.id === unitId);
  return unit?.name ?? null;
}
