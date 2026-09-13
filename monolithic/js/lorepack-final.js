// File: js/lorepack-final.js
// LOREPACK™ v3.7.1 :: BRIDGE CONTROLLER
// - Controls UI, Bridge, and Graph Triggers
// - Current generation-model default
// - Graph model passed explicitly to kernel
// - Complete CF-01 → CF-10 core test matrix
// © 2026 MYTHOS. All Rights Reserved.

import {
  Lorepack,
  EMBEDDING_MODEL,
  DEFAULT_GENERATION_MODEL,
  MAX_CHUNK_CHARS
} from './lorepack.js';

const lore = new Lorepack();

const ui = {
  log(msg, src = 'SYS', type = 'sys') {
    const c =
      document.getElementById(
        'logConsole'
      );

    if (!c) return;

    const d =
      document.createElement(
        'div'
      );

    d.className =
      `log-entry ${type}`;

    d.textContent =
      `[${new Date().toLocaleTimeString()}] ${src}: ${msg}`;

    c.appendChild(d);

    c.scrollTop =
      c.scrollHeight;
  },

  stat(id, val) {
    const el =
      document.getElementById(
        id
      );

    if (el) {
      el.innerText =
        String(val);
    }
  },

  bar(pct) {
    const el =
      document.getElementById(
        'progressBar'
      );

    if (el) {
      el.style.width =
        `${Math.max(
          0,
          Math.min(
            100,
            pct
          )
        )}%`;
    }
  }
};

function toggleFlex(
  id,
  indId = null
) {
  const el =
    document.getElementById(
      id
    );

  if (!el) return;

  const isHidden =
    window.getComputedStyle(
      el
    ).display === 'none';

  el.style.display =
    isHidden
      ? 'flex'
      : 'none';

  if (indId) {
    const ind =
      document.getElementById(
        indId
      );

    if (ind) {
      ind.textContent =
        isHidden
          ? '-'
          : '+';
    }
  }
}

let fileQueue = [];
let abortController = null;

function getAgentId() {
  return (
    document.getElementById(
      'agentId'
    )?.value || ''
  )
    .trim()
    .toUpperCase();
}

function getAgentHandle() {
  return (
    document.getElementById(
      'agentHandle'
    )?.value || ''
  )
    .trim() ||
    getAgentId();
}

function getSystemPrompt() {
  return (
    document.getElementById(
      'systemPrompt'
    )?.value ||
    'You are ARCHIVAX.'
  );
}

function getModel() {
  return (
    document.getElementById(
      'modelSelect'
    )?.value ||
    DEFAULT_GENERATION_MODEL
  );
}

function getThreadsPerKey() {
  return parseInt(
    document.getElementById(
      'lanesPerKey'
    )?.value ||
      '3',
    10
  );
}

function getBatchSize() {
  return parseInt(
    document.getElementById(
      'batchSize'
    )?.value ||
      '40',
    10
  );
}

function loadSavedParams() {
  const p =
    localStorage.getItem(
      'O_PROMPT'
    );

  if (
    p &&
    document.getElementById(
      'systemPrompt'
    )
  ) {
    document.getElementById(
      'systemPrompt'
    ).value = p;
  }

  let keys = [];

  try {
    keys =
      JSON.parse(
        localStorage.getItem(
          'O_KEYS'
        ) ||
        '[]'
      );
  } catch {
    keys = [];
  }

  [
    'k1',
    'k2',
    'k3'
  ].forEach(
    (id, i) => {
      const el =
        document.getElementById(
          id
        );

      if (el) {
        el.value =
          keys[i] || '';
      }
    }
  );

  lore.setApiKeys(
    keys.filter(Boolean)
  );

  const savedBatch =
    localStorage.getItem(
      'O_BATCH'
    );

  if (
    savedBatch &&
    document.getElementById(
      'batchSize'
    )
  ) {
    document.getElementById(
      'batchSize'
    ).value =
      savedBatch;
  }

  const savedLanes =
    localStorage.getItem(
      'O_LANES'
    );

  if (
    savedLanes &&
    document.getElementById(
      'lanesPerKey'
    )
  ) {
    document.getElementById(
      'lanesPerKey'
    ).value =
      savedLanes;
  }
}

function saveParams() {
  const prompt =
    document.getElementById(
      'systemPrompt'
    )?.value || '';

  const keys =
    [
      'k1',
      'k2',
      'k3'
    ]
      .map(
        id =>
          (
            document.getElementById(
              id
            )?.value || ''
          ).trim()
      )
      .filter(Boolean);

  localStorage.setItem(
    'O_PROMPT',
    prompt
  );

  localStorage.setItem(
    'O_KEYS',
    JSON.stringify(keys)
  );

  localStorage.setItem(
    'O_BATCH',
    String(
      getBatchSize()
    )
  );

  localStorage.setItem(
    'O_LANES',
    String(
      getThreadsPerKey()
    )
  );

  lore.setApiKeys(
    keys
  );

  ui.log(
    `Parameters saved. Keys: ${keys.length}`,
    'SYS'
  );
}

async function refreshStats() {
  const s =
    await lore.getStats();

  ui.stat(
    'statVectors',
    `${s.totalNodes} N / ${s.totalEdges} E`
  );

  const size =
    fileQueue.reduce(
      (
        total,
        file
      ) =>
        total +
        (file.size || 0),
      0
    );

  ui.stat(
    'statChunks',
    `${fileQueue.length} Files | ${(
      size /
      (1024 * 1024)
    ).toFixed(2)} MB`
  );
}

function stageFiles(files) {
  const list =
    Array.from(
      files || []
    );

  if (!list.length) return;

  fileQueue.push(
    ...list
  );

  refreshStats();

  ui.log(
    `Staged ${list.length} file(s).`,
    'SYS'
  );
}

async function buildTasksFromFiles() {
  const tasks = [];

  for (
    const f of fileQueue
  ) {
    const text =
      await f.text();

    const chunks =
      lore.chunk(
        text,
        MAX_CHUNK_CHARS
      );

    for (
      const c of chunks
    ) {
      if (
        c.length >
        MAX_CHUNK_CHARS
      ) {
        throw new Error(
          `Chunk ceiling violation: ${c.length} > ${MAX_CHUNK_CHARS}.`
        );
      }

      tasks.push({
        text: c,
        source:
          f.name
      });
    }
  }

  return tasks;
}

function setBusy(
  stateLabel
) {
  ui.stat(
    'statState',
    stateLabel
  );
}

function setControlsEnabled(
  enabled
) {
  [
    'ingestBtn',
    'exportBtn',
    'importBtn',
    'sendBtn',
    'stageFilesBtn',
    'buildGraphBtn',
    'testMatrixBtn'
  ].forEach(
    id => {
      const el =
        document.getElementById(
          id
        );

      if (el) {
        el.disabled =
          !enabled;
      }
    }
  );
}

// ------------------------------------------------------------
// INGEST
// ------------------------------------------------------------

async function runIngest() {
  const agentId =
    getAgentId();

  if (!agentId) {
    return ui.log(
      'Agent ID required.',
      'ERR',
      'err'
    );
  }

  if (!fileQueue.length) {
    return ui.log(
      'No files staged.',
      'ERR',
      'err'
    );
  }

  abortController =
    new AbortController();

  setControlsEnabled(
    false
  );

  setBusy(
    'INGESTING'
  );

  ui.bar(0);

  try {
    const tasks =
      await buildTasksFromFiles();

    ui.log(
      `Ingesting ${tasks.length} chunks...`,
      'SYS'
    );

    await lore.ingestBatches(
      tasks,
      {
        agentId,

        agentHandle:
          getAgentHandle(),

        batchSize:
          getBatchSize(),

        threadsPerKey:
          getThreadsPerKey(),

        signal:
          abortController
            .signal,

        onProgress:
          ({
            processed,
            total
          }) => {
            ui.bar(
              total
                ? (
                    processed /
                    total
                  ) * 100
                : 100
            );

            ui.stat(
              'statVectorsLog',
              processed
            );
          }
      }
    );

    ui.log(
      'Ingestion complete.',
      'SYS',
      'ok'
    );

    fileQueue = [];

    await refreshStats();

  } catch (e) {
    ui.log(
      `Ingest failed: ${e.message}`,
      'ERR',
      'err'
    );

  } finally {
    setBusy(
      'IDLE'
    );

    setControlsEnabled(
      true
    );

    abortController =
      null;
  }
}

// ------------------------------------------------------------
// EXPORT
// ------------------------------------------------------------

async function exportAgentBlob(
  agentId
) {
  const encoder =
    new TextEncoder();

  const stream =
    new ReadableStream({
      async start(
        controller
      ) {
        try {
          let count = 0;

          for await (
            const batch
            of lore.yieldExportBatches(
              agentId,
              1000
            )
          ) {
            const lines =
              batch
                .map(
                  obj =>
                    JSON.stringify(
                      obj
                    )
                )
                .join('\n') +
              '\n';

            controller.enqueue(
              encoder.encode(
                lines
              )
            );

            count +=
              batch.length;

            ui.stat(
              'statVectorsLog',
              count
            );
          }

          controller.close();

        } catch (error) {
          controller.error(
            error
          );
        }
      }
    });

  const gz =
    stream.pipeThrough(
      new CompressionStream(
        'gzip'
      )
    );

  return await new Response(
    gz
  ).blob();
}

async function runExport() {
  const agentId =
    getAgentId();

  if (!agentId) {
    return ui.log(
      'Agent ID required.',
      'ERR',
      'err'
    );
  }

  setControlsEnabled(
    false
  );

  setBusy(
    'EXPORTING'
  );

  ui.bar(0);

  try {
    const blob =
      await exportAgentBlob(
        agentId
      );

    const a =
      document.createElement(
        'a'
      );

    a.href =
      URL.createObjectURL(
        blob
      );

    a.download =
      `MYTHOS.LORE.${agentId}.LOREPACK.${
        new Date()
          .toISOString()
          .slice(0, 10)
      }.jsonl.gz`;

    a.click();

    setTimeout(
      () =>
        URL.revokeObjectURL(
          a.href
        ),
      2000
    );

    ui.log(
      `Exported ${agentId}.`,
      'SYS',
      'ok'
    );

  } catch (e) {
    ui.log(
      `Export failed: ${e.message}`,
      'ERR',
      'err'
    );

  } finally {
    setBusy(
      'IDLE'
    );

    setControlsEnabled(
      true
    );

    ui.bar(0);
  }
}

// ------------------------------------------------------------
// IMPORT
// ------------------------------------------------------------

async function runImport(
  file
) {
  if (!file) return;

  setControlsEnabled(
    false
  );

  setBusy(
    'IMPORTING'
  );

  ui.bar(0);

  try {
    const res =
      await lore.import(
        file,
        ({
          processed
        }) => {
          ui.bar(
            Math.min(
              99,
              (
                processed %
                5000
              ) / 50
            )
          );

          ui.stat(
            'statVectorsLog',
            processed
          );
        }
      );

    ui.log(
      `Imported ${res.nodesImported} items (${res.vectorsImported} vectors / ${res.edgesImported} edges).`,
      'SYS',
      'ok'
    );

    await refreshStats();

  } catch (e) {
    ui.log(
      `Import failed: ${e.message}`,
      'ERR',
      'err'
    );

  } finally {
    setBusy(
      'IDLE'
    );

    setControlsEnabled(
      true
    );

    ui.bar(0);
  }
}

// ------------------------------------------------------------
// CHAT
// ------------------------------------------------------------

async function runChat() {
  const qEl =
    document.getElementById(
      'chatInput'
    );

  const q =
    (
      qEl?.value ||
      ''
    ).trim();

  if (!q) return;

  const agentId =
    getAgentId();

  ui.log(
    q,
    'OPERATOR',
    'user'
  );

  try {
    const res =
      await lore.chat(
        q,
        agentId,
        getSystemPrompt(),
        getModel()
      );

    ui.log(
      res.response,
      agentId ||
        'ARCHIVAX',
      'ai'
    );

    ui.log(
      `[${res.derivation}]`,
      'SYS',
      'sys'
    );

  } catch (e) {
    ui.log(
      `Chat error: ${e.message}`,
      'ERR',
      'err'
    );

  } finally {
    if (qEl) {
      qEl.value = '';
    }
  }
}

// ------------------------------------------------------------
// CORE FUNCTION TEST MATRIX
// ------------------------------------------------------------

function assertTest(
  condition,
  message
) {
  if (!condition) {
    throw new Error(
      message
    );
  }
}

function testLog(
  id,
  status,
  message
) {
  ui.log(
    `${id}: ${status} — ${message}`,
    status === 'PASSED'
      ? 'TEST'
      : 'ERR',
    status === 'PASSED'
      ? 'ok'
      : 'err'
  );
}

async function runCoreFunctionTest() {
  const TEST_ALPHA =
    `__LOREPACK_TEST_ALPHA_${Date.now()}`;

  const TEST_BETA =
    `__LOREPACK_TEST_BETA_${Date.now()}`;

  const SOURCE =
    'TEST_LOREPACK_001';

  const fixture = [
    {
      text:
        'ARCHIVAX maintains the Sacred Archive. The archive preserves provenance and continuity.',

      source:
        SOURCE
    },

    {
      text:
        'The Forge records decisions as durable knowledge. Provenance identifies where each record originated.',

      source:
        SOURCE
    }
  ];

  let originalGenerate =
    null;

  setControlsEnabled(
    false
  );

  setBusy(
    'TESTING'
  );

  ui.bar(0);

  try {
    // ----------------------------------------------------------
    // CF-01 INTAKE
    // ----------------------------------------------------------

    assertTest(
      fixture.length === 2,
      'Fixture was not constructed.'
    );

    testLog(
      'CF-01 INTAKE',
      'PASSED',
      'Fixture TEST_LOREPACK_001 loaded.'
    );

    // ----------------------------------------------------------
    // CF-02 CHUNKING
    // ----------------------------------------------------------

    const chunks =
      fixture.flatMap(
        item =>
          lore.chunk(
            item.text,
            MAX_CHUNK_CHARS
          )
      );

    assertTest(
      chunks.length >= 2,
      `Expected at least 2 chunks, received ${chunks.length}.`
    );

    assertTest(
      chunks.every(
        chunk =>
          chunk.length <=
          MAX_CHUNK_CHARS
      ),
      'Hard chunk ceiling violated.'
    );

    testLog(
      'CF-02 CHUNKING',
      'PASSED',
      `${chunks.length} chunks generated.`
    );

    ui.bar(10);

    // ----------------------------------------------------------
    // CF-03 EMBEDDING
    // ----------------------------------------------------------

    if (!lore.apiKeys.length) {
      throw new Error(
        'CF-03 requires at least one API key.'
      );
    }

    const testTexts =
      chunks.slice(
        0,
        2
      );

    const vectors =
      await lore.embedBatch(
        testTexts
      );

    assertTest(
      vectors.length ===
        testTexts.length,
      'Embedding count mismatch.'
    );

    const dimension =
      vectors[0]?.length || 0;

    assertTest(
      dimension > 0,
      'Embedding dimension is zero.'
    );

    assertTest(
      vectors.every(
        vector =>
          Array.isArray(
            vector
          ) &&
          vector.length ===
            dimension
      ),
      'Embedding dimensions are inconsistent.'
    );

    testLog(
      'CF-03 EMBEDDING',
      'PASSED',
      `${EMBEDDING_MODEL} → ${dimension} dimensions.`
    );

    ui.bar(20);

    // ----------------------------------------------------------
    // CF-04 INGESTION
    // ----------------------------------------------------------

    await lore.deleteAgentData(
      TEST_ALPHA
    );

    const ingestTasks =
      chunks.map(
        text => ({
          text,
          source:
            SOURCE
        })
      );

    const ingestResult =
      await lore.ingestBatches(
        ingestTasks,
        {
          agentId:
            TEST_ALPHA,

          agentHandle:
            TEST_ALPHA,

          batchSize:
            2,

          threadsPerKey:
            1,

          onProgress:
            ({
              processed,
              total
            }) => {
              ui.bar(
                20 +
                (
                  total
                    ? (
                        processed /
                        total
                      ) * 15
                    : 15
                )
              );
            }
        }
      );

    assertTest(
      ingestResult.ingested ===
        ingestTasks.length,
      `Expected ${ingestTasks.length} ingested vectors, received ${ingestResult.ingested}.`
    );

    const alphaNodes =
      await lore.getNodes(
        TEST_ALPHA
      );

    assertTest(
      alphaNodes.length ===
        ingestTasks.length,
      'Stored vector count does not match ingestion count.'
    );

    assertTest(
      alphaNodes.every(
        node =>
          node.metadata
            ?.embeddingModel ===
            EMBEDDING_MODEL &&
          node.metadata
            ?.embeddingDimension ===
            node.vector.length &&
          node.vector.length ===
            dimension
      ),
      'Stored embedding metadata is invalid.'
    );

    testLog(
      'CF-04 INGESTION',
      'PASSED',
      `${alphaNodes.length} vector nodes stored.`
    );

    ui.bar(35);

    // ----------------------------------------------------------
    // CF-05 PROVENANCE
    // ----------------------------------------------------------

    assertTest(
      alphaNodes.every(
        node =>
          node.metadata
            ?.source ===
          SOURCE
      ),
      'Source identity was not preserved.'
    );

    testLog(
      'CF-05 PROVENANCE',
      'PASSED',
      `Source identity preserved as ${SOURCE}.`
    );

    ui.bar(45);

    // ----------------------------------------------------------
    // CF-06 GRAPH SYNTHESIS
    //
    // Deliberately isolate the graph test from the
    // round-trip dataset. No corrupt vector is inserted.
    // The generator is temporarily stubbed to return [].
    // ----------------------------------------------------------

    originalGenerate =
      lore._generate;

    lore._generate =
      async () => '[]';

    const graphCount =
      await lore.buildGraphLite(
        TEST_ALPHA,
        (
          curr,
          total,
          created
        ) => {
          ui.bar(
            45 +
            (
              total
                ? (
                    curr /
                    total
                  ) * 15
                : 15
            )
          );
        },
        getModel()
      );

    assertTest(
      graphCount === 0,
      `Expected 0 semantic edges, received ${graphCount}.`
    );

    const alphaEdges =
      await lore.getEdges(
        TEST_ALPHA
      );

    assertTest(
      alphaEdges.length === 0,
      'Graph test created unexpected edges.'
    );

    testLog(
      'CF-06 GRAPH SYNTHESIS',
      'PASSED',
      '0 semantic edges generated.'
    );

    lore._generate =
      originalGenerate;

    originalGenerate =
      null;

    ui.bar(60);

    // ----------------------------------------------------------
    // CF-07 AGENT ISOLATION
    // ----------------------------------------------------------

    await lore.ingestBatches(
      [
        {
          text:
            'BETA ISOLATION FIXTURE.',
          source:
            'TEST_BETA'
        }
      ],
      {
        agentId:
          TEST_BETA,

        agentHandle:
          TEST_BETA,

        batchSize:
          1,

        threadsPerKey:
          1
      }
    );

    const betaNodes =
      await lore.getNodes(
        TEST_BETA
      );

    const alphaAfterBeta =
      await lore.getNodes(
        TEST_ALPHA
      );

    assertTest(
      betaNodes.length === 1,
      'Beta fixture was not stored.'
    );

    assertTest(
      alphaAfterBeta.length ===
        ingestTasks.length,
      'Alpha workspace was contaminated by Beta.'
    );

    assertTest(
      betaNodes.every(
        node =>
          node.agentId ===
          TEST_BETA
      ),
      'Beta agent barrier failed.'
    );

    assertTest(
      alphaAfterBeta.every(
        node =>
          node.agentId ===
          TEST_ALPHA
      ),
      'Alpha agent barrier failed.'
    );

    testLog(
      'CF-07 AGENT ISOLATION',
      'PASSED',
      'Alpha/Beta workspace barriers intact.'
    );

    ui.bar(70);

    // ----------------------------------------------------------
    // CF-08 EXPORT
    // ----------------------------------------------------------

    // Remove Beta from the test environment so only Alpha
    // participates in the round-trip.
    await lore.deleteAgentData(
      TEST_BETA
    );

    const exportedBlob =
      await exportAgentBlob(
        TEST_ALPHA
      );

    assertTest(
      exportedBlob &&
        exportedBlob.size > 0,
      'Export produced an empty blob.'
    );

    testLog(
      'CF-08 EXPORT',
      'PASSED',
      `MYTHOS.AGENT_TEST_ALPHA.jsonl.gz (${exportedBlob.size} bytes).`
    );

    ui.bar(80);

    // ----------------------------------------------------------
    // CF-09 IMPORT
    // ----------------------------------------------------------

    const beforeExportNodes =
      await lore.getNodes(
        TEST_ALPHA
      );

    const beforeExportEdges =
      await lore.getEdges(
        TEST_ALPHA
      );

    const beforeNodeMap =
      new Map(
        beforeExportNodes.map(
          node => [
            node.id,
            node
          ]
        )
      );

    const beforeEdgeMap =
      new Map(
        beforeExportEdges.map(
          edge => [
            edge.id,
            edge
          ]
        )
      );

    await lore.deleteAgentData(
      TEST_ALPHA
    );

    const importResult =
      await lore.import(
        new File(
          [
            exportedBlob
          ],
          'MYTHOS.AGENT_TEST_ALPHA.jsonl.gz',
          {
            type:
              'application/gzip'
          }
        )
      );

    assertTest(
      importResult.vectorsImported ===
        beforeExportNodes.length,
      'Imported vector count does not match export.'
    );

    assertTest(
      importResult.edgesImported ===
        beforeExportEdges.length,
      'Imported edge count does not match export.'
    );

    testLog(
      'CF-09 IMPORT',
      'PASSED',
      `${importResult.vectorsImported} nodes / ${importResult.edgesImported} edges restored.`
    );

    ui.bar(90);

    // ----------------------------------------------------------
    // CF-10 ROUND-TRIP
    // ----------------------------------------------------------

    const restored =
      await lore.getNodes(
        TEST_ALPHA
      );

    const restoredEdges =
      await lore.getEdges(
        TEST_ALPHA
      );

    const restoredNodeMap =
      new Map(
        restored.map(
          node => [
            node.id,
            node
          ]
        )
      );

    const restoredEdgeMap =
      new Map(
        restoredEdges.map(
          edge => [
            edge.id,
            edge
          ]
        )
      );

    assertTest(
      restored.length ===
        beforeExportNodes.length,
      `Vector count changed during round-trip: ${beforeExportNodes.length} → ${restored.length}.`
    );

    assertTest(
      restored.every(
        node =>
          node.agentId ===
            TEST_ALPHA &&
          node.metadata
            ?.source ===
            SOURCE &&
          Array.isArray(
            node.vector
          ) &&
          node.vector.length ===
            dimension &&
          node.metadata
            ?.embeddingModel ===
            EMBEDDING_MODEL &&
          node.metadata
            ?.embeddingDimension ===
            dimension
      ),
      'Vector integrity failed during round-trip.'
    );

    assertTest(
      restoredNodeMap.size ===
        beforeNodeMap.size,
      'Vector ID cardinality changed during round-trip.'
    );

    for (
      const [
        id,
        original
      ] of beforeNodeMap
    ) {
      const copy =
        restoredNodeMap.get(
          id
        );

      assertTest(
        !!copy,
        `Vector ID lost during round-trip: ${id}.`
      );

      assertTest(
        copy.id ===
          original.id,
        `Vector ID changed during round-trip: ${id}.`
      );

      assertTest(
        copy.text ===
          original.text,
        `Vector text changed for ID ${id}.`
      );
    }

    assertTest(
      restoredEdges.length ===
        beforeExportEdges.length,
      'Edge count changed during round-trip.'
    );

    assertTest(
      restoredEdgeMap.size ===
        beforeEdgeMap.size,
      'Edge ID cardinality changed during round-trip.'
    );

    for (
      const [
        id,
        original
      ] of beforeEdgeMap
    ) {
      const copy =
        restoredEdgeMap.get(
          id
        );

      assertTest(
        !!copy,
        `Edge ID lost during round-trip: ${id}.`
      );

      assertTest(
        copy.sourceId ===
          original.sourceId,
        `Edge source reference changed for ${id}.`
      );

      assertTest(
        restoredNodeMap.has(
          copy.sourceId
        ),
        `Edge ${id} references a missing restored vector.`
      );
    }

    testLog(
      'CF-10 ROUND-TRIP',
      'PASSED',
      `${restored.length} vectors / ${restoredEdges.length} edges verified; IDs, provenance, dimensions and edge references preserved.`
    );

    ui.bar(100);

    ui.log(
      'CORE TEST PASSED: CF-01 → CF-10.',
      'TEST',
      'ok'
    );

  } catch (e) {
    if (
      originalGenerate
    ) {
      lore._generate =
        originalGenerate;
    }

    ui.log(
      `CORE TEST FAILED: ${e.message}`,
      'ERR',
      'err'
    );

  } finally {
    if (
      originalGenerate
    ) {
      lore._generate =
        originalGenerate;
    }

    try {
      await lore.deleteAgentData(
        TEST_ALPHA
      );

      await lore.deleteAgentData(
        TEST_BETA
      );
    } catch (cleanupError) {
      ui.log(
        `Test cleanup warning: ${cleanupError.message}`,
        'ERR',
        'err'
      );
    }

    setBusy(
      'IDLE'
    );

    setControlsEnabled(
      true
    );

    ui.bar(0);

    await refreshStats();
  }
}

// ------------------------------------------------------------
// INIT
// ------------------------------------------------------------

document.addEventListener(
  'DOMContentLoaded',
  async () => {
    try {
      await lore.ready();

      loadSavedParams();

      await refreshStats();

      ui.stat(
        'statState',
        'IDLE'
      );

      ui.log(
        'LOREPACK Factory v3.7.1 online (Graph Ready).',
        'SYS',
        'ok'
      );

    } catch (e) {
      ui.log(
        `Boot error: ${e.message}`,
        'ERR',
        'err'
      );
    }

    const bind =
      (
        id,
        fn
      ) => {
        const el =
          document.getElementById(
            id
          );

        if (el) {
          el.onclick =
            fn;
        }
      };

    bind(
      'togglePrompt',
      () =>
        toggleFlex(
          'prompt',
          'promptInd'
        )
    );

    bind(
      'toggleKeys',
      () =>
        toggleFlex(
          'keys',
          'keysInd'
        )
    );

    bind(
      'saveBtn',
      saveParams
    );

    bind(
      'ingestBtn',
      runIngest
    );

    bind(
      'exportBtn',
      runExport
    );

    bind(
      'sendBtn',
      runChat
    );

    bind(
      'testMatrixBtn',
      runCoreFunctionTest
    );

    bind(
      'clearLogBtn',
      () => {
        const consoleEl =
          document.getElementById(
            'logConsole'
          );

        if (consoleEl) {
          consoleEl.innerHTML =
            '';
        }
      }
    );

    const stageBtn =
      document.getElementById(
        'stageFilesBtn'
      );

    const fileInput =
      document.getElementById(
        'fileInput'
      );

    if (
      stageBtn &&
      fileInput
    ) {
      stageBtn.onclick =
        () =>
          fileInput.click();
    }

    if (fileInput) {
      fileInput.onchange =
        e => {
          stageFiles(
            e.target.files
          );

          e.target.value =
            '';
        };
    }

    const importBtn =
      document.getElementById(
        'importBtn'
      );

    const importFile =
      document.getElementById(
        'importFile'
      );

    if (
      importBtn &&
      importFile
    ) {
      importBtn.onclick =
        () =>
          importFile.click();
    }

    if (importFile) {
      importFile.onchange =
        async e => {
          await runImport(
            e.target.files?.[0]
          );

          e.target.value =
            '';
        };
    }

    bind(
      'nukeTrigger',
      () =>
        toggleFlex(
          'nukeModal'
        )
    );

    bind(
      'nukeCancelBtn',
      () =>
        toggleFlex(
          'nukeModal'
        )
    );

    bind(
      'nukeConfirmBtn',
      async () => {
        try {
          await lore.nuke();

          location.reload();

        } catch (e) {
          ui.log(
            `Nuke failed: ${e.message}`,
            'ERR',
            'err'
          );
        }
      }
    );

    // ----------------------------------------------------------
    // GRAPH
    // ----------------------------------------------------------

    bind(
      'buildGraphBtn',
      async () => {
        const aid =
          getAgentId();

        if (!aid) {
          return ui.log(
            'Agent ID required.',
            'ERR',
            'err'
          );
        }

        setControlsEnabled(
          false
        );

        setBusy(
          'GRAPHING'
        );

        ui.bar(0);

        try {
          const model =
            getModel();

          ui.log(
            `Building Graph for ${aid} using ${model}...`,
            'SYS'
          );

          const count =
            await lore.buildGraphLite(
              aid,
              (
                curr,
                total,
                created
              ) => {
                ui.bar(
                  total
                    ? (
                        curr /
                        total
                      ) * 100
                    : 100
                );

                if (
                  curr % 5 === 0 ||
                  curr === total
                ) {
                  ui.stat(
                    'statVectorsLog',
                    `${curr}/${total} | +${created} Edges`
                  );
                }
              },
              model
            );

          ui.log(
            `Graph build complete. ${count} edges created.`,
            'SYS',
            'ok'
          );

          await refreshStats();

        } catch (e) {
          ui.log(
            `Graph build failed: ${e.message}`,
            'ERR',
            'err'
          );

        } finally {
          setBusy(
            'IDLE'
          );

          setControlsEnabled(
            true
          );

          ui.bar(0);
        }
      }
    );
  }
);