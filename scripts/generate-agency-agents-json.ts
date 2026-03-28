#!/usr/bin/env npx ts-node
/**
 * generate-agency-agents-json.ts
 *
 * Parses vendor/agency-agents/*.md files and generates JSON index
 * for frontend consumption via backend API.
 *
 * Usage:
 *   npx ts-node scripts/generate-agency-agents-json.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const VENDOR_DIR = path.resolve(__dirname, '../vendor/agency-agents');
const OUTPUT_DIR = path.resolve(__dirname, '../src/stratix-data');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'agency-agents.json');

interface AgencyAgent {
  id: string;
  name: string;
  description: string;
  domain: string;
  color: string;
  emoji: string;
  vibe: string;
  slug: string;
  sections: {
    soul: string[];
    agents: string[];
  };
  filePath: string;
}

interface Frontmatter {
  name?: string;
  description?: string;
  color?: string;
  emoji?: string;
  vibe?: string;
}

const DOMAINS = [
  'academic',
  'design',
  'engineering',
  'game-development',
  'marketing',
  'paid-media',
  'product',
  'project-management',
  'sales',
  'specialized',
  'spatial-computing',
  'support',
  'testing',
];

/**
 * Slugify a string: "Frontend Developer" → "frontend-developer"
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Extract frontmatter from markdown content
 */
function parseFrontmatter(content: string): { frontmatter: Frontmatter; body: string } {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!fmMatch) {
    return { frontmatter: {}, body: content };
  }

  const fmContent = fmMatch[1];
  const body = fmMatch[2];

  try {
    const frontmatter = yaml.load(fmContent) as Frontmatter;
    return { frontmatter: frontmatter || {}, body };
  } catch {
    return { frontmatter: {}, body };
  }
}

/**
 * Classify a section header into soul or agents category
 */
function classifySection(headerLower: string): 'soul' | 'agents' {
  const soulKeywords = [
    'identity',
    'memory',
    'communication',
    'style',
    'critical rule',
    'rules you must follow',
    'personality',
  ];

  return soulKeywords.some((kw) => headerLower.includes(kw)) ? 'soul' : 'agents';
}

/**
 * Parse body content into sections
 * Captures content before the first ## header as a preamble section (classified as soul)
 */
function parseBody(body: string): { soul: string[]; agents: string[] } {
  const lines = body.split('\n');
  const sections = { soul: [] as string[], agents: [] as string[] };

  let currentSection = '';
  let currentCategory: 'soul' | 'agents' | null = null;

  for (const line of lines) {
    // Detect ## headers (with or without emoji prefixes)
    const headerMatch = line.match(/^##\s+(.+)/);

    if (headerMatch) {
      // Flush previous section (preamble or previous section)
      if (currentSection.trim()) {
        if (currentCategory) {
          sections[currentCategory].push(currentSection.trim());
        } else {
          // Preamble before first ## header - classify as soul
          sections.soul.push(currentSection.trim());
        }
      }

      const headerLower = headerMatch[1].toLowerCase();
      currentCategory = classifySection(headerLower);
      currentSection = line + '\n';
    } else {
      currentSection += line + '\n';
    }
  }

  // Flush final section
  if (currentSection.trim() && currentCategory) {
    sections[currentCategory].push(currentSection.trim());
  }

  return sections;
}

/**
 * Process a single agent file
 */
function processAgentFile(filePath: string, domain: string): AgencyAgent | null {
  const content = fs.readFileSync(filePath, 'utf-8');
  const { frontmatter, body } = parseFrontmatter(content);

  if (!frontmatter.name) {
    console.warn(`  Skipping ${filePath} - no name in frontmatter`);
    return null;
  }

  const slug = slugify(frontmatter.name);
  const sections = parseBody(body);

  return {
    id: `${domain}-${slug}`,
    name: frontmatter.name,
    description: frontmatter.description || '',
    domain,
    color: frontmatter.color || 'gray',
    emoji: frontmatter.emoji || '🤖',
    vibe: frontmatter.vibe || '',
    slug,
    sections,
    filePath: path.relative(VENDOR_DIR, filePath),
  };
}

/**
 * Main generator function
 */
function main(): void {
  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    console.log('📁 Created directory:', OUTPUT_DIR);
  }

  console.log('🔍 Scanning vendor/agency-agents directory...\n');

  const agents: AgencyAgent[] = [];

  for (const domain of DOMAINS) {
    const domainDir = path.join(VENDOR_DIR, domain);

    if (!fs.existsSync(domainDir)) {
      console.log(`  Skipping ${domain} - directory not found`);
      continue;
    }

    console.log(`📂 Processing ${domain}/`);

    // Find all .md files (but not in subdirectories like game-development/unity/)
    const files = fs.readdirSync(domainDir);

    for (const file of files) {
      if (!file.endsWith('.md')) continue;

      const filePath = path.join(domainDir, file);
      const agent = processAgentFile(filePath, domain);

      if (agent) {
        agents.push(agent);
        console.log(`  ✓ ${agent.name} (${agent.id})`);
      }
    }
  }

  // Build output
  const output = {
    generatedAt: new Date().toISOString(),
    version: '1.0',
    domains: DOMAINS,
    totalAgents: agents.length,
    agents,
  };

  // Write JSON
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  console.log(`\n✅ Generated ${agents.length} agents → ${OUTPUT_FILE}`);
}

main();
