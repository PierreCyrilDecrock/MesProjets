#!/usr/bin/env node
/**
 * Génère projects.json + shots/*.jpg + icons/projects/*.png
 *
 * Pour chaque dépôt GitHub Pages du compte :
 *   1. ouvre le site dans un vrai navigateur (Chromium) et le prend en capture d'écran ;
 *   2. cherche l'icône propre du projet (apple-touch-icon, favicon, manifest) ;
 *      à défaut, découpe une vignette carrée de la capture.
 *
 * Variables d'environnement :
 *   GITHUB_USER        compte à lister (défaut : propriétaire de GITHUB_REPOSITORY)
 *   GITHUB_TOKEN       optionnel, relève la limite de l'API GitHub
 *   FORCE=1            régénère tout, même les projets inchangés
 *   --- réservées aux tests ---
 *   OUT_DIR, GITHUB_API_URL, PAGES_BASE, CHROME_PATH, NO_SANDBOX
 */
import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.env.OUT_DIR || ROOT);
const API = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
const FORCE = !!process.env.FORCE;
const [repoOwner = '', selfRepo = ''] = (process.env.GITHUB_REPOSITORY || '').split('/');
const OWNER = process.env.GITHUB_USER || repoOwner;
if (!OWNER) { console.error('Définis GITHUB_USER (ou GITHUB_REPOSITORY).'); process.exit(1); }
const PAGES_BASE = (process.env.PAGES_BASE || `https://${OWNER.toLowerCase()}.github.io`).replace(/\/$/, '');

const readJson = async (f, d) => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return d; } };
const exists = async (f) => !!(await fs.stat(f).catch(() => null));
const clean = (p) => String(p || '').split('?')[0];

const cfg = {
  exclude: [], includeForks: false, viewport: { width: 1280, height: 720 }, waitMs: 2000,
  ...(await readJson(path.join(ROOT, 'projects.config.json'), {}))
};
const excluded = new Set([...cfg.exclude, selfRepo].filter(Boolean).map((n) => n.toLowerCase()));

// ---- Liste des dépôts -------------------------------------------------------
async function listRepos() {
  const headers = { 'User-Agent': 'mes-projets', Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  let all = [];
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(`${API}/users/${OWNER}/repos?per_page=100&type=owner&page=${page}`, { headers });
    if (!res.ok) throw new Error(`API GitHub : HTTP ${res.status}`);
    const chunk = await res.json();
    all = all.concat(chunk);
    if (chunk.length < 100) break;
  }
  return all;
}

function pagesUrl(r) {
  const home = (r.homepage || '').trim();
  if (/^https?:\/\//i.test(home) && /github\.io/i.test(home)) return home;
  if (r.name.toLowerCase() === `${OWNER.toLowerCase()}.github.io`) return `${PAGES_BASE}/`;
  return `${PAGES_BASE}/${r.name}/`;
}

// ---- Icônes -----------------------------------------------------------------
// Exécutée dans la page : liste les icônes déclarées, de la meilleure à la moins bonne.
async function collectIcons() {
  const out = [];
  const abs = (h, base = document.baseURI) => { try { return new URL(h, base).href; } catch { return null; } };
  document.querySelectorAll('link[rel~="icon"], link[rel~="apple-touch-icon"], link[rel~="apple-touch-icon-precomposed"]').forEach((l) => {
    const href = abs(l.getAttribute('href') || ''); if (!href) return;
    const rel = (l.getAttribute('rel') || '').toLowerCase(), sizes = l.getAttribute('sizes') || '';
    let score = rel.includes('apple-touch-icon') ? 1000 : 0;
    score += (/any/.test(sizes) || /svg/.test(l.getAttribute('type') || '') || /\.svg(\?|$)/.test(href)) ? 500 : (parseInt(sizes, 10) || 32);
    out.push({ href, score });
  });
  const m = document.querySelector('link[rel="manifest"]');
  if (m) {
    try {
      const mj = await (await fetch(m.href)).json();
      for (const i of mj.icons || []) {
        const href = abs(i.src, m.href); if (!href) continue;
        out.push({ href, score: 700 + (parseInt(String(i.sizes || '').split(' ').pop(), 10) || 64) });
      }
    } catch { /* manifeste illisible : on ignore */ }
  }
  return out.sort((a, b) => b.score - a.score);
}

function decodeDataUri(uri) {
  const m = /^data:([^,]*),([\s\S]*)$/.exec(uri); if (!m) return null;
  if (/;base64/i.test(m[1])) return Buffer.from(m[2], 'base64');
  try { return Buffer.from(decodeURIComponent(m[2])); } catch { return Buffer.from(m[2]); }
}

async function toIconPng(buf) {
  const img = sharp(buf, { density: 300 });
  const meta = await img.metadata();
  if (meta.format !== 'svg' && Math.max(meta.width || 0, meta.height || 0) < 48) return null; // trop petit : flou
  return img.resize(192, 192, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
}

// ---- Capture ----------------------------------------------------------------
async function capture(browser, p) {
  const ctx = await browser.newContext({ viewport: cfg.viewport, deviceScaleFactor: 1, locale: 'fr-FR' });
  try {
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    const res = await page.goto(p.url, { waitUntil: 'load', timeout: 30000 });
    if (!res || res.status() >= 400) throw new Error(`HTTP ${res ? res.status() : '?'}`);
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(cfg.waitMs);
    const shot = await page.screenshot({ type: 'png' });

    let icon = null;
    const cands = await page.evaluate(collectIcons).catch(() => []);
    for (const c of cands) {
      try {
        let buf;
        if (c.href.startsWith('data:')) buf = decodeDataUri(c.href);
        else { const r = await ctx.request.get(c.href, { timeout: 15000 }); if (!r.ok()) continue; buf = await r.body(); }
        icon = buf && (await toIconPng(buf));
        if (icon) break;
      } catch { /* format illisible (.ico…) : candidat suivant */ }
    }
    return { shot, icon };
  } finally {
    await ctx.close();
  }
}

// ---- Principal --------------------------------------------------------------
const prevFile = path.join(OUT, 'projects.json');
const prevData = await readJson(prevFile, null);
const prevByName = new Map((prevData?.projects || []).map((p) => [p.name, p]));

const repos = (await listRepos())
  .filter((r) => r.has_pages && !r.archived && (cfg.includeForks || !r.fork) && !excluded.has(r.name.toLowerCase()))
  .sort((a, b) => (b.pushed_at || '').localeCompare(a.pushed_at || ''));
console.log(`${repos.length} projet(s) avec GitHub Pages pour ${OWNER}`);

await fs.mkdir(path.join(OUT, 'shots'), { recursive: true });
await fs.mkdir(path.join(OUT, 'icons', 'projects'), { recursive: true });

let browser = null;
const projects = [];
const stats = { reused: 0, captured: 0, failed: 0 };

for (const r of repos) {
  const rev = Math.floor(Date.parse(r.pushed_at || 0) / 1000) || 0;
  const entry = {
    name: r.name, description: r.description || '', pushed: r.pushed_at || null, hasPages: true,
    fork: !!r.fork, archived: !!r.archived, lang: r.language || '', url: pagesUrl(r), repoUrl: r.html_url
  };
  const prev = prevByName.get(r.name);
  const shotRel = `shots/${r.name}.jpg`, iconRel = `icons/projects/${r.name}.png`;

  const unchanged = prev && !FORCE && prev.pushed === entry.pushed && prev.shot
    && await exists(path.join(OUT, clean(prev.shot))) && (!prev.icon || await exists(path.join(OUT, clean(prev.icon))));
  if (unchanged) {
    Object.assign(entry, { shot: prev.shot, icon: prev.icon, iconKind: prev.iconKind });
    projects.push(entry); stats.reused++;
    console.log(`= ${r.name} (inchangé)`);
    continue;
  }

  try {
    browser ??= await chromium.launch({
      executablePath: process.env.CHROME_PATH || undefined,
      args: process.env.NO_SANDBOX ? ['--no-sandbox'] : []
    });
    const { shot, icon } = await capture(browser, entry);
    await sharp(shot).resize({ width: 960 }).jpeg({ quality: 80, mozjpeg: true }).toFile(path.join(OUT, shotRel));
    entry.shot = `${shotRel}?v=${rev}`;
    if (icon) {
      await fs.writeFile(path.join(OUT, iconRel), icon);
      entry.icon = `${iconRel}?v=${rev}`; entry.iconKind = 'site';
    } else {
      // Pas d'icône déclarée : vignette carrée tirée de la capture.
      const side = Math.min(cfg.viewport.width, cfg.viewport.height);
      const thumb = await sharp(shot)
        .extract({ left: Math.floor((cfg.viewport.width - side) / 2), top: 0, width: side, height: side })
        .resize(192, 192).png().toBuffer();
      await fs.writeFile(path.join(OUT, iconRel), thumb);
      entry.icon = `${iconRel}?v=${rev}`; entry.iconKind = 'thumbnail';
    }
    stats.captured++;
    console.log(`+ ${r.name} (${entry.iconKind === 'site' ? 'icône du site' : 'vignette'})`);
  } catch (e) {
    stats.failed++;
    entry.error = e.message;
    // On garde les anciens visuels s'il y en a, pour ne pas dégrader l'affichage.
    if (prev?.shot && await exists(path.join(OUT, clean(prev.shot)))) Object.assign(entry, { shot: prev.shot, icon: prev.icon, iconKind: prev.iconKind });
    console.warn(`! ${r.name} : ${e.message}`);
  }
  projects.push(entry);
}
await browser?.close();

// Supprime les images des projets qui n'existent plus.
const keep = new Set(projects.flatMap((p) => [p.shot, p.icon]).filter(Boolean).map((f) => path.basename(clean(f))));
for (const dir of ['shots', path.join('icons', 'projects')]) {
  for (const f of await fs.readdir(path.join(OUT, dir))) {
    if (!keep.has(f)) { await fs.rm(path.join(OUT, dir, f)); console.log(`- ${dir}/${f} (supprimé)`); }
  }
}

// N'écrit projects.json que si le contenu change (évite un commit par jour pour rien).
const next = { user: OWNER, projects };
const same = prevData && JSON.stringify({ user: prevData.user, projects: prevData.projects }) === JSON.stringify(next);
if (same) console.log('projects.json inchangé.');
else await fs.writeFile(prevFile, JSON.stringify({ generatedAt: new Date().toISOString(), ...next }, null, 2) + '\n');

console.log(`Terminé : ${stats.captured} capturé(s), ${stats.reused} inchangé(s), ${stats.failed} échec(s).`);
