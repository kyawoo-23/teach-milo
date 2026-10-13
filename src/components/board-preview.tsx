"use client";
import type { BoardSubmission, BoardSnapshot, Board } from "@/lib/contracts";
import { compileBoard } from "@/lib/board-catalog";
import { boardDisplay } from "@/lib/boards";
import { useI18n } from "./locale-context";
export function BoardPreview({
  snapshot,
  definition,
}: {
  snapshot: BoardSubmission | BoardSnapshot;
  definition?: Board;
}) {
  const { t, locale } = useI18n();
  if (snapshot.version !== 2) {
    const display =
      "display" in snapshot && snapshot.display
        ? snapshot.display
        : snapshot.version === 3 && definition
          ? boardDisplay(
              definition,
              compileBoard(definition),
              snapshot,
              {},
              locale,
            )
          : [];
    return (
      <div className="board-preview">
        <dl>
          {display.map(({ label, value, unit }, index) => (
            <div key={index}>
              <dt>{label}</dt>
              <dd>
                {value}
                {unit ? ` ${unit}` : ""}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }
  const state = snapshot.state;
  const image = snapshot.png
    ? `data:image/png;base64,${snapshot.png}`
    : "imageUrl" in snapshot
      ? snapshot.imageUrl
      : undefined;
  return (
    <div className="board-preview">
      {state.kind === "sketch" && image && (
        <img
          src={image}
          alt={t("Shared sketch accompanying your explanation")}
          loading="lazy"
          width={960}
          height={640}
        />
      )}
      {state.kind === "concept_map" && (
        <>
          <strong>{t("Concept map")}</strong>
          <p>{state.nodes.map((n) => n.label).join(" · ")}</p>
          {state.links.map((l) => (
            <p key={l.id}>
              {state.nodes.find((n) => n.id === l.from)?.label} → {l.label} →{" "}
              {state.nodes.find((n) => n.id === l.to)?.label}
            </p>
          ))}
        </>
      )}
      {state.kind === "matching" && (
        <>
          <strong>{t("Matching pairs")}</strong>
          {Object.entries(state.matches).map(([a, b]) => (
            <p key={a}>
              {state.pairs.find((p) => p.id === a)?.term} →{" "}
              {state.pairs.find((p) => p.id === b)?.description}
            </p>
          ))}
        </>
      )}
      {state.kind === "table" && (
        <div className="board-table-scroll">
          <table>
            <caption className="visually-hidden">
              {t("Comparison table")}
            </caption>
            <thead>
              <tr>
                {state.columns.map((c, i) => (
                  <th scope="col" key={i}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state.rows.map((r) => (
                <tr key={r.id}>
                  {r.cells.map((c, i) => (
                    <td key={i}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
