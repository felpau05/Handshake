// AI image-gen: turn the winner's photo into a themed "drawing" used as their
// leaderboard avatar. Reuses the Gemini SDK's image model to avoid onboarding a
// 5th vendor. With STUB_IMAGE_GEN=true (default) it returns the original photo
// unchanged, so the whole winner→avatar pipeline runs end-to-end for free.
import { GoogleGenAI } from '@google/genai';
import { env, features } from '../../config/env.js';

const ai = features.imageGen ? new GoogleGenAI({ apiKey: env.GEMINI_API_KEY! }) : null;

export const DEFAULT_STYLE_PROMPT =
  'Transform this portrait into a bold, heroic comic-book trading-card illustration, ' +
  'vibrant colors, dramatic lighting, clean ink outlines. Keep the face recognizable.';

/**
 * @param base64Photo data URL or raw base64 of the winner's captured frame.
 * @returns a data URL for the stylized image (or the original when stubbed).
 */
export async function generateStylizedPortrait(
  base64Photo: string,
  stylePrompt: string = DEFAULT_STYLE_PROMPT,
): Promise<string> {
  if (!ai) return base64Photo; // stub passthrough

  const { data, mimeType } = splitDataUrl(base64Photo);
  const res = await ai.models.generateContent({
    model: env.GEMINI_IMAGE_MODEL,
    contents: [
      { text: stylePrompt },
      { inlineData: { mimeType, data } },
    ],
  });

  // Pull the first inline image part out of the response.
  const parts = res.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    const inline = (part as { inlineData?: { data: string; mimeType?: string } }).inlineData;
    if (inline?.data) {
      return `data:${inline.mimeType ?? 'image/png'};base64,${inline.data}`;
    }
  }
  console.warn('[imagegen] no image in response, returning original photo');
  return base64Photo;
}

function splitDataUrl(input: string): { data: string; mimeType: string } {
  const match = /^data:(.+?);base64,(.*)$/.exec(input);
  if (match) return { mimeType: match[1], data: match[2] };
  return { mimeType: 'image/jpeg', data: input };
}
