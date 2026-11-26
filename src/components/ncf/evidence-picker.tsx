"use client";

import { Camera, Paperclip, Video, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const ACCEPT = "image/*,video/mp4,video/quicktime,application/pdf,.docx,.xlsx";

/**
 * Evidence for the draft. On a phone, "Take photo" and "Record video" open the camera directly; "Choose files" picks
 * from the gallery or the computer. Everything picked collects in one list (several camera shots in a row too) and is
 * sent together as `files` with the surrounding form.
 */
export function EvidencePicker() {
  // Each picked file with its preview link (images only), made when the file is added.
  const [items, setItems] = useState<{ file: File; url: string | null }[]>([]);
  const carrier = useRef<HTMLInputElement>(null);

  // The hidden input the form sends always holds exactly the listed files.
  useEffect(() => {
    if (!carrier.current) return;
    const dt = new DataTransfer();
    items.forEach((i) => dt.items.add(i.file));
    carrier.current.files = dt.files;
  }, [items]);

  // The form clears itself after a successful upload: clear the list with it.
  useEffect(() => {
    const form = carrier.current?.form;
    if (!form) return;
    const clear = () => setItems((cur) => { cur.forEach((i) => i.url && URL.revokeObjectURL(i.url)); return []; });
    form.addEventListener("reset", clear);
    return () => form.removeEventListener("reset", clear);
  }, []);

  const add = (list: FileList | null) => {
    if (!list?.length) return;
    const picked = [...list];
    setItems((cur) => [
      ...cur,
      ...picked
        .filter((p) => !cur.some((c) => c.file.name === p.name && c.file.size === p.size && c.file.lastModified === p.lastModified))
        .map((file) => ({ file, url: file.type.startsWith("image/") ? URL.createObjectURL(file) : null })),
    ]);
  };
  const remove = (k: number) => setItems((cur) => {
    const gone = cur[k];
    if (gone?.url) URL.revokeObjectURL(gone.url);
    return cur.filter((_, i) => i !== k);
  });
  const size = (n: number) => (n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  const pick = "btn h-11 flex-1 justify-center md:h-9 md:flex-none";

  return (
    <div className="flex flex-col gap-3">
      <input ref={carrier} type="file" name="files" multiple hidden tabIndex={-1} aria-hidden="true" />
      <div className="flex flex-wrap gap-2">
        {/* Phones and tablets: straight to the camera */}
        <label className={`${pick} hidden cursor-pointer pointer-coarse:inline-flex`}>
          <Camera size={16} aria-hidden="true" /> Take photo
          <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
        </label>
        <label className={`${pick} hidden cursor-pointer pointer-coarse:inline-flex`}>
          <Video size={16} aria-hidden="true" /> Record video
          <input type="file" accept="video/*" capture="environment" className="sr-only" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
        </label>
        <label htmlFor="files" className={`${pick} cursor-pointer`}>
          <Paperclip size={16} aria-hidden="true" /> Choose files
        </label>
        <input id="files" type="file" multiple accept={ACCEPT} className="sr-only" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      </div>
      {items.length > 0 ? (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {items.map(({ file: f, url }, k) => (
            <li key={`${f.name}-${k}`} className="flex items-center gap-2.5 rounded-md border bg-card p-2">
              {url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt="" className="size-11 shrink-0 rounded-sm object-cover" />
              ) : (
                <span className="flex size-11 shrink-0 items-center justify-center rounded-sm bg-muted text-[10px] font-semibold uppercase text-muted-foreground">
                  {f.name.split(".").pop()?.slice(0, 4)}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{f.name}</span>
                <span className="num text-[11px] text-muted-foreground">{size(f.size)}</span>
              </span>
              <button type="button" onClick={() => remove(k)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                aria-label={`Remove ${f.name}`}>
                <X size={15} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12px] text-muted-foreground">No file chosen yet. Photos, videos (up to 50 MB), PDF, Word or Excel.</p>
      )}
    </div>
  );
}
