import { type NonEmptyObject } from "type-fest";
import { ActionTypes, ROLE } from "@monotopia/const";
import { DialogBuilder } from "@monotopia/utils";
import { Base } from "../../core/Base";
import { Peer } from "../../core/Peer";
import { Variant } from "growtopia.js";
import { type ItemDefinition } from "grow-items";

const RESULTS_PER_PAGE = 18;
const MAX_RESULTS = 250;
const DEFAULT_AMOUNT = 200;
const MAX_AMOUNT = 200;

type SearchResult = {
  item: ItemDefinition;
  rank: number;
};

export class SearchItem {
  constructor(
    public base: Base,
    public peer: Peer,
    public action: NonEmptyObject<{
      dialog_name: string;
      buttonClicked?: string;
      n?: string;
      amount?: string;
      page?: string;
      show_seeds?: string;
    }>,
  ) {}

  public async execute(): Promise<void> {
    if (!this.action.dialog_name) return;
    if (this.peer.data.role !== ROLE.DEVELOPER) return;

    const buttonClicked = this.action.buttonClicked ?? "";
    if (!buttonClicked || buttonClicked === "Close") return;

    if (buttonClicked.startsWith("give_")) {
      this.giveItem(Number.parseInt(buttonClicked.slice("give_".length), 10));
      return;
    }

    const page = this.getTargetPage(buttonClicked);
    this.sendSearchResults(page);
  }

  private sendSearchResults(page: number): void {
    const query = this.getQuery();
    const showSeeds = this.shouldShowSeeds();
    const amount = this.getAmount();
    const results = this.searchItems(query, showSeeds);
    const maxPage = Math.max(
      0,
      Math.ceil(results.length / RESULTS_PER_PAGE) - 1,
    );
    const currentPage = Math.min(maxPage, Math.max(0, page));
    const pageResults = results.slice(
      currentPage * RESULTS_PER_PAGE,
      currentPage * RESULTS_PER_PAGE + RESULTS_PER_PAGE,
    );

    const dialog = new DialogBuilder()
      .defaultColor()
      .addLabelWithIcon("`wDeveloper Item Search``", 32, "big")
      .addSmallText("Search by item name or ID, then click an item to add it.")
      .addInputBox("n", "Search:", query, 40)
      .addInputBox("amount", "Amount:", amount, 3)
      .addCheckbox(
        "show_seeds",
        "Show seeds too",
        showSeeds ? "selected" : "not_selected",
      )
      .addButton("search_items", "`2Search``")
      .embed("page", currentPage)
      .embed("amount", amount);

    if (!query) {
      dialog.addTextBox("Enter a search term to start browsing items.");
    } else if (!results.length) {
      dialog.addTextBox(
        showSeeds
          ? "No items matched that search."
          : "No non-seed items matched that search. Try enabling seeds.",
      );
    } else {
      dialog
        .addSpacer("small")
        .addSmallText(
          `Results: \`w${results.length}\`\`, Page \`w${
            currentPage + 1
          }/${maxPage + 1}\`\`, Amount: \`w${amount}\`\``,
        );

      for (const { item } of pageResults) {
        dialog.addButtonWithIcon(
          `give_${item.id}`,
          item.id ?? 0,
          this.getResultLabel(item),
          "left",
          0,
        );
      }

      dialog.addCustomBreak();

      if (maxPage > 0) {
        dialog.addSpacer("small");
        if (currentPage > 0) dialog.addButton("page_prev", "`wPrevious``");
        if (currentPage < maxPage) dialog.addButton("page_next", "`wNext``");
      }
    }

    dialog.addSpacer("small").endDialog("search_item", "Close", "");

    this.peer.send(Variant.from("OnDialogRequest", dialog.str()));
  }

  private searchItems(query: string, showSeeds: boolean): SearchResult[] {
    const normalizedQuery = this.normalize(query);
    if (!normalizedQuery) return [];

    const exactID = Number.parseInt(normalizedQuery, 10);

    return Array.from(this.base.items.metadata.items.values())
      .filter((item) => this.isSearchable(item, showSeeds))
      .map((item) => ({
        item,
        rank: this.getRank(item, normalizedQuery, exactID),
      }))
      .filter((result) => result.rank >= 0)
      .sort((a, b) => a.rank - b.rank || (a.item.id ?? 0) - (b.item.id ?? 0))
      .slice(0, MAX_RESULTS);
  }

  private isSearchable(item: ItemDefinition, showSeeds: boolean): boolean {
    if (!item.id || !item.name) return false;
    if (!showSeeds && item.type === ActionTypes.SEED) return false;

    return true;
  }

  private getRank(
    item: ItemDefinition,
    normalizedQuery: string,
    exactID: number,
  ): number {
    const id = item.id ?? 0;
    const name = this.normalize(item.name);

    if (Number.isFinite(exactID) && id === exactID) return 0;
    if (name === normalizedQuery) return 1;
    if (name.startsWith(normalizedQuery)) return 2;
    if (name.includes(normalizedQuery)) return 3;
    if (id.toString().startsWith(normalizedQuery)) return 4;

    return -1;
  }

  private giveItem(itemID: number): void {
    if (!Number.isFinite(itemID)) return;

    const item = this.base.items.metadata.items.get(itemID.toString());
    if (!item) {
      this.peer.sendConsoleMessage("`4Error: Invalid item ID.``");
      return;
    }

    if (item.type === ActionTypes.SEED && !this.shouldShowSeeds()) {
      this.peer.sendConsoleMessage(
        "`oEnable `wShow seeds too`` before adding seed items.",
      );
      return;
    }

    const amount = this.getAmount();
    this.peer.addItemInven(itemID, amount);
    this.peer.send(
      Variant.from(
        "OnConsoleMessage",
        `Added \`6${item.name}\`\` (\`w${amount}\`\`) to your inventory.`,
      ),
    );
    this.peer.saveToCache();
  }

  private getTargetPage(buttonClicked: string): number {
    const parsedPage = Number.parseInt(this.action.page ?? "0", 10);
    const currentPage = Number.isFinite(parsedPage) ? parsedPage : 0;

    if (buttonClicked === "search_items") return 0;
    if (buttonClicked === "page_prev") return currentPage - 1;
    if (buttonClicked === "page_next") return currentPage + 1;

    return currentPage;
  }

  private getResultLabel(item: ItemDefinition): string {
    const type = item.type !== undefined ? ActionTypes[item.type] : "UNKNOWN";
    const id = item.id ?? 0;

    return `\`w${this.cleanDialogText(item.name)}\`\` \`o#${id} / ${type}`;
  }

  private getQuery(): string {
    return (this.action.n ?? "").trim().slice(0, 40);
  }

  private getAmount(): number {
    const parsed = Number.parseInt(this.action.amount ?? "", 10);
    if (!Number.isFinite(parsed)) return DEFAULT_AMOUNT;

    return Math.min(MAX_AMOUNT, Math.max(1, parsed));
  }

  private shouldShowSeeds(): boolean {
    return this.action.show_seeds === "1";
  }

  private normalize(value?: string): string {
    return (value ?? "").trim().toLowerCase();
  }

  private cleanDialogText(value?: string): string {
    return (value ?? "")
      .replace(/\|/g, "/")
      .replace(/[\r\n]+/g, " ")
      .slice(0, 55);
  }
}
