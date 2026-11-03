import "@fontsource-variable/geist";
import "./style.css";
import * as THREE from "three";
import { GRAY, ORANGE, PINK, StepperCube } from "./cube";
import { Bits } from "./particles";

const canvas = document.querySelector<HTMLCanvasElement>("#stage")!;
const output = document.querySelector<HTMLOutputElement>(".value")!;
const upButton = document.querySelector<HTMLButtonElement>('[data-dir="up"]')!;
const downButton = document.querySelector<HTMLButtonElement>('[data-dir="down"]')!;

const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

// `?record` hands the clock to scripts/record.mjs: no frame loop, no timers, seeded bits, and
// a larger cube for a 1920 by 1080 frame. The script drives presses and advances time itself.
const recording = new URLSearchParams(location.search).has("record");

// preserveDrawingBuffer keeps the last frame readable once the loop sleeps, which screenshots
// and the frame-by-frame recorder depend on.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setClearColor("#fdfdfd");

const scene = new THREE.Scene();
// Flat front light keeps the front faces at their true colour; the key from above lifts the
// top faces and darkens the undersides, which is what makes the boxes read as boxes.
// Three's lights are physically based and Lambert divides by pi, so the intensities carry it.
scene.add(new THREE.AmbientLight("#ffffff", 0.62 * Math.PI));
const key = new THREE.DirectionalLight("#ffffff", 0.62 * Math.PI);
key.position.set(0.3, 1, 0.8);
scene.add(key);

// Orthographic, one world unit to one CSS px. A button at rest shows only its front face, so it
// reads as a flat square like any interface; the depth only appears while it rolls. The tight
// near and far planes also keep the arrows from fighting the face in the depth buffer.
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);
camera.position.z = 2000;

const up = new StepperCube("up");
const down = new StepperCube("down");
const bits = new Bits(recording ? seeded(7) : Math.random);
scene.add(up.root, down.root, bits.mesh);

let size = 120;

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  size = recording ? Math.round(h * 0.18) : Math.round(Math.min(128, Math.max(72, Math.min(w, h) * 0.12)));
  document.documentElement.style.setProperty("--s", `${size}px`);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h, false);
  camera.left = -w / 2;
  camera.right = w / 2;
  camera.top = h / 2;
  camera.bottom = -h / 2;
  // On an odd width or height the centre falls on a half pixel; shift so cube edges stay crisp.
  camera.position.x = (w % 2) / 2;
  camera.position.y = -(h % 2) / 2;
  camera.updateProjectionMatrix();
  up.layout(size, size);
  down.layout(size, -size);
  // Draw now rather than on the next frame, so a resize never shows a stale or cleared canvas.
  advance(0);
  wake();
}

let value = 0;
let accent = 0;

function nextAccent() {
  accent += 1;
  return accent % 2 === 1 ? ORANGE : PINK;
}

/** Writes the new value and rolls the digits the same way the cube went. */
function show(next: number, dir: 1 | -1) {
  value = next;
  // At hold speed only the newest leaving number animates; older ones would stack up.
  const spans = output.querySelectorAll("span");
  spans.forEach((span, i) => i < spans.length - 1 && span.remove());
  const old = spans[spans.length - 1];
  const fresh = document.createElement("span");
  fresh.textContent = String(value);
  output.append(fresh);
  if (motionQuery.matches || !old) {
    old?.remove();
    return;
  }
  const easing = "cubic-bezier(0.23, 1, 0.32, 1)";
  old.animate(
    [
      { transform: "translateY(0)", opacity: 1 },
      { transform: `translateY(${-dir * 60}%)`, opacity: 0 },
    ],
    { duration: 140, easing, fill: "forwards" },
  ).onfinish = () => old.remove();
  fresh.animate(
    [
      { transform: `translateY(${dir * 60}%)`, opacity: 0 },
      { transform: "translateY(0)", opacity: 1 },
    ],
    { duration: 200, easing },
  );
}

let settleTimer = 0;

/** After a quiet spell, any coloured cube rolls once more back onto gray. */
function scheduleSettle() {
  if (recording) return;
  window.clearTimeout(settleTimer);
  settleTimer = window.setTimeout(settle, 1400);
}

function settle() {
  for (const cube of [up, down]) {
    if (!cube.resting) cube.step(GRAY, motionQuery.matches, 0.6);
  }
  wake();
}

function press(dir: "up" | "down", boost = 1) {
  const reduced = motionQuery.matches;
  const cube = dir === "up" ? up : down;
  if (dir === "down" && value === 0) {
    cube.refuse(reduced);
    wake();
    return;
  }
  cube.step(nextAccent(), reduced, boost);
  show(value + (dir === "up" ? 1 : -1), dir === "up" ? 1 : -1);
  if (!reduced) {
    const count = Math.round(5 + boost * 3);
    if (dir === "up") bits.burst(0, cube.topY, cube.frontColor, size, true, count);
    else bits.burst(0, cube.bottomY, cube.frontColor, size, false, count);
  }
  scheduleSettle();
  wake();
}

// Holding a button repeats, and the repeat speeds up: one step, a pause,
// then steps every 140ms closing in on 35ms. The hop and the burst grow with the speed.
let holdTimer = 0;

function startHold(dir: "up" | "down") {
  press(dir);
  let interval = 140;
  const tick = () => {
    interval = Math.max(35, interval * 0.88);
    press(dir, 1 + (140 - interval) / 70);
    holdTimer = window.setTimeout(tick, interval);
  };
  holdTimer = window.setTimeout(tick, 380);
}

function bindButton(button: HTMLButtonElement, dir: "up" | "down") {
  const cube = dir === "up" ? up : down;
  const release = () => {
    window.clearTimeout(holdTimer);
    cube.setHeld(false);
    wake();
  };
  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    button.setPointerCapture(event.pointerId);
    cube.setHeld(true);
    startHold(dir);
  });
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("lostpointercapture", release);
  // Keyboard activation arrives as a click with detail 0; pointer clicks are already handled.
  button.addEventListener("click", (event) => {
    if (event.detail === 0) press(dir);
  });
}

bindButton(upButton, "up");
bindButton(downButton, "down");

window.addEventListener("keydown", (event) => {
  if (event.key === "ArrowUp") press("up");
  else if (event.key === "ArrowDown") press("down");
  else return;
  event.preventDefault();
});

// The loop runs only while something moves, so an idle page draws nothing.
let running = false;
let last = 0;

function wake() {
  if (running || recording) return;
  running = true;
  last = performance.now();
  requestAnimationFrame(frame);
}

function frame(now: number) {
  // The rAF timestamp can predate the wake() that scheduled it. Unclamped, that gave a
  // negative step, no physics, and a loop that went to sleep mid-roll.
  const elapsed = Math.max(0, Math.min((now - last) / 1000, 1 / 20));
  last = now;
  running = advance(elapsed);
  if (running) requestAnimationFrame(frame);
}

/** Moves everything on by `elapsed` seconds and draws. Returns true while anything moves. */
function advance(elapsed: number) {
  // Fixed substeps keep the stiff springs stable on 30Hz and 120Hz displays alike.
  const steps = Math.max(1, Math.ceil(elapsed / (1 / 240)));
  const dt = elapsed / steps;
  let moving = false;
  for (let i = 0; i < steps; i++) {
    const a = up.update(dt);
    const b = down.update(dt);
    moving = a || b;
  }
  moving = bits.update(elapsed) || moving;
  renderer.render(scene, camera);
  return moving;
}

/** Small seeded generator, so a recording throws the same bits every take. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

if (recording) {
  Object.assign(window, {
    stepper: {
      press,
      settle,
      hold: (dir: "up" | "down", held: boolean) => (dir === "up" ? up : down).setHeld(held),
      /** Steps physics and the digit animations by `dt` seconds, then draws one frame. */
      advance(dt: number) {
        for (const animation of document.getAnimations()) {
          animation.pause();
          const end = Number(animation.effect?.getComputedTiming().endTime ?? 0);
          const next = Number(animation.currentTime ?? 0) + dt * 1000;
          if (next >= end) animation.finish();
          else animation.currentTime = next;
        }
        advance(dt);
      },
    },
  });
}

window.addEventListener("resize", resize);
resize();
