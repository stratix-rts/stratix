import { SkillDefinition, SkillExecutor, ExecutionContext } from '../../types';

interface ZoneApiItem {
  id?: string;
  zoneId?: string;
  name?: string;
  title?: string;
  prompt?: string;
  members?: unknown[];
  status?: string;
  createdAt?: string;
}

/**
 * 带重试的 fetch 封装
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number = 3,
  baseDelayMs: number = 100,
  timeoutMs: number = 30000
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);

      // 5xx 错误或网络错误时重试
      if (!response.ok && response.status >= 500 && attempt < maxRetries) {
        lastError = new Error(`HTTP ${response.status}`);
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error instanceof Error ? error : new Error(String(error));

      // 网络错误（超时、连接失败等）时重试
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
    }
  }

  throw lastError || new Error('Max retries exceeded');
}

/**
 * Zone 操作执行器
 * 支持 Agent 进入/离开 Zone，获取 Zone 列表和详情
 *
 * NOTE: 使用 lazy import 引入 zoneContextManager 以避免循环依赖
 */
export class ZoneSkillExecutor implements SkillExecutor {
  async execute(
    skill: SkillDefinition,
    params: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<unknown> {
    const { agentId } = context;
    const gatewayUrl = process.env.GATEWAY_URL || 'http://127.0.0.1:7524';

    // Lazy import to avoid circular dependency at module load time
    const { zoneContextManager } = await import('../../../stratix-character-creator/core/ZoneContextManager');

    switch (skill.skillId) {
      case 'zone_move_to': {
        const zoneId = typeof params.zoneId === 'string' ? params.zoneId : '';
        const reason = typeof params.reason === 'string' ? params.reason : undefined;
        if (!zoneId) {
          throw new Error('zoneId is required for zone_move_to');
        }

        const response = await fetchWithRetry(`${gatewayUrl}/api/zones/${zoneId}/members/${agentId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason }),
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Failed to move to zone: ${response.status} ${error}`);
        }

        const data = await response.json();

        // Update ZoneContextManager to track agent's current zone
        await zoneContextManager.inject(agentId, zoneId);

        return {
          success: true,
          message: `Successfully moved to zone ${zoneId}`,
          zoneId,
          zoneName: data.zone?.title || data.zone?.name,
          memberCount: data.zone?.members?.length || 1
        };
      }

      case 'zone_leave': {
        const reason = typeof params.reason === 'string' ? params.reason : undefined;
        const directZoneId = typeof params.zoneId === 'string' ? params.zoneId : undefined;
        // zoneId can come from params or context.variables
        const zoneId = typeof params.zoneId === 'string' ? params.zoneId :
          (typeof context.variables?.zoneId === 'string' ? context.variables.zoneId : undefined);

        let currentZoneId = directZoneId;

        // If zoneId not provided directly, need zoneId to find current zone
        if (!currentZoneId) {
          if (!zoneId) {
            throw new Error('zoneId is required for zone_leave (pass zoneId directly or set context.variables.zoneId)');
          }

          // First get current zone membership
          const listResponse = await fetchWithRetry(`${gatewayUrl}/api/zones?zoneId=${encodeURIComponent(zoneId)}`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
          });

          if (listResponse.ok) {
            const listData = await listResponse.json();
            const zones = listData.zones || [];
            for (const zone of zones) {
              if (zone.members && zone.members.includes(agentId)) {
                currentZoneId = zone.id || zone.zoneId;
                break;
              }
            }
          }
        }

        if (!currentZoneId) {
          return {
            success: true,
            message: 'Not currently in any zone',
            alreadyLeft: true
          };
        }

        const response = await fetchWithRetry(`${gatewayUrl}/api/zones/${currentZoneId}/members/${agentId}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason }),
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Failed to leave zone: ${response.status} ${error}`);
        }

        // Update ZoneContextManager to remove agent from zone
        await zoneContextManager.detachFromZone(agentId, currentZoneId);

        return {
          success: true,
          message: `Successfully left zone ${currentZoneId}`,
          previousZoneId: currentZoneId
        };
      }

      case 'zone_list': {
        // zoneId can come from params or context.variables
        const zoneId = typeof params.zoneId === 'string' ? params.zoneId :
          (typeof context.variables?.zoneId === 'string' ? context.variables.zoneId : undefined);
        if (!zoneId) {
          throw new Error('zoneId is required for zone_list (pass as param or set in context.variables.zoneId)');
        }

        const response = await fetchWithRetry(`${gatewayUrl}/api/zones?zoneId=${encodeURIComponent(zoneId)}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });

        if (!response.ok) {
          throw new Error(`Failed to list zones: ${response.status}`);
        }

        const data = await response.json();
        const zones = (data.zones || []).map((zone: ZoneApiItem) => ({
          zoneId: zone.id || zone.zoneId,
          name: zone.name || zone.title || 'Unnamed Zone',
          title: zone.title || '',
          prompt: zone.prompt || '',
          agentCount: zone.members?.length || 0,
          status: zone.status
        }));

        return {
          success: true,
          zones,
          total: zones.length
        };
      }

      case 'zone_info': {
        const { zoneId } = params;
        if (!zoneId) {
          throw new Error('zoneId is required for zone_info');
        }

        const response = await fetchWithRetry(`${gatewayUrl}/api/zones/${zoneId}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });

        if (!response.ok) {
          throw new Error(`Failed to get zone info: ${response.status}`);
        }

        const data = await response.json();
        return {
          success: true,
          zone: data.zone
        };
      }

      case 'zone_search': {
        const keyword = typeof params.keyword === 'string' ? params.keyword : '';
        const limit = typeof params.limit === 'number' ? params.limit : 20;
        if (!keyword || keyword.trim().length < 2) {
          throw new Error('keyword is required for zone_search (minimum 2 characters)');
        }

        const response = await fetchWithRetry(
          `${gatewayUrl}/api/zones/search?keyword=${encodeURIComponent(keyword)}&limit=${encodeURIComponent(String(limit))}`,
          {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
          }
        );

        if (!response.ok) {
          throw new Error(`Failed to search zones: ${response.status}`);
        }

        const data = await response.json();
        const zones = (data.zones || []).map((zone: ZoneApiItem & { zoneId?: string }) => ({
          zoneId: zone.id || zone.zoneId,
          name: zone.name || zone.title || 'Unnamed Zone',
          title: zone.title || '',
          prompt: zone.prompt || '',
          agentCount: zone.members?.length || 0,
          status: zone.status,
        }));

        return {
          success: true,
          zones,
          total: zones.length,
          keyword,
          searchedAt: Date.now()
        };
      }

      case 'zone_recent': {
        // Get recently created zones for potential joining
        // Agent can call this to discover new zones that might need agents
        const limit = typeof params.limit === 'number' ? params.limit : 10;
        const zoneId = typeof params.zoneId === 'string' ? params.zoneId : undefined;

        let url = `${gatewayUrl}/api/zones?limit=${encodeURIComponent(String(limit))}`;
        if (zoneId) {
          url += `&zoneId=${encodeURIComponent(zoneId)}`;
        }

        const response = await fetchWithRetry(url, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });

        if (!response.ok) {
          throw new Error(`Failed to get recent zones: ${response.status}`);
        }

        const data = await response.json();
        const zones = (data.zones || []).map((zone: ZoneApiItem & { zoneId?: string; createdAt?: string }) => ({
          zoneId: zone.id || zone.zoneId,
          name: zone.name || zone.title || 'Unnamed Zone',
          title: zone.title || '',
          prompt: zone.prompt || '',
          agentCount: zone.members?.length || 0,
          status: zone.status,
          createdAt: zone.createdAt
        }));

        return {
          success: true,
          zones,
          total: zones.length,
          fetchedAt: Date.now()
        };
      }

      default:
        throw new Error(`Unknown zone skill: ${skill.skillId}`);
    }
  }
}
