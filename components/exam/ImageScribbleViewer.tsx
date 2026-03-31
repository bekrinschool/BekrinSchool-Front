"use client";

import { useRef, useState, useEffect } from "react";

export type ScribbleStroke = {
  tool: "pen" | "eraser";
  width: number;
  points: { x: number; y: number }[];
};

export type ScribbleDrawingData = {
  strokes?: ScribbleStroke[];
};

export interface ImageScribbleViewerProps {
  pages: string[];
  pdfScribbles?: { pageIndex: number; drawingData: ScribbleDrawingData }[];
  className?: string;
  maxHeight?: number;
}

export function ImageScribbleViewer({
  pages = [],
  pdfScribbles = [],
  className = "",
  maxHeight = 480,
}: ImageScribbleViewerProps) {
  const [pageDimensions, setPageDimensions] = useState<{ width: number; height: number }[]>([]);
  const [containerWidth, setContainerWidth] = useState(700);
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayCanvasesRef = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const scribblesByPage = useRef<Map<number, ScribbleDrawingData>>(new Map());

  useEffect(() => {
    pdfScribbles.forEach(({ pageIndex, drawingData }) => {
      scribblesByPage.current.set(pageIndex, drawingData || { strokes: [] });
    });
  }, [pdfScribbles]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateWidth = () => setContainerWidth(el.clientWidth || 700);
    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pages.length]);

  useEffect(() => {
    pageDimensions.forEach((d, i) => {
      const overlay = overlayCanvasesRef.current.get(i);
      if (overlay && d?.width && d?.height) {
        overlay.width = d.width;
        overlay.height = d.height;
      }
    });
  }, [pageDimensions]);

  useEffect(() => {
    if (!pdfScribbles?.length || pageDimensions.length === 0) return;
    for (let i = 0; i < pageDimensions.length; i++) {
      const data = scribblesByPage.current.get(i);
      const overlay = overlayCanvasesRef.current.get(i);
      if (!overlay || !data?.strokes?.length) continue;
      const ctx = overlay.getContext("2d");
      if (!ctx) continue;
      if (overlay.width > 0 && overlay.height > 0) ctx.clearRect(0, 0, overlay.width, overlay.height);
      data.strokes.forEach((stroke) => {
        ctx.strokeStyle = stroke.tool === "eraser" ? "rgba(255,255,255,1)" : "#000";
        ctx.lineWidth = stroke.tool === "eraser" ? stroke.width * 2 : stroke.width;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
        if (stroke.points.length < 2) return;
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
        stroke.points.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
        ctx.stroke();
      });
    }
  }, [pdfScribbles, pageDimensions]);

  const handleImageLoad = (index: number, naturalWidth: number, naturalHeight: number) => {
    const w = containerWidth || 700;
    const h = (w / naturalWidth) * naturalHeight;
    setPageDimensions((prev) => {
      const next = [...prev];
      next[index] = { width: w, height: h };
      return next;
    });
  };

  if (!pages.length) {
    return (
      <div className={`flex items-center justify-center py-8 text-slate-500 ${className}`} style={{ minHeight: maxHeight ? Math.min(maxHeight, 200) : 200 }}>
        Səhifə tapılmadı
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`overflow-auto ${className}`} style={{ maxHeight }}>
      <div className="mx-auto w-full max-w-3xl px-2 py-2 space-y-4">
        {pages.map((src, i) => (
          <div
            key={i}
            className="relative bg-white shadow rounded overflow-hidden page-wrapper"
            style={{
              width: pageDimensions[i]?.width ?? "100%",
              height: pageDimensions[i]?.height ?? undefined,
              marginBottom: 40,
            }}
          >
            <img
              src={src}
              alt={`Səhifə ${i + 1}`}
              className="exam-page block w-full h-auto"
              onLoad={(e) => {
                const img = e.currentTarget;
                handleImageLoad(i, img.naturalWidth, img.naturalHeight);
              }}
            />
            <canvas
              ref={(canvasEl) => {
                if (canvasEl) overlayCanvasesRef.current.set(i, canvasEl);
                else overlayCanvasesRef.current.delete(i);
              }}
              className="scribble-layer absolute inset-0 block w-full h-full pointer-events-none"
              style={{ top: 0, left: 0, width: "100%", height: "100%" }}
              aria-hidden
            />
          </div>
        ))}
      </div>
    </div>
  );
}
