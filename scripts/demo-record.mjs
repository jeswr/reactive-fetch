#!/usr/bin/env node
// Records the reactive-fetch demo video by running the dedicated Playwright
// demo spec, then converts the webm output to mp4 + gif for README embedding.
//
// Flow:
//   1. `playwright test --config=playwright.demo.config.ts` — produces a
//      video.webm under e2e/demo-output/<test-name>/
//   2. Copy the webm into docs/demo.webm
//   3. Run ffmpeg to produce docs/demo.mp4 (H.264, faststart)
//   4. Run ffmpeg with palette filter to produce docs/demo.gif (<5MB)
//
// Requirements: ffmpeg on PATH. If missing, the script prints a helpful
// install hint and exits non-zero rather than silently producing partial
// output — a demo commit without the mp4/gif isn't useful.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const e2eDir = resolve(repoRoot, 'e2e');
const docsDir = resolve(repoRoot, 'docs');
const outputDir = resolve(e2eDir, 'demo-output');

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function which(cmd) {
  const result = spawnSync('which', [cmd], { stdio: 'pipe' });
  return result.status === 0;
}

if (!which('ffmpeg')) {
  console.error(
    '[demo-record] ffmpeg not found on PATH.\n' +
      '  Install it first:\n' +
      '    macOS:  brew install ffmpeg\n' +
      '    Ubuntu: sudo apt-get install -y ffmpeg\n',
  );
  process.exit(1);
}

// Clean previous output so we can confidently pick the latest recording.
if (existsSync(outputDir)) {
  rmSync(outputDir, { recursive: true, force: true });
}
mkdirSync(docsDir, { recursive: true });

console.log('[demo-record] running Playwright demo spec…');
run('pnpm', ['exec', 'playwright', 'test', '--config=playwright.demo.config.ts'], {
  cwd: e2eDir,
});

// Find the recorded webm. Playwright saves it as video.webm (or
// <index>.webm) under demo-output/<project-name>/<sanitized-test-name>/.
function findWebm(dir) {
  if (!existsSync(dir)) return undefined;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current)) {
      const path = join(current, entry);
      const st = statSync(path);
      if (st.isDirectory()) {
        stack.push(path);
      } else if (entry.endsWith('.webm')) {
        return path;
      }
    }
  }
  return undefined;
}

const webm = findWebm(outputDir);
if (!webm) {
  console.error('[demo-record] no .webm produced; check Playwright output above.');
  process.exit(1);
}

const docWebm = resolve(docsDir, 'demo.webm');
const docMp4 = resolve(docsDir, 'demo.mp4');
const docGif = resolve(docsDir, 'demo.gif');
const palette = resolve(outputDir, 'palette.png');

console.log(`[demo-record] copying ${webm} → ${docWebm}`);
cpSync(webm, docWebm);

// mp4: widely supported, supports HTML <video>, good for GitHub web UI.
console.log('[demo-record] encoding mp4…');
run('ffmpeg', [
  '-y',
  '-i',
  docWebm,
  '-c:v',
  'libx264',
  '-preset',
  'medium',
  '-crf',
  '23',
  '-movflags',
  '+faststart',
  '-pix_fmt',
  'yuv420p',
  docMp4,
]);

// gif: README-embeddable. Two-pass palette gen for smaller size.
// 12fps + 960px width keeps file comfortably under 5MB for a ~40s clip.
console.log('[demo-record] generating gif palette…');
run('ffmpeg', [
  '-y',
  '-i',
  docWebm,
  '-vf',
  'fps=12,scale=960:-1:flags=lanczos,palettegen=stats_mode=diff',
  palette,
]);

console.log('[demo-record] encoding gif…');
run('ffmpeg', [
  '-y',
  '-i',
  docWebm,
  '-i',
  palette,
  '-filter_complex',
  'fps=12,scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5',
  docGif,
]);

const gifBytes = statSync(docGif).size;
console.log(`[demo-record] docs/demo.gif is ${(gifBytes / (1024 * 1024)).toFixed(2)} MB`);
if (gifBytes > 5 * 1024 * 1024) {
  console.warn(
    '[demo-record] GIF exceeds 5MB target. Consider trimming slowMo, reducing fps, or ' +
      'shortening the highlight() pauses in demo.spec.ts.',
  );
}

console.log('[demo-record] done.');
console.log(`  webm: ${docWebm}`);
console.log(`  mp4:  ${docMp4}`);
console.log(`  gif:  ${docGif}`);
