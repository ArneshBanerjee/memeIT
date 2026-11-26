# Content sources and natural-language search

Research checked on **November 26, 2026**. This document separates verified
provider requirements, engineering recommendations, and what the first release
actually implements. Provider policies can change; recheck before integrating.

## Decision for the first release

Open directly into **real internet meme discovery** using Imgflip and Memegen's
public catalogs. The checked responses contained **100 Imgflip entries and 209
Memegen entries**; the same format can occur in both sources. Selected verified
classics may supplement the changing popular list. These are recognizable meme
formats such as This Is Fine, Distracted Boyfriend, Drake, and Surprised Pikachu,
not a claim to cover every internet meme. Catalog entries are labeled as
templates; they are not a feed of every captioned post.

Search their names, visual descriptions, intent descriptions, and tags in Rust.
[`../assets/internet-metadata.json`](../assets/internet-metadata.json) contains
311 original annotations keyed by exact `{source, id}`: the 309 observed provider
entries and two independently verified Imgflip classics. Each record contains
`source`, `id`, `description`, and `tags`; it contains no copied artwork. Visual
queries such as "dog in a burning room" and "man distracted by another woman"
can match without knowing the meme's name.

The matching engine uses token normalization, weighted phrase and keyword
matches, reaction synonyms, and limited handling of negated emotion words.
This is **description search**, not general AI vision or embedding search. It
cannot infer the contents of an arbitrary imported image or understand every
possible sentence. A local imported library remains available separately.

Optional authenticated providers expand coverage: **Imgflip API Premium**
searches its full template database; **KLIPY** searches GIFs and captioned memes
in separate source views. The latter preserves provider ranking and uses
**Copy link**, without downloading or persisting provider media. Credentials
are supplied explicitly, kept for the session, and never published in the OSS
repository. A broad out-of-box KLIPY experience needs a developer-owned,
approved production integration.

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

Implementation boundary: separate optional provider views make direct client
requests with the user's configured app key. Preserve the response order and
original delivery URLs. Do not use a Vercel proxy or merge results into a local
index. Copy links only; temporary media files for native copying or drag-out
require clarification and approval of that integration with KLIPY first.

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

### Imgflip: popular formats now, full template search with credentials

`GET https://api.imgflip.com/get_memes` is documented with an unauthenticated
example and returns popular user-uploaded templates, approximately 100 at the
time of documentation. It supports an image/GIF type parameter. More extensive
search and animated captioning are premium features; authenticated endpoints
use bearer keys. Template content can change or disappear. The service is
designed around captioning templates, not finding a ready-made reaction for
every conversation.

Hotlinked images require a link to Imgflip or the corresponding image page.
Keep a visible source link and do not represent this catalog as CC0 artwork.
The public catalog works without a key; full search is an explicit paid API
option with a session-scoped key. Label both as templates. Do not publish the
bearer key or perform paid generation silently.

Sources: [Imgflip API](https://imgflip.com/api),
[Imgflip terms](https://imgflip.com/terms).

### Memegen: a second public catalog of established meme formats

The documented `GET https://api.memegen.link/templates` endpoint provides IDs,
names, aliases/keywords, blank image URLs, provider example URLs, and source
links. The checked response had 209 entries. The service supports PNG, JPEG,
GIF, and WebP generation; animation depends on the chosen background/format.
MemeIT uses the public catalog and its image URLs, with visible source labels.
Its source code is MIT-licensed, which should not be represented as a new
blanket copyright license for every underlying photo or film still. Keep
provider imagery separate from the application's software and icon licenses.

Sources: [Memegen API catalog](https://api.memegen.link/templates),
[official project documentation](https://github.com/jacebrowning/memegen),
[software license](https://github.com/jacebrowning/memegen/blob/main/LICENSE.txt).

Additional verified format references:
[Math Lady / Confused Lady, Imgflip ID 80996545](https://imgflip.com/memetemplate/80996545/Math-ladyConfused-lady),
[Success Kid, Imgflip ID 61544](https://imgflip.com/memetemplate/Success-Kid).
Their inclusion in the annotation file does not imply that a provider's
changing popular feed currently returns them.

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

- Open with public meme catalogs without requiring provider account setup.
  Cache supported catalog metadata for repeat launches and explain when
  internet access is still needed to load the actual media.
- Keep keyboard focus in search, support predictable result navigation, and
  confirm whether the action copied an image, a file, or a link.
- Preserve original animation when sharing a GIF. A static clipboard bitmap
  is not equivalent to an animated GIF attachment.
- Cancel stale searches, debounce remote requests, and show quota/network
  failures without erasing the imported local library.
- Keep favorites and recents local, and store provider references only when
  the provider's policy permits it. Never assume an online favorite grants
  permission to archive the underlying media.
- Keep software licensing, app-icon licensing, imported-file ownership,
  and provider-content terms separate.

The application icon's CC0 dedication applies to the icon, not to internet
meme images. Future embedding and image-recognition capabilities described in
this document should not be inferred to be shipped. Credential-gated providers
must remain clearly marked as requiring configuration; compiled support is not
evidence that a provider-approved production key has been obtained.
