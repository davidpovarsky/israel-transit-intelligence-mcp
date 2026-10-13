#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const mode = process.argv.find(arg => arg.startsWith('--server='))?.split('=')[1] ?? process.argv[2] ?? 'help';
const filename = {
  curlbus:'live-server.mjs', fallback:'live-server.mjs', live:'live-server.mjs',
  busnearby:'busnearby-server.mjs', directions:'busnearby-server.mjs',
  openbus:'openbus-server.mjs'
}[mode];
if (!filename) {
  console.error('Usage: israel-transit-mcp --server=curlbus|busnearby|openbus');
  process.exitCode = 2;
} else {
  const child = spawn(process.execPath,[join(root,'server',filename)],{stdio:'inherit'});
  child.on('error',err=>{console.error('[transit] spawn failed:',err.message);process.exitCode=1;});
  child.on('exit',(code,signal)=>{process.exitCode=signal?1:(code??1);});
}