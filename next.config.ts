import path from "path";
import type { NextConfig } from "next";

const root = path.join(__dirname);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  outputFileTracingRoot: root,
  turbopack: {
    root,
  },
};

export default nextConfig;

// Only wire up the Wrangler dev proxy for `next dev`, not production builds.
if (process.env.NODE_ENV !== "production") {
  import("@opennextjs/cloudflare").then((m) => m.initOpenNextCloudflareForDev());
}
