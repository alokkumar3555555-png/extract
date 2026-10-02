import type { ExtractionResult, IdType } from "@/types/extraction";

export const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ID_TYPES = new Set<IdType>(["aadhaar", "pan", "driving_licence", "unknown"]);
const TEXT_LIMITS = { name: 200, documentNumber: 100, address: 2000, phoneNumber: 50 };

export class ValidationError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

export function validateUploadedFile(value: FormDataEntryValue | null): File {
  if (!(value instanceof File)) throw new ValidationError("A file is required");
  if (!MIME_TYPES.has(value.type)) throw new ValidationError("Unsupported file type", 415);
  if (value.size === 0) throw new ValidationError("File must not be empty");
  if (value.size > MAX_FILE_SIZE) throw new ValidationError("File exceeds the 10 MB limit", 413);
  return value;
}

export function validateExtractionPayload(value: unknown): ExtractionResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("Expected an extraction object");
  }
  const input = value as Record<string, unknown>;
  const allowed = new Set(["idType", ...Object.keys(TEXT_LIMITS)]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new ValidationError("Unexpected fields in extraction data");
  }
  if (typeof input.idType !== "string" || !ID_TYPES.has(input.idType as IdType)) {
    throw new ValidationError("Invalid idType");
  }
  for (const [key, limit] of Object.entries(TEXT_LIMITS)) {
    const field = input[key];
    if (field !== null && typeof field !== "string") {
      throw new ValidationError(key + " must be a string or null");
    }
    if (typeof field === "string" && field.length > limit) {
      throw new ValidationError(key + " exceeds the maximum length");
    }
  }
  return {
    idType: input.idType as IdType,
    name: input.name as string | null,
    documentNumber: input.documentNumber as string | null,
    address: input.address as string | null,
    phoneNumber: input.phoneNumber as string | null,
  };
}

export function validateExtractionId(id: string): string {
  if (!id || id === "." || id === ".." || id.includes("/") || Buffer.byteLength(id) > 1500) {
    throw new ValidationError("Invalid extraction ID");
  }
  return id;
}

// Bound the stream before multipart/JSON parsing, including requests without Content-Length.
export async function readLimitedBody(request: Request, limit: number): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > limit) throw new ValidationError("Request body is too large", 413);
  if (!request.body) throw new ValidationError("Request body is required");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new ValidationError("Request body is too large", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}
