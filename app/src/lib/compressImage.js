/**
 * SI — Service Inside · Client-side image compression
 *
 * A fault photo off a phone camera is 3–5MB, and the app has exactly two things
 * to do with it: render an 80px thumbnail, and open it full-screen in the
 * viewer. Storing the original pays a plan quota (see DATA_AND_STORAGE.md §
 * storage and egress fill before the database does) for detail nothing ever
 * looks at, and costs the person on the floor the upload over plant wifi.
 *
 * `output: "export"` means there is no server to resize on, so this runs in the
 * browser: decode, draw to a canvas scaled to a 1920px long edge, re-encode as
 * JPEG. On a phone photo that is typically 80–90% smaller.
 *
 * Called from ONE place — `addAttachment()` in lib/workOrders.js — which is the
 * chokepoint both upload paths already share (the raise form and the work
 * order's Attachments tab). Compressing there rather than at each call site is
 * what guarantees the original is never the thing that gets uploaded: only the
 * returned file reaches storage, so there is no original to delete afterwards,
 * and `file_size_bytes` records the compressed size because it reads
 * `file.size` off this result.
 *
 * ── It never throws, and never rejects ──
 *
 * Every failure path returns the ORIGINAL file, so an upload can never be lost
 * to compression. That is what makes "any format" true rather than aspirational:
 *
 *   * HEIC, the iPhone default, cannot be decoded by a canvas in Chrome or
 *     Firefox — there is no decoder in those engines. It decodes fine on
 *     iOS/macOS Safari, where the OS provides one, and iOS usually hands over a
 *     JPEG anyway when a photo is picked through `accept="image/*"`. Where it
 *     cannot be decoded, the original uploads untouched.
 *   * Anything else exotic (AVIF on an old browser, a TIFF, a corrupt file)
 *     takes the same path.
 *   * A result that came out LARGER than the original — which happens on an
 *     already-optimised small image — is discarded for the original.
 *
 * So the guarantee is: every allowed format uploads, most of them compressed.
 *
 * ── Two choices worth not reversing ──
 *
 * **JPEG, not WebP**, even though WebP is smaller at equal quality and the
 * bucket allows it. These photos are opened on whatever is to hand in a plant,
 * including old Android tablets; JPEG is the one raster format nothing fails to
 * decode. The bytes saved are not worth a photo of a fault that will not open.
 *
 * **The canvas is filled white before the draw.** JPEG has no alpha channel, so
 * a transparent PNG — a screenshot of an HMI error dialog, say — composites
 * against whatever the canvas started as, which is transparent black. Without
 * the fill, every transparent pixel comes out black and a light screenshot
 * arrives looking like a photograph of a switched-off monitor.
 */

/** Long edge of the output, in pixels. */
const MAX_EDGE = 1920;

/**
 * Quality ladder. The first pass is 0.75, which is visually indistinguishable
 * from the original at this resolution; the lower rungs exist only because the
 * requirement is a HALVING, and an image that was already compressed once does
 * not always halve at 0.75. Each retry is just another encode of a canvas that
 * is already drawn, so the ladder costs encoding time and no decoding.
 */
const QUALITY_LADDER = [0.75, 0.6, 0.45];

/** Anything at or under this is already small enough not to bother. */
const SKIP_UNDER_BYTES = 60 * 1024;

/** What "compressed enough" means: half the original, per the requirement. */
const TARGET_RATIO = 0.5;

/**
 * Decode a file into something drawable.
 *
 * `createImageBitmap` first: it decodes off the main thread, so a 12MP photo
 * does not freeze the form, and `imageOrientation: "from-image"` applies the
 * EXIF rotation. Skipping that is how a photo taken in portrait arrives on its
 * side — the flag's default has changed across spec revisions, so it is passed
 * explicitly rather than relied on.
 *
 * The `<img>` fallback is for browsers without `createImageBitmap` for blobs.
 * Its object URL is revoked on both paths; leaking one per upload would hold
 * the whole original in memory for the life of the page.
 */
async function decode(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Fall through — an engine with no decoder for this format throws here,
      // and the <img> path is worth trying because it uses a different one.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("undecodable"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** canvas.toBlob as a promise. Resolves null rather than throwing. */
function toBlob(canvas, quality) {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), "image/jpeg", quality);
    } catch {
      resolve(null);
    }
  });
}

/** `IMG_0421.HEIC` -> `IMG_0421.jpg`. The key should not lie about its bytes. */
function asJpegName(name) {
  return `${String(name || "photo").replace(/\.[^.\s]*$/, "")}.jpg`;
}

/**
 * Compress an image file. Returns a new JPEG File, or the original file
 * unchanged when it cannot be improved or cannot be read.
 *
 * @param {File} file
 * @returns {Promise<File>} never rejects
 */
export async function compressImage(file) {
  if (!file || typeof file !== "object") return file;

  // Not an image (a PDF attachment, say) — nothing to do. Also the guard that
  // keeps this safe to call unconditionally from addAttachment().
  if (!String(file.type || "").startsWith("image/")) return file;

  // An SVG is markup, not a raster: rasterising it would make it bigger AND
  // lose its scalability. It is not in the bucket's allowlist anyway.
  if (file.type === "image/svg+xml") return file;

  if (file.size <= SKIP_UNDER_BYTES) return file;

  let bitmap;
  try {
    bitmap = await decode(file);
  } catch {
    return file; // HEIC on Chrome/Firefox, or anything else undecodable
  }

  try {
    const srcW = bitmap.width || bitmap.naturalWidth;
    const srcH = bitmap.height || bitmap.naturalHeight;
    if (!srcW || !srcH) return file;

    // Only ever downscale. Enlarging a small photo to 1920 would invent detail
    // and cost bytes to store the invention.
    const scale = Math.min(1, MAX_EDGE / Math.max(srcW, srcH));
    const w = Math.max(1, Math.round(srcW * scale));
    const h = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;

    // See the header: JPEG has no alpha, so transparency has to land on
    // something, and white is what a screenshot expects.
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);

    // Walk down the ladder, keeping the smallest result, and stop as soon as
    // one is under half the original.
    let best = null;
    for (const quality of QUALITY_LADDER) {
      const blob = await toBlob(canvas, quality);
      if (!blob) continue;
      if (!best || blob.size < best.size) best = blob;
      if (blob.size <= file.size * TARGET_RATIO) break;
    }

    // Nothing encoded, or the "compressed" version is not actually smaller.
    if (!best || best.size >= file.size) return file;

    return new File([best], asJpegName(file.name), {
      type: "image/jpeg",
      lastModified: file.lastModified || undefined,
    });
  } catch {
    return file;
  } finally {
    // Frees the decoded pixels immediately instead of at the next GC. Absent on
    // the <img> fallback, hence the guard.
    if (typeof bitmap?.close === "function") bitmap.close();
  }
}
