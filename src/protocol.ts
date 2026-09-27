/**
 * The wire: the Sec-MS-GEC token, the text as the service takes it, the SSML
 * around it, the frames that come back, and opening one configured connection.
 *
 * A port of the Python `edge-tts` package (7.x): the same token, the same
 * headers and the same streaming, so audio starts as soon as the first chunk
 * is synthesised rather than once the whole text has been.
 *
 * Bun only: `Bun.CryptoHasher`, and `new WebSocket(url, { headers })`, which
 * the browser and Node's WebSocket do not take.
 */

import {
  CHROMIUM_MAJOR,
  DEFAULT_RATE,
  DEFAULT_VOICE,
  ORIGIN,
  OUTPUT_FORMAT,
  SEC_MS_GEC_VERSION,
  TRUSTED_CLIENT_TOKEN,
  WSS_URL,
} from "./constants";

/** Seconds from the Windows file-time epoch (1601) to the Unix one. */
const WIN_EPOCH = 11_644_473_600;
/** The service takes at most this much text per request; longer text is sent in turns. */
export const CHUNK_BYTES = 4096;

/** The Sec-MS-GEC token: SHA-256 of the time, in 5-minute steps of Windows file time, and the client token. */
export function secMsGec(nowMs: number): string {
  let seconds = Math.floor(nowMs / 1000) + WIN_EPOCH;
  seconds -= seconds % 300;
  const ticks = BigInt(seconds) * 10_000_000n;
  return new Bun.CryptoHasher("sha256")
    .update(`${ticks}${TRUSTED_CLIENT_TOKEN}`)
    .digest("hex")
    .toUpperCase();
}

export const id = () => crypto.randomUUID().replaceAll("-", "");

/** XML-escaped, without the control characters the service rejects (a vertical tab from a PDF). */
export function cleanText(text: string): string {
  return (
    text
      // biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
  );
}

/**
 * Cut escaped text into pieces the service takes: at most `limit` UTF-8
 * bytes, split at a line break or a space where there is one, and never
 * inside an `&amp;` entity.
 */
export function splitText(text: string, limit = CHUNK_BYTES): string[] {
  const encoder = new TextEncoder();
  const pieces: string[] = [];
  let rest = text;
  while (encoder.encode(rest).length > limit) {
    // The longest prefix under the limit, in characters.
    let end = rest.length;
    while (encoder.encode(rest.slice(0, end)).length > limit) end = Math.floor(end * 0.9);
    let cut = Math.max(rest.lastIndexOf("\n", end), rest.lastIndexOf(" ", end));
    if (cut <= 0) cut = end;
    const amp = rest.lastIndexOf("&", cut);
    if (amp >= 0 && rest.indexOf(";", amp) >= cut) cut = amp;
    const piece = rest.slice(0, cut).trim();
    if (piece !== "") pieces.push(piece);
    rest = rest.slice(cut);
  }
  if (rest.trim() !== "") pieces.push(rest.trim());
  return pieces;
}

/** JavaScript's Date.toString() in UTC, which is what the service expects to read. */
export function timestamp(): string {
  const date = new Date().toUTCString().replace(/^(\w+), (\d+) (\w+) (\d+)/, "$1 $3 $2 $4");
  return `${date.replace(" GMT", "")} GMT+0000 (Coordinated Universal Time)`;
}

/** The voice and speed a text is read with. */
export type Voice = { voice: string; rate: string };

/** A short voice name — `en-GB-RyanNeural` — or the long form `Microsoft Server Speech Text to Speech Voice (en-GB, RyanNeural)`. */
const VOICE_NAME = /^[A-Za-z0-9 ,()-]+$/;
/** Relative speed, as the service takes it: `+20%`, `-10%`, `+0%`. */
const RATE_FORMAT = /^[+-]\d+%$/;

/** Throws for a voice or rate that would not fit in the SSML's attributes. */
export function checkVoice({ voice, rate }: Voice): void {
  if (!VOICE_NAME.test(voice)) throw new Error(`edge-tts: not a voice name: ${voice}`);
  if (!RATE_FORMAT.test(rate)) throw new Error(`edge-tts: not a rate like +20%: ${rate}`);
}

/** The voice's locale — `en-GB` for `en-GB-RyanNeural` — for the SSML's `xml:lang`; `en-US` when it has none. */
export function localeOf(voice: string): string {
  const match =
    /^([a-z]{2,3}-[A-Za-z]{2,4})-/.exec(voice) ?? /\(([a-z]{2,3}-[A-Za-z]{2,4}),/.exec(voice);
  return match?.[1] ?? "en-US";
}

/** The SSML for one piece of already escaped text. */
export function ssml(
  text: string,
  { voice, rate }: Voice = { voice: DEFAULT_VOICE, rate: DEFAULT_RATE },
): string {
  return (
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${localeOf(voice)}'>` +
    `<voice name='${voice}'><prosody pitch='+0Hz' rate='${rate}' volume='+0%'>` +
    `${text}</prosody></voice></speak>`
  );
}

/** The text message that asks for one piece. */
export function ssmlRequest(text: string, voice: Voice): string {
  return `X-RequestId:${id()}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${timestamp()}Z\r\nPath:ssml\r\n\r\n${ssml(text, voice)}`;
}

/**
 * The audio of a binary frame: two bytes of header length, headers, then the
 * MP3 bytes — or null for a frame that is not audio or carries none.
 */
export function audioOf(frame: Uint8Array): Uint8Array | null {
  if (frame.length < 2) return null;
  const length = ((frame[0] ?? 0) << 8) | (frame[1] ?? 0);
  const headers = new TextDecoder().decode(frame.subarray(2, length + 2));
  if (!headers.includes("Path:audio") || !headers.includes("Content-Type:audio/mpeg")) return null;
  const data = frame.subarray(length + 2);
  return data.length === 0 ? null : data;
}

/** A word as spoken: its text, and when it starts and ends in the audio, in seconds. */
export type SpokenWord = { text: string; start: number; end: number };

/**
 * The words an `audio.metadata` frame names. The service sends them with the
 * audio at no cost in speed (measured: first word timing at 186 ms, first
 * audio at 193 ms), in 100 ns ticks from the start of the piece.
 */
export function wordsOf(frame: string): SpokenWord[] {
  if (!frame.includes("Path:audio.metadata")) return [];
  try {
    const body = JSON.parse(frame.slice(frame.indexOf("\r\n\r\n") + 4)) as {
      Metadata?: {
        Type?: string;
        Data?: { Offset?: number; Duration?: number; text?: { Text?: string } };
      }[];
    };
    return (body.Metadata ?? []).flatMap((entry) => {
      const data = entry.Data;
      const text = data?.text?.Text;
      if (entry.Type !== "WordBoundary" || data === undefined || typeof text !== "string")
        return [];
      const start = (data.Offset ?? 0) / 1e7;
      return [{ text, start, end: start + (data.Duration ?? 0) / 1e7 }];
    });
  } catch {
    // A frame we cannot read: its words are simply not highlighted.
    return [];
  }
}

/** The configuration sent once per connection: word timings on, the fixed MP3 format. */
export const CONFIG =
  "Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n" +
  '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},' +
  `"outputFormat":"${OUTPUT_FORMAT}"}}}}\r\n`;

/** An open connection to the service, and whether it can still be used. */
export type Link = {
  ws: WebSocket;
  openedAt: number;
  closed: boolean;
};

/** A connection to the service, open and configured, ready for requests. */
export function openLink(): Promise<Link> {
  const url = `${WSS_URL}&ConnectionId=${id()}&Sec-MS-GEC=${secMsGec(Date.now())}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;
  const ws = new WebSocket(url, {
    headers: {
      Pragma: "no-cache",
      "Cache-Control": "no-cache",
      Origin: ORIGIN,
      "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR}.0.0.0`,
      "Accept-Language": "en-US,en;q=0.9",
      Cookie: `muid=${id().toUpperCase()};`,
    },
  });
  ws.binaryType = "arraybuffer";
  const link: Link = { ws, openedAt: Date.now(), closed: false };
  return new Promise((resolve, reject) => {
    ws.onopen = () => {
      ws.send(`X-Timestamp:${timestamp()}\r\n${CONFIG}`);
      resolve(link);
    };
    ws.onerror = () => reject(new Error("the speech service refused the connection"));
    ws.addEventListener("close", () => {
      link.closed = true;
    });
  });
}
