// The one thing worth pinning: file rows are JSON hidden inside an HTML
// attribute, so both layers of escaping have to survive. This markup is
// trimmed from a real /files/folder page.

import { test, expect } from "bun:test";
import { assetsOn, safeName, matching, parseDiscussions, parsePosted } from "./classes.ts";

const ROW = (id: string, name: string, size: number) =>
  `<div class='row file px-4' data-ec3-info='{&quot;download_url&quot;:` +
  `&quot;https://cdn.ca.managebac.com/uploads/asset/file/${id}/${name}` +
  `?Expires=1785670472\\u0026Signature=abc\\u0026Key-Pair-Id=K2RK&quot;,` +
  `&quot;name&quot;:&quot;${name}&quot;,&quot;mime_type&quot;:&quot;application/pdf&quot;,` +
  `&quot;file_size&quot;:${size}}'>`;

test("reads name, size and signed url out of data-ec3-info", () => {
  const files = assetsOn(ROW("176410136", "Annotated_Script.pdf", 12394675), "paper 1");

  expect(files).toHaveLength(1);
  expect(files[0].name).toBe("Annotated_Script.pdf");
  expect(files[0].folder).toBe("paper 1");
  expect(files[0].size).toBe(12394675);
  // The &amp; between query params must decode, or the signature is rejected.
  expect(files[0].url).toContain("&Signature=abc");
  expect(files[0].url).not.toContain("&amp;");
});

test("the same row rendered twice on a page counts once", () => {
  // Folder pages print every row a second time inside #js-assets-file-main.
  const html = ROW("1", "a.pdf", 10) + ROW("2", "b.pdf", 20) + ROW("1", "a.pdf", 10);

  expect(assetsOn(html, "").map((f) => f.name)).toEqual(["a.pdf", "b.pdf"]);
});

test("a name cannot walk out of the download directory", () => {
  expect(safeName("..")).toBe("untitled");
  expect(safeName("../../etc")).toBe("..-..-etc");
  expect(safeName("/etc/passwd")).toBe("-etc-passwd");
  // Leading dots are only a problem when that is the whole name.
  expect(safeName("..hidden.pdf")).toBe("..hidden.pdf");
});

test("--match takes a folder, a file, or part of either", () => {
  const files = [
    { name: "Annotated_Script.pdf", folder: "paper 1", size: 1, url: "u1" },
    { name: "Sample_D.pdf", folder: "paper 2", size: 1, url: "u2" },
    { name: "reading_log_en.pdf", folder: "", size: 1, url: "u3" },
  ];

  expect(matching(files, "paper 2").map((f) => f.name)).toEqual(["Sample_D.pdf"]);
  expect(matching(files, "annotated").map((f) => f.name)).toEqual(["Annotated_Script.pdf"]);
  expect(matching(files, "paper").length).toBe(2);
  // A loose file has no folder, so "folder/name" must still match on the name.
  expect(matching(files, "reading").map((f) => f.name)).toEqual(["reading_log_en.pdf"]);
  expect(matching(files, "nope")).toEqual([]);
});

// Discussion markup, trimmed from a real /discussions page with the names
// replaced. The fields sit in sibling divs with no wrapper per post, so the
// only thing separating one post from the next is the id marker.
const POST = (id: string, category: string | null, body: string) =>
  `<div id="discussion_${id}" class="discussion new-discussion">` +
  `<div class='hstack gap-2 align-items-start discussion-inner'>` +
  `<div class='author hstack gap-2 flex-wrap'>` +
  `<strong aria-hidden='true'>A Teacher</strong>` +
  (category ? `<span class='category'>\n in \n<em>${category}</em>\n</span>` : "") +
  `</div>` +
  `<div class='date gray-text'>\nPosted on\nTuesday, May 19, 2026 at 12:21 AM\n</div>` +
  `<div class='body pt-3'>` +
  `<div class='h4 title' data-translate-target='content'>Some title</div>` +
  `<div class="redactor-styles fr-view">${body}</div>` +
  `</div><div class='replies'></div></div></div>`;

test("parseDiscussions reads each post's own fields, not its neighbour's", () => {
  const posts = parseDiscussions(POST("2", "Homework", "<p>b</p>") + POST("1", null, "<p>a</p>"), "99");

  expect(posts.map((p) => p.id)).toEqual(["2", "1"]);
  expect(posts[0].category).toBe("Homework");
  // Teachers leave the category blank more often than they fill it, so an
  // absent one must stay null rather than inherit the post above.
  expect(posts[1].category).toBe(null);
  expect(posts[0].author).toBe("A Teacher");
  expect(posts[0].url).toBe("/student/classes/99/discussions/2");
});

test("parsePosted takes the year off the page instead of inferring it", () => {
  expect(parsePosted("Tuesday, May 19, 2026 at 12:21 AM")).toEqual(new Date(2026, 4, 19, 0, 21));
  expect(parsePosted("Wednesday, Jun 10, 2026 at 10:38 PM")).toEqual(new Date(2026, 5, 10, 22, 38));
  expect(parsePosted("Sep 20")).toBe(null);
});

test("the body keeps its line breaks and leaks no markup", () => {
  const posts = parseDiscussions(
    POST("1", "Homework", "<p>From Diff1:</p><p>Ex. 1, 2</p><p>and 7,&nbsp;9</p>"),
    "99",
  );

  // The line breaks are how teachers list exercises, so they have to survive.
  expect(posts[0].body).toBe("From Diff1:\nEx. 1, 2\nand 7, 9");
  // The title has its own field and must not be repeated at the top of the body.
  expect(posts[0].body).not.toContain("Some title");
  expect(posts[0].body).not.toContain("<");
  expect(posts[0].body).not.toContain("class=");
});
