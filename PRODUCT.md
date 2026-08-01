# bacpack

## What it is

A CLI over ManageBac for students. It answers "what's due", logs CAS experiences and reflections,
and writes Learner Portfolio entries, using the session cookie the browser already holds. The
official ManageBac+ API is administrator-only, so there is no supported route for a student.

Reads are live. Nothing is mirrored locally, so nothing can go stale.

## Why it exists

Three facts about ManageBac make a naive scraper quietly wrong rather than loudly broken:

1. The session cookie **rotates mid-conversation**, and replaying the original returns 422. It
   reads like rate limiting and is not.
2. Deadlines are printed **without a year**.
3. Teachers **post the same deadline twice**, with different ids and slightly different titles.

Most of bacpack is the handling of those three, plus refusing to report an empty week when the
markup has changed underneath it.

## Principles

- **Reads are live, writes are deliberate.** Every write previews and exits; `--confirm` posts.
  The failure that matters is an agent double-posting to a permanent school record after an
  ambiguous error, not a slow command.
- **Never guess an identifier.** Classes resolve by name, learning outcomes and portfolio works are
  read from the live form. School-specific ids change every September and hardcoding them is how
  this breaks silently in the autumn.
- **Silence is a bug.** A page that parses to nothing exits non-zero. "Nothing due" and "the
  selectors rotted" must never look the same.
- **Ship no flag that does nothing.** Two options were removed after testing showed ManageBac
  accepts and then discards them. A confident preview that changes nothing is worse than a missing
  feature.
- **Zero runtime dependencies**, and no knowledge of any other system. Content arrives on flags and
  stdin, so the tool stays testable without an account anywhere else.

## Where it's headed

Nothing is committed. Candidates, roughly in order of usefulness:

- **`due --ics`**, writing a calendar file to subscribe to. The only idea here that changes *where*
  the information reaches you rather than adding a command to remember.
- **Coursework submission.** The biggest gap: deadlines say "Submit Coursework" and bacpack can
  show the button but not press it. Multipart upload, a real build.
- **File attachments** on CAS reflections and portfolio entries. Same multipart problem.
- **`portfolio pdf`**, since ManageBac already renders one server-side.
- **`class_stream`**, only if it turns out to be server-rendered somewhere. It returns no items in
  the page source for any class tested.

Explicitly out of scope: **grades**. No endpoint exists for a student session, anywhere. Not
unbuilt, absent.

## Status

Every command has been exercised against a live account, including the writes. Zero runtime
dependencies, 15 tests over the parts with real logic (year inference, duplicate deadlines, label
resolution across punctuation differences).
