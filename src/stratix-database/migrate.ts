import path from 'path';

import * as fs from 'fs-extra';

import { StratixAgentConfig } from '../stratix-core/stratix-protocol';
import { MessageSender, ProjectChannelType, MessageRole, ProjectMessageType, ProjectStatus, ProjectConfig, ProjectZoneConfig } from '../stratix-project/types';

import { agentRepository } from './AgentRepository';
import { projectRepository } from './ProjectRepository';
import { initializeDatabase, getDatabase } from './StratixDatabase';

const DEFAULT_PRIORITY = 3;

function log(level: 'info' | 'warn' | 'error', message: string, ctx?: Record<string, unknown>): void {
  console[level](`[Migration] ${message}`, ctx || '');
}

// Strict row interfaces for legacy JSON data
interface LegacyAgentJson {
  agentId?: unknown;
  name?: unknown;
  type?: unknown;
  profile?: unknown;
  soul?: unknown;
  rules?: unknown;
  backendType?: unknown;
  configStatus?: unknown;
  position?: unknown;
  memory?: unknown;
  openClawConfig?: unknown;
  stratixConfig?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

interface LegacyProjectJson {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  priority?: unknown;
  status?: unknown;
  config?: unknown;
  path?: unknown;
  presentAgentIds?: unknown;
  zoneConfig?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  startedAt?: unknown;
  completedAt?: unknown;
}

interface LegacyChannelJson {
  id?: unknown;
  projectId?: unknown;
  name?: unknown;
  type?: unknown;
  description?: unknown;
  subscriberIds?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

interface LegacyMessageJson {
  id?: unknown;
  projectId?: unknown;
  channelId?: unknown;
  role?: unknown;
  content?: unknown;
  sender?: unknown;
  mentions?: unknown;
  rawContent?: unknown;
  messageType?: unknown;
  taskId?: unknown;
  sessionKey?: unknown;
  runId?: unknown;
  metadata?: unknown;
  timestamp?: unknown;
}

interface LegacyDataJson {
  agents?: LegacyAgentJson[];
  projects?: LegacyProjectJson[];
  channels?: Record<string, LegacyChannelJson[]>;
  messages?: Record<string, LegacyMessageJson[]>;
}

async function migrate() {
  const dataDir = 'stratix-data';

  log('info', 'Starting data migration...');

  initializeDatabase({ dataDir });
  log('info', 'Database initialized');

  const agentsData = await fs.readFile(path.join(dataDir, 'stratix.db.json'), 'utf8');
  const projectsData = await fs.readFile(path.join(dataDir, 'projects.json'), 'utf8');

  const agentsJson = JSON.parse(agentsData) as { agents?: LegacyAgentJson[] };
  const projectsJson = JSON.parse(projectsData) as LegacyDataJson;

  // Wrap entire migration in a transaction
  const db = getDatabase().getDatabase();
  const migrateAll = db.transaction(() => {
    if (agentsJson.agents && agentsJson.agents.length > 0) {
      log('info', `Migrating ${agentsJson.agents.length} agents...`);
      for (const agent of agentsJson.agents) {
        agentRepository.saveAgent(agent as StratixAgentConfig);
        log('info', `Agent migrated: ${String(agent.agentId)}`);
      }
    }

    if (projectsJson.projects && projectsJson.projects.length > 0) {
      log('info', `Migrating ${projectsJson.projects.length} projects...`);
      for (const project of projectsJson.projects) {
        const mappedProject = {
          id: String(project.id),
          name: String(project.name),
          description: String(project.description || ''),
          priority: Number(project.priority) || DEFAULT_PRIORITY,
          status: String(project.status) as ProjectStatus,
          config: (project.config || {}) as ProjectConfig,
          path: String(project.path || ''),
          presentAgentIds: (project.presentAgentIds || []) as string[],
          zoneConfig: (project.zoneConfig || {}) as ProjectZoneConfig,
          createdAt: new Date(String(project.createdAt)),
          updatedAt: new Date(String(project.updatedAt)),
          startedAt: project.startedAt ? new Date(String(project.startedAt)) : undefined,
          completedAt: project.completedAt ? new Date(String(project.completedAt)) : undefined
        };
        projectRepository.createProject(mappedProject);
        log('info', `Project migrated: ${String(project.id)}`);
      }
    }

    if (projectsJson.channels) {
      for (const [projectId, channels] of Object.entries(projectsJson.channels)) {
        log('info', `Migrating ${channels.length} channels for project ${projectId}...`);
        for (const channel of channels) {
          projectRepository.createChannel({
            id: String(channel.id),
            projectId: String(channel.projectId),
            name: String(channel.name),
            type: String(channel.type) as ProjectChannelType,
            description: String(channel.description || ''),
            subscriberIds: (channel.subscriberIds || []) as string[],
            isPrivate: false,
            createdAt: Number(channel.createdAt),
            updatedAt: Number(channel.updatedAt)
          });
          log('info', `Channel migrated: ${String(channel.id)}`);
        }
      }
    }

    if (projectsJson.messages) {
      for (const [projectId, messages] of Object.entries(projectsJson.messages)) {
        log('info', `Migrating ${messages.length} messages for project ${projectId}...`);
        for (const msg of messages) {
          projectRepository.createMessage({
            id: String(msg.id),
            projectId: String(msg.projectId),
            channelId: String(msg.channelId),
            role: String(msg.role) as MessageRole,
            content: String(msg.content),
            sender: msg.sender as MessageSender,
            mentions: (msg.mentions || []) as string[],
            rawContent: msg.rawContent ? String(msg.rawContent) : undefined,
            messageType: String(msg.messageType || 'chat') as ProjectMessageType,
            taskId: msg.taskId ? String(msg.taskId) : undefined,
            sessionKey: msg.sessionKey ? String(msg.sessionKey) : undefined,
            runId: msg.runId ? String(msg.runId) : undefined,
            metadata: (msg.metadata || { source: 'user', createdAt: new Date().toISOString() }) as { source: 'openclaw' | 'local' | 'user'; createdAt: string },
            timestamp: Number(msg.timestamp)
          });
        }
        log('info', `${messages.length} messages migrated for project ${projectId}`);
      }
    }
  });

  try {
    migrateAll();
    log('info', 'Migration completed successfully!');
  } catch (error) {
    log('error', 'Migration failed', { error: String(error) });
    throw error;
  }

  const projectCount = projectRepository.getAllProjects().length;
  log('info', `Verification: ${projectCount} projects in database`);
}

migrate().catch((err) => log('error', 'Unhandled migration error', { error: String(err) }));
