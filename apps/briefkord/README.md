# Briefkord

Briefkord is a Chrome extension that gathers everything for a meeting on one board.
Save pages, images, selections and files while you browse, arrange them on a canvas or as an agenda, and walk through them in meeting mode.
Boards stay on your computer. No account and no server.

## What Briefkord does

- Save the current page, a right-clicked image or selection, or a quick note to a board from the side panel.
- Drop images, PDFs and documents onto a board.
- Use link, image, note, file, checklist and flow diagram cards.
- Place, resize, group and colour cards on a free canvas, and draw arrows between them.
- See the same cards as an ordered list with sections, like an agenda.
- Walk through the list one card at a time in full-screen meeting mode.
- Search all boards by title, note text and link title.
- Share a board as a view file anyone can open in a browser, or as an edit file a teammate imports, edits and sends back.
- Ask AI to summarize a link, draw a diagram from a description, suggest an order, or brief you before the meeting.

## Install for testing

You need Chrome with the side panel.

```bash
pnpm install
pnpm build
```

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose `apps/briefkord/.output/chrome-mv3`.
3. Click the Briefkord icon to open the side panel.

## Keyboard shortcuts

- `Alt+Shift+S`: save this page to Briefkord. You can change it at `chrome://extensions/shortcuts`.

On a board (press `?` any time to see them):

- Tools: `V` select, `N` note, `C` checklist, `D` diagram, `A` arrow, `G` group, `Ctrl+K` search the board.
- Cards: `Space` open large, `Ctrl+D` duplicate, `Del` delete, `Alt+↑`/`Alt+↓` move up or down the list, `Ctrl+Z` undo, `Ctrl+Shift+Z` redo, `Space` + drag to pan the canvas.
- Meeting mode: `→` next card, `←` previous card, `N` show or hide notes, `F` full screen, `Esc` leave.

## Privacy

Nothing leaves your computer unless you send it. There is no account, no server, no analytics and no telemetry.

| Data | Where it stays | What can leave, and when |
| --- | --- | --- |
| Boards, cards, notes, layout | Your computer (IndexedDB) | Nothing. Leaves only inside a file you export. |
| Images and files you add | Your computer (OPFS) | Nothing. Leaves only inside a file you export. Never sent to AI. |
| Saved pages | Your computer: title, address, preview image and page text, taken from the open tab when you save | Nothing at save time. Briefkord does not fetch the page again unless you press Refresh. |
| Text for AI | Your computer | When you press an AI action, only the text it needs (a saved page's text, a description, card titles and notes) goes to the provider you chose in the shared model picker. |
| Speech from the mic | Memory only, while the mic is on; never kept | Only the audio between your two presses, once, when you stop, to Groq (`whisper-large-v3-turbo`) or OpenAI (`gpt-transcribe`) with your own key. Esc while listening throws it away. Never Chrome's built-in dictation. |
| Exported files | The folder you choose | The view file and the `.briefkord` package go wherever you send them. Briefkord never uploads them. |
| Keys | `chrome.storage.session`, cleared when Chrome closes | Fetched from Penv Cloud after "Connect Penv Cloud", or pasted. Never printed, logged or committed. |

AI keys come from Penv Cloud or a key you paste, and stay in `chrome.storage.session`.

## Development

```bash
pnpm dev        # build and reload the extension while you edit
pnpm compile    # type-check
pnpm test       # unit tests (vitest)
pnpm build      # test build to .output/chrome-mv3, with the machine check page
pnpm zip        # release zip in .output/, without the machine check pages
```

## Plans and specs

Plans, specs, handoffs and design frames live in the specs repo:
https://github.com/Itzfeminisce/productivity-apps-engineering-specs/tree/main/apps/briefkord
