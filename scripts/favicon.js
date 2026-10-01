// docs/favicon.ico, for crawlers and browsers that ask for /favicon.ico. It holds the 32x32 and 192x192 logos as
// they are: an ICO file can contain PNG images unchanged, so nothing is resampled and the pixel art stays crisp.
// npm run build:demo writes it; test/pages.test.js checks it holds exactly these two images.

/** The logos in the icon, smallest first: [published path, pixel size]. */
export const ICON_SOURCES = [["docs/assets/honeytongue-logo-32.png", 32], ["docs/assets/honeytongue-logo-192.png", 192]];

/** An ICO file holding these PNG images, given as [bytes, size] pairs. */
export function buildIco(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1: an icon
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(([png, size], i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, entry); // width (0 means 256)
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1); // height
    header.writeUInt8(0, entry + 2); // no palette
    header.writeUInt8(0, entry + 3); // reserved
    header.writeUInt16LE(1, entry + 4); // colour planes
    header.writeUInt16LE(32, entry + 6); // bits per pixel
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map(([png]) => png)]);
}

/** The images in an ICO file, as { size, bytes } (for the test). */
export function readIco(ico) {
  if (ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1) throw new Error("not an icon file");
  return Array.from({ length: ico.readUInt16LE(4) }, (_, i) => {
    const entry = 6 + 16 * i;
    const length = ico.readUInt32LE(entry + 8), offset = ico.readUInt32LE(entry + 12);
    return { size: ico.readUInt8(entry) || 256, bytes: ico.subarray(offset, offset + length) };
  });
}
