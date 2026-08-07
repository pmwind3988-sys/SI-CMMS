"use client";

import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon, Video } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { listenAttachments, addAttachment } from "../../lib/workOrders";
import { describeError } from "../../lib/errors";
import Button from "../ui/Button";
import { ErrorBanner } from "../ui/Surfaces";

export default function AttachmentsPanel({ wo }) {
  const { user } = useAuth();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const photoInput = useRef(null);
  const videoInput = useRef(null);

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

  return (
    <div className="flex gap-6 flex-wrap">
      {error && <ErrorBanner message={error} />}
      <div className="flex-1 min-w-[260px]">
        <div className="flex items-center justify-between mb-2.5">
          <div className="font-bold text-[13.5px] text-ink">Photos ({photos.length})</div>
          <Button size="sm" variant="ghost" icon={ImageIcon} onClick={() => photoInput.current.click()}>Upload</Button>
          <input ref={photoInput} type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files, "photo")} />
        </div>
        <div className="flex gap-2 flex-wrap">
          {photos.length === 0 && <div className="text-[12.5px] text-ink-soft">No photos uploaded yet.</div>}
          {photos.map((p) => (
            <img key={p.id} src={p.file_url} alt="" className="w-18 h-18 rounded object-cover border border-border" />
          ))}
        </div>
      </div>
      <div className="flex-1 min-w-[260px]">
        <div className="flex items-center justify-between mb-2.5">
          <div className="font-bold text-[13.5px] text-ink">Videos ({videos.length})</div>
          <Button size="sm" variant="ghost" icon={Video} onClick={() => videoInput.current.click()}>Upload</Button>
          <input ref={videoInput} type="file" accept="video/*" multiple hidden onChange={(e) => upload(e.target.files, "video")} />
        </div>
        {videos.length === 0 && <div className="text-[12.5px] text-ink-soft">No videos uploaded yet.</div>}
        <div className="flex flex-col gap-1.5">
          {videos.map((v) => (
            <a key={v.id} href={v.file_url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-[12.5px] bg-canvas rounded px-2.5 py-2">
              <Video size={14} className="text-ink-soft" /> Video attachment
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
