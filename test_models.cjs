require('dotenv').config();

async function test() {
  try {
    const key = process.env.GEMINI_API_KEY;
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
    const data = await response.json();
    const models = data.models || [];
    const embedModels = models.filter(m => m.supportedGenerationMethods && (m.supportedGenerationMethods.includes('embedContent') || m.supportedGenerationMethods.includes('embedText')));
    console.log(embedModels.map(m => m.name));
  } catch (e) {
    console.error(e);
  }
}
test();
