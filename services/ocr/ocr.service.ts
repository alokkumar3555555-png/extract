import "server-only";
import path from "node:path";
import { createRequire } from "node:module";
import { access } from "node:fs/promises";
import { createWorker, OEM, PSM, type Worker } from "tesseract.js";
import { ExtractionError } from "@/services/extraction.error";
import { normalizeOcrText } from "@/services/parsers/parser-utils";

export type OcrResult = { text: string; confidence?: number };
const requireAsset = createRequire(path.join(process.cwd(), "package.json"));
const TIMEOUT_MS = 40_000;
let worker: Worker | undefined;
let busy = false;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

export async function terminateOcrWorker(): Promise<void> {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = undefined;
  const current = worker;
  worker = undefined;
  if (current) await current.terminate();
}

export async function recognizeImage(image: Buffer): Promise<OcrResult> {
  // One job per process: never allow overlapping recognition or an unbounded image queue.
  if (busy) throw new ExtractionError("unavailable");
  busy = true;
  if (idleTimer) clearTimeout(idleTimer);
  let expired = false;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const task = async (): Promise<OcrResult> => {
      if (!worker) {
        const languageDirectory = path.join(path.dirname(requireAsset.resolve("@tesseract.js-data/eng")), "4.0.0");
        await access(path.join(languageDirectory, "eng.traineddata.gz"));
        if (expired) throw new ExtractionError("unavailable");
        const initialized = await createWorker("eng", OEM.LSTM_ONLY, {
          langPath: languageDirectory,
          workerPath: requireAsset.resolve("tesseract.js/src/worker-script/node/index.js"),
          corePath: path.dirname(requireAsset.resolve("tesseract.js-core/package.json")),
          cacheMethod: "none", gzip: true,
          logger: () => {}, errorHandler: () => {},
        });
        if (expired) { await initialized.terminate(); throw new ExtractionError("unavailable"); }
        worker = initialized;
      }
      const current = worker;
      await current.setParameters({ tessedit_pageseg_mode: PSM.AUTO, user_defined_dpi: "300" });
      const { data } = await current.recognize(image, {}, { text: true });
      const result: OcrResult = { text: normalizeOcrText(data.text), confidence: data.confidence };
      // Tesseract's /input is WebAssembly MEMFS, never a host-disk file. Remove it,
      // then reset the engine to release its last image/text and adaptive state before reuse.
      await current.FS("unlink", ["/input"]);
      await current.reinitialize("eng", OEM.LSTM_ONLY);
      return result;
    };
    const deadline = new Promise<never>((_resolve, reject) => {
      deadlineTimer = setTimeout(() => {
        expired = true;
        void terminateOcrWorker().catch(() => {});
        reject(new ExtractionError("unavailable"));
      }, TIMEOUT_MS);
    });
    const result = await Promise.race([task(), deadline]);
    idleTimer = setTimeout(() => { void terminateOcrWorker().catch(() => {}); }, 30_000);
    idleTimer.unref();
    return result;
  } catch (error) {
    await terminateOcrWorker().catch(() => {});
    if (error instanceof ExtractionError) throw error;
    throw new ExtractionError("internal");
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
    busy = false;
  }
}
