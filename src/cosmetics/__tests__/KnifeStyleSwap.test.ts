import { describe, expect, it } from 'vitest';
import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { applyKnifeStyle, syncKnifePair } from '../KnifeStyleSwap';

// stand-in for the imported viewmodel: a 'knife' node with a long thin blade
// mesh running from the grip (origin) out along -z
function makeViewmodel(): { root: Group; node: Group; authored: Mesh } {
  const root = new Group();
  const node = new Group();
  node.name = 'knife';
  const geometry = new BoxGeometry(0.02, 0.05, 0.54);
  geometry.translate(0, 0, -0.2);
  const authored = new Mesh(geometry, new MeshBasicMaterial());
  authored.name = 'knife_knife_0';
  node.add(authored);
  root.add(node);
  return { root, node, authored };
}

describe('applyKnifeStyle', () => {
  it('hides the authored blade and mounts the procedural one along its axis', () => {
    const { root, node, authored } = makeViewmodel();
    expect(applyKnifeStyle(root, 'bowie')).toBe(true);
    expect(authored.visible).toBe(false);
    const mount = node.getObjectByName('ProceduralKnifeMount');
    expect(mount).toBeDefined();
    root.updateMatrixWorld(true);
    const box = new Box3().setFromObject(mount!);
    // tip reaches out along -z like the authored blade, not +z or sideways
    expect(box.min.z).toBeLessThan(-0.3);
    expect(box.max.z).toBeLessThan(0.2);
    const size = box.getSize(new Vector3());
    expect(size.z).toBeGreaterThan(size.x);
    expect(size.z).toBeGreaterThan(size.y);
  });

  it('switches styles in place and can restore the authored knife', () => {
    const { root, node, authored } = makeViewmodel();
    applyKnifeStyle(root, 'karambit');
    applyKnifeStyle(root, 'kukri');
    expect(node.children.filter((c) => c.name === 'ProceduralKnifeMount')).toHaveLength(1);
    applyKnifeStyle(root, null);
    expect(authored.visible).toBe(true);
    expect(node.getObjectByName('ProceduralKnifeMount')).toBeUndefined();
  });

  it('dual-wields push daggers on a mirror of the animated knife node', () => {
    const { root, node } = makeViewmodel();
    const leftGoal = new Group();
    leftGoal.name = 'L_wrist_Goal';
    root.add(leftGoal);
    applyKnifeStyle(root, 'shadow_daggers');
    const pair = leftGoal.getObjectByName('ProceduralKnifePairMount');
    expect(pair).toBeDefined();
    // the knife node animates; the copy follows it mirrored across x = 0
    node.position.set(0.1, 0.2, -0.3);
    syncKnifePair(root);
    expect(pair!.position.toArray()).toEqual([-0.1, 0.2, -0.3]);
    expect(pair!.scale.x).toBe(-1);
    // single knives don't get a second copy, and switching away removes it
    applyKnifeStyle(root, 'karambit');
    expect(root.getObjectByName('ProceduralKnifePairMount')).toBeUndefined();
  });

  it('reports models without a swappable knife', () => {
    expect(applyKnifeStyle(new Group(), 'bayonet')).toBe(false);
  });
});
