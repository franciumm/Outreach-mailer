const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function callGemini(prompt, isJson = true) {
    const model = genAI.getGenerativeModel({ 
        model: "gemini-3-pro-preview",
        generationConfig: isJson ? { responseMimeType: "application/json" } : {}
    });
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    return isJson ? JSON.parse(text) : text;
}

module.exports = { callGemini };