<script>

    export let LatestVersion = "Unknown";
    export let CurrentVersion = "Unknown";
    export let Strictness = "Error";
    
    const checkSkinCompatibility = (version1, version2) => {
        const regex = /^\d+\.\d+\.\d+\.\d+$/; // Match versions in the form <main>.<major>.<minor>.<patch>

        if (!regex.test(version1) || !regex.test(version2)) {
            return false;
        }

        const [main1, major1, minor1] = version1.split('.').map(Number);
        const [main2, major2, minor2] = version2.split('.').map(Number);

        return main1 === main2 && major1 === major2 && minor1 === minor2;
    }

    </script>

    {#if checkSkinCompatibility(CurrentVersion, LatestVersion)}
        <p class="badge bg-green-100 text-green-800">{LatestVersion}</p>
    {:else}
        {#if Strictness === "Error"}
            <!-- Error -->
            <p class="badge bg-red-100 text-red-800" title="Not compatible with the current OpenTaiko version">{LatestVersion}</p>
        {:else}
            <!-- Warning -->
            <p class="badge bg-yellow-100 text-yellow-800" title="Might be outdated, use with caution">{LatestVersion}</p>
        {/if}
    {/if}
    
    <style>

    </style>