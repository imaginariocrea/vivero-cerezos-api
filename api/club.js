const GHL_API_TOKEN = process.env.GHL_API_TOKEN;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;

// Solo la web del vivero puede usar este formulario
const ALLOWED_ORIGINS = new Set([
  'https://viveroloscerezos.uy',
  'https://www.viveroloscerezos.uy',
]);

const MAX_FIELD_CHARS = 200;

function normalizePhone(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (!digits.startsWith('598')) {
    digits = digits.startsWith('0') ? '598' + digits.slice(1) : '598' + digits;
  }
  return '+' + digits;
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

  const { nombre, email, whatsapp } = req.body || {};
  if (!nombre || typeof nombre !== 'string' || !nombre.trim() || nombre.length > MAX_FIELD_CHARS) {
    res.status(400).json({ error: 'Falta el nombre' });
    return;
  }
  if (!email || typeof email !== 'string' || !email.includes('@') || email.length > MAX_FIELD_CHARS) {
    res.status(400).json({ error: 'Email inválido' });
    return;
  }
  if (whatsapp && String(whatsapp).length > MAX_FIELD_CHARS) {
    res.status(400).json({ error: 'WhatsApp inválido' });
    return;
  }

  try {
    const ghlRes = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GHL_API_TOKEN}`,
        Version: '2021-07-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        locationId: GHL_LOCATION_ID,
        firstName: nombre.trim(),
        email: email.trim(),
        phone: normalizePhone(whatsapp),
        tags: ['club-web'],
        source: 'Formulario Club Los Cerezos - sitio web',
      }),
    });

    if (!ghlRes.ok) {
      const errText = await ghlRes.text();
      console.error('GHL error:', ghlRes.status, errText);
      res.status(502).json({ error: 'No pudimos registrar tus datos, intentá de nuevo' });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al procesar el registro' });
  }
};
