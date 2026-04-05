// ============================================
// Deduplicator - 信息去重与分类引擎
// Phase 3: P3-05 - Deduplicator 去重与分类
// ============================================

import * as crypto from 'crypto';

import type {
  RawInput,
  DeduplicationResult,
  ClassificationResult,
  ClassifiedInput,
  DeduplicatorConfig,
} from './types';

// -------------------------------------------------------------------------
// Default Configuration
// -------------------------------------------------------------------------

const DEFAULT_DEDUPLICATOR_CONFIG: Required<DeduplicatorConfig> = {
  deduplicationWindow: 86_400_000,    // 24 hours
  similarityThreshold: 0.85,             // 85% similarity threshold
  hashAlgorithm: 'sha256',
};

// -------------------------------------------------------------------------
// Category Definitions
// -------------------------------------------------------------------------

interface CategoryDefinition {
  name: string;
  keywords: string[];
  weight: number;  // keyword match weight for relevance scoring
}

const CATEGORY_DEFINITIONS: CategoryDefinition[] = [
  {
    name: 'security',
    keywords: [
      'security', 'vulnerability', 'cve', 'exploit', 'injection', 'xss', 'csrf',
      'authentication', 'authorization', 'encryption', 'ssl', 'tls', 'https',
      'credential', 'password', 'token', 'session', 'jwt', 'oauth', 'safelist',
      'blocklist', 'malware', 'ransomware', 'phishing', 'ddos', 'breach',
      'cors', ' CSP', 'sanitize', 'escape', 'permission', 'access control',
    ],
    weight: 1.0,
  },
  {
    name: 'performance',
    keywords: [
      'performance', 'speed', 'optimize', 'cache', 'lazy', 'memoize', 'debounce',
      'throttle', 'bundle', 'tree shaking', 'split', 'compression', 'gzip',
      'preload', 'prefetch', 'render', 'fps', 'latency', 'throughput',
      'memory', 'leak', 'gc', 'heap', 'benchmark', 'profiling', 'bottleneck',
      'cdn', 'load time', 'first contentful paint', 'fcp', 'lcp', 'cls',
    ],
    weight: 1.0,
  },
  {
    name: 'feature',
    keywords: [
      'feature', 'new', 'add', 'introduce', 'implement', 'support', 'enhance',
      'improve', 'upgrade', 'update', 'introduce', 'launch', 'release',
      'announce', 'debut', 'expand', 'extend', 'integrate', 'onboarding',
      'user experience', 'ux', 'ui', 'design', 'widget', 'component',
    ],
    weight: 0.9,
  },
  {
    name: 'bug',
    keywords: [
      'bug', 'fix', 'repair', 'patch', 'hotfix', 'issue', 'problem', 'error',
      'crash', 'fail', 'broken', 'fault', 'defect', 'regression', 'fallback',
      'workaround', 'resolve', 'correct', 'amend', 'rectify', 'triage',
    ],
    weight: 1.0,
  },
  {
    name: 'docs',
    keywords: [
      'docs', 'documentation', 'readme', 'guide', 'tutorial', 'example',
      'changelog', 'migration', 'upgrade guide', 'api', 'reference', 'manual',
      'how to', 'getting started', 'introduction', 'overview', 'configuration',
    ],
    weight: 0.9,
  },
  {
    name: 'test',
    keywords: [
      'test', 'testing', 'unit', 'integration', 'e2e', 'end-to-end', 'coverage',
      'jest', 'mocha', 'cypress', 'playwright', 'spec', 'assertion', 'mock',
      'stub', 'spy', 'tdd', 'bdd', 'qa', 'quality assurance', 'validation',
    ],
    weight: 1.0,
  },
  {
    name: 'other',
    keywords: [],
    weight: 0,
  },
];

// -------------------------------------------------------------------------
// Deduplicator Class
// -------------------------------------------------------------------------

export class Deduplicator {
  private config: Required<DeduplicatorConfig>;

  constructor(config: DeduplicatorConfig = {}) {
    this.config = {
      deduplicationWindow: config.deduplicationWindow ?? DEFAULT_DEDUPLICATOR_CONFIG.deduplicationWindow,
      similarityThreshold: config.similarityThreshold ?? DEFAULT_DEDUPLICATOR_CONFIG.similarityThreshold,
      hashAlgorithm: config.hashAlgorithm ?? DEFAULT_DEDUPLICATOR_CONFIG.hashAlgorithm,
    };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Deduplicate a list of raw inputs
   *
   * Strategy:
   * 1. Exact deduplication: hash comparison (SHA-256 of title+url)
   * 2. Similar deduplication: title similarity > threshold (default 0.85)
   * 3. Time window: only deduplicate items within deduplicationWindow
   */
  deduplicate(inputs: RawInput[]): DeduplicationResult {
    const unique: RawInput[] = [];
    const duplicates: RawInput[] = [];
    const similarityMap = new Map<string, string[]>();

    const now = Date.now();

    for (const input of inputs) {
      const inputHash = this.computeHash(input);

      // Check if this item is within the deduplication time window
      const age = now - input.fetchedAt.getTime();
      if (age > this.config.deduplicationWindow) {
        // Outside time window, treat as unique
        unique.push(input);
        continue;
      }

      // Check exact duplicate by hash
      const isExactDuplicate = unique.some(existing => {
        const existingHash = this.computeHash(existing);
        return existingHash === inputHash;
      });

      if (isExactDuplicate) {
        duplicates.push(input);
        continue;
      }

      // Check similar duplicate by title similarity
      let isSimilarDuplicate = false;
      const similarHashes: string[] = [];

      for (const existing of unique) {
        const similarity = this.computeSimilarity(input.title, existing.title);

        if (similarity >= this.config.similarityThreshold) {
          isSimilarDuplicate = true;
          const existingHash = this.computeHash(existing);

          // Record similarity relationship
          if (!similarityMap.has(existingHash)) {
            similarityMap.set(existingHash, []);
          }
          similarityMap.get(existingHash)!.push(inputHash);

          similarHashes.push(existingHash);
        }
      }

      if (isSimilarDuplicate) {
        duplicates.push(input);
      } else {
        unique.push(input);
      }
    }

    return {
      unique,
      duplicates,
      duplicateCount: duplicates.length,
      similarityMap,
    };
  }

  /**
   * Classify inputs into categories based on keyword matching
   */
  classify(inputs: RawInput[]): ClassificationResult {
    const classifiedInputs: ClassifiedInput[] = [];
    const categories = new Map<string, number>();

    for (const input of inputs) {
      const classified = this.classifySingle(input);
      classifiedInputs.push(classified);

      // Count by category
      categories.set(
        classified.category,
        (categories.get(classified.category) ?? 0) + 1
      );
    }

    return {
      inputs: classifiedInputs,
      categories,
    };
  }

  /**
   * Check if a single input is a duplicate against existing hashes
   */
  isDuplicate(input: RawInput, existingHashes: Set<string>): boolean {
    const inputHash = this.computeHash(input);

    // Exact hash match
    if (existingHashes.has(inputHash)) {
      return true;
    }

    return false;
  }

  /**
   * Compute text similarity using Jaccard similarity coefficient
   * Tokenizes strings and calculates Jaccard similarity
   *
   * @returns similarity score between 0 and 1
   */
  computeSimilarity(a: string, b: string): number {
    if (!a || !b) return 0;
    if (a === b) return 1;

    const tokensA = this.tokenize(a.toLowerCase());
    const tokensB = this.tokenize(b.toLowerCase());

    if (tokensA.length === 0 || tokensB.length === 0) return 0;

    // Calculate Jaccard similarity: |A ∩ B| / |A ∪ B|
    const intersection = new Set<string>();
    const union = new Set<string>(tokensA);

    for (const token of tokensB) {
      union.add(token);
      if (tokensA.includes(token)) {
        intersection.add(token);
      }
    }

    return intersection.size / union.size;
  }

  /**
   * Extract tags from content based on keyword matching
   */
  extractTags(content: string): string[] {
    const tags = new Set<string>();
    const lowerContent = content.toLowerCase();

    // Extract category-based tags
    for (const category of CATEGORY_DEFINITIONS) {
      for (const keyword of category.keywords) {
        if (lowerContent.includes(keyword.toLowerCase())) {
          tags.add(category.name);
          break;
        }
      }
    }

    // Extract tech stack tags (common technologies)
    const techPatterns = [
      /\b(react|vue|angular|svelte)\b/gi,
      /\b(node|deno|bun)\b/gi,
      /\b(python|java|go|rust|typescript|javascript)\b/gi,
      /\b(docker|kubernetes|aws|azure|gcp)\b/gi,
      /\b(postgresql|mysql|mongodb|redis|elasticsearch)\b/gi,
      /\b(graphql|rest|grpc|websocket)\b/gi,
      /\b(jest|cypress|playwright|mocha)\b/gi,
      /\b(webpack|vite|rollup|esbuild)\b/gi,
    ];

    for (const pattern of techPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        for (const match of matches) {
          tags.add(match.toLowerCase());
        }
      }
    }

    // Extract version numbers as tags (e.g., v1.0.0, 2.0)
    const versionPattern = /\bv?(\d+\.\d+(?:\.\d+)?)\b/g;
    let versionMatch;
    while ((versionMatch = versionPattern.exec(content)) !== null) {
      tags.add(`v${versionMatch[1]}`);
    }

    return Array.from(tags);
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  /**
   * Compute hash for a RawInput (SHA-256 of title + url)
   */
  private computeHash(input: RawInput): string {
    const data = `${input.title}|${input.url ?? ''}`;
    return crypto
      .createHash(this.config.hashAlgorithm)
      .update(data)
      .digest('hex');
  }

  /**
   * Tokenize a string into words
   */
  private tokenize(text: string): string[] {
    // Split on non-alphanumeric characters and filter empty strings
    return text
      .split(/[^a-zA-Z0-9]+/)
      .filter(token => token.length > 1);
  }

  /**
   * Classify a single input into a category
   */
  private classifySingle(input: RawInput): ClassifiedInput {
    const combinedText = `${input.title} ${input.content}`.toLowerCase();
    const tags = this.extractTags(combinedText);

    // Calculate relevance score for each category
    let bestCategory = 'other';
    let bestScore = 0;

    for (const category of CATEGORY_DEFINITIONS) {
      if (category.name === 'other') continue;

      const score = this.calculateCategoryScore(combinedText, category);

      if (score > bestScore) {
        bestScore = score;
        bestCategory = category.name;
      }
    }

    // If no category matched with sufficient score, classify as 'other'
    if (bestScore < 0.1) {
      bestCategory = 'other';
    }

    return {
      ...input,
      category: bestCategory,
      relevanceScore: Math.round(bestScore * 100) / 100,
      tags,
    };
  }

  /**
   * Calculate category match score based on keyword frequency
   */
  private calculateCategoryScore(text: string, category: CategoryDefinition): number {
    if (category.keywords.length === 0) return 0;

    let matchCount = 0;
    let totalWeight = 0;

    for (const keyword of category.keywords) {
      totalWeight += category.weight;

      // Case-insensitive keyword search
      const regex = new RegExp(`\\b${this.escapeRegex(keyword.toLowerCase())}\\b`, 'gi');
      const matches = text.match(regex);

      if (matches) {
        matchCount += matches.length * category.weight;
      }
    }

    // Normalize score to 0-1 range
    return totalWeight > 0 ? Math.min(1, matchCount / totalWeight) : 0;
  }

  /**
   * Escape special regex characters in a string
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}


