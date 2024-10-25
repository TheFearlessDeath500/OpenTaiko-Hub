<script>
    // Dependencies
    import { onMount } from 'svelte';
    import { TabGroup, Tab } from '@skeletonlabs/skeleton';
    import { fetch } from "@tauri-apps/plugin-http";
    import { marked } from 'marked';

    let currentInfo = 0;

    // Information
    const changelogUrl = 'https://raw.githubusercontent.com/0auBSQ/OpenTaiko/main/CHANGELOG.md';
    let changelogContent = '';
    const hubChangelogUrl = 'https://raw.githubusercontent.com/OpenTaiko/OpenTaiko-Hub/main/CHANGELOG.md';
    let hubChangelogContent = '';

    const renderer = new marked.Renderer();
    renderer.link = function(href, title, text) {
        let link = marked.Renderer.prototype.link.call(this, href, title, text);
        return link.replace("<a","<a target='_blank' class='text-blue-600 underline'");
    };
    marked.setOptions({
        renderer: renderer
    })

    const updateChangeLogs = async () => {
        try {
            const response = await fetch(changelogUrl);
        if (response.ok) {
            const text = await response.text();
            changelogContent = marked(text);
        } else {
            changelogContent = '<p>Failed to load changelog.</p>';
        }
        } catch (error) {
            changelogContent = `<p>Error: ${error.message}</p>`;
        }
    }

    const updateHubChangeLogs = async () => {
        try {
            const response = await fetch(hubChangelogUrl);
        if (response.ok) {
            const text = await response.text();
            hubChangelogContent = marked(text);
        } else {
            hubChangelogContent = '<p>Failed to load changelog.</p>';
        }
        } catch (error) {
            hubChangelogContent = `<p>Error: ${error.message}</p>`;
        }
    }

    onMount(async () => {
        updateChangeLogs();
        updateHubChangeLogs();
    });

</script>

<TabGroup 
	justify="justify-center"
	active="variant-filled-primary"
	hover="hover:variant-soft-primary"
	flex="flex-1 lg:flex-none"
	rounded=""
	border=""
	class="bg-surface-100-800-token w-full"
	>
	<Tab bind:group={currentInfo} name="tab1" value={0}>
		<svelte:fragment slot="lead"><i class="fa-regular fa-file-lines"></i></svelte:fragment>
		<span>Changelogs (Game)</span>
	</Tab>
	<Tab bind:group={currentInfo} name="tab2" value={1}>
		<svelte:fragment slot="lead"><i class="fa-regular fa-file-lines"></i></svelte:fragment>
		<span>Changelogs (Hub)</span>
	</Tab>
	<Tab bind:group={currentInfo} name="tab3" value={2}>
		<svelte:fragment slot="lead"><i class="fa-regular fa-file-lines"></i></svelte:fragment>
		<span>Documentation</span>
	</Tab>
	<Tab bind:group={currentInfo} name="tab4" value={3}>
		<svelte:fragment slot="lead"><i class="fa-regular fa-file-lines"></i></svelte:fragment>
		<span>Troubleshooting</span>
	</Tab>
	<Tab bind:group={currentInfo} name="tab5" value={4}>
		<svelte:fragment slot="lead"><i class="fa-regular fa-file-lines"></i></svelte:fragment>
		<span>Credits</span>
	</Tab>
	<!-- ... -->
</TabGroup>
<!-- OpenTaiko Changelogs -->
{#if currentInfo === 0}
    {@html changelogContent}
{/if}
<!-- OpenTaiko Hub Changelogs -->
{#if currentInfo === 1}
    {@html hubChangelogContent}
{/if}
<!-- Documentation -->
{#if currentInfo === 2}
    <iframe src="https://opentaiko.github.io/OpTk-Documentation/" title="OpenTaiko Documentation" width="100%"  style="background-color:white;height:calc(100% - 85px)"></iframe>
{/if}

<style>


</style>