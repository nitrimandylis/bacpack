// The one check that matters: year inference and duplicate deadlines.
// Fixture is a real Tasks & Deadlines page saved on 2026-08-01.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { inferYear, parseWhen, parseTasks, dedupe } from "./due.ts";

const AUG_1_2026 = new Date(2026, 7, 1);
const fixture = readFileSync(new URL("../test/fixtures/tasks.html", import.meta.url), "utf8");

test("a later month is this school year", () => {
  expect(inferYear(8, 20, AUG_1_2026)).toBe(2026); // Sep 20
});

test("an earlier month has rolled into next year", () => {
  expect(inferYear(0, 15, AUG_1_2026)).toBe(2027); // Jan 15
});

test("earlier in the same month is next year, later is this year", () => {
  expect(inferYear(7, 30, AUG_1_2026)).toBe(2026);
  expect(inferYear(7, 1, AUG_1_2026)).toBe(2026); // today itself
  expect(new Date(2026, 7, 1) <= new Date(inferYear(7, 1, AUG_1_2026), 7, 1)).toBe(true);
});

test("parses a ManageBac time into a real date", () => {
  const due = parseWhen("Sep 20, 9:00 AM", AUG_1_2026);
  expect(due?.getFullYear()).toBe(2026);
  expect(due?.getMonth()).toBe(8);
  expect(due?.getDate()).toBe(20);
  expect(due?.getHours()).toBe(9);
});

test("midnight and noon do not collide", () => {
  expect(parseWhen("Sep 20, 12:00 AM", AUG_1_2026)?.getHours()).toBe(0);
  expect(parseWhen("Sep 20, 12:00 PM", AUG_1_2026)?.getHours()).toBe(12);
  expect(parseWhen("Sep 20, 11:00 PM", AUG_1_2026)?.getHours()).toBe(23);
});

test("reads the real page", () => {
  const tasks = parseTasks(fixture, AUG_1_2026);
  expect(tasks.length).toBe(2);
  expect(tasks[0].title).toBe("IA first draft");
  expect(tasks[0].subject).toContain("Maths AA HL");
  expect(tasks[0].when).toBe("Sep 20, 9:00 AM");
  expect(tasks[0].badges).toEqual(["Deadline", "Pending"]);
  expect(tasks[0].action).toBe("Submit Coursework");
});

test("the duplicated Math IA deadline survives dedupe as two rows", () => {
  // Same class, same day, different times and titles. Fuzzy matching here
  // would hide one of two real deadlines.
  const tasks = dedupe(parseTasks(fixture, AUG_1_2026));
  expect(tasks.length).toBe(2);
});

test("an exact repeat is dropped", () => {
  const tasks = parseTasks(fixture, AUG_1_2026);
  expect(dedupe([...tasks, ...tasks]).length).toBe(2);
});
