import { type NonEmptyObject } from "type-fest";
import { DialogBuilder, stripDisplayName } from "@growserver/utils";
import { Variant } from "growtopia.js";
import { Base } from "../../core/Base";
import { Peer } from "../../core/Peer";

const MAX_FRIENDS = 100;
const FRIENDS_PER_PAGE = 7;
const SOCIAL_ICON = 1366;

type FriendsMenuAction = NonEmptyObject<
  Record<string, string> & {
    dialog_name: string;
    buttonClicked?: string;
    page?: string;
    show_location?: string;
    show_notifications?: string;
    ignore_non_friends?: string;
  }
>;

type FriendView = {
  id: number;
  name: string;
  displayName: string;
  onlinePeer?: Peer;
  daysOffline?: number;
};

export class FriendsMenu {
  constructor(
    public base: Base,
    public peer: Peer,
    public action: FriendsMenuAction,
  ) {}

  public async execute(): Promise<void> {
    if (!this.peer.data?.userID) return;

    this.normalizeFriendList();

    const buttonClicked = this.action.buttonClicked ?? "";
    if (buttonClicked === "Close") return;

    if (buttonClicked === "show_friends" || buttonClicked === "Back") {
      await this.sendFriendsOnlineDialog();
      return;
    }

    if (buttonClicked === "show_all_friends") {
      await this.sendAllFriendsDialog(this.getTargetPage(buttonClicked));
      return;
    }

    if (buttonClicked === "edit_friends") {
      await this.sendEditFriendsDialog(this.getTargetPage(buttonClicked));
      return;
    }

    if (buttonClicked === "friend_options") {
      this.sendFriendOptionsDialog();
      return;
    }

    if (buttonClicked === "friend_options_ok") {
      await this.sendFriendsOnlineDialog("`2Friend options saved.``");
      return;
    }

    if (buttonClicked === "remove_selected") {
      const message = await this.removeSelectedFriends();
      await this.sendEditFriendsDialog(this.getTargetPage(buttonClicked), message);
      return;
    }

    if (
      buttonClicked === "block_trade" ||
      buttonClicked === "mute_unmute" ||
      buttonClicked === "show_apprentices" ||
      buttonClicked === "show_guild_members" ||
      buttonClicked === "trade_history" ||
      buttonClicked === "community_hub"
    ) {
      await this.sendSocialPortalDialog("`oThat section is not available yet.``");
      return;
    }

    if (buttonClicked.startsWith("warp_")) {
      const warpMessage = await this.warpToFriend(
        this.getButtonUserID("warp_"),
      );
      if (warpMessage) await this.sendFriendsOnlineDialog(warpMessage);
      return;
    }

    if (
      buttonClicked === "all_page_prev" ||
      buttonClicked === "all_page_next"
    ) {
      await this.sendAllFriendsDialog(this.getTargetPage(buttonClicked));
      return;
    }

    if (
      buttonClicked === "edit_page_prev" ||
      buttonClicked === "edit_page_next" ||
      buttonClicked.startsWith("friend_")
    ) {
      await this.sendEditFriendsDialog(this.getTargetPage(buttonClicked));
      return;
    }

    await this.sendSocialPortalDialog();
  }

  public async sendSocialPortalDialog(message = ""): Promise<void> {
    const dialog = new DialogBuilder()
      .defaultColor()
      .addLabelWithIcon("`wSocial Portal``", SOCIAL_ICON, "big")
      .addSpacer("small");

    if (message) dialog.addTextBox(message);

    dialog
      .addButton("show_friends", "`wShow Friends``")
      .addButton("community_hub", "`wCommunity Hub``")
      .addButton("show_apprentices", "`wShow Apprentices``")
      .addButton("show_guild_members", "`wShow Guild Members``")
      .addButton("trade_history", "`wTrade History``")
      .addSpacer("small")
      .addButton("Close", "`wBack``")
      .addQuickExit()
      .endDialog("friends_menu", "Close", "");

    this.peer.send(Variant.from("OnDialogRequest", dialog.str()));
  }

  private async sendFriendsOnlineDialog(message = ""): Promise<void> {
    const friends = await this.getFriendViews();
    const onlineFriends = friends.filter((friend) => friend.onlinePeer);
    const dialog = new DialogBuilder()
      .defaultColor()
      .addLabelWithIcon(
        `\`w${onlineFriends.length} of ${friends.length} Friends Online\`\``,
        SOCIAL_ICON,
        "big",
      )
      .addSpacer("small");

    if (message) dialog.addTextBox(message);

    if (!onlineFriends.length) {
      dialog.addTextBox("`oNone of your friends are currently online.``");
    } else {
      onlineFriends.forEach((friend) => {
        const worldName = friend.onlinePeer?.data.world;
        const location =
          worldName && worldName !== "EXIT"
            ? ` \`oin \`w${this.cleanDialogText(worldName)}\`\``
            : "";

        dialog.addButton(
          `warp_${friend.id}`,
          `${this.formatPlayerName(friend.displayName)}${location}`,
        );
      });
    }

    dialog
      .addSpacer("small")
      .addButton("show_all_friends", "`wShow offline and ignored too``")
      .addButton("edit_friends", "`wEdit Friends``")
      .addButton("friend_options", "`wFriend Options``")
      .addButton("social_portal", "`wBack``")
      .addButton("Close", "`wClose``")
      .addQuickExit()
      .endDialog("friends_menu", "Close", "");

    this.peer.send(Variant.from("OnDialogRequest", dialog.str()));
  }

  private async sendAllFriendsDialog(
    targetPage = 0,
    message = "",
  ): Promise<void> {
    const friends = await this.getFriendViews();
    const onlineCount = friends.filter((friend) => friend.onlinePeer).length;
    const maxPage = Math.max(
      0,
      Math.ceil(friends.length / FRIENDS_PER_PAGE) - 1,
    );
    const currentPage = Math.min(maxPage, Math.max(0, targetPage));
    const pageFriends = friends.slice(
      currentPage * FRIENDS_PER_PAGE,
      currentPage * FRIENDS_PER_PAGE + FRIENDS_PER_PAGE,
    );

    const dialog = new DialogBuilder()
      .defaultColor()
      .addLabelWithIcon(
        `\`w${onlineCount} of ${friends.length} Friends Online\`\``,
        SOCIAL_ICON,
        "big",
      )
      .embed("page", currentPage)
      .addSpacer("small");

    if (message) dialog.addTextBox(message);

    if (!friends.length) {
      dialog.addTextBox("`oYou don't have any friends yet.``");
    } else {
      pageFriends.forEach((friend) => {
        dialog.addButton(
          friend.onlinePeer ? `warp_${friend.id}` : `friend_${friend.id}`,
          this.getAllFriendsLabel(friend),
        );
      });
    }

    dialog.addSpacer("small").addTextBox("`oYou aren't currently ignoring anyone.``");

    if (maxPage > 0) {
      dialog.addSpacer("small");
      if (currentPage > 0) dialog.addButton("all_page_prev", "`wPrevious``");
      if (currentPage < maxPage) dialog.addButton("all_page_next", "`wNext``");
    }

    dialog
      .addSpacer("small")
      .addButton("edit_friends", "`wEdit Friends``")
      .addButton("friend_options", "`wFriend Options``")
      .addButton("show_friends", "`wBack``")
      .addButton("Close", "`wClose``")
      .addQuickExit()
      .endDialog("friends_menu", "Close", "");

    this.peer.send(Variant.from("OnDialogRequest", dialog.str()));
  }

  private async sendEditFriendsDialog(
    targetPage = 0,
    message = "",
  ): Promise<void> {
    const friends = await this.getFriendViews();
    const maxPage = Math.max(
      0,
      Math.ceil(friends.length / FRIENDS_PER_PAGE) - 1,
    );
    const currentPage = Math.min(maxPage, Math.max(0, targetPage));
    const pageFriends = friends.slice(
      currentPage * FRIENDS_PER_PAGE,
      currentPage * FRIENDS_PER_PAGE + FRIENDS_PER_PAGE,
    );

    const dialog = new DialogBuilder()
      .defaultColor()
      .addLabelWithIcon("`wAll Friends``", SOCIAL_ICON, "big")
      .embed("page", currentPage)
      .addSpacer("small")
      .addButton("remove_selected", "`wRemove``")
      .addButton("block_trade", "`wBlock / Unblock Trade``")
      .addButton("mute_unmute", "`wMute / Unmute``")
      .addSpacer("small");

    if (message) dialog.addTextBox(message);

    if (!friends.length) {
      dialog.addTextBox("`oYou don't have any friends to edit.``");
    } else {
      pageFriends.forEach((friend) => {
        dialog.addCheckbox(
          `selected_friend_${friend.id}`,
          this.getPlainPlayerName(friend.displayName),
          "not_selected",
        );
      });
    }

    if (maxPage > 0) {
      dialog.addSpacer("small");
      if (currentPage > 0) dialog.addButton("edit_page_prev", "`wPrevious``");
      if (currentPage < maxPage)
        dialog.addButton("edit_page_next", "`wNext``");
    }

    dialog
      .addSpacer("small")
      .addButton("show_all_friends", "`wBack``")
      .addButton("Close", "`wClose``")
      .addQuickExit()
      .endDialog("friends_menu", "Close", "");

    this.peer.send(Variant.from("OnDialogRequest", dialog.str()));
  }

  private sendFriendOptionsDialog(): void {
    const dialog = new DialogBuilder()
      .defaultColor()
      .addLabelWithIcon("`wFriend Options``", SOCIAL_ICON, "big")
      .addSpacer("small")
      .addCheckbox("show_location", "`wShow location to friends``", "selected")
      .addCheckbox(
        "show_notifications",
        "`wShow friend notifications``",
        "selected",
      )
      .addCheckbox(
        "ignore_non_friends",
        "`wIgnore non-friends messages``",
        "not_selected",
      )
      .addSpacer("small")
      .addButton("friend_options_ok", "`wOK``")
      .addQuickExit()
      .endDialog("friends_menu", "Close", "");

    this.peer.send(Variant.from("OnDialogRequest", dialog.str()));
  }

  private async removeSelectedFriends(): Promise<string> {
    const selectedIDs = this.getSelectedFriendIDs();
    if (!selectedIDs.length) return "`4Select at least one friend first.``";

    const friendIDs = this.normalizeFriendList();
    const selected = new Set(selectedIDs);
    const nextFriends = friendIDs.filter((id) => !selected.has(id));
    const removedCount = friendIDs.length - nextFriends.length;

    if (!removedCount) return "`4No selected friends were found.``";

    this.peer.data.friends = nextFriends;
    await this.peer.saveToCache();
    await this.peer.saveToDatabase();

    return `\`2Removed ${removedCount} friend${removedCount === 1 ? "" : "s"}.\`\``;
  }

  private async warpToFriend(userID: number): Promise<string | undefined> {
    if (
      !Number.isInteger(userID) ||
      !this.normalizeFriendList().includes(userID)
    ) {
      return "`4That player is not on your Friends list.``";
    }

    const onlineFriend = this.getOnlinePeer(userID);
    if (!onlineFriend) return "`4That friend is offline.``";

    const worldName = onlineFriend.data.world;
    if (!worldName || worldName === "EXIT") {
      return "`4That friend is not in a world right now.``";
    }
    if (this.peer.data.world === worldName) {
      return "`oYou are already in that friend's world.``";
    }

    this.peer.sendConsoleMessage(
      `Warping to \`2${this.cleanDialogText(worldName)}\`\` to visit ${onlineFriend.data.displayName}.`,
    );

    if (this.peer.data.world && this.peer.data.world !== "EXIT") {
      this.peer.leaveWorld(false);
    }

    setTimeout(() => {
      void this.peer.enterWorld(worldName);
    }, 200);

    return undefined;
  }

  private async getFriendViews(): Promise<FriendView[]> {
    const friendIDs = this.normalizeFriendList();
    const views = await Promise.all(
      friendIDs.map(async (id): Promise<FriendView | undefined> => {
        const onlinePeer = this.getOnlinePeer(id);
        if (onlinePeer) {
          return {
            id,
            name:        onlinePeer.data.name,
            displayName: onlinePeer.data.displayName,
            onlinePeer,
          };
        }

        const player = await this.base.database.players.getByUID(id);
        if (!player) return undefined;

        return {
          id:          player.id,
          name:        player.name,
          displayName: player.display_name,
          daysOffline: this.getDaysSince(player.updated_at ?? player.created_at),
        };
      }),
    );

    const validViews: FriendView[] = [];
    views.forEach((view) => {
      if (view) validViews.push(view);
    });

    const validIDs = validViews.map((view) => view.id);
    if (validIDs.length !== friendIDs.length) {
      this.peer.data.friends = validIDs;
      await this.peer.saveToCache();
      await this.peer.saveToDatabase();
    }

    return validViews.sort((a, b) => {
      if (!!a.onlinePeer !== !!b.onlinePeer) return a.onlinePeer ? -1 : 1;
      return this.sortName(a).localeCompare(this.sortName(b));
    });
  }

  private getOnlinePeer(userID: number): Peer | undefined {
    const peerData = this.base.cache.peers.find(
      (peer) => peer.userID === userID,
    );
    return peerData ? new Peer(this.base, peerData.netID) : undefined;
  }

  private getAllFriendsLabel(friend: FriendView): string {
    if (friend.onlinePeer) {
      return `\`2(online) \`w${this.getPlainPlayerName(friend.displayName)}\`\``;
    }

    const days = friend.daysOffline ?? 0;
    return `\`4(${days}d) \`w${this.getPlainPlayerName(friend.displayName)}\`\``;
  }

  private getTargetPage(buttonClicked: string): number {
    const parsedPage = Number.parseInt(this.action.page ?? "0", 10);
    const currentPage = Number.isFinite(parsedPage) ? parsedPage : 0;

    if (buttonClicked.endsWith("_page_prev")) return currentPage - 1;
    if (buttonClicked.endsWith("_page_next")) return currentPage + 1;

    return currentPage;
  }

  private getButtonUserID(prefix: string): number {
    return Number.parseInt(
      (this.action.buttonClicked ?? "").slice(prefix.length),
      10,
    );
  }

  private getSelectedFriendIDs(): number[] {
    return Object.entries(this.action)
      .filter(([key, value]) => key.startsWith("selected_friend_") && value === "1")
      .map(([key]) => Number.parseInt(key.slice("selected_friend_".length), 10))
      .filter((id) => Number.isInteger(id));
  }

  private normalizeFriendList(): number[] {
    const friends = Array.isArray(this.peer.data.friends)
      ? this.peer.data.friends
      : [];

    this.peer.data.friends = [
      ...new Set(
        friends
          .map((id) => Number(id))
          .filter((id) => Number.isInteger(id) && id > 0),
      ),
    ];

    return this.peer.data.friends;
  }

  private formatPlayerName(name: string): string {
    const cleanName = this.cleanDialogText(name);
    return cleanName.includes("`") ? `${cleanName}\`\`` : `\`w${cleanName}\`\``;
  }

  private getPlainPlayerName(name: string): string {
    return this.cleanDialogText(stripDisplayName(name) || name);
  }

  private sortName(friend: FriendView): string {
    return stripDisplayName(friend.displayName || friend.name).toLowerCase();
  }

  private getDaysSince(value?: string | null): number {
    if (!value) return 0;

    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp)) return 0;

    const elapsedMs = Date.now() - timestamp;
    if (elapsedMs <= 0) return 0;

    return Math.floor(elapsedMs / 86_400_000);
  }

  private cleanDialogText(value: string): string {
    return value
      .replace(/\|/g, "/")
      .replace(/[\r\n]+/g, " ")
      .slice(0, 60);
  }
}
