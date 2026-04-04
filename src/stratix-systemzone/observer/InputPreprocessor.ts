// ============================================
// InputPreprocessor - 规则预处理（本地，零成本）
// Phase 1: Step 4 - Observer（规则预处理 + LLM）
// ============================================

import type {
  InputFormat,
  InputLanguage,
  UserInputType,
} from '../types';

import type { PreprocessorConfig, PreprocessedInput } from './types';

// ------------------------------------------------
// 常量定义
// ------------------------------------------------

const URL_REGEX = /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([\/\w .-]*)*\/?$/i;
const CODE_BLOCK_REGEX = /(?:```[\s\S]*?```|`[^`]+`)/g;
const JSON_BLOCK_REGEX = /^\s*[{[\[][\s\S]*[}\]]\s*$/;
const CHINESE_CHAR_REGEX = /[\u4e00-\u9fff]/;
const ENGLISH_WORD_REGEX = /[a-zA-Z]{3,}/;

const TYPE_KEYWORDS: Record<UserInputType, string[]> = {
  news: ['新闻', 'news', '报道', '刚刚', '获悉', '最新', '今日', '昨天', '宣布', 'launch', 'release', 'announced'],
  idea: ['想法', 'idea', '觉得', '也许', '可以', '思考', '考虑', '要不要', 'could', 'should', 'maybe', 'perhaps'],
  analysis: ['分析', 'analysis', '分析一下', '研究', '探讨', '解读', '拆解', 'review', 'examine', 'investigate'],
  code: ['代码', 'code', '函数', 'class', 'function', 'import', 'export', 'const', 'let', 'var', 'interface'],
  test_report: ['测试', 'test', '覆盖率', 'coverage', '通过', 'pass', 'fail', 'error', 'spec', 'jest'],
  other: [],
};

// ------------------------------------------------
// InputPreprocessor 类
// ------------------------------------------------

export class InputPreprocessor {
  private config: Required<PreprocessorConfig>;

  constructor(config: PreprocessorConfig = {}) {
    this.config = {
      detectLanguageEnabled: config.detectLanguageEnabled ?? true,
      deduplicationEnabled: config.deduplicationEnabled ?? true,
      cleaningEnabled: config.cleaningEnabled ?? true,
    };
  }

  /**
   * 预处理用户输入
   * 1. 格式检测：code / url / text / json
   * 2. 语言检测：中 / 英 / 混合
   * 3. 清洗：去空白、去重复
   * 4. 基础分类
   */
  process(content: string): PreprocessedInput {
    const original = content;

    // Step 1: 格式检测
    const { format, confidence: formatConfidence } = this.detectFormat(original);

    // Step 2: 语言检测
    const language = this.config.detectLanguageEnabled
      ? this.detectLanguage(original)
      : 'mixed';

    // Step 3: 清洗
    const cleaned = this.config.cleaningEnabled
      ? this.clean(original)
      : original;

    // Step 4: 推断输入类型
    const inferredType = this.classifyInput(cleaned, format);

    return {
      original,
      cleaned,
      format,
      language,
      inferredType,
      formatConfidence,
    };
  }

  /**
   * 格式检测
   * 返回: code | url | text | json
   */
  detectFormat(content: string): { format: InputFormat; confidence: number } {
    const trimmed = content.trim();

    // Check for URL
    if (this.isUrl(trimmed)) {
      return { format: 'url', confidence: 0.95 };
    }

    // Check for JSON
    if (this.isJson(trimmed)) {
      return { format: 'json', confidence: 0.9 };
    }

    // Check for code
    if (this.isCode(trimmed)) {
      return { format: 'code', confidence: 0.85 };
    }

    return { format: 'text', confidence: 0.7 };
  }

  /**
   * 语言检测
   * 返回: zh | en | mixed
   */
  detectLanguage(content: string): InputLanguage {
    // Count Chinese characters
    const chineseMatches = content.match(CHINESE_CHAR_REGEX);
    const chineseCount = chineseMatches ? chineseMatches.length : 0;

    // Count English words
    const englishMatches = content.match(ENGLISH_WORD_REGEX);
    const englishCount = englishMatches ? englishMatches.length : 0;

    const totalChars = content.length;

    // Avoid division by zero
    if (totalChars === 0) {
      return 'mixed';
    }

    const chineseRatio = chineseCount / totalChars;
    const englishRatio = englishCount / totalChars;

    // If both are significant, consider mixed
    if (chineseRatio > 0.3 && englishRatio > 0.3) {
      return 'mixed';
    }

    // If Chinese is dominant
    if (chineseRatio > 0.4) {
      return 'zh';
    }

    // If English is dominant
    if (englishRatio > 0.4) {
      return 'en';
    }

    // Fallback: use character count comparison
    if (chineseCount > englishCount * 2) {
      return 'zh';
    }
    if (englishCount > chineseCount * 2) {
      return 'en';
    }

    return 'mixed';
  }

  /**
   * 清洗内容
   * - 去除多余空白
   * - 去除重复行
   * - 去除常见无意义前缀
   */
  clean(content: string): string {
    let cleaned = content;

    // Remove common prefixes
    cleaned = this.removePrefixes(cleaned);

    // Normalize line endings
    cleaned = cleaned.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Remove empty lines at start/end
    cleaned = cleaned.replace(/^\n+/, '').replace(/\n+$/, '');

    // Collapse multiple blank lines into one
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    // Remove leading/trailing whitespace from each line (optional, preserve indentation)
    // Skip this to preserve code indentation

    // Deduplicate consecutive identical lines if enabled
    if (this.config.deduplicationEnabled) {
      cleaned = this.deduplicateLines(cleaned);
    }

    return cleaned.trim();
  }

  /**
   * 根据内容和格式推断用户输入类型
   */
  classifyInput(content: string, format: InputFormat): UserInputType {
    // If explicitly code format, likely code input
    if (format === 'code') {
      return 'code';
    }

    // If JSON format, could be analysis or other
    if (format === 'json') {
      return 'other';
    }

    // Check for type keywords
    const lowerContent = content.toLowerCase();

    for (const [type, keywords] of Object.entries(TYPE_KEYWORDS)) {
      if (type === 'other') continue;

      for (const keyword of keywords) {
        if (lowerContent.includes(keyword.toLowerCase())) {
          return type as UserInputType;
        }
      }
    }

    // Default to 'other' if no match
    return 'other';
  }

  // ------------------------------------------------
  // 私有辅助方法
  // ------------------------------------------------

  private isUrl(content: string): boolean {
    // Check for URL pattern
    if (URL_REGEX.test(content)) {
      // Verify it has a proper TLD
      const hasTld = /\.[a-z]{2,6}(?:\/|$)/i.test(content);
      return hasTld || content.startsWith('http');
    }
    return false;
  }

  private isJson(content: string): boolean {
    const trimmed = content.trim();
    if (!JSON_BLOCK_REGEX.test(trimmed)) {
      return false;
    }

    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      return false;
    }
  }

  private isCode(content: string): boolean {
    // Check for code block markers
    if (CODE_BLOCK_REGEX.test(content)) {
      return true;
    }

    // Check for common code patterns
    const codePatterns = [
      /^import\s+.+\s+from\s+/m,
      /^export\s+(default\s+)?/m,
      /^const\s+\w+\s*=/m,
      /^let\s+\w+\s*=/m,
      /^function\s+\w+\s*\(/m,
      /^class\s+\w+(\s+extends\s+\w+)?/m,
      /^interface\s+\w+/m,
      /^type\s+\w+\s*=/m,
      /^\s*if\s*\(.+\)\s*\{/m,
      /^\s*for\s*\(.+\)\s*\{/m,
      /^\s*while\s*\(.+\)\s*\{/m,
      /=>\s*\{/,
      /{\s*[\n\r]\s*}/,
    ];

    let matchCount = 0;
    for (const pattern of codePatterns) {
      if (pattern.test(content)) {
        matchCount++;
      }
    }

    // If 2+ patterns match, likely code
    return matchCount >= 2;
  }

  private removePrefixes(content: string): string {
    // Remove common无意-prefixes that users might paste
    const prefixes = [
      /^>\s*/gm,           // Quoted text
      /^\.\.\.\s*/gm,      // Ellipsis
      /^-\s*/gm,           // Bullet points
      /^\d+\.\s*/gm,       // Numbered lists
    ];

    let cleaned = content;
    for (const prefix of prefixes) {
      cleaned = cleaned.replace(prefix, '');
    }

    return cleaned;
  }

  private deduplicateLines(content: string): string {
    const lines = content.split('\n');
    const seen = new Set<string>();
    const result: string[] = [];

    for (const line of lines) {
      // Use trimmed version for comparison
      const trimmed = line.trim();
      if (trimmed === '') {
        // Always allow empty lines
        result.push(line);
        continue;
      }

      if (!seen.has(trimmed)) {
        seen.add(trimmed);
        result.push(line);
      }
      // Skip duplicate non-empty lines
    }

    return result.join('\n');
  }
}
