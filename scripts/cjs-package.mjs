// Marks dist/cjs as CommonJS so require() resolves it even though the package root is "type": "module".
import { writeFileSync } from 'node:fs';
writeFileSync(new URL('../dist/cjs/package.json', import.meta.url), JSON.stringify({ type: 'commonjs' }) + '\n');
