import {
  allPresets,
  getPresetById,
  getPresetsByCategory,
  singleAgentPreset,
  multiAgentChatPreset,
  codeReviewPreset,
} from '@/agent-platform/workflow/presets';
import { WorkflowPreset } from '@/agent-platform/workflow/types';

describe('WorkflowPresets', () => {
  describe('allPresets', () => {
    test('contains all three presets', () => {
      expect(allPresets).toHaveLength(3);
    });

    test('each preset has required fields', () => {
      allPresets.forEach(preset => {
        expect(preset.id).toBeDefined();
        expect(preset.name).toBeDefined();
        expect(preset.description).toBeDefined();
        expect(preset.category).toBeDefined();
        expect(preset.definition).toBeDefined();
      });
    });

    test('presets have valid categories', () => {
      const validCategories: WorkflowPreset['category'][] = [
        'single-agent',
        'multi-agent',
        'automation',
        'custom',
      ];

      allPresets.forEach(preset => {
        expect(validCategories).toContain(preset.category);
      });
    });

    test('presets have icon emojis', () => {
      allPresets.forEach(preset => {
        expect(preset.icon).toMatch(/[\u{1F300}-\u{1F9FF}]/u);
      });
    });
  });

  describe('singleAgentPreset', () => {
    test('has correct id', () => {
      expect(singleAgentPreset.id).toBe('single-agent');
    });

    test('has single-agent category', () => {
      expect(singleAgentPreset.category).toBe('single-agent');
    });

    test('has single llm step', () => {
      expect(singleAgentPreset.definition.sequence).toHaveLength(1);
      expect(singleAgentPreset.definition.sequence[0].type).toBe('llm');
    });

    test('step has provider and model configured', () => {
      const step = singleAgentPreset.definition.sequence[0];
      expect(step.properties.providerId).toBe('openai');
      expect(step.properties.model).toBe('gpt-4o');
    });

    test('has system prompt', () => {
      const step = singleAgentPreset.definition.sequence[0];
      expect(step.properties.systemPrompt).toBeDefined();
      expect(step.properties.systemPrompt!.length).toBeGreaterThan(0);
    });
  });

  describe('multiAgentChatPreset', () => {
    test('has correct id', () => {
      expect(multiAgentChatPreset.id).toBe('multi-agent-chat');
    });

    test('has multi-agent category', () => {
      expect(multiAgentChatPreset.category).toBe('multi-agent');
    });

    test('has multiple steps', () => {
      expect(multiAgentChatPreset.definition.sequence.length).toBeGreaterThan(1);
    });

    test('has parallel processing step', () => {
      const parallelStep = multiAgentChatPreset.definition.sequence.find(
        step => step.type === 'parallel'
      );
      expect(parallelStep).toBeDefined();
      expect(parallelStep!.componentType).toBe('parallel');
    });

    test('has expert roles', () => {
      const parallelStep = multiAgentChatPreset.definition.sequence.find(
        step => step.type === 'parallel'
      );
      expect(parallelStep!.sequences).toBeDefined();
      expect(parallelStep!.sequences!.length).toBeGreaterThan(1);
    });

    test('has coordinator and summarizer', () => {
      const stepIds = multiAgentChatPreset.definition.sequence.map(s => s.id);
      expect(stepIds).toContain('coordinator');
      expect(stepIds).toContain('summarizer');
    });
  });

  describe('codeReviewPreset', () => {
    test('has correct id', () => {
      expect(codeReviewPreset.id).toBe('code-review');
    });

    test('has automation category', () => {
      expect(codeReviewPreset.category).toBe('automation');
    });

    test('has multiple review steps', () => {
      expect(codeReviewPreset.definition.sequence.length).toBeGreaterThan(1);
    });

    test('has security reviewer', () => {
      const securityStep = codeReviewPreset.definition.sequence.find(
        step => step.id === 'security-reviewer'
      );
      expect(securityStep).toBeDefined();
      expect(securityStep!.properties.role).toBe('security-reviewer');
    });

    test('has performance reviewer', () => {
      const perfStep = codeReviewPreset.definition.sequence.find(
        step => step.id === 'performance-reviewer'
      );
      expect(perfStep).toBeDefined();
      expect(perfStep!.properties.role).toBe('performance-reviewer');
    });

    test('has final reviewer', () => {
      const finalStep = codeReviewPreset.definition.sequence.find(
        step => step.id === 'final-reviewer'
      );
      expect(finalStep).toBeDefined();
    });
  });

  describe('getPresetById', () => {
    test('returns preset for valid id', () => {
      const preset = getPresetById('single-agent');
      expect(preset).toBeDefined();
      expect(preset!.id).toBe('single-agent');
    });

    test('returns preset for multi-agent-chat id', () => {
      const preset = getPresetById('multi-agent-chat');
      expect(preset).toBeDefined();
      expect(preset!.id).toBe('multi-agent-chat');
    });

    test('returns preset for code-review id', () => {
      const preset = getPresetById('code-review');
      expect(preset).toBeDefined();
      expect(preset!.id).toBe('code-review');
    });

    test('returns undefined for unknown id', () => {
      const preset = getPresetById('unknown-preset');
      expect(preset).toBeUndefined();
    });

    test('is case sensitive', () => {
      expect(getPresetById('Single-Agent')).toBeUndefined();
      expect(getPresetById('SINGLE-AGENT')).toBeUndefined();
    });
  });

  describe('getPresetsByCategory', () => {
    test('returns single-agent presets', () => {
      const presets = getPresetsByCategory('single-agent');
      expect(presets).toHaveLength(1);
      expect(presets[0].id).toBe('single-agent');
    });

    test('returns multi-agent presets', () => {
      const presets = getPresetsByCategory('multi-agent');
      expect(presets).toHaveLength(1);
      expect(presets[0].id).toBe('multi-agent-chat');
    });

    test('returns automation presets', () => {
      const presets = getPresetsByCategory('automation');
      expect(presets).toHaveLength(1);
      expect(presets[0].id).toBe('code-review');
    });

    test('returns empty array for custom category', () => {
      const presets = getPresetsByCategory('custom');
      expect(presets).toHaveLength(0);
    });
  });

  describe('WorkflowDefinition structure', () => {
    test('all presets have valid properties', () => {
      allPresets.forEach(preset => {
        expect(preset.definition.properties).toBeDefined();
        expect(preset.definition.properties.name).toBeDefined();
        expect(preset.definition.sequence).toBeDefined();
        expect(Array.isArray(preset.definition.sequence)).toBe(true);
        expect(preset.definition.sequence.length).toBeGreaterThan(0);
      });
    });

    test('all steps have valid structure', () => {
      allPresets.forEach(preset => {
        preset.definition.sequence.forEach(step => {
          expect(step.id).toBeDefined();
          expect(step.componentType).toBeDefined();
          expect(step.type).toBeDefined();
          expect(step.name).toBeDefined();
          expect(step.properties).toBeDefined();
        });
      });
    });

    test('all steps have valid types', () => {
      const validTypes = ['llm', 'tool', 'router', 'human', 'parallel', 'loop'];

      allPresets.forEach(preset => {
        preset.definition.sequence.forEach(step => {
          expect(validTypes).toContain(step.type);
        });
      });
    });
  });
});
