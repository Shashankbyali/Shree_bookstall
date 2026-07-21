"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Printer, QrCode, ScanLine, Upload } from "lucide-react";

export default function HomePage() {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const configuredBase = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
  const submitUrl = configuredBase ? `${configuredBase}/submit` : "";

  useEffect(() => {
    const resolved = configuredBase
      ? `${configuredBase}/submit`
      : `${window.location.origin}/submit`;

    import("qrcode").then((QRCode) => {
      QRCode.toDataURL(resolved, {
        width: 280,
        margin: 2,
        color: { dark: "#0c2d3a", light: "#ffffff" },
      }).then(setQrDataUrl);
    });
  }, [configuredBase]);

  return (
    <main className="flex-1">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <p className="font-display text-xl font-semibold tracking-tight text-ink">
          Shree BookStall
        </p>
        <Link
          href="/login"
          className="rounded-full border border-line bg-white/70 px-4 py-2 text-sm font-medium text-ink-soft transition hover:border-accent hover:text-accent"
        >
          Owner login
        </Link>
      </header>

      <section className="relative mx-auto grid max-w-6xl gap-10 px-5 pb-16 pt-6 md:grid-cols-[1.15fr_0.85fr] md:items-center md:pt-10">
        <div className="animate-fade-up">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-accent">
            Print desk
          </p>
          <h1 className="font-display text-4xl font-semibold leading-[1.1] text-ink sm:text-5xl md:text-6xl">
            Shree BookStall
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
            Skip messy WhatsApp forwards. Customers scan the QR, add their name
            and phone, upload any file — and it lands on the owner print desk
            ready to crop, brighten, and print.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/submit"
              className="btn-primary inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold"
            >
              <Upload className="h-4 w-4" />
              Send for print
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-full border border-line bg-white/80 px-6 py-3 text-sm font-semibold text-ink-soft transition hover:border-ink/30"
            >
              <Printer className="h-4 w-4" />
              Open dashboard
            </Link>
          </div>
        </div>

        <div className="paper-card animate-fade-up-delay rounded-3xl p-6 sm:p-8">
          <div className="mb-4 flex items-center gap-2 text-ink-soft">
            <QrCode className="h-5 w-5 text-accent" />
            <h2 className="font-display text-xl font-semibold">Customer QR</h2>
          </div>
          <p className="mb-5 text-sm text-muted">
            Print this QR and keep it at the counter. Customers scan → submit →
            you see it instantly.
          </p>
          <div className="flex justify-center rounded-2xl bg-white p-4 ring-1 ring-line">
            {qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrDataUrl}
                alt="QR code to submit print job"
                className="h-56 w-56"
              />
            ) : (
              <div className="flex h-56 w-56 items-center justify-center text-sm text-muted">
                Generating QR…
              </div>
            )}
          </div>
          {submitUrl && (
            <p className="mt-3 break-all text-center text-xs text-muted">
              {submitUrl}
            </p>
          )}
          {qrDataUrl && (
            <a
              href={qrDataUrl}
              download="shree-bookstall-print-qr.png"
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full border border-line px-4 py-2.5 text-sm font-semibold text-ink-soft transition hover:bg-paper"
            >
              Download QR
            </a>
          )}
        </div>
      </section>

      <section className="border-t border-line/70 bg-white/40">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-14 sm:grid-cols-3">
          {[
            {
              icon: ScanLine,
              title: "Scan & identify",
              text: "Customer scans QR, enters name and phone — no WhatsApp chat needed.",
            },
            {
              icon: Upload,
              title: "Any format",
              text: "PDF, photos, Word, PPT, and more — upload as-is from the phone.",
            },
            {
              icon: Printer,
              title: "Desk-ready edit",
              text: "One-tap auto crop & brighten for messy phone photos, like a doc scanner.",
            },
          ].map((item) => (
            <div key={item.title} className="animate-fade-up">
              <item.icon className="mb-3 h-6 w-6 text-accent" />
              <h3 className="font-display text-lg font-semibold text-ink">
                {item.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{item.text}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
