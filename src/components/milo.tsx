"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Pause, Play } from "lucide-react";
import { MiloArtwork } from "./milo-artwork";
import { animateMilo, MILO_MOTIONS, type MiloState } from "./milo-motion";

const MOTION_KEY = "teachback-milo-motion-paused";
const MotionContext = createContext({ paused: false, toggle: () => {} });

export function MiloMotionProvider({ children }: { children: ReactNode }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const read = () => {
      try {
        setPaused(localStorage.getItem(MOTION_KEY) === "1");
      } catch {
        /* Storage is optional. */
      }
    };
    read();
    window.addEventListener("storage", read);
    return () => window.removeEventListener("storage", read);
  }, []);
  function toggle() {
    const next = !paused;
    setPaused(next);
    try {
      localStorage.setItem(MOTION_KEY, next ? "1" : "0");
    } catch {
      /* Keep the in-memory preference. */
    }
  }
  return (
    <MotionContext.Provider value={{ paused, toggle }}>
      {children}
    </MotionContext.Provider>
  );
}

export function MiloMotionToggle() {
  const { paused, toggle } = useContext(MotionContext);
  return (
    <button
      type="button"
      className="milo-motion-toggle"
      onClick={toggle}
      aria-label={paused ? "Resume Milo motion" : "Pause Milo motion"}
      title={paused ? "Resume Milo motion" : "Pause Milo motion"}
    >
      {paused ? (
        <Play size={13} aria-hidden="true" />
      ) : (
        <Pause size={13} aria-hidden="true" />
      )}
    </button>
  );
}

export function Milo({
  size = 48,
  thinking = false,
  state,
  interactive = false,
  animated = true,
  reactionKey,
}: {
  size?: number;
  thinking?: boolean;
  state?: MiloState;
  interactive?: boolean;
  animated?: boolean;
  reactionKey?: string | number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { paused } = useContext(MotionContext);
  const [greeting, setGreeting] = useState<{
    id: number;
    baseKey: string;
  } | null>(null);
  const [settled, setSettled] = useState<string | null>(null);
  const requested = thinking ? "thinking" : (state ?? "idle");
  const greetingAllowed =
    requested !== "thinking" && requested !== "celebration";
  const baseKey = `${requested}:${reactionKey ?? ""}`;
  const greetingId =
    greetingAllowed && greeting?.baseKey === baseKey ? greeting.id : 0;
  const requestKey = `${baseKey}:${greetingId}`;
  const playing =
    settled === requestKey
      ? MILO_MOTIONS[requested].loop
        ? requested
        : "idle"
      : greetingId
        ? "greeting"
        : requested;

  // A greeting interrupted by a new lesson state must not replay afterwards.
  useEffect(() => {
    setGreeting(null);
  }, [baseKey]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !animated) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = true;
    let animations: Animation[] = [];
    let disposed = false;
    const sync = () => {
      if (paused || preference.matches) {
        animations.forEach((animation) => animation.cancel());
        animations = [];
        return;
      }
      if (!animations.length && typeof svg.animate === "function") {
        animations = animateMilo(svg, playing);
        if (!MILO_MOTIONS[playing].loop && animations.length) {
          void Promise.all(animations.map((animation) => animation.finished))
            .then(() => {
              if (!disposed) setSettled(requestKey);
            })
            .catch(() => {
              /* Cancelled on state changes or reduced motion. */
            });
        }
      }
      animations.forEach((animation) => {
        if (visible && !document.hidden) {
          if (animation.playState === "paused") animation.play();
        } else if (animation.playState === "running" || animation.pending)
          animation.pause();
      });
    };
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            sync();
          });
    observer?.observe(svg);
    preference.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      disposed = true;
      observer?.disconnect();
      preference.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
      animations.forEach((animation) => animation.cancel());
    };
  }, [animated, paused, playing, requestKey]);

  const artwork = (
    <MiloArtwork
      size={size}
      state={playing}
      svgRef={svgRef}
      decorative={interactive}
    />
  );
  if (!interactive) return artwork;
  return (
    <button
      type="button"
      className="milo-greet"
      aria-label="Say hello to Milo"
      aria-disabled={!greetingAllowed || undefined}
      onClick={() => {
        if (!greetingAllowed) return;
        setSettled(null);
        setGreeting((value) => ({ id: (value?.id ?? 0) + 1, baseKey }));
      }}
      style={{ width: size, height: size }}
    >
      {artwork}
    </button>
  );
}
