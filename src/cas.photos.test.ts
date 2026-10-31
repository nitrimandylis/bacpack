import { expect, test } from "bun:test";
import { buildPhotosForm, photoType } from "./cas.ts";

test("photos post as one AlbumEvidence with indexed files and captions", () => {
  const files = [new Blob(["a"]), new Blob(["b"])];
  const form = buildPhotosForm(files, ["one.jpg", "two.jpg"], "hi", "tok");
  expect(form.get("type")).toBe("AlbumEvidence");
  expect(form.get("authenticity_token")).toBe("tok");
  expect((form.get("evidence[photos_attributes][0][file]") as File).name).toBe("one.jpg");
  expect((form.get("evidence[photos_attributes][1][file]") as File).name).toBe("two.jpg");
  expect(form.get("evidence[photos_attributes][1][caption]")).toBe("hi");
  expect(form.get("evidence[photos_attributes][2][file]")).toBeNull();
});

test("photo parts carry the image type from the extension", () => {
  expect(photoType("/tmp/IMG_1.JPG")).toBe("image/jpeg");
  expect(photoType("shot.png")).toBe("image/png");
  expect(photoType("notes.txt")).toBe("application/octet-stream");
});
