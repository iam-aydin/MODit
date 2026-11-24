import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { safe } from './core';
import { browserSession } from './downloads';

// Finds the best (largest) icon a website offers and returns it as a data: URL.
// Results are cached in <userData>/icons so each site is only looked up once.

const iconDir = () => path.join(app.getPath('userData'), 'icons');
const inflight = new Map<string, Promise<string | null>>();

interface Cand { url: string; score: number }

function sniff(buf: Buffer): string | null {
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.length > 4 && buf.toString('latin1', 0, 4) === 'GIF8') return 'image/gif';
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length > 4 && buf.readUInt32BE(0) === 0x00000100) return 'image/x-icon';
  if (buf.toString('utf8', 0, 600).includes('<svg')) return 'image/svg+xml';
  return null; // anything else (e.g. an HTML error page) is not an icon
}

async function get(url: string): Promise<Response | null> {
  try {
    const r = await browserSession().fetch(url, { signal: AbortSignal.timeout(8000) });
    return r.ok ? r : null;
  } catch { return null; }
}

async function fetchImage(url: string): Promise<string | null> {
  const r = await get(url);
  if (!r) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 80 || buf.length > 2_500_000) return null;
  const mime = sniff(buf);
  return mime ? `data:${mime};base64,${buf.toString('base64')}` : null;
}

const attr = (tag: string, name: string): string => {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return (m && (m[1] ?? m[2] ?? m[3])) || '';
};

/** Icon links declared in the page, best first. */
function candidates(html: string, base: string): Cand[] {
  const out: Cand[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const rel = attr(tag, 'rel').toLowerCase();
    if (!/\bicon\b/.test(rel) || rel.includes('mask-icon')) continue;
    const href = attr(tag, 'href');
    if (!href || href.startsWith('data:')) continue;
    let url: string;
    try { url = new URL(href, base).href; } catch { continue; }
    if (!/^https?:/i.test(url)) continue;
    const sizes = [...attr(tag, 'sizes').matchAll(/(\d+)x(\d+)/g)].map(m => +m[1]);
    const apple = rel.includes('apple-touch');
    let score: number;
    if (/svg/i.test(attr(tag, 'type')) || /\.svg(\?|$)/i.test(href)) score = 150; // sharp at any size
    else if (sizes.length) score = Math.max(...sizes);
    else if (apple) score = 180;
    else score = /\.ico(\?|$)/i.test(href) ? 48 : 32;
    if (apple) score += 20; // usually a big, opaque square
    out.push({ url, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

async function lookup(siteUrl: string): Promise<string | null> {
  const u = new URL(siteUrl);
  let base = u.origin + '/';
  const list: Cand[] = [];

  const page = await get(siteUrl);
  if (page) {
    base = page.url || base;
    const html = (await page.text()).slice(0, 600_000);
    list.push(...candidates(html, base));
  }
  // conventional locations, tried after whatever the page declares
  list.push({ url: new URL('/apple-touch-icon.png', u.origin).href, score: 1 });
  list.push({ url: new URL('/favicon.ico', u.origin).href, score: 0 });

  const seen = new Set<string>();
  for (const c of list) {
    if (seen.has(c.url)) continue;
    seen.add(c.url);
    const d = await fetchImage(c.url);
    if (d) return d;
  }
  // last resort (sites behind bot checks): Google's icon service. Only the domain name is sent.
  return fetchImage(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(u.hostname)}&sz=128`);
}

export function getIcon(siteUrl: string): Promise<string | null> {
  let host: string;
  try {
    const u = new URL(siteUrl);
    if (!/^https?:$/.test(u.protocol)) return Promise.resolve(null);
    host = u.hostname;
  } catch { return Promise.resolve(null); }

  const file = path.join(iconDir(), safe(host) + '.txt');
  try { return Promise.resolve(fs.readFileSync(file, 'utf8')); } catch { /* not cached yet */ }

  let p = inflight.get(host);
  if (!p) {
    p = lookup(siteUrl)
      .then(d => {
        if (d) { fs.mkdirSync(iconDir(), { recursive: true }); fs.writeFileSync(file, d); }
        return d;
      })
      .catch(() => null)
      .finally(() => inflight.delete(host));
    inflight.set(host, p);
  }
  return p;
}
