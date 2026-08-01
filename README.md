```
 ██████╗  █████╗  ██████╗ ██████╗  █████╗  ██████╗ ██╗  ██╗
 ██╔══██╗██╔══██╗██╔════╝██╔══██╗██╔══██╗██╔════╝██║ ██╔╝
 ██████╔╝███████║██║     ██████╔╝███████║██║     █████╔╝
 ██╔══██╗██╔══██║██║     ██╔═══╝ ██╔══██║██║     ██╔═██╗
 ██████╔╝██║  ██║╚██████╗██║     ██║  ██║╚██████╗██║  ██╗
 ╚═════╝ ╚═╝  ╚═╝ ╚═════╝╚═╝     ╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝
```

<div align="center">

### `MANAGEBAC // FROM THE TERMINAL`

*your deadlines, your CAS hours and your learner portfolio, without the four clicks*

![runtime](https://img.shields.io/badge/runtime-bun-d97706?style=flat-square&labelColor=111111)
![deps](https://img.shields.io/badge/dependencies-0-d97706?style=flat-square&labelColor=111111)
![writes](https://img.shields.io/badge/writes-preview_first-374151?style=flat-square&labelColor=111111)
![api](https://img.shields.io/badge/official_api-admin_only_(so_no)-374151?style=flat-square&labelColor=111111)
![license](https://img.shields.io/badge/license-MIT-d97706?style=flat-square&labelColor=111111)

</div>

---

## 📚 What is this

ManageBac has a public API. It is administrator-only, and if you are a student you are not getting a key. bacpack takes the other route: your own session cookie, the same one your browser already holds, and reads the pages you can already see.

It does three things. It tells you what is due, it logs CAS experiences, and it adds entries to a Learner Portfolio. Reads are live, so there is no local copy to go stale. Writes print what they are about to send and then stop, because a school record is not a place to find out your flags were wrong.

The interesting parts are not the HTTP. ManageBac rotates your session cookie mid-conversation and answers 422 when you replay the old one, which reads like rate limiting and is not. It prints dates without a year. Teachers post the same deadline twice. bacpack is mostly the handling of those three facts.

```console
nick@bacpack:~$ bacpack due --days 14
[✓] 2 deadlines found. both are the same IA, posted twice by the same teacher.
[i] dedupe matches exact title and time only. anything fuzzier hides real work.
```

## 🎒 The commands

| | command | what it actually does |
|---|---|---|
| 01 | **`due`** | upcoming deadlines, `--days N` to cut it short. infers the missing year, keeps genuine duplicates |
| 02 | **`classes`** | your classes and their ids, mostly so you can see what `--class` will match |
| 03 | **`cas list`** | every CAS experience with hours, strands and reflection count |
| 04 | **`cas outcomes`** | the seven IB learning outcomes and their ids — per school, so read, never hardcoded |
| 05 | **`cas add`** | creates an experience. explicitly does not email your CAS advisor unless you ask |
| 06 | **`cas reflect`** | adds a reflection to an experience, found by name. body only — see below |
| 07 | **`portfolio list`** | portfolio entries with their tags and the first lines of each body |
| 08 | **`portfolio tags`** | the works and the whole IB tag taxonomy, grouped. works change every September |
| 09 | **`portfolio add`** | adds an entry. `--tags concepts/culture` by name, no id lookup |
| 10 | **`portfolio edit`** | changes an entry. anything you don't pass keeps its current value |
| 11 | **`portfolio star`** | toggles the star |
| 12 | **`portfolio delete`** | removes an entry, after showing you which one |

Every read takes `--json`. Every write previews and exits; `--confirm` is what actually posts.

`portfolio edit` reads the entry first and reuses whatever you leave out. The edit form overwrites every field it posts, so `--body-file` on its own would otherwise wipe an entry's works and tags without mentioning it.

`cas reflect` takes a body and nothing else. The create form carries no learning-outcome checkboxes, and an `evidence[url]` value posts cleanly and then appears nowhere. Both were tested live and silently dropped, so there are no flags for them — a flag that previews confidently and changes nothing is worse than a missing feature.

`--class` takes part of a class name, not an id: `--class greek`. Ids change each school year, and every class exposes the portfolio route, so a name is both safer and shorter than the number.

## 🚀 Run it

Needs [Bun](https://bun.sh). You supply two things: your school's subdomain, and your session cookie.

```bash
git clone https://github.com/nitrimandylis/bacpack.git
cd bacpack
bun install
bun run build            # single binary, no bun needed after this
```

Then, once:

```bash
export MANAGEBAC_SCHOOL=yourschool          # yourschool.managebac.com
mkdir -p ~/.config/managebac
# paste the value of the _managebac_session cookie into this file:
$EDITOR ~/.config/managebac/cookie
chmod 600 ~/.config/managebac/cookie
```

To find the cookie: log in to ManageBac, open devtools, Application → Cookies → your ManageBac domain, copy the value of `_managebac_session`. It lasts about a year. When it dies you get a clean 401 telling you so, not a silent empty result.

```bash
./bacpack due
./bacpack portfolio add --class greek --body-file entry.html --tags culture
```

The second one prints what it would send and stops. Add `--confirm` when you mean it.

## 🔩 Under the hood

```mermaid
flowchart LR
    A[cookie file] --> B[client.ts]
    B -->|carries Set-Cookie forward| B
    B --> C[due.ts]
    B --> D[cas.ts]
    B --> E[portfolio.ts]
    C --> F[index.ts]
    D --> F
    E --> F
    F -->|preview| G[stdout]
    F -->|--confirm| H[ManageBac]
```

| layer | path | job |
|---|---|---|
| client | `src/client.ts` | one session. carries the rotated cookie forward, retries, tells 401 from 422, resolves a class by name |
| due | `src/due.ts` | year inference, dedupe, and the guard that shouts when the selectors rot instead of reporting nothing due |
| cas | `src/cas.ts` | experiences and the create form, including the advisor-email checkbox that ships pre-ticked |
| portfolio | `src/portfolio.ts` | reflections, the tag taxonomy, and the create form that has no title field |
| cli | `src/index.ts` | argument parsing and the preview that stands between you and a permanent record |

Three failure modes are handled by name, because all three have happened. `401` means the cookie died, so it says so and stops. `422` means the session rotated, so it retries with the new one. `200` with nothing parseable means ManageBac changed its markup, so it exits non-zero rather than telling you your week is clear.

**Stack:** Bun · TypeScript · `node:util` parseArgs · no runtime dependencies

---

<div align="center">

**[Nick Trimandylis](https://github.com/nitrimandylis)**

`READ LIVE. WRITE TWICE, THE SECOND TIME ON PURPOSE`

MIT licensed.

</div>
