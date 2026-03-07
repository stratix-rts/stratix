/**
 * AgentPanel Vue 组件配置
 */

import type { ComponentToken } from '../../types';

export const VueAgentPanelConfig: ComponentToken = {
  size: {
    width: '100%',
    height: 'auto',
    minHeight: '60px',
  },
  layout: {
    padding: 'md',
    gap: 'md',
  },
  style: {
    background: '#12121a',
    border: '1px solid #2a2a3e',
    borderRadius: 'md',
  },
  responsive: {
    mobile: {
      padding: 'sm',
    },
  },
  animation: {
    enter: {
      duration: 250,
      easing: 'ease-out',
    },
  },
} as const;

/**
 * Agent 状态指示器配置
 */
export const AgentStatusConfig = {
  online: {
    color: '#00ff88',
    pulse: true,
  },
  busy: {
    color: '#fbbf24',
    pulse: true,
  },
  offline: {
    color: '#6a6a8a',
    pulse: false,
  },
  error: {
    color: '#ff4444',
    pulse: true,
  },
} as const;
