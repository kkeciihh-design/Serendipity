import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { atmosphericSvg, fieldnoteSchema, inferLandscape, localFieldnote } from "../lib/landscape-template";
import { destinationGallery, mergeGallery, nextGalleryDestination } from "../lib/destination-gallery";
vi.mock("../lib/settings", () => ({ storedAIConfiguration: vi.fn(async () => null) }));
vi.mock("../lib/ai-adapter", () => ({ completeText: vi.fn() }));
import { storedAIConfiguration } from "../lib/settings";
import { completeText } from "../lib/ai-adapter";
import { findCommonsPhoto, findCommonsPhotos, generateDestination, listCustomGallery, normalizeGalleryFieldnote, readGalleryPhoto, regenerateDestination, removeDestination, updateDestination, findGalleryDestination } from "../lib/gallery-service";

const directories: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.mocked(storedAIConfiguration).mockReset().mockResolvedValue(null); vi.mocked(completeText).mockReset(); await Promise.all(directories.splice(0).map(dir=>rm(dir,{recursive:true,force:true}))); });
async function isolate() { const directory = await mkdtemp(path.join(os.tmpdir(), "serendipity-gallery-")); directories.push(directory); vi.stubEnv("SERENDIPITY_DATA_DIR", directory); return directory; }
const offline = () => vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

describe("landscape templates and local gallery", () => {
  it("skips atmosphere entries during photography rotation, including wraparound", () => {
    const photo = destinationGallery[0], next = destinationGallery[1];
    const atmosphere = { ...photo, id: "atmosphere", photoKind: "atmosphere" as const };
    const places = [atmosphere, photo, atmosphere, next];
    expect(nextGalleryDestination(places, photo.id, true).id).toBe(next.id);
    expect(nextGalleryDestination(places, next.id, true).id).toBe(photo.id);
    expect(nextGalleryDestination(places, photo.id).photoKind).toBe("atmosphere");
    expect(nextGalleryDestination([atmosphere], atmosphere.id, true).id).toBe("jiuzhaigou");
  });
  it("restores built-in photography over legacy atmosphere overrides while keeping drawing edits", () => {
    const base = destinationGallery[0];
    const restored = mergeGallery([], { [base.id]: { photoKind: "atmosphere", photo: { ...base.photo, src: "/api/gallery/old/photo" }, note: "保留的风物志。保留的第二句。" } })[0];
    expect(restored.photo).toBe(base.photo);
    expect(restored.photoKind).toBe("commons");
    expect(restored.note).toContain("保留的风物志");
  });
  it("keeps an existing licensed photograph when regeneration cannot reach Commons", async () => {
    await isolate(); offline();
    const base = destinationGallery[1];
    const refreshed = await regenerateDestination(base.id);
    expect(refreshed.photo).toEqual(base.photo);
    expect(refreshed.photoKind).toBe("commons");
    expect((await findGalleryDestination(base.id))?.photo).toEqual(base.photo);
  });
  it("keeps each mountain's geography, landmark prose and initial composition distinct", () => {
    const notes = ["华山", "黄山", "三清山", "泰山", "长白山"].map((name) => localFieldnote(name));
    expect(notes.map((note) => note.region)).toEqual(["陕西 · 渭南", "安徽 · 黄山", "江西 · 上饶", "山东 · 泰安", "吉林 · 延边"]);
    expect(notes.map((note) => note.visual.scene)).toEqual(["cliff", "peaks", "peaks", "cliff", "tianchi"]);
    expect(new Set(notes.map((note) => note.note)).size).toBe(5);
    expect(new Set(notes.map((note) => note.visual.seed)).size).toBe(5);
    expect(notes[0].note).toContain("苍龙岭"); expect(notes[2].note).toContain("巨蟒出山");
  });
  it("has nine literary fallback families without claiming unknown coordinates", () => {
    const names = ["无名峰岭", "无名绝壁", "无名湖潭", "无名喀斯特", "无名古园", "无名古村", "无名沙漠", "无名海岸", "无名深溪"];
    const notes = names.map((name) => localFieldnote(name));
    expect(new Set(notes.map((note) => note.visual.scene)).size).toBe(9);
    expect(new Set(notes.map((note) => note.note.split("：")[1])).size).toBe(9);
    for (const note of notes) { expect(note.latitude).toBeNull(); expect(note.region).toBe("地区待核实"); expect(note.note).not.toContain("把天光轻轻托起"); }
    expect(localFieldnote("山").latitude).toBeNull();
  });
  it("normalizes incomplete model parameters without discarding its useful fieldnote", () => {
    const local = localFieldnote("华山");
    const normalized = normalizeGalleryFieldnote({ data: { region: "上海", latitude: "31.2", note: "苍龙岭上，风在一线天中回旋。下棋亭外，云从石壁脚下升起。", visual: { palette: "invalid", ridge: "92", scene: "jiangnan" } } }, local);
    expect(normalized.note).toContain("下棋亭"); expect(normalized.visual.ridge).toBe(92);
    expect(normalized.visual.scene).toBe("cliff"); expect(normalized.visual.palette).toBe(local.visual.palette);
    expect(normalized.region).toBe(local.region); expect(normalized.latitude).toBe(local.latitude);
  });
  it("accepts reasoning tags, JSON fences and omitted visual fields from the shared AI parser", async () => {
    await isolate(); offline();
    vi.mocked(storedAIConfiguration).mockResolvedValue({provider:"openai-chat-completions",baseUrl:"https://example.com",apiKey:"test",model:"test",systemPrompt:"",basePrompt:""});
    vi.mocked(completeText).mockResolvedValue({ok:true,content:'<think>核实景区</think>\n```json\n{"region":"江西 · 上饶","note":"巨蟒出山立在云端。女神峰把暮色留在岩壁。","visual":{"palette":"jade"}}\n```'});
    const place = await generateDestination({ name:"三清山",preference:"" });
    expect(place.generation).toBe("ai"); expect(place.note).toContain("女神峰"); expect(place.visual?.scene).toBe("peaks");
    expect(vi.mocked(completeText).mock.calls[0][0]).toMatchObject({ timeoutMs:60_000 });
  });
  it("persists built-in edits separately from their original licensed scene", async () => {
    await isolate();
    const original = destinationGallery[0];
    await updateDestination(original.id, { visual: { ...inferLandscape(original.name), scene:"coast",palette:"gold",celestial:"cloud" } });
    expect((await findGalleryDestination(original.id))?.visual).toMatchObject({scene:"coast",palette:"gold",celestial:"cloud"});
    expect(original.visual?.scene).not.toBe("coast"); expect(await listCustomGallery()).toEqual([]);
  });
  it("filters the full Commons metadata and accepts four wide, geographically related photographs", async () => {
    const page = (index:number, title:string, width=2400, height=1400, description="Mount Hua mountain landscape quality", categories="Mount Hua") => ({index,title:`File:${title}`,imageinfo:[{url:`https://upload.wikimedia.org/${index}.jpg`,width,height,descriptionurl:`https://commons.wikimedia.org/wiki/File:${encodeURIComponent(title)}`,extmetadata:{LicenseShortName:{value:"CC BY-SA 4.0"},LicenseUrl:{value:"https://creativecommons.org/licenses/by-sa/4.0/"},ImageDescription:{value:description},Categories:{value:categories}}}]});
    const pages = [page(1,"Huashan Road Shanghai.jpg"),page(2,"Huashan mountain portrait.jpg",1000,1600),page(3,"Mount Hua tiny.jpg",1200,800),page(4,"Mount Hua car.jpg"),page(5,"Mount Hua hidden.jpg",2400,1400,"Mountain ".repeat(90)+"hospital"),page(6,"Unrelated.jpg",2400,1400,"Alpine landscape","Alps"),page(20,"CNS Mount Hua frigate.jpg"),page(21,"Mount Hua Hotel.jpg"),page(22,"Mount Hua satellite.jpg"),page(23,"Mount Hua.png",2400,1400,"Mount Hua landscape", "SentinelHub|Mount Hua"),...Array.from({length:4},(_,i)=>page(i+7,`Mount Hua panorama ${i}.jpg`))];
    const fetcher = vi.fn().mockResolvedValue(Response.json({query:{pages:Object.fromEntries(pages.map((p,i)=>[i,p]))}})); vi.stubGlobal("fetch",fetcher);
    const photos = await findCommonsPhotos("华山");
    expect(photos).toHaveLength(4); expect(photos.every((photo)=>photo.source.includes("panorama"))).toBe(true);
    const query = new URL(String(fetcher.mock.calls[0][0])).searchParams.get("gsrsearch");
    expect(query).toContain('"Mount Hua"'); expect(query).not.toContain('(\"'); expect(query).not.toContain("-map");
    await findCommonsPhotos("华山",{offset:24}); expect(new URL(String(fetcher.mock.calls.at(-1)?.[0])).searchParams.get("gsroffset")).toBe("24");
  });
  it("ships eight distinct licensed scenes with complete fieldnotes", () => {
    expect(destinationGallery.length).toBeGreaterThanOrEqual(8);
    expect(new Set(destinationGallery.map(p=>p.id)).size).toBe(destinationGallery.length);
    for (const place of destinationGallery) { expect(place.note.split("。").filter(Boolean)).toHaveLength(2); expect(place.prompt).toContain(place.name === "沙溪古镇" ? "沙溪" : place.name === "敦煌月牙泉" ? "月牙泉" : place.name); expect(place.photo.source).toMatch(/^https:\/\/commons.wikimedia.org/); expect(place.coordinates).toMatch(/N.*E/); }
  });
  it("prefers a wide Mount Sanqing photograph over a narrower summit closeup", async () => {
    const page = (index:number,title:string,height:number,categories:string) => ({index,title:`File:${title}`,imageinfo:[{url:`https://upload.wikimedia.org/${index}.jpg`,width:3000,height,descriptionurl:`https://commons.wikimedia.org/wiki/File:${encodeURIComponent(title)}`,extmetadata:{LicenseShortName:{value:"CC BY-SA 3.0"},Categories:{value:categories}}}]});
    const pages = [page(1,"Sanqing Shan summit.jpg",2000,"Mount Sanqing|Yujing summit"),page(2,"19212-SanQingShan.jpg",1734,"Mount Sanqing")];
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(Response.json({query:{pages:Object.fromEntries(pages.map((entry,index)=>[index,entry]))}})));
    const photos = await findCommonsPhotos("三清山",{limit:1});
    expect(photos[0].source).toContain("19212-SanQingShan");
  });
  it("keeps unknown geography honest and rejects executable visual parameters", () => {
    const local = localFieldnote("还未命名的山谷"); expect(local.latitude).toBeNull(); expect(local.region).toContain("待核实");
    expect(fieldnoteSchema.safeParse({...local, visual:{...local.visual,palette:"url(javascript:alert(1))"}}).success).toBe(false);
    expect(fieldnoteSchema.safeParse({...local, latitude:999}).success).toBe(false);
    expect(localFieldnote("长白山天池").latitude).toBeCloseTo(42.006);
  });
  it("renders every atmosphere palette as an actual decodable bitmap", async () => {
    for (const name of ["长白山天池", "敦煌沙山", "沙溪古镇", "苏州拙政园", "漓江", "霞浦"]) {
      const visual=inferLandscape(name); const png=await sharp(Buffer.from(atmosphericSvg(visual))).png().toBuffer(); expect((await sharp(png).metadata()).width).toBe(1920);
    }
  }, 20000);
  it("creates a durable offline scene, serves its photo, and removes only its own assets", async () => {
    const directory=await isolate(); offline();
    const place=await generateDestination({name:"长白山天池",preference:"雪峰"});
    expect(place.generation).toBe("local"); expect(place.photoKind).toBe("atmosphere"); expect(place.photo.alt).toContain("非实景摄影");
    expect((await listCustomGallery())[0]).toEqual(place); expect((await sharp((await readGalleryPhoto(place.id))!).metadata()).format).toBe("webp");
    await expect(removeDestination("../data")).rejects.toThrow(); await expect(removeDestination("jiuzhaigou")).rejects.toThrow();
    await removeDestination(place.id); expect(await readdir(path.join(directory,"gallery"))).toEqual([]);
  });
  it("uses a validated AI fieldnote and uploaded photo without sending the photo to AI", async () => {
    await isolate(); offline();
    vi.mocked(storedAIConfiguration).mockResolvedValue({provider:"openai-chat-completions",baseUrl:"https://example.com",apiKey:"test",model:"test",systemPrompt:"",basePrompt:""});
    vi.mocked(completeText).mockResolvedValue({ok:true,content:JSON.stringify({...localFieldnote("苏州拙政园"),note:"花窗借来一片春色，池水接住午后的光。沿着回廊慢走，把半日留给竹影。"})});
    const photo=await sharp({create:{width:200,height:100,channels:3,background:"#aabbcc"}}).png().toBuffer();
    const place=await generateDestination({name:"苏州拙政园",preference:"",photo:`data:image/png;base64,${photo.toString("base64")}`});
    expect(place.generation).toBe("ai"); expect(place.photoKind).toBe("upload"); expect(fetch).not.toHaveBeenCalled(); expect(JSON.stringify(vi.mocked(completeText).mock.calls)).not.toContain(photo.toString("base64"));
  });
  it("rejects fake uploads and aborts without saving a late result", async () => {
    await isolate(); offline();
    await expect(generateDestination({name:"天池",preference:"",photo:"data:image/svg+xml;base64,AAAA"})).rejects.toThrow();
    await expect(generateDestination({name:"天池",preference:"",photo:"data:image/png;base64,YmFk"})).rejects.toThrow();
    const controller=new AbortController();controller.abort(); await expect(generateDestination({name:"天池",preference:""},controller.signal)).rejects.toThrow(); expect(await listCustomGallery()).toEqual([]);
  });
  it("rejects unlicensed images and non-Commons download targets", async () => {
    for (const [license,url] of [["All rights reserved","https://upload.wikimedia.org/image.jpg"],["CC BY-SA 4.0","http://127.0.0.1/secret"]]) {
      const stub=vi.fn().mockResolvedValue(Response.json({query:{pages:{1:{index:1,imageinfo:[{url,width:1600,height:900,descriptionurl:"https://commons.wikimedia.org/wiki/File:Test",extmetadata:{LicenseShortName:{value:license}}}]}}}}));
      vi.stubGlobal("fetch",stub);expect(await findCommonsPhoto("天池")).toBeNull();expect(stub).toHaveBeenCalledTimes(1);
    }
  });
});
