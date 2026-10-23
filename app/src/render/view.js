// Cameras. The pilot always stands at the flight line, eyes 1.7 m up.
//   FlatView: the view turns to follow the heli like your head would, with optional
//             auto-zoom so a far-away heli stays readable on a phone screen.
//   CardboardView: side-by-side stereo with lens pre-distortion, head-tracked from the
//             phone's orientation sensors. Works without WebXR.
//   WebXR immersive-vr is handled in main.js through three's XR manager when offered.

import * as THREE from "three";

const EYE = new THREE.Vector3(0, 1.7, 0);

export class FlatView {
  constructor() {
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 6000);
    this.camera.position.copy(EYE);
    this.look = new THREE.Vector3(0, 0.5, -5);
    this.fov = 50;
  }

  resize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }

  update(target, dt, { autoZoom = true, refDistance = 6, baseFov = 34 } = {}) {
    const k = Math.min(1, dt * 14);
    this.look.lerp(target, k);
    this.camera.lookAt(this.look);
    const d = this.camera.position.distanceTo(target);
    const want = autoZoom ? THREE.MathUtils.clamp(baseFov * Math.pow(refDistance / Math.max(d, 0.1), 0.6), Math.min(12, baseFov), baseFov) : baseFov;
    this.fov += (want - this.fov) * Math.min(1, dt * 3);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
  }

  render(renderer, scene) { renderer.render(scene, this.camera); }
}

const DISTORT = {
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: `uniform sampler2D tex; uniform float k1, k2, eyeAspect, zoom; varying vec2 vUv;
    void main(){
      float eye = step(0.5, vUv.x);
      vec2 local = vec2(fract(vUv.x * 2.0), vUv.y);
      vec2 p = (local - 0.5) * vec2(eyeAspect, 1.0);
      float r2 = dot(p, p);
      p *= (1.0 + k1 * r2 + k2 * r2 * r2) * zoom;
      vec2 q = p / vec2(eyeAspect, 1.0) + 0.5;
      if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
      gl_FragColor = texture2D(tex, vec2((q.x + eye) * 0.5, q.y));
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

export class CardboardView {
  constructor() {
    this.head = new THREE.Group();
    this.head.position.copy(EYE);
    this.left = new THREE.PerspectiveCamera(80, 1, 0.1, 6000);
    this.right = new THREE.PerspectiveCamera(80, 1, 0.1, 6000);
    this.head.add(this.left, this.right);
    this.ipd = 0.064;
    // linear HDR target; the distortion pass applies tone mapping and sRGB output itself
    this.rt = new THREE.WebGLRenderTarget(2, 2, { samples: 2, type: THREE.HalfFloatType });
    this.mat = new THREE.ShaderMaterial({
      ...DISTORT,
      uniforms: { tex: { value: this.rt.texture }, k1: { value: 0.28 }, k2: { value: 0.12 }, eyeAspect: { value: 1 }, zoom: { value: 0.85 } },
      depthTest: false, depthWrite: false,
    });
    this.quadScene = new THREE.Scene();
    this.quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat));
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.orient = null;
    this.yawOffset = 0;
    this._q = new THREE.Quaternion();
    this.onOrient = (e) => { if (e.alpha != null) this.orient = { a: e.alpha, b: e.beta, g: e.gamma }; };
    this.tracked = new THREE.Vector3(0, 0.5, -5);
    this.headTracking = true;  // off: stereo 3D that follows the heli, like the flat view
  }

  start() { addEventListener("deviceorientation", this.onOrient); this.needsCenter = true; }
  stop() { removeEventListener("deviceorientation", this.onOrient); this.orient = null; }

  setLens({ k1, k2, zoom, ipd, fov }) {
    if (k1 != null) this.mat.uniforms.k1.value = k1;
    if (k2 != null) this.mat.uniforms.k2.value = k2;
    if (zoom != null) this.mat.uniforms.zoom.value = zoom;
    if (ipd != null) this.ipd = ipd;
    if (fov != null) { this.left.fov = this.right.fov = fov; this.left.updateProjectionMatrix(); this.right.updateProjectionMatrix(); }
  }

  resize(w, h, pixelRatio) {
    const ew = w / 2;
    for (const c of [this.left, this.right]) { c.aspect = ew / h; c.updateProjectionMatrix(); }
    this.rt.setSize(Math.round(w * pixelRatio), Math.round(h * pixelRatio));
    this.mat.uniforms.eyeAspect.value = ew / h;
  }

  /** Face the current view direction toward the field (−z). */
  recenter() { this.needsCenter = true; }

  headQuaternion(out) {
    const o = this.orient;
    if (!o) return null;
    const D = THREE.MathUtils.DEG2RAD;
    const euler = new THREE.Euler(o.b * D, o.a * D, -o.g * D, "YXZ");
    out.setFromEuler(euler);
    out.multiply(new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2));  // camera looks out of the back of the phone
    const angle = (screen.orientation?.angle ?? window.orientation ?? 0) * D;
    out.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -angle));
    return out;
  }

  update(target, dt) {
    const q = this.headTracking ? this.headQuaternion(this._q) : null;
    if (q) {
      if (this.needsCenter) {
        const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
        this.yawOffset = Math.atan2(-f.x, -f.z) * -1;
        this.needsCenter = false;
      }
      const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yawOffset);
      this.head.quaternion.copy(yaw.multiply(q));
    } else {
      // head tracking off, or no sensors (desktop): follow the heli
      this.tracked.lerp(target, Math.min(1, dt * 14));
      this.head.lookAt(this.tracked);
      this.head.rotateY(Math.PI);  // Object3D.lookAt points +z at the target; cameras look down -z
    }
    this.left.position.set(-this.ipd / 2, 0, 0);
    this.right.position.set(this.ipd / 2, 0, 0);
    this.head.updateMatrixWorld(true);
  }

  render(renderer, scene) {
    // a render target carries its own viewport/scissor; renderer.setViewport only affects the canvas
    const rt = this.rt, w = rt.width, h = rt.height;
    rt.scissorTest = true;
    renderer.setRenderTarget(rt);
    for (const [cam, x] of [[this.left, 0], [this.right, w / 2]]) {
      rt.viewport.set(x, 0, w / 2, h);
      rt.scissor.set(x, 0, w / 2, h);
      renderer.setRenderTarget(rt);  // re-apply the target's viewport
      renderer.clear();
      renderer.render(scene, cam);
    }
    renderer.setRenderTarget(null);
    renderer.render(this.quadScene, this.quadCam);
  }
}

export { EYE };
