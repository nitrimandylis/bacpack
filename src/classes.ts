// Class content: units, files and discussions.
//
// class_stream is deliberately absent. It renders no items in the static HTML
// for any class tested on 2026-08-01, so it is either hydrated by JavaScript
// or unused here. A command that always returns nothing is worse than none.

import { get, stripTags } from "./client.ts";

export type Unit = { id: string; title: string; status: string; badges: string[] };
export type ClassFile = { name: string; href: string; folder: boolean };
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

export async function listFiles(classId: string): Promise<ClassFile[]> {
  const html = await get(`/student/classes/${classId}/files`);
  const rows = html.split("<div class='row file").slice(1);
  const files: ClassFile[] = [];

  for (const row of rows) {
    const link = row.match(/href="(\/student\/classes\/\d+\/files\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!link) continue;
    files.push({
      name: stripTags(link[2]),
      href: link[1],
      folder: link[1].includes("/folder/"),
    });
  }
  return files;
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
