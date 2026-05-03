export const designTokens = {
  colors: {
    background: {
      primary: '#020617',
      secondary: '#0F172A',
      tertiary: '#1E293B',
      hover: '#1E293B',
      card: '#0F172A',
    },
    border: {
      primary: '#1E293B',
      secondary: '#334155',
      focus: '#22C55E',
    },
    text: {
      primary: '#F8FAFC',
      secondary: '#94A3B8',
      muted: '#64748B',
    },
    accent: {
      primary: '#22C55E',
      secondary: '#4A90E2',
      warning: '#E67E22',
      danger: '#EF4444',
      purple: '#9B59B6',
    },
    hero: {
      writer: '#4A90E2',
      dev: '#9B59B6',
      analyst: '#E67E22',
    },
  },
  fonts: {
    sans: "'Fira Sans', sans-serif",
    mono: "'Fira Code', monospace",
  },
  radius: {
    sm: '4px',
    md: '8px',
    lg: '12px',
    full: '9999px',
  },
  transitions: {
    fast: '150ms ease',
    normal: '200ms ease',
    slow: '300ms ease',
  },
  shadows: {
    sm: '0 1px 2px rgba(0, 0, 0, 0.3)',
    md: '0 4px 6px rgba(0, 0, 0, 0.3)',
    focus: '0 0 0 2px rgba(34, 197, 94, 0.2)',
  },
};

export type HeroColorType = 'writer' | 'dev' | 'analyst';

export const getHeroColor = (type: HeroColorType | string): string => {
  const colors: Record<HeroColorType, string> = {
    writer: designTokens.colors.hero.writer,
    dev: designTokens.colors.hero.dev,
    analyst: designTokens.colors.hero.analyst,
  };
  return colors[type as HeroColorType] || designTokens.colors.text.muted;
};

export const commonStyles = `
@import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600;700&family=Fira+Sans:wght@300;400;500;600;700&display=swap');

.designer-base {
  font-family: 'Fira Sans', sans-serif;
  background: #020617;
  border-radius: 12px;
  padding: 16px;
  color: #F8FAFC;
}

.section-title {
  font-family: 'Fira Code', monospace;
  font-size: 14px;
  font-weight: 600;
  color: #F8FAFC;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.card {
  background: #0F172A;
  border: 1px solid #1E293B;
  border-radius: 8px;
  padding: 16px;
}

.card:hover {
  border-color: #334155;
}

.btn-primary {
  background: #22C55E;
  color: #020617;
  border: none;
  padding: 8px 16px;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  transition: all 200ms ease;
}

.btn-primary:hover {
  background: #16A34A;
  transform: translateY(-1px);
}

.btn-secondary {
  background: transparent;
  color: #F8FAFC;
  border: 1px solid #1E293B;
  padding: 8px 16px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 200ms ease;
}

.btn-secondary:hover {
  background: #1E293B;
  border-color: #334155;
}

.input-field {
  width: 100%;
  padding: 10px 14px;
  background: #0F172A;
  border: 1px solid #1E293B;
  border-radius: 8px;
  color: #F8FAFC;
  font-size: 14px;
  transition: border-color 200ms ease;
}

.input-field::placeholder {
  color: #64748B;
}

.input-field:focus {
  outline: none;
  border-color: #22C55E;
  box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.2);
}

.textarea-field {
  width: 100%;
  padding: 10px 14px;
  background: #0F172A;
  border: 1px solid #1E293B;
  border-radius: 8px;
  color: #F8FAFC;
  font-size: 14px;
  resize: vertical;
  min-height: 80px;
  transition: border-color 200ms ease;
}

.textarea-field::placeholder {
  color: #64748B;
}

.textarea-field:focus {
  outline: none;
  border-color: #22C55E;
  box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.2);
}

.label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: #94A3B8;
  margin-bottom: 6px;
}

.label-required::after {
  content: ' *';
  color: #EF4444;
}

.tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  background: rgba(34, 197, 94, 0.1);
  color: #22C55E;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
}

.icon-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid #1E293B;
  border-radius: 6px;
  color: #94A3B8;
  cursor: pointer;
  transition: all 200ms ease;
}

.icon-btn:hover {
  background: #1E293B;
  color: #F8FAFC;
}

.icon-btn.danger:hover {
  background: rgba(239, 68, 68, 0.1);
  border-color: #EF4444;
  color: #EF4444;
}

.divider {
  height: 1px;
  background: #1E293B;
  margin: 16px 0;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px;
  color: #64748B;
}

.empty-state svg {
  width: 48px;
  height: 48px;
  margin-bottom: 12px;
  stroke: currentColor;
  stroke-width: 1.5;
}

/* Scrollbar */
::-webkit-scrollbar {
  width: 6px;
}

::-webkit-scrollbar-track {
  background: #0F172A;
  border-radius: 3px;
}

::-webkit-scrollbar-thumb {
  background: #334155;
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: #475569;
}

/* Animations */
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.animate-fade-in {
  animation: fadeIn 200ms ease;
}

/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
`;
