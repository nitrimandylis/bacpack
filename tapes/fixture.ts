// Builds the fake HOME the demo tape runs in: a session cookie, nothing else.
// The pages themselves come from tapes/preload.ts, which stands in for the network.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const home = join(import.meta.dir, "fixtures", "home");
mkdirSync(join(home, ".config", "managebac"), { recursive: true });
writeFileSync(join(home, ".config", "managebac", "cookie"), "demo-session");
