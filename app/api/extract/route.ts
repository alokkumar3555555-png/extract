import { errorResponse, handleApiError, successResponse } from "@/lib/api-response";
import { MAX_FILE_SIZE, readLimitedBody, validateUploadedFile } from "@/lib/validation";
import { ExtractionError } from "@/services/extraction.error";
import { extractGovernmentId } from "@/services/extraction.service";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.split(";")[0].trim().toLowerCase() !== "multipart/form-data") {
      return errorResponse("Expected multipart/form-data", 415);
    }
    const body = await readLimitedBody(request, MAX_FILE_SIZE + 64 * 1024);
    let form: FormData;
    try {
      form = await new Response(body.buffer as ArrayBuffer, { headers: { "Content-Type": contentType } }).formData();
    } catch {
      return errorResponse("Invalid multipart form data", 400);
    }
    if (form.getAll("file").length > 1) return errorResponse("Upload exactly one file", 400);
    const file = validateUploadedFile(form.get("file"));
    const buffer = Buffer.from(await file.arrayBuffer());
    try {
      return successResponse(await extractGovernmentId(buffer, { mimeType: file.type }));
    } finally {
      buffer.fill(0);
    }
  } catch (error) {
    if (error instanceof ExtractionError) return errorResponse(error.message, error.status);
    return handleApiError(error, "Unable to extract document information");
  }
}
