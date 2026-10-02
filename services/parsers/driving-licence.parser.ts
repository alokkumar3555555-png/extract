import { emptyResult, extractAddress, extractName, extractPhone, labeledValue, linesOf, uniqueCandidate } from "@/services/parsers/parser-utils";

export function parseDrivingLicence(text: string) {
  const lines = linesOf(text);
  const labeled = labeledValue(lines, /^(?:(?:driving\s+)?licen[cs]e|dl)\s*(?:no\.?|number)\s*[:.-]?\s*/i);
  const isNumber = (value: string) => value.length >= 7 && value.length <= 40 && /^[A-Za-z0-9 /-]+$/.test(value) && /\d/.test(value);
  const fallback = [...text.matchAll(/\b[A-Za-z]{2}[- ]?\d{2}[- /]?\d{7,15}\b/g)].map((match) => match[0]);
  const number = labeled && isNumber(labeled) ? labeled : uniqueCandidate(fallback.filter(isNumber));
  return { ...emptyResult("driving_licence"), name: extractName(lines), documentNumber: number, address: extractAddress(lines), phoneNumber: extractPhone(lines) };
}
