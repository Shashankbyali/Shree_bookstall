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
  experimental: {
    serverActions: {
      bodySizeLimit: "30mb",
    },
  },
};

export default nextConfig;
