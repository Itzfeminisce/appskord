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

Each app ships on its own. Bump the app's `package.json` version and merge to `main`.
The Store workflow tests and builds that app, checks the zip has no manifest `key` and no `.pem`, tags `<app>@<version>`,
and makes a GitHub release with the zip. Merges that do not change a version publish nothing, since every upload starts a new store review.
It submits the zip to the Chrome Web Store only for apps listed in the repository variable `CWS_AUTO_PUBLISH`
(for example `rekord klipkord`). Leave an app out while its last version is still in review; upload its zip by hand instead.

A tag pushed by hand, `<app>@<version>`, still runs the Release workflow and uploads when the store secrets exist.
A tag ending in `-test` is a dry run: a prerelease, no store upload. The Release workflow can also be run by hand with an app name to get the zip as an artifact.

### Store setup (once)

1. In Google Cloud Console, make a project and enable the Chrome Web Store API.
2. Set up the OAuth consent screen as External, add your email as a test user, then press Publish app so tokens do not expire after 7 days.
3. Make an OAuth client ID of type Web application, with redirect URI `https://developers.google.com/oauthplayground`.
4. In the OAuth 2.0 Playground, tick "Use your own OAuth credentials" and enter the client ID and secret.
5. Authorize the scope `https://www.googleapis.com/auth/chromewebstore`, then exchange the code for tokens.
6. In the Chrome Web Store dashboard, copy your publisher ID from Publisher, Settings.
7. In this repo's Settings, Secrets and variables, Actions, add secrets `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN` and `CWS_PUBLISHER_ID`.
8. When ready, add the variable `CWS_AUTO_PUBLISH` with the apps to publish, separated by spaces.

## Privacy

Each app states what it stores and sends in its own `docs/privacy.md`:

- Rekord: `apps/rekord/docs/privacy.md`
- Klipkord: `apps/klipkord/docs/privacy.md`
- Motikord: `apps/motikord/docs/privacy.md`

## Licence

GNU AGPL-3.0 only. See `LICENSE` and `NOTICE`. Commits before this change were released under MIT and stay under MIT.

The app names and icons are trademarks and are not covered by the licence. Forks must rename and rebrand. See `TRADEMARKS.md`.
