// Prints the colour of pixels in a captured PNG: node qa/r10-tor-pixels.cjs <file.png> x,y [x,y ...]  (uses the PNG reader inside playwright-core)
const fs = require('node:fs');
const {PNG} = require('playwright-core/lib/utilsBundle');
const [file, ...points] = process.argv.slice(2);
const png = PNG.sync.read(fs.readFileSync(file));
for (const point of points) {
  const [x, y] = point.split(',').map(Number), i = (png.width * y + x) << 2;
  console.log(`${x},${y}: rgb(${png.data[i]}, ${png.data[i + 1]}, ${png.data[i + 2]}) alpha ${png.data[i + 3]}`);
}
console.log(`size ${png.width}x${png.height}`);
