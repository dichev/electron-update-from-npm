// Icon files from a nativeImage, with PNG entries
export const pngAt = (image, size) => image.resize({ width: size, height: size, quality: 'best' }).toPNG()

// ICONDIR (reserved, type 1, one image) + ICONDIRENTRY (size 0 = 256, planes 1, 32 bpp, byte length, offset 22), then the PNG
export function toIco(png) {
  const head = Buffer.alloc(22)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(1, 4)
  head.writeUInt16LE(1, 10)
  head.writeUInt16LE(32, 12)
  head.writeUInt32LE(png.length, 14)
  head.writeUInt32LE(22, 18)
  return Buffer.concat([head, png])
}

// 'icns' + total length, then per image its type + length (both big-endian, lengths including the 8-byte headers)
export function toIcns(images) {
  const block = (type, data) => {
    const head = Buffer.alloc(8)
    head.write(type)
    head.writeUInt32BE(data.length + 8, 4)
    return Buffer.concat([head, data])
  }
  return block('icns', Buffer.concat(Object.entries(images).map(([type, png]) => block(type, png))))
}
