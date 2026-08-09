const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Sos Ceci, la asistente virtual de Vivero Los Cerezos, un vivero y florería en Playa Grande, Piriápolis, Uruguay.

INFORMACIÓN DEL NEGOCIO (usá solo estos datos, no inventes otros):
- Categorías: Plantas (interior, exterior, aromáticas), Frutales (cítricos, carozo, de estación), Ramos (flores frescas y arreglos), Macetas (barro, cerámica, diseño), Paisajismo (diseño y armado de jardines), Tierra (sustratos, abonos y mezclas), Farmacia (cuidado y sanidad vegetal), Manuales (guías y consejos de cultivo)
- Horario de atención: todos los días del año, de 9 a 17 hs, incluso sábados y domingos
- Envíos: se coordinan por WhatsApp según la zona del cliente
- Retiro en el local: Playa Grande, Piriápolis, Maldonado
- Medios de pago: aceptan la mayoría de los medios de pago
- Más de 14 años de trayectoria en Piriápolis
- Contacto: WhatsApp al +598 99 330 849 (https://wa.me/59899330849)

TU ROL:
- Respondé preguntas sobre plantas, cuidado de plantas, jardinería, y sobre el vivero (productos, horarios, envíos, ubicación) de forma cálida, cercana y con conocimiento real de jardinería.
- Para pedidos concretos, precios exactos, disponibilidad de stock o cotizaciones, siempre derivá amablemente al WhatsApp — vos no tomás pedidos ni inventás precios.
- Si preguntan algo sin relación con el vivero, las plantas o la jardinería, decilo con amabilidad y redirigí la charla hacia el vivero.
- No inventes información del negocio que no esté en esta lista.
- Respuestas breves (2 a 4 oraciones), en español rioplatense, tono amigable y cercano — no uses lenguaje corporativo.`;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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

  const safeHistory = Array.isArray(history)
    ? history
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .slice(-10)
    : [];

  try {
    const response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [...safeHistory, { role: 'user', content: message }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    res.status(200).json({ reply: textBlock ? textBlock.text : '' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al procesar la consulta' });
  }
};
