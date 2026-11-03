import * as THREE from "three";
import { GRAVITY } from "./cube";

const MAX = 220;
const LIFE = 1.1;

type Bit = {
  alive: boolean;
  age: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Euler;
  spin: THREE.Vector3;
  size: number;
};

/**
 * Small cubes a press throws out of the button, one instanced mesh for all of them.
 * They fly, tumble, fall under the same gravity as the hop, and shrink to nothing,
 * so they never need transparency.
 */
export class Bits {
  readonly mesh: THREE.InstancedMesh;
  private readonly bits: Bit[] = [];
  private next = 0;
  private readonly dummy = new THREE.Object3D();

  constructor(private readonly random: () => number) {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), MAX);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < MAX; i++) {
      this.bits.push({
        alive: false,
        age: 0,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        rot: new THREE.Euler(),
        spin: new THREE.Vector3(),
        size: 0,
      });
      this.mesh.setColorAt(i, new THREE.Color());
      this.hide(i);
    }
  }

  /** Throws `count` bits from (x, y). `up` sends them skyward, otherwise they drop out the bottom. */
  burst(x: number, y: number, color: THREE.Color, unit: number, up: boolean, count: number) {
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      const bit = this.bits[i];
      bit.alive = true;
      bit.age = 0;
      bit.size = unit * (0.08 + this.random() * 0.1);
      bit.pos.set(x + (this.random() - 0.5) * unit * 0.8, y, (this.random() - 0.5) * unit * 0.6);
      const speed = unit * (9 + this.random() * 9);
      bit.vel.set(
        (this.random() - 0.5) * unit * 9,
        up ? speed : -speed * 0.25,
        (this.random() - 0.2) * unit * 7,
      );
      bit.rot.set(this.random() * 6, this.random() * 6, 0);
      bit.spin.set((this.random() - 0.5) * 20, (this.random() - 0.5) * 20, (this.random() - 0.5) * 20);
      this.mesh.setColorAt(i, color);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Returns true while any bit is still in the air. */
  update(dt: number): boolean {
    let any = false;
    for (let i = 0; i < MAX; i++) {
      const bit = this.bits[i];
      if (!bit.alive) continue;
      bit.age += dt;
      if (bit.age >= LIFE) {
        bit.alive = false;
        this.hide(i);
        continue;
      }
      any = true;
      bit.vel.y -= GRAVITY * 0.55 * dt;
      bit.pos.addScaledVector(bit.vel, dt);
      bit.rot.x += bit.spin.x * dt;
      bit.rot.y += bit.spin.y * dt;
      bit.rot.z += bit.spin.z * dt;
      const t = bit.age / LIFE;
      const scale = bit.size * Math.min(1, t * 12) * (1 - t * t);
      this.dummy.position.copy(bit.pos);
      this.dummy.rotation.copy(bit.rot);
      this.dummy.scale.setScalar(Math.max(scale, 0.0001));
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    return any;
  }

  private hide(i: number) {
    this.dummy.position.set(0, 0, 0);
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(i, this.dummy.matrix);
  }
}
