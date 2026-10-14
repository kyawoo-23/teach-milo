import katex from "katex";
import "katex/contrib/mhchem";

export const formulaOptions = {
  throwOnError: false,
  trust: false,
  output: "htmlAndMathml" as const,
  maxExpand: 1000,
  maxSize: 20,
};

export function formulaHtml(body: string, displayMode = false) {
  return katex.renderToString(body, { ...formulaOptions, displayMode });
}
