import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { File } from "node:buffer";
import { renderToStaticMarkup } from "react-dom/server";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireLocal = createRequire(import.meta.url);
const demo = { idType: "pan", name: "SYNTHETIC USER", documentNumber: "ABCDE0000Z", address: null, phoneNumber: null };

// Exercise the actual page's event handlers and state transitions without a browser dependency.
function mount({ responses = [], fetchImpl } = {}) {
  const slots = []; const cleanups = []; const requests = []; const revoked = []; const created = []; const clipboard = [];
  let cursor = 0;
  const react = { ...requireLocal("react"),
    useState: initial => { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useRef: initial => { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect: effect => { const index = cursor++; if (!(index in slots)) { slots[index] = true; cleanups.push(effect()); } },
  };
  const mod = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, "app/page.tsx"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, {
    exports: mod.exports, require: ref => ref === "react" ? react : ref === "next/image" ? { __esModule: true, default: props => requireLocal("react").createElement("img", props) } : requireLocal(ref),
    URL: { createObjectURL: file => { const url = "blob:synthetic-" + created.length; created.push({ file, url }); return url; }, revokeObjectURL: url => revoked.push(url) },
    FormData, AbortController, setTimeout, clearTimeout,
    navigator: { clipboard: { writeText: async value => clipboard.push(value) } },
    fetch: async (url, options) => { requests.push({ url, options }); return fetchImpl ? fetchImpl(url, options) : responses.shift(); },
    console: new Proxy({}, { get: () => () => { throw Error("Unexpected logging"); } }),
  });
  const render = () => { cursor = 0; return mod.exports.default(); };
  const unmount = () => cleanups.forEach(cleanup => cleanup?.());
  return { render, unmount, requests, revoked, created, clipboard };
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...[].concat(tree.props?.children ?? []).flatMap(nodes)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join("");
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  if (!tree || typeof tree !== "object") return "";
  return [].concat(tree.props?.children ?? []).map(text).join("");
}
function button(tree, label) { const item = nodes(tree).find(node => node.type === "button" && text(node).trim() === label); assert.ok(item, "Button exists: " + label); return item; }
function fileInput(tree) { return nodes(tree).find(node => node.type === "input" && node.props.type === "file"); }
function choose(h, file) { fileInput(h.render()).props.onChange({ target: { files: [file] }, currentTarget: { value: "" } }); }
function response(data, status = 200) { return { ok: status >= 200 && status < 300, json: async () => data }; }
const image = () => new File(["synthetic"], "synthetic.png", { type: "image/png" });

test("page renders supplied layout with correct privacy copy and disabled extraction", () => {
  const h = mount(); const tree = h.render(); const html = renderToStaticMarkup(tree);
  assert.ok(html.includes("SMART ID EXTRACTION")); assert.ok(html.includes("Extracted Information"));
  assert.ok(html.includes("processed in memory on our server")); assert.equal(button(tree, "Extract ID").props.disabled, true);
  assert.equal(text(tree).includes("Find these identifiers"), false); h.unmount();
});
test("valid selection shows preview; replacing, removing and unmounting revoke URLs", () => {
  const h = mount(); choose(h, image()); let tree = h.render();
  assert.equal(button(tree, "Extract ID").props.disabled, false);
  assert.ok(nodes(tree).some(node => node.props?.alt === "Selected ID image preview" && node.props.src === "blob:synthetic-0"));
  choose(h, image()); assert.deepEqual(h.revoked, ["blob:synthetic-0"]);
  nodes(h.render()).find(node => node.props?.["aria-label"] === "Remove image").props.onClick();
  assert.deepEqual(h.revoked, ["blob:synthetic-0", "blob:synthetic-1"]);
  choose(h, image()); h.unmount(); assert.equal(h.revoked.at(-1), "blob:synthetic-2");
});
test("invalid MIME, empty and oversized uploads are rejected without requests", () => {
  for (const file of [new File(["bad"], "bad.gif", { type: "image/gif" }), new File([], "empty.png", { type: "image/png" }), new File([new Uint8Array(10485761)], "large.png", { type: "image/png" })]) {
    const h = mount(); choose(h, file); const tree = h.render();
    assert.equal(button(tree, "Extract ID").props.disabled, true); assert.ok(nodes(tree).some(node => node.props?.role === "alert"));
    assert.equal(h.requests.length, 0); assert.equal(h.created.length, 0); h.unmount();
  }
});
test("extract sends multipart, renders five fields/null placeholders and never auto-saves", async () => {
  const h = mount({ responses: [response({ success: true, data: demo })] }); const file = image(); choose(h, file);
  await button(h.render(), "Extract ID").props.onClick();
  // The UI starts an async handler with void; wait for its microtasks to finish.
  await new Promise(resolve => setImmediate(resolve));
  const request = h.requests[0]; assert.equal(request.url, "/api/extract"); assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers, undefined); assert.equal(request.options.body.get("file").name, file.name);
  const resultText = text(h.render()); assert.ok(resultText.includes("PAN Card")); assert.ok(resultText.includes("SYNTHETIC USER"));
  assert.equal(nodes(h.render()).filter(node => node.type === "dd" && text(node) === "Not found").length, 2);
  assert.equal(h.requests.length, 1); assert.ok(button(h.render(), "Save Result")); h.unmount();
});
test("save posts only structured fields, shows success and prevents duplicate saves", async () => {
  const h = mount({ responses: [response({ success: true, data: demo }), response({ success: true, data: { ...demo, id: "synthetic-record", createdAt: "2026-10-02T00:00:00Z", userId: null } }, 201), response({ success: true, data: demo })] });
  choose(h, image()); button(h.render(), "Extract ID").props.onClick(); await new Promise(resolve => setImmediate(resolve));
  const action = button(h.render(), "Save Result").props.onClick; action(); action(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.requests.length, 2); const savedRequest = h.requests[1]; assert.equal(savedRequest.url, "/api/extractions");
  assert.deepEqual(JSON.parse(savedRequest.options.body), demo); assert.equal(savedRequest.options.headers["Content-Type"], "application/json");
  assert.ok(text(h.render()).includes("Saved successfully")); assert.equal(button(h.render(), "Saved").props.disabled, true);
  button(h.render(), "Saved").props.onClick(); assert.equal(h.requests.length, 2);
  button(h.render(), "Extract ID").props.onClick(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.requests.length, 3); assert.equal(button(h.render(), "Saved").props.disabled, true);
  choose(h, image()); assert.equal(text(h.render()).includes("Saved successfully"), false); h.unmount();
});
test("safe backend errors display and extraction can be retried", async () => {
  const h = mount({ responses: [response({ success: false, error: "Unable to extract document information" }, 422)] });
  choose(h, image()); button(h.render(), "Extract ID").props.onClick(); await new Promise(resolve => setImmediate(resolve));
  assert.ok(text(h.render()).includes("Unable to extract document information")); assert.equal(button(h.render(), "Extract ID").props.disabled, false); h.unmount();
});
test("save failure stays unsaved and displays safe backend message", async () => {
  const h = mount({ responses: [response({ success: true, data: demo }), response({ success: false, error: "Unable to save extraction" }, 500)] });
  choose(h, image()); button(h.render(), "Extract ID").props.onClick(); await new Promise(resolve => setImmediate(resolve));
  button(h.render(), "Save Result").props.onClick(); await new Promise(resolve => setImmediate(resolve));
  assert.ok(text(h.render()).includes("Unable to save extraction")); assert.equal(button(h.render(), "Save Result").props.disabled, false); h.unmount();
});
test("clear resets results and preview; copy uses structured human-readable output", async () => {
  const h = mount({ responses: [response({ success: true, data: demo })] }); choose(h, image());
  button(h.render(), "Extract ID").props.onClick(); await new Promise(resolve => setImmediate(resolve));
  button(h.render(), "Copy result").props.onClick(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.clipboard[0], "ID Type: PAN Card\nName: SYNTHETIC USER\nDocument Number: ABCDE0000Z\nAddress: Not found\nPhone Number: Not found");
  button(h.render(), "Clear").props.onClick(); const tree = h.render(); assert.equal(button(tree, "Extract ID").props.disabled, true);
  assert.equal(text(tree).includes("SYNTHETIC USER"), false); assert.equal(h.revoked.length, 1); h.unmount();
});
test("loading disables extraction/save/image changes and unmount aborts request", async () => {
  let resolve; const pending = new Promise(done => { resolve = done; });
  const h = mount({ fetchImpl: async () => pending }); choose(h, image()); button(h.render(), "Extract ID").props.onClick();
  const tree = h.render(); assert.equal(button(tree, "Extracting…").props.disabled, true); assert.equal(fileInput(tree).props.disabled, true);
  const original = h.created.length; choose(h, image()); assert.equal(h.created.length, original);
  h.unmount(); assert.equal(h.requests[0].options.signal.aborted, true); resolve(response({ success: true, data: demo }));
  await new Promise(done => setImmediate(done));
});
test("mobile navigation toggles and closes when a link is selected", () => {
  const h = mount(); let tree = h.render(); nodes(tree).find(node => node.props?.["aria-label"] === "Toggle navigation").props.onClick();
  tree = h.render(); assert.equal(nodes(tree).find(node => node.type === "nav").props.className, "nav-links open");
  nodes(tree).find(node => node.type === "nav").props.onClick(); assert.equal(nodes(h.render()).find(node => node.type === "nav").props.className, "nav-links"); h.unmount();
});

// Opt in with FRONTEND_LIVE_TEST=1 while the app runs on localhost:3107.
// This creates one synthetic Firestore record and removes it in finally.
test("live frontend handlers call local OCR and Firestore and clean up the record", { skip: process.env.FRONTEND_LIVE_TEST !== "1", timeout: 120000 }, async () => {
  const sharp = requireLocal("sharp"); const base = "http://localhost:3107";
  let createdId;
  const h = mount({ fetchImpl: async (url, options) => {
    const response = await fetch(base + url, options);
    if (url === "/api/extractions" && response.ok) createdId = (await response.clone().json()).data?.id;
    return response;
  } });
  async function waitFor(predicate) {
    const deadline = Date.now() + 55000;
    while (!predicate()) { assert.ok(Date.now() < deadline, "Request completed within deadline"); await new Promise(resolve => setTimeout(resolve, 50)); }
  }
  try {
    const page = await fetch(base); assert.equal(page.status, 200); assert.ok((await page.text()).includes("SMART ID EXTRACTION"));
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="500"><rect width="100%" height="100%" fill="white"/><g fill="black" font-family="Arial" font-size="48"><text x="50" y="90">INCOME TAX DEPARTMENT</text><text x="50" y="180">PERMANENT ACCOUNT NUMBER</text><text x="50" y="270">Name: SYNTHETIC USER</text><text x="50" y="360">ABCDE0000Z</text></g></svg>');
    const png = await sharp(svg).png().toBuffer(); choose(h, new File([png], "synthetic.png", { type: "image/png" }));
    button(h.render(), "Extract ID").props.onClick();
    await waitFor(() => !text(h.render()).includes("Extraction in progress"));
    assert.ok(text(h.render()).includes("SYNTHETIC USER")); assert.ok(text(h.render()).includes("PAN Card"));
    assert.equal(h.requests.length, 1);
    button(h.render(), "Save Result").props.onClick();
    await waitFor(() => !text(h.render()).includes("Saving…"));
    assert.ok(text(h.render()).includes("Saved successfully")); assert.ok(createdId);
    const saved = await fetch(base + "/api/extractions/" + encodeURIComponent(createdId));
    assert.equal(saved.status, 200); const record = (await saved.json()).data;
    assert.equal(record.name, "SYNTHETIC USER"); assert.equal(record.idType, "pan");
    png.fill(0);
  } finally {
    h.unmount();
    if (createdId) {
      const deleted = await fetch(base + "/api/extractions/" + encodeURIComponent(createdId), { method: "DELETE" });
      assert.equal(deleted.status, 200, "Synthetic record deleted");
      assert.equal((await fetch(base + "/api/extractions/" + encodeURIComponent(createdId))).status, 404, "Deletion verified");
    }
  }
});
