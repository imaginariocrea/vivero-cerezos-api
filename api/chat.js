const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1 });

const PRIMARY_MODEL = 'claude-haiku-5-5';
const FALLBACK_MODEL = 'claude-opus-5'; // modelo anterior, probado en producción
const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 529]);

// Solo la web del vivero puede usar este chat
const ALLOWED_ORIGINS = new Set([
  'https://viveroloscerezos.uy',
  'https://www.viveroloscerezos.uy',
]);

const MAX_MESSAGE_CHARS = 1000;
const MAX_HISTORY_CHARS = 2000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createChatResponse(systemPrompt, messages) {
  const attempts = [
    { model: PRIMARY_MODEL, delay: 0 },
    { model: PRIMARY_MODEL, delay: 700 },
    { model: FALLBACK_MODEL, delay: 0 },
  ];
  let lastErr;
  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    // Si el modelo principal falló con un error no transitorio, ir directo al modelo anterior
    if (attempt.model === PRIMARY_MODEL && lastErr && !RETRYABLE_STATUS.has(lastErr.status)) continue;
    if (attempt.delay) await sleep(attempt.delay);
    try {
      return await client.messages.create({
        model: attempt.model,
        max_tokens: 2048,
        system: systemPrompt,
        messages,
      });
    } catch (err) {
      lastErr = err;
      console.error(`Intento con ${attempt.model} falló (status ${err && err.status}): ${err && err.message}`);
      if (attempt.model !== PRIMARY_MODEL && !RETRYABLE_STATUS.has(err && err.status)) throw err;
    }
  }
  throw lastErr;
}

const SITE_BASE = 'https://www.viveroloscerezos.uy';
const SITE_PAGES = [
  { path: '/', label: 'Inicio' },
  { path: '/frutales.html', label: 'Frutales' },
  { path: '/ramos.html', label: 'Ramos' },
  { path: '/paisajismo.html', label: 'Paisajismo' },
  { path: '/manuales.html', label: 'Manuales' },
  { path: '/plantas.html', label: 'Plantas' },
  { path: '/macetas.html', label: 'Macetas' },
  { path: '/tierra.html', label: 'Tierra' },
  { path: '/farmacia.html', label: 'Farmacia' },
];

const SITE_CACHE_TTL_MS = 15 * 60 * 1000;
let siteCache = { text: '', fetchedAt: 0 };

const BASE_PERSONA = `Sos Ceci, la asistente virtual de Vivero Los Cerezos, un vivero y florería en Playa Grande, Piriápolis, Uruguay.

DATOS FIJOS DEL NEGOCIO (siempre válidos):
- Horario de atención: todos los días del año, de 9 a 17 hs, incluso sábados y domingos
- Envíos: se coordinan por WhatsApp según la zona del cliente
- Retiro en el local: Playa Grande, Piriápolis, Maldonado
- Medios de pago: aceptan la mayoría de los medios de pago
- Más de 14 años de trayectoria en Piriápolis
- Contacto: WhatsApp al +598 99 330 849 (https://wa.me/59899330849)

TU ROL:
- Respondé preguntas sobre plantas, cuidado de plantas, jardinería, y sobre el vivero (productos, categorías, horarios, envíos, ubicación) de forma cálida, cercana y con conocimiento real de jardinería.
- Más abajo puede haber un bloque CONTENIDO ACTUAL DEL SITIO, extraído en vivo de viveroloscerezos.uy. Cuando esté presente, usalo como fuente principal para describir categorías, productos y novedades — es lo más actualizado que existe, más que tu propio conocimiento previo del negocio.
- Para pedidos concretos, precios exactos, disponibilidad de stock o cotizaciones, siempre derivá amablemente al WhatsApp — vos no tomás pedidos ni confirmás precios ni stock como definitivos, aunque el sitio los mencione de pasada.
- Si preguntan algo sin relación con el vivero, las plantas o la jardinería, decilo con amabilidad y redirigí la charla hacia el vivero.
- No inventes información del negocio que no esté en los DATOS FIJOS o en el CONTENIDO ACTUAL DEL SITIO.
- Respuestas breves (2 a 4 oraciones), en español rioplatense, tono amigable y cercano — no uses lenguaje corporativo.`;

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&aacute;/gi, 'á')
    .replace(/&eacute;/gi, 'é')
    .replace(/&iacute;/gi, 'í')
    .replace(/&oacute;/gi, 'ó')
    .replace(/&uacute;/gi, 'ú')
    .replace(/&ntilde;/gi, 'ñ')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchPageText(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(SITE_BASE + path, { signal: controller.signal });
    if (!res.ok) return null;
    const html = await res.text();
    return htmlToText(html).slice(0, 8000);
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function getSiteContext() {
  const now = Date.now();
  if (siteCache.text && now - siteCache.fetchedAt < SITE_CACHE_TTL_MS) {
    return siteCache.text;
  }
  const results = await Promise.all(
    SITE_PAGES.map(async (page) => {
      const text = await fetchPageText(page.path);
      return text ? `--- ${page.label} (${page.path}) ---\n${text}` : null;
    })
  );
  const combined = results.filter(Boolean).join('\n\n');
  if (combined) {
    siteCache = { text: combined, fetchedAt: now };
    return combined;
  }
  return siteCache.text;
}

async function buildSystemPrompt() {
  let siteContext = '';
  try {
    siteContext = await getSiteContext();
  } catch (err) {
    console.error('Error leyendo el sitio en vivo:', err);
  }
  const siteBlock = siteContext
    ? `\n\nCONTENIDO ACTUAL DEL SITIO (extraído en vivo, puede incluir texto de navegación y menús):\n${siteContext}`
    : '';
  return BASE_PERSONA + siteBlock;
}

module.exports = async (req, res) => {
  const origin = req.headers.origin;
  const allowed = ALLOWED_ORIGINS.has(origin);
  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (!allowed) {
    res.status(403).json({ error: 'Origen no permitido' });
    return;
  }
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { message, history } = req.body || {};
  if (!message || typeof message !== 'string' || !message.trim()) {
    res.status(400).json({ error: 'Falta el mensaje' });
    return;
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    res.status(400).json({ error: 'El mensaje es demasiado largo' });
    return;
  }

  const safeHistory = Array.isArray(history)
    ? history
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_HISTORY_CHARS) }))
    : [];

  try {
    const systemPrompt = await buildSystemPrompt();
    const response = await createChatResponse(systemPrompt, [...safeHistory, { role: 'user', content: message }]);

    const textBlock = response.content.find((b) => b.type === 'text');
    res.status(200).json({ reply: textBlock ? textBlock.text : '', model: response.model });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al procesar la consulta' });
  }
};
