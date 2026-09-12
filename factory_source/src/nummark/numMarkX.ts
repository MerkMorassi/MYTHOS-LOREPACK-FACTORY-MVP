
export class NumMarkXEngine {
    private grid = new Map<string, Set<string | number>>();
  
    // 1. Lexical Hashing: Text -> ASCII (3-digit) -> Concatenated String
    generateKey(text: string): string | null {
      const clean = text.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
      if (!clean) return null;
      
      // Safety cap for key length to avoid memory issues with huge text chunks if passed accidentally
      if (clean.length > 100) return null; 
  
      let encoded = '';
      for (let i = 0; i < clean.length; i++) {
        const asciiCode = clean.charCodeAt(i);
        encoded += asciiCode.toString().padStart(3, "0");
      }
      return encoded; 
    }
    
    // 2. Indexing
    index(docId: string | number, text: string) {
      // We only index short phrases or keywords usually, but here we try to index the chunk content.
      // NOTE: NumMarkX is best for exact phrase matching. 
      // For general chunks, we might index the first few words or specific extracted keywords if we had them.
      // Given the logic from the snippet, it indexes the *entire* text content provided. 
      // We will assume 'text' passed here is meant to be a lookup key (like a title or specific phrase).
      // However, the snippet indexes the chunk text. 
      // To make this practical, we will only index if the text length is manageable, 
      // or we accept that 'teleport' only works if the user types the EXACT chunk text (unlikely).
      // A better adaptation for RAG: Index distinct words or bigrams? 
      // The snippet implies "Instant Knowability" via "Deterministic ASCII Hash".
      // We will stick to the snippet's logic: Key = Hash(Text).
      
      const key = this.generateKey(text);
      if (!key) return;
      if (!this.grid.has(key)) {
        this.grid.set(key, new Set());
      }
      this.grid.get(key)!.add(docId);
    }
    
    // 3. Teleport (O(1) Retrieval)
    teleport(queryText: string): (string | number)[] | null {
      const key = this.generateKey(queryText);
      if (!key || !this.grid.has(key)) return null;
      return Array.from(this.grid.get(key)!);
    }
    
    // 4. Synchronization
    rebuildIndex(vectors: { id: string | number; text: string }[]) {
      this.grid.clear();
      // In a real NumMarkX implementation, we'd probably extract keywords from the text to index.
      // For this direct port, we'll index the text itself, which means it mostly acts as a cache for exact repeated phrases.
      vectors.forEach(v => this.index(v.id, v.text));
      console.log(`[NumMarkX] Teleporter Online. Nodes: ${this.grid.size} (Deterministic Mode)`);
    }
  }
  
  export const TELEPORTER = new NumMarkXEngine();
