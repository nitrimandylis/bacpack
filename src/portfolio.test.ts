// Resolving Notion's label text against ManageBac's.
//
// These are the real option names from both systems as of 2026-08-01. Notion
// cannot store commas in a select option, so several pairs can never match
// exactly and the flattening is the only thing making the pipe work.

import { expect, test } from "bun:test";
import { flatten, resolveByLabel, resolveLabels as portfolioResolveLabels, type Tag, type Work } from "./portfolio.ts";

const tag = (id: string, label: string, category: string): Tag => ({ id, label, category });

// As printed by `bacpack portfolio tags --class greek`.
const TAGS: Tag[] = [
  tag("1", "Paper 1: Guided analysis", "Assessment"),
  tag("2", "Paper 2: Comparative essay", "Assessment"),
  tag("4", "Individual oral", "Assessment"),
  tag("5", "Readers, writers and texts", "Areas of exploration"),
  tag("6", "Time and space", "Areas of exploration"),
  tag("9", "Culture", "Concepts"),
  tag("15", "Receptive skills", "Skills"),
  tag("17", "Interactive skills", "Skills"),
  tag("18", "Culture, identity and community", "Fields of Inquiry for Global Issues"),
  tag("20", "Politics, power and justice", "Fields of Inquiry for Global Issues"),
  tag("110", "Prose: non-fiction", "Reading Log"),
];

const WORKS: Work[] = [
  { id: "77076", label: "Γκιακ by Δ. Παπαμάρκος (Prose: Fiction)" },
  { id: "77075", label: "Μπάρτλπυ, ο γραφέας by H. Melville (Prose: Fiction)" },
  { id: "77957", label: "Τα 400 χτυπήματα by F. Truffaut (Ταινία)" },
  { id: "77077", label: "Το μίσος by M. Kassovitz (Ταινία)" },
];

const pick = (queries: string[]) => resolveByLabel(queries, TAGS, "tag").map((t) => t.id);

test("commas flatten away", () => {
  expect(flatten("Culture, identity and community")).toBe(flatten("Culture identity and community"));
  expect(flatten("Paper 1: Guided analysis")).toBe(flatten("Paper 1 — Guided Analysis"));
});

test("Notion's comma-free names reach ManageBac's comma-bearing ones", () => {
  // These are exactly the values stored in the Notion multi-selects.
  expect(pick(["Culture identity and community"])).toEqual(["18"]);
  expect(pick(["Politics power and justice"])).toEqual(["20"]);
  expect(pick(["Readers writers and texts"])).toEqual(["5"]);
  expect(pick(["Prose: Non-Fiction"])).toEqual(["110"]);
  expect(pick(["Paper 1 — Guided Analysis"])).toEqual(["1"]);
  expect(pick(["Interactive"])).toEqual(["17"]);
});

test("an exact label still beats a longer one containing it", () => {
  // "Culture" must not be swallowed by "Culture, identity and community".
  expect(pick(["Culture"])).toEqual(["9"]);
});

test("category-qualified input round-trips from the preview", () => {
  expect(pick(["Concepts/Culture"])).toEqual(["9"]);
  expect(pick(["Concepts / Culture"])).toEqual(["9"]);
});

test("renamed Notion works reach the right ManageBac work", () => {
  const ids = resolveByLabel(
    ["Το μίσος", "Τα 400 χτυπήματα", "Μπάρτλπυ ο γραφέας", "Γκιακ"],
    WORKS,
    "work",
  ).map((w) => w.id);
  expect(ids).toEqual(["77077", "77957", "77075", "77076"]);
});

test("an unknown label is rejected rather than guessed", () => {
  // The pre-rename Notion value. It must fail loudly, not silently mis-tag.
  expect(() => resolveByLabel(["La Haine"], WORKS, "work")).toThrow(/No work matches/);
});

test("a genuinely ambiguous query is rejected", () => {
  expect(() => pick(["Paper"])).toThrow(/matches 2/);
});

// A ManageBac label can contain a comma, which is also the list delimiter.
// Splitting first made "Culture, identity and community" resolve to
// Concepts/Culture plus a stray Field, silently and with exit code 0.
const pickList = (raw: string[]) => portfolioResolveLabels(raw, TAGS, "tag").map((t) => t.id);

test("a comma-carrying label survives as one tag", () => {
  expect(pickList(["Culture, identity and community"])).toEqual(["18"]);
  expect(pickList(["Politics, power and justice"])).toEqual(["20"]);
});

test("a plain list is still split", () => {
  expect(pickList(["Individual oral,Time and space"])).toEqual(["4", "6"]);
  expect(pickList(["Individual oral, Time and space"])).toEqual(["4", "6"]);
});

test("repeating the flag carries several comma-bearing labels", () => {
  expect(pickList(["Culture, identity and community", "Politics, power and justice"]))
    .toEqual(["18", "20"]);
});

test("the comma-free Notion spelling still resolves to the Field", () => {
  expect(pickList(["Culture identity and community"])).toEqual(["18"]);
});

test("a bare Culture still means the concept", () => {
  expect(pickList(["Culture"])).toEqual(["9"]);
});
