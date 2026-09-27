// Text to speech with Microsoft Edge's online "Read aloud" voices, spoken over
// its WebSocket: no key, nothing installed. Bun only.
//
//   constants.ts    the values that rotate when Microsoft or upstream edge-tts
//                   moves them (token, Edge version) and the fixed format
//   protocol.ts     the token, escaping, chunking, SSML, frames, one connection
//   speech-link.ts  warm connections, owned and closed by the consumer
//   synthesize.ts   a whole text as one MP3 stream with word timings

export {
  CHROMIUM_MAJOR,
  CHROMIUM_VERSION,
  DEFAULT_RATE,
  DEFAULT_VOICE,
  OUTPUT_FORMAT,
  SEC_MS_GEC_VERSION,
  SPEECH_SECTION,
  TRUSTED_CLIENT_TOKEN,
  WSS_URL,
} from "./constants";
export { type LogFields, type Logger, silentLogger } from "./log";
export {
  audioOf,
  CHUNK_BYTES,
  cleanText,
  type Link,
  localeOf,
  openLink,
  type SpokenWord,
  secMsGec,
  splitText,
  ssml,
  type Voice,
  wordsOf,
} from "./protocol";
export {
  LINK_DEFAULTS,
  type LinkOpener,
  SpeechLinks,
  type SpeechLinksOptions,
} from "./speech-link";
export {
  piecesOf,
  SECTION_PAUSE,
  SILENT_FRAME,
  type SynthesizeOptions,
  secondsOf,
  synthesize,
} from "./synthesize";
