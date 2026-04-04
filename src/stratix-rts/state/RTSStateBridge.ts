import {
  stratixStateStore,
  type AgentState,
} from '@/stratix-core/state';
import type { AgentStatus } from '../sprites/AgentSprite';

/** Maps AgentSprite status (RTS layer) to AgentActivityStatus (StateStore) */
const activityMap: Record<AgentStatus, AgentState['status']['activity']> = {
  online: 'busy',   // RTS online → StateStore busy (agent is active)
  offline: 'idle',
  busy: 'busy',
  error: 'error',
};

export class RTSStateBridge {
  // ── Agent operations ─────────────────────────────────────────

  registerAgent(
    agentId: string,
    name: string,
    _config: Partial<AgentState>['config']
  ): void {
    const existing = stratixStateStore.getAgent(agentId);
    const state: AgentState = existing
      ? { ...existing }
      : {
          id: agentId,
          name,
          status: {
            config: 'draft',
            connection: 'disconnected',
            activity: 'idle',
          },
          config: {},
        };
    stratixStateStore.setAgent(agentId, state);
  }

  updateAgentStatus(agentId: string, status: AgentStatus): void {
    const current = stratixStateStore.getAgent(agentId);
    const activity = activityMap[status];
    if (current?.status.activity === activity) return; // deduplicate
    stratixStateStore.updateAgent(agentId, {
      status: {
        config: current?.status.config ?? 'draft',
        connection: current?.status.connection ?? 'disconnected',
        activity,
      },
      lastActiveAt: Date.now(),
    });
  }

  agentEnterZone(agentId: string, zoneId: string): void {
    const current = stratixStateStore.getAgent(agentId);
    if (current?.currentZone === zoneId) return; // deduplicate
    stratixStateStore.updateAgent(agentId, { currentZone: zoneId });
  }

  agentLeaveZone(agentId: string): void {
    const current = stratixStateStore.getAgent(agentId);
    if (!current?.currentZone) return; // deduplicate
    stratixStateStore.updateAgent(agentId, { currentZone: undefined });
  }

  unregisterAgent(agentId: string): void {
    stratixStateStore.removeAgent(agentId);
  }

  // ── Selection operations ─────────────────────────────────────

  private previousSelectedAgents: string[] = [];

  syncSelection(selectedAgentIds: string[], selectedZoneId: string | null): void {
    const uiState = stratixStateStore.get('ui');
    const agentsChanged = uiState.selectedAgents.join(',') !== selectedAgentIds.join(',');
    const zoneChanged = uiState.selectedZone !== selectedZoneId;
    if (!agentsChanged && !zoneChanged) return; // deduplicate
    stratixStateStore.set('ui', {
      ...uiState,
      selectedAgents: selectedAgentIds,
      selectedZone: selectedZoneId ?? uiState.selectedZone,
    });
  }
}
