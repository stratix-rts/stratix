/**
 * Stratix Electron Preload
 * 
 * 暴露 Electron API 给渲染进程
 * 支持服务调用、Tailscale、OpenClaw 等功能
 */

import { contextBridge, ipcRenderer } from 'electron';

import type { DetectedAgent } from '../core/types';
import type { CliChatEventEnvelope, CliChatIpcApi, CliChatRunRequest } from '../app/services/chat-transport-bridge';
import type { PersistedCharacterRecord, PersistedUnitPosition } from '../app/services/persistence/game-save-dao';
import type { ChatMessageInsert, PersistedChatMessage } from '../app/services/persistence/chat-history-dao';
import type { PersistedTaskRecord, PersistedTaskStatRow } from '../app/services/persistence/task-record-dao';
import type { PersistedPipelineRecord } from '../app/services/persistence/pipeline-record-dao';
import type { AgentHealthEventInsert } from '../app/services/persistence/agent-health-dao';

export interface ElectronAPI {
  // 通用服务调用
  invoke: (channel: string, ...args: any[]) => Promise<any>;

  // Dialog
  dialog: {
    openDirectory: () => Promise<{ success: boolean; canceled?: boolean; path?: string }>;
  };

  // Tailscale
  tailscale: {
    getStatus: () => Promise<any>;
    discoverNodes: () => Promise<any[]>;
    getNodes: () => Promise<any[]>;
    getLoginUrl: () => Promise<string | null>;
    login: (authKey?: string) => Promise<boolean>;
    isRunning: () => Promise<boolean>;
    needsAuth: () => Promise<boolean>;
    onEvent: (callback: (event: any) => void) => () => void;
    connectNode: (nodeId: string) => Promise<boolean>;
  };

  // OpenClaw
  openclaw: {
    connectDirect: (endpoint: string, config: any) => Promise<{ success: boolean; deviceId?: string; error?: string }>;
    disconnectDirect: () => Promise<{ success: boolean }>;
    sendMessage: (message: string, sessionId?: string) => Promise<any>;
  };

  // Custom Providers
  config: {
    saveCustomProviders: (configJson: string) => Promise<{ success: boolean; error?: string }>;
    loadCustomProviders: () => Promise<{ success: boolean; data: string | null; error?: string }>;
  };

  // API Keys (encrypted)
  apiKey: {
    save: (providerId: string, apiKey: string) => Promise<{ success: boolean; error?: string }>;
    load: (providerId: string) => Promise<{ success: boolean; data: string | null; error?: string }>;
    delete: (providerId: string) => Promise<{ success: boolean; error?: string }>;
    list: () => Promise<{ success: boolean; data: string[]; error?: string }>;
  };

  // Agent Platform - Workflow
  workflow: {
    list: () => Promise<{ success: boolean; workflows?: Array<{ id: string; name: string; updatedAt: number }>; error?: string }>;
    load: (id: string) => Promise<{ success: boolean; workflow?: any; error?: string }>;
    save: (id: string, workflow: any) => Promise<{ success: boolean; error?: string }>;
    delete: (id: string) => Promise<{ success: boolean; error?: string }>;
    presets: () => Promise<{ success: boolean; presets?: any[]; error?: string }>;
    presetLoad: (presetId: string) => Promise<{ success: boolean; workflow?: any; error?: string }>;
  };

  // Agent Platform - Providers
  provider: {
    list: () => Promise<{ success: boolean; providers?: any[]; error?: string }>;
    models: (providerId: string) => Promise<{ success: boolean; models?: string[]; error?: string }>;
    test: (providerId: string, model: string, apiKey?: string) => Promise<{ success: boolean; message: string; latency?: number }>;
    create: (instanceId: string, providerId: string, model: string, apiKey?: string, options?: any) => Promise<{ success: boolean; error?: string }>;
  };

  // Agent Platform - Execution
  execution: {
    start: (workflowId: string, workflow: any, input: string) => Promise<{ success: boolean; executionId?: string; error?: string }>;
    status: (executionId: string) => Promise<{ success: boolean; execution?: any; error?: string }>;
    list: () => Promise<{ success: boolean; executions?: any[] }>;
    clear: (executionId?: string) => Promise<{ success: boolean }>;
  };

  // Texture
  texture: {
    upload: (characterId: string, imageData: string, filename?: string) => Promise<{ success: boolean; data?: any; error?: string }>;
    check: (filePath: string) => Promise<{ exists: boolean; url?: string | null; size?: number; generatedAt?: number }>;
    delete: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  };

  // 本地 CLI agent 检测（@since v3.8，task_022）
  // 主进程探测 → 这里转给渲染层 → 渲染层并入 core 状态（WorldState.detectedAgents）。
  agentDetection: {
    /** 拉当前检测快照（渲染层启动时补上「订阅之前就检测完」的那部分）。 */
    snapshot: () => Promise<DetectedAgent[]>;
    /** 订阅检测更新（主进程每探测完一项推一次全量快照）；返回退订函数。 */
    onUpdate: (callback: (agents: DetectedAgent[]) => void) => () => void;
    /**
     * 按需跑一轮 T1 健康探测（@since v3.30，task_054）：主进程直跑 T1 五家的
     * which + --version，逐项并入快照并推送 onUpdate，resolve 返回整轮结果
     * （health-monitor 的防抖输入）。串行化在主进程：同轮不重叠。
     */
    probe: () => Promise<DetectedAgent[]>;
  };

  /**
   * 游戏存档（@since v3.12，task_033）：角色档案 + 单位站位的持久化通道。
   * SQLite 只在主进程（sql.js 适配器需要 Node fs），渲染层一律经这里走 IPC。
   */
  gameSave: {
    /** 读完整快照（角色档案 + 全部站位）。 */
    loadSnapshot: () => Promise<{ ok: boolean; characters?: PersistedCharacterRecord[]; unitPositions?: PersistedUnitPosition[]; error?: string }>;
    /** 批量 upsert 角色档案。 */
    saveCharacters: (records: PersistedCharacterRecord[]) => Promise<{ ok: boolean; error?: string }>;
    /** 批量 upsert 单位站位。 */
    saveUnitPositions: (entries: PersistedUnitPosition[]) => Promise<{ ok: boolean; error?: string }>;
    /** 写一条角色对话历史（@since v3.15，task_036）。 */
    saveChatMessage: (message: ChatMessageInsert) => Promise<{ ok: boolean; error?: string }>;
    /** 读某角色最近 N 条对话历史（默认 50）。 */
    loadChatMessages: (characterId: string, limit?: number) => Promise<{ ok: boolean; messages?: PersistedChatMessage[]; error?: string }>;
    /** upsert 一条角色任务记录（@since v3.16，task_037，落 character_tasks 表）。 */
    saveTask: (record: PersistedTaskRecord) => Promise<{ ok: boolean; error?: string }>;
    /** 读某角色最近 N 条任务（默认 20；038 队列可见性）。 */
    loadTasks: (characterId: string, limit?: number) => Promise<{ ok: boolean; tasks?: PersistedTaskRecord[]; error?: string }>;
    /** 全量按角色×状态聚合统计（@since v3.26，task_050，派发推荐的数据源）。 */
    loadTaskStats: () => Promise<{ ok: boolean; rows?: PersistedTaskStatRow[]; error?: string }>;
    /** upsert 一条流水线编排态（@since v3.27，task_051，落 pipelines 表）。 */
    savePipeline: (record: PersistedPipelineRecord) => Promise<{ ok: boolean; error?: string }>;
    /** 插入一条 agent 健康事件（@since v3.30，task_054，落 agent_health_events 表）。 */
    saveHealthEvent: (insert: AgentHealthEventInsert) => Promise<{ ok: boolean; error?: string }>;
  };

  /**
   * 角色对话 CLI transport（@since v3.14，task_035）：子进程只在主进程跑，
   * 事件经 chat:event 逐条推回，结束补一条 end 信封（形状见 chat-transport-bridge.ts）。
   */
  cliChat: CliChatIpcApi;

  /**
   * 开发期开关透传（@since v3.9，task_026）。
   * why 只透传白名单里的开关：process.env 整个交给渲染层等于把主进程环境（含凭据）暴露出去。
   */
  env: {
    /** 首启向导强制触发（'1' = 每次启动都触发）。 */
    STRATIX_ONBOARDING_FORCE: string | null;
  };

}

const electronAPI: ElectronAPI = {
  // 通用服务调用
  invoke: ipcRenderer.invoke.bind(ipcRenderer),

  // Dialog
  dialog: {
    openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  },

  // Tailscale
  tailscale: {
    getStatus: () => ipcRenderer.invoke('tailscale:status'),
    discoverNodes: () => ipcRenderer.invoke('tailscale:discover'),
    getNodes: () => ipcRenderer.invoke('tailscale:nodes'),
    getLoginUrl: () => ipcRenderer.invoke('tailscale:loginUrl'),
    login: (authKey) => ipcRenderer.invoke('tailscale:login', authKey),
    isRunning: () => ipcRenderer.invoke('tailscale:isRunning'),
    needsAuth: () => ipcRenderer.invoke('tailscale:needsAuth'),
    connectNode: (nodeId) => ipcRenderer.invoke('tailscale:connectNode', nodeId),
    onEvent: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
      ipcRenderer.on('tailscale:event', handler);
      return () => ipcRenderer.off('tailscale:event', handler);
    },
  },
  
  // OpenClaw
  openclaw: {
    connectDirect: (endpoint, config) => ipcRenderer.invoke('openclaw:connect', endpoint, config),
    disconnectDirect: () => ipcRenderer.invoke('openclaw:disconnect'),
    sendMessage: (message, sessionId) => ipcRenderer.invoke('openclaw:sendMessage', { message, sessionId }),
  },
  
  // Custom Providers
  config: {
    saveCustomProviders: (configJson) => ipcRenderer.invoke('config:saveCustomProviders', configJson),
    loadCustomProviders: () => ipcRenderer.invoke('config:loadCustomProviders'),
  },
  
  // API Keys (encrypted)
  apiKey: {
    save: (providerId, apiKey) => ipcRenderer.invoke('apikey:save', providerId, apiKey),
    load: (providerId) => ipcRenderer.invoke('apikey:load', providerId),
    delete: (providerId) => ipcRenderer.invoke('apikey:delete', providerId),
    list: () => ipcRenderer.invoke('apikey:list'),
  },

  // Agent Platform - Workflow
  workflow: {
    list: () => ipcRenderer.invoke('workflow:list'),
    load: (id) => ipcRenderer.invoke('workflow:load', id),
    save: (id, workflow) => ipcRenderer.invoke('workflow:save', id, workflow),
    delete: (id) => ipcRenderer.invoke('workflow:delete', id),
    presets: () => ipcRenderer.invoke('workflow:presets'),
    presetLoad: (presetId) => ipcRenderer.invoke('workflow:presetLoad', presetId),
  },

  // Agent Platform - Providers
  provider: {
    list: () => ipcRenderer.invoke('provider:list'),
    models: (providerId) => ipcRenderer.invoke('provider:models', providerId),
    test: (providerId, model, apiKey) => ipcRenderer.invoke('provider:test', providerId, model, apiKey),
    create: (instanceId, providerId, model, apiKey, options) =>
      ipcRenderer.invoke('provider:create', instanceId, providerId, model, apiKey, options),
  },

  // Agent Platform - Execution
  execution: {
    start: (workflowId, workflow, input) => ipcRenderer.invoke('execution:start', workflowId, workflow, input),
    status: (executionId) => ipcRenderer.invoke('execution:status', executionId),
    list: () => ipcRenderer.invoke('execution:list'),
    clear: (executionId) => ipcRenderer.invoke('execution:clear', executionId),
  },

  // Texture
  texture: {
    upload: (characterId, imageData, filename) =>
      ipcRenderer.invoke('texture:upload', { characterId, imageData, filename }),
    check: (filePath) => ipcRenderer.invoke('texture:check', filePath),
    delete: (filePath) => ipcRenderer.invoke('texture:delete', filePath),
  },

  // 本地 CLI agent 检测（@since v3.8，task_022）；健康周期探测（@since v3.30，task_054）。
  agentDetection: {
    snapshot: () => ipcRenderer.invoke('agent:detected:snapshot'),
    onUpdate: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, agents: DetectedAgent[]) => callback(agents);
      ipcRenderer.on('agent:detected:update', handler);
      return () => ipcRenderer.off('agent:detected:update', handler);
    },
    probe: () => ipcRenderer.invoke('agent:detected:probe'),
  },

  // 游戏存档（@since v3.12，task_033）：透传到主进程的 DAO（game:loadSnapshot / game:save*）。
  // 对话历史两条（@since v3.15，task_036）同走 game: 前缀：game:saveChatMessage / game:loadChatMessages；
  // 任务记录（@since v3.16，task_037）game:saveTask / game:loadTasks；
  // 统计聚合（@since v3.26，task_050）：game:taskStats；
  // 流水线编排态（@since v3.27，task_051）：game:savePipeline（站任务的 pipeline_id 归属
  // 复用 game:saveTask 多带一列，不另开面）；
  // agent 健康事件（@since v3.30，task_054）：game:saveHealthEvent + 周期探测 agent:detected:probe。
  gameSave: {
    loadSnapshot: () => ipcRenderer.invoke('game:loadSnapshot'),
    saveCharacters: (records: PersistedCharacterRecord[]) => ipcRenderer.invoke('game:saveCharacters', records),
    saveUnitPositions: (entries: PersistedUnitPosition[]) => ipcRenderer.invoke('game:saveUnitPositions', entries),
    saveChatMessage: (message: ChatMessageInsert) => ipcRenderer.invoke('game:saveChatMessage', message),
    loadChatMessages: (characterId: string, limit?: number) => ipcRenderer.invoke('game:loadChatMessages', characterId, limit),
    saveTask: (record: PersistedTaskRecord) => ipcRenderer.invoke('game:saveTask', record),
    loadTasks: (characterId: string, limit?: number) => ipcRenderer.invoke('game:loadTasks', characterId, limit),
    loadTaskStats: () => ipcRenderer.invoke('game:taskStats'),
    savePipeline: (record: PersistedPipelineRecord) => ipcRenderer.invoke('game:savePipeline', record),
    saveHealthEvent: (insert: AgentHealthEventInsert) => ipcRenderer.invoke('game:saveHealthEvent', insert),
  },

  /**
   * 角色对话 CLI transport（task_035）：
   *   run —— 发起一轮（事件按 runId 过滤后回调；end 信封到达即自摘监听，不泄漏）；
   *   abort —— 按 runId 中断（主进程 killTree）。
   */
  cliChat: {
    run: (request: CliChatRunRequest, onEvent: (envelope: CliChatEventEnvelope) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, envelope: CliChatEventEnvelope): void => {
        if (envelope?.runId !== request.runId) return;
        onEvent(envelope);
        if (envelope.end) ipcRenderer.off('chat:event', handler);
      };
      ipcRenderer.on('chat:event', handler);
      return ipcRenderer.invoke('chat:run', request).then((result) => {
        // 被拒（校验失败 / runId 冲突）：不会再有任何事件，立刻摘监听。
        if (!result?.ok) ipcRenderer.off('chat:event', handler);
        return result as { ok: boolean; error?: string };
      });
    },
    abort: (runId: string) => ipcRenderer.invoke('chat:abort', runId) as Promise<{ ok: boolean }>,
  },

  // 开发期开关透传（@since v3.9，task_026）：只给白名单里的开关。
  env: {
    STRATIX_ONBOARDING_FORCE: process.env.STRATIX_ONBOARDING_FORCE ?? null,
  },

};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
