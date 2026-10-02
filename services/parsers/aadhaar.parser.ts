import { emptyResult, extractAddress, isName, extractPhone, linesOf, uniqueCandidate } from "@/services/parsers/parser-utils";

const HOLDER_LABEL = /(?:^|[/|])\s*(?:(?:name|nane|narne)(?:\s+of\s+(?:the\s+)?(?:card\s*)?holder)?|(?:card\s+)?holder['’]?s?\s+(?:name|nane|narne))\b\s*[:.-]?\s*/i;
const RELATION = /\b(?:father|mother|husband|guardian)(?:['’]s|s)?\s*(?:name|nane|narne)?\b|\b[SDCW]\s*\/\s*O\b/i;
const FIELD = /\b(?:dob|date\s+of\s+birth|year\s+of\s+birth|yob|gender|male|female|address|aadhaar|uidai|government|govt|india|signature|enrolment|enrollment|vid|mobile|phone)\b/i;
const BIRTH = /\b(?:dob|date\s+of\s+birth|year\s+of\s+birth|yob)\b/i;
const GENDER = /^(?:gender\s*[:.-]?\s*)?(?:male|female|transgender)\b|^gender\b/i;

function aadhaarNameCandidate(value: string): string | null {
  const name = value.trim();
  return name.length <= 120 && isName(name) && !FIELD.test(name) && !RELATION.test(name)
    && !HOLDER_LABEL.test(name) && name.split(/\s+/).length <= 12 ? name : null;
}

function extractAadhaarName(lines: string[]): string | null {
  const explicit: string[] = [];
  let labeled = false;
  for (let index = 0; index < lines.length; index++) {
    const relation = lines[index].search(RELATION);
    const section = relation >= 0 ? lines[index].slice(0, relation) : lines[index];
    const match = section.match(HOLDER_LABEL);
    if (!match) continue;
    labeled = true;
    const rest = section.slice((match.index ?? 0) + match[0].length);
    const inline = aadhaarNameCandidate(rest);
    if (inline) { explicit.push(inline); continue; }
    if (relation >= 0 || FIELD.test(rest)) continue;
    for (let cursor = index + 1; cursor < Math.min(index + 4, lines.length); cursor++) {
      const line = lines[cursor];
      if (FIELD.test(line) || RELATION.test(line) || HOLDER_LABEL.test(line) || /\d/.test(line)) break;
      const candidate = aadhaarNameCandidate(line);
      if (candidate) { explicit.push(candidate); break; }
      if (/[A-Za-z]{3}/.test(line)) break;
    }
  }
  if (labeled) return uniqueCandidate(explicit);
  const contextual: string[] = [];
  const hasBirth = lines.some((line) => BIRTH.test(line));
  for (let index = 1; index < lines.length; index++) {
    if (!(hasBirth ? BIRTH.test(lines[index]) : GENDER.test(lines[index]))) continue;
    for (let cursor = index - 1; cursor >= Math.max(0, index - 3); cursor--) {
      const line = lines[cursor];
      if (FIELD.test(line) || RELATION.test(line) || /\d/.test(line)) break;
      const candidate = aadhaarNameCandidate(line);
      if (candidate) {
        // Never select a parent/care-of value, or an address line near demographics.
        if (!lines.slice(Math.max(0, cursor - 2), cursor).some((previous) => RELATION.test(previous) || /\baddress\b/i.test(previous))) contextual.push(candidate);
        break;
      }
      if (/[A-Za-z]{3}/.test(line)) break;
    }
  }
  return uniqueCandidate(contextual);
}

export function parseAadhaar(text: string) {
  const lines = linesOf(text);
  const candidates = lines.filter((line) => !/\bVID\b|virtual|enrol|phone|mobile|contact|helpline/i.test(line))
    .flatMap((line) => [...line.matchAll(/(?<![\dA-Za-z])(?:\d(?:[ -]?\d){11,}|[Xx*]{4}[ -]?[Xx*]{4}[ -]?\d{4})(?![\dA-Za-z])/g)])
    .map((match) => match[0].replace(/[ -]/g, ""))
    .filter((number) => number.length === 12)
    .map((number) => number.replace(/(.{4})(.{4})(.{4})/, "$1 $2 $3"));
  return { ...emptyResult("aadhaar"), name: extractAadhaarName(lines), documentNumber: uniqueCandidate(candidates), address: extractAddress(lines, true), phoneNumber: extractPhone(lines) };
}
