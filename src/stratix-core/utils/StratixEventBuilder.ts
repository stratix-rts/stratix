/**
 * Stratix 事件构建器
 * 
 * 快速构建符合 Stratix 规范的事件对象
 */

import {
  StratixFrontendOperationEvent,
  StratixStateSyncEvent,
  StratixCommandData,
  StratixFrontendEventType,
  StratixStateSyncEventType,
  AgentStatusInfo,
} from '../stratix-protocol';
import StratixIdGenerator from './StratixIdGenerator';

export class StratixEventBuilder {
  private static instance: StratixEventBuilder;
  private idGenerator: StratixIdGenerator;

  private constructor() {
    this.idGenerator = StratixIdGenerator.getInstance();
  }

  public static getInstance(): StratixEventBuilder {
    if (!StratixEventBuilder.instance) {
      StratixEventBuilder.instance = new StratixEventBuilder();
    }
    return StratixEventBuilder.instance;
  }

  /**
   * 构建 Agent 选中事件
   * @param agentIds 选中的 Agent ID 列表
   */
  public buildAgentSelectEvent(agentIds: string[]): StratixFrontendOperationEvent {
    return {
      eventType: 'stratix:agent_select',
      payload: { agentIds },
      timestamp: Date.now(),
      requestId: this.idGenerator.generateRequestId(),
    };
  }

  /**
   * 构建 Agent 取消选中事件
   * @param agentIds 取消选中的 Agent ID 列表
   */
  public buildAgentDeselectEvent(agentIds: string[]): StratixFrontendOperationEvent {
    return {
      eventType: 'stratix:agent_deselect',
      payload: { agentIds },
      timestamp: Date.now(),
      requestId: this.idGenerator.generateRequestId(),
    };
  }

  /**
   * 构建指令执行事件
   * @param command 指令数据
   */
  public buildCommandExecuteEvent(command: StratixCommandData): StratixFrontendOperationEvent {
    return {
      eventType: 'stratix:command_execute',
      payload: { command },
      timestamp: Date.now(),
      requestId: this.idGenerator.generateRequestId(),
    };
  }

  /**
   * 构建指令取消事件
   * @param commandId 指令 ID
   */
  public buildCommandCancelEvent(commandId: string): StratixFrontendOperationEvent {
    return {
      eventType: 'stratix:command_cancel',
      payload: { commandId },
      timestamp: Date.now(),
      requestId: this.idGenerator.generateRequestId(),
    };
  }

  /**
   * 构建 Agent 状态更新事件
   * @param agentId Agent ID
   * @param status 状态
   */
  public buildAgentStatusUpdateEvent(
    agentId: string,
    status: AgentStatusInfo
  ): StratixStateSyncEvent {
    return {
      eventType: 'stratix:agent_status_update',
      payload: { agentId, status },
      timestamp: Date.now(),
      requestId: this.idGenerator.generateRequestId(),
    };
  }

  /**
   * 构建指令状态更新事件
   * @param commandId 指令 ID
   * @param commandStatus 指令状态
   * @param agentId 可选，关联的 Agent ID
   */
  public buildCommandStatusUpdateEvent(
    commandId: string,
    commandStatus: 'pending' | 'running' | 'success' | 'failed',
    agentId?: string
  ): StratixStateSyncEvent {
    return {
      eventType: 'stratix:command_status_update',
      payload: { commandId, commandStatus, agentId },
      timestamp: Date.now(),
      requestId: this.idGenerator.generateRequestId(),
    };
  }

  /**
   * 构建 Agent 创建事件
   * @param agentId Agent ID
   * @param data Agent 配置数据
   */
  public buildAgentCreateEvent(agentId: string, data: any): StratixStateSyncEvent {
    return {
      eventType: 'stratix:agent_create',
      payload: { agentId, data },
      timestamp: Date.now(),
      requestId: this.idGenerator.generateRequestId(),
    };
  }

  /**
   * 构建配置更新事件
   * @param agentId Agent ID
   * @param data 更新的配置数据
   */
  public buildConfigUpdatedEvent(agentId: string, data: any): StratixStateSyncEvent {
    return {
      eventType: 'stratix:config_updated',
      payload: { agentId, data },
      timestamp: Date.now(),
      requestId: this.idGenerator.generateRequestId(),
    };
  }

  /**
   * 构建自定义前端操作事件
   * @param eventType 事件类型
   * @param payload 事件负载
   */
  public buildCustomFrontendEvent(
    eventType: StratixFrontendEventType,
    payload: StratixFrontendOperationEvent['payload']
  ): StratixFrontendOperationEvent {
    return {
      eventType,
      payload,
      timestamp: Date.now(),
      requestId: this.idGenerator.generateRequestId(),
    };
  }

  /**
   * 构建自定义状态同步事件
   * @param eventType 事件类型
   * @param payload 事件负载
   */
  public buildCustomStateSyncEvent(
    eventType: StratixStateSyncEventType,
    payload: StratixStateSyncEvent['payload']
  ): StratixStateSyncEvent {
    return {
      eventType,
      payload,
      timestamp: Date.now(),
      requestId: this.idGenerator.generateRequestId(),
    };
  }

  /**
   * 快速构建 CommandData
   * @param skillId 技能 ID
   * @param agentId Agent ID
   * @param params 参数
   */
  public buildCommandData(
    skillId: string,
    agentId: string,
    params: Record<string, any>
  ): StratixCommandData {
    return {
      commandId: this.idGenerator.generateCommandId(),
      skillId,
      agentId,
      params,
      executeAt: Date.now(),
    };
  }
}

export default StratixEventBuilder;
