// ============================================
// WebhookAdapter - Webhook 接收器
// Phase 3: P3-03
// ============================================

import * as crypto from 'crypto';
import type { RawInput, ContentType, SourceType } from '../types';

// ------------------------------------------------
// Webhook Payload 接口
// ------------------------------------------------

export interface WebhookPayload {
  event: string;
  action: string;
  data: Record<string, unknown>;
  timestamp: Date;
  source: string;
}

// ------------------------------------------------
// Webhook 来源类型
// ------------------------------------------------

type WebhookSource = 'github' | 'gitlab' | 'generic';

// ------------------------------------------------
// GitHub Webhook 格式
// ------------------------------------------------

interface GitHubWebhook {
  action?: string;
  ref?: string;
  repository?: {
    full_name: string;
    clone_url: string;
    html_url: string;
  };
  sender?: {
    login: string;
  };
  commits?: Array<{
    id: string;
    message: string;
    url: string;
    author: {
      name: string;
      email: string;
    };
  }>;
  head_commit?: {
    id: string;
    message: string;
    url: string;
    author: {
      name: string;
      email: string;
    };
  };
  pull_request?: {
    number: number;
    title: string;
    body: string;
    html_url: string;
    user: {
      login: string;
    };
  };
  issue?: {
    number: number;
    title: string;
    body: string;
    html_url: string;
    user: {
      login: string;
    };
  };
  release?: {
    tag_name: string;
    name: string;
    body: string;
    html_url: string;
    author: {
      login: string;
    };
  };
  workflow_run?: {
    name: string;
    conclusion: string | null;
    html_url: string;
  };
  [key: string]: unknown;
}

// ------------------------------------------------
// GitLab Webhook 格式
// ------------------------------------------------

interface GitLabWebhook {
  object_kind?: string;
  event_name?: string;
  project?: {
    path_with_namespace: string;
    git_http_url: string;
    web_url: string;
  };
  user_name?: string;
  commits?: Array<{
    id: string;
    message: string;
    url: string;
    author: {
      name: string;
      email: string;
    };
  }>;
  merge_request?: {
    iid: number;
    title: string;
    description: string;
    web_url: string;
    author: {
      username: string;
    };
  };
  issue?: {
    iid: number;
    title: string;
    description: string;
    web_url: string;
    author: {
      username: string;
    };
  };
  release?: {
    tag: string;
    name: string;
    description: string;
    url: string;
    author: {
      name: string;
    };
  };
  [key: string]: unknown;
}

// ------------------------------------------------
// WebhookAdapter
// ------------------------------------------------

export class WebhookAdapter {
  /**
   * 验证 webhook 签名 (HMAC-SHA256)
   * 支持 GitHub X-Hub-Signature-256 格式
   */
  verifySignature(payload: string, signature: string, secret: string): boolean {
    if (!signature || !secret) {
      return false;
    }

    const expectedSignature = this.computeHmacSignature(payload, secret);

    // GitHub 格式: sha256=<signature>
    const actualSignature = signature.startsWith('sha256=')
      ? signature
      : `sha256=${signature}`;

    return this.constantTimeCompare(expectedSignature, actualSignature);
  }

  /**
   * 计算 HMAC-SHA256 签名
   */
  private computeHmacSignature(payload: string, secret: string): string {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payload, 'utf-8');
    return `sha256=${hmac.digest('hex')}`;
  }

  /**
   * 常数时间比较，防止时序攻击
   */
  private constantTimeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }

  /**
   * 解析 webhook payload
   * 自动检测来源 (GitHub / GitLab / Generic)
   */
  parsePayload(payload: string, headers: Record<string, string>): WebhookPayload {
    const normalizedPayload = this.normalizePayload(payload);
    const source = this.detectSource(headers, normalizedPayload);

    return this.mapToWebhookPayload(normalizedPayload, source, headers);
  }

  /**
   * 标准化 payload 字符串为对象
   */
  private normalizePayload(payload: string): Record<string, unknown> {
    try {
      return JSON.parse(payload);
    } catch {
      return {};
    }
  }

  /**
   * 检测 webhook 来源
   */
  private detectSource(
    headers: Record<string, string>,
    payload: Record<string, unknown>
  ): WebhookSource {
    const event = headers['x-github-event'] || headers['x-gitlab-event'];
    if (event) {
      if (headers['x-github-event']) return 'github';
      if (headers['x-gitlab-event']) return 'gitlab';
    }

    // 根据 payload 结构推断
    if (this.isGitHubPayload(payload)) return 'github';
    if (this.isGitLabPayload(payload)) return 'gitlab';

    return 'generic';
  }

  private isGitHubPayload(payload: Record<string, unknown>): boolean {
    return 'repository' in payload || 'pull_request' in payload || 'issue' in payload;
  }

  private isGitLabPayload(payload: Record<string, unknown>): boolean {
    return 'object_kind' in payload || 'project' in payload || 'merge_request' in payload;
  }

  /**
   * 映射原始 payload 到 WebhookPayload
   */
  private mapToWebhookPayload(
    payload: Record<string, unknown>,
    source: WebhookSource,
    headers: Record<string, string>
  ): WebhookPayload {
    const timestamp = this.extractTimestamp(payload, headers);
    const { event, action } = this.extractEventAndAction(payload, source, headers);

    return {
      event,
      action,
      data: payload,
      timestamp,
      source,
    };
  }

  /**
   * 提取时间戳
   */
  private extractTimestamp(
    payload: Record<string, unknown>,
    headers: Record<string, string>
  ): Date {
    // 优先从 headers 提取
    const deliveryHeader = headers['x-github-delivery'] || headers['x-gitlab-delivery'];
    if (deliveryHeader) {
      // 如果有 delivery ID，使用当前时间
      return new Date();
    }

    // 从 payload 提取
    const timestampFields = ['created_at', 'timestamp', 'time', 'updated_at'];
    for (const field of timestampFields) {
      if (payload[field]) {
        const date = new Date(payload[field] as string);
        if (!isNaN(date.getTime())) {
          return date;
        }
      }
    }

    return new Date();
  }

  /**
   * 提取事件类型和动作
   */
  private extractEventAndAction(
    payload: Record<string, unknown>,
    source: WebhookSource,
    headers: Record<string, string>
  ): { event: string; action: string } {
    switch (source) {
      case 'github': {
        const githubPayload = payload as unknown as GitHubWebhook;
        const event = headers['x-github-event'] || 'unknown';
        const action = githubPayload.action || 'unknown';
        return { event, action };
      }
      case 'gitlab': {
        const gitlabPayload = payload as unknown as GitLabWebhook;
        const event = gitlabPayload.object_kind || gitlabPayload.event_name || 'unknown';
        const action = gitlabPayload.object_kind || 'unknown';
        return { event, action };
      }
      default:
        return { event: 'webhook', action: 'received' };
    }
  }

  /**
   * 映射 WebhookPayload 到 RawInput[]
   */
  mapToRawInput(payload: WebhookPayload, sourceId: string): RawInput[] {
    const results: RawInput[] = [];
    const githubPayload = payload.data as unknown as GitHubWebhook;
    const gitlabPayload = payload.data as unknown as GitLabWebhook;

    switch (payload.source) {
      case 'github':
        this.extractGitHubInputs(githubPayload, sourceId, results);
        break;
      case 'gitlab':
        this.extractGitLabInputs(gitlabPayload, sourceId, results);
        break;
      default:
        this.extractGenericInputs(payload, sourceId, results);
    }

    return results;
  }

  /**
   * 提取 GitHub webhook 数据
   */
  private extractGitHubInputs(
    payload: GitHubWebhook,
    sourceId: string,
    results: RawInput[]
  ): void {
    // Push 事件
    if (payload.commits && payload.commits.length > 0) {
      for (const commit of payload.commits) {
        results.push({
          id: `gh-commit-${commit.id}`,
          sourceId,
          sourceType: 'webhook',
          title: this.extractCommitTitle(commit.message),
          content: commit.message,
          url: commit.url,
          author: commit.author?.name,
          publishedAt: new Date(),
          fetchedAt: new Date(),
          contentType: 'commit',
          metadata: {
            commitId: commit.id,
            repository: payload.repository?.full_name,
          },
          hash: this.computeContentHash(commit.message + commit.id),
        });
      }
    }

    // Head commit (PR merge, tag push 等)
    if (payload.head_commit && payload.commits?.length === undefined) {
      const commit = payload.head_commit;
      results.push({
        id: `gh-commit-${commit.id}`,
        sourceId,
        sourceType: 'webhook',
        title: this.extractCommitTitle(commit.message),
        content: commit.message,
        url: commit.url,
        author: commit.author?.name,
        publishedAt: new Date(),
        fetchedAt: new Date(),
        contentType: 'commit',
        metadata: {
          commitId: commit.id,
          repository: payload.repository?.full_name,
        },
        hash: this.computeContentHash(commit.message + commit.id),
      });
    }

    // Pull Request 事件
    if (payload.pull_request) {
      const pr = payload.pull_request;
      results.push({
        id: `gh-pr-${pr.number}`,
        sourceId,
        sourceType: 'webhook',
        title: `#${pr.number}: ${pr.title}`,
        content: pr.body || '',
        url: pr.html_url,
        author: pr.user?.login,
        publishedAt: new Date(),
        fetchedAt: new Date(),
        contentType: 'issue',
        metadata: {
          prNumber: pr.number,
          repository: payload.repository?.full_name,
        },
        hash: this.computeContentHash(`pr-${pr.number}-${pr.title}`),
      });
    }

    // Issue 事件
    if (payload.issue) {
      const issue = payload.issue;
      results.push({
        id: `gh-issue-${issue.number}`,
        sourceId,
        sourceType: 'webhook',
        title: `#${issue.number}: ${issue.title}`,
        content: issue.body || '',
        url: issue.html_url,
        author: issue.user?.login,
        publishedAt: new Date(),
        fetchedAt: new Date(),
        contentType: 'issue',
        metadata: {
          issueNumber: issue.number,
          repository: payload.repository?.full_name,
        },
        hash: this.computeContentHash(`issue-${issue.number}-${issue.title}`),
      });
    }

    // Release 事件
    if (payload.release) {
      const release = payload.release;
      results.push({
        id: `gh-release-${release.tag_name}`,
        sourceId,
        sourceType: 'webhook',
        title: `Release ${release.tag_name}: ${release.name || release.tag_name}`,
        content: release.body || '',
        url: release.html_url,
        author: release.author?.login,
        publishedAt: new Date(),
        fetchedAt: new Date(),
        contentType: 'release',
        metadata: {
          tagName: release.tag_name,
          repository: payload.repository?.full_name,
        },
        hash: this.computeContentHash(`release-${release.tag_name}`),
      });
    }

    // Workflow run 事件
    if (payload.workflow_run) {
      const wf = payload.workflow_run;
      results.push({
        id: `gh-workflow-${wf.name}-${Date.now()}`,
        sourceId,
        sourceType: 'webhook',
        title: `Workflow: ${wf.name} - ${wf.conclusion || 'running'}`,
        content: `Workflow "${wf.name}" completed with status: ${wf.conclusion || 'unknown'}`,
        url: wf.html_url,
        fetchedAt: new Date(),
        contentType: 'other',
        metadata: {
          workflowName: wf.name,
          conclusion: wf.conclusion,
          repository: payload.repository?.full_name,
        },
        hash: this.computeContentHash(`workflow-${wf.name}-${Date.now()}`),
      });
    }
  }

  /**
   * 提取 GitLab webhook 数据
   */
  private extractGitLabInputs(
    payload: GitLabWebhook,
    sourceId: string,
    results: RawInput[]
  ): void {
    const projectName = payload.project?.path_with_namespace || 'unknown';

    // Push 事件
    if (payload.commits && payload.commits.length > 0) {
      for (const commit of payload.commits) {
        results.push({
          id: `gl-commit-${commit.id}`,
          sourceId,
          sourceType: 'webhook',
          title: this.extractCommitTitle(commit.message),
          content: commit.message,
          url: commit.url,
          author: commit.author?.name,
          publishedAt: new Date(),
          fetchedAt: new Date(),
          contentType: 'commit',
          metadata: {
            commitId: commit.id,
            project: projectName,
          },
          hash: this.computeContentHash(commit.message + commit.id),
        });
      }
    }

    // Merge Request 事件
    if (payload.merge_request) {
      const mr = payload.merge_request;
      results.push({
        id: `gl-mr-${mr.iid}`,
        sourceId,
        sourceType: 'webhook',
        title: `!${mr.iid}: ${mr.title}`,
        content: mr.description || '',
        url: mr.web_url,
        author: mr.author?.username,
        publishedAt: new Date(),
        fetchedAt: new Date(),
        contentType: 'issue',
        metadata: {
          mrIid: mr.iid,
          project: projectName,
        },
        hash: this.computeContentHash(`mr-${mr.iid}-${mr.title}`),
      });
    }

    // Issue 事件
    if (payload.issue) {
      const issue = payload.issue;
      results.push({
        id: `gl-issue-${issue.iid}`,
        sourceId,
        sourceType: 'webhook',
        title: `#${issue.iid}: ${issue.title}`,
        content: issue.description || '',
        url: issue.web_url,
        author: issue.author?.username,
        publishedAt: new Date(),
        fetchedAt: new Date(),
        contentType: 'issue',
        metadata: {
          issueIid: issue.iid,
          project: projectName,
        },
        hash: this.computeContentHash(`issue-${issue.iid}-${issue.title}`),
      });
    }

    // Release 事件
    if (payload.release) {
      const release = payload.release;
      results.push({
        id: `gl-release-${release.tag}`,
        sourceId,
        sourceType: 'webhook',
        title: `Release ${release.tag}: ${release.name || release.tag}`,
        content: release.description || '',
        url: release.url,
        author: release.author?.name,
        publishedAt: new Date(),
        fetchedAt: new Date(),
        contentType: 'release',
        metadata: {
          tag: release.tag,
          project: projectName,
        },
        hash: this.computeContentHash(`release-${release.tag}`),
      });
    }
  }

  /**
   * 提取通用 JSON webhook 数据
   */
  private extractGenericInputs(
    payload: WebhookPayload,
    sourceId: string,
    results: RawInput[]
  ): void {
    // 尝试从常见字段提取
    const title = this.extractField<string>(payload.data, ['title', 'name', 'subject', 'summary']);
    const content = this.extractField<string>(payload.data, ['body', 'description', 'content', 'text', 'message']);
    const url = this.extractField<string>(payload.data, ['url', 'link', 'html_url', 'web_url', 'href']);
    const author = this.extractField<string>(payload.data, ['author', 'user', 'sender', 'created_by']);

    const extractedTitle = title || `${payload.event}: ${payload.action}`;

    results.push({
      id: `generic-${this.computeContentHash(extractedTitle + Date.now())}`,
      sourceId,
      sourceType: 'webhook',
      title: extractedTitle,
      content: content || JSON.stringify(payload.data),
      url,
      author,
      publishedAt: payload.timestamp,
      fetchedAt: new Date(),
      contentType: this.inferContentType(payload.data),
      metadata: {
        event: payload.event,
        action: payload.action,
      },
      hash: this.computeContentHash(extractedTitle + (content || '')),
    });
  }

  /**
   * 从对象中提取指定字段
   */
  private extractField<T>(obj: Record<string, unknown>, fields: string[]): T | undefined {
    for (const field of fields) {
      if (obj[field] !== undefined && obj[field] !== null) {
        return obj[field] as T;
      }
    }
    return undefined;
  }

  /**
   * 从 commit message 提取标题 (第一行)
   */
  private extractCommitTitle(message: string): string {
    const firstLine = message.split('\n')[0];
    return firstLine.length > 80 ? firstLine.substring(0, 77) + '...' : firstLine;
  }

  /**
   * 推断内容类型
   */
  private inferContentType(data: Record<string, unknown>): ContentType {
    if (data['commit'] || data['commits'] || data['head_commit']) return 'commit';
    if (data['pull_request'] || data['merge_request']) return 'issue';
    if (data['issue']) return 'issue';
    if (data['release']) return 'release';
    if (data['changelog'] || data['changelog_entries']) return 'changelog';
    if (data['tweet'] || data['twitter']) return 'tweet';
    return 'other';
  }

  /**
   * 计算内容 hash (用于去重)
   */
  private computeContentHash(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf-8').digest('hex').substring(0, 16);
  }

  /**
   * 事件过滤
   */
  filterEvent(payload: WebhookPayload, allowedEvents: string[]): boolean {
    if (!allowedEvents || allowedEvents.length === 0) {
      return true; // 没有配置过滤规则，允许所有
    }

    const eventKey = `${payload.event}:${payload.action}`;
    const eventOnly = payload.event;

    return allowedEvents.some(allowed => {
      if (allowed === '*') return true;
      if (allowed === eventKey) return true;
      if (allowed === eventOnly) return true;
      // 支持通配符: push*, *push
      if (allowed.endsWith('*') && eventOnly.startsWith(allowed.slice(0, -1))) return true;
      if (allowed.startsWith('*') && eventOnly.endsWith(allowed.slice(1))) return true;
      return false;
    });
  }
}
