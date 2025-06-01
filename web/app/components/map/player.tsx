import { SkillLevel } from '@blert/common';

import { Entity, EntityType } from './entity';

export class PlayerEntity implements Entity {
  x: number;
  y: number;
  type: EntityType = EntityType.PLAYER;
  size = 1;
  outlineColor: string;
  interactable: boolean = true;
  customZIndex: number | null = null;

  name: string;
  hitpoints?: SkillLevel;
  highlight: boolean;

  constructor(
    x: number,
    y: number,
    name: string,
    hitpoints?: SkillLevel,
    highlight: boolean = false,
  ) {
    this.x = x;
    this.y = y;
    this.name = name;
    this.outlineColor = highlight ? '#1be5e5' : '#979695';

    this.hitpoints = hitpoints;
    this.highlight = highlight;
  }

  getUniqueId(): string {
    return `${this.type}-${this.name}`;
  }

  setHighlight(highlight: boolean) {
    this.highlight = highlight;
    this.outlineColor = highlight ? '#1be5e5' : '#979695';
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
          textAlign: 'center',
          color: '#fff',
          fontSize: '11px',
          fontWeight: this.highlight ? 700 : 400,
          textShadow: '3px 3px 2px rgba(0, 0, 0, 1)',
          textWrap: 'nowrap',
        }}
      >
        {this.name}
        {this.hitpoints !== undefined && <div>{this.hitpoints.toString()}</div>}
      </div>
    );
  }
}
