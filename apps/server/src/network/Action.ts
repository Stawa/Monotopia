import { Peer } from "../core/Peer";
import { Base } from "../core/Base";
import { parseAction } from "@monotopia/utils";
import { ActionMap } from "./actions/index";
import logger from "@monotopia/logger";

export class IActionPacket {
  public obj: Record<string, string>;

  constructor(
    public base: Base,
    public peer: Peer,
    public chunk: Buffer,
  ) {
    this.obj = parseAction(chunk);
  }

  public async execute() {
    if (!this.obj.action) return;
    logger.debug(`Receive action packet:\n ${this.obj}`);

    const actionType = this.obj.action;

    try {
      const Class = ActionMap[actionType];

      if (!Class) {
        logger.warn(
          `No Action class found for action='${actionType}' from netID=${this.peer.data.netID} userID=${this.peer.data.userID} obj=${JSON.stringify(this.obj)}`,
        );
        return;
      }

      const action = new Class(this.base, this.peer);
      await action.execute(this.obj);
    } catch (e) {
      logger.warn(e);
    }
  }
}
