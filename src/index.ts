#!/usr/bin/env bun
// bacpack: a ManageBac CLI.
//
// Writes always print a preview and stop. Nothing is sent without --confirm.

import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveClass, listClasses } from "./client.ts";
import { fetchTasks, withinDays, type Task } from "./due.ts";
import * as cas from "./cas.ts";
import * as portfolio from "./portfolio.ts";
import * as classes from "./classes.ts";

const HELP = `bacpack - ManageBac from the terminal

  bacpack due [--days N] [--json]
  bacpack classes [--json]

  bacpack cas list [--json]
  bacpack cas outcomes | cas groups
  bacpack cas add --name TEXT --start ISO --end ISO  [experience flags] [--confirm]
  bacpack cas edit --experience NAME                 [experience flags] [--confirm]
  bacpack cas delete --experience NAME [--confirm]
  bacpack cas reflect --experience NAME --body-file FILE.html [--confirm]

  experience flags (on edit, anything omitted keeps its current value):
    --creativity H  --action H  --service H     hours per strand
    --service-type direct|indirect|advocacy|research
    --approaches ongoing,school-based,community-based,individual
    --outcomes a,b        --group NAME          --notes-file FILE
    --project             --notify-advisor      (both default off)
    --supervisor-name/-title/-email/-phone TEXT

  bacpack class units --class NAME [--json]
  bacpack class files --class NAME [--json] [--match TEXT] [--download DIR]
  bacpack class discussions --class NAME [--json]

  bacpack portfolio list --class NAME [--json]
  bacpack portfolio tags --class NAME [--json]
  bacpack portfolio add --class NAME --body-file FILE.html
                        [--tags a,b] [--works a,b] [--confirm]
  bacpack portfolio edit --class NAME --id N
                        [--body-file FILE.html] [--tags a,b] [--works a,b] [--confirm]
  bacpack portfolio star --class NAME --id N [--confirm]
  bacpack portfolio delete --class NAME --id N [--confirm]

--class takes part of a class name, not an id, e.g. --class greek
--match takes part of a folder or file name, e.g. --match "paper 2"
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
    download: { type: "string" },
    match: { type: "string" },
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
    "service-type": { type: "string" },
    approaches: { type: "string" },
    group: { type: "string" },
    "supervisor-name": { type: "string" },
    "supervisor-title": { type: "string" },
    "supervisor-email": { type: "string" },
    "supervisor-phone": { type: "string" },
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

// Returns undefined when the flag was not passed, so `cas edit` can tell
// "leave it alone" apart from "set it to zero".
function hours(flag: string): number | undefined {
  const value = values[flag as keyof typeof values];
  if (typeof value !== "string" || !value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`--${flag} must be a number of hours.`);
  return parsed;
}

function text(flag: string): string | undefined {
  const value = values[flag as keyof typeof values];
  return typeof value === "string" && value ? value : undefined;
}

function resolveServiceType(query: string): string {
  const needle = query.toLowerCase();
  for (const [id, label] of Object.entries(cas.SERVICE_ACTION_TYPES)) {
    if (id === needle || label.toLowerCase() === needle) return id;
  }
  throw new Error(
    `--service-type must be one of: ${Object.values(cas.SERVICE_ACTION_TYPES).join(", ").toLowerCase()}`,
  );
}

function resolveApproaches(queries: string[]): Record<cas.Approach, boolean> {
  const chosen: Record<cas.Approach, boolean> = {
    ongoing: false,
    school_based: false,
    community_based: false,
    individual: false,
  };
  for (const query of queries) {
    const key = query.toLowerCase().replace(/-/g, "_") as cas.Approach;
    if (!(key in chosen)) {
      throw new Error(`Unknown approach "${query}". Use: ${cas.APPROACHES.join(", ").replace(/_/g, "-")}`);
    }
    chosen[key] = true;
  }
  return chosen;
}

// Builds the field set for both add and edit: start from `base` (blank for
// add, the live record for edit) and override only what was passed.
async function experienceFromFlags(base: cas.ExperienceFields): Promise<cas.ExperienceFields> {
  const next: cas.ExperienceFields = { ...base, approaches: { ...base.approaches } };

  if (text("name")) next.name = text("name")!;
  if (text("start")) next.startDate = cas.toManageBacDate(text("start")!);
  if (text("end")) next.endDate = cas.toManageBacDate(text("end")!);

  const creativity = hours("creativity");
  const action = hours("action");
  const service = hours("service");
  if (creativity !== undefined) next.creativityHours = creativity;
  if (action !== undefined) next.actionHours = action;
  if (service !== undefined) next.serviceHours = service;

  if (values.project === true) next.project = true;
  if (text("service-type")) next.serviceActionType = resolveServiceType(text("service-type")!);
  if (text("approaches")) next.approaches = resolveApproaches(commaList("approaches"));
  if (text("notes-file")) next.notes = readFile("notes-file");

  if (text("outcomes")) {
    next.outcomeIds = cas
      .resolveOutcomes(commaList("outcomes"), await cas.fetchOutcomes())
      .map((outcome) => outcome.id);
  }

  if (text("group")) {
    const groups = await cas.fetchGroups();
    const needle = text("group")!.toLowerCase();
    const hits = groups.filter((group) => group.label.toLowerCase().includes(needle));
    if (hits.length !== 1) {
      const listing = (hits.length ? hits : groups).map((g) => `  ${g.label}`).join("\n");
      throw new Error(`--group "${text("group")}" matched ${hits.length} groups:\n${listing}`);
    }
    next.groupId = hits[0].id;
  }

  if (text("supervisor-name")) next.supervisorName = text("supervisor-name")!;
  if (text("supervisor-title")) next.supervisorTitle = text("supervisor-title")!;
  if (text("supervisor-email")) next.supervisorEmail = text("supervisor-email")!;
  if (text("supervisor-phone")) next.supervisorPhone = text("supervisor-phone")!;

  next.notifyAdvisor = values["notify-advisor"] === true;
  return next;
}

function experiencePreview(fields: cas.ExperienceFields): [string, string][] {
  const on = cas.APPROACHES.filter((a) => fields.approaches[a]).map((a) => a.replace(/_/g, "-"));
  return [
    ["name", fields.name],
    ["dates", `${fields.startDate} to ${fields.endDate}`],
    ["creativity", `${fields.creativityHours} h`],
    ["action", `${fields.actionHours} h`],
    ["service", `${fields.serviceHours} h`],
    ["service type", cas.SERVICE_ACTION_TYPES[fields.serviceActionType] ?? "(none)"],
    ["approaches", on.join(", ") || "(none)"],
    ["CAS project", fields.project ? "yes" : "no"],
    ["outcomes", fields.outcomeIds.length ? `${fields.outcomeIds.length} selected` : "(none)"],
    ["group", fields.groupId || "(none)"],
    ["supervisor", fields.supervisorName || "(none)"],
    ["notes", fields.notes ? `${fields.notes.length} chars` : "(none)"],
    ["email advisor", fields.notifyAdvisor ? "YES" : "no"],
  ];
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
    const fields = await experienceFromFlags(cas.emptyFields());
    if (!fields.name) throw new Error("--name is required.");
    if (!fields.startDate || !fields.endDate) throw new Error("--start and --end are required.");
    if (fields.creativityHours + fields.actionHours + fields.serviceHours === 0) {
      throw new Error("Give at least one of --creativity, --action, --service.");
    }
    if (!previewed(experiencePreview(fields))) return;
    await cas.createExperience(fields);
    console.log("Posted.");
    return;
  }

  if (command === "cas" && sub === "edit") {
    const experience = await cas.resolveExperience(required("experience"));
    const current = await cas.fetchExperienceFields(experience.id);
    const fields = await experienceFromFlags(current);
    if (!previewed([["editing", `${experience.name} (${experience.id})`], ...experiencePreview(fields)])) return;
    await cas.updateExperience(experience.id, fields);
    console.log("Saved.");
    return;
  }

  if (command === "cas" && sub === "delete") {
    const experience = await cas.resolveExperience(required("experience"));
    const ok = previewed([
      ["DELETE", `${experience.name} (${experience.id})`],
      ["hours", experience.hours.join(", ") || "(none)"],
      ["reflections", experience.reflections],
    ]);
    if (!ok) return;
    await cas.deleteExperience(experience.id);
    console.log("Deleted.");
    return;
  }

  if (command === "cas" && sub === "groups") {
    const groups = await cas.fetchGroups();
    print(groups, groups.map((g) => `${g.id}  ${g.label}`));
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

  if (command === "class") {
    const klass = await resolveClass(required("class"));
    if (sub === "units") {
      const units = await classes.listUnits(klass.id);
      print(units, units.map((u) => `${u.status.padEnd(10)} ${u.title}  [${u.badges.join(", ")}]`));
      return;
    }
    if (sub === "files") {
      const all = await classes.listFiles(klass.id);
      const files = values.match ? classes.matching(all, values.match) : all;
      // Downloading nothing because a needle was a typo must not look like a
      // class with no files.
      if (values.match && files.length === 0) {
        throw new Error(
          `Nothing in ${klass.name} matches "${values.match}".\n` +
            `Run without --match to see what is there.`,
        );
      }
      const dir = values.download;
      if (!dir) {
        print(files, files.map((f) => `${(f.folder || ".").padEnd(20)}  ${f.name}`));
        return;
      }
      // Not a write to ManageBac, so no --confirm: this only touches your disk.
      const target = join(dir, classes.safeName(klass.name));
      const written = await classes.download(files, target);
      console.log(`${written.length} new of ${files.length} files -> ${target}`);
      return;
    }
    if (sub === "discussions") {
      const discussions = await classes.listDiscussions(klass.id);
      print(discussions, discussions.map((d) => `${d.id}  ${d.title}`));
      return;
    }
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
