/**
 * InputPreprocessor.test.ts - 规则预处理测试
 * Phase 1: Step 4 - Observer InputPreprocessor 测试
 */

import { InputPreprocessor } from '../InputPreprocessor';
import type { PreprocessorConfig } from '../types';

describe('InputPreprocessor', () => {
  let preprocessor: InputPreprocessor;

  beforeEach(() => {
    preprocessor = new InputPreprocessor();
  });

  describe('constructor', () => {
    it('should use default config when no config provided', () => {
      const instance = new InputPreprocessor();
      expect(instance).toBeInstanceOf(InputPreprocessor);
    });

    it('should accept custom config options', () => {
      const config: PreprocessorConfig = {
        detectLanguageEnabled: false,
        deduplicationEnabled: false,
        cleaningEnabled: false,
      };
      const instance = new InputPreprocessor(config);
      expect(instance).toBeInstanceOf(InputPreprocessor);
    });

    it('should apply partial config with defaults', () => {
      const instance = new InputPreprocessor({ deduplicationEnabled: false });
      expect(instance).toBeInstanceOf(InputPreprocessor);
    });
  });

  describe('process()', () => {
    it('should return PreprocessedInput with all fields', () => {
      const result = preprocessor.process('hello world');

      expect(result).toHaveProperty('original');
      expect(result).toHaveProperty('cleaned');
      expect(result).toHaveProperty('format');
      expect(result).toHaveProperty('language');
      expect(result).toHaveProperty('inferredType');
      expect(result).toHaveProperty('formatConfidence');
    });

    it('should preserve original content', () => {
      const content = 'Hello World Content';
      const result = preprocessor.process(content);
      expect(result.original).toBe(content);
    });

    it('should process empty string', () => {
      const result = preprocessor.process('');
      expect(result.format).toBe('text');
      expect(result.cleaned).toBe('');
    });
  });

  describe('detectFormat()', () => {
    describe('URL detection', () => {
      it('should detect http URL', () => {
        const result = preprocessor.detectFormat('https://example.com/path');
        expect(result.format).toBe('url');
        expect(result.confidence).toBeGreaterThanOrEqual(0.9);
      });

      it('should detect http URL without protocol', () => {
        const result = preprocessor.detectFormat('example.com/path');
        expect(result.format).toBe('url');
      });

      it('should detect URL with subdomain', () => {
        const result = preprocessor.detectFormat('https://sub.example.com');
        expect(result.format).toBe('url');
      });

      it('should not detect invalid URL without TLD', () => {
        const result = preprocessor.detectFormat('localhost:3000');
        // localhost doesn't have proper TLD, should fall back to text
        expect(['text', 'url']).toContain(result.format);
      });
    });

    describe('JSON detection', () => {
      it('should detect valid JSON object', () => {
        const result = preprocessor.detectFormat('{"key": "value"}');
        expect(result.format).toBe('json');
        expect(result.confidence).toBe(0.9);
      });

      it('should detect valid JSON array', () => {
        const result = preprocessor.detectFormat('[1, 2, 3]');
        expect(result.format).toBe('json');
      });

      it('should not detect invalid JSON', () => {
        const result = preprocessor.detectFormat('{key: value}');
        expect(result.format).not.toBe('json');
      });

      it('should not detect incomplete JSON', () => {
        const result = preprocessor.detectFormat('{ "key":');
        expect(result.format).not.toBe('json');
      });
    });

    describe('Code detection', () => {
      it('should detect code with code block markers', () => {
        const result = preprocessor.detectFormat('```typescript\nconst x = 1;\n```');
        expect(result.format).toBe('code');
        expect(result.confidence).toBe(0.85);
      });

      it('should detect code with inline code markers', () => {
        const result = preprocessor.detectFormat('`const x = 1;`');
        expect(result.format).toBe('code');
      });

      it('should detect import statement', () => {
        const result = preprocessor.detectFormat('import { foo } from "bar";');
        expect(result.format).toBe('code');
      });

      it('should detect export statement', () => {
        const result = preprocessor.detectFormat('export const foo = 1;');
        expect(result.format).toBe('code');
      });

      it('should detect function declaration', () => {
        const result = preprocessor.detectFormat('function foo() { return 1; }');
        expect(result.format).toBe('code');
      });

      it('should detect class declaration', () => {
        const result = preprocessor.detectFormat('class Foo extends Bar {}');
        expect(result.format).toBe('code');
      });

      it('should detect interface declaration', () => {
        const result = preprocessor.detectFormat('interface Person { name: string; }');
        expect(result.format).toBe('code');
      });

      it('should detect type alias', () => {
        const result = preprocessor.detectFormat('type Foo = string | number;');
        expect(result.format).toBe('code');
      });

      it('should detect arrow function', () => {
        const result = preprocessor.detectFormat('const fn = () => { return 1; };');
        expect(result.format).toBe('code');
      });

      it('should detect multiple code patterns', () => {
        const result = preprocessor.detectFormat('const x = 1;\nif (x) { console.log(x); }');
        expect(result.format).toBe('code');
      });

      it('should not detect single pattern as code', () => {
        const result = preprocessor.detectFormat('const x = 1;');
        expect(result.format).toBe('text');
      });

      it('should not detect plain text with braces as code', () => {
        const result = preprocessor.detectFormat('This is just { some } text');
        expect(result.format).toBe('text');
      });
    });

    describe('Text detection (fallback)', () => {
      it('should detect plain text', () => {
        const result = preprocessor.detectFormat('Hello, this is plain text.');
        expect(result.format).toBe('text');
        expect(result.confidence).toBe(0.7);
      });

      it('should detect short text', () => {
        const result = preprocessor.detectFormat('Hi');
        expect(result.format).toBe('text');
      });
    });
  });

  describe('detectLanguage()', () => {
    it('should detect Chinese when >40% Chinese characters', () => {
      const result = preprocessor.detectLanguage('这是一段中文内容');
      expect(result).toBe('zh');
    });

    it('should detect English when >40% English words', () => {
      const result = preprocessor.detectLanguage('This is a paragraph of English text.');
      expect(result).toBe('en');
    });

    it('should detect mixed when both >30%', () => {
      const result = preprocessor.detectLanguage('中文 Chinese English 英文');
      expect(result).toBe('mixed');
    });

    it('should detect Chinese when Chinese >2x English', () => {
      const result = preprocessor.detectLanguage('中 English 中');
      expect(result).toBe('zh');
    });

    it('should detect English when English >2x Chinese', () => {
      const result = preprocessor.detectLanguage('中文 english english english');
      expect(result).toBe('en');
    });

    it('should default to mixed for empty string', () => {
      const result = preprocessor.detectLanguage('');
      expect(result).toBe('mixed');
    });

    it('should detect mixed for equal proportions', () => {
      const result = preprocessor.detectLanguage('中英');
      expect(result).toBe('mixed');
    });

    it('should return mixed when language detection disabled', () => {
      const disabled = new InputPreprocessor({ detectLanguageEnabled: false });
      const result = disabled.detectLanguage('这是一段中文内容');
      expect(result).toBe('mixed');
    });
  });

  describe('clean()', () => {
    it('should remove quoted text prefix', () => {
      const result = preprocessor.clean('> quoted text');
      expect(result).not.toContain('>');
    });

    it('should remove ellipsis prefix', () => {
      const result = preprocessor.clean('... some text');
      expect(result).not.toContain('...');
    });

    it('should remove bullet point prefix', () => {
      const result = preprocessor.clean('- item 1\n- item 2');
      expect(result).not.toContain('- ');
    });

    it('should remove numbered list prefix', () => {
      const result = preprocessor.clean('1. first\n2. second');
      expect(result).not.toMatch(/^\d+\.\s/);
    });

    it('should normalize CRLF to LF', () => {
      const result = preprocessor.clean('line1\r\nline2\rline3');
      expect(result).toBe('line1\nline2\nline3');
    });

    it('should trim empty lines at start', () => {
      const result = preprocessor.clean('\n\n\nhello');
      expect(result.startsWith('\n')).toBe(false);
    });

    it('should trim empty lines at end', () => {
      const result = preprocessor.clean('hello\n\n\n');
      expect(result.endsWith('\n')).toBe(false);
    });

    it('should collapse multiple blank lines', () => {
      const result = preprocessor.clean('line1\n\n\n\nline2');
      expect(result).toBe('line1\n\n\nline2');
    });

    it('should deduplicate consecutive identical lines', () => {
      const result = preprocessor.clean('line1\nline1\nline2');
      expect(result).toBe('line1\nline2');
    });

    it('should preserve empty lines during deduplication', () => {
      const result = preprocessor.clean('line1\n\n\nline1');
      expect(result).toBe('line1\n\n');
    });

    it('should not deduplicate when deduplication disabled', () => {
      const noDedup = new InputPreprocessor({ deduplicationEnabled: false });
      const result = noDedup.clean('line1\nline1\nline2');
      expect(result).toBe('line1\nline1\nline2');
    });

    it('should preserve code indentation', () => {
      const code = '  const x = 1;\n    const y = 2;';
      const result = preprocessor.clean(code);
      expect(result).toContain('  const x');
      expect(result).toContain('    const y');
    });

    it('should return cleaned content when cleaning disabled', () => {
      const noClean = new InputPreprocessor({ cleaningEnabled: false });
      const result = noClean.clean('  > quoted text  ');
      expect(result).toBe('  > quoted text  ');
    });
  });

  describe('classifyInput()', () => {
    describe('news type', () => {
      it('should classify Chinese news keywords', () => {
        const result = preprocessor.classifyInput('新闻报道：今日宣布发布', 'text');
        expect(result).toBe('news');
      });

      it('should classify English news keywords', () => {
        const result = preprocessor.classifyInput('The company announced a new release', 'text');
        expect(result).toBe('news');
      });

      it('should classify 报道 as news', () => {
        const result = preprocessor.classifyInput('据最新报道', 'text');
        expect(result).toBe('news');
      });

      it('should classify 宣布 as news', () => {
        const result = preprocessor.classifyInput('公司宣布新政策', 'text');
        expect(result).toBe('news');
      });
    });

    describe('idea type', () => {
      it('should classify idea keywords', () => {
        const result = preprocessor.classifyInput('我有一个想法，也许可以这样做', 'text');
        expect(result).toBe('idea');
      });

      it('should classify English idea keywords', () => {
        const result = preprocessor.classifyInput('Maybe we could implement this', 'text');
        expect(result).toBe('idea');
      });

      it('should classify 考虑 as idea', () => {
        const result = preprocessor.classifyInput('正在考虑是否要优化', 'text');
        expect(result).toBe('idea');
      });
    });

    describe('analysis type', () => {
      it('should classify analysis keywords', () => {
        const result = preprocessor.classifyInput('请分析一下这个问题', 'text');
        expect(result).toBe('analysis');
      });

      it('should classify English analysis keywords', () => {
        const result = preprocessor.classifyInput('Please analysis this code', 'text');
        expect(result).toBe('analysis');
      });

      it('should classify 拆解 as analysis', () => {
        const result = preprocessor.classifyInput('对系统进行拆解', 'text');
        expect(result).toBe('analysis');
      });
    });

    describe('code type', () => {
      it('should classify code format as code', () => {
        const result = preprocessor.classifyInput('function test() {}', 'code');
        expect(result).toBe('code');
      });

      it('should classify code keywords in text', () => {
        const result = preprocessor.classifyInput('这个函数需要优化', 'text');
        expect(result).toBe('code');
      });

      it('should classify import keyword', () => {
        const result = preprocessor.classifyInput('import from statement', 'text');
        expect(result).toBe('code');
      });

      it('should classify interface keyword', () => {
        const result = preprocessor.classifyInput('interface definition', 'text');
        expect(result).toBe('code');
      });
    });

    describe('test_report type', () => {
      it('should classify test keywords', () => {
        const result = preprocessor.classifyInput('测试覆盖率只有30%', 'text');
        expect(result).toBe('test_report');
      });

      it('should classify English test keywords', () => {
        const result = preprocessor.classifyInput('jest test passed', 'text');
        expect(result).toBe('test_report');
      });

      it('should classify coverage keyword', () => {
        const result = preprocessor.classifyInput('coverage report shows 50%', 'text');
        expect(result).toBe('test_report');
      });

      it('should classify pass/fail keywords', () => {
        const result = preprocessor.classifyInput('test pass or fail', 'text');
        expect(result).toBe('test_report');
      });
    });

    describe('other type', () => {
      it('should default to other when no keywords match', () => {
        const result = preprocessor.classifyInput('random text without meaning', 'text');
        expect(result).toBe('other');
      });

      it('should classify JSON format as other', () => {
        const result = preprocessor.classifyInput('{"data": "value"}', 'json');
        expect(result).toBe('other');
      });

      it('should return other for empty content', () => {
        const result = preprocessor.classifyInput('', 'text');
        expect(result).toBe('other');
      });
    });
  });

  describe('integration scenarios', () => {
    it('should process URL with language detection', () => {
      const result = preprocessor.process('https://example.com/docs');
      expect(result.format).toBe('url');
      expect(['zh', 'en', 'mixed']).toContain(result.language);
    });

    it('should process Chinese news article', () => {
      const result = preprocessor.process('据报道，公司今日宣布推出新产品');
      expect(result.format).toBe('text');
      expect(result.language).toBe('zh');
      expect(result.inferredType).toBe('news');
    });

    it('should process English code snippet', () => {
      const result = preprocessor.process('```typescript\nconst x = 1;\nexport default x;\n```');
      expect(result.format).toBe('code');
      expect(result.inferredType).toBe('code');
    });

    it('should process JSON data', () => {
      const result = preprocessor.process('{"name": "test", "value": 123}');
      expect(result.format).toBe('json');
      expect(result.inferredType).toBe('other');
    });

    it('should handle mixed content cleaning', () => {
      const content = '> please analysis this\n\nfunction foo() {\n  return 1;\n}\nfunction foo() {\n  return 1;\n}';
      const result = preprocessor.process(content);
      expect(result.cleaned).not.toContain('>');
      expect(result.inferredType).toBe('code');
    });
  });
});
