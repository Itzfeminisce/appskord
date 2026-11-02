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

## Privacy tab
Copy each answer into the field of the same name. Each is under 1,000 characters.

### Single purpose description
Rekord records the user's meetings and turns them into a transcript, summary and action items that the user can search, ask questions about and share. Everything it does serves that one job: recording a meeting and writing it down.

### Permission justifications
- **sidePanel justification:** Rekord's whole interface lives in Chrome's side panel, so the user can see the transcript and notes beside the meeting.
- **tabCapture justification:** Records the sound of the meeting tab (for example Google Meet) after the user presses Start recording on that tab. Nothing is captured without that press.
- **offscreen justification:** Recording and transcription run in an offscreen document so they keep going when the side panel is closed or the user switches tabs during a long meeting.
- **activeTab justification:** The user's click on Rekord grants access to the meeting tab they are on, so Rekord can record it and read its title to name the meeting. No other tab is touched.
- **storage justification:** Keeps meetings, transcripts, notes and settings on the user's computer. Rekord has no server of its own.
- **identity justification:** Signs the user in to Penv Cloud to fetch their own AI keys, and to their Google account when they choose to connect Google Docs, Calendar or Tasks. Uses launchWebAuthFlow only when the user presses Connect.
- **alarms justification:** Times the reminders the user turns on: the brief before a meeting, due-day reminders for action items, the Friday look back, and building memory from older meetings in small steps.
- **notifications justification:** Shows those briefs and reminders when the side panel is closed. The user can turn each one off in Settings.
- **Host permission justification:** Rekord asks for no host at install. Every host is optional and asked for only when the user turns that feature on: penv.cloud for their keys; Groq, OpenAI, OpenRouter, Anthropic or Deepgram for the transcription and summary service the user picked; Notion, Google APIs, Google Tasks and Linear when the user shares notes or sends tasks there; Hugging Face to download the search model once (nothing is sent to it); localhost:11434 for the user's own Ollama. Audio or text goes only to the service the user picked.

### Are you using remote code?
No, I am not using remote code. All JavaScript and Wasm ship inside the package. The search model downloaded from Hugging Face is data, not code.

### Data usage
Tick these (all handled only to do the single purpose, at the user's request):
- **Personally identifiable information:** tick. Names of people in the meeting (speaker names, calendar invitees) appear in transcripts sent to the AI service the user picked.
- **Authentication information:** tick. The user's own AI and service keys, kept on their computer and sent only to the service each key belongs to.
- **Personal communications:** tick. What people say in the meeting, sent to the transcription and summary service the user picked, and to Docs, Notion or Linear when the user shares.
- **Website content:** tick. The sound of the meeting tab the user records.

Leave unticked: health information, financial and payment information, location, web history, user activity.

### Certifications (tick all three)
- I do not sell or transfer user data to third parties, apart from the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

### Privacy policy URL
https://github.com/Itzfeminisce/appskord/blob/main/apps/rekord/docs/privacy.md

## Store assets
All in this folder, `public/store/`. The build leaves this folder out of the extension. 24-bit PNG, no alpha.
- **Icon:** `public/icon/128.png`.
- **Global promo video:** leave blank.
- **Screenshots (1280x800), upload in this order:**
  1. `public/store/screenshot-1.png`: Record any meeting.
  2. `public/store/screenshot-2.png`: A live transcript as people talk.
  3. `public/store/screenshot-3.png`: Ask all your meetings.
  4. `public/store/screenshot-4.png`: Share in one click.
- **Small promo tile (440x280):** `public/store/small-promo-tile.png`.
- **Marquee promo tile (1400x560):** `public/store/marquee-promo-tile.png`.

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
