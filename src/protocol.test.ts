import { expect, test } from "bun:test";
import {
  audioOf,
  cleanText,
  localeOf,
  piecesOf,
  SECTION_PAUSE,
  SILENT_FRAME,
  secMsGec,
  splitText,
  ssml,
  synthesize,
  wordsOf,
} from "./index";
import { checkVoice } from "./protocol";

test("the token matches the Python edge-tts at the same instant", () => {
  // python: sha256(f"{ticks:.0f}{TOKEN}") with ticks from 1790163000 s.
  expect(secMsGec(1_790_163_000_000)).toBe(
    "DD9ABAACC8D7938B08AB085F9C530469AD154C26654ED031DF97B3855CF0F0C0",
  );
  // Five-minute steps: the same token within one.
  expect(secMsGec(1_790_163_000_000 + 60_000)).toBe(secMsGec(1_790_163_000_000));
});

test("text is escaped and stripped of control characters", () => {
  expect(cleanText("a < b & c\u000bd")).toBe("a &lt; b &amp; c d");
});

test("long text is cut at spaces, under the byte limit, never inside an entity", () => {
  const pieces = splitText("aaaa bbbb &amp; cccc", 12);
  expect(pieces.every((p) => new TextEncoder().encode(p).length <= 12)).toBe(true);
  expect(pieces.join(" ")).toBe("aaaa bbbb &amp; cccc");
  expect(splitText("short")).toEqual(["short"]);
});

test("sections are pieces of their own, each after a pause", () => {
  expect(piecesOf("Intro. A & b\fNext\nText.\f\f")).toEqual([
    { text: "Intro. A &amp; b", pause: false },
    { text: "Next\nText.", pause: true },
  ]);
  expect(piecesOf("One section")).toEqual([{ text: "One section", pause: false }]);
});

test("the pause is whole silent frames in the voice's own format", () => {
  // MPEG-2 layer III, 48 kbit/s, 24 kHz, mono: 144 bytes a frame, 24 ms.
  expect([...SILENT_FRAME.slice(0, 4)]).toEqual([0xff, 0xf3, 0x64, 0xc4]);
  expect(SECTION_PAUSE.length % 144).toBe(0);
  expect(SECTION_PAUSE.slice(144, 148)).toEqual(SILENT_FRAME.slice(0, 4));
  expect((SECTION_PAUSE.length * 8) / 48_000).toBeCloseTo(0.408, 3);
});

test("audio frames: header length, headers, then the MP3 bytes", () => {
  const headers = new TextEncoder().encode(
    "X-RequestId:1\r\nContent-Type:audio/mpeg\r\nPath:audio\r\n",
  );
  const frame = new Uint8Array([0, headers.length, ...headers, 0xff, 0xf3]);
  expect([...(audioOf(frame) ?? [])]).toEqual([0xff, 0xf3]);
  const end = new TextEncoder().encode("Path:audio\r\n");
  expect(audioOf(new Uint8Array([0, end.length, ...end]))).toBeNull();
});

test("word timings come from WordBoundary metadata, in seconds", () => {
  const frame =
    "X-RequestId:1\r\nContent-Type:application/json\r\nPath:audio.metadata\r\n\r\n" +
    JSON.stringify({
      Metadata: [
        {
          Type: "WordBoundary",
          Data: { Offset: 1_000_000, Duration: 5_000_000, text: { Text: "Hi" } },
        },
        { Type: "SessionEnd", Data: { Offset: 0 } },
      ],
    });
  expect(wordsOf(frame)).toEqual([{ text: "Hi", start: 0.1, end: 0.6 }]);
  expect(wordsOf("Path:turn.end\r\n\r\n{}")).toEqual([]);
  expect(wordsOf("Path:audio.metadata\r\n\r\nnot json")).toEqual([]);
});

test("xml:lang is the voice's locale", () => {
  expect(localeOf("en-GB-RyanNeural")).toBe("en-GB");
  expect(localeOf("de-DE-KatjaNeural")).toBe("de-DE");
  expect(localeOf("zh-CN-shaanxi-XiaoniNeural")).toBe("zh-CN");
  expect(localeOf("Microsoft Server Speech Text to Speech Voice (sv-SE, MattiasNeural)")).toBe(
    "sv-SE",
  );
  expect(localeOf("odd")).toBe("en-US");
  expect(ssml("Hej", { voice: "sv-SE-MattiasNeural", rate: "-5%" })).toBe(
    "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='sv-SE'>" +
      "<voice name='sv-SE-MattiasNeural'><prosody pitch='+0Hz' rate='-5%' volume='+0%'>" +
      "Hej</prosody></voice></speak>",
  );
});

test("a voice or rate that would break the SSML is refused", () => {
  expect(() => checkVoice({ voice: "en-GB-RyanNeural", rate: "+20%" })).not.toThrow();
  expect(() => checkVoice({ voice: "x'><evil", rate: "+20%" })).toThrow();
  expect(() => checkVoice({ voice: "en-GB-RyanNeural", rate: "fast" })).toThrow();
  expect(() => synthesize("hi", { rate: "20" })).toThrow();
});

test("the section separator can be the consumer's own", () => {
  expect(piecesOf("One§Two", "§")).toEqual([
    { text: "One", pause: false },
    { text: "Two", pause: true },
  ]);
  // With another separator a form feed is just whitespace.
  expect(piecesOf("One\fTwo", "§")).toEqual([{ text: "One Two", pause: false }]);
});
