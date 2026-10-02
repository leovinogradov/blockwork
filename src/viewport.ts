import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { getFaceFrame, type BoxSpec, type FaceName } from './model';
import { parseFaceColor } from './face-color';

export type ViewName = 'iso' | 'front' | 'right' | 'top';
export type ProjectionMode = 'perspective' | 'orthographic';

export interface Viewport {
  setBoxes(boxes: BoxSpec[], options?: { preserveView?: boolean; hiddenIds?: Iterable<string> }): void;
  select(id: string | null, face?: FaceName | null): void;
  setVisibility(id: string, visible: boolean): void;
  setView(view: ViewName): void;
  fit(): void;
  setProjection(mode: ProjectionMode): void;
  setGrid(visible: boolean): void;
  dispose(): void;
}

type BoxObject = {
  id: string;
  mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  edges: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>;
  size: THREE.Vector3;
};

const CLEAR_COLOR = 0x101923;
const EDGE_COLOR = 0x5f98a9;
const SELECTED_EDGE_COLOR = 0xffba4b;
const EMPTY_RADIUS = 24;

/**
 * A small, self-contained Three.js viewport for inch-based cabinet geometry.
 * Model coordinates use X width, Y depth and Z height, with a box position at
 * its lower-left-back (minimum) corner.
 */
export function createViewport(
  host: HTMLElement,
  onSelect: (id: string | null, face?: FaceName | null) => void,
  onFaceContext?: (hit: { boxId: string; face: FaceName; clientX: number; clientY: number }) => void,
): Viewport {
  let disposed = false;
  let selectedId: string | null = null;
  let selectedFace: FaceName | null = null;
  let projection: ProjectionMode = 'perspective';
  let currentView: ViewName = 'iso';
  let animationFrame = 0;
  let pointerDown: { x: number; y: number; button: number; pointerId: number; dragged: boolean } | null = null;
  let faceHighlight: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  let lastBounds = new THREE.Box3();
  const objects = new Map<string, BoxObject>();
  const hiddenIds = new Set<string>();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  const boxRoot = new THREE.Group();

  scene.background = new THREE.Color(CLEAR_COLOR);
  scene.add(root);
  root.add(boxRoot);

  const clearFaceHighlight = () => {
    if (!faceHighlight) return;
    boxRoot.remove(faceHighlight);
    faceHighlight.geometry.dispose();
    faceHighlight.material.dispose();
    faceHighlight = null;
  };

  const updateFaceHighlight = () => {
    clearFaceHighlight();
    if (!selectedId || !selectedFace) return;
    const object = objects.get(selectedId);
    if (!object) return;

    const frame = getFaceFrame(selectedFace);
    const dimensions = [object.size.x, object.size.y, object.size.z];
    const geometry = new THREE.PlaneGeometry(
      dimensions[frame.uAxis],
      dimensions[frame.vAxis],
    );
    const material = new THREE.MeshBasicMaterial({
      color: SELECTED_EDGE_COLOR,
      depthWrite: false,
      opacity: 0.28,
      side: THREE.DoubleSide,
      transparent: true,
    });
    faceHighlight = new THREE.Mesh(geometry, material);
    const axisVector = (axis: 0 | 1 | 2, sign: 1 | -1) => {
      const vector = new THREE.Vector3();
      vector.setComponent(axis, sign);
      return vector;
    };
    const u = axisVector(frame.uAxis, frame.uSign);
    const v = axisVector(frame.vAxis, frame.vSign);
    const normal = axisVector(frame.normalAxis, frame.normalSign);

    // PlaneGeometry lies in local XY with its normal along +Z. Align those
    // axes to the signed outside face frame so width and height stay on the
    // face's U/V axes for all faces in this Z-up viewport.
    faceHighlight.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, v, normal));
    faceHighlight.position.copy(object.mesh.position).addScaledVector(
      normal,
      dimensions[frame.normalAxis] / 2 + 0.012,
    );
    boxRoot.add(faceHighlight);
  };

  const perspectiveCamera = new THREE.PerspectiveCamera(42, 1, 0.1, 10000);
  perspectiveCamera.up.set(0, 0, 1);
  const orthographicCamera = new THREE.OrthographicCamera(-20, 20, 20, -20, 0.1, 10000);
  orthographicCamera.up.set(0, 0, 1);
  let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = perspectiveCamera;

  const hemi = new THREE.HemisphereLight(0xc4dbef, 0x18212a, 2.1);
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(70, -90, 120);
  const fill = new THREE.DirectionalLight(0x7db3d5, 0.7);
  fill.position.set(-80, 30, 50);
  scene.add(hemi, key, fill);

  const grid = new THREE.GridHelper(240, 240, 0x304b58, 0x23343e);
  grid.rotation.x = Math.PI / 2;
  grid.position.z = -0.015;
  const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
  gridMaterials.forEach((material) => {
    material.transparent = true;
    material.opacity = 0.48;
  });
  root.add(grid);

  const axes = new THREE.Group();
  const addAxis = (to: THREE.Vector3, color: number) => {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-to.x, -to.y, -to.z),
      to,
    ]);
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 });
    axes.add(new THREE.Line(geometry, material));
  };
  addAxis(new THREE.Vector3(55, 0, 0), 0xe06262);
  addAxis(new THREE.Vector3(0, 55, 0), 0x62c47a);
  addAxis(new THREE.Vector3(0, 0, 55), 0x6aaee9);
  root.add(axes);

  let renderer: THREE.WebGLRenderer | null = null;
  let controls: OrbitControls | null = null;
  let observer: ResizeObserver | null = null;

  const showFallback = () => {
    const message = document.createElement('div');
    message.className = 'viewport-webgl-fallback';
    message.textContent = 'This 3D view needs WebGL, which is unavailable in this browser.';
    Object.assign(message.style, {
      alignItems: 'center',
      background: '#101923',
      color: '#b8cad7',
      display: 'flex',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '14px',
      height: '100%',
      justifyContent: 'center',
      padding: '24px',
      textAlign: 'center',
      width: '100%',
    });
    host.replaceChildren(message);
  };

  try {
    const testCanvas = document.createElement('canvas');
    if (!testCanvas.getContext('webgl2') && !testCanvas.getContext('webgl')) {
      throw new Error('WebGL is unavailable');
    }
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(CLEAR_COLOR, 1);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.touchAction = 'none';
    renderer.domElement.style.width = '100%';
    host.replaceChildren(renderer.domElement);
  } catch {
    showFallback();
  }

  const updateOrthoFrustum = (width: number, height: number) => {
    const aspect = Math.max(width / Math.max(height, 1), 0.01);
    const viewHeight = 40;
    orthographicCamera.left = (-viewHeight * aspect) / 2;
    orthographicCamera.right = (viewHeight * aspect) / 2;
    orthographicCamera.top = viewHeight / 2;
    orthographicCamera.bottom = -viewHeight / 2;
    orthographicCamera.updateProjectionMatrix();
  };

  const makeControls = () => {
    if (!renderer) return;
    controls?.dispose();
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.11;
    controls.enablePan = true;
    controls.panSpeed = 0.85;
    controls.rotateSpeed = 0.7;
    controls.zoomSpeed = 0.8;
    controls.screenSpacePanning = true;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT: THREE.MOUSE.PAN,
    };
    controls.minDistance = 0.5;
    controls.maxDistance = 5000;
    controls.minZoom = 0.08;
    controls.maxZoom = 200;
    controls.target.set(0, 0, 0);
    controls.update();
  };

  const resize = () => {
    if (!renderer || disposed) return;
    const width = Math.max(host.clientWidth, 1);
    const height = Math.max(host.clientHeight, 1);
    renderer.setSize(width, height, false);
    perspectiveCamera.aspect = width / height;
    perspectiveCamera.updateProjectionMatrix();
    updateOrthoFrustum(width, height);
  };

  const boundsRadius = () => {
    if (lastBounds.isEmpty()) return EMPTY_RADIUS;
    return Math.max(lastBounds.getSize(new THREE.Vector3()).length() / 2, 2);
  };

  const boundsCenter = () => lastBounds.isEmpty()
    ? new THREE.Vector3(0, 0, 0)
    : lastBounds.getCenter(new THREE.Vector3());

  const fit = () => {
    const target = boundsCenter();
    const radius = boundsRadius();
    const direction = camera.position.clone().sub(controls?.target ?? target);
    if (direction.lengthSq() < 0.0001) direction.set(1, -1, 0.75);
    direction.normalize();

    if (camera instanceof THREE.PerspectiveCamera) {
      const vertical = THREE.MathUtils.degToRad(camera.fov) / 2;
      const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
      const distance = (radius / Math.sin(Math.min(vertical, horizontal))) * 1.22;
      camera.position.copy(target).addScaledVector(direction, distance);
    } else {
      const viewWidth = camera.right - camera.left;
      const viewHeight = camera.top - camera.bottom;
      const diameter = radius * 2 * 1.28;
      camera.zoom = Math.max(0.08, Math.min(viewWidth / diameter, viewHeight / diameter));
      camera.position.copy(target).addScaledVector(direction, Math.max(radius * 4, 20));
      camera.updateProjectionMatrix();
    }
    controls?.target.copy(target);
    controls?.update();
  };

  const select = (id: string | null, face: FaceName | null = null) => {
    selectedId = objects.has(id ?? '') && !hiddenIds.has(id!) ? id : null;
    selectedFace = selectedId ? face : null;
    for (const [objectId, object] of objects) {
      object.edges.material.color.setHex(objectId === selectedId ? SELECTED_EDGE_COLOR : EDGE_COLOR);
      object.edges.material.opacity = objectId === selectedId ? 1 : 0.74;
    }
    updateFaceHighlight();
  };

  const setBoxes = (boxes: BoxSpec[], options: { preserveView?: boolean; hiddenIds?: Iterable<string> } = {}) => {
    clearFaceHighlight();
    hiddenIds.clear();
    for (const id of options.hiddenIds ?? []) hiddenIds.add(id);
    for (const object of objects.values()) {
      object.mesh.geometry.dispose();
      object.mesh.material.dispose();
      object.edges.geometry.dispose();
      object.edges.material.dispose();
      boxRoot.remove(object.mesh, object.edges);
    }
    objects.clear();
    lastBounds = new THREE.Box3();

    for (const spec of boxes) {
      const [rawWidth, rawDepth, rawHeight] = spec.size;
      const width = Math.max(Math.abs(rawWidth), 0.01);
      const depth = Math.max(Math.abs(rawDepth), 0.01);
      const height = Math.max(Math.abs(rawHeight), 0.01);
      const [x, y, z] = spec.position;
      const geometry = new THREE.BoxGeometry(width, depth, height);
      const faceColor = parseFaceColor(spec.color);
      const material = new THREE.MeshStandardMaterial({
        color: faceColor.color,
        metalness: 0.03,
        roughness: 0.74,
        transparent: faceColor.opacity < 1,
        opacity: faceColor.opacity,
        depthWrite: faceColor.opacity === 1,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x + width / 2, y + depth / 2, z + height / 2);
      mesh.userData.boxId = spec.id;
      const edgeGeometry = new THREE.EdgesGeometry(geometry, 20);
      const edgeMaterial = new THREE.LineBasicMaterial({
        color: EDGE_COLOR,
        transparent: true,
        opacity: 0.74,
      });
      const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
      edges.position.copy(mesh.position);
      const isVisible = !hiddenIds.has(spec.id);
      mesh.visible = isVisible;
      edges.visible = isVisible;
      boxRoot.add(mesh, edges);
      objects.set(spec.id, { id: spec.id, mesh, edges, size: new THREE.Vector3(width, depth, height) });
      if (isVisible) {
        lastBounds.expandByPoint(new THREE.Vector3(x, y, z));
        lastBounds.expandByPoint(new THREE.Vector3(x + width, y + depth, z + height));
      }
    }
    select(selectedId, selectedFace);
    if (!options.preserveView) fit();
  };

  const setVisibility = (id: string, visible: boolean) => {
    const object = objects.get(id);
    if (!object) return;
    if (visible) hiddenIds.delete(id);
    else hiddenIds.add(id);
    object.mesh.visible = visible;
    object.edges.visible = visible;
    lastBounds.makeEmpty();
    for (const candidate of objects.values()) {
      if (candidate.mesh.visible) lastBounds.union(new THREE.Box3().setFromObject(candidate.mesh));
    }
    if (!visible && selectedId === id) select(null);
  };

  const setView = (view: ViewName) => {
    currentView = view;
    const target = boundsCenter();
    const direction = new THREE.Vector3();
    if (view === 'front') direction.set(0, -1, 0);
    else if (view === 'right') direction.set(1, 0, 0);
    else if (view === 'top') direction.set(0, -0.0001, 1);
    else direction.set(1, -1, 0.8);
    direction.normalize();
    camera.position.copy(target).addScaledVector(direction, Math.max(boundsRadius() * 4, 30));
    controls?.target.copy(target);
    controls?.update();
    fit();
  };

  const setProjection = (mode: ProjectionMode) => {
    if (projection === mode) return;
    const oldPosition = camera.position.clone();
    const oldTarget = controls?.target.clone() ?? new THREE.Vector3();
    projection = mode;
    camera = projection === 'perspective' ? perspectiveCamera : orthographicCamera;
    camera.position.copy(oldPosition);
    camera.up.set(0, 0, 1);
    makeControls();
    controls?.target.copy(oldTarget);
    controls?.update();
    if (camera instanceof THREE.OrthographicCamera) fit();
  };

  const pointerToNdc = (event: PointerEvent) => {
    if (!renderer) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  };

  const faceFromNormal = (normal: THREE.Vector3): FaceName => {
    const x = Math.abs(normal.x);
    const y = Math.abs(normal.y);
    const z = Math.abs(normal.z);
    if (x >= y && x >= z) return normal.x >= 0 ? 'right' : 'left';
    if (y >= z) return normal.y >= 0 ? 'back' : 'front';
    return normal.z >= 0 ? 'top' : 'bottom';
  };

  const faceAtPointer = (event: PointerEvent) => {
    pointerToNdc(event);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects([...objects.values()].filter((object) => !hiddenIds.has(object.id)).map((object) => object.mesh), false)[0];
    const boxId = hit?.object.userData.boxId as string | undefined;
    if (!hit?.face || !boxId) return null;
    const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    return { boxId, face: faceFromNormal(normal) };
  };

  const onPointerDown = (event: PointerEvent) => {
    pointerDown = {
      x: event.clientX,
      y: event.clientY,
      button: event.button,
      pointerId: event.pointerId,
      dragged: false,
    };
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!pointerDown || pointerDown.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 4) {
      pointerDown.dragged = true;
    }
  };
  const onPointerUp = (event: PointerEvent) => {
    const down = pointerDown;
    if (!down || down.pointerId !== event.pointerId || down.button !== event.button) return;
    pointerDown = null;
    if (down.dragged || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) return;

    const hit = faceAtPointer(event);
    if (event.button === 0) {
      select(hit?.boxId ?? null, hit?.face ?? null);
      onSelect(hit?.boxId ?? null, hit?.face ?? null);
    } else if (event.button === 2) {
      select(hit?.boxId ?? null, hit?.face ?? null);
      onSelect(hit?.boxId ?? null, hit?.face ?? null);
      if (hit) {
        onFaceContext?.({ ...hit, clientX: event.clientX, clientY: event.clientY });
      }
    }
  };
  const onContextMenu = (event: MouseEvent) => {
    event.preventDefault();
  };

  const render = () => {
    if (disposed || !renderer) return;
    animationFrame = requestAnimationFrame(render);
    controls?.update();
    renderer.render(scene, camera);
  };

  if (renderer) {
    makeControls();
    setView(currentView);
    resize();
    observer = new ResizeObserver(resize);
    observer.observe(host);
    renderer.domElement.addEventListener('pointerdown', onPointerDown, true);
    renderer.domElement.addEventListener('pointermove', onPointerMove, true);
    renderer.domElement.addEventListener('pointerup', onPointerUp, true);
    renderer.domElement.addEventListener('contextmenu', onContextMenu);
    render();
  }

  return {
    setBoxes,
    select,
    setVisibility,
    setView,
    fit,
    setProjection,
    setGrid: (visible) => {
      grid.visible = visible;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(animationFrame);
      observer?.disconnect();
      if (renderer) {
        renderer.domElement.removeEventListener('pointerdown', onPointerDown, true);
        renderer.domElement.removeEventListener('pointermove', onPointerMove, true);
        renderer.domElement.removeEventListener('pointerup', onPointerUp, true);
        renderer.domElement.removeEventListener('contextmenu', onContextMenu);
      }
      controls?.dispose();
      clearFaceHighlight();
      for (const object of objects.values()) {
        object.mesh.geometry.dispose();
        object.mesh.material.dispose();
        object.edges.geometry.dispose();
        object.edges.material.dispose();
      }
      grid.geometry.dispose();
      gridMaterials.forEach((material) => material.dispose());
      axes.traverse((child) => {
        if (child instanceof THREE.Line) {
          child.geometry.dispose();
          child.material.dispose();
        }
      });
      renderer?.dispose();
      renderer?.domElement.remove();
      objects.clear();
    },
  };
}
