<script>
    import "../app.css";
    import "../lite-yt-embed.css";
    import "../lite-yt-embed.js";

    import { onMount, setContext } from 'svelte';
    import { autoModeWatcher, getToastStore } from '@skeletonlabs/skeleton';
    import { initializeStores, Toast } from '@skeletonlabs/skeleton';
    import { download } from "@tauri-apps/plugin-upload";
    import { type } from '@tauri-apps/plugin-os';
    import { readTextFile } from '@tauri-apps/plugin-fs';
    import { path } from '@tauri-apps/api';

    import { setupI18n } from '$lib/i18n/index.js';
    import { _, isLoading, locale } from 'svelte-i18n';
    import { get } from 'svelte/store';

    import { GetPreferencesPath } from '$lib/utils/path.js';

    setupI18n();

    initializeStores();

    const toastStore = getToastStore();

    const TriggerError = (msg) => {
        console.error(msg);
        const t = {
            message: msg,
            timeout: 4000,
            background: 'variant-filled-error',
        };
        toastStore.trigger(t);
    };

    const TriggerWarning = (msg) => {
        console.warn(msg);
        const t = {
            message: msg,
            timeout: 4000,
            background: 'variant-filled-warning',
        };
        toastStore.trigger(t);
    };

    const TriggerSuccess = (msg) => {
        console.log(msg);
        const t = {
            message: msg,
            timeout: 4000,
            background: 'variant-filled-success',
        };
        toastStore.trigger(t);
    };

    const wait = (ms) => {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    const backoffDownload = async (url, path, prfunc, n = 10, t = 1000) => {
        for (let attempt = 1; attempt <= n; attempt++) {
            try {
                await download(url, path, prfunc);
                return true;
            }
            catch (error) {
                if (attempt === n) {
                    TriggerError(get(_)('dl.error.failed_abort'));
                    return false;
                }
                TriggerWarning(get(_)('dl.warn.failed_retry', { values: { attempt, max: n } }));

                await wait(t);
            }
        }
    }

    const GetOS = async () => {
        const currentPlatform = await type();
        switch (currentPlatform) {
            case "linux":
                return "Linux";
            case "windows":
                return "Win";
            case "macos":
                return "Mac";
            case "ios":
            case "android":
            default:
                return "Unsupported";
        }
    }

    setContext('toast', { TriggerError, TriggerWarning, TriggerSuccess, backoffDownload, wait, GetOS });

    onMount(async () => {
        autoModeWatcher();

        // Restore persisted locale
        try {
            const prefsDir = await GetPreferencesPath();
            const langFilePath = await path.join(prefsDir, 'language.json');
            const langFile = await readTextFile(langFilePath);
            const { locale: savedLocale } = JSON.parse(langFile);
            if (savedLocale) locale.set(savedLocale);
        } catch {
            // First launch or missing file — getLocaleFromNavigator() already applied
        }
    })
</script>

<Toast />
{#if !$isLoading}
<slot></slot>
{/if}
