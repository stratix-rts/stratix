import { LLMConnector } from '../../stratix-agent/core/LLMConnector';
import type { LLMConfig, ChatMessage } from '../../stratix-agent/types';
import { getDatabase } from '../../stratix-database/StratixDatabase';

// Database row interface
interface ArchiveRow {
  archive_id: string;
  agent_id: string;
  zone_id: string | null;
  archive_type: string;
  content: string;
  key_decisions: string;
  outstanding_tasks: string;
  archived_at: number;
  expires_at: number | null;
}

export interface CompressionResult {
  summary: string;
  keyDecisions: string[];
  outstandingTasks: string[];
}

// Default LLM config for compression (can be overridden via setLLMConfig)
const DEFAULT_COMPRESSION_LLM: LLMConfig = {
  provider: 'deepseek',
  model: 'deepseek-chat',
  temperature: 0.3,
  maxTokens: 1024,
};

export class ContextCompressionService {
  private static instance: ContextCompressionService;
  private llm: LLMConnector | null = null;
  private llmConfig: LLMConfig = DEFAULT_COMPRESSION_LLM;

  private constructor() {}

  static getInstance(): ContextCompressionService {
    if (!ContextCompressionService.instance) {
      ContextCompressionService.instance = new ContextCompressionService();
    }
    return ContextCompressionService.instance;
  }

  /**
   * Set custom LLM configuration for compression
   */
  setLLMConfig(config: Partial<LLMConfig>): void {
    this.llmConfig = { ...this.llmConfig, ...config };
    this.llm = null; // Reset LLM instance to use new config
  }

  /**
   * Get or create LLM connector
   */
  private getLLM(): LLMConnector {
    if (!this.llm) {
      this.llm = new LLMConnector(this.llmConfig);
    }
    return this.llm;
  }

  /**
   * Compress old messages into a semantic summary using LLM
   */
  async compress(
    agentId: string,
    messages: Array<{ role: string; content: string; timestamp: number }>,
    options: {
      zoneId?: string;
      summaryPrompt?: string;
    } = {}
  ): Promise<CompressionResult> {
    let result: CompressionResult;

    try {
      result = await this.compressWithLLM(messages, options.summaryPrompt);
    } catch (error) {
      console.warn('[ContextCompression] LLM compression failed, using basic extraction:', error);
      result = this.basicCompress(messages);
    }

    // Store in database
    await this.storeArchive(agentId, result, { zoneId: options.zoneId });

    return result;
  }

  /**
   * Use LLM to generate semantic summary
   */
  private async compressWithLLM(
    messages: Array<{ role: string; content: string; timestamp: number }>,
    customPrompt?: string
  ): Promise<CompressionResult> {
    const llm = this.getLLM();
    const prompt = customPrompt || this.buildSummarizationPrompt(messages);

    const chatMessages: ChatMessage[] = [
      { role: 'user', content: prompt }
    ];

    const response = await llm.generate(chatMessages);

    // Parse JSON response from LLM
    try {
      const parsed = JSON.parse(response.content.trim());
      return {
        summary: parsed.summary || '',
        keyDecisions: Array.isArray(parsed.keyDecisions) ? parsed.keyDecisions : [],
        outstandingTasks: Array.isArray(parsed.outstandingTasks) ? parsed.outstandingTasks : [],
      };
    } catch (error) {
      // If JSON parsing fails, try to extract information via basic methods
      console.warn('[ContextCompression] Failed to parse LLM response as JSON:', error);
      return this.basicCompress(messages);
    }
  }

  /**
   * Build prompt for LLM summarization
   */
  private buildSummarizationPrompt(
    messages: Array<{ role: string; content: string; timestamp: number }>
  ): string {
    const messageText = messages
      .map(m => `[${m.role}]: ${m.content}`)
      .join('\n\n');

    return `请分析以下对话记录，生成结构化摘要：

## 对话记录
${messageText}

## 要求
1. 生成简洁的中文摘要（100-200字）
2. 提取关键决策（用一句话描述每个决策）
3. 提取待办事项（用一句话描述每个任务）
4. 输出严格 JSON 格式：
{
  "summary": "摘要内容",
  "keyDecisions": ["决策1", "决策2"],
  "outstandingTasks": ["任务1", "任务2"]
}`;
  }

  /**
   * Basic compression without LLM (fallback)
   */
  private basicCompress(
    messages: Array<{ role: string; content: string; timestamp: number }>
  ): CompressionResult {
    return {
      summary: this.generateBasicSummary(messages),
      keyDecisions: this.extractBasicDecisions(messages),
      outstandingTasks: this.extractBasicTasks(messages),
    };
  }

  /**
   * Retrieve relevant archives for an agent
   */
  async getRelevantArchives(
    agentId: string,
    query: string,
    limit: number = 5
  ): Promise<CompressionResult[]> {
    const db = getDatabase().getDatabase();

    // Simple keyword matching for now
    // In production, this would use vector search
    const keywords = this.extractKeywords(query);

    let sql = `
      SELECT * FROM context_archives
      WHERE agent_id = ?
        AND (expires_at IS NULL OR expires_at > ?)
    `;
    const params: any[] = [agentId, Date.now()];

    // Add keyword-based filtering if keywords exist
    if (keywords.length > 0) {
      const keywordPatterns = keywords.map(() => '(content LIKE ? OR key_decisions LIKE ?)');
      sql += ` AND (${keywordPatterns.join(' OR ')})`;
      for (const keyword of keywords) {
        const sanitized = this.sanitizeForLike(keyword);
        params.push(`%${sanitized}%`, `%${sanitized}%`);
      }
    }

    sql += ' ORDER BY archived_at DESC LIMIT ?';
    params.push(limit);

    const rows = db.prepare(sql).all(...params) as ArchiveRow[];

    return rows.map(row => {
      let content: CompressionResult;
      try {
        content = JSON.parse(row.content);
      } catch {
        content = {
          summary: row.content,
          keyDecisions: [],
          outstandingTasks: [],
        };
      }

      return {
        summary: content.summary,
        keyDecisions: JSON.parse(row.key_decisions || '[]'),
        outstandingTasks: JSON.parse(row.outstanding_tasks || '[]'),
      };
    });
  }

  /**
   * Archive old messages from layer 1 to layer 2
   */
  async archiveMessages(
    agentId: string,
    messages: Array<{ role: string; content: string; timestamp: number }>,
    zoneId?: string
  ): Promise<void> {
    if (messages.length === 0) return;

    await this.compress(agentId, messages, { zoneId });
  }

  // ==================== Helper Methods ====================

  private generateBasicSummary(
    messages: Array<{ role: string; content: string; timestamp: number }>
  ): string {
    const count = messages.length;
    const first = messages[0]?.content.slice(0, 100) || '';
    const last = messages[messages.length - 1]?.content.slice(0, 100) || '';

    return `[对话摘要] 共 ${count} 条消息。开始于: ${first}... 结束于: ${last}...`;
  }

  private extractBasicDecisions(
    messages: Array<{ role: string; content: string; timestamp: number }>
  ): string[] {
    const decisions: string[] = [];
    const decisionKeywords = ['决定', 'decided', '选择', 'chose', '方案', 'plan'];

    for (const msg of messages) {
      const lower = msg.content.toLowerCase();
      for (const keyword of decisionKeywords) {
        if (lower.includes(keyword)) {
          const sentence = this.extractSentence(msg.content, keyword);
          if (sentence && !decisions.includes(sentence)) {
            decisions.push(sentence);
          }
        }
      }
    }

    return decisions.slice(0, 10); // Limit to 10 decisions
  }

  private extractBasicTasks(
    messages: Array<{ role: string; content: string; timestamp: number }>
  ): string[] {
    const tasks: string[] = [];
    const taskKeywords = ['todo', '任务', '需要做', 'should', 'must', '需要', '待办'];

    for (const msg of messages) {
      const lower = msg.content.toLowerCase();
      for (const keyword of taskKeywords) {
        if (lower.includes(keyword)) {
          const sentence = this.extractSentence(msg.content, keyword);
          if (sentence && !tasks.includes(sentence)) {
            tasks.push(sentence);
          }
        }
      }
    }

    return tasks.slice(0, 10); // Limit to 10 tasks
  }

  private extractSentence(text: string, keyword: string): string {
    const lower = text.toLowerCase();
    const index = lower.indexOf(keyword);
    if (index === -1) return '';

    // Find sentence boundaries
    const start = Math.max(0, index - 50);
    const end = Math.min(text.length, index + keyword.length + 50);

    return text.slice(start, end).trim();
  }

  private extractKeywords(text: string): string[] {
    // Simple keyword extraction
    const words = text.toLowerCase().split(/\s+/);
    const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'to', 'of', 'in', 'for', 'and', 'or']);

    return words
      .filter(w => w.length > 2 && !stopWords.has(w))
      .map(w => w.replace(/[^a-z0-9\u4e00-\u9fff]/g, '')) // Keep alphanumeric and CJK
      .filter(w => w.length > 0)
      .slice(0, 10);
  }

  private async storeArchive(
    agentId: string,
    data: CompressionResult,
    options: { zoneId?: string } = {}
  ): Promise<void> {
    const db = getDatabase().getDatabase();
    const now = Date.now();
    const archiveId = `archive_${agentId}_${now}`;

    db.prepare(`
      INSERT INTO context_archives (archive_id, agent_id, zone_id, archive_type, content, key_decisions, outstanding_tasks, archived_at)
      VALUES (?, ?, ?, 'session_summary', ?, ?, ?, ?)
    `).run(
      archiveId,
      agentId,
      options.zoneId || null,
      JSON.stringify(data),
      JSON.stringify(data.keyDecisions),
      JSON.stringify(data.outstandingTasks),
      now
    );
  }

  /**
   * Sanitize input for use in LIKE pattern
   */
  private sanitizeForLike(input: string): string {
    return input.replace(/[%_]/g, '\\$&');
  }
}

export default ContextCompressionService;
