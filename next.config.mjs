import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: __dirname,
  },
  // Reduces "preloaded but not used" CSS warning in dev (Next.js injects layout.css preload;
  // with chunking disabled the preload is more likely to match the actual stylesheet).
  experimental: {
    cssChunking: false,
  },
};

export default nextConfig;

