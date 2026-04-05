// ============================================
// WebhookAdapter.test.ts - Webhook 接收器测试
// Phase 3: P3-03
// ============================================

import { WebhookAdapter } from '../WebhookAdapter';

describe('WebhookAdapter', () => {
  let adapter: WebhookAdapter;

  beforeEach(() => {
    adapter = new WebhookAdapter();
  });

  // ==========================================
  // verifySignature Tests
  // ==========================================

  describe('verifySignature', () => {
    it('should return true for valid GitHub SHA256 signature', () => {
      const payload = '{"action":"push"}';
      const secret = 'test-secret';
      const signature = 'sha256=' + require('crypto')
        .createHmac('sha256', secret)
        .update(payload, 'utf-8')
        .digest('hex');

      expect(adapter.verifySignature(payload, signature, secret)).toBe(true);
    });

    it('should return false for invalid signature', () => {
      const payload = '{"action":"push"}';
      const secret = 'test-secret';
      const wrongSignature = 'sha256=invalid';

      expect(adapter.verifySignature(payload, wrongSignature, secret)).toBe(false);
    });

    it('should return false for empty signature', () => {
      const payload = '{"action":"push"}';
      const secret = 'test-secret';

      expect(adapter.verifySignature(payload, '', secret)).toBe(false);
    });

    it('should return false for empty secret', () => {
      const payload = '{"action":"push"}';
      const signature = 'sha256=abc123';

      expect(adapter.verifySignature(payload, signature, '')).toBe(false);
    });

    it('should handle signature without sha256= prefix', () => {
      const payload = '{"action":"push"}';
      const secret = 'test-secret';
      const signature = require('crypto')
        .createHmac('sha256', secret)
        .update(payload, 'utf-8')
        .digest('hex');

      expect(adapter.verifySignature(payload, signature, secret)).toBe(true);
    });
  });

  // ==========================================
  // parsePayload Tests
  // ==========================================

  describe('parsePayload', () => {
    it('should parse GitHub webhook payload', () => {
      const payload = JSON.stringify({
        action: 'opened',
        repository: { full_name: 'owner/repo' },
        pull_request: {
          number: 123,
          title: 'Test PR',
          body: 'Description',
          html_url: 'https://github.com/owner/repo/pull/123',
          user: { login: 'testuser' },
        },
      });
      const headers = {
        'x-github-event': 'pull_request',
        'x-github-delivery': 'abc123',
      };

      const result = adapter.parsePayload(payload, headers);

      expect(result.source).toBe('github');
      expect(result.event).toBe('pull_request');
      expect(result.action).toBe('opened');
      expect(result.data).toBeDefined();
    });

    it('should parse GitLab webhook payload', () => {
      const payload = JSON.stringify({
        object_kind: 'merge_request',
        project: { path_with_namespace: 'group/project' },
        merge_request: {
          iid: 42,
          title: 'Test MR',
          description: 'Description',
          web_url: 'https://gitlab.com/group/project/-/merge_requests/42',
          author: { username: 'testuser' },
        },
      });
      const headers = {
        'x-gitlab-event': 'Merge Request Hook',
      };

      const result = adapter.parsePayload(payload, headers);

      expect(result.source).toBe('gitlab');
      expect(result.event).toBe('merge_request');
      expect(result.data).toBeDefined();
    });

    it('should parse generic JSON webhook payload', () => {
      const payload = JSON.stringify({
        title: 'Generic Event',
        body: 'Event description',
        url: 'https://example.com/event',
      });
      const headers = {};

      const result = adapter.parsePayload(payload, headers);

      expect(result.source).toBe('generic');
      expect(result.event).toBe('webhook');
      expect(result.action).toBe('received');
    });

    it('should handle invalid JSON payload gracefully', () => {
      const payload = 'not valid json';
      const headers = {};

      const result = adapter.parsePayload(payload, headers);

      expect(result.data).toEqual({});
      expect(result.source).toBe('generic');
    });

    it('should extract timestamp from payload fields', () => {
      const payload = JSON.stringify({
        created_at: '2024-01-15T10:30:00Z',
        title: 'Test',
      });
      const headers = {};

      const result = adapter.parsePayload(payload, headers);

      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.timestamp.getUTCFullYear()).toBe(2024);
    });
  });

  // ==========================================
  // mapToRawInput Tests
  // ==========================================

  describe('mapToRawInput', () => {
    it('should map GitHub push event with commits to RawInput[]', () => {
      const webhookPayload = {
        event: 'push',
        action: 'opened',
        data: {
          ref: 'refs/heads/main',
          repository: { full_name: 'owner/repo' },
          commits: [
            {
              id: 'abc123',
              message: 'feat: add new feature\n\nDetailed description',
              url: 'https://github.com/owner/repo/commit/abc123',
              author: { name: 'Test User', email: 'test@example.com' },
            },
          ],
        },
        timestamp: new Date(),
        source: 'github',
      };
      const sourceId = 'source-1';

      const result = adapter.mapToRawInput(webhookPayload, sourceId);

      expect(result).toHaveLength(1);
      expect(result[0].sourceId).toBe(sourceId);
      expect(result[0].contentType).toBe('commit');
      expect(result[0].author).toBe('Test User');
      expect(result[0].title).toBe('feat: add new feature');
    });

    it('should map GitHub pull request to RawInput[]', () => {
      const webhookPayload = {
        event: 'pull_request',
        action: 'opened',
        data: {
          action: 'opened',
          pull_request: {
            number: 100,
            title: 'Add feature',
            body: 'PR description',
            html_url: 'https://github.com/owner/repo/pull/100',
            user: { login: 'developer' },
          },
          repository: { full_name: 'owner/repo' },
        },
        timestamp: new Date(),
        source: 'github',
      };
      const sourceId = 'source-2';

      const result = adapter.mapToRawInput(webhookPayload, sourceId);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('gh-pr-100');
      expect(result[0].title).toBe('#100: Add feature');
      expect(result[0].contentType).toBe('issue');
      expect(result[0].url).toBe('https://github.com/owner/repo/pull/100');
    });

    it('should map GitLab merge request to RawInput[]', () => {
      const webhookPayload = {
        event: 'merge_request',
        action: 'opened',
        data: {
          object_kind: 'merge_request',
          project: { path_with_namespace: 'group/project' },
          merge_request: {
            iid: 5,
            title: 'Add feature',
            description: 'MR description',
            web_url: 'https://gitlab.com/group/project/-/merge_requests/5',
            author: { username: 'developer' },
          },
        },
        timestamp: new Date(),
        source: 'gitlab',
      };
      const sourceId = 'source-3';

      const result = adapter.mapToRawInput(webhookPayload, sourceId);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('gl-mr-5');
      expect(result[0].title).toBe('!5: Add feature');
      expect(result[0].author).toBe('developer');
    });

    it('should map generic webhook to RawInput[]', () => {
      const webhookPayload = {
        event: 'custom',
        action: 'triggered',
        data: {
          title: 'Custom Event',
          body: 'Custom event content',
          url: 'https://example.com/event',
          author: 'Event Sender',
        },
        timestamp: new Date(),
        source: 'generic',
      };
      const sourceId = 'source-4';

      const result = adapter.mapToRawInput(webhookPayload, sourceId);

      expect(result).toHaveLength(1);
      expect(result[0].sourceId).toBe(sourceId);
      expect(result[0].title).toBe('Custom Event');
      expect(result[0].content).toBe('Custom event content');
    });

    it('should handle GitHub release event', () => {
      const webhookPayload = {
        event: 'release',
        action: 'published',
        data: {
          release: {
            tag_name: 'v1.0.0',
            name: 'Version 1.0.0',
            body: 'Release notes',
            html_url: 'https://github.com/owner/repo/releases/tag/v1.0.0',
            author: { login: 'release-manager' },
          },
          repository: { full_name: 'owner/repo' },
        },
        timestamp: new Date(),
        source: 'github',
      };
      const sourceId = 'source-5';

      const result = adapter.mapToRawInput(webhookPayload, sourceId);

      expect(result).toHaveLength(1);
      expect(result[0].contentType).toBe('release');
      expect(result[0].author).toBe('release-manager');
    });
  });

  // ==========================================
  // filterEvent Tests
  // ==========================================

  describe('filterEvent', () => {
    it('should return true when allowedEvents is empty', () => {
      const payload = {
        event: 'push',
        action: 'opened',
        data: {},
        timestamp: new Date(),
        source: 'github',
      };

      expect(adapter.filterEvent(payload, [])).toBe(true);
    });

    it('should return true when allowedEvents contains *', () => {
      const payload = {
        event: 'push',
        action: 'opened',
        data: {},
        timestamp: new Date(),
        source: 'github',
      };

      expect(adapter.filterEvent(payload, ['*'])).toBe(true);
    });

    it('should filter by exact event:action match', () => {
      const payload = {
        event: 'pull_request',
        action: 'opened',
        data: {},
        timestamp: new Date(),
        source: 'github',
      };

      expect(adapter.filterEvent(payload, ['pull_request:opened'])).toBe(true);
      expect(adapter.filterEvent(payload, ['pull_request:closed'])).toBe(false);
    });

    it('should filter by event only', () => {
      const payload = {
        event: 'push',
        action: 'opened',
        data: {},
        timestamp: new Date(),
        source: 'github',
      };

      expect(adapter.filterEvent(payload, ['push'])).toBe(true);
      expect(adapter.filterEvent(payload, ['pull_request'])).toBe(false);
    });

    it('should support wildcard suffix matching', () => {
      const payload = {
        event: 'pull_request',
        action: 'opened',
        data: {},
        timestamp: new Date(),
        source: 'github',
      };

      expect(adapter.filterEvent(payload, ['pull_request*'])).toBe(true);
    });

    it('should support wildcard prefix matching', () => {
      const payload = {
        event: 'github_pr',
        action: 'opened',
        data: {},
        timestamp: new Date(),
        source: 'generic',
      };

      expect(adapter.filterEvent(payload, ['*_pr'])).toBe(true);
    });

    it('should return true when any allowed event matches', () => {
      const payload = {
        event: 'issues',
        action: 'opened',
        data: {},
        timestamp: new Date(),
        source: 'github',
      };

      expect(adapter.filterEvent(payload, ['pull_request', 'issues', 'release'])).toBe(true);
      expect(adapter.filterEvent(payload, ['push', 'release'])).toBe(false);
    });
  });

  // ==========================================
  // Edge Cases
  // ==========================================

  describe('edge cases', () => {
    it('should handle empty payload object', () => {
      const payload = JSON.stringify({});
      const headers = {};

      const result = adapter.parsePayload(payload, headers);

      expect(result.data).toEqual({});
    });

    it('should generate unique hash for each input', () => {
      const payload1 = {
        event: 'push',
        action: 'opened',
        data: { title: 'First' },
        timestamp: new Date(),
        source: 'generic',
      };
      const payload2 = {
        event: 'push',
        action: 'opened',
        data: { title: 'Second' },
        timestamp: new Date(),
        source: 'generic',
      };

      const result1 = adapter.mapToRawInput(payload1, 'source');
      const result2 = adapter.mapToRawInput(payload2, 'source');

      expect(result1[0].hash).not.toBe(result2[0].hash);
    });
  });
});
