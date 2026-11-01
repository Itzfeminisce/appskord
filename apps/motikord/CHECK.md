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
