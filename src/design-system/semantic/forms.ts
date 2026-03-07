/**
 * 表单语义 Token
 * 
 * 用于统一表单组件的视觉样式
 */

export const FormSemantic = {
  field: {
    default: {
      background: '#1a1a2e',
      border: '#2a2a3e',
      text: '#ffffff',
    },
    hover: {
      background: '#2a2a3e',
      border: '#3a3a5e',
    },
    focus: {
      border: '#00ffff',
      shadow: 'rgba(0, 255, 255, 0.15)',
    },
    error: {
      border: '#ff4444',
      shadow: 'rgba(255, 68, 68, 0.15)',
      text: '#ff4444',
    },
    success: {
      border: '#00ff88',
      shadow: 'rgba(0, 255, 136, 0.15)',
    },
    disabled: {
      background: '#12121a',
      text: '#6a6a8a',
      opacity: 0.5,
    },
  },
  
  label: {
    default: {
      color: '#cbd5e1',
      fontSize: '13px',
      fontWeight: 500,
    },
    required: {
      color: '#ff4444',
      marker: '*',
    },
    optional: {
      color: '#64748b',
    },
  },
  
  helpText: {
    default: {
      color: '#64748b',
      fontSize: '12px',
    },
    error: {
      color: '#ff4444',
    },
    success: {
      color: '#00ff88',
    },
  },
  
  layout: {
    gap: '16px',
    fieldMarginBottom: '8px',
    actionsGap: '12px',
    actionsPaddingTop: '16px',
  },
} as const;

/**
 * 表单尺寸规范
 */
export const FormSizes = {
  sm: {
    height: '32px',
    padding: '4px 8px',
    fontSize: '12px',
    labelFontSize: '11px',
  },
  md: {
    height: '40px',
    padding: '8px 12px',
    fontSize: '14px',
    labelFontSize: '13px',
  },
  lg: {
    height: '48px',
    padding: '12px 16px',
    fontSize: '16px',
    labelFontSize: '14px',
  },
} as const;
