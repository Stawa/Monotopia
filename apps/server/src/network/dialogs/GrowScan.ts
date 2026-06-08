import { type NonEmptyObject } from "type-fest";
import { Variant } from "growtopia.js";
import { type ItemDefinition } from "grow-items";
import { DialogBuilder } from "@growserver/utils";
import { ActionTypes, BlockFlags } from "@growserver/const";
import type { Base } from "../../core/Base";
import type { Peer } from "../../core/Peer";
import type { World } from "../../core/World";

const ITEM_GROWSCAN_9000 = 6016;
const ITEM_GEM = 112;
const RESULTS_PER_PAGE = 50;
const MAX_QUERY_LENGTH = 40;
const MAX_STORED_LOCATIONS = 8;

const BLOCK_FILTER_LABELS = {
  all:         "All",
  foreground:  "Blocks",
  background:  "Backgrounds",
  untradeable: "Untradeable",
} as const;

const ITEM_FILTER_LABELS = {
  all:         "All",
  clothes:     "Clothes",
  consumables: "Consumables",
  blocks:      "Blocks",
  seeds:       "Seeds",
  locks:       "Locks",
  other:       "Other",
} as const;

const CHI_LABELS = {
  earth: "Earth",
  wind:  "Wind",
  fire:  "Fire",
  water: "Water",
  none:  "None",
} as const;

const FLOATING_BLOCK_TYPES = new Set<number>([
  ActionTypes.FOREGROUND,
  ActionTypes.BACKGROUND,
  ActionTypes.DEADLY_BLOCK,
  ActionTypes.TRAMPOLINE,
  ActionTypes.PLATFORM,
  ActionTypes.BEDROCK,
  ActionTypes.LAVA,
  ActionTypes.FOREGROUND_WITH_EXTRA_FRAME,
  ActionTypes.BACKGD_SFX_EXTRA_FRAME,
  ActionTypes.BOUNCY,
  ActionTypes.POINTY,
  ActionTypes.CHECKPOINT,
  ActionTypes.ICE,
  ActionTypes.DICE,
  ActionTypes.CHEMICAL,
  ActionTypes.PROVIDER,
  ActionTypes.LAB,
  ActionTypes.WEATHER_MACHINE,
  ActionTypes.DISPLAY_BLOCK,
  ActionTypes.VENDING_MACHINE,
  ActionTypes.STATS_BLOCK,
]);

type GrowScanMode = "blocks" | "items";
type BlockFilter = keyof typeof BLOCK_FILTER_LABELS;
type ItemFilter = keyof typeof ITEM_FILTER_LABELS;
type GrowScanFilter = BlockFilter | ItemFilter;
type Chi = keyof typeof CHI_LABELS;
type ScanLayer = "foreground" | "background" | "floating";

type GrowScanAction = NonEmptyObject<
  Record<string, string> & {
    dialog_name: string;
    buttonClicked?: string;
    mode?: string;
    filter?: string;
    page?: string;
    query?: string;
    tilex?: string;
    tiley?: string;
  }
>;

type GrowScanDialogOptions = {
  mode?: GrowScanMode;
  filter?: GrowScanFilter;
  page?: number;
  query?: string;
  tileX?: number;
  tileY?: number;
};

type ScanLocation = {
  x: number;
  y: number;
  layer: ScanLayer;
  amount?: number;
};

type ScanEntry = {
  id: number;
  item: ItemDefinition;
  name: string;
  count: number;
  foreground: number;
  background: number;
  stackCount: number;
  locationCount: number;
  rarity: number;
  superRare: boolean;
  untradeable: boolean;
  chi: Chi;
  locations: ScanLocation[];
};

type BlockStats = {
  blocks: number;
  backgrounds: number;
  untradeable: number;
  superRare: number;
  totalRarity: number;
  unique: number;
  chi: Map<Chi, number>;
};

type FloatingStats = {
  stacks: number;
  amount: number;
  gems: number;
  superRare: number;
  totalRarity: number;
  unique: number;
};

export class GrowScan {
  constructor(
    public base: Base,
    public peer: Peer,
    public action: GrowScanAction,
  ) {}

  public async execute(): Promise<void> {
    const buttonClicked = this.action.buttonClicked ?? "";
    if (buttonClicked === "Close") return;

    const previousMode = normalizeMode(this.action.mode);
    const mode = getTargetMode(buttonClicked, previousMode);
    const filter =
      mode === previousMode
        ? getTargetFilter(mode, buttonClicked, this.action.filter)
        : "all";
    const page = getTargetPage(buttonClicked, this.action.page);
    const query = getQuery(this.action.query);

    if (buttonClicked.startsWith("result_")) {
      sendLocationHint(this.base, this.peer, mode, buttonClicked, filter);
    }

    sendGrowScanDialog(this.base, this.peer, {
      mode,
      filter,
      page,
      query,
      tileX: parseNumber(this.action.tilex),
      tileY: parseNumber(this.action.tiley),
    });
  }
}

export function sendGrowScanDialog(
  base: Base,
  peer: Peer,
  options: GrowScanDialogOptions = {},
): void {
  const world = peer.currentWorld();
  if (!world) return;

  const mode = options.mode ?? "blocks";
  const filter = normalizeFilter(mode, options.filter);
  const query = getQuery(options.query);

  const blockEntries = scanWorldBlocks(base, world);
  const floatingEntries = scanFloatingItems(base, world);
  const blockStats = getBlockStats(blockEntries);
  const floatingStats = getFloatingStats(floatingEntries);
  const sourceEntries = mode === "blocks" ? blockEntries : floatingEntries;
  const entries = applySearch(applyFilter(sourceEntries, mode, filter), query);
  const maxPage = Math.max(0, Math.ceil(entries.length / RESULTS_PER_PAGE) - 1);
  const currentPage = Math.min(maxPage, Math.max(0, options.page ?? 0));
  const pageEntries = entries.slice(
    currentPage * RESULTS_PER_PAGE,
    currentPage * RESULTS_PER_PAGE + RESULTS_PER_PAGE,
  );

  const dialog = new DialogBuilder()
    .defaultColor()
    .addLabelWithIcon("`wGrowScan 9000``", ITEM_GROWSCAN_9000, "big")
    .addSmallText(`World: \`w${cleanDialogText(world.worldName)}\`\``)
    .addButton(
      "mode_blocks",
      mode === "blocks" ? "`2World Blocks``" : "`wWorld Blocks``",
    )
    .addButton(
      "mode_items",
      mode === "items" ? "`2Floating Items``" : "`wFloating Items``",
    )
    .addCustomBreak();

  addFilterButtons(dialog, mode, filter);

  dialog
    .addInputBox("query", "Search:", query, MAX_QUERY_LENGTH)
    .addButton("search", "`2Search``")
    .embed("mode", mode)
    .embed("filter", filter)
    .embed("page", currentPage)
    .embed("tilex", options.tileX ?? 0)
    .embed("tiley", options.tileY ?? 0)
    .addSpacer("small");

  if (mode === "blocks") {
    addBlockSummary(dialog, blockStats);
  } else {
    addFloatingSummary(dialog, floatingStats);
  }

  dialog.addSpacer("small");

  if (!entries.length) {
    dialog.addTextBox(
      query
        ? "`oNo scanned items matched that search.``"
        : "`oNothing found for this scan view.``",
    );
  } else {
    dialog.addSmallText(
      `Results: \`w${entries.length}\`\`, Page \`w${currentPage + 1}/${
        maxPage + 1
      }\`\``,
    );

    for (const entry of pageEntries) {
      dialog.addButtonWithIcon(
        `result_${mode}_${entry.id}`,
        entry.id,
        formatEntryLabel(mode, entry),
        "left",
        clampIconCount(entry.count),
      );
    }
  }

  if (maxPage > 0) {
    dialog.addSpacer("small");
    if (currentPage > 0) dialog.addButton("page_prev", "`wPrevious Page``");
    if (currentPage < maxPage) dialog.addButton("page_next", "`wNext Page``");
  }

  dialog.addSpacer("small").addQuickExit().endDialog("growscan", "Close", "");

  peer.send(Variant.from("OnDialogRequest", dialog.str()));
}

function scanWorldBlocks(base: Base, world: World): ScanEntry[] {
  const entries = new Map<number, ScanEntry>();
  const chiByID = getChiLookup(base);

  for (const block of world.data.blocks) {
    addBlockEntry(base, entries, chiByID, block.fg, {
      x:     block.x,
      y:     block.y,
      layer: "foreground",
    });
    addBlockEntry(base, entries, chiByID, block.bg, {
      x:     block.x,
      y:     block.y,
      layer: "background",
    });
  }

  return sortEntries(Array.from(entries.values()));
}

function scanFloatingItems(base: Base, world: World): ScanEntry[] {
  const entries = new Map<number, ScanEntry>();
  const chiByID = getChiLookup(base);

  for (const dropped of world.data.dropped?.items ?? []) {
    if (!dropped.id || dropped.amount <= 0) continue;

    const entry = getOrCreateEntry(base, entries, chiByID, dropped.id);
    if (!entry) continue;

    entry.count += dropped.amount;
    entry.stackCount += 1;
    entry.locationCount += 1;
    if (entry.locations.length < MAX_STORED_LOCATIONS) {
      entry.locations.push({
        x:      dropped.block?.x ?? Math.floor(dropped.x / 32),
        y:      dropped.block?.y ?? Math.floor(dropped.y / 32),
        layer:  "floating",
        amount: dropped.amount,
      });
    }
  }

  return sortEntries(Array.from(entries.values()));
}

function addBlockEntry(
  base: Base,
  entries: Map<number, ScanEntry>,
  chiByID: Map<number, Chi>,
  itemID: number,
  location: ScanLocation,
): void {
  if (!itemID) return;

  const entry = getOrCreateEntry(base, entries, chiByID, itemID);
  if (!entry) return;

  entry.count += 1;
  entry.locationCount += 1;
  if (location.layer === "foreground") entry.foreground += 1;
  if (location.layer === "background") entry.background += 1;
  if (entry.locations.length < MAX_STORED_LOCATIONS) {
    entry.locations.push(location);
  }
}

function getOrCreateEntry(
  base: Base,
  entries: Map<number, ScanEntry>,
  chiByID: Map<number, Chi>,
  itemID: number,
): ScanEntry | undefined {
  const existing = entries.get(itemID);
  if (existing) return existing;

  const item = base.items.metadata.items.get(itemID.toString());
  if (!item) return undefined;

  const entry: ScanEntry = {
    id:            itemID,
    item,
    name:          item.name ?? `Item ${itemID}`,
    count:         0,
    foreground:    0,
    background:    0,
    stackCount:    0,
    locationCount: 0,
    rarity:        normalizeRarity(item),
    superRare:     isSuperRare(item),
    untradeable:   !!((item.flags ?? 0) & BlockFlags.UNTRADEABLE),
    chi:           chiByID.get(itemID) ?? "none",
    locations:     [],
  };

  entries.set(itemID, entry);
  return entry;
}

function getBlockStats(entries: ScanEntry[]): BlockStats {
  const chi = new Map<Chi, number>();
  const stats: BlockStats = {
    blocks:      0,
    backgrounds: 0,
    untradeable: 0,
    superRare:   0,
    totalRarity: 0,
    unique:      entries.length,
    chi,
  };

  for (const entry of entries) {
    stats.blocks += entry.foreground;
    stats.backgrounds += entry.background;
    if (entry.untradeable) stats.untradeable += entry.count;
    if (entry.superRare) stats.superRare += entry.count;
    stats.totalRarity += getRarityTotal(entry);
    chi.set(entry.chi, (chi.get(entry.chi) ?? 0) + entry.count);
  }

  return stats;
}

function getFloatingStats(entries: ScanEntry[]): FloatingStats {
  const stats: FloatingStats = {
    stacks:      0,
    amount:      0,
    gems:        0,
    superRare:   0,
    totalRarity: 0,
    unique:      entries.length,
  };

  for (const entry of entries) {
    stats.stacks += entry.stackCount;
    stats.amount += entry.count;
    if (entry.id === ITEM_GEM) stats.gems += entry.count;
    if (entry.superRare) stats.superRare += entry.count;
    stats.totalRarity += getRarityTotal(entry);
  }

  return stats;
}

function addBlockSummary(dialog: DialogBuilder, stats: BlockStats): void {
  dialog
    .addSmallText(
      `Blocks: \`w${formatNumber(stats.blocks)}\`\`, Backgrounds: \`w${formatNumber(
        stats.backgrounds,
      )}\`\`, Untradeable: \`w${formatNumber(stats.untradeable)}\`\``,
    )
    .addSmallText(
      `Super Rare: \`w${formatNumber(
        stats.superRare,
      )}\`\`, Total Rarity: \`w${formatNumber(
        stats.totalRarity,
      )}\`\`, Unique: \`w${formatNumber(stats.unique)}\`\``,
    );

  const chiText = Array.from(stats.chi.entries())
    .filter(([chi, count]) => chi !== "none" && count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([chi, count]) => `${CHI_LABELS[chi]} ${formatNumber(count)}`)
    .join(", ");

  if (chiText) dialog.addSmallText(`Chi: \`w${chiText}\`\``);
}

function addFloatingSummary(dialog: DialogBuilder, stats: FloatingStats): void {
  dialog
    .addSmallText(
      `Floating Items: \`w${formatNumber(
        stats.amount,
      )}\`\`, Stacks: \`w${formatNumber(
        stats.stacks,
      )}\`\`, Gems: \`w${formatNumber(stats.gems)}\`\``,
    )
    .addSmallText(
      `Super Rare: \`w${formatNumber(
        stats.superRare,
      )}\`\`, Total Rarity: \`w${formatNumber(
        stats.totalRarity,
      )}\`\`, Unique: \`w${formatNumber(stats.unique)}\`\``,
    );
}

function addFilterButtons(
  dialog: DialogBuilder,
  mode: GrowScanMode,
  activeFilter: GrowScanFilter,
): void {
  const labels = mode === "blocks" ? BLOCK_FILTER_LABELS : ITEM_FILTER_LABELS;

  for (const [filter, label] of Object.entries(labels)) {
    dialog.addButton(
      `filter_${filter}`,
      activeFilter === filter ? `\`2${label}\`\`` : `\`w${label}\`\``,
    );
  }

  dialog.addCustomBreak();
}

function applyFilter(
  entries: ScanEntry[],
  mode: GrowScanMode,
  filter: GrowScanFilter,
): ScanEntry[] {
  if (mode === "blocks") {
    return applyBlockFilter(entries, filter as BlockFilter);
  }

  return entries.filter((entry) => {
    const itemFilter = filter as ItemFilter;
    if (itemFilter === "all") return true;
    return getFloatingFilter(entry.item) === itemFilter;
  });
}

function applyBlockFilter(
  entries: ScanEntry[],
  filter: BlockFilter,
): ScanEntry[] {
  if (filter === "all") return entries;

  return entries
    .map((entry) => {
      if (filter === "foreground" && entry.foreground > 0) {
        return cloneEntryForLayer(entry, entry.foreground, "foreground");
      }
      if (filter === "background" && entry.background > 0) {
        return cloneEntryForLayer(entry, entry.background, "background");
      }
      if (filter === "untradeable" && entry.untradeable) return entry;

      return undefined;
    })
    .filter((entry): entry is ScanEntry => !!entry);
}

function cloneEntryForLayer(
  entry: ScanEntry,
  count: number,
  layer: ScanLayer,
): ScanEntry {
  return {
    ...entry,
    count,
    foreground:    layer === "foreground" ? count : 0,
    background:    layer === "background" ? count : 0,
    locationCount: count,
    locations:     entry.locations.filter((location) => location.layer === layer),
  };
}

function applySearch(entries: ScanEntry[], query: string): ScanEntry[] {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return entries;

  return entries.filter((entry) => {
    return (
      entry.id.toString().startsWith(normalizedQuery) ||
      normalize(entry.name).includes(normalizedQuery)
    );
  });
}

function sendLocationHint(
  base: Base,
  peer: Peer,
  mode: GrowScanMode,
  buttonClicked: string,
  filter: GrowScanFilter,
): void {
  const world = peer.currentWorld();
  if (!world) return;

  const itemID = Number.parseInt(buttonClicked.split("_").pop() ?? "", 10);
  if (!Number.isInteger(itemID)) return;

  const entries =
    mode === "blocks"
      ? applyFilter(scanWorldBlocks(base, world), mode, filter)
      : applyFilter(scanFloatingItems(base, world), mode, filter);
  const entry = entries.find((result) => result.id === itemID);
  const location = entry?.locations[0];
  if (!entry || !location) return;

  const extraLocations = Math.max(0, entry.locationCount - 1);
  const suffix =
    extraLocations > 0
      ? ` and \`w${formatNumber(extraLocations)}\`\` more spot${
        extraLocations === 1 ? "" : "s"
      }`
      : "";
  const amount =
    location.layer === "floating" && location.amount
      ? ` Amount here: \`w${formatNumber(location.amount)}\`\`.`
      : "";

  peer.sendConsoleMessage(
    `GrowScan found \`w${cleanDialogText(entry.name)}\`\` at \`2${location.x}, ${
      location.y
    }\`\`${suffix}.${amount}`,
  );
}

function getFloatingFilter(item: ItemDefinition): ItemFilter {
  const type = item.type ?? -1;

  if (type === ActionTypes.CLOTHES || type === ActionTypes.ANCES) {
    return "clothes";
  }
  if (type === ActionTypes.CONSUMABLE) return "consumables";
  if (type === ActionTypes.SEED) return "seeds";
  if (type === ActionTypes.LOCK) return "locks";
  if (
    FLOATING_BLOCK_TYPES.has(type) ||
    (item.flags ?? 0) & BlockFlags.FOREGROUND
  ) {
    return "blocks";
  }

  return "other";
}

function getTargetMode(
  buttonClicked: string,
  previousMode: GrowScanMode,
): GrowScanMode {
  if (buttonClicked === "mode_items") return "items";
  if (buttonClicked === "mode_blocks") return "blocks";

  return previousMode;
}

function getTargetFilter(
  mode: GrowScanMode,
  buttonClicked: string,
  currentFilter?: string,
): GrowScanFilter {
  const clickedFilter = buttonClicked.startsWith("filter_")
    ? buttonClicked.slice("filter_".length)
    : undefined;

  return normalizeFilter(mode, clickedFilter ?? currentFilter);
}

function getTargetPage(buttonClicked: string, page?: string): number {
  const currentPage = parseNumber(page) ?? 0;

  if (
    buttonClicked === "search" ||
    buttonClicked === "mode_blocks" ||
    buttonClicked === "mode_items" ||
    buttonClicked.startsWith("filter_")
  ) {
    return 0;
  }
  if (buttonClicked === "page_prev") return currentPage - 1;
  if (buttonClicked === "page_next") return currentPage + 1;

  return currentPage;
}

function normalizeMode(mode?: string): GrowScanMode {
  return mode === "items" ? "items" : "blocks";
}

function normalizeFilter(mode: GrowScanMode, filter?: string): GrowScanFilter {
  if (mode === "blocks" && isBlockFilter(filter)) return filter;
  if (mode === "items" && isItemFilter(filter)) return filter;

  return "all";
}

function isBlockFilter(filter?: string): filter is BlockFilter {
  return !!filter && Object.hasOwn(BLOCK_FILTER_LABELS, filter);
}

function isItemFilter(filter?: string): filter is ItemFilter {
  return !!filter && Object.hasOwn(ITEM_FILTER_LABELS, filter);
}

function getChiLookup(base: Base): Map<number, Chi> {
  const lookup = new Map<number, Chi>();

  for (const item of base.items.wiki ?? []) {
    if (item.chi === "earth" || item.chi === "wind") {
      lookup.set(item.id, item.chi);
    } else if (item.chi === "fire" || item.chi === "water") {
      lookup.set(item.id, item.chi);
    }
  }

  return lookup;
}

function sortEntries(entries: ScanEntry[]): ScanEntry[] {
  return entries.sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name) || a.id - b.id,
  );
}

function formatEntryLabel(mode: GrowScanMode, entry: ScanEntry): string {
  const name = cleanDialogText(entry.name);
  const rarity = entry.superRare ? "Super Rare" : `Rarity ${entry.rarity}`;
  const count =
    mode === "items" && entry.stackCount > 1
      ? `${formatNumber(entry.count)} in ${formatNumber(entry.stackCount)} stacks`
      : formatNumber(entry.count);

  return `\`w${name}\`\` \`o#${entry.id} / ${count} / ${rarity}`;
}

function getRarityTotal(entry: ScanEntry): number {
  if (entry.superRare) return 0;

  return entry.rarity * entry.count;
}

function normalizeRarity(item: ItemDefinition): number {
  return Math.max(0, Math.trunc(item.rarity ?? 0));
}

function isSuperRare(item: ItemDefinition): boolean {
  return normalizeRarity(item) >= 999;
}

function clampIconCount(count: number): number {
  return Math.min(200, Math.max(0, Math.trunc(count)));
}

function getQuery(value?: string): string {
  return (value ?? "").trim().slice(0, MAX_QUERY_LENGTH);
}

function normalize(value?: string): string {
  return (value ?? "").trim().toLowerCase();
}

function parseNumber(value?: string): number | undefined {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatNumber(value: number): string {
  return Math.trunc(value).toLocaleString("en-US");
}

function cleanDialogText(value?: string): string {
  return (value ?? "")
    .replace(/\|/g, "/")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 60);
}
