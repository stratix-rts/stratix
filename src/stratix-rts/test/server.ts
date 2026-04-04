import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { createServer } from 'http';
import { resolve, extname, join, relative } from 'path';

const PORT = 5175;
const ROOT = resolve(process.cwd());
const TEST_DIR = join(ROOT, 'src/stratix-rts/test');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.ts': 'application/typescript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.mjs': 'application/javascript',
};

function findFile(name: string, dir: string): string | null {
  try {
    const items = readdirSync(dir);
    for (const item of items) {
      const fullPath = join(dir, item);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        const found = findFile(name, fullPath);
        if (found) return found;
      } else if (item === name || item.startsWith(name.split('.')[0] + '.')) {
        return fullPath;
      }
    }
  } catch { /* ignore */ }
  return null;
}

const server = createServer((req, res) => {
  let urlPath = req.url === '/' ? '/index.html' : req.url!;
  
  if (urlPath.includes('?')) {
    urlPath = urlPath.split('?')[0];
  }

  let filePath: string;
  
  if (urlPath === '/index.html') {
    filePath = join(TEST_DIR, 'index.html');
  } else if (urlPath === '/main.ts') {
    filePath = join(TEST_DIR, 'main.ts');
  } else if (urlPath.startsWith('/node_modules/')) {
    filePath = join(ROOT, urlPath);
  } else if (urlPath.startsWith('/src/')) {
    filePath = join(ROOT, urlPath);
  } else if (urlPath.startsWith('/dist/')) {
    filePath = join(ROOT, urlPath);
  } else {
    filePath = join(ROOT, urlPath);
  }
  
  serveFile(filePath, res);
});

function serveFile(filePath: string, res: any) {
  if (!existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found: ' + filePath);
    return;
  }
  
  const ext = extname(filePath);
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  
  try {
    const content = readFileSync(filePath);
    res.writeHead(200, { 
      'Content-Type': mime,
      'Access-Control-Allow-Origin': '*'
    });
    res.end(content);
  } catch (e: any) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Server Error: ' + e.message);
  }
}

server.listen(PORT, () => {
  console.log(`\n🎮 Stratix RTS Test Server`);
  console.log(`   http://localhost:${PORT}\n`);
});
