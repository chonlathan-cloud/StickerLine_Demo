
import { GoogleGenAI, Type } from "@google/genai";
import { StickerStyle, StickerSheetConfig } from "../types";

/**
 * GeminiService: Master Version V3.3-STABLE
 * Following LINE Sticker Guidelines & Strict Thai Text Constraints.
 */
export class GeminiService {
  /**
   * Generates ultra-short Thai captions using Gemini 3 Flash.
   * Constraint: Max 12 characters, strictly 1 sentence/phrase.
   */
  async generateStickerCaptions(theme: string): Promise<string[]> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const model = 'gemini-3-flash-preview';

    const prompt = `
      Act as a professional LINE Sticker Creator. 
      Theme: "${theme || 'friendly character'}"
      Goal: Generate 16 ultra-short Thai phrases for stickers.
      
      STRICT RULES:
      1. Maximum 12 characters per phrase (including vowels and spaces).
      2. Strictly ONLY ONE single phrase or sentence. NO multi-sentence or two-line text.
      3. Example of maximum length: "ให้กำลังใจนะ". Do NOT exceed this length.
      4. Avoid compound sentences like "สู้ๆ นะ เป็นกำลังใจให้" (This is TOO LONG).
      
      Required 16 categories: Greeting, Thanks, OK, Fight, Sorry, Yay, Busy, Love, Angry, Shocked, Hmm, Sleep, Working, Hungry, Waiting, Bye.
      Output ONLY a JSON array of 16 strings.
    `;

    try {
      const response = await ai.models.generateContent({
        model: model,
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        }
      });

      const defaultCaptions = ["หวัดดีจ้า", "ขอบคุณนะ", "โอเคเลย", "สู้ๆ นะ", "ขอโทษที", "เย้ๆๆ", "ยุ่งมาก", "รักน้าา", "งอนแล้ว", "ตกใจเลย", "คิดแป๊บ", "ฝันดีนะ", "ทำงานอยู่", "หิวมาก", "รอแป๊บ", "บายจ้า"];
      const text = response.text;
      if (!text) return defaultCaptions;
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) return defaultCaptions;
      const sanitized = parsed
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .slice(0, 16);

      if (sanitized.length === 16) return sanitized;
      return [...sanitized, ...defaultCaptions.slice(sanitized.length, 16)];
    } catch (error) {
      return ["หวัดดีจ้า", "ขอบคุณนะ", "โอเคเลย", "สู้ๆ นะ", "ขอโทษที", "เย้ๆๆ", "ยุ่งมาก", "รักน้าา", "งอนแล้ว", "ตกใจเลย", "คิดแป๊บ", "ฝันดีนะ", "ทำงานอยู่", "หิวมาก", "รอแป๊บ", "บายจ้า"]; 
    }
  }

  /**
   * Generates sticker sheet using Gemini 3 Pro Image (Master Spec).
   */
  async generateStickerSheet(config: StickerSheetConfig): Promise<string> {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const model = 'gemini-3-pro-image-preview'; 
    
    const base64Data = config.base64Image.split(',')[1];
    const mimeType = config.base64Image.match(/data:(.*?);/)?.[1] || 'image/png';

    let captions: string[] = [];
    if (config.includeCaptions) {
      captions = await this.generateStickerCaptions(config.extraPrompt);
    }

    // STYLE GUIDE - MASTER LOCK
    let styleGuide = "";
    if (config.style === 'Chibi 2D') {
      styleGuide = `Art Style: Premium 2D Chibi, bold black outlines, vibrant flat colors.`;
    } else if (config.style === 'Pixar 3D') {
      styleGuide = `
        **Art Style: 3D High-Fidelity Character (Disney/Pixar style).**
        - Material: Soft matte textures, cinematic studio lighting, expressive 3D features.
        - Character edges: clean natural edge details with no white glow or die-cut border.
      `;
    }

    // TECHNICAL TOKENS - AGENTS.MD SECTION 4 (LOCKED)
    const technicalTokens = "High-resolution professional art, thick clean outlines, no white die-cut border, no white glow around character, solid #00FF00 green background for transparency, 4x4 grid layout, 16 distinct poses, consistent character design, center-aligned characters, LINE sticker compliant style.";

    // TEXT INSTRUCTION - ENFORCING SINGLE SHORT LINE
    const textInstruction = config.includeCaptions 
      ? `TEXT CONSTRAINT: Apply these Thai captions: ${captions.join(', ')}. 
         MANDATORY: Use ONLY ONE single line of text per sticker. 
         DO NOT create two lines or long sentences. Text must be very short and readable.`
      : "Ensure no text is included in the artwork.";

    const fullPrompt = `
      ${technicalTokens}
      Objective: Create a professional 16-pose sticker sheet (4 columns x 4 rows) based on the uploaded photo.
      ${styleGuide}
      ${textInstruction}
      Character Likeness: ${config.extraPrompt || 'Maintain subject identity faithfully.'}
      Character should be positioned clearly in each grid cell.
    `.trim();

    try {
      const response = await ai.models.generateContent({
        model: model,
        contents: [{
          parts: [
            { inlineData: { mimeType: mimeType, data: base64Data } },
            { text: fullPrompt }
          ],
        }],
        config: {
          imageConfig: {
            aspectRatio: config.aspectRatio || "1:1",
            imageSize: "1K"
          }
        }
      });

      const part = response.candidates?.[0]?.content?.parts.find(p => p.inlineData);
      if (part?.inlineData?.data) {
        return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
      }
      throw new Error("API returned success but no image data was found.");
    } catch (error: any) {
      console.error("Master Generation Error:", error);
      throw new Error(error.message || "Sticker Generation Failed");
    }
  }
}
