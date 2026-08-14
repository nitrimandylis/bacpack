// The portfolio index is paginated at ten entries a page. Reading it once
// returns the newest ten and exits 0, which reads as a complete list.

import { expect, test } from "bun:test";
import { listEntries } from "./portfolio.ts";

// One entry's worth of the real markup, trimmed to the fields the parser reads.
const entry = (id: string) =>
  `<div class='journal-evidence' id='evidence-${id}'>` +
  `<span class='padding-right'>March 10, 2026</span>` +
  `<div class='label label-outcome'>Individual oral</div>` +
  `<div class='body'>body of ${id}</div></div>`;

const page = (ids: string[]) => `<html><body>${ids.map(entry).join("")}</body></html>`;

const PAGES: Record<string, string> = {
  "/student/classes/1/learner_portfolio/reflections": page(["10", "9", "8"]),
  "/student/classes/1/learner_portfolio/reflections/page/2": page(["7", "6"]),
};

test("every page is read, not just the first", async () => {
  const asked: string[] = [];
  const entries = await listEntries("1", async (path) => {
    asked.push(path);
    // A page past the end is a 200 with no entries on it, not a 404.
    return PAGES[path] ?? page([]);
  });

  expect(entries.map((e) => e.id)).toEqual(["10", "9", "8", "7", "6"]);
  expect(asked).toEqual([
    "/student/classes/1/learner_portfolio/reflections",
    "/student/classes/1/learner_portfolio/reflections/page/2",
    "/student/classes/1/learner_portfolio/reflections/page/3",
  ]);
});

test("a server that clamps an out-of-range page back to the first still terminates", async () => {
  const entries = await listEntries("1", async () => page(["10", "9", "8"]));
  expect(entries.map((e) => e.id)).toEqual(["10", "9", "8"]);
});

test("a class with one short page costs one request", async () => {
  const asked: string[] = [];
  await listEntries("1", async (path) => {
    asked.push(path);
    return page([]);
  });
  expect(asked).toHaveLength(1);
});
