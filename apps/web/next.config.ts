import type { NextConfig } from "next";

const apiBase = process.env.API_BASE_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  // The shared package ships TypeScript source.
  transpilePackages: ["@stride/shared"],
  // Same-origin /api calls from the browser are proxied to the Express server (no CORS).
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiBase}/api/:path*` }];
  },
};

export default nextConfig;
