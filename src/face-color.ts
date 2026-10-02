/** Split a face color into the opaque color understood by Three.js and its material opacity. */
export function parseFaceColor(value: string): { color: string | number; opacity: number } {
  const color = value.trim();
  if (color.toLowerCase() === 'transparent') return { color: 0x8795a1, opacity: 0.2 };

  const hex8 = /^#([\da-f]{6})([\da-f]{2})$/i.exec(color);
  if (hex8) return { color: `#${hex8[1]}`, opacity: parseInt(hex8[2], 16) / 255 };

  const hex4 = /^#([\da-f]{3})([\da-f])$/i.exec(color);
  if (hex4) return { color: `#${[...hex4[1]].map((digit) => digit + digit).join('')}`, opacity: parseInt(hex4[2] + hex4[2], 16) / 255 };

  const functional = /^(rgba|hsla)\((.*),\s*(\d*\.?\d+)\s*\)$/i.exec(color);
  if (functional) {
    const opacity = Number(functional[3]);
    if (opacity >= 0 && opacity <= 1) return { color: `${functional[1].slice(0, -1)}(${functional[2]})`, opacity };
  }
  return { color, opacity: 1 };
}
