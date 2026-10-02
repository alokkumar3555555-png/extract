import type { ExtractionResult, IdType } from "@/types/extraction";

export function normalizeOcrText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/[^\S\n]+/g, " ").split("\n")
    .map((line) => line.trim()).filter(Boolean).join("\n");
}
export function linesOf(text: string): string[] { return normalizeOcrText(text).split("\n").filter(Boolean); }
export function emptyResult(idType: IdType): ExtractionResult {
  return { idType, name: null, documentNumber: null, address: null, phoneNumber: null };
}
export function uniqueCandidate(values: string[]): string | null {
  const unique = [...new Set(values.map((value) => value.trim()))];
  return unique.length === 1 ? unique[0] : null;
}
export function isName(value: string): boolean {
  return value.length >= 3 && value.length <= 200 && /^[A-Za-z][A-Za-z .'-]*$/.test(value)
    && !/\b(?:government|india|income|department|permanent|account|aadhaar|uidai|licen[cs]e|transport|authority|father|mother|gender|male|female|birth|address|signature|republic|valid|issued|holder|enrol|identification|name)\b/i.test(value);
}
export function labeledValue(lines: string[], label: RegExp): string | null {
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(label);
    if (match) {
      const inline = lines[index].slice(match[0].length).trim();
      return inline || lines[index + 1] || null;
    }
  }
  return null;
}
export function extractName(lines: string[], contextual = false): string | null {
  const labeled = labeledValue(lines, /^(?:name of (?:the )?holder|holder'?s? name|name)\s*[:.-]?\s*/i);
  if (labeled && isName(labeled)) return labeled;
  if (contextual) {
    const index = lines.findIndex((line) => /^(?:dob|date of birth|year of birth|father'?s? name)\b/i.test(line));
    // Only the immediately preceding line; never search past a parent-name field.
    if (index > 0 && isName(lines[index - 1]) && !/father|mother|[SDCW]\s*\/\s*O/i.test(lines[index - 2] ?? "")) return lines[index - 1];
  }
  return null;
}
export function extractAddress(lines: string[], allowCareOf = false): string | null {
  let index = lines.findIndex((line) => /^(?:(?:permanent|present|residential)\s+)?address\b/i.test(line));
  if (index < 0 && allowCareOf) index = lines.findIndex((line) => /^[SDCW]\s*\/\s*O\s*[:.-]/i.test(line));
  if (index < 0) return null;
  const values: string[] = [];
  for (let cursor = index; cursor < Math.min(lines.length, index + 8); cursor++) {
    let line = lines[cursor];
    if (cursor > index && /^(?:name|dob|date of birth|gender|male|female|phone|mobile|tel|contact|dl|licen[cs]e|pan|aadhaar|uidai|vid|issue|valid|signature|blood|class|cov)\b|^\d{4}\s?\d{4}\s?\d{4}$|^www\.|^help/i.test(line)) break;
    if (cursor === index) line = line.replace(/^(?:(?:permanent|present|residential)\s+)?address\s*[:.-]?\s*/i, "");
    if (line) values.push(line);
    if (/\b\d{6}\b/.test(line)) break;
  }
  const address = values.join(" ").trim();
  return address.length >= 5 && address.length <= 2000 && /[A-Za-z]/.test(address) ? address : null;
}
export function extractPhone(lines: string[]): string | null {
  const candidates: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/helpline|toll.free|office|authority|customer|support/i.test(line)) continue;
    const match = line.match(/^(?:mobile(?: no\.?| number)?|phone(?: no\.?| number)?|contact(?: no\.?| number)?|tel(?:ephone)?)\s*[:.-]?\s*(.*)$/i);
    if (!match) continue;
    const value = (match[1] || lines[index + 1] || "").trim().replace(/\s+/g, " ");
    const digits = value.replace(/\D/g, "");
    if (/^\+?[\d ()-]+$/.test(value) && digits.length >= 10 && digits.length <= 15) candidates.push(value);
  }
  return uniqueCandidate(candidates);
}
