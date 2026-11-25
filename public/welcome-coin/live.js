// b14 welcome r6 SAMPLE: the Early Member seal, live. The same three.js coin and shader as the rendered seals (badges/r5/src/seal4.js,
// copied unchanged apart from its imports), drawn every frame the pose changes: pointer x/y tilt the coin (rotY/rotX) and turn the
// studio light (uLight), so the foil and the bevel highlights move with the hand.
import { THREE, renderer, canvas, material, coinGeometry } from './seal4.js';

const geo = coinGeometry();
const camera = new THREE.PerspectiveCamera(16, 1, 0.1, 60);
camera.position.set(0, 0, 8.6); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix();
const made = {};
/** One live seal per rank. px = drawing-buffer size in device pixels. */
export function liveSeal(rank = 'early', look = rank, px = 720) {
  if (made[rank]) return made[rank];
  const mat = material(look, rank);
  const mesh = new THREE.Mesh(geo, mat); const scene = new THREE.Scene(); scene.add(mesh);
  renderer.setSize(px, px, false); renderer.setClearColor(0x000000, 0);
  let last = '';
  const draw = (rx, ry, light) => {
    const key = rx.toFixed(4) + ry.toFixed(4) + light.toFixed(4); if (key === last) return; last = key;
    mesh.rotation.set(rx, ry, 0); mesh.updateMatrixWorld(true);
    mat.uniforms.uRot.value.setFromMatrix4(mesh.matrixWorld); mat.uniforms.uLight.value = light;
    renderer.render(scene, camera);
  };
  draw(-0.1, 0.14, 0);   // the rest pose of the rendered sprite (H_early.png): the hand-over between them is invisible
  made[rank] = { canvas, draw };
  return made[rank];
}
