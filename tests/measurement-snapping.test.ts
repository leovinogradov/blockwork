import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cylinderAxes, cylinderSize, type CylinderAxis, type BoxSpec } from '../src/model';
import { measurementSegments, snapMeasurement, type MeasurementSegment } from '../src/measurements';
import { measurementPointVisible } from '../src/measurement-visibility';
import type { Vector3 } from '../src/groups';

function cameraFor(projection: 'perspective' | 'orthographic', position: Vector3) {
  const camera = projection === 'perspective' ? new THREE.PerspectiveCamera(40, 1, 0.1, 100) : new THREE.OrthographicCamera(-8, 8, 8, -8, 0.1, 100);
  camera.position.set(...position); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
  return camera;
}

function cylinderScene(axis: CylinderAxis) {
  const size = cylinderSize(2, 6, axis);
  const solid: BoxSpec = { id: 'cylinder', name: 'Cylinder', kind: 'cylinder', axis, size, position: size.map(n => -n / 2) as Vector3, color: '#fff' };
  const geometry = new THREE.CylinderGeometry(2, 2, 6, 96);
  if (axis === 'x') geometry.rotateZ(-Math.PI / 2);
  if (axis === 'z') geometry.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.userData.boxId = solid.id; mesh.updateMatrixWorld(true);
  return { solid, mesh, segments: measurementSegments({ boxes: [solid] }) };
}

test('only cylinder end centers request permission to pass through their owning solid', () => {
  const { segments } = cylinderScene('z');
  assert.equal(segments.filter(s => s.selfOcclusionObjectId === 'cylinder').length, 2);
  assert.ok(segments.filter(s => s.pointKind === 'edge').every(s => s.selfOcclusionObjectId === undefined));
  const box: BoxSpec = { id: 'box', name: 'Box', size: [4,4,6], position: [0,0,0], color: '#fff' };
  assert.ok(measurementSegments({ boxes: [box] }).every(s => s.selfOcclusionObjectId === undefined));
});

test('end centers allow self occlusion on every axis but reject other objects anywhere before the point', () => {
  for (const projection of ['perspective', 'orthographic'] as const) for (const axis of ['x', 'y', 'z'] as const) {
    const { solid, mesh, segments } = cylinderScene(axis);
    const cameraPosition: Vector3 = [0,0,0]; cameraPosition[cylinderAxes(solid).radialAxes[0]] = 20;
    for (const center of segments.filter(s => s.pointKind === 'center')) {
      const point = center.a;
      cameraPosition[cylinderAxes(solid).lengthAxis] = -Math.sign(point[cylinderAxes(solid).lengthAxis]) * 8;
      const camera = cameraFor(projection, cameraPosition), raycaster = new THREE.Raycaster();
      assert.equal(measurementPointVisible(point, camera, [mesh], raycaster, 0.001), false, `${projection}/${axis}: hidden without exemption`);
      assert.equal(measurementPointVisible(point, camera, [mesh], raycaster, 0.001, center.selfOcclusionObjectId), true);
      const projected = new THREE.Vector3(...point).project(camera);
      raycaster.setFromCamera(new THREE.Vector2(projected.x, projected.y), camera);
      const direction = raycaster.ray.direction.clone();
      for (const ahead of [5, 1]) {
        const blocker = new THREE.Mesh(new THREE.BoxGeometry(0.5,0.5,0.5), new THREE.MeshBasicMaterial());
        blocker.userData.boxId = 'other';
        blocker.position.set(...point).addScaledVector(direction, -ahead); blocker.updateMatrixWorld(true);
        assert.equal(measurementPointVisible(point, camera, [mesh, blocker], raycaster, 0.001, solid.id), false, `${projection}/${axis}: blocker ${ahead} inches before center`);
        assert.equal(measurementPointVisible(point, camera, [blocker, mesh], raycaster, 0.001, solid.id), false);
        blocker.position.set(...point).addScaledVector(direction, 2); blocker.updateMatrixWorld(true);
        assert.equal(measurementPointVisible(point, camera, [mesh, blocker], raycaster, 0.001, solid.id), true, 'geometry beyond the reference does not block it');
      }
    }
  }
});

test('a hidden cylinder end center snaps when visible through its own cylinder and rejects external occlusion', () => {
  const { mesh, segments } = cylinderScene('z');
  const centers = segments.filter(s => s.pointKind === 'center');
  for (const projection of ['perspective', 'orthographic'] as const) {
    const camera = cameraFor(projection, [20,0,0]), raycaster = new THREE.Raycaster();
    const project = (point: Vector3) => {
      const view = new THREE.Vector4(...point,1).applyMatrix4(camera.matrixWorldInverse), clip = view.clone().applyMatrix4(camera.projectionMatrix);
      return { x: (clip.x/clip.w+1)*400, y:(1-clip.y/clip.w)*400, w:clip.w, depth:-view.z, visible:true };
    };
    const p = project(centers[0].a), cursor: [number, number] = [p.x,p.y];
    const visible = (point: Vector3, id?: string) => measurementPointVisible(point, camera, [mesh], raycaster, 0.001, id);
    const snap = snapMeasurement(cursor, centers, project, visible);
    assert.equal(snap?.kind, 'center'); assert.deepEqual(snap?.anchor, centers[0].start);
    const blocker = new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshBasicMaterial());
    blocker.userData.boxId = 'blocker'; blocker.position.set(1,0,-3); blocker.updateMatrixWorld(true);
    assert.equal(snapMeasurement(cursor, centers, project, (point,id) => measurementPointVisible(point,camera,[mesh,blocker],raycaster,0.001,id)), null);
  }
});

test('a closer edge wins over a cylinder center within snap tolerance regardless of iteration order', () => {
  const center: MeasurementSegment = { start: { objectId:'c',coordinates:[0.5,0.5,0] }, end:{objectId:'c',coordinates:[0.5,0.5,0]}, a:[0,0,0], b:[0,0,0], pointKind:'center', selfOcclusionObjectId:'c' };
  const edge: MeasurementSegment = { start:{objectId:'edge',coordinates:[0,0,0]},end:{objectId:'edge',coordinates:[1,0,0]}, a:[5,-20,2],b:[5,20,2],pointKind:'edge' };
  const project = ([x,y,z]: Vector3) => ({ x,y,w:1,visible:true,depth:20-z });
  for (const ordered of [[center,edge],[edge,center]]) {
    const calls: (string | undefined)[] = [];
    const snap = snapMeasurement([0,0],ordered,project,(_,owner) => { calls.push(owner); return true; });
    assert.equal(snap?.kind,'edge'); assert.equal(snap?.anchor.objectId,'edge');
    assert.ok(calls.includes('c')); assert.ok(calls.includes(undefined));
  }
  const behind = { ...edge, a:[5,-20,-2] as Vector3,b:[5,20,-2] as Vector3 };
  assert.equal(snapMeasurement([0,0],[behind,center],project)?.kind,'center');
  const outside = { ...edge, a:[13,-20,2] as Vector3,b:[13,20,2] as Vector3 };
  assert.equal(snapMeasurement([0,0],[outside,center],project)?.kind,'center');
});

test('overlapping cylinder centers pick the nearest end in perspective and orthographic projections', () => {
  const { segments } = cylinderScene('z');
  for (const projection of ['perspective','orthographic'] as const) {
    const camera = cameraFor(projection,[0,0,20]);
    const project = (point:Vector3) => {
      const view = new THREE.Vector4(...point,1).applyMatrix4(camera.matrixWorldInverse), clip = view.clone().applyMatrix4(camera.projectionMatrix);
      return { x:clip.x/clip.w,y:clip.y/clip.w,w:clip.w,visible:true,depth:-view.z };
    };
    const centers = segments.filter(s => s.pointKind === 'center');
    for (const ordered of [centers,[...centers].reverse()]) assert.deepEqual(snapMeasurement([0,0],ordered,project)?.anchor.coordinates,[0.5,0.5,1]);
  }
});

test('depth priority keeps the nearest cursor point on each continuous cylinder rim', () => {
  const { segments } = cylinderScene('z');
  const rim = segments.filter(s => s.pointKind === 'edge' && s.start.coordinates[2] === 1);
  const point: Vector3 = [2*Math.cos(0.31),2*Math.sin(0.31),3];
  for (const projection of ['perspective','orthographic'] as const) {
    const camera = cameraFor(projection,[20,0,8]);
    const project = (p:Vector3) => {
      const view = new THREE.Vector4(...p,1).applyMatrix4(camera.matrixWorldInverse), clip = view.clone().applyMatrix4(camera.projectionMatrix);
      return { x:(clip.x/clip.w+1)*400,y:(1-clip.y/clip.w)*400,w:clip.w,visible:true,depth:-view.z };
    };
    const cursor = project(point), snap = snapMeasurement([cursor.x,cursor.y],rim,project)!;
    const picked = project(snap.point);
    assert.ok(Math.hypot(picked.x-cursor.x,picked.y-cursor.y)<0.1,'rim snapping stays at the cursor instead of drifting to a foreground tessellation segment');
  }
});
