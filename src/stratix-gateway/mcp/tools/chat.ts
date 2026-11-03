/**
 * 文件职责：`stratix_chat_send` —— 给指定角色发一轮对话，等这一轮回复回来。
 * 输入：character（角色 id）/ message（发言内容）。
 * 输出：受理回执（消息 id + 角色 + 本轮状态 + 回复正文 + 耗时 + 会话 id）。
 * 禁止事项：
 *   1. 在 MCP 侧自己跑一轮对话 —— 对话服务住在持有 chat-service 的那个进程（渲染进程），
 *      那边才有 per-character 忙碌锁；MCP 侧另起一套会让"同一角色同时只允许一轮在跑"
 *      当场失效，也会造出第二份会话真相。这里只**委托**（McpHost.sendChatRound 端口）；
 *   2. 用 HudCommand.chat.send 投给外部会话（link）—— 那是给 link 用的，不是给角色发消息，
 *      两者不可混用（docs/MCP-SPEC.md §2.7）；
 *   3. 编造回复 —— 端口没接就如实报不可用，不许自己造一条回复糊弄调用方；
 *   4. 回灌对话历史 —— 历史在 UI 抽屉与落库表里，不随本工具返回。
 *
 * ============ 本部署的可用性（task_125 / N1 复测）============
 * 诊断：对话引擎（app/services/chat-service.ts）住在**应用进程**（组合根 src/app/main/main-entry.ts
 *   把它接到抽屉视图口 + IPC transport），而 MCP server 挂在 **gateway service 进程** ——
 *   两个进程不共进程，忙碌锁与外部会话句柄都不共享。在 service 进程里另起一套聊天实现，
 *   会让「同一角色同时只允许一轮在跑」当场失效，并造出第二份会话真相（mcp/types.ts 的
 *   sendChatRound 端口契约已写明这条纪律）。跨进程真接线要么改 world-sync 协议（当前是
 *   封闭五型词表，没有 RPC 通道）让 service 回调渲染侧，要么把对话引擎整体迁到 service 进程
 *   并让抽屉改走 RPC —— 两者都超出本任务范围（前者动协议与渲染层，后者动架构主线）。
 * 因此本部署取**诚实降级**：端口缺席时如实报「不可用（not_available）」+ **retryable:false**
 *   （缺端口是架构缺口，重试不会自愈 —— 旧实现标 retryable:true，诱导外部 agent 无效重试），
 *   并在 hint 里指向可用的替代路径（stratix_task_assign / stratix_session_list / stratix_session_get）。
 */

import { countCodePoints, requireString, truncateText } from '../args';
import { McpToolError, toToolResult } from '../envelope';
import type { ToolSpec } from '../types';

import { guardCharacter } from './common';

/** 发言内容的码点上限（schema 同值）。 */
const MAX_MESSAGE_LEN = 8000;

/**
 * 回复正文的码点上限。
 * why 2000：与任务摘要同量级（MAX_TASK_SUMMARY_LEN = 2000）—— 一轮对话的正文可能很长，
 * 而工具返回是给模型读的，超长正文会把上下文预算吃光；要全文的模型去查落库表。
 */
const MAX_REPLY_LEN = 2000;

export const chatSendTool: ToolSpec = {
  name: 'stratix_chat_send',
  domain: 'chat',
  verb: 'send',
  // 清单位次（§2 的条目号只作文档锚点，见 docs/MCP-SPEC.md §2.0）：
  // mission 域新工具插进来后，chat 域整体后移两位 —— 既有工具之间的相对次序不变。
  order: 10,
  description: [
    '给指定角色发一轮对话，等这一轮回复回来。',
    '⚠ 本部署暂不可用：对话引擎住在应用进程（聊天抽屉那一侧），MCP 所在的 gateway service 进程',
    '没有对话通路 —— 调用本工具会拿到 not_available（错误码 internal_error，**retryable:false**，',
    '重试不会自愈）。要一份确定的产出物用 stratix_task_assign（任务有结果摘要、有超时、有归档）；',
    '要查发生过什么用 stratix_session_list / stratix_session_get；',
    '要多人讨论用 stratix_mission_create 编组后派单。',
    '何时用：提问、讨论、澄清需求 —— 需要来回对话而不是一次性交付（前提：宿主接了对话端口）。',
    '何时不用：要一份确定的产出物 —— 用 stratix_task_assign（任务有结果摘要、有超时、有归档）；',
    '要多人讨论 —— 先 stratix_mission_create 编组，再各自发消息。',
    '边界：本工具**同步等一轮**（受服务端单轮超时约束），返回该轮回复文本（超过 2000 码点截断并标 reply_truncated）。',
    '同一角色同时只允许一轮在跑；已有轮次在跑时返回 chat_busy，**不静默丢弃**。',
    '对话历史不随本工具返回（历史在 UI 抽屉与落库表里）；MCP 侧目前没有读对话历史的工具，别去找不存在的名字。',
    '错误：unknown_character / character_unbound / agent_not_installed / character_offline（可重试）/',
    'chat_busy（可重试）/ invalid_arguments / internal_error（不可用时 retryable:false）。',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      character: { type: 'string', description: '角色 id（见 stratix_registry）。' },
      message: {
        type: 'string',
        minLength: 1,
        maxLength: MAX_MESSAGE_LEN,
        description: '这一轮要说的内容。上限 8000 码点。',
      },
    },
    required: ['character', 'message'],
    additionalProperties: false,
  },
  errors: [
    'unknown_character',
    'character_unbound',
    'agent_not_installed',
    'character_offline',
    'chat_busy',
    'invalid_arguments',
    'internal_error',
  ],
  readOnly: false,
  handler: async (args, host) => {
    const characterId = requireString(args, 'character');
    const messageRaw = requireString(args, 'message');

    if (countCodePoints(messageRaw) > MAX_MESSAGE_LEN) {
      throw new McpToolError(
        'invalid_arguments',
        `message 超过 ${MAX_MESSAGE_LEN} 码点上限`,
        { hint: '把这一轮的话写短一点（要全文就分两轮发）' }
      );
    }

    // ── 通路可用性（**先于守门**）──
    // why 先于守门：本部署整条对话通路都没接（架构缺口，见文件头），若先守门，调用方会拿到
    //   unknown_character 之类与"为什么调不成"无关的错误码，误以为换个角色 id 就能成。
    //   端口缺席是**确定性的架构缺口** —— 重试不会自愈，故 retryable:false（task_125 / N1）。
    const sendChatRound = host.sendChatRound;
    if (!sendChatRound) {
      throw new McpToolError(
        'internal_error',
        '角色对话通路在本部署不可用（not_available）：MCP 宿主未接 sendChatRound 端口',
        {
          retryable: false,
          hint:
            '本部署的角色对话只发生在应用内的聊天抽屉，MCP 侧调不到，重试无用。' +
            '要一份确定的产出物用 stratix_task_assign（派单后用 stratix_task_status 取结果）；' +
            '要查发生过什么用 stratix_session_list / stratix_session_get。',
        }
      );
    }

    // ── 角色守门（与派单同一份口径：在档 / 绑了 agent / CLI 已检出 / 不离线）──
    const character = guardCharacter(host.getWorldState(), characterId, 'chat');

    // ── 委托给持有 chat-service 的那一侧跑这一轮 ──
    const outcome = await sendChatRound(character.id, messageRaw);
    const replyTruncated = countCodePoints(outcome.reply) > MAX_REPLY_LEN;

    return toToolResult({
      ok: true,
      data: {
        message_id: outcome.messageId,
        character: { id: character.id, name: character.name },
        status: outcome.status,
        reply: truncateText(outcome.reply, MAX_REPLY_LEN),
        reply_truncated: replyTruncated,
        duration_ms: outcome.durationMs,
        session_id: outcome.sessionId,
      },
    });
  },
};
