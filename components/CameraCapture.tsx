"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, LoaderCircle, X } from "lucide-react";

type Props = { disabled: boolean; onSelect: (file: File) => void };

export default function CameraCapture({ disabled, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState("");
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const mobileInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);

  function stopCamera() {
    generation.current++;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setOpen(false); setStarting(false); setReady(false); setCapturing(false);
  }
  useEffect(() => () => {
    generation.current++;
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);
  useEffect(() => {
    if (!open) return;
    const video = videoRef.current;
    if (video) {
      video.srcObject = streamRef.current;
      void video.play().catch(() => setError("Unable to show the camera preview. Please try again."));
    }
    dialogRef.current?.showModal();
  }, [open]);

  async function startCamera() {
    if (disabled || starting || open) return;
    setError("");
    // Native capture is a fallback for browsers without webcam APIs (often mobile).
    if (!navigator.mediaDevices?.getUserMedia) { mobileInput.current?.click(); return; }
    setStarting(true);
    const current = ++generation.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      if (current !== generation.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current = stream; setOpen(true);
    } catch (cause) {
      if (current !== generation.current) return;
      const name = cause instanceof Error ? cause.name : "";
      setError(name === "NotAllowedError" ? "Camera permission was denied. Allow camera access in your browser or upload an image." : "Unable to access a camera. Use HTTPS or localhost, connect a camera, or upload an image.");
    } finally { if (current === generation.current) setStarting(false); }
  }
  function takePhoto() {
    const video = videoRef.current;
    if (!video || !ready || capturing) return;
    setCapturing(true); setError("");
    const current = generation.current;
    try {
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 2400 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Capture unavailable");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        canvas.width = 0; canvas.height = 0;
        if (current !== generation.current) return;
        if (!blob) { setCapturing(false); setError("Unable to capture a photo. Please try again."); return; }
        const file = new File([blob], "camera-id.jpg", { type: "image/jpeg" });
        stopCamera(); onSelect(file);
      }, "image/jpeg", 0.92);
    } catch { setCapturing(false); setError("Unable to capture a photo. Please try again."); }
  }

  return <>
    <input ref={mobileInput} className="file-input" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" aria-label="Take an ID photo" disabled={disabled} onChange={(event) => { const file = event.target.files?.[0]; if (file) onSelect(file); event.currentTarget.value = ""; }} />
    <button className="header-upload" onClick={() => void startCamera()} disabled={disabled || starting || open}>{starting ? <LoaderCircle size={14} className="spin" /> : <Camera size={14} />}{starting ? "Opening camera…" : "Take photo"}</button>
    {starting && <button className="clear-btn" onClick={stopCamera}>Cancel camera</button>}
    {error && !open && <p className="upload-error camera-error" role="alert">{error}</p>}
    {open && <dialog ref={dialogRef} className="camera-dialog" aria-labelledby="camera-title" onCancel={(event) => { event.preventDefault(); stopCamera(); }}><div className="camera-header"><h2 id="camera-title">Take an ID photo</h2><button aria-label="Close camera" className="clear-btn" onClick={stopCamera}><X size={20} /></button></div><p>Keep the full document in frame and use good lighting.</p><video ref={videoRef} autoPlay playsInline muted onLoadedMetadata={() => setReady(true)} aria-label="Live camera preview" />{error && <p className="upload-error" role="alert">{error}</p>}<div className="camera-actions"><button className="clear-btn" onClick={stopCamera}>Cancel</button><button className="primary-btn" onClick={takePhoto} disabled={!ready || capturing}>{capturing ? <LoaderCircle size={16} className="spin" /> : <Camera size={16} />} {capturing ? "Capturing…" : "Use photo"}</button></div></dialog>}
  </>;
}
