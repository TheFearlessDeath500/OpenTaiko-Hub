<script>

export let SongInfo;
export let Difficulty = "Easy";
export let OnCrownClick = undefined;

$: HoFCrownColorClass = (HoFRank !== undefined)
    ? (HoFRank === 1 || Level >= 13)
        ? "text-yellow-500"
        : (HoFRank === 2 || Level >= 12)
            ? "text-zinc-400"
            : (HoFRank === 3 || Level >= 11)
                ? "text-amber-800"
                : "text-green-400"
    : "";

$: ChipColor = {
    "Easy": "blue",
    "Normal": "green",
    "Hard": "yellow",
    "Oni": "red",
    "Edit": "purple",
    "Tower": "orange",
    "Dan": "blue"
}[Difficulty];

$: HoFRank = SongInfo.chartHoFRanks?.[Difficulty];

$: Level = SongInfo.chartDifficulties[Difficulty];

$: Prefix = ["Easy", "Normal", "Hard", "Oni", "Edit"].includes(Difficulty) ? "★" : `${Difficulty} ★`;

$: Maker = ["Easy", "Normal", "Hard", "Oni", "Edit", "Tower"].includes(Difficulty) ? `Charter: ${SongInfo.chartMakers[Difficulty]}` : undefined;

</script>


{#if Level !== undefined}
    <span class="badge bg-{ChipColor}-100 text-{ChipColor}-800 levelchip" title={Maker}>{Prefix}{~~Level}</span>
    {#if HoFRank !== undefined}
        <br /><br />
        <button class="hofrank" title="OpenTaiko Hall of Fame" on:click={() => OnCrownClick?.(SongInfo, Difficulty)}>
            <i class="fa-solid fa-crown {HoFCrownColorClass}"></i> <small class="text-black dark:text-white"><b>{HoFRank}</b></small>
        </button>
    {/if}
{/if}

<style>
    .levelchip {cursor: pointer;}
    .hofrank {text-decoration: none; background: none; border: none; cursor: pointer; padding: 0;}
</style>