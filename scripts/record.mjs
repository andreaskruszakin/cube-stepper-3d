// Renders the X cut: a scripted take played frame by frame on a virtual clock, so every take
// is identical and no frame is dropped. Writes exports/cube-stepper-x.mp4 at 1920 by 1080,
// 60fps, H.264 High CRF 14. The take ends where it starts (0, gray), so it loops on X.
//
//   node scripts/record.mjs [url]        needs the dev server or a preview running
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";

const url = (process.argv[2] ?? "http://127.0.0.1:5199/") + "?record";
const FPS = 60;
const FRAMES = "out/frames";
const OUT = "exports/cube-stepper-x.mp4";

// The take, as [seconds, action]. Holds repeat on the same curve as the live page: a step,
// 380ms, then intervals from 140ms shrinking by 0.88 to 35ms, with the hop growing as they do.
const events = [];
let value = 0;
let lastPress = 0;

function tap(t, dir) {
  events.push([t, "hold", dir, true], [t, "press", dir, 1], [t + 0.09, "hold", dir, false]);
  value = Math.max(0, value + (dir === "up" ? 1 : value > 0 ? -1 : 0));
  lastPress = t;
}

function hold(t, dir, until) {
  events.push([t, "hold", dir, true], [t, "press", dir, 1]);
  value = Math.max(0, value + (dir === "up" ? 1 : -1));
  let at = t + 0.38;
  let interval = 140;
  let refused = 0;
  while (!until(at, refused)) {
    interval = Math.max(35, interval * 0.88);
    if (dir === "down" && value === 0) refused++;
    events.push([at, "press", dir, 1 + (140 - interval) / 70]);
    value = Math.max(0, value + (dir === "up" ? 1 : -1));
    lastPress = at;
    at += interval / 1000;
  }
  events.push([at, "hold", dir, false]);
  return at;
}

tap(0.8, "up");
tap(1.25, "up");
tap(1.7, "up");
let t = hold(2.3, "up", (at) => at >= 4.6);
events.push([lastPress + 1.4, "settle"]);
t = lastPress + 2.2;
tap(t, "down");
tap(t + 0.4, "down");
hold(t + 1.0, "down", (_, refused) => refused >= 3);
const settleAt = lastPress + 1.4;
events.push([settleAt, "settle"]);
const duration = settleAt + 1.2;
events.sort((a, b) => a[0] - b[0]);

rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });
mkdirSync("exports", { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(url);
await page.evaluate(() => document.fonts.ready);

const total = Math.ceil(duration * FPS);
let next = 0;
for (let frame = 0; frame < total; frame++) {
  const now = frame / FPS;
  const due = [];
  while (next < events.length && events[next][0] <= now) due.push(events[next++]);
  await page.evaluate(
    ({ due, dt }) => {
      const s = window.stepper;
      for (const [, kind, dir, arg] of due) {
        if (kind === "press") s.press(dir, arg);
        else if (kind === "hold") s.hold(dir, arg);
        else s.settle();
      }
      s.advance(dt);
    },
    { due, dt: frame === 0 ? 0 : 1 / FPS },
  );
  await page.screenshot({ path: `${FRAMES}/${String(frame).padStart(5, "0")}.png` });
  if (frame % 120 === 0) console.log(`frame ${frame}/${total}`);
}
await browser.close();

execFileSync("ffmpeg", [
  "-v", "error", "-y",
  "-framerate", String(FPS),
  "-i", `${FRAMES}/%05d.png`,
  "-c:v", "libx264", "-profile:v", "high", "-preset", "slow", "-crf", "14",
  "-pix_fmt", "yuv420p", "-movflags", "+faststart",
  OUT,
]);
console.log(`wrote ${OUT}, ${total} frames, ${duration.toFixed(2)}s`);
