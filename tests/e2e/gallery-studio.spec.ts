import { test, expect } from "./fixtures";

test("automation keeps a deterministic cover, explicit URLs choose a scene", async ({page})=>{
  await page.clock.install(); await page.goto("/"); await expect(page.getByTestId("home-gallery")).toHaveAttribute("data-destination","jiuzhaigou");
  await page.clock.fastForward(310000); await expect(page.getByTestId("home-gallery")).toHaveAttribute("data-destination","jiuzhaigou");
  await page.goto("/?gallery=dunhuang"); await expect(page.getByTestId("home-gallery")).toHaveAttribute("data-destination","dunhuang");
  await page.clock.fastForward(310000); await expect(page.getByTestId("home-gallery")).toHaveAttribute("data-destination","dunhuang");
});

test("normal browser advances on open, rotates at either interval, and pauses",async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(navigator,"webdriver",{get:()=>false}));
  await page.clock.install(); await page.goto("/"); await expect(page.getByTestId("home-gallery")).toHaveAttribute("data-destination","west-lake");
  await page.getByRole("heading",{level:1}).click();
  await page.clock.fastForward(30010); await expect(page.getByTestId("home-gallery")).toHaveAttribute("data-destination","li-river");
  await page.getByRole("switch",{name:"自动轮换"}).click(); await page.clock.fastForward(60000); await expect(page.getByTestId("home-gallery")).toHaveAttribute("data-destination","li-river");
  await page.reload(); await expect(page.getByTestId("home-gallery")).toHaveAttribute("data-destination","li-river");
  await page.getByRole("switch",{name:"自动轮换"}).click(); await page.getByLabel("轮换间隔").selectOption("300000"); await page.getByRole("heading",{level:1}).click();
  await page.clock.fastForward(30010); await expect(page.getByTestId("home-gallery")).toHaveAttribute("data-destination","li-river");
  await page.clock.fastForward(270010); await expect(page.getByTestId("home-gallery")).toHaveAttribute("data-destination","hongcun");
  await page.reload(); await expect(page.getByTestId("home-gallery")).toHaveAttribute("data-destination","xiapu");
});

test("one-name creation persists both modes, preserves trip input, and deletes cleanly",async({page,request})=>{
  test.setTimeout(90000);
  await page.goto("/"); await page.getByTestId("trip-request-input").fill("保留我正在写的旅行想法");
  await page.getByRole("button",{name:/灵感造景/}).click();
  const dialog=page.getByRole("dialog",{name:"一句向往，自成画境"});
  await expect(page.getByLabel("向往的景点")).toBeFocused();
  await page.getByLabel("向往的景点").fill("长白山天池");
  await page.getByRole("button",{name:"AI 按模板生成画境"}).click();
  await expect(dialog.locator(".studio-result")).toBeVisible({timeout:45000});
  const id=await page.getByTestId("home-gallery").getAttribute("data-destination"); expect(id).toMatch(/^custom-/);
  await expect(dialog.locator(".studio-preview-pair img")).toBeVisible(); await expect(dialog.locator(".studio-preview-pair svg")).toBeVisible();
  await page.getByRole("button",{name:"前往首页欣赏 →"}).click(); await expect(page.getByTestId("trip-request-input")).toHaveValue("保留我正在写的旅行想法");
  await page.getByRole("button",{name:"素描手账模式"}).click(); await expect(page.getByTestId("hero-landscape").locator("svg")).toHaveAttribute("data-landscape-scene",id!);
  await page.reload(); await expect(page.getByTestId("home-gallery")).toHaveAttribute("data-destination",id!);
  await page.getByRole("button",{name:/灵感造景/}).click(); await page.getByRole("button",{name:"移除画境：长白山天池"}).click(); await expect(page.getByRole("button",{name:"移除画境：长白山天池"})).toHaveCount(0);
  expect((await request.get(`/api/gallery/${id}/photo`)).status()).toBe(404);
});

test("mobile studio is keyboard dismissible, input failures are recoverable",async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto("/");
  const trigger=page.getByRole("button",{name:/灵感造景/});await trigger.click();
  await page.getByLabel("向往的景点").fill("苏州拙政园");
  await page.route("**/api/gallery",route=>route.request().method()==="POST"?route.fulfill({status:500,json:{error:"保存失败，请重试"}}):route.continue());
  await page.getByRole("button",{name:"AI 按模板生成画境"}).click();await expect(page.getByRole("dialog").getByRole("alert")).toContainText("保存失败"); await expect(page.getByLabel("向往的景点")).toHaveValue("苏州拙政园");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.keyboard.press("Escape");await expect(page.getByRole("dialog")).toHaveCount(0);await expect(trigger).toBeFocused();
});
