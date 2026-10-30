# Motikord privacy policy

Motikord is a Chrome extension that makes short animated clips on your computer. This page says what stays on your computer, what leaves it, and when.

Nothing leaves your computer unless you switch it on. There is no account, no analytics and no telemetry.

| Data | Where it stays | What can leave, and when |
| --- | --- | --- |
| Clips, recipes, brand kit, library | Your computer (IndexedDB and OPFS) | Nothing. Leaves only inside a file you export. |
| Your own media and fonts | Your computer | Nothing. Never sent to AI or any library. |
| Prompts and recipe text | Your computer | Sent to the AI you chose (Groq by default) when you prompt. Not sent if Chrome's built-in AI is used. |
| Page grabs | Your computer | The text of a grab goes to the AI only as part of a prompt you send. The page is read only after you press "Grab from this page" and allow that site. |
| Media and music searches | Your computer | Your search words go to the library you search (Openverse or Pexels). Picked files are downloaded once from their source and kept here. |
| Keys | `chrome.storage.session`, cleared when Chrome closes | Fetched from Penv Cloud after "Connect Penv Cloud", or pasted. Never printed, logged or committed. |

Each service you turn on handles what it receives under its own privacy policy. Motikord does not sell or share your data with anyone else.

## Permissions and why
- `sidePanel`: shows Motikord beside the page.
- `storage` and `unlimitedStorage`: keep your settings, clips and media on your computer. Clips and media can be large.
- `identity`: signs you in to Penv Cloud so your keys can be fetched.
- `activeTab` and `scripting`: run the page picker when you press "Grab from this page". Nothing is read from a page before that.

## Optional host access
Chrome asks for these only when you first use the feature. Nothing is requested at install.
- `penv.cloud`: fetches your keys after "Connect Penv Cloud".
- `api.groq.com`: the AI that writes and changes your clips. It receives your prompt and the clip's text, never your media.
- `api.openverse.org`: searches Openverse photos and music. It receives your search words.
- `api.pexels.com`, `images.pexels.com`, `videos.pexels.com`: searches Pexels and downloads the photo or video you pick. Needs your Pexels key.
- Source sites of Openverse files, used only to download a file you pick: `*.staticflickr.com`, `upload.wikimedia.org`, `cdn.freesound.org`, `*.jamendo.com`, `ccmixter.org`, `images.metmuseum.org`, `images.rawpixel.com`, `cdn.stocksnap.io`, `files.freemusicarchive.org`, `archive.org` and `*.archive.org`, `lh3.googleusercontent.com`, `player.vimeo.com`.
- `https://*/*` and `http://*/*`: "Grab from this page" asks for the one site you are on, never all sites at once, so the picker can run there.

## What Motikord does not do
- No tracking, analytics, advertising or crash reporting.
- No reading of the pages you visit. A page is read only after you press "Grab from this page" and allow that site.
- No upload of your clips, media, brand kit or fonts.
- No loading of remote code.

## Your control
Delete a clip in Motikord and it is gone from your computer. Disconnect Penv Cloud at any time in Settings. Removing the extension removes its data. Clips with CC BY media export with `credits.txt`, so you can credit the authors.

## Questions
Open an issue at https://github.com/itzfeminisce/motikord-clip-generation-chrome-extension/issues.

Last updated: 2026-10-30
