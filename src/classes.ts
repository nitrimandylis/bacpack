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
export type Discussion = { id: string; title: string };

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

export async function listDiscussions(classId: string): Promise<Discussion[]> {
  const html = await get(`/student/classes/${classId}/discussions`);
  const seen = new Map<string, string>();

  for (const match of html.matchAll(
    /href="\/student\/classes\/\d+\/discussions\/(\d+)"[^>]*>([\s\S]{0,200}?)<\/a>/g,
  )) {
    const title = stripTags(match[2]);
    if (title && !seen.has(match[1])) seen.set(match[1], title);
  }
  return [...seen].map(([id, title]) => ({ id, title }));
}
