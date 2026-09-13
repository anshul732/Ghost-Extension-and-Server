import { mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
await mkdir('dist', { recursive: true });
await rm('dist/opportunities-extension.zip', { force: true });
const result = spawnSync('zip', ['-qr', '../dist/opportunities-extension.zip', '.', '-x', '*.DS_Store'], { cwd: 'extension', stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status) process.exit(result.status);
console.log('Created dist/opportunities-extension.zip. Unzip and load the folder in Chrome.');
