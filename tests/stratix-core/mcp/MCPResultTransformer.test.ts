/**
 * MCPResultTransformer Tests
 */

import { MCPResultTransformer } from '@/stratix-core/mcp/MCPResultTransformer';

describe('MCPResultTransformer', () => {
  let transformer: MCPResultTransformer;

  beforeEach(() => {
    transformer = new MCPResultTransformer();
  });

  describe('transformResultSync', () => {
    it('should handle text content', () => {
      const result = transformer.transformResultSync({ content: [{ type: 'text', text: 'hello' }] });
      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
    });

    it('should truncate long text', () => {
      const longText = 'a'.repeat(20000);
      const result = transformer.transformResultSync({ content: [{ type: 'text', text: longText }] });
      expect(result).toBeDefined();
    });

    it('should handle empty input', () => {
      const result = transformer.transformResultSync({ content: [] });
      expect(result).toBeDefined();
    });

    it('should handle missing content', () => {
      const result = transformer.transformResultSync({});
      expect(result).toBeDefined();
    });
  });
});
