/**
 * 状态语义 Token
 */

export const StatusSemantic = {
  success: {
    background: 'rgba(0, 255, 136, 0.1)',
    border: '1px solid #00ff88',
    text: '#00ff88',
    icon: 'success',
  },
  
  warning: {
    background: 'rgba(251, 191, 36, 0.1)',
    border: '1px solid #fbbf24',
    text: '#fbbf24',
    icon: 'warning',
  },
  
  danger: {
    background: 'rgba(255, 68, 68, 0.1)',
    border: '1px solid #ff4444',
    text: '#ff4444',
    icon: 'error',
  },
  
  info: {
    background: 'rgba(0, 212, 255, 0.1)',
    border: '1px solid #00d4ff',
    text: '#00d4ff',
    icon: 'info',
  },
} as const;
