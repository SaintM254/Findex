import fs from 'node:fs';
import path from 'node:path';
import opentype from 'opentype.js';
import { Resvg } from '@resvg/resvg-js';

const source = fs.readFileSync('assets/branding/findex-original.svg', 'utf8');
const fontData = fs.readFileSync('assets/fonts/Poppins-Bold.ttf');
const font = opentype.parse(fontData.buffer.slice(fontData.byteOffset, fontData.byteOffset + fontData.byteLength));
const lettering = font.getPath('Findex', 136.796, 303.433, 68.839).toPathData(3);
const outlined = source.replace(/<text\b[\s\S]*?<\/text>/, `<path d="${lettering}" fill="#fff"/>`);
fs.writeFileSync('public/findex.svg', outlined);
function png(file, size, sourceSvg = outlined) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, new Resvg(sourceSvg, { fitTo: { mode: 'width', value: size } }).render().asPng());
}
png('public/images/findex-icon.png', 512);
png('android/app/src/main/res/drawable-nodpi/findex_launcher_art.png', 512);
for (const [density, icon, foreground] of [['mdpi',48,108],['hdpi',72,162],['xhdpi',96,216],['xxhdpi',144,324],['xxxhdpi',192,432]]) {
  for (const suffix of ['', '_round']) png(`android/app/src/main/res/mipmap-${density}/ic_launcher${suffix}.png`, icon);
  png(`android/app/src/main/res/mipmap-${density}/ic_launcher_foreground.png`, foreground);
}
// A cropped mark remains legible in small in-app brand treatments.
fs.writeFileSync('public/images/findex-mark.svg', outlined.replace('viewBox="0 0 512 512"', 'viewBox="90 125 332 254"').replace('width="512" height="512"', 'width="332" height="254"'));
console.log('Generated the provided icon, outlined Poppins lettering, and Android launcher densities.');
