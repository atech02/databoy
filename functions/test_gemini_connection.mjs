import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY || "";
if (!apiKey) {
  console.error("Missing GEMINI_API_KEY environment variable.");
  process.exit(1);
}

async function run() {
  console.log("=== Testing Gemini API Connectivity ===");
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    
    console.log("Sending prompt to Gemini: 'Reply with the word SUCCESS'...");
    const result = await model.generateContent("Reply with the word SUCCESS");
    const response = await result.response;
    const text = response.text().trim();
    
    console.log(`\nGemini Response: "${text}"`);
    if (text.includes("SUCCESS")) {
      console.log("Result: PASS");
    } else {
      console.log("Result: FAIL (unexpected response content)");
    }
  } catch (err) {
    console.error("Result: FAIL", err);
  }
}

run();
