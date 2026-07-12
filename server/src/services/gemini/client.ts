// Shared Gemini client construction. Both geminiClient.ts (narration/judging)
// and imageGenClient.ts (winner portraits) call this instead of constructing
// their own GoogleGenAI, so the Developer-API-vs-Vertex-AI branching (and its
// very different auth story) lives in exactly one place.
import { GoogleGenAI } from '@google/genai';
import { env, features } from '../../config/env.js';

let logged = false;

/** Returns null when no Gemini credential is configured (offline stub mode). */
export function createGeminiClient(): GoogleGenAI | null {
  if (!features.gemini) return null;

  const client = env.GEMINI_USE_VERTEX
    ? new GoogleGenAI({
        vertexai: true,
        project: env.GEMINI_VERTEX_PROJECT!,
        location: env.GEMINI_VERTEX_LOCATION,
      })
    : new GoogleGenAI({ apiKey: env.GEMINI_API_KEY! });

  if (!logged) {
    logged = true;
    console.log(
      env.GEMINI_USE_VERTEX
        ? `[gemini] using Vertex AI / Gemini Enterprise Agent Platform — project ${env.GEMINI_VERTEX_PROJECT}, region ${env.GEMINI_VERTEX_LOCATION}`
        : '[gemini] using the Developer API (plain API key)',
    );
  }
  return client;
}
