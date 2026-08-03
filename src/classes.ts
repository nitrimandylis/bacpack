// Class content: units, files and discussions.
//
// class_stream is deliberately absent. It renders no items in the static HTML
// for any class tested on 2026-08-01, so it is either hydrated by JavaScript
// or unused here. A command that always returns nothing is worse than none.

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { get, stripTags, decodeEntities } from "./client.ts";

export type Unit = { id: string; title: string; status: string; badges: string[] };
export type ClassFile = { name: string; folder: string; size: number; url: string };
export type Discussion = {
  id: string;
  title: string;
  author: string;
  category: string | null; // teachers fill this in inconsistently, often not at all
  postedAt: Date | null;
  posted: string; // exactly as ManageBac printed it
  body: string;
  url: string;
};

export async function listUnits(classId: string): Promise<Unit[]> {
  const html = await get(`/student/classes/${classId}/units`);
  const cards = html.split("fusion-card-item").slice(1);
  const units: Unit[] = [];

  for (const card of cards) {
    const link = card.match(/href="\/student\/classes\/\d+\/units\/(\d+)[^"]*"[^>]*>([^<]*)<\/a>/);
    if (!link) continue;
    units.push({
      id: link[1],
      title: stripTags(link[2]),
      status: card.match(/class='unit-component unit ([a-z ]*)'/)?.[1].trim() ?? "",
      badges: [...card.matchAll(/badge-label'>\s*([^<]+?)\s*<\/span>/g)].map((m) => m[1]),
    });
  }
  return units;
}

// Every file row carries its whole record in one data-ec3-info attribute:
// name, size, and a pre-signed CDN download_url that needs no cookie. So a
// folder page is one request and no per-file link resolution.
type Ec3Info = { download_url?: string; name?: string; file_size?: number };

export function assetsOn(html: string, folder: string): ClassFile[] {
  const files: ClassFile[] = [];
  const seen = new Set<string>();

  for (const match of html.matchAll(/data-ec3-info='([^']+)'/g)) {
    const info = JSON.parse(decodeEntities(match[1])) as Ec3Info;
    if (!info.download_url || !info.name || seen.has(info.download_url)) continue;
    seen.add(info.download_url);
    files.push({ name: info.name, folder, size: info.file_size ?? 0, url: info.download_url });
  }
  return files;
}

// Folders are one level deep. Loose files at the top level link straight to
// the CDN, so matching only /student/classes/ hrefs would miss them entirely.
export async function listFiles(classId: string): Promise<ClassFile[]> {
  const root = await get(`/student/classes/${classId}/files`);
  const files = assetsOn(root, "");
  const seenFolders = new Set<string>();

  for (const match of root.matchAll(
    /href="\/student\/classes\/\d+\/files\/folder\/(\d+)"[^>]*>([\s\S]*?)<\/a>/g,
  )) {
    const [, id, label] = match;
    const name = stripTags(label);
    if (!name || seenFolders.has(id)) continue;
    seenFolders.add(id);
    files.push(...assetsOn(await get(`/student/classes/${classId}/files/folder/${id}`), name));
  }
  return files;
}

// One filter covers both "just the paper 2 folder" and "just the annotated
// scripts", because the needle is tested against "folder/name". Substring and
// case-insensitive, the same way --class already resolves a class.
export function matching(files: ClassFile[], needle: string): ClassFile[] {
  const query = needle.toLowerCase();
  return files.filter((file) => `${file.folder}/${file.name}`.toLowerCase().includes(query));
}

// A ManageBac file or folder name is remote input on the way to a filesystem
// path. Strip separators, then reject an all-dots name: with no separator
// left, ".." is the only remaining string that can walk out of the target.
export function safeName(name: string): string {
  return name.replace(/[/\\]/g, "-").replace(/^\.+$/, "").trim() || "untitled";
}

// A folder really can hold two different files under one name: Modern Greek A
// has two distinct "Annotated_Script.pdf" in paper 1. Number the later ones
// rather than let one overwrite or mask the other. Listing order is stable, so
// the same file keeps the same number across runs.
function uniqueTarget(path: string, taken: Set<string>): string {
  if (!taken.has(path)) return path;
  const dot = path.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [path.slice(0, dot), path.slice(dot)] : [path, ""];
  let n = 2;
  while (taken.has(`${stem}-${n}${ext}`)) n++;
  return `${stem}-${n}${ext}`;
}

// Skips what is already on disk, so an interrupted run resumes by rerunning.
export async function download(files: ClassFile[], dir: string): Promise<string[]> {
  const written: string[] = [];
  const taken = new Set<string>();

  for (const file of files) {
    // Loose files sit at the top of the class, not in a folder named "".
    const folderDir = file.folder ? join(dir, safeName(file.folder)) : dir;
    const target = uniqueTarget(join(folderDir, safeName(file.name)), taken);
    taken.add(target);
    if (existsSync(target)) continue;
    const response = await fetch(file.url);
    if (!response.ok) {
      throw new Error(`${file.name} failed to download (${response.status}). Links expire, re-list.`);
    }
    mkdirSync(folderDir, { recursive: true });
    writeFileSync(target, Buffer.from(await response.arrayBuffer()));
    written.push(target);
  }
  return written;
}

// Discussion dates carry their year ("Wednesday, Jun 10, 2026 at 10:38 PM"),
// unlike Tasks & Deadlines, so nothing has to be inferred here.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function parsePosted(text: string): Date | null {
  const match = text.match(/([A-Z][a-z]{2}) (\d{1,2}), (\d{4}) at (\d{1,2}):(\d{2})\s*(AM|PM)/);
  if (!match) return null;
  const month = MONTHS.indexOf(match[1]);
  if (month < 0) return null;
  let hour = Number(match[4]) % 12;
  if (match[6] === "PM") hour += 12;
  return new Date(Number(match[3]), month, Number(match[2]), hour, Number(match[5]));
}

// stripTags collapses every run of whitespace, which turns a multi-paragraph
// homework post into one long line. Discussion bodies are the one place in
// ManageBac where the line breaks carry meaning, because that is how teachers
// list the exercises.
export function blockText(html: string): string {
  const spaced = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n");
  return decodeEntities(spaced.replace(/<[^>]+>/g, ""))
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// One post per div#discussion_{id}. Splitting on that marker rather than
// matching a single regex over the whole page keeps each post's fields from
// being read off its neighbour.
export function parseDiscussions(html: string, classId: string): Discussion[] {
  const posts: Discussion[] = [];

  for (const block of html.split(/<div id="discussion_/).slice(1)) {
    const id = block.slice(0, block.indexOf('"'));
    if (!/^\d+$/.test(id)) continue;

    const title = block.match(/class='h4 title'[^>]*>([\s\S]*?)<\/div>/);
    const author = block.match(/<strong aria-hidden='true'>([^<]*)<\/strong>/);
    const category = block.match(/class='category'>[\s\S]*?<em>([^<]*)<\/em>/);
    const posted = block.match(/class='date gray-text'>\s*Posted on\s*([^<]+)</);

    // The body runs to the replies container, which is the one element that
    // always closes it. Counting nested divs would be the alternative. Both
    // boundaries sit at a tag edge, so slice past the '>' and stop before the
    // '<' or the markup leaks into the text.
    const opens = block.match(/<div class='body[^']*'>/);
    const end = block.indexOf("<div class='replies'");
    const from = opens ? block.indexOf(opens[0]) + opens[0].length : -1;
    const region = from < 0 ? "" : block.slice(from, end < 0 ? undefined : end);
    // The title renders inside the body container as well as in its own field.
    const body = blockText(region.replace(/<div class='h4 title'[\s\S]*?<\/div>/, ""));

    const postedText = posted ? posted[1].trim().replace(/\s+/g, " ") : "";
    posts.push({
      id,
      title: title ? stripTags(title[1]) : "",
      author: author ? author[1].trim() : "",
      category: category ? category[1].trim() : null,
      postedAt: parsePosted(postedText),
      posted: postedText,
      body,
      url: `/student/classes/${classId}/discussions/${id}`,
    });
  }
  return posts;
}

// Ceiling: the first page only, which is five posts. ManageBac paginates
// behind a "Show More" button and the route for it is not mapped. At roughly
// one post a week across every class this is weeks of headroom, but a class
// that goes quiet for a term and then posts six times in a day would lose the
// oldest of them.
export async function listDiscussions(classId: string): Promise<Discussion[]> {
  const html = await get(`/student/classes/${classId}/discussions`);
  return parseDiscussions(html, classId);
}
