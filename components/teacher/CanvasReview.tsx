"use client";

import { useEffect, useRef, useState } from "react";
import { Canvas as FabricCanvas } from "fabric";

interface CanvasReviewProps {
  canvasJson: Record<string, unknown> | null | undefined;
  canvasSnapshot?: string | null;
}

export default function CanvasReview({ canvasJson, canvasSnapshot }: CanvasReviewProps) {
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [loadError, setLoadError] = useState(false);

  // When we have a snapshot image, prefer it for teacher review to avoid Fabric context errors (clearRect, removeChild).
  const snapshotUrl = typeof canvasSnapshot === "string" && canvasSnapshot.trim() ? canvasSnapshot : null;

  useEffect(() => {
    setLoadError(false);
    if (snapshotUrl) return; // No Fabric when showing snapshot only
    const el = canvasElRef.current;
    if (!el || !canvasJson || typeof window === "undefined") return;
    const ctx = el.getContext("2d");
    if (!ctx) return;

    const meta =
      canvasJson.metadata && typeof canvasJson.metadata === "object"
        ? (canvasJson.metadata as Record<string, unknown>)
        : undefined;
    const savedW =
      Number(meta?.width) ||
      (canvasJson.canvasWidth as number) ||
      (canvasJson.width as number) ||
      800;
    const savedH =
      Number(meta?.height) ||
      (canvasJson.canvasHeight as number) ||
      (canvasJson.height as number) ||
      600;
    const containerW = containerRef.current?.offsetWidth ?? savedW;

    const scale = containerW / savedW;
    const displayH = savedH * scale;

    let canvas: InstanceType<typeof FabricCanvas> | null = null;
    let isMounted = true;
    try {
      canvas = new FabricCanvas(el, {
        width: containerW,
        height: displayH,
        selection: false,
        interactive: false,
      });

      const fabricJson = { ...canvasJson };
      delete (fabricJson as Record<string, unknown>).metadata;

      void canvas
        .loadFromJSON(fabricJson)
        .then(() => {
          if (!isMounted || !canvas) return;
          try {
            const lowerEl = canvas.lowerCanvasEl;
            if (!lowerEl?.getContext("2d")) return;
            canvas.setZoom(scale);
            canvas.setDimensions({ width: containerW, height: displayH });
            canvas.renderAll();
          } catch {
            setLoadError(true);
          }
        })
        .catch(() => {
          if (isMounted) setLoadError(true);
        });
    } catch {
      setLoadError(true);
    }

    return () => {
      isMounted = false;
      if (!canvas) return;
      try {
        canvas.off();
        canvas.dispose();
      } catch (e) {
        const err = e as Error & { name?: string; message?: string };
        const isHarmless = err?.name === "NotFoundError" || (typeof err?.message === "string" && (err.message.includes("removeChild") || err.message.includes("clearRect")));
        if (!isHarmless) console.warn("Fabric.js dispose warning (harmless):", e);
      }
    };
  }, [canvasJson, snapshotUrl]);

  // Prefer snapshot image when available — avoids Fabric and context errors in grading view.
  if (snapshotUrl) {
    return (
      <div ref={containerRef} className="rounded border border-slate-200 overflow-hidden bg-white">
        <img
          src={snapshotUrl}
          alt="Situasiya qaralama"
          className="max-w-full h-auto block"
        />
      </div>
    );
  }

  if (!canvasJson) {
    return (
      <div ref={containerRef} className="rounded border border-slate-200 overflow-hidden bg-white p-4 text-slate-500 text-sm">
        Qaralama məlumatı yoxdur.
      </div>
    );
  }

  if (loadError) {
    return (
      <div ref={containerRef} className="rounded border border-slate-200 overflow-hidden bg-white p-4 text-slate-500 text-sm">
        {canvasSnapshot ? (
          <img src={canvasSnapshot} alt="Situasiya qaralama" className="max-w-full h-auto block" />
        ) : (
          "Qaralamanı göstərmək mümkün olmadı."
        )}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="rounded border border-slate-200 overflow-hidden bg-white">
      <canvas ref={canvasElRef} />
    </div>
  );
}
