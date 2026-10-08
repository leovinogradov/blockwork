import { OrthographicCamera, PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// Model units are inches. This is a reference scale, not a movement floor.
const DEFAULT_REFERENCE_VIEW_HEIGHT = 6;
const PAN_SPEED = 0.85;
const ZOOM_SPEED = 0.8;
const MULTIPLIER_POW = 0 // 0 = linear slowdown, 0.5 = square-root slowdown, 1 = no slowdown

export class NavigationControls extends OrbitControls {
  private referenceViewHeight: number;

  constructor(camera: PerspectiveCamera | OrthographicCamera, element: HTMLElement, referenceViewHeight = DEFAULT_REFERENCE_VIEW_HEIGHT) {
    super(camera, element);
    this.referenceViewHeight = referenceViewHeight;
    this.addEventListener('change', this.updateNavigationSpeeds);
    this.updateNavigationSpeeds();
  }

  setReferenceViewHeight(viewHeight: number) {
    this.referenceViewHeight = viewHeight;
    this.updateNavigationSpeeds();
  }

  private updateNavigationSpeeds = () => {
    const camera = this.object;
    const viewHeight = camera instanceof OrthographicCamera
      ? (camera.top - camera.bottom) / camera.zoom
      : camera instanceof PerspectiveCamera
        ? 2 * camera.position.distanceTo(this.target) * Math.tan(camera.fov * Math.PI / 360)
        : this.referenceViewHeight;
    // OrbitControls' movement is linear in view height. Multiplying by its
    // inverse square root makes movement follow sqrt(reference * viewHeight).
    // It keeps decreasing toward zero, with no threshold or minimum speed.
    const multiplier = viewHeight > 0 ? Math.pow(this.referenceViewHeight / viewHeight, MULTIPLIER_POW) : 1;
    this.panSpeed = PAN_SPEED * multiplier;
    this.zoomSpeed = ZOOM_SPEED * multiplier;
  };

  override dispose() {
    this.removeEventListener('change', this.updateNavigationSpeeds);
    super.dispose();
  }
}
