"use client";

/**
 * SI — Service Inside · Work order attachments
 *
 * Upload photos, and — the half that was missing — open them.
 *
 * A photo was a bare `<img>` with no handler on it, so tapping one did nothing
 * at all: the only view of a fault photo was an 80px thumbnail. A video was a
 * bare `<a target="_blank">` to the signed object URL, which navigates out of
 * the app to a raw file rather than playing it, and reads as "Video attachment"
 * however many there are. Both now open in a viewer over the page — full-size
 * image, or a real `<video controls>` — reached by tapping the thumbnail.
 *
 * The viewer walks photos-then-videos as a single list, the order the two
 * columns already read in, so next/prev is one model instead of two.
 *
 * **Video is upload-removed, not read-removed.** There is no video control any
 * more and migration 0036 drops the video mime types from the bucket, so no new
 * one can arrive by any path. What was uploaded before that stays playable, and
 * the Videos column renders only when the work order actually has one —
 * otherwise a permanently-empty "Videos (0)" column would sit next to Photos
 * advertising a feature that is gone. Deleting the playback branch instead
 * would have made those files unreachable from the app that stored them.
 *
 * Photos are compressed in the browser before upload (lib/compressImage.js),
 * inside `addAttachment` rather than here — see the note there.
 */
import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Image as ImageIcon,
  Play,
  X,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { listenAttachments, addAttachment } from "../../lib/workOrders";
import { describeError } from "../../lib/errors";
import Button from "../ui/Button";
import { ErrorBanner, ModalOverlay } from "../ui/Surfaces";

/**
 * `attachments` carries no filename column — the name survives only inside the
 * object key `addAttachment` builds: `work_orders/{id}/{epoch}-{safe name}`.
 * Strip the folder and that epoch prefix back off so the viewer can name the
 * file the way whoever uploaded it would recognise. No decoding step:
 * `addAttachment` has already replaced every character outside `[\w.-]`, so a
 * percent-escape cannot have survived to be decoded.
 */
function fileLabel(a) {
  const base = (a.storage_path || a.file_url || "").split("/").pop() || "";
  return base.replace(/^\d{10,}-/, "") || (a.file_type === "video" ? "Video" : "Photo");
}

function fileSize(bytes) {
  if (!bytes) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * One attachment, full size, over the page.
 *
 * Portalled through ModalOverlay rather than positioned here: `<main>` carries
 * `.rise`, whose fill-mode leaves a transform on it, and `inset-0` inside a
 * transformed ancestor is the page rather than the screen — the reason that
 * component exists at all. The `!` overrides darken its backdrop and centre the
 * panel on a phone too, where it otherwise aligns to the bottom edge.
 */
function AttachmentViewer({ items, index, onIndex, onClose }) {
  const item = items[index];
  const [failed, setFailed] = useState(false);

  // Cleared per attachment: one expired URL would otherwise leave the message
  // standing over every attachment opened after it.
  useEffect(() => setFailed(false), [item?.id]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" && index < items.length - 1) onIndex(index + 1);
      else if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [index, items.length, onClose, onIndex]);

  if (!item) return null;

  const isVideo = item.file_type === "video";
  const size = fileSize(item.file_size_bytes);
  const navClass =
    "absolute top-1/2 -translate-y-1/2 rounded-full bg-black/55 p-2 text-white disabled:opacity-0";

  return (
    <ModalOverlay onClose={onClose} className="!bg-black/80 !items-center p-3 sm:p-6">
      <div className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded bg-white">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-bold text-ink">{fileLabel(item)}</div>
            <div className="truncate text-[11.5px] text-ink-soft">
              {isVideo ? "Video" : "Photo"} {index + 1} of {items.length}
              {size ? ` · ${size}` : ""}
            </div>
          </div>
          {/* A way out for anything the browser will not decode itself — an
              iPhone video in HEVC, say. Same signed URL, handed to the OS. */}
          <a
            href={item.file_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded border border-[#D8DEE4] px-2.5 py-1.5 text-[12.5px] font-semibold text-ink"
          >
            <ExternalLink size={14} /> Open
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex-shrink-0 rounded p-1.5 text-ink-soft hover:bg-canvas"
          >
            <X size={18} />
          </button>
        </div>

        <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black">
          {failed ? (
            <div className="px-6 py-12 text-center text-[13px] leading-relaxed text-white/80">
              This attachment couldn&apos;t be loaded. Its link is signed and lasts an hour —
              reopen the work order to mint a fresh one.
            </div>
          ) : isVideo ? (
            // key: React would otherwise reuse one <video> element across
            // attachments, and swapping src on a playing element keeps the old
            // stream buffered and skips autoplay. playsInline: without it iOS
            // takes every video fullscreen on its own.
            <video
              key={item.id}
              src={item.file_url}
              controls
              autoPlay
              playsInline
              preload="metadata"
              onError={() => setFailed(true)}
              className="max-h-[70vh] w-full"
            />
          ) : (
            <img
              key={item.id}
              src={item.file_url}
              alt={fileLabel(item)}
              onError={() => setFailed(true)}
              className="max-h-[70vh] max-w-full object-contain"
            />
          )}

          {items.length > 1 && (
            <>
              <button
                type="button"
                aria-label="Previous attachment"
                disabled={index === 0}
                onClick={() => onIndex(index - 1)}
                className={`${navClass} left-2`}
              >
                <ChevronLeft size={20} />
              </button>
              <button
                type="button"
                aria-label="Next attachment"
                disabled={index === items.length - 1}
                onClick={() => onIndex(index + 1)}
                className={`${navClass} right-2`}
              >
                <ChevronRight size={20} />
              </button>
            </>
          )}
        </div>
      </div>
    </ModalOverlay>
  );
}

export default function AttachmentsPanel({ wo }) {
  const { user } = useAuth();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [viewing, setViewing] = useState(null);
  const photoInput = useRef(null);

  useEffect(() => {
    const unsub = listenAttachments(wo.id, setItems, () => setError("Couldn't load attachments."));
    return unsub;
  }, [wo.id]);

  async function upload(files, fileType) {
    setError(null);
    try {
      const actor = { uid: user.uid, name: user.name, role: user.role };
      await Promise.all(Array.from(files).map((f) => addAttachment(wo.id, actor, f, fileType)));
    } catch (e) {
      // Storage rejects oversize files and disallowed mime types with a specific
      // reason (the bucket caps at 50MB — see migration 0005). Show it, or the
      // user retries the same too-large file forever.
      setError(describeError(e, "Couldn't upload — try again."));
    }
  }

  const photos = (items || []).filter((a) => a.file_type === "photo");
  const videos = (items || []).filter((a) => a.file_type === "video");
  // The viewer's list, and the index every thumbnail below hands it.
  const media = [...photos, ...videos];

  return (
    // The banner was a flex child of the two-column row, so an upload error
    // showed up as a third squeezed column instead of a full-width banner.
    <div>
      {error && <ErrorBanner message={error} />}
      {/* One column until there is actually a legacy video to show, so Photos
          gets the full width in the ordinary case rather than half of it. */}
      <div className={`grid grid-cols-1 gap-6 ${videos.length > 0 ? "sm:grid-cols-2" : ""}`}>
        <div className="min-w-0">
          <div className="mb-2.5 flex items-center justify-between">
            <div className="font-bold text-[13.5px] text-ink">Photos ({photos.length})</div>
            <Button size="sm" variant="ghost" icon={ImageIcon} onClick={() => photoInput.current.click()}>Upload</Button>
            <input ref={photoInput} type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files, "photo")} />
          </div>
          <div className="flex flex-wrap gap-2">
            {photos.length === 0 && <div className="text-[12.5px] text-ink-soft">No photos uploaded yet.</div>}
            {photos.map((p, i) => (
              // w-18/h-18 aren't in Tailwind's scale, so these compiled to
              // nothing and every photo rendered at its full camera resolution —
              // one attachment pushed the page thousands of pixels wide.
              <button
                key={p.id}
                type="button"
                onClick={() => setViewing(i)}
                aria-label={`View ${fileLabel(p)}`}
                className="h-20 w-20 flex-shrink-0 overflow-hidden rounded border border-border"
              >
                <img src={p.file_url} alt="" loading="lazy" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        </div>
        {videos.length > 0 && (
        <div className="min-w-0">
          <div className="mb-2.5">
            <div className="font-bold text-[13.5px] text-ink">Videos ({videos.length})</div>
            <div className="text-[11.5px] text-ink-soft">
              Uploaded before video attachments were withdrawn. Still playable; no new ones can be added.
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            {videos.map((v, i) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setViewing(photos.length + i)}
                className="flex w-full items-center gap-2 rounded bg-canvas px-2.5 py-2 text-left text-[12.5px]"
              >
                <Play size={14} className="flex-shrink-0 text-ink-soft" />
                <span className="min-w-0 flex-1 truncate text-ink">{fileLabel(v)}</span>
                {fileSize(v.file_size_bytes) && (
                  <span className="flex-shrink-0 text-[11.5px] text-ink-soft">
                    {fileSize(v.file_size_bytes)}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
        )}
      </div>

      {viewing !== null && media[viewing] && (
        <AttachmentViewer
          items={media}
          index={viewing}
          onIndex={setViewing}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}
