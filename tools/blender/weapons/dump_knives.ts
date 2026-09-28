/**
 * dumps the runtime procedural knives to json so render_knives.py can preview
 * them in blender (headless chrome can't run the game on this machine).
 *
 *   npx tsx tools/blender/weapons/dump_knives.ts <out.json> [id,id,...] [open|folded]
 */
import { type BufferGeometry, type Color, Mesh, type MeshStandardMaterial, Vector3 } from 'three';
import { writeFileSync } from 'node:fs';
import { KNIVES } from '../../../src/combat/knives';
import { buildProceduralKnife } from '../../../src/cosmetics/ProceduralKnife';

const outPath = process.argv[2] ?? '.blender-tmp/knives.json';
const only = process.argv[3] ? process.argv[3].split(',') : null;
const pose = process.argv[4] ?? 'open';

interface Group { start: number; count: number; mat: number }

const out: unknown[] = [];
for (const def of KNIVES) {
  if (only && !only.includes(def.id)) continue;
  const knife = buildProceduralKnife(def);
  if (pose === 'folded') {
    knife.getObjectByName('blade_pivot')?.rotation.set(0, 0, -Math.PI * 0.75);
    knife.getObjectByName('handle_safe')?.rotation.set(0, 0, Math.PI * 0.6);
    knife.getObjectByName('handle_bite')?.rotation.set(0, 0, -Math.PI * 0.6);
  }
  knife.updateMatrixWorld(true);
  const meshes: unknown[] = [];
  knife.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const g: BufferGeometry = (o.geometry as BufferGeometry).clone().applyMatrix4(o.matrixWorld);
    const mats = (Array.isArray(o.material) ? o.material : [o.material]) as MeshStandardMaterial[];
    const pos = Array.from(g.getAttribute('position').array as Float32Array);
    const index = g.index ? Array.from(g.index.array) : [...Array(pos.length / 3).keys()];
    const groups: Group[] = g.groups.length
      ? g.groups.map((gr) => ({ start: gr.start, count: gr.count, mat: gr.materialIndex ?? 0 }))
      : [{ start: 0, count: index.length, mat: 0 }];
    meshes.push({
      name: o.name,
      pos,
      nrm: Array.from(g.getAttribute('normal').array as Float32Array),
      index,
      groups,
      materials: mats.map((m) => ({
        name: m.name,
        color: `#${(m.color as Color).getHexString()}`,
        metalness: m.metalness,
        roughness: m.roughness,
        map: m.map?.name ?? null,
        normalMap: m.normalMap?.name ?? null,
        roughnessMap: m.roughnessMap?.name ?? null,
      })),
    });
  });
  const sockets: Record<string, number[]> = {};
  knife.traverse((o) => {
    if (o.name.startsWith('socket_')) sockets[o.name] = o.getWorldPosition(new Vector3()).toArray();
  });
  out.push({ id: def.id, name: def.name, meshes, sockets, length: def.shape.bladeLength + def.shape.handleLength });
}
writeFileSync(outPath, JSON.stringify(out));
console.log(`[dump_knives] wrote ${out.length} knives to ${outPath}`);
