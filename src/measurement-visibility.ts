import * as THREE from 'three';
import type { Vector3 } from './groups';

/** Ignore only the owning cylinder for an end-center, never another blocker. */
export function measurementPointVisible(point: Vector3, camera: THREE.Camera, occluders: THREE.Object3D[], raycaster: THREE.Raycaster, tolerance: number, selfOcclusionObjectId?: string) {
  const position = new THREE.Vector3(...point), projected = position.clone().project(camera);
  raycaster.setFromCamera(new THREE.Vector2(projected.x, projected.y), camera);
  const distance = position.sub(raycaster.ray.origin).dot(raycaster.ray.direction);
  return raycaster.intersectObjects(occluders, false).every((hit) =>
    hit.distance >= distance - tolerance || selfOcclusionObjectId !== undefined && hit.object.userData.boxId === selfOcclusionObjectId);
}
