// ============================================
// RSSAdapter.ts - RSS Feed 适配器
// Phase 3: 外部信息源 - RSS 源适配器
// ============================================

import type { RawInput, SourceType } from '../types';

// ------------------------------------------------
// RSSConfig
// ------------------------------------------------

export interface RSSConfig {
  feedUrl: string;
  maxItems: number;
  refreshInterval: number;
}

// ------------------------------------------------
// 内部类型
// ------------------------------------------------

export interface ParsedItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  author?: string;
  guid?: string;
  content?: string;
  categories?: string[];
}

export interface ParsedFeed {
  title: string;
  link: string;
  description: string;
  items: ParsedItem[];
  feedType: 'rss' | 'atom';
}

// ------------------------------------------------
// 常量
// ------------------------------------------------

const FETCH_TIMEOUT_MS = 30_000;

// ------------------------------------------------
// RSSAdapter
// ------------------------------------------------

export class RSSAdapter {
  /**
   * 抓取 RSS Feed
   */
  async fetch(url: string, config?: RSSConfig): Promise<RawInput[]> {
    const xml = await this.fetchXML(url);
    const feed = await this.parseXML(xml);
    const items = feed.items.slice(0, config?.maxItems ?? 100);
    return this.mapToRawInput(items, url);
  }

  /**
   * 获取原始 XML
   */
  private async fetchXML(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      fetch(url, { signal: controller.signal })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          return response.text();
        })
        .then((text) => {
          clearTimeout(timeoutId);
          resolve(text);
        })
        .catch((err) => {
          clearTimeout(timeoutId);
          if (err.name === 'AbortError') {
            reject(new Error(`Fetch timeout after ${FETCH_TIMEOUT_MS}ms`));
          } else {
            reject(err);
          }
        });
    });
  }

  /**
   * 解析 XML 为 ParsedFeed
   */
  async parseXML(xml: string): Promise<ParsedFeed> {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');

    // 检查解析错误
    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      throw new Error('Invalid XML format');
    }

    // 检测 feed 类型
    const rssChannel = doc.querySelector('channel');
    if (rssChannel) {
      return this.parseRSS(doc);
    }

    const atomFeed = doc.querySelector('feed');
    if (atomFeed) {
      return this.parseAtom(doc);
    }

    throw new Error('Unknown feed format: neither RSS nor Atom');
  }

  /**
   * 解析 RSS 2.0
   */
  private parseRSS(doc: Document): ParsedFeed {
    const channel = doc.querySelector('channel')!;

    const title = this.getElementText(channel, 'title') ?? '';
    const link = this.getElementText(channel, 'link') ?? '';
    const description = this.getElementText(channel, 'description') ?? '';

    const items: ParsedItem[] = [];
    const itemElements = channel.querySelectorAll('item');

    for (const itemEl of Array.from(itemElements)) {
      items.push({
        title: this.getElementText(itemEl, 'title') ?? '',
        link: this.getElementText(itemEl, 'link') ?? '',
        description: this.getElementText(itemEl, 'description') ?? '',
        pubDate: this.getElementText(itemEl, 'pubDate') ?? '',
        author: this.getElementText(itemEl, 'author') ?? this.getElementText(itemEl, 'dc:creator') ?? undefined,
        guid: this.getElementText(itemEl, 'guid') ?? undefined,
        content: this.getElementText(itemEl, 'content:encoded') ?? undefined,
        categories: this.getCategories(itemEl),
      });
    }

    return { title, link, description, items, feedType: 'rss' };
  }

  /**
   * 解析 Atom
   */
  private parseAtom(doc: Document): ParsedFeed {
    const feed = doc.querySelector('feed')!;

    const title = this.getElementText(feed, 'title') ?? '';
    const linkEl = feed.querySelector('link[rel="alternate"]') ?? feed.querySelector('link');
    const link = linkEl?.getAttribute('href') ?? '';
    const description = this.getElementText(feed, 'subtitle') ?? '';

    const items: ParsedItem[] = [];
    const entryElements = feed.querySelectorAll('entry');

    for (const entry of Array.from(entryElements)) {
      const entryLinkEl = entry.querySelector('link[rel="alternate"]') ?? entry.querySelector('link');
      items.push({
        title: this.getElementText(entry, 'title') ?? '',
        link: entryLinkEl?.getAttribute('href') ?? '',
        description: this.getElementText(entry, 'summary') ?? this.getElementText(entry, 'content') ?? '',
        pubDate: this.getElementText(entry, 'updated') ?? this.getElementText(entry, 'published') ?? '',
        author: this.getElementText(entry, 'author name') ?? undefined,
        guid: this.getElementText(entry, 'id') ?? undefined,
        content: this.getElementText(entry, 'content') ?? undefined,
        categories: this.getAtomCategories(entry),
      });
    }

    return { title, link, description, items, feedType: 'atom' };
  }

  /**
   * 获取元素文本内容
   */
  private getElementText(parent: Element, selector: string): string | null {
    const el = parent.querySelector(`:scope > ${selector}`);
    return el?.textContent?.trim() ?? null;
  }

  /**
   * 获取 RSS categories
   */
  private getCategories(itemEl: Element): string[] {
    const cats: string[] = [];
    for (const cat of itemEl.querySelectorAll('category')) {
      const text = cat.textContent?.trim();
      if (text) cats.push(text);
    }
    return cats;
  }

  /**
   * 获取 Atom categories
   */
  private getAtomCategories(entry: Element): string[] {
    const cats: string[] = [];
    for (const cat of entry.querySelectorAll('category')) {
      const term = cat.getAttribute('term');
      if (term) cats.push(term);
    }
    return cats;
  }

  /**
   * 将 ParsedItem 映射为 RawInput
   */
  mapToRawInput(items: ParsedItem[], sourceId: string): RawInput[] {
    return items.map((item) => ({
      id: this.computeHash(item),
      sourceId,
      sourceType: 'rss' as SourceType,
      title: item.title,
      content: item.description,
      url: item.link || undefined,
      author: item.author || undefined,
      publishedAt: item.pubDate ? new Date(item.pubDate) : undefined,
      fetchedAt: new Date(),
      contentType: this.inferContentType(item),
      metadata: {
        guid: item.guid,
        categories: item.categories,
        content: item.content,
      },
      hash: this.computeHash(item),
    }));
  }

  /**
   * 推断内容类型
   */
  private inferContentType(item: ParsedItem): RawInput['contentType'] {
    const titleLower = item.title.toLowerCase();
    const descLower = item.description.toLowerCase();
    const combined = titleLower + ' ' + descLower;

    if (/changelog|release|version\s*\d/i.test(combined)) return 'changelog';
    if (/release|published|announcement/i.test(combined)) return 'release';
    if (/issue|bug|defect|pull\s*request/i.test(combined)) return 'issue';
    if (/commit|git|branch/i.test(combined)) return 'commit';
    if (/tweet|twitter|post/i.test(combined)) return 'tweet';

    return 'article';
  }

  /**
   * 验证 Feed 有效性
   */
  async validateFeed(url: string): Promise<boolean> {
    try {
      const xml = await this.fetchXML(url);
      const feed = await this.parseXML(xml);
      return feed.items.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * 计算内容哈希（用于去重）
   */
  computeHash(item: ParsedItem): string {
    const content = [
      item.title,
      item.link,
      item.description,
      item.guid,
      item.pubDate,
    ]
      .filter(Boolean)
      .join('|');

    return this.simpleHash(content);
  }

  /**
   * 简单哈希函数（不依赖外部库）
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    const positiveHash = Math.abs(hash);
    return positiveHash.toString(16).padStart(8, '0');
  }
}

// ------------------------------------------------
// 默认导出
// ------------------------------------------------

export default RSSAdapter;
