import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const cssPath = path.join(root, 'dist', 'app.css');
const workerPath = path.join(root, 'worker.js');

if (!fs.existsSync(cssPath)) {
  console.error('Missing dist/app.css — run: npm run build:css');
  process.exit(1);
}

const css = fs.readFileSync(cssPath, 'utf8');
const escaped = css.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

let workerSrc = fs.readFileSync(workerPath, 'utf8');
const marker = /const EMBEDDED_TAILWIND_CSS = `[\s\S]*?`;/;
if (!marker.test(workerSrc)) {
  console.error('worker.js: const EMBEDDED_TAILWIND_CSS = `...`; not found');
  process.exit(1);
}

workerSrc = workerSrc.replace(marker, `const EMBEDDED_TAILWIND_CSS = \`${escaped}\`;`);
fs.writeFileSync(workerPath, workerSrc);
console.log('Embedded Tailwind CSS:', css.length, 'bytes minified → worker.js');
