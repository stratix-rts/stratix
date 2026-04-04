/**
 * ZoneAgentSkills - Agent → Zone skill functions
 *
 * These are helper functions that Agents call directly (not via SkillExecutor)
 * to communicate back to the Zone Coordinator.
 *
 * Functions:
 * - taskClaim: Agent claims a task
 * - taskProgress: Agent reports progress
 * - taskComplete: Agent completes a task
 * - taskIssue: Agent reports an issue
 * - capabilityUpdate: Agent updates its capabilities
 */

import {
  taskFlowRepository,
  auditLogRepository,
  agentCapabilityRepository,
  type Capability,
} from '../../stratix-database';
import type { TaskCompleteParams } from '../../stratix-orchestration/zone/ZoneCoordinator';

const gatewayUrl = process.env.GATEWAY_URL || 'http://127.0.0.1:7524';

/**
 * Task claim parameters
 */
export interface TaskClaimParams {
  taskId: string;
  capability: Capability;
}

/**
 * Task progress parameters
 */
export interface TaskProgressParams {
  taskId: string;
  progress: number; // 0-100
  status: 'in_progress' | 'blocked' | 'waiting';
  message?: string;
  currentStep?: string;
}

/**
 * Task issue parameters
 */
export interface TaskIssueParams {
  taskId: string;
  issue: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  suggestedFix?: string;
}

/**
 * Capability update parameters
 */
export interface CapabilityUpdateParams {
  capabilities: Array<{
    capability: Capability;
    level: 1 | 2 | 3 | 4 | 5;
  }>;
}

/**
 * Result type for skill operations
 */
export interface ZoneSkillResult {
  success: boolean;
  error?: string;
  [key: string]: any;
}

/**
 * TaskClaim - Agent claims a task
 *
 * Called when an Agent autonomously claims a task from a Zone.
 * Records:
 * - task_flow (claimed)
 * - audit_log (task_claimed)
 */
export async function taskClaim(
  agentId: string,
  zoneId: string,
  taskId: string,
  capability: Capability
): Promise<ZoneSkillResult> {
  try {
    // Validate inputs
    if (!agentId || !zoneId || !taskId || !capability) {
      throw new Error('taskClaim requires: agentId, zoneId, taskId, capability');
    }

    // Record task_flow (claimed)
    const flowRecord = taskFlowRepository.addFlow(
      taskId,
      zoneId,
      null, // fromAgentId: null for self-claim
      agentId,
      'claimed',
      { reason: `Claimed by agent ${agentId} with capability ${capability}` }
    );

    // Record audit_log (task_claimed)
    auditLogRepository.log(
      zoneId,
      'task_claimed',
      agentId,
      taskId,
      { capability }
    );

    return {
      success: true,
      taskId,
      agentId,
      zoneId,
      flowId: flowRecord.flowId,
      claimedAt: Date.now(),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * TaskProgress - Agent reports progress on a task
 *
 * Called periodically by an Agent to report task progress.
 * Records:
 * - audit_log (task_started if status=in_progress for first time)
 */
export async function taskProgress(
  agentId: string,
  zoneId: string,
  taskId: string,
  progress: number,
  status: 'in_progress' | 'blocked' | 'waiting',
  message?: string,
  currentStep?: string
): Promise<ZoneSkillResult> {
  try {
    // Validate inputs
    if (!agentId || !zoneId || !taskId) {
      throw new Error('taskProgress requires: agentId, zoneId, taskId');
    }

    if (progress < 0 || progress > 100) {
      throw new Error('progress must be between 0 and 100');
    }

    // Get latest flow to check if this is first start
    const latestFlow = taskFlowRepository.getLatestFlow(taskId);
    const isFirstStart = latestFlow?.action !== 'started' && status === 'in_progress';

    // Record audit_log (task_started if first time going to in_progress)
    if (isFirstStart) {
      auditLogRepository.log(
        zoneId,
        'task_started',
        agentId,
        taskId,
        { progress, status, message, currentStep }
      );

      // Also record task_flow for start
      taskFlowRepository.addFlow(
        taskId,
        zoneId,
        agentId,
        agentId,
        'started',
        { reason: message, output: currentStep }
      );
    } else {
      // Just log progress as audit
      auditLogRepository.log(
        zoneId,
        'task_started', // Using task_started as generic progress event
        agentId,
        taskId,
        { progress, status, message, currentStep, isProgressUpdate: !isFirstStart }
      );
    }

    return {
      success: true,
      taskId,
      agentId,
      zoneId,
      progress,
      status,
      message,
      currentStep,
      reportedAt: Date.now(),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * TaskComplete - Agent completes a task
 *
 * Called when an Agent finishes a task (success or failure).
 * Records:
 * - task_flow (completed/failed)
 * - audit_log (task_completed/task_failed)
 * - Decrements agent's load
 */
export async function taskComplete(
  agentId: string,
  zoneId: string,
  report: TaskCompleteParams
): Promise<ZoneSkillResult> {
  try {
    // Validate inputs
    if (!agentId || !zoneId || !report.taskId) {
      throw new Error('taskComplete requires: agentId, zoneId, report.taskId');
    }

    const { taskId, success, output, files, summary, issues, duration } = report;
    const action: TaskFlowAction = success ? 'completed' : 'failed';

    // Record task_flow (completed/failed)
    const flowRecord = taskFlowRepository.addFlow(
      taskId,
      zoneId,
      agentId,
      agentId,
      action,
      { output, files, issues, duration }
    );

    // Record audit_log
    const eventType = success ? 'task_completed' : 'task_failed';
    auditLogRepository.log(
      zoneId,
      eventType,
      agentId,
      taskId,
      { success, output, files, summary, issues, duration }
    );

    // Decrement agent's load only if task was delegated
    // If task was only claimed (via taskClaim), no incrementLoad was called, so don't decrement
    const wasDelegated = taskFlowRepository.getTaskFlowHistory(taskId)
      .some(flow => flow.action === 'delegated');
    if (wasDelegated) {
      agentCapabilityRepository.decrementLoad(agentId, zoneId);
    }

    // Notify Zone Coordinator via API if available
    try {
      await fetch(`${gatewayUrl}/api/zones/${zoneId}/tasks/${taskId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId,
          success,
          output,
          files,
          summary,
          issues,
          duration,
        }),
      });
    } catch (apiError) {
      // Non-fatal: log but don't fail the operation
      console.warn(`[ZoneAgentSkills] Failed to notify Zone Coordinator: ${apiError}`);
    }

    return {
      success: true,
      taskId,
      agentId,
      zoneId,
      flowId: flowRecord.flowId,
      completedAt: Date.now(),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * TaskIssue - Agent reports a problem with a task
 *
 * Called when an Agent encounters an issue it cannot resolve.
 * Records:
 * - audit_log (task_failed)
 */
export async function taskIssue(
  agentId: string,
  zoneId: string,
  taskId: string,
  issue: string,
  severity: 'low' | 'medium' | 'high' | 'critical',
  suggestedFix?: string
): Promise<ZoneSkillResult> {
  try {
    // Validate inputs
    if (!agentId || !zoneId || !taskId || !issue) {
      throw new Error('taskIssue requires: agentId, zoneId, taskId, issue');
    }

    // Record audit_log (task_failed with issue details)
    auditLogRepository.log(
      zoneId,
      'task_failed',
      agentId,
      taskId,
      { issue, severity, suggestedFix, isIssueReport: true }
    );

    // Record task_flow (failed)
    taskFlowRepository.addFlow(
      taskId,
      zoneId,
      agentId,
      agentId,
      'failed',
      { issues: [issue] }
    );

    // Decrement agent's load only if task was delegated
    // If task was only claimed (via taskClaim), no incrementLoad was called, so don't decrement
    const wasDelegated = taskFlowRepository.getTaskFlowHistory(taskId)
      .some(flow => flow.action === 'delegated');
    if (wasDelegated) {
      agentCapabilityRepository.decrementLoad(agentId, zoneId);
    }

    return {
      success: true,
      taskId,
      agentId,
      zoneId,
      issue,
      severity,
      suggestedFix,
      reportedAt: Date.now(),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * CapabilityUpdate - Agent updates its capabilities
 *
 * Called when an Agent wants to update its registered capabilities in a Zone.
 * Records:
 * - agentCapabilityRepository.setCapability for each capability
 * - audit_log (skill_executed)
 */
export async function capabilityUpdate(
  agentId: string,
  zoneId: string,
  capabilities: Array<{ capability: Capability; level: 1 | 2 | 3 | 4 | 5 }>
): Promise<ZoneSkillResult> {
  try {
    // Validate inputs
    if (!agentId || !zoneId || !capabilities || capabilities.length === 0) {
      throw new Error('capabilityUpdate requires: agentId, zoneId, capabilities (non-empty array)');
    }

    // Update each capability
    const updatedCapabilities = [];
    for (const cap of capabilities) {
      const result = agentCapabilityRepository.setCapability(
        agentId,
        zoneId,
        cap.capability,
        cap.level
      );
      updatedCapabilities.push({
        capability: result.capability,
        level: result.level,
      });
    }

    // Record audit_log
    auditLogRepository.log(
      zoneId,
      'skill_executed',
      agentId,
      agentId, // target is self (capability update affects own capabilities)
      { skillId: 'capability_update', capabilities: updatedCapabilities }
    );

    return {
      success: true,
      agentId,
      zoneId,
      capabilities: updatedCapabilities,
      updatedAt: Date.now(),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Re-export TaskFlowAction for internal use
type TaskFlowAction = 'created' | 'delegated' | 'claimed' | 'started' | 'completed' | 'failed' | 'cancelled';
