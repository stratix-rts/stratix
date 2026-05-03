import { zoneRepository } from '../../stratix-database/ZoneRepository';
import { zoneMemberRepository } from '../../stratix-database/ZoneMemberRepository';
import { Zone } from '../../stratix-project/types';
import { gatewayEventBus } from '../GatewayEventBus';

export class ZoneMemberService {
  constructor(
    private checkPermission: (action: string, resource: string, agentId: string) => void,
    private syncZoneToStore: (zone: Zone) => void,
    private ensureInitialized: () => Promise<void>
  ) {}

  public async addMember(zoneId: string, agentId: string, requesterId: string = 'system'): Promise<Zone> {
    await this.ensureInitialized();

    this.checkPermission('add_member', `zone:${zoneId}`, requesterId);

    // 权威源：zone_members 表
    zoneMemberRepository.addMember(zoneId, agentId);
    // 同步到 zone_contexts.members JSON（冗余缓存，供 UI 查询）
    const zone = zoneRepository.addMember(zoneId, agentId);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }

    this.syncZoneToStore(zone);

    gatewayEventBus.publishZoneEvent('zone:member_joined', zoneId, zone.projectId!, {
      agentId
    });

    this.autoAssignTaskToMember(zoneId, agentId).catch(err => {
      console.error(`[ZoneMemberService] Unhandled error in autoAssignTaskToMember:`, err);
    });

    return zone;
  }

  private async autoAssignTaskToMember(zoneId: string, agentId: string): Promise<void> {
    try {
      const TaskQueueService = require('../../stratix-orchestration/task-queue/TaskQueueService').TaskQueueService;
      const taskQueue = TaskQueueService.getInstance();

      await taskQueue.getTasksByZone(zoneId);

      const task = await taskQueue.dequeueTask(agentId, zoneId);

      if (task) {
        console.log(`[ZoneMemberService] Auto-claimed task ${task.taskId} for agent ${agentId} in zone ${zoneId}`);
      } else {
        console.debug(`[ZoneMemberService] No pending tasks to assign to agent ${agentId} in zone ${zoneId}`);
      }
    } catch (err) {
      console.error(`[ZoneMemberService] Failed to auto-assign task to agent ${agentId} in zone ${zoneId}:`, err);
    }
  }

  public async removeMember(zoneId: string, agentId: string, requesterId: string = 'system'): Promise<Zone> {
    await this.ensureInitialized();

    this.checkPermission('remove_member', `zone:${zoneId}`, requesterId);

    // 权威源：zone_members 表（soft remove）
    zoneMemberRepository.removeMember(zoneId, agentId);
    // 同步到 zone_contexts.members JSON
    const zone = zoneRepository.removeMember(zoneId, agentId);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }

    this.syncZoneToStore(zone);

    gatewayEventBus.publishZoneEvent('zone:member_left', zoneId, zone.projectId!, {
      agentId
    });

    return zone;
  }

  public async addMembers(zoneId: string, agentIds: string[], requesterId: string = 'system'): Promise<Zone> {
    await this.ensureInitialized();

    this.checkPermission('add_members', `zone:${zoneId}`, requesterId);

    // 权威源：zone_members 表
    for (const agentId of agentIds) {
      zoneMemberRepository.addMember(zoneId, agentId);
    }
    // 同步到 zone_contexts.members JSON
    const zone = zoneRepository.addMembers(zoneId, agentIds);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }

    this.syncZoneToStore(zone);

    for (const agentId of agentIds) {
      gatewayEventBus.publishZoneEvent('zone:member_joined', zoneId, zone.projectId!, {
        agentId
      });
    }

    return zone;
  }

  public async removeMembers(zoneId: string, agentIds: string[], requesterId: string = 'system'): Promise<Zone> {
    await this.ensureInitialized();

    this.checkPermission('remove_members', `zone:${zoneId}`, requesterId);

    // 权威源：zone_members 表（soft remove）
    for (const agentId of agentIds) {
      zoneMemberRepository.removeMember(zoneId, agentId);
    }
    // 同步到 zone_contexts.members JSON
    const zone = zoneRepository.removeMembers(zoneId, agentIds);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }

    this.syncZoneToStore(zone);

    for (const agentId of agentIds) {
      gatewayEventBus.publishZoneEvent('zone:member_left', zoneId, zone.projectId!, {
        agentId
      });
    }

    return zone;
  }
}
