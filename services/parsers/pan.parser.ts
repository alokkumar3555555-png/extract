import { emptyResult, extractAddress, extractPhone, isName, linesOf, uniqueCandidate } from "@/services/parsers/parser-utils";

// Fuzzy matching is deliberately limited to known labels, never to name values.
const NAME_WORD = "(?:name|nane|narne)";
const HOLDER_LABEL = new RegExp(
  "(?:^|[/|])\\s*((?:applicant\\s+" + NAME_WORD
  + "|(?:card\\s+)?holder['’]?s?\\s+" + NAME_WORD
  + "|" + NAME_WORD + "(?:\\s+of\\s+(?:the\\s+)?(?:card\\s*)?holder)?))\\b\\s*[:.\\-]?\\s*", "i",
);
const INLINE_HOLDER_LABEL = new RegExp(
  "\\b(?:applicant\\s+" + NAME_WORD + "|" + NAME_WORD
  + "(?:\\s+of\\s+(?:the\\s+)?(?:card\\s*)?holder)?)\\s*:\\s*", "i",
);
const PARENT_LABEL = /\b(?:father|fatner|fathcr|mother)(?:['’]s|s)?\s*(?:name|nane|narne)\b/i;
const BIRTH_LABEL = /^(?:dob|date\s+of\s+birth|birth\s+date)\b/i;
const OTHER_FIELD = /\b(?:income\s+tax|govt|government|india|permanent\s+account|pan|date\s+of\s+birth|dob|gender|signature|address|male|female)\b/i;

function holderLabel(line: string): RegExpMatchArray | null {
  const parent = line.search(PARENT_LABEL);
  // A holder and father field can share an OCR line. Only inspect the portion
  // before the father label so that its "Name" cannot become a holder label.
  const holderSection = parent >= 0 ? line.slice(0, parent) : line;
  return holderSection.match(HOLDER_LABEL) ?? holderSection.match(INLINE_HOLDER_LABEL);
}

function nameCandidate(value: string): string | null {
  const cleaned = value.trim();
  return cleaned.length <= 120 && isName(cleaned) && !OTHER_FIELD.test(cleaned)
    && !PARENT_LABEL.test(cleaned) && !holderLabel(cleaned)
    && cleaned.split(/\s+/).length <= 12 ? cleaned : null;
}

function extractPanName(lines: string[]): string | null {
  const labeled: string[] = [];
  let hasHolderLabel = false;
  for (let index = 0; index < lines.length; index++) {
    const match = holderLabel(lines[index]);
    if (!match) continue;
    hasHolderLabel = true;
    const valueStart = (match.index ?? 0) + match[0].length;
    const rest = lines[index].slice(valueStart);
    const parent = rest.search(PARENT_LABEL);
    const inline = nameCandidate(parent >= 0 ? rest.slice(0, parent) : rest);
    if (inline) { labeled.push(inline); continue; }
    // An inline parent field or another field ends this holder section.
    if (PARENT_LABEL.test(rest) || OTHER_FIELD.test(rest)) continue;
    for (let cursor = index + 1; cursor < Math.min(lines.length, index + 4); cursor++) {
      const line = lines[cursor];
      if (PARENT_LABEL.test(line) || OTHER_FIELD.test(line) || holderLabel(line) || /\d/.test(line)) break;
      const candidate = nameCandidate(line);
      if (candidate) { labeled.push(candidate); break; }
      // Skip a bilingual label or nonalphabetic OCR separator, but do not jump
      // over arbitrary English prose and pick a distant unrelated name.
      if (/[A-Za-z]{3}/.test(line)) break;
    }
  }
  if (hasHolderLabel) return uniqueCandidate(labeled);

  // Classic layout: holder immediately above an explicitly labeled father field.
  const contextual: string[] = [];
  for (let index = 1; index < lines.length; index++) {
    if (!PARENT_LABEL.test(lines[index])) continue;
    const previous = lines[index - 1];
    if (index >= 2 && PARENT_LABEL.test(lines[index - 2])) continue;
    const candidate = nameCandidate(previous);
    if (candidate) contextual.push(candidate);
  }
  if (contextual.length) return uniqueCandidate(contextual);

  // Older unlabeled cards commonly place holder, father, then DOB. One name
  // before DOB is ambiguous (it may be the father), so require exactly two.
  if (lines.some((line) => PARENT_LABEL.test(line))) return null;
  for (let index = 2; index < lines.length; index++) {
    if (!BIRTH_LABEL.test(lines[index])) continue;
    const holder = nameCandidate(lines[index - 2]);
    const father = nameCandidate(lines[index - 1]);
    const extraName = index >= 3 ? nameCandidate(lines[index - 3]) : null;
    if (holder && father && !extraName) contextual.push(holder);
  }
  return uniqueCandidate(contextual);
}

export function parsePan(text: string) {
  const lines = linesOf(text);
  const numbers = [...text.matchAll(/(?<![A-Za-z0-9])([A-Za-z]{5})[ ]?(\d{4})[ ]?([A-Za-z])(?![A-Za-z0-9])/g)]
    .map((match) => match[1].toUpperCase() + match[2] + match[3].toUpperCase());
  return { ...emptyResult("pan"), name: extractPanName(lines), documentNumber: uniqueCandidate(numbers), address: extractAddress(lines), phoneNumber: extractPhone(lines) };
}
