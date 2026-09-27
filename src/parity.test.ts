/**
 * Byte-for-byte the same as prifly's copy (`apps/desktop-host/src/speech/
 * edge-tts.ts` at prifly 615b955): the expected values were produced by
 * running prifly's own functions on these inputs and hashing the JSON of the
 * result. Hard-coded rather than imported, so this repo tests on its own.
 */

import { expect, test } from "bun:test";
import { cleanText, piecesOf, SECTION_PAUSE, secMsGec, splitText, ssml } from "./index";
import { CONFIG } from "./protocol";

const inputs = {
  plain: "Hello, world.",
  escaped: "a < b & c > d\u000b\u0001e",
  sections: "# Title\fFirst para.\n\nSecond & third.\f\fTail",
  long: Array.from({ length: 700 }, (_, i) => `word${i} & ümlaut`).join(" "),
  noSpaces: "x".repeat(5000),
  entityEdge: `${"y".repeat(4090)} &amp; z`,
};

/** sha256 of JSON.stringify of cleanText, splitText(cleanText) and piecesOf, from prifly. */
const prifly: Record<keyof typeof inputs, [string, string, string]> = {
  plain: [
    "77b022ebccdee0c6f15454b794d140fd52750d566996a934c9d0830ce39627f9",
    "35674ad35eb19c962255f23dfdad63f913c07ff4eb725583a7b1de096cdaa572",
    "60981455068d04f4224fb0aaec036f3c2661ffcee43d846a47259b73e2de89df",
  ],
  escaped: [
    "49eb5ab294ebf3f1d374c1b0ffa5c50346b3adba25dae527da9a6129a2b270d1",
    "af7e11e1b8d0ae48d5d71fbcb46d9e1cd28356662d513b10d47c91b64a084296",
    "36a269901532b3273821b2d22c310215a89c4ab99e8281de5dee02d10e35c943",
  ],
  sections: [
    "84e8eac41d45bcb870277a5d01eed767af2398eeb7a9c9d7ea9a770b5f32a2a8",
    "1cbd05ca4fc30c3e68df14182aba2256a9547fedc90e898fddbe4a78cd54e8ae",
    "a395dde100343f28bb04e60dd0868793b6addcceb24f01eb9aae8dce0f91aa07",
  ],
  long: [
    "d12a24d0e1a3bc684491b6f181decba1d97654ab270ce60ed4992f3b3ca00474",
    "247cd4170918a32fc9b973cc98f1febb67423bf47c171d9ed50654aac7d4f827",
    "fd54aca8ffd3ffd17ea967f0017e3d169e170427efe69f148b0a8a67de47549a",
  ],
  noSpaces: [
    "f6aded27d6860380436f8521caa75568b9504f97b8927dceb41de307362e8cd7",
    "daeec930f858c6323185b630caae82d357ad655084d693f31376a3b6d1ee1590",
    "8614c0435319c5c97c0bcebf01f271166dc75807393dd4fa930349529cc86e6e",
  ],
  entityEdge: [
    "ec53b8d829fb3cc710151e1833329b5a480f77e8e7e96c69b3a516deceb9d0c7",
    "0f9b72ced3d79af9db11b5c6234bfa6e7d1e2ba91e2011b01da2a0f92454585c",
    "0e8027dc68c54b607437b41cbdfac66f1d63ce5c131218fe67d4a6b1869c8b69",
  ],
};

const sha = (value: unknown) =>
  new Bun.CryptoHasher("sha256").update(JSON.stringify(value)).digest("hex");

test("escaping, chunking and sections match prifly's on fixed inputs", () => {
  for (const [name, text] of Object.entries(inputs)) {
    const clean = cleanText(text);
    const got = [sha(clean), sha(splitText(clean)), sha(piecesOf(text))];
    expect({ name, got }).toEqual({ name, got: prifly[name as keyof typeof inputs] });
  }
  expect(splitText(cleanText(inputs.long))).toHaveLength(4);
  expect(piecesOf(inputs.sections)).toHaveLength(3);
});

test("the token matches prifly's at three instants", () => {
  expect([0, 1_790_163_000_000, 1_700_000_123_456].map(secMsGec)).toEqual([
    "7ECB79D14E3AA576D2D79E6D487A1388156D91E614B1BE11C64226A29BC8DD8C",
    "DD9ABAACC8D7938B08AB085F9C530469AD154C26654ED031DF97B3855CF0F0C0",
    "AE4CF72E466874182A75878E20EADA83D29A1C12CAD9C3E0E014CCE0BFA55880",
  ]);
});

test("the section pause is prifly's, byte for byte", () => {
  expect(new Bun.CryptoHasher("sha256").update(SECTION_PAUSE).digest("hex")).toBe(
    "1997cf7a35ef51b5896f7120c813f306bf37678ef58e06ff3924ef5a90e45283",
  );
});

test("the SSML and config are prifly's, but for xml:lang", () => {
  // prifly (and Python edge-tts) always send xml:lang='en-US'; here it is the
  // voice's locale. Every other byte is the same.
  const priflySsml =
    "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
    "<voice name='en-GB-RyanNeural'><prosody pitch='+0Hz' rate='+20%' volume='+0%'>" +
    "A &amp; B</prosody></voice></speak>";
  expect(ssml("A &amp; B")).toBe(priflySsml.replace("xml:lang='en-US'", "xml:lang='en-GB'"));
  expect(ssml("A &amp; B", { voice: "en-US-AriaNeural", rate: "+20%" })).toBe(
    priflySsml.replace("en-GB-RyanNeural", "en-US-AriaNeural"),
  );
  expect(CONFIG).toBe(
    "Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n" +
      '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},' +
      '"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n',
  );
});
