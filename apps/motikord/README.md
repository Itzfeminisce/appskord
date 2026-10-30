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

Setup asks who writes your clips: on this computer (Chrome's built-in AI, where available) or Groq, which is faster. For Groq, press "Connect Penv Cloud", or choose "Paste a key". A Pexels key is optional and adds Pexels photos and videos to media search.

## AI options

- Groq, with a key from Penv Cloud or one you paste.
- Chrome's built-in AI, when your computer has it. Nothing is sent anywhere.

## Privacy

Nothing leaves your computer unless you switch it on.
There is no account, no analytics and no telemetry.

| Data | Where it stays | What can leave, and when |
| --- | --- | --- |
| Clips, recipes, brand kit, library | Your computer (IndexedDB and OPFS) | Nothing. Leaves only inside a file you export. |
| Your own media and fonts | Your computer | Nothing. Never sent to AI or any library. |
| Prompts and recipe text | Your computer | Sent to the AI you chose (Groq by default) when you prompt. Not sent if Chrome's built-in AI is used. |
| Page grabs | Your computer | The text of a grab goes to the AI only as part of a prompt you send. The page is read only after you press "Grab from this page" and allow that site. |
| Media and music searches | Your computer | Your search words go to the library you search (Openverse or Pexels). Picked files are downloaded once from their source and kept here. |
| Keys | `chrome.storage.session`, cleared when Chrome closes | Fetched from Penv Cloud after "Connect Penv Cloud", or pasted. Never printed, logged or committed. |

The full policy, with every permission and host, is in [docs/privacy.md](docs/privacy.md).

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
