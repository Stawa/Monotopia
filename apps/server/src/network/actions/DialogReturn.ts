import { type NonEmptyObject } from "type-fest";
import { Base } from "../../core/Base";
import { Peer } from "../../core/Peer";
import { DialogMap } from "../dialogs/index";
import logger from "@growserver/logger";

const NOOP_DIALOGS = new Set([
  "help_end",
  "info_end",
  "news_end",
  "ok",
  "stats_end",
  "status_end",
  "store_end",
  "who_end",
  "wrench_end",
]);

export class DialogReturn {
  constructor(
    public base: Base,
    public peer: Peer,
  ) {}

  public async execute(
    action: NonEmptyObject<Record<string, string>>,
  ): Promise<void> {
    try {
      const dialogName = action.dialog_name;
      if (!dialogName || NOOP_DIALOGS.has(dialogName)) return;

      const Class = DialogMap[dialogName];

      if (!Class)
        throw new Error(`No Dialog class found with dialog name ${dialogName}`);

      const dialog = new Class(this.base, this.peer, action);
      await dialog.execute();
    } catch (e) {
      logger.warn(e);
    }
  }
}
