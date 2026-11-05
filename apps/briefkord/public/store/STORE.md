# Chrome Web Store listing

Build the store zip with `pnpm zip:store`; it leaves `key` out of the manifest, which the store rejects. Test zips (`pnpm zip`) keep it so unpacked ids stay fixed. For the first upload only, add the private key as `key.pem` at the zip root so the store keeps the id `ghbafbelhbkgelfckkdkaclkjmidepea`; never commit it. The file is `.output/briefkord-<version>-chrome.zip`. Raise `version` in `package.json` for every upload.

## Listing text
- **Name:** Briefkord
- **Short description (132 characters max):** One board for every meeting. Save pages, files and notes while you browse, then walk through them one card at a time.
- **Long description:**
  Briefkord gathers everything for a meeting on one board.

  - Save the page you are on in one click, with its title, preview and text.
  - Right-click to save an image or a selected quote to any board.
  - Drop in images, PDFs and documents, or add notes, checklists and flow diagrams.
  - Arrange cards on a free canvas, group them and draw arrows between them.
  - See the same cards as an agenda, in sections, with time for each.
  - Meeting mode shows one card at a time, full screen, with your notes beside it.
  - Search every board by title, note and saved page text.
  - Share a board as a file anyone can open in a browser, or as an edit file a teammate imports.
  - Optional: summarize a page, draw a diagram from a description, suggest an order, brief you before the meeting, fill a card or take dictation, using the AI service you choose with your own key or one from Penv Cloud.
  - Boards, files and settings stay on your computer. No account, no server of its own.
  - Open source.
- **Category:** Productivity. **Language:** English.
- **Privacy policy URL:** https://github.com/Itzfeminisce/appskord/blob/main/apps/briefkord/docs/privacy.md

## Privacy tab
Copy each answer into the field of the same name. Each is under 1,000 characters.

### Single purpose description
Briefkord gathers the pages, images, files and notes for one meeting on a board, so the user can arrange them and walk through them during the meeting. Everything it does serves that one job: preparing and presenting a meeting board.

### Permission justifications
- **sidePanel justification:** Briefkord's capture view lives in Chrome's side panel, so the user can save pages to a board while they browse.
- **storage justification:** Keeps settings and the user's keys on their computer. Keys sit in session storage and are cleared when Chrome closes. Briefkord has no server of its own.
- **unlimitedStorage justification:** Boards hold the images, PDFs and documents the user adds, which can pass the default storage limit. All of it stays on the user's computer.
- **activeTab justification:** When the user presses Save this page, the shortcut or a right-click menu item, Briefkord reads that one tab's title, address, preview image and text to make a card. No other tab is touched.
- **scripting justification:** Runs a one-time read in the tab the user chose to save, to copy its text, a selected quote or a right-clicked image. Only after the user's click, and only in that tab.
- **contextMenus justification:** Adds "Save image to Briefkord" and "Save selection to Briefkord" to Chrome's right-click menu.
- **identity justification:** Signs the user in to Penv Cloud to fetch their own AI keys. Uses launchWebAuthFlow only when the user presses Connect Penv Cloud.
- **Host permission justification:** Briefkord asks for no host at install. Every host is optional and asked for only inside the click that needs it: penv.cloud for the user's keys, and Groq, OpenAI, Anthropic, OpenRouter, Gemini or xAI for the AI service the user picked. Text or dictated audio goes only to the service the user picked.

### Are you using remote code?
No, I am not using remote code. All JavaScript ships inside the package.

### Data usage
Tick these (all handled only to do the single purpose, at the user's request):
- **Authentication information:** tick. The user's own AI keys, kept in session storage on their computer and sent only to the service each key belongs to.
- **Personal communications:** tick. Speech the user dictates, sent once to the speech service they picked when they stop the mic.
- **Website content:** tick. The title, address, preview image and text of pages the user saves, and the page text sent to the AI service when the user asks for a summary.

Leave unticked: personally identifiable information, health information, financial and payment information, location, web history, user activity.

### Certifications (tick all three)
- I do not sell or transfer user data to third parties, apart from the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

### Privacy policy URL
https://github.com/Itzfeminisce/appskord/blob/main/apps/briefkord/docs/privacy.md

## Store assets
All in this folder, `public/store/`. The build leaves this folder out of the extension. 24-bit PNG, no alpha. The screenshots are made from the approved design frames in the specs repo.
- **Icon:** `public/icon/128.png`.
- **Global promo video:** leave blank.
- **Screenshots (1280x800), upload in this order:**
  1. `public/store/screenshot-1.png`: One board for every meeting.
  2. `public/store/screenshot-2.png`: Save pages while you browse.
  3. `public/store/screenshot-3.png`: Turn the board into an agenda.
  4. `public/store/screenshot-4.png`: Present one card at a time.
  5. `public/store/screenshot-5.png`: Share a board anyone can open.
- **Small promo tile (440x280):** `public/store/small-promo-tile.png`.
- **Marquee promo tile (1400x560):** `public/store/marquee-promo-tile.png`.

## Additional fields
- **Official URL:** None (no site of ours is verified in Search Console).
- **Homepage URL:** https://github.com/Itzfeminisce/appskord/tree/main/apps/briefkord
- **Support URL:** https://github.com/Itzfeminisce/appskord/issues
- **Mature content:** No.
- **Item support:** On.

## Release steps
- Bump `version` in `apps/briefkord/package.json` and merge to `main`. The Store workflow tests, builds, tags `briefkord@x.y.z` and makes a GitHub release with the zip.
- Store upload is automatic only when `briefkord` is in the repository variable `CWS_AUTO_PUBLISH` and the store secrets exist. The first upload is always by hand, since it carries `key.pem`.
- Dry run: tag `briefkord@x.y.z-test` makes a prerelease and never uploads.
