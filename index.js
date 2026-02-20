/**
 * AGENTE HARRY - IBRICOM v2.1 (CORREGIDO)
 * Solución definitiva - Modelo Gemini validado
 * Render.com + PM2 + Meta WhatsApp Cloud API
 */

require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');

const app = express();

// Middleware para raw body (necesario para verificación HMAC)
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

// Configuración desde variables de entorno
const CONFIG = {
  PORT: process.env.PORT || 10000,
  WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN,
  PHONE_NUMBER_ID: process.env.PHONE_NUMBER_ID,
  APP_SECRET: process.env.APP_SECRET,
  WEBHOOK_VERIFY_TOKEN: process.env.WEBHOOK_VERIFY_TOKEN,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  // MODELO CORREGIDO - Validado en producción
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
  WEBHOOK_PATH: '/webhook',
  HEALTH_PATH: '/health'
};

// Validación de configuración crítica
function validateConfig() {
  const required = ['WHATSAPP_TOKEN', 'PHONE_NUMBER_ID', 'APP_SECRET', 'WEBHOOK_VERIFY_TOKEN', 'GEMINI_API_KEY'];
  const missing = required.filter(key => !CONFIG[key]);
  
  if (missing.length > 0) {
    console.error('❌ ERROR CRÍTICO: Faltan variables de entorno:', missing.join(', '));
    process.exit(1);
  }
  
  // Validar que PHONE_NUMBER_ID no sea el placeholder
  if (CONFIG.PHONE_NUMBER_ID === '123456789012345') {
    console.error('❌ ERROR CRÍTICO: PHONE_NUMBER_ID es el placeholder. Usa el número real de Meta.');
    process.exit(1);
  }
  
  console.log('✅ Configuración validada correctamente');
  console.log('📱 Phone Number ID:', CONFIG.PHONE_NUMBER_ID);
  console.log('🤖 Gemini Model:', CONFIG.GEMINI_MODEL);
}

// Verificación de firma HMAC-SHA256 de Meta
function verifySignature(payload, signature) {
  if (!signature || !CONFIG.APP_SECRET) return false;
  
  const expectedSignature = crypto
    .createHmac('sha256', CONFIG.APP_SECRET)
    .update(payload, 'utf8')
    .digest('hex');
  
  const actualSignature = signature.replace('sha256=', '');
  
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'hex'),
      Buffer.from(actualSignature, 'hex')
    );
  } catch (e) {
    return false;
  }
}

// Procesar mensaje con Gemini - Versión estable
async function processWithGemini(messageText, senderPhone) {
  try {
    const systemPrompt = `Eres Harry, el asistente financiero oficial de IBRICOM/MBV. 
    Tu función es procesar alertas financieras, consultas de tesorería y notificaciones bancarias.
    Responde de manera profesional, concisa y directa.
    Si la consulta es sobre finanzas, banca o tesorería, proporciona información útil.
    Si no entiendes la consulta, pide aclaración de forma cortés.`;
    
    // Endpoint corregido - versión v1beta es estable
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${CONFIG.GEMINI_API_KEY}`;
    
    const response = await axios.post(
      apiUrl,
      {
        contents: [{
          role: 'user',
          parts: [
            { text: systemPrompt },
            { text: `Consulta del usuario (${senderPhone}): ${messageText}` }
          ]
        }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 500,
          topP: 0.8,
          topK: 40
        }
      },
      { 
        timeout: 15000,
        headers: { 'Content-Type': 'application/json' }
      }
    );
    
    if (response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
      return response.data.candidates[0].content.parts[0].text;
    }
    
    return "He recibido tu mensaje. ¿En qué puedo ayudarte con tus finanzas hoy?";
    
  } catch (error) {
    console.error('❌ Error Gemini:', {
      status: error.response?.status,
      message: error.response?.data?.error?.message || error.message,
      model: CONFIG.GEMINI_MODEL
    });
    
    // Respuesta de fallback profesional
    return "Gracias por tu mensaje. Soy Harry, asistente financiero de IBRICOM. En este momento estoy procesando tu consulta. Por favor, indícame si necesitas información sobre alertas bancarias, tesorería o reportes financieros.";
  }
}

// Enviar mensaje de WhatsApp con manejo de errores detallado
async function sendWhatsAppMessage(to, message) {
  try {
    const apiUrl = `https://graph.facebook.com/v18.0/${CONFIG.PHONE_NUMBER_ID}/messages`;
    
    const response = await axios.post(
      apiUrl,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'text',
        text: { body: message }
      },
      {
        headers: {
          'Authorization': `Bearer ${CONFIG.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );
    
    console.log(`✅ Mensaje enviado a ${to}:`, response.data?.messages?.[0]?.id);
    return true;
    
  } catch (error) {
    console.error('❌ Error WhatsApp API:', {
      status: error.response?.status,
      code: error.response?.data?.error?.code,
      message: error.response?.data?.error?.message,
      phoneNumberId: CONFIG.PHONE_NUMBER_ID
    });
    return false;
  }
}

// Endpoint de Health Check
app.get(CONFIG.HEALTH_PATH, (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: '2.1.0',
    service: 'harry-ibricom',
    config: {
      phoneNumberId: CONFIG.PHONE_NUMBER_ID !== '123456789012345' ? '✅ Configurado' : '❌ Placeholder',
      geminiModel: CONFIG.GEMINI_MODEL
    }
  });
});

// Verificación del Webhook (GET)
app.get(CONFIG.WEBHOOK_PATH, (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  
  console.log('🔍 Webhook verification:', { mode, token: token?.substring(0, 10) + '...' });
  
  if (mode === 'subscribe' && token === CONFIG.WEBHOOK_VERIFY_TOKEN) {
    console.log('✅ Webhook verificado exitosamente');
    res.status(200).send(challenge);
  } else {
    console.error('❌ Verificación fallida');
    res.sendStatus(403);
  }
});

// Recepción de mensajes (POST) - Versión estable
app.post(CONFIG.WEBHOOK_PATH, async (req, res) => {
  // Verificar firma de seguridad
  const signature = req.headers['x-hub-signature-256'];
  
  if (!verifySignature(req.rawBody, signature)) {
    console.error('❌ Firma HMAC inválida');
    return res.sendStatus(403);
  }
  
  // Responder inmediatamente a Meta (evitar reintentos)
  res.sendStatus(200);
  
  try {
    const body = req.body;
    
    // Validar estructura del payload
    if (!body?.entry?.[0]?.changes?.[0]?.value?.messages) {
      return; // No es un mensaje entrante (puede ser status update)
    }
    
    const messageData = body.entry[0].changes[0].value.messages[0];
    const senderPhone = messageData.from;
    const messageType = messageData.type;
    
    console.log(`📩 Mensaje recibido de ${senderPhone}:`, messageType);
    
    // Procesar solo mensajes de texto
    if (messageType !== 'text' || !messageData.text?.body) {
      console.log('⚠️ Tipo de mensaje no soportado:', messageType);
      await sendWhatsAppMessage(senderPhone, "Por ahora solo proceso mensajes de texto. Pronto tendré más funcionalidades.");
      return;
    }
    
    const userMessage = messageData.text.body;
    console.log('📝 Contenido:', userMessage.substring(0, 50) + '...');
    
    // Procesar con Gemini
    const aiResponse = await processWithGemini(userMessage, senderPhone);
    
    // Enviar respuesta
    const sent = await sendWhatsAppMessage(senderPhone, aiResponse);
    
    if (sent) {
      console.log('✅ Conversación completada exitosamente');
    } else {
      console.error('❌ Fallo al enviar respuesta');
    }
    
  } catch (error) {
    console.error('❌ Error procesando mensaje:', error.message);
  }
});

// Manejo de errores no capturados
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});

// Iniciar servidor
validateConfig();

app.listen(CONFIG.PORT, () => {
  console.log(`
  ╔════════════════════════════════════════════════════════╗
  ║           AGENTE HARRY v2.1 - IBRICOM                 ║
  ║         Sistema Financiero 24/7 - ESTABLE              ║
  ╠════════════════════════════════════════════════════════╣
  ║  🟢 Puerto: ${CONFIG.PORT}                              ║
  ║  🔒 Webhook: ${CONFIG.WEBHOOK_PATH}                     ║
  ║  💓 Health: ${CONFIG.HEALTH_PATH}                       ║
  ║  🤖 Modelo: ${CONFIG.GEMINI_MODEL}                      ║
  ║  📱 WhatsApp: ${CONFIG.PHONE_NUMBER_ID}                 ║
  ╚════════════════════════════════════════════════════════╝
  `);
});
