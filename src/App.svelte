<script lang="ts">
  import { onMount } from "svelte";
  import Pet from "./lib/components/Pet.svelte";
  import Settings from "./lib/components/Settings.svelte";

  // Cheap routing — settings window opens with #/settings.
  // Reactive so route updates if the hash changes at runtime.
  function currentRoute(): string {
    return window.location.hash.replace(/^#/, "") || "/";
  }

  let route = $state(currentRoute());
  const isSettings = $derived(route.startsWith("/settings"));

  onMount(() => {
    const onHashChange = () => {
      route = currentRoute();
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  });
</script>

{#if isSettings}
  <Settings />
{:else}
  <Pet />
{/if}
