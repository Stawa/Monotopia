import { type NonEmptyObject } from "type-fest";
import { Base } from "../../core/Base";
import { Peer } from "../../core/Peer";

export class UseDoorTutorial {
  constructor(
    public base: Base,
    public peer: Peer,
    public action: NonEmptyObject<Record<string, string>>,
  ) {}

  public async execute(): Promise<void> {
    this.peer.leaveWorld();
  }
}
