import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LandscapeSketch } from "../app/components/landscape-sketch";
import { inferLandscape, landscapeScenes } from "../lib/landscape-template";

const render = (name: string, overrides = {}) => renderToStaticMarkup(createElement(LandscapeSketch, {
  scene: "preview", name, parameters: { ...inferLandscape(name), ...overrides },
}));

describe("live landscape rendering", () => {
  it("renders all nine front-end compositions and a two-tier waterfall", () => {
    const drawings = landscapeScenes.map((scene) => render("灵感预览", { scene }));
    expect(new Set(drawings).size).toBe(9);
    expect(drawings[8]).toContain('data-landscape-feature="double-waterfall"');
    expect(drawings[1]).toContain("M-70 0H70"); // summit pavilion
  });
  it("keeps named mountains distinct and responds to saved parameter changes", () => {
    const mountains = ["三清山", "黄山", "华山", "长白山天池"].map((name) => render(name));
    expect(new Set(mountains).size).toBe(4);
    expect(mountains[3]).toContain('data-landscape-engine="tianchi"');
    expect(mountains[3]).toContain("#b9d2d8");
    const original = render("黄山");
    for (const override of [{ ridge: 0 }, { seed: 1 }, { palette: "rose" }, { motif: "pagoda" }, { sunX: 500 }, { celestial: "cloud" }]) {
      expect(render("黄山", override)).not.toBe(original);
    }
    expect(render("黄山")).toBe(original);
  });
  it.each(landscapeScenes)("%s responds to saved rendering parameters", (scene) => {
    const parameters = { ...inferLandscape("灵感预览"), scene };
    const original = render("灵感预览", parameters);
    for (const override of [{ seed: 0 }, { ridge: 0 }, { palette: "rose" }, { motif: "boat" }, { sunX: 500 }, { celestial: "cloud" }]) {
      expect(render("灵感预览", { ...parameters, ...override })).not.toBe(original);
    }
  });
  it("keeps paint and clipping references independent across gallery albums", () => {
    const markup = renderToStaticMarkup(createElement("div", {}, ["三清山", "黄山", "华山", "长白山天池"].map((name) => createElement(LandscapeSketch, {
      key: name, scene: "gallery", name, parameters: inferLandscape(name),
    }))));
    const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [, reference] of markup.matchAll(/url\(#([^)]+)\)/g)) expect(ids).toContain(reference);
  });
});
