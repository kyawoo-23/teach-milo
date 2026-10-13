"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { BoardOutputSchema, type Board } from "@/lib/contracts";

export const SWEEP_SAMPLES = 16;
export type Series = Record<string, { x: number; metrics: Record<string, number> }[]>;
const ReplySchema = z.object({ results: z.array(BoardOutputSchema) });

// Computed values are previews only; the server re-runs calculate() on attach.
// A failed or slow update keeps the last good values and reports failure.
export function useBoardCalculation(
  board: Board,
  state: Record<string, number>,
  sweeps: string[],
) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [metrics, setMetrics] = useState<Record<string, number>>();
  const [series, setSeries] = useState<Series>({});
  const [failed, setFailed] = useState(false);
  const enabled = board.derived.length > 0 && !!board.code;
  useEffect(() => {
    if (!enabled || !loaded) return;
    let alive = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const channel = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const points = sweeps.map((id) => {
      const s = board.state.find((x) => x.id === id)!;
      return Array.from(
        { length: SWEEP_SAMPLES },
        (_, n) => s.min + ((s.max - s.min) * n) / (SWEEP_SAMPLES - 1),
      );
    });
    const batch = [
      state,
      ...sweeps.flatMap((id, n) =>
        points[n].map((x) => ({ ...state, [id]: x })),
      ),
    ];
    const ids = board.derived.map((d) => d.id);
    const receive = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.data?.channel !== channel ||
        event.data?.requestId !== requestId
      )
        return;
      clearTimeout(timeout);
      const parsed = ReplySchema.safeParse(event.data);
      if (
        !alive ||
        !parsed.success ||
        parsed.data.results.length !== batch.length ||
        parsed.data.results.some((r) => ids.some((id) => !(id in r.metrics)))
      ) {
        if (alive) setFailed(true);
        return;
      }
      const [current, ...rest] = parsed.data.results;
      setMetrics(current.metrics);
      setSeries(
        Object.fromEntries(
          sweeps.map((id, n) => [
            id,
            points[n].map((x, i) => ({
              x,
              metrics: rest[n * SWEEP_SAMPLES + i].metrics,
            })),
          ]),
        ),
      );
      setFailed(false);
    };
    window.addEventListener("message", receive);
    const debounce = setTimeout(() => {
      frame.current?.contentWindow?.postMessage(
        { type: "calculate", channel, requestId, code: board.code, batch },
        "*",
      );
      timeout = setTimeout(() => alive && setFailed(true), 2000);
    }, 120);
    return () => {
      alive = false;
      clearTimeout(debounce);
      clearTimeout(timeout);
      window.removeEventListener("message", receive);
    };
  }, [board, state, sweeps, enabled, loaded]);
  return {
    enabled,
    frame,
    onLoad: () => setLoaded(true),
    metrics: enabled ? metrics : {},
    series,
    failed: enabled && failed,
  };
}
