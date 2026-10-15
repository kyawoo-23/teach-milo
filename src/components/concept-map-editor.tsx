"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Controller } from "react-hook-form";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Link2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  conceptPairKey,
  conceptHasOpenPair,
  conceptPairsAvailable,
  uniqueConceptLinks,
  type MapState,
} from "@/lib/board-tools";
import { ConceptFormSchema, relationshipFormSchema } from "@/lib/form-schemas";
import { CustomSelect } from "./custom-select";
import { FieldError, useSchemaForm } from "./schema-form";
import { useI18n } from "./locale-context";
import { Modal, ModalFooter } from "./ui";
import styles from "./concept-map-editor.module.css";

const TOOLBAR_ICON_SIZE = 18;

type Editor =
  | { kind: "concept"; id?: string; at?: Point }
  | { kind: "relationship"; id?: string; from?: string };
type ContextMenuState = {
  x: number;
  y: number;
  target:
    | { kind: "concept"; id: string }
    | { kind: "relationship"; id: string }
    | { kind: "canvas"; point: Point };
};
type MapProps = {
  state: MapState;
  onChange: (state: MapState) => void;
  disabled: boolean;
};
type Point = { x: number; y: number };
const bounded = (x: number, y: number, inset: Point = { x: 0, y: 0 }) => ({
  x: Math.max(inset.x, Math.min(CANVAS_WIDTH - inset.x, x)),
  y: Math.max(inset.y, Math.min(CANVAS_HEIGHT - inset.y, y)),
});
const placed = (point: { x: number; y: number }) => ({
  left: `${(point.x / CANVAS_WIDTH) * 100}%`,
  top: `${(point.y / CANVAS_HEIGHT) * 100}%`,
});

export function ConceptMap({ state, onChange, disabled }: MapProps) {
  const { t } = useI18n();
  const id = useId();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [selected, setSelected] = useState("");
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [nodeInsets, setNodeInsets] = useState<Record<string, Point>>({});
  const nodes = state.nodes.map((node) => ({
    ...node,
    ...bounded(node.x, node.y, nodeInsets[node.id]),
  }));
  const selectedNode = nodes.find((node) => node.id === selected);
  const canConnect = conceptPairsAvailable(state.nodes, state.links);
  useEffect(() => {
    const links = uniqueConceptLinks(state.links);
    if (links.length === state.links.length) return;
    onChange({ ...state, links });
  }, [onChange, state]);
  const selectionControls = useRef<HTMLFieldSetElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const suppressClick = useRef(false);
  const scene = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected && !selectedNode) setSelected("");
  }, [selected, selectedNode]);
  useEffect(() => {
    if (!selected || editor) return;
    const clearOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (selectionControls.current?.contains(target)) return;
      // Controls can resize/recentre an expanded board when selection clears.
      // Keep them in place through pointerup/click so their action can activate.
      if (
        target instanceof Element &&
        target.closest("button, input, textarea, select, [role='combobox']") &&
        scene.current?.closest(".board-workspace")?.contains(target)
      )
        return;
      if (
        target instanceof Element &&
        (target.closest("[data-concept-context-menu]") ||
          target.closest("[data-concept-id]")?.parentElement === scene.current)
      )
        return;
      setSelected("");
    };
    const clearOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (
        event.target instanceof Element &&
        event.target.closest("[data-concept-context-menu]")
      )
        return;
      if (
        !scene.current
          ?.closest(".concept-map-editor")
          ?.contains(document.activeElement)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      setSelected("");
    };
    document.addEventListener("pointerdown", clearOutside, true);
    document.addEventListener("keydown", clearOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", clearOutside, true);
      document.removeEventListener("keydown", clearOnEscape, true);
    };
  }, [selected, editor]);
  const [relationshipPositions, setRelationshipPositions] = useState<
    Record<string, { x: number; y: number }>
  >({});
  useLayoutEffect(() => {
    const element = scene.current;
    if (!element) return;
    const layout = () => {
      if (!element.clientWidth || !element.clientHeight) return;
      const view = element.getBoundingClientRect();
      const origin = {
        x: view.left + element.clientLeft,
        y: view.top + element.clientTop,
      };
      const rect = (item: Element) => {
        const box = item.getBoundingClientRect();
        return {
          x: box.left - origin.x,
          y: box.top - origin.y,
          width: box.width,
          height: box.height,
        };
      };
      const concepts = new Map(
        [...element.querySelectorAll<HTMLElement>("[data-concept-id]")].map(
          (item) => [item.dataset.conceptId!, rect(item)],
        ),
      );
      // Clamp each centre by its actual size, leaving room for the focus ring.
      // Re-measure on resize so narrow screens retain the same reachable edges.
      const insets = Object.fromEntries(
        [...concepts].map(([nodeId, box]) => [
          nodeId,
          {
            x: Math.min(
              CANVAS_WIDTH / 2,
              ((box.width / 2 + 6) / element.clientWidth) * CANVAS_WIDTH,
            ),
            y: Math.min(
              CANVAS_HEIGHT / 2,
              ((box.height / 2 + 6) / element.clientHeight) * CANVAS_HEIGHT,
            ),
          },
        ]),
      );
      setNodeInsets((previous) =>
        JSON.stringify(previous) === JSON.stringify(insets) ? previous : insets,
      );
      const obstacles = [...concepts.values()];
      const next: Record<string, { x: number; y: number }> = {};
      for (const item of element.querySelectorAll<HTMLElement>(
        "[data-relationship-id]",
      )) {
        const link = state.links.find(
          (link) => link.id === item.dataset.relationshipId,
        );
        const from = link && concepts.get(link.from),
          to = link && concepts.get(link.to);
        if (!link || !from || !to) continue;
        const size = rect(item);
        const center = {
          x: (from.x + from.width / 2 + to.x + to.width / 2) / 2,
          y: (from.y + from.height / 2 + to.y + to.height / 2) / 2,
        };
        const offsets: [number, number][] = [[0, 0]];
        for (const gap of [52, 104, 156])
          offsets.push(
            [0, gap],
            [0, -gap],
            [gap, 0],
            [-gap, 0],
            [gap, gap],
            [-gap, gap],
            [gap, -gap],
            [-gap, -gap],
          );
        const candidates = offsets.map(([dx, dy]) => {
          const x = Math.max(
            6 + size.width / 2,
            Math.min(element.clientWidth - size.width / 2 - 6, center.x + dx),
          );
          const y = Math.max(
            6 + size.height / 2,
            Math.min(element.clientHeight - size.height / 2 - 6, center.y + dy),
          );
          const box = {
            x: x - size.width / 2,
            y: y - size.height / 2,
            width: size.width,
            height: size.height,
          };
          const overlap = obstacles.reduce(
            (sum, other) =>
              sum +
              Math.max(
                0,
                Math.min(box.x + box.width + 6, other.x + other.width) -
                  Math.max(box.x - 6, other.x),
              ) *
                Math.max(
                  0,
                  Math.min(box.y + box.height + 6, other.y + other.height) -
                    Math.max(box.y - 6, other.y),
                ),
            0,
          );
          return { x, y, box, overlap };
        });
        const best = candidates.reduce((best, candidate) =>
          candidate.overlap < best.overlap ? candidate : best,
        );
        obstacles.push(best.box);
        next[link.id] = {
          x: (best.x / element.clientWidth) * CANVAS_WIDTH,
          y: (best.y / element.clientHeight) * CANVAS_HEIGHT,
        };
      }
      setRelationshipPositions((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      );
    };
    layout();
    const observer = new ResizeObserver(layout);
    observer.observe(element);
    element
      .querySelectorAll("[data-concept-id]")
      .forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [state.nodes, state.links, nodeInsets]);
  const drag = useRef<{
    id: string;
    pointer: number;
    x: number;
    y: number;
    origin: { x: number; y: number };
    original: { x: number; y: number };
  } | null>(null);
  useEffect(() => {
    if (!editor && opener.current) {
      (opener.current.isConnected ? opener.current : addButton.current)?.focus({
        preventScroll: true,
      });
      opener.current = null;
    }
  }, [editor]);
  const open = (target: Editor, element: HTMLElement) => {
    if (disabled) return;
    opener.current = element;
    setEditor(target);
  };
  const showContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    if (disabled) return;
    event.preventDefault();
    const element = event.target instanceof Element ? event.target : null;
    const concept = element?.closest<HTMLElement>("[data-concept-id]");
    const relationship = concept
      ? null
      : element?.closest<HTMLElement>("[data-relationship-id]");
    const anchor = concept ?? relationship;
    const fromKeyboard = event.clientX === 0 && event.clientY === 0;
    let x = event.clientX;
    let y = event.clientY;
    if (fromKeyboard && anchor) {
      const rect = anchor.getBoundingClientRect();
      x = rect.left;
      y = rect.bottom;
    } else if (fromKeyboard && scene.current) {
      const rect = scene.current.getBoundingClientRect();
      x = rect.left + rect.width / 2;
      y = rect.top + rect.height / 2;
    }
    if (concept?.dataset.conceptId) {
      setSelected(concept.dataset.conceptId);
      setMenu({
        x,
        y,
        target: { kind: "concept", id: concept.dataset.conceptId },
      });
      return;
    }
    if (relationship?.dataset.relationshipId) {
      setMenu({
        x,
        y,
        target: {
          kind: "relationship",
          id: relationship.dataset.relationshipId,
        },
      });
      return;
    }
    const bounds = scene.current?.getBoundingClientRect();
    const point =
      bounds?.width && bounds.height
        ? bounded(
            ((x - bounds.left) / bounds.width) * CANVAS_WIDTH,
            ((y - bounds.top) / bounds.height) * CANVAS_HEIGHT,
          )
        : { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 };
    setMenu({ x, y, target: { kind: "canvas", point } });
  };
  const menuAnchor = (target: ContextMenuState["target"]) => {
    const selector =
      target.kind === "concept"
        ? `[data-concept-id="${CSS.escape(target.id)}"]`
        : target.kind === "relationship"
          ? `[data-relationship-id="${CSS.escape(target.id)}"]`
          : "";
    return (
      (selector
        ? scene.current?.querySelector<HTMLElement>(selector)
        : addButton.current) ?? addButton.current
    );
  };
  const openFromMenu = (target: Editor) => {
    if (!menu) return;
    const element = menuAnchor(menu.target);
    setMenu(null);
    if (element) open(target, element);
  };
  const deleteConcept = (nodeId: string) => {
    onChange({
      ...state,
      nodes: state.nodes.filter((item) => item.id !== nodeId),
      links: state.links.filter(
        (link) => link.from !== nodeId && link.to !== nodeId,
      ),
    });
    setSelected("");
    setMenu(null);
    requestAnimationFrame(() =>
      addButton.current?.focus({ preventScroll: true }),
    );
  };
  const deleteRelationship = (linkId: string) => {
    onChange({
      ...state,
      links: state.links.filter((item) => item.id !== linkId),
    });
    setMenu(null);
    requestAnimationFrame(() =>
      addButton.current?.focus({ preventScroll: true }),
    );
  };
  useEffect(() => {
    if (disabled || !selected || editor) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Backspace" && event.key !== "Delete") return;
      if (
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.isComposing
      )
        return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          "input, textarea, select, [contenteditable='true'], [data-concept-context-menu]",
        )
      )
        return;
      event.preventDefault();
      deleteConcept(selected);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [disabled, selected, editor, state, onChange]);
  const move = (nodeId: string, point: { x: number; y: number }) =>
    onChange({
      ...state,
      nodes: state.nodes.map((node) =>
        node.id === nodeId ? { ...node, ...point } : node,
      ),
    });
  const cancelDrag = () => {
    const current = drag.current;
    drag.current = null;
    if (current) move(current.id, current.original);
  };
  return (
    <div className={`concept-map-editor ${styles.editor}`}>
      <div className="matching-toolbar">
        <p className="tool-hint">
          {t(
            "Select a concept to move or edit it. Delete or Backspace removes the selected concept. Right-click for more actions. Click outside to deselect.",
          )}
        </p>
        <div
          className="sketch-toolbar"
          role="group"
          aria-label={t("Concept map actions")}
        >
          <div className="sketch-tool-group">
            <button
              ref={addButton}
              type="button"
              title={t("Add concept")}
              aria-label={t("Add concept")}
              disabled={disabled || state.nodes.length >= 10}
              onClick={(event) =>
                open({ kind: "concept" }, event.currentTarget)
              }
            >
              <Plus size={TOOLBAR_ICON_SIZE} aria-hidden="true" />
              <span className="visually-hidden">{t("Add concept")}</span>
            </button>
            <button
              type="button"
              title={t("Add relationship")}
              aria-label={t("Add relationship")}
              disabled={disabled || !canConnect}
              onClick={(event) =>
                open({ kind: "relationship" }, event.currentTarget)
              }
            >
              <Link2 size={TOOLBAR_ICON_SIZE} aria-hidden="true" />
              <span className="visually-hidden">{t("Add relationship")}</span>
            </button>
          </div>
        </div>
      </div>
      <div
        ref={scene}
        className={styles.scene}
        data-concept-scene=""
        onContextMenu={showContextMenu}
        style={{
          minHeight: Math.min(
            440,
            220 +
              Math.max(0, nodes.length - 4) * 20 +
              Math.max(0, state.links.length - 4) * 8,
          ),
        }}
      >
        <svg
          viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={t("Concept relationships")}
        >
          <title>{t("Concept relationships")}</title>
          <defs>
            <marker
              id={`${id}-arrow`}
              viewBox="0 0 10 10"
              refX="5"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
            </marker>
          </defs>
          {state.links.map((link) => {
            const from = nodes.find((node) => node.id === link.from);
            const to = nodes.find((node) => node.id === link.to);
            const badge = relationshipPositions[link.id];
            return from && to ? (
              <g key={link.id}>
                <polyline
                  points={`${from.x},${from.y} ${(from.x + to.x) / 2},${(from.y + to.y) / 2} ${to.x},${to.y}`}
                  markerMid={`url(#${id}-arrow)`}
                />
                {badge && (
                  <line
                    className={styles.leader}
                    x1={(from.x + to.x) / 2}
                    y1={(from.y + to.y) / 2}
                    x2={badge.x}
                    y2={badge.y}
                  />
                )}
              </g>
            ) : null;
          })}
        </svg>
        {state.links.map((link) => {
          const from = nodes.find((node) => node.id === link.from);
          const to = nodes.find((node) => node.id === link.to);
          return from && to ? (
            <button
              type="button"
              key={link.id}
              data-relationship-id={link.id}
              className={styles.relationship}
              style={placed(
                relationshipPositions[link.id] ?? {
                  x: (from.x + to.x) / 2,
                  y: (from.y + to.y) / 2,
                },
              )}
              disabled={disabled}
              aria-label={t("Edit relationship {name}", { name: link.label })}
              title={`${from.label} → ${to.label}: ${link.label}`}
              onClick={(event) =>
                open({ kind: "relationship", id: link.id }, event.currentTarget)
              }
            >
              <ArrowRight
                size={14}
                aria-hidden="true"
                style={{
                  transform: `rotate(${(Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI}deg)`,
                }}
              />
              <span>{link.label || t("Relationship")}</span>
            </button>
          ) : null;
        })}
        {nodes.map((node) => (
          <button
            type="button"
            key={node.id}
            data-concept-id={node.id}
            className={styles.node}
            style={placed(node)}
            disabled={disabled}
            aria-label={t("Select concept {name}", { name: node.label })}
            aria-pressed={selected === node.id}
            title={node.label}
            onClick={(event) => {
              if (suppressClick.current) {
                suppressClick.current = false;
                return;
              }
              setSelected(node.id);
            }}
            onKeyDown={(event) => {
              const delta: Record<string, [number, number]> = {
                ArrowLeft: [-15, 0],
                ArrowRight: [15, 0],
                ArrowUp: [0, -15],
                ArrowDown: [0, 15],
              };
              if (delta[event.key] && !disabled) {
                event.preventDefault();
                setSelected(node.id);
                move(
                  node.id,
                  bounded(
                    node.x + delta[event.key][0],
                    node.y + delta[event.key][1],
                    nodeInsets[node.id],
                  ),
                );
              }
            }}
            onPointerDown={(event) => {
              if (
                disabled ||
                event.button !== 0 ||
                !event.isPrimary ||
                drag.current
              )
                return;
              suppressClick.current = false;
              setSelected(node.id);
              const original = state.nodes.find((item) => item.id === node.id)!;
              drag.current = {
                id: node.id,
                pointer: event.pointerId,
                x: event.clientX,
                y: event.clientY,
                origin: { x: node.x, y: node.y },
                original: { x: original.x, y: original.y },
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const current = drag.current;
              if (!current || current.pointer !== event.pointerId) return;
              const dx = event.clientX - current.x,
                dy = event.clientY - current.y;
              if (!suppressClick.current && Math.hypot(dx, dy) < 5) return;
              suppressClick.current = true;
              const bounds = event.currentTarget.parentElement!;
              move(
                current.id,
                bounded(
                  current.origin.x + (dx / bounds.clientWidth) * CANVAS_WIDTH,
                  current.origin.y + (dy / bounds.clientHeight) * CANVAS_HEIGHT,
                  nodeInsets[current.id],
                ),
              );
            }}
            onPointerUp={(event) => {
              if (drag.current?.pointer !== event.pointerId) return;
              drag.current = null;
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={cancelDrag}
            onLostPointerCapture={cancelDrag}
          >
            <span>{node.label || t("Concept")}</span>
          </button>
        ))}
        {!nodes.length && (
          <div className={styles.empty}>
            <Link2 size={28} aria-hidden="true" />
            <p>{t("Add two concepts to start your map.")}</p>
          </div>
        )}
      </div>
      {selectedNode && (
        <fieldset ref={selectionControls} className="board-object-inspector">
          <legend className="visually-hidden">{t("Selected concept")}</legend>
          <label className="tool-field">
            {t("Selected concept")}
            <strong>{selectedNode.label || t("Concept")}</strong>
          </label>
          <div
            className="sketch-toolbar"
            role="group"
            aria-label={t("Concept map actions")}
          >
            <div className="sketch-tool-group">
              <button
                type="button"
                disabled={disabled}
                title={t("Edit concept {name}", {
                  name: selectedNode.label,
                })}
                aria-label={t("Edit concept {name}", {
                  name: selectedNode.label,
                })}
                onClick={(event) =>
                  open(
                    { kind: "concept", id: selectedNode.id },
                    event.currentTarget,
                  )
                }
              >
                <Pencil size={TOOLBAR_ICON_SIZE} aria-hidden="true" />
                <span className="visually-hidden">{t("Edit")}</span>
              </button>
              <button
                type="button"
                disabled={disabled}
                title={t("Delete concept {name}", {
                  name: selectedNode.label,
                })}
                aria-label={t("Delete concept {name}", {
                  name: selectedNode.label,
                })}
                onClick={() => deleteConcept(selectedNode.id)}
              >
                <Trash2 size={TOOLBAR_ICON_SIZE} aria-hidden="true" />
                <span className="visually-hidden">{t("Delete")}</span>
              </button>
            </div>
            <div
              className="sketch-tool-group"
              role="group"
              aria-label={t("Position")}
            >
              {(
                [
                  ["Move left", -15, 0, ArrowLeft],
                  ["Move up", 0, -15, ArrowUp],
                  ["Move down", 0, 15, ArrowDown],
                  ["Move right", 15, 0, ArrowRight],
                ] as const
              ).map(([label, x, y, Icon]) => {
                const point = bounded(
                  selectedNode.x + x,
                  selectedNode.y + y,
                  nodeInsets[selectedNode.id],
                );
                return (
                  <button
                    type="button"
                    key={label}
                    title={t(label)}
                    disabled={
                      disabled ||
                      (Math.abs(point.x - selectedNode.x) *
                        ((scene.current?.clientWidth ?? CANVAS_WIDTH) /
                          CANVAS_WIDTH) <
                        0.5 &&
                        Math.abs(point.y - selectedNode.y) *
                          ((scene.current?.clientHeight ?? CANVAS_HEIGHT) /
                            CANVAS_HEIGHT) <
                          0.5)
                    }
                    aria-label={t(label)}
                    onClick={() => move(selectedNode.id, point)}
                  >
                    <Icon size={TOOLBAR_ICON_SIZE} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </div>
        </fieldset>
      )}
      <p className={styles.summary}>
        {t("{concepts}/10 concepts · {relationships}/20 relationships", {
          concepts: nodes.length,
          relationships: state.links.length,
        })}
      </p>
      {editor?.kind === "concept" && (
        <ConceptPopup
          key={`concept-${editor.id ?? "new"}`}
          {...{ state, onChange, disabled }}
          nodeId={editor.id}
          at={editor.at}
          onClose={() => setEditor(null)}
          onSelect={setSelected}
          onRelationship={(target) => setEditor(target)}
        />
      )}
      {menu &&
        createPortal(
          <MapContextMenu
            point={menu}
            label={t("Concept map actions")}
            onClose={() => {
              const anchor = menuAnchor(menu.target);
              setMenu(null);
              anchor?.focus({ preventScroll: true });
            }}
          >
            <ContextMenuItems
              target={menu.target}
              disabled={disabled}
              nodes={nodes}
              links={state.links}
              canConnect={canConnect}
              onAddConcept={(point) =>
                openFromMenu({ kind: "concept", at: point })
              }
              onAddRelationship={(from) =>
                openFromMenu({ kind: "relationship", from })
              }
              onEditConcept={(id) => openFromMenu({ kind: "concept", id })}
              onEditRelationship={(id) =>
                openFromMenu({ kind: "relationship", id })
              }
              onDeleteConcept={deleteConcept}
              onDeleteRelationship={deleteRelationship}
            />
          </MapContextMenu>,
          scene.current?.closest("dialog") ?? document.body,
        )}
      {editor?.kind === "relationship" && (
        <RelationshipPopup
          key={`relationship-${editor.id ?? "new"}`}
          {...{ state, onChange, disabled }}
          target={editor}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}

function ContextMenuItems({
  target,
  disabled,
  nodes,
  links,
  canConnect,
  onAddConcept,
  onAddRelationship,
  onEditConcept,
  onEditRelationship,
  onDeleteConcept,
  onDeleteRelationship,
}: {
  target: ContextMenuState["target"];
  disabled: boolean;
  nodes: MapState["nodes"];
  links: MapState["links"];
  canConnect: boolean;
  onAddConcept: (point: Point) => void;
  onAddRelationship: (from?: string) => void;
  onEditConcept: (id: string) => void;
  onEditRelationship: (id: string) => void;
  onDeleteConcept: (id: string) => void;
  onDeleteRelationship: (id: string) => void;
}) {
  const { t } = useI18n();
  if (target.kind === "canvas")
    return (
      <>
        <button
          type="button"
          role="menuitem"
          disabled={disabled || nodes.length >= 10}
          onClick={() => onAddConcept(target.point)}
        >
          {t("Add concept")}
        </button>
        <button
          type="button"
          role="menuitem"
          disabled={disabled || !canConnect}
          onClick={() => onAddRelationship()}
        >
          {t("Add relationship")}
        </button>
      </>
    );
  if (target.kind === "concept") {
    const name = nodes.find((node) => node.id === target.id)?.label ?? "";
    return (
      <>
        <button
          type="button"
          role="menuitem"
          disabled={disabled}
          aria-label={t("Edit concept {name}", { name })}
          onClick={() => onEditConcept(target.id)}
        >
          {t("Edit")}
        </button>
        <button
          type="button"
          role="menuitem"
          disabled={disabled || !conceptHasOpenPair(target.id, nodes, links)}
          onClick={() => onAddRelationship(target.id)}
        >
          {t("Add relationship")}
        </button>
        <button
          type="button"
          role="menuitem"
          className={styles.menuDelete}
          disabled={disabled}
          aria-label={t("Delete concept {name}", { name })}
          onClick={() => onDeleteConcept(target.id)}
        >
          {t("Delete")}
        </button>
      </>
    );
  }
  const name = links.find((link) => link.id === target.id)?.label ?? "";
  return (
    <>
      <button
        type="button"
        role="menuitem"
        disabled={disabled}
        aria-label={t("Edit relationship {name}", { name })}
        onClick={() => onEditRelationship(target.id)}
      >
        {t("Edit")}
      </button>
      <button
        type="button"
        role="menuitem"
        className={styles.menuDelete}
        disabled={disabled}
        aria-label={t("Delete relationship {name}", { name })}
        onClick={() => onDeleteRelationship(target.id)}
      >
        {t("Delete")}
      </button>
    </>
  );
}

function MapContextMenu({
  point,
  label,
  onClose,
  children,
}: {
  point: { x: number; y: number };
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!element) return;
    const close = () => onCloseRef.current();
    const popover = "popover" in HTMLElement.prototype;
    if (popover) element.showPopover();
    const rect = element.getBoundingClientRect();
    const pad = 8;
    element.style.left = `${Math.max(pad, Math.min(point.x, window.innerWidth - rect.width - pad))}px`;
    element.style.top = `${Math.max(pad, Math.min(point.y, window.innerHeight - rect.height - pad))}px`;
    element
      .querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
      ?.focus({ preventScroll: true });
    const outside = (event: globalThis.PointerEvent) => {
      if (element.contains(event.target as Node)) return;
      close();
    };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      if (popover && element.matches(":popover-open")) element.hidePopover();
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [point.x, point.y]);
  return (
    <div
      ref={menuRef}
      className={styles.menu}
      role="menu"
      aria-label={label}
      data-concept-context-menu=""
      popover="manual"
      style={{ left: point.x, top: point.y }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
          return;
        }
        if (event.key === "Tab") {
          onClose();
          return;
        }
        const items = [
          ...menuRef.current!.querySelectorAll<HTMLButtonElement>(
            '[role="menuitem"]:not(:disabled)',
          ),
        ];
        const index = items.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const next =
          event.key === "ArrowDown"
            ? (index + 1) % items.length
            : event.key === "ArrowUp"
              ? (index - 1 + items.length) % items.length
              : event.key === "Home"
                ? 0
                : event.key === "End"
                  ? items.length - 1
                  : -1;
        if (!items.length || next < 0) return;
        event.preventDefault();
        items[next]?.focus();
      }}
    >
      {children}
    </div>
  );
}

function PopupActions({
  form,
  onClose,
  onDelete,
  deleteLabel,
  disabled,
  submitLabel,
}: {
  form: string;
  onClose: () => void;
  onDelete?: () => void;
  deleteLabel?: string;
  disabled: boolean;
  submitLabel: string;
}) {
  const { t } = useI18n();
  return (
    <div className={styles.actions}>
      {onDelete && (
        <button
          type="button"
          className={`danger-button ${styles.deleteButton}`}
          disabled={disabled}
          aria-label={deleteLabel}
          onClick={onDelete}
        >
          <Trash2 size={17} aria-hidden="true" /> {t("Delete")}
        </button>
      )}
      <button type="button" className="secondary-button" onClick={onClose}>
        {t("Cancel")}
      </button>
      <button
        type="submit"
        form={form}
        className="primary-button"
        disabled={disabled}
      >
        {submitLabel}
      </button>
    </div>
  );
}

function ConceptPopup({
  state,
  onChange,
  disabled,
  nodeId,
  at,
  onClose,
  onSelect,
  onRelationship,
}: MapProps & {
  nodeId?: string;
  at?: Point;
  onClose: () => void;
  onSelect: (id: string) => void;
  onRelationship: (target: Editor) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const node = state.nodes.find((node) => node.id === nodeId);
  const form = useSchemaForm(ConceptFormSchema, { name: node?.label ?? "" });
  const field = form.register("name");
  const [name, setName] = form.state("name");
  const firstInput = useRef<HTMLInputElement>(null);
  const position =
    at ??
    bounded(
      160 + (state.nodes.length % 3) * 300,
      100 + Math.floor(state.nodes.length / 3) * 140,
    );
  const links = state.links.filter(
    (link) => link.from === nodeId || link.to === nodeId,
  );
  const formId = `${id}-concept`;
  return (
    <Modal
      open
      title={t(node ? "Edit concept" : "Add concept")}
      className={styles.popup}
      initialFocusRef={firstInput}
      onClose={onClose}
    >
      <form
        id={formId}
        className={styles.form}
        onSubmit={form.handleSubmit(({ name }) => {
          if (disabled || (nodeId ? !node : state.nodes.length >= 10)) return;
          const savedId = node?.id ?? crypto.randomUUID();
          onChange({
            ...state,
            nodes: node
              ? state.nodes.map((item) =>
                  item.id === nodeId ? { ...item, label: name } : item,
                )
              : [...state.nodes, { id: savedId, label: name, ...position }],
          });
          onSelect(savedId);
          onClose();
        })}
      >
        <div className={styles.body}>
          <div className={styles.field}>
            <label htmlFor={`${id}-name`}>
              {t(node ? "Concept" : "New concept")}
            </label>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              name={field.name}
              onBlur={field.onBlur}
              id={`${id}-name`}
              {...form.a11y("name", `${id}-name`)}
              ref={(element) => {
                field.ref(element);
                firstInput.current = element;
              }}
              maxLength={100}
              disabled={disabled}
              placeholder={t("Name a key idea from your lesson")}
              autoFocus
              enterKeyHint="done"
              autoComplete="off"
            />
            <FieldError
              id={`${id}-name`}
              message={form.formState.errors.name?.message}
            />
          </div>
          {node && (
            <div className={styles.connections}>
              <strong>{t("Relationships")}</strong>
              {links.map((link) => (
                <button
                  key={link.id}
                  type="button"
                  disabled={disabled}
                  aria-label={t("Edit relationship {name}", {
                    name: link.label,
                  })}
                  onClick={() =>
                    onRelationship({ kind: "relationship", id: link.id })
                  }
                >
                  <span>{link.label}</span>
                  <small>
                    {state.nodes.find((node) => node.id === link.from)?.label} →{" "}
                    {state.nodes.find((node) => node.id === link.to)?.label}
                  </small>
                </button>
              ))}
              <button
                type="button"
                className={styles.addAction}
                disabled={
                  disabled ||
                  !conceptHasOpenPair(node.id, state.nodes, state.links)
                }
                onClick={() =>
                  onRelationship({ kind: "relationship", from: node.id })
                }
              >
                <Plus size={16} aria-hidden="true" /> {t("Add relationship")}
              </button>
            </div>
          )}
        </div>
      </form>
      <ModalFooter className={styles.footer}>
        <PopupActions
          form={formId}
          onClose={onClose}
          disabled={disabled}
          submitLabel={t(node ? "Save changes" : "Add concept")}
          deleteLabel={
            node ? t("Delete concept {name}", { name: node.label }) : undefined
          }
          onDelete={
            node
              ? () => {
                  onChange({
                    ...state,
                    nodes: state.nodes.filter((item) => item.id !== node.id),
                    links: state.links.filter(
                      (link) => link.from !== node.id && link.to !== node.id,
                    ),
                  });
                  onSelect("");
                  onClose();
                }
              : undefined
          }
        />
      </ModalFooter>
    </Modal>
  );
}

function RelationshipPopup({
  state,
  onChange,
  disabled,
  target,
  onClose,
}: MapProps & {
  target: Extract<Editor, { kind: "relationship" }>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const link = state.links.find((link) => link.id === target.id);
  const form = useSchemaForm(
    relationshipFormSchema(
      state.nodes.map((node) => node.id),
      state.links,
      link?.id,
    ),
    {
      from: link?.from ?? target.from ?? "",
      to: link?.to ?? "",
      relation: link?.label ?? "",
    },
  );
  const [from] = form.state("from");
  const [relation, setRelation] = form.state("relation");
  const firstInput = useRef<HTMLButtonElement>(null);
  const formId = `${id}-relationship`;
  return (
    <Modal
      open
      title={t(link ? "Edit relationship" : "Add relationship")}
      className={styles.popup}
      initialFocusRef={firstInput}
      onClose={onClose}
    >
      <form
        id={formId}
        className={styles.form}
        onSubmit={form.handleSubmit(({ from, to, relation }) => {
          if (
            disabled ||
            (target.id ? !link : state.links.length >= 20) ||
            state.links.some(
              (item) =>
                item.id !== link?.id &&
                conceptPairKey(item.from, item.to) === conceptPairKey(from, to),
            )
          )
            return;
          onChange({
            ...state,
            links: link
              ? state.links.map((item) =>
                  item.id === link.id
                    ? { ...item, from, to, label: relation }
                    : item,
                )
              : [
                  ...state.links,
                  { id: crypto.randomUUID(), from, to, label: relation },
                ],
          });
          onClose();
        })}
      >
        <div className={styles.body}>
          {(["from", "to"] as const).map((name) => (
            <div className={styles.field} key={name}>
              <label htmlFor={`${id}-${name}`}>
                {t(name === "from" ? "From" : "To")}
              </label>
              <Controller
                control={form.control}
                name={name}
                render={({ field, fieldState }) => (
                  <CustomSelect
                    id={`${id}-${name}`}
                    label={t(name === "from" ? "From" : "To")}
                    name={field.name}
                    value={field.value}
                    disabled={disabled}
                    onBlur={field.onBlur}
                    inputRef={(element) => {
                      field.ref(element);
                      if (name === "from") firstInput.current = element;
                    }}
                    invalid={!!fieldState.error}
                    describedBy={
                      fieldState.error ? `${id}-${name}-error` : undefined
                    }
                    placeholder={t("Choose a concept")}
                    options={state.nodes
                      .filter((node) => {
                        if (name === "from")
                          return conceptHasOpenPair(
                            node.id,
                            state.nodes,
                            state.links.filter((item) => item.id !== link?.id),
                          );
                        if (!from || node.id === from) return false;
                        return !state.links.some(
                          (item) =>
                            item.id !== link?.id &&
                            conceptPairKey(item.from, item.to) ===
                              conceptPairKey(from, node.id),
                        );
                      })
                      .map((node) => ({ value: node.id, label: node.label }))}
                    onChange={(value) => {
                      field.onChange(value);
                      if (name !== "from") return;
                      const nextTo = form.getValues("to");
                      if (
                        nextTo === value ||
                        state.links.some(
                          (item) =>
                            item.id !== link?.id &&
                            conceptPairKey(item.from, item.to) ===
                              conceptPairKey(value, nextTo),
                        )
                      )
                        form.setValue("to", "");
                    }}
                  />
                )}
              />
              <FieldError
                id={`${id}-${name}`}
                message={form.formState.errors[name]?.message}
              />
            </div>
          ))}
          <div className={styles.field}>
            <label htmlFor={`${id}-relation`}>{t("Relationship")}</label>
            <input
              type="text"
              value={relation}
              onChange={(event) => setRelation(event.currentTarget.value)}
              name={form.register("relation").name}
              onBlur={form.register("relation").onBlur}
              ref={form.register("relation").ref}
              id={`${id}-relation`}
              {...form.a11y("relation", `${id}-relation`)}
              maxLength={300}
              disabled={disabled}
              enterKeyHint="done"
              autoComplete="off"
            />
            <FieldError
              id={`${id}-relation`}
              message={form.formState.errors.relation?.message}
            />
          </div>
        </div>
      </form>
      <ModalFooter className={styles.footer}>
        <PopupActions
          form={formId}
          onClose={onClose}
          disabled={disabled}
          submitLabel={t(link ? "Save changes" : "Connect concepts")}
          deleteLabel={
            link
              ? t("Delete relationship {name}", { name: link.label })
              : undefined
          }
          onDelete={
            link
              ? () => {
                  onChange({
                    ...state,
                    links: state.links.filter((item) => item.id !== link.id),
                  });
                  onClose();
                }
              : undefined
          }
        />
      </ModalFooter>
    </Modal>
  );
}
