/**
 * 按钮语义 Token
 * 
 * 映射全局 Token 到按钮场景
 */

import { getToken } from '../config';

export const ButtonSemantic = {
  primary: {
    background: '#00ffff',
    hover: '#00e6e6',
    active: '#00cccc',
    text: '#0d0d14',
    border: 'none',
    borderRadius: '4px',
    padding: '8px 16px',
    animation: {
      duration: 150,
    },
  },
  
  secondary: {
    background: 'transparent',
    hover: 'rgba(0, 212, 255, 0.1)',
    active: 'rgba(0, 212, 255, 0.2)',
    text: '#ffffff',
    border: '1px solid #2a2a3e',
    borderRadius: '4px',
    padding: '8px 16px',
    animation: {
      duration: 150,
    },
  },
  
  success: {
    background: '#00ff88',
    hover: '#00e67a',
    active: '#00cc70',
    text: '#0d0d14',
    border: 'none',
    borderRadius: '4px',
    padding: '8px 16px',
    animation: {
      duration: 150,
    },
  },
  
  danger: {
    background: '#ff4444',
    hover: '#ff3333',
    active: '#ff2222',
    text: '#ffffff',
    border: 'none',
    borderRadius: '4px',
    padding: '8px 16px',
    animation: {
      duration: 150,
    },
  },
  
  disabled: {
    background: '#2a2a3e',
    hover: '#2a2a3e',
    active: '#2a2a3e',
    text: '#6a6a8a',
    border: 'none',
    borderRadius: '4px',
    padding: '8px 16px',
    animation: {
      duration: 0,
    },
  },
} as const;

/**
 * 获取按钮样式
 */
export function getButtonStyle(variant: keyof typeof ButtonSemantic) {
  return ButtonSemantic[variant];
}
