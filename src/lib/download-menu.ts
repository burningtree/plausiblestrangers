// The download menus (DownloadMenu.astro, and the album's on record pages): one
// open at a time, closed by a click elsewhere or Escape. A file on the download
// server (another domain) is fetched and saved under its friendly name, since a
// browser ignores `download` names across domains; its size shows the progress.
let started = false;

export async function save(url: string, name: string, progress?: (text: string) => void) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${url}: ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    if (total && progress) progress(`${Math.min(99, Math.round((got / total) * 100))}%`);
  }
  saveBlob(new Blob(chunks as BlobPart[], { type: res.headers.get('content-type') ?? 'application/octet-stream' }), name);
}

export function saveBlob(blob: Blob, name: string) {
  const href = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}

const closeAll = (except?: Element | null) =>
  document.querySelectorAll<HTMLDetailsElement>('details[data-dl-menu][open]').forEach((d) => d !== except && (d.open = false));

export function initDownloadMenus() {
  if (started) return;
  started = true;
  document.addEventListener('click', async (event) => {
    const target = event.target as Element | null;
    const menu = target?.closest?.('details[data-dl-menu]') ?? null;
    closeAll(menu);
    const opt = target?.closest?.<HTMLAnchorElement>('a.dl-opt');
    if (!opt) return;
    if (menu) (menu as HTMLDetailsElement).open = false;
    if (!opt.dataset.dlName) return; // a link, not a file (the listen menu)
    if (new URL(opt.href, location.href).origin === location.origin) return; // the browser saves it, named
    event.preventDefault();
    const size = opt.querySelector<HTMLElement>('.dl-size');
    const was = size?.textContent ?? '';
    const summary = menu?.querySelector('summary');
    summary?.setAttribute('aria-busy', 'true');
    try {
      await save(opt.href, opt.dataset.dlName!, (t) => {
        if (size) size.textContent = t;
        summary?.setAttribute('data-progress', t);
      });
    } catch (e) {
      console.error(e);
      location.href = opt.href; // at least open the file
    } finally {
      if (size) size.textContent = was;
      summary?.removeAttribute('aria-busy');
      summary?.removeAttribute('data-progress');
    }
  });
  document.addEventListener('keydown', (e) => e.key === 'Escape' && closeAll());
}
