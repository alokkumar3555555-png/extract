export type ExtractionErrorCode = "unreadable" | "unavailable" | "internal";

// Never attach library errors, OCR text, image data, or personal values.
export class ExtractionError extends Error {
  readonly status: number;
  constructor(readonly code: ExtractionErrorCode) {
    super({ unreadable: "Unable to extract document information", unavailable: "OCR worker temporarily unavailable", internal: "Unable to process document" }[code]);
    this.name = "ExtractionError";
    this.status = { unreadable: 422, unavailable: 503, internal: 500 }[code];
  }
}
