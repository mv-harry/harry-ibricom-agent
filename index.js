const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'ibricom-harry-2024';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const HARRY_PROMPT = `Eres Harry, Jefe de Ventas de IBRICOM/MBV. Tu personalidad:
- Profesional pero cercano, experto en comercio exterior y logística
- Usas jerga comercial argentina moderada ("che", "dale", "perfecto")
- Siempre propones soluciones, nunca solo identificas problemas
- Conoces precios FOB/CIF, tiempos de tránsito, documentación

REGLAS DE NEGOCIO IBRICOM:
- Productos: Electrónica, insumos industriales, repuestos
- MOQ mínimo: USD 3,000 por orden
- Tiempos: 25-45 días puerta a puerta según origen
- Pagos: 30% anticipo, 70% contra BL o documentos
- No operamos con productos perecederos ni peligrosos sin MSDS

Cuando te consulten:
1. Pregunta origen y destino si no lo especifican
2. Menciona siempre el MOQ mínimo
3. Ofrece cotización en 24-48hs si te dan detalles
4. Si es logística urgente, menciona opción aérea (más cara)

Responde en español, máximo 3 párrafos, siempre proponiendo el siguiente paso.`;

app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('✅ Webhook verificado');
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

app.post('/webhook', async (req, res) => {
    res.status(200).send('EVENT_RECEIVED');
    
    try {
        const body = req.body;
        
        if (body.object === 'whatsapp_business_account') {
            const entry = body.entry?.[0];
            const changes = entry?.changes?.[0];
            const value = changes?.value;
            
            if (value?.messages && value.messages.length > 0) {
                const message = value.messages[0];
                const from = message.from;
                const msgBody = message.text?.body || '';
                
                console.log(`💬 Mensaje de ${from}: ${msgBody}`);
                await processMessage(from, msgBody);
            }
        }
    } catch (error) {
        console.error('Error:', error);
    }
});

async function processMessage(phoneNumber, messageText) {
    try {
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
            {
                contents: [{
                    parts: [
                        { text: HARRY_PROMPT },
                        { text: `Mensaje del cliente: ${messageText}` }
                    ]
                }]
            }
        );

        const aiResponse = response.data.candidates?.[0]?.content?.parts?.[0]?.text || 
                          'Disculpá, no pude procesar tu consulta.';
        
        await sendWhatsAppMessage(phoneNumber, aiResponse);
        
    } catch (error) {
        console.error('Error Gemini:', error);
        await sendWhatsAppMessage(phoneNumber, 'Hubo un error técnico. Intentá en unos minutos.');
    }
}

async function sendWhatsAppMessage(to, message) {
    try {
        await axios.post(
            `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
            {
                messaging_product: 'whatsapp',
                to: to,
                type: 'text',
                text: { body: message }
            },
            {
                headers: {
                    'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        console.log('✅ Mensaje enviado');
    } catch (error) {
        console.error('Error enviando mensaje:', error.response?.data || error.message);
    }
}

app.get('/health', (req, res) => {
    res.json({ status: 'OK', agent: 'Harry', time: new Date().toISOString() });
});

// Página de privacidad requerida por Meta
app.get('/privacy.html', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Privacy Policy</title></head>
        <body>
            <h1>Privacy Policy</h1>
            <p>This app processes WhatsApp messages via Meta API. No personal data is stored.</p>
        </body>
        </html>
    `);
});

// Página de términos requerida por Meta
app.get('/terms.html', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Terms of Service</title></head>
        <body>
            <h1>Terms of Service</h1>
            <p>By using this service, you agree to WhatsApp Business API terms.</p>
        </body>
        </html>
    `);
});

app.listen(PORT, () => {
    console.log(`🚀 Harry operativo en puerto ${PORT}`);
});
