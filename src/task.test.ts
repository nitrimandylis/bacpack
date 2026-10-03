// The task page parser and the title picker. Fixture is the description block
// of a real core task page, trimmed and with the school renamed.

import { expect, test } from "bun:test";
import { parseTaskPage, pickTask } from "./task.ts";
import type { Task } from "./due.ts";

const page = `<div class='h4'>Description</div>
<div class="show-more"><div class="fr-view"><p><a href="https://acme.managebac.com/attachments/abc--123" class="fr-file" data-name="paper2.pdf" rel="noopener" target="_blank"><span><span class="fr-inner">paper2.pdf</span><span class="fr-file-size">161.27 KB</span></span></a></p><p>Dear students,</p><ul><li>study sections B2.2.1 (page 342)</li><li>answer all the review questions in pages 356 and 357</li></ul><p>Upload your answers here</p></div>
</div></div>
<hr class='divider mx-n6 my-4' />
<h3>Dropbox</h3>`;

test("reads the description without the attachment text", () => {
  const { description } = parseTaskPage(page);
  expect(description).toBe(
    "Dear students,\nstudy sections B2.2.1 (page 342)\nanswer all the review questions in pages 356 and 357\nUpload your answers here",
  );
});

test("reads attachments as session paths", () => {
  expect(parseTaskPage(page).attachments).toEqual([
    { name: "paper2.pdf", size: "161.27 KB", path: "/attachments/abc--123" },
  ]);
});

test("a page with no description is empty, not an error", () => {
  expect(parseTaskPage("<h3>Dropbox</h3>")).toEqual({ description: "", attachments: [] });
});

const make = (title: string, subject: string): Task => ({
  title, subject, when: "Oct 7", due: null, badges: [], action: null, url: `/student/${title}/${subject}`,
});
const tasks = [make("ML + Case Study Training", "CS Group 2"), make("ML + Case Study Training", "CS Group 2 HL"), make("Stacks + Queues", "CS Group 2")];

test("a unique title substring picks one task", () => {
  expect(pickTask(tasks, "stacks").title).toBe("Stacks + Queues");
});

test("a shared title is an error until --class narrows it", () => {
  expect(() => pickTask(tasks, "case study")).toThrow("matches 2 tasks");
  expect(pickTask(tasks, "case study", "group 2 hl").subject).toBe("CS Group 2 HL");
});

test("a url picks exactly that task", () => {
  expect(pickTask(tasks, "/student/Stacks + Queues/CS Group 2").title).toBe("Stacks + Queues");
});
