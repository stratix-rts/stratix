/**
 * 输入框语义 Token
 */

export const InputSemantic = {
  default: {
    background: '#1a1a2e',
    border: '1px solid #2a2a3e',
    borderRadius: '4px',
    padding: '8px 12px',
    text: '#ffffff',
    placeholder: '#6a6a8a',
    focusBorder: '#00ffff',
    errorBorder: '#ff4444',
  },
  
  filled: {
    background: '#12121a',
    border: 'none',
    borderRadius: '4px',
    padding: '10px 14px',
    text: '#ffffff',
    placeholder: '#6a6a8a',
    focusBorder: '#00ffff',
    errorBorder: '#ff4444',
  },
  
  outlined: {
    background: 'transparent',
    border: '1px solid #2a2a3e',
    borderRadius: '4px',
    padding: '8px 12px',
    text: '#ffffff',
    placeholder: '#6a6a8a',
    focusBorder: '#00ffff',
    errorBorder: '#ff4444',
  },
} as const;
