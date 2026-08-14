// Learner Portfolio reflections.
//
// The UI shows seven categories. The form has two: Works go in oral_work_ids,
// and the other six all flatten into one evidence_tag_ids list. There is no
// title field, so a title has to be the first block of the body HTML.

import { get, post, csrfToken, stripTags, decodeEntities } from "./client.ts";

export type Tag = { id: string; label: string; category: string };
export type Work = { id: string; label: string };
export type Entry = { id: string; date: string; tags: string[]; body: string };

function reflectionsPath(classId: string): string {
  return `/student/classes/${classId}/learner_portfolio/reflections`;
}

function parseEntries(html: string): Entry[] {
  const blocks = html.split("journal-evidence").slice(1);

  return blocks.map((block) => ({
    id: block.match(/id='evidence-(\d+)'/)?.[1] ?? "",
    date: block.match(/<span class='padding-right'>([^<]+)<\/span>/)?.[1].trim() ?? "",
    tags: [...block.matchAll(/label label-outcome'>([^<]*)<\/div>/g)].map((m) => stripTags(m[1])),
    // ponytail: the body is a slice, not a parse. It is a list preview, and
    // `portfolio list --json` is for skimming, not for round-tripping HTML.
    body: stripTags(block.split("class='body'")[1] ?? "").slice(0, 200),
  }));
}

// ManageBac paginates the portfolio at ten entries a page, so reading the index
// once returns the newest ten and nothing else, with exit code 0. That reads as
// a complete list. A Greek class with sixteen entries reported ten, and the six
// missing ones looked like Notion rows wrongly marked as posted.
//
// Pagination is a path segment, not a query parameter. Past the last page the
// server still answers 200, with no entries on it.
export async function listEntries(
  classId: string,
  // Injected so the paging loop is testable without mocking the whole client,
  // which leaks into every other test file in the same run.
  fetchPage: (path: string) => Promise<string> = get,
): Promise<Entry[]> {
  const entries: Entry[] = [];
  const seen = new Set<string>();

  for (let page = 1; ; page++) {
    const path = page === 1 ? reflectionsPath(classId) : `${reflectionsPath(classId)}/page/${page}`;
    const fresh = parseEntries(await fetchPage(path)).filter((entry) => !seen.has(entry.id));

    // Stops on an empty page, and also on a server that clamps an out-of-range
    // page back to the first one rather than emptying it.
    if (fresh.length === 0) return entries;

    for (const entry of fresh) seen.add(entry.id);
    entries.push(...fresh);
  }
}

// Works are per class and change every year, and the tag ids belong to the IB
// taxonomy, so both are read from the live form rather than hardcoded.
export async function fetchTaxonomy(classId: string): Promise<{ tags: Tag[]; works: Work[] }> {
  const html = await get(`${reflectionsPath(classId)}/new`);
  const start = html.indexOf('id="new_evidence"');
  if (start < 0) throw new Error("Could not find the new-reflection form. The layout changed.");
  const form = html.slice(start, html.indexOf("</form>", start));

  // Each option is <label for="evidence_<kind>_<id>"><input .../>Text</label>,
  // and each group is preceded by a bare <label class="check_boxes ...">Name</label>.
  const works: Work[] = [];
  for (const match of form.matchAll(
    /<label for="evidence_oral_work_ids_(\d+)">\s*<input[^>]*>([^<]*)<\/label>/g,
  )) {
    works.push({ id: match[1], label: stripTags(match[2]) });
  }

  // Walk the form in order so each tag keeps the heading above it.
  const tags: Tag[] = [];
  let category = "";
  const walker =
    /<label class="check_boxes optional">([^<]+)<\/label>|<label for="evidence_evidence_tag_ids_(\d+)">\s*<input[^>]*>([^<]*)<\/label>/g;
  for (const match of form.matchAll(walker)) {
    if (match[1] !== undefined) {
      category = stripTags(match[1]);
    } else {
      tags.push({ id: match[2], label: stripTags(match[3]), category });
    }
  }

  if (tags.length === 0) throw new Error("Read no tags off the new-reflection form.");
  return { tags, works };
}

// Flattens punctuation so labels from different systems can be compared.
// Notion cannot store a comma in a select option at all, while ManageBac
// writes "Culture, identity and community" and "Paper 1: Guided analysis".
// Matching them exactly is impossible by construction, so both sides get
// their punctuation reduced to spaces before comparison.
export function flatten(text: string): string {
  return text
    .toLowerCase()
    .replace(/[,:;.–—-]/g, " ")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

const show = <T extends { label: string; category?: string }>(item: T) =>
  item.category ? `${item.category} / ${item.label}` : item.label;

// The single item a query names, or null when it names none or several.
function findOne<T extends { id: string; label: string; category?: string }>(
  query: string,
  available: T[],
): T | null {
  // An exact id is accepted so scripts can pin a value.
  const byId = available.find((item) => item.id === query);
  if (byId) return byId;

  const needle = flatten(query);

  // Previews print "Category/Label", so accept that back as input rather
  // than making the tool's own output invalid.
  const qualified = available.filter((item) => flatten(show(item)) === needle);
  if (qualified.length === 1) return qualified[0];

  // An exact label wins outright, otherwise "Culture" is forever ambiguous
  // against "Culture, identity and community".
  const exact = available.filter((item) => flatten(item.label) === needle);
  if (exact.length === 1) return exact[0];

  const hits = available.filter((item) => flatten(item.label).includes(needle));
  if (hits.length === 1) return hits[0];

  return null;
}

export function resolveByLabel<T extends { id: string; label: string; category?: string }>(
  queries: string[],
  available: T[],
  kind: string,
): T[] {
  return queries.map((query) => {
    const found = findOne(query, available);
    if (found) return found;

    const hits = available.filter((item) => flatten(item.label).includes(flatten(query)));
    if (hits.length === 0) {
      throw new Error(
        `No ${kind} matches "${query}". Available:\n${available.map((i) => `  ${show(i)}`).join("\n")}`,
      );
    }
    throw new Error(
      `"${query}" matches ${hits.length} ${kind}s, be more specific:\n` +
        hits.map((i) => `  ${show(i)}`).join("\n"),
    );
  });
}

// `--tags a,b` is a list, but a ManageBac label can itself contain a comma:
// "Culture, identity and community". Splitting on the comma first turned that
// one label into "Culture", which exact-matches Concepts/Culture and binds
// silently, plus a fragment that matched the Field it came from. The result was
// a wrong tag and a duplicate, with exit code 0.
//
// So try each occurrence whole before splitting it. A real list never resolves
// as a single label, and a comma-carrying label always does. Pass the flag more
// than once when several such labels are needed.
export function resolveLabels<T extends { id: string; label: string; category?: string }>(
  raw: string[],
  available: T[],
  kind: string,
): T[] {
  const out: T[] = [];
  for (const occurrence of raw) {
    const whole = findOne(occurrence, available);
    if (whole) {
      out.push(whole);
      continue;
    }
    const parts = occurrence.split(",").map((part) => part.trim()).filter(Boolean);
    out.push(...resolveByLabel(parts, available, kind));
  }
  return out;
}

export function buildForm(body: string, tags: Tag[], works: Work[], token: string): URLSearchParams {
  const form = new URLSearchParams();
  form.set("authenticity_token", token);
  form.set("type", "JournalEvidence");
  form.set("evidence[body]", body);

  form.append("evidence[oral_work_ids][]", "");
  for (const work of works) form.append("evidence[oral_work_ids][]", work.id);

  form.append("evidence[evidence_tag_ids][]", "");
  for (const tag of tags) form.append("evidence[evidence_tag_ids][]", tag.id);

  form.set("commit", "Add Entry");
  return form;
}

export async function createEntry(
  classId: string,
  body: string,
  tags: Tag[],
  works: Work[],
): Promise<void> {
  const html = await get(`${reflectionsPath(classId)}/new`);
  await post(reflectionsPath(classId), buildForm(body, tags, works, csrfToken(html)));
}

export type CurrentEntry = { body: string; tagIds: string[]; workIds: string[] };

// The edit form posts every field, so anything not sent is cleared. Read what
// is already ticked and treat it as the default, or `--body-file` alone would
// silently wipe an entry's whole taxonomy.
export async function fetchEntry(classId: string, entryId: string): Promise<CurrentEntry> {
  const html = await get(`${reflectionsPath(classId)}/${entryId}/edit`);
  if (!html.includes("edit_evidence")) {
    throw new Error(`No entry ${entryId} in that class, or the edit form changed shape.`);
  }

  const checkedIds = (kind: string): string[] =>
    [...html.matchAll(new RegExp(`<input[^>]*id="evidence_${kind}_(\\d+)"[^>]*>`, "g"))]
      .filter((match) => match[0].includes("checked"))
      .map((match) => match[1]);

  const body = html.match(/name="evidence\[body\]"[^>]*>([\s\S]*?)<\/textarea>/)?.[1] ?? "";
  return {
    body: decodeEntities(body),
    tagIds: checkedIds("evidence_tag_ids"),
    workIds: checkedIds("oral_work_ids"),
  };
}

export async function updateEntry(
  classId: string,
  entryId: string,
  body: string,
  tags: Tag[],
  works: Work[],
): Promise<void> {
  const path = `${reflectionsPath(classId)}/${entryId}`;
  const html = await get(`${path}/edit`);
  const form = buildForm(body, tags, works, csrfToken(html));
  form.set("_method", "patch");
  form.set("commit", "Save Entry");
  await post(path, form);
}

async function methodCall(path: string, method: string, referer: string): Promise<void> {
  const html = await get(referer);
  const form = new URLSearchParams();
  form.set("authenticity_token", csrfToken(html));
  form.set("_method", method);
  await post(path, form);
}

export async function deleteEntry(classId: string, entryId: string): Promise<void> {
  await methodCall(`${reflectionsPath(classId)}/${entryId}`, "delete", reflectionsPath(classId));
}

export async function starEntry(classId: string, entryId: string): Promise<void> {
  await methodCall(
    `${reflectionsPath(classId)}/${entryId}/star`,
    "patch",
    reflectionsPath(classId),
  );
}
