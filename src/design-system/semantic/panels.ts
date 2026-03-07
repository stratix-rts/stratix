/**
 * 面板语义 Token
 * 
 * 映射全局 Token 到面板场景
 */

export const PanelSemantic = {
  default: {
    background: '#12121a',
    border: '1px solid #2a2a3e',
    borderRadius: '4px',
    padding: '16px',
    boxShadow: '0 4px 8px rgba(0, 0, 0, 0.4)',
  },
  
  elevated: {
    background: '#1a1a2e',
    border: '1px solid #3a3a5e',
    borderRadius: '4px',
    padding: '20px',
    boxShadow: '0 8px 16px rgba(0, 0, 0, 0.5)',
  },
  
  outlined: {
    background: 'transparent',
    border: '1px solid #2a2a3e',
    borderRadius: '4px',
    padding: '16px',
    boxShadow: 'none',
  },
  
  ghost: {
    background: 'rgba(18, 18, 26, 0.5)',
    border: 'none',
    borderRadius: '4px',
    padding: '16px',
    boxShadow: 'none',
  },
} as const;

/**
 * 获取面板样式
 */
export function getPanelStyle(variant: keyof typeof PanelSemantic) {
  return PanelSemantic[variant];
}
