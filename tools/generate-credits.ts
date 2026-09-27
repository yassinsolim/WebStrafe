import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderCreditsMarkdown } from '../src/credits';

// writes CREDITS.md from the registry in src/credits.ts
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(rootDir, 'CREDITS.md');
await fs.writeFile(target, renderCreditsMarkdown(), 'utf8');
console.log(`[credits] wrote ${path.relative(rootDir, target)}`);
