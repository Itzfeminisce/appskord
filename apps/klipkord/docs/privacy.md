# Klipkord privacy policy

Klipkord is a Chrome extension that records your screen and turns your words into notes. This page says what stays on your computer, what leaves it, and when.

Nothing leaves your computer unless you switch it on. There is no account, no analytics and no telemetry.

| Data | Where it stays | What can leave, and when |
| --- | --- | --- |
| Screen, camera, mic and tab audio tracks | Your computer (browser storage, or the folder you chose) | Nothing, unless you share a cut to Drive. |
| Events (cursor, clicks, shortcuts, scrolls, page changes) | Your computer, inside the recording | Nothing, ever. Recorded only on a tab Klipkord may see, only while recording. No typed characters are stored, only "typing" or a shortcut name such as Ctrl+C. Nothing at all in password fields. |
| Project (edits, layouts, zooms, overlays, captions) | Your computer (IndexedDB) | Nothing. |
| Media you add (videos, images, music) | Copied into the project on your computer | Nothing. |
| Bundled music | Ships inside the extension, CC0 | Nothing. |
| Transcript | Your computer | Audio goes to Groq only if you turned on cloud transcript. |
| Ask the AI to edit, highlights, suggested edits | Your computer when no cloud AI is set | Transcript text, word or segment ids, chapter titles and your request go to the AI you chose. Never video, audio, images or events. |
| Translate captions | Your computer when no cloud AI is set | Caption text and the target language go to the AI you chose. |
| Camera background blur, noise removal, loudness | Your computer | Nothing. MediaPipe and RNNoise run locally; the models ship with the extension, never from a third-party CDN. |
| Brand kit | Your computer, shared with Motikord in the same Appskord settings store | Nothing. |
| Exported files | Your folder | Nothing, unless you press "Share link" to upload to Google Drive. |
| Keys | `chrome.storage.session`, cleared when Chrome closes | Fetched from Penv Cloud after "Connect Penv Cloud", or pasted. They never leave the browser except to the provider they belong to. Never printed, logged or committed. |

Each service you turn on handles what it receives under its own privacy policy. Klipkord does not sell or share your data with anyone else.

## What the AI receives
Only words: transcript text, word or segment ids, chapter titles, caption text, the target language and your request. Never audio, video, images or events. They go only to the provider you chose, and only when you use an AI feature. Keys never leave the browser except to that provider.

## Licences
Bundled code, models and fonts keep their licences:
Mediabunny (MPL-2.0), MediaPipe (Apache-2.0), web-noise-suppressor (MIT), Geist and the other bundled fonts (OFL), bundled music (CC0).

## Model downloads
The first time on-device Whisper runs, Chrome downloads its model files from Hugging Face (`huggingface.co` and its CDN `hf.co`). No recording data is sent in that request.

## Permissions and why
- `sidePanel`: shows Klipkord beside the page.
- `offscreen`: keeps recording and transcribing while the panel is closed.
- `desktopCapture`: lets you choose the screen, window or tab to record.
- `storage` and `unlimitedStorage`: keep your settings and recordings on your computer. Videos are large.
- `identity`: signs you in to Penv Cloud so your keys can be fetched.
- `activeTab` and `scripting`: after you press a shortcut, show a small marker toast in the tab you are on. Nothing else is read from the page.
- Host access to `huggingface.co` and `*.hf.co`: downloads the Whisper models.
- Optional host access, asked only when you turn the feature on:
  - `penv.cloud`: fetches your keys after "Connect Penv Cloud".
  - `api.groq.com`, `openrouter.ai`, `api.openai.com`, `api.anthropic.com`: the cloud AI you choose.
  - `localhost:11434`: your own Ollama.

## What Klipkord does not do
- No tracking, analytics, advertising or crash reporting.
- No reading of the pages you visit.
- No recording unless you start it.

## Your control
Delete a recording in Klipkord and it is gone from your computer. Turn off cloud AI or disconnect Penv Cloud at any time in Settings. Removing the extension removes its data.

## Questions
Use the contact details on Klipkord's Chrome Web Store page, or open an issue at https://github.com/Itzfeminisce/klipkord-screen-recorder-chrome-extension/issues.

Last updated: 2026-11-02
