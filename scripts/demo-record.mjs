#!/usr/bin/env node
// Records the reactive-fetch demo video by running the dedicated Playwright
// demo spec, then composites the opener + popup recordings side-by-side and
// encodes the README-embeddable variants.
//
// Flow:
//   1. `playwright test --config=playwright.demo.config.ts` — produces one
//      .webm per Page under e2e/demo-output/<test-name>/:
//        - video.webm   (main/opener page — the app UI, ~1280x720)
//        - video-1.webm (login popup — WebID prompt, CSS login, consent)
//      The popup IS the most important part of the flow, so we must show
//      both. Previously we committed only the main track and the popup was
//      invisible to anyone watching the README video.
//   2. Composite both tracks side-by-side with ffmpeg hstack. The popup
//      track is right-padded backwards (tpad start_mode=clone) so its first
//      frame fills the gap before the popup opens; that way both inputs
//      have the same duration and hstack produces a clean recording.
//   3. Re-encode to mp4 (H.264, faststart) and gif (two-pass palette) for
//      the README web-UI embeds.
//
// Requirements: ffmpeg on PATH. If missing, the script prints a clear
// platform-specific install hint and exits non-zero before attempting
// anything downstream.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { platform } from 'node:os';
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

function ffmpegInstallHint() {
  switch (platform()) {
    case 'darwin':
      return '    macOS:  brew install ffmpeg';
    case 'linux':
      return '    Debian/Ubuntu: sudo apt-get install -y ffmpeg\n' +
        '    Fedora/RHEL:   sudo dnf install -y ffmpeg\n' +
        '    Arch:          sudo pacman -S ffmpeg';
    case 'win32':
      return '    Windows: winget install Gyan.FFmpeg   (or: choco install ffmpeg)';
    default:
      return '    Install ffmpeg from https://ffmpeg.org/download.html and ensure it is on PATH';
  }
}

if (!which('ffmpeg')) {
  console.error(
    '[demo-record] ffmpeg not found on PATH.\n' +
      '  Install it first:\n' +
      ffmpegInstallHint() +
      '\n  Then re-run: pnpm demo:record',
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

// Playwright's context-level `video: 'on'` records one .webm per Page.
// For the demo spec that's two files — the main page and the popup —
// named video.webm and video-1.webm. We want ALL of them so we can
// composite them; the previous implementation returned just one and
// threw away the popup.
function findAllWebms(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current)) {
      const path = join(current, entry);
      const st = statSync(path);
      if (st.isDirectory()) {
        stack.push(path);
      } else if (/^video(?:-\d+)?\.webm$/.test(entry)) {
        out.push(path);
      }
    }
  }
  // Stable order: video.webm first, then video-1.webm, video-2.webm, …
  out.sort((a, b) => {
    const rank = (p) => {
      const m = /video(?:-(\d+))?\.webm$/.exec(p);
      return m && m[1] ? Number(m[1]) : 0;
    };
    return rank(a) - rank(b);
  });
  return out;
}

const webms = findAllWebms(outputDir);
if (webms.length === 0) {
  console.error('[demo-record] no .webm produced; check Playwright output above.');
  process.exit(1);
}
console.log(`[demo-record] found ${webms.length} recording(s):`);
for (const w of webms) console.log(`  - ${w}`);

// Probe a webm's duration in seconds (float).
function probeDuration(path) {
  const result = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
    { stdio: 'pipe', encoding: 'utf8' },
  );
  if (result.status !== 0) {
    console.error(`[demo-record] ffprobe failed for ${path}:\n${result.stderr}`);
    process.exit(1);
  }
  const n = parseFloat(String(result.stdout).trim());
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`[demo-record] unexpected duration for ${path}: ${result.stdout}`);
    process.exit(1);
  }
  return n;
}

const docWebm = resolve(docsDir, 'demo.webm');
const docMp4 = resolve(docsDir, 'demo.mp4');
const docGif = resolve(docsDir, 'demo.gif');
const palette = resolve(outputDir, 'palette.png');

if (webms.length === 1) {
  // Single-page recording: just copy. No compositing required.
  console.log(`[demo-record] copying ${webms[0]} → ${docWebm}`);
  run('cp', [webms[0], docWebm]);
} else {
  // Multi-page recording: hstack main + popup side-by-side.
  //
  // Alignment: the popup track starts partway through the main track (the
  // user has to click "Show WebID" first). Playwright writes both files
  // at test teardown, so filesystem birth/mtime times don't give a clean
  // "popup created X seconds after main" offset. Instead, assume both
  // recordings END at approximately the same wallclock moment (true when
  // the test waits for popup close and then one more assertion) and
  // derive the offset from their durations: offset = main.duration -
  // popup.duration. Rough but visually close — the popup appears on the
  // right side right around the moment the user clicks the button.
  const main = webms[0];
  const popup = webms[1]; // First non-main recording; extra pages (rare) are dropped.
  if (webms.length > 2) {
    console.warn(
      `[demo-record] more than 2 recordings found; compositing only the first two (${main}, ${popup}). ` +
        'Extra tracks: ' + webms.slice(2).join(', '),
    );
  }
  const mainDuration = probeDuration(main);
  const popupDuration = probeDuration(popup);
  // Prefer the spec-emitted timings (exact) over the end-aligned heuristic
  // (approximate). The spec writes popupOpenedAt as seconds-since-page.goto.
  let delta;
  const timingsPath = resolve(outputDir, 'timings.json');
  if (existsSync(timingsPath)) {
    try {
      const timings = JSON.parse(readFileSync(timingsPath, 'utf8'));
      const popupOpenedAt = Number(timings.popupOpenedAt);
      if (Number.isFinite(popupOpenedAt) && popupOpenedAt >= 0) {
        delta = popupOpenedAt;
      }
    } catch (err) {
      console.warn(`[demo-record] could not read timings.json: ${err.message}`);
    }
  }
  if (delta === undefined) {
    // Fallback: assume both recordings end at the same wallclock moment and
    // the popup existed for its full duration. Not as accurate as the
    // spec-emitted timings but keeps the popup visible.
    delta = Math.max(0, mainDuration - popupDuration);
  }
  console.log(
    `[demo-record] compositing main (${mainDuration.toFixed(2)}s) + popup (${popupDuration.toFixed(2)}s); ` +
      `popup offset ≈ ${delta.toFixed(2)}s`,
  );

  // Left pane: opener at its native 1280x720.
  // Right pane: popup track.
  //   - Playwright records each Page at the context viewport (1280x720)
  //     rather than at the window size, so the popup dialog — a modal
  //     roughly 520x640 in the top-left — leaves a huge empty margin on
  //     the right and bottom of the recording. Without a crop, the popup
  //     UI ends up tiny inside the right pane surrounded by whitespace,
  //     which is what prompted the "popup never appears" feedback.
  //     Cropping the popup source to POPUP_CROP_W x POPUP_CROP_H before
  //     scaling gives the popup UI most of the pane. The values are
  //     tuned for the three screens that show up in this popup (the
  //     reactive-fetch callback WebID prompt, the CSS login page, and
  //     the CSS consent page); if a future screen uses more horizontal
  //     real estate it may get clipped — widen the crop in that case.
  //   - Together: opener 1280 + popup 800 = 2080x720 composite.
  //   - tpad start_mode=clone freezes the popup's first frame for `delta`
  //     seconds so both inputs have the same duration before hstack.
  const POPUP_CROP_W = 760;
  const POPUP_CROP_H = 720;
  const filter = [
    '[0:v]scale=1280:720,setsar=1[main]',
    `[1:v]crop=${POPUP_CROP_W}:${POPUP_CROP_H}:0:0,scale=800:720,setsar=1,tpad=start_mode=clone:start_duration=${delta.toFixed(3)}[pop]`,
    '[main][pop]hstack=inputs=2',
  ].join(';');

  console.log('[demo-record] encoding composite webm…');
  run('ffmpeg', [
    '-y',
    '-i', main,
    '-i', popup,
    '-filter_complex', filter,
    '-c:v', 'libvpx-vp9',
    '-crf', '32',
    '-b:v', '0',
    docWebm,
  ]);
}

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
// 12fps + 1280px width keeps things legible on the 2080px-wide composite
// while staying under the 5MB target for a ~15s clip.
console.log('[demo-record] generating gif palette…');
run('ffmpeg', [
  '-y',
  '-i',
  docWebm,
  '-vf',
  'fps=12,scale=1280:-1:flags=lanczos,palettegen=stats_mode=diff',
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
  'fps=12,scale=1280:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5',
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
