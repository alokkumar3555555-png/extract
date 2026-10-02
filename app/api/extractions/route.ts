import { errorResponse, handleApiError, successResponse } from "@/lib/api-response";
import { readLimitedBody, validateExtractionPayload } from "@/lib/validation";
import { listExtractions, saveExtraction } from "@/services/extraction.repository";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return errorResponse("Expected application/json", 415);
    }
    const body = await readLimitedBody(request, 16 * 1024);
    let payload: unknown;
    try { payload = JSON.parse(new TextDecoder().decode(body)); }
    catch { return errorResponse("Invalid JSON body", 400); }
    const data = validateExtractionPayload(payload);
    return successResponse(await saveExtraction(data), 201);
  } catch (error) {
    return handleApiError(error, "Unable to save extraction");
  }
}

export async function GET() {
  try { return successResponse(await listExtractions()); }
  catch { return errorResponse("Unable to list extractions", 500); }
}
