// One ManageBac session, shared by every command.
//
// Three failure modes are real and are handled explicitly:
//   401  the cookie is dead, tell the user to refresh it, never retry
//   422  the server rotated the session cookie, retry after carrying it forward
//   200 with nothing parseable  the selectors rotted, callers must shout

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const COOKIE_PATH = join(homedir(), ".config", "managebac", "cookie");
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
const MAX_ATTEMPTS = 4;

// The current session cookie value. ManageBac hands back a new one in
// Set-Cookie on most responses; replaying the original file value on every
// request is what causes intermittent 422s.
let session = "";

function baseUrl(): string {
  const school = process.env.MANAGEBAC_SCHOOL;
  if (!school) {
    throw new Error(
      "MANAGEBAC_SCHOOL is not set.\n" +
        "It is the subdomain of your school's ManageBac, e.g. MANAGEBAC_SCHOOL=cgs for cgs.managebac.com",
    );
  }
  return `https://${school}.managebac.com`;
}

function loadCookie(): string {
  let raw: string;
  try {
    raw = readFileSync(COOKIE_PATH, "utf8");
  } catch {
    throw new Error(
      `No session cookie at ${COOKIE_PATH}\n` +
        "See the README for how to copy _managebac_session out of your browser.",
    );
  }
  const value = raw.trim();
  if (!value) throw new Error(`${COOKIE_PATH} is empty.`);
  return value;
}

function rememberRotation(response: Response): void {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const cookies = headers.getSetCookie
    ? headers.getSetCookie()
    : [response.headers.get("set-cookie") ?? ""];
  for (const cookie of cookies) {
    const match = cookie.match(/_managebac_session=([^;]+)/);
    if (match) session = match[1];
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(path: string, body?: URLSearchParams): Promise<{ status: number; text: string }> {
  if (!session) session = loadCookie();

  let lastStatus = 0;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const response = await fetch(baseUrl() + path, {
      method: body ? "POST" : "GET",
      body,
      redirect: "manual",
      headers: {
        "User-Agent": USER_AGENT,
        Cookie: `_managebac_session=${session}`,
      },
    });
    rememberRotation(response);
    lastStatus = response.status;

    // A Rails form POST answers 302 on success, so treat any redirect as one.
    if (response.status === 200 || (response.status >= 300 && response.status < 400)) {
      return { status: response.status, text: await response.text() };
    }
    if (response.status === 401) {
      throw new Error(
        `Session expired (401).\nLog in to ManageBac in your browser and refresh ${COOKIE_PATH}`,
      );
    }
    if (response.status === 404) {
      throw new Error(`Not found: ${path}`);
    }
    await sleep(1500 * (attempt + 1));
  }
  throw new Error(`${path} failed after ${MAX_ATTEMPTS} attempts, last status ${lastStatus}`);
}

export async function get(path: string): Promise<string> {
  const { text } = await request(path);
  return text;
}

export async function post(path: string, form: URLSearchParams): Promise<void> {
  await request(path, form);
}

export function csrfToken(html: string): string {
  const match = html.match(/<meta name="csrf-token" content="([^"]+)"/);
  if (!match) {
    throw new Error("No CSRF token on the page. The layout changed, or the session is not logged in.");
  }
  return match[1];
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

export function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&nbsp;/g, (entity) => ENTITIES[entity])
    .replace(/\s+/g, " ")
    .trim();
}

export type Klass = { id: string; name: string };

export async function listClasses(): Promise<Klass[]> {
  const html = await get("/student/classes/my");
  const seen = new Map<string, string>();
  const pattern = /href="\/student\/classes\/(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  for (const match of html.matchAll(pattern)) {
    const name = stripTags(match[2]);
    if (name && !seen.has(match[1])) seen.set(match[1], name);
  }
  if (seen.size === 0) {
    throw new Error("Could not read the class list. The selectors have probably rotted.");
  }
  return [...seen].map(([id, name]) => ({ id, name }));
}

// Classes are resolved by name substring, never by id: ids change every
// September, and every class exposes the portfolio route so probing cannot
// tell them apart.
export async function resolveClass(query: string): Promise<Klass> {
  const classes = await listClasses();
  const needle = query.toLowerCase();
  const hits = classes.filter((klass) => klass.name.toLowerCase().includes(needle));

  if (hits.length === 1) return hits[0];

  const listing = (items: Klass[]) => items.map((k) => `  ${k.name}`).join("\n");
  if (hits.length === 0) {
    throw new Error(`No class matches "${query}". Your classes:\n${listing(classes)}`);
  }
  throw new Error(`"${query}" matches ${hits.length} classes, be more specific:\n${listing(hits)}`);
}
