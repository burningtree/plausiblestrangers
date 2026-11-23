// Iconoir icons (via @iconify-json/iconoir), inlined as SVG at build time —
// no icon font, no runtime request. Browse names at https://iconoir.com
import iconoir from '@iconify-json/iconoir/icons.json';

type IconSet = { icons: Record<string, { body: string }>; aliases?: Record<string, { parent: string }> };
const set = iconoir as unknown as IconSet;

export function iconSvg(name: string, cls = 'icon') {
  const real = set.icons[name] ? name : set.aliases?.[name]?.parent;
  const icon = real && set.icons[real];
  if (!icon) throw new Error(`unknown iconoir icon: ${name}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em" class="${cls}" aria-hidden="true" focusable="false">${icon.body}</svg>`;
}
