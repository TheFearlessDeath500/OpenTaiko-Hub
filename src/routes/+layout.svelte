<script>
    import "../app.css";
    import "../lite-yt-embed.css";
    import "../lite-yt-embed.js";
    
    import { onMount } from 'svelte';
    import { autoModeWatcher } from '@skeletonlabs/skeleton';
    import { initializeStores, Toast } from '@skeletonlabs/skeleton';

    initializeStores();

    onMount(() => {										
        autoModeWatcher();
    })
</script>

<Toast />
<slot></slot>
