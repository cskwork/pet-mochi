<script lang="ts">
  import { onMount } from "svelte";
  import {
    api,
    type Settings,
    type Memory,
    type InboxFile,
    type EventLogEntry,
    type DailyReflection,
  } from "../bridge/api";

  let settings = $state<Settings | null>(null);
  let memories = $state<Memory[]>([]);
  let inbox = $state<InboxFile[]>([]);
  let events = $state<EventLogEntry[]>([]);
  let lastReflection = $state<DailyReflection | null>(null);
  let savingMessage = $state("");
  let exportPath = $state<string | null>(null);
  let activeTab = $state<"general" | "memory" | "sandbox" | "developer">("general");
  let loadError = $state<string | null>(null);
  let actionError = $state<string | null>(null);
  let pendingApiKey = $state("");

  function showError(prefix: string, e: unknown) {
    const msg = (e as Error)?.message ?? String(e);
    actionError = `${prefix}: ${msg}`;
    setTimeout(() => (actionError = null), 4_000);
  }

  async function load() {
    if (!api.hasBackend) return;
    try {
      const [s, m, ix, ev, lr] = await Promise.all([
        api.getSettings(),
        api.listMemories(200),
        api.listInboxFiles(),
        api.getEventLog(100),
        api.getLastReflection(),
      ]);
      settings = s;
      memories = m;
      inbox = ix;
      events = ev;
      lastReflection = lr;
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
      alert(`Mochi summarized:\n\n${summary}`);
      inbox = await api.listInboxFiles();
    } catch (e) {
      showError("approve file", e);
    }
  }

  async function runReflection() {
    try {
      lastReflection = await api.runDailyReflection();
    } catch (e) {
      showError("reflection", e);
    }
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
      events = await api.getEventLog(100);
    } catch (e) {
      showError("event log", e);
    }
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
    <p>Loading…</p>
  {:else}
    {#if actionError}
      <p class="warn">{actionError}</p>
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
          <input bind:value={settings.ollamaModel} placeholder="llama3.2" />
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
            max="2"
            step="0.1"
            bind:value={settings.animationIntensity}
          />
          <span>{settings.animationIntensity.toFixed(1)}×</span>
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
          <span class="status">{savingMessage}</span>
        </div>
      </section>
    {/if}

    {#if activeTab === "memory"}
      <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
      <section id="panel-memory" role="tabpanel" aria-labelledby="tab-memory">
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
        {#if memories.length === 0}
          <p class="hint">No durable memories yet — chat with Mochi to seed them.</p>
        {:else}
          <ul class="memory-list">
            {#each memories as m (m.id)}
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
          <button onclick={runReflection}>Run daily reflection</button>
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
        {#if lastReflection}
          <h3>Last dream — {lastReflection.reflectionDate}</h3>
          <ul>
            <li><b>learned:</b> {lastReflection.learned}</li>
            <li><b>noticed:</b> {lastReflection.noticed}</li>
            <li><b>wants:</b> {lastReflection.wants}</li>
          </ul>
        {/if}
      </section>
    {/if}

    {#if activeTab === "developer"}
      <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
      <section id="panel-developer" role="tabpanel" aria-labelledby="tab-developer">
        <p class="hint">Internal event log — last 100 events.</p>
        <button onclick={refreshEvents}>Refresh</button>
        <table>
          <thead>
            <tr><th>time</th><th>type</th><th>salience</th></tr>
          </thead>
          <tbody>
            {#each events as e (e.id)}
              <tr>
                <td>{new Date(e.createdAt).toLocaleTimeString()}</td>
                <td>{e.eventType}</td>
                <td>{e.salience ?? "-"}</td>
              </tr>
            {/each}
          </tbody>
        </table>
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
  }
</style>
