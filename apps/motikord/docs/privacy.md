# Motikord privacy policy

Motikord is a Chrome extension that makes short animated clips on your computer. This page says what stays on your computer, what leaves it, and when.

Nothing leaves your computer unless you switch it on. There is no account, no analytics and no telemetry.

| Data | Where it stays | What can leave, and when |
| --- | --- | --- |
| Clips, recipes, brand kit, library | Your computer (IndexedDB and OPFS) | Nothing. Leaves only inside a file you export. |
| Your own media and fonts | Your computer | Nothing. Never sent to AI or any library. |
| Prompts and recipe text | Your computer | Sent only to the one AI provider you chose (Groq by default; or OpenAI, Anthropic or OpenRouter) when you prompt: your prompt and the clip's text, never your media. Not sent if Chrome's built-in AI is used. |
| Your voice | Nowhere. No recording is kept | Heard only while the mic is lit, after you press Speak. Turned into text on this computer by Chrome's on-device speech recognition when Chrome can (never Chrome's cloud speech service); otherwise sent to Groq or OpenAI, with your key, only to become text, and only when that is the provider you chose. The text goes into the prompt box and is sent only when you press Make clip or send. |
| Page grabs | Your computer | The text of a grab goes to the AI only as part of a prompt you send. The page is read only after you press "Grab from this page" and allow access. |
| Media and music searches | Your computer | Your search words go to every media source that is on (Media sources in Settings: Openverse, Wikimedia Commons and NASA by default; Museums, ccMixter, Pexels, Pixabay, Freesound, Jamendo, Unsplash or your own links if you turn them on). Picked files are downloaded once from their source and kept here. |
| Keys | `chrome.storage.session`, cleared when Chrome closes | Groq, OpenAI, Anthropic, OpenRouter, Pexels, Pixabay, Freesound, Jamendo and Unsplash keys, and keys for your own media sources, fetched from Penv Cloud after "Connect Penv Cloud", or pasted. Each key goes only to its own service. Never printed, logged or committed. |

Each service you turn on handles what it receives under its own privacy policy. Motikord does not sell or share your data with anyone else.

## Permissions and why
- `sidePanel`: shows Motikord beside the page.
- `storage` and `unlimitedStorage`: keep your settings, clips and media on your computer. Clips and media can be large.
- `identity`: signs you in to Penv Cloud so your keys can be fetched.
- `activeTab` and `scripting`: run the page picker when you press "Grab from this page". Nothing is read from a page before that.
- Microphone (no install-time permission): the first time you press Speak, a small Motikord tab opens so Chrome can ask you once. It closes itself. Motikord listens only while the mic is lit and keeps no recording.

## Optional host access
Chrome asks for these only when you first use the feature. Nothing is requested at install.
- `penv.cloud`: fetches your keys after "Connect Penv Cloud".
- `api.groq.com`, `api.openai.com`, `api.anthropic.com`, `openrouter.ai`: the AI provider you chose (Groq, OpenAI, Anthropic or OpenRouter), which writes and changes your clips. Chrome asks only for the one you use. It receives your prompt and the clip's text, never your media. Motikord also asks it for its list of models, so you can pick one in Settings. With Groq or OpenAI, when Chrome can't turn speech into text on your computer, it also receives the audio of a voice prompt, only to turn it into text.
- `api.openverse.org`: searches Openverse photos and music. It receives your search words.
- `api.pexels.com`, `images.pexels.com`, `videos.pexels.com`: searches Pexels and downloads the photo or video you pick. Needs your Pexels key.
- Source sites of Openverse files, used only to download a file you pick: `*.staticflickr.com`, `upload.wikimedia.org`, `cdn.freesound.org`, `*.jamendo.com`, `ccmixter.org`, `images.metmuseum.org`, `images.rawpixel.com`, `cdn.stocksnap.io`, `files.freemusicarchive.org`, `archive.org` and `*.archive.org`, `lh3.googleusercontent.com`, `player.vimeo.com`.
- Media sources, each asked the first time you search it: `commons.wikimedia.org` and `upload.wikimedia.org` (Wikimedia Commons), `images-api.nasa.gov` and `images-assets.nasa.gov` (NASA Image Library), `collectionapi.metmuseum.org`, `images.metmuseum.org`, `api.artic.edu` and `www.artic.edu` (Museums), `ccmixter.org`, `pixabay.com` and `cdn.pixabay.com`, `freesound.org` and `cdn.freesound.org`, `*.jamendo.com`, `api.unsplash.com` and `images.unsplash.com`. Each receives your search words, and the key you gave it if it needs one.
- Your own media sources: when you add one, Chrome asks for that site. It receives your search words and, if you gave one, the key, sent the way you chose.
- `https://*/*` and `http://*/*`: "Grab from this page" asks for the site you are on. When Chrome does not tell Motikord which site that is, it asks for all sites once, so the picker can run on any page. Nothing is read from a page until you press the button.

## Media source terms
- Unsplash: when you add an Unsplash photo, Motikord tells Unsplash it was used (its download link, as Unsplash's API terms ask) and credits the photographer in credits.txt with a link back to Unsplash.
- Pixabay: files are downloaded once and kept on your computer, never hotlinked, as Pixabay's API terms ask.
- Jamendo and Freesound: each track keeps its Creative Commons licence; non-commercial ones show only when "Only free to use in videos" is off.
- Sources that state no licence (your own links, NASA): each item says "Check you may use it" and credits.txt lists it as From the source, with its link. Motikord never claims a licence a source did not give.

## What Motikord does not do
- No tracking, analytics, advertising or crash reporting.
- No reading of the pages you visit. A page is read only after you press "Grab from this page" and allow access.
- No upload of your clips, media, brand kit or fonts.
- No recording of your voice. Audio is held in memory only while you speak and is never saved or logged.
- No loading of remote code.

## Your control
Delete a clip in Motikord and it is gone from your computer. Disconnect Penv Cloud at any time in Settings. Removing the extension removes its data. Clips with CC BY media export with `credits.txt`, so you can credit the authors.

## Questions
Open an issue at https://github.com/itzfeminisce/motikord-clip-generation-chrome-extension/issues.

Last updated: 2026-10-30
