// Drives the stepper the way a person does: real pointer holds on the cubes, then keys.
// Fails loudly when a path breaks, and leaves screenshots in out/ for the hand-back.
//
//   node scripts/verify.mjs [url]        runs Chromium and WebKit against the dev server
import { chromium, webkit } from "playwright";
import { mkdirSync } from "node:fs";

const url = process.argv[2] ?? "http://127.0.0.1:5197/";
mkdirSync("out", { recursive: true });

const value = (page) => page.locator(".value span:last-child").textContent();

function expect(label, actual, test) {
  if (!test(actual)) throw new Error(`${label}: got ${actual}`);
  console.log(`ok  ${label}: ${actual}`);
}

for (const engine of [chromium, webkit]) {
  const name = engine.name();
  const browser = await engine.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `out/${name}-rest.png` });

  const upBox = await page.locator('[data-dir="up"]').boundingBox();
  const downBox = await page.locator('[data-dir="down"]').boundingBox();
  const centre = (b) => [b.x + b.width / 2, b.y + b.height / 2];

  // One tap is one step.
  await page.mouse.move(...centre(upBox));
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(60);
  await page.screenshot({ path: `out/${name}-mid-roll.png` });
  expect(`${name} tap up`, await value(page), (v) => v === "1");

  // A held press repeats and speeds up.
  await page.mouse.down();
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `out/${name}-holding.png` });
  await page.mouse.up();
  const held = Number(await value(page));
  expect(`${name} hold up 1.6s`, held, (v) => v > 15);

  // Releasing stops the repeat.
  await page.waitForTimeout(300);
  expect(`${name} release stops`, Number(await value(page)), (v) => v === held);

  // Dragging off the cube while held still releases on pointer up.
  await page.mouse.move(...centre(downBox));
  await page.mouse.down();
  await page.mouse.move(40, 40, { steps: 5 });
  await page.waitForTimeout(500);
  await page.mouse.up();
  const afterDrag = Number(await value(page));
  await page.waitForTimeout(300);
  expect(`${name} drag-off release`, Number(await value(page)), (v) => v === afterDrag && v < held);

  // Keys.
  await page.keyboard.press("ArrowUp");
  expect(`${name} ArrowUp`, Number(await value(page)), (v) => v === afterDrag + 1);
  await page.locator('[data-dir="down"]').focus();
  await page.keyboard.press("Enter");
  expect(`${name} Enter on focused down`, Number(await value(page)), (v) => v === afterDrag);

  // Down at zero is refused.
  for (let i = 0; i < afterDrag + 3; i++) await page.keyboard.press("ArrowDown");
  expect(`${name} floor at 0`, await value(page), (v) => v === "0");

  // After the settle the cubes roll back to gray and the loop goes to sleep.
  await page.waitForTimeout(2600);
  const frames = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const gl = document.querySelector("#stage").getContext("webgl2");
        let draws = 0;
        const original = gl.drawElements.bind(gl);
        gl.drawElements = (...args) => {
          draws++;
          return original(...args);
        };
        setTimeout(() => resolve(draws), 500);
      }),
  );
  expect(`${name} idle draws in 500ms`, frames, (v) => v === 0);
  await page.screenshot({ path: `out/${name}-settled.png` });

  expect(`${name} page errors`, errors.length, (v) => v === 0);
  await browser.close();
}
