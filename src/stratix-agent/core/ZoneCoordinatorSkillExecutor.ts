import { SkillExecutor, SkillDefinition, ExecutionContext } from '../types';
import {
  taskFlowRepository,
  auditLogRepository,
  agentCapabilityRepository,
} from '../../stratix-database';
import type { TaskFlowAction } from '../../stratix-database';

/**
 * Task delegate parameters (Zone → Agent)
 */
export interface TaskDelegateParams {
  taskId: string;
  taskTitle: string;
  taskDescription: string;
  taskType: 'coding' | 'writing' | 'analysis' | 'research' | 'general';
  priority: 1 | 2 | 3 | 4 | 5;
  deadline?: number;
  outputPath?: string;
  context?: {
    files?: string[];
    references?: string[];
    previousTaskId?: string;
  };
  requireUserConfirm?: boolean;
}

/**
 * Task cancel parameters (Zone → Agent)
 */
export interface TaskCancelParams {
  taskId: string;
  reason: string;
}

/**
 * Context update parameters (Zone → Agent)
 */
export interface ContextUpdateParams {
  contextDelta: Record<string, any>;
}

/**
 * ZoneCoordinatorSkillExecutor - Handles Zone → Agent skills
 *
 * This executor is invoked by the Zone Coordinator to interact with Agents.
 * Skills handled:
 * - task_delegate: Zone assigns a task to an Agent
 * - task_cancel: Zone cancels a task
 * - context_update: Zone updates Agent context
 * - capability_query: Zone queries Agent capabilities
 */
export class ZoneCoordinatorSkillExecutor implements SkillExecutor {
  async execute(
    skill: SkillDefinition,
    params: Record<string, any>,
    context: ExecutionContext
  ): Promise<any> {
    const { agentId } = context;
    const gatewayUrl = process.env.GATEWAY_URL || 'http://127.0.0.1:7524';

    switch (skill.skillId) {
      case 'task_delegate': {
        const {
          taskId,
          taskTitle,
          taskDescription,
          taskType,
          priority,
          deadline,
          context: taskContext,
        } = params as TaskDelegateParams;

        if (!taskId || !taskTitle || !taskType || !priority) {
          throw new Error('task_delegate requires: taskId, taskTitle, taskType, priority');
        }

        // Get zoneId from context.variables or params
        const zoneId = params.zoneId || context.variables?.zoneId;
        if (!zoneId) {
          throw new Error('zoneId is required for task_delegate (pass as param or set context.variables.zoneId)');
        }

        // Record task_flow (started - Zone initiated the delegation)
        const flowRecord = taskFlowRepository.addFlow(
          taskId,
          zoneId,
          null, // fromAgentId: null means Zone created
          agentId,
          'delegated',
          {
            reason: `Delegated to agent ${agentId}`,
            output: taskDescription,
          }
        );

        // Record audit_log (task_assigned)
        auditLogRepository.log(
          zoneId,
          'task_assigned',
          undefined, // actor is Zone Coordinator
          agentId,
          { taskId, taskTitle, taskType, priority, deadline }
        );

        // Increment agent's load
        agentCapabilityRepository.incrementLoad(agentId, zoneId);

        return {
          success: true,
          taskId,
          taskTitle,
          taskDescription,
          taskType,
          priority,
          deadline,
          zoneId,
          assignedTo: agentId,
          flowId: flowRecord.flowId,
          context: taskContext,
        };
      }

      case 'task_cancel': {
        const { taskId, reason } = params as TaskCancelParams;

        if (!taskId || !reason) {
          throw new Error('task_cancel requires: taskId, reason');
        }

        const zoneId = params.zoneId || context.variables?.zoneId;
        if (!zoneId) {
          throw new Error('zoneId is required for task_cancel (pass as param or set context.variables.zoneId)');
        }

        // Get the task flow to find the assignee
        const latestFlow = taskFlowRepository.getLatestFlow(taskId);
        const assigneeId = latestFlow?.toAgentId || agentId;

        // Record task_flow (cancelled)
        taskFlowRepository.addFlow(
          taskId,
          zoneId,
          null, // fromAgentId: Zone cancelled
          assigneeId,
          'cancelled',
          { reason }
        );

        // Record audit_log
        auditLogRepository.log(
          zoneId,
          'task_failed', // Using task_failed as cancellation event
          undefined,
          taskId,
          { reason, action: 'cancelled' }
        );

        // Decrement agent's load if it was assigned
        if (assigneeId) {
          agentCapabilityRepository.decrementLoad(assigneeId, zoneId);
        }

        return {
          success: true,
          taskId,
          reason,
          cancelledAt: Date.now(),
        };
      }

      case 'context_update': {
        const { contextDelta } = params as ContextUpdateParams;

        if (!contextDelta || typeof contextDelta !== 'object') {
          throw new Error('context_update requires: contextDelta (object)');
        }

        const zoneId = params.zoneId || context.variables?.zoneId;
        if (!zoneId) {
          throw new Error('zoneId is required for context_update (pass as param or set context.variables.zoneId)');
        }

        // Record audit_log (context_shared)
        auditLogRepository.log(
          zoneId,
          'context_shared',
          undefined, // actor is Zone Coordinator
          agentId,
          { contextDelta }
        );

        // Return the context delta for the agent to incorporate
        return {
          success: true,
          contextDelta,
          updatedAt: Date.now(),
          message: `Context updated with ${Object.keys(contextDelta).length} changes`,
        };
      }

      case 'capability_query': {
        const zoneId = params.zoneId || context.variables?.zoneId;
        if (!zoneId) {
          throw new Error('zoneId is required for capability_query (pass as param or set context.variables.zoneId)');
        }

        // Get agent's capabilities from repository
        const capabilities = agentCapabilityRepository.getCapabilities(agentId, zoneId);

        if (capabilities.length === 0) {
          return {
            success: true,
            agentId,
            zoneId,
            capabilities: [],
            message: 'No capabilities registered for this agent in this zone',
          };
        }

        return {
          success: true,
          agentId,
          zoneId,
          capabilities: capabilities.map(cap => ({
            capability: cap.capability,
            level: cap.level,
            currentLoad: cap.currentLoad,
          })),
        };
      }

      default:
        throw new Error(`Unknown zone coordinator skill: ${skill.skillId}`);
    }
  }
}
