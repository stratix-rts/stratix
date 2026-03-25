import type { ContextArchive } from './ContextManager';

export interface ScoredContext {
  archive: ContextArchive;
  score: number;
  matchedKeywords: string[];
}

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
    const {
      keywordWeight = 0.4,
      recencyWeight = 0.3,
      taskRelevanceWeight = 0.3,
    } = options;

    const keywords = this.extractKeywords(query);
    const now = Date.now();

    return archives.map(archive => {
      // Keyword similarity score
      const { score: keywordScore, matched } = this.calculateKeywordScore(archive, keywords);

      // Recency score (exponential decay)
      const ageMs = now - archive.archivedAt;
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      const recencyScore = Math.exp(-ageDays / 7); // Half-life of 7 days

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
    threshold: number = 0.3
  ): ScoredContext[] {
    return scored.filter(s => s.score >= threshold);
  }

  /**
   * Extract top N most relevant contexts
   */
  getTopContexts(
    archives: ContextArchive[],
    query: string,
    topN: number = 5
  ): ScoredContext[] {
    const scored = this.score(archives, query);
    return scored.slice(0, topN);
  }

  // ==================== Private Methods ====================

  private extractKeywords(text: string): string[] {
    const words = text.toLowerCase().split(/\s+/);
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'to', 'of', 'in', 'for', 'and', 'or', 'but', 'if', 'then', 'else',
      'when', 'at', 'from', 'by', 'on', 'off', 'out', 'over', 'into',
      'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which',
      'who', 'whom', 'this', 'that', 'these', 'those', 'am', 'do', 'does',
      'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must',
      'have', 'has', 'had', 'having', 'doing', 'can', 'need',
    ]);

    return words
      .filter(w => w.length > 2 && !stopWords.has(w) && !/^\d+$/.test(w))
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
          relevance += 0.1;
        }
      }
    }

    // Cap at 1.0
    return Math.min(relevance, 1.0);
  }
}

export default RelevanceScorer;
