/**
 * Everything that has to be bumped when the service stops answering.
 *
 * The service is Edge's own "Read aloud", so it checks that the caller looks
 * like Edge: the Sec-MS-GEC token (a hash of the time and Edge's public client
 * token, see `secMsGec` in `protocol.ts`) and an Edge version it accepts. When
 * Microsoft moves either, the Python `edge-tts` project releases a new constant
 * — https://github.com/rany2/edge-tts, `src/edge_tts/constants.py` and
 * `drm.py` — and the values here follow it. Nothing else in this package
 * should need to change for a rotation.
 */

/** Edge's public client token: in the URL and hashed into Sec-MS-GEC. Upstream: `TRUSTED_CLIENT_TOKEN`. */
export const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";

/** The Edge version the requests claim to be. Upstream: `CHROMIUM_FULL_VERSION`. */
export const CHROMIUM_VERSION = "143.0.3650.75";

/** Its major version, for the User-Agent. Upstream: `CHROMIUM_MAJOR_VERSION`. */
export const CHROMIUM_MAJOR = CHROMIUM_VERSION.split(".")[0] ?? "";

/** Sent next to the token as `Sec-MS-GEC-Version`. Upstream: `SEC_MS_GEC_VERSION`. */
export const SEC_MS_GEC_VERSION = `1-${CHROMIUM_VERSION}`;

/** The Read aloud extension's origin, which the service expects. */
export const ORIGIN = "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold";

export const WSS_URL =
  "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1" +
  `?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`;

/**
 * The audio format asked for. FIXED on purpose: `secondsOf` (word timings of a
 * later piece) and `SILENT_FRAME` (the section pause) are both written for
 * 24 kHz, 48 kbit/s mono MP3, and would be wrong for any other.
 */
export const OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";

export const DEFAULT_VOICE = "en-GB-RyanNeural";
export const DEFAULT_RATE = "+20%";

/**
 * Where a text starts a new section — a heading, or the text after a rule.
 *
 * The Edge voice has two pauses and no more: about 0.72 s at a full stop or a
 * line break (a blank line and an ellipsis too), about 0.2 s at a comma, colon,
 * semicolon or dash; SSML `<break>` is refused (measured 2026-09-27). A heading
 * therefore sounded like one more line. So each section is its own request,
 * with silence between them (`SECTION_PAUSE`).
 *
 * A form feed: whitespace to everything else that reads the text, and a
 * character no message is written with. A consumer may pass its own separator
 * to `synthesize`; this is the default.
 */
export const SPEECH_SECTION = "\f";
