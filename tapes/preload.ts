// Demo only. Loaded with `bun --preload` by the tape, so src/ is untouched.
// Replaces fetch with canned ManageBac pages. All names here are invented.

const DAY = 24 * 60 * 60 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "Oct 27, 9:00 AM", computed from today so the age stays plausible on re-record.
function when(daysAhead: number, hour: number): string {
  const d = new Date(Date.now() + daysAhead * DAY);
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${hour % 12 || 12}:00 ${suffix}`;
}

const tasks = [
  { id: 1, title: "Extended Essay draft", klass: "IB DP Extended Essay (Grade 12)", days: 2, hour: 9, badge: "Deadline", action: "Submit Coursework" },
  { id: 2, title: "Lab report: specific heat capacity", klass: "IB DP Physics HL (Grade 12)", days: 4, hour: 15, badge: "Deadline", action: "Submit Coursework" },
  { id: 3, title: "Paper 2 practice set", klass: "IB DP Mathematics AA HL (Grade 12)", days: 6, hour: 8, badge: "Task", action: "Submit Coursework" },
  { id: 4, title: "Reading journal 3", klass: "IB DP English A Lang and Lit SL (Grade 12)", days: 9, hour: 23, badge: "Task", action: "Submit Coursework" },
];

function tile(t: (typeof tasks)[number]): string {
  const url = `/student/classes/${t.id}/events/${t.id}`;
  return `<div class='f-tile f-tile--inline'>
<div class="f-tile__body"><p class="f-tile__title h5"><a class="f-tile__title-link link-dark f-truncate-item" href="${url}"><span class="f-truncate-item">${t.title}</span></a></p><div class="f-tile__description"><div class="hstack"><span><svg class="fi fi-clock"></svg> ${when(t.days, t.hour)}</span><span class="vr"></span><a class="f-truncate-item link-dark" href="/student/classes/${t.id}">${t.klass}</a><span class='badge'>
<span class='badge-label'>${t.badge}</span>
</span>
<span class='badge'>
<span class='badge-label'>Pending</span>
</span>
</div></div></div>
<div class='f-tile__suffix'>
<a class="btn btn-primary" href="${url}"><svg></svg>
${t.action}</a>
</div></div>`;
}

const taskPage = `<div class='js-tasks vstack gap-6'>${tasks.map(tile).join("\n")}</div>`;
const emptyPage = `<div class='js-tasks vstack gap-6'></div>`;

const detailPage = `<div class='h4'>Description</div>
<div class="show-more"><div class="fr-view"><p><a href="https://demo.managebac.com/attachments/abc--1" class="fr-file" data-name="ee-checklist.pdf"><span><span class="fr-inner">ee-checklist.pdf</span><span class="fr-file-size">84.2 KB</span></span></a></p><p>Hi all,</p><ul><li>Submit chapters 1 to 3 as one document</li><li>Include your RPPF reflection from the last meeting</li><li>Bibliography in the style you will use in the final</li></ul><p>Upload your draft here.</p></div>
</div></div>
<hr class='divider' />`;

globalThis.fetch = (async (input: any) => {
  const url = new URL(String(input));
  let body = "";
  if (url.pathname === "/student/tasks_and_deadlines") {
    body = url.searchParams.get("upcoming_page") === "1" ? taskPage : emptyPage;
  } else if (url.pathname === "/student/classes/1/events/1") {
    body = detailPage;
  } else {
    return new Response("", { status: 404 });
  }
  return new Response(body, { status: 200 });
}) as typeof fetch;
