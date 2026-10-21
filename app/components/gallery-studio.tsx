"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, ImagePlus, Plus, RefreshCw, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { destinationGallery, mergeGallery, type GalleryDestination, type GalleryOverride, type GalleryPhoto } from "@/lib/destination-gallery";
import { inferLandscape, inferSceneArchetype, landscapeCelestials, landscapePaletteIds, landscapePaletteLabels, landscapePalettes, landscapeSceneLabels, landscapeScenes, type LandscapePaletteId, type LandscapeParameters, type LandscapeScene } from "@/lib/landscape-template";
import { LandscapeSketch } from "./landscape-sketch";

export const GALLERY_EVENT = "serendipity:gallery-changed";
type StudioView = "photo" | "sketch" | "dual";
type GalleryPayload = { places?: GalleryDestination[]; overrides?: Record<string, GalleryOverride> };

function isStale(place: GalleryDestination) {
  return !!place.custom && (!place.visual?.scene || /把天光轻轻托起|华山路|华山医院|1914|creative.?park/i.test(`${place.note} ${decodeURI(place.photo.source)}`));
}

function readPhotoFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function GalleryStudio({ places, onApply, onChanged, embedded = false, onOpenChange }: { places: readonly GalleryDestination[]; onApply?: (place: GalleryDestination, mode: "photo" | "sketch") => void; onChanged: () => void; embedded?: boolean; onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false), [name, setName] = useState(""), [preference, setPreference] = useState(""), [photo, setPhoto] = useState<string>(), [photoName, setPhotoName] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [result, setResult] = useState<GalleryDestination | null>(null), [removing, setRemoving] = useState("");
  const [view, setView] = useState<StudioView>("photo");
  const [editing, setEditing] = useState<GalleryDestination | null>(null), [editVisual, setEditVisual] = useState<LandscapeParameters | null>(null);
  const [editPhoto, setEditPhoto] = useState<string>(), [editPhotoName, setEditPhotoName] = useState(""), [selectedCandidate, setSelectedCandidate] = useState<GalleryPhoto | null>(null);
  const [candidates, setCandidates] = useState<GalleryPhoto[]>([]), [candidateBusy, setCandidateBusy] = useState(false), [editorBusy, setEditorBusy] = useState(false);
  const [editorError, setEditorError] = useState(""), [notice, setNotice] = useState(""), [repairing, setRepairing] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null), inputRef = useRef<HTMLInputElement>(null), editorRef = useRef<HTMLElement>(null), controller = useRef<AbortController | null>(null), photoRead = useRef(0), editorPhotoRead = useRef(0), candidateRead = useRef(0), candidateBatch = useRef(0);
  useEffect(() => { if (!open) return; const dialog = dialogRef.current; const opener = document.activeElement as HTMLElement; dialog?.showModal(); inputRef.current?.focus(); return () => { dialog?.close(); opener?.focus(); }; }, [open]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4200);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => { if (open && editing) { editorRef.current?.scrollIntoView({ block: "start" }); editorRef.current?.focus({ preventScroll: true }); } }, [open, editing]);
  const show = (value: boolean) => { if (value) { setResult(null); setEditing(null); setError(""); setNotice(""); } else { candidateRead.current++; editorPhotoRead.current++; setEditing(null); setCandidates([]); } setOpen(value); onOpenChange?.(value); };
  const close = () => { if (editorBusy || repairing) return; controller.current?.abort(); setBusy(false); show(false); };
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key !== "Escape" || busy || editorBusy) return; event.preventDefault(); close(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, busy, editorBusy]);
  async function selectPhoto(file?: File) {
    const version = ++photoRead.current; setError(""); setPhoto(undefined); setPhotoName("");
    if (!file) return;
    if (file.size > 5_000_000 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setError("请选择 5 MB 以内的 JPEG、PNG 或 WebP 照片。"); return; }
    try { const data = await readPhotoFile(file); if (version === photoRead.current) { setPhoto(data); setPhotoName(file.name); } }
    catch { setError("照片读取失败，请重新选择。"); }
  }
  async function selectEditorPhoto(file?: File) {
    const version = ++editorPhotoRead.current;
    setEditorError(""); setEditPhoto(""); setEditPhotoName(""); setSelectedCandidate(null);
    if (!file) return;
    if (file.size > 5_000_000 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setEditorError("请选择 5 MB 以内的 JPEG、PNG 或 WebP 照片。"); return; }
    try { const data = await readPhotoFile(file); if (version === editorPhotoRead.current) { setEditPhoto(data); setEditPhotoName(file.name); } }
    catch { setEditorError("照片读取失败，请重新选择。"); }
  }
  async function generate(event: React.SubmitEvent) {
    event.preventDefault(); if (busy || !name.trim()) return;
    setBusy(true); setError(""); setResult(null); const abort = new AbortController(); controller.current = abort;
    try {
      const response = await fetch("/api/gallery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, preference, photo }), signal: abort.signal });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "画境未能保存，请重试。");
      setResult(data.place); onChanged(); onApply?.(data.place, view === "sketch" ? "sketch" : "photo"); window.dispatchEvent(new Event(GALLERY_EVENT));
    } catch (error) { if (!abort.signal.aborted) setError(error instanceof Error ? error.message : "生成失败，请重试。"); }
    finally { if (!abort.signal.aborted) setBusy(false); }
  }
  async function remove(place: GalleryDestination) {
    if (removing) return; setRemoving(place.id); setError("");
    try { const response = await fetch(`/api/gallery/${place.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" } }); if (!response.ok) throw new Error("移除失败，请稍后重试。"); if (result?.id === place.id) setResult(null); if (editing?.id === place.id) setEditing(null); onChanged(); window.dispatchEvent(new Event(GALLERY_EVENT)); }
    catch (error) { setError(error instanceof Error ? error.message : "移除失败"); } finally { setRemoving(""); }
  }
  function apply(place: GalleryDestination, mode = view === "sketch" ? "sketch" : "photo") {
    if (mode !== "photo" && mode !== "sketch") return;
    if (onApply) onApply(place, mode);
    if (embedded) window.location.assign(`/?gallery=${encodeURIComponent(place.id)}&mode=${mode}`);
    else show(false);
  }
  async function loadCandidates(place: GalleryDestination, refresh = false) {
    const version = ++candidateRead.current; setCandidateBusy(true); setEditorError("");
    if (refresh) candidateBatch.current = (candidateBatch.current + 1) % 12;
    try {
      const response = await fetch(`/api/gallery/${encodeURIComponent(place.id)}/candidates${refresh ? `?refresh=1&offset=${candidateBatch.current * 24}` : ""}`);
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "候选图加载失败");
      if (version === candidateRead.current) {
        if (refresh && !data.candidates?.length) setEditorError("这一批暂无合适实景，已保留当前候选；可再换一批或上传本地照片。");
        else setCandidates((data.candidates ?? []).slice(0, 4));
      }
    } catch (error) { if (version === candidateRead.current) setEditorError(error instanceof Error ? error.message : "候选图加载失败"); }
    finally { if (version === candidateRead.current) setCandidateBusy(false); }
  }
  function openEditor(place: GalleryDestination) {
    if (!open) show(true);
    const visual = place.visual ?? inferLandscape(place.name);
    setEditing(place); setEditVisual({ ...visual, scene: inferSceneArchetype(place.name, visual) }); setEditPhoto(""); setEditPhotoName(""); setSelectedCandidate(null);
    candidateBatch.current = 0; editorPhotoRead.current++;
    setCandidates(place.photoCandidates ?? []); setEditorError(""); setNotice(""); void loadCandidates(place);
  }
  async function saveEditor() {
    if (!editing || !editVisual || editorBusy) return;
    setEditorBusy(true); setEditorError("");
    try {
      const body: { visual: LandscapeParameters; photo?: string; photoCandidate?: GalleryPhoto } = { visual: editVisual };
      if (editPhoto) body.photo = editPhoto;
      else if (selectedCandidate) body.photoCandidate = selectedCandidate;
      const response = await fetch(`/api/gallery/${encodeURIComponent(editing.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "调校未能保存");
      if (result?.id === editing.id) setResult(data.place);
      setEditing(null); setNotice(`已保存「${editing.name}」的画境调校。`); onChanged(); window.dispatchEvent(new Event(GALLERY_EVENT));
    } catch (error) { setEditorError(error instanceof Error ? error.message : "调校未能保存"); }
    finally { setEditorBusy(false); }
  }
  async function repair(place: GalleryDestination) {
    if (repairing) return; setRepairing(place.id); setEditorError(""); setError("");
    try {
      const response = await fetch(`/api/gallery/${encodeURIComponent(place.id)}/refresh`, { method: "POST", headers: { "Content-Type":"application/json" }, body:"{}" });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "重绘失败");
      if (editing?.id === place.id) openEditor(data.place);
      if (result?.id === place.id) setResult(data.place);
      setNotice(data.place.generationNotice || `已重新寻找「${place.name}」的实景与构图。`); onChanged(); window.dispatchEvent(new Event(GALLERY_EVENT));
    } catch (error) { const message = error instanceof Error ? error.message : "重绘失败"; setEditorError(message); setError(message); }
    finally { setRepairing(""); }
  }
  const albums = <div className="gallery-albums">{places.map(place => <article key={place.id} className="gallery-album" data-place={place.name}>
    {view === "dual" ? <div className="gallery-thumbnail gallery-thumbnail-dual"><div className="gallery-dual-grid">
      <button type="button" className="gallery-dual-pane" aria-label={`展示实景画境：${place.name}`} onClick={()=>apply(place, "photo")}><Image src={place.photo.src} alt={place.photo.alt} fill unoptimized sizes="200px"/><span>📷 {place.name}</span></button>
      <button type="button" className="gallery-dual-pane" aria-label={`展示素描画境：${place.name}`} onClick={()=>apply(place, "sketch")}><LandscapeSketch scene={place.id} parameters={place.visual} name={place.name} fit="meet"/><span>✒️ {place.name}</span></button>
    </div></div> :
    <button type="button" className={`gallery-thumbnail gallery-thumbnail-${view}`} aria-label={`展示画境：${place.name}`} onClick={() => apply(place)}>
      {view === "photo" && <Image src={place.photo.src} alt={place.photo.alt} fill unoptimized sizes="220px" />}
      {view === "sketch" && <LandscapeSketch scene={place.id} parameters={place.visual} name={place.name} fit="meet" />}
      <span>{place.name}<ArrowUpRight size={12} /></span>
    </button>}
    <div><span>{place.custom ? "自定义" : place.region}{isStale(place) && <em className="gallery-stale">待修</em>}</span><span className="gallery-album-actions">
      <button type="button" className="gallery-tune" aria-label={`调校画境：${place.name}`} onClick={() => openEditor(place)}><SlidersHorizontal size={11} />调校画境</button>
      {place.custom && <button type="button" disabled={!!removing} aria-label={`移除画境：${place.name}`} onClick={() => void remove(place)}><X size={11}/>{removing === place.id ? "移除中" : "移除"}</button>}
    </span></div>
  </article>)}</div>;
  const viewbar = <div className="studio-gallery-toolbar"><div className="studio-view-switch" role="group" aria-label="画廊视图">
    {(["photo", "sketch", "dual"] as const).map(item => <button key={item} type="button" aria-pressed={view === item} onClick={() => setView(item)}>{item === "photo" ? "📷 管理实景" : item === "sketch" ? "✒️ 管理素描" : "🌓 双生并列"}</button>)}
  </div><span>{view === "dual" ? "点选左侧实景或右侧素描应用到首页" : `点击画境应用到首页 · ${view === "sketch" ? "应用素描" : "应用实景"}`}</span></div>;
  return <>
    {embedded ? <section id="gallery" className="settings-gallery dashboard-card"><div className="gallery-section-heading"><div><p className="studio-eyebrow">THE LANDSCAPE COLLECTION</p><h2>山河壁纸画廊</h2><p>{places.length} 幅双生画境 · 实景与东方素描</p></div><button className="studio-primary" onClick={() => show(true)}><Plus size={14}/>灵感造景</button></div>{notice && <p className="gallery-notice" role="status">{notice}</p>}{error && <p role="alert">{error}</p>}{viewbar}{albums}<p className="gallery-storage-note">自定义画境和照片保存在本机画廊；旅行 JSON 备份不包含画廊。</p></section> : <button type="button" className="home-next-landscape home-studio-trigger" aria-label="灵感造景：一句向往，自成画境" title="灵感造景" onClick={() => show(true)}><Plus size={13}/>造景</button>}
    {open && <dialog ref={dialogRef} className="gallery-studio-mask fixed inset-0 z-50 m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden bg-transparent p-0" aria-labelledby="gallery-studio-title" onCancel={event => { event.preventDefault(); if (!busy && !editorBusy) close(); }}
      onClick={event => { if (event.target === event.currentTarget && !busy && !editorBusy) close(); }}>
      <div className="gallery-studio" onClick={event => event.stopPropagation()}>
      <div className="studio-scroll">
      <header className="studio-header"><div><p className="studio-eyebrow">A PLACE IN YOUR IMAGINATION</p><h2 id="gallery-studio-title">一句向往，自成画境</h2><p>写下一个名字，让山河在眼前展开。</p></div><button type="button" onClick={close} aria-label="关闭灵感造景"><X size={19}/></button></header>
      <div className="studio-body">{!result && !editing && <form onSubmit={generate}>
        <label className="studio-label" htmlFor="landscape-name">向往的景点<span>只需一个名字</span></label><input ref={inputRef} id="landscape-name" required maxLength={60} placeholder="例如：长白山天池、苏州拙政园" value={name} disabled={busy} onChange={e=>setName(e.target.value)}/>
        <label className="studio-label" htmlFor="landscape-preference">一句偏好<span>可选</span></label><input id="landscape-preference" maxLength={240} placeholder="清晨薄雾、秋日暖阳，或你喜欢的颜色" value={preference} disabled={busy} onChange={e=>setPreference(e.target.value)}/>
        <label className="studio-upload"><ImagePlus size={18}/><span>{photoName || "带上自己的一张照片"}<small>可选 · JPEG / PNG / WebP · 5 MB 以内</small></span><input aria-label="上传画境照片" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e=>void selectPhoto(e.target.files?.[0])}/></label>
        {photo && <button type="button" className="studio-text-button" disabled={busy} onClick={()=>{ photoRead.current++; setPhoto(undefined); setPhotoName(""); }}>移除所选照片</button>}
        <button className="studio-generate bg-[#1B362A] text-white hover:bg-[#12261D] disabled:bg-[#1B362A] disabled:text-white/75" type="submit" disabled={busy || !name.trim()}><Sparkles size={16}/>{busy ? "正在写风物志、寻找光与山…" : "AI 按模板生成画境"}</button>
        <p className="studio-footnote">文案 · 图片匹配 · 东方素描，一次完成。服务不可用时自动采用本地模板与光影意象。</p>
      </form>}
      <div aria-live="polite">{error && <p role="alert" className="studio-error">{error}</p>}{notice && <p className="gallery-notice" role="status">{notice}</p>}{result && <section className="studio-result"><p className="studio-eyebrow">已收藏 · {result.generation === "ai" ? "AI 风物志" : "本地风物志"} · {result.photoKind === "atmosphere" ? "光影意象（非实拍）" : result.photoKind === "upload" ? "本地照片" : "Commons 匹配摄影"}</p>{result.generationNotice && <p className="studio-footnote">{result.generationNotice}</p>}<h3>{result.name}<span>{result.region} · {result.season}</span></h3><p>{result.note}</p><div className="studio-preview-pair"><figure><div><Image src={result.photo.src} alt={result.photo.alt} fill unoptimized sizes="340px" /></div><figcaption>{result.photoKind === "atmosphere" ? "光影意象" : "实景画卷"}</figcaption></figure><figure><div><LandscapeSketch scene={result.id} parameters={result.visual} name={result.name}/></div><figcaption>东方素描</figcaption></figure></div><button className="studio-text-button" type="button" onClick={()=>{ onApply?.(result, "photo"); if (embedded) window.location.assign(`/?gallery=${result.id}&mode=photo`); else close(); }}>前往首页欣赏 →</button></section>}</div>
      {result && !editing && <button className="studio-text-button" type="button" onClick={()=>openEditor(result)}><SlidersHorizontal size={14}/>调校画境</button>}
      {editing && editVisual && <section ref={editorRef} tabIndex={-1} className="studio-editor" aria-label={`调校画境：${editing.name}`}>
        <div className="studio-editor-head"><div><p className="studio-eyebrow">FINE-TUNE THE LANDSCAPE</p><h3>调校「{editing.name}」</h3><p>选择画境、色板与天象，或更换一张真实的候选照片。</p></div><button type="button" aria-label="关闭调校" disabled={editorBusy || !!repairing} onClick={()=>{ candidateRead.current++; editorPhotoRead.current++; setEditing(null); }}><X size={17}/></button></div>
        {editorError && <p role="alert" className="studio-error">{editorError}</p>}
        <div className="studio-editor-preview">
          <figure><div>{(editPhoto || selectedCandidate || editing.photo) ? <img src={editPhoto || selectedCandidate?.thumb || selectedCandidate?.src || editing.photo.src} alt={selectedCandidate?.alt ?? editing.photo.alt} /> : null}</div><figcaption>{editPhoto ? `本地照片 · ${editPhotoName}` : selectedCandidate ? "新选实景" : "当前实景"}</figcaption></figure>
          <figure><div><LandscapeSketch scene={editing.id} parameters={editVisual} name={editing.name}/></div><figcaption>东方素描</figcaption></figure>
        </div>
        <div className="studio-editor-fields">
          <fieldset><legend>画境</legend><div className="studio-chips">{landscapeScenes.map(scene => <button key={scene} type="button" aria-pressed={(editVisual.scene ?? editing.visual?.scene) === scene} onClick={()=>setEditVisual(current=>current ? { ...current, scene: scene as LandscapeScene } : current)}>{landscapeSceneLabels[scene]}</button>)}</div></fieldset>
          <fieldset><legend>色板</legend><div className="studio-chips">{landscapePaletteIds.map(palette => <button key={palette} type="button" aria-pressed={editVisual.palette === palette} onClick={()=>setEditVisual(current=>current ? { ...current, palette: palette as LandscapePaletteId } : current)}><i style={{background: landscapePalettes[palette].wash}} />{landscapePaletteLabels[palette]}</button>)}</div></fieldset>
          <fieldset><legend>天象</legend><div className="studio-chips">{landscapeCelestials.map(celestial => <button key={celestial} type="button" aria-pressed={editVisual.celestial === celestial} onClick={()=>setEditVisual(current=>current ? { ...current, celestial } : current)}>{celestial === "sun" ? "朝日" : celestial === "moon" ? "皓月" : "云岚"}</button>)}</div></fieldset>
        </div>
        <div className="studio-candidate-head"><div><strong>实景候选</strong><span>Commons 横版风光 · 最多四张</span></div><button type="button" disabled={candidateBusy} onClick={()=>void loadCandidates(editing, true)}><RefreshCw size={12} className={candidateBusy ? "is-spinning" : ""}/>{candidateBusy ? "寻找中" : "换一批"}</button></div>
        <div className="studio-candidates">{candidates.map(candidate => <button key={candidate.src} type="button" className={selectedCandidate?.src === candidate.src ? "is-selected" : ""} aria-label={`选择候选图：${candidate.alt ?? editing.name}`} aria-pressed={selectedCandidate?.src === candidate.src} onClick={()=>{ setSelectedCandidate(candidate); setEditPhoto(""); setEditPhotoName(""); }}><img src={candidate.thumb ?? candidate.src} alt={candidate.alt ?? `${editing.name} 候选实景`} />{selectedCandidate?.src === candidate.src && <Check size={15}/>}<span>{candidate.author}</span></button>)}{!candidates.length && <p>{candidateBusy ? "正在寻找合适的实景…" : "暂无可用的实景候选，可保留当前照片或上传本地照片。"}</p>}</div>
        <div className="studio-editor-actions">
          <label className="studio-upload studio-upload-compact"><ImagePlus size={16}/><span>{editPhotoName || "上传本地照片"}<small>JPEG / PNG / WebP · 5 MB 以内</small></span><input aria-label="上传调校照片" type="file" accept="image/jpeg,image/png,image/webp" disabled={editorBusy} onChange={e=>void selectEditorPhoto(e.target.files?.[0])}/></label>
          <button type="button" className="studio-text-button" disabled={editorBusy || !!repairing} onClick={()=>void repair(editing)}><RefreshCw size={12} className={repairing === editing.id ? "is-spinning" : ""}/>{repairing === editing.id ? "重新生成中…" : "重新生成实景与风物志"}</button>
          <button type="button" className="studio-primary" disabled={editorBusy || !!repairing} onClick={()=>void saveEditor()}>{editorBusy ? "保存中…" : "保存调校"}</button>
        </div>
      </section>}
      <details className="studio-collection" open={!result && !editing}><summary>翻阅山河画廊 <span>{places.length} 幅</span></summary>{viewbar}{albums}</details></div>
      </div>
      </div>
    </dialog>}
  </>;
}

export function SettingsGallery() {
  const [places, setPlaces] = useState<readonly GalleryDestination[]>(destinationGallery);
  const refresh = () => { void fetch("/api/gallery").then(r=>r.ok ? r.json() : null).then((data: GalleryPayload | null)=>{ if(data?.places) setPlaces(mergeGallery(data.places, data.overrides)); }).catch(()=>{}); };
  useEffect(()=>{ refresh(); window.addEventListener(GALLERY_EVENT, refresh); return ()=>window.removeEventListener(GALLERY_EVENT, refresh); }, []);
  return <GalleryStudio places={places} onChanged={refresh} embedded/>;
}
