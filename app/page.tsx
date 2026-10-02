"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ArrowRight, Check, CircleHelp, Clipboard, FileText, Hash, ImagePlus, LoaderCircle, Menu, RotateCcw, Save, ScanLine, ShieldCheck, Sparkles, Upload, X } from "lucide-react";
import type { ApiResponse, ExtractionResult, IdType, StoredExtraction } from "@/types/extraction";

const ID_LABELS: Record<IdType, string> = { aadhaar: "Aadhaar Card", pan: "PAN Card", driving_licence: "Driving Licence", unknown: "Unknown" };
const FIELDS = [ ["name", "Name"], ["documentNumber", "Document Number"], ["address", "Address"], ["phoneNumber", "Phone Number"] ] as const;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

function isExtraction(value: unknown): value is ExtractionResult {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  return typeof data.idType === "string" && Object.hasOwn(ID_LABELS, data.idType)
    && FIELDS.every(([key]) => data[key] === null || typeof data[key] === "string");
}

export default function Home() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState("");
  const [extractionResult, setExtractionResult] = useState<ExtractionResult | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [extractError, setExtractError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const previewUrl = useRef("");
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const savedSignature = useRef("");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = extracting || saving;

  useEffect(() => () => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    requestRef.current?.abort();
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  function resetResult() {
    setExtractionResult(null); setExtractError(""); setSaveError(""); setSaved(false); setCopied(false); setCopyError("");
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }
  function clear() {
    if (busyRef.current) return;
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = ""; savedSignature.current = ""; setSelectedFile(null); setImagePreview(""); resetResult();
  }
  function selectFile(file?: File) {
    if (!file || busyRef.current) return;
    let error = "";
    if (!ACCEPTED_TYPES.includes(file.type)) error = "Choose a JPEG, PNG, or WebP image.";
    else if (!file.size) error = "Choose a nonempty image.";
    else if (file.size > 10 * 1024 * 1024) error = "That image exceeds the 10 MiB limit. Choose a smaller image.";
    clear();
    if (error) { setExtractError(error); return; }
    try {
      const url = URL.createObjectURL(file);
      previewUrl.current = url; setSelectedFile(file); setImagePreview(url);
    } catch { setExtractError("Unable to preview this image. Try another file."); }
  }
  async function extract() {
    if (!selectedFile || busyRef.current) return;
    busyRef.current = true; setExtracting(true); resetResult();
    const controller = new AbortController(); requestRef.current = controller;
    try {
      const form = new FormData(); form.append("file", selectedFile);
      const response = await fetch("/api/extract", { method: "POST", body: form, signal: controller.signal });
      const payload: ApiResponse<ExtractionResult> = await response.json();
      if (controller.signal.aborted) return;
      if (!payload.success) { setExtractError(typeof payload.error === "string" ? payload.error : "Unable to extract document information."); return; }
      if (!response.ok || !isExtraction(payload.data)) { setExtractError("Unable to read the extraction response. Please try again."); return; }
      setExtractionResult(payload.data);
      setSaved(savedSignature.current === JSON.stringify([payload.data.idType, ...FIELDS.map(([key]) => payload.data[key])]));
    } catch {
      if (!controller.signal.aborted) setExtractError("Unable to extract document information. Please try again.");
    } finally {
      busyRef.current = false; requestRef.current = null;
      if (!controller.signal.aborted) setExtracting(false);
    }
  }
  async function saveResult() {
    if (!extractionResult || saved || busyRef.current) return;
    busyRef.current = true; setSaving(true); setSaveError("");
    const controller = new AbortController(); requestRef.current = controller;
    try {
      const body: ExtractionResult = {
        idType: extractionResult.idType, name: extractionResult.name,
        documentNumber: extractionResult.documentNumber, address: extractionResult.address,
        phoneNumber: extractionResult.phoneNumber,
      };
      const response = await fetch("/api/extractions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
      const payload: ApiResponse<StoredExtraction> = await response.json();
      if (controller.signal.aborted) return;
      if (!payload.success) { setSaveError(typeof payload.error === "string" ? payload.error : "Unable to save this result."); return; }
      if (!response.ok || !isExtraction(payload.data) || typeof payload.data.id !== "string") { setSaveError("Unable to confirm the save. Please check before trying again."); return; }
      savedSignature.current = JSON.stringify([extractionResult.idType, ...FIELDS.map(([key]) => extractionResult[key])]);
      setSaved(true);
    } catch {
      if (!controller.signal.aborted) setSaveError("Unable to confirm the save. Please check your connection before trying again.");
    } finally {
      busyRef.current = false; requestRef.current = null;
      if (!controller.signal.aborted) setSaving(false);
    }
  }
  async function copyResult() {
    if (!extractionResult) return;
    setCopyError("");
    try {
      await navigator.clipboard.writeText([
        "ID Type: " + ID_LABELS[extractionResult.idType],
        ...FIELDS.map(([key, label]) => label + ": " + (extractionResult[key] ?? "Not found")),
      ].join("\n"));
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1600);
    } catch { setCopyError("Could not copy the result. Please try again."); }
  }

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="#top" aria-label="ID Extractor home"><span className="brand-mark"><ScanLine size={19} strokeWidth={2.5} /></span><span>ID<span className="brand-light">Extractor</span></span></a>
      <button className="mobile-menu" onClick={() => setMobileOpen(!mobileOpen)} aria-label="Toggle navigation" aria-expanded={mobileOpen} aria-controls="main-navigation">{mobileOpen ? <X size={20} /> : <Menu size={20} />}</button>
      <nav id="main-navigation" className={mobileOpen ? "nav-links open" : "nav-links"} onClick={() => setMobileOpen(false)}><a className="nav-active" href="#workspace">Extractor</a><a href="#how-it-works">How it works</a><a href="#privacy">Privacy</a></nav>
      <div className="top-actions"><a className="help-btn" href="#how-it-works"><CircleHelp size={16} /> Help</a><span className="avatar" aria-label="Extractor"><ScanLine size={15} /></span></div>
    </header>
    <main id="top">
      <section className="hero"><div className="eyebrow"><span className="eyebrow-dot" /> SMART ID EXTRACTION</div><h1>Extract details<br className="desktop-break" /> from your <span>ID.</span></h1><p>Upload an Aadhaar Card, PAN Card, or Driving Licence and extract its key information.</p><div className="hero-note"><ShieldCheck size={15} /> Your ID image is processed temporarily and is not stored.</div></section>
      <section className="workspace" id="workspace" aria-label="ID extraction workspace">
        <div className="input-card card">
          <div className="card-head"><div className="card-title"><span className="title-icon purple"><FileText size={17} /></span><div><h2>Your ID image</h2><span className="subheading">Choose a clear image of your document</span></div></div><button className="header-upload" onClick={() => inputRef.current?.click()} disabled={busy}><ImagePlus size={14} /> Upload image</button></div>
          <div className="photo-upload">
            <input ref={inputRef} className="file-input" id="id-image" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Government ID image" onChange={(event) => { selectFile(event.target.files?.[0]); event.currentTarget.value = ""; }} disabled={busy} />
            <button type="button" className={"upload-drop primary-upload " + (busy ? "uploading" : "")} onClick={() => inputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); selectFile(event.dataTransfer.files[0]); }} disabled={busy}>
              <span className="upload-icon">{extracting ? <LoaderCircle size={24} className="spin" /> : <ImagePlus size={24} />}</span><span className="upload-copy"><strong>{extracting ? "Extracting your ID…" : "Choose or drop an ID image"}</strong><small>{extracting ? "Processing securely on our server" : "JPEG, PNG, or WebP · up to 10 MiB"}</small></span><span className="upload-action"><Upload size={13} /> Browse</span>
            </button>
            {imagePreview && selectedFile && <><div className="image-preview"><Image src={imagePreview} alt="Selected ID image preview" width={800} height={500} unoptimized /></div><div className="photo-file"><FileText size={15} /><span title={selectedFile.name}>{selectedFile.name}</span><small>{(selectedFile.size / 1024 / 1024).toFixed(2)} MiB</small><button aria-label="Remove image" onClick={clear} disabled={busy}><X size={14} /></button></div></>}
            {extractError && <p className="upload-error" role="alert">{extractError}</p>}
          </div>
          <div className="supported-documents"><span className="option-heading">Supported documents</span><div className="chips">{["Aadhaar Card", "PAN Card", "Driving Licence"].map((label) => <span className="chip selected" key={label}><span className="chip-dot" />{label}</span>)}</div></div>
          <div className="scan-row"><button className="clear-btn" onClick={clear} disabled={!selectedFile || busy}><RotateCcw size={13} /> Clear</button><button className="primary-btn" onClick={() => void extract()} disabled={!selectedFile || busy}>{extracting ? <><LoaderCircle size={16} className="spin" /> Extracting…</> : <>Extract ID <ArrowRight size={16} /></>}</button></div>
        </div>
        <div className={"results-card card " + (extractionResult ? "has-results" : "")} aria-busy={extracting}>
          <div className="card-head results-head"><div className="card-title"><span className="title-icon green"><Hash size={17} /></span><div><h2>Extracted Information</h2><span className="subheading">{extractionResult ? "Review the details before saving" : "Your results will appear here"}</span></div></div></div>
          {extractionResult ? <><div className="result-toolbar"><span><Check size={14} /> Extraction complete</span><button className="copy-btn" onClick={() => void copyResult()}>{copied ? <Check size={14} /> : <Clipboard size={14} />}{copied ? "Copied!" : "Copy result"}</button></div><dl className="structured-results"><div className="result-item"><dt>ID Type</dt><dd>{ID_LABELS[extractionResult.idType]}</dd></div>{FIELDS.map(([key, label]) => <div className="result-item" key={key}><dt>{label}</dt><dd className={extractionResult[key] === null ? "not-found" : ""}>{extractionResult[key] ?? "Not found"}</dd></div>)}</dl><div className="save-row"><span>Save only the extracted details.</span><button className="primary-btn" onClick={() => void saveResult()} disabled={saving || saved || extracting}>{saving ? <LoaderCircle size={15} className="spin" /> : saved ? <Check size={15} /> : <Save size={15} />}{saving ? "Saving…" : saved ? "Saved" : "Save Result"}</button></div>{saved && <p className="save-success" role="status">Saved successfully</p>}{saveError && <p className="upload-error" role="alert">{saveError}</p>}{copyError && <p className="upload-error" role="alert">{copyError}</p>}</> : <div className="empty-state"><div className="empty-illustration"><span className="empty-paper"><span /><span /><span /></span><span className="empty-search">{extracting ? <LoaderCircle size={18} className="spin" /> : <Hash size={18} />}</span><Sparkles className="empty-spark" size={15} /></div><strong>{extracting ? "Reading your document" : "Ready when you are"}</strong><p>{extracting ? "Your image is being processed. This may take a moment." : "Upload your ID image and select Extract ID to see its information here."}</p><a href="#how-it-works"><CircleHelp size={14} /> See how it works</a></div>}
          <div className="result-foot" aria-live="polite"><span><span className="foot-dot" /> {extracting ? "Extraction in progress" : extractionResult ? "Scan complete" : "Waiting for an image"}</span><span><ShieldCheck size={13} /> Image not stored</span></div>
        </div>
      </section>
      <section className="how-section" id="how-it-works"><div className="section-heading"><span>QUICK & SIMPLE</span><h2>From your ID to <em>clear data.</em></h2><p>Upload, extract, and review your information.</p></div><div className="steps"><div className="step"><div className="step-number">01</div><div className="step-icon lavender"><Upload size={19} /></div><h3>Upload your ID</h3><p>Choose a clear Aadhaar, PAN, or Driving Licence image.</p></div><div className="step-connector" /><div className="step"><div className="step-number">02</div><div className="step-icon mint"><ScanLine size={19} /></div><h3>Extract details</h3><p>Our local OCR engine reads the document and identifies the relevant fields.</p></div><div className="step-connector" /><div className="step"><div className="step-number">03</div><div className="step-icon peach"><Save size={19} /></div><h3>Review &amp; save</h3><p>Review the extracted information and save it when you’re ready.</p></div></div></section>
      <section className="privacy-banner" id="privacy"><div className="privacy-icon"><ShieldCheck size={21} /></div><div><strong>Your ID image is processed temporarily and is not stored.</strong><span>Uploaded images are processed in memory on our server and discarded after extraction. Only extracted data is saved when you explicitly choose Save Result.</span></div><span className="privacy-badge"><Check size={13} /> Images not stored</span></section>
    </main>
    <footer><a className="brand footer-brand" href="#top"><span className="brand-mark"><ScanLine size={17} strokeWidth={2.5} /></span><span>ID<span className="brand-light">Extractor</span></span></a><span>Less typing. More time for what matters.</span><a href="#privacy">Privacy first <ShieldCheck size={13} /></a></footer>
  </div>;
}
