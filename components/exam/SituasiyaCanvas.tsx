"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Canvas as FabricCanvas, PencilBrush, FabricImage } from "fabric";
import { Pen, Eraser, Undo2, Trash2, Maximize2, X, ArrowDownUp } from "lucide-react";

const DEFAULT_CANVAS_HEIGHT = 600;
const MIN_CANVAS_HEIGHT = 400;
const MAX_CANVAS_HEIGHT = 12000;

/** Read persisted logical size from saved Fabric payload (backend stores whole object in canvas_json). */
export function extractSavedCanvasDimensions(json: object | null | undefined): {
  height: number;
  width?: number;
} {
  if (!json || typeof json !== "object") {
    return { height: DEFAULT_CANVAS_HEIGHT };
  }
  const o = json as Record<string, unknown>;
  const meta =
    o.metadata && typeof o.metadata === "object"
      ? (o.metadata as Record<string, unknown>)
      : undefined;
  const rawH =
    Number(meta?.height) ||
    Number(o.canvasHeight) ||
    Number(o.height) ||
    0;
  const rawW =
    Number(meta?.width) ||
    Number(o.canvasWidth) ||
    Number(o.width) ||
    0;
  const height =
    rawH >= MIN_CANVAS_HEIGHT
      ? Math.min(MAX_CANVAS_HEIGHT, rawH)
      : DEFAULT_CANVAS_HEIGHT;
  const width = rawW > 0 ? Math.min(1200, rawW) : undefined;
  return { height, width };
}

/** Fabric loadFromJSON may not understand our app-specific keys — strip before load. */
function toFabricLoadPayload(json: object): object {
  const o = { ...(json as Record<string, unknown>) };
  delete o.metadata;
  return o;
}

/** Fabric v7: avoid clearRect after dispose / lost context. */
function isFabricCanvasDrawable(canvas: FabricCanvas | null): boolean {
  if (!canvas) return false;
  try {
    const el = canvas.lowerCanvasEl;
    return !!(el && el.getContext("2d"));
  } catch {
    return false;
  }
}

// WCAG AA contrast on white (#ffffff): dark enough for visibility (no bright yellow)
const COLORS = [
  { value: "#1a1a1a", label: "Qara" },
  { value: "#c0392b", label: "Qırmızı" },
  { value: "#1a5276", label: "Göy" },
  { value: "#1e8449", label: "Yaşıl" },
  { value: "#b7950b", label: "Sarı" },
  { value: "#d35400", label: "Narıncı" },
  { value: "#6c3483", label: "Bənövşəyi" },
  { value: "#7b241c", label: "Tünd qırmızı" },
];

export interface SituasiyaCanvasProps {
  initialJson?: object | null;
  /** Fallback: load this image when no initialJson (e.g. legacy canvas saved as PNG) */
  initialImageUrl?: string | null;
  onSaveStatus?: (status: "saved" | "unsaved" | "saving" | "error") => void;
  answerId?: number;
  situationIndex?: number;
}

export interface SituasiyaCanvasRef {
  getCanvasData: () => {
    json: object;
    snapshotBase64: string;
    width: number;
    height: number;
  };
  /** Parent called save API successfully — update top status only (no extra labels). */
  markServerSaving: () => void;
  markServerSaved: () => void;
  markServerSaveFailed: () => void;
}

const SituasiyaCanvas = forwardRef<SituasiyaCanvasRef, SituasiyaCanvasProps>(
  function SituasiyaCanvas(
    { initialJson, initialImageUrl, onSaveStatus, answerId: _answerId, situationIndex: _situationIndex },
    ref
  ) {
    const canvasElRef = useRef<HTMLCanvasElement>(null);
    const fabricRef = useRef<FabricCanvas | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const fullscreenWrapperRef = useRef<HTMLDivElement>(null);

    const [tool, setTool] = useState<"pen" | "eraser">("pen");
    const [color, setColor] = useState("#1a1a1a");
    const [brushSize, setBrushSize] = useState(3);
    const [isFullscreen, setIsFullscreen] = useState(false);
    /** Logical height (px); seeded from saved JSON, updated by "Böyüt" and after Fabric init. */
    const [canvasH, setCanvasH] = useState(
      () => extractSavedCanvasDimensions(initialJson).height
    );
    const [saveStatus, setSaveStatus] = useState<"saved" | "unsaved" | "saving" | "error">("saved");
    const [fabricError, setFabricError] = useState(false);

    /** Screen-space eraser ring center, relative to drawing container (matches Fabric eraser brush width = brushSize * 4). */
    const [eraserPointer, setEraserPointer] = useState<{ x: number; y: number } | null>(
      null
    );
    const eraserRafRef = useRef<number | null>(null);
    const eraserPendingRef = useRef<{ x: number; y: number } | null>(null);

    const eraserBrushWidthPx = brushSize * 4;

    const scheduleEraserPointerUpdate = useCallback((clientX: number, clientY: number) => {
      const node = containerRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      eraserPendingRef.current = {
        x: clientX - rect.left,
        y: clientY - rect.top,
      };
      if (eraserRafRef.current == null) {
        eraserRafRef.current = requestAnimationFrame(() => {
          eraserRafRef.current = null;
          const p = eraserPendingRef.current;
          if (p) setEraserPointer(p);
        });
      }
    }, []);

    const onDrawingContainerPointerMove = useCallback(
      (e: ReactPointerEvent<HTMLDivElement>) => {
        if (tool !== "eraser") return;
        scheduleEraserPointerUpdate(e.clientX, e.clientY);
      },
      [tool, scheduleEraserPointerUpdate]
    );

    const onDrawingContainerPointerEnter = useCallback(
      (e: ReactPointerEvent<HTMLDivElement>) => {
        if (tool !== "eraser") return;
        scheduleEraserPointerUpdate(e.clientX, e.clientY);
      },
      [tool, scheduleEraserPointerUpdate]
    );

    const onDrawingContainerPointerLeave = useCallback(() => {
      setEraserPointer(null);
      eraserPendingRef.current = null;
      if (eraserRafRef.current != null) {
        cancelAnimationFrame(eraserRafRef.current);
        eraserRafRef.current = null;
      }
    }, []);

    useEffect(() => {
      if (tool !== "eraser") {
        setEraserPointer(null);
        eraserPendingRef.current = null;
        if (eraserRafRef.current != null) {
          cancelAnimationFrame(eraserRafRef.current);
          eraserRafRef.current = null;
        }
      }
    }, [tool]);

    useEffect(() => {
      return () => {
        if (eraserRafRef.current != null) {
          cancelAnimationFrame(eraserRafRef.current);
        }
      };
    }, []);

    // Initialize Fabric canvas (after container is in DOM)
    /* eslint-disable react-hooks/exhaustive-deps -- mount-only; including initialJson would recreate Fabric and wipe strokes while modal stays open */
    useEffect(() => {
      setFabricError(false);
      const el = canvasElRef.current;
      if (!el || typeof window === "undefined") return;
      const ctx = el.getContext("2d");
      if (!ctx) return;
      const container = containerRef.current;
      const w = Math.min(container?.offsetWidth ?? 800, 1200);
      const savedDims = extractSavedCanvasDimensions(initialJson);
      const h = Math.max(savedDims.height, MIN_CANVAS_HEIGHT);
      let canvas: FabricCanvas | null = null;
      let isMounted = true;
      try {
        canvas = new FabricCanvas(el, {
          isDrawingMode: true,
          backgroundColor: "#ffffff",
          width: w,
          height: h,
        });
      } catch {
        setFabricError(true);
        return;
      }
      fabricRef.current = canvas;
      setCanvasH(h);

      try {
        if (initialJson && typeof initialJson === "object") {
          const payload = toFabricLoadPayload(initialJson);
          /* Fabric v7: loadFromJSON returns Promise; 2nd arg is a per-object reviver, NOT a done callback. */
          void canvas
            .loadFromJSON(payload)
            .then(() => {
              if (!isMounted || fabricRef.current !== canvas || !isFabricCanvasDrawable(canvas)) {
                return;
              }
              try {
                const restoredH = extractSavedCanvasDimensions(initialJson).height;
                const targetH = Math.max(
                  restoredH,
                  canvas.getHeight(),
                  MIN_CANVAS_HEIGHT
                );
                canvas.setDimensions({ width: w, height: targetH });
                setCanvasH(targetH);
                canvas.renderAll();
                setSaveStatus("saved");
                onSaveStatus?.("saved");
              } catch {
                if (isMounted) setFabricError(true);
              }
            })
            .catch(() => {
              if (isMounted) setFabricError(true);
            });
        } else if (initialImageUrl) {
          FabricImage.fromURL(initialImageUrl)
            .then((img) => {
              const c = fabricRef.current;
              if (!isMounted || !c || !isFabricCanvasDrawable(c)) return;
              img.scaleToWidth(w);
              c.add(img);
              c.renderAll();
              setSaveStatus("saved");
              onSaveStatus?.("saved");
            })
            .catch(() => {});
        }
      } catch {
        setFabricError(true);
      }

      canvas.on("path:created", () => {
        setSaveStatus("unsaved");
        onSaveStatus?.("unsaved");
      });

      const ro = container
        ? new ResizeObserver(() => {
            const c = fabricRef.current;
            if (!c || !container || !isFabricCanvasDrawable(c)) return;
            try {
              const newW = Math.min(container.offsetWidth || 800, 1200);
              if (newW !== c.getWidth()) {
                c.setDimensions({ width: newW, height: c.getHeight() });
                c.renderAll();
              }
            } catch {
              setFabricError(true);
            }
          })
        : null;
      if (ro && container) ro.observe(container);

      return () => {
        isMounted = false;
        ro?.disconnect();
        if (canvas) {
          try {
            canvas.off();
            canvas.dispose();
          } catch (e) {
            console.warn("Fabric.js dispose warning (harmless):", e);
          }
        }
        fabricRef.current = null;
      };
    }, []);
    /* eslint-enable react-hooks/exhaustive-deps */

    // Update brush when tool/color/size changes
    useEffect(() => {
      const canvas = fabricRef.current;
      if (!canvas || !isFabricCanvasDrawable(canvas)) return;
      try {
        canvas.isDrawingMode = true;
        const brush = new PencilBrush(canvas);
        if (tool === "pen") {
          brush.color = color;
          brush.width = brushSize;
        } else {
          brush.color = "#ffffff";
          brush.width = brushSize * 4;
        }
        canvas.freeDrawingBrush = brush;
      } catch {
        setFabricError(true);
      }
    }, [tool, color, brushSize]);

    useImperativeHandle(
      ref,
      () => ({
        getCanvasData: () => {
          const canvas = fabricRef.current;
          if (!canvas) {
            return {
              json: {},
              snapshotBase64: "",
              width: 800,
              height: canvasH,
            };
          }
          try {
            if (!isFabricCanvasDrawable(canvas)) {
              return {
                json: {},
                snapshotBase64: "",
                width: 800,
                height: canvasH,
              };
            }
            const cw = canvas.getWidth();
            const ch = canvas.getHeight();
            const json = canvas.toJSON() as Record<string, unknown>;
            json.canvasWidth = cw;
            json.canvasHeight = ch;
            json.metadata = { width: cw, height: ch };
            const snapshotBase64 = canvas.toDataURL({
              format: "png",
              multiplier: 1,
            });
            return {
              json,
              snapshotBase64,
              width: cw,
              height: ch,
            };
          } catch {
            return {
              json: {},
              snapshotBase64: "",
              width: 800,
              height: canvasH,
            };
          }
        },
        markServerSaving: () => {
          setSaveStatus("saving");
          onSaveStatus?.("saving");
        },
        markServerSaved: () => {
          setSaveStatus("saved");
          onSaveStatus?.("saved");
        },
        markServerSaveFailed: () => {
          setSaveStatus("error");
          onSaveStatus?.("error");
        },
      }),
      [canvasH, onSaveStatus]
    );

    const expandHeight = useCallback(() => {
      const canvas = fabricRef.current;
      if (!canvas || !isFabricCanvasDrawable(canvas)) return;
      const newH = canvas.getHeight() + 400;
      canvas.setDimensions({ width: canvas.getWidth(), height: newH });
      setCanvasH(newH);
      canvas.renderAll();
      setSaveStatus("unsaved");
    }, []);

    const clearCanvas = useCallback(() => {
      const canvas = fabricRef.current;
      if (!canvas || !isFabricCanvasDrawable(canvas)) return;
      canvas.getObjects().forEach((obj) => canvas.remove(obj));
      canvas.renderAll();
      setSaveStatus("unsaved");
    }, []);

    const undo = useCallback(() => {
      const canvas = fabricRef.current;
      if (!canvas || !isFabricCanvasDrawable(canvas)) return;
      const objects = canvas.getObjects();
      if (objects.length > 0) {
        canvas.remove(objects[objects.length - 1]);
        canvas.renderAll();
        setSaveStatus("unsaved");
      }
    }, []);

    const toggleFullscreen = useCallback(() => {
      // Internal UI overlay only. Do NOT call browser Fullscreen API here.
      // This prevents non-PDF exam security fullscreen from being dropped.
      setIsFullscreen((prev) => !prev);
    }, []);

    useEffect(() => {
      if (typeof window === "undefined") return;
      window.dispatchEvent(
        new CustomEvent("situation-fullscreen-change", {
          detail: { open: isFullscreen },
        })
      );
    }, [isFullscreen]);

    if (fabricError) {
      return (
        <div className="relative bg-white rounded-lg p-4 border border-amber-200 bg-amber-50/50">
          <p className="text-sm text-amber-800">Qaralama paneli yüklənə bilmədi. Səhifəni yeniləyib yenidən cəhd edin.</p>
        </div>
      );
    }

    const rangePct = `${((brushSize - 1) / 11) * 100}%`;

    const saveStatusEl = (
      <span
        className={`ml-auto text-xs font-medium ${
          saveStatus === "saved"
            ? "text-emerald-600"
            : saveStatus === "error"
              ? "text-rose-600"
              : "text-slate-500"
        }`}
      >
        {saveStatus === "saved"
          ? "Yadda saxlanıldı"
          : saveStatus === "saving"
            ? "Saxlanılır..."
            : saveStatus === "error"
              ? "Saxlama xətası"
              : "Saxlanılmayıb"}
      </span>
    );

    const expandBtn = (
      <button
        type="button"
        onClick={expandHeight}
        title="Şaquli ölçünü 400px artır"
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md shadow-sm hover:bg-slate-50 transition-colors"
      >
        <ArrowDownUp className="w-4 h-4" />
        Böyüt
      </button>
    );

    const fullscreenToggleBtn = (
      <button
        type="button"
        onClick={toggleFullscreen}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md shadow-sm hover:bg-slate-50 transition-colors"
      >
        <Maximize2 className="w-4 h-4" />
        Tam ekran
      </button>
    );

    const drawingToolsRow = (
      <>
        <div className="flex rounded-md overflow-hidden border border-slate-300 bg-white shadow-sm">
          <button
            type="button"
            onClick={() => setTool("pen")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors ${
              tool === "pen"
                ? "bg-slate-700 text-white"
                : "bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            <Pen className="w-4 h-4" />
            Qələm
          </button>
          <button
            type="button"
            onClick={() => setTool("eraser")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors border-l border-slate-200 ${
              tool === "eraser"
                ? "bg-slate-700 text-white"
                : "bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            <Eraser className="w-4 h-4" />
            Silgi
          </button>
        </div>

        <div className="h-6 w-px bg-slate-300 hidden sm:block" aria-hidden />

        <div className="flex items-center gap-1.5">
          {COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => {
                setColor(c.value);
                setTool("pen");
              }}
              title={c.label}
              style={{ background: c.value }}
              className={`w-5 h-5 rounded-full border border-gray-300 shadow-sm transition-all ${
                color === c.value && tool === "pen"
                  ? "border-slate-800 ring-2 ring-slate-400 ring-offset-1"
                  : "hover:border-slate-500"
              }`}
            />
          ))}
        </div>

        <div className="h-6 w-px bg-slate-300 hidden sm:block" aria-hidden />

        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-600">Ölçü</span>
          <input
            type="range"
            min={1}
            max={12}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            className="situasiya-brush-range"
            style={
              {
                ["--situasiya-range-pct" as string]: rangePct,
              } as CSSProperties
            }
          />
          <span className="text-xs font-mono text-slate-600 w-5 tabular-nums">{brushSize}</span>
        </div>

        <div className="h-6 w-px bg-slate-300 hidden sm:block" aria-hidden />

        <button
          type="button"
          onClick={undo}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md shadow-sm hover:bg-slate-50 transition-colors"
        >
          <Undo2 className="w-4 h-4" />
          Geri al
        </button>
        <button
          type="button"
          onClick={clearCanvas}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-red-700 bg-white border border-red-200 rounded-md shadow-sm hover:bg-red-50 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
          Təmizlə
        </button>
      </>
    );

    const toolbarEmbedded = (
      <div className="flex flex-wrap items-center gap-2 shrink-0 px-3 py-2 bg-slate-100 border-b border-slate-200 rounded-t-lg">
        {drawingToolsRow}
        <div className="h-6 w-px bg-slate-300 hidden sm:block" aria-hidden />
        {expandBtn}
        <div className="h-6 w-px bg-slate-300 hidden sm:block" aria-hidden />
        {fullscreenToggleBtn}
        {saveStatusEl}
      </div>
    );

    const toolbarFullscreen = (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
        {drawingToolsRow}
        {saveStatusEl}
      </div>
    );

    return (
      <div
        ref={fullscreenWrapperRef}
        data-situation-fullscreen={isFullscreen ? "true" : "false"}
        className={
          isFullscreen
            ? "fixed inset-0 z-[100] flex flex-col bg-slate-50"
            : "relative bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden flex flex-col"
        }
        style={isFullscreen ? { maxHeight: "100dvh" } : undefined}
      >
        {!isFullscreen && toolbarEmbedded}

        <div
          className={
            isFullscreen
              ? "flex min-h-0 flex-1 flex-col overflow-hidden"
              : "flex min-h-0 flex-1 overflow-auto bg-slate-200/30"
          }
          style={
            isFullscreen
              ? { minHeight: 0 }
              : { maxHeight: "min(70vh, 640px)", minHeight: 0 }
          }
        >
          <div
            className={
              isFullscreen
                ? "flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-3 sm:p-4"
                : "contents"
            }
          >
            <div
              className={
                isFullscreen
                  ? "flex w-full max-w-full flex-col items-stretch gap-3 lg:max-w-4xl"
                  : "contents"
              }
            >
              {isFullscreen && (
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  {expandBtn}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFullscreen();
                    }}
                    title="Tam ekrandan çıx"
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
                  >
                    <X className="h-4 w-4 shrink-0" aria-hidden />
                    Bağla
                  </button>
                </div>
              )}

              {isFullscreen && toolbarFullscreen}

              <div
                className={
                  isFullscreen
                    ? "min-h-0 w-full max-h-[min(72dvh,calc(100dvh-14rem))] overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
                    : "contents"
                }
              >
                <div
                  className={
                    (isFullscreen
                      ? "relative mx-auto inline-block w-full max-w-full rounded-lg border border-slate-200 bg-white shadow-inner"
                      : "relative inline-block rounded-b-lg border border-slate-200 border-t-0 bg-white shadow-inner") +
                    (tool === "eraser" ? " cursor-none" : "")
                  }
                  ref={containerRef}
                  style={{ touchAction: "none", minHeight: canvasH }}
                  onPointerMove={onDrawingContainerPointerMove}
                  onPointerEnter={onDrawingContainerPointerEnter}
                  onPointerLeave={onDrawingContainerPointerLeave}
                >
                  <canvas id="situasiya-fabric-canvas" ref={canvasElRef} />
                  {tool === "eraser" && eraserPointer != null && (
                    <div
                      className="pointer-events-none absolute z-[30] rounded-full border border-dashed border-slate-600 bg-transparent shadow-[0_0_0_1px_rgba(255,255,255,0.85)_inset]"
                      style={{
                        width: eraserBrushWidthPx,
                        height: eraserBrushWidthPx,
                        left: eraserPointer.x - eraserBrushWidthPx / 2,
                        top: eraserPointer.y - eraserBrushWidthPx / 2,
                      }}
                      aria-hidden
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
);

SituasiyaCanvas.displayName = "SituasiyaCanvas";
export default SituasiyaCanvas;
