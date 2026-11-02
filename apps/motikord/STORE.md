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
  - Add a brand kit, your own media, and free photos, videos and music from Openverse and Pexels.
  - Export MP4, WebM or GIF in several sizes. Clips with CC BY media export with credits.txt.
  - The editor, preview, render and library stay on your computer. No account, no server, no upload.
  - Optional: Groq writes the clips, with a key from Penv Cloud (https://penv.cloud) or your own. Keys stay on the computer and are cleared when Chrome closes.
  - Open source.
- **Category:** Productivity. **Language:** English.
- **Privacy policy URL:** https://github.com/Itzfeminisce/appskord/blob/main/apps/motikord/docs/privacy.md

## Single purpose
Make short animated clips from a prompt, a page or your own media.

## Permission justifications
- `sidePanel`: shows Motikord beside the page.
- `storage`: keeps settings and clips on the user's computer.
- `unlimitedStorage`: clips and media files are large.
- `identity`: signs in to Penv Cloud to fetch the user's keys.
- `activeTab`: acts on the tab the user is on when they press "Grab from this page".
- `scripting`: runs the page picker in that tab. Nothing is read before the user presses Grab.
- Optional host access (`penv.cloud`, `api.groq.com`): asked only when the user connects Penv Cloud or uses Groq; sends the prompt and the clip's text only to the service the user picked.
- Optional host access (`api.openverse.org`, `api.pexels.com`, `images.pexels.com`, `videos.pexels.com`): asked when the user first searches free media; sends only the search words.
- Optional host access (Openverse source sites: `*.staticflickr.com`, `upload.wikimedia.org`, `cdn.freesound.org`, `*.jamendo.com`, `ccmixter.org`, `images.metmuseum.org`, `images.rawpixel.com`, `cdn.stocksnap.io`, `files.freemusicarchive.org`, `archive.org`, `*.archive.org`, `lh3.googleusercontent.com`, `player.vimeo.com`): downloads a file the user picked, once.
- Optional host access (`https://*/*`, `http://*/*`): "Grab from this page" asks for the one site the user is on, never all sites at once.
- Remote code: none is loaded.
- Data use: disclose prompts, clip text and search words, sent only to the service the user turns on; none sold; none used for unrelated purposes.

## Store assets
All in `store/` (not `public/`, which would ship inside the extension). 24-bit PNG, no alpha.
- **Icon:** `public/icon/128.png`.
- **Global promo video:** leave blank.
- **Screenshots (1280x800), upload in this order:**
  1. `store/screenshot-1.png`: Describe the clip you want.
  2. `store/screenshot-2.png`: Edit every scene.
  3. `store/screenshot-3.png`: One clip in every size.
  4. `store/screenshot-4.png`: Swap a scene’s template in one click.
  5. `store/screenshot-5.png`: A quality check before you export.
- **Small promo tile (440x280):** `store/small-promo-tile.png`.
- **Marquee promo tile (1400x560):** `store/marquee-promo-tile.png`.

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
