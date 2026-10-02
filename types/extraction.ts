export type IdType = "aadhaar" | "pan" | "driving_licence" | "unknown";

export type ExtractionResult = {
  idType: IdType;
  name: string | null;
  documentNumber: string | null;
  address: string | null;
  phoneNumber: string | null;
};

export type StoredExtraction = ExtractionResult & {
  id: string;
  userId?: string | null;
  createdAt: string;
};

export type ApiResponse<T> = { success: true; data: T } | { success: false; error: string };
