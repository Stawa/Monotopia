import {
  ActionTypes,
  BlockFlags,
  BlockFlags2,
  CLOTH_MAP,
  TileCollisionTypes,
} from "@growserver/const";
import { type ItemsInfo } from "@growserver/types";
import { type ItemDefinition } from "grow-items";
import { type Base } from "../core/Base";

const FLAG_LABELS: Array<[BlockFlags, string]> = [
  [BlockFlags.MULTI_FACING, "Multi Facing"],
  [BlockFlags.WRENCHABLE, "Wrenchable"],
  [BlockFlags.SEEDLESS, "Seedless"],
  [BlockFlags.PERMANENT, "Permanent"],
  [BlockFlags.DROPLESS, "Dropless"],
  [BlockFlags.WORLD_LOCKED, "World Locked"],
  [BlockFlags.AUTO_PICKUP, "Auto Pickup"],
  [BlockFlags.PUBLIC, "Public"],
  [BlockFlags.UNTRADEABLE, "Untradeable"],
];

const FLAG2_LABELS: Array<[BlockFlags2, string]> = [
  [BlockFlags2.GEMLESS, "Gemless"],
  [BlockFlags2.DUNGEON_ITEM, "Dungeon"],
  [BlockFlags2.GUILD_ITEM, "Guild"],
  [BlockFlags2.TRANSMUTABLE, "Transmutable"],
  [BlockFlags2.ONE_IN_WORLD, "One Per World"],
  [BlockFlags2.ONLY_FOR_WORLD_OWNER, "World Owner Only"],
  [BlockFlags2.NO_UPGRADE, "No Upgrade"],
  [BlockFlags2.USE_PAINT, "Uses Paint"],
];

const SUPER_RARE_RARITY = 999;
const DEFAULT_MAX_AMOUNT = 200;
const TECHNICAL_FIELD_LIMIT = 12;

const WIKI_EFFECT_OVERRIDES: Record<number, string[]> = {
  2952: ["Dig, Dug"],
  12172: ["Punch Range", "Build Range"],
  13022: ["Double Jump", "Slow Fall"],
  13024: ["Double Jump", "Slow Fall"],
  14796: ["Punch Range", "Punch Damage"],
};

const WIKI_CLOTHING_MOD_MATCHERS: Array<[string, RegExp]> = [
  [
    "Double Jump",
    /double jump|jump in mid-?air|jump again|wings?|jetpack|glider|parasol|hover|float/,
  ],
  [
    "Speedy",
    /speedy|speed boost|move faster|run faster|high speeds|agility|dash/,
  ],
  [
    "Punch Damage",
    /punch damage|punching damage|enhanced digging|break blocks faster|smash through|rip dirt apart/,
  ],
  ["Punch Range", /punch range|long punch|longer punch|reach farther/],
  ["Punch Power", /punch power/],
  ["Extra Gems", /extra gems|more gems|additional gems|bonus gems|gem drops?/],
  ["Slow Fall", /slow fall|slowfall|glide lightly|fall slowly|float gently/],
  ["High Jump", /high jump|jump higher|way up high|lift you through the air/],
  ["Punch Pull", /punch pull|pull.+punch|punch.+pull/],
  ["Build Range", /build range|place farther|build farther/],
  ["Light Source", /light source|glow in the dark|illuminat|casts? light/],
  ["Extra Blocks", /extra blocks|more blocks|bonus blocks/],
  ["Wall Climbing", /wall climbing|climb walls?|cling to walls?/],
  ["Fire Hose", /fire hose/],
  ["Fireproof", /fireproof|fire immunity|immune to fire|resist fire/],
  ["Ghost Immunity", /ghost immunity|immune to ghosts?/],
  ["Healing", /healing|heals?/],
  ["Skin Color", /skin color/],
  ["Knock Back Reduction", /knock ?back reduction|reduced knock ?back/],
  ["Damage Reduction", /damage reduction|reduced damage|takes? less damage/],
  ["Putt Putt Putt", /putt putt putt/],
  ["Slippery", /slippery/],
  ["XP Buff", /xp buff|experience boost|extra xp|bonus xp/],
  ["Miscellaneous", /miscellaneous/],
  ["Speedy in Water", /speedy in water|move faster underwater|swim faster/],
  ["Float on Water", /float on water|walk on water/],
  ["Grow Effect", /grow effect/],
  ["Zombie Weapon", /zombie weapon/],
  ["Low Jump", /low jump|jump lower/],
  ["Cookie Hunter", /cookie hunter/],
  ["Skating", /skating|ice skates?/],
];

type ItemEffectSource = {
  id?: number;
  name?: string;
  desc?: string;
  playMods?: string[];
};

export interface ItemDetails {
  id: number;
  name: string;
  description: string;
  rarity: number;
  rarityText: string;
  typeID: number;
  type: string;
  maxAmount: number;
  flags: string;
  growTime: number;
  growTimeText: string;
  breakHits: number;
  resetStateAfter: number;
  resetStateAfterText: string;
  collisionID: number;
  collision: string;
  materialID: number;
  bodyPart: string;
  recipeItems: Array<{ id: number; name: string }>;
  recipe: string;
  playMods: string[];
  permanent: boolean;
  tradeStatus: string;
  destroyInfo: string;
  placementInfo: string;
  technical: string[];
}

export function cleanItemText(value?: string): string {
  if (!value) return "";

  const cleaned = value
    .replace(/\s+/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .trim();

  return /^todo\.?$/i.test(cleaned) ? "" : cleaned;
}

export function normalizeItemName(value?: string): string {
  return cleanItemText(value).toLowerCase();
}

export function formatItemType(type: number | undefined): string {
  if (type === undefined) return "Unknown";

  return formatConstantName(ActionTypes[type]) ?? `Type ${type}`;
}

export function formatItemFlags(flags = 0, flags2 = 0): string {
  const labels = [
    ...FLAG_LABELS.filter(([flag]) => !!(flags & flag)).map(
      ([, label]) => label,
    ),
    ...FLAG2_LABELS.filter(([flag]) => !!(flags2 & flag)).map(
      ([, label]) => label,
    ),
  ];

  return labels.length ? labels.join(", ") : "None";
}

export function formatCollisionType(collisionType: number | undefined): string {
  if (collisionType === undefined) return "Unknown";

  return (
    formatConstantName(TileCollisionTypes[collisionType]) ??
    `Collision ${collisionType}`
  );
}

export function getItemEffectText(
  itemMeta: ItemDefinition | undefined,
  itemInfo: ItemEffectSource | undefined,
): string {
  const wikiEffects = getWikiEffectOverrides(itemMeta, itemInfo);

  return cleanItemText(
    [
      itemMeta?.name,
      itemMeta?.info,
      itemMeta?.extraOptions,
      itemMeta?.extraOptions2,
      itemMeta?.punchOptions,
      itemInfo?.name,
      itemInfo?.desc,
      ...(itemInfo?.playMods ?? []),
      ...wikiEffects,
    ].join(" "),
  ).toLowerCase();
}

function getWikiEffectOverrides(
  itemMeta: ItemDefinition | undefined,
  itemInfo: ItemEffectSource | undefined,
): string[] {
  const itemID = itemMeta?.id ?? itemInfo?.id;
  if (itemID === undefined) return [];

  return WIKI_EFFECT_OVERRIDES[itemID] ?? [];
}

export function itemHasPunchDamageEffect(
  itemMeta: ItemDefinition | undefined,
  itemInfo: ItemEffectSource | undefined,
): boolean {
  const itemName = normalizeItemName(itemInfo?.name || itemMeta?.name);
  const modText = getItemEffectText(itemMeta, itemInfo);
  const wikiEffects = getWikiEffectOverrides(itemMeta, itemInfo);

  return (
    wikiEffects.includes("Punch Damage") ||
    /punch damage|punching damage|enhanced digging|break blocks faster|smash through|rip dirt apart/.test(
      modText,
    ) ||
    /dragoscarf|pickaxe|drill|rock hammer|rock chisel/.test(itemName)
  );
}

function addWikiClothingModLabels(
  effects: Set<string>,
  combinedText: string,
): void {
  WIKI_CLOTHING_MOD_MATCHERS.forEach(([label, matcher]) => {
    if (matcher.test(combinedText)) effects.add(label);
  });
}

export function inferItemEffects(
  itemMeta: ItemDefinition | undefined,
  itemInfo: ItemEffectSource | undefined,
): string[] {
  const effects = new Set(
    itemInfo?.playMods?.map(cleanItemText).filter(Boolean) ?? [],
  );
  const itemName = normalizeItemName(itemInfo?.name || itemMeta?.name);
  const modText = getItemEffectText(itemMeta, itemInfo);
  const combinedText = `${itemName} ${modText}`;

  getWikiEffectOverrides(itemMeta, itemInfo).forEach((effect) => {
    effects.add(effect);
  });

  addWikiClothingModLabels(effects, combinedText);

  if (itemHasPunchDamageEffect(itemMeta, itemInfo)) {
    if (!effects.has("Punch Damage") && !effects.has("Dig, Dug")) {
      effects.add("Enhanced Digging");
    }
  }

  if (/harvester|harvest/.test(combinedText)) {
    effects.add("Harvester");
  }

  return [...effects];
}

function getWikiItem(base: Base, itemID: number): ItemsInfo | undefined {
  return base.items.wiki.find((item) => item.id === itemID);
}

function getItemName(base: Base, itemID: number): string {
  const wikiName = cleanItemText(getWikiItem(base, itemID)?.name);
  if (wikiName) return wikiName;

  return (
    cleanItemText(base.items.metadata.items.get(itemID.toString())?.name) ||
    `Item ${itemID}`
  );
}

function getMetadataText(itemMeta: ItemDefinition | undefined): string {
  return cleanItemText(
    [
      itemMeta?.info,
      itemMeta?.extraOptions,
      itemMeta?.extraOptions2,
      itemMeta?.punchOptions,
    ].join(" "),
  );
}

function inferDescription(
  base: Base,
  itemID: number,
  itemMeta: ItemDefinition | undefined,
  itemInfo: ItemsInfo | undefined,
): string {
  const wikiDescription = cleanItemText(itemInfo?.desc);
  if (wikiDescription) return wikiDescription;

  const metadataDescription = getMetadataText(itemMeta);
  if (metadataDescription) return metadataDescription;

  const itemName = itemInfo?.name || itemMeta?.name || `Item ${itemID}`;
  const type = itemMeta?.type;
  const typeName = formatItemType(type).toLowerCase().replace(/_/g, " ");
  const playMods = inferItemEffects(itemMeta, itemInfo);

  if (type === ActionTypes.SEED) {
    const blockName =
      base.items.metadata.items.get((itemID - 1).toString())?.name ?? itemName;
    return `A seed that can be planted or spliced. It grows into ${blockName}.`;
  }

  if (type === ActionTypes.CLOTHES || type === ActionTypes.ANCES) {
    return playMods.length
      ? `A wearable item. Effects: ${playMods.join(", ")}.`
      : "A wearable item that can be equipped from your backpack.";
  }

  if (type === ActionTypes.LOCK) {
    return "A lock used to protect blocks and control who can build in an area.";
  }

  if (
    type === ActionTypes.DOOR ||
    type === ActionTypes.MAIN_DOOR ||
    type === ActionTypes.PORTAL ||
    type === ActionTypes.GATEWAY ||
    type === ActionTypes.FRIENDS_ENTRANCE
  ) {
    return "A door or entrance that can move players to another door or world.";
  }

  if (type === ActionTypes.VENDING_MACHINE) {
    return (
      "A lock-owned machine that stores one tradeable item type and sells it " +
      "for World Locks. Owners can stock it, empty it, and choose either " +
      "World Locks per item or items per World Lock pricing."
    );
  }

  if (type === ActionTypes.STATS_BLOCK) {
    return "A wrenchable stats block that scans world blocks and floating items.";
  }

  if (type === ActionTypes.DISPLAY_BLOCK) {
    return "A display block that can hold and show one tradeable item.";
  }

  if (type === ActionTypes.DICE) {
    return "A dice block that rolls a random face when punched.";
  }

  if (type === ActionTypes.WEATHER_MACHINE) {
    return "A weather machine that changes the world's weather while active.";
  }

  if (type === ActionTypes.SIGN) {
    return "A writable sign that displays custom text when viewed.";
  }

  if (type === ActionTypes.BACKGROUND) {
    return "A background block used to decorate worlds.";
  }

  if (type === ActionTypes.FOREGROUND) {
    return "A placeable foreground block used to build worlds.";
  }

  return `A ${typeName} item.`;
}

function getRecipeItemIDs(
  itemMeta: ItemDefinition | undefined,
  itemInfo: ItemsInfo | undefined,
): number[] {
  const wikiRecipe = itemInfo?.recipe?.splice ?? [];
  if (wikiRecipe.length) return wikiRecipe.filter(Number.isInteger);

  return (itemMeta?.recipe ?? []).filter(Number.isInteger);
}

function formatRecipe(
  recipeItems: Array<{ id: number; name: string }>,
): string {
  if (!recipeItems.length) return "";

  return recipeItems.map((item) => `${item.name} (#${item.id})`).join(" + ");
}

function getRecipeItems(
  base: Base,
  itemMeta: ItemDefinition | undefined,
  itemInfo: ItemsInfo | undefined,
): Array<{ id: number; name: string }> {
  return getRecipeItemIDs(itemMeta, itemInfo).map((id) => ({
    id,
    name: getItemName(base, id),
  }));
}

function formatDuration(seconds: number): string {
  const totalSeconds = Math.max(0, Math.trunc(seconds));
  if (totalSeconds <= 0) return "None";

  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  const parts = [
    days ? `${days}d` : "",
    hours ? `${hours}h` : "",
    minutes ? `${minutes}m` : "",
    secs || (!days && !hours && !minutes) ? `${secs}s` : "",
  ].filter(Boolean);

  return parts.join(" ");
}

function formatConstantName(value: string | undefined): string | undefined {
  if (!value) return undefined;

  return value
    .toLowerCase()
    .split("_")
    .map((part) => {
      if (part === "vip") return "VIP";
      if (part === "sfx") return "SFX";
      if (part === "pve") return "PVE";
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function formatRarity(rarity: number): string {
  if (rarity >= SUPER_RARE_RARITY) return "Super Rare";
  if (rarity <= 0) return "N/A";

  return `${rarity}`;
}

function formatBodyPart(itemMeta: ItemDefinition | undefined): string {
  if (
    itemMeta?.type !== ActionTypes.CLOTHES &&
    itemMeta?.type !== ActionTypes.ANCES
  ) {
    return "";
  }

  const slot = CLOTH_MAP[itemMeta.bodyPartType as keyof typeof CLOTH_MAP];
  if (!slot) return `Slot ${itemMeta.bodyPartType ?? 0}`;

  return slot.charAt(0).toUpperCase() + slot.slice(1);
}

function formatTradeStatus(itemMeta: ItemDefinition | undefined): string {
  if (!itemMeta) return "Unknown";
  if ((itemMeta.flags ?? 0) & BlockFlags.UNTRADEABLE) return "Untradeable";

  return "Tradeable";
}

function formatDestroyInfo(itemMeta: ItemDefinition | undefined): string {
  if (!itemMeta) return "";

  const flags = itemMeta.flags ?? 0;
  const flags2 = itemMeta.flags2 ?? 0;
  const rarity = itemMeta.rarity ?? 0;

  if (flags & BlockFlags.PERMANENT) {
    return "Returns to your backpack when broken if you have room.";
  }
  if (flags & BlockFlags.DROPLESS) return "Does not drop itself when broken.";
  if (flags2 & BlockFlags2.GEMLESS) return "Does not drop gems.";
  if (rarity >= SUPER_RARE_RARITY) return "Super rare; gem drops are disabled.";
  if (rarity > 0) return `Can drop gems based on rarity ${rarity}.`;

  return "";
}

function formatPlacementInfo(itemMeta: ItemDefinition | undefined): string {
  if (!itemMeta) return "";

  const labels: string[] = [];
  const flags = itemMeta.flags ?? 0;
  const flags2 = itemMeta.flags2 ?? 0;

  if (flags & BlockFlags.WORLD_LOCKED) labels.push("World Locked worlds only");
  if (flags & BlockFlags.WRENCHABLE) labels.push("Wrenchable");
  if (flags & BlockFlags.PUBLIC) labels.push("Public");
  if (flags2 & BlockFlags2.ONE_IN_WORLD) labels.push("One per world");
  if (flags2 & BlockFlags2.ONLY_FOR_WORLD_OWNER) {
    labels.push("World owner only");
  }

  return labels.join(", ");
}

function formatTechnicalDetails(
  itemMeta: ItemDefinition | undefined,
): string[] {
  if (!itemMeta) return [];

  const technical = [
    `Type ID: ${itemMeta.type ?? 0}`,
    `Collision ID: ${itemMeta.collisionType ?? 0}`,
    `Material ID: ${itemMeta.materialType ?? 0}`,
    `Texture: ${itemMeta.texture ?? "none"} (${itemMeta.textureX ?? 0}, ${
      itemMeta.textureY ?? 0
    })`,
    itemMeta.storageType ? `Storage ID: ${itemMeta.storageType}` : "",
    itemMeta.visualEffectType
      ? `Visual effect: ${itemMeta.visualEffectType}`
      : "",
    itemMeta.tileRange ? `Tile range: ${itemMeta.tileRange}` : "",
    itemMeta.lightRange ? `Light range: ${itemMeta.lightRange}` : "",
    itemMeta.vaultCapacity ? `Vault capacity: ${itemMeta.vaultCapacity}` : "",
    `Flags: 0x${(itemMeta.flags ?? 0).toString(16)}`,
    itemMeta.flags2 ? `Flags2: 0x${itemMeta.flags2.toString(16)}` : "",
    itemMeta.flags3 ? `Flags3: 0x${itemMeta.flags3.toString(16)}` : "",
  ].filter(Boolean);

  return technical.slice(0, TECHNICAL_FIELD_LIMIT);
}

export function hasItemDetails(base: Base, itemID: number): boolean {
  return (
    base.items.metadata.items.has(itemID.toString()) ||
    base.items.wiki.some((item) => item.id === itemID)
  );
}

export function getItemDetails(base: Base, itemID: number): ItemDetails {
  const itemMeta = base.items.metadata.items.get(itemID.toString());
  const itemInfo = getWikiItem(base, itemID);
  const name = getItemName(base, itemID);
  const rarity = itemMeta?.rarity ?? 0;
  const recipeItems = getRecipeItems(base, itemMeta, itemInfo);

  return {
    id: itemID,
    name,
    description: inferDescription(base, itemID, itemMeta, itemInfo),
    rarity,
    rarityText: formatRarity(rarity),
    typeID: itemMeta?.type ?? -1,
    type: formatItemType(itemMeta?.type),
    maxAmount: itemMeta?.maxAmount ?? DEFAULT_MAX_AMOUNT,
    flags: formatItemFlags(itemMeta?.flags, itemMeta?.flags2),
    growTime: itemMeta?.growTime ?? 0,
    growTimeText: formatDuration(itemMeta?.growTime ?? 0),
    breakHits: itemMeta?.breakHits ?? 0,
    resetStateAfter: itemMeta?.resetStateAfter ?? 0,
    resetStateAfterText: formatDuration(itemMeta?.resetStateAfter ?? 0),
    collisionID: itemMeta?.collisionType ?? -1,
    collision: formatCollisionType(itemMeta?.collisionType),
    materialID: itemMeta?.materialType ?? 0,
    bodyPart: formatBodyPart(itemMeta),
    recipeItems,
    recipe: formatRecipe(recipeItems),
    playMods: inferItemEffects(itemMeta, itemInfo),
    permanent: !!((itemMeta?.flags ?? 0) & BlockFlags.PERMANENT),
    tradeStatus: formatTradeStatus(itemMeta),
    destroyInfo: formatDestroyInfo(itemMeta),
    placementInfo: formatPlacementInfo(itemMeta),
    technical: formatTechnicalDetails(itemMeta),
  };
}
