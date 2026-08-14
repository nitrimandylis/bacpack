---
name: bacpack-cli
description: Drive ManageBac from the terminal via the bacpack CLI — check what is due, download a class's files, log CAS experiences and reflections, and write Learner Portfolio entries. Use whenever the user asks what is due or overdue, wants the handouts or resources from a class, mentions CAS hours or reflections, the Learner Portfolio or IA tab, wants coursework pushed into ManageBac, or names ManageBac at all.
---

# bacpack

`bacpack` is a CLI over ManageBac. It reads live and writes the two plain text forms ManageBac
exposes. It knows about nothing else: if the content originates somewhere else, a notes app or a
database, **you** are the glue that reads it and builds the command.

## Before anything

```bash
export MANAGEBAC_SCHOOL=<subdomain>     # acme for acme.managebac.com
```

Credentials live at `~/.config/managebac/credentials`, and the session bacpack caches for itself
at `~/.config/managebac/cookie`. **Never read, print, echo or pass either around.** bacpack loads
them itself and logs in again when the session lapses, which is roughly fortnightly, so an expired
session needs nothing from you or the user. `ManageBac rejected the login` is the one case that
does: the password changed, and only the user can fix it.

If the binary is not on PATH, run from source: `bun run src/index.ts …`

## The one rule for writes

**Every write previews and exits. Nothing is sent without `--confirm`.**

Run it without `--confirm`, show the user the preview, and only add `--confirm` once they have seen
it. Do not chain both in a single step. If a command fails ambiguously, **re-read the state before
retrying**: several of these endpoints have no undo, and a blind retry can double-post to a
permanent school record.

## Reading

```bash
bacpack due [--days 14] [--json]        # deadlines, year inferred, duplicates kept
bacpack classes [--json]
bacpack cas list [--json]               # experiences with hours, badges, reflection counts
bacpack cas outcomes                    # the 7 learning outcomes and their ids
bacpack cas groups
bacpack class units|files|discussions --class NAME [--json]
bacpack class files --class NAME [--match TEXT] [--download DIR]
                                        # --match "paper 2" or --match annotated narrows it
                                        # --download saves to DIR/<class>/<folder>/
bacpack portfolio list --class NAME [--json]
bacpack portfolio tags --class NAME     # live works + the whole tag taxonomy
```

Use `--json` whenever you are going to parse the result. The prose output is for humans.

## Writing

```bash
bacpack cas add --name "..." --start ISO --end ISO \
  --creativity H --action H --service H \
  --service-type direct|indirect|advocacy|research \
  --approaches ongoing,school-based,community-based,individual \
  --outcomes ethics,collaboration --group "..." \
  --supervisor-name "..." --supervisor-email "..." \
  --notes-file FILE [--project] [--confirm]

bacpack cas edit --experience NAME [same flags] [--confirm]
bacpack cas delete --experience NAME [--confirm]
bacpack cas reflect --experience NAME --body-file FILE.html [--confirm]

bacpack portfolio add --class NAME --body-file FILE.html --tags a,b --works a,b [--confirm]
bacpack portfolio edit --class NAME --id N [--body-file F] [--tags a,b] [--works a,b] [--confirm]
bacpack portfolio star|delete --class NAME --id N [--confirm]
```

## Things that will bite you

- **Never pass `--notify-advisor`** unless the user explicitly asks. ManageBac's checkbox ships
  pre-ticked; bacpack sends `0` unless overridden, and overriding emails their CAS advisor.
- **`--class` takes part of a class name, never an id.** `--class greek`. Ids change every
  September, and every class exposes the portfolio route, so an id is both brittle and unsafe.
- **The Learner Portfolio has no title field.** Fold the title into the first block of the body
  HTML or the entry renders headless. `--body-file` takes HTML and passes it through unchanged.
- **`cas reflect` takes a body and nothing else.** That form has no learning-outcome checkboxes,
  and its `url` field accepts a value then discards it. There are deliberately no flags for either.
- **Edits preserve what you omit.** `cas edit --service 9` changes only the hours. This is load
  bearing: both edit forms overwrite every field they post, so the CLI reads the record first.
- **A CAS group can only be set at creation.** ManageBac's edit form has no group field.
- **Works ids change every September.** If a `--works` value stops resolving, run
  `bacpack portfolio tags` rather than guessing.
- **Never run `portfolio edit --body-file` on a body you have not read.** `edit` replaces the whole
  body, and `portfolio list --json` truncates `body` to a ~200-character excerpt, so the CLI alone
  gives you no way to see what you are about to destroy. There is no `portfolio show`. Read the
  live body first, from the edit form's textarea:

  ```
  GET /student/classes/{classId}/learner_portfolio/reflections/{entryId}/edit
  -> <textarea name="evidence[body]">…</textarea>     (HTML-unescape it)
  ```

  Send `Accept: text/html`, replay the cached session from `~/.config/managebac/cookie` on every
  request without ever printing it, and retry on 422. Apply the smallest possible string edit to what you
  read, assert the match count before replacing, then post and re-read to diff. Treat a body you
  could not read as a body you may not edit.
- **A label containing a comma needs its own `--tags` occurrence.** `--tags a,b` is still a list,
  but each occurrence is now tried whole before it is split, so
  `--tags "Culture, identity and community"` resolves to that one Field. Two such labels means
  passing the flag twice; putting both in one string splits them into fragments again:

  ```bash
  --tags "Culture, identity and community" --tags "Politics, power and justice"   # right
  --tags "Culture, identity and community,Politics, power and justice"            # wrong, 4 fragments
  ```

  The comma-free Notion spellings (`Culture identity and community`) resolve too, so values copied
  from Notion stay safe either way.
- **This was a silent-corruption bug before 2026-08-11.** Splitting happened first, so `Culture`
  exact-matched `Concepts / Culture` and bound with **exit code 0**. If a portfolio entry has a
  stray `Concepts/Culture` or a duplicated Field, it was posted by the old binary. Fixed in
  `resolveLabels`, `src/portfolio.ts`.
- **Always preview before `--confirm`, and read the tag line back** against the values you meant.
- **If a bare label is ambiguous, qualify it** as `Concepts/Culture`. The `/` form is what previews
  print and is accepted back as input.
- **`portfolio list` is complete, and was not before 2026-08-14.** The index paginates at ten
  entries per page and the old binary read page one only, exiting 0 on a truncated list. It now
  walks `.../reflections/page/N` until a page adds nothing new. A pre-fix run is why an older
  entry can look missing from ManageBac when it is not: re-check with a current binary before
  reporting a gap, and never conclude anything from ten entries exactly.
- **`class discussions` returns the newest five posts.** ManageBac paginates behind a "Show More"
  button whose route is not mapped, so an older post is unreachable rather than absent. Say so
  instead of reporting that the class has posted nothing.
- **The homework is in the discussion body, not the title.** Each post carries its date, category,
  author and body, and the body keeps its line breaks because teachers list the exercises one to a
  line. Parse `--json` and read `body`; the plain output is formatted for a human to read.
- **A `200` with nothing parseable exits non-zero.** That means ManageBac changed its markup, not
  that the user has nothing due. Report it as breakage, never as an empty week.
- **`--download` takes no `--confirm`, because it writes to disk and not to ManageBac.** It is
  still the one read that can be large: a single class ran to 67 files and 235 MB. Agree the
  directory with the user first. It skips what is already there, so a failed run is resumed by
  running the same command again, not by clearing the directory.
- **Reach for `--match` before downloading a whole class.** The user usually wants one folder or
  one handout, not 235 MB. List first without `--download` to confirm the needle hits what they
  meant, then add the directory. A needle that matches nothing exits non-zero.

## What it cannot do

Submitting coursework, uploading a file anywhere, and anything involving grades. Files move one
way only: `class files --download` pulls, nothing pushes. **ManageBac exposes no grades or
report-card endpoint at all to a student session**, so never offer to fetch them.
