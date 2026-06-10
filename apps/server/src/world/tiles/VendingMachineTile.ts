import { ItemDefinition } from "grow-items";
import type { Base } from "../../core/Base";
import { Peer } from "../../core/Peer";
import type { World } from "../../core/World";
import type { TileData, VendingMachine } from "@monotopia/types";
import { ExtendBuffer } from "@monotopia/utils";
import { TileExtraTypes, TileFlags } from "@monotopia/const";
import { Tile } from "../Tile";

const DEFAULT_ITEM_AMOUNT = 1;
const DEFAULT_WL_PRICE = 0;
const MAX_ITEM_AMOUNT = 200;
const MAX_WL_PRICE = 200;
const PRICE_MODE_WORLD_LOCKS_PER_ITEM = "world_locks_per_item";
const PRICE_MODE_ITEMS_PER_WORLD_LOCK = "items_per_world_lock";

type VendingMachinePriceMode = NonNullable<VendingMachine["priceMode"]>;

export class VendingMachineTile extends Tile {
  public extraType = TileExtraTypes.VENDING_MACHINE;

  constructor(
    public base: Base,
    public world: World,
    public block: TileData,
  ) {
    super(base, world, block);
  }

  public async onPlaceForeground(
    peer: Peer,
    itemMeta: ItemDefinition,
  ): Promise<boolean> {
    if (!(await super.onPlaceForeground(peer, itemMeta))) return false;

    this.data.flags |= TileFlags.TILEEXTRA;
    this.data.vendingMachine = this.createEmptyData(peer);
    return true;
  }

  public async onDestroy(peer: Peer): Promise<void> {
    await super.onDestroy(peer);
    this.data.vendingMachine = undefined;
  }

  public async serialize(dataBuffer: ExtendBuffer): Promise<void> {
    await super.serialize(dataBuffer);
    const vending = this.getVendingData();

    dataBuffer.grow(9);
    dataBuffer.writeU8(this.extraType);
    dataBuffer.writeU32(this.getSerializedItemID(vending));
    dataBuffer.writeI32(this.getSerializedPrice(vending));
  }

  public async setFlags(flags: number): Promise<number> {
    flags = await super.setFlags(flags);

    const vending = this.getVendingData();
    flags |= TileFlags.TILEEXTRA;

    if (vending.itemID && vending.amount > 0) {
      flags |= TileFlags.OPEN;
    } else {
      flags &= ~TileFlags.OPEN;
    }

    return flags;
  }

  private createEmptyData(peer?: Peer): VendingMachine {
    return {
      itemID:     0,
      amount:     0,
      itemAmount: DEFAULT_ITEM_AMOUNT,
      wlPrice:    DEFAULT_WL_PRICE,
      ownerUserID:
        this.world.getTileOwnerUID(this.data) ?? peer?.data.userID ?? 0,
      priceMode: PRICE_MODE_ITEMS_PER_WORLD_LOCK,
    };
  }

  private getVendingData(peer?: Peer): VendingMachine {
    this.data.flags |= TileFlags.TILEEXTRA;
    this.data.vendingMachine ??= this.createEmptyData(peer);

    const vending = this.data.vendingMachine;
    vending.itemID = Math.max(0, Math.trunc(vending.itemID || 0));
    vending.amount = Math.max(0, Math.trunc(vending.amount || 0));
    vending.itemAmount = Math.min(
      MAX_ITEM_AMOUNT,
      Math.max(1, Math.trunc(vending.itemAmount || DEFAULT_ITEM_AMOUNT)),
    );
    vending.wlPrice = Math.min(
      MAX_WL_PRICE,
      Math.max(
        0,
        Math.trunc(
          typeof vending.wlPrice === "number"
            ? vending.wlPrice
            : (vending.price ?? DEFAULT_WL_PRICE),
        ),
      ),
    );
    vending.ownerUserID =
      this.world.getTileOwnerUID(this.data) ?? vending.ownerUserID ?? 0;
    vending.priceMode = this.normalizePriceMode(vending);
    delete vending.price;

    return vending;
  }

  private getSerializedItemID(vending: VendingMachine): number {
    return vending.itemID && vending.amount > 0 ? vending.itemID : 0;
  }

  private getSerializedPrice(vending: VendingMachine): number {
    if (!vending.itemID || vending.amount <= 0 || vending.wlPrice <= 0) {
      return 0;
    }

    if (this.isItemsPerWorldLock(vending)) {
      return -this.getPurchaseItemAmount(vending);
    }

    return Math.max(1, vending.wlPrice);
  }

  private isItemsPerWorldLock(vending: VendingMachine): boolean {
    return this.normalizePriceMode(vending) === PRICE_MODE_ITEMS_PER_WORLD_LOCK;
  }

  private normalizePriceMode(vending: VendingMachine): VendingMachinePriceMode {
    if (
      vending.priceMode === PRICE_MODE_ITEMS_PER_WORLD_LOCK ||
      vending.priceMode === PRICE_MODE_WORLD_LOCKS_PER_ITEM
    ) {
      return vending.priceMode;
    }

    if (
      vending.wlPrice <= 0 ||
      (vending.itemAmount > 1 && vending.wlPrice === 1)
    ) {
      return PRICE_MODE_ITEMS_PER_WORLD_LOCK;
    }

    return PRICE_MODE_WORLD_LOCKS_PER_ITEM;
  }

  private getPurchaseItemAmount(vending: VendingMachine): number {
    if (!vending.itemID || vending.amount <= 0) return 0;

    return Math.min(vending.amount, Math.max(1, vending.itemAmount));
  }
}
