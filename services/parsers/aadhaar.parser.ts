import { emptyResult, extractAddress, extractName, extractPhone, linesOf, uniqueCandidate } from "@/services/parsers/parser-utils";

export function parseAadhaar(text: string) {
  const lines = linesOf(text);
  const candidates = lines.filter((line) => !/\bVID\b|virtual|enrol|phone|mobile|contact|helpline/i.test(line))
    .flatMap((line) => [...line.matchAll(/(?<![\dA-Za-z])(?:\d(?:[ -]?\d){11,}|[Xx*]{4}[ -]?[Xx*]{4}[ -]?\d{4})(?![\dA-Za-z])/g)])
    .map((match) => match[0].replace(/[ -]/g, ""))
    .filter((number) => number.length === 12)
    .map((number) => number.replace(/(.{4})(.{4})(.{4})/, "$1 $2 $3"));
  return { ...emptyResult("aadhaar"), name: extractName(lines, true), documentNumber: uniqueCandidate(candidates), address: extractAddress(lines, true), phoneNumber: extractPhone(lines) };
}
