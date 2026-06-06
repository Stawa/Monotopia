import { Variant } from "growtopia.js";
import { Base } from "../../core/Base";
import { Peer } from "../../core/Peer";
import { type NonEmptyObject } from "type-fest";

export class OnFriend {
  constructor(
    public base: Base,
    public peer: Peer,
  ) {}

  public async execute(
    _action: NonEmptyObject<Record<string, string>>,
  ): Promise<void> {
    this.peer.send(Variant.from("OnTextOverlay", "Friends menu is not implemented yet."));
  }
}
