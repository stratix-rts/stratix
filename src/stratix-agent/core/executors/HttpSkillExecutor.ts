import { writeFile } from 'fs/promises';
import { SkillDefinition, SkillExecutor, ExecutionContext } from '../../types';
import { SafetyValidator } from '../SafetyValidator';

/** Default number of search results for web_search */
const DEFAULT_SEARCH_RESULTS = 5;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number = 30000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

export class HttpSkillExecutor implements SkillExecutor {
  async execute(
    skill: SkillDefinition,
    params: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<unknown> {
    // Handle web_search specially - uses DuckDuckGo API
    if (skill.skillId === 'web_search') {
      const query = typeof params.query === 'string' ? params.query : '';
      const num_results = typeof params.num_results === 'number' ? params.num_results : DEFAULT_SEARCH_RESULTS;
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1`;

      // Validate URL
      const urlValidation = SafetyValidator.validateUrl(url, context);
      if (!urlValidation.valid) {
        throw new Error(`URL validation failed: ${urlValidation.reason}`);
      }

      try {
        const response = await fetchWithTimeout(url, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
        });

        const data = await response.json();

        // Extract relevant results
        const results: { title: string; url: string; snippet: string }[] = [];

        if (data.RelatedTopics && data.RelatedTopics.length > 0) {
          for (const topic of data.RelatedTopics.slice(0, num_results)) {
            if (topic.Text && topic.FirstURL) {
              results.push({
                title: topic.Text.split(' - ')[0] || topic.Text,
                url: topic.FirstURL,
                snippet: topic.Text,
              });
            }
          }
        }

        // Also include Abstract if available
        if (data.AbstractText && results.length < num_results) {
          results.unshift({
            title: data.Heading || 'Wikipedia Summary',
            url: data.AbstractURL || '',
            snippet: data.AbstractText,
          });
        }

        return {
          query,
          results: results.slice(0, num_results),
          total: results.length,
        };
      } catch (error) {
        throw new Error(`Web search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Handle file_download specially - fetch and save to file
    if (skill.skillId === 'file_download') {
      const url = typeof params.url === 'string' ? params.url : '';
      const path = typeof params.path === 'string' ? params.path : '';

      // Validate URL
      const urlValidation = SafetyValidator.validateUrl(url, context);
      if (!urlValidation.valid) {
        throw new Error(`URL validation failed: ${urlValidation.reason}`);
      }

      try {
        const response = await fetchWithTimeout(url, { method: 'GET' });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const buffer = await response.arrayBuffer();
        await writeFile(path, Buffer.from(buffer));

        return { success: true, path, size: buffer.byteLength };
      } catch (error) {
        throw new Error(`File download failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Default HTTP handling for generic API calls
    const url = typeof params.url === 'string' ? params.url : (typeof params.endpoint === 'string' ? params.endpoint : '');
    const method = typeof params.method === 'string' ? params.method : 'GET';
    const headers = typeof params.headers === 'object' && params.headers !== null ? params.headers as Record<string, string> : {};

    // Validate URL
    const urlValidation = SafetyValidator.validateUrl(url, context);
    if (!urlValidation.valid) {
      throw new Error(`URL validation failed: ${urlValidation.reason}`);
    }

    try {
      const response = await fetchWithTimeout(url, {
        method: typeof method === 'string' ? method : 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(typeof headers === 'object' && headers !== null ? headers : {}),
        },
        body: params.body !== undefined && params.body !== null ? JSON.stringify(params.body) : undefined,
      });

      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        return await response.json();
      }
      return await response.text();
    } catch (error) {
      throw new Error(`HTTP request failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}


