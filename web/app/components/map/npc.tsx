import { SkillLevel, getNpcDefinition } from '@blert/common';

import { Entity, EntityType } from './entity';

const DEFAULT_OUTLINE_COLOR = '#3d3dd5';

export class NpcEntity implements Entity {
  x: number;
  y: number;
  type: EntityType = EntityType.NPC;
  size: number;
  name: string;
  outlineColor: string;
  interactable: boolean = true;

  id: number;
  roomId: number;
  hitpoints: SkillLevel;

  constructor(
    x: number,
    y: number,
    id: number,
    roomId: number,
    hitpoints: SkillLevel,
    outlineColor?: string,
    shortName: boolean = false,
  ) {
    const npcDefinition = getNpcDefinition(id);
    if (npcDefinition !== null) {
      this.name = shortName ? npcDefinition.shortName : npcDefinition.fullName;
    } else {
      this.name = `NPC ${id}`;
    }

    this.x = x;
    this.y = y;
    this.size = npcDefinition?.size ?? 1;
    this.id = id;
    this.roomId = roomId;
    this.hitpoints = hitpoints;
    this.outlineColor = outlineColor ?? DEFAULT_OUTLINE_COLOR;
  }

  getUniqueId(): string {
    return `${this.type}-${this.roomId}`;
  }

  renderContents(): React.ReactNode {
    const displayHitpoints = this.hitpoints.getBase() > 0;

    return (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          color: '#fff',
          fontSize: '12px',
          textShadow: '3px 3px 2px rgba(0, 0, 0, 1)',
          textAlign: 'center',
        }}
      >
        {this.name}
        {displayHitpoints && <div>{this.hitpoints.toString()}</div>}
      </div>
    );
  }
}
