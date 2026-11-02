# Chrome Web Store listing

Build the store zip with `pnpm zip:store`; it leaves `key` out of the manifest, which the store rejects. Test zips (`pnpm zip`) keep it so unpacked ids stay fixed. For the first upload only, add the private key as `key.pem` at the zip root so the store keeps the id `pppjklpibpnndjfddhcedbdicfdalchl`; never commit it. The file is `.output/motikord-<version>-chrome.zip`. Raise `version` in `package.json` for every upload.

## Listing text
- **Name:** Motikord
- **Short description (132 characters max):** Short animated clips, made on your computer
- **Long description:**
  Motikord turns a prompt, a page or your own media into a short animated clip.

  - Describe a clip and Motikord picks the type: Promo, Quote, Chart reveal, Explainer, Logo intro, Captions or Social post.
  - Keep editing with prompts like "slower" or "bigger title", or by hand in the editor, with undo.
  - A quality check looks at text size and reading time before you export.
  - Add a brand kit, your own media, and free photos, videos and music from open media libraries.
  - Export MP4, WebM or GIF in several sizes. Clips with CC BY media export with credits.txt.
  - The editor, preview, render and library stay on your computer. No account, no server, no upload.
  - Optional: connect the AI service you choose to write the clips, with your own key or one from Penv Cloud. Keys stay on your computer.
  - Open source.
- **Category:** Productivity. **Language:** English.
- **Privacy policy URL:** https://github.com/Itzfeminisce/appskord/blob/main/apps/motikord/docs/privacy.md

## Privacy tab
Copy each answer into the field of the same name. Each is under 1,000 characters.

### Single purpose description
Motikord makes short animated video clips from a description the user types or says, using text, images and media they choose, and lets them edit and export the clip. Everything it does serves that one job: making a motion clip.

### Permission justifications
- **sidePanel justification:** Motikord's start screen and settings live in Chrome's side panel beside the page the user is working from.
- **storage justification:** Keeps settings, clips and the user's brand kit on their computer. Motikord has no server of its own.
- **unlimitedStorage justification:** Clips, music and media files are large and stay on the user's computer, beyond the default storage quota.
- **activeTab justification:** When the user clicks Motikord on a page, it can see that tab's address so Grab from this page can ask for that one site only.
- **scripting justification:** Runs the page picker in the tab the user is on after they press Grab from this page, so they can pick the text and images to use. Nothing is read before they press Grab.
- **identity justification:** Signs the user in to Penv Cloud to fetch their own AI keys. Only when the user presses Connect.
- **Host permission justification:** Motikord asks for no host at install. Every host is optional and asked for only when the user needs it: penv.cloud for their keys; api.groq.com to write the clip; Openverse, Pexels, Unsplash, Pixabay, NASA, the Met, the Art Institute of Chicago and Freesound when the user searches free media; and for Grab from this page, the one site the user is on, never all sites at once.

### Are you using remote code?
No, I am not using remote code. All JavaScript and Wasm ship inside the package.

### Data usage
Tick these (all handled only to do the single purpose, at the user's request):
- **Authentication information:** tick. The user's own AI and media keys, kept on their computer and sent only to the service each key belongs to.
- **Website content:** tick. Text and images the user picks with Grab from this page, and the prompt for the clip, sent to the AI service the user turns on.

Leave unticked: personally identifiable information, health information, financial and payment information, personal communications, location, web history, user activity.

### Certifications (tick all three)
- I do not sell or transfer user data to third parties, apart from the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

### Privacy policy URL
https://github.com/Itzfeminisce/appskord/blob/main/apps/motikord/docs/privacy.md

## Store assets
All in this folder, `public/store/`. The build leaves this folder out of the extension. 24-bit PNG, no alpha.
- **Icon:** `public/icon/128.png`.
- **Global promo video:** leave blank.
- **Screenshots (1280x800), upload in this order:**
  1. `public/store/screenshot-1.png`: Describe the clip you want.
  2. `public/store/screenshot-2.png`: Edit every scene.
  3. `public/store/screenshot-3.png`: One clip in every size.
  4. `public/store/screenshot-4.png`: Swap a scene’s template in one click.
  5. `public/store/screenshot-5.png`: A quality check before you export.
- **Small promo tile (440x280):** `public/store/small-promo-tile.png`.
- **Marquee promo tile (1400x560):** `public/store/marquee-promo-tile.png`.

## Additional fields
- **Official URL:** None (no site of ours is verified in Search Console).
- **Homepage URL:** https://github.com/Itzfeminisce/appskord/tree/main/apps/motikord
- **Support URL:** https://github.com/Itzfeminisce/appskord/issues
- **Mature content:** No.
- **Item support:** On.

## Release steps
- Bump `version` in `apps/motikord/package.json`, merge to `main`, then tag from `main`: `git tag motikord@x.y.z && git push origin motikord@x.y.z`.
- CI runs the tests, builds, checks the tag matches the manifest version, and makes a GitHub release with the zip.
- Store upload is automatic once the Chrome Web Store secrets exist (`CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`, `CWS_EXTENSION_ID_MOTIKORD`). Until then, download the zip from the release and upload it by hand.
- Dry run: tag `motikord@x.y.z-test` makes a prerelease and never uploads.
