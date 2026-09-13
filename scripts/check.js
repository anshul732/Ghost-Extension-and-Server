import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
for (const dir of ['server', 'extension', 'demo', 'scripts', 'tests']) {
  for (const file of await readdir(dir)) if (file.endsWith('.js')) {
    const result = spawnSync(process.execPath, ['--check', join(dir, file)], { stdio: 'inherit' });
    if (result.status) process.exit(result.status);
  }
}
const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
if (manifest.manifest_version !== 3) throw new Error('Manifest V3 required.');
for (const path of [manifest.background.service_worker, manifest.options_page, ...Object.values(manifest.icons), ...manifest.web_accessible_resources.flatMap(r => r.resources)]) await readFile(join('extension', path));
console.log('JavaScript syntax and extension assets verified.');
