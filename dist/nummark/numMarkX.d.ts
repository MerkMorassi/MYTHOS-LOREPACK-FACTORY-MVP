export declare class NumMarkXEngine {
    private grid;
    generateKey(text: string): string | null;
    index(docId: string | number, text: string): void;
    teleport(queryText: string): (string | number)[] | null;
    rebuildIndex(vectors: {
        id: string | number;
        text: string;
    }[]): void;
}
export declare const TELEPORTER: NumMarkXEngine;
