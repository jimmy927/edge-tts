/**
 * A whole text as one MP3 stream: cut into pieces the service takes, each
 * piece one request on one connection, sections apart by a pause of silence.
 */

import { DEFAULT_RATE, DEFAULT_VOICE, SPEECH_SECTION } from "./constants";
import { type Logger, silentLogger } from "./log";
import {
  audioOf,
  checkVoice,
  cleanText,
  type Link,
  openLink,
  type SpokenWord,
  splitText,
  ssmlRequest,
  type Voice,
  wordsOf,
} from "./protocol";
import type { SpeechLinks } from "./speech-link";

/** Seconds of audio in this many bytes of the service's 48 kbit/s MP3 (`OUTPUT_FORMAT`). */
export const secondsOf = (bytes: number) => (bytes * 8) / 48_000;

/**
 * One frame of silence in the service's own format — MPEG-2 layer III,
 * 24 kHz, 48 kbit/s, mono: 144 bytes, 24 ms. The header, then side
 * information and data all zero: no bits to decode, so nothing is heard.
 */
export const SILENT_FRAME = new Uint8Array(144);
SILENT_FRAME.set([0xff, 0xf3, 0x64, 0xc4]);

/**
 * The silence put before a new section: 17 frames, about 0.4 s, on top of the
 * voice's own pause at the end of a piece. Its longest pause is 0.72 s and it
 * takes no `<break>`, so a heading sounded like one more line (2026-09-27).
 */
export const SECTION_PAUSE = new Uint8Array(SILENT_FRAME.length * 17).map(
  (_, index) => SILENT_FRAME[index % SILENT_FRAME.length] ?? 0,
);

/** The text's pieces for the service, each saying whether a section's pause goes before it. */
export function piecesOf(
  text: string,
  separator: string = SPEECH_SECTION,
): { text: string; pause: boolean }[] {
  return text
    .split(separator)
    .map((section) => splitText(cleanText(section)))
    .filter((pieces) => pieces.length > 0)
    .flatMap((pieces, section) =>
      pieces.map((piece, index) => ({ text: piece, pause: section > 0 && index === 0 })),
    );
}

/** One request on a connection: one piece of text, its MP3 bytes and word timings as they come. */
function synthesizePiece(
  link: Link,
  text: string,
  voice: Voice,
  onAudio: (bytes: Uint8Array) => void,
  onWord: (word: SpokenWord) => void,
): Promise<void> {
  const { ws } = link;
  return new Promise((resolve, reject) => {
    const onClose = (event: CloseEvent) =>
      reject(new Error(`speech socket closed mid-request: ${event.code}`));
    ws.addEventListener("close", onClose, { once: true });
    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        for (const word of wordsOf(event.data)) onWord(word);
        if (event.data.includes("Path:turn.end")) {
          ws.removeEventListener("close", onClose);
          resolve();
        }
        return;
      }
      const audio = audioOf(new Uint8Array(event.data as ArrayBuffer));
      if (audio !== null) onAudio(audio);
    };
    ws.send(ssmlRequest(text, voice));
  });
}

export type SynthesizeOptions = {
  /** Default `en-GB-RyanNeural`. Its locale becomes the SSML's `xml:lang`. */
  voice?: string;
  /** Default `+20%`. */
  rate?: string;
  /** Default: says nothing. One `edge-tts.synth` per synthesis, `warn` when it failed. */
  log?: Logger;
  /** Where a new section starts, with a pause before it. Default `SPEECH_SECTION` (a form feed). */
  sectionSeparator?: string;
  /** Warm connections to take from and give back to. Without, each synthesis opens one and closes it. */
  links?: SpeechLinks;
  /** The stream failed; it is errored too. */
  onError?: (caught: unknown) => void;
  /** Each word, timed from the start of the whole stream. */
  onWord?: (word: SpokenWord) => void;
  /** The stream ended, finished or stopped. */
  onEnd?: () => void;
};

/** The whole text as one MP3 stream, piece after piece, starting with the first. */
export function synthesize(
  text: string,
  options: SynthesizeOptions = {},
): ReadableStream<Uint8Array> {
  const voice: Voice = {
    voice: options.voice ?? DEFAULT_VOICE,
    rate: options.rate ?? DEFAULT_RATE,
  };
  checkVoice(voice);
  const log = options.log ?? silentLogger;
  const links = options.links ?? null;
  const pieces = piecesOf(text, options.sectionSeparator ?? SPEECH_SECTION);
  // Measured per read, so a slow start says which stage it was: the socket to
  // the service (a new TLS connection each time) or the synthesis after it.
  const started = performance.now();
  const at = { open: 0, audio: 0 };
  const since = (mark: number) => (mark === 0 ? null : Math.round(mark - started));
  let bytes = 0;
  // Set when the listener stops (a stop, or another text): the pieces not yet
  // asked for are never asked for. Without it, a stopped read ran to its end
  // — 19 s of synthesis once — and each chunk after the stop failed with
  // "Controller is already closed".
  let cancelled = false;
  let link: Link | null = null;
  const stats = () => ({
    pieces: pieces.length,
    chars: text.length,
    bytes,
    cancelled,
    openMs: since(at.open),
    firstAudioMs: since(at.audio),
    ms: Math.round(performance.now() - started),
  });
  const emit = (controller: ReadableStreamDefaultController<Uint8Array>, chunk: Uint8Array) => {
    if (cancelled) return;
    at.audio ||= performance.now();
    bytes += chunk.length;
    controller.enqueue(chunk);
  };
  const speak = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    open: Link,
    piece: { text: string; pause: boolean },
  ) => {
    if (piece.pause) emit(controller, SECTION_PAUSE.slice());
    // A later piece's timings start at its own zero: shift them by the audio before it.
    const base = secondsOf(bytes);
    return synthesizePiece(
      open,
      piece.text,
      voice,
      (chunk) => emit(controller, chunk),
      (word) => options.onWord?.({ ...word, start: word.start + base, end: word.end + base }),
    );
  };
  // Without `links`, the connection is this synthesis's alone and closed after.
  const acquire = () => (links === null ? openLink() : links.take());
  const release = (done: Link) => {
    // A read stopped mid-turn leaves the rest of that turn in flight on
    // the connection: closed, never handed to the next read.
    if (cancelled || links === null) done.ws.close();
    else links.give(done);
  };
  return new ReadableStream({
    async start(controller) {
      try {
        link = await acquire();
        at.open = performance.now();
        for (const piece of pieces) {
          if (cancelled) break;
          await speak(controller, link, piece);
        }
        release(link);
        log.info("edge-tts.synth", stats());
        if (!cancelled) controller.close();
      } catch (caught) {
        if (cancelled) return;
        log.warn("edge-tts.synth", { ...stats(), error: String(caught) });
        options.onError?.(caught);
        controller.error(caught);
      } finally {
        options.onEnd?.();
      }
    },
    cancel() {
      cancelled = true;
      link?.ws.close();
    },
  });
}
