// "download the album": pick a format and the browser fetches the record's tracks
// in it (m4a from the site, often already cached; MP3/FLAC from the download
// server), puts them in one zip with the cover and a readme, and saves it.
// Nothing extra is stored anywhere.
import { zip, type ZipFile } from './zip';
import { saveBlob, initDownloadMenus } from './download-menu';

interface Plan {
  name: string; // the zip's file name and its folder, without .zip
  readme: string;
  formats: Record<string, { name: string; src: string; size: number }[]>;
}

let started = false;
const mb = (b: number) => `${(b / 1e6).toFixed(b < 1e7 ? 1 : 0)} MB`;

async function fetchAll(files: Plan['formats'][string], folder: string, progress: (text: string) => void) {
  const total = files.reduce((s, f) => s + f.size, 0);
  let done = 0;
  const out: ZipFile[] = [];
  for (const f of files) {
    const res = await fetch(f.src);
    if (!res.ok || !res.body) throw new Error(`${f.src}: ${res.status}`);
    // read in chunks, to show how far along it is
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      chunks.push(value);
      got += value.length;
      progress(`${Math.min(99, Math.round(((done + got) / total) * 100))}%`);
    }
    const data = new Uint8Array(got);
    let at = 0;
    for (const c of chunks) {
      data.set(c, at);
      at += c.length;
    }
    done += f.size;
    out.push({ name: `${folder}/${f.name}`, data });
  }
  return out;
}

async function download(list: HTMLElement, format: string) {
  const plan = JSON.parse(list.dataset.albumZip!) as Plan;
  const menu = list.closest<HTMLDetailsElement>('details');
  const summary = menu?.querySelector('summary');
  if (!summary || summary.hasAttribute('aria-busy')) return;
  const say = (t: string) => summary.setAttribute('data-progress', t);
  summary.setAttribute('aria-busy', 'true');
  const name = format === 'm4a' ? plan.name : `${plan.name} (${format.toUpperCase()})`;
  try {
    say(`${format} 0%`);
    const files = await fetchAll(plan.formats[format], name, (t) => say(`${format} ${t}`));
    say('zipping…');
    await new Promise((r) => setTimeout(r)); // let the label paint
    files.unshift({ name: `${name}/README.txt`, data: new TextEncoder().encode(plan.readme) });
    const blob = new Blob(zip(files) as BlobPart[], { type: 'application/zip' });
    saveBlob(blob, `${name}.zip`);
    say(`saved · ${mb(blob.size)}`);
  } catch (e) {
    console.error(e);
    say('didn’t work — try again');
  } finally {
    summary.removeAttribute('aria-busy');
    setTimeout(() => summary.removeAttribute('data-progress'), 6000);
  }
}

export function initAlbumZip() {
  if (started) return;
  started = true;
  initDownloadMenus();
  document.addEventListener('click', (event) => {
    const btn = (event.target as Element | null)?.closest?.<HTMLElement>('[data-album-zip-format]');
    const list = btn?.closest<HTMLElement>('[data-album-zip]');
    if (!btn || !list) return;
    const menu = list.closest<HTMLDetailsElement>('details');
    if (menu) menu.open = false;
    download(list, btn.dataset.albumZipFormat!);
  });
}
