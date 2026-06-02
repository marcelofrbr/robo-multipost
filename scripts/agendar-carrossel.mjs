#!/usr/bin/env node
/**
 * Agendador automatico de carrossel via API publica do Robo MultiPost.
 *
 * O que ele faz sozinho (so o agendamento — voce fornece as imagens e legendas):
 *   1. Lista as integracoes do perfil (GET /public/v1/integrations) e acha
 *      LinkedIn e Instagram automaticamente.
 *   2. Sobe cada slide da pasta, EM ORDEM (POST /public/v1/upload).
 *   3. Monta o post de carrossel para cada rede e agenda (POST /public/v1/posts).
 *
 * NAO precisa de banco/infra local: fala HTTP direto com a instancia no ar.
 *
 * Uso:
 *   POSTIZ_API_KEY="<chave-do-perfil>" node scripts/agendar-carrossel.mjs scripts/carrossel.config.json
 *
 * Dica de seguranca: rode primeiro com "type": "draft" no config para validar
 * tudo SEM publicar. Depois troque para "schedule" e rode de novo.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, extname, basename, isAbsolute } from 'node:path';

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
};
const IMAGE_EXTS = Object.keys(MIME);

function die(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

function log(msg) {
  console.log(msg);
}

// Normaliza a base para terminar em /public/v1 (aceita https://dominio/api,
// https://dominio/api/public/v1, com ou sem barra final).
function normalizeBase(baseUrl) {
  let b = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!b) die('config.baseUrl ausente. Ex.: "https://seu-dominio/api"');
  if (!/^https?:\/\//.test(b)) die(`config.baseUrl invalida: ${b}`);
  if (!b.endsWith('/public/v1')) b += '/public/v1';
  return b;
}

async function api(base, apiKey, path, { method = 'GET', body, isForm = false } = {}) {
  const headers = { Authorization: apiKey };
  if (!isForm && body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) {
    const hint =
      res.status === 401 || res.status === 403
        ? '\n\n⚠️  AUTENTICACAO FALHOU. Use a CHAVE DE PERFIL (nao a de organizacao). ' +
          'NAO faca fallback para a chave de organizacao — ela cria os posts INVISIVEIS. ' +
          'Gere/cole novamente a chave de perfil correta e tente de novo.'
        : '';
    die(
      `${method} ${path} falhou (HTTP ${res.status}):\n` +
        (typeof json === 'string' ? json : JSON.stringify(json, null, 2)) +
        hint
    );
  }
  return json;
}

async function listSlides(folder) {
  const cwd = process.cwd();
  const dir = isAbsolute(folder) ? folder : join(cwd, folder);
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    die(`Pasta de slides nao encontrada: ${dir}`);
  }
  const images = entries
    .filter((f) => IMAGE_EXTS.includes(extname(f).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  if (!images.length) die(`Nenhuma imagem (${IMAGE_EXTS.join(', ')}) em: ${dir}`);
  return images.map((f) => join(dir, f));
}

async function uploadSlide(base, apiKey, filePath) {
  const buffer = await readFile(filePath);
  const name = basename(filePath);
  const mime = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mime }), name);
  const out = await api(base, apiKey, '/upload', { method: 'POST', body: form, isForm: true });
  if (!out?.id || !out?.path) die(`Upload de ${name} nao retornou {id, path}: ${JSON.stringify(out)}`);
  return { id: out.id, path: out.path };
}

async function uploadSlideFromUrl(base, apiKey, url) {
  const out = await api(base, apiKey, '/upload-from-url', { method: 'POST', body: { url } });
  if (!out?.id || !out?.path) die(`Upload da URL ${url} nao retornou {id, path}: ${JSON.stringify(out)}`);
  return { id: out.id, path: out.path };
}

function findById(list, id) {
  const hit = list.find((i) => i.id === id);
  if (!hit) {
    die(
      `integrationId nao encontrado neste perfil (a chave acessa o perfil certo?): ${id}\n` +
        `Integracoes visiveis para esta chave:\n` +
        list.map((i) => `  - ${i.name} | id=${i.id} | identifier=${i.identifier}${i.disabled ? ' (DESABILITADA)' : ''}`).join('\n')
    );
  }
  return hit;
}

function pickIntegration(list, wanted, explicitId) {
  if (explicitId) {
    const hit = list.find((i) => i.id === explicitId);
    if (!hit) die(`integrationId fixado nao encontrado no perfil: ${explicitId}`);
    return hit;
  }
  const matches = list.filter(
    (i) => !i.disabled && String(i.identifier || '').toLowerCase().startsWith(wanted)
  );
  if (matches.length === 0) {
    die(
      `Nenhuma integracao "${wanted}" ativa encontrada neste perfil.\n` +
        `Integracoes disponiveis:\n` +
        list.map((i) => `  - ${i.name} | id=${i.id} | identifier=${i.identifier}${i.disabled ? ' (DESABILITADA)' : ''}`).join('\n')
    );
  }
  if (matches.length > 1) {
    die(
      `Mais de uma integracao "${wanted}" encontrada. Fixe o id no config (networks.${wanted}.integrationId):\n` +
        matches.map((i) => `  - ${i.name} | id=${i.id} | identifier=${i.identifier}`).join('\n')
    );
  }
  return matches[0];
}

function makeId(n = 10) {
  const c = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: n }, () => c[Math.floor(Math.random() * c.length)]).join('');
}

function buildSettings(identifier, netCfg) {
  const id = String(identifier).toLowerCase();
  if (id.startsWith('instagram')) {
    return { post_type: netCfg.post_type || 'post', collaborators: [] };
  }
  if (id.startsWith('linkedin')) {
    const s = { post_as_images_carousel: netCfg.post_as_images_carousel !== false };
    if (netCfg.carousel_name) s.carousel_name = netCfg.carousel_name;
    return s;
  }
  return {};
}

async function main() {
  const configPath = process.argv[2];
  if (!configPath) die('Informe o caminho do config. Ex.: node scripts/agendar-carrossel.mjs scripts/carrossel.config.json');
  const apiKey = process.env.POSTIZ_API_KEY;
  if (!apiKey) die('Defina a variavel de ambiente POSTIZ_API_KEY com a chave do perfil.');

  const cfg = JSON.parse(await readFile(configPath, 'utf-8'));
  const base = normalizeBase(cfg.baseUrl);
  const type = cfg.type || 'schedule';
  if (!['draft', 'schedule', 'now'].includes(type)) die(`config.type invalido: ${type} (use draft|schedule|now)`);
  if (type !== 'now' && !cfg.date) die('config.date obrigatorio para draft/schedule (ISO 8601, ex.: "2026-06-06T12:00:00.000Z")');
  const hasChannels = Array.isArray(cfg.channels) && cfg.channels.length;
  const hasNetworks = cfg.networks && Object.keys(cfg.networks).length;
  if (!hasChannels && !hasNetworks) {
    die('Informe "channels" (lista com integrationId+caption — recomendado) OU "networks" (auto-deteccao).');
  }

  log(`\n🔧 Instancia : ${base}`);
  log(`🗓️  Tipo/Data: ${type}${cfg.date ? ` @ ${cfg.date}` : ''}`);

  // 1) Integracoes do perfil (com a CHAVE DE PERFIL — escopa os canais a este perfil)
  log(`\n📡 Listando integracoes do perfil...`);
  const integrations = await api(base, apiKey, '/integrations');
  log(`   Encontradas ${integrations.length} integracao(oes).`);

  // Resolucao dos canais. "channels" (IDs explicitos) e o caminho recomendado
  // quando ha mais de um canal da mesma rede (ex.: dois LinkedIns).
  let resolved;
  if (hasChannels) {
    resolved = cfg.channels.map((ch) => {
      if (!ch.integrationId) die('Cada item de "channels" precisa de integrationId.');
      if (!ch.caption) die(`Channel ${ch.integrationId} precisa de caption.`);
      const integ = findById(integrations, ch.integrationId);
      if (integ.disabled) die(`Integracao DESABILITADA: ${integ.name} (${integ.id}).`);
      log(`   ✓ ${integ.name} (id=${integ.id}, identifier=${integ.identifier})`);
      return { integ, netCfg: ch, caption: ch.caption };
    });
  } else {
    resolved = Object.keys(cfg.networks).map((net) => {
      const netCfg = cfg.networks[net] || {};
      const integ = pickIntegration(integrations, net.toLowerCase(), netCfg.integrationId);
      if (!netCfg.caption) die(`networks.${net}.caption obrigatorio.`);
      log(`   ✓ ${net}: ${integ.name} (id=${integ.id}, identifier=${integ.identifier})`);
      return { integ, netCfg, caption: netCfg.caption };
    });
  }

  // 2) Upload dos slides EM ORDEM (uma vez so, reaproveitado em todas as redes).
  //    Aceita imagens por URL (cfg.images: ["https://..."]) OU por pasta (cfg.folder).
  const slides = [];
  if (Array.isArray(cfg.images) && cfg.images.length) {
    log(`\n🖼️  Subindo ${cfg.images.length} slide(s) por URL, em ordem:`);
    for (const url of cfg.images) {
      const up = await uploadSlideFromUrl(base, apiKey, url);
      slides.push(up);
      log(`   ↑ ${url} → ${up.path}`);
    }
  } else if (cfg.folder) {
    const slidePaths = await listSlides(cfg.folder);
    log(`\n🖼️  Subindo ${slidePaths.length} slide(s) da pasta, em ordem:`);
    for (const p of slidePaths) {
      const up = await uploadSlide(base, apiKey, p);
      slides.push(up);
      log(`   ↑ ${basename(p)} → ${up.path}`);
    }
  } else {
    die('Informe as imagens: "images" (lista de URLs) OU "folder" (pasta local) no config.');
  }
  const image = slides.map((s) => ({ id: s.id, path: s.path }));

  // 3) Monta e agenda
  const posts = resolved.map(({ netCfg, integ, caption }) => ({
    integration: { id: integ.id },
    group: makeId(10),
    settings: buildSettings(integ.identifier, netCfg),
    value: [{ content: caption, id: makeId(10), image }],
  }));

  const payload = {
    type,
    shortLink: cfg.shortLink ?? false,
    date: cfg.date,
    tags: [],
    posts,
  };

  log(`\n🚀 Enviando ${posts.length} post(s) (${type})...`);
  const out = await api(base, apiKey, '/posts', { method: 'POST', body: payload });
  log(`\n✅ Pronto! Resposta da API:\n${JSON.stringify(out, null, 2)}`);
  if (type === 'draft') {
    log(`\nℹ️  Foi criado como RASCUNHO (nao publica). Valide no app e, quando ok, troque "type" para "schedule" e rode de novo.`);
  } else if (type === 'schedule') {
    log(`\nℹ️  Agendado. Vai publicar em ${cfg.date} (desde que backend + Temporal estejam no ar nesse horario).`);
  }
}

main().catch((e) => die(e?.stack || String(e)));
