# Content sources and natural-language search

Research checked on **November 26, 2026**. This document separates verified
provider requirements, engineering recommendations, and what the first release
actually implements. Provider policies can change; recheck before integrating.

## Decision for the first release

Ship a useful offline experience: 18 original, CC0 reaction images/GIFs plus the
user's imported library. Search authored descriptions, titles, and tags using
Rust text normalization, token matching, and a bounded synonym vocabulary. Call
this **description search**, not general AI vision or embedding search. It can
match a conversational situation when that intent is represented in the
metadata; it cannot understand every sentence or infer an imported image's
meaning from pixels.

Provide optional, explicitly labeled **Imgflip templates** independently of the
personal library. Templates are blank captioning inputs, not finished reaction
memes. Keep the main workflow useful without a key, account, or network.

There is no verified unrestricted, reliable, no-key API for a comprehensive
finished-meme catalog in the sources investigated. An unauthenticated endpoint
or public image URL does not itself grant rights to redistribute a dataset.
Do not scrape a catalog and label its media as MIT-licensed app assets.

## Provider comparison

### Tenor: unavailable for a new integration

Google's official notice says new API key sign-ups/integrations stopped on
January 13, 2026; third-party API integrations were fully decommissioned on
June 30, 2026. Tenor remaining available in some Google products does not mean
its public developer API is available. Do not use old Tenor tutorials as a
launch plan.

Source: [Google Tenor sunset notice](https://support.google.com/tenor/answer/10455265).

### KLIPY: strongest prospective online provider, requires onboarding

KLIPY has GIF and static-meme search. Testing keys are limited to 100 requests
per hour; production access requires a request through its Partner Panel.
Its terms prohibit storing content except search thumbnails and combining its
search results with other sources without written consent. Its integration
guidance requires direct delivery, unchanged URLs, and preserved result order;
custom proxy/cache integrations require prior approval. Attribution and
available creator/source details must be displayed.

Recommendation: evaluate KLIPY for a later, separate provider tab with approved
production access. Do not put its responses through a Vercel proxy, merge them
into a local index, or rerank the result grid under the default agreement.
Clarify permitted temporary-file handling for native clipboard and drag-out
before promising downloaded GIF sharing.

Sources: [KLIPY documentation](https://docs.klipy.com/),
[API terms](https://klipy.com/support/api-terms),
[Meme API overview](https://klipy.com/support/meme-api).

### GIPHY: mature search with important integration constraints

GIPHY documents a 100-request/hour beta limit. Production access requires an
application and a pricing discussion. Its branding must appear where its API
is used. Its published practices prohibit proxying API/media requests,
caching responses/URLs/assets, reordering or filtering returned results, and
mixing other providers in the same grid. Direct client requests are required.

Recommendation: an optional standalone provider experience is plausible after
onboarding. It is unsuitable for a server-side search proxy or an unrestricted
local embedding index of its results. Tiny preview renditions reduce bandwidth;
the chosen share rendition should retain animation and meet the destination's
file-size limits. Temporary files for clipboard export also need policy review.

Sources: [GIPHY developer docs](https://developers.giphy.com/docs/),
[GIPHY developer FAQ](https://developers.giphy.com/faq).

### Imgflip: useful templates, different from finished-meme retrieval

`GET https://api.imgflip.com/get_memes` is documented with an unauthenticated
example and returns popular user-uploaded templates, approximately 100 at the
time of documentation. It supports an image/GIF type parameter. More extensive
search and animated captioning are premium features; authenticated endpoints
use bearer keys. Template content can change or disappear. The service is
designed around captioning templates, not finding a ready-made reaction for
every conversation.

Hotlinked images require a link to Imgflip or the corresponding image page.
Keep a visible source link and do not represent this catalog as CC0 artwork.
Do not expose an authenticated creator's bearer key in an OSS repository or
ship paid generation silently. The initial integration should label results
as templates and remain optional.

Sources: [Imgflip API](https://imgflip.com/api),
[Imgflip terms](https://imgflip.com/terms).

### Wikimedia Commons: licensed media, not a reaction-meme replacement

Commons files can be reused according to each file's license. Some require
creator credit, a license link, or ShareAlike for derivatives; verify provenance
per file. The Action API's `imageinfo` module exposes media URLs and metadata;
its `extmetadata` property is expensive and should be requested sparingly.
Commons is useful for a deliberately curated open pack, but its general-purpose
catalog is not a substitute for reaction GIF search.

Sources: [Commons reuse guidance](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia/en),
[MediaWiki Imageinfo API](https://www.mediawiki.org/wiki/API:Imageinfo).

## Making descriptive search work

### Baseline: honest, small, immediate

Index `title + description + tags`, preserving the user's editable metadata.
Normalize case and punctuation, tokenize, ignore only genuinely unhelpful
filler, weight titles and exact phrases above loose description matches, and
expand a curated reaction vocabulary. Examples include `exhausted → tired`,
`uncomfortable → awkward`, and `congratulations → celebration`.

Avoid broad expansions that erase negation or invert intent. "Not happy" must
not confidently become a celebration. Filename matching is a useful fallback
for imported files, but cannot replace descriptions. Preserve manually entered
metadata and let people improve it once instead of repeatedly searching badly.

A first-release evaluation set should include exact names, single emotions,
situational descriptions, synonyms, unrelated queries, and negated phrases.
Check whether the desired result appears near the top and whether empty states
are honest. Do not advertise universal natural-language understanding from a
small hand-built synonym table.

### Next step: local hybrid semantic search

SQLite FTS5 offers Unicode tokenization, BM25 weighting, English stemming, and
trigram substring search. It is a sensible exact-match component as the library
grows. A text embedding component can complement it for paraphrased situations.
Use a documented hybrid score or reciprocal-rank fusion; evaluate actual meme
queries before selecting weights.

Source: [SQLite FTS5](https://www.sqlite.org/fts5.html).

`sentence-transformers/all-MiniLM-L6-v2` is Apache-2.0, English-focused, maps text
to 384-dimensional vectors, and truncates beyond 256 wordpieces. It is suitable
to evaluate for short local descriptions. It does not read image pixels.
Multilingual needs require testing a multilingual model rather than assuming
English embeddings understand every language.

Source: [MiniLM model card](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2).

Rust's FastEmbed supports local text embeddings, multilingual models, and
compatible CLIP image/text encoders. It uses ONNX Runtime through `ort`; this
adds native runtime and model packaging work. A Rust application can use such
dependencies, but should not claim its entire dependency stack is pure Rust.
Pin the model revision and checksum, show download progress, handle offline
startup, and keep the picker responsive while background indexing runs.

Source: [FastEmbed Rust repository](https://github.com/Anush008/fastembed-rs).

For automatic import labeling, OCR and image embeddings can help with visible
text and scene similarity. They do not reliably recover sarcasm, the cultural
meaning of a meme, or its intended conversational use. Rich, editable intent
descriptions remain valuable. Any external captioning service should be an
explicit choice because imported images may be private.

### Online natural-language queries

Local query cleanup can shorten a description before sending it to a provider,
but results must follow that provider's ordering/attribution requirements.
Do not silently send conversation history: the text typed into the picker is
enough. Query rewriting, provider request, and any later personal-library
ranking should be distinct components so policies can be enforced correctly.

## Practical seamlessness requirements

- Open with the last useful view immediately; search must not wait for a model
  download or provider account setup.
- Keep keyboard focus in search, support predictable result navigation, and
  confirm whether the action copied an image, a file, or a link.
- Preserve original animation when sharing a GIF. A static clipboard bitmap
  is not equivalent to an animated GIF attachment.
- Cancel stale searches, debounce remote requests, and show quota/network
  failures without erasing the offline library.
- Keep favorites and recents local, and store provider references only when
  the provider's policy permits it. Never assume an online favorite grants
  permission to archive the underlying media.
- Keep software licensing, starter-art licensing, imported-file ownership,
  and provider-content terms separate.

The starter pack's source, catalog, CC0 dedication, and hash manifest live in
[`../assets/`](../assets/). None of the future embedding, vision, or approved
online-provider capabilities described here should be inferred to be shipped.
