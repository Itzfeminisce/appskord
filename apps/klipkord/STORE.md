# Chrome Web Store listing

Build the store zip with `pnpm zip:store`; it leaves `key` out of the manifest, which the store rejects. Test zips (`pnpm zip`) keep it so unpacked ids stay fixed. For the first upload only, add the private key as `key.pem` at the zip root so the store keeps the id `iapgbifdchhmidblniddncnagghloepi`; never commit it. The file is `.output/klipkord-<version>-chrome.zip`. Raise `version` in `package.json` for every upload.

## Listing text
- **Name:** Klipkord
- **Short description (132 characters max):** Record your screen while you talk. Get a transcript, summary, notes and chapters, all on your computer.
- **Long description:**
  Klipkord records your screen and your voice, then writes it up for you.

  - Record a screen, window or tab, with computer sound and an optional camera bubble.
  - Add markers while you record, and pause when you need to.
  - A live transcript shows while you talk, and a better one replaces it after you stop.
  - Get a summary, notes and chapters shaped to the recording: how-to guide, bug report, team update or meeting.
  - Jump to any moment from the transcript, trim the video and add comments.
  - Recording, the video, the library, playback and trimming stay on your computer. No account, no server, no upload.
  - Transcription and notes run on your computer where it allows (on-device Whisper, Chrome's built-in AI, Ollama).
  - Optional: use Groq for speed and quality, with a key from Penv Cloud (https://penv.cloud) or your own.
  - Open source.
- **Category:** Productivity. **Language:** English.
- **Privacy policy URL:** https://github.com/Itzfeminisce/appskord/blob/main/apps/klipkord/docs/privacy.md

## Single purpose
Record the screen and turn the spoken words into a transcript, summary and notes.

## Permission justifications
- `sidePanel`: shows Klipkord beside the page.
- `offscreen`: keeps recording and transcribing while the panel is closed.
- `desktopCapture`: lets the user choose the screen, window or tab to record.
- `storage`: keeps settings and recordings on the user's computer.
- `unlimitedStorage`: screen videos are large.
- `identity`: signs in to Penv Cloud to fetch the user's keys.
- `activeTab`: after a keyboard shortcut, acts on the tab the user is on.
- `scripting`: draws a small marker toast in that tab.
- Host access (`huggingface.co`, `*.hf.co`): downloads the Whisper models.
- Optional host access (`penv.cloud`, Groq, OpenRouter, OpenAI, Anthropic, `localhost:11434`): asked only when the user turns that feature on; sends text or audio only to the service the user picked.
- Remote code: none is loaded. Models are data files.
- Data use: disclose audio and transcript text, sent only to the cloud AI the user turns on; none sold; none used for unrelated purposes.

## Store assets
All in `store/` (not `public/`, which would ship inside the extension). 24-bit PNG, no alpha.
- **Icon:** `public/icon/128.png`.
- **Global promo video:** leave blank.
- **Screenshots (1280x800), upload in this order:**
  1. `store/screenshot-1.png`: Record your screen, keep it on your computer.
  2. `store/screenshot-2.png`: A tab, a window or the whole screen.
  3. `store/screenshot-3.png`: Notes shaped to what you recorded.
  4. `store/screenshot-4.png`: You choose where the AI runs.
- **Small promo tile (440x280):** `store/small-promo-tile.png`.
- **Marquee promo tile (1400x560):** `store/marquee-promo-tile.png`.

## Additional fields
- **Official URL:** None (no site of ours is verified in Search Console).
- **Homepage URL:** https://github.com/Itzfeminisce/appskord/tree/main/apps/klipkord
- **Support URL:** https://github.com/Itzfeminisce/appskord/issues
- **Mature content:** No.
- **Item support:** On.

## Release steps
- Bump `version` in `apps/klipkord/package.json`, merge to `main`, then tag from `main`: `git tag klipkord@x.y.z && git push origin klipkord@x.y.z`.
- CI runs the tests, builds, checks the tag matches the manifest version, and makes a GitHub release with the zip.
- Store upload is automatic once the Chrome Web Store secrets exist (`CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`, `CWS_EXTENSION_ID_KLIPKORD`). Until then, download the zip from the release and upload it by hand.
- Dry run: tag `klipkord@x.y.z-test` makes a prerelease and never uploads.
