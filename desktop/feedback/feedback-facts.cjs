'use strict';
// Beta 14: the "technical details" a report may carry when the person ticks the box. Each is a fixed word or a bucket (feedback-report.cjs checks
// every value again against its own rule), never a path, a name, an address or a page. `inputs` come from main; this file only turns them into words.
const bucketMemory = (bytes) => {
  const gb = Number(bytes) / 1024 ** 3;
  return gb < 4 ? '<4 GB' : gb < 8 ? '4-8 GB' : gb < 16 ? '8-16 GB' : gb < 32 ? '16-32 GB' : '32+ GB';
};
const bucketScale = (scale) => {
  const known = [1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  const hit = known.find((value) => Math.abs(value - Number(scale)) < 0.01);
  return hit === undefined ? 'other' : String(hit);
};
function osName(platform, systemVersion) {
  const major = Number.parseInt(String(systemVersion || '').split('.')[0], 10);
  if (platform === 'darwin') return Number.isFinite(major) ? `macOS ${major}` : 'macOS 0';
  if (platform === 'win32') { const build = Number.parseInt(String(systemVersion || '').split('.')[2], 10); return build >= 22000 ? 'Windows 11' : 'Windows 10'; }
  return 'Linux';
}
/** inputs: {platform, systemVersion, arch, language, scaleFactor, dark, layout, reducedMotion, softwareDrawing, totalMemory, displays} */
function technicalFacts(inputs) {
  return {
    os: osName(inputs.platform, inputs.systemVersion),
    arch: ['x64', 'arm64', 'ia32'].includes(inputs.arch) ? inputs.arch : 'other',
    language: String(inputs.language || 'en').replace(/_/g, '-'),
    displayScale: bucketScale(inputs.scaleFactor),
    theme: inputs.dark ? 'dark' : 'light',
    layout: String(inputs.layout || 'top'),
    motion: inputs.reducedMotion ? 'reduced' : 'full',
    gpu: inputs.softwareDrawing ? 'software' : 'hardware',
    memory: bucketMemory(inputs.totalMemory),
    monitors: Number(inputs.displays) >= 3 ? '3+' : Number(inputs.displays) === 2 ? '2' : '1',
  };
}
module.exports = { technicalFacts, bucketMemory, bucketScale, osName };
