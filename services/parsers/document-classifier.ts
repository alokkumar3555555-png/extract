import type { IdType } from "@/types/extraction";

export function classifyDocument(text: string): IdType {
  const value = text.toUpperCase();
  const scores: Record<Exclude<IdType, "unknown">, number> = {
    aadhaar: (/\bAADHAAR\b|\bUIDAI\b/.test(value) ? 5 : 0)
      + (/GOVERNMENT OF INDIA/.test(value) ? 1 : 0)
      + (/\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/.test(value) ? 2 : 0)
      + (/\bDOB\b|YEAR OF BIRTH/.test(value) ? 1 : 0)
      + (/\b(?:MALE|FEMALE|GENDER)\b/.test(value) ? 1 : 0),
    pan: (/INCOME TAX DEPARTMENT|PERMANENT ACCOUNT NUMBER/.test(value) ? 5 : 0)
      + (/\b[A-Z]{5}\s?\d{4}\s?[A-Z]\b/.test(value) ? 3 : 0)
      + (/FATHER'?S? NAME/.test(value) ? 1 : 0),
    driving_licence: (/DRIVING LICEN[CS]E/.test(value) ? 5 : 0)
      + (/\bDL\s*(?:NO|NUMBER)|LICEN[CS]E\s*(?:NO|NUMBER)/.test(value) ? 3 : 0)
      + (/TRANSPORT|\bRTO\b|MOTOR VEHICLES/.test(value) ? 2 : 0),
  };
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (ranked[0][1] < 5 || ranked[0][1] - ranked[1][1] < 2) return "unknown";
  return ranked[0][0] as IdType;
}
