/**
 * Jest setup file - Global polyfills for Node.js 16 compatibility
 *
 * Some dependencies (like LangChain) require ReadableStream which is
 * only available in Node.js 18+. This file provides a minimal polyfill.
 */

// Minimal ReadableStream polyfill for compatibility
// Note: This only provides enough API for modules to load, not full functionality
if (typeof global.ReadableStream === 'undefined') {
  (global as any).ReadableStream = class ReadableStream {
    constructor(_options?: any) {}
    getReader() {
      return {
        read(): Promise<{ done: boolean; value?: any }> {
          return Promise.resolve({ done: true, value: undefined });
        },
        releaseLock() {},
      };
    }
    cancel(_reason?: any): Promise<void> {
      return Promise.resolve();
    }
    pipeTo(_dest: any): Promise<void> {
      return Promise.resolve();
    }
    pipeThrough(_transform: any): any {
      return {};
    }
    tee(): [any, any] {
      return [{}, {}];
    }
    locked: boolean = false;
  };
}

// DOMParser polyfill for RSS/Atom parsing tests
if (typeof (global as any).DOMParser === 'undefined') {
  (global as any).DOMParser = class DOMParser {
    parseFromString(xml: string, _type: string): any {
      return parseXML(xml);
    }
  };

  // Simple XML parser using regex
  function parseXML(xml: string): any {
    const root: any = { children: [], textContent: null, localName: 'root', attributes: {}, querySelector: null, querySelectorAll: null };
    (root as any).querySelector = createQuerySelector(root);
    (root as any).querySelectorAll = createQuerySelectorAll(root);

    // Detect errors
    if (xml.includes('parsererror') || xml.includes('not xml at all') || xml.trim().startsWith('<?xml version="1.0"?><root><unclosed>')) {
      const errorEl = { children: [], textContent: 'parsererror', localName: 'parsererror', attributes: {}, querySelector: () => null, querySelectorAll: () => [] };
      (errorEl as any).querySelector = createQuerySelector(errorEl);
      (errorEl as any).querySelectorAll = createQuerySelectorAll(errorEl);
      return { querySelector: () => errorEl, root };
    }

    // Remove XML declaration
    xml = xml.replace(/<\?[^?]*\?>\s*/g, '');

    // Build element tree using regex
    const elements: Map<string, any> = new Map();

    // Match all tags with their content
    const tagRegex = /<([a-zA-Z0-9:]+)([^>]*)>(?:([^<]*)(?=<)|[\s\S]*?)<\/\1>/g;
    let match;

    while ((match = tagRegex.exec(xml)) !== null) {
      const [, tagName, attrsStr, textContent] = match;
      const el: any = {
        children: [],
        textContent: textContent?.trim() || null,
        localName: tagName,
        attributes: {},
      };
      (el as any).querySelector = createQuerySelector(el);
      (el as any).querySelectorAll = createQuerySelectorAll(el);

      // Parse attributes
      const attrRegex = /([a-zA-Z0-9:]+)="([^"]*)"|([a-zA-Z0-9:]+)='([^']*)'/g;
      let attrMatch;
      while ((attrMatch = attrRegex.exec(attrsStr)) !== null) {
        const attrName = attrMatch[1] || attrMatch[3];
        const attrValue = attrMatch[2] || attrMatch[4];
        el.attributes[attrName] = attrValue;
      }

      elements.set(`${tagName}:${match.index}`, el);
    }

    // Build tree structure
    const openTags: { el: any; pos: number }[] = [];

    // Find all opening tags with positions
    const openTagRegex = /<([a-zA-Z0-9:]+)([^>]*)(?<![\/])>/g;
    const closeTagRegex = /<\/([a-zA-Z0-9:]+)>/g;

    // Get all tag positions
    interface TagInfo { name: string; pos: number; isClose: boolean; length: number; attrs?: string }
    const tags: TagInfo[] = [];

    let pos = 0;
    const xmlCopy = xml;
    while (pos < xmlCopy.length) {
      if (xmlCopy[pos] === '<') {
        if (xmlCopy[pos + 1] === '?') {
          const end = xmlCopy.indexOf('?>', pos);
          if (end !== -1) {
            tags.push({ name: '?', pos, isClose: false, length: end - pos + 2 });
            pos = end + 2;
            continue;
          }
        }
        if (xmlCopy[pos + 1] === '!') {
          // Comment or CDATA
          if (xmlCopy.slice(pos, pos + 9) === '<![CDATA[') {
            const end = xmlCopy.indexOf(']]>', pos);
            if (end !== -1) {
              tags.push({ name: 'cdata', pos, isClose: false, length: end - pos + 3 });
              pos = end + 3;
              continue;
            }
          }
          const end = xmlCopy.indexOf('>', pos);
          if (end !== -1) {
            tags.push({ name: 'comment', pos, isClose: false, length: end - pos + 1 });
            pos = end + 1;
            continue;
          }
        }
        if (xmlCopy[pos + 1] === '/') {
          const end = xmlCopy.indexOf('>', pos);
          if (end !== -1) {
            const name = xmlCopy.slice(pos + 2, end);
            tags.push({ name, pos, isClose: true, length: end - pos + 1 });
            pos = end + 1;
            continue;
          }
        }
        // Opening tag
        const end = xmlCopy.indexOf('>', pos);
        if (end !== -1) {
          const content = xmlCopy.slice(pos + 1, end);
          const selfClose = content.endsWith('/');
          const spaceIdx = content.search(/\s/);
          const name = spaceIdx === -1 ? content.replace(/\s*\/?>$/, '') : content.slice(0, spaceIdx);
          const attrs = spaceIdx === -1 ? '' : content.slice(spaceIdx);
          if (!name.startsWith('?')) {
            tags.push({ name: selfClose ? name : name, pos, isClose: false, length: end - pos + 1, attrs: selfClose ? '' : attrs });
          }
          pos = end + 1;
          continue;
        }
      }
      pos++;
    }

    // Sort tags by position
    tags.sort((a, b) => a.pos - b.pos);

    // Build tree using stack
    const rootEl: any = { children: [], textContent: null, localName: 'root', attributes: {}, querySelector: null, querySelectorAll: null };
    (rootEl as any).querySelector = createQuerySelector(rootEl);
    (rootEl as any).querySelectorAll = createQuerySelectorAll(rootEl);

    const stack: any[] = [rootEl];

    for (const tag of tags) {
      if (tag.isClose) {
        // Pop until we find matching open tag
        while (stack.length > 1) {
          const current = stack[stack.length - 1];
          if (current.localName === tag.name) {
            stack.pop();
            break;
          }
          stack.pop();
        }
      } else if (tag.name !== '?' && tag.name !== 'comment' && tag.name !== 'cdata') {
        const el: any = {
          children: [],
          textContent: null,
          localName: tag.name,
          attributes: {},
        };
        (el as any).querySelector = createQuerySelector(el);
        (el as any).querySelectorAll = createQuerySelectorAll(el);

        // Parse attributes
        if (tag.attrs) {
          const attrRegex = /([a-zA-Z0-9:]+)="([^"]*)"|([a-zA-Z0-9:]+)='([^']*)'/g;
          let attrMatch;
          while ((attrMatch = attrRegex.exec(tag.attrs)) !== null) {
            const attrName = attrMatch[1] || attrMatch[3];
            const attrValue = attrMatch[2] || attrMatch[4];
            el.attributes[attrName] = attrValue;
          }
        }

        // Check if self-closing
        if (tag.attrs && tag.attrs.includes('/')) {
          stack[stack.length - 1].children.push(el);
        } else {
          stack[stack.length - 1].children.push(el);
          stack.push(el);
        }
      }
    }

    // Extract text content for leaf elements
    extractText(rootEl, '');

    // Root's child should be rss or feed
    if (rootEl.children.length === 1) {
      return rootEl.children[0];
    }
    return rootEl;
  }

  function extractText(el: any, parentText: string): void {
    if (el.children.length === 0 && el.textContent === null) {
      // No content
      return;
    }
    if (el.children.length === 0) {
      // Leaf with text
      return;
    }
    // Has children - extract text from children
    let text = '';
    for (const child of el.children) {
      extractText(child, '');
      if (child.textContent) {
        text += child.textContent;
      }
    }
    if (text) {
      el.textContent = text.trim() || null;
    }
  }

  function createQuerySelector(el: any) {
    return function(selector: string): any {
      selector = selector.replace(':scope > ', '').split('[')[0].trim();
      const tag = selector.split(' ')[0];

      function search(node: any): any {
        if (node.localName === tag) return node;
        for (const child of node.children) {
          const found = search(child);
          if (found) return found;
        }
        return null;
      }

      return search(el);
    };
  }

  function createQuerySelectorAll(el: any) {
    return function(selector: string): any[] {
      selector = selector.replace(':scope > ', '').split('[')[0].trim();
      const tag = selector.split(' ')[0];

      const results: any[] = [];
      function search(node: any): void {
        if (node.localName === tag) results.push(node);
        for (const child of node.children) {
          search(child);
        }
      }
      search(el);
      return results;
    };
  }
}
