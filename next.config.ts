import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["tesseract.js", "tesseract.js-core", "@tesseract.js-data/eng", "sharp"],
  outputFileTracingIncludes: {
    "/api/extract": [
      "./node_modules/tesseract.js/src/**/*",
      "./node_modules/tesseract.js-core/**/*",
      "./node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz",
    ],
  },
};

export default nextConfig;
