/**
 * The logger a consumer injects. Two levels, one event name and flat fields —
 * the shape of prifly's `log`/`warn`, so a consumer passes its own through
 * unchanged. Events: `edge-tts.synth` (one per synthesis) and `edge-tts.link`
 * (one per connection handed out).
 */

export type LogFields = Record<string, string | number | boolean | null>;

export type Logger = {
  info: (event: string, fields: LogFields) => void;
  warn: (event: string, fields: LogFields) => void;
};

/** The default: says nothing. */
export const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
};
