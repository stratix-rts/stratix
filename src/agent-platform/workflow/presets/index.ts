export { singleAgentPreset } from './single-agent';
export { multiAgentChatPreset } from './multi-agent-chat';
export { codeReviewPreset } from './code-review';

import type { WorkflowPreset } from '../types';

import { codeReviewPreset } from './code-review';
import { multiAgentChatPreset } from './multi-agent-chat';
import { singleAgentPreset } from './single-agent';

export const allPresets: WorkflowPreset[] = [
  singleAgentPreset,
  multiAgentChatPreset,
  codeReviewPreset,
];

export function getPresetById(id: string): WorkflowPreset | undefined {
  return allPresets.find((preset) => preset.id === id);
}

export function getPresetsByCategory(category: WorkflowPreset['category']): WorkflowPreset[] {
  return allPresets.filter((preset) => preset.category === category);
}
