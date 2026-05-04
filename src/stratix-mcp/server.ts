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
import { projectRepository } from '../stratix-database/ProjectRepository';
import { ZoneCoordinator } from '../stratix-orchestration/zone/ZoneCoordinator';
import type { Capability } from '../stratix-database/AgentCapabilityRepository';

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

function validateZone(zoneId: string): { valid: false; response: ReturnType<typeof textResponse> } | { valid: true } {
  const zone = zoneRepository.getZone(zoneId);
  if (!zone) {
    return { valid: false, response: textResponse(`Error: Zone ${zoneId} not found.`) };
  }
  return { valid: true };
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
    const projectId = getDefaultProjectId();
    if (!projectId) {
      return { content: [{ type: 'text' as const, text: 'No projects found. Create a project first.' }] };
    }

    const zones = zoneRepository.getZonesByProject(projectId);
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
    const projectId = getDefaultProjectId();
    if (!projectId) {
      return { content: [{ type: 'text' as const, text: 'Error: No default project found.' }] };
    }

    const zone = zoneRepository.createZone(projectId, title, prompt || '');

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
    if (!validation.valid) {
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
    const projectId = getDefaultProjectId();
    if (!projectId) {
      return { content: [{ type: 'text' as const, text: 'No projects found.' }] };
    }

    const zones = zoneRepository.getZonesByProject(projectId);
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
    if (!validation.valid) {
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
    const projectId = getDefaultProjectId();
    const zones = projectId ? zoneRepository.getZonesByProject(projectId) : [];
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
          databaseStatus: projectId ? 'connected' : 'no_project',
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
