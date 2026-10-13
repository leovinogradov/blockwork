import * as THREE from 'three';
import { NavigationControls, type NavigationTool } from './navigation-controls';
import { GRID_LINE_OPACITY, gridAppearanceForCamera } from './grid-scale';
import { withDepthBias } from './depth-bias';
import { createFaceHighlight } from './face-highlight';
import { measurementPointVisible } from './measurement-visibility';
import { createMeasurementAnnotation } from './measurement-annotation';
import { cylinderAxes, parseInches, formatInches, type BoxSpec, type FaceName } from './model';
import { parseFaceColor } from './face-color';
import { sketchShapesInBox, type SelectionAction } from './sketch-selection';
import { modelObjectsInBox } from './model-selection';
import { lineDisplacement, lineMeasurements, parseLineAngle, snapToSketchEdges, type SketchShape, type SketchSnap } from './sketch';
import { modelSketchFrame, modelSketchPoints, type ModelSketch } from './model-sketch';
import { autoMeasurementAxis, dominantMeasurementAxis, measurementLine, DEFAULT_MEASUREMENT_OFFSET, measurementOffsetAtPointer, measurementAxisLayout, measurementSegments, resolveMeasurement, resolveMeasurementAnchor, snapMeasurement, type Measurement, type MeasurementAnchor, type MeasurementGeometry, type MeasurementAxis, type MeasurementAxisChoice, type MeasurementSegment } from './measurements';

export type ViewName = 'iso' | 'front' | 'right' | 'top';
export type ProjectionMode = 'perspective' | 'orthographic';
export type SketchTool = 'select' | 'rectangle' | 'line' | 'circle';

export interface Viewport {
  setBoxes(boxes: BoxSpec[], options?: { preserveView?: boolean; hiddenIds?: Iterable<string>; sketches?: ModelSketch[] }): void;
  setRectangles(rectangles: SketchShape[], options?: { preserveView?: boolean; hiddenIds?: Iterable<string> }): void;
  setMode(mode: 'model' | 'sketch'): void;
  setSketchTool(tool: SketchTool): void;
  setMeasurementTool(active: boolean): void;
  setMeasurementAxis(axis: MeasurementAxisChoice): void;
  setMeasurements(measurements: Measurement[]): void;
  setMeasurementsThroughObjects(through: boolean): void;
  select(id: string | null, face?: FaceName | null): void;
  selectMany(ids: Iterable<string>): void;
  setVisibility(ids: string | Iterable<string>, visible: boolean): void;
  setView(view: ViewName): void;
  fit(): void;
  setProjection(mode: ProjectionMode): void;
  setGrid(visible: boolean): void;
  setNavigationTool(tool: NavigationTool): void;
  dispose(): void;
}

type BoxObject = {
  id: string;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  edges: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  size: THREE.Vector3;
  edgeColor: number;
  sketch?: boolean;
  bounds?: THREE.Box3;
  faceHighlight?: ReturnType<typeof createFaceHighlight>;
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
  onSketchDraw?: (first: [number, number], opposite: [number, number], tool: SketchTool) => void,
  onSketchStage?: (stage: 'idle' | 'first' | 'opposite') => void,
  onSketchSelect?: (ids: string[], action: SelectionAction) => void,
  onMeasure?: (start: MeasurementAnchor, end: MeasurementAnchor, offset: number, axis: MeasurementAxis, distanceAxis?: MeasurementAxis) => void,
  onMeasureStage?: (stage: 'first' | 'second' | 'placement' | 'invalid' | 'same', axis?: MeasurementAxis) => void,
  onMeasureModeChange?: (axisMode: boolean) => void,
  onModelSelect?: (ids: string[], action: SelectionAction) => void,
): Viewport {
  let disposed = false;
  let selectedId: string | null = null;
  let selectedIds = new Set<string>();
  let selectedFace: FaceName | null = null;
  let projection: ProjectionMode = 'perspective';
  let sketchMode = false;
  let sketchTool: SketchTool = 'select';
  let navigationTool: NavigationTool = 'select';
  let pendingMeasurementShift = false;
  let sketchFirst: [number, number] | null = null;
  let sketchHover: [number, number] | null = null;
  let lineInputMode: 'cartesian' | 'polar' = 'cartesian';
  let sketchRectangles: SketchShape[] = [];
  let measurementTool = false;
  let measurementAxisMode = false;
  let measurementsThroughObjects = true;
  let measurementAxis: MeasurementAxisChoice = 'auto';
  let measurementDraftAxis: MeasurementAxis | null = null;
  let measurementDraftDistanceAxis: MeasurementAxis | undefined;
  let measurementFirst: MeasurementAnchor | null = null;
  let measurementSecond: MeasurementAnchor | null = null;
  let measurementPlacementCursor: [number, number] | null = null;
  let measurementHover: ReturnType<typeof snapMeasurement> = null;
  let measurementGeometry: MeasurementGeometry = {};
  let measurementEdges: MeasurementSegment[] = [];
  let currentView: ViewName = 'iso';
  let animationFrame = 0;
  let pointerDown: { x: number; y: number; button: number; pointerId: number; dragged: boolean; additive: boolean; world?: [number, number] } | null = null;
  let lastBounds = new THREE.Box3();
  const objects = new Map<string, BoxObject>();
  const hiddenIds = new Set<string>();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  const boxRoot = new THREE.Group();
  const sketchPreview = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: SELECTED_EDGE_COLOR, depthTest: false }));
  sketchPreview.visible = false;

  scene.background = new THREE.Color(CLEAR_COLOR);
  scene.add(root);
  root.add(boxRoot);
  root.add(sketchPreview);

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

  const grid = new THREE.Group();
  const inchGrid = new THREE.GridHelper(600, 600, 0x304b58, 0x23343e);
  const footGrid = new THREE.GridHelper(600, 50, 0x304b58, 0x23343e);
  footGrid.visible = false;
  // This fill represents the averaged hidden inch lines, not a decorative
  // ground color. Keep its color matched to the grid's non-axis line color;
  // gridAppearanceForCamera computes its opacity and fade into visible lines.
  const gridFill = new THREE.Mesh(
    new THREE.PlaneGeometry(600, 600),
    new THREE.MeshBasicMaterial({ color: 0x23343e, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
  );
  // GridHelper lies in local XZ; place the tint just beneath its lines.
  gridFill.rotation.x = -Math.PI / 2;
  gridFill.position.y = -0.002;
  gridFill.renderOrder = -2;
  inchGrid.renderOrder = footGrid.renderOrder = -1;
  grid.add(gridFill, inchGrid, footGrid);
  grid.rotation.x = Math.PI / 2;
  grid.position.z = -0.015;
  const gridMaterials = [inchGrid, footGrid].flatMap((helper) => Array.isArray(helper.material) ? helper.material : [helper.material]);
  gridMaterials.forEach((material) => {
    material.transparent = true;
    material.opacity = GRID_LINE_OPACITY;
    material.depthWrite = false;
  });
  root.add(grid);

  const axes = new THREE.Group();
  const addAxis = (to: THREE.Vector3, color: number) => {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-to.x, -to.y, -to.z),
      to,
    ]);
    const material = withDepthBias(new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 }), -1);
    axes.add(new THREE.Line(geometry, material));
  };
  addAxis(new THREE.Vector3(55, 0, 0), 0xe06262);
  addAxis(new THREE.Vector3(0, 55, 0), 0x62c47a);
  addAxis(new THREE.Vector3(0, 0, 55), 0x6aaee9);
  root.add(axes);

  let renderer: THREE.WebGLRenderer | null = null;
  let controls: NavigationControls | null = null;
  let observer: ResizeObserver | null = null;
  let resizePending = true;
  let renderedWidth = 0;
  let renderedHeight = 0;

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
    renderer.domElement.tabIndex = -1;
    host.replaceChildren(renderer.domElement);
  } catch {
    showFallback();
  }

  const sketchOverlay = document.createElement('div');
  sketchOverlay.className = 'sketch-drawing-overlay';
  sketchOverlay.innerHTML = '<div class="sketch-guide sketch-guide-x"></div><div class="sketch-guide sketch-guide-y"></div><div class="sketch-snap-indicator"></div><div class="sketch-dimensions"><label>W <input aria-label="Rectangle width in inches" inputmode="decimal" autocomplete="off"></label><label>H <input aria-label="Rectangle height in inches" inputmode="decimal" autocomplete="off"></label><label class="line-polar-field" hidden>Length <input aria-label="Line length in inches" inputmode="decimal" autocomplete="off"><span>in</span></label><label class="line-polar-field" hidden>Angle <input aria-label="Line angle in degrees" inputmode="decimal" autocomplete="off"><span>°</span></label><small>in · Enter to draw</small></div>';
  if (renderer) host.append(sketchOverlay);
  const selectionBox = document.createElement('div');
  selectionBox.className = 'sketch-selection-box';
  selectionBox.hidden = true;
  if (renderer) host.append(selectionBox);
  const measurementOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  measurementOverlay.classList.add('measurement-overlay');
  measurementOverlay.setAttribute('aria-label', 'Distance measurements');
  if (renderer) host.append(measurementOverlay);
  const previewAnnotation = createMeasurementAnnotation(measurementOverlay, true);
  root.add(previewAnnotation.group);
  const measurementMarker = document.createElementNS(measurementOverlay.namespaceURI, 'circle');
  measurementMarker.setAttribute('class', 'measurement-marker'); measurementMarker.setAttribute('r', '5');
  measurementOverlay.append(measurementMarker);
  let annotations: { measurement: Measurement; elements: ReturnType<typeof createMeasurementAnnotation> }[] = [];
  const setMeasurements = (measurements: Measurement[]) => {
    annotations.forEach(({ elements }) => elements.dispose());
    annotations = measurements.map((measurement) => {
      const elements = createMeasurementAnnotation(measurementOverlay);
      root.add(elements.group);
      return { measurement, elements };
    });
  };
  const projectMeasurementPoint = (p: [number, number, number]) => {
    const view = new THREE.Vector4(...p, 1).applyMatrix4(camera.matrixWorldInverse);
    const clip = view.clone().applyMatrix4(camera.projectionMatrix);
    return { x: (clip.x / clip.w + 1) * host.clientWidth / 2, y: (1 - clip.y / clip.w) * host.clientHeight / 2, w: clip.w, visible: clip.w > 0 && Math.abs(clip.z / clip.w) <= 1, ...(!sketchMode ? { depth: -view.z } : {}) };
  };
  const planeRaycaster = new THREE.Raycaster();
  const pointOnAnnotationPlane = (frame: ReturnType<typeof measurementAxisLayout>, point: [number, number]) => {
    planeRaycaster.setFromCamera(new THREE.Vector2(point[0] / host.clientWidth * 2 - 1, 1 - point[1] / host.clientHeight * 2), camera);
    if (Math.abs(planeRaycaster.ray.direction.dot(new THREE.Vector3(...frame.normal))) < 1e-6) return null;
    const hit = planeRaycaster.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(...frame.normal), new THREE.Vector3(...frame.midpoint)), new THREE.Vector3());
    return hit ? hit.toArray() as [number, number, number] : null;
  };
  const labelRaycaster = new THREE.Raycaster();
  let labelOccluders: THREE.Object3D[] = [];
  let labelOcclusionTolerance = .001;
  const labelIsOccluded = (point: [number, number, number]) => {
    const position = new THREE.Vector3(...point), projected = position.clone().project(camera);
    labelRaycaster.setFromCamera(new THREE.Vector2(projected.x, projected.y), camera);
    const hit = labelRaycaster.intersectObjects(labelOccluders, false)[0];
    const distance = position.sub(labelRaycaster.ray.origin).dot(labelRaycaster.ray.direction);
    return !!hit && hit.distance < distance - labelOcclusionTolerance;
  };
  const drawAnnotation = (elements: ReturnType<typeof createMeasurementAnnotation>, measurement: Measurement) => {
    const resolved = resolveMeasurement(measurement, measurementGeometry);
    if (!resolved || [measurement.id, measurement.start.objectId, measurement.end.objectId].some((id) => hiddenIds.has(id))) { elements.hide(); return; }
    elements.update(resolved.start, resolved.end, resolved.distance, measurement, sketchMode, selectedIds.has(measurement.id), measurementsThroughObjects, camera, [host.clientWidth, host.clientHeight], labelIsOccluded);
  };
  const updateMeasurements = () => {
    camera.updateMatrixWorld();
    labelOccluders = measurementsThroughObjects ? [] : [...objects.values()].filter((object) => !hiddenIds.has(object.id) && object.mesh.material.depthWrite).map((object) => object.mesh);
    if (labelOccluders.length) labelOcclusionTolerance = Math.max(.001, boundsRadius() * 1e-5);
    for (const { elements, measurement } of annotations) drawAnnotation(elements, measurement);
    measurementMarker.setAttribute('display', 'none');
    if (!measurementTool) { previewAnnotation.hide(); return; }
    if (measurementFirst && measurementSecond) {
      drawAnnotation(previewAnnotation, { id: 'preview', start: measurementFirst, end: measurementSecond, offset: placementOffset(), axis: measurementDraftAxis ?? 'z', distanceAxis: measurementDraftDistanceAxis });
      return;
    }
    if (measurementFirst && measurementHover) {
      const start = resolveMeasurementAnchor(measurementFirst, measurementGeometry);
      const distanceAxis = measurementAxisMode && start ? dominantMeasurementAxis(start, measurementHover.point) : undefined;
      drawAnnotation(previewAnnotation, { id: 'preview', start: measurementFirst, end: measurementHover.anchor, axis: measurementDraftAxis ?? 'z', distanceAxis });
    }
    else previewAnnotation.hide();
    const point = measurementHover?.point ?? (measurementFirst ? resolveMeasurementAnchor(measurementFirst, measurementGeometry) : null);
    if (point) {
      const p = projectMeasurementPoint(point);
      if (p.visible) { measurementMarker.removeAttribute('display'); measurementMarker.setAttribute('cx', String(p.x)); measurementMarker.setAttribute('cy', String(p.y)); }
    }
  };
  const setMeasurementTool = (active: boolean) => {
    pendingMeasurementShift = false;
    if (active) setNavigationTool('select');
    measurementTool = active; clearMeasurementDraft(); pointerDown = null;
    if (active) { setSketchTool('select'); onMeasureStage?.('first'); }
    if (renderer) renderer.domElement.style.cursor = active ? 'crosshair' : sketchMode && sketchTool !== 'select' ? 'crosshair' : '';
  };
  const clearMeasurementDraft = () => {
    measurementDraftAxis = null; measurementDraftDistanceAxis = undefined; measurementFirst = null; measurementSecond = null; measurementPlacementCursor = null; measurementHover = null;
  };
  const placementOffset = () => {
    if (!measurementFirst || !measurementSecond || !measurementPlacementCursor) return 0;
    const start = resolveMeasurementAnchor(measurementFirst, measurementGeometry), end = resolveMeasurementAnchor(measurementSecond, measurementGeometry);
    if (!start || !end) return 0;
    const axis = sketchMode ? 'z' : measurementDraftAxis ?? 'z';
    const line = measurementLine(start, end, measurementDraftDistanceAxis);
    const frame = measurementAxisLayout(line.start, line.end, axis);
    const cursor = pointOnAnnotationPlane(frame, measurementPlacementCursor);
    return cursor ? measurementOffsetAtPointer(line.start, line.end, cursor, axis) : DEFAULT_MEASUREMENT_OFFSET;
  };
  const updatePlacementCursor = (event: PointerEvent) => {
    if (!renderer) return;
    const rect = renderer.domElement.getBoundingClientRect();
    measurementPlacementCursor = [event.clientX - rect.left, event.clientY - rect.top];
  };
  const guideX = sketchOverlay.querySelector<HTMLElement>('.sketch-guide-x')!;
  const guideY = sketchOverlay.querySelector<HTMLElement>('.sketch-guide-y')!;
  const sizeBox = sketchOverlay.querySelector<HTMLElement>('.sketch-dimensions')!;
  const snapMarker = sketchOverlay.querySelector<HTMLElement>('.sketch-snap-indicator')!;
  const widthInput = sketchOverlay.querySelectorAll<HTMLInputElement>('input')[0];
  const heightInput = sketchOverlay.querySelectorAll<HTMLInputElement>('input')[1];

  const lengthInput = sketchOverlay.querySelectorAll<HTMLInputElement>('input')[2];
  const angleInput = sketchOverlay.querySelectorAll<HTMLInputElement>('input')[3];
  const dimensionInputs = [widthInput, heightInput, lengthInput, angleInput];
  const lineDimensionInputs = [lengthInput, angleInput, widthInput, heightInput];
  const angleGuide = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: '#d6aa69', transparent: true, opacity: 0.6, dashSize: 0.25, gapSize: 0.2, depthTest: false }));
  angleGuide.visible = false;
  root.add(angleGuide);

  const clearSketchPreview = () => {
    if (dimensionInputs.includes(document.activeElement as HTMLInputElement)) {
      (document.activeElement as HTMLInputElement).blur();
    }
    lineInputMode = 'cartesian';
    angleGuide.visible = false;
    sketchFirst = null;
    sketchHover = null;
    sketchPreview.visible = false;
    sketchOverlay.classList.remove('sizing');
    for (const input of dimensionInputs) { input.value = ''; input.classList.remove('invalid'); }
  };

  const setSketchTool = (tool: SketchTool) => {
    if (tool !== 'select') setNavigationTool('select');
    sketchTool = sketchMode ? tool : 'select';
    pointerDown = null;
    selectionBox.hidden = true;
    clearSketchPreview();
    const line = sketchTool === 'line';
    const circle = sketchTool === 'circle';
    if (line) sizeBox.prepend(lengthInput.parentElement!, angleInput.parentElement!);
    sizeBox.classList.toggle('line-dimensions', line);
    sizeBox.classList.toggle('circle-dimensions', circle);
    sizeBox.querySelectorAll<HTMLElement>('.line-polar-field').forEach((label) => { label.hidden = !line; });
    sizeBox.querySelector('small')!.textContent = line ? '+ clockwise · − counterclockwise' : 'in · Enter to draw';
    widthInput.parentElement!.firstChild!.textContent = line ? 'ΔX ' : circle ? 'Radius ' : 'W ';
    heightInput.parentElement!.hidden = circle;
    heightInput.parentElement!.firstChild!.textContent = line ? 'ΔY ' : 'H ';
    widthInput.setAttribute('aria-label', line ? 'Line X displacement in inches' : circle ? 'Circle radius in inches' : 'Rectangle width in inches');
    heightInput.setAttribute('aria-label', line ? 'Line Y displacement in inches' : 'Rectangle height in inches');
    sketchOverlay.classList.toggle('active', sketchMode && sketchTool !== 'select');
    sketchOverlay.classList.remove('pointing');
    if (renderer) renderer.domElement.style.cursor = sketchMode && sketchTool !== 'select' ? 'crosshair' : '';
    onSketchStage?.(sketchTool !== 'select' ? 'first' : 'idle');
  };

  const updateSketchPreview = (origin: [number, number], point: [number, number], inputMode?: 'cartesian' | 'polar') => {
    sketchHover = point;
    const [x1, y1] = origin;
    const [x2, y2] = point;
    const previous = sketchPreview.geometry;
    const radius = sketchTool === 'circle' ? parseInches(Math.hypot(x2 - x1, y2 - y1)) : Math.hypot(x2 - x1, y2 - y1);
    sketchPreview.geometry = new THREE.BufferGeometry().setFromPoints(sketchTool === 'circle' ? Array.from({ length: 96 }, (_, i) => new THREE.Vector3(x1 + radius * Math.cos(i * Math.PI / 48), y1 + radius * Math.sin(i * Math.PI / 48), 0.04)) : sketchTool === 'line' ? [new THREE.Vector3(x1, y1, 0.04), new THREE.Vector3(x2, y2, 0.04)] : [
      new THREE.Vector3(x1, y1, 0.04), new THREE.Vector3(x2, y1, 0.04),
      new THREE.Vector3(x2, y2, 0.04), new THREE.Vector3(x1, y2, 0.04),
    ]);
    previous.dispose();
    sketchPreview.visible = sketchTool === 'circle' || sketchTool === 'line' ? radius >= 1 / 64 : Math.abs(x2 - x1) >= 1 / 64 && Math.abs(y2 - y1) >= 1 / 64;
    sketchOverlay.classList.add('sizing');
    if (sketchTool === 'line') {
      const delta: [number, number] = [x2 - x1, y2 - y1];
      const { length, angle } = lineMeasurements(delta);
      if (inputMode !== 'cartesian') { widthInput.value = formatInches(delta[0]); heightInput.value = formatInches(delta[1]); }
      if (inputMode !== 'polar') { lengthInput.value = formatInches(length); angleInput.value = String(Number(angle.toFixed(2))); }
      const rect = renderer?.domElement.getBoundingClientRect();
      const unitsPerPixel = camera instanceof THREE.OrthographicCamera && rect ? (camera.top - camera.bottom) / (camera.zoom * rect.height) : 0.1;
      const radius = Math.min(length * 0.3, 35 * unitsPerPixel);
      const guidePoints = [new THREE.Vector3(x1, y1, 0.05), new THREE.Vector3(x1 + radius * 1.4, y1, 0.05)];
      const radians = angle * Math.PI / 180;
      const steps = Math.max(1, Math.ceil(Math.abs(angle) / 5));
      for (let i = 0; i < steps; i++) {
        for (const t of [i / steps, (i + 1) / steps]) guidePoints.push(new THREE.Vector3(x1 + radius * Math.cos(t * radians), y1 - radius * Math.sin(t * radians), 0.05));
      }
      angleGuide.geometry.dispose();
      angleGuide.geometry = new THREE.BufferGeometry().setFromPoints(guidePoints);
      angleGuide.computeLineDistances();
      angleGuide.visible = length >= 1 / 64;
      if (inputMode && rect) {
        const start = new THREE.Vector3(x1, y1, 0).project(camera);
        const px = (start.x + 1) * rect.width / 2, py = (1 - start.y) * rect.height / 2;
        const boxWidth = sizeBox.offsetWidth, boxHeight = sizeBox.offsetHeight;
        // Keep the numeric editor on the opposite side of the new segment.
        sizeBox.style.left = `${Math.max(8, Math.min(delta[0] >= 0 ? px - boxWidth - 14 : px + 14, rect.width - boxWidth - 8))}px`;
        sizeBox.style.top = `${Math.max(8, Math.min(py + 14, rect.height - boxHeight - 8))}px`;
      }
    } else if (sketchTool === 'circle') {
      if (document.activeElement !== widthInput) widthInput.value = radius >= 1 / 64 ? formatInches(radius) : '';
    } else {
      if (document.activeElement !== widthInput) widthInput.value = Math.abs(x2 - x1) >= 1 / 64 ? formatInches(Math.abs(x2 - x1)) : '';
      if (document.activeElement !== heightInput) heightInput.value = Math.abs(y2 - y1) >= 1 / 64 ? formatInches(Math.abs(y2 - y1)) : '';
    }
  };

  const finishSketch = (opposite: [number, number]) => {
    if (!sketchFirst) return;
    const first = sketchFirst;
    if (sketchTool === 'circle' ? parseInches(Math.hypot(opposite[0] - first[0], opposite[1] - first[1])) < 1 / 64 : sketchTool === 'line' ? Math.hypot(opposite[0] - first[0], opposite[1] - first[1]) < 1 / 64 : Math.abs(opposite[0] - first[0]) < 1 / 64 || Math.abs(opposite[1] - first[1]) < 1 / 64) return;
    clearSketchPreview();
    onSketchDraw?.(first, opposite, sketchTool);
    onSketchStage?.('first');
  };

  const readDimensionPoint = (markInvalid: boolean): [number, number] | null => {
    if (!sketchFirst) return null;
    const read = (input: HTMLInputElement, parse: (value: string) => number) => {
      try { const value = parse(input.value); input.classList.remove('invalid'); return value; }
      catch { if (markInvalid) input.classList.add('invalid'); return null; }
    };
    if (sketchTool === 'circle') {
      const radius = read(widthInput, (value) => { const r = parseInches(value); if (r <= 0) throw new Error(); return r; });
      return radius === null ? null : [sketchFirst[0] + radius, sketchFirst[1]];
    }
    if (sketchTool === 'line' && lineInputMode === 'polar') {
      const length = read(lengthInput, (value) => { const n = parseInches(value); if (n < 0) throw new Error(); return n; });
      const angle = read(angleInput, parseLineAngle);
      if (length === null || angle === null) return null;
      const [dx, dy] = lineDisplacement(length, angle);
      return [sketchFirst[0] + dx, sketchFirst[1] + dy];
    }
    const parse = (value: string) => { const n = parseInches(value || (sketchTool === 'line' ? '0' : '')); if (sketchTool !== 'line' && n <= 0) throw new Error(); return n; };
    const dx = read(widthInput, parse), dy = read(heightInput, parse);
    if (dx === null || dy === null) return null;
    const signX = sketchTool !== 'line' && sketchHover && sketchHover[0] < sketchFirst[0] ? -1 : 1;
    const signY = sketchTool !== 'line' && sketchHover && sketchHover[1] < sketchFirst[1] ? -1 : 1;
    return [sketchFirst[0] + signX * dx, sketchFirst[1] + signY * dy];
  };

  for (const input of dimensionInputs) {
    input.addEventListener('focus', () => input.select());
    if (input === angleInput) input.addEventListener('blur', () => {
      try { input.value = String(parseLineAngle(input.value)); } catch { /* Keep invalid text available for correction. */ }
    });
    input.addEventListener('input', () => {
      input.classList.remove('invalid');
      lineInputMode = input === lengthInput || input === angleInput ? 'polar' : 'cartesian';
      const point = readDimensionPoint(false);
      if (sketchFirst && point) updateSketchPreview(sketchFirst, point, sketchTool === 'line' ? lineInputMode : undefined);
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        setSketchTool('select'); renderer?.domElement.focus({ preventScroll: true });
        return;
      }
      if (event.key === 'Tab' && sketchFirst && (sketchTool === 'circle' || sketchTool === 'line' || (input === widthInput && !event.shiftKey))) {
        event.preventDefault();
        const inputs = sketchTool === 'circle' ? [widthInput] : sketchTool === 'line' ? lineDimensionInputs : [widthInput, heightInput];
        const next = (inputs.indexOf(input) + (event.shiftKey ? -1 : 1) + inputs.length) % inputs.length;
        inputs[next].focus();
        return;
      }
      if (event.key !== 'Enter' || !sketchFirst) return;
      event.preventDefault(); event.stopPropagation();
      const point = readDimensionPoint(true);
      if (point) finishSketch(point);
    });
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
    controls = new NavigationControls(camera, renderer.domElement, navigationPointAtPointer, navigationModelScale);
    controls.enableRotate = !sketchMode;
    controls.setNavigationTool(navigationTool);
    controls.enablePan = true;
    controls.rotateSpeed = 0.686;
    controls.screenSpacePanning = true;
    controls.mouseButtons = sketchMode
      ? { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN }
      : { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
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
    resizePending = false;
    if (width === renderedWidth && height === renderedHeight) return;
    renderedWidth = width;
    renderedHeight = height;
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

  const navigationRaycaster = new THREE.Raycaster();
  const navigationModelScale = () => lastBounds.isEmpty() ? 0 : lastBounds.getSize(new THREE.Vector3()).length();
  const navigationPointAtPointer = (ndc: THREE.Vector2) => {
    camera.updateMatrixWorld();
    boxRoot.updateMatrixWorld(true);
    navigationRaycaster.setFromCamera(ndc, camera);
    if (sketchMode) return navigationRaycaster.ray.intersectPlane(
      new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), new THREE.Vector3(),
    );
    const meshes = [...objects.values()].filter(({ mesh }) => mesh.visible).map(({ mesh }) => mesh);
    return navigationRaycaster.intersectObjects(meshes, false)[0]?.point ?? null;
  };

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

  const applySelection = (ids: Iterable<string>, face: FaceName | null = null) => {
    selectedIds = new Set([...ids].filter((id) => (objects.has(id) || annotations.some((a) => a.measurement.id === id)) && !hiddenIds.has(id)));
    selectedId = selectedIds.size === 1 ? [...selectedIds][0] : null;
    selectedFace = selectedId && objects.has(selectedId) && !objects.get(selectedId)?.sketch ? face : null;
    for (const [objectId, object] of objects) {
      object.edges.material.color.setHex(selectedIds.has(objectId) ? SELECTED_EDGE_COLOR : object.edgeColor);
      object.edges.material.opacity = selectedIds.has(objectId) ? 1 : 0.74;
      object.faceHighlight?.setFace(objectId === selectedId ? selectedFace : null);
    }
  };
  const select = (id: string | null, face: FaceName | null = null) => applySelection(id ? [id] : [], face);
  const selectMany = (ids: Iterable<string>) => applySelection(ids);

  const disposeObject = (object: BoxObject) => {
    object.mesh.traverse((child) => {
      if (child instanceof THREE.LineSegments) { child.geometry.dispose(); (child.material as THREE.Material).dispose(); }
    });
    object.mesh.geometry.dispose(); object.mesh.material.dispose();
    object.edges.geometry.dispose(); object.edges.material.dispose();
    boxRoot.remove(object.mesh, object.edges);
  };

  const setBoxes = (boxes: BoxSpec[], options: { preserveView?: boolean; hiddenIds?: Iterable<string>; sketches?: ModelSketch[] } = {}) => {
    measurementGeometry = { boxes, sketches: options.sketches ?? [] };
    measurementHover = null;
    if ([measurementFirst, measurementSecond].some((anchor) => anchor && !resolveMeasurementAnchor(anchor, measurementGeometry))) { clearMeasurementDraft(); onMeasureStage?.('first'); }
    hiddenIds.clear();
    for (const id of options.hiddenIds ?? []) hiddenIds.add(id);
    for (const object of objects.values()) {
      disposeObject(object);
    }
    objects.clear();
    sketchRectangles = [];
    lastBounds = new THREE.Box3();

    for (const spec of boxes) {
      const [rawWidth, rawDepth, rawHeight] = spec.size;
      const width = Math.max(Math.abs(rawWidth), 0.01);
      const depth = Math.max(Math.abs(rawDepth), 0.01);
      const height = Math.max(Math.abs(rawHeight), 0.01);
      const [x, y, z] = spec.position;
      let geometry: THREE.BufferGeometry;
      if (spec.kind === 'cylinder') {
        const { lengthAxis, radialAxes } = cylinderAxes(spec);
        const radius = spec.size[radialAxes[0]] / 2;
        geometry = new THREE.CylinderGeometry(radius, radius, spec.size[lengthAxis], 96);
        if (lengthAxis === 0) geometry.rotateZ(-Math.PI / 2);
        if (lengthAxis === 2) geometry.rotateX(Math.PI / 2);
      } else geometry = new THREE.BoxGeometry(width, depth, height);
      const faceColor = parseFaceColor(spec.color);
      const material = new THREE.MeshStandardMaterial({
        color: faceColor.color,
        metalness: 0.03,
        roughness: 0.74,
        transparent: faceColor.opacity < 1,
        opacity: faceColor.opacity,
        depthWrite: faceColor.opacity === 1,
      });
      const faceHighlight = createFaceHighlight(material, SELECTED_EDGE_COLOR);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x + width / 2, y + depth / 2, z + height / 2);
      mesh.userData.boxId = spec.id;
      const edgeGeometry = new THREE.EdgesGeometry(geometry, 20);
      const edgeMaterial = withDepthBias(new THREE.LineBasicMaterial({
        color: EDGE_COLOR,
        transparent: true,
        opacity: 0.74,
      }), 0.5);
      const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
      edges.position.copy(mesh.position);
      const isVisible = !hiddenIds.has(spec.id);
      mesh.visible = isVisible;
      edges.visible = isVisible;
      boxRoot.add(mesh, edges);
      objects.set(spec.id, { id: spec.id, mesh, edges, size: new THREE.Vector3(width, depth, height), edgeColor: EDGE_COLOR, faceHighlight });
      if (isVisible) {
        lastBounds.expandByPoint(new THREE.Vector3(x, y, z));
        lastBounds.expandByPoint(new THREE.Vector3(x + width, y + depth, z + height));
      }
    }
    for (const spec of options.sketches ?? []) {
      const [width, height] = spec.size;
      const frame = modelSketchFrame({ ...spec, groupId: undefined });
      const u = new THREE.Vector3(...frame.u), v = new THREE.Vector3(...frame.v), normal = new THREE.Vector3(...frame.normal);
      const geometry = new THREE.PlaneGeometry(width, height);
      const color = parseFaceColor(spec.color).color;
      const mesh = new THREE.Mesh(geometry, withDepthBias(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }), 1));
      mesh.position.set(...spec.position).addScaledVector(u, width / 2).addScaledVector(v, height / 2);
      mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, v, normal));
      mesh.userData.boxId = spec.id;
      const edgeColor = new THREE.Color(color).getHex();
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), withDepthBias(new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: 0.74 }), 2));
      edges.position.copy(mesh.position); edges.quaternion.copy(mesh.quaternion);
      for (const shape of spec.shapes) {
        const [x, y] = shape.position, [dx, dy] = shape.size;
        const a = new THREE.Vector3(x - width / 2, y - height / 2, 0);
        const b = new THREE.Vector3(x + dx - width / 2, y + dy - height / 2, 0);
        const points = shape.kind === 'circle' ? Array.from({ length: 96 }, (_, i) => [i, i + 1].map((j) => new THREE.Vector3((a.x + b.x) / 2 + dx / 2 * Math.cos(j * Math.PI / 48), (a.y + b.y) / 2 + dy / 2 * Math.sin(j * Math.PI / 48), 0))).flat() : shape.kind === 'line' ? [a, b] : [a, new THREE.Vector3(b.x, a.y, a.z), new THREE.Vector3(b.x, a.y, a.z), b, b, new THREE.Vector3(a.x, b.y, a.z), new THREE.Vector3(a.x, b.y, a.z), a];
        const stroke = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), withDepthBias(new THREE.LineBasicMaterial({ color: parseFaceColor(shape.color).color }), 2));
        stroke.userData.boxId = spec.id;
        mesh.add(stroke);
      }
      const bounds = new THREE.Box3().setFromPoints(modelSketchPoints(spec).map((point) => new THREE.Vector3(...point)));
      mesh.visible = edges.visible = !hiddenIds.has(spec.id);
      boxRoot.add(mesh, edges);
      objects.set(spec.id, { id: spec.id, mesh, edges, size: new THREE.Vector3(width, height, 0), edgeColor, sketch: true, bounds });
      if (mesh.visible) lastBounds.union(bounds);
    }
    select(selectedId, selectedFace);
    measurementEdges = measurementSegments(measurementGeometry, hiddenIds);
    if (!options.preserveView) fit();
  };

  const setRectangles = (rectangles: SketchShape[], options: { preserveView?: boolean; hiddenIds?: Iterable<string> } = {}) => {
    measurementGeometry = { rectangles };
    measurementHover = null;
    if ([measurementFirst, measurementSecond].some((anchor) => anchor && !resolveMeasurementAnchor(anchor, measurementGeometry))) { clearMeasurementDraft(); onMeasureStage?.('first'); }
    sketchRectangles = rectangles;
    hiddenIds.clear();
    for (const id of options.hiddenIds ?? []) hiddenIds.add(id);
    for (const object of objects.values()) {
      disposeObject(object);
    }
    objects.clear(); lastBounds = new THREE.Box3();
    for (const spec of rectangles) {
      const [width, height] = spec.size;
      const [x, y] = spec.position;
      const geometry = spec.kind === 'circle' ? new THREE.CircleGeometry(width / 2, 96) : new THREE.PlaneGeometry(Math.abs(width) || 1 / 64, Math.abs(height) || 1 / 64);
      const faceColor = parseFaceColor(spec.color);
      // Keep the plane raycastable while rendering the outline only.
      const material = new THREE.MeshBasicMaterial({ color: faceColor.color, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x + width / 2, y + height / 2, 0);
      mesh.userData.boxId = spec.id;
      const edgeColor = new THREE.Color(faceColor.color).getHex();
      const edgeGeometry = spec.kind === 'line'
        ? new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-width / 2, -height / 2, 0), new THREE.Vector3(width / 2, height / 2, 0)])
        : new THREE.EdgesGeometry(geometry);
      const edges = new THREE.LineSegments(edgeGeometry, withDepthBias(new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: 0.95 }), 2));
      edges.position.set(x + width / 2, y + height / 2, 0);
      mesh.visible = edges.visible = !hiddenIds.has(spec.id);
      boxRoot.add(mesh, edges);
      objects.set(spec.id, { id: spec.id, mesh, edges, size: new THREE.Vector3(width, height, 0), edgeColor });
      if (mesh.visible) { lastBounds.expandByPoint(new THREE.Vector3(x, y, 0)); lastBounds.expandByPoint(new THREE.Vector3(x + width, y + height, 0)); }
    }
    selectMany(selectedIds);
    measurementEdges = measurementSegments(measurementGeometry, hiddenIds);
    if (!options.preserveView) fit();
  };

  const setMode = (mode: 'model' | 'sketch') => {
    setNavigationTool('select');
    setMeasurementTool(false);
    sketchMode = mode === 'sketch';
    setSketchTool('select');
    axes.visible = !sketchMode;
    if (controls) {
      controls.enableRotate = !sketchMode;
      controls.mouseButtons = sketchMode
        ? { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN }
        : { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
    }
    perspectiveCamera.up.set(0, sketchMode ? 1 : 0, sketchMode ? 0 : 1);
    orthographicCamera.up.copy(perspectiveCamera.up);
    if (sketchMode) { setProjection('orthographic'); setView('top'); }
  };

  const setVisibility = (ids: string | Iterable<string>, visible: boolean) => {
    for (const id of typeof ids === 'string' ? [ids] : ids) {
      const object = objects.get(id);
      if (!object && !annotations.some((a) => a.measurement.id === id)) continue;
      if (visible) hiddenIds.delete(id);
      else hiddenIds.add(id);
      if (object) { object.mesh.visible = visible; object.edges.visible = visible; }
    }
    if (!visible && (hiddenIds.has(measurementFirst?.objectId ?? '') || hiddenIds.has(measurementSecond?.objectId ?? ''))) { clearMeasurementDraft(); onMeasureStage?.('first'); }
    measurementEdges = measurementSegments(measurementGeometry, hiddenIds);
    lastBounds.makeEmpty();
    for (const candidate of objects.values()) {
      if (candidate.mesh.visible) lastBounds.union(candidate.bounds ?? new THREE.Box3().setFromObject(candidate.mesh));
    }
    if (!visible && [...selectedIds].some((id) => hiddenIds.has(id))) applySelection([...selectedIds].filter((id) => !hiddenIds.has(id)), selectedFace);
  };

  const setView = (view: ViewName) => {
    if (sketchMode) view = 'top';
    currentView = view;
    const target = boundsCenter();
    const direction = new THREE.Vector3();
    if (sketchMode) direction.set(0, 0, 1);
    else if (view === 'front') direction.set(0, -1, 0);
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
    camera.up.set(0, sketchMode ? 1 : 0, sketchMode ? 0 : 1);
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

  const sketchPointAtPointer = (event: PointerEvent): SketchSnap | null => {
    if (!renderer) return null;
    pointerToNdc(event);
    raycaster.setFromCamera(pointer, camera);
    const point = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), new THREE.Vector3());
    if (!point) return null;
    const pixelsPerInch = camera instanceof THREE.OrthographicCamera
      ? renderer.domElement.getBoundingClientRect().height * camera.zoom / (camera.top - camera.bottom)
      : 0;
    const tolerance = pixelsPerInch > 0 ? 12 / pixelsPerInch : 0;
    return snapToSketchEdges([point.x, point.y], sketchRectangles.filter((rectangle) => !hiddenIds.has(rectangle.id)), tolerance);
  };

  const positionSketchOverlay = (event: PointerEvent, snap: SketchSnap | null) => {
    if (!renderer) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const ndc = snap?.kind ? new THREE.Vector3(snap.point[0], snap.point[1], 0).project(camera) : null;
    const guidePointX = ndc ? (ndc.x + 1) * rect.width / 2 : x;
    const guidePointY = ndc ? (1 - ndc.y) * rect.height / 2 : y;
    guideX.style.top = `${guidePointY}px`;
    guideY.style.left = `${guidePointX}px`;
    const boxWidth = sizeBox.offsetWidth || (sketchTool === 'line' ? 240 : 142);
    const boxHeight = sizeBox.offsetHeight || (sketchTool === 'line' ? 85 : 68);
    sizeBox.style.left = `${Math.max(8, Math.min(x + 14, rect.width - boxWidth - 8))}px`;
    sizeBox.style.top = `${Math.max(8, Math.min(y + 14, rect.height - boxHeight - 8))}px`;
    snapMarker.classList.toggle('visible', !!snap?.kind);
    if (snap?.kind) {
      snapMarker.textContent = snap.kind.toUpperCase();
      snapMarker.style.left = `${guidePointX}px`;
      snapMarker.style.top = `${guidePointY}px`;
    }
    sketchOverlay.classList.add('pointing');
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
    if (sketchMode && renderer) {
      const rect = renderer.domElement.getBoundingClientRect();
      let closest: string | null = null, distance = 10;
      for (const spec of sketchRectangles) {
        if (spec.kind !== 'line' || hiddenIds.has(spec.id)) continue;
        const project = (x: number, y: number) => {
          const v = new THREE.Vector3(x, y, 0).project(camera);
          return [(v.x + 1) * rect.width / 2 + rect.left, (1 - v.y) * rect.height / 2 + rect.top];
        };
        const a = project(...spec.position), b = project(spec.position[0] + spec.size[0], spec.position[1] + spec.size[1]);
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((event.clientX - a[0]) * dx + (event.clientY - a[1]) * dy) / (dx * dx + dy * dy)));
        const d = Math.hypot(event.clientX - a[0] - t * dx, event.clientY - a[1] - t * dy);
        if (d <= distance) { distance = d; closest = spec.id; }
      }
      if (closest) return { boxId: closest, face: 'top' as FaceName };
    }
    raycaster.params.Line.threshold = Math.max(0.05, boundsRadius() / 150);
    const hit = raycaster.intersectObjects([...objects.values()].filter((object) => !hiddenIds.has(object.id) && (!sketchMode || sketchRectangles.find((s) => s.id === object.id)?.kind !== 'line')).map((object) => object.mesh), true)[0];
    const boxId = hit?.object.userData.boxId as string | undefined;
    if (boxId && objects.get(boxId)?.sketch) return { boxId, face: null };
    if (!hit?.face || !boxId) return null;
    if (sketchMode) return { boxId, face: 'top' as FaceName };
    const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    return { boxId, face: faceFromNormal(normal) };
  };

  const measurementAtPointer = (event: PointerEvent) => {
    if (!renderer) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    camera.updateMatrixWorld(); boxRoot.updateMatrixWorld(true);
    const occluders = [...objects.values()].filter((object) => !object.sketch && !hiddenIds.has(object.id)).map((object) => object.mesh);
    return snapMeasurement([event.clientX - rect.left, event.clientY - rect.top], measurementEdges, projectMeasurementPoint, (point, selfOcclusionObjectId) => {
      if (sketchMode) return true;
      return measurementPointVisible(point, camera, occluders, raycaster, Math.max(0.001, boundsRadius() * 1e-5), selfOcclusionObjectId);
    });
  };

  const toggleMeasurementAxisMode = () => {
    measurementAxisMode = !measurementAxisMode;
    if (measurementFirst && measurementSecond) {
      const start = resolveMeasurementAnchor(measurementFirst, measurementGeometry), end = resolveMeasurementAnchor(measurementSecond, measurementGeometry);
      measurementDraftDistanceAxis = measurementAxisMode && start && end ? dominantMeasurementAxis(start, end) : undefined;
    }
    onMeasureModeChange?.(measurementAxisMode);
  };
  const onMeasurementModifier = (event: KeyboardEvent) => {
    if (event.key !== 'Shift' || event.repeat || event.ctrlKey || event.metaKey || event.altKey || !measurementTool) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select'))) return;
    // Wait for release so holding Shift for navigation doesn't also edit
    // the measurement, regardless of which device sends the next gesture.
    pendingMeasurementShift = true;
  };
  const onMeasurementModifierUp = (event: KeyboardEvent) => {
    if (event.key !== 'Shift') return;
    const target = event.target;
    const editing = target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select'));
    if (pendingMeasurementShift && measurementTool && !editing) toggleMeasurementAxisMode();
    pendingMeasurementShift = false;
  };
  const onNavigationWheel = (event: WheelEvent) => {
    if (event.shiftKey) pendingMeasurementShift = false;
  };
  const clearMeasurementHover = () => { measurementHover = null; };
  const onWindowBlur = () => { pendingMeasurementShift = false; controls?.setNavigationTool(navigationTool); clearMeasurementHover(); };

  const setNavigationTool = (tool: NavigationTool) => {
    navigationTool = sketchMode && tool === 'orbit' ? 'select' : tool;
    pendingMeasurementShift = false;
    pointerDown = null;
    selectionBox.hidden = true;
    controls?.setNavigationTool(navigationTool);
    if (renderer) renderer.domElement.style.cursor = navigationTool === 'zoom' ? 'ns-resize'
      : navigationTool !== 'select' ? 'grab' : measurementTool || sketchMode && sketchTool !== 'select' ? 'crosshair' : '';
  };

  const measurementLabelAtPointer = (event: PointerEvent) => {
    updateMeasurements();
    pointerToNdc(event);
    raycaster.setFromCamera(pointer, camera);
    const bounds = renderer!.domElement.getBoundingClientRect();
    const hits = annotations.filter(({ elements }) => elements.containsPoint(event.clientX - bounds.left, event.clientY - bounds.top));
    hits.sort((a, b) => a.elements.labelPosition.clone().sub(raycaster.ray.origin).dot(raycaster.ray.direction) - b.elements.labelPosition.clone().sub(raycaster.ray.origin).dot(raycaster.ray.direction));
    return hits[0]?.measurement.id;
  };

  const onPointerDown = (event: PointerEvent) => {
    // Cancel native mouse actions before handling secondary-click navigation.
    if (event.button === 1 || event.button === 2) event.preventDefault();
    if (event.shiftKey && event.button !== 0) pendingMeasurementShift = false;
    if (navigationTool !== 'select') { renderer?.domElement.focus({ preventScroll: true }); return; }
    if (measurementTool && event.button === 0) {
      event.preventDefault(); event.stopImmediatePropagation(); renderer?.domElement.focus({ preventScroll: true });
      renderer?.domElement.setPointerCapture(event.pointerId);
      pointerDown = { x: event.clientX, y: event.clientY, button: 0, pointerId: event.pointerId, dragged: false, additive: false };
      return;
    }
    const drawing = sketchMode && sketchTool !== 'select' && event.button === 0;
    const selecting = !drawing && event.button === 0;
    const snap = drawing ? sketchPointAtPointer(event) : null;
    if (drawing) { event.preventDefault(); event.stopImmediatePropagation(); renderer?.domElement.focus({ preventScroll: true }); positionSketchOverlay(event, snap); renderer?.domElement.setPointerCapture(event.pointerId); }
    if (selecting) { event.preventDefault(); event.stopImmediatePropagation(); renderer?.domElement.focus({ preventScroll: true }); renderer?.domElement.setPointerCapture(event.pointerId); }
    pointerDown = {
      x: event.clientX,
      y: event.clientY,
      button: event.button,
      pointerId: event.pointerId,
      dragged: false,
      additive: event.shiftKey || event.ctrlKey || event.metaKey,
      world: snap?.point,
    };
  };
  const onPointerMove = (event: PointerEvent) => {
    if (navigationTool !== 'select') return;
    if (measurementTool) {
      if (measurementSecond) updatePlacementCursor(event);
      else measurementHover = measurementAtPointer(event);
      if (!pointerDown || pointerDown.button === 0) { event.stopImmediatePropagation(); return; }
    }
    if (sketchMode && sketchTool !== 'select') {
      if (dimensionInputs.includes(document.activeElement as HTMLInputElement)) return;
      const snap = sketchPointAtPointer(event);
      positionSketchOverlay(event, snap);
      const point = snap?.point;
      const origin = sketchFirst ?? (pointerDown?.button === 0 ? pointerDown.world : undefined);
      if (point && origin) updateSketchPreview(origin, point);
      if (!pointerDown || pointerDown.button === 0) event.stopImmediatePropagation();
    }
    if (!pointerDown || pointerDown.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 4) {
      pointerDown.dragged = true;
    }
    if ((!sketchMode || sketchTool === 'select') && pointerDown.button === 0) {
      event.stopImmediatePropagation();
      if (pointerDown.dragged && renderer) {
        const bounds = renderer.domElement.getBoundingClientRect();
        selectionBox.hidden = false;
        selectionBox.style.left = `${Math.min(pointerDown.x, event.clientX) - bounds.left}px`;
        selectionBox.style.top = `${Math.min(pointerDown.y, event.clientY) - bounds.top}px`;
        selectionBox.style.width = `${Math.abs(event.clientX - pointerDown.x)}px`;
        selectionBox.style.height = `${Math.abs(event.clientY - pointerDown.y)}px`;
      }
    }
  };
  const onPointerUp = (event: PointerEvent) => {
    if (navigationTool !== 'select') return;
    const down = pointerDown;
    if (measurementTool && event.button === 0) {
      event.preventDefault(); event.stopImmediatePropagation(); pointerDown = null;
      if (renderer?.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
      if (!down || down.pointerId !== event.pointerId || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) return;
      if (measurementFirst && measurementSecond) {
        updatePlacementCursor(event); camera.updateMatrixWorld();
        const first = measurementFirst, second = measurementSecond, offset = parseInches(placementOffset()), axis = measurementDraftAxis ?? 'z';
        const distanceAxis = measurementDraftDistanceAxis;
        clearMeasurementDraft(); onMeasure?.(first, second, offset, axis, distanceAxis); onMeasureStage?.('first'); return;
      }
      const snap = measurementAtPointer(event); measurementHover = snap;
      if (!snap) { onMeasureStage?.('invalid'); return; }
      if (!measurementFirst) {
        measurementFirst = structuredClone(snap.anchor);
        const view = camera.getWorldDirection(new THREE.Vector3());
        measurementDraftAxis = sketchMode ? 'z' : measurementAxis === 'auto' ? autoMeasurementAxis([view.x, view.y, view.z]) : measurementAxis;
        onMeasureStage?.('second', measurementDraftAxis); return;
      }
      const distance = resolveMeasurement({ id: 'preview', start: measurementFirst, end: snap.anchor }, measurementGeometry)?.distance ?? 0;
      if (distance < 1 / 128) { onMeasureStage?.('same'); return; }
      const start = resolveMeasurementAnchor(measurementFirst, measurementGeometry)!;
      measurementDraftDistanceAxis = measurementAxisMode ? dominantMeasurementAxis(start, snap.point) : undefined;
      measurementSecond = structuredClone(snap.anchor); measurementHover = null;
      updatePlacementCursor(event);
      onMeasureStage?.('placement'); return;
    }
    if (sketchMode && sketchTool !== 'select') {
      if (event.button === 0) { event.preventDefault(); event.stopImmediatePropagation(); }
      if (event.button === 0 && renderer?.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
      pointerDown = null;
      if (event.button !== 0 || !down || down.pointerId !== event.pointerId) return;
      const snap = sketchPointAtPointer(event);
      positionSketchOverlay(event, snap);
      const point = snap?.point;
      if (!point) return;
      if (!sketchFirst) {
        sketchFirst = down.dragged && down.world ? down.world : point;
        if (down.dragged) finishSketch(point);
        else { updateSketchPreview(sketchFirst, point); onSketchStage?.('opposite'); }
      } else finishSketch(point);
      return;
    }
    if (!down || down.pointerId !== event.pointerId || down.button !== event.button) return;
    pointerDown = null;
    if (event.button === 0) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (renderer?.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
    }
    if (event.button === 0 && !down.dragged && Math.hypot(event.clientX - down.x, event.clientY - down.y) <= 4) {
      const measurementId = measurementLabelAtPointer(event);
      if (measurementId) {
        selectionBox.hidden = true;
        select(measurementId); onSelect(measurementId); return;
      }
    }
    const dragged = down.dragged || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4;
    if (!sketchMode && event.button === 0 && dragged && renderer) {
      selectionBox.hidden = true;
      const ids = modelObjectsInBox(objects.values(), camera, [down.x, down.y], [event.clientX, event.clientY], renderer.domElement.getBoundingClientRect(), hiddenIds);
      if (onModelSelect) onModelSelect(ids, down.additive ? 'add' : 'replace');
      else selectMany(down.additive ? [...selectedIds, ...ids] : ids);
      return;
    }
    if (sketchMode && sketchTool === 'select' && event.button === 0) {
      selectionBox.hidden = true;
      let ids: string[];
      if (dragged && renderer) {
        const bounds = renderer.domElement.getBoundingClientRect();
        ids = sketchShapesInBox(sketchRectangles, [down.x, down.y], [event.clientX, event.clientY], ([x, y]) => {
          const projected = new THREE.Vector3(x, y, 0).project(camera);
          return [(projected.x + 1) * bounds.width / 2 + bounds.left, (1 - projected.y) * bounds.height / 2 + bounds.top];
        }, hiddenIds);
      } else {
        const hit = faceAtPointer(event);
        ids = hit ? [hit.boxId] : [];
      }
      if (onSketchSelect) onSketchSelect(ids, down.additive ? dragged ? 'add' : 'toggle' : 'replace');
      else { select(ids[0] ?? null); onSelect(ids[0] ?? null); }
      return;
    }
    if (dragged) return;
    if (event.button === 2 && (down.additive || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey)) return;

    const hit = faceAtPointer(event);
    if (event.button === 0) {
      if (down.additive && onModelSelect) onModelSelect(hit ? [hit.boxId] : [], 'toggle');
      else {
        select(hit?.boxId ?? null, hit?.face ?? null);
        onSelect(hit?.boxId ?? null, hit?.face ?? null);
      }
    } else if (event.button === 2) {
      select(hit?.boxId ?? null, hit?.face ?? null);
      onSelect(hit?.boxId ?? null, hit?.face ?? null);
      if (hit?.face && !sketchMode) {
        onFaceContext?.({ ...hit, clientX: event.clientX, clientY: event.clientY });
      }
    }
  };
  const onContextMenu = (event: MouseEvent) => {
    event.preventDefault(); event.stopPropagation();
  };
  const onSecondaryClick = (event: MouseEvent) => { if (event.button === 2) event.preventDefault(); };
  const onSketchKeyDown = (event: KeyboardEvent) => {
    if (navigationTool !== 'select') return;
    if (event.key === 'Escape' && (!sketchMode || sketchTool === 'select')) {
      if (pointerDown && renderer?.domElement.hasPointerCapture(pointerDown.pointerId)) renderer.domElement.releasePointerCapture(pointerDown.pointerId);
      pointerDown = null; selectionBox.hidden = true;
      if (sketchMode) onSketchSelect?.([], 'replace');
      else onModelSelect?.([], 'replace');
      return;
    }
    if (event.key !== 'Tab' || event.shiftKey || !sketchMode || sketchTool === 'select' || !sketchFirst) return;
    event.preventDefault();
    (sketchTool === 'line' ? lengthInput : widthInput).focus();
  };
  const onPointerLeave = () => { sketchOverlay.classList.remove('pointing'); clearMeasurementHover(); };
  const onPointerCancel = () => { pointerDown = null; selectionBox.hidden = true; clearMeasurementHover(); };

  const clipCenter = new THREE.Vector3();
  const clipDirection = new THREE.Vector3();
  const clipSize = new THREE.Vector3();
  const updateClippingRange = () => {
    const center = lastBounds.isEmpty() ? clipCenter.set(0, 0, 0) : lastBounds.getCenter(clipCenter);
    const radius = lastBounds.isEmpty() ? EMPTY_RADIUS : Math.max(lastBounds.getSize(clipSize).length() / 2, 2);
    const distance = center.sub(camera.position).dot(camera.getWorldDirection(clipDirection));
    // Keep the near plane outside the model's bounding sphere. A near plane
    // fitted to the view gives the small line bias enough depth precision.
    const near = Math.max(0.01, (distance - radius) / 2);
    // Include the world-origin axes and 600-inch grid in the far range.
    const far = Math.max(near + 1, distance + radius * 2, camera.position.length() + 500);
    if (camera.near === near && camera.far === far) return;
    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();
  };

  const render = () => {
    if (disposed || !renderer) return;
    animationFrame = requestAnimationFrame(render);
    // Changing the drawing buffer clears it. Resize and redraw in the same
    // frame so a ResizeObserver callback cannot leave a blank canvas at paint.
    if (resizePending) resize();
    controls?.update();
    const { inchBlend, fillOpacity } = gridAppearanceForCamera(camera, camera.position.distanceTo(controls?.target ?? grid.position), host.clientHeight);
    inchGrid.visible = inchBlend > 0;
    footGrid.visible = inchBlend < 1;
    gridFill.visible = inchBlend < 1;
    gridFill.material.opacity = fillOpacity;
    for (const [helper, opacity] of [[inchGrid, inchBlend], [footGrid, 1 - inchBlend]] as const) {
      const materials = Array.isArray(helper.material) ? helper.material : [helper.material];
      materials.forEach((material) => { material.opacity = GRID_LINE_OPACITY * opacity; });
    }
    updateClippingRange();
    updateMeasurements();
    renderer.render(scene, camera);
  };

  if (renderer) {
    makeControls();
    setView(currentView);
    observer = new ResizeObserver(() => { resizePending = true; });
    observer.observe(host);
    renderer.domElement.addEventListener('pointerdown', onPointerDown, true);
    renderer.domElement.addEventListener('pointermove', onPointerMove, true);
    renderer.domElement.addEventListener('pointerup', onPointerUp, true);
    renderer.domElement.addEventListener('pointerleave', onPointerLeave);
    renderer.domElement.addEventListener('pointercancel', onPointerCancel, true);
    renderer.domElement.addEventListener('keydown', onSketchKeyDown);
    renderer.domElement.addEventListener('contextmenu', onContextMenu, true);
    renderer.domElement.addEventListener('mousedown', onSecondaryClick, true);
    renderer.domElement.addEventListener('auxclick', onSecondaryClick, true);
    renderer.domElement.addEventListener('wheel', onNavigationWheel, { capture: true, passive: true });
    window.addEventListener('keydown', onMeasurementModifier);
    window.addEventListener('keyup', onMeasurementModifierUp);
    window.addEventListener('blur', onWindowBlur);
    render();
  }

  return {
    setBoxes,
    setRectangles,
    setMode,
    setSketchTool,
    setMeasurementTool,
    setMeasurementAxis: (axis) => { measurementAxis = axis; if (measurementFirst && axis !== 'auto') measurementDraftAxis = sketchMode ? 'z' : axis; },
    setMeasurements,
    setMeasurementsThroughObjects: (through) => { measurementsThroughObjects = through; },
    select,
    selectMany,
    setVisibility,
    setView,
    fit,
    setProjection,
    setNavigationTool,
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
        renderer.domElement.removeEventListener('pointerleave', onPointerLeave);
        renderer.domElement.removeEventListener('pointercancel', onPointerCancel, true);
        renderer.domElement.removeEventListener('keydown', onSketchKeyDown);
        renderer.domElement.removeEventListener('contextmenu', onContextMenu, true);
        renderer.domElement.removeEventListener('mousedown', onSecondaryClick, true);
        renderer.domElement.removeEventListener('auxclick', onSecondaryClick, true);
        renderer.domElement.removeEventListener('wheel', onNavigationWheel, true);
        window.removeEventListener('keydown', onMeasurementModifier);
        window.removeEventListener('keyup', onMeasurementModifierUp);
        window.removeEventListener('blur', onWindowBlur);
      }
      controls?.dispose();
      angleGuide.geometry.dispose();
      angleGuide.material.dispose();
      sketchPreview.geometry.dispose();
      sketchPreview.material.dispose();
      previewAnnotation.dispose();
      annotations.forEach(({ elements }) => elements.dispose());
      for (const object of objects.values()) {
        disposeObject(object);
      }
      inchGrid.geometry.dispose();
      footGrid.geometry.dispose();
      gridFill.geometry.dispose();
      gridFill.material.dispose();
      gridMaterials.forEach((material) => material.dispose());
      axes.traverse((child) => {
        if (child instanceof THREE.Line) {
          child.geometry.dispose();
          child.material.dispose();
        }
      });
      renderer?.dispose();
      renderer?.domElement.remove();
      measurementOverlay.remove();
      objects.clear();
    },
  };
}
