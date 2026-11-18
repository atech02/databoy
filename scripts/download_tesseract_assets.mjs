import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import zlib from "node:zlib";

const TARGET_DIR = path.resolve("public/vendor/tesseract");
if (!fs.existsSync(TARGET_DIR)) {
  fs.mkdirSync(TARGET_DIR, { recursive: true });
}

function fetchWithRetry(url, maxRetries = 5) {
  return new Promise((resolve, reject) => {
    function attempt(n) {
      const req = https.get(url, { headers: { "User-Agent": "DataBoy-Asset-Fetcher/1.0" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(fetchWithRetry(res.headers.location, maxRetries - 1));
        }
        if (res.statusCode !== 200) {
          if (n > 0) {
            console.log(`[Retry] ${url} HTTP ${res.statusCode}, retrying (${n} left)...`);
            return setTimeout(() => attempt(n - 1), 1000);
          }
          return reject(new Error(`Failed to download ${url}: HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      });
      req.on("error", (err) => {
        if (n > 0) {
          console.log(`[Retry] ${url} error: ${err.message}, retrying (${n} left)...`);
          return setTimeout(() => attempt(n - 1), 1500);
        }
        reject(err);
      });
      req.setTimeout(30000, () => {
        req.destroy();
        if (n > 0) {
          console.log(`[Retry] ${url} timeout, retrying (${n} left)...`);
          return setTimeout(() => attempt(n - 1), 1500);
        }
        reject(new Error(`Timeout downloading ${url}`));
      });
    }
    attempt(maxRetries);
  });
}

async function downloadAsset(filename, urls, shouldGzip = false) {
  const destPath = path.join(TARGET_DIR, filename);
  if (fs.existsSync(destPath) && fs.statSync(destPath).size > 1000) {
    console.log(`[Exists] ${filename} (${fs.statSync(destPath).size} bytes)`);
    return;
  }

  let downloadedBuffer = null;
  for (const url of urls) {
    try {
      console.log(`[Downloading] ${filename} from ${url}...`);
      downloadedBuffer = await fetchWithRetry(url);
      console.log(`[Success] Downloaded ${filename} (${downloadedBuffer.length} bytes)`);
      break;
    } catch (err) {
      console.warn(`[Fail] ${url}: ${err.message}`);
    }
  }

  if (!downloadedBuffer) {
    throw new Error(`Failed to download ${filename} from any mirror.`);
  }

  if (shouldGzip) {
    console.log(`[Gzipping] ${filename}...`);
    const gzipped = zlib.gzipSync(downloadedBuffer);
    fs.writeFileSync(destPath, gzipped);
    console.log(`[Saved] ${filename} (${gzipped.length} bytes, gzip)`);
  } else {
    fs.writeFileSync(destPath, downloadedBuffer);
    console.log(`[Saved] ${filename} (${downloadedBuffer.length} bytes)`);
  }
}

async function run() {
  console.log("=== Downloading Tesseract.js v5.1.0 Assets ===");

  // 1. Tesseract.js browser bundle
  await downloadAsset("tesseract.min.js", [
    "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/tesseract.min.js",
    "https://unpkg.com/tesseract.js@5.1.0/dist/tesseract.min.js",
  ]);

  // 2. Worker bundle
  await downloadAsset("worker.min.js", [
    "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/worker.min.js",
    "https://unpkg.com/tesseract.js@5.1.0/dist/worker.min.js",
  ]);

  // 3. Tesseract Core WASM wrapper
  await downloadAsset("tesseract-core.wasm.js", [
    "https://cdn.jsdelivr.net/npm/tesseract.js-core@v5.1.0/tesseract-core.wasm.js",
    "https://unpkg.com/tesseract.js-core@v5.1.0/tesseract-core.wasm.js",
  ]);

  // 4. Tesseract Core SIMD WASM binary
  await downloadAsset("tesseract-core-simd.wasm", [
    "https://cdn.jsdelivr.net/npm/tesseract.js-core@v5.1.0/tesseract-core-simd.wasm",
    "https://unpkg.com/tesseract.js-core@v5.1.0/tesseract-core-simd.wasm",
  ]);

  // 5. Tesseract Core standard WASM binary (fallback for non-SIMD devices)
  await downloadAsset("tesseract-core.wasm", [
    "https://cdn.jsdelivr.net/npm/tesseract.js-core@v5.1.0/tesseract-core.wasm",
    "https://unpkg.com/tesseract.js-core@v5.1.0/tesseract-core.wasm",
  ]);

  // 6. English traineddata (both raw and gzipped for maximum loader compatibility)
  await downloadAsset("eng.traineddata", [
    "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/eng.traineddata",
    "https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata",
  ]);
  const engBuffer = fs.readFileSync(path.join(TARGET_DIR, "eng.traineddata"));
  fs.writeFileSync(path.join(TARGET_DIR, "eng.traineddata.gz"), zlib.gzipSync(engBuffer));
  console.log(`[Created] eng.traineddata.gz (${fs.statSync(path.join(TARGET_DIR, "eng.traineddata.gz")).size} bytes)`);

  // 7. French traineddata (both raw and gzipped for maximum loader compatibility)
  await downloadAsset("fra.traineddata", [
    "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/fra.traineddata",
    "https://github.com/tesseract-ocr/tessdata_fast/raw/main/fra.traineddata",
  ]);
  const fraBuffer = fs.readFileSync(path.join(TARGET_DIR, "fra.traineddata"));
  fs.writeFileSync(path.join(TARGET_DIR, "fra.traineddata.gz"), zlib.gzipSync(fraBuffer));
  console.log(`[Created] fra.traineddata.gz (${fs.statSync(path.join(TARGET_DIR, "fra.traineddata.gz")).size} bytes)`);

  console.log("\nAll Tesseract assets successfully placed in public/vendor/tesseract/");
  const files = fs.readdirSync(TARGET_DIR);
  for (const f of files) {
    const s = fs.statSync(path.join(TARGET_DIR, f));
    console.log(`  - ${f.padEnd(28)} ${(s.size / 1024 / 1024).toFixed(2)} MB (${s.size} bytes)`);
  }
}

run().catch((err) => {
  console.error("FATAL ERROR downloading assets:", err);
  process.exit(1);
});
