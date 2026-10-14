"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { formulaOptions, formulaHtml } from "@/lib/formula-katex";
import { formulaSegments, normaliseMath } from "@/lib/formulas";

// Inline text deliberately preserves prose literally: no block elements or
// interactive Markdown inside headings, labels, options, or evidence buttons.
export function FormulaText({
  children,
}: {
  children: string | null | undefined;
}) {
  return (
    <span className="formula-inline">
      {formulaSegments(children ?? "").map((segment, index) =>
        segment.kind === "math" ? (
          <span
            key={index}
            dangerouslySetInnerHTML={{ __html: formulaHtml(segment.body) }}
          />
        ) : (
          segment.source
        ),
      )}
    </span>
  );
}

export function FormulaBlock({
  children,
}: {
  children: string | null | undefined;
}) {
  return (
    <div className="formula-content">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[
          remarkGfm,
          [remarkMath, { singleDollarTextMath: false }],
        ]}
        rehypePlugins={[[rehypeKatex, formulaOptions]]}
      >
        {normaliseMath(children ?? "")}
      </ReactMarkdown>
    </div>
  );
}
