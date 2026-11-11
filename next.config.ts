import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingIncludes: {
    "/api/vss-warden/verify": ["./runtime/run-wasi.mjs", "./runtime/vss-warden.wasm"],
  },
};

export default nextConfig;
