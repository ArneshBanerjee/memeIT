# MemeIT

**Find the reaction. Keep the conversation going.**

A small desktop picker for real internet memes for **Windows, macOS, and Linux**. Press `Cmd/Ctrl + Shift + M`, describe a reaction, choose a GIF or image, and press Enter to copy it. Paste into your conversation when you're ready.

MemeIT is an early **0.1.2 preview**, with a Rust application core and a lightweight TypeScript interface inside Tauri 2. It is not an Electron app. It does not read chats, monitor clipboard history, inject keystrokes, or send messages for you.

## Download

Get available installers from the [MemeIT website](https://memeit-iota.vercel.app) or [GitHub Releases](https://github.com/ArneshBanerjee/memeIT/releases). The website displays only binaries actually attached to a published release. Preview builds are labelled.

Initial builds are not notarized by Apple or signed with a Windows publisher certificate. Operating systems can warn about or block them. Source builds are available; trusted signing is a prerequisite for a broader consumer launch.

## What works

- A resident picker with a global shortcut, system tray, and single-instance behavior.
- A live popular-format browser backed by Imgflip and Memegen, with recognizable internet memes.
- Optional KLIPY GIF/static-meme search and Imgflip full-catalog search with your provider key.
- Add your own text to supported static templates with an on-device live editor, draggable text layers, clipboard copying, and automatic storage in Your memes.
- Native import of your own static PNG, JPEG, WebP, and animated GIF files into a private local library.
- Description search combining a local sentence model with meme names, visual descriptions, slang, and typo-tolerant matching in Rust.
- Save supported online memes to a local library, with favorites and recent reactions.
- Image clipboard copying for still images; original-file clipboard copying for GIFs.
- Native Save file fallback when a chat does not accept pasted files.
- Keyboard navigation, editable descriptions, and a configurable shortcut.

**Describe what you remember:** the desktop app combines a bundled MiniLM sentence model with exact names, descriptive metadata, word forms, and typo tolerance. Queries such as “dog cooked,” “god eye closed,” or “brown dog accepting its fate in the sunlight” find Cooked Dog; “the guy looking back at other girl meme” finds Distracted Boyfriend. Matching runs on your device without an AI account or search API key. The model compares text descriptions; it does not recognize imported image contents automatically, so add descriptions to your own files. Search can retrieve only entries present in the selected catalog. Optional provider tabs use that provider’s search.

The desktop app uses the local language model for Popular memes and Your memes, including descriptions and captions on your creations. The browser preview uses a lighter descriptive matcher. Imported files can be named and described with **Name & describe**; their image contents are not automatically recognized.

## Internet catalog coverage

| Source | Available without a key? | Coverage and behavior |
| --- | --- | --- |
| Popular formats: Imgflip + Memegen | Yes | Live popular/classic formats plus verified internet reactions including 6–7 and contemporary slang formats, not every captioned meme variant. Feed contents and availability vary. |
| KLIPY GIFs / memes | No | Broad live reaction search with a testing/production app key. Separate provider results retain provider order. |
| Imgflip full catalog | No | Advertised 1M+ template catalog; requires API Premium and a bearer key. |
| Your memes | Yes | Saved supported memes and imported files, available offline. |

Use **Settings → Connect online catalogs** to enter your own key. Preview credentials remain in memory until the app quits and are sent only to the matching provider. Production onboarding and credentials are not included in this repository.

KLIPY currently supports **Copy link** only. Its default rules prohibit retaining media copies, so native file copying/saving for that provider awaits written approval. Supported Imgflip/Memegen images can be copied or saved directly; local GIFs retain their original files. No service is presented as containing literally every meme.

## The sharing flow

1. Open the picker with `Cmd/Ctrl + Shift + M` or its tray/launcher entry.
2. Describe the moment or enter a category. Use arrows to select a reaction.
3. Choose **Add text** to caption a static template, or press Enter to copy the original.
4. In the editor, drag captions into place, adjust styling, and choose **Copy meme**. The finished image is copied directly to your clipboard and automatically kept in **Your memes**. There is no file-save dialog. Captions render on-device; they are not sent to a captioning API.
5. Return to your chat and paste. Open **Your memes** later to copy any creation again. Use **Import memes** to bring your own PNG, JPEG, WebP, or animated GIF and optionally choose **Name & describe** to rename it. If GIF-file paste is unsupported, save the file and attach it.

Static image clipboard formats do not preserve animation. MemeIT therefore copies GIFs as original files. The destination app decides whether it accepts file pasting. Compatibility across Discord, Slack, Telegram, WhatsApp, Messages, browsers, and Linux compositors requires individual testing; a successful build does not establish that compatibility.

## Platform scope

| Platform | Distribution target | Important limits |
| --- | --- | --- |
| macOS | Apple Silicon and Intel | Early builds are ad-hoc signed, not notarized. |
| Windows | x64 installer | Requires WebView2; installer handles setup. Publisher signing is pending. |
| Linux | x64 AppImage and Debian package | Build baseline Ubuntu 22.04; WebKitGTK and system-library compatibility varies. |
| Linux Wayland | Same Linux binary | Global hotkey support varies; configure a desktop shortcut to launch MemeIT. Clipboard support depends on compositor/data-control support. |

Android/iOS and additional processor architectures are future work. Automatic paste and automatic sending are not part of this release.

## Develop

Install [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/), a current stable Rust toolchain, and Node.js 22.12 or later.

```sh
npm ci
npm run model:prepare
npm run tauri dev
```

Browser-only preview (native features show an explanatory message):

```sh
npm run dev
```

Checks and packaging:

```sh
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri build
```

Release packaging downloads a pinned, checksum-verified MiniLM model into ignored build resources and bundles it with the app. No model download is required after installation. See the model notices in `models/minilm/` after preparation.

The app's per-user data directory contains the library metadata and imported media. Imported/saved files stay local. Internet catalogs and previews contact their named providers. Keep backups of your originals. Media imports are bounded and validated; native file pickers choose paths rather than unrestricted webview filesystem access.

## Repository

- `src-tauri/`: Rust search, library, clipboard, desktop integrations, packaging.
- `src/`: compact accessible picker UI.
- `assets/`: internet-format search metadata and the app icon; no bundled custom meme pack.
- `website/`: Vercel landing page and GitHub release metadata endpoint.
- `.github/workflows/`: checks and native-platform release builds.
- `docs/`: research, release procedure, and compatibility checklist.

## Why no Tenor or bundled API secret?

Tenor's third-party API ended on June 30, 2026. GIPHY and KLIPY require credentials and impose rules on caching, ordering, attribution, and combining results. A general online catalog needs an approved provider integration; a secret embedded in a public desktop application is not secret. The popular-format browser works without a key. The optional full catalogs need provider credentials. See [the research](docs/RESEARCH.md) for the architecture and tradeoffs.

## Contribute

See [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports should include app version, operating system, X11/Wayland if relevant, and destination chat application. Never include private chats, credentials, or personal meme-library files without checking them first.

Software: [MIT](LICENSE). Original app icon: [CC0](assets/LICENSE). Internet memes and user-imported media retain their own rights; source links are shown in the app.
