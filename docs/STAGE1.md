# Stage 1 Extraction

This repository contains the LorePack Factory machinery extracted from `MerkMorassi/storyboard-studio` without the host application's UI, agent management, media features, or provider configuration.

## Included

- `LorepackFactory`: chunking, embedding ingestion, conversational capture, triplet graph generation, JSONL or gzip JSONL import/export, and batched endpoint sync.
- `IndexedDbLorepackStore`: the browser persistence dependency reduced to the vector and triplet-edge stores used by the factory.
- `LorepackModel` and `LorepackStore` contracts: explicit integration boundaries for model and persistence adapters.

## Stage 2 Boundary

No dependency installation, Node.js server, local clone, or source-repository change is part of Stage 1. Stage 2 can provide a Node-compatible store, a model provider adapter, and an HTTP entrypoint while reusing `LorepackFactory`.
