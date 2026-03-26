import Phaser from 'phaser';
import StratixEventBus from '../stratix-core/StratixEventBus';
import {
  StratixFrontendOperationEvent,
  StratixStateSyncEvent,
  StratixAgentConfig,
  StratixCommandData
} from '../stratix-core/stratix-protocol';

type StratixEvent = StratixFrontendOperationEvent | StratixStateSyncEvent;

export class StratixRTSEventManager {
  private eventBus: StratixEventBus;
  private scene: Phaser.Scene;
  private boundHandlers: Map<string, (event: StratixEvent) => void> = new Map();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.eventBus = StratixEventBus.getInstance();
  }

  public subscribeAll(): void {
    this.subscribe('stratix:agent_create', this.onAgentCreate.bind(this));
    this.subscribe('stratix:agent_status_update', this.onAgentStatusUpdate.bind(this));
    this.subscribe('stratix:command_status_update', this.onCommandStatusUpdate.bind(this));
    this.subscribe('stratix:zone_updated', this.onZoneUpdated.bind(this));
    this.subscribe('stratix:zone_deleted', this.onZoneDeleted.bind(this));
    this.subscribe('stratix:zone_member_joined', this.onZoneMemberJoined.bind(this));
    this.subscribe('stratix:zone_member_left', this.onZoneMemberLeft.bind(this));
  }

  public unsubscribeAll(): void {
    this.boundHandlers.forEach((handler, eventType) => {
      this.eventBus.unsubscribe(eventType, handler);
    });
    this.boundHandlers.clear();
  }

  private subscribe(
    eventType: string, 
    handler: (event: StratixEvent) => void
  ): void {
    this.boundHandlers.set(eventType, handler);
    this.eventBus.subscribe(eventType, handler);
  }

  public emitAgentSelect(agentIds: string[]): void {
    const event: StratixFrontendOperationEvent = {
      eventType: 'stratix:agent_select',
      payload: { agentIds },
      timestamp: Date.now(),
      requestId: this.generateRequestId()
    };
    this.eventBus.emit(event);
  }

  public emitAgentDeselect(agentIds: string[]): void {
    const event: StratixFrontendOperationEvent = {
      eventType: 'stratix:agent_deselect',
      payload: { agentIds },
      timestamp: Date.now(),
      requestId: this.generateRequestId()
    };
    this.eventBus.emit(event);
  }

  public emitCommandExecute(agentIds: string[], command: StratixCommandData): void {
    const event: StratixFrontendOperationEvent = {
      eventType: 'stratix:command_execute',
      payload: { agentIds, command },
      timestamp: Date.now(),
      requestId: this.generateRequestId()
    };
    this.eventBus.emit(event);
  }

  public emitCommandCancel(commandId: string): void {
    const event: StratixFrontendOperationEvent = {
      eventType: 'stratix:command_cancel',
      payload: { commandId },
      timestamp: Date.now(),
      requestId: this.generateRequestId()
    };
    this.eventBus.emit(event);
  }

  private onAgentCreate(event: StratixEvent): void {
    const payload = event.payload as { data?: StratixAgentConfig };
    const agentConfig = payload.data;
    if (!agentConfig) return;
    this.scene.events.emit('stratix:create-agent', agentConfig);
  }

  private onAgentStatusUpdate(event: StratixEvent): void {
    const payload = event.payload as { agentId?: string; status?: string };
    const { agentId, status } = payload;
    if (!agentId || !status) return;
    this.scene.events.emit('stratix:update-agent-status', { agentId, status });
  }

  private onCommandStatusUpdate(event: StratixEvent): void {
    const payload = event.payload as { agentId?: string; commandStatus?: string };
    const { agentId, commandStatus } = payload;
    if (!agentId || !commandStatus) return;
    this.scene.events.emit('stratix:update-command-status', { agentId, commandStatus });
  }

  private onZoneUpdated(event: StratixEvent): void {
    const payload = event.payload as { zoneId?: string; title?: string; prompt?: string };
    const { zoneId, title, prompt } = payload;
    if (!zoneId) return;
    this.scene.events.emit('stratix:zone-updated', { zoneId, title, prompt });
  }

  private onZoneDeleted(event: StratixEvent): void {
    const payload = event.payload as { zoneId?: string };
    const { zoneId } = payload;
    if (!zoneId) return;
    this.scene.events.emit('stratix:zone-deleted', { zoneId });
  }

  private onZoneMemberJoined(event: StratixEvent): void {
    const payload = event.payload as { zoneId?: string; agentId?: string };
    const { zoneId, agentId } = payload;
    if (!zoneId || !agentId) return;
    this.scene.events.emit('stratix:zone-member-joined', { zoneId, agentId });
  }

  private onZoneMemberLeft(event: StratixEvent): void {
    const payload = event.payload as { zoneId?: string; agentId?: string };
    const { zoneId, agentId } = payload;
    if (!zoneId || !agentId) return;
    this.scene.events.emit('stratix:zone-member-left', { zoneId, agentId });
  }

  private generateRequestId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `stratix-req-${timestamp}-${random}`;
  }
}
