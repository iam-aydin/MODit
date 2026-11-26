import { ipcRenderer } from 'electron';

// Runs in every page of the MODit browser, but only does something on renderer/newtab.html:
// it fills the site cards (the same saved sites as the app's Sites page) and handles open / add / remove.
// The page itself has no scripts (strict CSP); the main process also checks that these messages come from that page.

interface Site { n: string; u: string }

const onNewTab = location.protocol === 'file:' && /[\\/]newtab\.html$/i.test(location.pathname);

if (onNewTab) {
  const icons = new Map<string, string | null>();
  let sites: Site[] = [];

  const $ = (id: string) => document.getElementById(id) as HTMLElement;
  const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
  const el = (tag: string, cls: string, text?: string) => {
    const e = document.createElement(tag);
    e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  const putIcon = (box: HTMLElement, data: string) => {
    const img = document.createElement('img');
    img.src = data;
    img.alt = '';
    box.textContent = '';
    box.classList.add('has');
    box.appendChild(img);
  };

  function draw(): void {
    const grid = $('grid');
    grid.textContent = '';
    sites.forEach(s => {
      const card = el('div', 'card site');
      card.dataset.u = s.u;
      const rm = el('button', 'rm', '✕');
      rm.title = 'Remove';
      rm.dataset.rm = s.u;
      const ico = el('div', 'ico', (s.n || '?').trim().charAt(0).toUpperCase());
      card.append(rm, ico, el('h3', '', s.n), el('small', '', hostOf(s.u)));
      grid.appendChild(card);
      const known = icons.get(s.u);
      if (known) putIcon(ico, known);
      else if (known === undefined) {
        icons.set(s.u, null);
        ipcRenderer.invoke('nt:icon', s.u).then((d: string | null) => {
          if (!d) return;
          icons.set(s.u, d);
          for (const c of Array.from(grid.children) as HTMLElement[]) if (c.dataset.u === s.u) putIcon(c.querySelector('.ico') as HTMLElement, d);
        }).catch(() => undefined);
      }
    });
    const add = el('div', 'card add');
    add.id = 'addCard';
    add.append(el('div', 'ico', '+'), el('h3', '', 'Add site'));
    grid.appendChild(add);
  }

  const load = () => ipcRenderer.invoke('nt:sites').then((l: Site[]) => { sites = Array.isArray(l) ? l : []; draw(); }).catch(() => undefined);

  function openDialog(): void {
    ($('dName') as HTMLInputElement).value = '';
    ($('dUrl') as HTMLInputElement).value = '';
    $('dErr').textContent = '';
    $('dlg').classList.add('on');
    $('dUrl').focus();
  }
  const closeDialog = () => $('dlg').classList.remove('on');

  async function submit(): Promise<void> {
    const r = await ipcRenderer.invoke('nt:add', ($('dName') as HTMLInputElement).value, ($('dUrl') as HTMLInputElement).value).catch(() => null);
    if (r && r.ok) { sites = r.sites; draw(); closeDialog(); }
    else $('dErr').textContent = (r && r.error) || 'Could not add the site';
  }

  window.addEventListener('DOMContentLoaded', () => {
    $('grid').addEventListener('click', e => {
      const t = e.target as HTMLElement;
      const rm = t.closest('[data-rm]') as HTMLElement | null;
      if (rm) {
        ipcRenderer.invoke('nt:remove', rm.dataset.rm).then((l: Site[]) => { sites = l; draw(); }).catch(() => undefined);
        return;
      }
      if (t.closest('#addCard')) { openDialog(); return; }
      const card = t.closest('.site') as HTMLElement | null;
      if (card && card.dataset.u) ipcRenderer.send('nt:open', card.dataset.u, false);
    });
    $('grid').addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); }); // no auto-scroll cursor
    $('grid').addEventListener('auxclick', e => { // middle click: open in a background tab
      if (e.button !== 1) return;
      const card = (e.target as HTMLElement).closest('.site') as HTMLElement | null;
      if (card && card.dataset.u) ipcRenderer.send('nt:open', card.dataset.u, true);
    });
    $('dOk').addEventListener('click', () => { void submit(); });
    $('dCancel').addEventListener('click', closeDialog);
    $('dlg').addEventListener('mousedown', e => { if (e.target === $('dlg')) closeDialog(); });
    document.addEventListener('keydown', e => {
      if (!$('dlg').classList.contains('on')) return;
      if (e.key === 'Escape') closeDialog();
      else if (e.key === 'Enter') void submit();
    });
    void load();
  });

  // the tab was switched to: the app's Sites page may have changed the list meanwhile
  ipcRenderer.on('nt:refresh', () => { void load(); });
}
