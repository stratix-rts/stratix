/**
 * 文件职责：`stratix_task_assign`（派单）与 `stratix_task_status`（查单）—— 角色任务域的两个工具。
 * 输入：assign = character / prompt / mission_id / timeout_ms / origin；status = task_id / include_output。
 * 输出：受理回执（标识 + 状态 + 查法 poll）或任务状态与结果摘要 / 全文。
 * 禁止事项：
 *   1. 绕过 core 总线直接写状态 —— 派单只发 HudCommand.task.assign，由 core 状态机裁决落库；
 *   2. 自己判"能不能派" —— 前置守门照抄 app 层 guardTaskCharacter 的同一份判定口径
 *      （角色在档 / 绑了 agent / CLI 已检出 / 不离线），**不改变 app 层出队时的裁决权**；
 *   3. 回显角色人设全文 —— 人设不进回执（那是角色自己的设定，不是这次派单的结果）；
 *   4. 把 origin 当鉴权凭据 —— origin 是审计留痕（调用方自称），不构成任何信任。
 */

import { MAX_TASKS, MAX_TASK_PROMPT_LEN, MAX_TASK_SUMMARY_LEN } from '../../../core/types';
import {
  countCodePoints,
  optionalBoolean,
  optionalInteger,
  optionalString,
  optionalStringOrNull,
  requireString,
} from '../args';
import { McpToolError, toToolResult } from '../envelope';
import type { ToolSpec } from '../types';

/**
 * 执行期超时的生效值（毫秒）。
 * why 是常量而不是入参：timeout_ms 属 app 层执行器口径（core 契约零 IO，不带超时字段），
 * 当前执行器尚未支持单任务超时 → 实际生效值恒为缺省 600000，回执回显生效值而非请求值
 * （docs/MCP-SPEC.md §2.2 边界补充）。
 */
const EFFECTIVE_TASK_TIMEOUT_MS = 600_000;

/** 审计来源的合法显式取值（spec §2.0：只允许 agent 与 script；ui 拒绝，mcp 冗余）。 */
const EXPLICIT_ORIGINS = ['agent', 'script'] as const;
/** 缺省来源：经 MCP 进来的派单一律记 mcp。 */
const DEFAULT_ORIGIN = 'mcp';

type Origin = (typeof EXPLICIT_ORIGINS)[number] | 'mcp';

export const taskAssignTool: ToolSpec = {
  name: 'stratix_task_assign',
  domain: 'task',
  verb: 'assign',
  description: [
    '派一条角色任务：把一段自由文本指令交给指定角色，由该角色绑定的 CLI agent 执行，产出文本结果。',
    '何时用：需要某个角色干一件具体的事（写代码、查资料、审阅）。',
    '何时不用：只问一句话或要一次讨论 —— 用 stratix_chat_send；要编组多人协同 —— 用 stratix_mission_create。',
    '边界：每个角色串行执行（并发 1），入队即返回、不等执行完。任务最长 timeout_ms（缺省 600000，上限 600000），',
    '超时判失败 —— 当前执行器尚未支持单任务超时，实际生效超时恒为 600000（回执回显生效值）。',
    'mission_id 给了就把该任务挂在这条编组任务上，任务终态自动回报给它（完成 → 编组任务收尾；失败 → 按中止收尾）。',
    'origin 是审计来源：缺省记 mcp；由 agent 经 MCP 派单时必须显式传 origin="agent"（区分"人派的单"与"agent 派的单"）。',
    '错误：unknown_character / character_unbound / agent_not_installed / character_offline（可重试）/',
    'task_capacity_exceeded（可重试）/ invalid_arguments（prompt 为空或超长、origin 非法）。',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      character: {
        type: 'string',
        description: '角色 id（见 stratix_registry）。',
      },
      prompt: {
        type: 'string',
        minLength: 1,
        maxLength: MAX_TASK_PROMPT_LEN,
        description: '任务指令原文。上限 20000 码点（MAX_TASK_PROMPT_LEN）。',
      },
      mission_id: {
        type: ['string', 'null'],
        description: '关联的编组任务 id；缺省 = 普通派发。',
      },
      timeout_ms: {
        type: 'integer',
        minimum: 1000,
        maximum: 600_000,
        default: EFFECTIVE_TASK_TIMEOUT_MS,
        description: '执行超时（毫秒）。当前执行器尚未支持单任务超时，生效值恒为 600000。',
      },
      origin: {
        type: 'string',
        enum: [...EXPLICIT_ORIGINS],
        default: DEFAULT_ORIGIN,
        description: '审计来源。缺省按调用通道记为 mcp；agent 经 MCP 派单必须显式传 agent。',
      },
    },
    required: ['character', 'prompt'],
    additionalProperties: false,
  },
  errors: [
    'invalid_arguments',
    'unknown_character',
    'character_unbound',
    'agent_not_installed',
    'character_offline',
    'task_capacity_exceeded',
    'internal_error',
  ],
  readOnly: false,
  handler: (args, host) => {
    const characterId = requireString(args, 'character');
    const promptRaw = requireString(args, 'prompt');
    const missionId = optionalStringOrNull(args, 'mission_id') ?? null;
    const requestedTimeout = optionalInteger(args, 'timeout_ms', { min: 1000, max: 600_000 });

    // origin：显式值只允许 agent / script；缺省 = mcp。
    const originRaw = optionalString(args, 'origin');
    let origin: Origin = DEFAULT_ORIGIN;
    if (originRaw !== undefined) {
      if (!EXPLICIT_ORIGINS.includes(originRaw as (typeof EXPLICIT_ORIGINS)[number])) {
        throw new McpToolError('invalid_arguments', `origin「${originRaw}」不合法`, {
          hint: 'origin 只能是 agent 或 script；经 MCP 派单缺省即记 mcp',
        });
      }
      origin = originRaw as Origin;
    }

    const prompt = promptRaw.trim();
    if (prompt.length === 0) {
      throw new McpToolError('invalid_arguments', 'prompt 不能为空', {
        hint: '给出一句明确的任务指令',
      });
    }
    if (countCodePoints(prompt) > MAX_TASK_PROMPT_LEN) {
      throw new McpToolError(
        'invalid_arguments',
        `prompt 超过 ${MAX_TASK_PROMPT_LEN} 码点上限`,
        { hint: '把指令拆短后重试' }
      );
    }
    // 请求了超时但当前执行器不支持单任务超时 → 不静默吞掉：回执回显生效值（下方统一用生效值）。
    void requestedTimeout;

    const state = host.getWorldState();

    // ── 前置守门（与 app 层 guardTaskCharacter 同一份判定口径；app 层出队时仍会再守一次）──
    const character = state.characters.find((c) => c.id === characterId);
    if (!character) {
      throw new McpToolError('unknown_character', `未找到角色「${characterId}」的档案`, {
        hint: '用 stratix_registry 查可用的角色 id',
      });
    }
    if (!character.agentKind) {
      throw new McpToolError('character_unbound', `角色「${character.name}」未绑定 CLI agent`, {
        hint: '先在角色档案里绑定 agent，再派单',
      });
    }
    const detected = (state.detectedAgents ?? []).some(
      (agent) => agent.kind === character.agentKind && agent.installed
    );
    if (!detected) {
      throw new McpToolError(
        'agent_not_installed',
        `角色「${character.name}」绑定的 CLI（${character.agentKind}）未被检出`,
        { hint: '安装该 CLI 或换一个已装好的角色' }
      );
    }
    if (state.units.some((unit) => unit.characterId === characterId && unit.online === false)) {
      throw new McpToolError('character_offline', `角色「${character.name}」当前离线`, {
        hint: '等 CLI 恢复在线后重新派单，或换一位在线角色',
      });
    }
    if ((state.tasks ?? []).length >= MAX_TASKS) {
      throw new McpToolError('task_capacity_exceeded', `任务队列已满（上限 ${MAX_TASKS}）`, {
        hint: '等在办任务收尾后重试',
      });
    }

    // ── 派单：只发 core 命令，落库与相位由 core 状态机裁决 ──
    const before = new Set((state.tasks ?? []).map((task) => task.id));
    host.dispatchCommand({
      type: 'task.assign',
      characterId,
      prompt,
      missionId,
    });

    // 回读核对：命令通道是 fire-and-forget（runtime 不回传结果），只能靠状态差分确认落地。
    const created = (host.getWorldState().tasks ?? [])
      .filter((task) => !before.has(task.id) && task.characterId === characterId && task.prompt === prompt)
      .pop();
    if (!created) {
      throw new McpToolError(
        'internal_error',
        '派单未落地：本进程没有 core 运行时接管这条命令',
        { hint: '确认 Stratix 运行时在本进程已启动后再派单' }
      );
    }

    return toToolResult({
      ok: true,
      data: {
        task_id: created.id,
        character: {
          id: character.id,
          name: character.name,
          agent_kind: character.agentKind ?? null,
        },
        status: created.status,
        mission_id: created.missionId ?? null,
        origin,
        timeout_ms: EFFECTIVE_TASK_TIMEOUT_MS,
        queued_at: created.createdAt,
        poll: {
          tool: 'stratix_task_status',
          args: { task_id: created.id },
        },
      },
    });
  },
};

export const taskStatusTool: ToolSpec = {
  name: 'stratix_task_status',
  domain: 'task',
  verb: 'status',
  description: [
    '读取一条角色任务的当前状态与结果摘要。',
    '何时用：派单后查进展；任务回报完成时取结果。',
    '何时不用：只想知道"还有谁在忙" —— 用 stratix_world_snapshot；要取消一条排队中的任务 —— 用 stratix_task_cancel。',
    '边界：include_output=false（缺省）时 output 是摘要（core 侧 CharacterTask.output 本就只存摘要，上限 2000 码点）；',
    'include_output=true 时取 SQLite 里的全文（可能很长，仅在确需原文时用；库里还没有这一条时回落摘要并把',
    'output_truncated 置为 true）。任务处于 awaiting_approval 时额外返回 plan（计划草稿，待用户裁决；此时任务不会自行继续）。',
    '错误：task_not_found。',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      task_id: { type: 'string', description: '任务 id（派单回执里给的那个）。' },
      include_output: {
        type: 'boolean',
        default: false,
        description: 'true = 返回执行结果全文；false = 只回摘要。',
      },
    },
    required: ['task_id'],
    additionalProperties: false,
  },
  errors: ['task_not_found', 'invalid_arguments'],
  readOnly: true,
  handler: async (args, host) => {
    const taskId = requireString(args, 'task_id');
    const includeOutput = optionalBoolean(args, 'include_output', false);

    const state = host.getWorldState();
    const task = (state.tasks ?? []).find((item) => item.id === taskId);
    if (!task) {
      throw new McpToolError('task_not_found', `任务「${taskId}」不存在`, {
        hint: '用 stratix_world_snapshot 确认任务 id',
      });
    }

    const character = state.characters.find((c) => c.id === task.characterId);
    const summary = task.output ?? '';

    let output = summary;
    let outputTruncated: boolean;
    if (includeOutput) {
      const full = host.readTaskOutput ? await host.readTaskOutput(taskId) : null;
      if (full !== null && full.length > 0) {
        output = full;
        outputTruncated = false;
      } else {
        // 全文不可得（尚未落库 / 库不可用）：回落摘要，并如实标出"这是截断的"。
        output = summary;
        outputTruncated = true;
      }
    } else {
      outputTruncated = countCodePoints(summary) >= MAX_TASK_SUMMARY_LEN;
    }

    return toToolResult({
      ok: true,
      data: {
        task_id: task.id,
        character: {
          id: task.characterId,
          name: character?.name ?? null,
        },
        status: task.status,
        mission_id: task.missionId ?? null,
        created_at: task.createdAt,
        started_at: task.startedAt,
        ended_at: task.endedAt,
        output,
        output_truncated: outputTruncated,
        plan: task.plan ?? null,
        poll: {
          tool: 'stratix_task_status',
          args: { task_id: task.id },
        },
      },
    });
  },
};
