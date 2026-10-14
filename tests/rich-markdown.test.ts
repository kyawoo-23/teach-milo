import { describe, expect, it } from "vitest";
import { htmlFromMarkdown } from "../src/lib/rich-markdown";

describe("htmlFromMarkdown", () => {
  it("renders inline formatting instead of markdown markers", () => {
    expect(htmlFromMarkdown("**photosynthesis** stores energy")).toBe(
      "<div><strong>photosynthesis</strong> stores energy</div>",
    );
    expect(htmlFromMarkdown("photosynthesis _stores_ energy")).toBe(
      "<div>photosynthesis <em>stores</em> energy</div>",
    );
    expect(htmlFromMarkdown("photosynthesis stores `energy`")).toBe(
      "<div>photosynthesis stores <code>energy</code></div>",
    );
  });

  it("renders headings and lists", () => {
    expect(htmlFromMarkdown("## Title")).toBe("<h2>Title</h2>");
    expect(htmlFromMarkdown("- a\n- b")).toBe("<ul><li>a</li><li>b</li></ul>");
    expect(htmlFromMarkdown("1. a\n2. b")).toBe(
      "<ol><li>a</li><li>b</li></ol>",
    );
  });

  it("leaves an empty note empty", () => {
    expect(htmlFromMarkdown("")).toBe("");
  });
});
