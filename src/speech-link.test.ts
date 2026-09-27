import { expect, test } from "bun:test";
import type { Link } from "./protocol";
import { SpeechLinks } from "./speech-link";

function fakeOpener() {
  const opened: Link[] = [];
  const open = async (): Promise<Link> => {
    const link: Link = {
      ws: { close() {} } as unknown as WebSocket,
      openedAt: Date.now(),
      closed: false,
    };
    opened.push(link);
    return link;
  };
  return { opened, open };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a warm-up opens one connection, and the next read takes it", async () => {
  const { opened, open } = fakeOpener();
  const links = new SpeechLinks({ open });
  links.warm();
  await settle();
  expect(opened).toHaveLength(1);
  const link = await links.take();
  expect(link === opened[0]).toBe(true);
});

test("a finished read hands its connection back for the next one", async () => {
  const { opened, open } = fakeOpener();
  const links = new SpeechLinks({ open });
  const first = await links.take();
  await settle();
  // take() also opened a spare in the background; returning `first` keeps
  // at most one spare, so it is closed rather than kept twice.
  links.give(first);
  const next = await links.take();
  expect(opened.includes(next)).toBe(true);
  expect(next.closed).toBe(false);
});

test("a connection older than the service tolerates is not handed out", async () => {
  const { opened, open } = fakeOpener();
  const links = new SpeechLinks({ open });
  links.warm();
  await settle();
  const stale = opened[0];
  if (stale === undefined) throw new Error("no connection opened");
  stale.openedAt -= 60_000;
  const link = await links.take();
  expect(link).not.toBe(stale);
});

test("nothing is opened or scheduled until asked", async () => {
  const { opened, open } = fakeOpener();
  new SpeechLinks({ open });
  await settle();
  expect(opened).toHaveLength(0);
});

test("the age limit is an option", async () => {
  const { opened, open } = fakeOpener();
  const links = new SpeechLinks({ open, maxAgeMs: 10 });
  links.warm();
  await settle();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const link = await links.take();
  expect(link).not.toBe(opened[0]);
  links.close();
});

test("close() lets the spare go and keeps nothing warm after", async () => {
  const { opened, open } = fakeOpener();
  const links = new SpeechLinks({ open });
  links.warm();
  await settle();
  links.close();
  expect(opened[0]?.closed).toBe(true);
  // Still usable, cold: a new connection each time, none kept.
  const link = await links.take();
  await settle();
  expect(opened).toHaveLength(2);
  links.give(link);
  expect(link.closed).toBe(true);
  links.warm();
  await settle();
  expect(opened).toHaveLength(2);
});
