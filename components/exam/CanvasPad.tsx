"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { Pen, Eraser, Undo2, Redo2, Trash2, Maximize2, Plus } from "lucide-react";

const MAX_UNDO = 30;
const PRESET_WIDTHS = [2, 4, 6];
/** Height of the single long canvas in logical pixels (scrollable) */
const LONG_CANVAS_HEIGHT = 2500;
const AUTO_SAVE_INTERVAL_MS = 30_000;
const AUTO_SAVE_DEBOUNCE_MS = 3000;

interface CanvasPadProps {
  attemptId: number;
  questionId?: number;
  situationIndex?: number;
  initialImageUrl?: string | null;
  initialImageUrls?: (string | null)[];
  onSave?: (imageBase64: string, pageIndex?: number) => Promise<void>;
  readOnly?: boolean;
  compact?: boolean;
  maxWidth?: number;
  /** Single infinite scrollable canvas (no pages); auto-save every 30s and 3s after last stroke */
  longScrollable?: boolean;
}

export function CanvasPad({
  attemptId,
  questionId,
  situationIndex,
  initialImageUrl,
  initialImageUrls,
  onSave,
  readOnly = false,
  compact = false,
  maxWidth = 1200,
  longScrollable = false,
}: CanvasPadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isDrawingRef = useRef(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [lineWidth, setLineWidth] = useState(4);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [fullscreen, setFullscreen] = useState(false);
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const lastSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSaveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const debouncedSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastStrokeAtRef = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const drawContainerRef = useRef<HTMLDivElement>(null);
  const canvasSnapshotRef = useRef<string | null>(null);
  const firstMountRef = useRef(true);
  const pagesRef = useRef<string[]>([initialImageUrl ?? ""]);
  const storageKey = `canvas_${attemptId}_${questionId ?? "default"}_${situationIndex ?? 0}`;

  const pushUndo = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const data = canvas.toDataURL("image/png", 0.92);
    undoStack.current.push(data);
    if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
    redoStack.current = [];
    setRedoCount(0);
  }, []);

  const drawImageToCanvas = useCallback((urlOrDataUrl: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const img = new Image();
    img.crossOrigin = urlOrDataUrl.startsWith("data:") ? null : "anonymous";
    img.onload = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = urlOrDataUrl;
  }, []);

  const getContainerWidth = useCallback(() => {
    const container = scrollContainerRef.current ?? containerRef.current;
    const rect = container?.getBoundingClientRect();
    if (!rect?.width) return Math.min(800, maxWidth);
    return Math.min(Math.max(rect.width, 280), maxWidth);
  }, [maxWidth]);

  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = scrollContainerRef.current ?? containerRef.current;
    if (!canvas || !container) return;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const rect = container.getBoundingClientRect();
    let w = Math.max(rect.width || 400, 280);
    w = Math.min(w, maxWidth);
    let h: number;
    if (longScrollable) {
      h = LONG_CANVAS_HEIGHT;
    } else {
      h = compact ? 180 : 300;
      if (!compact) h = Math.min(rect.height || 300, 400);
    }
    const cw = Math.floor(w * dpr);
    const ch = Math.floor(h * dpr);
    canvas.width = cw;
    canvas.height = ch;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, [compact, maxWidth, lineWidth, longScrollable]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const isFirstRun = firstMountRef.current;
    if (canvas && !isFirstRun && !readOnly) {
      try {
        canvasSnapshotRef.current = canvas.toDataURL("image/png", 0.92);
      } catch (_) {}
    }
    firstMountRef.current = false;
    initCanvas();
    if (canvasSnapshotRef.current && canvasRef.current) {
      drawImageToCanvas(canvasSnapshotRef.current);
      canvasSnapshotRef.current = null;
    } else if (isFirstRun && typeof window !== "undefined" && !readOnly) {
      const saved = localStorage.getItem(storageKey);
      if (saved && !initialImageUrl) {
        try {
          drawImageToCanvas(saved);
          undoStack.current.push(saved);
        } catch (e) {
          console.warn("Failed to load canvas from localStorage", e);
        }
      }
    }
  }, [initCanvas, storageKey, readOnly, initialImageUrl, drawImageToCanvas]);

  const clearCanvasToWhite = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  useEffect(() => {
    if (longScrollable) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const data = pagesRef.current[currentPage];
    if (data) {
      drawImageToCanvas(data);
    } else {
      clearCanvasToWhite();
    }
  }, [currentPage, drawImageToCanvas, clearCanvasToWhite, longScrollable]);

  useEffect(() => {
    if (initialImageUrl && canvasRef.current && undoStack.current.length === 0 && (longScrollable || currentPage === 0)) {
      const url = initialImageUrl;
      drawImageToCanvas(url);
      const data = canvasRef.current.toDataURL("image/png", 0.92);
      undoStack.current.push(data);
      pagesRef.current[0] = data;
    }
  }, [initialImageUrl, drawImageToCanvas, currentPage, longScrollable]);

  const getCoords = (e: React.PointerEvent | PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const performSave = useCallback(() => {
    if (!onSave || !canvasRef.current || readOnly) return;
    const data = canvasRef.current.toDataURL("image/png", 0.92);
    if (!longScrollable && pagesRef.current[currentPage] !== undefined) pagesRef.current[currentPage] = data;
    if (longScrollable) pagesRef.current[0] = data;
    setSaveStatus("saving");
    onSave(data, longScrollable ? 0 : currentPage)
      .then(() => {
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
        if (typeof window !== "undefined") {
          localStorage.removeItem(storageKey);
        }
      })
      .catch(() => setSaveStatus("error"));
  }, [onSave, readOnly, storageKey, longScrollable, currentPage]);

  const scheduleDebouncedSave = useCallback(() => {
    if (!onSave || readOnly) return;
    if (debouncedSaveRef.current) clearTimeout(debouncedSaveRef.current);
    debouncedSaveRef.current = setTimeout(() => {
      debouncedSaveRef.current = null;
      performSave();
    }, AUTO_SAVE_DEBOUNCE_MS);
  }, [onSave, readOnly, performSave]);

  useEffect(() => {
    if (!longScrollable || !onSave || readOnly) return;
    const t = setInterval(performSave, AUTO_SAVE_INTERVAL_MS);
    autoSaveIntervalRef.current = t;
    return () => {
      if (autoSaveIntervalRef.current) clearInterval(autoSaveIntervalRef.current);
      autoSaveIntervalRef.current = null;
    };
  }, [longScrollable, onSave, readOnly, performSave]);

  useEffect(() => {
    const el = drawContainerRef.current;
    if (!el) return;
    const onTouchMove = (e: TouchEvent) => {
      if (isDrawingRef.current && e.cancelable) e.preventDefault();
    };
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => el.removeEventListener("touchmove", onTouchMove);
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (readOnly) return;
    if (e.cancelable) e.preventDefault();
    pushUndo();
    const { x, y } = getCoords(e);
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
    ctx.strokeStyle = tool === "eraser" ? "rgba(0,0,0,1)" : "#000000";
    ctx.lineWidth = tool === "eraser" ? lineWidth * 2 : lineWidth;
    ctx.beginPath();
    ctx.moveTo(x, y);
    isDrawingRef.current = true;
    setIsDrawing(true);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDrawing || readOnly) return;
    const { x, y } = getCoords(e);
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const saveToStorage = useCallback((data: string) => {
    if (typeof window !== "undefined" && !readOnly) {
      try {
        localStorage.setItem(storageKey, data);
      } catch (e) {
        console.warn("Failed to save canvas to localStorage", e);
      }
    }
  }, [storageKey, readOnly]);

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDrawing) return;
    isDrawingRef.current = false;
    setIsDrawing(false);
    lastStrokeAtRef.current = Date.now();
    if (canvasRef.current) {
      const data = canvasRef.current.toDataURL("image/png", 0.92);
      if (pagesRef.current[currentPage] !== undefined) pagesRef.current[currentPage] = data;
      saveToStorage(data);
    }
    if (longScrollable) {
      scheduleDebouncedSave();
      return;
    }
    if (onSave && canvasRef.current) {
      const data = canvasRef.current.toDataURL("image/png", 0.92);
      if (lastSaveRef.current) clearTimeout(lastSaveRef.current);
      lastSaveRef.current = setTimeout(() => {
        setSaveStatus("saving");
        onSave(data, currentPage)
          .then(() => {
            setSaveStatus("saved");
            setTimeout(() => setSaveStatus("idle"), 2000);
            if (typeof window !== "undefined") {
              localStorage.removeItem(storageKey);
            }
          })
          .catch(() => setSaveStatus("error"));
        lastSaveRef.current = null;
      }, 2000);
    }
  };

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const onUp = () => setIsDrawing(false);
    window.addEventListener("pointerup", onUp);
    return () => window.removeEventListener("pointerup", onUp);
  }, []);

  const handleUndo = () => {
    if (undoStack.current.length <= 1 || readOnly) return;
    redoStack.current.push(undoStack.current.pop()!);
    const prev = undoStack.current[undoStack.current.length - 1];
    if (prev) drawImageToCanvas(prev);
    setUndoCount(undoStack.current.length);
    setRedoCount(redoStack.current.length);
  };

  const handleRedo = () => {
    if (!redoStack.current.length || readOnly) return;
    const next = redoStack.current.pop()!;
    undoStack.current.push(next);
    drawImageToCanvas(next);
    setUndoCount(undoStack.current.length);
    setRedoCount(redoStack.current.length);
  };

  const handleClear = () => {
    if (readOnly) return;
    pushUndo();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };

  const handleManualSave = () => {
    if (!onSave || !canvasRef.current) return;
    const data = canvasRef.current.toDataURL("image/png", 0.92);
    if (pagesRef.current[currentPage] !== undefined) pagesRef.current[currentPage] = data;
    setSaveStatus("saving");
    onSave(data, longScrollable ? 0 : currentPage)
      .then(() => {
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
        if (typeof window !== "undefined") {
          localStorage.removeItem(storageKey);
        }
      })
      .catch(() => setSaveStatus("error"));
  };

  useEffect(() => {
    if (canvasRef.current && onSave && !readOnly) {
      (canvasRef.current as any).finalSave = async () => {
        if (lastSaveRef.current) {
          clearTimeout(lastSaveRef.current);
          lastSaveRef.current = null;
        }
        if (debouncedSaveRef.current) {
          clearTimeout(debouncedSaveRef.current);
          debouncedSaveRef.current = null;
        }
        if (canvasRef.current) {
          const data = canvasRef.current.toDataURL("image/png", 0.92);
          if (longScrollable) {
            pagesRef.current[0] = data;
            await onSave(data, 0);
          } else {
            if (pagesRef.current[currentPage] !== undefined) pagesRef.current[currentPage] = data;
            for (let i = 0; i < pagesRef.current.length; i++) {
              const d = pagesRef.current[i];
              if (d) await onSave(d, i);
            }
          }
        }
        if (typeof window !== "undefined") {
          localStorage.removeItem(storageKey);
        }
      };
    }
  }, [onSave, readOnly, storageKey, longScrollable, currentPage]);

  const canvasEl = (
    <div
      ref={(el) => {
        (drawContainerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
        if (!longScrollable && el) (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
        else if (longScrollable) (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = null;
      }}
      className={`relative rounded-lg border border-slate-200 bg-white ${longScrollable ? "overflow-visible" : "overflow-hidden"} ${!longScrollable && (compact ? "max-h-[180px]" : "min-h-[200px]")}`}
      style={{ touchAction: "none" }}
    >
      <canvas
        ref={canvasRef}
        data-canvas-pad="true"
        className="block w-full cursor-crosshair touch-none select-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        style={{ cursor: readOnly ? "default" : "crosshair" }}
      />
      {!readOnly && (
        <div className="absolute bottom-2 left-2 right-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setTool("pen")}
            className={`p-1.5 rounded ${tool === "pen" ? "bg-slate-200" : "hover:bg-slate-100"}`}
            title="Qələm"
          >
            <Pen className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setTool("eraser")}
            className={`p-1.5 rounded ${tool === "eraser" ? "bg-slate-200" : "hover:bg-slate-100"}`}
            title="Silgi"
          >
            <Eraser className="w-4 h-4" />
          </button>
          {PRESET_WIDTHS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setLineWidth(w)}
              className={`px-1.5 py-0.5 text-xs rounded ${lineWidth === w ? "bg-slate-200" : "hover:bg-slate-100"}`}
            >
              {w}
            </button>
          ))}
          <button
            type="button"
            onClick={handleUndo}
            disabled={undoStack.current.length <= 1}
            className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-40"
            title="Geri"
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleRedo}
            className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-40"
            title="İrəli"
          >
            <Redo2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleClear}
            className="p-1.5 rounded hover:bg-red-50 text-red-600"
            title="Təmizlə"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          {onSave && (
            longScrollable ? (
              <span className="ml-auto text-xs text-slate-500">
                {saveStatus === "saving" ? "Avtomatik yadda saxlanılır..." : saveStatus === "saved" ? "Saxlanıldı" : "Qaralama sahəsi"}
              </span>
            ) : (
              <button
                type="button"
                onClick={handleManualSave}
                disabled={saveStatus === "saving"}
                className="ml-auto text-xs px-2 py-1 rounded bg-primary text-white hover:bg-blue-600 disabled:opacity-60"
              >
                {saveStatus === "saving" ? "Saxlanılır..." : saveStatus === "saved" ? "Saxlanıldı" : "Yadda saxla"}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );

  const handleFullscreenOpen = () => {
    if (canvasRef.current) {
      try {
        canvasSnapshotRef.current = canvasRef.current.toDataURL("image/png", 0.92);
      } catch (_) {}
    }
    setFullscreen(true);
  };

  const handleFullscreenClose = () => {
    if (canvasRef.current) {
      try {
        canvasSnapshotRef.current = canvasRef.current.toDataURL("image/png", 0.92);
      } catch (_) {}
    }
    setFullscreen(false);
  };

  useEffect(() => {
    if (readOnly || !canvasSnapshotRef.current) return;
    const saved = canvasSnapshotRef.current;
    let cancelled = false;
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled || !canvasRef.current) return;
        drawImageToCanvas(saved);
        canvasSnapshotRef.current = null;
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  }, [fullscreen, drawImageToCanvas, readOnly]);

  const handlePageSwitch = (pageIndex: number) => {
    if (pageIndex === currentPage || longScrollable) return;
    if (canvasRef.current) {
      const data = canvasRef.current.toDataURL("image/png", 0.92);
      if (!pagesRef.current[currentPage]) pagesRef.current[currentPage] = "";
      pagesRef.current[currentPage] = data;
    }
    setCurrentPage(pageIndex);
  };

  const handleAddPage = () => {
    if (longScrollable) return;
    if (canvasRef.current) {
      const data = canvasRef.current.toDataURL("image/png", 0.92);
      if (pagesRef.current[currentPage] === undefined) pagesRef.current[currentPage] = "";
      pagesRef.current[currentPage] = data;
    }
    pagesRef.current.push("");
    setPageCount(pagesRef.current.length);
    setCurrentPage(pagesRef.current.length - 1);
  };

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
        <div className="relative max-w-4xl w-full">
          <button
            type="button"
            onClick={handleFullscreenClose}
            className="absolute -top-10 right-0 text-white hover:underline"
          >
            Bağla
          </button>
          {canvasEl}
        </div>
      </div>
    );
  }

  const inner = (
    <>
      {!compact && !readOnly && !longScrollable && pageCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-2">
          {Array.from({ length: pageCount }, (_, i) => i).map((i) => (
            <button
              key={i}
              type="button"
              onClick={() => handlePageSwitch(i)}
              className={`px-2 py-1 text-sm rounded ${currentPage === i ? "bg-primary text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
            >
              Səhifə {i + 1}
            </button>
          ))}
          <button
            type="button"
            onClick={handleAddPage}
            className="flex items-center gap-1 px-2 py-1 text-sm rounded bg-slate-100 text-slate-700 hover:bg-slate-200"
          >
            <Plus className="w-4 h-4" />
            Yeni səhifə
          </button>
        </div>
      )}
      {longScrollable ? (
        <div
          ref={scrollContainerRef}
          className="rounded-lg border border-slate-200 bg-slate-50 overflow-y-auto overflow-x-hidden"
          style={{ maxHeight: "50vh", minHeight: 280 }}
        >
          <div ref={containerRef} className="w-full">
            {canvasEl}
          </div>
        </div>
      ) : (
        canvasEl
      )}
      {!compact && !readOnly && (
        <button
          type="button"
          onClick={handleFullscreenOpen}
          className="mt-1 p-1 rounded hover:bg-slate-100 text-slate-500"
          title="Tam ekran"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      )}
    </>
  );

  return <div className="relative">{inner}</div>;
}
