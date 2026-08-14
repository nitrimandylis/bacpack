// The one check that matters here: an expired session logs in and replays the
// request, instead of handing the caller an empty body it will misread as
// rotted selectors.
//
// HOME is redirected at a temp directory before client.ts is imported, because
// the module resolves the cookie path once at load and login() writes to it.
// fetch is stubbed, so nothing touches the network and the credentials below
// are fictional.

import { expect, test, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "bacpack-test-"));
mkdirSync(join(home, ".config", "managebac"), { recursive: true });
writeFileSync(join(home, ".config", "managebac", "cookie"), "stale");

const realHome = process.env.HOME;
const realFetch = globalThis.fetch;
process.env.HOME = home;
process.env.MANAGEBAC_SCHOOL = "example";
process.env.MANAGEBAC_EMAIL = "student@example.invalid";
process.env.MANAGEBAC_PASSWORD = "not-a-real-password";

const { get } = await import("./client.ts");

afterAll(() => {
  globalThis.fetch = realFetch;
  process.env.HOME = realHome;
  rmSync(home, { recursive: true, force: true });
});

function reply(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
}

test("an expired session logs in again and replays the request", async () => {
  const calls: string[] = [];
  let sessionIsDead = true;

  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    calls.push(path);

    if (path === "/login") {
      return reply(200, '<input name="authenticity_token" value="csrf-token" />', {
        "set-cookie": "_managebac_session=pre-auth; path=/",
      });
    }
    if (path === "/sessions") {
      expect(String(init?.body)).toContain("password=not-a-real-password");
      sessionIsDead = false;
      return reply(302, "", {
        location: "https://accounts.faria.org/accounts/otsi?token=x",
        "set-cookie": "_managebac_session=fresh; path=/",
      });
    }
    // A dead session answers the way ManageBac really does: a redirect to the
    // login page with nothing in the body.
    if (sessionIsDead) return reply(302, "", { location: "https://example.managebac.com/login" });
    expect(init?.headers).toMatchObject({ Cookie: "_managebac_session=fresh" });
    return reply(200, "<div class='js-tasks'>real page</div>");
  }) as typeof fetch;

  const html = await get("/student/tasks_and_deadlines");

  expect(html).toContain("js-tasks");
  expect(calls).toEqual([
    "/student/tasks_and_deadlines", // the stale cookie, rejected
    "/login", // csrf token
    "/sessions", // log in
    "/student/tasks_and_deadlines", // replayed, now works
  ]);
  // The new session is cached, so the next process starts already logged in.
  expect(readFileSync(join(home, ".config", "managebac", "cookie"), "utf8")).toBe("fresh");
});
