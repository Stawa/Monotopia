import type { Class } from "type-fest";
import { GazzetteEnd } from "./GazetteEnd";
import { SearchItem } from "./SearchItem";
import { AreaLockEdit } from "./AreaLockEdit";
import { ConfirmClearWorld } from "./ConfirmClearWorld";
import { DoorEdit } from "./DoorEdit";
import { DropEnd } from "./DropEnd";
import { SignEdit } from "./SignEdit";
import { TrashEnd } from "./TrashEnd";
import { SwitcheROOEdit } from "./SwitcheROOEdit";
import { RevokeLockAccess } from "./RevokeLockAccess";
import { DisplayBlockEdit } from "./DisplayBlockEdit";
import { DiceEdit } from "./DiceEdit";
import { UseDoorTutorial } from "./UseDoorTutorial";
import { GatewayEdit } from "./GatewayEdit";
import { WorldCategoryEdit } from "./WorldCategoryEdit";
import { WorldTimerEdit } from "./WorldTimerEdit";
import { FriendsMenu } from "./FriendsMenu";

export const DialogMap: Record<
  string,
  Class<{
    execute: () => Promise<void>;
  }>
> = {
  ["gazzette_end"]:         GazzetteEnd,
  ["search_item"]:          SearchItem,
  ["area_lock_edit"]:       AreaLockEdit,
  ["confirm_clearworld"]:   ConfirmClearWorld,
  ["door_edit"]:            DoorEdit,
  ["gateway_edit"]:         GatewayEdit,
  ["drop_end"]:             DropEnd,
  ["sign_edit"]:            SignEdit,
  ["trash_end"]:            TrashEnd,
  ["switcheroo_edit"]:      SwitcheROOEdit,
  ["revoke_lock_access"]:   RevokeLockAccess,
  ["displayblock_edit"]:    DisplayBlockEdit,
  ["dice_edit"]:            DiceEdit,
  ["world_category_edit"]:  WorldCategoryEdit,
  ["world_timer_edit"]:     WorldTimerEdit,
  ["friends_menu"]:         FriendsMenu,
  ["on_use_door_tutorial"]: UseDoorTutorial,
};
