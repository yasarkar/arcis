import fs from 'fs';
import { Resvg } from '@resvg/resvg-js';

const svg = fs.readFileSync('public/logo.svg', 'utf8');

// Render at 3x resolution for Retina email displays (660px width x 150px height)
const resvg = new Resvg(svg, {
  fitTo: {
    mode: 'width',
    value: 660,
  },
  background: 'rgba(0, 0, 0, 0)', // Transparent
});

const pngData = resvg.render();
const pngBuffer = pngData.asPng();

fs.writeFileSync('public/logo.png', pngBuffer);
console.log('Successfully generated public/logo.png! Size:', pngBuffer.length, 'bytes');
