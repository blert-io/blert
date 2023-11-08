import { Entity, EntityType } from './entity';

export class PlayerEntity implements Entity {
  x: number;
  y: number;
  type: EntityType = 'player';
  size = 1;

  name: string;

  constructor(x: number, y: number, name: string) {
    this.x = x;
    this.y = y;
    this.name = name;
  }

  renderContents() {
    return (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontSize: '12px',
          textShadow: '3px 3px 2px rgba(0, 0, 0, 1)',
        }}
      >
        {this.name}
      </div>
    );
  }
}
