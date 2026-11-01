# Chrome Web Store listing

Build the zip with `npm run zip`. For the first upload only, add the private key as `key.pem` at the zip root so the store keeps the id `pppjklpibpnndjfddhcedbdicfdalchl`; never commit it. The file is `.output/motikord-<version>-chrome.zip`. Raise `version` in `package.json` for every upload.

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
- **Privacy policy URL:** the public URL of `docs/privacy.md`.

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

## Assets to prepare
- Icons: `public/icon/` (16, 48, 128).
- Screenshots 1280x800, at least one. Frames to capture: Home (prompt box), Making, the editor, Quality check, Free media search, Export, Library, Brand kit, Privacy (Where your data goes).
- Small promo tile 440x280.
