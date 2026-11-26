# MemeIT: research and product decisions

Research checked November 26, 2026. Desktop scope: Windows, macOS, Linux; mobile deferred by the product owner.

## What makes this useful

The product is a resident reaction picker, not another messaging application. A useful path is shortcut → describe the situation → select → copy → return to the existing conversation. There should be no MemeIT login wall, conversation ingestion, forced cloud inference, or automatically sent message in that path. A provider key is currently needed for broad live search.

The biggest engineering risk is media transfer, not displaying a grid. Static clipboard image formats represent pixels. GIF animation requires preserving the original encoded file, and receiving applications disagree on accepting pasted files. Global hotkeys and foreground focus also vary by OS and compositor. These boundaries should be visible in product behavior and validation rather than hidden behind “works everywhere.”

## Chosen architecture

Use Tauri 2 with Rust for search, persistence, import validation, image decoding, clipboard ownership, and desktop integration. A small HTML/TypeScript interface handles accessible controls and GIF previews in the system webview. This is a Rust-powered application, not a claim that every dependency or UI line is Rust. Tauri's native packaging and existing integrations reduce the amount of OS-specific code needed. [Tauri architecture](https://v2.tauri.app/concept/architecture/)

Keep one serialized clipboard owner alive. Copy PNG/JPEG/WebP as image pixels and GIFs as original-file references. Always offer Save file. Opening the picker and copying should not require accessibility permissions or simulated keystrokes. [arboard clipboard formats and file lists](https://docs.rs/arboard/latest/arboard/struct.Set.html)

The first search implementation combines descriptions, titles, tags, phrases, and reaction aliases locally. It is useful for a captioned collection, but is not a substitute for general semantic inference. A follow-up should compare hybrid lexical/embedding ranking using a real evaluation set before introducing model downloads. MiniLM offers small English sentence embeddings; CLIP/OCR can assist imports but do not automatically understand a meme's social intent. [MiniLM model card](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2), [FastEmbed Rust](https://github.com/Anush008/fastembed-rs)

## Catalog strategy

Tenor is unavailable for a new product: its third-party API shut down June 30, 2026. [Google FAQ](https://support.google.com/tenor/answer/10455265)

KLIPY is a promising candidate for an approved GIF + meme catalog, but testing credentials, production approval, attribution, storage rules, and search-order requirements must be respected. GIPHY imposes similar restrictions, including prohibitions on proxying/caching and reranking. A Vercel proxy does not automatically make those integrations permissible. Provider results should have their own source-labelled surface and retain the provider's order. [KLIPY documentation](https://docs.klipy.com/), [KLIPY terms](https://klipy.com/support/api-terms), [GIPHY best practices](https://developers.giphy.com/docs/#best-practices)

Imgflip's free popular-template list exposes recognizable formats to caption, not a complete ready-to-send reaction catalog. Memegen adds classic formats through its public templates API. Both are labelled as formats; neither is presented as every captioned internet meme. [Imgflip API](https://imgflip.com/api)

This preview defaults to real internet formats loaded from Imgflip and Memegen. The checked catalogs expose 100 popular Imgflip entries and 209 Memegen formats, with overlap; they are not a comprehensive index. Authored visual/intent metadata makes recognized formats searchable by description. Separate optional KLIPY GIF/meme and Imgflip full-search tabs require keys. No production key or scraped archive is embedded. KLIPY shares links until retained-media/native-file handling is approved. To achieve frictionless broad online search, arrange approved production access.

## Distribution

Build desktop installers on native GitHub Actions runners, gather all assets into a draft release, and publish only after every required build succeeds. Keep binaries in GitHub Releases. The Vercel site discovers actual published assets and handles preview/no-release/API-failure states. [Tauri GitHub pipeline](https://v2.tauri.app/distribute/pipelines/github/), [GitHub Releases API](https://docs.github.com/en/rest/releases/releases)

A consumer launch needs macOS Developer ID signing/notarization and Windows publisher signing. Ad-hoc/unsigned preview builds are technically distributable but introduce installation friction. Secure auto-update signing is a separate prerequisite; do not ship an unsigned updater. [macOS signing](https://v2.tauri.app/distribute/sign/macos/), [Windows signing](https://v2.tauri.app/distribute/sign/windows/), [Tauri updater](https://v2.tauri.app/plugin/updater/)

## Follow-up gates

1. Verify static image paste and original GIF animation across target chat apps on each OS; record actual outcomes in the compatibility checklist.
2. Evaluate descriptive retrieval on at least 100 realistic prompts and imported memes. Compare lexical baseline against MiniLM hybrid search; include named memes, vague intent, negation, misspellings, and multilingual requests.
3. Obtain approved online-provider access and clarify file-transfer handling. Do not silently bypass quota or storage rules.
4. Provision release signing and notarization credentials before calling the product a frictionless consumer release.
5. Add local deletion/library management, cache budgets, and migration tests as collections grow; keep search latency observable without collecting private queries.

See the detailed [platform research](RESEARCH-platforms.md), [search research](RESEARCH-search.md), and [release research](RESEARCH-release.md).
