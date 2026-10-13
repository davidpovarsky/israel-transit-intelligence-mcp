#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const mode = process.argv.find(arg => arg.startsWith('--server='))?.split('=')[1] ?? process.argv[2] ?? 'help';
const server = mode === 'curlbus' || mode === 'fallback' || mode === 'live'
  ? join(root, 'server', 'live-server.mjs')
  : mode === 'busnearby' || mode === 'directions'
    ? join(root, 'server', 'busnearby-server.mjs')
    : null;

if (!server) {
  console.error('Usage: israel-transit-mcp --server=curlbus|busnearby');
  process.exitCode = 2;
} else {
  const child = spawn(process.execPath, [server], { stdio: 'inherit' });
  child.on('error', error => {
    console.error(`[israel-transit-mcp] failed to start server: ${error.message}`);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    if (signal) process.exitCode = 1;
    else if (code !== null) process.exitCode = code;
  });
}
