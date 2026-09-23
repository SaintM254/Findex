// Optional sandbox runner: Chromium and its shared libraries are distributed through npm.
// Normal developer machines and CI can use `npx playwright install chromium` instead.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { brotliDecompressSync } from 'node:zlib';
import { execFileSync, spawnSync } from 'node:child_process';
import chromium from '@sparticuz/chromium';

const require = createRequire(import.meta.url);
const executablePath = await chromium.executablePath();
const libs = join(tmpdir(), 'findex-chromium-libs');
mkdirSync(libs, { recursive: true });
const packageRoot = dirname(dirname(require.resolve('@sparticuz/chromium')));
const archive = join(packageRoot, 'bin', 'al2023.tar.br');
if (existsSync(archive)) {
  const tar = join(libs, 'al2023.tar');
  writeFileSync(tar, brotliDecompressSync(readFileSync(archive)));
  execFileSync('tar', ['xf', tar, '-C', libs]);
}
const args = chromium.args.filter(arg => !arg.includes('disable-web-security') && !arg.includes('allow-running-insecure-content') && !arg.includes('single-process'));
const result = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, FINDEX_CHROMIUM_PATH: executablePath, FINDEX_CHROMIUM_ARGS: JSON.stringify(args), LD_LIBRARY_PATH: `${join(libs, 'lib')}:${process.env.LD_LIBRARY_PATH || ''}` },
});
process.exit(result.status ?? 1);
