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

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import { Router, Request, Response } from 'express';

import { zoneRepository } from '../stratix-database/ZoneRepository';
import { zoneMemberRepository } from '../stratix-database/ZoneMemberRepository';
import { agentCapabilityRepository } from '../stratix-database/AgentCapabilityRepository';
import { projectRepository } from '../stratix-database/ProjectRepository';
import { ZoneCoordinator } from '../stratix-orchestration/zone/ZoneCoordinator';

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
        agentCapabilityRepository.setCapability(agentId, zoneId, cap as any, Number(level));
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
