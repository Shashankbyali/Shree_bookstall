import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shree BookStall — Print Desk",
  description:
    "Scan, upload, and print. Send printouts to Shree BookStall without WhatsApp hassle.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col antialiased grain">
        {children}
      </body>
    </html>
  );
}
