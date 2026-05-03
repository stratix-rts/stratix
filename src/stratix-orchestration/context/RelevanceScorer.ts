import type { ContextArchive } from './ContextManager';

export interface ScoredContext {
  archive: ContextArchive;
  score: number;
  matchedKeywords: string[];
}

const DEFAULT_KEYWORD_WEIGHT = 0.4;
const DEFAULT_RECENCY_WEIGHT = 0.3;
const DEFAULT_TASK_RELEVANCE_WEIGHT = 0.3;
const DEFAULT_THRESHOLD = 0.3;
const DEFAULT_TOP_N = 5;
const MS_PER_DAY = 1000 * 60 * 60 * 24;
const RECENCY_HALF_LIFE_DAYS = 7;
const MAX_RELEVANCE_SCORE = 1.0;
const TASK_WORD_MATCH_INCREMENT = 0.1;

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'to', 'of', 'in', 'for', 'and', 'or', 'but', 'if', 'then', 'else',
  'when', 'at', 'from', 'by', 'on', 'off', 'out', 'over', 'into',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which',
  'who', 'whom', 'this', 'that', 'these', 'those', 'am', 'do', 'does',
  'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must',
  'have', 'has', 'had', 'having', 'doing', 'can', 'need',
]);

export class RelevanceScorer {
  private static instance: RelevanceScorer;

  private constructor() {}

  static getInstance(): RelevanceScorer {
    if (!RelevanceScorer.instance) {
      RelevanceScorer.instance = new RelevanceScorer();
    }
    return RelevanceScorer.instance;
  }

  /**
   * Score context archives by relevance to current query/task
   */
  score(
    archives: ContextArchive[],
    query: string,
    options: {
      keywordWeight?: number;
      recencyWeight?: number;
      taskRelevanceWeight?: number;
    } = {}
  ): ScoredContext[] {
    if (archives.length === 0 || !query.trim()) {
      return [];
    }

    const {
      keywordWeight = DEFAULT_KEYWORD_WEIGHT,
      recencyWeight = DEFAULT_RECENCY_WEIGHT,
      taskRelevanceWeight = DEFAULT_TASK_RELEVANCE_WEIGHT,
    } = options;

    const keywords = this.extractKeywords(query);
    const now = Date.now();

    return archives.map(archive => {
      // Keyword similarity score
      const { score: keywordScore, matched } = this.calculateKeywordScore(archive, keywords);

      // Recency score (exponential decay)
      const ageMs = now - archive.archivedAt;
      const ageDays = ageMs / MS_PER_DAY;
      const recencyScore = Math.exp(-ageDays / RECENCY_HALF_LIFE_DAYS);

      // Task relevance score
      const taskScore = this.calculateTaskRelevance(archive, query);

      // Weighted total
      const totalScore =
        keywordScore * keywordWeight +
        recencyScore * recencyWeight +
        taskScore * taskRelevanceWeight;

      return {
        archive,
        score: totalScore,
        matchedKeywords: matched,
      };
    }).sort((a, b) => b.score - a.score);
  }

  /**
   * Filter archives by minimum relevance threshold
   */
  filterByThreshold(
    scored: ScoredContext[],
    threshold: number = DEFAULT_THRESHOLD
  ): ScoredContext[] {
    return scored.filter(s => s.score >= threshold);
  }

  /**
   * Extract top N most relevant contexts
   */
  getTopContexts(
    archives: ContextArchive[],
    query: string,
    topN: number = DEFAULT_TOP_N
  ): ScoredContext[] {
    const scored = this.score(archives, query);
    return scored.slice(0, topN);
  }

  // ==================== Private Methods ====================

  private extractKeywords(text: string): string[] {
    const words = text.toLowerCase().split(/\s+/);

    return words
      .filter(w => w.length > 2 && !STOP_WORDS.has(w) && !/^\d+$/.test(w))
      .map(w => w.replace(/[^a-z0-9\u4e00-\u9fff]/g, '')) // Keep alphanumeric and CJK
      .filter(w => w.length > 0);
  }

  private calculateKeywordScore(
    archive: ContextArchive,
    keywords: string[]
  ): { score: number; matched: string[] } {
    if (keywords.length === 0) return { score: 0, matched: [] };

    const archiveText = [
      archive.summary,
      ...archive.keyDecisions,
      ...archive.outstandingTasks,
    ].join(' ').toLowerCase();

    let matchCount = 0;
    const matched: string[] = [];

    for (const keyword of keywords) {
      if (archiveText.includes(keyword.toLowerCase())) {
        matchCount++;
        matched.push(keyword);
      }
    }

    const score = matchCount / keywords.length;
    return { score, matched };
  }

  private calculateTaskRelevance(
    archive: ContextArchive,
    query: string
  ): number {
    // Check if the archive's outstanding tasks are mentioned in the query
    const queryLower = query.toLowerCase();
    let relevance = 0;

    for (const task of archive.outstandingTasks) {
      // Task mentions in query
      const taskWords = this.extractKeywords(task);
      for (const word of taskWords) {
        if (queryLower.includes(word)) {
          relevance += TASK_WORD_MATCH_INCREMENT;
        }
      }
    }

    // Cap at 1.0
    return Math.min(relevance, MAX_RELEVANCE_SCORE);
  }
}

export default RelevanceScorer;
