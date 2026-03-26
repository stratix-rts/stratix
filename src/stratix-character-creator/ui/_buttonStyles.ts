/**
 * Button Style Helper - Design System Token Integration
 *
 * Provides centralized button styling using design system tokens.
 */

import { ButtonSemantic } from '@/design-system/semantic/buttons';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'success' | 'danger' | 'warning' | 'ghost' | 'disabled';

// Type for button semantic token with optional shadow properties
interface ButtonToken {
  background: string;
  backgroundHover: string;
  backgroundActive: string;
  text: string;
  border: string;
  borderRadius: string;
  padding: string;
  shadow?: string;
  shadowHover?: string;
}

/**
 * Get button styles from design system ButtonSemantic tokens
 */
export function getButtonStyles(variant: ButtonVariant): ButtonToken {
  return ButtonSemantic[variant] as ButtonToken;
}

/**
 * Generate inline styles string for button HTML
 */
export function getButtonInlineStyles(variant: ButtonVariant): string {
  const s = getButtonStyles(variant);
  const parts: string[] = [
    `background: ${s.background};`,
    `color: ${s.text};`,
    `border: ${s.border};`,
    `border-radius: ${s.borderRadius};`,
    `padding: ${s.padding};`,
  ];

  if (s.shadow) {
    parts.push(`box-shadow: ${s.shadow};`);
  }

  return parts.join(' ');
}

/**
 * Get hover styles for a button variant
 */
export function getButtonHoverStyles(variant: ButtonVariant): string {
  const s = getButtonStyles(variant);
  const parts: string[] = [
    `background: ${s.backgroundHover};`,
  ];

  if (s.shadowHover) {
    parts.push(`box-shadow: ${s.shadowHover};`);
  }

  return parts.join(' ');
}

/**
 * Get active/pressed styles for a button variant
 */
export function getButtonActiveStyles(variant: ButtonVariant): string {
  const s = getButtonStyles(variant);
  return `background: ${s.backgroundActive};`;
}

/**
 * Apply button styles and add hover event listeners to a DOM button element
 */
export function attachButtonStyles(button: HTMLButtonElement | null, variant: ButtonVariant): void {
  if (!button) return;

  // Apply base styles
  const styles = getButtonStyles(variant);
  button.style.background = styles.background;
  button.style.color = styles.text;
  button.style.border = styles.border;
  button.style.borderRadius = styles.borderRadius;
  button.style.padding = styles.padding;
  if (styles.shadow) {
    button.style.boxShadow = styles.shadow;
  }

  // Add hover effects
  button.addEventListener('mouseenter', () => {
    button.style.background = styles.backgroundHover;
    if (styles.shadowHover) {
      button.style.boxShadow = styles.shadowHover;
    }
  });

  button.addEventListener('mouseleave', () => {
    button.style.background = styles.background;
    if (styles.shadow) {
      button.style.boxShadow = styles.shadow;
    } else {
      button.style.boxShadow = 'none';
    }
  });

  button.addEventListener('mousedown', () => {
    button.style.background = styles.backgroundActive;
  });

  button.addEventListener('mouseup', () => {
    button.style.background = styles.backgroundHover;
  });
}
