import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/owner/login", destination: "/login", permanent: false },
      {
        source: "/owner/dashboard",
        destination: "/dashboard",
        permanent: false,
      },
    ];
  },
  turbopack: {
    root: path.join(__dirname),
  },
  // sharp loads libvips as a native .so at runtime. File tracing follows the
  // JS require graph, so it ships @img/sharp-linux-x64 but misses the
  // libvips-cpp.so inside its transitive @img/sharp-libvips-* dependency, and
  // the image routes die with ERR_DLOPEN_FAILED on Vercel. Only the two routes
  // that touch sharp need the extra weight.
  outputFileTracingIncludes: {
    "/api/jobs/[id]/files/[fileId]": ["node_modules/@img/**/*"],
    "/api/jobs/[id]/files/[fileId]/enhance": ["node_modules/@img/**/*"],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "30mb",
    },
  },
};

export default nextConfig;
