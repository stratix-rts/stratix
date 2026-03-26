/**
 * ZoneContextManager - Zone 上下文管理器
 *
 * 管理 Agent 进入/离开 Zone 时的上下文注入，支持多 Zone 场景
 */

import type { ZoneContext, ZoneFile, ZoneInfo } from '../../stratix-agent/types';

// ============================================
// Types
// ============================================

export interface ZoneContextResult {
  success: boolean;
  context?: ZoneContext;
  error?: string;
  injectedAt: number;
}

export interface MCPToolBinding {
  skillId: string;
  mcpToolName: string;
  endpoint: string;
  authType: 'none' | 'bearer' | 'apikey';
  timeout: number;
}

// ============================================
// ZoneContextManager
// ============================================

export class ZoneContextManager {
  private static instance: ZoneContextManager;

  // Agent ID -> Zone ID (当前所在 Zone)
  private currentZoneMap: Map<string, string> = new Map();

  // Agent ID -> ZoneContext[]
  private agentZonesMap: Map<string, ZoneContext[]> = new Map();

  // Skill ID -> MCP Tool Binding
  private mcpToolBindings: Map<string, MCPToolBinding> = new Map();

  private constructor() {}

  static getInstance(): ZoneContextManager {
    if (!ZoneContextManager.instance) {
      ZoneContextManager.instance = new ZoneContextManager();
    }
    return ZoneContextManager.instance;
  }

  /**
   * 进入 Zone 时调用 - 注入 Zone 上下文
   */
  async inject(agentId: string, zoneId: string): Promise<ZoneContextResult> {
    const injectedAt = Date.now();

    try {
      // 获取 Zone 信息（从 stratix-gateway 的 ZoneService 获取）
      const zone = await this.fetchZone(zoneId);

      if (!zone) {
        return {
          success: false,
          error: `Zone not found: ${zoneId}`,
          injectedAt,
        };
      }

      // 构建 ZoneContext
      const context: ZoneContext = {
        zoneId: zone.id,
        title: zone.title,
        prompt: zone.prompt,
        files: zone.files.map(f => this.mapToZoneFile(f)),
        members: zone.members,
        enteredAt: injectedAt,
      };

      // 更新当前 Zone
      this.currentZoneMap.set(agentId, zoneId);

      // 更新 Agent 的 Zone 列表
      const zones = this.agentZonesMap.get(agentId) || [];
      const existingIndex = zones.findIndex(z => z.zoneId === zoneId);

      if (existingIndex >= 0) {
        // 更新已有 Zone 的上下文
        zones[existingIndex] = context;
      } else {
        // 添加新 Zone
        zones.push(context);
      }

      this.agentZonesMap.set(agentId, zones);

      return {
        success: true,
        context,
        injectedAt,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        injectedAt,
      };
    }
  }

  /**
   * 离开 Zone 时调用 - 移除 Agent 的 Zone 上下文
   */
  async detach(agentId: string): Promise<void> {
    // 移除当前 Zone
    this.currentZoneMap.delete(agentId);

    // 保留其他 Zone 的上下文（只清除进入时间等临时状态）
    const zones = this.agentZonesMap.get(agentId) || [];
    zones.forEach(z => {
      delete z.enteredAt;
    });
  }

  /**
   * 离开指定 Zone
   */
  async detachFromZone(agentId: string, zoneId: string): Promise<void> {
    // 如果当前 Zone 是这个，则清除
    if (this.currentZoneMap.get(agentId) === zoneId) {
      this.currentZoneMap.delete(agentId);
    }

    // 从 Zone 列表中移除
    const zones = this.agentZonesMap.get(agentId) || [];
    const filtered = zones.filter(z => z.zoneId !== zoneId);
    this.agentZonesMap.set(agentId, filtered);
  }

  /**
   * 更新 Zone 上下文
   */
  async updateContext(zoneId: string, updates: Partial<ZoneContext>): Promise<ZoneContextResult> {
    const injectedAt = Date.now();

    try {
      const zones = Array.from(this.agentZonesMap.values()).flat();
      const zoneIndex = zones.findIndex(z => z.zoneId === zoneId);

      if (zoneIndex === -1) {
        return {
          success: false,
          error: `Zone not found: ${zoneId}`,
          injectedAt,
        };
      }

      // 更新 Zone 上下文
      const zone = zones[zoneIndex];
      const updatedZone: ZoneContext = {
        ...zone,
        ...updates,
        zoneId: zone.zoneId, // 保持 zoneId 不变
      };

      // 更新存储
      const entry = Array.from(this.agentZonesMap.entries())
        .find(([_, zones]) => zones.some(z => z.zoneId === zoneId));
      const agentId = entry?.[0];

      if (agentId) {
        const agentZones = this.agentZonesMap.get(agentId) || [];
        const idx = agentZones.findIndex(z => z.zoneId === zoneId);
        if (idx !== -1) {
          agentZones[idx] = updatedZone;
          this.agentZonesMap.set(agentId, agentZones);
        }
      }

      return {
        success: true,
        context: updatedZone,
        injectedAt,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update zone context',
        injectedAt,
      };
    }
  }

  /**
   * 获取 Agent 当前 Zone 的上下文
   */
  getContext(agentId: string): ZoneContext | null {
    const currentZoneId = this.currentZoneMap.get(agentId);
    if (!currentZoneId) return null;

    const zones = this.agentZonesMap.get(agentId) || [];
    return zones.find(z => z.zoneId === currentZoneId) || null;
  }

  /**
   * 获取 Agent 所属的所有 Zone 上下文
   */
  getAgentZones(agentId: string): ZoneContext[] {
    return this.agentZonesMap.get(agentId) || [];
  }

  /**
   * 注册 MCP 工具绑定
   */
  registerMCPTool(binding: MCPToolBinding): void {
    this.mcpToolBindings.set(binding.skillId, binding);
  }

  /**
   * 获取技能对应的 MCP 工具
   */
  getMCPTool(skillId: string): MCPToolBinding | null {
    return this.mcpToolBindings.get(skillId) || null;
  }

  /**
   * 获取所有 MCP 工具绑定
   */
  getAllMCPTools(): MCPToolBinding[] {
    return Array.from(this.mcpToolBindings.values());
  }

  /**
   * 获取所有可进入的 Zone 列表
   */
  async getAvailableZones(projectId: string = '-'): Promise<ZoneInfo[]> {
    try {
      const baseUrl = process.env.GATEWAY_URL || 'http://127.0.0.1:7524';
      const response = await fetch(`${baseUrl}/api/zones`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        console.warn(`[ZoneContextManager] Failed to fetch zones: ${response.status}`);
        return [];
      }

      const data = await response.json();
      if (data.success && Array.isArray(data.zones)) {
        return data.zones.map((zone: any) => ({
          zoneId: zone.id || zone.zoneId,
          name: zone.name || '',
          title: zone.title || zone.name || '',
          prompt: zone.prompt || '',
          x: zone.x || 0,
          y: zone.y || 0,
          width: zone.width || 100,
          height: zone.height || 100,
          agentCount: zone.members?.length || 0,
          status: zone.status,
        }));
      }
      return [];
    } catch (error) {
      console.warn('[ZoneContextManager] Error fetching zones:', error);
      return [];
    }
  }

  /**
   * 获取 Zone 提示词上下文
   */
  async getZonePromptContext(agentId: string, projectId: string = '-'): Promise<{
    inZone: boolean;
    currentZone?: ZoneContext;
    availableZones: ZoneInfo[];
  }> {
    const currentZone = this.getContext(agentId);
    const availableZones = await this.getAvailableZones(projectId);

    return {
      inZone: currentZone !== null,
      currentZone: currentZone || undefined,
      availableZones,
    };
  }

  /**
   * 从 stratix-gateway 获取 Zone 信息
   */
  private async fetchZone(zoneId: string): Promise<{
    id: string;
    title: string;
    prompt: string;
    files: Array<{
      id: string;
      name: string;
      source: string;
      content?: string;
    }>;
    members: string[];
  } | null> {
    try {
      const baseUrl = process.env.GATEWAY_URL || 'http://127.0.0.1:7524';
      const response = await fetch(`${baseUrl}/api/zones/${zoneId}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        console.warn(`[ZoneContextManager] Failed to fetch zone ${zoneId}: ${response.status}`);
        return null;
      }

      const data = await response.json();
      if (data.success && data.zone) {
        return data.zone;
      }
      return null;
    } catch (error) {
      console.warn(`[ZoneContextManager] Error fetching zone ${zoneId}:`, error);
      return null;
    }
  }

  /**
   * 将 ZoneFile 转换为 ZoneContext 格式
   */
  private mapToZoneFile(file: {
    id: string;
    name: string;
    source: string;
    content?: string;
  }): ZoneFile {
    return {
      id: file.id,
      name: file.name,
      path: file.source,
      content: file.content,
    };
  }

  /**
   * 清空所有数据（测试用）
   */
  clear(): void {
    this.currentZoneMap.clear();
    this.agentZonesMap.clear();
    this.mcpToolBindings.clear();
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalAgents: number;
    totalZones: number;
    mcpTools: number;
  } {
    return {
      totalAgents: this.currentZoneMap.size,
      totalZones: new Set(Array.from(this.currentZoneMap.values())).size,
      mcpTools: this.mcpToolBindings.size,
    };
  }
}

// ============================================
// Singleton Export
// ============================================

export const zoneContextManager = ZoneContextManager.getInstance();
