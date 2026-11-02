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

## Privacy tab
Copy each answer into the field of the same name. Each is under 1,000 characters.

### Single purpose description
Klipkord records the user's screen and voice and turns the recording into a transcript, summary, notes and chapters, with a simple editor to trim and polish the video. Everything it does serves that one job: recording the screen and writing it up.

### Permission justifications
- **sidePanel justification:** Klipkord's controls live in Chrome's side panel beside the page being recorded.
- **desktopCapture justification:** Opens Chrome's own picker so the user chooses the screen, window or tab to record. Nothing is captured until the user picks one.
- **storage justification:** Keeps settings and the library of recordings on the user's computer. Klipkord has no server of its own.
- **unlimitedStorage justification:** Screen recordings are large videos, kept on the user's computer, and would not fit in the default storage quota.
- **identity justification:** Signs the user in to Penv Cloud to fetch their own AI keys, and to their Google account when they choose to save a video to Google Drive. Only when the user presses Connect.
- **activeTab justification:** When the user presses a Klipkord keyboard shortcut (for example Alt+Shift+M to add a marker or Alt+Shift+D to draw), Klipkord acts on the tab they are on and nowhere else.
- **scripting justification:** Shows a small marker toast and the drawing layer in that tab, and while recording a tab, notes clicks so the editor can zoom to them. Password fields are skipped.
- **Host permission justification:** huggingface.co and *.hf.co are needed to download the Whisper speech model files once, so transcription can run on the user's computer. These are data files, not code, and nothing is sent to Hugging Face. Every other host is optional and asked for only when the user turns that feature on: penv.cloud for their keys; Groq, OpenAI, OpenRouter or Anthropic for the AI the user picked; Google APIs to save to Drive; localhost:11434 for the user's own Ollama; and the page being recorded, for markers and drawing.

### Are you using remote code?
No, I am not using remote code. All JavaScript and Wasm, including the speech engine, ship inside the package. The Whisper models downloaded from Hugging Face are data, not code.

### Data usage
Tick these (all handled only to do the single purpose, at the user's request):
- **Authentication information:** tick. The user's own AI keys, kept on their computer and sent only to the service each key belongs to.
- **User activity:** tick. Clicks inside the tab being recorded, kept on the user's computer to place zooms. Password fields are skipped.
- **Website content:** tick. The recorded screen and sound. The video stays on the user's computer unless they save it to Google Drive. Audio and transcript text go to the AI service the user turns on.

Leave unticked: personally identifiable information, health information, financial and payment information, personal communications, location, web history.

### Certifications (tick all three)
- I do not sell or transfer user data to third parties, apart from the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

### Privacy policy URL
https://github.com/Itzfeminisce/appskord/blob/main/apps/klipkord/docs/privacy.md

## Store assets
All in this folder, `public/store/`. The build leaves this folder out of the extension. 24-bit PNG, no alpha.
- **Icon:** `public/icon/128.png`.
- **Global promo video:** leave blank.
- **Screenshots (1280x800), upload in this order:**
  1. `public/store/screenshot-1.png`: Record your screen, keep it on your computer.
  2. `public/store/screenshot-2.png`: A tab, a window or the whole screen.
  3. `public/store/screenshot-3.png`: Notes shaped to what you recorded.
  4. `public/store/screenshot-4.png`: You choose where the AI runs.
- **Small promo tile (440x280):** `public/store/small-promo-tile.png`.
- **Marquee promo tile (1400x560):** `public/store/marquee-promo-tile.png`.

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
