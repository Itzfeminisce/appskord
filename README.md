# Appskord

Appskord is the home of three Chrome extensions that run on your computer and keep your data there: Rekord takes meeting
notes, Klipkord records the screen, and Motikord makes short animated clips. They share one toolchain (Vite+ with WXT)
and a few small packages, and each app keeps its own id, version and store listing.

## Apps

| App      | What it does         | Folder          |
| -------- | -------------------- | --------------- |
| Rekord   | Meeting notes        | `apps/rekord`   |
| Klipkord | Screen recorder      | `apps/klipkord` |
| Motikord | Short animated clips | `apps/motikord` |

## Build one app

You need Node 22 and pnpm 10. Install once, then run the app's own scripts.

```
pnpm install
pnpm exec vp run <app>#build     # build into apps/<app>/.output
pnpm exec vp run <app>#zip       # the Web Store zip
pnpm exec vp -C apps/<app> test run
```

Run tests per app. A bare `vp test` at the root does not read each app's Vitest config.

## Shared code

`packages/config` holds the shared tsconfig, `defineAppConfig()` for each app's `wxt.config.ts`, the manifest checks each
app calls from its `wxt.config.test.ts`, and the test setup. It ships as TypeScript source with no build step.

## Releases

Each app ships on its own. Bump the app's `package.json` version, merge to `main`, then push a tag `<app>@<version>`, for example `motikord@1.2.0`.
CI tests and builds that app, checks the tag matches the manifest version, and makes a GitHub release with the zip. It uploads to the Chrome Web Store when the store secrets exist; otherwise upload the zip by hand.
A tag ending in `-test` is a dry run: a prerelease, no store upload. The workflow can also be run by hand with an app name to get the zip as an artifact.

## Privacy

Each app states what it stores and sends in its own `docs/privacy.md`:

- Rekord: `apps/rekord/docs/privacy.md`
- Klipkord: `apps/klipkord/docs/privacy.md`
- Motikord: `apps/motikord/docs/privacy.md`

## Licence

MIT. See `LICENSE`.
