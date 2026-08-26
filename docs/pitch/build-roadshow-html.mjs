import fs from "node:fs/promises";
import path from "node:path";
import console from "node:console";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "../..");
const output = path.join(here, "storyforge-opc-roadshow.html");

async function dataUri(file) {
  const bytes = await fs.readFile(file);
  const ext = path.extname(file).slice(1).replace("jpg", "jpeg");
  return `data:image/${ext};base64,${bytes.toString("base64")}`;
}

const img = {
  hub: await dataUri(path.join(here, "assets/product-hub.png")),
  world: await dataUri(path.join(here, "assets/world-engine.png")),
  longform: await dataUri(path.join(projectRoot, "docs/assets/feature-guide/demo-chapter-editor-filled-toolbar.png")),
  node: await dataUri(path.join(here, "assets/node-authoring.png")),
  ttrpg: await dataUri(path.join(here, "assets/ttrpg.png")),
  chat: await dataUri(path.join(here, "assets/character-chat.png")),
  game: await dataUri(path.join(here, "assets/text-game-current.png")),
};

const sources = {
  market: [
    "中国社会科学院：《2025中国网络文学发展研究报告》（2026-04-14） https://www.cass.cn/yaowen/202604/t20260414_5980410.shtml",
    "中国作家网：《2024中国网络文学蓝皮书》相关报道（2025-06-30） https://wyb.chinawriter.com.cn/Pad/content/202506/30/content79852.html",
    "Episode 官方首页（访问于 2026-08-16） https://home.episodeinteractive.com/",
  ],
  traction: [
    "GitHub 仓库（访问于 2026-08-16） https://github.com/yuanbw2025/storyforge",
    "GitHub Traffic 文档：Traffic API 仅覆盖最近 14 天；clones 为完整克隆事件，不含 fetch https://docs.github.com/en/rest/metrics/traffic?apiVersion=2022-11-28",
    "StoryForge 自存档 views.csv / clones.csv（最近 14 个完整归档日：2026-07-31—2026-08-13）",
    "Bilibili StoryForge 教程合集与主视频（访问于 2026-08-16） https://www.bilibili.com/video/BV1q37j6QExh/",
    "社群规模约 1,000：项目方口径，待平台后台截图归档。",
  ],
};

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>StoryForge · OPC 路演演示稿</title>
<style>
:root{--paper:#f5f0e7;--paper2:#ede5d8;--ink:#211f1b;--muted:#716b61;--rust:#a45137;--rust2:#c67856;--pine:#253a35;--pine2:#3f5a51;--gold:#d7a452;--line:rgba(42,38,31,.15);--white:#fffdfa;--shadow:0 24px 80px rgba(45,37,29,.18)}
*{box-sizing:border-box} html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#171a18;color:var(--ink)}
body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
.stage{position:fixed;inset:0;display:grid;place-items:center;padding-bottom:54px;background:radial-gradient(circle at 50% 20%,#30362f 0,#171a18 60%)}
.deck{--deck-scale:1;position:relative;width:1280px;height:720px;flex:0 0 1280px;overflow:hidden;background:var(--paper);box-shadow:var(--shadow);transform:scale(var(--deck-scale));transform-origin:center center;cursor:pointer;user-select:none}
.slide{display:block;visibility:hidden;pointer-events:none;position:absolute;inset:0;padding:54px 66px 46px;background:var(--paper);overflow:hidden;isolation:isolate;opacity:0;transform:translateX(0) scale(.985)}
.slide.active{visibility:visible;pointer-events:auto;z-index:3;opacity:1}
.slide.enter-next{animation:enterNext .78s cubic-bezier(.16,.84,.24,1) both}.slide.enter-prev{animation:enterPrev .78s cubic-bezier(.16,.84,.24,1) both}
.slide.leaving-next,.slide.leaving-prev{visibility:visible;z-index:2;pointer-events:none}.slide.leaving-next{animation:leaveNext .66s cubic-bezier(.5,0,.7,.2) both}.slide.leaving-prev{animation:leavePrev .66s cubic-bezier(.5,0,.7,.2) both}
.slide:before{content:"";position:absolute;inset:0;z-index:-2;background-image:linear-gradient(rgba(63,55,45,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(63,55,45,.035) 1px,transparent 1px);background-size:32px 32px;mask-image:linear-gradient(to bottom,rgba(0,0,0,.7),transparent 75%)}
.slide:after{content:"";position:absolute;width:480px;height:480px;border:1px solid rgba(164,81,55,.12);border-radius:50%;right:-270px;top:-260px;box-shadow:0 0 0 58px rgba(164,81,55,.035),0 0 0 116px rgba(164,81,55,.025);z-index:-1}
@keyframes enterNext{from{opacity:0;transform:translateX(19%) scale(.94) rotateY(-4deg);clip-path:inset(0 0 0 23%)}to{opacity:1;transform:none;clip-path:inset(0)}}
@keyframes enterPrev{from{opacity:0;transform:translateX(-19%) scale(.94) rotateY(4deg);clip-path:inset(0 23% 0 0)}to{opacity:1;transform:none;clip-path:inset(0)}}
@keyframes leaveNext{from{opacity:1;transform:none;filter:brightness(1)}to{opacity:0;transform:translateX(-10%) scale(.96);filter:brightness(.74)}}
@keyframes leavePrev{from{opacity:1;transform:none;filter:brightness(1)}to{opacity:0;transform:translateX(10%) scale(.96);filter:brightness(.74)}}
@keyframes rise{from{opacity:0;transform:translateY(28px) scale(.985)}to{opacity:1;transform:none}}
@keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(215,164,82,.25)}50%{box-shadow:0 0 0 18px rgba(215,164,82,0)}}
@keyframes travel{from{stroke-dashoffset:260}to{stroke-dashoffset:0}}
@keyframes breathe{50%{transform:scale(1.035);filter:brightness(1.08)}}
@keyframes ringBreathe{0%,100%{transform:translate(-50%,-50%) scale(1)}50%{transform:translate(-50%,-50%) scale(1.025);filter:brightness(1.08)}}
.active .screen img{animation:screenSettle 1.1s cubic-bezier(.16,.84,.24,1) both}
@keyframes screenSettle{from{transform:scale(1.035);filter:saturate(.65);opacity:.35}to{transform:scale(1);filter:saturate(1);opacity:1}}
@keyframes lineGrow{from{transform:scaleX(0);opacity:.15}to{transform:scaleX(1);opacity:1}}
@keyframes rayGlow{from{opacity:0;filter:blur(6px)}to{opacity:1;filter:none}}
@keyframes wipeNext{0%{opacity:0;transform:translateX(-115%)}32%{opacity:1}100%{opacity:0;transform:translateX(115%)}}
@keyframes wipePrev{0%{opacity:0;transform:translateX(115%)}32%{opacity:1}100%{opacity:0;transform:translateX(-115%)}}
@keyframes nodePop{from{opacity:0;transform:translateY(16px) scale(.88)}to{opacity:1;transform:none}}
.transition-wipe{position:absolute;z-index:18;inset:-18% -30%;pointer-events:none;opacity:0;background:linear-gradient(100deg,transparent 34%,rgba(215,164,82,.08) 43%,rgba(255,253,250,.7) 50%,rgba(164,81,55,.12) 57%,transparent 66%)}.transition-wipe.next{animation:wipeNext .78s cubic-bezier(.2,.72,.24,1)}.transition-wipe.prev{animation:wipePrev .78s cubic-bezier(.2,.72,.24,1)}
.active .reveal{animation:rise .55s both}.active .d1{animation-delay:.08s}.active .d2{animation-delay:.16s}.active .d3{animation-delay:.24s}.active .d4{animation-delay:.32s}.active .d5{animation-delay:.4s}
.kicker{font:700 11px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.18em;color:var(--rust);text-transform:uppercase}
h1,h2,h3,p{margin:0}.display{font-family:"Songti SC","STSong","Noto Serif CJK SC",serif;font-weight:600;letter-spacing:-.035em}
h1{font-size:62px;line-height:1.08}.slide-title{font-size:39px;line-height:1.16;margin-top:10px;max-width:980px}.lead{font-size:20px;line-height:1.65;color:var(--muted);max-width:900px;margin-top:16px}.small{font-size:13px;line-height:1.55;color:var(--muted)}
.topline{display:flex;align-items:flex-start;justify-content:space-between;gap:28px}.topline>div:first-child{min-width:0}.brand{display:flex;align-items:center;gap:10px;font:600 14px/1 Georgia,serif;color:var(--pine)}.brand-mark{width:28px;height:28px;border:1px solid var(--rust);display:grid;place-items:center;border-radius:8px;color:var(--rust)}
.chapter-rail{position:absolute;z-index:10;left:66px;right:66px;top:16px;display:grid;grid-template-columns:repeat(5,1fr);gap:16px;pointer-events:none}.chapter-step{position:relative;padding-top:8px;border-top:2px solid rgba(113,107,97,.17);font:700 9px/1.1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.11em;color:#a49a8c;white-space:nowrap}.chapter-step:before{content:"";position:absolute;left:0;top:-2px;width:0;height:2px;background:var(--rust)}.chapter-step.done{color:#766e63;border-color:rgba(37,58,53,.35)}.chapter-step.done:before{width:100%;background:var(--pine)}.chapter-step.current{color:var(--rust)}.active .chapter-step.current:before{animation:chapterGrow .7s .16s cubic-bezier(.16,.84,.24,1) both}@keyframes chapterGrow{from{width:0}to{width:100%}}
.page{flex:0 0 auto;white-space:nowrap;font:600 11px/1 ui-monospace,monospace;color:#9b9183}.section-no{color:var(--rust);margin-right:6px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:26px}.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.card{border:1px solid var(--line);background:rgba(255,253,250,.72);border-radius:16px;padding:22px;box-shadow:0 7px 24px rgba(52,43,34,.05)}
.card.dark{background:var(--pine);color:var(--white);border-color:transparent}.card.rust{background:var(--rust);color:#fff;border-color:transparent}
.tag{display:inline-flex;align-items:center;gap:7px;padding:6px 10px;border-radius:999px;background:rgba(164,81,55,.1);color:var(--rust);font-size:11px;font-weight:700;letter-spacing:.04em}.tag.now{background:rgba(37,58,53,.1);color:var(--pine)}.tag.future{background:rgba(215,164,82,.16);color:#8b6221}
.user-story{position:absolute;left:66px;right:66px;bottom:34px;display:flex;align-items:center;gap:16px;padding-top:13px;border-top:1px solid var(--line);font-size:14px;color:#504a42}.user-story b{font:700 10px/1 ui-monospace,monospace;color:var(--rust);letter-spacing:.14em;white-space:nowrap}
.screen{position:relative;overflow:hidden;border:1px solid rgba(46,42,35,.18);border-radius:16px;background:#f8f4ec;box-shadow:0 18px 45px rgba(47,38,30,.17)}.screen img{width:100%;height:100%;object-fit:contain;display:block}.screen:after{content:"ACTUAL PRODUCT";position:absolute;top:12px;right:12px;background:rgba(33,31,27,.82);color:white;padding:6px 9px;border-radius:999px;font:700 9px/1 ui-monospace,monospace;letter-spacing:.1em}
.feature-layout{display:grid;grid-template-columns:43% 57%;gap:30px;margin-top:24px;height:405px}.feature-copy{display:flex;flex-direction:column;gap:15px}.feature-copy h3{font:600 27px/1.25 "Songti SC","STSong",serif}.bullets{display:grid;gap:11px;margin-top:2px}.bullet{display:grid;grid-template-columns:22px 1fr;gap:10px;font-size:15px;line-height:1.45}.bullet i{width:19px;height:19px;border:1px solid rgba(164,81,55,.35);color:var(--rust);border-radius:50%;font:700 11px/18px Georgia;text-align:center;font-style:normal}
.cover{background:linear-gradient(135deg,#f8f4ec 0%,#eee5d7 68%,#e0d3c0 100%)}.cover .title-wrap{position:absolute;left:74px;top:157px;width:660px}.cover h1{font-size:76px}.cover .sub{font:500 25px/1.5 "Songti SC","STSong",serif;margin-top:18px;max-width:680px}.cover .promise{margin-top:28px;font-size:15px;color:var(--muted)}
.forge{position:absolute;right:68px;top:98px;width:420px;height:420px}.forge .core{position:absolute;left:145px;top:145px;width:130px;height:130px;border-radius:50%;display:grid;place-items:center;background:var(--pine);color:#fff;font:600 24px/1.2 Georgia,serif;box-shadow:0 0 0 18px rgba(37,58,53,.08);animation:pulse 2.8s infinite}.orbit{position:absolute;inset:0;border:1px solid rgba(37,58,53,.23);border-radius:50%;animation:breathe 5s ease-in-out infinite}.orbit.o2{inset:50px;border-color:rgba(164,81,55,.28);animation-delay:-1s}.spark{position:absolute;width:10px;height:10px;border-radius:50%;background:var(--gold);box-shadow:0 0 16px var(--gold)}.s1{left:200px;top:-4px}.s2{right:32px;top:142px;background:var(--rust)}.s3{left:42px;bottom:70px;background:var(--pine2)}
.problem-wrap{display:grid;grid-template-columns:repeat(3,1fr);align-items:stretch;gap:20px;margin-top:28px;height:300px}.problem-step{position:relative;padding:27px 25px 24px;border-top:4px solid var(--rust)}.problem-step:nth-child(2){border-top-color:var(--gold)}.problem-step:nth-child(3){border-top-color:var(--pine)}.problem-step .step-no{font:700 10px/1 ui-monospace,monospace;letter-spacing:.14em;color:var(--rust)}.problem-step h3{font:600 25px/1.3 "Songti SC",serif;margin:16px 0 15px}.problem-step p{font-size:14px;line-height:1.65;color:var(--muted)}.problem-step:not(:last-child):after{content:"→";position:absolute;right:-18px;top:47%;z-index:3;color:var(--rust);font:600 22px/1 Georgia,serif}.solution-band{display:grid;grid-template-columns:116px 1fr;gap:18px;align-items:center;margin-top:18px;padding:16px 20px;border-left:4px solid var(--pine);background:rgba(37,58,53,.08)}.solution-band b{font:700 13px/1.3 "Songti SC",serif;color:var(--pine)}.solution-band span{font-size:14px;line-height:1.55}.active .problem-step{animation:rise .58s both}.active .problem-step:nth-child(2){animation-delay:.12s}.active .problem-step:nth-child(3){animation-delay:.24s}
.journey-v2{display:grid;grid-template-columns:23% 49% 23%;gap:2.5%;margin-top:28px;height:390px}.journey-stage{position:relative;padding:20px 18px 16px;border-top:4px solid var(--rust);background:linear-gradient(180deg,rgba(255,253,250,.72),rgba(255,253,250,.18))}.journey-stage:nth-child(2){border-color:var(--gold)}.journey-stage:nth-child(3){border-color:var(--pine)}.phase-title{font:700 10px/1 ui-monospace,monospace;letter-spacing:.13em;color:var(--rust)}.phase-title strong{display:block;margin-top:8px;font:600 20px/1.25 "Songti SC",serif;letter-spacing:0;color:var(--ink)}.stage-flow{display:flex;align-items:center;justify-content:center;gap:12px;height:205px}.flow-node{width:92px;height:92px;border-radius:50%;display:grid;place-items:center;text-align:center;background:var(--white);border:1px solid var(--line);font:600 16px/1.3 "Songti SC",serif;box-shadow:0 10px 28px rgba(48,40,32,.09)}.flow-node.main{background:var(--pine);color:#fff;border:0;box-shadow:0 0 0 10px rgba(37,58,53,.09)}.flow-arrow{color:var(--rust);font:600 22px/1 Georgia,serif}.stage-caption{text-align:center;font-size:11px;line-height:1.5;color:var(--muted)}.engine-to-instance{display:grid;grid-template-columns:135px 34px 1fr;align-items:center;gap:8px;margin-top:18px}.engine-core{height:135px;border-radius:50%;display:grid;place-items:center;text-align:center;background:var(--pine);color:#fff;font:600 19px/1.3 "Songti SC",serif;box-shadow:0 0 0 10px rgba(37,58,53,.08)}.instance-box{position:relative;padding:42px 12px 12px;border:2px solid rgba(164,81,55,.32);border-radius:18px;background:rgba(255,253,250,.64)}.instance-box>strong{position:absolute;left:14px;top:12px;font:700 11px/1 ui-monospace,monospace;letter-spacing:.11em;color:var(--rust)}.instance-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}.instance-chip{padding:12px 8px;border-radius:10px;background:var(--white);border:1px solid var(--line);text-align:center;font:600 13px/1.25 "Songti SC",serif}.active .journey-stage{animation:rise .62s both}.active .journey-stage:nth-child(2){animation-delay:.18s}.active .journey-stage:nth-child(3){animation-delay:.36s}.active .instance-chip{animation:nodePop .48s both}.active .instance-chip:nth-child(1){animation-delay:.42s}.active .instance-chip:nth-child(2){animation-delay:.5s}.active .instance-chip:nth-child(3){animation-delay:.58s}.active .instance-chip:nth-child(4){animation-delay:.66s}
.engine-pillars{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.engine-pillars .mini{border-left:3px solid var(--rust);padding:8px 10px;background:rgba(164,81,55,.06)}.mini b{font-size:13px}.mini p{font-size:11px;line-height:1.45;color:var(--muted);margin-top:4px}
.million{font:700 47px/1 "Songti SC",serif;color:var(--rust);letter-spacing:-.04em}.equation{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.equation span{font-size:12px;padding:8px 10px;border-radius:9px;background:var(--white);border:1px solid var(--line)}.equation i{color:var(--rust);font-style:normal}
.players{display:flex;margin-top:6px}.avatar{width:38px;height:38px;margin-right:-9px;border-radius:50%;display:grid;place-items:center;border:3px solid var(--paper);background:var(--rust);color:white;font-weight:700}.avatar:nth-child(2){background:var(--pine)}.avatar:nth-child(3){background:var(--gold);color:var(--ink)}.avatar:nth-child(4){background:#756a83}
.game-card{min-height:272px;display:flex;flex-direction:column}.game-icon{font:600 31px/1 Georgia,serif;color:var(--rust)}.game-card h3{font:600 22px/1.3 "Songti SC",serif;margin:14px 0 9px}.game-card p{font-size:13px;line-height:1.6;color:var(--muted)}.game-card .example{margin-top:auto;padding-top:14px;border-top:1px solid var(--line);font-size:12px;color:var(--pine);font-weight:600}
.game-types{display:grid;gap:8px}.game-type{display:grid;grid-template-columns:92px 1fr;gap:12px;align-items:start;padding:11px 0;border-top:1px solid var(--line)}.game-type:first-child{border-top:0}.game-type b{font:600 14px/1.35 "Songti SC",serif;color:var(--rust)}.game-type span{font-size:12px;line-height:1.5;color:var(--muted)}
.loop{position:relative;height:405px;margin-top:12px}.loop-ring{position:absolute;left:50%;top:50%;width:330px;height:330px;transform:translate(-50%,-50%);border:2px dashed rgba(164,81,55,.28);border-radius:50%;animation:ringBreathe 6s infinite}.loop-center{position:absolute;left:50%;top:50%;width:150px;height:150px;transform:translate(-50%,-50%);border-radius:50%;display:grid;place-items:center;text-align:center;background:var(--pine);color:#fff;font:600 21px/1.35 "Songti SC",serif}.loop-item{position:absolute;width:175px;padding:14px 15px;border-radius:14px;background:var(--white);border:1px solid var(--line);box-shadow:0 10px 28px rgba(48,40,32,.08)}.loop-item b{font:600 17px/1.3 "Songti SC",serif}.loop-item p{font-size:11px;line-height:1.45;color:var(--muted);margin-top:5px}.li1{left:100px;top:36px}.li2{right:85px;top:48px}.li3{right:60px;bottom:38px}.li4{left:78px;bottom:32px}
.numbers{display:grid;grid-template-columns:1.25fr 1fr 1fr 1fr;gap:15px;margin-top:38px}.number-card{min-height:190px;padding:22px}.number-card .n{font:650 40px/1 Georgia,serif;color:var(--rust);letter-spacing:-.04em}.number-card.dark .n{color:var(--gold)}.number-card h3{font:600 17px/1.35 "Songti SC",serif;margin-top:15px}.number-card p{font-size:11px;line-height:1.5;margin-top:9px;color:var(--muted)}.number-card.dark p{color:#d9ddd9}.market-bottom{display:flex;gap:18px;align-items:center;margin-top:18px;padding:14px 18px;background:rgba(37,58,53,.07);border-left:3px solid var(--pine);font-size:13px}
.traction{display:grid;grid-template-columns:1.1fr 1.9fr;gap:24px;margin-top:28px}.signal{padding:23px}.signal .n{font:650 42px/1 Georgia,serif;color:var(--rust)}.signal h3{font:600 17px/1.3 "Songti SC",serif;margin-top:8px}.signal p{font-size:11px;color:var(--muted);margin-top:7px;line-height:1.45}.signals{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}.traction-note{margin-top:14px;font-size:12px;line-height:1.55;color:var(--muted)}
.roadmap{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:32px}.phase{position:relative;padding:23px;min-height:290px}.phase:before{content:"";position:absolute;top:-9px;left:22px;width:18px;height:18px;border-radius:50%;background:var(--rust);border:5px solid var(--paper)}.phase:nth-child(2):before{background:var(--gold)}.phase:nth-child(3):before{background:var(--pine)}.phase h3{font:600 23px/1.3 "Songti SC",serif}.phase .when{font:700 10px/1 ui-monospace,monospace;letter-spacing:.12em;color:var(--rust);margin-bottom:10px}.phase ul{padding:0;margin:16px 0 0;list-style:none;display:grid;gap:9px}.phase li{font-size:13px;line-height:1.4;padding-left:14px;position:relative}.phase li:before{content:"·";position:absolute;left:0;color:var(--rust);font-weight:900}
.team{display:grid;grid-template-columns:.85fr 1.45fr;gap:28px;margin-top:32px}.founder{padding:28px;background:var(--pine);color:white}.founder .portrait{width:76px;height:76px;border-radius:50%;display:grid;place-items:center;border:1px solid rgba(255,255,255,.25);font:600 26px/1 Georgia,serif;background:rgba(255,255,255,.08)}.founder h3{font:600 25px/1.3 "Songti SC",serif;margin-top:19px}.founder p{font-size:13px;line-height:1.65;color:#d7ddda;margin-top:10px}.next-list{display:grid;grid-template-columns:1fr 1fr;gap:14px}.next{padding:19px}.next b{font:600 17px/1.3 "Songti SC",serif}.next p{font-size:12px;line-height:1.5;color:var(--muted);margin-top:8px}.residency{margin-top:14px;padding:13px 16px;border-left:3px solid var(--gold);background:rgba(215,164,82,.1);font-size:12px;line-height:1.5}
.closing{background:linear-gradient(140deg,var(--paper),#e4d8c7)}.closing .quote{position:absolute;left:90px;top:164px;width:900px;font:600 39px/1.5 "Songti SC","STSong",serif;letter-spacing:-.025em}.closing .quote em{font-style:normal;color:var(--rust)}.closing .url{position:absolute;left:92px;bottom:70px;font:600 15px/1 ui-monospace,monospace;color:var(--pine)}.closing .seal{position:absolute;right:106px;bottom:68px;width:112px;height:112px;border-radius:50%;display:grid;place-items:center;text-align:center;background:var(--rust);color:#fff;font:600 17px/1.35 Georgia,serif;transform:rotate(-8deg);box-shadow:0 12px 30px rgba(164,81,55,.25)}
.source{position:absolute;left:66px;bottom:15px;font-size:8px;color:#92887b;max-width:1040px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.user-story+.source{bottom:12px}.notes{display:none;position:absolute;z-index:9;left:30px;right:30px;bottom:28px;max-height:42%;overflow:auto;padding:18px 20px;background:rgba(25,27,25,.96);color:white;border-radius:14px;font-size:13px;line-height:1.6;box-shadow:0 20px 70px #0008}.notes.show{display:block}.notes b{color:var(--gold)}
.edge-hint{position:absolute;z-index:20;top:50%;transform:translateY(-50%);width:54px;height:96px;border:1px solid rgba(255,255,255,.18);border-radius:16px;display:grid;place-items:center;background:rgba(24,27,25,.2);color:white;font:300 35px/1 Georgia,serif;opacity:0;transition:.22s;pointer-events:none;backdrop-filter:blur(8px)}.edge-hint.left{left:16px}.edge-hint.right{right:16px}.deck:hover .edge-hint{opacity:.56}
.click-guide{position:absolute;z-index:20;right:28px;bottom:22px;padding:8px 12px;border-radius:999px;background:rgba(33,31,27,.68);color:white;font:600 10px/1 ui-monospace,monospace;letter-spacing:.06em;opacity:.58;pointer-events:none;transition:.25s}.deck:not(:hover) .click-guide{opacity:.22}
.controls{position:fixed;z-index:50;left:50%;bottom:12px;transform:translateX(-50%);display:flex;gap:8px;align-items:center;padding:7px 10px;border-radius:999px;background:rgba(20,22,20,.78);backdrop-filter:blur(12px);opacity:.34;transition:.2s}.controls:hover{opacity:1}.controls button{border:0;background:transparent;color:white;font-size:15px;width:29px;height:29px;border-radius:50%;cursor:pointer}.controls button:hover{background:#ffffff1c}.progress{width:120px;height:3px;background:#ffffff22;border-radius:4px;overflow:hidden}.progress i{display:block;height:100%;background:var(--gold);width:0;transition:width .45s ease}.count{font:600 10px/1 ui-monospace,monospace;color:#ddd;min-width:38px;text-align:center}
@media print{body{overflow:visible;background:white}.stage{position:static;display:block}.deck{width:1280px;height:auto;box-shadow:none;transform:none!important}.slide{position:relative;display:block!important;visibility:visible!important;opacity:1!important;transform:none!important;width:1280px;height:720px;page-break-after:always}.controls,.edge-hint,.click-guide{display:none}}
</style>
</head>
<body>
<main class="stage"><div class="deck" id="deck">

<section class="slide cover active" data-title="封面">
  <div class="topline"><div class="brand"><span class="brand-mark">✦</span> storyforge</div><span class="page">01 / 16</span></div>
  <div class="title-wrap reveal"><div class="kicker">Narrative World Operating System</div><h1 class="display">StoryForge</h1><div class="sub">让一个想法成为真正的故事，<br>再让故事生长为可持续的世界。</div><div class="promise">从自然语言到长篇作品、互动叙事与社区共创的完整生产路径</div></div>
  <div class="forge reveal d2"><div class="orbit"></div><div class="orbit o2"></div><div class="spark s1"></div><div class="spark s2"></div><div class="spark s3"></div><div class="core">故事<br>熔炉</div></div>
  <div class="notes"><b>约 18 秒</b><br>开场只讲一个判断：AI 时代不缺一段内容，缺的是把一个想法持续做成作品，并让作品拥有后续生命的系统。</div>
</section>

<section class="slide" data-title="问题与解法">
  <div class="topline"><div><div class="kicker"><span class="section-no">01</span>PROJECT THESIS</div><h2 class="slide-title display">一个想法走向完整故事，再走向内容资产，仍然跨越两道断层</h2></div><span class="page">02 / 16</span></div>
  <div class="problem-wrap">
    <div class="problem-step card"><div class="step-no">01 · 灵感起点</div><h3>想法缺少持续生长的结构</h3><p>主题、角色和冲突容易停留在零散灵感，创作者需要把它组织成能够推进、审校和完成的故事。</p></div>
    <div class="problem-step card"><div class="step-no">02 · 作品形成</div><h3>长故事需要跨越时间的一致性</h3><p>事实、人物、伏笔、节奏与文风要在漫长创作过程中持续协同，普通生成工具难以维护完整上下文。</p></div>
    <div class="problem-step card"><div class="step-no">03 · 价值延展</div><h3>故事需要进入新的内容生命周期</h3><p>创作、游玩、分享和共同创作分散在不同工具中，故事背后的世界结构很难被继续利用。</p></div>
  </div>
  <div class="solution-band reveal d4"><b>StoryForge 的解法</b><span>把灵感组织成完整故事，以世界引擎沉淀可复用结构，再生成可运行、可分享、可共同创作的内容资产。</span></div>
  <div class="notes"><b>约 25 秒</b><br>这页先建立完整问题空间：灵感到故事是一道断层，故事到内容资产是第二道断层。StoryForge 提供连续生产路径。</div>
</section>

<section class="slide" data-title="完整路径">
  <div class="topline"><div><div class="kicker"><span class="section-no">02</span>CORE PATH</div><h2 class="slide-title display">StoryForge 让想法成为故事，让故事成为可持续的内容资产</h2></div><span class="page">03 / 16</span></div>
  <div class="journey-v2">
    <div class="journey-stage"><div class="phase-title">STAGE 01<strong>让想法成为故事</strong></div><div class="stage-flow"><div class="flow-node">一个<br>想法</div><div class="flow-arrow">→</div><div class="flow-node">完整<br>故事</div></div><div class="stage-caption">从自然语言出发，形成可规划、可写作、可审校的故事结构</div></div>
    <div class="journey-stage"><div class="phase-title">STAGE 02<strong>让故事成为可运行资产</strong></div><div class="engine-to-instance"><div class="engine-core">世界<br>引擎</div><div class="flow-arrow">→</div><div class="instance-box"><strong>可运行实例</strong><div class="instance-grid"><div class="instance-chip">长篇小说</div><div class="instance-chip">多人跑团</div><div class="instance-chip">角色互动</div><div class="instance-chip">叙事游戏</div></div></div></div><div class="stage-caption">世界事实与版本保持稳定；每种创作和游玩活动在独立实例中运行</div></div>
    <div class="journey-stage"><div class="phase-title">STAGE 03<strong>让内容进入共同生态</strong></div><div class="stage-flow"><div class="flow-node">分享<br>游玩</div><div class="flow-arrow">→</div><div class="flow-node main">持续<br>演化</div></div><div class="stage-caption">作品被发现、改编和共同创作，并保留来源与世界版本关系</div></div>
  </div>
  <div class="user-story"><b>USER STORY</b><span>“我从一句设定开始完成故事；世界引擎保存其中的事实与规则，随后我和读者可以继续创作、游玩和分享。”</span></div>
  <div class="notes"><b>约 28 秒</b><br>这页是全场总图。三个阶段依次回答：故事怎样形成、世界怎样运行、内容怎样进入社区生态。四种产品形态明确归属于可运行实例。</div>
</section>

<section class="slide" data-title="世界引擎">
  <div class="topline"><div><div class="kicker"><span class="section-no">03</span>FOUNDATION</div><h2 class="slide-title display">世界引擎先于所有玩法：一套事实，多种叙事实例</h2></div><span class="page">04 / 16</span></div>
  <div class="feature-layout">
    <div class="feature-copy reveal d1"><span class="tag now">已形成工作台</span><h3>把设定从“提示词”升级为可继承、可冻结、可发布的世界资产</h3><div class="engine-pillars"><div class="mini"><b>Canon</b><p>世界事实与角色规则</p></div><div class="mini"><b>Blueprint</b><p>故事、角色与叙事结构</p></div><div class="mini"><b>Instance</b><p>写作与游玩状态隔离</p></div></div><div class="bullets"><div class="bullet"><i>1</i><span>同一世界被小说、跑团、聊天和游戏复用</span></div><div class="bullet"><i>2</i><span>发布版本不可变，实例事件不会反向污染 Canon</span></div><div class="bullet"><i>3</i><span>本地优先：原稿与世界资料默认不上传</span></div></div></div>
    <div class="screen reveal d2"><img src="${img.world}" alt="StoryForge 世界引擎真实界面"></div>
  </div>
  <div class="user-story"><b>USER STORY</b><span>“我只维护一次世界规则，小说续写、跑团战役和角色聊天都从同一个可信版本出发。”</span></div>
  <div class="notes"><b>约 22 秒</b><br>说明当前世界工作台已经存在；“可执行叙事蓝图、统一实例和社区版本网络”属于下一阶段，不要说成已全部完成。</div>
</section>

<section class="slide" data-title="长篇小说">
  <div class="topline"><div><div class="kicker"><span class="section-no">04</span>LONG-FORM CREATION</div><h2 class="slide-title display">长篇本身就是核心价值：目标是数百万字仍然记得前因后果</h2></div><span class="page">05 / 16</span></div>
  <div class="feature-layout">
    <div class="feature-copy reveal d1"><span class="tag now">当前主要用户入口</span><div class="million">百万字级一致性</div><p class="small">系统把创作拆成可治理、可回查、可复用的结构，并按需组合当前章节需要的上下文。</p><div class="equation"><span>世界事实</span><i>+</i><span>角色弧光</span><i>+</i><span>伏笔 / 状态</span><i>+</i><span>相关前文</span></div><div class="bullets"><div class="bullet"><i>1</i><span>卷纲 → 章纲 → 场景 → 正文的分阶段工作流</span></div><div class="bullet"><i>2</i><span>事实提取、影响分析、质量审校与章节记忆</span></div><div class="bullet"><i>3</i><span>创作者确认后写回，保留人的控制权</span></div></div></div>
    <div class="screen reveal d2"><img src="${img.longform}" alt="StoryForge 长篇章节编辑真实界面"></div>
  </div>
  <div class="user-story"><b>USER STORY</b><span>“我只想写网文：StoryForge 帮我维护卷章结构、角色关系和数百章之后仍要兑现的伏笔。”</span></div>
  <div class="notes"><b>约 25 秒</b><br>明确“数百万字”是目标能力边界，不是声称已经做完百万字公开基准。现场 demo 选短路径展示结构如何支撑长篇。</div>
</section>

<section class="slide" data-title="节点创作">
  <div class="topline"><div><div class="kicker"><span class="section-no">05</span>CREATIVE CONTROL</div><h2 class="slide-title display">同一套底层数据，也能变成可观察、可回放的创作图</h2></div><span class="page">06 / 16</span></div>
  <div class="feature-layout">
    <div class="feature-copy reveal d1"><span class="tag now">高级创作入口</span><h3>节点创作为进阶用户提供可自由编排的工作流</h3><div class="bullets"><div class="bullet"><i>1</i><span>自由连接世界观、故事、角色、执行控制和输出节点</span></div><div class="bullet"><i>2</i><span>运行过程可观察、可回放，结果先成为候选</span></div><div class="bullet"><i>3</i><span>确认采纳后才写回项目，避免 AI 直接污染资料库</span></div></div><p class="small">分步骤写作降低门槛；节点创作提供自由度。两种入口共享同一世界与治理边界。</p></div>
    <div class="screen reveal d2"><img src="${img.node}" alt="StoryForge 节点创作真实界面"></div>
  </div>
  <div class="user-story"><b>USER STORY</b><span>“我不想按固定步骤写：我可以把角色支线、世界事件和审校节点组合成自己的生产线。”</span></div>
  <div class="notes"><b>约 18 秒</b><br>这页用于证明产品并非只有一种工作流，也展示了 AI 写回治理能力。</div>
</section>

<section class="slide" data-title="多人跑团">
  <div class="topline"><div><div class="kicker"><span class="section-no">06</span>MULTIPLAYER TTRPG</div><h2 class="slide-title display">多人进入同一个世界，共同创造一条新的历史</h2></div><span class="page">07 / 16</span></div>
  <div class="feature-layout">
    <div class="feature-copy reveal d1"><div><span class="tag now">当前：本地单人战役</span> <span class="tag future">下一步：多人房间</span></div><div class="players"><div class="avatar">GM</div><div class="avatar">A</div><div class="avatar">B</div><div class="avatar">C</div></div><h3>玩家共享一个世界版本，各自拥有角色、秘密、行动与后果</h3><div class="bullets"><div class="bullet"><i>1</i><span>AI / 真人主持人、确定性骰子、战斗与事件回放已具备本地基座</span></div><div class="bullet"><i>2</i><span>多人阶段加入房间、席位、同步状态与权限</span></div><div class="bullet"><i>3</i><span>战役事件保存在实例中，可整理为世界支线或新作品</span></div></div></div>
    <div class="screen reveal d2"><img src="${img.ttrpg}" alt="StoryForge 跑团真实界面"></div>
  </div>
  <div class="user-story"><b>USER STORY</b><span>“四位朋友进入我小说的同一个世界：一人主持、三人扮演角色，每次选择都成为这条世界线的新历史。”</span></div>
  <div class="notes"><b>约 25 秒</b><br>明确当前是单人/本地，真正的多人协作依赖后续平台层；但它不是另起炉灶，而是复用现有战役、骰子、战斗和回放基座。</div>
</section>

<section class="slide" data-title="角色互动">
  <div class="topline"><div><div class="kicker"><span class="section-no">07</span>CHARACTER INTERACTION</div><h2 class="slide-title display">角色以世界事实、身份与记忆持续存在</h2></div><span class="page">08 / 16</span></div>
  <div class="feature-layout">
    <div class="feature-copy reveal d1"><div><span class="tag now">当前：单角色分支聊天</span> <span class="tag future">未来：多角色冒险</span></div><h3>冻结世界与角色快照，让对话有身份、场景、记忆与后果</h3><div class="bullets"><div class="bullet"><i>1</i><span>选择角色、用户身份与场景后建立独立会话</span></div><div class="bullet"><i>2</i><span>支持重生成、检查点和分支，不破坏原始世界</span></div><div class="bullet"><i>3</i><span>下一阶段扩展长期记忆、多角色房间和角色关系演化</span></div></div></div>
    <div class="screen reveal d2"><img src="${img.chat}" alt="StoryForge 角色聊天真实界面"></div>
  </div>
  <div class="user-story"><b>USER STORY</b><span>“读者可以以记者的身份采访小说中的反派；这段关系有上下文，也能发展成一条新的支线。”</span></div>
  <div class="notes"><b>约 20 秒</b><br>角色互动与通用陪聊的区别是它有世界事实、角色快照和实例边界。</div>
</section>

<section class="slide" data-title="文字游戏形态">
  <div class="topline"><div><div class="kicker"><span class="section-no">08</span>NARRATIVE GAMES</div><h2 class="slide-title display">文字游戏把故事结构转化为选择、状态、分支与结局</h2></div><span class="page">09 / 15</span></div>
  <div class="feature-layout">
    <div class="feature-copy reveal d1"><div><span class="tag now">当前：实验入口</span> <span class="tag future">下一步：编辑与发布</span></div><h3>同一世界可以生成三类可玩的叙事产品</h3><div class="game-types"><div class="game-type"><b>分支冒险</b><span>作者设置关键节点与结局，玩家选择改变关系、资源和路线。</span></div><div class="game-type"><b>系统叙事</b><span>规则、状态和事件系统共同组织生存、经营与开放探索。</span></div><div class="game-type"><b>社区衍生</b><span>读者基于已发布的世界制作番外、支线和新的可玩版本。</span></div></div><p class="small">当前界面已完成世界绑定入口；选择、状态、分支编辑器与发布游玩闭环正在汇合。</p></div>
    <div class="screen reveal d2"><img src="${img.game}" alt="StoryForge 文字游戏真实界面"></div>
  </div>
  <div class="user-story"><b>USER STORY</b><span>“我从自己的故事和世界设定出发，就能制作一款拥有选择、状态与结局的叙事游戏。”</span></div>
  <div class="notes"><b>约 27 秒</b><br>先用真实界面证明文字游戏已经进入产品导航和世界绑定体系，再解释三种目标形态与当前实验边界。</div>
</section>

<section class="slide" data-title="社区飞轮">
  <div class="topline"><div><div class="kicker"><span class="section-no">09</span>COMMUNITY LOOP</div><h2 class="slide-title display">世界进入社区后，在发布、游玩、改编与共创中持续演化</h2></div><span class="page">10 / 16</span></div>
  <div class="loop reveal d1"><div class="loop-ring"></div><div class="loop-center">可持续的<br>叙事世界</div><div class="loop-item li1"><b>创作与发布</b><p>冻结世界版本、作品与授权边界</p></div><div class="loop-item li2"><b>发现与游玩</b><p>导入世界，进入小说、战役或游戏实例</p></div><div class="loop-item li3"><b>改编与共创</b><p>制作支线、角色故事与新玩法</p></div><div class="loop-item li4"><b>反馈与演化</b><p>以结构化提案形成新的世界版本</p></div></div>
  <div class="user-story"><b>USER STORY</b><span>“我发布一个可追溯版本的世界；其他人可以阅读、游玩、改编，并把新作品连接回它的来源。”</span></div>
  <div class="notes"><b>约 22 秒</b><br>说明社区不是普通帖子流，而是围绕世界版本和衍生关系形成的内容网络。</div>
</section>

<section class="slide" data-title="市场窗口">
  <div class="topline"><div><div class="kicker"><span class="section-no">10</span>MARKET WINDOW</div><h2 class="slide-title display">创作供给、AI 使用与互动消费已经同时成立</h2></div><span class="page">11 / 16</span></div>
  <div class="numbers">
    <div class="card dark number-card reveal d1"><div class="n">502.1 亿</div><h3>中国网络文学阅读市场</h3><p>2025 年；作品生产本身已经是大规模产业。</p></div>
    <div class="card number-card reveal d2"><div class="n">3269 万</div><h3>网文作者规模</h3><p>庞大的创作者群体已经构成明确的生产者市场。</p></div>
    <div class="card number-card reveal d3"><div class="n">85%+</div><h3>签约作者每周使用 AI 辅助</h3><p>AI 已进入工作流，但直接完成高质量长篇仍然困难。</p></div>
    <div class="card number-card reveal d4"><div class="n">100 亿+</div><h3>Episode 互动章节观看</h3><p>全球用户已经证明叙事内容可以被持续“玩”。</p></div>
  </div>
  <div class="market-bottom reveal d5"><b>StoryForge 的窗口：</b><span>连接“庞大的故事生产”与“成熟的互动消费”，让同一份世界资产跨越两类市场。</span></div>
  <div class="source">来源：中科院《2025中国网络文学发展研究报告》；中国作家网《2024中国网络文学蓝皮书》报道；Episode 官方首页。详细链接见演讲者备注。</div>
  <div class="notes"><b>约 25 秒</b><br>不要把四个数字简单相加成 TAM。它们分别证明：供给规模、创作者规模、AI 行为迁移和互动叙事消费都已经发生。<br><br><b>Sources</b><br>${sources.market.join("<br>")}</div>
</section>

<section class="slide" data-title="早期验证">
  <div class="topline"><div><div class="kicker"><span class="section-no">11</span>EARLY SIGNALS</div><h2 class="slide-title display">初期项目，但需求已经从代码仓库扩散到内容社区</h2></div><span class="page">12 / 16</span></div>
  <div class="traction">
    <div class="card dark reveal d1"><div class="kicker" style="color:var(--gold)">CURRENT PROOF</div><h3 class="display" style="font-size:29px;line-height:1.35;margin-top:13px">当前验证主要来自<br>长篇创作用户</h3><p style="color:#d8dfdc;font-size:13px;line-height:1.65;margin-top:15px">长篇工作流提供高频、强痛点的产品切入口；创作者沉淀的故事与世界将继续释放互动价值。</p><div class="traction-note" style="color:#bfcac5">已有社群用户反馈将作品发布到网文平台并获得持续追读；案例仍在征集可公开证明材料，路演不使用未经核验的收益数字。</div></div>
    <div><div class="signals"><div class="card signal reveal d1"><div class="n">520+</div><h3>GitHub Stars</h3><p>同时有 95 Forks、798 次提交（2026-08-16）。</p></div><div class="card signal reveal d2"><div class="n">≈ 1,000</div><h3>社群成员</h3><p>项目方口径；表示触达规模，不等于活跃创作者。</p></div><div class="card signal reveal d3"><div class="n">6,272</div><h3>近 14 日仓库浏览事件</h3><p>2026-07-31—08-13 的 14 个完整归档日。</p></div><div class="card signal reveal d4"><div class="n">1,290</div><h3>近 14 日完整克隆事件</h3><p>GitHub clone events，不代表 1,290 个独立用户。</p></div><div class="card signal reveal d5" style="grid-column:1/3"><div class="n">34,595</div><h3>教程合集累计播放</h3><p>其中主视频约 28,198 播放、2,864 收藏；说明用户愿意投入时间学习和尝试。</p></div></div><div class="traction-note">本地优先意味着无法统一统计生成字数和活跃创作者；这是隐私边界，也是下一阶段需要通过自愿、匿名化指标补足的产品验证能力。</div></div>
  </div>
  <div class="source">来源：GitHub 仓库与 Traffic 自存档、Bilibili 页面、项目方社群口径；所有事件量均非独立人数。</div>
  <div class="notes"><b>约 30 秒</b><br>先讲“信号”，不讲“规模神话”。GitHub 官方只提供近 14 天窗口，所以主页面只放最近 14 个完整归档日；历史累计存档可留作问答。<br><br><b>Sources</b><br>${sources.traction.join("<br>")}</div>
</section>

<section class="slide" data-title="路线图">
  <div class="topline"><div><div class="kicker"><span class="section-no">12</span>ROADMAP</div><h2 class="slide-title display">三阶段把创作基座扩展为可运行的世界网络</h2></div><span class="page">13 / 16</span></div>
  <div class="roadmap">
    <div class="card phase reveal d1"><div class="when">NOW · 已有基座</div><h3>完成作品</h3><ul><li>长篇分阶段写作与一致性治理</li><li>世界引擎工作台与本地世界包</li><li>节点创作、单人跑团、单角色聊天</li><li>开源社区与内容教程入口</li></ul></div>
    <div class="card phase reveal d2"><div class="when">NEXT · 产品闭环</div><h3>让世界运行</h3><ul><li>可执行叙事蓝图与统一实例状态</li><li>文字游戏编辑、发布与游玩闭环</li><li>多人跑团房间与多角色互动</li><li>匿名化、可选择的使用反馈指标</li></ul></div>
    <div class="card phase reveal d3"><div class="when">LATER · 生态网络</div><h3>让世界演化</h3><ul><li>创作者身份、云同步与世界发现</li><li>版本、授权、来源与衍生关系</li><li>结构化共创提案与协作工作流</li><li>创作、游玩、改编与分发市场</li></ul></div>
  </div>
  <div class="notes"><b>约 25 秒</b><br>这页回答评审最关心的“初期项目凭什么继续成长”：已有基座不是终点，下一步每项都能沿当前架构自然扩展。</div>
</section>

<section class="slide" data-title="当前阶段与下一步">
  <div class="topline"><div><div class="kicker"><span class="section-no">13</span>CURRENT STAGE & NEXT</div><h2 class="slide-title display">当前形成创作与世界基座，下一阶段推进产品闭环和社区生态</h2></div><span class="page">14 / 15</span></div>
  <div class="team">
    <div class="card founder reveal d1"><div class="portrait">NOW</div><h3>独立开发者持续开发<br>社区共同参与</h3><p>长篇创作、世界引擎、节点创作和本地互动实例已经形成初期产品基座，并持续吸收真实用户反馈。</p><p style="margin-top:18px;color:var(--gold)">500+ Stars · 近千人社群 · 持续版本迭代</p></div>
    <div class="reveal d2"><div class="next-list"><div class="card next"><b>产品闭环</b><p>完成文字游戏编辑发布、多人跑团和多角色互动。</p></div><div class="card next"><b>公开案例</b><p>建立授权、脱敏的创作者成果库与定量验证体系。</p></div><div class="card next"><b>协作团队</b><p>补充前端、游戏设计、内容运营与社区治理能力。</p></div><div class="card next"><b>社区生态</b><p>形成世界发布、发现、游玩、改编和共创的最小闭环。</p></div></div><div class="residency"><b>入驻后将围绕产品闭环、公开案例和协作团队，</b>加快从开源工具进入可持续产品与社区生态。</div></div>
  </div>
  <div class="notes"><b>约 25 秒</b><br>客观说明项目当前处于初期产品基座阶段；下一阶段集中完成产品闭环、公开案例、协作团队和社区生态。</div>
</section>

<section class="slide closing" data-title="收束">
  <div class="topline"><div class="brand"><span class="brand-mark">✦</span> storyforge</div><span class="page">15 / 15</span></div>
  <div class="quote reveal">StoryForge 希望让一个人从一个想法开始，<br>完成一部真正的作品；<br>再以<em>世界引擎</em>为基座，让它成为小说、多人跑团、角色关系与叙事游戏，<br>最终拥有被共同创造、持续演化的生命。</div>
  <div class="url reveal d2">github.com/yuanbw2025/storyforge</div><div class="seal reveal d3">MAKE<br>WORLDS<br>LIVE</div>
  <div class="notes"><b>约 18 秒</b><br>最后回到愿景，但把所有必要节点完整说清。停顿，感谢评审，进入问答。</div>
</section>

<div class="transition-wipe" id="transitionWipe"></div><div class="edge-hint left">‹</div><div class="edge-hint right">›</div><div class="click-guide" id="clickGuide">点击页面继续 →</div>
</div></main>
<div class="controls"><button id="prev" aria-label="上一页">‹</button><div class="progress"><i id="bar"></i></div><span class="count" id="count">1 / 15</span><button id="next" aria-label="下一页">›</button><button id="full" aria-label="全屏">⛶</button><button id="note" aria-label="演讲者备注">N</button></div>
<script>
const deckEl=document.getElementById('deck'),rawSlides=[...document.querySelectorAll('.slide')];
const deckOrder=[0,1,2,3,4,5,6,7,8,10,11,9,12,13,14],slides=deckOrder.map(i=>rawSlides[i]);
const anchor=deckEl.querySelector('.transition-wipe');slides.forEach(slide=>deckEl.insertBefore(slide,anchor));
const chapterLabels=['01 项目主题','02 核心路径','03 衍生产品','04 市场需求','05 未来愿景'];
const chapterBySlide=[0,0,1,1,2,2,2,2,2,3,3,4,4,4,4];
slides.forEach((slide,i)=>{const current=chapterBySlide[i];slide.querySelector('.page').textContent=String(i+1).padStart(2,'0')+' / '+slides.length;const rail=document.createElement('div');rail.className='chapter-rail';rail.innerHTML=chapterLabels.map((label,n)=>'<span class="chapter-step '+(n<current?'done':n===current?'current':'')+'">'+label+'</span>').join('');slide.prepend(rail)});
let index=0,animTimer=0,transitionId=0;
function fitDeck(){const scale=Math.max(.1,Math.min((window.innerWidth-24)/1280,(window.innerHeight-72)/720));deckEl.style.setProperty('--deck-scale',scale.toFixed(4));}
function syncChrome(){document.getElementById('count').textContent=(index+1)+' / '+slides.length;document.getElementById('bar').style.width=((index+1)/slides.length*100)+'%';document.getElementById('clickGuide').hidden=index!==0;document.title='StoryForge · '+slides[index].dataset.title;}
function triggerWipe(direction){const wipe=document.getElementById('transitionWipe');wipe.classList.remove('next','prev');void wipe.offsetWidth;wipe.classList.add(direction>0?'next':'prev')}
function show(n,direction=1,instant=false){const target=(n+slides.length)%slides.length;if(target===index&&!instant)return;const token=++transitionId;clearTimeout(animTimer);const old=slides[index],nextSlide=slides[target];slides.forEach(s=>{s.querySelector('.notes')?.classList.remove('show');s.classList.remove('enter-next','enter-prev','leaving-next','leaving-prev');if(s!==old&&s!==nextSlide)s.classList.remove('active')});if(instant){slides.forEach((s,i)=>s.classList.toggle('active',i===target));index=target;syncChrome();return}old.classList.remove('active');old.classList.add(direction>0?'leaving-next':'leaving-prev');nextSlide.classList.remove('active');void nextSlide.offsetWidth;nextSlide.classList.add('active',direction>0?'enter-next':'enter-prev');index=target;syncChrome();triggerWipe(direction);animTimer=setTimeout(()=>{if(token!==transitionId)return;slides.forEach((s,i)=>{s.classList.remove('enter-next','enter-prev','leaving-next','leaving-prev');s.classList.toggle('active',i===index)})},820)}
function next(){show(index+1,1)} function prev(){show(index-1,-1)}
document.getElementById('next').onclick=next;document.getElementById('prev').onclick=prev;document.getElementById('full').onclick=()=>document.documentElement.requestFullscreen?.();document.getElementById('note').onclick=()=>slides[index].querySelector('.notes')?.classList.toggle('show');
deckEl.addEventListener('click',e=>{if(e.target.closest('.notes'))return;const r=deckEl.getBoundingClientRect(),x=e.clientX-r.left;x<r.width*.28?prev():next()});
document.addEventListener('keydown',e=>{if(['ArrowRight','PageDown',' ','Enter'].includes(e.key)){e.preventDefault();next()}if(['ArrowLeft','PageUp','Backspace'].includes(e.key)){e.preventDefault();prev()}if(e.key.toLowerCase()==='f')document.documentElement.requestFullscreen?.();if(e.key.toLowerCase()==='n')slides[index].querySelector('.notes')?.classList.toggle('show');if(e.key==='Home')show(0,-1);if(e.key==='End')show(slides.length-1,1)});
let startX=0,lastWheelAt=0;document.addEventListener('touchstart',e=>startX=e.touches[0].clientX,{passive:true});document.addEventListener('touchend',e=>{const d=e.changedTouches[0].clientX-startX;if(Math.abs(d)>50)(d<0?next:prev)()},{passive:true});deckEl.addEventListener('wheel',e=>{if(Math.max(Math.abs(e.deltaX),Math.abs(e.deltaY))<18)return;e.preventDefault();const now=performance.now();if(now-lastWheelAt<420)return;lastWheelAt=now;(e.deltaX+e.deltaY)>0?next():prev()},{passive:false});
window.addEventListener('resize',fitDeck);window.addEventListener('orientationchange',fitDeck);fitDeck();show(0,1,true);
</script>
</body></html>`;

await fs.writeFile(output, html);
console.log(`Wrote ${output}`);
