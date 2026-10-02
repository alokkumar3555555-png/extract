import { errorResponse, successResponse } from "@/lib/api-response";
import { ValidationError, validateExtractionId } from "@/lib/validation";
import { deleteExtraction, getExtraction } from "@/services/extraction.repository";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const id = validateExtractionId((await context.params).id);
    const extraction = await getExtraction(id);
    return extraction ? successResponse(extraction) : errorResponse("Extraction not found", 404);
  } catch (error) {
    if (error instanceof ValidationError) return errorResponse(error.message, error.status);
    return errorResponse("Unable to retrieve extraction", 500);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const id = validateExtractionId((await context.params).id);
    return await deleteExtraction(id)
      ? successResponse({ id, deleted: true })
      : errorResponse("Extraction not found", 404);
  } catch (error) {
    if (error instanceof ValidationError) return errorResponse(error.message, error.status);
    return errorResponse("Unable to delete extraction", 500);
  }
}
