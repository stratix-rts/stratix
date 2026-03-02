/**
 * CharacterCreator 类型定义
 */

export type { BodyType, PartCategory } from '../constants';
import type { BodyType, PartCategory } from '../constants';

export interface PartSelection {
  itemId: string;
  variant: string;
}

export interface PartLayer {
  zPos?: number;
  male?: string;
  female?: string;
  teen?: string;
  muscular?: string;
  pregnant?: string;
  child?: string;
  skeleton?: string;
  zombie?: string;
}

export interface CreditInfo {
  file?: string;
  notes?: string;
  authors: string[];
  licenses: string[];
  urls?: string[];
}

export interface PartMetadata {
  itemId: string;
  name: string;
  priority?: number | null;
  typeName: string;
  required: string[];
  animations: string[];
  variants: string[];
  layers: Record<string, PartLayer>;
  credits: CreditInfo[];
  tags?: string[];
  requiredTags?: string[];
  excludedTags?: string[];
  path?: string[];
  replaceInPath?: Record<string, string>;
  previewRow?: number;
  previewColumn?: number;
  previewXOffset?: number;
  previewYOffset?: number;
  matchBodyColor?: boolean;
}

export interface OpenClawConfigLocal {
  endpoint: string;
  accountId: string;
  apiKey?: string;
  agentId?: string;
}

export interface DirectLLMConfigLocal {
  provider: 'openai' | 'anthropic' | 'ollama' | 'custom';
  model: string;
  endpoint?: string;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface SavedCharacter {
  characterId: string;
  name: string;
  bodyType: BodyType;
  parts: Record<string, PartSelection>;
  skillTree: SkillTreeState;
  attributes: Record<string, number>;
  isDefault: boolean;
  thumbnail?: string;
  createdAt: number;
  updatedAt: number;
  soul?: {
    identity: string;
    goals: string[];
    personality: string;
  };
  rules?: string[];
  backendType?: 'openclaw' | 'direct';
  openClawConfig?: OpenClawConfigLocal;
  directConfig?: DirectLLMConfigLocal;
  openClawConnectionId?: string;
}

export type { OpenClawConnectionMode, UnifiedOpenClawConfig } from '@/stratix-core/stratix-protocol';

export interface SkillTreeState {
  selectedNodes: string[];
  unlockedNodes: string[];
}

export interface SkillNode {
  nodeId: string;
  name: string;
  description?: string;
  icon?: string;
  prerequisites: string[];
  attributes: Record<string, number>;
  position: { x: number; y: number };
}

export interface ComposeOptions {
  bodyType: BodyType;
  animations?: string[];
  targetCanvas?: HTMLCanvasElement;
}

export interface ComposeResult {
  canvas: HTMLCanvasElement;
  parts: PartInfo[];
  credits: CreditInfo[];
}

export interface PartInfo {
  itemId: string;
  variant: string;
  spritePath: string;
  zPos: number;
  layerNum: number;
  animation: string;
  yPos: number;
}

export interface CharacterConfig {
  characterId?: string;
  name?: string;
  bodyType?: BodyType;
  parts?: Record<string, PartSelection>;
  skillTree?: SkillTreeState;
  isDefault?: boolean;
}

export interface PartCategoryInfo {
  category: PartCategory;
  name: string;
  icon?: string;
  parts: PartMetadata[];
}

export type AnimationName = keyof typeof import('../constants').ANIMATION_OFFSETS;

export interface AnimationFrame {
  x: number;
  y: number;
  frame: number;
  direction: number;
}

export interface PreviewState {
  animation: AnimationName;
  direction: number;
  scale: number;
  isPlaying: boolean;
}

export interface CharacterCreatorState {
  currentCharacter: SavedCharacter | null;
  previewState: PreviewState;
  availableParts: Record<string, PartMetadata[]>;
  isDirty: boolean;
}

export type CreatorStep = 'appearance' | 'openclaw' | 'agent';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}
