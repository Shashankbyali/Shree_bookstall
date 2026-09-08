"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RotateCcw, Sparkles, Undo2, X } from "lucide-react";

type Crop = { x: number; y: number; w: number; h: number };

type Props = {
  jobId: string;
  fileId: string;
  fileName: string;
  /** True when this file already has edits that can be undone. */
  enhanced: boolean;
  onClose: () => void;
  onSaved: () => void;
};

type Handle = "nw" | "ne" | "sw" | "se" | "move";

const FULL: Crop = { x: 0, y: 0, w: 1, h: 1 };
const MIN_SIZE = 0.05;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Crop + brightness editor for a scanned page.
 *
 * Every apply is computed from the customer's original upload, never from the
 * previous result, so dragging the sliders back and forth cannot progressively
 * degrade the image.
 */
export function ScanEditor({ jobId, fileId, fileName, enhanced, onClose, onSaved }: Props) {
  const [crop, setCrop] = useState<Crop>(FULL);
  const [brightness, setBrightness] = useState(1);
  const [contrast, setContrast] = useState(1);
  const [grayscale, setGrayscale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [autoCrop, setAutoCrop] = useState<Crop | null>(null);

  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ handle: Handle; startX: number; startY: number; start: Crop } | null>(null);
  // Mirrored in a ref so pointer handlers can read the crop they started from
  // without re-subscribing the window listeners on every drag frame.
  const cropRef = useRef(crop);
  useEffect(() => {
    cropRef.current = crop;
  }, [crop]);

  const previewUrl = `/api/jobs/${jobId}/files/${fileId}?preview=1&source=1`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}/files/${fileId}/enhance`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error || "Could not load this image");

        setAutoCrop(data.suggestedCrop ?? null);
        const s = data.settings ?? {};
        setBrightness(typeof s.brightness === "number" ? s.brightness : 1);
        setContrast(typeof s.contrast === "number" ? s.contrast : 1);
        setGrayscale(s.grayscale === true);
        setCrop(s.crop ?? data.suggestedCrop ?? FULL);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load this image");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId, fileId]);

  const startDrag = useCallback((handle: Handle, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      handle,
      startX: e.clientX,
      startY: e.clientY,
      start: cropRef.current,
    };
  }, []);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const drag = dragRef.current;
    const frame = frameRef.current;
    if (!drag || !frame) return;

    const rect = frame.getBoundingClientRect();
    const dx = (e.clientX - drag.startX) / rect.width;
    const dy = (e.clientY - drag.startY) / rect.height;
    const s = drag.start;

    setCrop(() => {
      if (drag.handle === "move") {
        return {
          ...s,
          x: clamp01(Math.min(s.x + dx, 1 - s.w)),
          y: clamp01(Math.min(s.y + dy, 1 - s.h)),
        };
      }
      // Resize from the dragged corner, keeping the opposite corner pinned.
      let { x, y, w, h } = s;
      if (drag.handle === "nw" || drag.handle === "sw") {
        const nx = clamp01(Math.min(s.x + dx, s.x + s.w - MIN_SIZE));
        w = s.x + s.w - nx;
        x = nx;
      } else {
        w = Math.max(MIN_SIZE, Math.min(s.w + dx, 1 - s.x));
      }
      if (drag.handle === "nw" || drag.handle === "ne") {
        const ny = clamp01(Math.min(s.y + dy, s.y + s.h - MIN_SIZE));
        h = s.y + s.h - ny;
        y = ny;
      } else {
        h = Math.max(MIN_SIZE, Math.min(s.h + dy, 1 - s.y));
      }
      return { x, y, w, h };
    });
  }, []);

  useEffect(() => {
    const stop = () => {
      dragRef.current = null;
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [onPointerMove]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function apply() {
    setSaving(true);
    setError("");
    try {
      const isFullFrame = crop.w >= 0.999 && crop.h >= 0.999;
      const res = await fetch(`/api/jobs/${jobId}/files/${fileId}/enhance`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          // Sending null asks the server to auto-detect instead.
          crop: isFullFrame ? null : crop,
          brightness,
          contrast,
          grayscale,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function revert() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/jobs/${jobId}/files/${fileId}/enhance`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not undo");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not undo");
    } finally {
      setSaving(false);
    }
  }

  // Approximates the server pipeline closely enough to judge the settings.
  const filter = `brightness(${brightness}) contrast(${contrast})${grayscale ? " grayscale(1)" : ""}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-3 sm:p-6">
      <div className="paper-card flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white">
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div className="min-w-0">
            <h2 className="font-display truncate text-lg font-semibold text-ink">
              Crop &amp; brighten
            </h2>
            <p className="truncate text-xs text-muted">{fileName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-muted hover:bg-paper hover:text-ink"
            aria-label="Close editor"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-20 text-muted">
              <Loader2 className="h-5 w-5 animate-spin" />
              Analysing image…
            </div>
          ) : (
            <>
              <div
                ref={frameRef}
                className="relative mx-auto max-h-[45vh] w-fit touch-none select-none overflow-hidden rounded-xl bg-paper"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewUrl}
                  alt={fileName}
                  draggable={false}
                  className="max-h-[45vh] w-auto max-w-full"
                  style={{ filter }}
                />
                {/* Dim everything outside the crop so the result is obvious. */}
                <div className="pointer-events-none absolute inset-0 bg-ink/45" />
                <div
                  className="absolute cursor-move overflow-hidden ring-2 ring-white"
                  style={{
                    left: `${crop.x * 100}%`,
                    top: `${crop.y * 100}%`,
                    width: `${crop.w * 100}%`,
                    height: `${crop.h * 100}%`,
                  }}
                  onPointerDown={(e) => startDrag("move", e)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewUrl}
                    alt=""
                    draggable={false}
                    className="absolute max-w-none"
                    style={{
                      filter,
                      width: `${100 / crop.w}%`,
                      height: `${100 / crop.h}%`,
                      left: `${(-crop.x / crop.w) * 100}%`,
                      top: `${(-crop.y / crop.h) * 100}%`,
                    }}
                  />
                </div>
                {(["nw", "ne", "sw", "se"] as const).map((handle) => (
                  <button
                    key={handle}
                    type="button"
                    aria-label={`Resize ${handle}`}
                    onPointerDown={(e) => startDrag(handle, e)}
                    className="absolute h-7 w-7 touch-none rounded-full border-2 border-accent bg-white shadow"
                    style={{
                      left: `calc(${(handle === "nw" || handle === "sw" ? crop.x : crop.x + crop.w) * 100}% - 14px)`,
                      top: `calc(${(handle === "nw" || handle === "ne" ? crop.y : crop.y + crop.h) * 100}% - 14px)`,
                    }}
                  />
                ))}
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setCrop(autoCrop ?? FULL)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-paper"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {autoCrop ? "Auto-detect page" : "No page detected"}
                </button>
                <button
                  type="button"
                  onClick={() => setCrop(FULL)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-paper"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Whole image
                </button>
              </div>

              <div className="mt-5 space-y-4">
                <Slider
                  label="Brightness"
                  value={brightness}
                  onChange={setBrightness}
                  min={0.5}
                  max={2}
                />
                <Slider
                  label="Contrast"
                  value={contrast}
                  onChange={setContrast}
                  min={0.5}
                  max={2}
                />
                <label className="flex items-center gap-2 text-sm font-medium text-ink-soft">
                  <input
                    type="checkbox"
                    checked={grayscale}
                    onChange={(e) => setGrayscale(e.target.checked)}
                    className="h-4 w-4 rounded border-line accent-accent"
                  />
                  Black &amp; white (smaller file, crisper on a mono printer)
                </label>
              </div>
            </>
          )}

          {error && (
            <p className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {error}
            </p>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
          {enhanced && (
            <button
              type="button"
              onClick={revert}
              disabled={saving}
              className="mr-auto inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-2 text-xs font-semibold text-ink-soft hover:bg-paper disabled:opacity-50"
              title="Restore the customer's original upload"
            >
              <Undo2 className="h-3.5 w-3.5" />
              Undo edits
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-full border border-line px-4 py-2 text-xs font-semibold text-ink-soft hover:bg-paper disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={saving || loading}
            className="btn-primary inline-flex items-center gap-1.5 rounded-full px-5 py-2 text-xs font-semibold disabled:opacity-60"
          >
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Applying…
              </>
            ) : (
              "Apply for print"
            )}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between text-sm font-semibold text-ink-soft">
        {label}
        <span className="font-normal text-muted">{value.toFixed(2)}×</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent"
      />
    </label>
  );
}
