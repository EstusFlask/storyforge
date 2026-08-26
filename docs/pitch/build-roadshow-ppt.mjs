import fs from "node:fs/promises";
import path from "node:path";
import console from "node:console";
import process from "node:process";
import { fileURLToPath } from "node:url";
const artifactToolModule = process.env.ARTIFACT_TOOL_MODULE || "@oai/artifact-tool";
const { Presentation, PresentationFile } = await import(artifactToolModule);

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const outDir = "/tmp/storyforge-ppt-render-v3";
const outPptx = path.join(here, "StoryForge-OPC-Roadshow-Backup.pptx");
await fs.mkdir(outDir, { recursive: true });

const C = {
  paper: "#F5F0E7", paper2: "#EDE5D8", ink: "#211F1B", muted: "#716B61",
  rust: "#A45137", rust2: "#C67856", pine: "#253A35", pine2: "#3F5A51",
  gold: "#D7A452", line: "#D9D0C2", white: "#FFFDFA", paleGreen: "#E4E9E5",
};
const serif = "Songti SC";
const sans = "PingFang SC";
const mono = "Menlo";
const totalSlides = 15;
const pres = Presentation.create({ slideSize: { width: 1280, height: 720 } });

const assets = {
  world: new Uint8Array(await fs.readFile(path.join(here, "assets/world-engine.png"))),
  longform: new Uint8Array(await fs.readFile(path.join(root, "docs/assets/feature-guide/demo-chapter-editor-filled-toolbar.png"))),
  node: new Uint8Array(await fs.readFile(path.join(here, "assets/node-authoring.png"))),
  ttrpg: new Uint8Array(await fs.readFile(path.join(here, "assets/ttrpg.png"))),
  chat: new Uint8Array(await fs.readFile(path.join(here, "assets/character-chat.png"))),
  game: new Uint8Array(await fs.readFile(path.join(here, "assets/text-game-current.png"))),
};

function addShape(slide, geometry, x, y, w, h, fill = "none", lineFill = "none", radius = undefined) {
  return slide.shapes.add({
    geometry,
    position: { left: x, top: y, width: w, height: h },
    fill,
    line: { style: "solid", fill: lineFill, width: lineFill === "none" ? 0 : 1 },
    ...(radius ? { borderRadius: radius } : {}),
  });
}
function text(slide, value, x, y, w, h, opts = {}) {
  const s = addShape(slide, "textbox", x, y, w, h, opts.fill ?? "none", opts.line ?? "none");
  s.text = value;
  s.text.style = {
    fontSize: opts.size ?? 20,
    color: opts.color ?? C.ink,
    bold: opts.bold ?? false,
    typeface: opts.typeface ?? sans,
    alignment: opts.align ?? "left",
    verticalAlignment: opts.valign ?? "top",
    lineSpacing: opts.lineSpacing ?? 1.1,
    autoFit: opts.autoFit ?? "shrinkText",
    insets: opts.insets ?? { top: 0, right: 0, bottom: 0, left: 0 },
  };
  return s;
}
function box(slide, x, y, w, h, fill = C.white, radius = "rounded-xl", line = C.line) {
  const s = addShape(slide, "roundRect", x, y, w, h, fill, line, radius);
  s.shadow = "shadow-sm";
  return s;
}
function tag(slide, value, x, y, w, kind = "rust") {
  const bg = kind === "now" ? C.paleGreen : kind === "future" ? "#F4E7CC" : "#F0DDD5";
  const color = kind === "now" ? C.pine : kind === "future" ? "#8B6221" : C.rust;
  addShape(slide, "roundRect", x, y, w, 28, bg, "none", "rounded-full");
  text(slide, value, x + 8, y + 6, w - 16, 18, { size: 11, color, bold: true, align: "center", typeface: sans });
}
const chapterLabels = ["01 项目主题", "02 核心路径", "03 衍生产品", "04 市场需求", "05 未来愿景"];
function chapterForPage(page) {
  if (page <= 2) return 0;
  if (page <= 4) return 1;
  if (page <= 9) return 2;
  if (page <= 11) return 3;
  return 4;
}
function addChapterRail(slide, page, dark = false) {
  const current = chapterForPage(page), gap = 14, width = (1148 - gap * 4) / 5;
  chapterLabels.forEach((label, i) => {
    const x = 66 + i * (width + gap);
    addShape(slide, "rect", x, 15, width, 2, i < current ? (dark ? C.gold : C.pine) : i === current ? (dark ? C.gold : C.rust) : (dark ? "#556861" : "#D9D0C2"), "none");
    text(slide, label, x, 21, width, 14, { size: 8, color: i === current ? (dark ? C.gold : C.rust) : i < current ? (dark ? "#BDC8C3" : "#766E63") : (dark ? "#82948D" : "#A49A8C"), bold: true, typeface: mono });
  });
}
function baseSlide(page, kicker, titleText, opts = {}) {
  const slide = pres.slides.add();
  slide.background.fill = opts.dark ? C.pine : C.paper;
  if (!opts.dark) {
    addShape(slide, "ellipse", 1060, 0, 220, 160, "#E8DED0", "none");
    addShape(slide, "ellipse", 1130, 0, 150, 100, C.paper, "#E2D6C7");
  }
  addChapterRail(slide, page, opts.dark ?? false);
  text(slide, kicker, 66, 44, 760, 22, { size: 11, color: opts.dark ? C.gold : C.rust, bold: true, typeface: mono });
  text(slide, String(page).padStart(2, "0") + " / " + totalSlides, 1140, 46, 74, 18, { size: 10, color: opts.dark ? "#CAD4D0" : "#9B9183", bold: true, typeface: mono, align: "right" });
  if (titleText) text(slide, titleText, 66, 76, 1090, 82, { size: opts.titleSize ?? 39, color: opts.dark ? C.white : C.ink, bold: true, typeface: serif, lineSpacing: 1.02 });
  return slide;
}
function addScreenshot(slide, bytes, x, y, w, h, crop = undefined) {
  addShape(slide, "roundRect", x - 5, y - 5, w + 10, h + 10, C.white, C.line, "rounded-xl");
  slide.images.add({ blob: bytes, contentType: "image/png", alt: "StoryForge product screenshot", fit: "contain", position: { left: x, top: y, width: w, height: h }, geometry: "roundRect", borderRadius: "rounded-lg", ...(crop ? { crop } : {}) });
  addShape(slide, "roundRect", x + w - 126, y + 12, 112, 24, "#35312DE5", "none", "rounded-full");
  text(slide, "ACTUAL PRODUCT", x + w - 120, y + 18, 100, 12, { size: 8, color: C.white, bold: true, typeface: mono, align: "center" });
}
function bullet(slide, n, value, x, y, w, opts = {}) {
  addShape(slide, "ellipse", x, y + 2, 20, 20, opts.dark ? "#FFFFFF12" : "#F4E4DD", opts.dark ? "#FFFFFF55" : "#D9B1A3");
  text(slide, String(n), x, y + 6, 20, 11, { size: 9, color: opts.dark ? C.gold : C.rust, bold: true, typeface: serif, align: "center" });
  text(slide, value, x + 31, y, w - 31, 38, { size: opts.size ?? 14, color: opts.dark ? "#E2E8E5" : C.ink, typeface: sans, lineSpacing: 1.15 });
}
function userStory(slide, value) {
  addShape(slide, "rect", 66, 658, 1148, 1, C.line, "none");
  text(slide, "USER STORY", 66, 674, 100, 16, { size: 9, color: C.rust, bold: true, typeface: mono });
  text(slide, value, 175, 670, 1035, 24, { size: 13, color: "#504A42", typeface: sans });
}
function notes(slide, body, urls = []) {
  const block = `${body}\n\n[Sources]\n${urls.map((u) => `- ${u}`).join("\n")}`;
  slide.speakerNotes.textFrame.setText(block);
}
function miniCard(slide, titleText, body, x, y, w, h, opts = {}) {
  box(slide, x, y, w, h, opts.fill ?? C.white, "rounded-xl", opts.line ?? C.line);
  text(slide, titleText, x + 18, y + 16, w - 36, 28, { size: opts.titleSize ?? 18, color: opts.color ?? C.ink, bold: true, typeface: serif });
  if (body && h > 66) text(slide, body, x + 18, y + 52, w - 36, h - 66, { size: opts.bodySize ?? 12, color: opts.bodyColor ?? C.muted, typeface: sans, lineSpacing: 1.22 });
}

// 01 Cover
{
  const s = pres.slides.add(); s.background.fill = C.paper;
  addShape(s, "ellipse", 820, 75, 400, 400, "none", "#AFA89C");
  addShape(s, "ellipse", 865, 120, 310, 310, "none", "#D7BBAE");
  addShape(s, "ellipse", 930, 185, 180, 180, C.pine, "none");
  text(s, "故事\n熔炉", 960, 233, 120, 86, { size: 26, color: C.white, bold: true, typeface: serif, align: "center", valign: "middle" });
  for (const p of [[1014,82,C.gold],[1178,228,C.rust],[875,438,C.pine2]]) addShape(s, "ellipse", p[0], p[1], 12, 12, p[2], "none");
  text(s, "✦", 66, 48, 30, 30, { size: 19, color: C.rust, bold: true, align: "center", valign: "middle" });
  text(s, "storyforge", 103, 52, 130, 24, { size: 15, color: C.pine, bold: true, typeface: serif });
  text(s, "01 / " + totalSlides, 1140, 51, 74, 16, { size: 10, color: "#9B9183", bold: true, typeface: mono, align: "right" });
  addChapterRail(s, 1);
  text(s, "NARRATIVE WORLD OPERATING SYSTEM", 74, 152, 540, 22, { size: 11, color: C.rust, bold: true, typeface: mono });
  text(s, "StoryForge", 72, 182, 660, 100, { size: 72, color: C.ink, bold: true, typeface: serif });
  text(s, "让一个想法成为真正的故事，\n再让故事生长为可持续的世界。", 76, 293, 650, 105, { size: 26, color: C.ink, bold: true, typeface: serif, lineSpacing: 1.25 });
  text(s, "从自然语言到长篇作品、互动叙事与社区共创的完整生产路径", 76, 424, 670, 30, { size: 15, color: C.muted });
  notes(s, "约 18 秒。AI 时代不缺一段内容，缺的是把一个想法持续做成作品，并让作品拥有后续生命的系统。", ["https://github.com/yuanbw2025/storyforge"]);
}

// 02 Problem + solution
{
  const s = baseSlide(2, "01  PROJECT THESIS", "一个想法走向完整故事，再走向内容资产，仍然跨越两道断层", { titleSize: 35 });
  const steps = [
    ["01 · 灵感起点", "想法缺少持续生长的结构", "主题、角色和冲突容易停留在零散灵感，创作者需要把它组织成能够推进、审校和完成的故事。", C.rust],
    ["02 · 作品形成", "长故事需要跨越时间的一致性", "事实、人物、伏笔、节奏与文风要在漫长创作过程中持续协同，普通生成工具难以维护完整上下文。", C.gold],
    ["03 · 价值延展", "故事需要进入新的内容生命周期", "创作、游玩、分享和共同创作分散在不同工具中，故事背后的世界结构很难被继续利用。", C.pine],
  ];
  steps.forEach((step, i) => {
    const x = 68 + i * 386;
    box(s, x, 190, 366, 285, C.white, "rounded-xl", C.line);
    addShape(s, "rect", x, 190, 366, 5, step[3], "none");
    text(s, step[0], x + 24, 218, 310, 18, { size: 10, color: C.rust, bold: true, typeface: mono });
    text(s, step[1], x + 24, 260, 314, 62, { size: 22, color: C.ink, bold: true, typeface: serif, lineSpacing: 1.15 });
    text(s, step[2], x + 24, 345, 314, 84, { size: 13, color: C.muted, lineSpacing: 1.28 });
    if (i < 2) text(s, "→", x + 360, 312, 52, 34, { size: 22, color: C.rust, bold: true, typeface: serif, align: "center" });
  });
  addShape(s, "rect", 68, 506, 1144, 82, "#E7E6DE", "none");
  addShape(s, "rect", 68, 506, 4, 82, C.pine, "none");
  text(s, "StoryForge 的解法", 90, 532, 150, 26, { size: 13, color: C.pine, bold: true, typeface: serif });
  text(s, "把灵感组织成完整故事，以世界引擎沉淀可复用结构，再生成可运行、可分享、可共同创作的内容资产。", 250, 526, 920, 42, { size: 14, color: C.ink, lineSpacing: 1.2 });
  notes(s, "约 25 秒。灵感到故事是一道断层，故事到内容资产是第二道断层。StoryForge 提供连续生产路径。", ["https://github.com/yuanbw2025/storyforge"]);
}

// 03 System path
{
  const s = baseSlide(3, "02  CORE PATH", "StoryForge 让想法成为故事，让故事成为可持续的内容资产", { titleSize: 35 });
  const stageXs = [68, 350, 942], stageWs = [258, 568, 270], stageColors = [C.rust, C.gold, C.pine];
  ["STAGE 01\n让想法成为故事", "STAGE 02\n让故事成为可运行资产", "STAGE 03\n让内容进入共同生态"].forEach((label, i) => {
    addShape(s, "rect", stageXs[i], 183, stageWs[i], 4, stageColors[i], "none");
    text(s, label, stageXs[i] + 16, 202, stageWs[i] - 32, 50, { size: i === 1 ? 17 : 16, color: C.ink, bold: true, typeface: serif, lineSpacing: 1.15 });
  });
  addShape(s, "ellipse", 88, 292, 88, 88, C.white, C.line); text(s, "一个\n想法", 100, 313, 64, 50, { size: 15, color: C.ink, bold: true, typeface: serif, align: "center", valign: "middle" });
  text(s, "→", 182, 322, 38, 30, { size: 21, color: C.rust, bold: true, typeface: serif, align: "center" });
  addShape(s, "ellipse", 224, 292, 88, 88, C.white, C.line); text(s, "完整\n故事", 236, 313, 64, 50, { size: 15, color: C.ink, bold: true, typeface: serif, align: "center", valign: "middle" });
  text(s, "从自然语言形成可规划、可写作、可审校的故事结构", 86, 418, 220, 58, { size: 11, color: C.muted, align: "center", lineSpacing: 1.25 });
  addShape(s, "ellipse", 376, 292, 126, 126, C.pine, C.pine); text(s, "世界\n引擎", 400, 331, 78, 58, { size: 20, color: C.white, bold: true, typeface: serif, align: "center", valign: "middle" });
  text(s, "→", 510, 337, 36, 28, { size: 22, color: C.rust, bold: true, typeface: serif, align: "center" });
  box(s, 548, 270, 344, 194, "#FFFDFA", "rounded-xl", "#D2AFA2"); text(s, "可运行实例", 568, 289, 160, 20, { size: 11, color: C.rust, bold: true, typeface: mono });
  [["长篇小说",568,329],["多人跑团",730,329],["角色互动",568,386],["叙事游戏",730,386]].forEach((v)=>miniCard(s,v[0],"",v[1],v[2],142,42,{titleSize:13}));
  text(s, "世界事实与版本保持稳定；每种创作和游玩活动在独立实例中运行", 378, 486, 510, 40, { size: 11, color: C.muted, align: "center" });
  addShape(s, "ellipse", 960, 292, 88, 88, C.white, C.line); text(s, "分享\n游玩", 972, 313, 64, 50, { size: 15, color: C.ink, bold: true, typeface: serif, align: "center", valign: "middle" });
  text(s, "→", 1055, 322, 38, 30, { size: 21, color: C.rust, bold: true, typeface: serif, align: "center" });
  addShape(s, "ellipse", 1100, 292, 88, 88, C.pine, C.pine); text(s, "持续\n演化", 1112, 313, 64, 50, { size: 15, color: C.white, bold: true, typeface: serif, align: "center", valign: "middle" });
  text(s, "发现、改编与共同创作保留来源和世界版本关系", 960, 418, 228, 58, { size: 11, color: C.muted, align: "center", lineSpacing: 1.25 });
  userStory(s, "“我从一句设定开始完成故事；世界引擎保存其中的事实与规则，随后我和读者可以继续创作、游玩和分享。”");
  notes(s, "约 28 秒。三个阶段依次回答：故事怎样形成、世界怎样运行、内容怎样进入社区生态。四种产品形态归属于可运行实例。", ["https://github.com/yuanbw2025/storyforge"]);
}

// 04 World engine
{
  const s = baseSlide(4, "03  FOUNDATION", "世界引擎先于所有玩法：一套事实，多种叙事实例");
  tag(s, "已形成工作台", 68, 177, 118, "now");
  text(s, "把设定从“提示词”升级为可继承、可冻结、可发布的世界资产", 68, 222, 440, 68, { size: 24, bold: true, typeface: serif, lineSpacing: 1.15 });
  const pillars = [["Canon","世界事实与角色规则"],["Blueprint","故事、角色与叙事结构"],["Instance","写作与游玩状态隔离"]];
  pillars.forEach((p,i)=>{addShape(s,"rect",68+i*145,316,134,62,"#F1E5DF","none");text(s,p[0],79+i*145,328,112,17,{size:12,color:C.rust,bold:true,typeface:mono});text(s,p[1],79+i*145,350,112,18,{size:10,color:C.muted});});
  bullet(s,1,"同一世界被小说、跑团、聊天和游戏复用",68,408,440);
  bullet(s,2,"发布版本不可变，实例事件不会反向污染 Canon",68,457,440);
  bullet(s,3,"本地优先：原稿与世界资料默认不上传",68,506,440);
  addScreenshot(s, assets.world, 545, 184, 665, 408);
  userStory(s, "“我只维护一次世界规则，小说续写、跑团战役和角色聊天都从同一个可信版本出发。”");
  notes(s, "约 22 秒。当前世界工作台已经存在；可执行叙事蓝图、统一实例和社区版本网络属于下一阶段。", ["https://github.com/yuanbw2025/storyforge", "https://github.com/yuanbw2025/storyforge/blob/main/docs/WORLD-ENGINE-COMMUNITY-ARCHITECTURE.md"]);
}

// 05 Long form
{
  const s = baseSlide(5, "04  LONG-FORM CREATION", "长篇本身就是核心价值：目标是数百万字仍然记得前因后果", { titleSize: 37 });
  tag(s, "当前主要用户入口", 68, 176, 138, "now");
  text(s, "百万字级一致性", 68, 221, 440, 58, { size: 43, color: C.rust, bold: true, typeface: serif });
  text(s, "系统把创作拆成可治理、可回查、可复用的结构，并按需组合当前章节需要的上下文。", 68, 289, 435, 45, { size: 13, color: C.muted });
  ["世界事实", "角色弧光", "伏笔 / 状态", "相关前文"].forEach((v,i)=>{box(s,68+i*108,348,99,36,C.white,"rounded-lg",C.line);text(s,v,74+i*108,359,87,16,{size:10,color:C.ink,bold:true,align:"center"});if(i<3)text(s,"+",165+i*108,357,18,18,{size:13,color:C.rust,bold:true,align:"center"});});
  bullet(s,1,"卷纲 → 章纲 → 场景 → 正文的分阶段工作流",68,412,440);
  bullet(s,2,"事实提取、影响分析、质量审校与章节记忆",68,461,440);
  bullet(s,3,"创作者确认后写回，保留人的控制权",68,510,440);
  addScreenshot(s, assets.longform, 545, 184, 665, 408);
  userStory(s, "“我只想写网文：StoryForge 帮我维护卷章结构、角色关系和数百章之后仍要兑现的伏笔。”");
  notes(s, "约 25 秒。数百万字是目标能力边界，不是声称已经完成百万字公开基准。", ["https://github.com/yuanbw2025/storyforge", "https://github.com/yuanbw2025/storyforge/tree/main/docs/assets/feature-guide"]);
}

// 06 Node authoring
{
  const s = baseSlide(6, "05  CREATIVE CONTROL", "同一套底层数据，也能变成可观察、可回放的创作图");
  tag(s, "高级创作入口", 68, 177, 118, "now");
  text(s, "节点创作为进阶用户提供可自由编排的工作流", 68, 222, 440, 66, { size: 24, bold: true, typeface: serif, lineSpacing: 1.15 });
  bullet(s,1,"自由连接世界观、故事、角色、执行控制和输出节点",68,323,440);
  bullet(s,2,"运行过程可观察、可回放，结果先成为候选",68,380,440);
  bullet(s,3,"确认采纳后才写回项目，避免 AI 直接污染资料库",68,437,440);
  text(s,"分步骤写作降低门槛；节点创作提供自由度。二者共享同一世界与治理边界。",68,514,430,50,{size:12,color:C.muted});
  addScreenshot(s, assets.node, 545, 184, 665, 408);
  userStory(s, "“我不想按固定步骤写：我可以把角色支线、世界事件和审校节点组合成自己的生产线。”");
  notes(s, "约 18 秒。节点工作流证明产品不只有一种固定流程，并展示 AI 写回治理能力。", ["https://github.com/yuanbw2025/storyforge"]);
}

// 07 TTRPG
{
  const s = baseSlide(7, "06  MULTIPLAYER TTRPG", "多人进入同一个世界，共同创造一条新的历史", { titleSize: 36 });
  tag(s, "当前：本地单人战役", 68, 176, 150, "now"); tag(s, "下一步：多人房间", 226, 176, 142, "future");
  ["GM","A","B","C"].forEach((v,i)=>{addShape(s,"ellipse",68+i*34,222,39,39,[C.rust,C.pine,C.gold,"#756A83"][i],C.paper);text(s,v,68+i*34,234,39,14,{size:10,color:i===2?C.ink:C.white,bold:true,align:"center"});});
  text(s, "玩家共享一个世界版本，各自拥有角色、秘密、行动与后果", 68, 282, 442, 64, { size: 23, bold: true, typeface: serif, lineSpacing: 1.15 });
  bullet(s,1,"AI / 真人主持人、确定性骰子、战斗与事件回放已有本地基座",68,374,440,{size:13});
  bullet(s,2,"多人阶段加入房间、席位、同步状态与权限",68,428,440,{size:13});
  bullet(s,3,"战役事件可整理为世界支线或新作品",68,482,440,{size:13});
  addScreenshot(s, assets.ttrpg, 545, 184, 665, 408);
  userStory(s, "“四位朋友进入我小说的同一个世界：一人主持、三人扮演角色，每次选择都成为这条世界线的新历史。”");
  notes(s, "约 25 秒。当前是单人/本地；真正多人协作依赖后续平台层，但会复用现有战役、骰子、战斗和回放基座。", ["https://github.com/yuanbw2025/storyforge/blob/main/docs/TTRPG-CAMPAIGN-DESIGN.md"]);
}

// 08 Chat
{
  const s = baseSlide(8, "07  CHARACTER INTERACTION", "角色以世界事实、身份与记忆持续存在");
  tag(s, "当前：单角色分支聊天", 68, 176, 160, "now"); tag(s, "未来：多角色冒险", 236, 176, 140, "future");
  text(s, "冻结世界与角色快照，让对话有身份、场景、记忆与后果", 68, 229, 440, 66, { size: 24, bold: true, typeface: serif, lineSpacing: 1.15 });
  bullet(s,1,"选择角色、用户身份与场景后建立独立会话",68,338,440);
  bullet(s,2,"支持重生成、检查点和分支，不破坏原始世界",68,397,440);
  bullet(s,3,"下一阶段扩展长期记忆、多角色房间和关系演化",68,456,440);
  addScreenshot(s, assets.chat, 545, 184, 665, 408);
  userStory(s, "“读者可以以记者的身份采访小说中的反派；这段关系有上下文，也能发展成一条新的支线。”");
  notes(s, "约 20 秒。与通用陪聊的区别是：角色互动具有世界事实、角色快照和实例边界。", ["https://github.com/yuanbw2025/storyforge/blob/main/docs/CHATGAME-1-SINGLE-CHARACTER-DESIGN.md"]);
}

// 09 Text game forms
{
  const s = baseSlide(9, "08  NARRATIVE GAMES", "文字游戏把故事结构转化为选择、状态、分支与结局", { titleSize: 36 });
  tag(s, "当前：实验入口", 68, 176, 126, "now"); tag(s, "下一步：编辑与发布", 202, 176, 148, "future");
  text(s, "同一世界可以生成三类可玩的叙事产品", 68, 226, 440, 62, { size: 24, bold: true, typeface: serif, lineSpacing: 1.15 });
  const types = [
    ["分支冒险", "作者设置关键节点与结局，玩家选择改变关系、资源和路线。"],
    ["系统叙事", "规则、状态和事件系统共同组织生存、经营与开放探索。"],
    ["社区衍生", "读者基于已发布的世界制作番外、支线和新的可玩版本。"],
  ];
  types.forEach((item, i) => {
    const y = 315 + i * 68;
    if (i > 0) addShape(s, "rect", 68, y - 11, 430, 1, C.line, "none");
    text(s, item[0], 68, y, 96, 24, { size: 14, color: C.rust, bold: true, typeface: serif });
    text(s, item[1], 176, y - 1, 322, 43, { size: 12, color: C.muted, lineSpacing: 1.18 });
  });
  text(s, "当前界面已完成世界绑定入口；选择、状态、分支编辑器与发布游玩闭环正在汇合。", 68, 529, 430, 46, { size: 11, color: C.muted, lineSpacing: 1.2 });
  addScreenshot(s, assets.game, 545, 184, 665, 408);
  userStory(s, "“我从自己的故事和世界设定出发，就能制作一款拥有选择、状态与结局的叙事游戏。”");
  notes(s, "约 27 秒。真实界面证明文字游戏已经进入产品导航和世界绑定体系；三种目标形态帮助评审理解产品方向与当前实验边界。", ["https://github.com/yuanbw2025/storyforge/blob/main/docs/INTERACTIVE-RUNTIME-ROADMAP.md"]);
}

// 12 Community loop (built after market and traction)
function addCommunitySlide() {
  const s = baseSlide(12, "11  COMMUNITY LOOP", "世界进入社区后，在发布、游玩、改编与共创中持续演化", { titleSize: 35 });
  addShape(s,"ellipse",477,198,330,330,"none","#D2AFA2");
  addShape(s,"ellipse",567,288,150,150,C.pine,"none");
  text(s,"可持续的\n叙事世界",587,330,110,66,{size:20,color:C.white,bold:true,typeface:serif,align:"center",valign:"middle"});
  miniCard(s,"创作与发布","冻结世界版本、作品与授权边界",105,202,225,92);
  miniCard(s,"发现与游玩","导入世界，进入小说、战役或游戏实例",950,214,225,92);
  miniCard(s,"改编与共创","制作支线、角色故事与新玩法",948,478,225,92);
  miniCard(s,"反馈与演化","以结构化提案形成新的世界版本",104,470,225,92);
  addShape(s,"rect",318,246,170,2,C.gold,"none");addShape(s,"rect",797,257,165,2,C.gold,"none");addShape(s,"rect",318,515,170,2,C.gold,"none");addShape(s,"rect",797,522,165,2,C.gold,"none");
  userStory(s, "“我发布一个可追溯版本的世界；其他人可以阅读、游玩、改编，并把新作品连接回它的来源。”");
  notes(s, "约 22 秒。社区围绕世界版本和衍生关系形成内容网络。", ["https://github.com/yuanbw2025/storyforge/blob/main/docs/WORLD-ENGINE-COMMUNITY-ARCHITECTURE.md"]);
}

// 10 Market
{
  const s = baseSlide(10, "09  MARKET WINDOW", "创作供给、AI 使用与互动消费已经同时成立");
  const cards = [
    ["502.1 亿","中国网络文学阅读市场","2025 年；作品生产本身已经是大规模产业。",C.pine,C.gold,"#DFE6E3"],
    ["3269 万","网文作者规模","庞大的创作者群体已经构成明确的生产者市场。",C.white,C.rust,C.muted],
    ["85%+","签约作者每周使用 AI 辅助","AI 已进入工作流，但直接完成高质量长篇仍然困难。",C.white,C.rust,C.muted],
    ["100 亿+","Episode 互动章节观看","全球用户已经证明叙事内容可以被持续“玩”。",C.white,C.rust,C.muted],
  ];
  cards.forEach((c,i)=>{const x=68+i*288;box(s,x,192,274,230,c[3],"rounded-xl",c[3]);text(s,c[0],x+22,222,230,48,{size:36,color:c[4],bold:true,typeface:serif});text(s,c[1],x+22,290,230,42,{size:17,color:i===0?C.white:C.ink,bold:true,typeface:serif});text(s,c[2],x+22,347,230,50,{size:11,color:c[5],lineSpacing:1.2});});
  addShape(s,"rect",68,451,1138,67,"#E7E6DE","none");addShape(s,"rect",68,451,4,67,C.pine,"none");
  text(s,"StoryForge 的窗口：",88,476,145,24,{size:13,color:C.ink,bold:true});text(s,"连接“庞大的故事生产”与“成熟的互动消费”，让同一份世界资产跨越两类市场。",238,474,920,28,{size:14,color:C.ink});
  text(s,"来源：中科院《2025中国网络文学发展研究报告》；中国作家网；Episode 官方首页。",68,682,950,12,{size:8,color:"#92887B"});
  notes(s, "约 25 秒。不要把四个数字简单相加成 TAM；它们分别证明供给规模、创作者规模、AI 行为迁移和互动消费都已发生。", ["https://www.cass.cn/yaowen/202604/t20260414_5980410.shtml", "https://wyb.chinawriter.com.cn/Pad/content/202506/30/content79852.html", "https://home.episodeinteractive.com/"]);
}

// 11 Traction
{
  const s = baseSlide(11, "10  EARLY SIGNALS", "初期项目，但需求已经从代码仓库扩散到内容社区", { titleSize: 37 });
  box(s,68,181,415,441,C.pine,"rounded-xl",C.pine);
  text(s,"CURRENT PROOF",92,207,200,18,{size:10,color:C.gold,bold:true,typeface:mono});
  text(s,"当前验证主要来自\n长篇创作用户",92,246,340,78,{size:25,color:C.white,bold:true,typeface:serif,lineSpacing:1.18});
  text(s,"长篇工作流提供高频、强痛点的产品切入口；创作者沉淀的故事与世界将继续释放互动价值。",92,346,340,76,{size:13,color:"#D8DFDC",lineSpacing:1.25});
  text(s,"已有社群用户反馈将作品发布到网文平台并获得持续追读；案例仍在征集公开证明材料，路演不使用未经核验的收益数字。",92,447,340,76,{size:12,color:"#BFCAC5",lineSpacing:1.25});
  const signals=[["520+","GitHub Stars","95 Forks · 798 次提交"],["≈ 1,000","社群成员","项目方口径；不等于活跃创作者"],["6,272","近 14 日仓库浏览事件","2026-07-31—08-13"],["1,290","近 14 日完整克隆事件","非独立用户"]];
  signals.forEach((c,i)=>{const x=505+(i%2)*354,y=181+Math.floor(i/2)*150;box(s,x,y,334,134,C.white,"rounded-xl",C.line);text(s,c[0],x+22,y+18,290,42,{size:34,color:C.rust,bold:true,typeface:serif});text(s,c[1],x+22,y+66,290,24,{size:15,color:C.ink,bold:true,typeface:serif});text(s,c[2],x+22,y+101,290,18,{size:10,color:C.muted});});
  box(s,505,481,688,102,C.white,"rounded-xl",C.line);text(s,"34,595",527,499,220,40,{size:34,color:C.rust,bold:true,typeface:serif});text(s,"教程合集累计播放",527,540,250,22,{size:15,color:C.ink,bold:true,typeface:serif});text(s,"主视频约 28,198 播放、2,864 收藏",820,522,320,24,{size:11,color:C.muted});
  text(s,"本地优先意味着无法统一统计生成字数和活跃创作者；这是隐私边界，也是下一阶段要补足的验证能力。",505,601,690,28,{size:10,color:C.muted});
  text(s,"来源：GitHub 仓库与 Traffic 自存档、Bilibili 页面、项目方社群口径；事件量均非独立人数。",68,684,1050,12,{size:8,color:"#92887B"});
  notes(s, "约 30 秒。GitHub 官方只提供近 14 天窗口，因此主页面只放最近 14 个完整归档日。所有事件量都不是独立人数。", ["https://github.com/yuanbw2025/storyforge", "https://docs.github.com/en/rest/metrics/traffic?apiVersion=2022-11-28", "https://github.com/yuanbw2025/storyforge/blob/main/data/traffic/views.csv", "https://github.com/yuanbw2025/storyforge/blob/main/data/traffic/clones.csv", "https://www.bilibili.com/video/BV1q37j6QExh/"]);
}

addCommunitySlide();

// 13 Roadmap
{
  const s = baseSlide(13, "12  ROADMAP", "三阶段把创作基座扩展为可运行的世界网络");
  const phases=[
    ["NOW · 已有基座","完成作品",["长篇分阶段写作与一致性治理","世界引擎工作台与本地世界包","节点创作、单人跑团、单角色聊天","开源社区与内容教程入口"]],
    ["NEXT · 产品闭环","让世界运行",["可执行叙事蓝图与统一实例状态","文字游戏编辑、发布与游玩闭环","多人跑团房间与多角色互动","匿名化、可选择的使用反馈指标"]],
    ["LATER · 生态网络","让世界演化",["创作者身份、云同步与世界发现","版本、授权、来源与衍生关系","结构化共创提案与协作工作流","创作、游玩、改编与分发市场"]],
  ];
  phases.forEach((p,i)=>{const x=68+i*386;box(s,x,192,366,356,C.white,"rounded-xl",C.line);addShape(s,"ellipse",x+22,180,18,18,[C.rust,C.gold,C.pine][i],C.paper);text(s,p[0],x+22,220,300,18,{size:10,color:C.rust,bold:true,typeface:mono});text(s,p[1],x+22,261,300,38,{size:23,color:C.ink,bold:true,typeface:serif});p[2].forEach((v,j)=>{text(s,"·",x+22,327+j*47,15,18,{size:18,color:C.rust,bold:true});text(s,v,x+42,328+j*47,292,32,{size:12,color:C.ink});});});
  notes(s, "约 25 秒。已有基座不是终点；下一步每项都沿当前架构自然扩展。", ["https://github.com/yuanbw2025/storyforge/blob/main/docs/roadmap/README.md", "https://github.com/yuanbw2025/storyforge/blob/main/docs/roadmap/CAPABILITY-BASELINE.md"]);
}

// 14 Current stage and next
{
  const s = baseSlide(14, "13  CURRENT STAGE & NEXT", "当前形成创作与世界基座，下一阶段推进产品闭环和社区生态", { titleSize: 35 });
  box(s,68,195,420,322,C.pine,"rounded-xl",C.pine);addShape(s,"ellipse",96,223,76,76,"#FFFFFF0A","#FFFFFF55");text(s,"NOW",96,248,76,28,{size:18,color:C.white,bold:true,typeface:serif,align:"center"});
  text(s,"独立开发者发起\n社区共同参与",96,330,330,70,{size:25,color:C.white,bold:true,typeface:serif,lineSpacing:1.15});
  text(s,"长篇创作、世界引擎、节点创作和本地互动实例已经形成初期产品基座，并持续吸收真实用户反馈。",96,420,330,62,{size:12,color:"#D7DDDA",lineSpacing:1.25});
  text(s,"500+ Stars · 近千人社群 · 持续版本迭代",96,492,330,20,{size:11,color:C.gold,bold:true});
  const nexts=[["产品闭环","完成文字游戏编辑发布、多人跑团和多角色互动。"],["公开案例","建立授权、脱敏的创作者成果库与定量验证体系。"],["协作团队","补充前端、游戏设计、内容运营与社区治理能力。"],["社区生态","形成世界发布、发现、游玩、改编和共创的最小闭环。"]];
  nexts.forEach((n,i)=>miniCard(s,n[0],n[1],518+(i%2)*344,195+Math.floor(i/2)*112,324,98,{titleSize:16,bodySize:11}));
  addShape(s,"rect",518,435,668,75,"#F4E8CD","none");addShape(s,"rect",518,435,4,75,C.gold,"none");text(s,"入驻后将围绕产品闭环、公开案例和协作团队，加快从开源工具进入可持续产品与社区生态。",536,456,626,39,{size:12,color:C.ink,bold:true,lineSpacing:1.18});
  notes(s, "约 25 秒。客观说明项目当前处于初期产品基座阶段；下一阶段集中完成产品闭环、公开案例、协作团队和社区生态。", ["https://github.com/yuanbw2025/storyforge"]);
}

// 15 Closing
{
  const s = pres.slides.add();s.background.fill=C.paper;addShape(s,"ellipse",1060,0,220,160,"#E8DED0","none");
  addChapterRail(s, 15);
  text(s,"✦",66,48,30,30,{size:19,color:C.rust,bold:true,align:"center",valign:"middle"});text(s,"storyforge",103,52,130,24,{size:15,color:C.pine,bold:true,typeface:serif});text(s,"15 / " + totalSlides,1140,51,74,16,{size:10,color:"#9B9183",bold:true,typeface:mono,align:"right"});
  text(s,"StoryForge 希望让一个人从一个想法开始，\n完成一部真正的作品；\n再以世界引擎为基座，让它成为小说、多人跑团、\n角色关系与叙事游戏，\n最终拥有被共同创造、持续演化的生命。",90,172,970,330,{size:39,color:C.ink,bold:true,typeface:serif,lineSpacing:1.18});
  text(s,"github.com/yuanbw2025/storyforge",92,614,520,24,{size:15,color:C.pine,bold:true,typeface:mono});addShape(s,"ellipse",1052,525,122,122,C.rust,"none");text(s,"MAKE\nWORLDS\nLIVE",1071,552,84,74,{size:16,color:C.white,bold:true,typeface:serif,align:"center",valign:"middle"});
  notes(s, "约 18 秒。最后回到愿景，把作品、世界引擎、多个形态和共同演化完整说清；感谢评审并进入问答。", ["https://github.com/yuanbw2025/storyforge"]);
}

async function writeBlob(file, blob) {
  await fs.writeFile(file, new Uint8Array(await blob.arrayBuffer()));
}
for (const [i, slide] of pres.slides.items.entries()) {
  const stem = `slide-${String(i + 1).padStart(2, "0")}`;
  await writeBlob(path.join(outDir, `${stem}.png`), await pres.export({ slide, format: "png", scale: 1 }));
  const layout = await slide.export({ format: "layout" });
  await fs.writeFile(path.join(outDir, `${stem}.layout.json`), await layout.text());
}
await writeBlob(path.join(outDir, "montage.webp"), await pres.export({ format: "webp", montage: true, scale: 1 }));
const pptx = await PresentationFile.exportPptx(pres);
await pptx.save(outPptx);
console.log(`Wrote ${outPptx}`);
