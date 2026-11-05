# Appskord

Appskord is a suite of Chrome extensions that run on your computer and keep your data there: Rekord takes meeting
notes, Klipkord records the screen, Motikord makes short animated clips, and Briefkord gathers everything for a meeting
on one board. They share one toolchain (Vite+ with WXT) and a few small packages, and each app keeps its own id,
version and store listing. Every app is free and open source.

## Apps

| App       | What it does         | Folder           | Store                                                                                         |
| --------- | -------------------- | ---------------- | --------------------------------------------------------------------------------------------- |
| Rekord    | Meeting notes        | `apps/rekord`    | [Chrome Web Store](https://chromewebstore.google.com/detail/flkicdahoghegnlgpkmdcemlooblblcd) |
| Klipkord  | Screen recorder      | `apps/klipkord`  | [Chrome Web Store](https://chromewebstore.google.com/detail/iapgbifdchhmidblniddncnagghloepi) |
| Motikord  | Short animated clips | `apps/motikord`  | Not yet listed                                                                                |
| Briefkord | Meeting-prep boards  | `apps/briefkord` | Not yet listed                                                                                |

Each app's README says what it does and how to load it for testing. Its store listing, Privacy tab answers, screenshots
and promo tiles live in `apps/<app>/public/store/STORE.md`; the build leaves that folder out of the extension.

## Build one app

You need Node 22 and pnpm 10. Install once, then run the app's own scripts.

```
pnpm install
pnpm exec vp run <app>#build      # build into apps/<app>/.output
pnpm exec vp run <app>#zip        # test zip, keeps the manifest key so the unpacked id stays fixed
pnpm exec vp run <app>#zip:store  # Web Store zip, without the manifest key
pnpm exec vp -C apps/<app> test run
```

Run tests per app. A bare `vp test` at the root does not read each app's Vitest config.

## Releases

Each app ships on its own: bump its `package.json` version and merge to `main`. The steps and the one-time store setup are in
[RELEASES.md](https://github.com/Itzfeminisce/productivity-apps-engineering-specs/blob/main/monorepo/RELEASES.md) in the specs repo.

## Privacy

Each app states what it stores and sends in its own `docs/privacy.md`:

- Rekord: `apps/rekord/docs/privacy.md`
- Klipkord: `apps/klipkord/docs/privacy.md`
- Motikord: `apps/motikord/docs/privacy.md`
- Briefkord: `apps/briefkord/docs/privacy.md`

No app has an account, analytics or a server of its own. AI features use the service each person picks, with their own
key or one from Penv Cloud.

## Licence

GNU AGPL-3.0 only. See `LICENSE` and `NOTICE`. Commits before this change were released under MIT and stay under MIT.

The app names and icons are trademarks and are not covered by the licence. Forks must rename and rebrand. See `TRADEMARKS.md`.
