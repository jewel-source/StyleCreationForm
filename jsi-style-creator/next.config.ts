import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs-dist ships worker/loader code that relies on relative dynamic
  // import() at its own on-disk location — bundling it breaks that
  // resolution, so it needs to run straight from node_modules.
  // @napi-rs/canvas is a native addon (.node binary) that pdfjs-dist
  // require()s at runtime to polyfill DOMMatrix/Path2D in Node — it must
  // also run unbundled so the binary ships with the serverless output.
  serverExternalPackages: ['pdfjs-dist', '@napi-rs/canvas'],
};

export default nextConfig;
