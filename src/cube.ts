import * as THREE from "three";

export const GRAY = new THREE.Color("#e4e4e4");
export const ORANGE = new THREE.Color("#ff5a00");
export const PINK = new THREE.Color("#efa0f6");
const INK = new THREE.Color("#1a1a1a");

// BoxGeometry material groups, in order: +x, -x, +y, -y, +z, -z.
function groupForNormal(n: THREE.Vector3): number {
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  const az = Math.abs(n.z);
  if (ax > ay && ax > az) return n.x > 0 ? 0 : 1;
  if (ay > az) return n.y > 0 ? 2 : 3;
  return n.z > 0 ? 4 : 5;
}

/**
 * One stepper button as a real box. Each press rolls it a quarter turn about X, so the face
 * underneath (up button) or above (down button) comes round to the front. The four faces on
 * that ring are recoloured as they come into view, so the box can roll forever on four faces
 * while every step keeps its own colour.
 *
 * On top of the roll it hops, squashes on landing, squashes while held, and shakes when a
 * press is refused. Everything is a spring stepped by `update`, which returns false once the
 * cube is at rest so the render loop can sleep.
 */
export class StepperCube {
  readonly root = new THREE.Group();
  private readonly roller = new THREE.Group();
  private readonly materials: THREE.MeshLambertMaterial[];
  private readonly ring: number[] = [];
  private readonly colors: THREE.Color[] = [GRAY];

  // Roll, in quarter turns. `sign` is the direction of rotation about X.
  private readonly sign: number;
  private target = 0;
  private turn = 0;
  private turnV = 0;

  // Hop height away from the number, in px: up for the up cube, down for the down cube, so
  // neither ever jumps into the digits.
  private readonly away: number;
  private hop = 0;
  private hopV = 0;

  // Vertical scale, springs toward 1 or the held squash.
  private squash = 1;
  private squashV = 0;
  private held = false;

  // Horizontal shake offset for a refused press.
  private shake = 0;
  private shakeV = 0;

  private size = 1;
  private baseY = 0;

  constructor(readonly dir: "up" | "down") {
    this.sign = dir === "up" ? -1 : 1;
    this.away = dir === "up" ? 1 : -1;
    this.materials = Array.from({ length: 6 }, () => new THREE.MeshLambertMaterial({ color: GRAY }));
    const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.materials);
    this.roller.add(box);

    const arrowShape = new THREE.Shape();
    const tip = dir === "up" ? 1 : -1;
    arrowShape.moveTo(0, 0.085 * tip);
    arrowShape.lineTo(-0.1, -0.085 * tip);
    arrowShape.lineTo(0.1, -0.085 * tip);
    arrowShape.closePath();
    const arrowGeometry = new THREE.ShapeGeometry(arrowShape);
    // Pulled toward the camera in the depth test as well as in space, so the face can never
    // win a pixel back from the arrow.
    const arrowMaterial = new THREE.MeshBasicMaterial({
      color: INK,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    // Ring face i is the face that sits at the front after i steps. Its arrow is the front
    // arrow carried backwards through i steps, so it reads upright once it rolls round.
    for (let i = 0; i < 4; i++) {
      const angle = -this.sign * (Math.PI / 2) * i;
      const holder = new THREE.Group();
      holder.rotation.x = angle;
      const arrow = new THREE.Mesh(arrowGeometry, arrowMaterial);
      arrow.position.z = 0.505;
      holder.add(arrow);
      this.roller.add(holder);
      const normal = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(1, 0, 0), angle);
      this.ring.push(groupForNormal(normal));
    }

    this.root.add(this.roller);
    this.paintRing();
  }

  /** Size and rest centre in world px. */
  layout(size: number, centerY: number) {
    this.size = size;
    this.baseY = centerY;
    this.roller.scale.setScalar(size);
    this.roller.position.y = size / 2;
  }

  /** Roll one step onto a face of `color`. `boost` scales the hop for a fast hold. */
  step(color: THREE.Color, reducedMotion: boolean, boost = 1) {
    this.target += 1;
    this.colors[this.target] = color;
    if (reducedMotion) {
      this.turn = this.target;
      this.turnV = 0;
      this.paintRing();
      return;
    }
    // Only relaunch near the ground, so a fast hold bounces on the spot instead of climbing.
    if (this.hop < this.size * 0.12) {
      this.hopV = Math.max(this.hopV, Math.sqrt(2 * GRAVITY * this.size * 0.34 * boost));
    }
  }

  /** Whether the current front face is gray, so an idle settle has nothing to do. */
  get resting() {
    return this.colors[this.target].equals(GRAY);
  }

  refuse(reducedMotion: boolean) {
    if (reducedMotion) return;
    this.shakeV += this.size * 9;
  }

  setHeld(held: boolean) {
    this.held = held;
  }

  /** Steps every spring by `dt` seconds. Returns true while anything is still moving. */
  update(dt: number): boolean {
    // Roll: slightly underdamped so each quarter turn lands with a small overshoot.
    const k = 520;
    const c = 2 * Math.sqrt(k) * 0.6;
    this.turnV += (k * (this.target - this.turn) - c * this.turnV) * dt;
    this.turn += this.turnV * dt;

    // Hop under gravity; the landing speed feeds the squash.
    if (this.hop > 0 || this.hopV > 0) {
      this.hopV -= GRAVITY * dt;
      this.hop += this.hopV * dt;
      if (this.hop <= 0) {
        this.squashV -= Math.min(-this.hopV / this.size, 6) * 1.1;
        this.hop = 0;
        this.hopV = 0;
      }
    }

    const sk = 700;
    const sc = 2 * Math.sqrt(sk) * 0.35;
    const squashTarget = this.held ? 0.88 : 1;
    this.squashV += (sk * (squashTarget - this.squash) - sc * this.squashV) * dt;
    this.squash += this.squashV * dt;

    const xk = 900;
    const xc = 2 * Math.sqrt(xk) * 0.18;
    this.shakeV += (-xk * this.shake - xc * this.shakeV) * dt;
    this.shake += this.shakeV * dt;

    this.roller.rotation.x = this.sign * (Math.PI / 2) * this.turn;
    this.root.position.set(this.shake, this.baseY - this.size / 2 + this.away * this.hop, 0);
    const wide = 1 + (1 - this.squash) * 0.5;
    this.root.scale.set(wide, this.squash, wide);
    this.paintRing();

    return (
      Math.abs(this.target - this.turn) > 0.001 ||
      Math.abs(this.turnV) > 0.001 ||
      this.hop > 0 ||
      Math.abs(this.squash - squashTarget) > 0.001 ||
      Math.abs(this.squashV) > 0.001 ||
      Math.abs(this.shake) > 0.05 ||
      Math.abs(this.shakeV) > 0.5
    );
  }

  /** Colour of the face the cube is rolling onto, for the particles it throws. */
  get frontColor() {
    return this.colors[this.target];
  }

  get topY() {
    return this.baseY + this.size / 2 + this.away * this.hop;
  }

  get bottomY() {
    return this.baseY - this.size / 2 + this.away * this.hop;
  }

  private paintRing() {
    const base = Math.floor(this.turn);
    for (let j = base - 1; j <= base + 2; j++) {
      const color = this.colors[Math.max(0, Math.min(j, this.target))] ?? GRAY;
      this.materials[this.ring[((j % 4) + 4) % 4]].color.copy(color);
    }
  }
}

export const GRAVITY = 9000;
