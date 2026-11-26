MemeIT's first desktop preview: a Rust-powered picker for popular internet memes on macOS, Windows, and Linux.

Open the picker with **Cmd/Ctrl + Shift + M**, describe the reaction or search a familiar format, then copy it back into your conversation. The default catalog loads popular image formats from **Imgflip and Memegen** with descriptive metadata for recognizable reactions. Your own imports and favorites are also supported. MemeIT never reads your conversation or sends a message for you.

## Catalog and sharing status

- **Available without a provider key:** popular Imgflip and Memegen image formats. This is a broad classic catalog, not a claim to contain every meme on the internet. Online catalog/media loading requires network access.
- **Optional broader GIF/meme search:** KLIPY requires an API key; production access is subject to provider approval. No public production key is bundled. KLIPY results keep their source attribution and provider order in a separate view.
- **Optional Imgflip full database search:** requires a separate API Premium subscription and API key. It is not enabled by the free popular-formats endpoint.
- **Sharing:** Imgflip/Memegen images can be copied as media. Local imported GIFs can be copied as files where the receiving chat supports them. **KLIPY currently copies the provider link**; direct media-file retention/sharing is deferred pending the necessary provider approval.

No MemeIT account is required. Provider keys, subscriptions, quotas and terms are separate. Searches and media requests made to an online provider are visible to that provider. Imported local files remain on your device.

## Downloads

- **macOS:** choose `aarch64.dmg` for Apple Silicon or `x64.dmg` for Intel.
- **Windows:** use the `x64-setup.exe` installer, or the MSI package.
- **Linux x64:** choose AppImage or the Debian package. Builds use Ubuntu 22.04 and WebKitGTK 4.1 as a baseline; compatibility with every distribution is not guaranteed.

Verify downloads using the attached `SHA256SUMS.txt`.

## Preview limitations

These early builds are **not a signed, notarized production release**. macOS builds use an ad-hoc signature and are not notarized. Windows builds are unsigned. Your operating system may warn about or block installation. Review the source and release provenance before deciding whether to install.

Global shortcuts can be unavailable in some Linux Wayland sessions. Open the application or tray menu as a fallback. Image and GIF file paste support depends on the chat application; saving and attaching permitted files is the fallback. Mobile platforms are not included.

Classic-catalog search matches names and descriptive metadata. Optional broad search uses the selected provider's service. This preview does not claim unrestricted semantic understanding or universal internet coverage. Third-party meme artwork remains subject to its owners' rights and source terms; the software licence does not relicense it.

Please report compatibility problems with the OS version and receiving chat app in [GitHub Issues](https://github.com/ArneshBanerjee/memeIT/issues).

### Caption templates locally

Choose **Add text** on a static internet template, write and position your captions, then copy or save the finished PNG. The editor runs on your device without a caption-generation API. Animated GIF editing is not included.
