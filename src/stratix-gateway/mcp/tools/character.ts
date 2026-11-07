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

import { MAX_CHARACTERS_PER_INSTANCE } from '../../../core/capacity';
import { findCharacterDeleteBlock } from '../../../core/character/delete-guard';
import { hasDuplicateCharacterName } from '../../../core/character/profile';
import { SKINS } from '../../../core/theme/skin-registry';
import {
  AGENT_KINDS,
  MAX_CHARACTER_NAME_LEN,
  type CharacterView,
  type WorldState,
} from '../../../core/types';
import { countCodePoints, optionalEnum, optionalString, requireString, truncateText } from '../args';
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
 *
 * @since v3.7（task_131）**建档与改档共用这一档**：同一个字段在 MCP 侧只有一个上限 ——
 *   建档时它是**输入**上限，改档时它也是**输入**上限（改档不因为"是修改"就放宽，
 *   否则 agent 建档时写不进的长人设、改档时却写得进，两侧口径就漂了）；
 *   它同时是**回显**上限（改档回执里的人设全文按它截断，见 toCharacterEditPayload）。
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
    '角色已经在了、只是要改人设或改名 —— 本工具只建档，不改档（改档用 stratix_character_edit）。',
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
    // 名册上限 = **每副本**口径（当前副本的名册；跨副本的总量上限另在落库层）。
    if (state.characters.length >= MAX_CHARACTERS_PER_INSTANCE) {
      throw new McpToolError('invalid_arguments', `名册已满（上限 ${MAX_CHARACTERS_PER_INSTANCE} 位角色）`, {
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
 *   顶到 MAX_CHARACTERS_PER_INSTANCE（每副本 64）就连正常建档都建不出来）—— 名册只进不出是一处结构性缺口。
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

/**
 * `stratix_character_edit` —— **名册维护**（改档：改名 / 换人设 / 切上下文开关）。
 *
 * why 需要它（123 的遗留缺口）：此前 MCP 侧只有建档（character_create）与删档（character_delete），
 *   改档面**只走界面** —— 外部 agent 建完档就再也无法自主维护自己的档（改个名字都得请人开界面）。
 *   名册只进不出是缺口，补了删档没补改档，缺口只补了一半。
 *
 * 输入：character_id（必填）+ name / persona / context_enabled（至少给一个）。
 * 输出：受理回执 —— 改了哪些字段（changed）、哪些字段本来就同值（unchanged）+ 改后的角色对象。
 * 禁止事项：
 *   1. 绕过 core 总线直接写状态 —— 改档只发 HudCommand.character.{name,persona,contextEnabled}.update；
 *      落库、名册投影、战场单位名同步全由 core 的 character manager 裁决
 *      （core/character/manager.ts 的 updateName / updatePersona / updateContextEnabled）；
 *   2. 自己写一套"名字合法性"规则 —— 形状裁决复用 core 的 resolveCharacterName 口径（≤ 24 码点），
 *      重名判定复用 core 的 hasDuplicateCharacterName（豁免自己）；权威裁决仍在 core；
 *   3. 放行受保护字段（皮肤 / 绑定 CLI / 等级 / 经验 / 形象）—— 它们各有各的裁决面，
 *      开放等于让外部 agent 绕过成长曲线与形象解锁门槛，一律拒绝并说清原因；
 *   4. 把"没改成"说成改成了 —— 每个字段下发后**回读状态核对**，没落地就如实报错。
 */

/**
 * 可编辑字段（= UI 侧角色编辑中心实际开放的字段）。
 * why 是这三项、不是别的：UI 的角色编辑中心（hud/screens/character-screen.ts）开的是
 *   「档案」（改名）/「人设」（全文编辑）/「形象」（部位选择器）三个 tab，
 *   外加 agent-panel 角色卡上的上下文开关（task_053）。
 *   形象（appearance）**不在**其中：它的部位按角色等级解锁（hud/screens/appearance-unlock-catalog.ts），
 *   解锁门槛是界面约束、core 明确不判（见 core/types.ts 的 character.appearance.update 注释）——
 *   MCP 侧开放原样写入等于给外部 agent 开了绕过门槛的后门，故不开放，改为说清去哪改。
 */
const EDITABLE_FIELDS = ['name', 'persona', 'context_enabled'] as const;

/**
 * 受保护字段 → 拒绝原因（"知道它，但锁着" —— 与"根本不认识它"分开说）。
 * why 单列一张表：这些字段调用方**很可能**会顺手传（改名时顺便传 skin、改等级），
 *   若只回一句"未知参数"，模型会以为字段名拼错了、改个名再试 —— 而真相是
 *   "这个字段锁着，改它要走别的路"。拒绝要说清**为什么锁**与**怎么办**。
 */
const PROTECTED_FIELDS: Readonly<Record<string, string>> = {
  skin_id: '皮肤是建档时定的（core 没有换肤命令面）—— 要换形象请建新角色',
  archetype: '绑定的 CLI agent 种类建档后不可改（core 档案里 agent_kind 是建档字段）—— 要换 CLI 请建新角色',
  agent_kind: '绑定的 CLI agent 种类建档后不可改（core 档案里 agent_kind 是建档字段）—— 要换 CLI 请建新角色',
  level: '等级由 core 的成长曲线裁决（成长只走任务 / 经验回报），不能直接写',
  experience: '经验由 core 的成长曲线裁决（成长只走任务 / 经验回报），不能直接写',
  appearance: '形象按角色等级解锁部位（解锁门槛是界面约束，MCP 侧开放就等于绕过它）—— 请在角色编辑面板改',
};

export const characterEditTool: ToolSpec = {
  name: 'stratix_character_edit',
  domain: 'character',
  verb: 'edit',
  // 清单位次：排在 character_delete（18）之后 —— character 域三件写面挨在一起。
  order: 19,
  description: [
    '改一个已有 agent 角色档案：改名、换人设提示词、开关角色的上下文注入。改完立即生效。',
    '何时用：角色建好了但档案要维护 —— 名字起错了要改、人设要按新任务调、上下文块要关掉；',
    '外部 agent 建完档后要自主维护自己的档（此前改档只能走界面，MCP 侧无从下手）。',
    '何时不用：只想看现有名册 —— 用 stratix_registry；只想看战场忙闲 —— 用 stratix_world_snapshot；',
    '角色还不存在 —— 先用 stratix_character_create 建档；要删角色 —— 用 stratix_character_delete（删档不是改档）。',
    '边界：character_id 必填；name / persona / context_enabled 至少给一个（都给就是一次改多项）。',
    'name：trim 后非空、≤ 24 码点；与**其它**角色重名（大小写不敏感）直接拒绝；与自己当前名字相同 → 幂等成功、不写库不广播（只改大小写算真改名）；战场单位名同步刷新。',
    'persona：整份替换（不是追加）；trim 后非空、≤ 2000 码点（MCP 侧上限，与建档同一口径）；与现有人设相同 → 幂等成功。',
    'context_enabled：true = 对话 / 任务首发附带战场现状块，false = 不带；与当前值相同 → 幂等成功。',
    '任务中 / 在线的角色同样可改（与界面口径一致）：改名立刻生效，人设与上下文开关下一轮对话生效，不打断在跑的那一轮。',
    '受保护字段（skin_id / archetype / agent_kind / level / experience / appearance）一律拒绝并说明原因：皮肤与绑定 CLI 建档后不可改，等级 / 经验由成长曲线裁决，形象按等级解锁（走界面改）。',
    '逐项下发并逐项回读核对：某个字段没改进去会如实报错（不假装改成功），后面的字段也不再下发。',
    '错误：invalid_arguments（character_id 缺失 / 没有要改的字段 / 字段值非法 / 未知或受保护字段）/ unknown_character（名册里没有这个 id）/ internal_error（命令没人接管）。',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      character_id: {
        type: 'string',
        minLength: 1,
        description: '要改的角色 id（必填）。用 stratix_registry 查名册里的真实 id。',
      },
      name: {
        type: 'string',
        maxLength: MAX_CHARACTER_NAME_LEN,
        description: `新名字（选填）。trim 后非空、≤ ${MAX_CHARACTER_NAME_LEN} 码点；与**其它**角色重名（大小写不敏感）会被拒绝；与自己当前名字相同 → 幂等成功、不写库。`,
      },
      persona: {
        type: 'string',
        maxLength: MAX_PERSONA_LEN,
        description: `新人设提示词（选填，整份替换）。trim 后非空、≤ ${MAX_PERSONA_LEN} 码点（MCP 侧上限，与建档同一口径）；与现有人设相同 → 幂等成功。`,
      },
      context_enabled: {
        type: 'boolean',
        description:
          '角色级上下文注入开关（选填）：true = 对话 / 任务首发附带战场现状块，false = 不带。与当前值相同 → 幂等成功。',
      },
    },
    required: ['character_id'],
    additionalProperties: false,
  },
  errors: ['invalid_arguments', 'unknown_character', 'internal_error'],
  readOnly: false,
  handler: (args, host) => {
    // —— 入参（形状与范围；业务合法性留给 core 的权威裁决，这里只做前置快筛）——
    const characterId = requireString(args, 'character_id');
    assertOnlyEditableFields(args);

    const state = host.getWorldState();
    const character = state.characters.find((item) => item.id === characterId);
    if (!character) {
      throw new McpToolError('unknown_character', `未找到角色「${characterId}」的档案`, {
        hint: '用 stratix_registry 查名册里的角色 id（名册里没有就是不存在，别重试同一个 id）',
      });
    }

    const wantName = readOptionalStringField(args, 'name');
    const wantPersona = readOptionalStringField(args, 'persona');
    const wantContext = readOptionalBooleanField(args, 'context_enabled');
    if (wantName === undefined && wantPersona === undefined && wantContext === undefined) {
      throw new McpToolError('invalid_arguments', '没有要改的字段', {
        hint: `至少给一个可改字段：${EDITABLE_FIELDS.join(' / ')}`,
      });
    }

    // —— 校验（口径与界面角色编辑中心一致；core 侧仍会再裁决一次，竞态以 core 为准）——
    const nextName = wantName === undefined ? undefined : resolveEditableName(wantName, state, characterId);
    const nextPersona = wantPersona === undefined ? undefined : resolveEditablePersona(wantPersona);

    // —— 逐项下发并逐项回读核对（先验后写：前一项没落地就不再往下发）——
    const changed: string[] = [];
    const unchanged: string[] = [];

    if (nextName !== undefined) {
      if (character.name === nextName) {
        // 同值 → 幂等成功：不下发（core 侧同值写入也不写库不广播，无副作用）。
        unchanged.push('name');
      } else {
        host.dispatchCommand({ type: 'character.name.update', characterId, name: nextName });
        const landed = host.getWorldState().characters.find((item) => item.id === characterId)?.name;
        if (landed !== nextName) {
          // 没落地有两种原因，说法要分开：被别人抢了同名（竞态）／命令没人接管。
          if (hasDuplicateCharacterName(host.getWorldState().characters, nextName, characterId)) {
            throw new McpToolError('invalid_arguments', `名册里已有同名角色「${nextName}」`, {
              hint: '换一个名字（重名按大小写不敏感判定），或用 stratix_registry 看现有名册',
            });
          }
          throw new McpToolError('internal_error', '改名未落地：本进程没有 core 运行时接管这条命令', {
            hint: '确认 Stratix 运行时在本进程已启动后再改角色',
          });
        }
        changed.push('name');
      }
    }

    if (nextPersona !== undefined) {
      if (character.persona === nextPersona) {
        unchanged.push('persona');
      } else {
        host.dispatchCommand({ type: 'character.persona.update', characterId, prompt: nextPersona });
        const landed = host.getWorldState().characters.find((item) => item.id === characterId)?.persona;
        if (landed !== nextPersona) {
          throw new McpToolError('internal_error', '人设未落地：本进程没有 core 运行时接管这条命令', {
            hint: '确认 Stratix 运行时在本进程已启动后再改角色',
          });
        }
        changed.push('persona');
      }
    }

    if (wantContext !== undefined) {
      // 缺省 / null = 开（core 的语义归一），故比较时按 true 兜底。
      if ((character.contextEnabled ?? true) === wantContext) {
        unchanged.push('context_enabled');
      } else {
        host.dispatchCommand({
          type: 'character.contextEnabled.update',
          characterId,
          enabled: wantContext,
        });
        const landed = host.getWorldState().characters.find((item) => item.id === characterId)?.contextEnabled;
        if ((landed ?? true) !== wantContext) {
          throw new McpToolError(
            'internal_error',
            '上下文开关未落地：本进程没有 core 运行时接管这条命令',
            { hint: '确认 Stratix 运行时在本进程已启动后再改角色' }
          );
        }
        changed.push('context_enabled');
      }
    }

    const after = host.getWorldState();
    const updated = after.characters.find((item) => item.id === characterId);
    if (!updated) {
      throw new McpToolError('internal_error', '角色在改档过程中从名册里消失了', {
        hint: '角色被并发删除了（用 stratix_registry 复核名册），需要时重新建档',
      });
    }

    return toToolResult({
      ok: true,
      data: {
        character_id: characterId,
        /** 实际改掉的字段。 */
        changed,
        /** 传了但与现值相同（幂等成功，没有写入）。 */
        unchanged,
        character: toCharacterEditPayload(updated),
        next: {
          tool: 'stratix_registry',
          args: {},
          hint:
            changed.length > 0
              ? '名册已更新（改完即生效）—— 用 stratix_registry 复核'
              : '字段与现值一致，没有写入（幂等成功，无需重试）',
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
 * 字段白名单快筛：未知参数与受保护参数分开拒（理由不同，下一步也不同）。
 * why 要在工具层查：运行期**没有** schema 校验器（server.ts 直接把 arguments 交给 handler），
 *   schema 里的 additionalProperties:false 只是给客户端看的契约 —— 真要拒，得手写这一段。
 */
function assertOnlyEditableFields(args: Readonly<Record<string, unknown>>): void {
  for (const key of Object.keys(args)) {
    if (key === 'character_id') continue;
    if ((EDITABLE_FIELDS as readonly string[]).includes(key)) continue;
    const reason = PROTECTED_FIELDS[key];
    if (reason) {
      throw new McpToolError('invalid_arguments', `参数 ${key} 是受保护字段，不能改：${reason}`, {
        hint: `本工具可改的字段只有：${EDITABLE_FIELDS.join(' / ')}`,
      });
    }
    throw new McpToolError('invalid_arguments', `未知参数 ${key}`, {
      hint: `本工具只认：character_id / ${EDITABLE_FIELDS.join(' / ')}`,
    });
  }
}

/**
 * 选填字符串字段（原始值）。
 * why 不用 args.ts 的 optionalString：它把空串当"没给"，而改档里空串是**非法值**
 *   （清空人设 / 清空名字都要被拒，不是"没改这一项"）—— 悄悄当缺省处理会让模型
 *   以为清空成功了。
 */
function readOptionalStringField(
  args: Readonly<Record<string, unknown>>,
  key: string
): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new McpToolError('invalid_arguments', `参数 ${key} 必须是字符串`);
  }
  return value;
}

/** 选填布尔字段（三态：缺省 = 不改这一项；故不能用 args.ts 的带缺省回落那档）。 */
function readOptionalBooleanField(
  args: Readonly<Record<string, unknown>>,
  key: string
): boolean | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') {
    throw new McpToolError('invalid_arguments', `参数 ${key} 必须是布尔值`);
  }
  return value;
}

/**
 * 新名字的形状与重名快筛（口径与界面角色编辑中心一致；core 侧仍是权威裁决）。
 * why 豁免自己：改大小写（Neo → NEO）是合法改名，core 侧也按"真改名"写库。
 */
function resolveEditableName(raw: string, state: WorldState, characterId: string): string {
  const name = raw.trim();
  if (name.length === 0) {
    throw new McpToolError('invalid_arguments', 'name 不能为空', {
      hint: '给一个新名字（不能是空串）',
    });
  }
  if (countCodePoints(name) > MAX_CHARACTER_NAME_LEN) {
    throw new McpToolError('invalid_arguments', `name 超过 ${MAX_CHARACTER_NAME_LEN} 码点上限`, {
      hint: '把角色名写短一点（人名级别的短名即可）',
    });
  }
  if (hasDuplicateCharacterName(state.characters, name, characterId)) {
    throw new McpToolError('invalid_arguments', `名册里已有同名角色「${name}」`, {
      hint: '换一个名字（重名按大小写不敏感判定；与自己同名不算），或用 stratix_registry 看现有名册',
    });
  }
  return name;
}

/** 新人设的形状快筛（trim 后非空 + 有界；core 侧仍会再裁决一次）。 */
function resolveEditablePersona(raw: string): string {
  const persona = raw.trim();
  if (persona.length === 0) {
    throw new McpToolError('invalid_arguments', 'persona 不能为空', {
      hint: '想换风格就直接写新的人设正文（整份替换），不要清空',
    });
  }
  if (countCodePoints(persona) > MAX_PERSONA_LEN) {
    throw new McpToolError('invalid_arguments', `persona 超过 ${MAX_PERSONA_LEN} 码点上限`, {
      hint: '人设写短一点，或拆成几行要点（与建档同一上限）',
    });
  }
  return persona;
}

/**
 * 改档回执里的角色载荷（人设有界）。
 * why 要截断：人设本体可达 core 的 32000 字符上限，而改档回执要回答的是"改成什么了"，
 *   全文回显会让默认响应体积不可控（与 world 工具截断任务摘要同一口径）。
 */
function toCharacterEditPayload(character: CharacterView): Record<string, unknown> {
  return {
    ...toCharacterPayload(character),
    persona: truncateText(character.persona, MAX_PERSONA_LEN),
    persona_truncated: countCodePoints(character.persona) > MAX_PERSONA_LEN,
  };
}
