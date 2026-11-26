# Privacy

MemeIT does not require a MemeIT account and does not collect telemetry. It does not read your conversations or clipboard history. Copying happens only when you request it.

The Popular memes tab downloads catalog metadata from Imgflip and Memegen and loads their image previews directly. Description matching over those catalog entries runs locally, including sentence-model inference. Release installers bundle the model: the app does not send these queries to an AI service or download model weights on first launch. Saving, copying, or editing a supported result downloads that selected media to your device. Caption text is rendered locally and is not sent to a captioning service. Copying a captioned meme automatically saves its PNG, captions, template source, and searchable description in Your memes on the device. It remains saved if the clipboard is temporarily unavailable. The browser preview keeps its own local copy in IndexedDB; clearing site data removes that preview library. Provider URLs, rights, and availability remain with their sources.

Optional KLIPY or full Imgflip searches send your query and configured app key directly from the desktop app to that provider. A random installation identifier is also sent to KLIPY as its customer_id parameter. KLIPY previews load from its CDN; this version does not retain its media in a local library. Provider keys are held only in memory until the app quits. They are never sent to the MemeIT website or committed to the repository.

Imported, created, and saved files, names, descriptions, tags, favorites, and recent-copy timestamps are stored in the app's per-user data directory. They are not uploaded by MemeIT. Uninstalling the app can leave this directory behind; remove it if you want to erase your library.

The download website contacts GitHub for public release metadata and loads credited Imgflip preview images. Vercel, GitHub, and media providers receive ordinary web request information under their own privacy policies. There are no analytics or tracking cookies added by MemeIT.
