import "server-only";
import sharp from "sharp";
import { ExtractionError } from "@/services/extraction.error";

export async function preprocessImage(image: Buffer): Promise<Buffer> {
  try {
    const options = { limitInputPixels: 20_000_000, failOn: "error" as const };
    const metadata = await sharp(image, options).metadata();
    if (!metadata.width || !metadata.height || !["jpeg", "png", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) > 1) {
      throw new ExtractionError("unreadable");
    }
    const longest = Math.max(metadata.width, metadata.height);
    const target = Math.min(2400, longest < 1600 ? Math.min(longest * 2, 1600) : longest);
    return await sharp(image, options).rotate().flatten({ background: "white" })
      .resize({ width: target, height: target, fit: "inside" })
      .grayscale().normalize({ lower: 0.5, upper: 99.5 }).sharpen({ sigma: 0.5 }).png().toBuffer();
  } catch {
    throw new ExtractionError("unreadable");
  }
}
