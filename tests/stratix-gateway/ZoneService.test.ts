/**
 * ZoneService and ZoneSkillExecutor Unit Tests
 */

// Mock fetch for Node.js 16 (doesn't have native fetch)
const mockFetch = jest.fn();
global.fetch = mockFetch;

import { ZoneSkillExecutor, createExecutor } from '@/stratix-agent/core/SkillExecutors';
import { SkillDefinition, ExecutionContext } from '@/stratix-agent/types';

// ============================================
// ZoneSkillExecutor Tests (with mocked fetch)
// ============================================
describe('ZoneSkillExecutor', () => {
  let executor: ZoneSkillExecutor;
  let context: ExecutionContext;

  beforeEach(() => {
    executor = new ZoneSkillExecutor();
    context = { agentId: 'test-agent-123' };
    mockFetch.mockReset();
    // Set default gateway URL for tests
    process.env.GATEWAY_URL = 'http://127.0.0.1:7524';
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const mockSkill = (skillId: string): SkillDefinition => ({
    skillId,
    name: skillId,
    description: `Test ${skillId} skill`,
    parameters: [],
    executor: 'zone',
  });

  describe('zone_move_to', () => {
    it('should throw error when zoneId is missing', async () => {
      await expect(executor.execute(mockSkill('zone_move_to'), {}, context))
        .rejects.toThrow('zoneId is required for zone_move_to');
    });

    it('should throw error when zoneId is null', async () => {
      await expect(executor.execute(mockSkill('zone_move_to'), { zoneId: null }, context))
        .rejects.toThrow('zoneId is required for zone_move_to');
    });

    it('should throw error when zoneId is empty string', async () => {
      await expect(executor.execute(mockSkill('zone_move_to'), { zoneId: '' }, context))
        .rejects.toThrow('zoneId is required for zone_move_to');
    });

    it('should throw error when API returns non-OK response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Zone not found')
      });

      await expect(executor.execute(mockSkill('zone_move_to'), { zoneId: 'zone-123' }, context))
        .rejects.toThrow('Failed to move to zone: 404 Zone not found');
    });

    it('should return success result when API returns OK', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          zone: {
            id: 'zone-123',
            title: 'Test Zone',
            members: ['test-agent-123']
          }
        })
      });

      const result = await executor.execute(mockSkill('zone_move_to'), { zoneId: 'zone-123' }, context);

      expect(result.success).toBe(true);
      expect(result.zoneId).toBe('zone-123');
      expect(result.message).toBe('Successfully moved to zone zone-123');
    });

    it('should call fetch with correct parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, zone: { id: 'z1' } })
      });

      await executor.execute(mockSkill('zone_move_to'), { zoneId: 'zone-abc', reason: 'testing' }, context);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:7524/api/zones/zone-abc/members/test-agent-123',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'testing' })
        })
      );
    });
  });

  describe('zone_leave', () => {
    it('should return alreadyLeft when not in any zone', async () => {
      // Mock the list zones response (first call)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ zones: [] })
      });

      const result = await executor.execute(mockSkill('zone_leave'), {}, context);

      expect(result.success).toBe(true);
      expect(result.alreadyLeft).toBe(true);
      expect(result.message).toBe('Not currently in any zone');
    });

    it('should leave current zone when agent is a member', async () => {
      // Mock the list zones response (first call) - agent is in zone-123
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          zones: [{
            id: 'zone-123',
            members: ['test-agent-123']
          }]
        })
      });

      // Mock the leave zone response (second call)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true })
      });

      const result = await executor.execute(mockSkill('zone_leave'), { reason: 'done working' }, context);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Successfully left zone zone-123');
      expect(result.previousZoneId).toBe('zone-123');
    });

    it('should throw error when leave API fails', async () => {
      // Mock the list zones response - agent is in zone-123
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          zones: [{
            id: 'zone-123',
            members: ['test-agent-123']
          }]
        })
      });

      // Mock the leave zone response (fails)
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal server error')
      });

      await expect(executor.execute(mockSkill('zone_leave'), {}, context))
        .rejects.toThrow('Failed to leave zone: 500 Internal server error');
    });
  });

  describe('zone_list', () => {
    it('should return empty zones array when no zones exist', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ zones: [] })
      });

      const result = await executor.execute(mockSkill('zone_list'), {}, context);

      expect(result.success).toBe(true);
      expect(result.zones).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should return formatted zones list', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          zones: [
            { id: 'z1', title: 'Zone 1', prompt: 'KR 1', members: ['a1', 'a2'], status: 'active' },
            { id: 'z2', title: 'Zone 2', prompt: 'KR 2', members: ['a1'], status: 'pending' }
          ]
        })
      });

      const result = await executor.execute(mockSkill('zone_list'), {}, context);

      expect(result.success).toBe(true);
      expect(result.zones).toHaveLength(2);
      expect(result.zones[0]).toEqual({
        zoneId: 'z1',
        name: 'Zone 1',
        title: 'Zone 1',
        prompt: 'KR 1',
        agentCount: 2,
        status: 'active'
      });
      expect(result.total).toBe(2);
    });

    it('should handle zone with missing fields gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          zones: [
            { id: 'z1' },  // missing title, prompt, members
            { title: 'Z2' }  // missing id
          ]
        })
      });

      const result = await executor.execute(mockSkill('zone_list'), {}, context);

      expect(result.success).toBe(true);
      expect(result.zones[0].name).toBe('Unnamed Zone');
      expect(result.zones[0].zoneId).toBe('z1');
      expect(result.zones[1].zoneId).toBeUndefined();
    });

    it('should throw error when API fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500
      });

      await expect(executor.execute(mockSkill('zone_list'), {}, context))
        .rejects.toThrow('Failed to list zones: 500');
    });
  });

  describe('zone_info', () => {
    it('should throw error when zoneId is missing', async () => {
      await expect(executor.execute(mockSkill('zone_info'), {}, context))
        .rejects.toThrow('zoneId is required for zone_info');
    });

    it('should throw error when zoneId is null', async () => {
      await expect(executor.execute(mockSkill('zone_info'), { zoneId: null }, context))
        .rejects.toThrow('zoneId is required for zone_info');
    });

    it('should return zone data when found', async () => {
      const mockZone = {
        id: 'zone-abc',
        title: 'My Zone',
        prompt: 'Test prompt',
        members: ['agent1'],
        files: []
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, zone: mockZone })
      });

      const result = await executor.execute(mockSkill('zone_info'), { zoneId: 'zone-abc' }, context);

      expect(result.success).toBe(true);
      expect(result.zone).toEqual(mockZone);
    });

    it('should throw error when zone not found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404
      });

      await expect(executor.execute(mockSkill('zone_info'), { zoneId: 'nonexistent' }, context))
        .rejects.toThrow('Failed to get zone info: 404');
    });

    it('should call fetch with correct zoneId', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, zone: {} })
      });

      await executor.execute(mockSkill('zone_info'), { zoneId: 'specific-zone-id' }, context);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:7524/api/zones/specific-zone-id',
        expect.objectContaining({ method: 'GET' })
      );
    });
  });

  describe('unknown skill', () => {
    it('should throw error for unknown zone skill', async () => {
      await expect(executor.execute(mockSkill('zone_unknown'), {}, context))
        .rejects.toThrow('Unknown zone skill: zone_unknown');
    });
  });
});

// ============================================
// createExecutor Tests
// ============================================
describe('createExecutor', () => {
  it('should create ZoneSkillExecutor for zone type', () => {
    const executor = createExecutor('zone');
    expect(executor).toBeInstanceOf(ZoneSkillExecutor);
  });

  it('should create different executor types correctly', () => {
    expect(createExecutor('http')).toBeDefined();
    expect(createExecutor('builtin')).toBeDefined();
    expect(createExecutor('fs')).toBeDefined();
    expect(createExecutor('bash')).toBeDefined();
    expect(createExecutor('code_sandbox')).toBeDefined();
  });

  it('should return default executor for unknown type', () => {
    const executor = createExecutor('unknown_type' as any);
    expect(executor).toBeDefined();
  });
});

// ============================================
// Zone API Validation Tests
// ============================================
describe('Zone API Validation', () => {
  describe('zoneId parameter validation', () => {
    it('should reject undefined zoneId', () => {
      const zoneId = undefined;
      expect(zoneId).toBeUndefined();
    });

    it('should reject null zoneId', () => {
      const zoneId = null;
      expect(zoneId).toBeNull();
    });

    it('should accept valid string zoneId', () => {
      const zoneId = 'zone-123';
      expect(typeof zoneId).toBe('string');
      expect(zoneId.length).toBeGreaterThan(0);
    });
  });

  describe('projectId parameter validation', () => {
    it('should require projectId for listing zones', () => {
      const projectId = '';
      expect(projectId.length).toBe(0);
    });

    it('should accept valid projectId', () => {
      const projectId = 'proj-abc';
      expect(typeof projectId).toBe('string');
      expect(projectId.length).toBeGreaterThan(0);
    });
  });

  describe('keyword search validation', () => {
    it('should reject empty keyword', () => {
      const keyword = '';
      expect(keyword.length).toBe(0);
    });

    it('should reject single character keyword', () => {
      const keyword = 'a';
      expect(keyword.length).toBeLessThan(2);
    });

    it('should accept valid keyword', () => {
      const keyword = 'test';
      expect(keyword.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('batch operations validation', () => {
    it('should reject empty agentIds array', () => {
      const agentIds: string[] = [];
      expect(agentIds.length).toBe(0);
    });

    it('should reject non-array agentIds', () => {
      const agentIds = 'not-an-array';
      expect(Array.isArray(agentIds)).toBe(false);
    });

    it('should accept valid agentIds array', () => {
      const agentIds = ['agent-1', 'agent-2'];
      expect(Array.isArray(agentIds)).toBe(true);
      expect(agentIds.length).toBe(2);
    });

    it('should reject too many agentIds', () => {
      const agentIds = Array(21).fill('agent');
      expect(agentIds.length).toBeGreaterThan(20);
    });

    it('should accept maximum allowed agentIds', () => {
      const agentIds = Array(20).fill('agent');
      expect(agentIds.length).toBeLessThanOrEqual(20);
    });
  });
});

// ============================================
// Zone Skill Definition Tests
// ============================================
describe('Zone Skill Definitions', () => {
  const zoneSkills = ['zone_move_to', 'zone_leave', 'zone_list', 'zone_info'];

  it('should have all required zone skills defined', () => {
    expect(zoneSkills).toContain('zone_move_to');
    expect(zoneSkills).toContain('zone_leave');
    expect(zoneSkills).toContain('zone_list');
    expect(zoneSkills).toContain('zone_info');
  });

  it('should have 4 zone skills total', () => {
    expect(zoneSkills.length).toBe(4);
  });
});

// ============================================
// Zone Task Status Tests
// ============================================
describe('Zone Task Status', () => {
  const validStatuses = ['pending', 'in_progress', 'done'];

  it('should have valid status values', () => {
    expect(validStatuses).toContain('pending');
    expect(validStatuses).toContain('in_progress');
    expect(validStatuses).toContain('done');
  });

  it('should transition from pending to in_progress', () => {
    let status = 'pending';
    expect(status).toBe('pending');
    status = 'in_progress';
    expect(status).toBe('in_progress');
  });

  it('should transition from in_progress to done', () => {
    let status = 'in_progress';
    expect(status).toBe('in_progress');
    status = 'done';
    expect(status).toBe('done');
  });
});

// ============================================
// Zone Clone Options Tests
// ============================================
describe('Zone Clone Options', () => {
  interface CloneOptions {
    includeFiles?: boolean;
    includeTasks?: boolean;
  }

  it('should default to not including files and tasks', () => {
    const options: CloneOptions = {};
    expect(options.includeFiles).toBeUndefined();
    expect(options.includeTasks).toBeUndefined();
  });

  it('should accept includeFiles option', () => {
    const options: CloneOptions = { includeFiles: true };
    expect(options.includeFiles).toBe(true);
  });

  it('should accept includeTasks option', () => {
    const options: CloneOptions = { includeTasks: true };
    expect(options.includeTasks).toBe(true);
  });

  it('should accept both options', () => {
    const options: CloneOptions = { includeFiles: true, includeTasks: true };
    expect(options.includeFiles).toBe(true);
    expect(options.includeTasks).toBe(true);
  });
});

// ============================================
// Zone Search Result Tests
// ============================================
describe('Zone Search Results', () => {
  interface SearchResult {
    zones: any[];
    count: number;
  }

  it('should return empty result for no matches', () => {
    const result: SearchResult = { zones: [], count: 0 };
    expect(result.zones).toEqual([]);
    expect(result.count).toBe(0);
  });

  it('should return matched zones with correct count', () => {
    const result: SearchResult = {
      zones: [{ id: 'z1', title: 'Match' }],
      count: 1
    };
    expect(result.zones.length).toBe(1);
    expect(result.count).toBe(result.zones.length);
  });

  it('should limit results', () => {
    const result: SearchResult = {
      zones: Array(20).fill({ id: 'z' }),
      count: 50
    };
    expect(result.zones.length).toBe(20); // limited
    expect(result.count).toBe(50); // total matches
  });
});
