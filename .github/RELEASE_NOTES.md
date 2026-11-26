MemeIT's first desktop preview: a Rust-powered local meme picker for macOS, Windows, and Linux.

Open the picker with **Cmd/Ctrl + Shift + M**, search titles, descriptions and tags, then copy a reaction back into your conversation. The app includes original starter reactions and supports your own imports and favorites. It never sends a message for you.

## Downloads

- **macOS:** choose `aarch64.dmg` for Apple Silicon or `x64.dmg` for Intel.
- **Windows:** use the `x64-setup.exe` installer, or the MSI package.
- **Linux x64:** choose AppImage or the Debian package. Builds use Ubuntu 22.04 and WebKitGTK 4.1 as a baseline; compatibility with every distribution is not guaranteed.

Verify downloads using the attached `SHA256SUMS.txt`.

## Preview limitations

These early builds are **not a signed, notarized production release**. macOS builds use an ad-hoc signature and are not notarized. Windows builds are unsigned. Your operating system may warn about or block installation. Review the source and release provenance before deciding whether to install.

Global shortcuts can be unavailable in some Linux Wayland sessions. Open the application or tray menu as a fallback. Image and GIF file paste support depends on the chat application; saving and attaching the file is the fallback. Mobile platforms are not included.

Search is local description/tag matching, not a cloud AI search service. No account is required and the app does not read your conversations.

Please report compatibility problems with the OS version and receiving chat app in [GitHub Issues](https://github.com/ArneshBanerjee/memeIT/issues).
