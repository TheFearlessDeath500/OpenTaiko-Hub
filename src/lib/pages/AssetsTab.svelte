<script>
    // Dependencies
    import { onMount } from 'svelte';
    import { ProgressBar, TabGroup, Tab } from '@skeletonlabs/skeleton';
    import { readTextFile, mkdir, readDir, exists, copyFile, remove } from '@tauri-apps/plugin-fs';
    import { fetch } from "@tauri-apps/plugin-http";
    import { path } from '@tauri-apps/api';
    import { invoke } from '@tauri-apps/api/core';
    import { listen } from '@tauri-apps/api/event';

    const copyAllFilesRecursive = async (src, dst) => {
        let files;
        try {
            files = await readDir(src, { recursive: false });
        } catch (error) {
            console.error(`Error reading directory ${src}:`, error);
            return;
        }
for (const file of files) {
            const srcPath = `${src}/${file.name}`;
            const dstPath = `${dst}/${file.name}`;
            try {
                if (file.isDirectory) {
                    await mkdir(dstPath, { recursive: true });
                    await copyAllFilesRecursive(srcPath, dstPath);
                } else {
                    await copyFile(srcPath, dstPath);
                }
            } catch (error) {
                console.error(`Error copying ${srcPath} → ${dstPath}:`, error);
            }
        }
    }
    import { getContext } from 'svelte';
    const { TriggerError, TriggerWarning, TriggerSuccess, backoffDownload } = getContext('toast');

    import { GetRootPath } from "../utils/path.js";
    import { _ } from 'svelte-i18n';
    import { get } from 'svelte/store';


    import AssetStatusCell from '$lib/components/AssetStatusCell.svelte';
    import VersionNumberChip from '$lib/components/VersionNumberChip.svelte';

    export let optk_version = "0.6.0.0";
    

    let currentAsset = 0;

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
    };


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
        const res = await GetRootPath();
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

    const DownloadDisplayedAssets = async (assetType) => {
        if (assetScanning === true) {
            const translatedType = get(_)(`assets.type.${assetType.toLowerCase()}`);
            TriggerError(get(_)('assets.error.scanning', { values: { type: translatedType } }));
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
            const translatedType = get(_)(`assets.type.${assetType.toLowerCase()}`);
            TriggerSuccess(get(_)('assets.success.all_up_to_date', { values: { type: translatedType } }));
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
        const res = await GetRootPath();

        const baseDir = {
            "Skins": "./OpenTaiko/System",
            "Characters": "./OpenTaiko/Global/Characters",
            "Puchicharas": "./OpenTaiko/Global/PuchiChara"
        }[assetType];
        const assetRelpath = (assetType === "Skins") ? assetObj.skinFolder : assetObj.charaFolder;
        const assetSize = (assetType === "Skins") ? assetObj.skinSize : assetObj.charaSize;
        const assetVersion = (assetType === "Skins") ? assetObj.skinVersion : assetObj.charaVersion;

        assetDLProgress[assetType][assetRelpath] = 0;

        const localPath = `${baseDir}/${assetRelpath}`;
        const assetFullPath = await path.join(res, localPath);

        if (!await exists(assetFullPath))
            await mkdir(assetFullPath, { recursive: true });

        const tmpFolder = await path.join(res, "./tmp");
        const uuid = crypto.randomUUID();
        const assetDownloadFolder = await path.join(tmpFolder, uuid);

        if (!await exists(assetDownloadFolder))
            await mkdir(assetDownloadFolder, { recursive: true });

        if (assetType === "Skins") {
            // Zip name: spaces → dots, parentheses stripped (matches release asset naming)
            const zipName = assetObj.skinFolder.replace(/[()]/g, '').replace(/ /g, '.') + '.zip';
            const zipUrl = `https://github.com/OpenTaiko/OpenTaiko-Skins/releases/download/system-assets/${zipName}`;
            const zipPath = await path.join(assetDownloadFolder, 'skin.zip');

            let totbyts = 0;
            const success = await backoffDownload(
                zipUrl,
                zipPath,
                (pr) => {
                    totbyts += pr.progress;
                    assetDLProgress[assetType][assetRelpath] = 100 * (totbyts / (assetSize * 1024 * 1024));
                    assetDLProgress = assetDLProgress;
                }
            );

            if (!success) {
                // backoffDownload already shows an error toast; show zip-specific guidance on top
                TriggerError(get(_)('assets.error.zip_not_found'));
                await remove(assetDownloadFolder, { recursive: true });
                delete assetDLProgress[assetType][assetRelpath];
                return;
            }

            assetDLProgress[assetType][assetRelpath] = 0;
            assetDLProgress = assetDLProgress;

            let extracting = true;
            const capturedRelpath = assetRelpath;
            const capturedType = assetType;
            const unlisten = await listen('extract-progress', (event) => {
                if (!extracting) return;
                assetDLProgress[capturedType][capturedRelpath] = event.payload;
                assetDLProgress = assetDLProgress;
            });

            await invoke('unzip_and_get_first_folder', { zipPath });
            extracting = false;
            unlisten();

            // All skin zips are flat (files/folders at zip root), so copy directly
            // from the extraction folder into the skin destination.
            await remove(zipPath);
            await copyAllFilesRecursive(assetDownloadFolder.replace(/\\/g, '/'), assetFullPath);

            await remove(assetDownloadFolder, { recursive: true });

        } else {
            // Per-file download for Characters and Puchicharas
            const subDir = "Global";
            const assetFpath = assetObj.charaFilesPath;
            const baseDirPath = await path.join(res, baseDir);

            let fileNames = [];
            let totbyts = 0;

            for (const filePath of assetFpath) {
                const localFileName = filePath.replace(/^[^\\]+\\/, '');
                const assetFileUrl = `https://raw.githubusercontent.com/OpenTaiko/OpenTaiko-Skins/main/${subDir}/${filePath}`;
                const dlPath = await path.join(assetDownloadFolder, localFileName.replace(/\\/g, '/'));
                const fileFold = await path.join(assetDownloadFolder, (filePath.split('\\').length > 2 ? filePath.replace(/^[^\\]+\\/, '').replace(/\\[^\\]+$/, '') : '').replace(/\\/g, '/'));

                if (!await exists(fileFold))
                    await mkdir(fileFold, { recursive: true });

                const success = await backoffDownload(
                    assetFileUrl,
                    dlPath,
                    (pr) => {
                        totbyts += pr.progress;
                        assetDLProgress[assetType][assetRelpath] = 100 * (totbyts / (assetSize * 1024 * 1024));
                        assetDLProgress = assetDLProgress;
                    }
                );

                if (!success) {
                    await remove(assetDownloadFolder, { recursive: true });
                    delete assetDLProgress[assetType][assetRelpath];
                    return;
                }

                fileNames.push(localFileName);
            }

            assetDLProgress[assetType][assetRelpath] = 0;
            await Promise.all(fileNames.map(async (fn, idx) => {
                const strPath = (await path.join(assetDownloadFolder, fn)).replace(/\\/g, '/');
                const destPath = (await path.join(baseDirPath, fn)).replace(/\\/g, '/');
                const fileFold = await path.dirname(destPath);

                if (!await exists(fileFold))
                    await mkdir(fileFold, { recursive: true });

                await copyFile(strPath, destPath);
                assetDLProgress[assetType][assetRelpath] = (idx + 1) * (100 / fileNames.length);
            }));

            await remove(assetDownloadFolder, { recursive: true });
        }

        if (assetNb === undefined)
            TriggerSuccess(get(_)('assets.success.download_complete'));
        else {
            const translatedType = get(_)(`assets.type.${assetType.toLowerCase()}`);
            TriggerSuccess(get(_)('assets.success.download_nb', { values: { type: translatedType, nb: assetNb, total: assetTotal } }));
        }

        currentAssets[assetType][assetRelpath] = {
            assetFolderName: assetRelpath,
            assetVersion: assetVersion
        };

        delete assetDLProgress[assetType][assetRelpath];
        assetDLProgress = assetDLProgress;
    }

    onMount(async () => {
        updateAssetsInfo();
        crawlAssets();
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
	<Tab bind:group={currentAsset} name="tab1" value={0}>
		<svelte:fragment slot="lead"><i class="fa-solid fa-palette"></i></svelte:fragment>
		<span>{$_('assets.tab.skins')}</span>
	</Tab>
	<Tab bind:group={currentAsset} name="tab2" value={1}>
		<svelte:fragment slot="lead"><i class="fa-solid fa-user"></i></svelte:fragment>
		<span>{$_('assets.tab.characters')}</span>
	</Tab>
	<Tab bind:group={currentAsset} name="tab3" value={2}>
		<svelte:fragment slot="lead"><i class="fa-solid fa-circle-half-stroke"></i></svelte:fragment>
		<span>{$_('assets.tab.puchicharas')}</span>
	</Tab>
	<!-- ... -->
</TabGroup>
<div class="table-container text-token">
	<table class="table table-hover">
		<thead>
			<tr>
				<th>{$_('assets.col.asset')}</th>
				<th>{$_('assets.col.version')}</th>
				<th>{$_('assets.col.resolution')}</th>
				<th>{$_('assets.col.author')}</th>
				<th>{$_('assets.col.size')}</th>
				<th class="w-1/6">{$_('assets.col.status')}</th>
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
					<button type="button" on:click={() => DownloadDisplayedAssets("Skins")} class="button-green button-main"><i class="fa-solid fa-download"></i> {$_('assets.button.bulk_download')}</button>
					{/if}
					{/if}
					<!-- Characters -->
					{#if currentAsset === 1}
					{#if assetCountProgressBar["Characters"] !== null}
					<ProgressBar bind:value={assetCountProgressBar["Characters"]} max={100} />
					{:else}
					<button type="button" on:click={() => DownloadDisplayedAssets("Characters")} class="button-green button-main"><i class="fa-solid fa-download"></i> {$_('assets.button.bulk_download')}</button>
					{/if}
					{/if}
					<!-- Puchicharas -->
					{#if currentAsset === 2}
					{#if assetCountProgressBar["Puchicharas"] !== null}
					<ProgressBar bind:value={assetCountProgressBar["Puchicharas"]} max={100} />
					{:else}
					<button type="button" on:click={() => DownloadDisplayedAssets("Puchicharas")} class="button-green button-main"><i class="fa-solid fa-download"></i> {$_('assets.button.bulk_download')}</button>
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
				<td>
					<VersionNumberChip LatestVersion={skinInfo.skinVersion} CurrentVersion={optk_version} Strictness="Error" />
				</td>
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
				<td>
					<VersionNumberChip LatestVersion={charaInfo.charaVersion} CurrentVersion="{optk_version}" Strictness="Warning" />
				</td>
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
				<td>
					<VersionNumberChip LatestVersion={charaInfo.charaVersion} CurrentVersion={optk_version} Strictness="Warning" />
				</td>
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

<style>

</style>