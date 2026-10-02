import type { ApiResponse } from "@/types/extraction";
import { ValidationError } from "@/lib/validation";

export function successResponse<T>(data: T, status = 200) {
  return Response.json({ success: true, data } satisfies ApiResponse<T>, {
    status, headers: { "Cache-Control": "no-store" },
  });
}

export function errorResponse(message: string, status: number) {
  return Response.json({ success: false, error: message } satisfies ApiResponse<never>, {
    status, headers: { "Cache-Control": "no-store" },
  });
}

export function handleApiError(error: unknown, fallback: string) {
  if (error instanceof ValidationError) return errorResponse(error.message, error.status);
  // Do not log arbitrary SDK errors: they can include submitted sensitive values.
  return errorResponse(fallback, 500);
}
