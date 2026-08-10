"use client";

import { useEffect, useState } from "react";
import { MessageSquare, Send } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { listenComments, addComment } from "../../lib/workOrders";
import { ROLE_LABELS } from "../../lib/roles";
import Button from "../ui/Button";
import { inputClass } from "../ui/Field";
import { ErrorBanner, EmptyState } from "../ui/Surfaces";
import { describeError } from "../../lib/errors";

// Postgres timestamptz arrives as an ISO 8601 string over PostgREST, not as a
// Firebase Timestamp object — so test parseability, not for a .toDate method.
function fmtTime(ts) {
  if (!ts || Number.isNaN(Date.parse(ts))) return "just now";
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Anyone who can read the work order can comment — this is the module's
 * one general-purpose collaboration surface, used equally for a
 * Technician's field notes and a Requester's follow-up question. There
 * is no separate "progress log" anymore; this is intentionally the same
 * `comments` collection every other module shares (see architecture doc).
 */
export default function CommentsPanel({ wo }) {
  const { user } = useAuth();
  const [comments, setComments] = useState(null);
  const [text, setText] = useState("");
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const unsub = listenComments(wo.id, setComments, () => setError("Couldn't load comments."));
    return unsub;
  }, [wo.id]);

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

  return (
    <div>
      <div className="mb-4 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a comment or progress update…"
          className={`${inputClass} min-w-0 flex-1`}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        {/* Post stays on the same row — it's short enough, and this is the one
            control a technician taps repeatedly while working. */}
        <Button variant="amber" icon={Send} onClick={submit} disabled={saving || !text.trim()} className="flex-shrink-0">
          Post
        </Button>
      </div>
      {error && <ErrorBanner message={error} />}
      {comments && comments.length === 0 && (
        <EmptyState>
          <MessageSquare size={18} className="mx-auto mb-2 text-ink-soft opacity-50" />
          No comments yet.
        </EmptyState>
      )}
      <div className="flex flex-col gap-2.5">
        {(comments || []).map((c) => (
          <div key={c.id} className="bg-canvas rounded px-3.5 py-2.5">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[12.5px] font-semibold text-ink">{c.author_name}</span>
              <span className="text-[10.5px] text-ink-soft bg-white border border-border rounded px-1.5 py-0.5">{ROLE_LABELS[c.author_role] || c.author_role}</span>
            </div>
            <div className="text-[13px] text-ink">{c.text}</div>
            <div className="text-[11.5px] text-ink-soft mt-1">
              {fmtTime(c.created_at)}
              {c.edited_at && " (edited)"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
