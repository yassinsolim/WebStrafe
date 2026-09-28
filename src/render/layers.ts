import type { Object3D } from 'three';

/**
 * tracers, flashes and particles draw on this layer. the world camera sees it,
 * the viewmodel probe doesn't, so a shot never lights the gun from inside the capture
 */
export const EFFECTS_LAYER = 3;

/** moves an effect (and its children) onto the effects layer */
export function onEffectsLayer<T extends Object3D>(object: T): T {
  object.traverse((child) => child.layers.set(EFFECTS_LAYER));
  return object;
}
