import type { ItemDefinition, ItemsDat } from "grow-items";

const ITEMS_DAT_KEY = "PBG892FXX982ABC*";

type ItemsBuffer = ItemsDat["buffer"];

export async function decodeItemsDatCompat(itemsDat: ItemsDat): Promise<void> {
  const buffer = itemsDat.buffer;

  buffer.mempos = 0;
  itemsDat.meta.version = buffer.readU16();
  itemsDat.meta.itemCount = buffer.readI32();
  itemsDat.meta.items.clear();

  for (let index = 0; index < itemsDat.meta.itemCount; index++) {
    const item = readItem(buffer, itemsDat.meta.version);

    if (item.id !== index) {
      throw new Error(
        `items.dat decode desynced at item ${index}; read item id ${item.id}`,
      );
    }

    itemsDat.meta.items.set(item.id, item);
  }
}

function readItem(buffer: ItemsBuffer, version = 0): ItemDefinition {
  const item: ItemDefinition = {};

  item.id = buffer.readI32();
  item.flags = buffer.readU16();
  item.type = buffer.readU8();
  item.materialType = buffer.readU8();
  item.name = readString(buffer, item.id, true);
  item.texture = readString(buffer, item.id);
  item.textureHash = buffer.readI32();
  item.visualEffectType = buffer.readU8();
  item.cookingTime = buffer.readI32();
  item.textureX = buffer.readU8();
  item.textureY = buffer.readU8();
  item.storageType = buffer.readU8();
  item.isStripeyWallpaper = buffer.readU8();
  item.collisionType = buffer.readU8();
  item.breakHits = buffer.readU8() / 6;
  item.resetStateAfter = buffer.readI32();
  item.bodyPartType = buffer.readU8();
  item.rarity = buffer.readI16();
  item.maxAmount = buffer.readU8();
  item.extraFile = readString(buffer, item.id);
  item.extraFileHash = buffer.readI32();
  item.audioVolume = buffer.readI32();
  item.petName = readString(buffer, item.id);
  item.petPrefix = readString(buffer, item.id);
  item.petSuffix = readString(buffer, item.id);
  item.petAbility = readString(buffer, item.id);
  item.seedBase = buffer.readU8();
  item.seedOverlay = buffer.readU8();
  item.treeBase = buffer.readU8();
  item.treeLeaves = buffer.readU8();
  item.seedColor = buffer.readI32();
  item.seedOverlayColor = buffer.readI32();
  item.ingredient = buffer.readI32();
  item.growTime = buffer.readI32();
  item.fxFlags = buffer.readI32();
  item.extraOptions = readString(buffer, item.id);
  item.texture2 = readString(buffer, item.id);
  item.extraOptions2 = readString(buffer, item.id);
  item.unknownInt1 = buffer.readI32();
  item.unknownInt2 = buffer.readI32();
  item.flags2 = buffer.readI32();
  item.extraBytes = readBytes(buffer, 60);
  item.tileRange = buffer.readI32();
  item.vaultCapacity = buffer.readI32();

  if (version >= 11) item.punchOptions = readString(buffer, item.id);
  if (version >= 12) {
    item.flags3 = buffer.readI32();
    item.bodyPart = readBytes(buffer, 9);
  }
  if (version >= 13) item.lightRange = buffer.readI32();
  if (version >= 14) item.unknownInt3 = buffer.readI32();
  if (version >= 15) {
    item.canSit = buffer.readU8();
    item.playerOffsetX = buffer.readI32();
    item.playerOffsetY = buffer.readI32();
    item.chairTextureX = buffer.readI32();
    item.chairTextureY = buffer.readI32();
    item.chairLegOffsetX = buffer.readI32();
    item.chairLegOffsetY = buffer.readI32();
    item.chairTexture = readString(buffer, item.id);
  }
  if (version >= 16) item.itemRenderer = readString(buffer, item.id);
  if (version >= 17) item.extraFlags1 = buffer.readI32();
  if (version >= 18) item.itemRendererHash = buffer.readI32();
  if (version >= 19) item.unknownBytes2 = readBytes(buffer, 9);
  if (version >= 21) item.unknownShort1 = buffer.readI16();
  if (version >= 22) item.info = readString(buffer, item.id);
  if (version >= 23) {
    item.recipe = [];

    for (let index = 0; index <= 1; index++) {
      const recipeItemID = buffer.readU16();
      if (recipeItemID) item.recipe[index] = recipeItemID;
    }
  }

  // items.dat v26 adds a small tail after the v23 recipe fields. grow-items
  // 1.3.1 does not know about it yet, which desyncs every item after Blank.
  if (version >= 24) {
    item.unknownByte1 = buffer.readU8();
    item.unknownString1 = readString(buffer, item.id);
    item.unknownInt4 = buffer.readI32();
    item.unknownByte2 = buffer.readU8();
  }

  return item;
}

function readString(buffer: ItemsBuffer, itemID = 0, encoded = false): string {
  const length = buffer.readI16();
  const chars: string[] = [];

  for (let index = 0; index < length; index++) {
    const charCode = buffer.data[buffer.mempos++];

    chars.push(
      String.fromCharCode(
        encoded
          ? charCode ^
              ITEMS_DAT_KEY.charCodeAt((itemID + index) % ITEMS_DAT_KEY.length)
          : charCode,
      ),
    );
  }

  return chars.join("");
}

function readBytes(buffer: ItemsBuffer, length: number): number[] {
  const bytes = buffer.data.slice(buffer.mempos, buffer.mempos + length);
  buffer.mempos += length;

  return bytes;
}
