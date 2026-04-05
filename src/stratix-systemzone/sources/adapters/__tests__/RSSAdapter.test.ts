// ============================================
// RSSAdapter.test.ts - RSS 适配器测试
// Phase 3: 外部信息源 - RSS 源适配器
// ============================================

import { RSSAdapter } from '../RSSAdapter';

// ------------------------------------------------
// Mock XML 数据
// ------------------------------------------------

const RSS2_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <link>https://example.com</link>
    <description>A test RSS feed</description>
    <item>
      <title>Article One</title>
      <link>https://example.com/article-1</link>
      <description>This is article one description</description>
      <pubDate>Wed, 01 Apr 2026 10:00:00 GMT</pubDate>
      <author>author1@example.com</author>
      <guid>article-1-guid</guid>
      <category>Tech</category>
      <category>News</category>
    </item>
    <item>
      <title>Article Two</title>
      <link>https://example.com/article-2</link>
      <description>This is article two description</description>
      <pubDate>Thu, 02 Apr 2026 12:00:00 GMT</pubDate>
      <dc:creator>Author Two</dc:creator>
      <guid>article-2-guid</guid>
    </item>
    <item>
      <title>Release v1.0.0</title>
      <link>https://example.com/release-1</link>
      <description>Version 1.0.0 release announcement</description>
      <pubDate>Fri, 03 Apr 2026 08:00:00 GMT</pubDate>
      <guid>release-1-guid</guid>
    </item>
  </channel>
</rss>`;

const RSS2_MINIMAL = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Minimal Feed</title>
    <item>
      <title>Minimal Article</title>
      <link>https://example.com/minimal</link>
    </item>
  </channel>
</rss>`;

const RSS_EMPTY = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Empty Feed</title>
    <link>https://example.com</link>
    <description>No items here</description>
  </channel>
</rss>`;

const ATOM_SAMPLE = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <subtitle>Atom format test</subtitle>
  <link rel="alternate" type="text/html" href="https://atom.example.com"/>
  <entry>
    <title>Atom Entry One</title>
    <link rel="alternate" type="text/html" href="https://atom.example.com/entry-1"/>
    <summary>Atom entry one summary</summary>
    <updated>2026-04-02T10:00:00Z</updated>
    <author><name>Atom Author</name></author>
    <id>atom-entry-1</id>
    <category term="Atom"/>
    <category term="Test"/>
  </entry>
  <entry>
    <title>Atom Entry Two</title>
    <link rel="alternate" type="text/html" href="https://atom.example.com/entry-2"/>
    <content>Atom entry two full content</content>
    <published>2026-04-03T08:00:00Z</published>
    <id>atom-entry-2</id>
  </entry>
</feed>`;

const ATOM_NO_LINK = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom No Link Feed</title>
  <entry>
    <title>No Link Entry</title>
    <id>no-link-entry</id>
  </entry>
</feed>`;

const INVALID_XML = `<?xml version="1.0"?>
<root><unclosed>`;

const MALFORMED_XML = `not xml at all`;

// ------------------------------------------------
// 测试用例
// ------------------------------------------------

describe('RSSAdapter', () => {
  let adapter: RSSAdapter;

  beforeEach(() => {
    adapter = new RSSAdapter();
  });

  describe('parseXML', () => {
    test('parses RSS 2.0 feed correctly', async () => {
      const feed = await adapter.parseXML(RSS2_SAMPLE);

      expect(feed.title).toBe('Test Feed');
      expect(feed.link).toBe('https://example.com');
      expect(feed.description).toBe('A test RSS feed');
      expect(feed.feedType).toBe('rss');
      expect(feed.items).toHaveLength(3);
    });

    test('extracts all RSS item fields', async () => {
      const feed = await adapter.parseXML(RSS2_SAMPLE);
      const item = feed.items[0];

      expect(item.title).toBe('Article One');
      expect(item.link).toBe('https://example.com/article-1');
      expect(item.description).toBe('This is article one description');
      expect(item.pubDate).toBe('Wed, 01 Apr 2026 10:00:00 GMT');
      expect(item.author).toBe('author1@example.com');
      expect(item.guid).toBe('article-1-guid');
      expect(item.categories).toEqual(['Tech', 'News']);
    });

    test('handles dc:creator namespace', async () => {
      const feed = await adapter.parseXML(RSS2_SAMPLE);
      const item = feed.items[1];

      expect(item.author).toBe('Author Two');
    });

    test('parses Atom feed correctly', async () => {
      const feed = await adapter.parseXML(ATOM_SAMPLE);

      expect(feed.title).toBe('Atom Feed');
      expect(feed.link).toBe('https://atom.example.com');
      expect(feed.description).toBe('Atom format test');
      expect(feed.feedType).toBe('atom');
      expect(feed.items).toHaveLength(2);
    });

    test('extracts Atom entry fields correctly', async () => {
      const feed = await adapter.parseXML(ATOM_SAMPLE);
      const item = feed.items[0];

      expect(item.title).toBe('Atom Entry One');
      expect(item.link).toBe('https://atom.example.com/entry-1');
      expect(item.description).toBe('Atom entry one summary');
      expect(item.pubDate).toBe('2026-04-02T10:00:00Z');
      expect(item.author).toBe('Atom Author');
      expect(item.guid).toBe('atom-entry-1');
      expect(item.categories).toEqual(['Atom', 'Test']);
    });

    test('uses content:encoded when available in RSS', async () => {
      const rssWithContent = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Content Feed</title>
    <item>
      <title>Full Content Article</title>
      <link>https://example.com/full-content</link>
      <description>Short description</description>
      <content:encoded><![CDATA[<p>Full HTML content here</p>]]></content:encoded>
      <pubDate>Wed, 01 Apr 2026 10:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

      const feed = await adapter.parseXML(rssWithContent);
      const item = feed.items[0];

      expect(item.content).toBe('<p>Full HTML content here</p>');
    });

    test('throws error for invalid XML', async () => {
      await expect(adapter.parseXML(INVALID_XML)).rejects.toThrow('Invalid XML format');
    });

    test('throws error for malformed XML', async () => {
      await expect(adapter.parseXML(MALFORMED_XML)).rejects.toThrow('Unknown feed format');
    });

    test('throws error for empty document', async () => {
      const emptyDoc = `<?xml version="1.0"?><root></root>`;
      await expect(adapter.parseXML(emptyDoc)).rejects.toThrow('Unknown feed format');
    });

    test('handles RSS with no items', async () => {
      const feed = await adapter.parseXML(RSS_EMPTY);

      expect(feed.title).toBe('Empty Feed');
      expect(feed.items).toHaveLength(0);
    });

    test('handles RSS with minimal item (only title and link)', async () => {
      const feed = await adapter.parseXML(RSS2_MINIMAL);

      expect(feed.items).toHaveLength(1);
      expect(feed.items[0].title).toBe('Minimal Article');
      expect(feed.items[0].link).toBe('https://example.com/minimal');
      expect(feed.items[0].description).toBe('');
    });

    test('handles Atom entry with no link element', async () => {
      const feed = await adapter.parseXML(ATOM_NO_LINK);

      expect(feed.items).toHaveLength(1);
      expect(feed.items[0].title).toBe('No Link Entry');
      expect(feed.items[0].link).toBe('');
    });

    test('uses published vs updated for Atom', async () => {
      const feed = await adapter.parseXML(ATOM_SAMPLE);
      const item2 = feed.items[1];

      // Second entry uses <published> not <updated>
      expect(item2.pubDate).toBe('2026-04-03T08:00:00Z');
    });
  });

  describe('mapToRawInput', () => {
    test('maps RSS items to RawInput array', async () => {
      const feed = await adapter.parseXML(RSS2_SAMPLE);
      const inputs = adapter.mapToRawInput(feed.items, 'test-source-id');

      expect(inputs).toHaveLength(3);
      expect(inputs[0].sourceId).toBe('test-source-id');
      expect(inputs[0].sourceType).toBe('rss');
    });

    test('sets correct RawInput fields', async () => {
      const feed = await adapter.parseXML(RSS2_SAMPLE);
      const inputs = adapter.mapToRawInput(feed.items, 'source-1');
      const input = inputs[0];

      expect(input.id).toBe(input.hash); // id equals hash
      expect(input.title).toBe('Article One');
      expect(input.content).toBe('This is article one description');
      expect(input.url).toBe('https://example.com/article-1');
      expect(input.author).toBe('author1@example.com');
      expect(input.publishedAt).toBeInstanceOf(Date);
      expect(input.contentType).toBe('article');
      expect(input.metadata).toBeDefined();
      expect(input.metadata?.guid).toBe('article-1-guid');
      expect(input.metadata?.categories).toEqual(['Tech', 'News']);
    });

    test('detects changelog content type', async () => {
      const feed = await adapter.parseXML(RSS2_SAMPLE);
      const inputs = adapter.mapToRawInput(feed.items, 'source-1');

      // Article Three is "Release v1.0.0" - should be detected as changelog
      expect(inputs[2].contentType).toBe('changelog');
    });

    test('handles missing optional fields', async () => {
      const feed = await adapter.parseXML(RSS2_MINIMAL);
      const inputs = adapter.mapToRawInput(feed.items, 'source-1');
      const input = inputs[0];

      expect(input.url).toBe('https://example.com/minimal');
      expect(input.author).toBeUndefined();
      expect(input.publishedAt).toBeUndefined();
    });
  });

  describe('computeHash', () => {
    test('generates consistent hash for same item', async () => {
      const feed = await adapter.parseXML(RSS2_SAMPLE);
      const item = feed.items[0];

      const hash1 = adapter.computeHash(item);
      const hash2 = adapter.computeHash(item);

      expect(hash1).toBe(hash2);
    });

    test('generates different hash for different items', async () => {
      const feed = await adapter.parseXML(RSS2_SAMPLE);

      const hash1 = adapter.computeHash(feed.items[0]);
      const hash2 = adapter.computeHash(feed.items[1]);

      expect(hash1).not.toBe(hash2);
    });

    test('generates 8-character hex hash', async () => {
      const feed = await adapter.parseXML(RSS2_SAMPLE);
      const hash = adapter.computeHash(feed.items[0]);

      expect(hash).toMatch(/^[0-9a-f]{8}$/);
    });

    test('hash is stable across parseXML calls', async () => {
      const feed1 = await adapter.parseXML(RSS2_SAMPLE);
      const feed2 = await adapter.parseXML(RSS2_SAMPLE);
      const item1 = feed1.items[0];
      const item2 = feed2.items[0];

      expect(adapter.computeHash(item1)).toBe(adapter.computeHash(item2));
    });
  });

  describe('validateFeed', () => {
    test('returns true for valid RSS feed', async () => {
      // Mock fetch to return valid XML
      const globalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(RSS2_SAMPLE),
      });

      const result = await adapter.validateFeed('https://example.com/feed');

      expect(result).toBe(true);
      global.fetch = globalFetch;
    });

    test('returns true for valid Atom feed', async () => {
      const globalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(ATOM_SAMPLE),
      });

      const result = await adapter.validateFeed('https://example.com/atom');

      expect(result).toBe(true);
      global.fetch = globalFetch;
    });

    test('returns false for invalid URL', async () => {
      const globalFetch = global.fetch;
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      const result = await adapter.validateFeed('https://invalid.example.com');

      expect(result).toBe(false);
      global.fetch = globalFetch;
    });

    test('returns false for empty feed', async () => {
      const globalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(RSS_EMPTY),
      });

      const result = await adapter.validateFeed('https://example.com/empty');

      expect(result).toBe(false);
      global.fetch = globalFetch;
    });

    test('returns false for malformed XML', async () => {
      const globalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(MALFORMED_XML),
      });

      const result = await adapter.validateFeed('https://example.com/malformed');

      expect(result).toBe(false);
      global.fetch = globalFetch;
    });

    test('returns false for HTTP error status', async () => {
      const globalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const result = await adapter.validateFeed('https://example.com/notfound');

      expect(result).toBe(false);
      global.fetch = globalFetch;
    });
  });

  describe('fetch (with mocked fetch)', () => {
    test('fetches and returns RawInput array', async () => {
      const globalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(RSS2_SAMPLE),
      });

      const inputs = await adapter.fetch('https://example.com/feed');

      expect(inputs).toHaveLength(3);
      expect(inputs[0]).toHaveProperty('id');
      expect(inputs[0]).toHaveProperty('sourceId', 'https://example.com/feed');
      expect(inputs[0]).toHaveProperty('sourceType', 'rss');
      expect(inputs[0]).toHaveProperty('title');
      expect(inputs[0]).toHaveProperty('content');
      expect(inputs[0]).toHaveProperty('fetchedAt');

      global.fetch = globalFetch;
    });

    test('respects maxItems config', async () => {
      const globalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(RSS2_SAMPLE),
      });

      const inputs = await adapter.fetch('https://example.com/feed', {
        feedUrl: 'https://example.com/feed',
        maxItems: 2,
        refreshInterval: 3600000,
      });

      expect(inputs).toHaveLength(2);

      global.fetch = globalFetch;
    });

    test('throws on network error', async () => {
      const globalFetch = global.fetch;
      global.fetch = jest.fn().mockRejectedValue(new Error('Network failure'));

      await expect(adapter.fetch('https://example.com/feed')).rejects.toThrow('Network failure');

      global.fetch = globalFetch;
    });

    test('throws on timeout', async () => {
      const globalFetch = global.fetch;
      // Create a slow promise that never resolves
      global.fetch = jest.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ ok: true, text: () => Promise.resolve(RSS2_SAMPLE) }), 60000);
          })
      );

      await expect(adapter.fetch('https://example.com/feed')).rejects.toThrow(/timeout/i);

      global.fetch = globalFetch;
    });
  });
});
