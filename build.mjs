import * as esbuild from 'esbuild';
import { mkdirSync, copyFileSync, existsSync, rmSync } from 'fs';

const watch = process.argv.includes('--watch');

if (existsSync('dist')) rmSync('dist', { recursive: true });
for (const dir of ['dist', 'dist/popup', 'dist/dashboard', 'dist/background', 'dist/content', 'dist/inject']) {
  mkdirSync(dir, { recursive: true });
}

copyFileSync('manifest.json', 'dist/manifest.json');
copyFileSync('src/popup/popup.html', 'dist/popup/popup.html');
copyFileSync('src/dashboard/dashboard.html', 'dist/dashboard/dashboard.html');

const swConfig = {
  entryPoints: [{ in: 'src/background/service-worker.ts', out: 'background/service-worker' }],
  bundle: true,
  outdir: 'dist',
  target: ['chrome120'],
  format: 'esm',
  sourcemap: watch,
  logLevel: 'info',
};

const pagesConfig = {
  entryPoints: [
    { in: 'src/inject/network-interceptor.ts', out: 'inject/network-interceptor' },
    { in: 'src/content/index.ts', out: 'content/index' },
    { in: 'src/popup/popup.ts', out: 'popup/popup' },
    { in: 'src/dashboard/dashboard.ts', out: 'dashboard/dashboard' },
  ],
  bundle: true,
  outdir: 'dist',
  target: ['chrome120'],
  format: 'iife',
  sourcemap: watch,
  logLevel: 'info',
};

if (watch) {
  const [swCtx, pagesCtx] = await Promise.all([
    esbuild.context(swConfig),
    esbuild.context(pagesConfig),
  ]);
  await Promise.all([swCtx.watch(), pagesCtx.watch()]);
  console.log('Watching for changes...');
} else {
  await Promise.all([esbuild.build(swConfig), esbuild.build(pagesConfig)]);
  console.log('Build complete → dist/');
}
