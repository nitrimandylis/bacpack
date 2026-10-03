// One task's page: the description the teacher wrote and the files attached
// to it. Tasks & Deadlines only lists titles, so this is the one place the
// actual homework instructions can be read.

import { get, redirectTarget, decodeEntities } from "./client.ts";
import { blockText, type ClassFile } from "./classes.ts";
import type { Task } from "./due.ts";

export type Attachment = { name: string; size: string; path: string };
export type TaskDetail = { description: string; attachments: Attachment[] };

// The description runs from its "Description" heading to the divider before
// the Dropbox section. Attachments are rich-text file links inside it.
export function parseTaskPage(html: string): TaskDetail {
  const start = html.indexOf("<div class='h4'>Description</div>");
  if (start < 0) return { description: "", attachments: [] };
  const end = html.indexOf("<hr class='divider", start);
  const region = html.slice(start, end < 0 ? undefined : end);

  const attachments: Attachment[] = [];
  for (const match of region.matchAll(/<a href="([^"]+)" class="fr-file" data-name="([^"]*)"[\s\S]*?<\/a>/g)) {
    const size = match[0].match(/fr-file-size">([^<]*)</);
    attachments.push({
      name: decodeEntities(match[2]),
      size: size ? size[1] : "",
      // Absolute on the school's own host; keep only the path so the session
      // client builds the URL.
      path: match[1].replace(/^https?:\/\/[^/]+/, ""),
    });
  }

  // The file links render as "name size" text at the top; drop them so the
  // description is only what the teacher wrote.
  const withoutFiles = region.replace(/<a [^>]*class="fr-file"[\s\S]*?<\/a>/g, "");
  const description = blockText(withoutFiles.replace("<div class='h4'>Description</div>", ""));
  return { description, attachments };
}

// Title is a substring, case-insensitive, like --class. A teacher often sets
// the same title in two classes (an SL and an HL group), so ambiguity is an
// error that lists the candidates rather than a guess.
export function pickTask(tasks: Task[], query: string, classQuery?: string): Task {
  let found = query.startsWith("/student/")
    ? tasks.filter((task) => task.url === query)
    : tasks.filter((task) => task.title.toLowerCase().includes(query.toLowerCase()));
  if (classQuery) {
    found = found.filter((task) => task.subject.toLowerCase().includes(classQuery.toLowerCase()));
  }
  if (found.length === 1) return found[0];
  if (found.length === 0) {
    throw new Error(`No upcoming task matches "${query}". Run bacpack due to see what is listed.`);
  }
  const list = found.map((task) => `  ${task.when}  ${task.subject}  ${task.title}`).join("\n");
  throw new Error(`"${query}" matches ${found.length} tasks. Narrow it with --class:\n${list}`);
}

export async function fetchTaskDetail(url: string): Promise<TaskDetail> {
  return parseTaskPage(await get(url));
}

// Resolved one at a time, because each pre-signed link expires.
export async function attachmentFiles(attachments: Attachment[]): Promise<ClassFile[]> {
  const files: ClassFile[] = [];
  for (const attachment of attachments) {
    files.push({ name: attachment.name, folder: "", size: 0, url: await redirectTarget(attachment.path) });
  }
  return files;
}
