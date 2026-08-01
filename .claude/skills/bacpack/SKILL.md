---
name: bacpack
description: Drive ManageBac from the terminal via the bacpack CLI — check what is due, log CAS experiences and reflections, and write Learner Portfolio entries. Use whenever Nick asks what is due or overdue, wants something pushed from Notion to ManageBac, mentions CAS hours or reflections, the Modern Greek portfolio or IA tab, or names ManageBac at all.
---

# bacpack

`bacpack` is a CLI over ManageBac at `~/cc/bacpack`. It reads live and writes the two text forms
ManageBac exposes. It is a **dumb ManageBac client**: it knows nothing about Notion. When work
moves from Notion to ManageBac, you are the glue, and `notion-cas` / `notion-greek-portfolio`
supply the values.

## Before anything

```bash
export MANAGEBAC_SCHOOL=cgs
```

The session cookie lives at `~/.config/managebac/cookie`. **Never read, print or pass it around.**
bacpack loads it itself. A `401` means it expired and only Nick can refresh it from the browser.

If the binary is not on PATH, run from source: `cd ~/cc/bacpack && bun run src/index.ts …`

## The one rule for writes

**Every write previews and exits.** Nothing is sent without `--confirm`.

Run it without `--confirm`, show Nick the preview, and only add `--confirm` once he has seen it.
Do not chain both in one step. If a command errors ambiguously, **re-read the state before
retrying** — several endpoints have no undo, and a blind retry can double-post.

## Reading

```bash
bacpack due [--days 14] [--json]        # deadlines, year inferred, duplicates kept
bacpack classes [--json]
bacpack cas list [--json]               # experiences with hours, badges, reflection counts
bacpack cas outcomes                    # the 7 learning outcomes and their ids
bacpack cas groups
bacpack class units|files|discussions --class NAME [--json]
bacpack portfolio list --class greek [--json]
bacpack portfolio tags --class greek    # live works + the whole tag taxonomy
```

Use `--json` whenever you are going to parse the result. Prose output is for Nick.

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

bacpack portfolio add --class greek --body-file FILE.html --tags a,b --works a,b [--confirm]
bacpack portfolio edit --class greek --id N [--body-file F] [--tags a,b] [--works a,b] [--confirm]
bacpack portfolio star|delete --class greek --id N [--confirm]
```

## Things that will bite you

- **Never pass `--notify-advisor`** unless Nick explicitly asks. ManageBac's checkbox ships
  pre-ticked; bacpack sends `0` unless you override, and the override emails his CAS advisor.
- **`--class` takes part of a class name, never an id.** `--class greek`. Ids change every
  September and every class exposes the portfolio route, so an id is both brittle and unsafe.
- **The portfolio has no title field.** Fold the title into the first block of the body HTML or
  the entry renders headless. `--body-file` takes HTML and passes it through unchanged.
- **`cas reflect` takes a body and nothing else.** The form has no learning-outcome checkboxes and
  its `url` field silently discards what you send. There are deliberately no flags for them.
- **Edits preserve what you omit.** `cas edit --service 9` changes only the hours. This is load
  bearing: both edit forms overwrite every field they post.
- **A CAS group can only be set at creation.** ManageBac's edit form has no group field.
- **Works ids change every September.** If a `--works` value stops resolving, run
  `bacpack portfolio tags --class greek` rather than guessing.
- **Tags: pass Notion's value verbatim.** bacpack flattens punctuation, so Notion's
  `Culture identity and community` reaches ManageBac's `Culture, identity and community`. If a
  bare label is ambiguous, qualify it: `Concepts/Culture`.
- **A `200` with nothing parseable exits non-zero.** That means ManageBac changed its markup, not
  that Nick has nothing due. Say so rather than reporting an empty week.

## What it cannot do

Submitting coursework, uploading any file, and anything involving grades. **There is no grades or
report-card endpoint in ManageBac at all**, so never offer to fetch them.

## Pushing from Notion

`On ManageBac` is the queue checkbox in both databases. Read the row, build the command, preview,
confirm, then tick the box. The field mappings live in `notion-cas` and `notion-greek-portfolio`.
