// A short-lived process gives the caller a reliable kill boundary even when
// the OCR library fails before exposing its Worker (e.g. missing model data).
import { createWorker, OEM, PSM } from "tesseract.js";
import chinese from "@tesseract.js-data/chi_sim";
process.once("message", async (image) => {
  let worker;
  try {
    worker = await createWorker("chi_sim", OEM.LSTM_ONLY, {
      langPath: chinese.langPath, cacheMethod: "none", gzip: true,
      logger: () => {}, errorHandler: () => { process.send?.({ ok: false }); },
    });
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, user_defined_dpi: "150" });
    const result = await worker.recognize(image, {}, { text: true });
    process.send?.({ ok: true, text: result.data.text });
  } catch { process.send?.({ ok: false }); }
  finally { await worker?.terminate().catch(() => {}); process.disconnect?.(); }
});
