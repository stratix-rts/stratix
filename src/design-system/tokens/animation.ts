/**
 * 动画系统
 * 
 * 基础配置 + 扩展接口
 * 支持组件级自定义
 */

export const Animation = {
  /** 持续时间 (毫秒) */
  duration: {
    fast: 150,
    normal: 250,
    slow: 400,
    instant: 75,
    deliberate: 600,
  },
  
  /** 缓动函数 */
  easing: {
    linear: 'linear',
    ease: 'ease',
    easeIn: 'ease-in',
    easeOut: 'ease-out',
    easeInOut: 'ease-in-out',
    spring: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)',
  },
  
  /** 预设动画 */
  presets: {
    fadeIn: {
      from: { opacity: 0 },
      to: { opacity: 1 },
      duration: 250,
      easing: 'ease-out',
    },
    fadeOut: {
      from: { opacity: 1 },
      to: { opacity: 0 },
      duration: 250,
      easing: 'ease-in',
    },
    slideUp: {
      from: { y: 20, opacity: 0 },
      to: { y: 0, opacity: 1 },
      duration: 300,
      easing: 'ease-out',
    },
    slideDown: {
      from: { y: -20, opacity: 0 },
      to: { y: 0, opacity: 1 },
      duration: 300,
      easing: 'ease-out',
    },
    scaleIn: {
      from: { scale: 0.95, opacity: 0 },
      to: { scale: 1, opacity: 1 },
      duration: 200,
      easing: 'ease-out',
    },
  },
  
  /** 
   * 组件级扩展接口
   * 按需添加组件特定动画配置
   */
  components: {
    button: {
      hover: 150,
      active: 100,
      focus: 150,
    },
    modal: {
      enter: 300,
      exit: 200,
      backdrop: 200,
    },
    dropdown: {
      enter: 150,
      exit: 100,
    },
    tooltip: {
      enter: 100,
      exit: 75,
    },
  },
} as const;

/**
 * 动画工具函数
 */
export function createAnimationCSS(
  property: string,
  duration: number,
  easing: string = 'ease-in-out'
): string {
  return `${property} ${duration}ms ${easing}`;
}

/**
 * 生成 CSS 变量
 */
export function generateAnimationCSS(): string {
  const variables: string[] = [];
  
  Object.entries(Animation.duration).forEach(([key, value]) => {
    variables.push(`--duration-${key}: ${value}ms;`);
  });
  
  Object.entries(Animation.easing).forEach(([key, value]) => {
    variables.push(`--easing-${key}: ${value};`);
  });
  
  return variables.join('\n');
}
