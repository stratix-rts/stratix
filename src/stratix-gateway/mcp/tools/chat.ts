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
 *   3. 编造回复 —— 端口没接就如实报 internal_error，不许自己造一条回复糊弄调用方；
 *   4. 回灌对话历史 —— 历史在 UI 抽屉与落库表里，不随本工具返回。
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
  order: 7,
  description: [
    '给指定角色发一轮对话，等这一轮回复回来。',
    '何时用：提问、讨论、澄清需求 —— 需要来回对话而不是一次性交付。',
    '何时不用：要一份确定的产出物 —— 用 stratix_task_assign（任务有结果摘要、有超时、有归档）；',
    '要多人讨论 —— 先 stratix_mission_create 编组，再各自发消息。',
    '边界：本工具**同步等一轮**（受服务端单轮超时约束），返回该轮回复文本（超过 2000 码点截断并标 reply_truncated）。',
    '同一角色同时只允许一轮在跑；已有轮次在跑时返回 chat_busy，**不静默丢弃**。',
    '对话历史不随本工具返回（历史在 UI 抽屉与落库表里），需要历史请用扩展位 stratix_chat_history。',
    '错误：unknown_character / character_unbound / agent_not_installed / character_offline（可重试）/',
    'chat_busy（可重试）/ invalid_arguments。',
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

    // ── 角色守门（与派单同一份口径：在档 / 绑了 agent / CLI 已检出 / 不离线）──
    const character = guardCharacter(host.getWorldState(), characterId, 'chat');

    // ── 委托给持有 chat-service 的那一侧跑这一轮 ──
    const sendChatRound = host.sendChatRound;
    if (!sendChatRound) {
      throw new McpToolError(
        'internal_error',
        '本进程没有可用的角色对话通路（未接 sendChatRound 端口）',
        { hint: '对话服务在渲染进程；请在组合根把对话端口接进来，或改用 stratix_task_assign 派单' }
      );
    }

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
