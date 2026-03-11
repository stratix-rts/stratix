import fs from 'fs-extra';
import path from 'path';
import { initializeDatabase } from './StratixDatabase';
import { projectRepository } from './ProjectRepository';
import { agentRepository } from './AgentRepository';

async function migrate() {
  const dataDir = 'stratix-data';
  
  console.log('[Migration] Starting data migration...');
  
  initializeDatabase({ dataDir });
  console.log('[Migration] Database initialized');
  
  const agentsJson = JSON.parse(fs.readFileSync(path.join(dataDir, 'stratix.db.json'), 'utf-8'));
  const projectsJson = JSON.parse(fs.readFileSync(path.join(dataDir, 'projects.json'), 'utf-8'));
  
  if (agentsJson.agents && agentsJson.agents.length > 0) {
    console.log(`[Migration] Migrating ${agentsJson.agents.length} agents...`);
    for (const agent of agentsJson.agents) {
      agentRepository.saveAgent(agent);
      console.log(`[Migration] Agent migrated: ${agent.agentId}`);
    }
  }
  
  if (projectsJson.projects && projectsJson.projects.length > 0) {
    console.log(`[Migration] Migrating ${projectsJson.projects.length} projects...`);
    for (const project of projectsJson.projects) {
      const mappedProject = {
        id: project.id,
        name: project.name,
        description: project.description || '',
        priority: project.priority || 3,
        status: project.status,
        config: project.config || {},
        path: project.path || '',
        presentAgentIds: project.presentAgentIds || [],
        zoneConfig: project.zoneConfig || {},
        createdAt: new Date(project.createdAt),
        updatedAt: new Date(project.updatedAt),
        startedAt: project.startedAt ? new Date(project.startedAt) : undefined,
        completedAt: project.completedAt ? new Date(project.completedAt) : undefined
      };
      projectRepository.createProject(mappedProject);
      console.log(`[Migration] Project migrated: ${project.id}`);
    }
  }
  
  if (projectsJson.channels) {
    for (const [projectId, channels] of Object.entries(projectsJson.channels) as [string, any[]][]) {
      console.log(`[Migration] Migrating ${channels.length} channels for project ${projectId}...`);
      for (const channel of channels) {
        projectRepository.createChannel({
          id: channel.id,
          projectId: channel.projectId,
          name: channel.name,
          type: channel.type,
          description: channel.description || '',
          subscriberIds: channel.subscriberIds || [],
          isPrivate: false,
          createdAt: channel.createdAt,
          updatedAt: channel.updatedAt
        });
        console.log(`[Migration] Channel migrated: ${channel.id}`);
      }
    }
  }
  
  if (projectsJson.messages) {
    for (const [projectId, messages] of Object.entries(projectsJson.messages) as [string, any[]][]) {
      console.log(`[Migration] Migrating ${messages.length} messages for project ${projectId}...`);
      for (const msg of messages) {
        projectRepository.createMessage({
          id: msg.id,
          projectId: msg.projectId,
          channelId: msg.channelId,
          role: msg.role,
          content: msg.content,
          sender: msg.sender,
          mentions: msg.mentions || [],
          rawContent: msg.rawContent,
          messageType: msg.messageType || 'chat',
          taskId: msg.taskId,
          sessionKey: msg.sessionKey,
          runId: msg.runId,
          metadata: msg.metadata || {},
          timestamp: msg.timestamp
        });
      }
      console.log(`[Migration] ${messages.length} messages migrated for project ${projectId}`);
    }
  }
  
  console.log('[Migration] Migration completed!');
  
  const agentCount = projectRepository.getAllProjects().length;
  console.log(`[Migration] Verification: ${agentCount} projects in database`);
}

migrate().catch(console.error);
