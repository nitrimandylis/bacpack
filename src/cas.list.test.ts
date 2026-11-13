// The CAS Project flag is an icon on the experience tile, not a badge.

import { expect, test } from "bun:test";
import { parseExperiences } from "./cas.ts";

function tile(id: string, name: string, extra = ""): string {
  return `<div class='activity-tile'><a href="/student/ib/activity/cas/${id}">${name}</a>${extra}` +
    `<span class="badge-label">School-based</span><span class='reflections-count'>3 reflections</span></div>`;
}

test("a tile with the CAS Project icon is a project, one without is not", () => {
  const icon = `<img alt="CAS Project" class="sebo-icon icon-18" data-bs-title="CAS Project">`;
  const experiences = parseExperiences(tile("1", "Kizuna", icon) + tile("2", "Gym"));
  expect(experiences.map((e) => [e.name, e.project])).toEqual([["Kizuna", true], ["Gym", false]]);
  expect(experiences[0].badges).toEqual(["School-based"]);
});
