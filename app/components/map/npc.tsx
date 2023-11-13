import { Entity, EntityType } from './entity';
import { SkillLevel } from '../../raid/stats';

// TODO(frolv): This belongs elsewhere.
const MAIDEN = { name: 'The Maiden of Sugadinti', size: 6 };
const TOB_NPCS: { [id: number]: any } = {
  [8360]: MAIDEN,
  [8361]: MAIDEN,
  [8362]: MAIDEN,
  [8363]: MAIDEN,
  [8364]: MAIDEN,
  [8365]: MAIDEN,
  [8366]: { name: 'Nylocas Matomenos', size: 2 },
  [8367]: { name: 'Blood spawn', size: 1 },
};

export class NpcEntity implements Entity {
  x: number;
  y: number;
  type: EntityType = EntityType.NPC;
  size: number;
  outlineColor: string = '#3d3dd5';
  interactable: boolean = true;

  id: number;
  roomId: number;
  hitpoints?: SkillLevel;

  constructor(
    x: number,
    y: number,
    id: number,
    roomId: number,
    hitpoints?: SkillLevel,
  ) {
    this.x = x;
    this.y = y;
    this.size = TOB_NPCS[id]?.size ?? 1;
    this.id = id;
    this.roomId = roomId;
    this.hitpoints = hitpoints;
  }

  getUniqueId(): string {
    return `${this.type}-${this.roomId}`;
  }

  renderContents(): React.ReactNode {
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
        {TOB_NPCS[this.id]?.name ?? this.id}
        {this.hitpoints !== undefined && (
          <div>
            {this.hitpoints.current}/{this.hitpoints.base}
          </div>
        )}
      </div>
    );
  }
}
