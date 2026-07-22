import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs-dist ships worker/loader code that relies on relative dynamic
  // import() at its own on-disk location — bundling it breaks that
  // resolution, so it needs to run straight from node_modules.
  serverExternalPackages: ['pdfjs-dist'],
};

export default nextConfig;
