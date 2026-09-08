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
  // sharp's native addon dlopens libvips from a sibling @img/sharp-libvips-*
  // package. That happens inside compiled code, not via require(), so file
  // tracing never sees it and the image routes die on Vercel with
  // ERR_DLOPEN_FAILED: libvips-cpp.so. Upstream fixes are open but unreleased
  // (vercel/nft#595, vercel/next.js#97978); until then the binaries have to be
  // pulled in by hand.
  outputFileTracingIncludes: {
    "/**": ["node_modules/@img/**/*.so*", "node_modules/@img/**/*.node"],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "30mb",
    },
  },
};

export default nextConfig;
