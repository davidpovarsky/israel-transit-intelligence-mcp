import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test('package is portable and exposes a fixed bin entry', async () => {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'israel-transit-intelligence-mcp');
  assert.equal(pkg.version, '1.2.0');
  assert.equal(pkg.bin['israel-transit-mcp'], 'bin/israel-transit-mcp.mjs');
  assert.equal(pkg.engines.node, '>=18.17');
  const readme = await readFile(join(root, 'README.md'), 'utf8');
  assert.match(readme, /npx --yes israel-transit-intelligence-mcp@1\.2\.0/);
  assert.doesNotMatch(readme, /\/home\/ubuntu|PLUGIN_ROOT/);
});
