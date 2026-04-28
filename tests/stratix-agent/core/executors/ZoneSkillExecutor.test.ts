import { ZoneSkillExecutor } from '@/stratix-agent/core/executors/ZoneSkillExecutor';
import { SkillDefinition, ExecutionContext } from '@/stratix-agent/types';

jest.mock('@/stratix-character-creator/core/ZoneContextManager', () => ({
  zoneContextManager: {
    inject: jest.fn().mockResolvedValue({ success: true }),
    detachFromZone: jest.fn().mockResolvedValue(undefined),
  },
}));

describe('ZoneSkillExecutor', () => {
  let executor: ZoneSkillExecutor;
  let mockContext: ExecutionContext;
  let originalFetch: typeof global.fetch;
  let originalGatewayUrl: string | undefined;

  beforeEach(() => {
    executor = new ZoneSkillExecutor();
    mockContext = {
      agentId: 'agent-1',
      variables: { projectId: 'project-1' },
    };
    originalFetch = global.fetch;
    global.fetch = jest.fn();
    originalGatewayUrl = process.env.GATEWAY_URL;
    process.env.GATEWAY_URL = 'http://localhost:7524';
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.GATEWAY_URL = originalGatewayUrl;
  });

  function mockFetchResponse(data: any, ok = true, status = 200) {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok,
      status,
      json: async () => data,
      text: async () => 'error',
    });
  }

  describe('zone_move_to', () => {
    const moveSkill: SkillDefinition = {
      skillId: 'zone_move_to',
      name: 'Zone Move To',
      description: 'Move to a zone',
      parameters: [],
      executor: 'zone',
    };

    test('moves to zone successfully', async () => {
      mockFetchResponse({
        zone: { title: 'Test Zone', name: 'test-zone', members: ['agent-1', 'agent-2'] },
      });

      const result = await executor.execute(moveSkill, { zoneId: 'zone-1', reason: 'testing' }, mockContext);

      expect(result.success).toBe(true);
      expect(result.zoneId).toBe('zone-1');
      expect(result.zoneName).toBe('Test Zone');
      expect(result.memberCount).toBe(2);
    });

    test('throws when zoneId is missing', async () => {
      await expect(executor.execute(moveSkill, {}, mockContext))
        .rejects.toThrow('zoneId is required');
    });

    test('throws when API returns error', async () => {
      mockFetchResponse({}, false, 404);

      await expect(executor.execute(moveSkill, { zoneId: 'zone-1' }, mockContext))
        .rejects.toThrow('Failed to move to zone');
    });

    test('retries on 5xx errors then succeeds', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}), text: async () => 'Bad Gateway' })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ zone: { title: 'Zone', members: [] } }),
          text: async () => '',
        });

      const result = await executor.execute(moveSkill, { zoneId: 'zone-1' }, mockContext);

      expect(result.success).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('zone_leave', () => {
    const leaveSkill: SkillDefinition = {
      skillId: 'zone_leave',
      name: 'Zone Leave',
      description: 'Leave a zone',
      parameters: [],
      executor: 'zone',
    };

    test('leaves zone with direct zoneId', async () => {
      mockFetchResponse({});

      const result = await executor.execute(leaveSkill, { zoneId: 'zone-1', reason: 'done' }, mockContext);

      expect(result.success).toBe(true);
      expect(result.previousZoneId).toBe('zone-1');
    });

    test('leaves zone by finding current zone via projectId', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          zones: [
            { id: 'zone-1', members: ['agent-1'] },
            { id: 'zone-2', members: ['agent-2'] },
          ],
        }),
        text: async () => '',
      });

      const result = await executor.execute(leaveSkill, {}, mockContext);

      expect(result.success).toBe(true);
      expect(result.previousZoneId).toBe('zone-1');
    });

    test('returns alreadyLeft when not in any zone', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ zones: [{ id: 'zone-1', members: ['agent-2'] }] }),
        text: async () => '',
      });

      const result = await executor.execute(leaveSkill, {}, mockContext);

      expect(result.success).toBe(true);
      expect(result.alreadyLeft).toBe(true);
    });

    test('throws when projectId is missing and no zoneId provided', async () => {
      const contextWithoutProject = { agentId: 'agent-1' };

      await expect(executor.execute(leaveSkill, {}, contextWithoutProject))
        .rejects.toThrow('projectId is required');
    });

    test('throws when API returns error', async () => {
      mockFetchResponse({}, false, 500);

      await expect(executor.execute(leaveSkill, { zoneId: 'zone-1' }, mockContext))
        .rejects.toThrow('Failed to leave zone');
    });
  });

  describe('zone_list', () => {
    const listSkill: SkillDefinition = {
      skillId: 'zone_list',
      name: 'Zone List',
      description: 'List zones',
      parameters: [],
      executor: 'zone',
    };

    test('lists zones successfully', async () => {
      mockFetchResponse({
        zones: [
          { id: 'zone-1', name: 'Zone 1', title: 'Zone One', members: ['agent-1'], status: 'active' },
          { id: 'zone-2', name: 'Zone 2', title: 'Zone Two', members: [], status: 'inactive' },
        ],
      });

      const result = await executor.execute(listSkill, {}, mockContext);

      expect(result.success).toBe(true);
      expect(result.zones).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.zones[0]).toHaveProperty('zoneId');
      expect(result.zones[0]).toHaveProperty('name');
      expect(result.zones[0]).toHaveProperty('agentCount');
    });

    test('throws when projectId is missing', async () => {
      const contextWithoutProject = { agentId: 'agent-1' };

      await expect(executor.execute(listSkill, {}, contextWithoutProject))
        .rejects.toThrow('projectId is required');
    });

    test('throws when API returns error', async () => {
      mockFetchResponse({}, false, 403);

      await expect(executor.execute(listSkill, {}, mockContext))
        .rejects.toThrow('Failed to list zones');
    });

    test('uses projectId from params over context', async () => {
      mockFetchResponse({ zones: [] });

      await executor.execute(listSkill, { projectId: 'param-project' }, mockContext);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('projectId=param-project'),
        expect.any(Object)
      );
    });
  });

  describe('zone_info', () => {
    const infoSkill: SkillDefinition = {
      skillId: 'zone_info',
      name: 'Zone Info',
      description: 'Get zone info',
      parameters: [],
      executor: 'zone',
    };

    test('gets zone info successfully', async () => {
      mockFetchResponse({ zone: { id: 'zone-1', name: 'Zone 1' } });

      const result = await executor.execute(infoSkill, { zoneId: 'zone-1' }, mockContext);

      expect(result.success).toBe(true);
      expect(result.zone).toEqual({ id: 'zone-1', name: 'Zone 1' });
    });

    test('throws when zoneId is missing', async () => {
      await expect(executor.execute(infoSkill, {}, mockContext))
        .rejects.toThrow('zoneId is required');
    });

    test('throws when API returns error', async () => {
      mockFetchResponse({}, false, 404);

      await expect(executor.execute(infoSkill, { zoneId: 'zone-1' }, mockContext))
        .rejects.toThrow('Failed to get zone info');
    });
  });

  describe('zone_search', () => {
    const searchSkill: SkillDefinition = {
      skillId: 'zone_search',
      name: 'Zone Search',
      description: 'Search zones',
      parameters: [],
      executor: 'zone',
    };

    test('searches zones successfully', async () => {
      mockFetchResponse({
        zones: [
          { id: 'zone-1', name: 'Dev Zone', title: 'Development', members: ['agent-1'] },
        ],
      });

      const result = await executor.execute(searchSkill, { keyword: 'dev' }, mockContext);

      expect(result.success).toBe(true);
      expect(result.total).toBe(1);
      expect(result.keyword).toBe('dev');
      expect(result.searchedAt).toBeDefined();
    });

    test('throws when keyword is missing', async () => {
      await expect(executor.execute(searchSkill, {}, mockContext))
        .rejects.toThrow('keyword is required');
    });

    test('throws when keyword is too short', async () => {
      await expect(executor.execute(searchSkill, { keyword: 'a' }, mockContext))
        .rejects.toThrow('minimum 2 characters');
    });

    test('throws when API returns error', async () => {
      mockFetchResponse({}, false, 500);

      await expect(executor.execute(searchSkill, { keyword: 'test' }, mockContext))
        .rejects.toThrow('Failed to search zones');
    });
  });

  describe('unknown skill', () => {
    test('throws for unknown zone skill', async () => {
      const unknownSkill: SkillDefinition = {
        skillId: 'zone_unknown',
        name: 'Unknown',
        description: 'Unknown',
        parameters: [],
        executor: 'zone',
      };

      await expect(executor.execute(unknownSkill, {}, mockContext))
        .rejects.toThrow('Unknown zone skill');
    });
  });
});
