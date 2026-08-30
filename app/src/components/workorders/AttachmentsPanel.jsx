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
 *
 * **A photo can be replaced by the person who uploaded it** (migration 0043),
 * from the camera or the gallery, while the work order is still live. The old
 * file is destroyed, so three things follow in this file: the control lives in
 * the full-size viewer rather than on the thumbnail — the thumbnail is already
 * a single `<button>` and nesting one inside it is invalid HTML, the problem
 * 0038 hit on the notification row; the warning is read BEFORE the camera
 * opens; and a replaced photo is marked in both places, because after a swap
 * its timestamp is the replacement's and no longer says when the fault was
 * first photographed.
 */
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Camera,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Image as ImageIcon,
  Play,
  RefreshCw,
  X,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { listenAttachments, addAttachment, replaceAttachment } from "../../lib/workOrders";
import { groupByPhase, phaseForStatus } from "../../lib/attachmentPhases";
import { fmtDateTimeMY } from "../../lib/datetime";
import { ROLE_LABELS } from "../../lib/roles";
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

/**
 * The uploader's role, as a word rather than an enum value. Falls back to the
 * raw code — the same fail-soft direction referenceData.js takes — and to a
 * dash for the rows written before migration 0039, which have no role recorded
 * because nothing was recording one.
 */
function uploaderRole(a) {
  if (!a.uploaded_by_role) return "—";
  return ROLE_LABELS[a.uploaded_by_role] || a.uploaded_by_role;
}

/** Name and role on one line, for the places that need it as flat text. */
function uploaderLine(a) {
  return `${a.uploaded_by_name || "Unknown"} · ${uploaderRole(a)}`;
}

/**
 * The statuses at which a work order's photos stop being replaceable. A copy of
 * the check in si_replace_attachment (migration 0043), which is the one that
 * decides — this only hides a control the database would refuse, the direction
 * this codebase allows a client predicate to run in.
 */
const FROZEN_STATUSES = ["verified", "closed"];

function canReplace(attachment, user, wo) {
  return (
    attachment.file_type === "photo" &&
    attachment.uploaded_by_id === user?.uid &&
    !FROZEN_STATUSES.includes(wo.status)
  );
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
function AttachmentViewer({ items, index, onIndex, onClose, replaceable, onReplace, busy }) {
  const item = items[index];
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const cameraInput = useRef(null);
  const galleryInput = useRef(null);

  // Cleared per attachment: one expired URL would otherwise leave the message
  // standing over every attachment opened after it.
  useEffect(() => setFailed(false), [item?.id]);
  // And the same for the confirmation: arrowing to the next photo with the
  // warning still open would aim it at a file the reader never agreed to lose.
  useEffect(() => setConfirming(false), [item?.id]);

  useEffect(() => {
    function onKey(e) {
      // While the warning is up, Escape backs out of THAT rather than out of
      // the viewer — the outer dismissal would look identical and leave the
      // reader unsure which one they cancelled. Nothing moves mid-upload
      // either: the arrows would swap the photo under a request already in
      // flight against the previous one.
      if (busy) return;
      if (e.key === "Escape") {
        if (confirming) setConfirming(false);
        else onClose();
      } else if (confirming) return;
      else if (e.key === "ArrowRight" && index < items.length - 1) onIndex(index + 1);
      else if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [index, items.length, onClose, onIndex, confirming, busy]);

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
            {/* Repeated here rather than left on the thumbnail: full screen is
                where somebody actually studies a photo, and it is the moment
                "who took this, and was it before or after the repair?" is worth
                answering without going back. Videos are legacy rows that
                predate 0039 and carry none of this, so the line is skipped
                rather than rendered as three dashes. */}
            {item.uploaded_by_name && (
              <div className="truncate text-[11.5px] text-ink-soft">
                {uploaderLine(item)} · {fmtDateTimeMY(item.uploaded_at)}
                {item.wo_status ? ` · ${phaseForStatus(item.wo_status).label}` : ""}
              </div>
            )}
            {/* The stamp above is the CURRENT picture's — a replacement
                re-stamps both (migration 0043) — so without this line a photo
                that has been swapped is indistinguishable from one that never
                was, and the timestamp quietly stops meaning "when the fault was
                photographed". */}
            {item.replaced_at && (
              <div className="truncate text-[11.5px] text-amber-700">
                Replaced {fmtDateTimeMY(item.replaced_at)}
                {item.replace_count > 1 ? ` · ${item.replace_count} times in total` : ""}
              </div>
            )}
          </div>
          {replaceable && !confirming && (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={busy}
              className="inline-flex flex-shrink-0 items-center gap-1.5 rounded border border-[#D8DEE4] px-2.5 py-1.5 text-[12.5px] font-semibold text-ink disabled:opacity-50"
            >
              <RefreshCw size={14} /> {busy ? "Replacing…" : "Replace"}
            </button>
          )}
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

        {/* The warning comes BEFORE the camera opens, not after a picture is
            taken. On a phone the file picker is a full-screen takeover, so a
            confirmation on the other side of it arrives when the reader has
            already committed — and the thing being confirmed is the deletion of
            a photo they can no longer see. Same reasoning as the decline
            confirmation in WorkflowPanel: the irreversible half is read back
            first. Choosing the file is then the agreement itself, which is why
            there is no second Confirm button. */}
        {confirming && (
          <div className="border-b border-border bg-[#FFFBEB] px-3 py-2.5">
            <div className="flex gap-2">
              <AlertTriangle size={15} className="mt-0.5 flex-shrink-0 text-amber-700" />
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-bold text-ink">
                  Replace this photo with a new one?
                </div>
                <div className="mt-0.5 text-[12px] leading-relaxed text-ink-soft">
                  {fileLabel(item)} will be deleted for good — it is not kept anywhere and
                  cannot be brought back. The swap is recorded against this work order with
                  your name on it.
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {/* Two inputs, not one with a toggle: `capture` is a hint the
                      browser either honours by opening the camera or ignores,
                      and there is no way to ask for the gallery once it is
                      present. On a laptop the first simply opens the file
                      picker, which is the only thing there is. */}
                  <Button size="sm" icon={Camera} disabled={busy} onClick={() => cameraInput.current.click()}>
                    Take photo
                  </Button>
                  <Button size="sm" variant="ghost" icon={ImageIcon} disabled={busy} onClick={() => galleryInput.current.click()}>
                    Choose from gallery
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
            <input
              ref={cameraInput}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                // Cleared so picking the same file twice still fires onChange —
                // a retry after a failed upload is exactly that case.
                e.target.value = "";
                if (f) onReplace(item, f);
              }}
            />
            <input
              ref={galleryInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) onReplace(item, f);
              }}
            />
          </div>
        )}

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
                disabled={index === 0 || busy}
                onClick={() => onIndex(index - 1)}
                className={`${navClass} left-2`}
              >
                <ChevronLeft size={20} />
              </button>
              <button
                type="button"
                aria-label="Next attachment"
                disabled={index === items.length - 1 || busy}
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
  const [replacingId, setReplacingId] = useState(null);
  const [notice, setNotice] = useState(null);
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

  /**
   * Swap one photo for another and close the viewer.
   *
   * Closing is not tidiness. The viewer holds an INDEX into a list this
   * replacement reorders: a swap re-stamps `wo_status`, so the photo can move
   * to a different phase group, and `orderedPhotos` is grouped — leaving the
   * viewer open would leave that index pointing at whatever slid into the slot,
   * which is a different photo with a live Replace button on it. The confirming
   * message therefore lands on the panel behind, where the grid has already
   * redrawn with the new picture in it.
   */
  async function replace(attachment, file) {
    setError(null);
    setNotice(null);
    setReplacingId(attachment.id);
    try {
      await replaceAttachment(attachment, file);
      setViewing(null);
      setNotice(`${fileLabel(attachment)} was replaced. The original has been deleted.`);
    } catch (e) {
      // Every refusal in si_replace_attachment is a sentence written to be
      // read — "This work order is closed…", "Only the person who uploaded a
      // photo can replace it." describeError surfaces those verbatim, which is
      // why they are worded that way rather than as codes.
      setError(describeError(e, "Couldn't replace that photo — try again."));
    } finally {
      setReplacingId(null);
    }
  }

  const photos = (items || []).filter((a) => a.file_type === "photo");
  const videos = (items || []).filter((a) => a.file_type === "video");

  /* Grouped by the phase of the job each photo documents (migration 0039).
     `orderedPhotos` is the grid's reading order once grouped, and it — not
     `photos` — is what the viewer indexes into, so the arrow keys walk the
     photos in the order they are actually shown rather than in the order the
     query returned them. */
  const photoGroups = groupByPhase(photos);
  const orderedPhotos = photoGroups.flatMap((g) => g.items);
  const photoIndex = new Map(orderedPhotos.map((p, i) => [p.id, i]));
  const media = [...orderedPhotos, ...videos];

  return (
    // The banner was a flex child of the two-column row, so an upload error
    // showed up as a third squeezed column instead of a full-width banner.
    <div>
      {error && <ErrorBanner message={error} />}
      {notice && (
        <div className="mb-3 flex items-start gap-2 rounded bg-[#ECFDF3] px-3 py-2 text-[12.5px] text-[#065F46]">
          <span className="min-w-0 flex-1">{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss"
            className="flex-shrink-0 rounded p-0.5 hover:bg-black/5"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {/* One column until there is actually a legacy video to show, so Photos
          gets the full width in the ordinary case rather than half of it. */}
      <div className={`grid grid-cols-1 gap-6 ${videos.length > 0 ? "sm:grid-cols-2" : ""}`}>
        <div className="min-w-0">
          <div className="mb-2.5 flex items-center justify-between">
            <div className="font-bold text-[13.5px] text-ink">Photos ({photos.length})</div>
            <Button size="sm" variant="ghost" icon={ImageIcon} onClick={() => photoInput.current.click()}>Upload</Button>
            <input ref={photoInput} type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files, "photo")} />
          </div>
          {photos.length === 0 && <div className="text-[12.5px] text-ink-soft">No photos uploaded yet.</div>}

          {/* One block per phase, empties omitted — so a work order that has
              only ever been photographed once still shows a single heading
              rather than five, four of them saying "none". */}
          {photoGroups.map(({ phase, items: groupPhotos }) => (
            <div key={phase.label} className="mb-4 last:mb-0">
              <div className="mb-1.5">
                <div className="text-[12.5px] font-bold text-ink">
                  {phase.label} <span className="font-medium text-ink-soft">({groupPhotos.length})</span>
                </div>
                <div className="text-[11px] text-ink-soft">{phase.note}</div>
              </div>
              <div className="flex flex-wrap gap-2.5">
                {groupPhotos.map((p) => (
                  // w-18/h-18 aren't in Tailwind's scale, so these compiled to
                  // nothing and every photo rendered at its full camera
                  // resolution — one attachment pushed the page thousands of
                  // pixels wide. The card is wider than the image so the
                  // caption has somewhere to sit without wrapping to five
                  // lines under an 80px thumbnail.
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setViewing(photoIndex.get(p.id))}
                    aria-label={`View ${fileLabel(p)}, uploaded by ${uploaderLine(p)}`}
                    className="w-32 flex-shrink-0 overflow-hidden rounded border border-border text-left"
                  >
                    <img src={p.file_url} alt="" loading="lazy" className="h-20 w-full object-cover" />
                    <div className="px-1.5 py-1">
                      <div className="truncate text-[11px] font-semibold text-ink">
                        {p.uploaded_by_name || "Unknown"}
                      </div>
                      <div className="truncate text-[10.5px] text-ink-soft">{uploaderRole(p)}</div>
                      {/* fmtDateTimeMY, not toLocaleString — the plant is in
                          Malaysia, and a photo whose stamp reads differently on
                          the supervisor's laptop and the technician's phone is
                          worse than no stamp. */}
                      <div className="truncate text-[10.5px] text-ink-soft">{fmtDateTimeMY(p.uploaded_at)}</div>
                      {/* The date above is the CURRENT picture's, so on a
                          replaced photo it is not when the fault was first
                          photographed. Marked here as well as in the viewer,
                          because the grid is where somebody scanning a work
                          order forms their impression of it. */}
                      {p.replaced_at && (
                        <div className="truncate text-[10.5px] font-semibold text-amber-700">
                          Replaced
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
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
                onClick={() => setViewing(orderedPhotos.length + i)}
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
          replaceable={canReplace(media[viewing], user, wo)}
          onReplace={replace}
          busy={replacingId === media[viewing].id}
        />
      )}
    </div>
  );
}
