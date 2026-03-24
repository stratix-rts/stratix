export interface ModalSizeConfig {
  width: string;
  maxWidth?: string;
  height?: string;
  maxHeight?: string;
  padding: string;
  borderRadius?: string;
  iconSize: number;
}

export interface ModalToken {
  size: {
    sm: ModalSizeConfig;
    md: ModalSizeConfig;
    lg: ModalSizeConfig;
    xl: ModalSizeConfig;
    fullscreen: ModalSizeConfig;
  };
  drawer: {
    width: string;
    height: string;
  };
  style: {
    borderRadius: string;
    shadow: string;
    maskBackground: string;
  };
  header: {
    gradient: {
      background: string;
      borderBottom: string;
    };
    solid: {
      background: string;
      borderBottom: string;
    };
  };
  animation: {
    duration: number;
    easing: string;
  };
}

export const ModalBaseConfig: ModalToken = {
  size: {
    sm: { 
      width: '400px', 
      maxWidth: '90vw',
      padding: '16px',
      iconSize: 14,
    },
    md: { 
      width: '520px', 
      maxWidth: '90vw',
      padding: '20px',
      iconSize: 16,
    },
    lg: { 
      width: '720px', 
      maxWidth: '90vw',
      padding: '24px',
      iconSize: 16,
    },
    xl: { 
      width: '900px', 
      maxWidth: '95vw',
      padding: '24px',
      iconSize: 18,
    },
    fullscreen: { 
      width: '100vw', 
      height: '100vh',
      maxWidth: '100vw',
      maxHeight: '100vh',
      padding: '24px',
      borderRadius: '0',
      iconSize: 18,
    },
  },
  drawer: {
    width: '400px',
    height: '100vh',
  },
  style: {
    borderRadius: '12px',
    shadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
    maskBackground: 'rgba(0, 0, 0, 0.5)',
  },
  header: {
    gradient: {
      background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
      borderBottom: '1px solid var(--ds-border)',
    },
    solid: {
      background: 'var(--ds-bg-secondary)',
      borderBottom: '1px solid var(--ds-border)',
    },
  },
  animation: {
    duration: 200,
    easing: 'ease-in-out',
  },
};

export const POSITION_CONFIG = {
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    animation: 'zoom',
  },
  bottom: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    animation: 'slide-up',
  },
  top: {
    alignItems: 'flex-start',
    justifyContent: 'center',
    animation: 'slide-down',
  },
  left: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    animation: 'slide-right',
    isDrawer: true,
  },
  right: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    animation: 'slide-left',
    isDrawer: true,
  },
} as const;

export type ModalPosition = keyof typeof POSITION_CONFIG;
