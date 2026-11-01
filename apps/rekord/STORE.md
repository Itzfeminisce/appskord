# Rekord store notes
## Release steps
- Bump `version` in `apps/rekord/package.json`, merge to `main`, then tag from `main`: `git tag rekord@x.y.z && git push origin rekord@x.y.z`.
- CI runs the tests, builds, checks the tag matches the manifest version, and makes a GitHub release with the zip.
- Store upload is automatic once the Chrome Web Store secrets exist (`CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`, `CWS_EXTENSION_ID_REKORD`). Until then, download the zip from the release and upload it by hand.
- Dry run: tag `rekord@x.y.z-test` makes a prerelease and never uploads.
