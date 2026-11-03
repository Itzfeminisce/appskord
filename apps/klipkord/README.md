# Klipkord

Klipkord is a Chrome side-panel extension that records your screen while you talk.
It turns your words into a transcript, a summary, notes and chapters you can jump through.
Think of it as a private, local Loom with Rekord's notes built in.

## What Klipkord does

- Record your screen, with your voice, computer sound and an optional camera bubble.
- Pause, resume and add markers while you record.
- Get a live transcript while you talk and a better one after you stop.
- Get a summary, notes and chapters that fit the kind of recording: how-to guide, bug report, team update or meeting.
- Play the recording back and jump to any moment from the transcript.
- Trim and cut a recording, and add comments.
- Keep recordings in a library, and save them to a folder you choose.
- Export a video file when you want to share it.

## Install

You need Chrome with the side panel.

From a release zip:

1. Download the zip from the GitHub releases page and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and choose the unzipped folder.

From source (needs Node.js and npm):

```bash
npm install
npm run build
```

Then load `.output/chrome-mv3` with **Load unpacked**.

## First run

1. Click the Klipkord icon to open the side panel.
2. Follow the setup. Klipkord checks your computer and picks an AI option for you.
3. Press Record and choose a screen, window or tab to share.
4. Press Record again to stop. The review opens when the notes are ready.

## Keyboard shortcuts

- `Alt+Shift+R`: start or stop recording.
- `Alt+Shift+P`: pause or resume.
- `Alt+Shift+M`: add a marker.

You can change them at `chrome://extensions/shortcuts`.

## AI options

- **On this computer** (default where your hardware allows): Whisper tiny transcribes live, and Whisper base re-transcribes after you stop.
- **Chrome's built-in AI**: writes notes on this computer when the machine supports it.
- **Ollama**: writes notes with a model running on your own computer.
- **Groq**: faster and better, and opt-in. Use "Connect Penv Cloud" to fetch a key, or paste your own key.

## Privacy

Nothing leaves your computer unless you switch it on.
There is no account, no analytics and no telemetry.

| Data | Where it stays | What can leave, and when |
| --- | --- | --- |
| Screen, camera, mic and tab audio tracks | Your computer (browser storage, or the folder you chose) | Nothing, unless you share a cut to Drive. |
| Events (cursor, clicks, shortcuts, scrolls, page changes) | Your computer, inside the recording | Nothing, ever. Recorded only on a tab Klipkord may see, only while recording. No typed characters are stored, only "typing" or a shortcut name such as Ctrl+C. Nothing at all in password fields. |
| Project (edits, layouts, zooms, overlays, captions) | Your computer (IndexedDB) | Nothing. |
| Media you add (videos, images, music) | Copied into the project on your computer | Nothing. |
| Bundled music | Ships inside the extension, CC0 | Nothing. |
| Transcript | Your computer | Audio goes only to the provider picked under Transcripts in Settings (Groq or OpenAI), and only once you pick one. |
| Ask the AI to edit, highlights, suggested edits | Your computer when no cloud AI is set | Transcript text, word or segment ids, chapter titles and your request go to the AI you chose. Never video, audio, images or events. |
| Translate captions | Your computer when no cloud AI is set | Caption text and the target language go to the AI you chose. |
| Camera background blur, noise removal, loudness | Your computer | Nothing. MediaPipe and RNNoise run locally; the models ship with the extension, never from a third-party CDN. |
| Brand kit | Your computer, shared with Motikord in the same Appskord settings store | Nothing. |
| Exported files | Your folder | Nothing, unless you press "Share link" to upload to Google Drive. |
| Keys | `chrome.storage.session`, cleared when Chrome closes | Fetched from Penv Cloud after "Connect Penv Cloud", or pasted. They never leave the browser except to the provider they belong to. Never printed, logged or committed. |

The first time on-device Whisper runs, Chrome downloads its model files from Hugging Face.
The AI only ever receives words, never audio or video, and only the provider you chose. Drive upload happens only when you press "Share link".

Bundled code, models and fonts keep their licences:
Mediabunny (MPL-2.0), MediaPipe (Apache-2.0), web-noise-suppressor (MIT), Geist and the other bundled fonts (OFL), bundled music (CC0).

The full policy is in [docs/privacy.md](docs/privacy.md).

## Development

```bash
npm run dev        # build and reload the extension while you edit
npm run compile    # type-check
npm test           # unit tests (vitest)
npm run build      # build to .output/chrome-mv3
npm run zip        # store-ready zip in .output/
```

- The manifest carries Klipkord's public key, so the extension id is always `iapgbifdchhmidblniddncnagghloepi`. Google Drive uses Klipkord's OAuth client by default; `WXT_GOOGLE_CLIENT_ID` overrides it.
  It fixes the extension ID, and so the Penv Cloud redirect URL. Plain builds work without it.
- The release zip leaves out the developer machine check. See [CHECK.md](CHECK.md).
- `node scripts/make-icons.mjs` rewrites the icons in `public/icon/`.
- Store listing text is in [public/store/STORE.md](public/store/STORE.md).

## Plans and specs

Plans, specs, handoffs and design frames live in the specs repo:
https://github.com/Itzfeminisce/productivity-apps-engineering-specs/tree/main/apps/klipkord

Klipkord is open source.
