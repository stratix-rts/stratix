/**
 * 部位配置
 */

import { LAYER_Z_POSITIONS } from '../constants';
import type { PartCategory } from '../constants';

export interface PartCategoryConfig {
  category: PartCategory;
  name: string;
  nameEn: string;
  icon: string;
  zPos: number;
  required?: boolean;
}

export const PART_CATEGORY_CONFIGS: PartCategoryConfig[] = [
  { category: 'shadow', name: '阴影', nameEn: 'Shadow', icon: 'shadow', zPos: LAYER_Z_POSITIONS.shadow },
  { category: 'body', name: '身体', nameEn: 'Body', icon: 'body', zPos: LAYER_Z_POSITIONS.body, required: true },
  { category: 'head', name: '头部', nameEn: 'Head', icon: 'head', zPos: LAYER_Z_POSITIONS.head },
  { category: 'eyes', name: '眼睛', nameEn: 'Eyes', icon: 'eyes', zPos: LAYER_Z_POSITIONS.eyes },
  { category: 'hair', name: '头发', nameEn: 'Hair', icon: 'hair', zPos: LAYER_Z_POSITIONS.hair },
  { category: 'ears', name: '耳朵', nameEn: 'Ears', icon: 'ears', zPos: LAYER_Z_POSITIONS.ears },
  { category: 'nose', name: '鼻子', nameEn: 'Nose', icon: 'nose', zPos: LAYER_Z_POSITIONS.nose },
  { category: 'facial', name: '面部毛发', nameEn: 'Facial Hair', icon: 'facial', zPos: LAYER_Z_POSITIONS.facial },
  { category: 'torso', name: '躯干', nameEn: 'Torso', icon: 'torso', zPos: LAYER_Z_POSITIONS.torso },
  { category: 'arms', name: '手臂', nameEn: 'Arms', icon: 'arms', zPos: LAYER_Z_POSITIONS.arms },
  { category: 'hands', name: '手部', nameEn: 'Hands', icon: 'hands', zPos: LAYER_Z_POSITIONS.hands },
  { category: 'legs', name: '腿部', nameEn: 'Legs', icon: 'legs', zPos: LAYER_Z_POSITIONS.legs },
  { category: 'feet', name: '足部', nameEn: 'Feet', icon: 'feet', zPos: LAYER_Z_POSITIONS.feet },
  { category: 'cape', name: '披风', nameEn: 'Cape', icon: 'cape', zPos: LAYER_Z_POSITIONS.cape },
  { category: 'backpack', name: '背包', nameEn: 'Backpack', icon: 'backpack', zPos: LAYER_Z_POSITIONS.backpack },
  { category: 'neck', name: '颈部', nameEn: 'Neck', icon: 'neck', zPos: LAYER_Z_POSITIONS.neck },
  { category: 'shoulders', name: '肩部', nameEn: 'Shoulders', icon: 'shoulders', zPos: LAYER_Z_POSITIONS.shoulders },
  { category: 'wrists', name: '手腕', nameEn: 'Wrists', icon: 'wrists', zPos: LAYER_Z_POSITIONS.wrists },
  { category: 'shield', name: '盾牌', nameEn: 'Shield', icon: 'shield', zPos: LAYER_Z_POSITIONS.shield },
  { category: 'weapon', name: '武器', nameEn: 'Weapon', icon: 'weapon', zPos: LAYER_Z_POSITIONS.weapon },
  { category: 'hat', name: '帽子', nameEn: 'Hat', icon: 'hat', zPos: LAYER_Z_POSITIONS.hat },
  { category: 'quiver', name: '箭袋', nameEn: 'Quiver', icon: 'quiver', zPos: LAYER_Z_POSITIONS.quiver }
];

export function getCategoryConfig(category: PartCategory): PartCategoryConfig | undefined {
  return PART_CATEGORY_CONFIGS.find(c => c.category === category);
}

export function getRequiredCategories(): PartCategory[] {
  return PART_CATEGORY_CONFIGS.filter(c => c.required).map(c => c.category);
}

export function getZPosForCategory(category: PartCategory): number {
  return LAYER_Z_POSITIONS[category] ?? 50;
}

export const DEFAULT_PARTS: Record<string, string> = {
  body: 'body_male',
  shadow: 'shadow_default'
};
