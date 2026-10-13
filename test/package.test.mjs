import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
test('Portable package has updated version, new openbus mode and correct GitHub-only deployment docs',async()=>{
 const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
 assert.equal(pkg.version,'1.3.0');assert.equal(pkg.bin['israel-transit-mcp'],'bin/israel-transit-mcp.mjs');
 const cli=await readFile(join(root,'bin/israel-transit-mcp.mjs'),'utf8');assert.match(cli,/openbus-server\.mjs/);
 const docs=await readFile(join(root,'README.md'),'utf8');
 assert.match(docs,/github:davidpovarsky\/israel-transit-intelligence-mcp#v1\.3\.0/);
 assert.doesNotMatch(docs,/npx --yes israel-transit-intelligence-mcp@1\.3\.0/);
 assert.doesNotMatch(docs,/\/home\/ubuntu|PLUGIN_ROOT/);
});