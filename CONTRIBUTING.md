# Contributing

MemeIT is intentionally small: find a reaction, copy it, get back to the conversation.

Use the setup commands in the README. Keep native operations in Rust and the interface independent of network services. For changes affecting library persistence, media validation, ranking, clipboard behavior, or release asset selection, include focused regression tests. UI-only edits should include a useful screenshot and keyboard check.

Run `npm run build`, `cargo fmt --manifest-path src-tauri/Cargo.toml --check`, and `cargo test --manifest-path src-tauri/Cargo.toml` before submitting a pull request. Native system dependencies are required on Linux.

Do not add scraped content, credentials, analytics, chat monitoring, or provider integrations that assume permission to cache or redistribute content. Starter assets require explicit provenance and a redistribution-compatible license.

Describe the user-visible problem and result in each PR, plus what you tested. Distinguish an OS compilation check from an actual chat-app paste test.
