# Machine check

First time:

1. Unzip `motikord-machine-check.zip` to a folder named `Motikord`.
2. Open `chrome://extensions`.
3. Turn on Developer mode.
4. Press Load unpacked.
5. Pick the `Motikord` folder.
6. Open the check page: the address shown on `chrome://extensions` for Motikord, ending in `/check.html`.
7. Press Run all.
8. Wait until every test shows Pass, Slow or Fail.
9. Press Copy results.
10. Paste the results in the thread.

Later builds:

1. Unzip the new zip over the same `Motikord` folder.
2. On `chrome://extensions`, press Reload on Motikord.

## v2 (sandbox)

Headless Chromium 153 in the build sandbox, 4 cores (Xeon 2.1 GHz), no GPU like the laptop but a different CPU.
Run with `pnpm build`, then `node scripts/measure-v2.mjs 10` (10 s per preview test; the page's Run v2 button runs the same rows).
Preview: the 16:9 recorded prompt with the most scenes, made by the real pipeline, drawn on a 1920x1080 canvas.
"Flushed" draw forces the raster with a 1 px read every 10th frame; the 33 ms frame budget is what it must stay under.

| Test | Budget | Result | Numbers |
| --- | --- | --- | --- |
| Background solid | 30 fps | Pass | 60 fps, flushed draw 1.4 ms |
| Background gradient | 30 fps | Pass | 60 fps, flushed draw 3.7 ms |
| Background blobs (drift) | 30 fps | Pass | 60 fps, flushed draw 7.5 ms |
| Background blocks | 30 fps | Pass | 60 fps, flushed draw 1.5 ms |
| Background grain | 30 fps | Pass | 59.5 fps, flushed draw 11.9 ms |
| Transition crossfade | 30 fps | Pass | 58.2 fps, flushed draw 14.4 ms |
| Transition slide | 30 fps | Pass | 59.1 fps, flushed draw 13.8 ms |
| Transition push | 30 fps | Pass | 60 fps, flushed draw 7.7 ms |
| Transition wipe | 30 fps | Pass | 59.3 fps, flushed draw 13.8 ms |
| Transition zoom | 30 fps | Pass | 57.3 fps, flushed draw 14.6 ms |
| Transition match | 30 fps | Pass | 60 fps, flushed draw 7.5 ms |
| One 512 px JPEG frame, offscreen | < 300 ms | Pass | median 3.6 ms, max 12.1 ms (20 runs) |
| Storyboard + scenes + checker, 20 recorded prompts | < 15 s | Pass | median 0.003 s, slowest 0.03 s; Groq network time not included |

Owner: confirm on the laptop with the machine check page in the test build.

## v3 (sandbox)

Sandbox numbers, not the laptop: headless Chromium 153, 4 cores (Xeon 2.1 GHz), no GPU, so WebGL2 runs on SwiftShader (software)
and every GPU-bound number here is a floor. Run with `pnpm build`, then `node scripts/measure-v3.mjs 10`; it serves the build
with the extension's CSP (`script-src 'self' 'wasm-unsafe-eval'`). The page's Run v3 button runs the same rows.
Scene: `@appskord/motion` test scene, 15 s, 1080x1920, seed 7: troika 3D text, three.quarks particles, depth of field and bloom
(postprocessing), our velocity motion blur (depth reprojection), grade, vignette and grain. Export: full quality, WebCodecs
H.264 via mediabunny `CanvasSource`, MP4 (VP9/WebM when H.264 cannot encode). Preview: reduced quality, 540x960, 5 blur samples.

| Test | Budget | Result | Numbers |
| --- | --- | --- | --- |
| Building blocks load | All load, no eval, no remote code | Pass | 10 of 10; 0 CSP violations, 0 remote requests; rapier and dotLottie wasm bundled |
| Preview speed | ≥ 30 fps at reduced quality | Pass | 38.1 fps, p95 frame 16.7 ms (10 s) |
| Export 30 fps | ≤ 4x clip length (60 s) | Slow | 703 s (46.9x); 1.56 s per frame waiting on software GPU and encode, 5 ms to submit |
| Export 60 fps | ≤ 8x clip length (120 s) | Slow | 1360 s (90.7x); fallback 30 fps default |
| Memory | < 1.5 GB during export | Pass | 45 MB peak JS heap (`performance.memory`; GPU memory is not visible to pages) |

The export rows are Slow only because the sandbox has no GPU; the laptop decides them.
## v3 (owner's laptop, 2026-11-09)

Windows, 4 cores, 8 GB, no WebGPU, Chrome 156. All rows Pass; no fallback needed.

| Test | Budget | Result | Numbers |
| --- | --- | --- | --- |
| Building blocks load | all load, no eval, no remote code | Pass | 10 of 10, 0 CSP violations, 0 remote requests |
| Preview speed | 30 fps | Pass | 54.5 fps at 540x960, p95 frame 16.9 ms |
| Export 30 fps | 60 s (4x) | Pass | 34.9 s (2.33x), render 14.4 ms + encode 63.2 ms per frame, 310 MB |
| Export 60 fps | 120 s (8x) | Pass | 78.1 s (5.21x), render 23.4 ms + encode 63.3 ms per frame, 519 MB |
| Memory | 1.5 GB | Pass | 1044 MB peak JS heap (60 fps); 600 MB at 30 fps |

Encode, not render, is the cost per frame. The 60 fps peak holds the whole file in memory: T5 streams export output instead.

Bundle: side panel 1,091,844 bytes before and after (same chunk files, byte for byte). Check page 165,999 bytes before,
5,051,956 after (the v3 stack, one 4.9 MB chunk), plus `dotlottie-player.wasm` 1.23 MB and the Archivo Black
woff 13 KB as assets. The v3 stack is imported only by the check page.
