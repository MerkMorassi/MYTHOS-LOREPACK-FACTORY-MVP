import type { LorepackModel, Triplet } from '../types.ts';

export class GeminiProvider implements LorepackModel {
  async getEmbeddings(text: string): Promise<number[] | null | undefined> {
    try {
      const response = await fetch('/api/lorepack/embed', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Embedding request failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      return data.embedding;
    } catch (error) {
      console.error('[GeminiProvider] Embedding generation error:', error);
      throw error;
    }
  }

  async extractTripletsFromText(text: string): Promise<Triplet[]> {
    try {
      const response = await fetch('/api/lorepack/triplets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Triplet extraction request failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      return data.triplets || [];
    } catch (error) {
      console.error('[GeminiProvider] Triplet extraction error:', error);
      throw error;
    }
  }
}
