import { FriendsMenu } from "../dialogs/FriendsMenu";
import { Base } from "../../core/Base";
import { Peer } from "../../core/Peer";
import { type NonEmptyObject } from "type-fest";

export class OnFriend {
  constructor(
    public base: Base,
    public peer: Peer,
  ) {}

  public async execute(
    action: NonEmptyObject<Record<string, string>>,
  ): Promise<void> {
    await new FriendsMenu(this.base, this.peer, {
      ...action,
      dialog_name: "friends_menu",
    }).execute();
  }
}
