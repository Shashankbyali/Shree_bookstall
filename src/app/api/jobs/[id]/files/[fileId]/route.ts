import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import { isOwnerAuthenticated } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveUploadPath } from "@/lib/uploads";

type Params = { params: Promise<{ id: string; fileId: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  if (!(await isOwnerAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, fileId } = await params;
  const file = await prisma.printFile.findFirst({
    where: { id: fileId, jobId: id },
  });

  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const buffer = await fs.readFile(resolveUploadPath(file.storedName));
  const download = req.nextUrl.searchParams.get("download") === "1";
  const disposition = download ? "attachment" : "inline";

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Disposition": `${disposition}; filename="${encodeURIComponent(file.originalName)}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
