// CAS experiences: list them, and create one.

import { get, post, csrfToken, stripTags, decodeEntities } from "./client.ts";

const CAS_PATH = "/student/ib/activity/cas";
const CAS_NEW_PATH = "/student/ib/activity/cas/new";

export type Experience = {
  id: string;
  name: string;
  badges: string[];
  hours: string[];
  reflections: string;
};

export type Outcome = { id: string; label: string };

export async function listExperiences(): Promise<Experience[]> {
  const html = await get(CAS_PATH);
  const cards = html.split("activity-tile").slice(1);
  const experiences: Experience[] = [];

  for (const card of cards) {
    const link = card.match(/href="\/student\/ib\/activity\/cas\/(\d+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!link) continue;
    experiences.push({
      id: link[1],
      name: stripTags(link[2]),
      badges: [...card.matchAll(/badge-label">([^<]+)<\/span>/g)].map((m) => m[1].trim()),
      hours: [...card.matchAll(/hour-type-hint-\w"[^>]*data-bs-title="([^"]+)"/g)].map((m) => m[1]),
      reflections: card.match(/reflections-count'>([^<]+)</)?.[1].trim() ?? "0 reflections",
    });
  }

  if (experiences.length === 0 && html.includes("fusion-card-list")) return experiences;
  if (experiences.length === 0) {
    throw new Error("Could not read any CAS experiences. The selectors have probably rotted.");
  }
  return experiences;
}

// The learning-outcome ids are per school, so read them off the form rather
// than hardcoding numbers that are meaningless anywhere else.
export async function fetchOutcomes(): Promise<Outcome[]> {
  const html = await get(CAS_NEW_PATH);
  const outcomes: Outcome[] = [];
  const pattern = /id="cas_activity_learning_outcome_ids_(\d+)"[^>]*>/g;

  for (const match of html.matchAll(pattern)) {
    const after = html.slice(match.index + match[0].length, match.index + match[0].length + 400);
    const label = stripTags(after.split("<input")[0].split("<div")[0]);
    if (label) outcomes.push({ id: match[1], label });
  }
  if (outcomes.length === 0) {
    throw new Error("Could not read the CAS learning outcomes from the create form.");
  }
  return outcomes;
}

export function resolveOutcomes(queries: string[], available: Outcome[]): Outcome[] {
  return queries.map((query) => {
    const needle = query.toLowerCase();
    const hits = available.filter((outcome) => outcome.label.toLowerCase().includes(needle));
    if (hits.length === 1) return hits[0];
    const listing = available.map((o) => `  ${o.label}`).join("\n");
    if (hits.length === 0) {
      throw new Error(`No learning outcome matches "${query}". Available:\n${listing}`);
    }
    throw new Error(`"${query}" matches ${hits.length} outcomes, be more specific:\n${listing}`);
  });
}

// ManageBac's date pickers post a human-readable date, not ISO.
export function toManageBacDate(iso: string): string {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`Dates must be ISO, e.g. 2026-09-01. Got "${iso}".`);
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const month = months[Number(match[2]) - 1];
  if (!month) throw new Error(`Not a real month: "${iso}".`);
  return `${month} ${Number(match[3])}, ${match[1]}`;
}

// Service action types are ManageBac-global and match the IB's four kinds.
export const SERVICE_ACTION_TYPES: Record<string, string> = {
  "1": "Direct",
  "2": "Indirect",
  "3": "Advocacy",
  "4": "Research",
};

export const APPROACHES = ["ongoing", "school_based", "community_based", "individual"] as const;
export type Approach = (typeof APPROACHES)[number];

// One shape for both create and edit, so an edit cannot silently drop a field
// that the create form set.
export type ExperienceFields = {
  name: string;
  startDate: string; // already in ManageBac's "August 1, 2026" form
  endDate: string;
  creativityHours: number;
  actionHours: number;
  serviceHours: number;
  project: boolean;
  serviceActionType: string; // "" or "1".."4"
  approaches: Record<Approach, boolean>;
  supervisorName: string;
  supervisorTitle: string;
  supervisorEmail: string;
  supervisorPhone: string;
  groupId: string;
  notes: string;
  outcomeIds: string[];
  notifyAdvisor: boolean;
};

export function emptyFields(): ExperienceFields {
  return {
    name: "",
    startDate: "",
    endDate: "",
    creativityHours: 0,
    actionHours: 0,
    serviceHours: 0,
    project: false,
    serviceActionType: "",
    approaches: { ongoing: false, school_based: false, community_based: false, individual: false },
    supervisorName: "",
    supervisorTitle: "",
    supervisorEmail: "",
    supervisorPhone: "",
    groupId: "",
    notes: "",
    outcomeIds: [],
    notifyAdvisor: false,
  };
}

export function buildForm(fields: ExperienceFields, token: string, commit: string): URLSearchParams {
  const form = new URLSearchParams();
  form.set("authenticity_token", token);
  form.set("cas_activity[name]", fields.name);
  form.set("cas_activity[start_date]", fields.startDate);
  form.set("cas_activity[end_date]", fields.endDate);
  form.set("cas_activity[cas_project]", fields.project ? "1" : "0");

  // Each strand is a checkbox plus an hours field. Hours above zero means the
  // strand is ticked; that is the only combination ManageBac renders sensibly.
  const strands: [string, number][] = [
    ["creativity", fields.creativityHours],
    ["action", fields.actionHours],
    ["service", fields.serviceHours],
  ];
  for (const [strand, hours] of strands) {
    form.set(`cas_activity[${strand}]`, hours > 0 ? "1" : "0");
    form.set(`cas_activity[${strand}_hours]`, hours.toFixed(1));
  }

  form.set("cas_activity[service_action_type]", fields.serviceActionType);
  for (const approach of APPROACHES) {
    form.set(`cas_activity[${approach}_approach]`, fields.approaches[approach] ? "1" : "0");
  }

  form.set("cas_activity[supervisor_name]", fields.supervisorName);
  form.set("cas_activity[supervisor_title]", fields.supervisorTitle);
  form.set("cas_activity[supervisor_email]", fields.supervisorEmail);
  form.set("cas_activity[supervisor_contact_number]", fields.supervisorPhone);
  // The edit form has no group select at all, so a group is settable only at
  // creation and cannot be read back. Sending an empty value would risk
  // clearing it on every edit, so the field is omitted unless it has a value.
  if (fields.groupId) form.set("cas_activity[group_id]", fields.groupId);

  form.set("cas_activity[notes]", fields.notes);
  form.append("cas_activity[learning_outcome_ids][]", "");
  for (const id of fields.outcomeIds) {
    form.append("cas_activity[learning_outcome_ids][]", id);
  }

  // This checkbox ships pre-checked in the HTML. Inheriting the default emails
  // the CAS advisor on every single entry, so it is always sent explicitly.
  form.set("cas_activity[notify_cas_advisor_email]", fields.notifyAdvisor ? "1" : "0");
  form.set("commit", commit);
  return form;
}

export async function createExperience(fields: ExperienceFields): Promise<void> {
  const html = await get(CAS_NEW_PATH);
  await post(CAS_PATH, buildForm(fields, csrfToken(html), "Add CAS Experience"));
}

// The edit form posts every field, so read the current values and let the CLI
// override only what was passed. Same trap as the portfolio editor.
export async function fetchExperienceFields(experienceId: string): Promise<ExperienceFields> {
  const html = await get(`${CAS_PATH}/${experienceId}/edit`);
  if (!html.includes("edit_cas_activity")) {
    throw new Error(`No experience ${experienceId}, or the edit form changed shape.`);
  }

  // Attribute order is not stable in this markup: `checked` appears before
  // `name` on some inputs and after it on others. Pull each tag out whole and
  // read its attributes independently rather than assuming an order.
  const tags = html.match(/<input\b[^>]*>/g) ?? [];
  const attr = (tag: string, name: string): string =>
    tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? "";
  const named = (field: string): string[] =>
    tags.filter((tag) => attr(tag, "name") === `cas_activity[${field}]`);

  const value = (field: string): string => {
    const tag = named(field).find((candidate) => attr(candidate, "type") !== "hidden");
    return tag ? attr(tag, "value") : "";
  };
  const ticked = (field: string): boolean =>
    named(field).some((tag) => attr(tag, "type") === "checkbox" && tag.includes("checked"));

  const fields = emptyFields();
  fields.name = decodeEntities(value("name"));
  fields.startDate = value("start_date");
  fields.endDate = value("end_date");
  fields.creativityHours = Number(value("creativity_hours")) || 0;
  fields.actionHours = Number(value("action_hours")) || 0;
  fields.serviceHours = Number(value("service_hours")) || 0;
  fields.project = ticked("cas_project");

  const chosenType = named("service_action_type").find(
    (tag) => attr(tag, "type") === "radio" && tag.includes("checked"),
  );
  fields.serviceActionType = chosenType ? attr(chosenType, "value") : "";

  for (const approach of APPROACHES) {
    fields.approaches[approach] = ticked(`${approach}_approach`);
  }

  fields.supervisorName = decodeEntities(value("supervisor_name"));
  fields.supervisorTitle = decodeEntities(value("supervisor_title"));
  fields.supervisorEmail = decodeEntities(value("supervisor_email"));
  fields.supervisorPhone = decodeEntities(value("supervisor_contact_number"));
  // Left blank on purpose. The edit form carries no group select, so there is
  // nothing to read; buildForm omits the field when it is empty rather than
  // posting a blank that could unlink the group.
  fields.groupId = "";
  fields.notes = decodeEntities(
    html.match(/name="cas_activity\[notes\]"[^>]*>([\s\S]*?)<\/textarea>/)?.[1] ?? "",
  );
  fields.outcomeIds = [...html.matchAll(/<input[^>]*id="cas_activity_learning_outcome_ids_(\d+)"[^>]*>/g)]
    .filter((match) => match[0].includes("checked"))
    .map((match) => match[1]);

  return fields;
}

export async function updateExperience(
  experienceId: string,
  fields: ExperienceFields,
): Promise<void> {
  const path = `${CAS_PATH}/${experienceId}`;
  const html = await get(`${path}/edit`);
  const form = buildForm(fields, csrfToken(html), "Save Changes");
  form.set("_method", "patch");
  await post(path, form);
}

export async function deleteExperience(experienceId: string): Promise<void> {
  const path = `${CAS_PATH}/${experienceId}`;
  const html = await get(path);
  const form = new URLSearchParams();
  form.set("authenticity_token", csrfToken(html));
  form.set("_method", "delete");
  await post(path, form);
}

export type Group = { id: string; label: string };

export async function fetchGroups(): Promise<Group[]> {
  const html = await get(CAS_NEW_PATH);
  const select = html.match(/<select[^>]*name="cas_activity\[group_id\]"[\s\S]*?<\/select>/)?.[0] ?? "";
  return [...select.matchAll(/<option value="(\d+)"[^>]*>([^<]*)</g)].map((match) => ({
    id: match[1],
    label: stripTags(match[2]),
  }));
}

export async function resolveExperience(query: string): Promise<Experience> {
  const all = await listExperiences();

  const byId = all.find((experience) => experience.id === query);
  if (byId) return byId;

  const needle = query.toLowerCase();
  const hits = all.filter((experience) => experience.name.toLowerCase().includes(needle));
  if (hits.length === 1) return hits[0];

  const listing = (items: Experience[]) => items.map((e) => `  ${e.name}`).join("\n");
  if (hits.length === 0) {
    throw new Error(`No experience matches "${query}". Yours:\n${listing(all)}`);
  }
  throw new Error(`"${query}" matches ${hits.length} experiences:\n${listing(hits)}`);
}

// A CAS reflection is the same JournalEvidence form the Learner Portfolio
// uses, but stripped down: body only.
//
// It deliberately does not send learning outcomes or a link. The create form
// carries no learning-outcome checkboxes at all, and an `evidence[url]` value
// posts without error and then appears nowhere. Both were tested live on
// 2026-08-01 and silently dropped, so offering flags for them would print a
// confident preview and change nothing.
export function buildReflectionForm(body: string, token: string): URLSearchParams {
  const form = new URLSearchParams();
  form.set("authenticity_token", token);
  form.set("modal", "true");
  form.set("type", "JournalEvidence");
  form.set("evidence[body]", body);
  form.set("commit", "Add Entry");
  return form;
}

export async function addReflection(experienceId: string, body: string): Promise<void> {
  const path = `${CAS_PATH}/${experienceId}/reflections`;
  const html = await get(`${path}/new`);
  await post(path, buildReflectionForm(body, csrfToken(html)));
}
