// Pixel checks for what the eye catches and the interaction suite does not.
//
//   arrow flicker  The arrows sat a fraction of a px above the face, and the depth buffer could
//                  not tell them apart, so the arrow lost pixels to the face depending on where
//                  the cube landed on screen. Renders the rest state at 31 viewport heights and
//                  fails if the arrow's ink coverage swings more than 6%.
//   flat at rest   An unpressed button has to read as a flat square, like a plain interface.
//                  Perspective showed a sliver of the cube's underside, so the button drew
//                  taller than wide. Fails if the up cube's painted box is not square.
//
//   node scripts/render-checks.mjs [url]
import { chromium, webkit } from "playwright";
import { PNG } from "pngjs";

const url = process.argv[2] ?? "http://127.0.0.1:5199/";
let failed = false;

function report(ok, label, detail) {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}: ${detail}`);
  if (!ok) failed = true;
}

const isPaper = (r, g, b) => r > 245 && g > 245 && b > 245;

for (const engine of [chromium, webkit]) {
  const name = engine.name();
  const browser = await engine.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(url);
  await page.waitForTimeout(300);

  const coverage = [];
  let shape = null;
  for (let h = 800; h <= 830; h++) {
    await page.setViewportSize({ width: 1280, height: h });
    await page.waitForTimeout(60);
    const box = await page.locator('[data-dir="up"]').boundingBox();
    const png = PNG.sync.read(await page.screenshot());
    const at = (x, y) => {
      const i = (png.width * Math.round(y) + Math.round(x)) * 4;
      return [png.data[i], png.data[i + 1], png.data[i + 2]];
    };
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Painted extent of the up cube along its centre lines, from the arrow-free edges inward.
    const pad = box.width;
    let top = cy - pad;
    while (top < cy && isPaper(...at(cx - box.width * 0.3, top))) top++;
    let bottom = cy + pad;
    while (bottom > cy && isPaper(...at(cx - box.width * 0.3, bottom))) bottom--;
    let left = cx - pad;
    while (left < cx && isPaper(...at(left, cy - box.height * 0.3))) left++;
    let right = cx + pad;
    while (right > cx && isPaper(...at(right, cy - box.height * 0.3))) right--;
    const w = right - left + 1;
    const hgt = bottom - top + 1;
    if (h === 800) shape = { w, h: hgt };

    // Summed darkness against the face, so anti-aliased edge pixels count by how dark they are.
    let ink = 0;
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const [r] = at(x, y);
        ink += Math.max(0, Math.min(1, (228 - r) / (228 - 26)));
      }
    }
    coverage.push(ink / (w * w));
  }

  const min = Math.min(...coverage);
  const max = Math.max(...coverage);
  const swing = (max - min) / max;
  report(swing <= 0.06, `${name} arrow ink swing over 31 heights`, `${(swing * 100).toFixed(1)}% (min ${min.toFixed(4)}, max ${max.toFixed(4)})`);
  report(Math.abs(shape.w - shape.h) <= 1, `${name} up cube at rest is square`, `${shape.w} wide, ${shape.h} tall`);
  await browser.close();
}

process.exit(failed ? 1 : 0);
