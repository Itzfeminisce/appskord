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

## Shared code

Every package ships as TypeScript source with no build step.

- `packages/config`: the shared tsconfig, `defineAppConfig()` for each app's `wxt.config.ts`, the manifest checks each app calls from its `wxt.config.test.ts`, and the test setup.
- `packages/llm`: the AI provider list, model lists, chat calls, error mapping and key detection behind the one provider and model picker every app uses.
- `packages/penv`: Connect Penv Cloud, the paste-a-key fallback and the key store in `chrome.storage.session`.
- `packages/platform`: the IndexedDB helper, typed runtime messages, optional host access inside a click, Google sign-in and the shared router setup.
- `packages/ui`: design tokens and shared components. Every string is a prop; each app sets its own accent.
- `packages/media`: video sources, frame cache and MP4/WebM writers for Klipkord and Motikord.
- `packages/scenes`: Motikord's scene templates and renderer, shared so Klipkord can draw Motikord's cards.
- `packages/brand`: the brand kit Klipkord and Motikord share on one computer.

## Releases

Each app ships on its own. Bump the app's `package.json` version and merge to `main`.
The Store workflow tests and builds that app, checks the zip has no manifest `key` and no `.pem`, tags `<app>@<version>`,
and makes a GitHub release with the zip. Merges that do not change a version publish nothing, since every upload starts a new store review.
It submits the zip to the Chrome Web Store only for apps listed in the repository variable `CWS_AUTO_PUBLISH`
(for example `rekord klipkord`). Leave an app out while its last version is still in review; upload its zip by hand instead.
An app's first upload is always by hand: add its private key as `key.pem` at the zip root so the store keeps the fixed id. Never commit the key.

A tag pushed by hand, `<app>@<version>`, still runs the Release workflow and uploads to the store.
A tag ending in `-test` is a dry run: a prerelease, no store upload. The Release workflow can also be run by hand with an app name to get the zip as an artifact.

### Store setup (once)

1. In Google Cloud Console, make a project and enable the Chrome Web Store API.
2. Set up the OAuth consent screen as External, add your email as a test user, then press Publish app so tokens do not expire after 7 days.
3. Make an OAuth client ID of type Web application, with redirect URI `https://developers.google.com/oauthplayground`.
4. In the OAuth 2.0 Playground, tick "Use your own OAuth credentials" and enter the client ID and secret.
5. Authorize the scope `https://www.googleapis.com/auth/chromewebstore`, then exchange the code for tokens.
6. In the Chrome Web Store dashboard, copy your publisher ID from Publisher, Settings.
7. In Penv Cloud, put `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN` and `CWS_PUBLISHER_ID` in the `store` environment of the project named in `.github/penv/.env.schema`. Mark it write-only, and give it a machine identity with an OIDC trust for issuer `https://token.actions.githubusercontent.com` and subject `repo:Itzfeminisce/appskord:environment:chrome-web-store`. No store key is kept in GitHub.
8. In this repo's Settings, Environments, make sure `chrome-web-store` has you as a required reviewer; every upload waits for your approval.
9. When ready, add the variable `CWS_AUTO_PUBLISH` with the apps to publish, separated by spaces.

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
