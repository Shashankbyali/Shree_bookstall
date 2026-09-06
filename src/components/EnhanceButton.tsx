"use client";

import { useState } from "react";
import { Download, Loader2, Wand2 } from "lucide-react";

type Props = {
  jobId: string;
  fileId: string;
  fileName: string;
  enhanced: boolean;
  fileSize: number;
  onDone: () => void;
};

export function EnhanceButton({
  jobId,
  fileId,
  fileName,
  enhanced,
  fileSize,
  onDone,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cacheBust, setCacheBust] = useState(fileSize);

  const printName = fileName.replace(/\.[^.]+$/, "") + "-print.jpg";
  const downloadUrl = `/api/jobs/${jobId}/files/${fileId}?download=1&v=${cacheBust}`;

  async function runEnhance() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/jobs/${jobId}/files/${fileId}/enhance`,
        { method: "POST" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Enhance failed");

      const newSize = data.file?.size ?? Date.now();
      setCacheBust(newSize);
      onDone();

      const link = document.createElement("a");
      link.href = `/api/jobs/${jobId}/files/${fileId}?download=1&v=${newSize}`;
      link.download = printName;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enhance failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="inline-flex flex-col gap-1">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={runEnhance}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-accent-dark disabled:opacity-60"
          title="Server-side auto crop and brighten"
        >
          {loading ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Editing…
            </>
          ) : (
            <>
              <Wand2 className="h-3.5 w-3.5" />
              Edit (auto crop + brighten)
            </>
          )}
        </button>
        {enhanced && (
          <a
            href={downloadUrl}
            download={printName}
            className="inline-flex items-center gap-1.5 rounded-full bg-warm px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90"
          >
            <Download className="h-3.5 w-3.5" />
            Download for print
          </a>
        )}
      </div>
      {error && <span className="text-[11px] text-rose-700">{error}</span>}
    </div>
  );
}
