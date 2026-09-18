require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

async function test() {
  try {
    const ai = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY});
    // Let's test embedContent
    const res = await ai.models.embedContent({
      model: 'text-embedding-004',
      contents: 'hello'
    });
    console.log('text-embedding-004 OK');
  } catch (e) {
    console.error('ERROR with text-embedding-004:', e.message);
  }
}
test();
