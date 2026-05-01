import Phaser from 'phaser';

// ============================================================================
// Types
// ============================================================================

export interface AgentInfo {
  agentId: string;
  name: string;
  type: string;
  status: string;
  position: { x: number; y: number };
  currentTask?: string;
  taskProgress?: number;
  skills?: Record<string, number>;
}

export interface ZoneInfo {
  zoneId: string;
  name: string;
  status: string;
  agentCount: number;
}

export interface Skill {
  skillId: string;
  name: string;
  description: string;
  icon?: string;
  hotkey?: string;
}

export interface UnitInfo {
  name: string;
  type: string;
  status: string;
  thumbnail?: string;
  health?: number;
  maxHealth?: number;
  currentTask?: string;
  taskProgress?: number;
  skills?: Record<string, number>;
}

export interface CommandPanelCallbacks {
  onChatClick: (agentIds: string[]) => void;
  onConfigClick: (agentId: string) => void;
  onTaskClick: (agentIds: string[]) => void;
  onStopClick: (agentIds: string[]) => void;
  onAgentDeselect?: (agentId: string) => void;
  onSelectAll?: () => void;
  onDeselectAll?: () => void;
}

export type PanelState = 'empty' | 'single_agent' | 'multi_agent' | 'zone';

export interface PanelData {
  agents: AgentInfo[];
  zone: ZoneInfo | null;
  skills: Skill[];
  isLoading: boolean;
}

export interface RenderContext {
  scene: Phaser.Scene;
  fontFamily: string;
  getBackgroundColor: () => string;
  getBackgroundSecondaryColor: () => string;
  getBackgroundTertiaryColor: () => string;
  getTextPrimaryColor: () => string;
  getTextSecondaryColor: () => string;
  getTextMutedColor: () => string;
  getBorderColor: () => string;
  getAccentColor: () => string;
  getPrimaryColor: () => string;
  getSuccessColor: () => string;
  getWarningColor: () => string;
  getDangerColor: () => string;
  getContentHeight: () => number;
  getProgressGradKey: () => string | null;
  getEmptyGradKey: () => string | null;
  hexToNumber: (hex: string) => number;
}

// ============================================================================
// Utility functions
// ============================================================================

export function getStatusColor(
  status: string,
  success: string,
  warning: string,
  danger: string,
  muted: string
): string {
  const colors: Record<string, string> = {
    online: success,
    offline: muted,
    busy: warning,
    error: danger,
  };
  return colors[status] || muted;
}

export function getStatusText(status: string): string {
  const texts: Record<string, string> = {
    online: '在线',
    offline: '离线',
    busy: '忙碌',
    error: '错误',
  };
  return texts[status] || '未知';
}

export function getZoneStatusColor(
  status: string,
  success: string,
  warning: string,
  danger: string,
  muted: string
): string {
  const colors: Record<string, string> = {
    idle: muted,
    busy: warning,
    active: success,
    error: danger,
  };
  return colors[status] || muted;
}

export function getZoneStatusText(status: string): string {
  const texts: Record<string, string> = {
    idle: '空闲',
    busy: '忙碌',
    active: '活跃',
    error: '错误',
  };
  return texts[status] || '未知';
}
