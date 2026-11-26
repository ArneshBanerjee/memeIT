# Local search model

Run `npm run model:prepare` to fetch the pinned, checksum-verified MiniLM weights into `minilm/`. Desktop release packaging runs this automatically. Weights are generated build inputs and are not committed to Git; the app bundles them for offline inference.

The download script records upstream provenance, hashes, model card, and Apache-2.0 license. See `scripts/prepare-semantic-model.mjs` and `src-tauri/src/semantic.rs`.
