#!/usr/bin/env bun
// bacpack: a ManageBac CLI.
//
// Writes always print a preview and stop. Nothing is sent without --confirm.

import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { resolveClass, listClasses } from "./client.ts";
import { fetchTasks, withinDays, type Task } from "./due.ts";
import * as cas from "./cas.ts";
import * as portfolio from "./portfolio.ts";

const HELP = `bacpack - ManageBac from the terminal

  bacpack due [--days N] [--json]
  bacpack classes [--json]

  bacpack cas list [--json]
  bacpack cas outcomes
  bacpack cas add --name TEXT --start ISO --end ISO
                  [--creativity H] [--action H] [--service H]
                  [--outcomes a,b] [--notes-file FILE] [--project]
                  [--notify-advisor] [--confirm]
  bacpack cas reflect --experience NAME --body-file FILE.html [--confirm]

  bacpack portfolio list --class NAME [--json]
  bacpack portfolio tags --class NAME [--json]
  bacpack portfolio add --class NAME --body-file FILE.html
                        [--tags a,b] [--works a,b] [--confirm]
  bacpack portfolio edit --class NAME --id N
                        [--body-file FILE.html] [--tags a,b] [--works a,b] [--confirm]
  bacpack portfolio star --class NAME --id N [--confirm]
  bacpack portfolio delete --class NAME --id N [--confirm]

--class takes part of a class name, not an id, e.g. --class greek
Writes preview and exit without sending. Add --confirm to actually post.

Needs MANAGEBAC_SCHOOL (your subdomain) and ~/.config/managebac/cookie
`;

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    help: { type: "boolean", short: "h" },
    json: { type: "boolean" },
    days: { type: "string" },
    class: { type: "string" },
    confirm: { type: "boolean" },
    name: { type: "string" },
    start: { type: "string" },
    end: { type: "string" },
    creativity: { type: "string" },
    action: { type: "string" },
    service: { type: "string" },
    outcomes: { type: "string" },
    "notes-file": { type: "string" },
    project: { type: "boolean" },
    "notify-advisor": { type: "boolean" },
    "body-file": { type: "string" },
    tags: { type: "string" },
    works: { type: "string" },
    experience: { type: "string" },
    id: { type: "string" },
  },
});

function required(flag: string): string {
  const value = values[flag as keyof typeof values];
  if (typeof value !== "string" || !value) throw new Error(`--${flag} is required.`);
  return value;
}

function commaList(flag: string): string[] {
  const value = values[flag as keyof typeof values];
  if (typeof value !== "string" || !value) return [];
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function readFile(flag: string): string {
  const path = required(flag);
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new Error(`Could not read ${path}`);
  }
}

function hours(flag: string): number {
  const value = values[flag as keyof typeof values];
  if (typeof value !== "string" || !value) return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`--${flag} must be a number of hours.`);
  return parsed;
}

function print(data: unknown, lines: string[]): void {
  if (values.json) console.log(JSON.stringify(data, null, 2));
  else console.log(lines.length ? lines.join("\n") : "(nothing)");
}

function previewed(fields: [string, string][]): boolean {
  const width = Math.max(...fields.map(([label]) => label.length));
  console.log("");
  for (const [label, value] of fields) {
    console.log(`  ${label.padEnd(width)}  ${value}`);
  }
  console.log("");
  if (!values.confirm) {
    console.log("Preview only. Re-run with --confirm to post this to ManageBac.");
    return false;
  }
  return true;
}

function formatTask(task: Task): string {
  const flags = task.badges.length ? ` [${task.badges.join(", ")}]` : "";
  return `${task.when.padEnd(20)} ${task.title}\n${" ".repeat(21)}${task.subject}${flags}`;
}

async function main(): Promise<void> {
  if (values.help || positionals.length === 0) {
    console.log(HELP);
    return;
  }
  const [command, sub] = positionals;

  if (command === "due") {
    const now = new Date();
    let tasks = await fetchTasks(now);
    if (values.days) tasks = withinDays(tasks, Number(values.days), now);
    print(tasks, tasks.map(formatTask));
    return;
  }

  if (command === "classes") {
    const classes = await listClasses();
    print(classes, classes.map((klass) => `${klass.id}  ${klass.name}`));
    return;
  }

  if (command === "cas" && sub === "list") {
    const experiences = await cas.listExperiences();
    print(
      experiences,
      experiences.map((e) => `${e.name}\n  ${[...e.hours, ...e.badges, e.reflections].join(" | ")}`),
    );
    return;
  }

  if (command === "cas" && sub === "outcomes") {
    const outcomes = await cas.fetchOutcomes();
    print(outcomes, outcomes.map((o) => `${o.id}  ${o.label}`));
    return;
  }

  if (command === "cas" && sub === "add") {
    const available = await cas.fetchOutcomes();
    const outcomes = cas.resolveOutcomes(commaList("outcomes"), available);
    const experience: cas.NewExperience = {
      name: required("name"),
      start: required("start"),
      end: required("end"),
      creativityHours: hours("creativity"),
      actionHours: hours("action"),
      serviceHours: hours("service"),
      outcomes,
      notes: values["notes-file"] ? readFile("notes-file") : "",
      project: values.project === true,
      notifyAdvisor: values["notify-advisor"] === true,
    };
    if (experience.creativityHours + experience.actionHours + experience.serviceHours === 0) {
      throw new Error("Give at least one of --creativity, --action, --service.");
    }

    const ok = previewed([
      ["name", experience.name],
      ["dates", `${cas.toManageBacDate(experience.start)} to ${cas.toManageBacDate(experience.end)}`],
      ["creativity", `${experience.creativityHours} h`],
      ["action", `${experience.actionHours} h`],
      ["service", `${experience.serviceHours} h`],
      ["CAS project", experience.project ? "yes" : "no"],
      ["outcomes", outcomes.map((o) => o.label).join(", ") || "(none)"],
      ["notes", experience.notes ? `${experience.notes.length} chars` : "(none)"],
      ["email advisor", experience.notifyAdvisor ? "YES" : "no"],
    ]);
    if (!ok) return;

    await cas.createExperience(experience);
    console.log("Posted.");
    return;
  }

  if (command === "cas" && sub === "reflect") {
    const experience = await cas.resolveExperience(required("experience"));
    const body = readFile("body-file");

    const ok = previewed([
      ["experience", `${experience.name} (${experience.reflections})`],
      ["body", `${body.length} chars, starts: ${body.slice(0, 60).replace(/\s+/g, " ")}`],
    ]);
    if (!ok) return;

    await cas.addReflection(experience.id, body);
    console.log("Posted.");
    return;
  }

  if (command === "portfolio") {
    const klass = await resolveClass(required("class"));

    if (sub === "list") {
      const entries = await portfolio.listEntries(klass.id);
      print(entries, entries.map((e) => `${e.date}  [${e.tags.join(", ")}]\n  ${e.body}`));
      return;
    }

    if (sub === "tags") {
      const { tags, works } = await portfolio.fetchTaxonomy(klass.id);
      const lines = [
        ...works.map((w) => `work  ${w.id.padEnd(8)} ${w.label}`),
        ...tags.map((t) => `tag   ${t.id.padEnd(8)} ${t.category} / ${t.label}`),
      ];
      print({ works, tags }, lines);
      return;
    }

    if (sub === "add") {
      const body = readFile("body-file");
      const taxonomy = await portfolio.fetchTaxonomy(klass.id);
      const tags = portfolio.resolveByLabel(commaList("tags"), taxonomy.tags, "tag");
      const works = portfolio.resolveByLabel(commaList("works"), taxonomy.works, "work");

      const ok = previewed([
        ["class", klass.name],
        ["works", works.map((w) => w.label).join(", ") || "(none)"],
        ["tags", tags.map((t) => `${t.category}/${t.label}`).join(", ") || "(none)"],
        ["body", `${body.length} chars, starts: ${body.slice(0, 60).replace(/\s+/g, " ")}`],
      ]);
      if (!ok) return;

      await portfolio.createEntry(klass.id, body, tags, works);
      console.log("Posted.");
      return;
    }

    if (sub === "edit") {
      const entryId = required("id");
      const current = await portfolio.fetchEntry(klass.id, entryId);
      const taxonomy = await portfolio.fetchTaxonomy(klass.id);

      // Anything not passed keeps whatever the entry already has, because the
      // edit form overwrites every field it posts.
      const body = values["body-file"] ? readFile("body-file") : current.body;
      const tags = values.tags
        ? portfolio.resolveByLabel(commaList("tags"), taxonomy.tags, "tag")
        : portfolio.resolveByLabel(current.tagIds, taxonomy.tags, "tag");
      const works = values.works
        ? portfolio.resolveByLabel(commaList("works"), taxonomy.works, "work")
        : portfolio.resolveByLabel(current.workIds, taxonomy.works, "work");

      const kept = (changed: boolean) => (changed ? "" : "  (unchanged)");
      const ok = previewed([
        ["entry", `${entryId} in ${klass.name}`],
        ["works", (works.map((w) => w.label).join(", ") || "(none)") + kept(!!values.works)],
        [
          "tags",
          (tags.map((t) => `${t.category}/${t.label}`).join(", ") || "(none)") + kept(!!values.tags),
        ],
        ["body", `${body.length} chars` + kept(!!values["body-file"])],
      ]);
      if (!ok) return;

      await portfolio.updateEntry(klass.id, entryId, body, tags, works);
      console.log("Saved.");
      return;
    }

    if (sub === "star" || sub === "delete") {
      const entryId = required("id");
      const entries = await portfolio.listEntries(klass.id);
      const entry = entries.find((candidate) => candidate.id === entryId);
      if (!entry) throw new Error(`No entry ${entryId} on the first page of ${klass.name}.`);

      const ok = previewed([
        [sub === "star" ? "star/unstar" : "DELETE", `${entryId} in ${klass.name}`],
        ["dated", entry.date],
        ["tags", entry.tags.join(", ") || "(none)"],
        ["body", entry.body.slice(0, 80)],
      ]);
      if (!ok) return;

      if (sub === "star") await portfolio.starEntry(klass.id, entryId);
      else await portfolio.deleteEntry(klass.id, entryId);
      console.log(sub === "star" ? "Toggled." : "Deleted.");
      return;
    }
  }

  throw new Error(`Unknown command: ${positionals.join(" ")}\n\n${HELP}`);
}

main().catch((error: Error) => {
  console.error(`\n${error.message}\n`);
  process.exit(1);
});
