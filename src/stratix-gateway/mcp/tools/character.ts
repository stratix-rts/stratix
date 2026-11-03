/**
 * 文件职责：`stratix_character_create` —— **名册供给**（在战场上建一个 agent 角色档案）。
 *   没有它，MCP 只能读名册不能建名册：空实例上 agent 连派单都发不出去
 *   （task_assign 必然 unknown_character，mission_create 只能造永不开工的 draft）。
 * 输入：name（必填）+ archetype（角色原型 = 绑定的本地 CLI agent 种类）+ persona（人设提示词）
 *      + skin_id（皮肤资源键）—— 后三者皆可选，缺省各有合理默认。
 * 输出：受理回执 —— character_id + 完整角色对象 + 它上场的战场单位 id + 下一步指引。
 * 禁止事项：
 *   1. 绕过 core 总线直接写状态 —— 建档只发 HudCommand.character.create；落库、名册投影、
 *      战场单位投影全由 core 的 character manager 裁决（core/character/manager.ts）；
 *   2. 自己写一套"重名 / 上限"规则 —— 工具只在发命令**前**做一次准入快筛（口径直接复用 core 的
 *      hasDuplicateCharacterName），权威裁决仍在 core 的同一次 setState 内（防并发抢名）；
 *   3. 编造初始等级 / 经验 —— core 建档口径恒为 level 1 / exp 0（契约如此），MCP 不另设参数；
 *   4. 把人设全文无界地灌进回执 —— 人设随 WorldState 全量广播，必须有界（core 上限 32000，
 *      MCP 侧再自设一层更紧的上限，见 MAX_PERSONA_LEN）。
 */

import { findCharacterDeleteBlock } from '../../../core/character/delete-guard';
import { hasDuplicateCharacterName } from '../../../core/character/profile';
import { SKINS } from '../../../core/theme/skin-registry';
import {
  AGENT_KINDS,
  MAX_CHARACTERS,
  MAX_CHARACTER_NAME_LEN,
  type CharacterView,
} from '../../../core/types';
import { countCodePoints, optionalEnum, optionalString, requireString } from '../args';
import { McpToolError, toToolResult } from '../envelope';
import type { ToolSpec } from '../types';

/** 角色原型的可选取值 = core 的内置 agent 词表（六家）—— 不另抄一份。 */
const ARCHETYPES = AGENT_KINDS;

/**
 * 缺省原型：claude-code。
 * why 是它：仓库既有 demo 与首启引导的默认绑定都是 claude-code；缺省时 agent 建出来的人
 *   至少绑着一种真实存在的 CLI —— 空名册最常见的用法就是"照着默认建一个能干活的角色"。
 */
const DEFAULT_ARCHETYPE = 'claude-code';

/** 皮肤 id 词表（渲染侧资源键，来自 core 的皮肤注册表 —— 不另抄一份）。 */
const SKIN_IDS = SKINS.map((skin) => skin.id);

/** 缺省皮肤：default（core 皮肤注册表的第一条）。 */
const DEFAULT_SKIN_ID = 'default';

/**
 * 人设提示词的码点上限（MCP 侧自设）。
 * why 比 core 的 32000 紧：回执要把建好的角色**整个**回给调用方（含人设全文），
 *   人设有界才谈得上"默认响应不超预算"；core 的上限管的是状态广播体积，两者是两件事。
 */
const MAX_PERSONA_LEN = 2000;

export const characterCreateTool: ToolSpec = {
  name: 'stratix_character_create',
  domain: 'character',
  verb: 'create',
  // 清单位次：新增工具排在既有十六件之后（既有工具的相对次序不变 —— 见 registry.ts 的排序口径）。
  order: 17,
  description: [
    '新建一个 agent 角色档案：起名、绑定一种本地 CLI agent（原型）、给一份人设提示词，角色随即出现在名册与战场上。',
    '何时用：名册是空的（或缺人手）时要开工 —— 先建角色，再派单 / 建编组；这是 MCP 侧唯一的名册供给入口。',
    '何时不用：只想看现有名册 —— 用 stratix_registry；只想看战场忙闲 —— 用 stratix_world_snapshot；',
    '角色已经在了、只是要改人设或改名 —— 本工具只建档，不改档（改档走界面）。',
    '边界：name 必填（trim 后非空，≤ 24 码点；与现有名册重名按大小写不敏感判定，**重名直接拒绝**）。',
    'archetype 缺省 claude-code（= 绑定的 CLI agent 种类，也就是名册里的 agent_kind）；skin_id 缺省 default；',
    'persona 缺省套 core 的默认人设模板（≤ 2000 码点，MCP 侧自设）。初始等级恒为 1、经验恒为 0（core 建档口径）。',
    '建档即上场：角色落库的同时在战场上多一个单位（unit_id 一并回给你），可直接拿去指派。',
    '错误：invalid_arguments（名字缺失 / 超长 / 重名 / 人设超长 / 原型或皮肤取值非法 / 名册已满）/ internal_error。',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        minLength: 1,
        maxLength: MAX_CHARACTER_NAME_LEN,
        description: `角色名（必填）。trim 后非空、≤ ${MAX_CHARACTER_NAME_LEN} 码点；与现有名册重名（大小写不敏感）会被拒绝。`,
      },
      archetype: {
        type: 'string',
        enum: [...ARCHETYPES],
        default: DEFAULT_ARCHETYPE,
        description:
          '角色原型 = 绑定哪种本地 CLI agent（= 名册里的 agent_kind）。缺省 claude-code。绑定未安装的 CLI 时派单会被拒。',
      },
      persona: {
        type: 'string',
        maxLength: MAX_PERSONA_LEN,
        description: `人设提示词（选填）。缺省 / 空串 → 套 core 的默认人设模板；≤ ${MAX_PERSONA_LEN} 码点（MCP 侧自设）。`,
      },
      skin_id: {
        type: 'string',
        enum: [...SKIN_IDS],
        default: DEFAULT_SKIN_ID,
        description: '皮肤资源键（渲染侧染色用）。缺省 default。',
      },
    },
    required: ['name'],
    additionalProperties: false,
  },
  errors: ['invalid_arguments', 'internal_error'],
  readOnly: false,
  handler: (args, host) => {
    // —— 入参（形状与范围；业务合法性留给 core）——
    const name = requireString(args, 'name');
    if (countCodePoints(name) > MAX_CHARACTER_NAME_LEN) {
      throw new McpToolError('invalid_arguments', `name 超过 ${MAX_CHARACTER_NAME_LEN} 码点上限`, {
        hint: '把角色名写短一点（人名级别的短名即可）',
      });
    }
    const archetype = optionalEnum(args, 'archetype', ARCHETYPES) ?? DEFAULT_ARCHETYPE;
    const skinId = optionalEnum(args, 'skin_id', SKIN_IDS) ?? DEFAULT_SKIN_ID;
    const persona = optionalString(args, 'persona');
    if (persona !== undefined && countCodePoints(persona) > MAX_PERSONA_LEN) {
      throw new McpToolError('invalid_arguments', `persona 超过 ${MAX_PERSONA_LEN} 码点上限`, {
        hint: '人设写短一点，或拆成几行要点',
      });
    }

    // —— 准入快筛（只读，不改状态；权威裁决在 core 的 setState 内）——
    const state = host.getWorldState();
    if (hasDuplicateCharacterName(state.characters, name)) {
      throw new McpToolError('invalid_arguments', `名册里已有同名角色「${name}」`, {
        hint: '换一个名字（重名按大小写不敏感判定），或用 stratix_registry 看现有名册',
      });
    }
    if (state.characters.length >= MAX_CHARACTERS) {
      throw new McpToolError('invalid_arguments', `名册已满（上限 ${MAX_CHARACTERS} 位角色）`, {
        hint: '先在界面里移除不需要的角色，再建新的',
      });
    }

    // —— 建档：只发命令，落库 / 投影 / 战场单位由 core 裁决 ——
    const beforeIds = new Set(state.characters.map((character) => character.id));
    host.dispatchCommand({
      type: 'character.create',
      name,
      agentKind: archetype,
      skinId,
      ...(persona ? { persona } : {}),
    });

    const after = host.getWorldState();
    const created = after.characters.find((character) => !beforeIds.has(character.id));
    if (!created) {
      throw new McpToolError('internal_error', '角色未落地：本进程没有 core 运行时接管这条命令', {
        hint: '确认 Stratix 运行时在本进程已启动后再建角色',
      });
    }

    // 建档即上场：core 在同一次 setState 里把角色投影成战场单位（core/character/unit-projection.ts）。
    const unit = after.units.find((item) => item.characterId === created.id);

    return toToolResult({
      ok: true,
      data: {
        character_id: created.id,
        // 战场单位 id（建档即上场；查不到就是 null —— 不编造）。
        unit_id: unit?.id ?? null,
        character: toCharacterPayload(created),
        next: {
          tool: 'stratix_mission_create',
          args: unit ? { units: [unit.id] } : {},
          hint: unit
            ? '给它起个任务标题就能开工（units 传这个角色的战场单位 id）'
            : '这个角色还没上场（没有战场单位）—— 先用 stratix_registry 看名册',
        },
        poll: {
          tool: 'stratix_registry',
          args: {},
        },
      },
    });
  },
};

/**
 * 角色对象 → 回执载荷（snake_case，与既有工具的载荷风格一致）。
 * why 整份回显：调用方刚建完档，最需要的就是"建成了什么样"（名字 / 原型 / 等级 / 皮肤 / 人设），
 *   少给字段就得再调一次 stratix_registry 拼凑 —— 那是白跑一轮。
 */
function toCharacterPayload(character: CharacterView): Record<string, unknown> {
  return {
    id: character.id,
    name: character.name,
    persona: character.persona,
    level: character.level,
    experience: character.experience,
    agent_kind: character.agentKind ?? null,
    skin_id: character.skinId ?? null,
    external_session_id: character.externalSessionId ?? null,
    appearance: character.appearance ?? null,
    context_enabled: character.contextEnabled ?? null,
  };
}

/**
 * `stratix_character_delete` —— **名册清理**（`character_create` 的逆向工具）。
 *
 * why 需要它：试错 / 评估型 agent 建了一堆角色就再也删不掉（复测留下的废角色会永久占着名册，
 *   顶到 MAX_CHARACTERS 就连正常建档都建不出来）—— 名册只进不出是一处结构性缺口。
 *
 * 输入：character_id（必填）。
 * 输出：删除回执 —— 删掉的角色 id / 名字 + 一并撤下的战场单位 id + 下一步指引。
 * 禁止事项：
 *   1. 绕过 core 总线直接改状态 —— 删除只发 HudCommand.character.delete；名册移除、
 *      战场单位撤下、占用裁决全由 core 的 character manager 在**同一次 setState** 内完成；
 *   2. 自己写一套"占用"规则 —— 占用判定复用 core 的 findCharacterDeleteBlock（纯函数，
 *      与 manager 同一份口径），本工具只在**下发前**用它做一次快筛并把原因说清；
 *   3. 把"删不存在的 id"当成功 —— 不存在的 id 报 unknown_character（说清"没有这条角色"），
 *      不假装删掉了什么（幂等性靠"明确的错误"达成，不靠静默成功）。
 */
export const characterDeleteTool: ToolSpec = {
  name: 'stratix_character_delete',
  domain: 'character',
  verb: 'delete',
  // 清单位次：排在 character_create（17）之后 —— character 域两件写面挨在一起。
  order: 18,
  description: [
    '删除一个 agent 角色档案：角色从名册消失，它在战场上的单位也一并撤下。',
    '何时用：名册里留着试错 / 废弃 / 出错的角色要清掉（角色建错了、重复了、CLI 换掉了）；',
    '名册满了建不出新角色时，先删掉用不上的那些。',
    '何时不用：只想看现有名册 —— 用 stratix_registry；只想改角色的名字 / 人设 / 形象 —— 那是改档不是删档；',
    '想停掉角色手头的活 —— 用 stratix_task_cancel 撤任务（任务撤不掉就等它收尾），删角色不撤任务。',
    '边界：character_id 必填（要删的角色 id，用 stratix_registry 查）。',
    '**占用中的角色删不掉**（会先说清原因，不静默跳过）：',
    '① 在任务中（还有没收尾的任务 / 战场单位还在执行编组任务）；② 在线（该角色有在办会话、正在对话）。',
    '删除后名册与战场同时少一位（不会出现"名册没了、战场上还留个单位"的幽灵单位）。',
    '删一个不存在的 id → 报 unknown_character（明确说没有这条角色），不当成删成功。',
    '错误：invalid_arguments（character_id 缺失）/ unknown_character（名册里没有这个 id）/',
    'illegal_transition（角色在任务中）/ chat_busy（角色在线、有在办会话）/ internal_error。',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      character_id: {
        type: 'string',
        minLength: 1,
        description: '要删除的角色 id（必填）。用 stratix_registry 查名册里的真实 id。',
      },
    },
    required: ['character_id'],
    additionalProperties: false,
  },
  errors: [
    'invalid_arguments',
    'unknown_character',
    'illegal_transition',
    'chat_busy',
    'internal_error',
  ],
  readOnly: false,
  handler: (args, host) => {
    // —— 入参（形状）——
    const characterId = requireString(args, 'character_id');

    // —— 前置快筛（只读；权威裁决在 core 的 manager，同一份判定口径）——
    const state = host.getWorldState();
    const character = state.characters.find((item) => item.id === characterId);
    if (!character) {
      throw new McpToolError('unknown_character', `未找到角色「${characterId}」的档案`, {
        hint: '用 stratix_registry 查名册里的角色 id（名册里没有就是不存在，别重试同一个 id）',
      });
    }
    const block = findCharacterDeleteBlock(state, characterId);
    if (block) {
      if (block.reason === 'character-busy') {
        throw new McpToolError(
          'illegal_transition',
          `角色「${character.name}」当前在任务中，不能删除：${block.detail}`,
          {
            retryable: true,
            hint: '先等这条任务收尾，或用 stratix_task_cancel 撤掉还在排队的任务，再回来删',
          }
        );
      }
      throw new McpToolError('chat_busy', `角色「${character.name}」当前在线，不能删除：${block.detail}`, {
        retryable: true,
        hint: '等这一轮对话结束后再删',
      });
    }

    // —— 删除：只发命令，名册移除 / 单位撤下 / 占用裁决由 core 裁决 ——
    // 单位 id 要在**删除前**取：删完它就没了（删后回查只会得到 null —— 那是漏报，不是没有单位）。
    const unitBefore = state.units.find((item) => item.characterId === characterId);
    host.dispatchCommand({ type: 'character.delete', characterId });

    const after = host.getWorldState();
    if (after.characters.some((item) => item.id === characterId)) {
      throw new McpToolError('internal_error', '角色未被删除：本进程没有 core 运行时接管这条命令', {
        hint: '确认 Stratix 运行时在本进程已启动后再删角色',
      });
    }

    return toToolResult({
      ok: true,
      data: {
        character_id: characterId,
        name: character.name,
        // 一并撤下的战场单位 id（没有上场就是 null —— 不编造）。
        removed_unit_id: unitBefore?.id ?? null,
        next: {
          tool: 'stratix_registry',
          args: {},
          hint: '名册已更新（角色与它的战场单位都已撤下）—— 用 stratix_registry 复核',
        },
      },
    });
  },
};
