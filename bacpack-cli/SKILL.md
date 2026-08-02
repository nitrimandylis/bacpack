---
name: bacpack-cli
description: Drive ManageBac from the terminal via the bacpack CLI — check what is due, log CAS experiences and reflections, and write Learner Portfolio entries. Use whenever the user asks what is due or overdue, mentions CAS hours or reflections, the Learner Portfolio or IA tab, wants coursework pushed into ManageBac, or names ManageBac at all.
---

# bacpack

`bacpack` is a CLI over ManageBac. It reads live and writes the two plain text forms ManageBac
exposes. It knows about nothing else: if the content originates somewhere else, a notes app or a
database, **you** are the glue that reads it and builds the command.

## Before anything

```bash
export MANAGEBAC_SCHOOL=<subdomain>     # acme for acme.managebac.com
```

The session cookie lives at `~/.config/managebac/cookie`. **Never read, print, echo or pass it
around.** bacpack loads it itself. A `401` means it expired, and only the user can refresh it from
their browser.

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
bacpack class files --class NAME --download DIR   # saves every file, resumable, no --confirm
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
- **Tag punctuation is flattened before matching**, so a value copied from another system resolves
  even when its commas differ. If a bare label is ambiguous, qualify it: `Concepts/Culture`.
- **A `200` with nothing parseable exits non-zero.** That means ManageBac changed its markup, not
  that the user has nothing due. Report it as breakage, never as an empty week.

## What it cannot do

Submitting coursework, uploading any file, and anything involving grades. **ManageBac exposes no
grades or report-card endpoint at all to a student session**, so never offer to fetch them.
