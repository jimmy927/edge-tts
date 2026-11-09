import { expect, test } from "bun:test";
import { secMsGec, tokenHash } from "./drm";

// Expected values were produced by running upstream's own drm.py (rany2/edge-tts
// bd44c1d1aaebdc1db7f47456ee12431b42ec7cac, edge_tts 7.3.x) under python3, with
// aiohttp and the exceptions import stubbed out, via generate_sec_ms_gec_v2(ms / 1000)
// and _token_hash(bytes). Regenerate them the same way if upstream changes the algorithm.

const BOUNDARY = 1_790_163_000_000; // a multiple of 300 s

test("the token matches upstream's Python at fixed instants", () => {
  expect(secMsGec(BOUNDARY)).toBe(
    "55EFC5EF97B02FBB-6DCE40245F3D5EC824AA723B3C67FD678E47F13533D772808081F96A46D434E3",
  );
  expect(secMsGec(0)).toBe(
    "52BC7A17B50DFEC9-28C4394775C8751CD2F6859C030C06DB1489ACAB3B3A7651831FC26895177ED6",
  );
  expect(secMsGec(1_700_000_123_456)).toBe(
    "0919602B5750900A-EC9DD394F23CB5635CF62A0E8E24136DCD32B26D10C543B10082E482D7516397",
  );
});

test("the token changes exactly on the 300 s boundary", () => {
  const before =
    "90BD438722F8BC02-B1798B2E90CE8E74A9ED45A670B6281DCDD0F671B893F0F4CB5B35D49A1537D2";
  const next = "74B4BA5D6C9F56EE-8AF95E12E4C21BB2AA2AD3CA0908379D416E45930A296FEC0F3E2D21359B10F1";
  expect(secMsGec(BOUNDARY - 1)).toBe(before);
  expect(secMsGec(BOUNDARY + 299_999)).toBe(secMsGec(BOUNDARY));
  expect(secMsGec(BOUNDARY + 300_000)).toBe(next);
});

const bytes = (hex: string) =>
  Uint8Array.from(hex.match(/../g) ?? [], (b) => Number.parseInt(b, 16));

test("the token hash matches upstream's _token_hash across lengths", () => {
  const ascending80 = Uint8Array.from({ length: 80 }, (_, i) => i + 1);
  const stride200 = Uint8Array.from({ length: 200 }, (_, i) => (i * 7) % 256);
  const cases: [Uint8Array, string, string][] = [
    [
      bytes("61626364656667"), // 7 bytes: the shortest allowed
      "97E9018412E7C939",
      "4B2714C790880C814D9D2AD59C85751F4469AD8B55859F18668799E789F47791",
    ],
    [
      new TextEncoder().encode("hello world, this is a test of the hash"), // 39 bytes
      "5661D12E07C08202",
      "46AC0A80E634443E2986B861E5A9750C4F1774BA7C1B2CFD1AB692BE45DA1682",
    ],
    [
      ascending80, // two blocks
      "E5ACCA36E7918690",
      "82F0A3498ADCBB43582EC320EA72D13623BAE278F18D4D15E6CA4E0CD37DFD99",
    ],
    [
      stride200, // four blocks, every byte value class
      "215E9D4E60AEE8F8",
      "434EA216D2F806C170EDB912EE25BE3656D38E2A0DDDF9ED13950A9452833CCC",
    ],
  ];
  for (const [data, cs64, sha256] of cases) expect(tokenHash(data)).toEqual([cs64, sha256]);
});

test("the token hash refuses less than seven bytes", () => {
  expect(() => tokenHash(new Uint8Array(6))).toThrow();
});
