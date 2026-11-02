/**
 * Stratix-as-dsh-plugin（spike）——把 Stratix 的世界态读面挂进 dsh 的工具注册表。
 *
 * 插件形状（照 dsh 官方文档 `docs/cordis-tutorial/01-first-plugin.md` 与
 * `docs/cookbook/adding-a-tool.md`）：
 * - 模块具名导出 `name`（诊断用标签）、`inject`（依赖的服务）、`Config`（配置 schema）、
 *   `apply(ctx, config)`（Cordis 装载时调用）；
 * - `inject: ['tools']` 让 Cordis 等 `tools` 服务就位后再装载本插件，于是
 *   `ctx.tools` 在 `apply` 里可用 —— 这就是「注册进 ctx.tools」的官方入口；
 * - 注册是 effect 式的：插件 fiber 被卸载时，工具自动注销（`ctx.tools.register` 返回的
 *   disposer 由注册层持有）。本插件自己持有的 WS 连接用 `ctx.effect` 挂一个 disposer，
 *   卸载时关掉 socket 与重连定时器 —— 不留孤儿连接。
 *
 * 范围声明（spike）：**只读**。注册一个工具 `stratix_world_snapshot`，
 * 不注册任何写命令工具（world-sync 的 `command.forward` 面不在本期）。
 */

import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
// 值导入：既拿到 defineTool，也把 `ctx.tools` 的 Context 类型增补带进来。
import { defineTool } from '@deepseek-ai/dsh-tools';
import { WorldSyncClient } from './world-sync-client.js';
import { createWorldSnapshotTool } from './world-snapshot-tool.js';

/** Cordis 插件名（诊断标签）。 */
export const name = 'stratix-dsh-bridge';

/** 依赖的服务：`tools` 注册表。没它就没有 `ctx.tools`。 */
export const inject = ['tools'];

/** 默认 world-sync 端点（可用环境变量 STRATIX_WORLD_SYNC_URL 覆盖）。 */
export const DEFAULT_WORLD_SYNC_URL = 'ws://127.0.0.1:7797/ws/world-sync';

/** 默认客户端 id（service 侧用作连接日志与广播归属）。 */
export const DEFAULT_CLIENT_ID = 'dsh-stratix-bridge';

/** 插件配置。 */
export interface BridgeConfig {
  /** Stratix service 的 world-sync WebSocket 端点（含 path）。 */
  url: string;
  /** 本客户端的 clientId。 */
  clientId: string;
  /** 重连退避基数（毫秒）。 */
  reconnectDelayMs: number;
}

/** Schemastery 配置 schema（dsh 的 patch 行用 `config:` 覆盖这里的默认值）。 */
export const Config: z<BridgeConfig> = z.object({
  url: z.string().default(process.env.STRATIX_WORLD_SYNC_URL ?? DEFAULT_WORLD_SYNC_URL),
  clientId: z.string().default(DEFAULT_CLIENT_ID),
  reconnectDelayMs: z.number().default(500),
});

function log(message: string): void {
  console.error(`[stratix-dsh-bridge] ${message}`);
}

/**
 * Cordis 装载入口。
 *
 * @param ctx - 宿主上下文，注入 `tools` 服务。
 * @param config - 部署侧配置（profile patch 的 `config:` 段）。
 */
export function apply(ctx: Context, config: BridgeConfig): void {
  const client = new WorldSyncClient({
    url: config.url,
    clientId: config.clientId,
    reconnectDelayMs: config.reconnectDelayMs,
    log,
  });

  // 插件 fiber 卸载时关连接（socket + 重连定时器）。
  ctx.effect(() => () => {
    log('插件卸载，关闭 world-sync 连接。');
    client.stop();
  });

  client.start();

  const tool = createWorldSnapshotTool(client, log);
  ctx.tools.register(tool);
  log(`已注册工具 ${tool.name}，world-sync 端点 ${config.url}。`);
}

/** 重新导出工具类型，方便宿主侧复用类型（不产生运行时依赖）。 */
export type { WorldSnapshotValue } from './world-snapshot-tool.js';
export { defineTool };
