import "server-only";
import { validateExtractionPayload } from "@/lib/validation";
import { ExtractionError } from "@/services/extraction.error";
import { preprocessImage } from "@/services/ocr/image-preprocessor";
import { recognizeImage } from "@/services/ocr/ocr.service";
import { classifyDocument } from "@/services/parsers/document-classifier";
import { parseAadhaar } from "@/services/parsers/aadhaar.parser";
import { parsePan } from "@/services/parsers/pan.parser";
import { parseDrivingLicence } from "@/services/parsers/driving-licence.parser";
import { normalizeOcrText } from "@/services/parsers/parser-utils";
import type { ExtractionResult } from "@/types/extraction";

export type ExtractionMetadata = { mimeType: string };

export function extractFromText(text: string): ExtractionResult {
  if (typeof text !== "string" || !text.trim() || text.length > 32_000) throw new ExtractionError("unreadable");
  const normalized = normalizeOcrText(text);
  const idType = classifyDocument(normalized);
  if (idType === "unknown") throw new ExtractionError("unreadable");
  const result = idType === "aadhaar" ? parseAadhaar(normalized) : idType === "pan" ? parsePan(normalized) : parseDrivingLicence(normalized);
  if (!result.name && !result.documentNumber) throw new ExtractionError("unreadable");
  try { return validateExtractionPayload(result); }
  catch { throw new ExtractionError("unreadable"); }
}

export async function extractGovernmentId(file: Buffer, metadata: ExtractionMetadata): Promise<ExtractionResult> {
  if (!file.length || !["image/jpeg", "image/png", "image/webp"].includes(metadata.mimeType)) throw new ExtractionError("unreadable");
  let processed: Buffer | undefined;
  try {
    processed = await preprocessImage(file);
    const ocr = await recognizeImage(processed);
    return extractFromText(ocr.text);
  } catch (error) {
    if (error instanceof ExtractionError) throw error;
    throw new ExtractionError("internal");
  } finally {
    processed?.fill(0);
  }
}
