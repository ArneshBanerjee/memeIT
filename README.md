# MemeIT

**Find the reaction. Keep the conversation going.**

A small, local-first desktop meme picker for **Windows, macOS, and Linux**. Press `Cmd/Ctrl + Shift + M`, describe a reaction, choose a GIF or image, and press Enter to copy it. Paste into your conversation when you're ready.

MemeIT is an early **0.1.0 preview**, with a Rust application core and a lightweight TypeScript interface inside Tauri 2. It is not an Electron app. It does not read chats, monitor clipboard history, inject keystrokes, or send messages for you.

## Download

Get available installers from [GitHub Releases](https://github.com/ArneshBanerjee/memeIT/releases). The website displays only binaries actually attached to a published release. Preview builds are labelled.

Initial builds are not notarized by Apple or signed with a Windows publisher certificate. Operating systems can warn about or block them. Source builds are available; trusted signing is a prerequisite for a broader consumer launch.

## What works

- A resident picker with a global shortcut, system tray, and single-instance behavior.
- An original, redistributable starter collection of PNG reactions and animated GIFs.
- Native import of your own PNG, JPEG, WebP, and GIF files into a private local library.
- Description search using titles, captions/descriptions, tags, phrase matching, and reaction synonyms in Rust.
- Favorites and recently copied reactions, saved locally.
- Image clipboard copying for still images; original-file clipboard copying for GIFs.
- Native Save file fallback when a chat does not accept pasted files.
- Keyboard navigation, editable descriptions, and a configurable shortcut.

**Search is an explicit baseline:** it uses local text and intent aliases, not a downloaded language model, automatic image recognition, or a comprehensive internet meme index. Add useful descriptions to imported memes. For example, describe a reaction as “pretending everything is fine while work falls apart” and add tags such as `chaos`, `denial`, and `work`.

## The sharing flow

1. Open the picker with `Cmd/Ctrl + Shift + M` or its tray/launcher entry.
2. Describe the moment or enter a category. Use arrows to select a reaction.
3. Press Enter. The picker copies the selection and can hide itself.
4. Return to your chat and paste. If GIF-file paste is unsupported, save the file and attach it.

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

Install [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/), a current stable Rust toolchain, and Node.js 22 or later.

```sh
npm ci
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

The app's per-user data directory contains the library metadata and imported media. Files stay local. Keep backups of your originals. Media imports are bounded and validated; native file pickers choose paths rather than unrestricted webview filesystem access.

## Repository

- `src-tauri/`: Rust search, library, clipboard, desktop integrations, packaging.
- `src/`: compact accessible picker UI.
- `assets/`: original starter art, captions, and provenance.
- `website/`: Vercel landing page and GitHub release metadata endpoint.
- `.github/workflows/`: checks and native-platform release builds.
- `docs/`: research, release procedure, and compatibility checklist.

## Why no Tenor or bundled API secret?

Tenor's third-party API ended on June 30, 2026. GIPHY and KLIPY require credentials and impose rules on caching, ordering, attribution, and combining results. A general online catalog needs an approved provider integration; a secret embedded in a public desktop application is not secret. The first release works without those services. See [the research](docs/RESEARCH.md) for the architecture and tradeoffs.

## Contribute

See [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports should include app version, operating system, X11/Wayland if relevant, and destination chat application. Never include private chats, credentials, or personal meme-library files without checking them first.

Software: [MIT](LICENSE). Original starter assets: [CC0](assets/LICENSE). User-imported and third-party media retain their own rights.
