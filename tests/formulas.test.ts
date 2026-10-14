import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FormulaBlock, FormulaText } from "@/components/formula-text";
import { describe, expect, it } from "vitest";
import {
  formulaSegments,
  interpolateBoardText,
  normaliseMath,
} from "@/lib/formulas";
import { formulaHtml } from "@/lib/formula-katex";
import { TurnSchema, TransferSchema } from "@/lib/contracts";

describe("formula content", () => {
  it.each(["$x$", "$$x$$", String.raw`\(x\)`, String.raw`\[x\]`])(
    "recognizes single-symbol math in %s",
    (source) => {
      expect(formulaSegments(source)).toEqual([
        {
          kind: "math",
          source,
          body: "x",
          display: source === String.raw`\[x\]` || source === "$$x$$",
        },
      ]);
    },
  );

  it("normalizes display math and protects all code before looking for delimiters", () => {
    const code = "```tex\n\\[x\\] $y$\n```\n``\\(z\\)``\n~~~\n$x$\n~~~";
    expect(normaliseMath(code)).toBe(code);
    const indented = "    \\[x\\] $y$\n\n    \\(z\\)\n";
    expect(normaliseMath(indented)).toBe(indented);
    expect(
      normaliseMath(String.raw`Price $5 and $10; \$20. Use $x$ or \(y\).`),
    ).toBe(String.raw`Price $5 and $10; \$20. Use $$x$$ or $$y$$.`);
    expect(normaliseMath(String.raw`\[\frac{1}{2}\]`)).toBe(
      "\n$$\n\\frac{1}{2}\n$$\n",
    );
    expect(normaliseMath("$$\nx^2\n$$")).toBe("\n$$\nx^2\n$$\n");
    expect(normaliseMath("$ unfinished")).toBe("$ unfinished");
  });

  it.each([
    String.raw`\frac{1}{2}`,
    String.raw`\sqrt{x^2}`,
    String.raw`\begin{matrix}1&2\\3&4\end{matrix}`,
    String.raw`\ce{H2O}`,
    String.raw`\pu{10 m/s}`,
  ])("renders %s with accessible MathML", (body) => {
    expect(formulaHtml(body)).toContain('class="katex"');
    expect(formulaHtml(body)).toContain("<math");
    expect(formulaHtml(body)).not.toContain("katex-error");
  });

  it("leaves malformed math readable and blocks untrusted HTML commands", () => {
    expect(formulaHtml(String.raw`\frac{`)).toContain("katex-error");
    expect(formulaHtml(String.raw`\frac{`)).toContain("\\frac{");
    expect(
      formulaHtml(String.raw`\href{javascript:alert(1)}{x}`),
    ).not.toContain("href=");
    expect(formulaHtml(String.raw`\htmlClass{injected}{x}`)).not.toContain(
      'class="injected"',
    );
  });

  it("substitutes known board values without touching formula groups or code", () => {
    const source = String.raw`Value {x}, unknown {unknown}, fraction $\frac{x}{2}$, bare \frac{x}{2}, code \`{x}\`.`;
    // Construct code separately because a raw template cannot contain a literal backtick.
    const input = source.replaceAll("\\`", "`");
    expect(interpolateBoardText(input, { x: "3 m" })).toBe(
      input.replace("Value {x}", "Value 3 m"),
    );
    expect(
      interpolateBoardText(String.raw`\(\frac{x}{2}\) {x}`, { x: "3" }),
    ).toBe(String.raw`\(\frac{x}{2}\) 3`);
  });

  it("renders shared prose safely without converting currency or code to math", () => {
    const text =
      String.raw`Use $x$ and \(\sqrt{x}\); pay $5 and $10.` +
      "\n\n`\\[x\\]`\n\n<script>alert(1)</script>";
    const html = renderToStaticMarkup(
      createElement(FormulaBlock, { children: text }),
    );
    expect(html.match(/class="katex"/g)).toHaveLength(2);
    expect(html).toContain("pay $5 and $10");
    expect(html).toContain("<code>\\[x\\]</code>");
    expect(html).not.toContain("<script>");
    const inline = renderToStaticMarkup(
      createElement(FormulaText, { children: "$x$ <img src=x>" }),
    );
    expect(inline).not.toContain("<p>");
    expect(inline).toContain("&lt;img src=x&gt;");
  });
  it("keeps original learner formula notation in API input", () => {
    const text = String.raw`I divide by two: \(\frac{x}{2}\).`;
    expect(
      TurnSchema.parse({
        text,
        revision: 0,
        operationId: "11111111-1111-4111-8111-111111111111",
      }).text,
    ).toBe(text);
    expect(
      TransferSchema.parse({
        answer: text,
        skip: false,
        revision: 0,
        operationId: "11111111-1111-4111-8111-111111111111",
      }).answer,
    ).toBe(text);
  });
});
