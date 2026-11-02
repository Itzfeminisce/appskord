# Chrome Web Store listing

Build the store zip with `pnpm zip:store`; it leaves `key` out of the manifest, which the store rejects. Test zips (`pnpm zip`) keep it so unpacked ids stay fixed. For the first upload only, add the private key as `key.pem` at the zip root so the store keeps the id `flkicdahoghegnlgpkmdcemlooblblcd`; never commit it. The file is `.output/rekord-<version>-chrome.zip`. Raise `version` in `package.json` for every upload.

## Listing text
- **Name:** Rekord
- **Short description (132 characters max):** Record your meetings and get a live transcript, summary and action items. Ask questions across every meeting.
- **Long description:**
  Rekord writes down your meetings for you.

  - Record a meeting in a Chrome tab, or in a desktop app such as Zoom or Teams. Add your microphone if you choose.
  - A live transcript shows while people talk.
  - Type notes and add markers during the meeting.
  - Get a summary and action items when it ends.
  - Ask questions about one meeting, or across all of them.
  - Export as Markdown or PDF, or share to Google Docs or Notion.
  - Rekord remembers promises, decisions, questions and people across meetings, each with the quote it came from.
  - Open loops shows what you owe and what you're owed, with a brief before each meeting and a look back on Fridays.
  - Send a follow-up in Gmail and action items to Google Tasks, Notion or Linear.
  - Meetings, transcripts and settings stay in your browser. No account, no server of its own.
  - Use Groq, OpenAI, Anthropic, OpenRouter, Deepgram or your own Ollama, with keys from Penv Cloud (https://penv.cloud) or your own.
  - Open source.
- **Category:** Productivity. **Language:** English.
- **Privacy policy URL:** https://github.com/Itzfeminisce/appskord/blob/main/apps/rekord/docs/privacy.md

## Single purpose
Record meetings and turn them into a transcript, summary and action items.

## Permission justifications
- `sidePanel`: shows Rekord beside the meeting.
- `tabCapture`: records the sound of the meeting tab the user starts Rekord on.
- `offscreen`: keeps recording and transcribing while the panel is closed.
- `activeTab`: lets the user's click on Rekord grant the meeting tab, so it can be recorded and named.
- `storage`: keeps meetings, transcripts and settings on the user's computer.
- `identity`: signs in to Penv Cloud to fetch the user's keys, and to Google when the user connects Docs, Calendar or Tasks.
- `alarms`: times the brief before a meeting, due-day reminders, the Friday look back and building memory from older meetings.
- `notifications`: shows those briefs and reminders when the side panel is closed.
- Optional host access (`penv.cloud`, Groq, OpenAI, OpenRouter, Anthropic, Deepgram, Notion, Google APIs, Google Tasks, Linear, Hugging Face, `localhost:11434`): asked only when the user turns that feature on; sends audio or text only to the service the user picked. Hugging Face only serves the search model download; nothing is sent to it.
- Remote code: none is loaded.
- Data use: disclose audio and transcript text, sent only to the services the user turns on; none sold; none used for unrelated purposes.

## Store assets
All in `store/` (not `public/`, which would ship inside the extension). 24-bit PNG, no alpha.
- **Icon:** `public/icon/128.png`.
- **Global promo video:** leave blank.
- **Screenshots (1280x800), upload in this order:**
  1. `store/screenshot-1.png`: Record any meeting.
  2. `store/screenshot-2.png`: A live transcript as people talk.
  3. `store/screenshot-3.png`: Ask all your meetings.
  4. `store/screenshot-4.png`: Share in one click.
- **Small promo tile (440x280):** `store/small-promo-tile.png`.
- **Marquee promo tile (1400x560):** `store/marquee-promo-tile.png`.

## Additional fields
- **Official URL:** None (no site of ours is verified in Search Console).
- **Homepage URL:** https://github.com/Itzfeminisce/appskord/tree/main/apps/rekord
- **Support URL:** https://github.com/Itzfeminisce/appskord/issues
- **Mature content:** No.
- **Item support:** On.

## Release steps
- Bump `version` in `apps/rekord/package.json`, merge to `main`, then tag from `main`: `git tag rekord@x.y.z && git push origin rekord@x.y.z`.
- CI runs the tests, builds, checks the tag matches the manifest version, and makes a GitHub release with the zip.
- Store upload is automatic once the Chrome Web Store secrets exist (`CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`, `CWS_EXTENSION_ID_REKORD`). Until then, download the zip from the release and upload it by hand.
- Dry run: tag `rekord@x.y.z-test` makes a prerelease and never uploads.
