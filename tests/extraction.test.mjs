import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { File } from "node:buffer";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireLocal = createRequire(import.meta.url);
// All fixture identifiers/phones/PINs use zeros, not real personal information.
const aadhaar = "AADHAAR\nGOVERNMENT OF INDIA\nSynthetic User\nDOB: 01/01/1900\nMale\n0000 0000 0000\nAddress: C/O Demo Parent\nExample Road, Example Town\nDemo State 000000";
const pan = "INCOME TAX DEPARTMENT\nGOVERNMENT OF INDIA\nPERMANENT ACCOUNT NUMBER\nABCDE0000Z\nName: Synthetic User\nFather's Name: Demo Parent\nDOB: 01/01/1900";
const dl = "DRIVING LICENCE\nSTATE TRANSPORT AUTHORITY\nDL No: ZZ-00/00000000000\nName of Holder: Synthetic User\nPermanent Address: Example Road\nExample Town\nDemo State 000000\nMobile: +00 00000 00000";

function harness({ text = pan, failure, real = false, workerStub, quickTimeout = false } = {}) {
  const modules = new Map();
  const calls = [];
  let timeoutCallback;
  const sandbox = {
    Buffer, File, FormData, Request, Response, TextDecoder, Uint8Array, AbortController, process,
    setTimeout: (fn, ms) => {
      if (quickTimeout && ms === 40000) { timeoutCallback = fn; return setTimeout(fn, 60000); }
      return setTimeout(fn, ms);
    }, clearTimeout,
    console: new Proxy({}, { get: () => () => { throw new Error("Unexpected logging"); } }),
  };
  function load(name) {
    if (modules.has(name)) return modules.get(name);
    const filename = path.join(root, name + ".ts");
    const mod = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    vm.runInNewContext(code, { ...sandbox, exports: mod.exports, require: (ref) => {
      if (ref === "server-only") return {};
      if (!real && ref === "@/services/ocr/image-preprocessor") return { preprocessImage: async (buffer) => { calls.push("preprocess"); return Buffer.from(buffer); } };
      if (!real && !workerStub && ref === "@/services/ocr/ocr.service") return { recognizeImage: async () => { calls.push("ocr"); if (failure) throw failure; return { text, confidence: 90 }; } };
      if (workerStub && ref === "tesseract.js") return { createWorker: workerStub, OEM: { LSTM_ONLY: 1 }, PSM: { AUTO: "3" } };
      if (ref.startsWith("@/")) return load(ref.slice(2));
      return requireLocal(ref);
    } }, { filename });
    modules.set(name, mod.exports);
    return mod.exports;
  }
  return { load, calls, fireTimeout: () => timeoutCallback() };
}
function upload(mime = "image/png", size = 3) {
  const form = new FormData();
  if (mime !== null) form.set("file", new File([new Uint8Array(size)], "synthetic.png", { type: mime }));
  return new Request("http://localhost/api/extract", { method: "POST", body: form });
}
async function invoke(options, request = upload()) {
  const h = harness(options);
  const response = await h.load("app/api/extract/route").POST(request);
  return { h, response, json: await response.json() };
}
const plain = (value) => JSON.parse(JSON.stringify(value));

test("upload validation: missing, unsupported, oversized and empty file", async () => {
  for (const [mime, size, status] of [[null, 0, 400], ["text/plain", 3, 415], ["image/png", 10485761, 413], ["image/png", 0, 400]]) {
    const { h, response, json } = await invoke({}, upload(mime, size));
    assert.equal(response.status, status); assert.equal(json.success, false); assert.equal(h.calls.length, 0);
  }
});
test("multipart body without Content-Length has a bounded size", async () => {
  const request = new Request("http://localhost/api/extract", { method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=test" }, body: new Uint8Array(10 * 1024 * 1024 + 65537) });
  assert.equal((await invoke({}, request)).response.status, 413);
});
test("classifier recognizes Aadhaar, PAN and DL deterministically", () => {
  const classify = harness().load("services/parsers/document-classifier").classifyDocument;
  for (const [text, type] of [[aadhaar, "aadhaar"], [pan, "pan"], [dl, "driving_licence"]]) assert.equal(classify(text), type);
});
test("unknown, one weak clue and conflicting evidence are not classified", () => {
  const classify = harness().load("services/parsers/document-classifier").classifyDocument;
  for (const text of ["Ordinary receipt", "0000 0000 0000", "ABCDE0000Z", "GOVERNMENT OF INDIA", "DL NO", "AADHAAR\nINCOME TAX DEPARTMENT"]) assert.equal(classify(text), "unknown");
});
test("Aadhaar extracts contextual holder name, grouped number and multiline address", () => {
  const result = harness().load("services/parsers/aadhaar.parser").parseAadhaar(aadhaar);
  assert.deepEqual(plain(result), { idType: "aadhaar", name: "Synthetic User", documentNumber: "0000 0000 0000", address: "C/O Demo Parent Example Road, Example Town Demo State 000000", phoneNumber: null });
});
test("Aadhaar preserves masking, excludes VID and rejects multiple candidates", () => {
  const parse = harness().load("services/parsers/aadhaar.parser").parseAadhaar;
  assert.equal(parse("AADHAAR\nXXXX XXXX 0000").documentNumber, "XXXX XXXX 0000");
  assert.equal(parse("AADHAAR\nVID: 0000 0000 0000 0000").documentNumber, null);
  assert.equal(parse("AADHAAR\n0000 0000 0000 0000").documentNumber, null);
  assert.equal(parse("AADHAAR\nMobile: +00 00000 00000").documentNumber, null);
  assert.equal(parse("AADHAAR\n0000 0000 0000\n1111 1111 1111").documentNumber, null);
});
test("PAN extracts holder rather than father and never fabricates address/phone", () => {
  const result = harness().load("services/parsers/pan.parser").parsePan(pan);
  assert.deepEqual(plain(result), { idType: "pan", name: "Synthetic User", documentNumber: "ABCDE0000Z", address: null, phoneNumber: null });
});
test("PAN tolerates lowercase/spacing but does not guess ambiguous OCR characters", () => {
  const parse = harness().load("services/parsers/pan.parser").parsePan;
  assert.equal(parse("abcde 0000 z").documentNumber, "ABCDE0000Z");
  assert.equal(parse("ABCDEOOOOZ").documentNumber, null);
  assert.equal(parse("ABCDE0000Z FGHIJ0000K").documentNumber, null);
});
test("unlabeled PAN holder immediately before father label is accepted", () => {
  const parse = harness().load("services/parsers/pan.parser").parsePan;
  assert.equal(parse("INCOME TAX DEPARTMENT\nSynthetic User\nFather's Name\nDemo Parent\nDOB: 01/01/1900").name, "Synthetic User");
  assert.equal(parse("Father's Name\nDemo Parent\nDOB: 01/01/1900").name, null);
});

test("PAN names: newer holder labels on same or following OCR line preserve spelling", () => {
  const parse = harness().load("services/parsers/pan.parser").parsePan;
  for (const label of ["Name", "NAME", "Name of Card Holder", "NAME OF CARD HOLDER", "Applicant Name", "Holder's Name"]) {
    for (const section of [label + ": Synthetic O'User", label + "\n\nSynthetic O'User"]) {
      const result = parse("INCOME TAX DEPARTMENT\nGOVT. OF INDIA\nPermanent Account Number\nABCDE0000Z\n" + section + "\nFather's Name\nDemo Parent\nDate of Birth\n01/01/1900\nGender: Male");
      assert.equal(result.name, "Synthetic O'User"); assert.equal(result.documentNumber, "ABCDE0000Z");
    }
  }
});
test("PAN names: narrowly corrupted labels and bilingual separator are recognized", () => {
  const parse = harness().load("services/parsers/pan.parser").parsePan;
  for (const label of ["Nane", "Narne", "NANE:", "नाम / Narne", "नाम Name:"]) {
    const result = parse("INCOME TAX DEPARTMENT\nGOVT OF INDIA\nABCDE0000Z\n" + label + "\nSynthetic User\nFather's Nane\nDemo Parent\nDate of Birth: 01/01/1900");
    assert.equal(result.name, "Synthetic User");
  }
});
test("PAN names: nearby bilingual OCR separator is skipped within holder section", () => {
  const parse = harness().load("services/parsers/pan.parser").parsePan;
  assert.equal(parse("NAME OF CARD HOLDER\nनाम\nSynthetic User\nFather's Name\nDemo Parent").name, "Synthetic User");
});
test("PAN names: father on same or immediately following line never replaces holder", () => {
  const parse = harness().load("services/parsers/pan.parser").parsePan;
  assert.equal(parse("Name: Synthetic User Father's Name: Demo Parent\nDOB: 01/01/1900").name, "Synthetic User");
  for (const text of ["Name\nFather's Name\nDemo Parent\nDate of Birth: 01/01/1900", "Father's Name: Demo Parent\nDOB: 01/01/1900", "Name: Father's Name: Demo Parent", "Name\nSignature\nDemo Parent\nFather's Name"]) assert.equal(parse(text).name, null);
});
test("PAN names: classic unlabeled holder/father/DOB order selects holder", () => {
  const parse = harness().load("services/parsers/pan.parser").parsePan;
  assert.equal(parse("INCOME TAX DEPARTMENT\nGOVT. OF INDIA\nSynthetic User\nDemo Parent\nDate of Birth: 01/01/1900\nABCDE0000Z").name, "Synthetic User");
  assert.equal(parse("INCOME TAX DEPARTMENT\nDemo Parent\nDate of Birth: 01/01/1900").name, null);
  assert.equal(parse("INCOME TAX DEPARTMENT\nOther Person\nSynthetic User\nDemo Parent\nDate of Birth: 01/01/1900").name, null);
});
test("PAN names: missing name, labels and header false positives remain null", () => {
  const parse = harness().load("services/parsers/pan.parser").parsePan;
  for (const invalid of ["INCOME TAX DEPARTMENT", "GOVERNMENT OF INDIA", "GOVT OF INDIA", "GOVT. OF INDIA", "FATHER'S NAME", "DATE OF BIRTH", "GENDER", "SIGNATURE", "PAN", "Permanent Account Number", "ABCDE0000Z", "12345"]) {
    assert.equal(parse("INCOME TAX DEPARTMENT\nName: " + invalid + "\nFather's Name\nDemo Parent\nABCDE0000Z").name, null);
  }
  assert.equal(parse("INCOME TAX DEPARTMENT\nPermanent Account Number\nABCDE0000Z").name, null);
});
test("PAN names: ambiguous repeated holder fields remain null", () => {
  const parse = harness().load("services/parsers/pan.parser").parsePan;
  assert.equal(parse("Name: Synthetic User\nApplicant Name: Different User").name, null);
  assert.equal(parse("Name: Synthetic User\nNAME: Synthetic User").name, "Synthetic User");
});
test("PAN manual-style OCR fixture reaches API without raw OCR or diagnostics", async () => {
  const text = "INCOME TAX DEPARTMENT\nGOVT. OF INDIA\nPermanent Account Number\nABCDE0000Z\nNAME OF CARD HOLDER\nSynthetic User\nFather's Name\nDemo Parent\nDate of Birth\n01/01/1900\nGender\nMale";
  const { response, json } = await invoke({ text });
  assert.equal(response.status, 200);
  assert.deepEqual(json, { success: true, data: { idType: "pan", name: "Synthetic User", documentNumber: "ABCDE0000Z", address: null, phoneNumber: null } });
});

test("DL accepts state-varying labelled numbers and structured address/phone", () => {
  const parse = harness().load("services/parsers/driving-licence.parser").parseDrivingLicence;
  const result = parse(dl);
  assert.equal(result.documentNumber, "ZZ-00/00000000000"); assert.equal(result.name, "Synthetic User");
  assert.equal(result.address, "Example Road Example Town Demo State 000000"); assert.equal(result.phoneNumber, "+00 00000 00000");
  assert.equal(parse("Licence No\nZZ00 00000000000").documentNumber, "ZZ00 00000000000");
  assert.equal(parse("Licence Number: 000000000000").documentNumber, "000000000000");
  assert.equal(parse("DRIVING LICENCE\nZZ-00-00000000000").documentNumber, "ZZ-00-00000000000");
});
test("phone requires explicit holder label; no country code or helpline inference", () => {
  const utils = harness().load("services/parsers/parser-utils");
  assert.equal(utils.extractPhone(["0000000000", "Helpline: 0000000000"]), null);
  assert.equal(utils.extractPhone(["Mobile: 00000 00000"]), "00000 00000");
  assert.equal(utils.extractPhone(["Phone: 0000000000", "Office phone: 1111111111"]), "0000000000");
});
test("whitespace normalization preserves lines, spelling and punctuation", () => {
  const utils = harness().load("services/parsers/parser-utils");
  assert.equal(utils.normalizeOcrText("  Name:   Synthetic User\r\n\r\nAddress: Example,   Town  "), "Name: Synthetic User\nAddress: Example, Town");
});
test("unknown, malformed, oversized and unusable OCR return 422", async () => {
  for (const text of ["", "garbage !@#$", "ordinary receipt", "AADHAAR", "x".repeat(32001), null]) {
    const { response, json } = await invoke({ text });
    assert.equal(response.status, 422); assert.deepEqual(json, { success: false, error: "Unable to extract document information" });
  }
});
test("valid OCR response keeps the public API unchanged and no raw text/confidence", async () => {
  const { h, response, json } = await invoke({});
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(h.calls, ["preprocess", "ocr"]);
  assert.deepEqual(json, { success: true, data: { idType: "pan", name: "Synthetic User", documentNumber: "ABCDE0000Z", address: null, phoneNumber: null } });
});
test("errors do not expose OCR text, personal fields or internal stacks", async () => {
  const { response, json } = await invoke({ failure: new Error("PRIVATE_RAW_OCR_DETAILS") });
  assert.equal(response.status, 500); assert.deepEqual(json, { success: false, error: "Unable to process document" });
});
test("reusable worker is serial, local-only, clears image and engine per job", async () => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const events = []; let options; let created = 0;
  const worker = { setParameters: async () => {}, recognize: async () => { await pending; return { data: { text: pan, confidence: 90 } }; }, FS: async (method, args) => events.push([method, args]), reinitialize: async () => events.push("reset"), terminate: async () => events.push("terminate") };
  const h = harness({ workerStub: async (_lang, _oem, config) => { created++; options = config; return worker; } });
  const ocr = h.load("services/ocr/ocr.service");
  const first = ocr.recognizeImage(Buffer.from("synthetic"));
  await assert.rejects(ocr.recognizeImage(Buffer.from("synthetic")), error => error.status === 503);
  release(); await first; await ocr.recognizeImage(Buffer.from("synthetic")); await ocr.terminateOcrWorker();
  assert.equal(created, 1); assert.equal(options.cacheMethod, "none"); assert.ok(path.isAbsolute(options.langPath));
  assert.equal(events.filter(item => item === "reset").length, 2); assert.equal(events.filter(item => Array.isArray(item) && item[0] === "unlink").length, 2);
});
test("worker timeout terminates the worker and returns safe 503", async () => {
  let terminated = false; let signalStarted;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const h = harness({ quickTimeout: true, workerStub: async () => ({ setParameters: async () => {}, recognize: async () => { signalStarted(); return new Promise(() => {}); }, terminate: async () => { terminated = true; } }) });
  const job = h.load("services/ocr/ocr.service").recognizeImage(Buffer.from("synthetic"));
  await started; h.fireTimeout();
  await assert.rejects(job, error => error.status === 503);
  assert.equal(terminated, true);
});
test("real Sharp/Tesseract integration uses only in-memory synthetic PNG", { timeout: 60000 }, async () => {
  const h = harness({ real: true }); const ocr = h.load("services/ocr/ocr.service");
  try {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="500"><rect width="100%" height="100%" fill="white"/><g fill="black" font-family="Arial" font-size="48"><text x="50" y="90">INCOME TAX DEPARTMENT</text><text x="50" y="180">PERMANENT ACCOUNT NUMBER</text><text x="50" y="270">Name: SYNTHETIC USER</text><text x="50" y="360">ABCDE0000Z</text></g></svg>');
    const image = await sharp(svg).png().toBuffer();
    const result = await h.load("services/extraction.service").extractGovernmentId(image, { mimeType: "image/png" });
    assert.equal(result.idType, "pan"); assert.equal(result.name, "SYNTHETIC USER"); assert.equal(result.phoneNumber, null);
    assert.equal(Object.hasOwn(result, "text"), false);
    await assert.rejects(h.load("services/ocr/image-preprocessor").preprocessImage(Buffer.from("invalid image")), error => error.status === 422);
    image.fill(0);
  } finally { await ocr.terminateOcrWorker(); }
});

test("PAN newer-layout synthetic image preserves holder name through real OCR", { timeout: 60000 }, async () => {
  const h = harness({ real: true }); const ocr = h.load("services/ocr/ocr.service");
  let image; let processed;
  try {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="720"><rect width="100%" height="100%" fill="white"/><g fill="black" font-family="Arial" font-size="42"><text x="50" y="80">INCOME TAX DEPARTMENT</text><text x="50" y="160">GOVT. OF INDIA</text><text x="50" y="240">Permanent Account Number: ABCDE0000Z</text><text x="50" y="320">Name of Card Holder: SYNTHETIC USER</text><text x="50" y="400">Father’s Name: DEMO PARENT</text><text x="50" y="480">Date of Birth: 01/01/1900</text><text x="50" y="560">Gender: Male</text></g></svg>');
    image = await sharp(svg).png().toBuffer();
    processed = await h.load("services/ocr/image-preprocessor").preprocessImage(image);
    const internal = await ocr.recognizeImage(processed);
    // Inspect known synthetic label structure internally; never expose/log OCR text.
    assert.ok(/Name of Card Holder:\s*SYNTHETIC USER/i.test(internal.text), "OCR retains the inline holder label and value");
    const result = h.load("services/parsers/pan.parser").parsePan(internal.text);
    assert.equal(result.name, "SYNTHETIC USER"); assert.equal(result.documentNumber, "ABCDE0000Z");
  } finally { image?.fill(0); processed?.fill(0); await ocr.terminateOcrWorker(); }
});
