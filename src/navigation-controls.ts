import { MOUSE, OrthographicCamera, PerspectiveCamera, Vector2, Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const ZOOM_SPEED = 0.8;
export const MIN_ZOOM_STEP_FRACTION = 1 / 100;
const WHEEL_STEP_DELTA = 100;
type PickNavigationPoint = (pointer: Vector2) => Vector3 | null;
export type NavigationInput = 'mouse' | 'trackpad';
export type NavigationTool = 'select' | 'orbit' | 'pan' | 'zoom';

const wheelPixels = (event: WheelEvent) => event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;

export class NavigationControls extends OrbitControls {
  inputDevice: NavigationInput = 'mouse';
  private navigationTool: NavigationTool = 'select';
  private drag: { pointerId: number; x: number; y: number; anchorX: number; anchorY: number; panSpeed: number } | null = null;
  // Three's installed OrbitControls implements these helpers but omits them
  // from its public typings. Reuse its camera limits and projection math.
  declare protected _pan: (x: number, y: number) => void;
  declare protected _rotateLeft: (angle: number) => void;
  declare protected _rotateUp: (angle: number) => void;
  declare protected _handleMouseWheel: (event: { clientX: number; clientY: number; deltaY: number }) => void;
  private readonly surface: HTMLElement;
  private readonly pickPoint: PickNavigationPoint;
  private readonly modelScale: () => number;
  private readonly pointers = new Set<number>();

  constructor(camera: PerspectiveCamera | OrthographicCamera, element: HTMLElement, pickPoint: PickNavigationPoint, modelScale: () => number) {
    // Register preparation before OrbitControls' handlers. Viewport tools can
    // still intercept input in the capture phase before either handler runs.
    super(camera, null);
    this.surface = element;
    this.pickPoint = pickPoint;
    this.modelScale = modelScale;
    this.enableDamping = false;
    this.screenSpacePanning = true;
    this.zoomToCursor = true;
    this.panSpeed = 1;
    this.zoomSpeed = ZOOM_SPEED;
    element.addEventListener('pointerdown', this.preparePointerDown);
    element.addEventListener('pointermove', this.moveNavigationPointer);
    element.addEventListener('pointerup', this.finishPointer);
    element.addEventListener('pointercancel', this.finishPointer);
    element.addEventListener('lostpointercapture', this.finishPointer);
    element.addEventListener('wheel', this.prepareWheel, { passive: false });
    this.connect(element);
  }

  private surfaceDepth(clientX: number, clientY: number) {
    const rect = this.surface.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.object.updateMatrixWorld();
    const point = this.pickPoint(new Vector2(
      (clientX - rect.left) / rect.width * 2 - 1,
      1 - (clientY - rect.top) / rect.height * 2,
    ));
    if (!point) return null;
    const depth = point.clone().sub(this.object.position).dot(this.object.getWorldDirection(new Vector3()));
    return Number.isFinite(depth) && depth > 0 ? depth : null;
  }

  private preparePointerDown = (event: PointerEvent) => {
    if (!this.enabled) return;
    if (event.button === 0 && this.navigationTool !== 'select') {
      event.preventDefault(); event.stopImmediatePropagation();
      if (this.drag) return;
      this.pointers.add(event.pointerId);
      this.drag = {
        pointerId: event.pointerId, x: event.clientX, y: event.clientY,
        anchorX: event.clientX, anchorY: event.clientY,
        panSpeed: this.surfacePanSpeed(event.clientX, event.clientY),
      };
      this.surface.setPointerCapture(event.pointerId);
      this.dispatchEvent({ type: 'start' });
      return;
    }
    this.zoomSpeed = ZOOM_SPEED;
    this.pointers.add(event.pointerId);
    if (event.pointerType === 'touch') return;
    const action = event.button === 0 ? this.mouseButtons.LEFT
      : event.button === 1 ? this.mouseButtons.MIDDLE : event.button === 2 ? this.mouseButtons.RIGHT : null;
    const modified = event.ctrlKey || event.metaKey || event.shiftKey;
    const panning = action === MOUSE.PAN ? !modified : action === MOUSE.ROTATE && modified;
    if (!panning || !this.enablePan) return;
    this.panSpeed = this.surfacePanSpeed(event.clientX, event.clientY);
  };

  private surfacePanSpeed(clientX: number, clientY: number) {
    if (this.object instanceof PerspectiveCamera) {
      const depth = this.surfaceDepth(clientX, clientY);
      const targetDistance = this.object.position.distanceTo(this.target);
      // OrbitControls pans on a screen-facing plane at targetDistance. This
      // ratio moves that plane to the picked depth without moving the camera
      // or its orbit center. Keep it fixed for the entire drag.
      if (depth !== null && targetDistance > 0) return depth / (targetDistance * this.object.zoom);
    }
    return 1;
  }

  setNavigationTool(tool: NavigationTool) {
    this.cancelNavigationDrag();
    this.navigationTool = tool;
  }

  private cancelNavigationDrag() {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    this.pointers.delete(drag.pointerId);
    if (this.surface.hasPointerCapture(drag.pointerId)) this.surface.releasePointerCapture(drag.pointerId);
    this.dispatchEvent({ type: 'end' });
  }

  private panPixels(x: number, y: number, speed: number) {
    if (!this.enablePan) return;
    this._pan(x * speed, y * speed);
    this.update();
  }

  private orbitPixels(x: number, y: number) {
    if (!this.enableRotate) return;
    const scale = 2 * Math.PI * this.rotateSpeed / Math.max(this.surface.clientHeight, 1);
    this._rotateLeft(x * scale);
    this._rotateUp(y * scale);
    this.update();
  }

  private moveNavigationPointer = (event: PointerEvent) => {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (this.enabled) {
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (this.navigationTool === 'pan') this.panPixels(dx, dy, drag.panSpeed);
      else if (this.navigationTool === 'orbit') this.orbitPixels(dx, dy);
      else if (this.navigationTool === 'zoom' && this.enableZoom && dy !== 0) {
        const zoomEvent = { clientX: drag.anchorX, clientY: drag.anchorY, deltaY: dy, deltaMode: 0 } as WheelEvent;
        this.prepareZoom(zoomEvent);
        this._handleMouseWheel(zoomEvent);
      }
    }
    drag.x = event.clientX; drag.y = event.clientY;
  };

  private finishPointer = (event: PointerEvent) => {
    if (this.drag?.pointerId === event.pointerId) {
      event.stopImmediatePropagation();
      this.cancelNavigationDrag();
    }
    this.pointers.delete(event.pointerId);
    if (this.pointers.size === 0) this.panSpeed = 1;
  };

  private prepareWheel = (event: WheelEvent) => {
    if (this.drag) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    if (this.inputDevice === 'trackpad' && !event.ctrlKey && !event.metaKey) {
      if (!this.enabled) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (this.pointers.size > 0) return;
      const units = wheelPixels(event);
      const dx = event.deltaX * units, dy = event.deltaY * units;
      if (dx === 0 && dy === 0) return;
      this.dispatchEvent({ type: 'start' });
      // Wheel deltas describe scrolling, the inverse of a pointer drag.
      if (event.shiftKey && this.enableRotate) this.orbitPixels(-dx, -dy);
      else this.panPixels(-dx, -dy, this.surfacePanSpeed(event.clientX, event.clientY));
      this.dispatchEvent({ type: 'end' });
      return;
    }
    if (!this.enabled || !this.enableZoom || event.deltaY === 0 || this.pointers.size > 0) return;
    this.prepareZoom(event);
  };

  private prepareZoom(event: WheelEvent) {
    if (this.object instanceof PerspectiveCamera) {
      const depth = this.surfaceDepth(event.clientX, event.clientY);
      if (depth !== null) {
        const distance = Math.max(this.minDistance, Math.min(this.maxDistance, depth));
        // Rebase along the view direction to preserve the framing. Setting the
        // target directly to an off-center hit would make the camera turn/jump.
        this.target.copy(this.object.position).addScaledVector(this.object.getWorldDirection(new Vector3()), distance);
        this.update();
      } // Empty space keeps the current focus depth.
    }
    this.prepareZoomSpeed(event);
  }

  private prepareZoomSpeed(event: WheelEvent) {
    this.zoomSpeed = ZOOM_SPEED;
    const extent = this.object instanceof OrthographicCamera
      ? (this.object.top - this.object.bottom) / this.object.zoom
      : this.object.position.distanceTo(this.target);
    // Match OrbitControls' wheel-unit conversion; retain its Ctrl/pinch
    // acceleration. A standard 100-pixel step moves at least the configured
    // fraction of the visible model's diagonal; smaller inputs scale proportionally.
    const wheelUnits = wheelPixels(event);
    const delta = Math.abs(event.deltaY) * wheelUnits / WHEEL_STEP_DELTA;
    const minimumStep = this.modelScale() * MIN_ZOOM_STEP_FRACTION * delta;
    if (extent <= 0 || minimumStep <= 0) return;
    const zoomIn = event.deltaY < 0;
    const baseExponent = Math.log(0.95) * ZOOM_SPEED * delta;
    const normalStep = extent * Math.abs(Math.expm1(zoomIn ? baseExponent : -baseExponent));
    if (normalStep >= minimumStep) return;
    // Solve for the stock zoom exponent instead of adding a separate camera
    // movement, preserving zoom-to-cursor and the existing travel limits.
    const ratio = minimumStep / extent;
    const exponent = zoomIn
      ? -Math.log1p(-Math.min(ratio, 1 - Number.EPSILON))
      : Math.log1p(ratio);
    this.zoomSpeed = exponent / (-Math.log(0.95) * delta);
  }

  override dispose() {
    this.cancelNavigationDrag();
    this.surface.removeEventListener('pointerdown', this.preparePointerDown);
    this.surface.removeEventListener('pointermove', this.moveNavigationPointer);
    this.surface.removeEventListener('pointerup', this.finishPointer);
    this.surface.removeEventListener('pointercancel', this.finishPointer);
    this.surface.removeEventListener('lostpointercapture', this.finishPointer);
    this.surface.removeEventListener('wheel', this.prepareWheel);
    this.pointers.clear();
    super.dispose();
  }
}
