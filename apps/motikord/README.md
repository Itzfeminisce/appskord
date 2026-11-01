# Motikord

Motikord is a Chrome side-panel extension that turns a prompt, a page or your own media into a short animated clip (5 to 60 seconds), made and rendered on your computer.
Think of a free, local, prompt-first Canva or Jitter that lives in Chrome.

## What Motikord does

- Start a clip from a prompt, a template or things you grab from a page. Motikord picks the clip type for you: Promo, Quote, Chart reveal, Explainer, Logo intro, Captions or Social post. You can always switch it.
- Keep editing with prompts ("slower", "bigger title", "use my brand colours") or by hand in the editor, with undo and a list of every change.
- A quality check looks at text size, reading time and credits before you export.
- Keep a brand kit (logo, colours, fonts) and your own media, and add free photos, videos and music from Openverse and Pexels.
- Export MP4, WebM or GIF in several sizes. Clips with CC BY media always export with `credits.txt`.
- Keep clips in a library on your computer.

## Install

You need Chrome with the side panel.

1. Build it (see Development), or unzip a Motikord zip to a folder.
2. Open `chrome://extensions` and turn on Developer mode.
3. Press Load unpacked and pick the folder (the unzipped folder, or `.output/chrome-mv3`).
4. Click the Motikord icon to open the side panel.

To update a zip build, unzip it over the same folder and press Reload on the extension card. Do not remove the extension, or its data goes with it.

## First run

Setup asks who writes your clips: on this computer (Chrome's built-in AI, where available) or faster in the cloud, with Groq (the default, with a free tier), OpenAI, Anthropic or OpenRouter. For a cloud provider, press "Connect Penv Cloud", or choose "Paste a key" and paste that provider's key. A Pexels key is optional and adds Pexels photos and videos to media search.

## AI options

- Groq, OpenAI, Anthropic or OpenRouter, with a key from Penv Cloud (`GROQ_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`) or one you paste. Settings lists the provider's current models; pick one, or keep the recommended model.
- Chrome's built-in AI, when your computer has it. Nothing is sent anywhere.

## Privacy

Nothing leaves your computer unless you switch it on.
There is no account, no analytics and no telemetry.

| Data | Where it stays | What can leave, and when |
| --- | --- | --- |
| Clips, recipes, brand kit, library | Your computer (IndexedDB and OPFS) | Nothing. Leaves only inside a file you export. |
| Your own media and fonts | Your computer | Nothing. Never sent to AI or any library. |
| Prompts and recipe text | Your computer | Sent only to the one AI provider you chose (Groq by default; or OpenAI, Anthropic or OpenRouter) when you prompt: your prompt and the clip's text, never your media. Not sent if Chrome's built-in AI is used. |
| Your voice | Nowhere. No recording is kept | Heard only while the mic is lit, after you press Speak. Turned into text on this computer by Chrome's on-device speech recognition when Chrome can (never Chrome's cloud speech service); otherwise sent to Groq or OpenAI, with your key, only to become text, and only when that is the provider you chose. The text goes into the prompt box and is sent only when you press Make clip or send. |
| Page grabs | Your computer | The text of a grab goes to the AI only as part of a prompt you send. The page is read only after you press "Grab from this page" and allow access. |
| Media and music searches | Your computer | Your search words go to every media source that is on (Media sources in Settings: Openverse, Wikimedia Commons and NASA by default; Museums, ccMixter, Pexels, Pixabay, Freesound, Jamendo, Unsplash or your own links if you turn them on). Picked files are downloaded once from their source and kept here. |
| Keys | `chrome.storage.session`, cleared when Chrome closes | Groq, OpenAI, Anthropic, OpenRouter, Pexels, Pixabay, Freesound, Jamendo and Unsplash keys, and keys for your own media sources, fetched from Penv Cloud after "Connect Penv Cloud", or pasted. Each key goes only to its own service. Never printed, logged or committed. |

The full policy, with every permission and host, is in [docs/privacy.md](docs/privacy.md).

## Media sources

Free media searches every source that is on, all at once. If one does not answer, the others still show. Turn sources on and off in Settings, Media sources.

- Ready now, no key: Openverse, Wikimedia Commons and NASA Image Library (on); Museums (CC0: The Met and the Art Institute of Chicago, public domain only) and ccMixter (off).
- Free with a key, from Penv Cloud or pasted: Pexels (`PEXELS_API_KEY`), Pixabay (`PIXABAY_API_KEY`), Freesound (`FREESOUND_API_KEY`), Jamendo (`JAMENDO_CLIENT_ID`) and Unsplash (`UNSPLASH_ACCESS_KEY`).
- Your own sources: paste a search link with `{query}` where the words go (Motikord adds `?q=` if you leave it out), and a key if it needs one, sent as `Authorization: Bearer`, `Authorization`, `?key=`, `?api_key=`, `?client_id=` or another header. Motikord runs a test search before adding it.

Links that work, tried in this order:
1. Openverse API (`/v1/images/` or `/v1/audio/`).
2. WordPress media (`/wp-json/wp/v2/media`).
3. MediaWiki or Wikimedia API with `prop=imageinfo` and `iiprop=url|mime|extmetadata`.
4. Pexels-style replies (`photos` with `src`, or `videos` with `video_files`).
5. Pixabay-style replies (`hits` with `largeImageURL`, or `videos`).
6. Any JSON with a list of items that hold an image, video or audio address, with a title, author and licence if present.

When a source gives no licence, each item says "Check you may use it" and credits.txt lists it as From the source, with its link. Unsplash photos send Unsplash's download ping when used and are credited to the photographer; Pixabay files are downloaded, never hotlinked.

## Development

```bash
npm run dev        # build and reload the extension while you edit
npm run compile    # type-check
npm test           # unit tests (vitest)
npm run build      # build to .output/chrome-mv3
npm run zip        # release zip in .output/ (leaves out the machine check)
```

- The manifest carries Motikord's public key, so the extension id is always `pppjklpibpnndjfddhcedbdicfdalchl`. This fixes the Penv Cloud redirect URL. `WXT_EXTENSION_KEY` overrides it.
- `npm run build` keeps the developer tools and the machine check page. See [CHECK.md](CHECK.md).
- A manual test for the owner is in [TEST-STEPS.md](TEST-STEPS.md).
- `npm run icons` rewrites the icons in `public/icon/`.
- Store listing text is in [STORE.md](STORE.md).

## Plans and specs

Plans, specs, handoffs and design frames live in the specs repo:
https://github.com/Itzfeminisce/productivity-apps-engineering-specs/tree/main/apps/motikord

Motikord is open source.
