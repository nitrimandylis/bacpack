// CAS experiences: list them, and create one.

import { get, post, csrfToken, stripTags } from "./client.ts";

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

export type NewExperience = {
  name: string;
  start: string; // ISO
  end: string; // ISO
  creativityHours: number;
  actionHours: number;
  serviceHours: number;
  outcomes: Outcome[];
  notes: string;
  project: boolean;
  notifyAdvisor: boolean;
};

export function buildForm(experience: NewExperience, token: string): URLSearchParams {
  const form = new URLSearchParams();
  form.set("authenticity_token", token);
  form.set("cas_activity[name]", experience.name);
  form.set("cas_activity[start_date]", toManageBacDate(experience.start));
  form.set("cas_activity[end_date]", toManageBacDate(experience.end));
  form.set("cas_activity[cas_project]", experience.project ? "1" : "0");

  // Each strand is a checkbox plus an hours field. Hours above zero means the
  // strand is ticked; that is the only combination ManageBac renders sensibly.
  const strands: [string, number][] = [
    ["creativity", experience.creativityHours],
    ["action", experience.actionHours],
    ["service", experience.serviceHours],
  ];
  for (const [strand, hours] of strands) {
    form.set(`cas_activity[${strand}]`, hours > 0 ? "1" : "0");
    form.set(`cas_activity[${strand}_hours]`, hours.toFixed(1));
  }

  form.set("cas_activity[notes]", experience.notes);
  form.append("cas_activity[learning_outcome_ids][]", "");
  for (const outcome of experience.outcomes) {
    form.append("cas_activity[learning_outcome_ids][]", outcome.id);
  }

  // This checkbox ships pre-checked in the HTML. Inheriting the default emails
  // the CAS advisor on every single entry, so it is always sent explicitly.
  form.set("cas_activity[notify_cas_advisor_email]", experience.notifyAdvisor ? "1" : "0");
  form.set("commit", "Add CAS Experience");
  return form;
}

export async function createExperience(experience: NewExperience): Promise<void> {
  const html = await get(CAS_NEW_PATH);
  await post(CAS_PATH, buildForm(experience, csrfToken(html)));
}
