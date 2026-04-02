import type { BaseMessage } from '@langchain/core/messages';
import { Annotation } from '@langchain/langgraph';

export const AgentGraphState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  input: Annotation<string>,
  currentStep: Annotation<string | null>,
  results: Annotation<Record<string, any>>({
    value: (x, y) => ({ ...x, ...y }),
    default: () => ({}),
  }),
  nextStep: Annotation<string | null>,
  error: Annotation<string | null>,
  status: Annotation<'pending' | 'running' | 'completed' | 'error'>({
    value: (_x, y) => y,
    default: () => 'pending',
  }),
});

export type AgentGraphStateType = typeof AgentGraphState;
