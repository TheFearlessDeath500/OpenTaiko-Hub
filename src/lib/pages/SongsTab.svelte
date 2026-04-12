<script>
    // Dependencies
    import { onMount } from 'svelte';
    import { ProgressBar } from '@skeletonlabs/skeleton';
    import { readFile, readTextFile, mkdir, readDir, exists, copyFile, remove } from '@tauri-apps/plugin-fs';
    import { fetch } from "@tauri-apps/plugin-http";
    import { download } from "@tauri-apps/plugin-upload";
    import { path } from '@tauri-apps/api';
    import { getContext } from 'svelte';
    const { TriggerError, TriggerWarning, TriggerSuccess, backoffDownload } = getContext('toast');

    import { md5 } from 'js-md5';
    import initSqlJs from 'sql.js';
    import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

    import { _ } from 'svelte-i18n';
    import { get } from 'svelte/store';

    import { GetRootPath } from "../utils/path.js";

    // Song management
    import AudioPlayer from '$lib/components/AudioPlayer.svelte';
    import SongDifficultyChip from '$lib/components/SongDifficultyChip.svelte';

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

    // Hall of Fame
    const hofDbUrl = 'https://opentaiko.github.io/hof.db3';
    const hofDifficultyMap    = { 0: "Easy", 1: "Normal", 2: "Hard", 3: "Oni", 4: "Edit" };
    const hofDifficultyRevMap = { "Easy": 0, "Normal": 1, "Hard": 2, "Oni": 3, "Edit": 4 };
    const hofDiffShortMap     = { "Easy": "EZ", "Normal": "NM", "Hard": "HD", "Oni": "EX", "Edit": "EXEX" };
    let hofDb = null;
    // uniqueId → { difficultyString → globalRank }
    let hofMap = {};

    // Modal state
    let hofModalOpen = false;
    let hofModalSongInfo = null;
    let hofModalDifficulty = null;
    let hofModalScores = [];
    let hofModalMaxListPoints = 0;

    const ComputeMaxListPoints = (rank) => {
        return parseInt(1000 * Math.pow(0.95, rank - 1));
    };

    const ScoreToListPointsRatio = (score) => {
        const total = score.goodCount + score.okCount + score.badCount;
        if (total === 0) return 0;
        const accuracy = (score.goodCount + score.okCount * 0.5) / total;
        const badRatio = score.badCount / total;
        let ratio = Math.pow(accuracy, 6) * Math.pow(1 - badRatio, 18);
        switch (score.status) {
            case "Perfect":    break;
            case "Full Combo": ratio *= 0.9; break;
            case "Clear":      ratio *= 0.7; break;
            default:           ratio = 0;    break;
        }
        return ratio;
    };

    const updateHoFInfo = async () => {
        try {
            const SQL = await initSqlJs({ locateFile: () => sqlWasmUrl });

            const response = await fetch(hofDbUrl);
            const buffer = await response.arrayBuffer();
            hofDb = new SQL.Database(new Uint8Array(buffer));

            // Global rank: all entries sorted by internalDifficultyIndex DESC regardless of difficulty
            const result = hofDb.exec(
                'SELECT uniqueId, difficulty, internalDifficultyIndex FROM entries ORDER BY internalDifficultyIndex DESC'
            );

            if (result.length > 0) {
                let globalRank = 0;
                for (const [uniqueId, difficulty, _idx] of result[0].values) {
                    globalRank++;
                    const diffStr = hofDifficultyMap[difficulty];
                    if (diffStr && uniqueId) {
                        if (!hofMap[uniqueId]) hofMap[uniqueId] = {};
                        hofMap[uniqueId][diffStr] = globalRank;
                    }
                }
            }

            // Patch soundtrackInfo with chartHoFRanks derived from the DB
            soundtrackInfo = soundtrackInfo.map(s => ({
                ...s,
                chartHoFRanks: hofMap[s.uniqueId] ?? {}
            }));
        } catch (e) {
            console.error('Failed to load HoF data:', e);
        }
    };

    const openHoFModal = (songInfo, difficulty) => {
        if (!hofDb) return;
        const rank = hofMap[songInfo.uniqueId]?.[difficulty];
        if (rank === undefined) return;

        const diffInt = hofDifficultyRevMap[difficulty];
        const result = hofDb.exec(
            `SELECT player, status, score, grade, goodCount, okCount, badCount, videoLink, imageLink
             FROM scores WHERE entryId = ? AND difficulty = ?`,
            [songInfo.uniqueId, diffInt]
        );

        const maxListPoints = ComputeMaxListPoints(rank);
        hofModalMaxListPoints = maxListPoints;

        hofModalScores = result.length > 0
            ? result[0].values
                .map((row) => {
                    const s = {
                        player: row[0], status: row[1], score: row[2], grade: row[3],
                        goodCount: row[4], okCount: row[5], badCount: row[6],
                        videoLink: row[7], imageLink: row[8]
                    };
                    s.listPoints = Math.round(maxListPoints * ScoreToListPointsRatio(s));
                    return s;
                })
                .sort((a, b) => b.listPoints - a.listPoints || b.score - a.score)
                .map((s, i) => ({ ...s, rank: i + 1 }))
            : [];

        hofModalSongInfo = songInfo;
        hofModalDifficulty = difficulty;
        hofModalOpen = true;
    };

    const filter1 = (sInfo) => {
        const uids = ["losTPEtAlSwANDERRBHLiXoUNdsetSUnaN"];
        return sInfo.filter(obj => !uids.includes(obj.uniqueId));
    }

    const filter2 = (sInfo) => {
        return sInfo;
    }

    const updateSoundtrackInfo = async () => {
        try {
            const response = await fetch(soundtrackInfoUrl);
        if (response.ok) {
            const text = await response.text();
            soundtrackInfo = JSON.parse(text);

            if (navigator.language === "zh-CN") {
                soundtrackInfo = filter1(soundtrackInfo);
            }
            else {
                soundtrackInfo = filter2(soundtrackInfo);
            }
        } else {
            soundtrackInfo = {};
        }
        } catch (error) {
            soundtrackInfo = {};
        }
    }
    
    const crawlSongs = async () => {
        const res = await GetRootPath();
        const baseDir = './OpenTaiko/Songs';
        scanning = true;
        const soundtrackIds = new Set(soundtrackInfo.map(s => s.uniqueId));
        
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

                            // Skip songs not tracked in soundtrackInfo
                            if (!soundtrackIds.has(uniqueId)) continue;

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
            TriggerError(get(_)('songs.error.scanning'));
            return ;
        }

        const filteredSInfo = soundtrackInfo.filter((SInfo) => GetFilteredAvailableSInfo(SInfo));

        const songCount = filteredSInfo.length;

        if (songCount === 0) {
            TriggerSuccess(get(_)('songs.success.all_up_to_date'));
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

        const res = await GetRootPath();
        const baseDir = './OpenTaiko/Songs';
        const baseDirPath = await path.join(res, baseDir);
        const localPath = `${baseDir}/${(currentObj !== null) ? currentObj.chartRelativePath : songObj.tjaFolderPath}`.replace(/\\/g, '/');
        const tjaFullPath = await path.join(res, localPath);

        let fold_exists = await exists(tjaFullPath);
        if (!fold_exists)
            await mkdir(tjaFullPath, {recursive: true});

        const tmpFolder = await path.join(res, "./tmp");
        const uuid = crypto.randomUUID();
        const chartDownloadFolder = await path.join(tmpFolder, `${uuid}/`);

        fold_exists = await exists(chartDownloadFolder);
        if (!fold_exists)
            await mkdir(chartDownloadFolder, {recursive: true});

        let fileNames = [];

        let totbyts = 0;
        for (const filePath of songObj.tjaFilesPath) {
            // forbid non-children paths
            let localFilePath = (filePath.startsWith(songObj.tjaFolderPath + '\\') || filePath.startsWith(songObj.tjaFolderPath + '/')) ?
                filePath.slice(songObj.tjaFolderPath.length + 1)
                : filePath.split("\\").pop();

            const tjaFileUrl = `https://raw.githubusercontent.com/OpenTaiko/OpenTaiko-Soundtrack/main/${filePath}`;
            const dlPath = await path.join(chartDownloadFolder, localFilePath.replace(/\\/g, '/'));

            // ensure subdirectory exists
            const dlPathFold = await path.dirname(dlPath);
            if (!await exists(dlPathFold))
                await mkdir(dlPathFold, {recursive: true});

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

            fileNames.push(localFilePath);
        };

        songDLProgress[songObj.uniqueId] = 0;
        await Promise.all(fileNames.map(async (fn, idx) => {
            const strPath = await path.join(chartDownloadFolder, fn.replace(/\\/g, '/'));
            const destPath = await path.join(tjaFullPath, fn.replace(/\\/g, '/'));

            // ensure subdirectory exists
            const destPathDir = await path.dirname(destPath);
            if (!await exists(destPathDir))
                await mkdir(destPathDir, {recursive: true});

            await copyFile(strPath, destPath);
            songDLProgress[songObj.uniqueId] = (idx + 1) * (100 / fileNames.length);
            //console.log(songDLProgress);
        }));

        // Download box.def and default.png if missing
        const genrePaths = songObj.tjaFolderPath.split('\\').slice(0, -1).map((_, i, arr) => arr.slice(0, i + 1).join('/'));

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
            TriggerSuccess(get(_)('songs.success.download_complete'));
        else
            TriggerSuccess(get(_)('songs.success.download_nb', { values: { nb: songNb, total: songTotal } }));

        //crawlSongs();
        currentSongs[songObj.uniqueId] = {
            chartMD5: songObj.tjaMD5,
            chartRelativePath: songObj.tjaFolderPath
        };

        delete songDLProgress[songObj.uniqueId];
        //console.log(songDLProgress);
    }

    // Artists info
    const artistsDbUrl = 'https://opentaiko.github.io/artists_info.db3';
    let songArtistsMap = {}; // songUid → { artists: ArtistObj[], link }
    let expandedSongUid = null;

    const updateArtistInfo = async () => {
        try {
            const SQL = await initSqlJs({ locateFile: () => sqlWasmUrl });
            const response = await fetch(artistsDbUrl);
            const buffer = await response.arrayBuffer();
            const db = new SQL.Database(new Uint8Array(buffer));

            const artistsResult = db.exec('SELECT entryId, artist, youtube, soundcloud, spotify, bandcamp, bilibili, other FROM artists');
            const artistsById = {};
            if (artistsResult.length > 0) {
                for (const [entryId, artist, youtube, soundcloud, spotify, bandcamp, bilibili, other] of artistsResult[0].values) {
                    artistsById[entryId] = { artist, youtube, soundcloud, spotify, bandcamp, bilibili, other };
                }
            }

            const songsResult = db.exec('SELECT songUid, artists, link FROM songs');
            if (songsResult.length > 0) {
                for (const [songUid, artistsJson, link] of songsResult[0].values) {
                    const artistIds = JSON.parse(artistsJson || '[]');
                    const artists = artistIds.map(id => artistsById[id]).filter(Boolean);
                    songArtistsMap[songUid] = { artists, link };
                }
            }
            songArtistsMap = songArtistsMap;
        } catch (e) {
            console.error('Failed to load artist info:', e);
        }
    };

    const toggleExpand = (uid) => {
        expandedSongUid = expandedSongUid === uid ? null : uid;
    };

    onMount(async () => {
        await updateSoundtrackInfo();
        updateHoFInfo();      // fire-and-forget: patches soundtrackInfo when DB is ready
        updateArtistInfo();   // fire-and-forget
        crawlSongs();
    });

</script>

<div class="table-container text-token">
	<table class="table table-hover">
		<thead>
			<tr>
				<th><button on:click={() => SortSongsByColumn("name")}>{$_('songs.col.name')}</button></th>
				<th><button on:click={() => SortSongsByColumn("genre")}>{$_('songs.col.folder')}</button></th>
				<th colspan="5" class="w-1/5">Difficulties</th>
				<th><button on:click={() => SortSongsByColumn("size")}>{$_('songs.col.size')}</button></th>
				<th class="w-1/6">{$_('songs.col.status')}</th>
			</tr>
			<tr>
				<th><input class="w-full rounded-md px-3 py-2 text-blue-950" placeholder={$_('songs.filter.song')} bind:value={searchSong}></th>
				<th><input class="w-full rounded-md px-3 py-2 text-blue-950" placeholder={$_('songs.filter.folder')} bind:value={searchGenre}></th>
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
					<button type="button" on:click={DownloadDisplayedSongs} class="button-green button-main"><i class="fa-solid fa-download"></i> {$_('songs.button.bulk_download')}</button>
					{/if}
				</th>
			</tr>
		</thead>
		<tbody>
			{#each soundtrackInfo as songInfo}
			{#if GetFilteredSInfo(songInfo)}
			<tr class:row-expanded={expandedSongUid === songInfo.uniqueId}>
				<td>
					<div class="flex items-center gap-2">
						<button class="expand-btn" on:click={() => toggleExpand(songInfo.uniqueId)} aria-label="expand">
							<i class="fa-solid fa-chevron-{expandedSongUid === songInfo.uniqueId ? 'down' : 'right'}"></i>
						</button>
						<div class="flex-1"><AudioPlayer {songInfo} /></div>
					</div>
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
					<SongDifficultyChip SongInfo={songInfo} Difficulty="Easy" OnCrownClick={openHoFModal}/>
				</td>
				<td>
					<SongDifficultyChip SongInfo={songInfo} Difficulty="Normal" OnCrownClick={openHoFModal}/>
				</td>
				<td>
					<SongDifficultyChip SongInfo={songInfo} Difficulty="Hard" OnCrownClick={openHoFModal}/>
				</td>
				<td>
					<SongDifficultyChip SongInfo={songInfo} Difficulty="Oni" OnCrownClick={openHoFModal}/>
				</td>
				<td>
					<SongDifficultyChip SongInfo={songInfo} Difficulty="Edit" OnCrownClick={openHoFModal}/>
				</td>
				{/if}
				<td>{songInfo.chartSize}Mb</td>
				<!-- songDLProgress[songObj.uniqueId] -->
				{#if scanning === true}
				<td>
					<p>{$_('songs.status.scanning')}</p>
				</td>
				{:else if !Object.keys(currentSongs).includes(songInfo.uniqueId)}
				<td>
					<p>{$_('songs.status.not_downloaded')}</p>
					<br />
					{#if songDLProgress[songInfo.uniqueId] === undefined}
					<button type="button" on:click={DownloadSong(songInfo, null)} class="button-green button-main"><i class="fa-solid fa-download"></i> {$_('songs.button.download')}</button>
					{:else}
					<ProgressBar bind:value={songDLProgress[songInfo.uniqueId]} max={100} />
					{/if}
				</td>
				{:else if currentSongs[songInfo.uniqueId].chartMD5 === songInfo.tjaMD5}
				<td>
					<p>{$_('songs.status.up_to_date')}</p>
                    <br />
                    {#if songDLProgress[songInfo.uniqueId] === undefined}
					<button type="button" on:click={DownloadSong(songInfo, currentSongs[songInfo.uniqueId])} class="button-gray button-main"><i class="fa-solid fa-download"></i> {$_('songs.button.redownload')}</button>
					{:else}
					<ProgressBar bind:value={songDLProgress[songInfo.uniqueId]} max={100} />
					{/if}
				</td>
				{:else}
				<td>
					<p>{$_('songs.status.outdated')}</p>
					<br />
					{#if songDLProgress[songInfo.uniqueId] === undefined}
					<button type="button" on:click={DownloadSong(songInfo, currentSongs[songInfo.uniqueId])} class="button-green button-main"><i class="fa-solid fa-download"></i> {$_('songs.button.update')}</button>
					{:else}
					<ProgressBar bind:value={songDLProgress[songInfo.uniqueId]} max={100} />
					{/if}
				</td>
				{/if}
			</tr>
			{#if expandedSongUid === songInfo.uniqueId}
				{@const artistData = songArtistsMap[songInfo.uniqueId]}
			<tr class="expanded-detail-row">
				<td colspan="9">
					<div class="song-detail-box">
						<!-- Jacket -->
						<div class="song-jacket">
							{#if songInfo.chartJacketFilePath}
								<img
									src="https://raw.githubusercontent.com/OpenTaiko/OpenTaiko-Soundtrack/main/{songInfo.chartJacketFilePath}"
									alt="jacket"
								/>
							{:else}
								<div class="no-jacket"><span>No jacket</span></div>
							{/if}
						</div>
						<!-- Artist info -->
						<div class="song-artist-info">
							{#if artistData && artistData.artists.length > 0}
								{#each artistData.artists as artist}
									<div class="artist-entry">
										<span class="artist-name">{artist.artist}</span>
										<div class="artist-links">
											{#if artist.youtube}   <a href={artist.youtube}   target="_blank" class="artist-link link-youtube">  <i class="fa-brands fa-youtube"></i>    YouTube</a>   {/if}
											{#if artist.soundcloud}<a href={artist.soundcloud} target="_blank" class="artist-link link-soundcloud"><i class="fa-brands fa-soundcloud"></i> SoundCloud</a>{/if}
											{#if artist.spotify}   <a href={artist.spotify}   target="_blank" class="artist-link link-spotify">  <i class="fa-brands fa-spotify"></i>    Spotify</a>   {/if}
											{#if artist.bandcamp}  <a href={artist.bandcamp}  target="_blank" class="artist-link link-bandcamp"> <i class="fa-brands fa-bandcamp"></i>   Bandcamp</a>  {/if}
											{#if artist.bilibili}  <a href={artist.bilibili}  target="_blank" class="artist-link link-bilibili"> <i class="fa-solid fa-tv"></i>          Bilibili</a>  {/if}
											{#if artist.other}     <a href={artist.other}     target="_blank" class="artist-link link-other">    <i class="fa-solid fa-link"></i>        Website</a>   {/if}
										</div>
									</div>
								{/each}
								{#if artistData.link}
									<a href={artistData.link} target="_blank" class="artist-link link-other mt-1"><i class="fa-solid fa-music"></i> Song link</a>
								{/if}
							{:else}
								<span class="opacity-50 italic">No artist information available.</span>
							{/if}
						</div>
					</div>
				</td>
			</tr>
			{/if}
			{/if}
			{/each}
		</tbody>
	</table>
</div>

{#if hofModalOpen && hofModalSongInfo}
<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
<div class="modal-backdrop" on:click={() => hofModalOpen = false}>
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="card p-6 space-y-4 modal-card" on:click|stopPropagation>
        <div class="flex justify-between items-center">
            <h2 class="h3">Hall of Fame — {hofModalSongInfo.chartTitle} ({hofDiffShortMap[hofModalDifficulty]} #{hofMap[hofModalSongInfo.uniqueId]?.[hofModalDifficulty]})</h2>
            <button class="button-red button-main" on:click={() => hofModalOpen = false}>{$_('hof.close')}</button>
        </div>
        <div class="flex flex-col gap-1">
            <a href="https://opentaiko.github.io/songinfo/{hofModalSongInfo.uniqueId}?d={hofDifficultyRevMap[hofModalDifficulty]}" target="_blank" class="text-blue-600 underline">
                {$_('hof.website_link')} <i class="fa-solid fa-arrow-up-right-from-square"></i>
            </a>
            <span class="text-sm opacity-70">{$_('hof.max_list_points')}: <b>{hofModalMaxListPoints}</b></span>
        </div>
        {#if hofModalScores.length === 0}
            <p>{$_('hof.no_scores')}</p>
        {:else}
        <div class="table-container">
            <table class="table table-hover">
                <thead>
                    <tr>
                        <th>{$_('hof.col.rank')}</th>
                        <th>{$_('hof.col.player')}</th>
                        <th>{$_('hof.col.score')}</th>
                        <th>{$_('hof.col.grade')}</th>
                        <th>{$_('hof.col.status')}</th>
                        <th>{$_('hof.col.good')}</th>
                        <th>{$_('hof.col.ok')}</th>
                        <th>{$_('hof.col.bad')}</th>
                        <th>LP</th>
                        <th>{$_('hof.col.video')}</th>
                    </tr>
                </thead>
                <tbody>
                    {#each hofModalScores as s}
                        {@const gradeDisplay = s.grade?.toUpperCase()}
                        {@const gradeClass = gradeDisplay === 'Ω' ? 'omega' : gradeDisplay}
                    <tr>
                        <td>{s.rank}</td>
                        <td>{s.player ?? '—'}</td>
                        <td>{s.score?.toLocaleString()}</td>
                        <td class="grade grade-{gradeClass}">{gradeDisplay}</td>
                        <td class="status status-{s.status?.replace(' ', '-')}">{s.status === 'Perfect' ? $_('hof.status.perfect') : s.status === 'Full Combo' ? $_('hof.status.full_combo') : s.status === 'Clear' ? $_('hof.status.clear') : (s.status ?? '—')}</td>
                        <td>{s.goodCount}</td>
                        <td>{s.okCount}</td>
                        <td>{s.badCount}</td>
                        <td>{s.listPoints?.toLocaleString()}</td>
                        <td>
                            {#if s.videoLink}
                                <a href={s.videoLink} target="_blank" class="text-blue-600 underline">{$_('hof.video_link')} <i class="fa-solid fa-arrow-up-right-from-square"></i></a>
                            {:else}—{/if}
                        </td>
                    </tr>
                    {/each}
                </tbody>
            </table>
        </div>
        {/if}
    </div>
</div>
{/if}

<style>
    .modal-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
    }
    .modal-card {
        max-width: 800px;
        width: 90%;
        max-height: 80vh;
        overflow-y: auto;
    }

    /* Grade letter colors */
    .grade { font-weight: bold; }
    .grade-E { color: #ffffff; }
    .grade-D { color: #ff4444; }
    .grade-C { color: #ff9933; }
    .grade-B { color: #ffdd00; }
    .grade-A { color: #44cc44; }
    .grade-S {
        background: linear-gradient(90deg, #56ccf2, #2f80ed, #56ccf2);
        background-size: 200% auto;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        animation: shimmer-blue 2s linear infinite;
    }
    .grade-omega {
        font-family: 'Segoe UI', Arial, sans-serif;
        background: linear-gradient(90deg, #1a237e, #3949ab, #5c6bc0, #3949ab, #1a237e);
        background-size: 200% auto;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        animation: shimmer-blue 2s linear infinite;
    }

    /* Status colors */
    .status-Perfect {
        background: linear-gradient(90deg, #ff0000, #ff8800, #ffff00, #00cc00, #0088ff, #8800ff, #ff0000);
        background-size: 300% auto;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        font-weight: bold;
        animation: rainbow 3s linear infinite;
    }
    .status-Full-Combo {
        background: linear-gradient(90deg, #b8860b, #ffd700, #fffacd, #ffd700, #b8860b);
        background-size: 200% auto;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        font-weight: bold;
        animation: shimmer-gold 2s linear infinite;
    }

    @keyframes rainbow {
        0%   { background-position: 0% center; }
        100% { background-position: 300% center; }
    }
    @keyframes shimmer-gold {
        0%   { background-position: 0% center; }
        100% { background-position: 200% center; }
    }
    @keyframes shimmer-blue {
        0%   { background-position: 0% center; }
        100% { background-position: 200% center; }
    }

    /* Expand button */
    .expand-btn {
        flex-shrink: 0;
        width: 1.6rem;
        height: 1.6rem;
        border-radius: 0.3rem;
        opacity: 0.6;
        transition: opacity 0.15s;
    }
    .expand-btn:hover { opacity: 1; }

    /* Expanded detail row */
    .expanded-detail-row td { padding: 0 !important; }

    .song-detail-box {
        display: flex;
        flex-direction: row;
        gap: 1rem;
        padding: 0.75rem 1rem;
        border-top: 1px solid rgba(128,128,128,0.2);
    }

    /* Jacket */
    .song-jacket {
        flex-shrink: 0;
        width: 96px;
        height: 96px;
        border-radius: 0.4rem;
        overflow: hidden;
        border: 1px solid rgba(128,128,128,0.3);
    }
    .song-jacket img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
    .no-jacket {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(128,128,128,0.15);
        font-size: 0.7rem;
        opacity: 0.5;
        font-style: italic;
    }

    /* Artist info */
    .song-artist-info {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        justify-content: center;
    }
    .artist-entry {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
    }
    .artist-name {
        font-weight: 600;
        font-size: 0.95rem;
    }
    .artist-links {
        display: flex;
        flex-wrap: wrap;
        gap: 0.3rem;
    }
    .artist-link {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        padding: 0.15rem 0.5rem;
        border-radius: 0.3rem;
        font-size: 0.78rem;
        font-weight: 500;
        color: #fff;
        text-decoration: none;
        transition: opacity 0.15s;
    }
    .artist-link:hover { opacity: 0.8; }
    .link-youtube   { background: #ff0000; }
    .link-soundcloud{ background: #ff5500; }
    .link-spotify   { background: #1db954; }
    .link-bandcamp  { background: #1da0c3; }
    .link-bilibili  { background: #00a1d6; }
    .link-other     { background: #555; }
</style>