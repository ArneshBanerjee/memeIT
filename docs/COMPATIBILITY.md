# Compatibility test checklist

Compilation is checked by CI; the following are manual acceptance tests. An unchecked cell means **not verified**, not “supported.” Do not send messages to anyone as part of testing without their authorization; use a private self-test chat or unsent composer.

| Target | PNG image paste | GIF file paste | Animation retained | Return to composer | Keyboard flow |
| --- | --- | --- | --- | --- | --- |
| macOS / Messages | Pending | Pending | Pending | Pending | Pending |
| macOS / Discord | Pending | Pending | Pending | Pending | Pending |
| Windows / Discord | Pending | Pending | Pending | Pending | Pending |
| Windows / Slack | Pending | Pending | Pending | Pending | Pending |
| Linux X11 / Telegram | Pending | Pending | Pending | Pending | Pending |
| Linux Wayland / Telegram | Pending | Pending | Pending | Pending | Pending |
| WhatsApp desktop/web | Pending | Pending | Pending | Pending | Pending |
| Browser chat inputs | Pending | Pending | Pending | Pending | Pending |

For each result record OS/compositor, chat version, app version, date, and whether attachment fallback succeeds. Include image dimensions and file size for failures. Test offline startup, no-results searches, import cancellation, invalid media, duplicate imports, occupied hotkey, clipboard failure, and restart persistence.

macOS and Windows install warnings remain expected for initial builds without trusted publisher signing. Linux global shortcuts use X11; native Wayland behavior must be verified independently with the user's compositor and any configured desktop shortcut.
