/**
 * Stratix MCP Server — 嵌入 Gateway 模式（Plan C）
 *
 * 让任何"随身 Agent"（OpenClaw、Claude Code 等）通过 MCP 协议成为调度者。
 * 暴露 5 个核心 tools：
 *   1. list_zones          — 列出所有 Zone
 *   2. create_zone         — 创建 Zone
 *   3. submit_requirement  — 提交需求（核心链路）
 *   4. get_zone_status     — 查询执行状态
 *   5. list_agents         — 列出可用 Agent
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import { Router, Request, Response } from 'express';

import { zoneRepository } from '../stratix-database/ZoneRepository';
import { zoneMemberRepository } from '../stratix-database/ZoneMemberRepository';
import { agentCapabilityRepository } from '../stratix-database/AgentCapabilityRepository';
import { zoneRepository as projectRepository } from '../stratix-database/ZoneRepository';
import { ZoneCoordinator } from '../stratix-orchestration/zone/ZoneCoordinator';
import type { Capability } from '../stratix-database/AgentCapabilityRepository';
import { TaskQueueService } from '../stratix-orchestration/task-queue/TaskQueueService';
import { auditLogRepository } from '../stratix-database/AuditLogRepository';
import { taskFlowRepository } from '../stratix-database/TaskFlowRepository';
import { getDatabase } from '../stratix-database/StratixDatabase';
import { readdirSync, statSync } from 'fs';
import path from 'path';

// ============================================================
// MCP Server 定义
// ============================================================

const mcpServer = new McpServer({
  name: 'stratix',
  version: '0.1.0',
});

// ============================================================
// Unified response helpers
// ============================================================

function textResponse(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function jsonResponse(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function logMcp(level: 'info' | 'warning' | 'error', data: unknown) {
  mcpServer.sendLoggingMessage({ level, logger: 'stratix-mcp', data }).catch(() => {
    // Silently ignore if not connected
  });
}

// ============================================================
// Zone validation helper
// ============================================================

function validateZone(zoneId: string): { valid: false; response: { content: { type: 'text'; text: string }[] } } | { valid: true } {
  const zone = zoneRepository.getZone(zoneId);
  if (!zone) {
    return { valid: false, response: textResponse(`Error: Zone ${zoneId} not found.`) };
  }
  return { valid: true };
}

// Type guard for validateZone result
function isInvalidZone(v: ReturnType<typeof validateZone>): v is { valid: false; response: { content: { type: 'text'; text: string }[] } } {
  return !v.valid;
}

// ============================================================
// ZoneCoordinator cache with TTL cleanup
// ============================================================

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface CachedCoordinator {
  coordinator: ZoneCoordinator;
  lastAccessed: number;
}

const coordinatorCache = new Map<string, CachedCoordinator>();

async function getCoordinator(zoneId: string): Promise<ZoneCoordinator> {
  const cached = coordinatorCache.get(zoneId);
  if (cached && Date.now() - cached.lastAccessed < CACHE_TTL_MS) {
    cached.lastAccessed = Date.now();
    logMcp('info', `Coordinator cache hit for zone ${zoneId}`);
    return cached.coordinator;
  }

  if (cached) {
    coordinatorCache.delete(zoneId);
  }

  const coordinator = await ZoneCoordinator.create(zoneId, {
    autoDecompose: true,
    autoAssign: true,
    requireUserConfirm: false,
    assignStrategy: 'capability_match',
  });
  coordinatorCache.set(zoneId, { coordinator, lastAccessed: Date.now() });
  logMcp('info', `Coordinator created for zone ${zoneId}`);
  return coordinator;
}

// Periodic cleanup of expired cache entries
setInterval(() => {
  const now = Date.now();
  for (const [zoneId, cached] of coordinatorCache.entries()) {
    if (now - cached.lastAccessed > CACHE_TTL_MS) {
      coordinatorCache.delete(zoneId);
    }
  }
}, 5 * 60 * 1000);

const VALID_CAPABILITIES: Capability[] = ['coding', 'writing', 'analysis', 'research', 'general'];

function toValidCapability(cap: string): Capability | null {
  if (VALID_CAPABILITIES.includes(cap as Capability)) {
    return cap as Capability;
  }
  return null;
}

function getDefaultProjectId(): string | null {
  const projects = projectRepository.getAllProjects();
  return projects.length > 0 ? projects[0].id : null;
}

// ============================================================
// Tool 1: list_zones
// ============================================================

mcpServer.tool(
  'list_zones',
  'List all zones in the default project. Returns zone id, title, status, and member count.',
  {},
  async () => {
    const zoneId = getDefaultProjectId();
    if (!zoneId) {
      return { content: [{ type: 'text' as const, text: 'No projects found. Create a project first.' }] };
    }

    const zones = zoneRepository.getZonesByProject(zoneId);
    const result = zones.map(z => {
      const members = zoneMemberRepository.getMembers(z.id);
      return {
        id: z.id,
        title: z.title,
        status: z.status || 'idle',
        memberCount: members.length,
        path: z.path || null,
        createdAt: z.createdAt,
      };
    });

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(result, null, 2),
      }],
    };
  }
);

// ============================================================
// Tool 2: create_zone
// ============================================================

mcpServer.tool(
  'create_zone',
  'Create a new Zone in the default project. A Zone is a workspace where agents collaborate on tasks.',
  {
    title: z.string().describe('Zone title / objective'),
    prompt: z.string().optional().describe('Detailed description or instructions for the Zone'),
  },
  async ({ title, prompt }) => {
    const zoneId = getDefaultProjectId();
    if (!zoneId) {
      return { content: [{ type: 'text' as const, text: 'Error: No default project found.' }] };
    }

    const zone = zoneRepository.createZone(zoneId, title, prompt || '');

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          id: zone.id,
          title: zone.title,
          path: zone.path,
          message: `Zone "${title}" created. Agents can now be added and requirements submitted.`,
        }, null, 2),
      }],
    };
  }
);

// ============================================================
// Tool 3: submit_requirement（核心链路）
// ============================================================

mcpServer.tool(
  'submit_requirement',
  'Submit a requirement to a Zone. The ZoneCoordinator will decompose it into tasks, match agents by capability, and assign work. This is the primary action for orchestrating agent work.',
  {
    zoneId: z.string().describe('The Zone ID to submit the requirement to'),
    requirement: z.string().describe('The requirement or task description in natural language'),
  },
  async ({ zoneId, requirement }) => {
    const validation = validateZone(zoneId);
    if (isInvalidZone(validation)) {
      return validation.response;
    }

    try {
      const coordinator = await getCoordinator(zoneId);
      const result = await coordinator.processRequirement(requirement);

      logMcp('info', `Requirement submitted to zone ${zoneId}: ${result.tasks.length} tasks created`);

      if (result.delegated.length > 0) {
        logMcp('info', `Tasks assigned in zone ${zoneId}: ${result.delegated.length} delegated`);
      }

      const summary = {
        success: result.success,
        taskCount: result.tasks.length,
        delegated: result.delegated.length,
        pending: result.pending.length,
        tasks: result.tasks.map(t => ({
          id: t.id,
          title: t.title,
          type: t.type,
          assignee: t.assigneeId || 'unassigned',
          status: t.status,
        })),
      };

      return jsonResponse(summary);
    } catch (error) {
      logMcp('error', `Requirement submission failed for zone ${zoneId}: ${error instanceof Error ? error.message : String(error)}`);
      return textResponse(`Error processing requirement: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
);

// ============================================================
// Tool 4: get_zone_status
// ============================================================

mcpServer.tool(
  'get_zone_status',
  'Get the current status of a Zone including task progress, active agents, and recent activity.',
  {
    zoneId: z.string().describe('The Zone ID to check'),
  },
  async ({ zoneId }) => {
    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      return textResponse(`Error: Zone ${zoneId} not found.`);
    }

    try {
      const coordinator = await getCoordinator(zoneId);
      const status = coordinator.getStatusSummary();

      return jsonResponse(status);
    } catch (error) {
      // Coordinator might not exist yet
      const members = zoneMemberRepository.getMembers(zoneId);
      return jsonResponse({
        zoneId,
        title: zone.title,
        memberCount: members.length,
        message: 'Zone exists but no coordinator activity yet. Submit a requirement to activate.',
      });
    }
  }
);

// ============================================================
// Tool 5: list_agents
// ============================================================

mcpServer.tool(
  'list_agents',
  'List agents available in a Zone with their capabilities. If no zoneId provided, lists all agents across all zones.',
  {
    zoneId: z.string().optional().describe('Optional Zone ID to filter agents'),
  },
  async ({ zoneId }) => {
    if (zoneId) {
      const members = zoneMemberRepository.getMembers(zoneId);
      const agents = members.map(m => {
        const caps = agentCapabilityRepository.getCapabilities(m.agentId, zoneId);
        return {
          agentId: m.agentId,
          role: m.role,
          capabilities: caps.map(c => ({ name: c.capability, level: c.level })),
        };
      });
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(agents, null, 2),
        }],
      };
    }

    // List all zones' members
    const defaultZoneId = getDefaultProjectId();
    if (!defaultZoneId) {
      return { content: [{ type: 'text' as const, text: 'No projects found.' }] };}

    const zones = zoneRepository.getZonesByProject(defaultZoneId);
    const allAgents: any[] = [];
    for (const z of zones) {
      const members = zoneMemberRepository.getMembers(z.id);
      for (const m of members) {
        const caps = agentCapabilityRepository.getCapabilities(m.agentId, z.id);
        allAgents.push({
          agentId: m.agentId,
          zoneId: z.id,
          zoneTitle: z.title,
          role: m.role,
          capabilities: caps.map(c => ({ name: c.capability, level: c.level })),
        });
      }
    }

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(allAgents, null, 2),
      }],
    };
  }
);

// ============================================================
// Tool 6: add_agent_to_zone
// ============================================================

mcpServer.tool(
  'add_agent_to_zone',
  'Add an agent to a Zone with specified capabilities. The agent will be eligible for task assignment.',
  {
    zoneId: z.string().describe('The Zone ID'),
    agentId: z.string().describe('Unique agent identifier'),
    capabilities: z.record(z.string(), z.number().min(1).max(10)).optional().describe('Capability map: { "coding": 5, "writing": 3 }'),
  },
  async ({ zoneId, agentId, capabilities }) => {
    const validation = validateZone(zoneId);
    if (isInvalidZone(validation)) {
      return validation.response;
    }

    // Add member to zone (both tables)
    zoneRepository.addMember(zoneId, agentId);

    // Register capabilities
    if (capabilities) {
      for (const [cap, level] of Object.entries(capabilities)) {
        const validCap = toValidCapability(cap);
        if (validCap) {
          agentCapabilityRepository.setCapability(agentId, zoneId, validCap, Number(level));
        }
      }
    }

    return jsonResponse({
      success: true,
      agentId,
      zoneId,
      capabilities: capabilities || {},
      message: `Agent ${agentId} added to zone with ${Object.keys(capabilities || {}).length} capabilities.`,
    });
  }
);

// ============================================================
// Tool 7: get_task_detail
// ============================================================

mcpServer.tool(
  'get_task_detail',
  'Get detailed information about a task from the task queue. Returns status, assigned agent, execution result, creation time, and more.',
  {
    taskId: z.string().describe('The task ID to look up'),
  },
  async ({ taskId }) => {
    try {
      const taskQueue = TaskQueueService.getInstance();
      const task = await taskQueue.getTask(taskId);
      if (!task) {
        return textResponse(`Error: Task ${taskId} not found.`);
      }
      return jsonResponse(task);
    } catch (error) {
      logMcp('error', `Failed to get task detail for ${taskId}: ${error instanceof Error ? error.message : String(error)}`);
      return textResponse(`Error retrieving task detail: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
);

// ============================================================
// Tool 8: cancel_task
// ============================================================

mcpServer.tool(
  'cancel_task',
  'Cancel a task by updating its status to cancelled. Records the reason and notifies any assigned agent.',
  {
    taskId: z.string().describe('The task ID to cancel'),
    reason: z.string().optional().describe('Optional reason for cancellation'),
  },
  async ({ taskId, reason }) => {
    try {
      const taskQueue = TaskQueueService.getInstance();
      const task = await taskQueue.getTask(taskId);
      if (!task) {
        return textResponse(`Error: Task ${taskId} not found.`);
      }
      if (task.status === 'cancelled' || task.status === 'completed' || task.status === 'failed') {
        return textResponse(`Error: Task ${taskId} is already in terminal status (${task.status}).`);
      }
      await taskQueue.updateTask(taskId, { status: 'cancelled' });
      taskFlowRepository.addFlow(
        taskId,
        task.zoneId,
        task.assignedAgentId || null,
        task.assignedAgentId || null,
        'cancelled',
        { reason: reason || 'Cancelled by admin' }
      );
      logMcp('info', `Task ${taskId} cancelled. Reason: ${reason || 'No reason provided'}`);
      return jsonResponse({
        success: true,
        taskId,
        status: 'cancelled',
        reason: reason || null,
        message: `Task ${taskId} has been cancelled.`,
      });
    } catch (error) {
      logMcp('error', `Failed to cancel task ${taskId}: ${error instanceof Error ? error.message : String(error)}`);
      return textResponse(`Error cancelling task: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
);

// ============================================================
// Tool 9: reassign_task
// ============================================================

mcpServer.tool(
  'reassign_task',
  'Reassign a task from its current agent to a new agent. Updates assigned_agent_id and records the change in task_flow.',
  {
    taskId: z.string().describe('The task ID to reassign'),
    newAgentId: z.string().describe('The new agent ID to assign the task to'),
  },
  async ({ taskId, newAgentId }) => {
    try {
      const taskQueue = TaskQueueService.getInstance();
      const task = await taskQueue.getTask(taskId);
      if (!task) {
        return textResponse(`Error: Task ${taskId} not found.`);
      }
      const zone = zoneRepository.getZone(task.zoneId);
      if (!zone) {
        return textResponse(`Error: Zone ${task.zoneId} not found.`);
      }
      if (!task.assignedAgentId) {
        return textResponse(`Error: Task ${taskId} has no current assignee.`);
      }
      if (task.assignedAgentId === newAgentId) {
        return textResponse(`Error: New agent ${newAgentId} is already assigned to this task.`);
      }

      const coordinator = await getCoordinator(task.zoneId);
      const result = await coordinator.reassignTask(taskId, newAgentId);

      if (!result.success) {
        return textResponse(`Error reassigning task: ${result.error || 'Unknown error'}`);
      }

      await taskQueue.updateTask(taskId, { assignedAgentId: newAgentId, status: 'assigned' });

      logMcp('info', `Task ${taskId} reassigned from ${task.assignedAgentId} to ${newAgentId}`);
      return jsonResponse({
        success: true,
        taskId,
        previousAgentId: task.assignedAgentId,
        newAgentId,
        message: `Task ${taskId} reassigned from ${task.assignedAgentId} to ${newAgentId}.`,
      });
    } catch (error) {
      logMcp('error', `Failed to reassign task ${taskId}: ${error instanceof Error ? error.message : String(error)}`);
      return textResponse(`Error reassigning task: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
);

// ============================================================
// Tool 10: remove_agent_from_zone
// ============================================================

mcpServer.tool(
  'remove_agent_from_zone',
  'Remove an agent from a Zone. Cleans up zone_members, zone_contexts.members, and capabilities. If the agent has in-progress tasks, the operation is blocked unless tasks are handled first.',
  {
    zoneId: z.string().describe('The Zone ID'),
    agentId: z.string().describe('The agent ID to remove'),
  },
  async ({ zoneId, agentId }) => {
    const validation = validateZone(zoneId);
    if (isInvalidZone(validation)) {
      return validation.response;
    }

    try {
      const db = getDatabase().getDatabase();
      const activeTasks = db.prepare(
        `SELECT task_id FROM tasks WHERE zone_id = ? AND assigned_agent_id = ? AND status IN ('assigned', 'in_progress')`
      ).all(zoneId, agentId) as Array<{ task_id: string }>;

      if (activeTasks.length > 0) {
        return textResponse(
          `Error: Agent ${agentId} has ${activeTasks.length} active task(s) in Zone ${zoneId}. ` +
          `Cancel or reassign these tasks first: ${activeTasks.map(t => t.task_id).join(', ')}`
        );
      }

      zoneRepository.removeMember(zoneId, agentId);
      agentCapabilityRepository.removeCapabilities(agentId, zoneId);

      const cached = coordinatorCache.get(zoneId);
      if (cached) {
        coordinatorCache.delete(zoneId);
      }

      auditLogRepository.log(zoneId, 'agent_left', agentId, undefined, { reason: 'admin_removed' });
      logMcp('info', `Agent ${agentId} removed from zone ${zoneId}`);

      return jsonResponse({
        success: true,
        agentId,
        zoneId,
        message: `Agent ${agentId} removed from Zone ${zoneId}.`,
      });
    } catch (error) {
      logMcp('error', `Failed to remove agent ${agentId} from zone ${zoneId}: ${error instanceof Error ? error.message : String(error)}`);
      return textResponse(`Error removing agent: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
);

// ============================================================
// Tool 11: delete_zone
// ============================================================

mcpServer.tool(
  'delete_zone',
  'Delete a Zone and clean up associated data (members, tasks, capabilities). If force=true, deletes even with active tasks.',
  {
    zoneId: z.string().describe('The Zone ID to delete'),
    force: z.boolean().optional().describe('Force delete even if there are active tasks'),
  },
  async ({ zoneId, force }) => {
    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      return textResponse(`Error: Zone ${zoneId} not found.`);
    }

    try {
      if (!force) {
        const db = getDatabase().getDatabase();
        const activeTasks = db.prepare(
          `SELECT COUNT(*) as count FROM tasks WHERE zone_id = ? AND status IN ('pending', 'assigned', 'in_progress')`
        ).get(zoneId) as { count: number } | undefined;

        if (activeTasks && activeTasks.count > 0) {
          return textResponse(
            `Error: Zone ${zoneId} has ${activeTasks.count} active task(s). ` +
            `Set force=true to delete anyway, or cancel/reassign tasks first.`
          );
        }
      }

      const cached = coordinatorCache.get(zoneId);
      if (cached) {
        coordinatorCache.delete(zoneId);
      }

      const db = getDatabase().getDatabase();
      db.prepare('DELETE FROM zones WHERE zone_id = ?').run(zoneId);
      db.prepare('DELETE FROM zone_contexts WHERE zone_id = ?').run(zoneId);

      logMcp('info', `Zone ${zoneId} deleted${force ? ' (forced)' : ''}`);
      return jsonResponse({
        success: true,
        zoneId,
        force: !!force,
        message: `Zone ${zoneId} has been deleted.`,
      });
    } catch (error) {
      logMcp('error', `Failed to delete zone ${zoneId}: ${error instanceof Error ? error.message : String(error)}`);
      return textResponse(`Error deleting zone: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
);

// ============================================================
// Tool 12: list_zone_files
// ============================================================

mcpServer.tool(
  'list_zone_files',
  'List files in a Zone sandbox directory. Supports browsing subdirectories. Only allows reading within the zone sandbox.',
  {
    zoneId: z.string().describe('The Zone ID'),
    subpath: z.string().optional().describe('Optional subdirectory path relative to the zone sandbox root'),
  },
  async ({ zoneId, subpath }) => {
    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      return textResponse(`Error: Zone ${zoneId} not found.`);
    }

    try {
      const basePath = zone.path || '';
      if (!basePath) {
        return textResponse(`Error: Zone ${zoneId} has no sandbox path configured.`);
      }

      const targetPath = subpath ? path.join(basePath, subpath) : basePath;
      const resolvedBase = path.resolve(basePath);
      const resolvedTarget = path.resolve(targetPath);

      if (!resolvedTarget.startsWith(resolvedBase)) {
        return textResponse(`Error: Access denied. Path ${subpath || ''} is outside the zone sandbox.`);
      }

      const entries = readdirSync(resolvedTarget, { withFileTypes: true });
      const files = entries.map(entry => {
        const stat = statSync(path.join(resolvedTarget, entry.name));
        return {
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
          size: stat.size,
          modifiedAt: stat.mtime.getTime(),
        };
      });

      return jsonResponse({
        zoneId,
        path: resolvedTarget,
        files,
      });
    } catch (error) {
      logMcp('error', `Failed to list files for zone ${zoneId}: ${error instanceof Error ? error.message : String(error)}`);
      return textResponse(`Error listing zone files: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
);

// ============================================================
// Tool 13: create_manual_task
// ============================================================

mcpServer.tool(
  'create_manual_task',
  'Manually create a task in a Zone without requirement decomposition. Directly writes to the tasks table. If assigneeId is provided, the task is immediately assigned; otherwise it remains pending.',
  {
    zoneId: z.string().describe('The Zone ID'),
    title: z.string().describe('Task title'),
    description: z.string().optional().describe('Task description'),
    type: z.enum(['coding', 'writing', 'analysis', 'research', 'general']).optional().describe('Task type'),
    priority: z.number().min(1).max(5).optional().describe('Task priority (1-5, 1 = highest)'),
    assigneeId: z.string().optional().describe('Optional agent ID to assign the task to immediately'),
  },
  async ({ zoneId, title, description, type, priority, assigneeId }) => {
    const validation = validateZone(zoneId);
    if (isInvalidZone(validation)) {
      return validation.response;
    }

    try {
      const coordinator = await getCoordinator(zoneId);
      const task = coordinator.createManualTask({
        title,
        description,
        type: (type || 'general') as 'coding' | 'writing' | 'analysis' | 'research' | 'general',
        priority: (priority || 3) as 1 | 2 | 3 | 4 | 5,
        assigneeId,
      });

      logMcp('info', `Manual task created in zone ${zoneId}: ${task.id}`);
      return jsonResponse({
        success: true,
        taskId: task.id,
        title: task.title,
        type: task.type,
        priority: task.priority,
        status: task.status,
        assigneeId: task.assigneeId || null,
        message: `Task "${title}" created in Zone ${zoneId}.`,
      });
    } catch (error) {
      logMcp('error', `Failed to create manual task in zone ${zoneId}: ${error instanceof Error ? error.message : String(error)}`);
      return textResponse(`Error creating manual task: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
);

// ============================================================
// Tool 14: update_zone
// ============================================================

mcpServer.tool(
  'update_zone',
  'Update Zone configuration including title, description (prompt), and status.',
  {
    zoneId: z.string().describe('The Zone ID'),
    title: z.string().optional().describe('New zone title'),
    prompt: z.string().optional().describe('New zone description/prompt'),
    status: z.enum(['idle', 'active', 'busy', 'completed', 'error']).optional().describe('New zone status'),
  },
  async ({ zoneId, title, prompt, status }) => {
    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      return textResponse(`Error: Zone ${zoneId} not found.`);
    }

    try {
      const updates: { title?: string; prompt?: string } = {};
      if (title !== undefined) updates.title = title;
      if (prompt !== undefined) updates.prompt = prompt;

      if (Object.keys(updates).length > 0) {
        zoneRepository.updateZone(zoneId, updates);
      }

      if (status !== undefined) {
        const db = getDatabase().getDatabase();
        db.prepare('UPDATE zones SET status = ? WHERE zone_id = ?').run(status, zoneId);
      }

      logMcp('info', `Zone ${zoneId} updated`);
      return jsonResponse({
        success: true,
        zoneId,
        updates: {
          title: title !== undefined ? title : zone.title,
          prompt: prompt !== undefined ? prompt : zone.prompt,
          status: status !== undefined ? status : zone.status,
        },
        message: `Zone ${zoneId} updated successfully.`,
      });
    } catch (error) {
      logMcp('error', `Failed to update zone ${zoneId}: ${error instanceof Error ? error.message : String(error)}`);
      return textResponse(`Error updating zone: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
);

// ============================================================
// Tool 15: get_agent_status
// ============================================================

mcpServer.tool(
  'get_agent_status',
  'Get agent status including current task counts, associated zones, and online/offline state. If no agentId is provided, returns status for all agents.',
  {
    agentId: z.string().optional().describe('Optional agent ID. If omitted, returns all agents.'),
  },
  async ({ agentId }) => {
    try {
      const db = getDatabase().getDatabase();
      const HEARTBEAT_THRESHOLD_MS = 5 * 60 * 1000;

      if (agentId) {
        const zones = zoneMemberRepository.getMembersByAgent(agentId);
        const activeResult = db.prepare(
          `SELECT COUNT(*) as count FROM tasks WHERE assigned_agent_id = ? AND status IN ('assigned', 'in_progress')`
        ).get(agentId) as { count: number } | undefined;
        const pendingResult = db.prepare(
          `SELECT COUNT(*) as count FROM tasks WHERE assigned_agent_id = ? AND status = 'pending'`
        ).get(agentId) as { count: number } | undefined;
        const bg = db.prepare(
          `SELECT status, last_heartbeat_at FROM agent_backgrounds WHERE agent_id = ?`
        ).get(agentId) as { status: string; last_heartbeat_at: number | null } | undefined;

        const isOnline = bg?.status === 'running' && bg?.last_heartbeat_at
          ? (Date.now() - bg.last_heartbeat_at) < HEARTBEAT_THRESHOLD_MS
          : false;

        return jsonResponse({
          agentId,
          activeTaskCount: activeResult?.count ?? 0,
          pendingTaskCount: pendingResult?.count ?? 0,
          isOnline,
          lastHeartbeatAt: bg?.last_heartbeat_at || null,
          zones: zones.map(z => ({ zoneId: z.zoneId, role: z.role, enteredAt: z.enteredAt })),
        });
      }

      const allAgents = db.prepare(
        `SELECT DISTINCT agent_id FROM zone_members WHERE left_at IS NULL
         UNION
         SELECT DISTINCT agent_id FROM agent_capabilities`
      ).all() as Array<{ agent_id: string }>;

      const statuses = [];
      for (const row of allAgents) {
        const id = row.agent_id;
        const zones = zoneMemberRepository.getMembersByAgent(id);
        const activeResult = db.prepare(
          `SELECT COUNT(*) as count FROM tasks WHERE assigned_agent_id = ? AND status IN ('assigned', 'in_progress')`
        ).get(id) as { count: number } | undefined;
        const pendingResult = db.prepare(
          `SELECT COUNT(*) as count FROM tasks WHERE assigned_agent_id = ? AND status = 'pending'`
        ).get(id) as { count: number } | undefined;
        const bg = db.prepare(
          `SELECT status, last_heartbeat_at FROM agent_backgrounds WHERE agent_id = ?`
        ).get(id) as { status: string; last_heartbeat_at: number | null } | undefined;

        const isOnline = bg?.status === 'running' && bg?.last_heartbeat_at
          ? (Date.now() - bg.last_heartbeat_at) < HEARTBEAT_THRESHOLD_MS
          : false;

        statuses.push({
          agentId: id,
          activeTaskCount: activeResult?.count ?? 0,
          pendingTaskCount: pendingResult?.count ?? 0,
          isOnline,
          lastHeartbeatAt: bg?.last_heartbeat_at || null,
          zoneCount: zones.length,
          zones: zones.map(z => ({ zoneId: z.zoneId, role: z.role })),
        });
      }

      return jsonResponse({ agents: statuses });
    } catch (error) {
      logMcp('error', `Failed to get agent status: ${error instanceof Error ? error.message : String(error)}`);
      return textResponse(`Error getting agent status: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
);

// ============================================================
// Resources
// ============================================================

mcpServer.resource(
  'zone-status',
  new ResourceTemplate('zone://{zoneId}/status', { list: undefined }),
  {
    description: 'Zone status summary including member count, task counts, and recent activity',
    mimeType: 'application/json',
  },
  async (uri, variables) => {
    const zoneId = Array.isArray(variables.zoneId) ? variables.zoneId[0] : variables.zoneId;
    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify({ error: `Zone ${zoneId} not found` }),
        }],
      };
    }

    const members = zoneMemberRepository.getMembers(zoneId);
    let status: Record<string, unknown>;
    try {
      const coordinator = await getCoordinator(zoneId);
      status = coordinator.getStatusSummary() as unknown as Record<string, unknown>;
    } catch {
      status = { message: 'No coordinator activity yet' };
    }

    return {
      contents: [{
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify({
          zoneId,
          title: zone.title,
          memberCount: members.length,
          ...status,
        }, null, 2),
      }],
    };
  }
);

mcpServer.resource(
  'zone-tasks',
  new ResourceTemplate('zone://{zoneId}/tasks', { list: undefined }),
  {
    description: 'All tasks within a Zone',
    mimeType: 'application/json',
  },
  async (uri, variables) => {
    const zoneId = Array.isArray(variables.zoneId) ? variables.zoneId[0] : variables.zoneId;
    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify({ error: `Zone ${zoneId} not found` }),
        }],
      };
    }

    const tasks = zoneRepository.getTasks(zoneId);

    return {
      contents: [{
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify({ zoneId, tasks }, null, 2),
      }],
    };
  }
);

mcpServer.resource(
  'zone-agents',
  new ResourceTemplate('zone://{zoneId}/agents', { list: undefined }),
  {
    description: 'Agents in a Zone with their capabilities',
    mimeType: 'application/json',
  },
  async (uri, variables) => {
    const zoneId = Array.isArray(variables.zoneId) ? variables.zoneId[0] : variables.zoneId;
    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify({ error: `Zone ${zoneId} not found` }),
        }],
      };
    }

    const members = zoneMemberRepository.getMembers(zoneId);
    const agents = members.map(m => {
      const caps = agentCapabilityRepository.getCapabilities(m.agentId, zoneId);
      return {
        agentId: m.agentId,
        role: m.role,
        capabilities: caps.map(c => ({ name: c.capability, level: c.level })),
      };
    });

    return {
      contents: [{
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify({ zoneId, agents }, null, 2),
      }],
    };
  }
);

mcpServer.resource(
  'system-info',
  'stratix://system/info',
  {
    description: 'System information including version, zone count, agent count, and database status',
    mimeType: 'application/json',
  },
  async (uri) => {
    const zoneId = getDefaultProjectId();
    const zones = zoneId ? zoneRepository.getZonesByProject(zoneId) : [];
    let agentCount = 0;
    for (const z of zones) {
      agentCount += zoneMemberRepository.getMembers(z.id).length;
    }

    return {
      contents: [{
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify({
          version: '0.1.0',
          zoneCount: zones.length,
          agentCount,
          databaseStatus: zoneId ? 'connected' : 'no_project',
        }, null, 2),
      }],
    };
  }
);

mcpServer.resource(
  'zone-audit-log',
  new ResourceTemplate('zone://{zoneId}/audit-log', { list: undefined }),
  {
    description: 'Zone audit log with the 50 most recent events in descending chronological order',
    mimeType: 'application/json',
  },
  async (uri, variables) => {
    const zoneId = Array.isArray(variables.zoneId) ? variables.zoneId[0] : variables.zoneId;
    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify({ error: `Zone ${zoneId} not found` }),
        }],
      };
    }

    const result = auditLogRepository.getZoneAuditTrail(zoneId, { limit: 50 });

    return {
      contents: [{
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify({
          zoneId,
          total: result.total,
          hasMore: result.hasMore,
          events: result.events,
        }, null, 2),
      }],
    };
  }
);

// ============================================================
// Prompts
// ============================================================

mcpServer.prompt(
  'submit_requirement',
  'Guidance for submitting a requirement to a Zone with proper context',
  {
    zoneId: z.string().describe('The Zone ID to submit the requirement to'),
    requirement: z.string().describe('The requirement or task description in natural language'),
  },
  ({ zoneId, requirement }) => {
    const zone = zoneRepository.getZone(zoneId);
    const zoneTitle = zone?.title || zoneId;
    return {
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `Submitting requirement to Zone "${zoneTitle}" (${zoneId}):\n\n${requirement}\n\nPlease use the submit_requirement tool to process this requirement.`,
        },
      }],
    };
  }
);

mcpServer.prompt(
  'agent_onboarding',
  'Onboarding guidance for a new agent joining a Zone',
  {
    zoneId: z.string().describe('The Zone ID the agent is joining'),
    agentId: z.string().describe('The unique agent identifier'),
  },
  ({ zoneId, agentId }) => {
    const zone = zoneRepository.getZone(zoneId);
    const zoneTitle = zone?.title || zoneId;
    const members = zoneMemberRepository.getMembers(zoneId);
    const capabilities = agentCapabilityRepository.getCapabilities(agentId, zoneId);

    return {
      messages: [{
        role: 'assistant',
        content: {
          type: 'text',
          text: `Welcome agent ${agentId} to Zone "${zoneTitle}" (${zoneId}).\n\n` +
            `Zone Objective: ${zone?.prompt || 'No objective set'}\n\n` +
            `Current Members: ${members.length}\n\n` +
            `Your Capabilities: ${capabilities.map(c => `${c.capability} (level ${c.level})`).join(', ') || 'None registered yet'}\n\n` +
            `Available Tools: list_zones, create_zone, submit_requirement, get_zone_status, list_agents, add_agent_to_zone\n\n` +
            `Workflow: 1) Review Zone status, 2) Receive task assignments, 3) Execute tasks, 4) Report completion.`,
        },
      }],
    };
  }
);

mcpServer.prompt(
  'task_review',
  'Prompt template for reviewing a completed task',
  {
    zoneId: z.string().describe('The Zone ID containing the task'),
    taskId: z.string().describe('The task ID to review'),
  },
  ({ zoneId, taskId }) => {
    const zone = zoneRepository.getZone(zoneId);
    const zoneTitle = zone?.title || zoneId;
    return {
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `Please review task ${taskId} in Zone "${zoneTitle}" (${zoneId}).\n\n` +
            `Check the task execution results, verify quality, and confirm completion or request revisions using the appropriate tools.`,
        },
      }],
    };
  }
);

// ============================================================
// Express Router（嵌入 Gateway）
// ============================================================

export function createMcpRouter(): Router {
  const router = Router();
  const transports = new Map<string, SSEServerTransport>();

  // SSE endpoint for MCP connections
  router.get('/sse', async (_req: Request, res: Response) => {
    const transport = new SSEServerTransport('/mcp/messages', res);
    transports.set(transport.sessionId, transport);
    await mcpServer.connect(transport);

    _req.on('close', () => {
      transports.delete(transport.sessionId);
      transport.close().catch((err) => {
        console.error('[MCP] Error closing SSE transport:', err);
      });
    });
  });

  // Message endpoint for MCP
  router.post('/messages', async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;
    if (!sessionId) {
      res.status(400).json({ error: 'Missing sessionId query parameter' });
      return;
    }

    const transport = transports.get(sessionId);
    if (!transport) {
      res.status(400).json({ error: 'No active SSE connection for sessionId' });
      return;
    }

    try {
      await transport.handlePostMessage(req, res, req.body);
    } catch (error) {
      logMcp('error', `Error handling POST message: ${error instanceof Error ? error.message : String(error)}`);
      console.error('[MCP] Error handling POST message:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to process message' });
      }
    }
  });

  return router;
}

// Also export for stdio usage (standalone mode)
export { mcpServer };
