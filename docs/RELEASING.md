# Releasing MemeIT

MemeIT source and installers live in [ArneshBanerjee/memeIT](https://github.com/ArneshBanerjee/memeIT). The public website is the buildless `website/` application on Vercel; installer binaries remain on GitHub Releases.

## Current release contract

The automated release is an **early preview**, not a claim of production certification. It builds:

| Platform | Architecture | Files |
| --- | --- | --- |
| macOS | Apple Silicon / arm64 | `.dmg` |
| macOS | Intel / x64 | `.dmg` |
| Windows | x64 | NSIS `-setup.exe`, `.msi` |
| Linux | x64 | `.AppImage`, `.deb` |

Linux uses Ubuntu 22.04 as the build baseline with WebKitGTK 4.1. ARM Linux and Windows, mobile platforms, and older distributions are not currently release targets.

macOS previews are ad-hoc signed and are **not notarized**. Windows previews are **unsigned**. Operating systems may warn about or block these builds. Do not describe them as signed, trusted production downloads. The workflow deliberately publishes prereleases, including `v0.1.0`.

## Catalog access contract

The product searches **popular internet memes**, not an original replacement sticker pack. Its default image catalog loads popular formats from Imgflip and Memegen and adds descriptive search metadata for recognizable reactions. This catalog is available without a provider key, but loading online catalogs and media requires network access. Imported local files remain a secondary source.

Broader KLIPY GIF and meme search requires a configured API key. A test key is restricted to development limits; production access requires provider approval. Imgflip full-database search is a separate optional service requiring an API Premium subscription and key. Neither service is represented as preconfigured in the public app. Do not describe the top/popular catalogs as the full internet or promise that literally every meme is available.

Provider content keeps its source attribution and follows provider delivery, ordering and caching rules. KLIPY results must remain separate from other providers, preserving the returned order. KLIPY sharing currently copies the provider link. Direct file retention/sharing is deferred pending provider authorization; an automatic downloader or durable local mirror is not part of the standard integration. Imgflip/Memegen images and local imported GIFs can use the app’s media/file-copy paths. Secrets must never be committed to the public repository.

## Publish a preview

1. Update the version in `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, and the root `package.json` together. Update lockfiles with the appropriate package manager. Keep `.github/RELEASE_NOTES.md` accurate for that release.
2. Run `npm ci`, `npm run build`, `npm test --prefix website`, `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`, and `cargo test --manifest-path src-tauri/Cargo.toml --locked`.
3. Commit the changes to `main`; confirm the Check workflow passes on Windows, macOS, and Linux.
4. Create and push the matching annotated version tag, for example `git tag -a v0.1.0 -m 'MemeIT 0.1.0 preview'` followed by `git push origin v0.1.0`.
5. Follow the **Release desktop builds** workflow. It validates version agreement, creates a draft, builds each platform, checks that all expected installers exist, uploads `SHA256SUMS.txt`, and only then publishes the preview.
6. Verify the public release and website download links. Smoke-test the *downloaded* packages on each target OS with the compatibility checklist below. A CI compilation pass is not a substitute for these tests.

If any target fails, the release remains a draft and is not presented as a downloadable public release. Fix the cause, then rerun the failed jobs. The prepare step refuses to modify an already published release. For a changed source tree, bump the version and use a new tag instead of moving a published tag.

`workflow_dispatch` supports reruns when the selected ref is a version tag; running it against `main` intentionally does not publish.

## Installer checks

- Install and launch from a downloaded file on a clean target OS.
- Without provider keys, verify live Imgflip/Memegen popular formats load and recognizable names/descriptions find real internet memes. Confirm source attribution and links are visible.
- Test provider failure and offline states: no fake or custom fallback content should masquerade as internet search results. Imported local media should remain accessible offline.
- With separately configured provider credentials, test broad image/GIF search, authentication errors, quota errors and missing-key setup. Validate KLIPY attribution, result order, separated presentation, and the approved media-delivery behavior before enabling production access.
- Invoke Cmd/Ctrl + Shift + M from another app. If a Linux compositor blocks the shortcut, confirm opening via app or tray still works.
- Import PNG/JPEG/GIF, search its description/tags, add a favorite, restart, and confirm persistence.
- Copy a static image into a compatible chat app; confirm it is an image, not a local path.
- Copy an imported animated GIF file, paste into supported chat apps, and confirm animation survives. Record unsupported applications and verify save/attach fallback. Confirm KLIPY results copy a provider link without downloading or retaining the media file.
- Confirm selecting a reaction never sends a message automatically.
- Confirm Escape dismisses the picker and the normal close/tray/quit behavior is understandable.

Record the OS, version, architecture, chat app and version, session type (X11/Wayland), test date and observed behavior. Do not claim an untested combination is verified.

## Production signing and updates

For macOS distribution without the ad-hoc warning, provision a paid Apple Developer account, Developer ID Application certificate, certificate password, and notarization credentials. Replace `APPLE_SIGNING_IDENTITY: '-'` with the real identity, provide certificate/notarization secrets to `tauri-action`, and verify signing, notarization and stapling on the resulting DMG. See [Tauri's macOS signing guide](https://v2.tauri.app/distribute/sign/macos/).

For Windows, provision an appropriate code-signing service/certificate and configure the bundle signing command. A signed new binary may still receive a SmartScreen reputation warning; signing does not guarantee warning-free installation. See [Tauri's Windows signing guide](https://v2.tauri.app/distribute/sign/windows/).

Automatic updating is not enabled in the initial pipeline. Add it only after generating and safeguarding a dedicated updater private key, embedding its public key, and publishing valid signed updater artifacts. OS signing and updater signing are separate. Never commit private keys, certificates, API secrets or credentials. See [Tauri updater signing](https://v2.tauri.app/plugin/updater/).

When promoting a future version to stable, update the workflow's preview title/notes, `--prerelease` settings and latest-release behavior together after the release passes its agreed validation. Do not relabel the first preview as stable merely to make a download button work.

## Vercel website

Import the GitHub repository into Vercel and set the project **Root Directory to `website`**. Choose the Other framework preset. The website has no build step, no runtime package dependencies and no generated build directory; Vercel serves the static files plus `api/releases.js`. Keep `main` as the production branch.

The endpoint reads published GitHub release metadata, preferring stable and falling back to a preview when there is no stable release. It exposes only recognized, nonempty installer assets uploaded to this repository. No release, missing platform, and upstream error states keep their GitHub fallback links and never synthesize a download URL.

Optional Vercel environment variable: `GITHUB_TOKEN`, a read-only credential with access to public release metadata. It is only read by the serverless function, never sent to the browser. Unauthenticated GitHub API access is limited to 60 requests per hour per source IP. Successful responses are CDN cached for five minutes with stale revalidation; failed lookups are not cached as empty releases.

Test the endpoint with `npm test --prefix website`. A plain local static server can preview the layout, but cannot run Vercel functions; in that case the site correctly displays its GitHub fallback. Use `vercel dev` or an actual deployment to test the live release endpoint. Use `vercel --prod` or the connected production branch to publish after checking the selected account and project.

The website sets a restrictive Content Security Policy and does not add trackers, remote fonts, or third-party scripts. Its hero displays three authentic popular meme images loaded directly from `i.imgflip.com` and provides an Imgflip hyperlink as required by the provider's [hotlinking terms](https://imgflip.com/terms). Those image requests contact Imgflip. The small interactive website demo searches only its three labelled sample formats; it is not the full application catalog. The source code licence does not relicense third-party meme artwork. Keep both the privacy and catalog descriptions accurate as providers change.


## Bundled semantic search

Release packaging runs `npm run model:prepare` before building the frontend. The script downloads a fixed MiniLM revision, verifies sizes and SHA-256 hashes, and bundles weights, tokenizer, configuration, model card, and Apache-2.0 license under `models/minilm/`. This directory is ignored by Git and separate from Vite public assets to avoid embedding the weights twice. `models/README.md` preserves the resource directory in a fresh checkout.

When changing descriptions, regenerate the small committed index with:

```sh
npm run model:prepare
cargo test --release --manifest-path src-tauri/Cargo.toml generate_catalog_index -- --ignored --nocapture
cargo test --release --manifest-path src-tauri/Cargo.toml actual_model_generalizes_descriptions -- --ignored --nocapture
```

Keep the model revision and checksums aligned between the download script and Rust loader. No model download or remote inference occurs during normal app use. Missing resources produce an explicit lexical fallback notice.
