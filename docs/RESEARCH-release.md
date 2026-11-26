# Distribution and release research

Researched against official project documentation on 26 November 2026. These are design decisions and documented platform constraints, not evidence that an untested installer or paste target works.

## Recommendation

Use a public GitHub repository, native GitHub Actions runners, GitHub Releases for immutable versioned installers, and Vercel for a small public product/download website. Tauri 2 handles OS-native packaging around the Rust application and local web UI. Keeping website hosting separate from desktop binary distribution avoids serving large installers through a serverless function.

The product promise is quick access to recognizable **internet memes**, rather than a bundled original reaction pack. Release notes and website screenshots must reflect the real catalog. Default access uses popular Imgflip/Memegen formats with descriptive metadata; broad optional services have separate key, pricing and production-access requirements. A public binary must clearly distinguish its no-key popular catalog from any optional full-provider search that has not been configured.

### Cross-platform builds

Tauri's official Actions recipe supports macOS arm64/x64, Windows x64 and Linux x64/arm64. Native runners are preferable to manually configuring platform SDK cross-compilation. MemeIT's initial release matrix covers macOS arm64/x64, Windows x64 and Linux x64. ARM Linux can be added when it has a tested runtime support matrix. [Tauri GitHub pipeline](https://v2.tauri.app/distribute/pipelines/github/)

Windows NSIS provides a familiar setup executable; MSI can serve managed installation. ARM64 Windows is possible with an additional Rust target and Visual Studio ARM64 tools; the NSIS installer runs under x86 emulation while the app can be native ARM64. The normal WebView2 bootstrapper checks must remain enabled. [Windows packaging](https://v2.tauri.app/distribute/windows-installer/)

Linux AppImages reduce packaging friction, but do not guarantee compatibility with every distribution: glibc and WebKitGTK impose a baseline. Tauri recommends building on the oldest supported system offering WebKitGTK 4.1; Ubuntu 22.04 and Debian 12 are examples. ARM AppImage tooling does not support ordinary cross-compilation, making native ARM runners useful later. [AppImage guide](https://v2.tauri.app/distribute/appimage/)

### Signing and trust

macOS ad-hoc signatures are useful for Apple Silicon downloads but do not prevent installation approval prompts. A paid Apple Developer identity and notarization are required for the intended trusted distribution path. Free developer identities cannot notarize. [macOS signing](https://v2.tauri.app/distribute/sign/macos/)

Windows signing is distinct from SmartScreen reputation. Unknown unsigned applications can be blocked by Smart App Control. New signed binaries can still show reputation warnings, and EV certificates no longer receive immediate SmartScreen reputation. Marketing must not promise frictionless installation for unsigned previews. [Windows signing](https://v2.tauri.app/distribute/sign/windows/)

Tauri's updater requires a signature that cannot be disabled. The updater private key stays in CI secrets, while the app contains the public key. The initial MemeIT release links to releases and does not pretend to have configured automatic updating. [Updater documentation](https://v2.tauri.app/plugin/updater/)

### Release integrity

Build into a draft release; publish only after the full matrix succeeds and expected assets/checksums exist. This is also compatible with GitHub immutable releases, which prevent asset and tag modification after publishing. A failed target leaves the previous public release intact. [GitHub release management](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)

Use least-privilege workflow tokens, committed lockfiles and verified pinned action commits. GitHub's current secure-use guidance also describes workflow dependency lockfiles. Artifact attestations can be added to establish build provenance; they supplement rather than replace OS code signing. [Workflow security](https://docs.github.com/en/actions/reference/security/secure-use), [artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations)

### A download page that stays accurate

The GitHub latest-release endpoint excludes drafts and prereleases. The website therefore falls back to published previews if no stable release exists. It maps the returned `browser_download_url`, file name, size and digest to platform choices rather than predicting links for hypothetical installers. It keeps a Releases link when the repository has no binaries or the API is unavailable. [Releases REST API](https://docs.github.com/en/rest/releases/releases#get-the-latest-release)

GitHub unauthenticated REST requests have a shared source-IP limit of 60 per hour. A cached server-side metadata endpoint reduces upstream calls and can use a server-only read credential if necessary. Vercel supports CDN caching using `s-maxage` and stale revalidation. Do not proxy binary downloads through this route. [GitHub limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api), [Vercel caching](https://vercel.com/docs/caching/cache-control-headers)

Vercel connects the website subdirectory to a project with `main` as production branch and PR previews for review. Root Directory is a project setting; a file named `vercel.json` alone does not set the remote monorepo root. [Vercel Git integration](https://vercel.com/docs/git), [monorepo setup](https://vercel.com/docs/monorepos)

The landing page uses recognizable images returned by Imgflip's public catalog, rather than illustrative substitutes. Its three-format sample demonstrates name/description matching and links to the selected source image. Imgflip requires a backlink when embedding its hosted images; the page includes visible Imgflip attribution and allows its image host through CSP. Images remain externally hosted and are not represented as assets under the repository's software licence. [Imgflip hotlinking terms](https://imgflip.com/terms)

## Naming

Keep **MemeIT** for the initial release: it clearly describes the small utility and avoids introducing a naming migration while the clipboard experience is still being tested. MemeTap and QuipDrop are alternatives, but domain, repository, app-store and trademark availability have not been checked.

## Release acceptance

A compiled matrix and a deployed site establish build/distribution plumbing. They do not establish runtime support for every desktop, compositor, chat app, provider or media type. Before widening support claims, download the public artifacts and test shortcut invocation, real internet-catalog retrieval, descriptive search, missing-key/quota states, import, favorites, static-image paste, animated-file paste and attachment fallback on each intended combination. Record exactly which combinations passed. Confirm provider approval and delivery requirements before enabling a broad GIF service in a public release.
