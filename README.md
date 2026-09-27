# @jimmy927/edge-tts

Text to speech with Microsoft Edge's online neural voices — the "Read aloud"
service Edge itself uses — over its WebSocket. No key, no account, nothing
installed. Streams MP3 as it is synthesised, with a timing for every word.

A TypeScript port of the Python [`edge-tts`](https://github.com/rany2/edge-tts)
package (7.x) by rany2 and contributors — the token, the escaping and chunking,
the SSML and the messages all follow it, and it is licensed the same way
(LGPL v3, see [License](#license)). Extracted from **prifly**'s desktop host,
where it reads answers aloud in en-GB-RyanNeural at +20 %.

**Bun only.** It uses `Bun.CryptoHasher` for the token and
`new WebSocket(url, { headers })`, which neither the browser's nor Node's
WebSocket accepts — and the service refuses a connection without Edge's
Origin and User-Agent.

## What is here

| file | |
|---|---|
| `constants.ts` | everything that rotates (client token, Edge version) and the fixed audio format |
| `protocol.ts` | the Sec-MS-GEC token, escaping, 4 KB chunking, SSML, audio and word-boundary frames, opening one connection |
| `speech-link.ts` | `SpeechLinks`: warm connections, owned and closed by the consumer |
| `synthesize.ts` | a whole text as one MP3 `ReadableStream`, sections apart by silence |

## Using it

```ts
import { SpeechLinks, synthesize } from "@jimmy927/edge-tts";

const links = new SpeechLinks({ log }); // one per process; nothing runs until used
links.warm();                           // e.g. when a pointer reaches a speaker button

const mp3 = synthesize("Title\fThe first paragraph.", {
  voice: "en-GB-RyanNeural", // default
  rate: "+20%",              // default
  links,                     // optional: without it each call opens and closes its own connection
  log,                       // optional { info, warn }; default silent
  onWord: (w) => console.log(w.text, w.start, w.end), // seconds from the start of the stream
  onError: (e) => console.error(e),
  onEnd: () => {},
});
return new Response(mp3, { headers: { "Content-Type": "audio/mpeg" } });

// on shutdown
links.close();
```

Cancelling the stream (the listener stops) stops asking for the remaining
pieces and closes that connection rather than handing a half-finished one to
the next read.

### Voice and rate

`voice` is any Edge short name (`de-DE-KatjaNeural`) or the long form; its
locale becomes the SSML's `xml:lang`. `rate` is `+N%` or `-N%`. Anything else
is refused before a connection is opened, since both go into SSML attributes.

### Sections

The voice has two pauses and no more (≈0.72 s at a full stop or line break,
≈0.2 s at a comma) and refuses SSML `<break>`, so a heading sounds like one more
line. Text split by `SPEECH_SECTION` (a form feed, `"\f"`) — or by your own
`sectionSeparator` — is sent as separate requests with `SECTION_PAUSE` (17
silent MP3 frames, ≈0.4 s) before each new section.

### The format is fixed

Always `audio-24khz-48kbitrate-mono-mp3` (`OUTPUT_FORMAT`). `secondsOf` —
which shifts a later piece's word timings by the audio before it — and
`SILENT_FRAME` are both written for exactly that format, so it is not an
option.

### Warm connections

A new connection costs 0.5–1.4 s before the first audio; a warm one 69–83 ms.
The service drops an idle connection at 60 s. `SpeechLinks` keeps one spare,
replaces it after `maxAgeMs` (45 s), and lets it go `lingerMs` (5 min) after
the last `warm()` or `take()`, checking every `checkMs` (5 s). Nothing is
opened and no timer runs until you call `warm()` or `take()`; `close()` stops
it all.

### Logging

Inject `{ info(event, fields), warn(event, fields) }`. Events:
`edge-tts.link` (each connection handed out, warm or not) and `edge-tts.synth`
(each synthesis: pieces, bytes, time to connection and to first audio; at
`warn` with `error` when it failed).

## When it stops speaking

The service checks that the caller looks like Edge. When Microsoft rotates
what it accepts, connections fail ("the speech service refused the
connection", or a 403 on the upgrade). The fix is almost always a new constant
in upstream Python `edge-tts`:

1. Look at the latest release of https://github.com/rany2/edge-tts —
   `src/edge_tts/constants.py` (`CHROMIUM_FULL_VERSION`,
   `TRUSTED_CLIENT_TOKEN`) and `drm.py` (how Sec-MS-GEC is computed).
2. Copy the new values into `src/constants.ts` — the only place they live.
3. `bun test` (the token test pins today's algorithm; update its expected
   value only if upstream changed the algorithm), tag a new version, bump the
   consumers.

## Installing

Not on npm. Depend on a pinned tag from GitHub:

```json
"@jimmy927/edge-tts": "git+https://github.com/jimmy927/edge-tts.git#v0.1.1"
```

(`github:jimmy927/edge-tts#v0.1.1` works too.) Changes are made **here**,
tagged, and each consumer bumps.

## Consumers

- **prifly** — the desktop host's read-aloud (`/speech`). Not switched yet:
  it still has its own copy in `apps/desktop-host/src/speech/`, which this
  package was extracted from.
- **threadhawk** — the Review page's read-aloud.

## Checks

```sh
bun test && bunx biome check . && bunx tsc --noEmit
```

## License

LGPL v3 (`LGPL-3.0-only`), the license of the upstream Python
[`edge-tts`](https://github.com/rany2/edge-tts) this is ported from. See
`LICENSE` (the LGPL, with the credit to upstream) and `COPYING` (the GPL v3 it
builds on).
