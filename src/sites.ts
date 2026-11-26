import { getSetting, setSetting } from './db';

// The saved sites: the cards of the app's Sites page and of the browser's new-tab page (one list, kept in the settings table).

export interface Site { n: string; u: string }

export const DEFAULT_SITES: Site[] = [
  { n: 'Nexus Mods', u: 'https://www.nexusmods.com' },
  { n: 'TekkenMods', u: 'https://tekkenmods.com' },
  { n: 'GameBanana', u: 'https://gamebanana.com' },
];
const MAX_SITES = 60;

const isWebUrl = (u: string) => { try { return /^https?:$/.test(new URL(u).protocol); } catch { return false; } };
const same = (a: string, b: string) => { try { return new URL(a).href === new URL(b).href; } catch { return a === b; } };

export function getSites(): Site[] {
  try {
    const s = JSON.parse(getSetting('sites') || 'null');
    if (Array.isArray(s)) {
      return s.filter((x): x is Site => !!x && typeof x.n === 'string' && typeof x.u === 'string' && isWebUrl(x.u)).slice(0, MAX_SITES);
    }
  } catch { /* use the defaults */ }
  return DEFAULT_SITES.map(x => ({ ...x }));
}

const save = (list: Site[]) => setSetting('sites', JSON.stringify(list));

export function addSite(name: unknown, url: unknown): { ok: true; sites: Site[] } | { ok: false; error: string } {
  let u = String(url ?? '').trim();
  if (!u) return { ok: false, error: 'Type the address of the site' };
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  let host: string;
  try { host = new URL(u).hostname.replace(/^www\./, ''); } catch { return { ok: false, error: 'That is not a valid address' }; }
  if (!isWebUrl(u) || !host) return { ok: false, error: 'That is not a valid address' };
  const list = getSites();
  if (list.some(s => same(s.u, u))) return { ok: false, error: 'That site is already here' };
  if (list.length >= MAX_SITES) return { ok: false, error: 'Too many sites' };
  list.push({ n: String(name ?? '').trim().slice(0, 60) || host, u });
  save(list);
  return { ok: true, sites: list };
}

export function removeSite(url: unknown): Site[] {
  const u = String(url ?? '');
  const list = getSites();
  const i = list.findIndex(s => s.u === u);
  if (i >= 0) { list.splice(i, 1); save(list); }
  return list;
}
