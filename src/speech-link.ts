/**
 * Warm connections to the speech service.
 *
 * Measured 2026-09-23: on a fresh WebSocket Microsoft's first audio came 0.5–
 * 1.4 s after the click, most of it the connection; on one already open and
 * configured, a new request answered in 69–83 ms, after 5 s or 20 s of idle
 * alike. The service closes a connection after 60 s without traffic (1006 at
 * 60.2 s), and edge-tts itself never reuses one (its issue #347, declined).
 *
 * So a connection is opened ahead of need — `warm()`, called when a reader is
 * about to listen — and kept for a few minutes after the last use, replaced
 * before the service's cutoff. Not all day: that would be a new connection
 * every ~45 s to a service used unofficially.
 *
 * Nothing runs until a consumer makes one and calls `warm()` or `take()`; each
 * consumer owns its own and `close()`s it when it shuts down.
 */

import { type Logger, silentLogger } from "./log";
import { type Link, openLink } from "./protocol";

export type LinkOpener = () => Promise<Link>;

export type SpeechLinksOptions = {
  /** How a connection is opened; `openLink` unless a test fakes it. */
  open?: LinkOpener;
  /** Replaced this long after opening: the service cuts an idle one at 60 s. Default 45 s. */
  maxAgeMs?: number;
  /** Kept warm this long after the last `warm()` or `take()`. Default 5 min. */
  lingerMs?: number;
  /** How often the spare is looked at while one is wanted. Default 5 s. */
  checkMs?: number;
  log?: Logger;
};

export const LINK_DEFAULTS = { maxAgeMs: 45_000, lingerMs: 5 * 60_000, checkMs: 5_000 } as const;

export class SpeechLinks {
  private spare: Link | null = null;
  private opening: Promise<Link> | null = null;
  private wantedUntil = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private shut = false;

  private readonly open: LinkOpener;
  private readonly maxAgeMs: number;
  private readonly lingerMs: number;
  private readonly checkMs: number;
  private readonly log: Logger;

  constructor(options: SpeechLinksOptions = {}) {
    this.open = options.open ?? openLink;
    this.maxAgeMs = options.maxAgeMs ?? LINK_DEFAULTS.maxAgeMs;
    this.lingerMs = options.lingerMs ?? LINK_DEFAULTS.lingerMs;
    this.checkMs = options.checkMs ?? LINK_DEFAULTS.checkMs;
    this.log = options.log ?? silentLogger;
  }

  /** A reader is about to listen: have a connection ready, and keep one for a while. */
  warm(): void {
    if (this.shut) return;
    this.wantedUntil = Date.now() + this.lingerMs;
    this.timer ??= setInterval(() => this.tend(), this.checkMs);
    void this.ensureSpare();
  }

  /** A connection for one request: the warm one if there is one, else a new one. */
  async take(): Promise<Link> {
    if (!this.shut) this.wantedUntil = Date.now() + this.lingerMs;
    const ready = this.fresh(this.spare) ? this.spare : null;
    this.spare = null;
    // Never the one still opening: that is on its way to being the spare,
    // and two reads on one connection would mix their audio.
    const link = ready ?? (await this.open());
    void this.ensureSpare();
    this.log.info("edge-tts.link", { warm: ready !== null, ageMs: Date.now() - link.openedAt });
    return link;
  }

  /** Done with a request that ended cleanly: keep the connection if it is still worth keeping. */
  give(link: Link): void {
    if (this.spare === null && this.fresh(link) && Date.now() < this.wantedUntil) {
      this.spare = link;
      return;
    }
    close(link);
  }

  /** Stop keeping anything warm: the spare is closed and the timer stopped. `take()` still works, cold. */
  close(): void {
    this.shut = true;
    this.wantedUntil = 0;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.spare !== null) {
      close(this.spare);
      this.spare = null;
    }
  }

  private fresh(link: Link | null): link is Link {
    return link !== null && !link.closed && Date.now() - link.openedAt < this.maxAgeMs;
  }

  private async ensureSpare(): Promise<void> {
    if (this.fresh(this.spare) || this.opening !== null || Date.now() >= this.wantedUntil) return;
    this.opening = this.open();
    try {
      const link = await this.opening;
      // Kept only if still wanted: a close() while it opened lets it go.
      if (this.spare === null && Date.now() < this.wantedUntil) this.spare = link;
      else close(link);
    } catch {
      // No connection now: the next take() opens one and says why.
    } finally {
      this.opening = null;
    }
  }

  /** Replace a connection before the service drops it; let go once nobody wants one. */
  private tend(): void {
    const wanted = Date.now() < this.wantedUntil;
    if (this.spare !== null && (!wanted || !this.fresh(this.spare))) {
      close(this.spare);
      this.spare = null;
    }
    if (wanted) {
      void this.ensureSpare();
    } else if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

function close(link: Link): void {
  link.closed = true;
  try {
    link.ws.close();
  } catch {
    // Already closing: nothing to do.
  }
}
