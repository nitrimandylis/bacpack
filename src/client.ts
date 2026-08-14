// One ManageBac session, shared by every command.
//
// Four failure modes are real and are handled explicitly:
//   302 to /login  the session died, log in again and retry once
//   401            same thing by another name, treated identically
//   422            Rails refusing the request format, see ACCEPT below
//   200 with nothing parseable  the selectors rotted, callers must shout

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Resolved per call rather than once at import, and from HOME rather than
// homedir(), which Bun caches at process start. Both matter: login() writes a
// file here, and a stale path would write it outside the caller's home.
const configDir = () => join(process.env.HOME || homedir(), ".config", "managebac");
const cookiePath = () => join(configDir(), "cookie");
const credentialsPath = () => join(configDir(), "credentials");
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
const MAX_ATTEMPTS = 4;

// Load-bearing. With the default */* that fetch sends, ManageBac answers 422
// on roughly half of all requests to /files. With this header it is 200 every
// time. Rails content negotiation, not rate limiting and not the session.
const ACCEPT = "text/html";

// The session cookie, read once and replayed unchanged on every request.
// ManageBac does hand back a different value in Set-Cookie, but that value is
// a downgrade: adopting it makes every later request 422 with no recovery.
// The one exception is the cookie issued by login() below, which is a real
// session rather than a mid-flight rotation.
let session = "";

// Sessions last about a fortnight, so one re-login per process is expected and
// two in a row means the credentials are wrong, not that the session lapsed
// again mid-run.
let loggedIn = false;

function baseUrl(): string {
  const school = process.env.MANAGEBAC_SCHOOL;
  if (!school) {
    throw new Error(
      "MANAGEBAC_SCHOOL is not set.\n" +
        "It is the subdomain of your school's ManageBac, e.g. MANAGEBAC_SCHOOL=acme for acme.managebac.com",
    );
  }
  return `https://${school}.managebac.com`;
}

// The cookie file is a cache, not a credential to maintain: an empty or
// missing one just means the next request logs in and writes a new one.
function loadCookie(): string {
  try {
    return readFileSync(cookiePath(), "utf8").trim();
  } catch {
    return "";
  }
}

function loadCredentials(): { email: string; password: string } {
  const email = process.env.MANAGEBAC_EMAIL;
  const password = process.env.MANAGEBAC_PASSWORD;
  if (email && password) return { email, password };

  let raw: string;
  try {
    raw = readFileSync(credentialsPath(), "utf8");
  } catch {
    throw new Error(
      "No ManageBac credentials.\n" +
        "Set MANAGEBAC_EMAIL and MANAGEBAC_PASSWORD, or write your email on line 1 " +
        `and your password on line 2 of ${credentialsPath()} (chmod 600).`,
    );
  }
  const [fileEmail, filePassword] = raw.split("\n").map((line) => line.trim());
  if (!fileEmail || !filePassword) {
    throw new Error(`${credentialsPath()} needs an email on line 1 and a password on line 2.`);
  }
  return { email: fileEmail, password: filePassword };
}

function sessionFrom(response: Response): string {
  const match = (response.headers.get("set-cookie") ?? "").match(/_managebac_session=([^;]+)/);
  return match ? match[1] : "";
}

// Logs in with the credentials and caches the session it gets back.
//
// The CSRF token is bound to the pre-auth session handed out with the login
// page, so both have to be carried into the POST. Success answers 302 to
// Faria's single-sign-on handoff at accounts.faria.org; that redirect is never
// followed, because the cookie set alongside it already works. A rejected
// login re-renders the form as a 200, so only a redirect counts as success.
async function login(): Promise<string> {
  const { email, password } = loadCredentials();

  const page = await fetch(baseUrl() + "/login", {
    headers: { "User-Agent": USER_AGENT, Accept: ACCEPT },
  });
  const token = (await page.text()).match(/name="authenticity_token" value="([^"]+)"/)?.[1];
  const preAuth = sessionFrom(page);
  if (!token || !preAuth) {
    throw new Error("Could not read the login form. ManageBac changed its login page.");
  }

  const response = await fetch(baseUrl() + "/sessions", {
    method: "POST",
    redirect: "manual",
    body: new URLSearchParams({
      authenticity_token: token,
      login: email,
      password,
      remember_me: "1",
      commit: "Login",
    }),
    headers: {
      "User-Agent": USER_AGENT,
      Accept: ACCEPT,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: `_managebac_session=${preAuth}`,
    },
  });

  const fresh = sessionFrom(response);
  if (response.status < 300 || response.status >= 400 || !fresh) {
    throw new Error("ManageBac rejected the login. Check the email and password.");
  }

  // Caching the session only saves the next run a login, so it must never be
  // able to fail one that already worked. A CI runner has no ~/.config at all,
  // which is the case that got this wrong first.
  try {
    mkdirSync(configDir(), { recursive: true });
    writeFileSync(cookiePath(), fresh, { mode: 0o600 });
  } catch {
    // Not cached, so every run logs in. Correct, just chattier.
  }

  loggedIn = true;
  return fresh;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(path: string, body?: URLSearchParams): Promise<{ status: number; text: string }> {
  if (!session) session = loadCookie() || (await login());

  let lastStatus = 0;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const response = await fetch(baseUrl() + path, {
      method: body ? "POST" : "GET",
      body,
      redirect: "manual",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: ACCEPT,
        Cookie: `_managebac_session=${session}`,
      },
    });
    lastStatus = response.status;

    // An expired session is a 302 to /login with an empty body, and a 401 on
    // the endpoints that answer honestly. Both are recoverable: log in again
    // and replay the request. Without this the empty body sails through as a
    // success and every caller reports rotted selectors instead.
    const redirect = response.status >= 300 && response.status < 400;
    const toLogin = redirect && (response.headers.get("location") ?? "").includes("/login");
    if (toLogin || response.status === 401) {
      if (loggedIn) {
        throw new Error("Logged in, but the session was rejected again. Check the credentials.");
      }
      // A POST carries a CSRF token minted for the dead session, so replaying
      // it after logging in would fail in a way that looks like a bad form.
      // Log in so the next run works, then say plainly that nothing was
      // written.
      if (body) {
        await login();
        throw new Error("The session expired mid-write, so nothing was submitted. Run it again.");
      }
      session = await login();
      continue;
    }

    // A Rails form POST answers 302 on success, so treat any other redirect
    // as one.
    if (response.status === 200 || redirect) {
      return { status: response.status, text: await response.text() };
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

export function decodeEntities(html: string): string {
  return html.replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&nbsp;/g, (entity) => ENTITIES[entity]);
}

export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
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
