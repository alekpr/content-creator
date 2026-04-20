import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env.js';

// Single shared client instance
export const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
