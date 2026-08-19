<script lang="ts">
  import { onMount } from "svelte";
  import {
    api,
    type Settings,
    type Memory,
    type InboxFile,
    type EventLogEntry,
    type StatusReport,
  } from "../bridge/api";
  import { emit } from "../bridge/tauri";
  import { KEEPSAKE_MEMORY_TYPE } from "../sim";

  let settings = $state<Settings | null>(null);
  let memories = $state<Memory[]>([]);
  // REQ-109 — keepsakes render on their own shelf, not in the memory list.
  let keepsakes = $derived(memories.filter((m) => m.type === KEEPSAKE_MEMORY_TYPE));
  let plainMemories = $derived(memories.filter((m) => m.type !== KEEPSAKE_MEMORY_TYPE));
  let inbox = $state<InboxFile[]>([]);
  let events = $state<EventLogEntry[]>([]);
  let recentReports = $state<StatusReport[]>([]);
  let runningReport = $state(false);
  let savingMessage = $state("");
  let exportPath = $state<string | null>(null);
  let activeTab = $state<"general" | "memory" | "sandbox" | "developer">("general");
  let loadError = $state<string | null>(null);
  let actionError = $state<string | null>(null);
  let pendingApiKey = $state("");
  let approvedSummary = $state<{ name: string; text: string } | null>(null);

  function showError(prefix: string, e: unknown) {
    const msg = (e as Error)?.message ?? String(e);
    actionError = `${prefix}: ${msg}`;
    setTimeout(() => (actionError = null), 4_000);
  }

  async function load() {
    if (!api.hasBackend) return;
    try {
      const [s, m, ix, ev, rr] = await Promise.all([
        api.getSettings(),
        api.listMemories(200),
        api.listInboxFiles(),
        api.getEventLog(50),
        api.listStatusReports(10),
      ]);
      settings = s;
      memories = m;
      inbox = ix;
      events = ev;
      recentReports = rr;
      loadError = null;
    } catch (e) {
      loadError = (e as Error)?.message ?? String(e);
    }
  }

  onMount(() => {
    document.body.classList.add("settings-page");
    void load();
    // Returned cleanup runs on component destroy in Svelte 5; without it the
    // settings background style leaks back onto the pet view in SPA navigation.
    return () => {
      document.body.classList.remove("settings-page");
    };
  });

  async function save() {
    if (!settings) return;
    savingMessage = "saving…";
    try {
      settings = await api.saveSettings(settings);
      savingMessage = "saved ✓";
      // REQ-113 — broadcast so the pet overlay picks up e.g. animation
      // intensity without a restart. Best-effort.
      void emit("settings:changed", settings).catch(() => undefined);
    } catch (e) {
      savingMessage = `error: ${(e as Error).message}`;
    }
    setTimeout(() => (savingMessage = ""), 2_000);
  }

  async function saveApiKey() {
    if (!settings) return;
    try {
      const isSet = await api.setCloudApiKey(pendingApiKey || null);
      settings = { ...settings, cloudApiKeySet: isSet };
      pendingApiKey = "";
      savingMessage = isSet ? "key saved ✓" : "key cleared ✓";
    } catch (e) {
      showError("save key", e);
    }
    setTimeout(() => (savingMessage = ""), 2_000);
  }

  async function clearApiKey() {
    if (!settings) return;
    try {
      await api.setCloudApiKey(null);
      settings = { ...settings, cloudApiKeySet: false };
      pendingApiKey = "";
    } catch (e) {
      showError("clear key", e);
    }
  }

  async function deleteMemory(id: string) {
    try {
      await api.deleteMemory(id);
      memories = await api.listMemories(200);
    } catch (e) {
      showError("delete memory", e);
    }
  }

  async function exportMemories(format: "md" | "json") {
    try {
      exportPath = await api.exportMemories(format);
    } catch (e) {
      showError("export", e);
    }
  }

  async function approveFile(name: string) {
    try {
      const summary = await api.approveFile(name);
      approvedSummary = { name, text: summary };
      inbox = await api.listInboxFiles();
    } catch (e) {
      showError("approve file", e);
    }
  }

  /** §9.8 — manually trigger a status report (debug / on-demand). The pet's
   *  normal flow fires this autonomously when (12h elapsed AND idle window);
   *  this button is here so the user can see one immediately without waiting.
   */
  async function runReportNow() {
    if (runningReport) return;
    runningReport = true;
    try {
      await api.runStatusReport();
      recentReports = await api.listStatusReports(10);
    } catch (e) {
      showError("status report", e);
    } finally {
      runningReport = false;
    }
  }

  function formatWindow(start: string, end: string): string {
    const s = new Date(start);
    const e = new Date(end);
    const sameDay = s.toDateString() === e.toDateString();
    const sLabel = sameDay
      ? s.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : s.toLocaleString();
    const eLabel = e.toLocaleString();
    return `${sLabel} → ${eLabel}`;
  }

  async function refreshInbox() {
    try {
      inbox = await api.listInboxFiles();
    } catch (e) {
      showError("inbox refresh", e);
    }
  }

  async function refreshEvents() {
    try {
      events = await api.getEventLog(50);
    } catch (e) {
      showError("event log", e);
    }
  }

  function payloadPreview(raw: string | null | undefined): string {
    if (!raw) return "";
    const flat = raw.replace(/\s+/g, " ").trim();
    return flat.length > 80 ? flat.slice(0, 80) + "…" : flat;
  }

  const TABS = ["general", "memory", "sandbox", "developer"] as const;
  function onTabKeydown(e: KeyboardEvent) {
    if (
      e.key !== "ArrowLeft" &&
      e.key !== "ArrowRight" &&
      e.key !== "Home" &&
      e.key !== "End"
    ) return;
    e.preventDefault();
    const i = TABS.indexOf(activeTab);
    let next = i;
    if (e.key === "ArrowLeft") next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === "ArrowRight") next = (i + 1) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    activeTab = TABS[next];
    requestAnimationFrame(() => {
      document.getElementById(`tab-${activeTab}`)?.focus();
    });
  }
</script>

<main class="settings">
  <header>
    <h1>🍡 Mochi</h1>
    <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
    <nav role="tablist" aria-label="Settings sections" onkeydown={onTabKeydown}>
      <button
        id="tab-general"
        role="tab"
        aria-controls="panel-general"
        aria-selected={activeTab === "general"}
        tabindex={activeTab === "general" ? 0 : -1}
        class:active={activeTab === "general"}
        onclick={() => (activeTab = "general")}
      >General</button>
      <button
        id="tab-memory"
        role="tab"
        aria-controls="panel-memory"
        aria-selected={activeTab === "memory"}
        tabindex={activeTab === "memory" ? 0 : -1}
        class:active={activeTab === "memory"}
        onclick={() => (activeTab = "memory")}
      >Memory</button>
      <button
        id="tab-sandbox"
        role="tab"
        aria-controls="panel-sandbox"
        aria-selected={activeTab === "sandbox"}
        tabindex={activeTab === "sandbox" ? 0 : -1}
        class:active={activeTab === "sandbox"}
        onclick={() => (activeTab = "sandbox")}
      >Sandbox</button>
      <button
        id="tab-developer"
        role="tab"
        aria-controls="panel-developer"
        aria-selected={activeTab === "developer"}
        tabindex={activeTab === "developer" ? 0 : -1}
        class:active={activeTab === "developer"}
        onclick={() => (activeTab = "developer")}
      >Developer</button>
    </nav>
  </header>

  {#if !api.hasBackend}
    <p class="warn">Backend bridge unavailable. Open via the desktop app to edit settings.</p>
  {:else if loadError}
    <p class="warn">Failed to load settings: {loadError}<br /><button onclick={load}>Retry</button></p>
  {:else if !settings}
    <p role="status" aria-live="polite">Loading settings…</p>
  {:else}
    {#if actionError}
      <p class="warn" role="alert">{actionError}</p>
    {/if}

    {#if activeTab === "general"}
      <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
      <section id="panel-general" role="tabpanel" aria-labelledby="tab-general">
        <label>
          Pet name
          <input bind:value={settings.petName} />
        </label>
        <label>
          Personality
          <select bind:value={settings.personalityPreset}>
            <option value="curious">curious</option>
            <option value="lazy">lazy</option>
            <option value="playful">playful</option>
            <option value="quiet">quiet</option>
          </select>
        </label>
        <label>
          LLM provider
          <select bind:value={settings.llmProvider}>
            <option value="ollama">Ollama (local)</option>
            <option value="none">None — silent mode</option>
          </select>
        </label>
        <label>
          Ollama endpoint
          <input bind:value={settings.ollamaEndpoint} placeholder="http://localhost:11434" />
        </label>
        <label>
          Ollama model
          <input bind:value={settings.ollamaModel} placeholder="gemma4:e2b" />
        </label>

        <fieldset>
          <legend>Cloud API key (write-only)</legend>
          <p class="hint">
            Status: {settings.cloudApiKeySet ? "key on file" : "no key stored"}.
            The key is never returned to the UI.
          </p>
          <div class="row">
            <input
              type="password"
              bind:value={pendingApiKey}
              placeholder="paste new key…"
              autocomplete="off"
            />
            <button onclick={saveApiKey} disabled={!pendingApiKey}>Save key</button>
            <button class="danger" onclick={clearApiKey} disabled={!settings.cloudApiKeySet}>
              Clear
            </button>
          </div>
        </fieldset>

        <label class="row">
          <input type="checkbox" bind:checked={settings.localOnlyMode} />
          Local-only mode (block any cloud calls)
        </label>
        <label class="row">
          <input type="checkbox" bind:checked={settings.autonomousSpeech} />
          Allow autonomous chat bubbles
        </label>
        <label class="row">
          <input type="checkbox" bind:checked={settings.memoryEnabled} />
          Memory enabled
        </label>
        <label class="row">
          <input type="checkbox" bind:checked={settings.alwaysOnTop} />
          Always on top
        </label>
        <label class="row">
          <input type="checkbox" bind:checked={settings.startOnLogin} />
          Start on login
        </label>
        <label>
          Animation intensity
          <input
            type="range"
            min="0"
            max="1.5"
            step="0.1"
            bind:value={settings.animationIntensity}
          />
          <span>{settings.animationIntensity.toFixed(1)}× {settings.animationIntensity === 0 ? "(particles & quirks off)" : ""}</span>
        </label>
        <label>
          Stage background
          <select bind:value={settings.stageBackground}>
            <option value="transparent">Fully transparent (desktop overlay)</option>
            <option value="cream">Cream card</option>
            <option value="blossom">Blossom pink</option>
            <option value="mint">Mint</option>
            <option value="night">Night</option>
          </select>
        </label>
        <label>
          Pet home folder
          <input bind:value={settings.petHomePath} placeholder="(default user data dir)" />
        </label>
        <label class="row">
          <input type="checkbox" bind:checked={settings.developerEventLog} />
          Developer event log
        </label>
        <div class="actions">
          <button onclick={save}>Save</button>
          <span class="status" role={savingMessage.startsWith("error") ? "alert" : "status"} aria-live="polite">{savingMessage}</span>
        </div>
      </section>
    {/if}

    {#if activeTab === "memory"}
      <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
      <section id="panel-memory" role="tabpanel" aria-labelledby="tab-memory">
        <h3>Keepsake shelf</h3>
        <p class="hint">
          Little gifts Mochi leaves when she feels well cared for (PRD §27.5).
        </p>
        {#if keepsakes.length === 0}
          <p class="hint">
            Nothing here yet — keep Mochi fed, played with, and patted, and
            she'll bring you something.
          </p>
        {:else}
          <ul class="keepsake-shelf">
            {#each keepsakes as k (k.id)}
              <li>
                <p class="keepsake-content">{k.content}</p>
                <div class="row">
                  <small>{new Date(k.createdAt).toLocaleDateString()}</small>
                  <button
                    class="danger"
                    onclick={() => deleteMemory(k.id)}
                    aria-label={`Delete keepsake: ${k.content}`}
                  >delete</button>
                </div>
              </li>
            {/each}
          </ul>
        {/if}

        <h3>Memories</h3>
        <p class="hint">
          Memories live in your local SQLite database. They are private until you export or share them.
        </p>
        <div class="actions">
          <button onclick={() => exportMemories("md")}>Export Markdown</button>
          <button onclick={() => exportMemories("json")}>Export JSON</button>
          {#if exportPath}
            <span class="status">→ {exportPath}</span>
          {/if}
        </div>
        {#if plainMemories.length === 0}
          <p class="hint">No durable memories yet — chat with Mochi to seed them.</p>
        {:else}
          <ul class="memory-list">
            {#each plainMemories as m (m.id)}
              <li>
                <div>
                  <span class="tag">{m.type}</span>
                  <span class="meta">imp {m.importance} · conf {(m.confidence * 100).toFixed(0)}%</span>
                </div>
                <p>{m.content}</p>
                <div class="row">
                  <small>{new Date(m.createdAt).toLocaleString()}</small>
                  <button class="danger" onclick={() => deleteMemory(m.id)}>delete</button>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/if}

    {#if activeTab === "sandbox"}
      <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
      <section id="panel-sandbox" role="tabpanel" aria-labelledby="tab-sandbox">
        <p class="hint">
          Drop <code>.txt</code>, <code>.md</code>, or <code>.json</code> files into the inbox to share with Mochi.
          Mochi only reads files you explicitly approve below.
        </p>
        <div class="actions">
          <button onclick={refreshInbox}>Refresh inbox</button>
          <button onclick={runReportNow} disabled={runningReport}>
            {runningReport ? "Writing report…" : "Run status report now"}
          </button>
        </div>
        {#if inbox.length === 0}
          <p class="hint">Inbox is empty.</p>
        {:else}
          <ul class="inbox-list">
            {#each inbox as f (f.name)}
              <li>
                <div>
                  <strong>{f.name}</strong>
                  <small>{(f.sizeBytes / 1024).toFixed(1)} KB · {f.modified ?? ""}</small>
                </div>
                <button onclick={() => approveFile(f.name)}>Approve & summarize</button>
              </li>
            {/each}
          </ul>
        {/if}
        {#if approvedSummary}
          <div class="approved-summary" role="status" aria-live="polite">
            <div class="row">
              <strong>Summary — {approvedSummary.name}</strong>
              <button onclick={() => (approvedSummary = null)} aria-label="Dismiss summary">×</button>
            </div>
            <p>{approvedSummary.text}</p>
          </div>
        {/if}
        <h3>Recent status reports</h3>
        <p class="hint">
          Mochi writes one of these roughly every 12 hours during an idle
          window — see PRD §9.8. Files land under your pet home folder's
          <code>dreams/</code> directory.
        </p>
        {#if recentReports.length === 0}
          <p class="hint">
            No reports yet. They appear after Mochi has been around for at
            least 12 hours and finds an idle moment, or you can use the
            button above to trigger one now.
          </p>
        {:else}
          <ul class="report-list">
            {#each recentReports as r (r.id)}
              <li>
                <div class="row">
                  <strong>{new Date(r.createdAt).toLocaleString()}</strong>
                  <small>{formatWindow(r.windowStart, r.windowEnd)}</small>
                </div>
                {#if r.prose}
                  <p class="prose">{r.prose}</p>
                {/if}
                <ul class="triple">
                  {#if r.learned}<li><b>learned:</b> {r.learned}</li>{/if}
                  {#if r.noticed}<li><b>noticed:</b> {r.noticed}</li>{/if}
                  {#if r.wants}<li><b>wants:</b> {r.wants}</li>{/if}
                </ul>
                {#if r.filePath}
                  <small class="meta">→ {r.filePath}</small>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/if}

    {#if activeTab === "developer"}
      <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
      <section id="panel-developer" role="tabpanel" aria-labelledby="tab-developer">
        {#if !settings.developerEventLog}
          <p class="hint">
            The developer event log is disabled. Enable “Developer event log” in
            the General tab to inspect recent events.
          </p>
        {:else}
          <p class="hint">Internal event log — last 50 events. Refresh on demand.</p>
          <div class="actions">
            <button onclick={refreshEvents}>Refresh</button>
          </div>
          {#if events.length === 0}
            <p class="hint">No events logged.</p>
          {:else}
            <div class="event-log-scroll">
              <table>
                <thead>
                  <tr>
                    <th>time</th>
                    <th>type</th>
                    <th>salience</th>
                    <th>payload</th>
                  </tr>
                </thead>
                <tbody>
                  {#each events as e (e.id)}
                    <tr>
                      <td>{new Date(e.createdAt).toLocaleTimeString()}</td>
                      <td>{e.eventType}</td>
                      <td>{e.salience ?? "-"}</td>
                      <td title={e.payloadJson ?? ""}>{payloadPreview(e.payloadJson)}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        {/if}
      </section>
    {/if}
  {/if}
</main>

<style>
  .settings {
    padding: 16px 20px;
    max-width: 720px;
    margin: 0 auto;
    color: var(--mochi-text);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }
  h1 {
    margin: 0;
    font-size: 20px;
  }
  nav {
    display: flex;
    gap: 4px;
  }
  nav button {
    background: transparent;
    color: var(--mochi-text);
    padding: 4px 10px;
    border-radius: 8px;
  }
  nav button.active {
    background: var(--mochi-pink);
  }
  section {
    background: white;
    border-radius: 14px;
    padding: 16px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.05);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  fieldset {
    border: 1px dashed #e7d1da;
    border-radius: 10px;
    padding: 8px 12px;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  legend {
    padding: 0 6px;
    font-size: 12px;
    color: #6a5a6a;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: #4a3a4a;
  }
  label.row {
    flex-direction: row;
    align-items: center;
    gap: 8px;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
  }
  .status {
    font-size: 11px;
    color: #6a5a6a;
  }
  .hint {
    font-size: 12px;
    color: #6a5a6a;
  }
  .warn {
    background: #fff4d4;
    color: #6b4f00;
    padding: 10px 12px;
    border-radius: 10px;
  }
  .memory-list,
  .inbox-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 320px;
    overflow-y: auto;
  }
  .keepsake-shelf {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 8px;
    max-height: 200px;
    overflow-y: auto;
  }
  .keepsake-shelf li {
    background: linear-gradient(180deg, #fff4e8, var(--mochi-cream));
    border: 1px dashed #ecd7c2;
    border-radius: 10px;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .keepsake-content {
    margin: 0;
    font-size: 12px;
  }
  h3 {
    margin: 6px 0 0;
    font-size: 14px;
  }
  .memory-list li,
  .inbox-list li {
    background: var(--mochi-cream);
    border-radius: 10px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .inbox-list li {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }
  .tag {
    background: var(--mochi-pink);
    border-radius: 999px;
    padding: 2px 8px;
    font-size: 11px;
    margin-right: 6px;
  }
  .meta {
    font-size: 11px;
    color: #7a6a7a;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }
  .danger {
    background: #f7d2d2;
    color: #6e2222;
    font-size: 11px;
    padding: 2px 10px;
  }
  table {
    width: 100%;
    font-size: 11px;
    border-collapse: collapse;
  }
  table th,
  table td {
    text-align: left;
    padding: 4px 6px;
    border-bottom: 1px solid #f1e1e8;
    vertical-align: top;
    word-break: break-word;
  }
  .event-log-scroll {
    max-height: 320px;
    overflow-y: auto;
  }
  .approved-summary {
    background: var(--mochi-cream);
    border-radius: 10px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .approved-summary p {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .report-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-height: 420px;
    overflow-y: auto;
  }
  .report-list li {
    background: var(--mochi-cream);
    border-radius: 10px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .report-list .prose {
    margin: 0;
    font-size: 12px;
    line-height: 1.5;
    color: #4a3a4a;
    white-space: pre-wrap;
  }
  .report-list .triple {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 12px;
    color: #4a3a4a;
  }
  .report-list .meta {
    font-size: 11px;
    color: #7a6a7a;
  }
</style>
