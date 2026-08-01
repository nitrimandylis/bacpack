// Learner Portfolio reflections.
//
// The UI shows seven categories. The form has two: Works go in oral_work_ids,
// and the other six all flatten into one evidence_tag_ids list. There is no
// title field, so a title has to be the first block of the body HTML.

import { get, post, csrfToken, stripTags } from "./client.ts";

export type Tag = { id: string; label: string; category: string };
export type Work = { id: string; label: string };
export type Entry = { id: string; date: string; tags: string[]; body: string };

function reflectionsPath(classId: string): string {
  return `/student/classes/${classId}/learner_portfolio/reflections`;
}

export async function listEntries(classId: string): Promise<Entry[]> {
  const html = await get(reflectionsPath(classId));
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

export function resolveByLabel<T extends { id: string; label: string; category?: string }>(
  queries: string[],
  available: T[],
  kind: string,
): T[] {
  const show = (item: T) => (item.category ? `${item.category} / ${item.label}` : item.label);

  return queries.map((query) => {
    // An exact id is accepted so scripts can pin a value.
    const byId = available.find((item) => item.id === query);
    if (byId) return byId;

    const needle = query.toLowerCase();

    // An exact label wins outright, otherwise "Culture" is forever ambiguous
    // against "Culture, identity and community".
    const exact = available.filter((item) => item.label.toLowerCase() === needle);
    if (exact.length === 1) return exact[0];

    const hits = available.filter((item) => item.label.toLowerCase().includes(needle));
    if (hits.length === 1) return hits[0];

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
