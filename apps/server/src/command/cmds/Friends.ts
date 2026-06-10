import { Command } from "../Command";
import { Base } from "../../core/Base";
import { Peer } from "../../core/Peer";
import { ROLE } from "@monotopia/const";
import { FriendsMenu } from "../../network/dialogs/FriendsMenu";

export default class Friends extends Command {
  constructor(
    public base: Base,
    public peer: Peer,
    public text: string,
    public args: string[],
  ) {
    super(base, peer, text, args);
    this.opt = {
      command:     ["friends", "friend"],
      description: "Open your Friends menu.",
      cooldown:    3,
      ratelimit:   2,
      category:    "`oBasic",
      usage:       "/friends",
      example:     ["/friends"],
      permission:  [ROLE.BASIC, ROLE.SUPPORTER, ROLE.DEVELOPER],
    };
  }

  public async execute(): Promise<void> {
    await new FriendsMenu(this.base, this.peer, {
      dialog_name: "friends_menu",
    }).execute();
  }
}
