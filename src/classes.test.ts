// The one thing worth pinning: file rows are JSON hidden inside an HTML
// attribute, so both layers of escaping have to survive. This markup is
// trimmed from a real /files/folder page.

import { test, expect } from "bun:test";
import { assetsOn, safeName } from "./classes.ts";

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
