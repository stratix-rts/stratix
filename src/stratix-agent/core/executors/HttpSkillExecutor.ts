import { SkillDefinition, SkillExecutor, ExecutionContext } from '../../types';
import { SafetyValidator } from '../SafetyValidator';

export class HttpSkillExecutor implements SkillExecutor {
  async execute(
    skill: SkillDefinition,
    params: Record<string, any>,
    context: ExecutionContext
  ): Promise<any> {
    // Handle web_search specially - uses DuckDuckGo API
    if (skill.skillId === 'web_search') {
      const { query, num_results = 5 } = params;
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1`;

      // Validate URL
      const urlValidation = SafetyValidator.validateUrl(url, context);
      if (!urlValidation.valid) {
        throw new Error(`URL validation failed: ${urlValidation.reason}`);
      }

      try {
        const response = await fetch(url, {
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
      const { url, path } = params;

      // Validate URL
      const urlValidation = SafetyValidator.validateUrl(url, context);
      if (!urlValidation.valid) {
        throw new Error(`URL validation failed: ${urlValidation.reason}`);
      }

      try {
        const response = await fetch(url, { method: 'GET' });
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
    const url = params.url || params.endpoint;
    const method = params.method || 'GET';
    const headers = params.headers || {};

    // Validate URL
    const urlValidation = SafetyValidator.validateUrl(url, context);
    if (!urlValidation.valid) {
      throw new Error(`URL validation failed: ${urlValidation.reason}`);
    }

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: params.body ? JSON.stringify(params.body) : undefined,
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

// Need writeFile for file_download - import here to avoid top-level fs import in original
import { writeFile } from 'fs/promises';
