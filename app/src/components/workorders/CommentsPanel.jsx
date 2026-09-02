"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare, Send, ImagePlus, Loader2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { listenComments, addComment, listenAttachments, addAttachment } from "../../lib/workOrders";
import { ROLE_LABELS } from "../../lib/roles";
import { fmtTimeMY, fmtDateLongMY, isoDateMY } from "../../lib/datetime";
import Button from "../ui/Button";
import { inputClass } from "../ui/Field";
import { ErrorBanner, EmptyState } from "../ui/Surfaces";
import { describeError } from "../../lib/errors";
import { AttachmentViewer } from "./AttachmentsPanel";

/**
 * Where this viewer's "I have read up to here" mark lives.
 *
 * localStorage, not a table. There is no read-receipt anywhere in this schema
 * and adding one would mean a row per person per work order per read — the
 * fastest-growing table in a database whose `notifications` table already has
 * no retention. An unread count is a per-person convenience, not a fact about
 * the work order, so it belongs on the device that is doing the reading.
 *
 * Keyed on the viewer's uid as well as the work order, for the reason
 * lib/draftRecovery.js keys drafts that way: a shared workshop terminal has
 * more than one person signing into it, and the second one must not inherit the
 * first one's read state.
 *
 * Every access is wrapped — Safari in private mode throws on the accessor
 * itself, and an unread badge is not worth taking a page down for.
 */
const seenKey = (uid, woId) => `si.chat.seen.${uid}.${woId}`;

function readSeen(uid, woId) {
  try {
    return window.localStorage.getItem(seenKey(uid, woId));
  } catch {
    return null;
  }
}

function writeSeen(uid, woId, iso) {
  try {
    window.localStorage.setItem(seenKey(uid, woId), iso);
  } catch {
    /* no-op: read state is a convenience, never a correctness requirement */
  }
}

/**
 * The work order's conversation — comments and photos in one thread.
 *
 * Two changes from the flat list this replaced, and the second is the reason
 * for the first.
 *
 * **Chat layout.** These are messages between a requester standing at a broken
 * machine and a technician who has to find it, and they were rendered as a
 * uniform stack of grey cards where your own note looked exactly like somebody
 * else's. Own messages now sit right in navy, everyone else's left in grey, so
 * "who said that" is answered by position before anything is read.
 *
 * **Photos are messages too.** They were behind a separate tab, which meant the
 * picture of the fault and the sentence describing it were never on screen
 * together — and on a phone the tab strip is a scrolling row where Attachments
 * starts off-screen. `attachments` and `comments` are different tables with
 * different timestamps, so they are merged here by time rather than joined: one
 * ascending thread, a photo appearing exactly where it was taken in the
 * conversation. The Photos tab keeps the phase-grouped gallery and the
 * replace flow (0039, 0043) — this is an additional reading of the same rows,
 * not a replacement for it.
 *
 * Attachments arrive newest-first with one-hour signed URLs minted by
 * listenAttachments; the sort below puts them back in conversation order.
 *
 * `active` says whether the Conversation tab is the one on screen, and
 * `onUnread` reports the count up to the tab strip that draws the badge.
 *
 * The count is computed HERE rather than in WorkOrderDetail because this is
 * where the two listeners already are — lifting them up would open the same
 * two subscriptions a level higher and make the tab strip responsible for
 * merging comments and attachments, which is this component's job.
 */
export default function CommentsPanel({ wo, active = true, onUnread }) {
  const { user } = useAuth();
  const [comments, setComments] = useState(null);
  const [files, setFiles] = useState(null);
  const [text, setText] = useState("");
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [viewingId, setViewingId] = useState(null);
  const photoInput = useRef(null);
  const endRef = useRef(null);

  useEffect(() => {
    const unsub = listenComments(wo.id, setComments, () => setError("Couldn't load comments."));
    return unsub;
  }, [wo.id]);

  useEffect(() => {
    // Failing to load photos must not take the conversation down with it: the
    // thread is still readable and postable without them, so this sets its own
    // notice rather than the shared error banner.
    const unsub = listenAttachments(wo.id, setFiles, () =>
      setError("Couldn't load the photos in this thread.")
    );
    return unsub;
  }, [wo.id]);

  /**
   * One thread, oldest first.
   *
   * Ascending, unlike the old list and unlike both queries: a conversation is
   * read downwards, and the composer sits under the last thing said. Keyed on
   * table + id, because a comment and an attachment can share neither table nor
   * meaning but could share a uuid.
   */
  const thread = useMemo(() => {
    const msgs = (comments || []).map((c) => ({
      kind: "comment",
      key: "c:" + c.id,
      at: c.created_at,
      authorId: c.author_id,
      authorName: c.author_name,
      authorRole: c.author_role,
      text: c.text,
      editedAt: c.edited_at,
    }));
    const pics = (files || []).map((a) => ({
      kind: "attachment",
      key: "a:" + a.id,
      at: a.uploaded_at,
      authorId: a.uploaded_by_id,
      authorName: a.uploaded_by_name,
      authorRole: a.uploaded_by_role,
      attachment: a,
    }));
    return [...msgs, ...pics].sort((x, y) => Date.parse(x.at || 0) - Date.parse(y.at || 0));
  }, [comments, files]);

  /* The viewer walks the photos in the thread, in thread order, so the arrow
     keys move through the conversation rather than through whatever order the
     query returned. Same discipline as `orderedPhotos` in the Photos tab. */
  const threadPhotos = thread
    .filter((m) => m.kind === "attachment" && m.attachment.file_type === "photo")
    .map((m) => m.attachment);
  const viewingIndex = threadPhotos.findIndex((p) => p.id === viewingId);

  const loading = comments === null;

  /* ---------------------------------------------------------------- *
   * Unread
   * ---------------------------------------------------------------- */
  const [seenAt, setSeenAt] = useState(() => (user?.uid ? readSeen(user.uid, wo.id) : null));
  const newestAt = thread.length ? thread[thread.length - 1].at : null;

  /**
   * Your own messages never count. Nothing else does either while the tab is
   * on screen — you are looking at it, so there is nothing to tell you about,
   * and a badge over a thread you are reading is just noise.
   */
  const unread = active
    ? 0
    : thread.filter(
        (m) =>
          m.authorId !== user?.uid &&
          Date.parse(m.at || 0) > Date.parse(seenAt || 0)
      ).length;

  // Reading the tab is what marks it read — including messages that arrive
  // while it is already open, which is why this watches `newestAt` too.
  useEffect(() => {
    if (!active || !newestAt || !user?.uid) return;
    if (seenAt && Date.parse(seenAt) >= Date.parse(newestAt)) return;
    setSeenAt(newestAt);
    writeSeen(user.uid, wo.id, newestAt);
  }, [active, newestAt, seenAt, user?.uid, wo.id]);

  useEffect(() => {
    onUnread?.(unread);
  }, [unread, onUnread]);

  /* Scroll to the newest message when one arrives — but only within the thread,
     never the page. `block: "nearest"` is what keeps a new comment from yanking
     the whole detail view down past the tab strip. */
  useEffect(() => {
    if (!loading) endRef.current?.scrollIntoView({ block: "nearest" });
  }, [thread.length, loading]);

  async function submit() {
    if (!text.trim()) return;
    setSaving(true);
    setError(null);
    const draft = text;
    try {
      await addComment(wo.id, { uid: user.uid, name: user.name, role: user.role }, draft.trim());
      setText("");
    } catch (e) {
      setError(describeError(e, "Couldn't post that comment — try again."));
      // draft intentionally left in the input, not cleared
    } finally {
      setSaving(false);
    }
  }

  async function attach(picked) {
    if (!picked?.length) return;
    setUploading(true);
    setError(null);
    try {
      const actor = { uid: user.uid, name: user.name, role: user.role };
      // addAttachment compresses before it uploads, so the original never
      // reaches storage — see the note there. Photos only, matching the Photos
      // tab and migration 0036, which took video off the bucket allowlist.
      await Promise.all(Array.from(picked).map((f) => addAttachment(wo.id, actor, f, "photo")));
    } catch (e) {
      setError(describeError(e, "Couldn't attach that photo — try again."));
    } finally {
      setUploading(false);
      // Clearing the input is what lets the same file be picked twice running.
      if (photoInput.current) photoInput.current.value = "";
    }
  }

  return (
    <div>
      {error && <ErrorBanner message={error} />}

      {loading && <div className="text-[12.5px] text-ink-soft">Loading conversation…</div>}

      {!loading && thread.length === 0 && (
        <EmptyState>
          <MessageSquare size={18} className="mx-auto mb-2 text-ink-soft opacity-50" />
          Nothing here yet. Post an update or attach a photo.
        </EmptyState>
      )}

      {/* Capped and scrollable so a long thread does not push the composer off
          the bottom of the page — the one control a technician uses repeatedly
          has to stay reachable without scrolling back. */}
      <div className="mb-3 flex max-h-[60vh] flex-col gap-1 overflow-y-auto scroll-touch">
        {thread.map((m, i) => {
          const mine = m.authorId && m.authorId === user?.uid;
          const prev = thread[i - 1];
          /* A date divider whenever the day changes, and only then. Times alone
             are ambiguous on a job that ran over a shutdown week. */
          const newDay = !prev || isoDateMY(prev.at) !== isoDateMY(m.at);
          /* Consecutive messages from the same person on the same day drop the
             name — a run of four notes from one technician does not need their
             name four times, and the alignment already says who it is. */
          const sameRun = !newDay && prev && prev.authorId === m.authorId;

          return (
            <div key={m.key}>
              {newDay && (
                <div className="my-2.5 flex items-center gap-2">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-soft">
                    {fmtDateLongMY(m.at)}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
              )}
              <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`min-w-0 max-w-[86%] sm:max-w-[78%] ${mine ? "items-end" : "items-start"}`}>
                  {!sameRun && (
                    <div
                      className={`mb-1 flex items-center gap-1.5 ${mine ? "justify-end" : "justify-start"}`}
                    >
                      <span className="text-[11.5px] font-semibold text-ink">
                        {mine ? "You" : m.authorName || "Someone"}
                      </span>
                      {!mine && (
                        <span className="rounded border border-border bg-white px-1.5 py-0.5 text-[10px] text-ink-soft">
                          {ROLE_LABELS[m.authorRole] || m.authorRole}
                        </span>
                      )}
                    </div>
                  )}

                  {m.kind === "comment" ? (
                    <div
                      className={`rounded-lg px-3 py-2 text-[13px] leading-relaxed ${
                        mine ? "bg-navy text-white" : "bg-canvas text-ink"
                      }`}
                      style={{ borderRadius: mine ? "10px 10px 2px 10px" : "10px 10px 10px 2px" }}
                    >
                      <span className="whitespace-pre-wrap break-words">{m.text}</span>
                    </div>
                  ) : (
                    <PhotoBubble
                      attachment={m.attachment}
                      mine={mine}
                      onOpen={() => setViewingId(m.attachment.id)}
                    />
                  )}

                  <div
                    className={`mt-0.5 text-[10.5px] text-ink-soft ${mine ? "text-right" : "text-left"}`}
                  >
                    {fmtTimeMY(m.at)}
                    {m.editedAt && " · edited"}
                    {m.kind === "attachment" && m.attachment.replaced_at && " · replaced"}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {/* Composer last, under the thread it is adding to. */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          icon={ImagePlus}
          loading={uploading}
          onClick={() => photoInput.current?.click()}
          className="flex-shrink-0"
          aria-label="Attach a photo"
        >
          <span className="hidden sm:inline">{uploading ? "Attaching…" : "Photo"}</span>
        </Button>
        <input
          ref={photoInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => attach(e.target.files)}
        />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message…"
          className={`${inputClass} min-w-0 flex-1`}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <Button
          variant="amber"
          icon={Send}
          loading={saving}
          onClick={submit}
          disabled={!text.trim()}
          className="flex-shrink-0"
        >
          <span className="hidden sm:inline">Post</span>
        </Button>
      </div>

      {viewingIndex >= 0 && (
        <AttachmentViewer
          items={threadPhotos}
          index={viewingIndex}
          onIndex={(i) => setViewingId(threadPhotos[i]?.id ?? null)}
          onClose={() => setViewingId(null)}
          /* Read-only here on purpose — see the note on AttachmentViewer.
             A boolean, not a predicate: the viewer tests `replaceable &&`, so
             `() => false` would be truthy and would put a live Replace control
             on every photo in the thread. */
          replaceable={false}
          onReplace={() => {}}
          busy={null}
        />
      )}
    </div>
  );
}

/**
 * A photo as a chat bubble.
 *
 * A button, not a div with a handler, so it is reachable by keyboard and
 * announces itself — the thumbnail is the only way into the full-size viewer
 * from here. `loading="lazy"` matters on a job with thirty pictures: each one
 * is a separate signed-URL fetch.
 */
function PhotoBubble({ attachment, mine, onOpen }) {
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block overflow-hidden rounded-lg border"
      style={{
        borderColor: mine ? "#2C5AA8" : "#E5E9F0",
        borderRadius: mine ? "10px 10px 2px 10px" : "10px 10px 10px 2px",
      }}
      aria-label={`Open photo from ${attachment.uploaded_by_name || "the thread"}`}
    >
      {failed ? (
        <span className="block px-3 py-2 text-[12px] text-ink-soft">
          Photo unavailable — its link may have expired. Reload the page.
        </span>
      ) : (
        <img
          src={attachment.file_url}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="block max-h-56 w-auto max-w-full object-cover"
        />
      )}
    </button>
  );
}
