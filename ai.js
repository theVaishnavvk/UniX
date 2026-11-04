// ====================================================
//  UniX AI Helper — powered by Google Gemini API
//  Replace GEMINI_API_KEY with your key from:
//  https://aistudio.google.com/app/apikey  (free tier)
// ====================================================

const GEMINI_API_KEY = "YOUR_GEMINI_API_KEY_HERE";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;

/**
 * Call Gemini with a prompt string, returns the response text.
 * @param {string} prompt
 * @returns {Promise<string>}
 */
export async function askGemini(prompt) {
    if (GEMINI_API_KEY === "YOUR_GEMINI_API_KEY_HERE") {
        return "⚠️ AI disabled: Please add your Gemini API key to js/ai.js";
    }
    try {
        const response = await fetch(GEMINI_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { maxOutputTokens: 200, temperature: 0.7 }
            })
        });
        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        return text || "AI could not generate a response. Please try again.";
    } catch (err) {
        console.error("Gemini error:", err);
        return "AI is temporarily unavailable.";
    }
}
