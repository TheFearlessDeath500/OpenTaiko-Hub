<script>
    import { onMount } from 'svelte';
    import { AppRail, AppRailTile, AppRailAnchor, ProgressBar, TabGroup, TabAnchor, Tab } from '@skeletonlabs/skeleton';
    import { getToastStore } from '@skeletonlabs/skeleton';
    import { readFile, readTextFile, BaseDirectory, writeFile, writeTextFile, mkdir, readDir, exists, copyFile, remove } from '@tauri-apps/plugin-fs';
    import { resourceDir, cacheDir, join } from '@tauri-apps/api/path';
    import { fetch } from "@tauri-apps/plugin-http";
    import { download } from "@tauri-apps/plugin-upload";
    import JSZip from 'jszip';
    import { md5 } from 'js-md5';

    import optkLogoUrl from '$lib/optk.png';


    // Tools
    import ToolCard from '$lib/components/ToolCard.svelte';
    import peepoScreenshotUrl from '$lib/peepo.png';
    import arrowScreenshotUrl from '$lib/arrow.png';
    import tjatoolsScreenshotUrl from '$lib/tjatools.png';

    // Song management
    import AudioPlayer from '$lib/components/AudioPlayer.svelte';
    import SongDifficultyChip from '$lib/components/SongDifficultyChip.svelte';

    // Skin management
    import AssetStatusCell from '$lib/components/AssetStatusCell.svelte';
    import VersionNumberChip from '$lib/components/VersionNumberChip.svelte';

    import { path } from '@tauri-apps/api';
    import { invoke } from '@tauri-apps/api/core';
    import { listen } from '@tauri-apps/api/event';

    import { marked } from 'marked';
    
    const toastStore = getToastStore();

    // Navigation
    let currentTile = 0;
    let currentTool = 0;
    let currentInfo = 0;
    let currentAsset = 0;

    // OpTk Version
    const repoOwner = '0AuBSQ';//'OpenTaiko'; 
    const repoName = 'OpenTaiko';//OpenTaiko-Dev-Mirror'; 
    let optk_version = '0.1.0.0';
    let optk_OS = 'Win';
    let buildDetails = 'Loading...';
    let latestVersion = 'Loading...';
    let buildDetailsNotFound = false;
    let latestVersionErrorFound = false;
    let updatePossible = false;
    let progress = 0;
    let downloadBusy = false;

    // Information
    const changelogUrl = 'https://raw.githubusercontent.com/0auBSQ/OpenTaiko/main/CHANGELOG.md';
    let changelogContent = '';
    const hubChangelogUrl = 'https://raw.githubusercontent.com/OpenTaiko/OpenTaiko-Hub/main/CHANGELOG.md';
    let hubChangelogContent = '';

    // Soundtrack
    const soundtrackInfoUrl = 'https://raw.githubusercontent.com/OpenTaiko/OpenTaiko-Soundtrack/main/soundtrack_info.json';
    let soundtrackInfo = [];
    let currentSongs = {};
    let scanning = false;
    let searchSong = "";
    let searchGenre = "";
    let songPreviousSort = "none";
    let songDLProgress = {};
    let songCountProgress = 0;
    let songCountProgressBar = null;

    // Skins
    const assetsInfoUrl = 'https://raw.githubusercontent.com/OpenTaiko/OpenTaiko-Skins/main/assets_info.json';
    let assetsInfo = {
        "Skins":[],
        "Characters":[],
        "Puchicharas":[]
    };
    let currentAssets = {
        "Skins":{},
        "Characters":{},
        "Puchicharas":{}
    };
    let assetScanning = false;
    let assetDLProgress = {
        "Skins":{},
        "Characters":{},
        "Puchicharas":{}
    };
    let assetCountProgress = {
        "Skins":0,
        "Characters":0,
        "Puchicharas":0
    };
    let assetCountProgressBar = {
        "Skins":null,
        "Characters":null,
        "Puchicharas":null
    };;

    const renderer = new marked.Renderer();
    renderer.link = function(href, title, text) {
        let link = marked.Renderer.prototype.link.call(this, href, title, text);
        return link.replace("<a","<a target='_blank' class='text-blue-600 underline'");
    };
    marked.setOptions({
        renderer: renderer
    })

    const TriggerError = (msg) => {
        console.error(msg);
        const t = {
            message: msg,
            timeout: 4000,
            background: 'variant-filled-error'
        };
        toastStore.trigger(t);
    }

    const TriggerWarning = (msg) => {
        console.warn(msg);
        const t = {
            message: msg,
            timeout: 4000,
            background: 'variant-filled-warning'
        };
        toastStore.trigger(t);
    }

    const TriggerSuccess = (msg) => {
        console.log(msg);
        const t = {
            message: msg,
            timeout: 4000,
            background: 'variant-filled-success'
        };
        toastStore.trigger(t);
    }

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
                    TriggerError(`Download failed, aborting`);
                    return false; 
                }
                TriggerWarning(`Download failed, retrying... (${attempt}/${n})`);

                await wait(t);
            }
        }
    }

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

    const updateSoundtrackInfo = async () => {
        try {
            const response = await fetch(soundtrackInfoUrl);
        if (response.ok) {
            const text = await response.text();
            soundtrackInfo = JSON.parse(text);
        } else {
            soundtrackInfo = {};
        }
        } catch (error) {
            soundtrackInfo = {};
        }
    }

    const updateAssetsInfo = async () => {
        try {
            const response = await fetch(assetsInfoUrl);
        if (response.ok) {
            const text = await response.text();
            assetsInfo = JSON.parse(text);
        } else {
            assetsInfo = {
                "Skins":[],
                "Characters":[],
                "Puchicharas":[]
            };
        }
        } catch (error) {
            assetsInfo = {
                "Skins":[],
                "Characters":[],
                "Puchicharas":[]
            };
        }
    }

    const crawlAssets = async () => {
        assetScanning = true;
        await crawlAsset("./OpenTaiko/System", "Skins");
        await crawlAsset("./OpenTaiko/Global/Characters", "Characters");
        await crawlAsset("./OpenTaiko/Global/PuchiChara", "Puchicharas");

        console.log(currentAssets);
        assetScanning = false;
    }

    const crawlAsset = async (baseDir, assetType) => {
        const res = await resourceDir();
        const targetFile = {
            "Skins": "SkinConfig.ini",
            "Characters": "CharaConfig.txt",
            "Puchicharas": "PuchiConfig.txt"
        }[assetType];
        
        async function folderExists(folderPath) {
            try {
                const fullPath = await path.join(res, folderPath);
                const entries = await readDir(fullPath);
                return true;
            } catch (error) {
                // Directory does not exist
                console.log(error)
                return false;
            }
        }

        async function processFolder(folderPath) {
            try {
                const fullPath = await path.join(res, folderPath);
                const entries = await readDir(fullPath, { recursive: true });

                for (const entry of entries) {
                    if (entry.isDirectory) {
                        // If it's a folder, process it recursively
                        await processFolder([folderPath, entry.name].join("/"));
                    } else if (entry.name === targetFile) {
                        
                        const configPath = [folderPath, entry.name].join("/");
                        const relativePath = folderPath.replace(`${baseDir}/`, '');

                        const configFullPath = await path.join(res, configPath);
                        const configData = await readTextFile(configFullPath);
                        const _extract = configData.match(/^[^=]*\b\w*Version\b\s*=\s*(.+)$/m)?.[1];
                        const _version = (_extract === undefined) ? "Unknown" : _extract;

                        currentAssets[assetType][relativePath] = {
                            assetFolderName: relativePath,
                            assetVersion: _version
                        };
                    }
                }
            } catch (error) {
                console.error(`Error processing folder ${folderPath}:`, error);
            }
        }

        try {
            // Check if base directory exists
            if (await folderExists(baseDir)) {
                // Start the process with the base directory
                await processFolder(baseDir);
            } else {
                console.warn(`The directory "${baseDir}" does not exist.`);
            }
        } catch (error) {
            console.error(`Error scanning assets:`, error);
        }
    }

    
    const crawlSongs = async () => {
        const res = await resourceDir();
        const baseDir = './OpenTaiko/Songs';
        scanning = true;
        
        async function folderExists(folderPath) {
            try {
                const fullPath = await path.join(res, folderPath);
                const entries = await readDir(fullPath);
                return true;
            } catch (error) {
                // Directory does not exist
                console.log(error)
                return false;
            }
        }

        async function processFolder(folderPath) {
            try {
                const fullPath = await path.join(res, folderPath);
                const entries = await readDir(fullPath, { recursive: true });

                for (const entry of entries) {
                    //console.log(entry)
                    if (entry.isDirectory) {
                        // If it's a folder, process it recursively
                        await processFolder([folderPath, entry.name].join("/"));
                    } else if (entry.name.endsWith('.tja')) {
                        // If it's a .tja file, process it
                        const tjaPath = [folderPath, entry.name].join("/");
                        //const folderPath = tjaPath.substring(0, tjaPath.lastIndexOf('/'));
                        const relativePath = folderPath.replace(`${baseDir}/`, '');

                        // Read the uniqueID.json file in the same folder
                        const uniqueIdFile = `${folderPath}/uniqueID.json`;
                        try {
                            let re = /[\0-\x1F\x7F-\x9F\xAD\u0378\u0379\u037F-\u0383\u038B\u038D\u03A2\u0528-\u0530\u0557\u0558\u0560\u0588\u058B-\u058E\u0590\u05C8-\u05CF\u05EB-\u05EF\u05F5-\u0605\u061C\u061D\u06DD\u070E\u070F\u074B\u074C\u07B2-\u07BF\u07FB-\u07FF\u082E\u082F\u083F\u085C\u085D\u085F-\u089F\u08A1\u08AD-\u08E3\u08FF\u0978\u0980\u0984\u098D\u098E\u0991\u0992\u09A9\u09B1\u09B3-\u09B5\u09BA\u09BB\u09C5\u09C6\u09C9\u09CA\u09CF-\u09D6\u09D8-\u09DB\u09DE\u09E4\u09E5\u09FC-\u0A00\u0A04\u0A0B-\u0A0E\u0A11\u0A12\u0A29\u0A31\u0A34\u0A37\u0A3A\u0A3B\u0A3D\u0A43-\u0A46\u0A49\u0A4A\u0A4E-\u0A50\u0A52-\u0A58\u0A5D\u0A5F-\u0A65\u0A76-\u0A80\u0A84\u0A8E\u0A92\u0AA9\u0AB1\u0AB4\u0ABA\u0ABB\u0AC6\u0ACA\u0ACE\u0ACF\u0AD1-\u0ADF\u0AE4\u0AE5\u0AF2-\u0B00\u0B04\u0B0D\u0B0E\u0B11\u0B12\u0B29\u0B31\u0B34\u0B3A\u0B3B\u0B45\u0B46\u0B49\u0B4A\u0B4E-\u0B55\u0B58-\u0B5B\u0B5E\u0B64\u0B65\u0B78-\u0B81\u0B84\u0B8B-\u0B8D\u0B91\u0B96-\u0B98\u0B9B\u0B9D\u0BA0-\u0BA2\u0BA5-\u0BA7\u0BAB-\u0BAD\u0BBA-\u0BBD\u0BC3-\u0BC5\u0BC9\u0BCE\u0BCF\u0BD1-\u0BD6\u0BD8-\u0BE5\u0BFB-\u0C00\u0C04\u0C0D\u0C11\u0C29\u0C34\u0C3A-\u0C3C\u0C45\u0C49\u0C4E-\u0C54\u0C57\u0C5A-\u0C5F\u0C64\u0C65\u0C70-\u0C77\u0C80\u0C81\u0C84\u0C8D\u0C91\u0CA9\u0CB4\u0CBA\u0CBB\u0CC5\u0CC9\u0CCE-\u0CD4\u0CD7-\u0CDD\u0CDF\u0CE4\u0CE5\u0CF0\u0CF3-\u0D01\u0D04\u0D0D\u0D11\u0D3B\u0D3C\u0D45\u0D49\u0D4F-\u0D56\u0D58-\u0D5F\u0D64\u0D65\u0D76-\u0D78\u0D80\u0D81\u0D84\u0D97-\u0D99\u0DB2\u0DBC\u0DBE\u0DBF\u0DC7-\u0DC9\u0DCB-\u0DCE\u0DD5\u0DD7\u0DE0-\u0DF1\u0DF5-\u0E00\u0E3B-\u0E3E\u0E5C-\u0E80\u0E83\u0E85\u0E86\u0E89\u0E8B\u0E8C\u0E8E-\u0E93\u0E98\u0EA0\u0EA4\u0EA6\u0EA8\u0EA9\u0EAC\u0EBA\u0EBE\u0EBF\u0EC5\u0EC7\u0ECE\u0ECF\u0EDA\u0EDB\u0EE0-\u0EFF\u0F48\u0F6D-\u0F70\u0F98\u0FBD\u0FCD\u0FDB-\u0FFF\u10C6\u10C8-\u10CC\u10CE\u10CF\u1249\u124E\u124F\u1257\u1259\u125E\u125F\u1289\u128E\u128F\u12B1\u12B6\u12B7\u12BF\u12C1\u12C6\u12C7\u12D7\u1311\u1316\u1317\u135B\u135C\u137D-\u137F\u139A-\u139F\u13F5-\u13FF\u169D-\u169F\u16F1-\u16FF\u170D\u1715-\u171F\u1737-\u173F\u1754-\u175F\u176D\u1771\u1774-\u177F\u17DE\u17DF\u17EA-\u17EF\u17FA-\u17FF\u180F\u181A-\u181F\u1878-\u187F\u18AB-\u18AF\u18F6-\u18FF\u191D-\u191F\u192C-\u192F\u193C-\u193F\u1941-\u1943\u196E\u196F\u1975-\u197F\u19AC-\u19AF\u19CA-\u19CF\u19DB-\u19DD\u1A1C\u1A1D\u1A5F\u1A7D\u1A7E\u1A8A-\u1A8F\u1A9A-\u1A9F\u1AAE-\u1AFF\u1B4C-\u1B4F\u1B7D-\u1B7F\u1BF4-\u1BFB\u1C38-\u1C3A\u1C4A-\u1C4C\u1C80-\u1CBF\u1CC8-\u1CCF\u1CF7-\u1CFF\u1DE7-\u1DFB\u1F16\u1F17\u1F1E\u1F1F\u1F46\u1F47\u1F4E\u1F4F\u1F58\u1F5A\u1F5C\u1F5E\u1F7E\u1F7F\u1FB5\u1FC5\u1FD4\u1FD5\u1FDC\u1FF0\u1FF1\u1FF5\u1FFF\u200B-\u200F\u202A-\u202E\u2060-\u206F\u2072\u2073\u208F\u209D-\u209F\u20BB-\u20CF\u20F1-\u20FF\u218A-\u218F\u23F4-\u23FF\u2427-\u243F\u244B-\u245F\u2700\u2B4D-\u2B4F\u2B5A-\u2BFF\u2C2F\u2C5F\u2CF4-\u2CF8\u2D26\u2D28-\u2D2C\u2D2E\u2D2F\u2D68-\u2D6E\u2D71-\u2D7E\u2D97-\u2D9F\u2DA7\u2DAF\u2DB7\u2DBF\u2DC7\u2DCF\u2DD7\u2DDF\u2E3C-\u2E7F\u2E9A\u2EF4-\u2EFF\u2FD6-\u2FEF\u2FFC-\u2FFF\u3040\u3097\u3098\u3100-\u3104\u312E-\u3130\u318F\u31BB-\u31BF\u31E4-\u31EF\u321F\u32FF\u4DB6-\u4DBF\u9FCD-\u9FFF\uA48D-\uA48F\uA4C7-\uA4CF\uA62C-\uA63F\uA698-\uA69E\uA6F8-\uA6FF\uA78F\uA794-\uA79F\uA7AB-\uA7F7\uA82C-\uA82F\uA83A-\uA83F\uA878-\uA87F\uA8C5-\uA8CD\uA8DA-\uA8DF\uA8FC-\uA8FF\uA954-\uA95E\uA97D-\uA97F\uA9CE\uA9DA-\uA9DD\uA9E0-\uA9FF\uAA37-\uAA3F\uAA4E\uAA4F\uAA5A\uAA5B\uAA7C-\uAA7F\uAAC3-\uAADA\uAAF7-\uAB00\uAB07\uAB08\uAB0F\uAB10\uAB17-\uAB1F\uAB27\uAB2F-\uABBF\uABEE\uABEF\uABFA-\uABFF\uD7A4-\uD7AF\uD7C7-\uD7CA\uD7FC-\uF8FF\uFA6E\uFA6F\uFADA-\uFAFF\uFB07-\uFB12\uFB18-\uFB1C\uFB37\uFB3D\uFB3F\uFB42\uFB45\uFBC2-\uFBD2\uFD40-\uFD4F\uFD90\uFD91\uFDC8-\uFDEF\uFDFE\uFDFF\uFE1A-\uFE1F\uFE27-\uFE2F\uFE53\uFE67\uFE6C-\uFE6F\uFE75\uFEFD-\uFF00\uFFBF-\uFFC1\uFFC8\uFFC9\uFFD0\uFFD1\uFFD8\uFFD9\uFFDD-\uFFDF\uFFE7\uFFEF-\uFFFB\uFFFE\uFFFF]/g;
                            
                            const uidFullPath = await path.join(res, uniqueIdFile);
                            const uniqueIdData = (await readTextFile(uidFullPath)).replace(re, "");
                            const uniqueId = (JSON.parse(uniqueIdData)).id;

                            // Compute the MD5 hash of the .tja file
                            const tjaFullPath = await path.join(res, tjaPath);
                            const tjaContent = await readFile(tjaFullPath);
                            const chartMD5 = md5(tjaContent);

                            // Update the currentSongs object
                            currentSongs[uniqueId] = {
                                chartMD5,
                                chartRelativePath: relativePath
                            };
                        } catch (error) {
                            console.error(`Failed to read uniqueID.json in ${folderPath}:`, error);
                            // Skip this folder if uniqueID.json is not found or there's an error reading it
                        }
                    }
                }
            } catch (error) {
                console.error(`Error processing folder ${folderPath}:`, error);
            }
        }

        try {
            // Check if base directory exists
            if (await folderExists(baseDir)) {
                // Start the process with the base directory
                await processFolder(baseDir);
            } else {
                console.warn(`The directory "${baseDir}" does not exist.`);
            }

            scanning = false;
        } catch (error) {
            console.error(`Error scanning songs:`, error);
            scanning = false;
        }
    }

    const checkSkinCompatibility = (version1, version2) => {
        const regex = /^\d+\.\d+\.\d+\.\d+$/; // Match versions in the form <main>.<major>.<minor>.<patch>

        if (!regex.test(version1) || !regex.test(version2)) {
            return false;
        }

        const [main1, major1, minor1] = version1.split('.').map(Number);
        const [main2, major2, minor2] = version2.split('.').map(Number);

        return main1 === main2 && major1 === major2 && minor1 === minor2;
    }


    const getLatestReleaseUrl = async () => {
        const apiUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/releases/latest`;

        try {
            const response = await fetch(apiUrl);
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.message);
            }

            // Find the desired asset in the release
            const asset = data.assets.find(asset => asset.name.endsWith('Win.x64.zip'));
            if (!asset) {
                throw new Error('Desired asset not found in the latest release');
            }

            return asset.browser_download_url; //browser_download_url;
        } catch (err) {
            TriggerError(`Failed to fetch latest release: ${err}`);
            return null;
        }
    }

    const copyAllFilesRecursive = async (src, dst) => {
        try {
            // Read the files and directories in the source folder
            const files = await readDir(src, { recursive: false });

            for (const file of files) {
                const srcPath = `${src}/${file.name}`;
                const dstPath = `${dst}/${file.name}`;
                if (file.isDirectory) {

                    // It's a directory, create it in the destination
                    await mkdir(dstPath, { recursive: true });

                    // Recursively move files from this directory
                    await copyAllFilesRecursive(srcPath, dstPath);
                } else {
                    // It's a file, move it to the destination
                    await copyFile(srcPath, dstPath);
                    console.log(`Moved: ${file.name}`);
                }
            }

            console.log('All files and directories have been moved successfully.');
        } catch (error) {
            console.error('Error moving files:', error);
        }
    }

    const DownloadOpenTaiko = async () => {
        if (downloadBusy === true) {
            TriggerError(`Currently already downloading`);
            return;
        }

        const url = await getLatestReleaseUrl();
        if (!url) return;

        try {
            progress = 0;
            downloadBusy = true;

            // Download the latest OpenTaiko release
            const res = await resourceDir();
            const base = await path.join(res, "./tmp");
            const dled = await path.join(base, "/OpenTaiko.zip");
            
            const fold_exists = await exists(base);
            if (!fold_exists)
                await mkdir(base);

            let totbyts = 0;
            const success = await backoffDownload(
                url,
                dled,
                (pr) => {
                    totbyts += pr.progress;
                    progress = 100 * (totbyts / pr.total);
                    console.log(progress);
                }
            );

            if (!success) {
                process = undefined;
                downloadBusy = false;
                return ;
            }

            TriggerSuccess('Download complete, now unzipping...');

            // Prepare the optk build folder if doesn't exist
            const optk_folder = await path.join(res, "./OpenTaiko");

            const optkfold_exists = await exists(optk_folder);
            if (!optkfold_exists)
                await mkdir(optk_folder);

            // Unzip and transfer OpenTaiko
            progress = undefined;

            const unlisten = await listen('extract-progress', (event) => {
                progress = event.payload;  // Update progress value
            });

            const folderName = await invoke('unzip_and_get_first_folder', { zipPath: dled });

            unlisten();

            TriggerSuccess('Unzip complete, now installing...');

            // Move unzipped files to OpenTaiko folder
            progress = undefined;

            const source_folder = folderName;
            await copyAllFilesRecursive(source_folder, optk_folder);
            

            // Generate the new version json (temporary? to do on build?)
            const version_file = await path.join(optk_folder, "/version.json");

            const json_ver = {
                version: latestVersion,
                build: "Win" // To change later
            };

            await writeTextFile(version_file, JSON.stringify(json_ver));

            // Clean after pooping
            await remove(dled);
            await remove(source_folder, { recursive: true });

            TriggerSuccess('Download and installation complete');

            
        } catch (err) {
            TriggerError(`Failed to download OpenTaiko: ${err}`)
        }
        await TryFetchingCurrentVersion();
        downloadBusy = false;
    }

    $: GetFilteredSInfo = (SInfo) => {
        const bInNameFilter = SInfo.chartTitle.toLowerCase().includes(searchSong.toLowerCase()) || SInfo.chartSubtitle?.toLowerCase().includes(searchSong.toLowerCase());
        const bInGenreFilter = SInfo.tjaGenreFolder.toLowerCase().includes(searchGenre.toLowerCase());

        return bInGenreFilter && bInNameFilter;
    }

    const GetFilteredAvailableSInfo = (SInfo) => {
        const bNotUpToDate = !(Object.keys(currentSongs).includes(SInfo.uniqueId) && currentSongs[SInfo.uniqueId].chartMD5 === SInfo.tjaMD5);

        return bNotUpToDate && GetFilteredSInfo(SInfo);
    }

    const UndefinedToMinusOne = (val) => {
        return (val === undefined || val === null) ? -1 : val;
    }

    const AlterValueTowerDan = (a, b, og) => {
        const aTD = (a.chartDifficulties.Tower !== undefined || a.chartDifficulties.Dan !== undefined);
        const bTD = (b.chartDifficulties.Tower !== undefined || b.chartDifficulties.Dan !== undefined);
        if (aTD) return 2147483647;
        else if (bTD) return -2147483648;
        return og;
    }

    const SortSongsByColumn = (column) => {
        const wasClickedPreviously = `${column} asc` === songPreviousSort;
        const mult = (wasClickedPreviously) ? -1 : 1;
        songPreviousSort = (wasClickedPreviously) ? `${column} desc` : `${column} asc`;

        switch (column) {
            default:
            case ("name"): 
            {
                soundtrackInfo = soundtrackInfo.sort((a, b) => mult * a.chartTitle.localeCompare(b.chartTitle));
                break;
            }
            case ("genre"): 
            {
                soundtrackInfo = soundtrackInfo.sort((a, b) => mult * a.tjaGenreFolder.localeCompare(b.tjaGenreFolder));
                break;
            }
            case ("size"):
            {
                soundtrackInfo = soundtrackInfo.sort((a, b) => mult * (a.chartSize - b.chartSize));
                break;
            }
            case ("ez"):
            {
                soundtrackInfo = soundtrackInfo.sort((a, b) => AlterValueTowerDan(a, b, mult * (UndefinedToMinusOne(a.chartDifficulties.Easy) - UndefinedToMinusOne(b.chartDifficulties.Easy))));
                break;
            }
            case ("nm"):
            {
                soundtrackInfo = soundtrackInfo.sort((a, b) => AlterValueTowerDan(a, b, mult * (UndefinedToMinusOne(a.chartDifficulties.Normal) - UndefinedToMinusOne(b.chartDifficulties.Normal))));
                break;
            }
            case ("hd"):
            {
                soundtrackInfo = soundtrackInfo.sort((a, b) => AlterValueTowerDan(a, b, mult * (UndefinedToMinusOne(a.chartDifficulties.Hard) - UndefinedToMinusOne(b.chartDifficulties.Hard))));
                break;
            }
            case ("ex"):
            {
                soundtrackInfo = soundtrackInfo.sort((a, b) => AlterValueTowerDan(a, b, mult * (UndefinedToMinusOne(a.chartDifficulties.Oni) - UndefinedToMinusOne(b.chartDifficulties.Oni))));
                break;
            }
            case ("exex"):
            {
                soundtrackInfo = soundtrackInfo.sort((a, b) => AlterValueTowerDan(a, b, mult * (UndefinedToMinusOne(a.chartDifficulties.Edit) - UndefinedToMinusOne(b.chartDifficulties.Edit))));
                break;
            }
        }
    }

    const DownloadDisplayedSongs = async () => {
        if (scanning === true) {
            TriggerError("Cannot download songs while local folders are being scanned");
            return ;
        }

        const filteredSInfo = soundtrackInfo.filter((SInfo) => GetFilteredAvailableSInfo(SInfo));

        const songCount = filteredSInfo.length;

        if (songCount === 0) {
            TriggerSuccess("All songs are already up-to-date");
            return ;
        }

        songCountProgress = 0;
        for (const SInfo of filteredSInfo) {
            songCountProgressBar = 100 * (songCountProgress / songCount);

            console.log(`Downloading song ${songCountProgress + 1} out of ${songCount}...`);
            console.log(SInfo);

            let curObj = null;
            if (Object.keys(currentSongs).includes(SInfo.uniqueId)) curObj = currentSongs[SInfo.uniqueId];

            await DownloadSong(SInfo, curObj, songCountProgress + 1, songCount);
            songCountProgress++;
        }
        songCountProgressBar = null
    }

    const DownloadSong = async (songObj, currentObj, songNb = undefined, songTotal = undefined) => {
        songDLProgress[songObj.uniqueId] = 0;
        //console.log(songDLProgress);

        const res = await resourceDir();
        const baseDir = './OpenTaiko/Songs';
        const baseDirPath = await path.join(res, baseDir);
        const localPath = `${baseDir}/${(currentObj !== null) ? currentObj.chartRelativePath : songObj.tjaFolderPath}`;
        const tjaFullPath = await path.join(res, localPath);

        let fold_exists = await exists(tjaFullPath);
        if (!fold_exists)
            await mkdir(tjaFullPath, {recursive: true});

        const tmpFolder = await path.join(res, "./tmp");
        const uuid = crypto.randomUUID();
        const chartDownloadFolder = await path.join(tmpFolder, `${uuid}\\`);

        fold_exists = await exists(chartDownloadFolder);
        if (!fold_exists)
            await mkdir(chartDownloadFolder, {recursive: true});

        let fileNames = [];

        let totbyts = 0;
        for (const filePath of songObj.tjaFilesPath) {
            const localFileName = filePath.split("\\").pop();
            const tjaFileUrl = `https://raw.githubusercontent.com/OpenTaiko/OpenTaiko-Soundtrack/main/${filePath}`;
            const dlPath = await path.join(chartDownloadFolder, localFileName);

            
            const success = await backoffDownload(
                tjaFileUrl,
                dlPath,
                (pr) => {
                    totbyts += pr.progress;
                    songDLProgress[songObj.uniqueId] = 100 * (totbyts / (songObj.chartSize * 1024 * 1024));
                    //console.log(songDLProgress);
                }
            );

            if (!success) {
                delete songDLProgress[songObj.uniqueId];
                return ;
            }

            fileNames.push(localFileName);
        };

        songDLProgress[songObj.uniqueId] = 0;
        await Promise.all(fileNames.map(async (fn, idx) => {
            const strPath = await path.join(chartDownloadFolder, fn);
            const destPath = await path.join(tjaFullPath, fn);

            await copyFile(strPath, destPath);
            songDLProgress[songObj.uniqueId] = (idx + 1) * (100 / fileNames.length);
            //console.log(songDLProgress);
        }));

        // Download box.def and default.png if missing
        const genrePaths = songObj.tjaFolderPath.split('\\').slice(0, -1).map((_, i, arr) => arr.slice(0, i + 1).join('\\'));

        for (const genrePath of genrePaths) {
            const genreFullPath = await path.join(baseDirPath, genrePath);
            const boxdefPath = await path.join(genreFullPath, "./box.def");
            const preimgPath = await path.join(genreFullPath, "./default.png");

            // Always download the box.def file to be sure it remains up-to-date, not a good implementation but would get the job done for now
            const deffile_exists = false; // await exists(boxdefPath);
            if (!deffile_exists) {
                const localFileName = 'box.def';
                const _url = `https://raw.githubusercontent.com/OpenTaiko/OpenTaiko-Soundtrack/main/${genrePath}/box.def`;
                const dlPath = await path.join(chartDownloadFolder, localFileName);

                const resourceExists = await fetch(_url).then(res => res.ok).catch(() => false);

                if (resourceExists) {
                    await download(_url, dlPath);
                    await copyFile(dlPath, boxdefPath);
                }
            }

            const preimage_exists = await exists(preimgPath);
            if (!preimage_exists) {
                const localFileName = 'default.png';
                const _url = `https://raw.githubusercontent.com/OpenTaiko/OpenTaiko-Soundtrack/main/${genrePath}/default.png`;
                const dlPath = await path.join(chartDownloadFolder, localFileName);

                const resourceExists = await fetch(_url).then(res => res.ok).catch(() => false);

                if (resourceExists) {
                    await download(_url, dlPath);
                    await copyFile(dlPath, preimgPath);
                }
            }
        }

        // Clean after pooping
        await remove(chartDownloadFolder, { recursive: true });

        if (songNb === undefined)
            TriggerSuccess('Download complete');
        else
            TriggerSuccess(`Downloaded song ${songNb} out of ${songTotal}`);

        //crawlSongs();
        currentSongs[songObj.uniqueId] = {
            chartMD5: songObj.tjaMD5,
            chartRelativePath: songObj.tjaFolderPath
        };

        delete songDLProgress[songObj.uniqueId];
        //console.log(songDLProgress);
    }

    const DownloadDisplayedAssets = async (assetType) => {
        if (scanning === true) {
            TriggerError(`Cannot download ${assetType} while local folders are being scanned`);
            return ;
        }

        const assetPrefix = (assetType === "Skins") ? "skin" : "chara";

        const _filter = (a) => {
            const _notdownloaded = !Object.keys(currentAssets[assetType]).includes(a[`${assetPrefix}Folder`]);
            const _outdated = _notdownloaded || currentAssets[assetType][a[`${assetPrefix}Folder`]].assetVersion !== a[`${assetPrefix}Version`];
            return _notdownloaded || _outdated;
        };

        const AInfo = assetsInfo[assetType].filter((a) => _filter(a));

        const assetCount = AInfo.length;

        if (assetCount === 0) {
            TriggerSuccess(`All ${assetType} are already up-to-date`);
            return ;
        }

        assetCountProgress[assetType] = 0;
        for (const Aif of AInfo) {
            const assetRelpath = (assetType === "Skins") ? Aif.skinFolder : Aif.charaFolder;

            assetCountProgressBar[assetType] = 100 * (assetCountProgress[assetType] / assetCount);

            console.log(`Downloading ${assetType} ${assetCountProgress[assetType] + 1} out of ${assetCount}...`);
            console.log(Aif);

            let curObj = null;
            if (Object.keys(currentAssets[assetType]).includes(assetRelpath)) curObj = currentAssets[assetType][assetRelpath];

            await DownloadAsset(Aif, curObj, assetType, assetCountProgress[assetType] + 1, assetCount);
            assetCountProgress[assetType]++;
        }
        assetCountProgressBar[assetType] = null
    }

    const DownloadAsset = async (assetObj, currentObj, assetType, assetNb = undefined, assetTotal = undefined) => {
        const res = await resourceDir();

        const targetFile = {
            "Skins": "SkinConfig.ini",
            "Characters": "CharaConfig.txt",
            "Puchicharas": "PuchiConfig.txt"
        }[assetType];
        const baseDir = {
            "Skins": "./OpenTaiko/System",
            "Characters": "./OpenTaiko/Global/Characters",
            "Puchicharas": "./OpenTaiko/Global/PuchiChara"
        }[assetType];
        const subDir = {
            "Skins": "System",
            "Characters": "Global",
            "Puchicharas": "Global"
        }[assetType];
        const assetRelpath = (assetType === "Skins") ? assetObj.skinFolder : assetObj.charaFolder;
        const assetFpath = (assetType === "Skins") ? assetObj.skinFilesPath : assetObj.charaFilesPath;
        const assetSize = (assetType === "Skins") ? assetObj.skinSize : assetObj.charaSize;
        const assetVersion = (assetType === "Skins") ? assetObj.skinVersion : assetObj.charaVersion;

        assetDLProgress[assetType][assetRelpath] = 0;

        const baseDirPath = await path.join(res, baseDir);
        const localPath = `${baseDir}/${assetRelpath}`;
        const assetFullPath = await path.join(res, localPath);

        let fold_exists = await exists(assetFullPath);
        if (!fold_exists)
            await mkdir(assetFullPath, {recursive: true});

        const tmpFolder = await path.join(res, "./tmp");
        const uuid = crypto.randomUUID();
        const assetDownloadFolder = await path.join(tmpFolder, `${uuid}\\`);

        fold_exists = await exists(assetDownloadFolder);
        if (!fold_exists)
            await mkdir(assetDownloadFolder, {recursive: true});

        let fileNames = [];

        let totbyts = 0;
        for (const filePath of assetFpath) {
            const localFileName = filePath.replace(/^[^\\]+\\/, '');
            const assetFileUrl = `https://raw.githubusercontent.com/OpenTaiko/OpenTaiko-Skins/main/${subDir}/${filePath}`;
            const dlPath = await path.join(assetDownloadFolder, localFileName);
            const fileFold = await path.join(assetDownloadFolder, filePath.split('\\').length > 2 ? filePath.replace(/^[^\\]+\\/, '').replace(/\\[^\\]+$/, '') : '');

            const fold_exists = await exists(fileFold);
            if (!fold_exists) {
                await mkdir(fileFold, { recursive: true });
            }

            const success = await backoffDownload(
                assetFileUrl,
                dlPath,
                (pr) => {
                    totbyts += pr.progress;
                    assetDLProgress[assetType][assetRelpath] = 100 * (totbyts / (assetSize * 1024 * 1024));
                }
            );

            if (!success) {
                delete assetDLProgress[assetType][assetRelpath];
                return; // Stop the entire process if download fails
            }

            fileNames.push(localFileName);
        }

        assetDLProgress[assetType][assetRelpath] = 0;
        await Promise.all(fileNames.map(async (fn, idx) => {
            const strPath = await path.join(assetDownloadFolder, fn);
            const destPath = (assetType === "Skins") ? await path.join(assetFullPath, fn) : await path.join(baseDirPath, fn);
            const fileFold = await path.dirname(destPath);

            fold_exists = await exists(fileFold);
            if (!fold_exists)
                await mkdir(fileFold, {recursive: true});

            await copyFile(strPath, destPath);
            assetDLProgress[assetType][assetRelpath] = (idx + 1) * (100 / fileNames.length);
        }));

        // Clean after pooping
        await remove(assetDownloadFolder, { recursive: true });

        if (assetNb === undefined)
            TriggerSuccess('Download complete');
        else
            TriggerSuccess(`Downloaded ${assetType} ${assetNb} out of ${assetTotal}`);

        currentAssets[assetType][assetRelpath] = {
            assetFolderName: assetRelpath,
            assetVersion: assetVersion
        };

        delete assetDLProgress[assetType][assetRelpath];
    }

    const TryFetchingLatestVersion = async () => {
        try {
            latestVersionErrorFound = false;
            latestVersion = 'Loading...';
            const response = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/releases/latest`);
            if (!response.ok) {
                throw new Error(`HTTP error status: ${response.status}`);
            }
            const data = await response.json();
            latestVersion = data.tag_name; // Latest tag version number
        } catch (err) {
            latestVersionErrorFound = true;
            TriggerError(`Failed to fetch latest release: ${err}`);
        }
    }

    const TryFetchingCurrentVersion = async () => {
        try {
            buildDetailsNotFound = false;
            buildDetails = 'Loading...';
            const filePath = './OpenTaiko/version.json';
            const res = await resourceDir();
            const versionFilePath = await path.join(res,filePath)
            const fileContent = await readTextFile(versionFilePath);
            const jsonData = JSON.parse(fileContent);
            optk_version = jsonData.version;
            optk_OS = jsonData.build;
            buildDetails = `${optk_version} (${optk_OS})`;
        } catch (err) {
            buildDetailsNotFound = true;
            optk_version = '0.1.0.0';
            buildDetails = "No valid OpenTaiko version found";
        }
    }
  
    onMount(async () => {
        updateChangeLogs();
        updateHubChangeLogs();
        updateSoundtrackInfo();
        updateAssetsInfo();
        crawlSongs();
        crawlAssets();
        await TryFetchingCurrentVersion();
        await TryFetchingLatestVersion();
    });
</script>




<div class="grid h-screen grid-rows-[auto_1fr_auto]">
    <!-- Grid Columns -->
    <div class="grid grid-cols-1 md:grid-cols-[auto_1fr]">
      <!-- Left Sidebar. -->
      <aside class="bg-yellow-500">
        <AppRail height="h-full">
            <!-- <svelte:fragment slot="lead">
                <AppRailAnchor href="/" >(icon)</AppRailAnchor>
            </svelte:fragment> -->
            <!-- --- -->
            <AppRailTile bind:group={currentTile} name="tile-1" value={0} title="Update or launch OpenTaiko">
                <svelte:fragment slot="lead"><i class="fa-solid fa-download"></i></svelte:fragment>
                <span>OpenTaiko version</span>
            </AppRailTile>
            <AppRailTile bind:group={currentTile} name="tile-2" value={1} title="Update your OpenTaiko songs and download the latest ones">
                <svelte:fragment slot="lead"><i class="fa-solid fa-music"></i></svelte:fragment>
                <span>Songlist</span>
            </AppRailTile>
            <AppRailTile bind:group={currentTile} name="tile-3" value={2} title="Get the newest OpenTaiko skins and related assets">
                <svelte:fragment slot="lead"><i class="fa-solid fa-pen-ruler"></i></svelte:fragment>
                <span>Skins</span>
            </AppRailTile>
            <AppRailTile bind:group={currentTile} name="tile-5" value={4} title="Tools that can improve your OpenTaiko experience">
                <svelte:fragment slot="lead"><i class="fa-solid fa-screwdriver-wrench"></i></svelte:fragment>
                <span>Tools</span>
            </AppRailTile>
            <!-- Trail -->
            <svelte:fragment slot="trail">
                <AppRailTile bind:group={currentTile} name="tile-4" value={3} title="To consult the changelogs, the documentation, or for troubleshooting">
                    <svelte:fragment slot="lead"><i class="fa-regular fa-file-lines"></i></svelte:fragment>
                    <span>Information</span>
                </AppRailTile>
                <AppRailAnchor href="https://discord.gg/aA8scTvZ6B" target="_blank" title="Official Discord">
					<i class="fa-brands fa-discord text-2xl"></i>
				</AppRailAnchor>
				<AppRailAnchor href="https://github.com/0auBSQ/OpenTaiko" target="_blank" title="GitHub">
					<i class="fa-brands fa-github text-2xl"></i>
				</AppRailAnchor>
			</svelte:fragment>
        </AppRail>
      </aside>
      <!-- Main Content -->
      <main class="h-screen space-y-4 p-4">
        <!-- OpenTaiko Version Page -->
        {#if currentTile === 0}
            <img src={optkLogoUrl} alt="Logo" class="mx-auto" />
            

            <section class="card w-full">
                <div class="p-4 space-y-4">
                    <div class="flex gap-4">
                        <span>Current version: </span>
                        {#if buildDetails === "Loading..."}
                            <div class="placeholder animate-pulse flex-1" />
                        {:else}
                            {#if downloadBusy === true}
                                <ProgressBar bind:value={progress} max={100} />
                            {:else}
                                <span>{buildDetails}</span>
                                <button type="button" on:click={TryFetchingCurrentVersion} class="text-white bg-blue-700 hover:bg-blue-800 font-medium rounded-lg text-sm px-3 py-1 dark:bg-blue-600 dark:hover:bg-blue-700">Reload</button>
                                {#if buildDetailsNotFound === true}
                                    <button type="button" on:click={DownloadOpenTaiko} class="text-white bg-green-700 hover:bg-green-800 font-medium rounded-lg text-sm px-3 py-1 dark:bg-green-600 dark:hover:bg-green-700">Download OpenTaiko</button>
                                {:else if latestVersion !== optk_version && 'Loading...' !== latestVersion}
                                    <button type="button" on:click={DownloadOpenTaiko} class="text-white bg-green-700 hover:bg-green-800 font-medium rounded-lg text-sm px-3 py-1 dark:bg-green-600 dark:hover:bg-green-700">Update OpenTaiko</button>
                                    {#if checkSkinCompatibility(latestVersion, optk_version) === false}
                                        <span class="text-red-500">(Updating will require a skin update)</span>
                                    {/if}
                                {:else}
                                <button type="button" on:click={DownloadOpenTaiko} class="text-white bg-gray-700 hover:bg-gray-800 font-medium rounded-lg text-sm px-3 py-1 dark:bg-gray-600 dark:hover:bg-gray-700">Redownload OpenTaiko</button>
                                {/if}
                            {/if}
                        {/if}
                    </div>
                </div>
            </section>

            <section class="card w-full">
                <div class="p-4 space-y-4">
                    <div class="flex gap-4">
                        <span>Latest version: </span>
                        {#if latestVersionErrorFound === true}
                            <span class="text-red-500">Fetch Error</span>
                            <button type="button" on:click={TryFetchingLatestVersion} class="text-white bg-red-700 hover:bg-red-800 font-medium rounded-lg text-sm px-3 py-1 dark:bg-red-600 dark:hover:bg-red-700">Retry</button>
                        {:else if latestVersion === "Loading..."}
                            <div class="placeholder animate-pulse flex-1" />
                        {:else}
                            <span>{latestVersion}</span>
                            <button type="button" on:click={TryFetchingLatestVersion} class="text-white bg-blue-700 hover:bg-blue-800 font-medium rounded-lg text-sm px-3 py-1 dark:bg-blue-600 dark:hover:bg-blue-700">Reload</button>
                        {/if}
                        
                    </div>
                </div>
            </section>
        {/if}

        <!-- Songs -->
        {#if currentTile === 1}
            <div class="table-container text-token">
                <table class="table table-hover">
                    <thead>
                        <tr>
                            <th><button on:click={() => SortSongsByColumn("name")}>Song name</button></th>
                            <th><button on:click={() => SortSongsByColumn("genre")}>Folder</button></th>
                            <th colspan="5" class="w-1/5">Difficulties</th>
                            <th><button on:click={() => SortSongsByColumn("size")}>Size</button></th>
                            <th class="w-1/6">Status</th>
                        </tr>
                        <tr>
                            <th><input class="w-full rounded-md px-3 py-2 text-blue-950" placeholder="Song search..." bind:value={searchSong}></th>
                            <th><input class="w-full rounded-md px-3 py-2 text-blue-950" placeholder="Folder search..." bind:value={searchGenre}></th>
                            <th><button on:click={() => SortSongsByColumn("ez")}>EZ</button></th>
                            <th><button on:click={() => SortSongsByColumn("nm")}>NM</button></th>
                            <th><button on:click={() => SortSongsByColumn("hd")}>HD</button></th>
                            <th><button on:click={() => SortSongsByColumn("ex")}>EX</button></th>
                            <th><button on:click={() => SortSongsByColumn("exex")}>EXEX</button></th>
                            <th></th>
                            <th>
                                {#if songCountProgressBar !== null}
                                    <ProgressBar bind:value={songCountProgressBar} max={100} />
                                {:else}
                                    <button type="button" on:click={DownloadDisplayedSongs} class="text-white bg-green-700 hover:bg-green-800 font-medium rounded-lg text-sm px-3 py-1 dark:bg-green-600 dark:hover:bg-green-700">Bulk download</button>
                                {/if}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {#each soundtrackInfo as songInfo}
                            {#if GetFilteredSInfo(songInfo)}
                                <tr>
                                    <td>
                                        <AudioPlayer {songInfo} />
                                        <!-- <button on:click={() => navigator.clipboard.writeText(songInfo.uniqueId)}>Copy uniqueID</button> -->
                                    </td>
                                    <td>{songInfo.tjaGenreFolder}</td>
                                    {#if songInfo.chartDifficulties.Dan !== undefined}
                                        <td colspan="5">
                                            <SongDifficultyChip SongInfo={songInfo} Difficulty="Dan"/>
                                        </td>
                                    {:else if songInfo.chartDifficulties.Tower !== undefined}
                                        <td colspan="5">
                                            <SongDifficultyChip SongInfo={songInfo} Difficulty="Tower"/>
                                        </td>
                                    {:else}
                                        <td>
                                            <SongDifficultyChip SongInfo={songInfo} Difficulty="Easy"/>
                                        </td>
                                        <td>
                                            <SongDifficultyChip SongInfo={songInfo} Difficulty="Normal"/>
                                        </td>
                                        <td>
                                            <SongDifficultyChip SongInfo={songInfo} Difficulty="Hard"/>
                                        </td>
                                        <td>
                                            <SongDifficultyChip SongInfo={songInfo} Difficulty="Oni"/>
                                        </td>
                                        <td>
                                            <SongDifficultyChip SongInfo={songInfo} Difficulty="Edit"/>
                                        </td>
                                    {/if}
                                    <td>{songInfo.chartSize}Mb</td>
                                    <!-- songDLProgress[songObj.uniqueId] -->
                                    {#if scanning === true}
                                        <td>
                                            <p>Scanning...</p>
                                        </td>
                                    {:else if !Object.keys(currentSongs).includes(songInfo.uniqueId)}
                                        <td>
                                            <p>Not downloaded</p>
                                            <br />
                                            {#if songDLProgress[songInfo.uniqueId] === undefined}
                                                <button type="button" on:click={DownloadSong(songInfo, null)} class="text-white bg-green-700 hover:bg-green-800 font-medium rounded-lg text-sm px-3 py-1 dark:bg-green-600 dark:hover:bg-green-700">Download</button>
                                            {:else}
                                                <ProgressBar bind:value={songDLProgress[songInfo.uniqueId]} max={100} />
                                            {/if}
                                        </td>
                                    {:else if currentSongs[songInfo.uniqueId].chartMD5 === songInfo.tjaMD5}
                                        <td>
                                            <p>Up-to-date</p>
                                        </td>
                                    {:else}
                                        <td>
                                            <p>Outdated</p>
                                            <br />
                                            {#if songDLProgress[songInfo.uniqueId] === undefined}
                                            <button type="button" on:click={DownloadSong(songInfo, currentSongs[songInfo.uniqueId])} class="text-white bg-green-700 hover:bg-green-800 font-medium rounded-lg text-sm px-3 py-1 dark:bg-green-600 dark:hover:bg-green-700">Update</button>
                                            {:else}
                                                <ProgressBar bind:value={songDLProgress[songInfo.uniqueId]} max={100} />
                                            {/if}
                                        </td>
                                    {/if}
                                    
                                </tr>
                            {/if}
                        {/each}


                        
                    </tbody>
                </table>
            </div>
        {/if}

        <!-- Skins -->
        {#if currentTile === 2}
            <TabGroup 
                justify="justify-center"
                active="variant-filled-primary"
                hover="hover:variant-soft-primary"
                flex="flex-1 lg:flex-none"
                rounded=""
                border=""
                class="bg-surface-100-800-token w-full"
            >
                <Tab bind:group={currentAsset} name="tab1" value={0}>
                    <svelte:fragment slot="lead"><i class="fa-solid fa-palette"></i></svelte:fragment>
                    <span>Skins</span>
                </Tab>
                <Tab bind:group={currentAsset} name="tab2" value={1}>
                    <svelte:fragment slot="lead"><i class="fa-solid fa-user"></i></svelte:fragment>
                    <span>Characters</span>
                </Tab>
                <Tab bind:group={currentAsset} name="tab3" value={2}>
                    <svelte:fragment slot="lead"><i class="fa-solid fa-circle-half-stroke"></i></svelte:fragment>
                    <span>Puchicharas</span>
                </Tab>
                <!-- ... -->
            </TabGroup>
            <div class="table-container text-token">
                <table class="table table-hover">
                    <thead>
                        <tr>
                            <th>Asset</th>
                            <th>Version</th>
                            <th>Resolution</th>
                            <th>Author</th>
                            <th>Size</th>
                            <th class="w-1/6">Status</th>
                        </tr>
                        <tr>
                            <th></th>
                            <th></th>
                            <th></th>
                            <th></th>
                            <th></th>
                            <th>
                                <!-- Skins -->
                                {#if currentAsset === 0}
                                    {#if assetCountProgressBar["Skins"] !== null}
                                        <ProgressBar bind:value={assetCountProgressBar["Skins"]} max={100} />
                                    {:else}
                                        <button type="button" on:click={() => DownloadDisplayedAssets("Skins")} class="text-white bg-green-700 hover:bg-green-800 font-medium rounded-lg text-sm px-3 py-1 dark:bg-green-600 dark:hover:bg-green-700">Bulk download</button>
                                    {/if}
                                {/if}
                                <!-- Characters -->
                                {#if currentAsset === 1}
                                    {#if assetCountProgressBar["Characters"] !== null}
                                        <ProgressBar bind:value={assetCountProgressBar["Characters"]} max={100} />
                                    {:else}
                                        <button type="button" on:click={() => DownloadDisplayedAssets("Characters")} class="text-white bg-green-700 hover:bg-green-800 font-medium rounded-lg text-sm px-3 py-1 dark:bg-green-600 dark:hover:bg-green-700">Bulk download</button>
                                    {/if}
                                {/if}
                                <!-- Puchicharas -->
                                {#if currentAsset === 2}
                                    {#if assetCountProgressBar["Puchicharas"] !== null}
                                        <ProgressBar bind:value={assetCountProgressBar["Puchicharas"]} max={100} />
                                    {:else}
                                        <button type="button" on:click={() => DownloadDisplayedAssets("Puchicharas")} class="text-white bg-green-700 hover:bg-green-800 font-medium rounded-lg text-sm px-3 py-1 dark:bg-green-600 dark:hover:bg-green-700">Bulk download</button>
                                    {/if}
                                {/if}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <!-- Skins -->
                        {#if currentAsset === 0}
                            {#each assetsInfo["Skins"] as skinInfo}
                                <tr>
                                    <td>{skinInfo.skinName}</td>
                                    <td><VersionNumberChip LatestVersion={skinInfo.skinVersion} CurrentVersion={optk_version} Strictness="Error" /></td>
                                    <td>{skinInfo.skinResolution}</td>
                                    <td>{skinInfo.skinCreator}</td>
                                    <td>{skinInfo.skinSize}Mb</td>
                                    <td>
                                        <AssetStatusCell
                                            IsScanning={assetScanning}
                                            AssetType="Skins"
                                            AssetInfo={skinInfo}
                                            CurrentAssets={currentAssets}
                                            DownloadMethod={DownloadAsset}
                                            Progress={assetDLProgress["Skins"][skinInfo.skinFolder]}
                                        />
                                    </td>
                                </tr>
                            {/each}
                        {/if}
                        <!-- Characters -->
                        {#if currentAsset === 1}
                            {#each assetsInfo["Characters"] as charaInfo}
                                <tr>
                                    <td>{charaInfo.charaName}</td>
                                    <td><VersionNumberChip LatestVersion={charaInfo.charaVersion} CurrentVersion="{optk_version}" Strictness="Warning" /></td>
                                    <td>{charaInfo.charaResolution}</td>
                                    <td>{charaInfo.charaCreator}</td>
                                    <td>{charaInfo.charaSize}Mb</td>
                                    <td>
                                        <AssetStatusCell
                                            IsScanning={assetScanning}
                                            AssetType="Characters"
                                            AssetInfo={charaInfo}
                                            CurrentAssets={currentAssets}
                                            DownloadMethod={DownloadAsset}
                                            Progress={assetDLProgress["Characters"][charaInfo.charaFolder]}
                                        />
                                    </td>
                                </tr>
                            {/each}
                        {/if}
                        <!-- Puchicharas -->
                        {#if currentAsset === 2}
                            {#each assetsInfo["Puchicharas"] as charaInfo}
                                <tr>
                                    <td>{charaInfo.charaName}</td>
                                    <td><VersionNumberChip LatestVersion={charaInfo.charaVersion} CurrentVersion={optk_version} Strictness="Warning" /></td>
                                    <td>{charaInfo.charaResolution}</td>
                                    <td>{charaInfo.charaCreator}</td>
                                    <td>{charaInfo.charaSize}Mb</td>
                                    <td>
                                        <AssetStatusCell
                                            IsScanning={assetScanning}
                                            AssetType="Puchicharas"
                                            AssetInfo={charaInfo}
                                            CurrentAssets={currentAssets}
                                            DownloadMethod={DownloadAsset}
                                            Progress={assetDLProgress["Puchicharas"][charaInfo.charaFolder]}
                                        />
                                    </td>
                                </tr>
                            {/each}
                        {/if}
                    </tbody>
                </table>
            </div>
        {/if}

        <!-- Information -->
        {#if currentTile === 3}
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
         
        {/if}

        
        <!-- Tools -->
        {#if currentTile === 4}
            <TabGroup 
                justify="justify-center"
                active="variant-filled-primary"
                hover="hover:variant-soft-primary"
                flex="flex-1 lg:flex-none"
                rounded=""
                border=""
                class="bg-surface-100-800-token w-full"
            >
                <Tab bind:group={currentTool} name="tab1" value={0}>
                    <svelte:fragment slot="lead"><i class="fa-regular fa-file-audio"></i></svelte:fragment>
                    <span>Charting</span>
                </Tab>
                <Tab bind:group={currentTool} name="tab2" value={1}>
                    <svelte:fragment slot="lead"><i class="fa-solid fa-envelope-open-text"></i></svelte:fragment>
                    <span>Submit your content!</span>
                </Tab>
                <!-- ... -->
            </TabGroup>

            <!-- Charting -->
            {#if currentTool === 0}
                <h2>Charting tutorial by ugyuu:</h2>
                <lite-youtube width="100%" videoid="U0i-z-tpxY8" playlabel="Play: Keynote (Google I/O '18)"></lite-youtube>
                <h2>Download PeepoDrumKit:</h2>
                <div class="w-full text-token grid grid-cols-1 md:grid-cols-2 gap-4">
                    <ToolCard 
                        Url="https://drive.google.com/uc?export=download&id=1TQuvKo1tBZrXZIMlUMJ3-1vU1jfsxI2H"
                        ImageSrc={peepoScreenshotUrl}
                        CardTitle="PeepoDrumKit"
                        CardSubtitle="Official Latest"
                        CardText ="The official latest version by samyuu, for regular charts without the experimental features"
                    />
                    <ToolCard 
                        Url="https://drive.google.com/uc?export=download&id=1P6ctv-qmxwH99z2mOSI5V3bPv5Rjfs11"
                        ImageSrc={peepoScreenshotUrl}
                        CardTitle="PeepoDrumKit"
                        CardSubtitle="Unofficial Latest"
                        CardText ="The unofficial latest version continued by Komi, adding experimental features supported by OpenTaiko"
                    />
                </div>
                <h2>Additional ressources:</h2>
                <div class="w-full text-token grid grid-cols-1 md:grid-cols-2 gap-4">
                    <ToolCard 
                        Url="https://whmhammer.github.io/tja-tools/"
                        ImageSrc={tjatoolsScreenshotUrl}
                        CardTitle="TJA Tools"
                        CardSubtitle="WHMHammer's fork"
                        CardText ="Visualize your charts and check stats about them on the go!"
                    />
                    <ToolCard 
                        Url="https://arrowvortex.ddrnl.com/"
                        ImageSrc={arrowScreenshotUrl}
                        CardTitle="Arrow Vortex"
                        CardSubtitle="Official Latest"
                        CardText ="The recommended tool to sync your charts trouble free!"
                    />
                </div>
            {/if}

            <!-- Submit your content -->
            {#if currentTool === 1}
                <div class="w-full text-token grid grid-cols-1 md:grid-cols-2 gap-4">
                    <ToolCard 
                        Url="https://forms.gle/WXNUwjJyLdJoeRSM6"
                        ImageSrc={peepoScreenshotUrl}
                        CardTitle="OpenTaiko soundtrack"
                        CardSubtitle="Song submission form"
                        CardText ="You can submit your songs here for the OpenTaiko soundtrack! Charts are usually made within 2 weeks if the song is accepted"
                    />
                    <ToolCard 
                        Url="https://forms.gle/1HbDtS7FtJDNfhUb7"
                        ImageSrc={peepoScreenshotUrl}
                        CardTitle="OpenTaiko soundtrack"
                        CardSubtitle="Song suggestion form"
                        CardText ="You can recommand artists here whose songs you thing would fit for OpenTaiko!"
                    />
                </div>
            {/if}


        {/if}

        
      </main>
    </div>
</div>

<style>
    main {
        overflow-y: auto;
    }
</style>