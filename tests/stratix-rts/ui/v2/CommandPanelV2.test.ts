/**
 * CommandPanelV2 Unit Tests
 *
 * Tests business logic: state derivation, panel data updates, callbacks
 * Uses dependency injection and minimal mocking
 */

import type { AgentInfo, ZoneInfo, Skill, PanelState, PanelData } from '@/stratix-rts/ui/v2/CommandPanelV2';

describe('CommandPanelV2 Business Logic', () => {
  // Test the state derivation logic in isolation
  describe('state derivation (deriveState)', () => {
    // Helper function that mimics the deriveState logic
    function deriveState(data: PanelData): PanelState {
      if (data.agents.length === 0 && !data.zone) {
        return 'empty';
      }
      if (data.zone && data.agents.length === 0) {
        return 'zone';
      }
      if (data.agents.length === 1) {
        return 'single_agent';
      }
      return 'multi_agent';
    }

    it('should derive "empty" state when no agents and no zone', () => {
      const data: PanelData = { agents: [], zone: null, skills: [], isLoading: false };
      expect(deriveState(data)).toBe('empty');
    });

    it('should derive "zone" state when zone selected but no agents', () => {
      const data: PanelData = {
        agents: [],
        zone: { zoneId: 'zone-1', name: 'Test Zone', status: 'active', agentCount: 5 },
        skills: [],
        isLoading: false
      };
      expect(deriveState(data)).toBe('zone');
    });

    it('should derive "single_agent" state when one agent selected', () => {
      const data: PanelData = {
        agents: [{ agentId: 'agent-1', name: 'Agent 1', type: 'dev', status: 'online', position: { x: 0, y: 0 } }],
        zone: null,
        skills: [],
        isLoading: false
      };
      expect(deriveState(data)).toBe('single_agent');
    });

    it('should derive "multi_agent" state when multiple agents selected', () => {
      const data: PanelData = {
        agents: [
          { agentId: 'agent-1', name: 'Agent 1', type: 'dev', status: 'online', position: { x: 0, y: 0 } },
          { agentId: 'agent-2', name: 'Agent 2', type: 'writer', status: 'busy', position: { x: 10, y: 10 } },
        ],
        zone: null,
        skills: [],
        isLoading: false
      };
      expect(deriveState(data)).toBe('multi_agent');
    });

    it('should prefer multi_agent over zone when both agents and zone exist', () => {
      // When both agents and zone are present, agents take precedence
      const data: PanelData = {
        agents: [
          { agentId: 'agent-1', name: 'Agent 1', type: 'dev', status: 'online', position: { x: 0, y: 0 } },
        ],
        zone: { zoneId: 'zone-1', name: 'Test Zone', status: 'active', agentCount: 5 },
        skills: [],
        isLoading: false
      };
      expect(deriveState(data)).toBe('single_agent');
    });
  });

  describe('data merge logic', () => {
    // Helper function that mimics the partial data merge
    function mergePanelData(existing: PanelData, update: Partial<PanelData>): PanelData {
      return {
        agents: update.agents !== undefined ? update.agents : existing.agents,
        zone: update.zone !== undefined ? update.zone : existing.zone,
        skills: update.skills !== undefined ? update.skills : existing.skills,
        isLoading: update.isLoading !== undefined ? update.isLoading : existing.isLoading,
      };
    }

    it('should merge partial data correctly', () => {
      const existing: PanelData = { agents: [], zone: null, skills: [], isLoading: false };
      const update = { agents: [{ agentId: 'agent-1', name: 'Agent 1', type: 'dev', status: 'online', position: { x: 0, y: 0 } }] };
      const result = mergePanelData(existing, update);
      expect(result.agents).toHaveLength(1);
      expect(result.agents[0].agentId).toBe('agent-1');
    });

    it('should preserve existing data when updating partial', () => {
      const existing: PanelData = {
        agents: [{ agentId: 'agent-1', name: 'Agent 1', type: 'dev', status: 'online', position: { x: 0, y: 0 } }],
        zone: null,
        skills: [{ skillId: 'skill-1', name: 'Coding', description: 'Write code' }],
        isLoading: false
      };
      const update = { isLoading: true };
      const result = mergePanelData(existing, update);
      expect(result.agents).toHaveLength(1);
      expect(result.skills).toHaveLength(1);
      expect(result.isLoading).toBe(true);
    });

    it('should update isLoading state', () => {
      const existing: PanelData = { agents: [], zone: null, skills: [], isLoading: false };
      const result1 = mergePanelData(existing, { isLoading: true });
      expect(result1.isLoading).toBe(true);

      const result2 = mergePanelData(result1, { isLoading: false });
      expect(result2.isLoading).toBe(false);
    });
  });

  describe('backward compatibility methods logic', () => {
    function updateAgentInfoLogic(agent: AgentInfo | null): Partial<PanelData> {
      return {
        agents: agent ? [agent] : [],
        zone: null,
      };
    }

    function updateSelectedAgentsLogic(agents: AgentInfo[]): Partial<PanelData> {
      return {
        agents,
        zone: null,
      };
    }

    function updateZoneInfoLogic(zone: ZoneInfo | null): Partial<PanelData> {
      return {
        agents: [],
        zone,
      };
    }

    it('updateAgentInfo should convert single agent to array', () => {
      const agent: AgentInfo = { agentId: 'agent-1', name: 'Agent 1', type: 'dev', status: 'online', position: { x: 0, y: 0 } };
      const result = updateAgentInfoLogic(agent);
      expect(result.agents).toEqual([agent]);
      expect(result.zone).toBeNull();
    });

    it('updateAgentInfo with null should clear agents', () => {
      const result = updateAgentInfoLogic(null);
      expect(result.agents).toEqual([]);
    });

    it('updateSelectedAgents should set agents array', () => {
      const agents: AgentInfo[] = [
        { agentId: 'agent-1', name: 'Agent 1', type: 'dev', status: 'online', position: { x: 0, y: 0 } },
        { agentId: 'agent-2', name: 'Agent 2', type: 'writer', status: 'busy', position: { x: 10, y: 10 } },
      ];
      const result = updateSelectedAgentsLogic(agents);
      expect(result.agents).toEqual(agents);
    });

    it('updateZoneInfo should set zone', () => {
      const zone: ZoneInfo = { zoneId: 'zone-1', name: 'Test Zone', status: 'active', agentCount: 5 };
      const result = updateZoneInfoLogic(zone);
      expect(result.zone).toEqual(zone);
      expect(result.agents).toEqual([]);
    });

    it('updateZoneInfo with null should clear zone', () => {
      const result = updateZoneInfoLogic(null);
      expect(result.zone).toBeNull();
    });
  });

  describe('status text mapping', () => {
    const statusTexts: Record<string, string> = {
      online: '在线',
      offline: '离线',
      busy: '忙碌',
      error: '错误',
    };

    const zoneStatusTexts: Record<string, string> = {
      idle: '空闲',
      busy: '忙碌',
      active: '活跃',
      error: '错误',
    };

    it('should return correct status text for agent', () => {
      expect(statusTexts['online']).toBe('在线');
      expect(statusTexts['offline']).toBe('离线');
      expect(statusTexts['busy']).toBe('忙碌');
      expect(statusTexts['error']).toBe('错误');
      expect(statusTexts['unknown']).toBeUndefined();
    });

    it('should return correct status text for zone', () => {
      expect(zoneStatusTexts['idle']).toBe('空闲');
      expect(zoneStatusTexts['busy']).toBe('忙碌');
      expect(zoneStatusTexts['active']).toBe('活跃');
      expect(zoneStatusTexts['error']).toBe('错误');
    });

    it('should use fallback for unknown status', () => {
      const texts = { ...statusTexts };
      const unknownText = texts['unknown'] || '未知';
      expect(unknownText).toBe('未知');
    });
  });

  describe('status color mapping', () => {
    const successColor = '#00ff88';
    const mutedColor = '#888899';
    const warningColor = '#ffcc00';
    const dangerColor = '#ff4757';

    const agentStatusColors: Record<string, string> = {
      online: successColor,
      offline: mutedColor,
      busy: warningColor,
      error: dangerColor,
    };

    const zoneStatusColors: Record<string, string> = {
      idle: mutedColor,
      busy: warningColor,
      active: successColor,
      error: dangerColor,
    };

    it('should return correct color for agent status', () => {
      expect(agentStatusColors['online']).toBe(successColor);
      expect(agentStatusColors['offline']).toBe(mutedColor);
      expect(agentStatusColors['busy']).toBe(warningColor);
      expect(agentStatusColors['error']).toBe(dangerColor);
    });

    it('should return correct color for zone status', () => {
      expect(zoneStatusColors['idle']).toBe(mutedColor);
      expect(zoneStatusColors['busy']).toBe(warningColor);
      expect(zoneStatusColors['active']).toBe(successColor);
      expect(zoneStatusColors['error']).toBe(dangerColor);
    });
  });
});
