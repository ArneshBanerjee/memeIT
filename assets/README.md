# MemeIT Originals

18 original reaction cards: 14 PNG images and four looping GIFs, all 480 × 360.
The pack works offline. The drawings and captions are created by
[`../scripts/generate-assets.py`](../scripts/generate-assets.py), not copied from
existing meme artwork. `icon.png` is an original 1024 × 1024 app icon.

To the extent possible under law, the authors dedicate the original drawings,
captions, descriptions, tags, icon, and catalog in this directory to the public
domain under **CC0 1.0 Universal**. See [LICENSE](LICENSE). No trademark rights in
the MemeIT name are asserted or granted by that dedication.

`catalog.json` is the shared metadata source. Each entry contains `id`, `title`,
`description`, `tags`, `filename`, and `kind`. `filename` is relative to this
directory; `kind` is `png` or `gif`. Descriptions explicitly describe reactions
and useful conversational situations. They are authored metadata, not automatic
image recognition.

`provenance.json` records generation method, dimensions, animation frame counts,
and SHA-256 hashes. This license covers these bundled originals; it does not
relicense anything users import or anything fetched from a content provider.

Regenerate with Python and Pillow 10 or newer:

```sh
python -m venv /tmp/memeit-assets-venv
/tmp/memeit-assets-venv/bin/pip install Pillow
/tmp/memeit-assets-venv/bin/python scripts/generate-assets.py
```

Run the last command from the repository root. Pillow's built-in font is
rasterized into the cards; no external font files or artwork are bundled.
