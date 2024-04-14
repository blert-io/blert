import { EventPlayer, MergedEvent, RoomNpcType } from '@blert/common';
import { EventNpc } from '@blert/common/event';
import { Event as EventProto } from '@blert/common/generated/event_pb';

function playerProtoToPlayer(proto: EventProto.Player): EventPlayer {
  const player: EventPlayer = {
    name: proto.getName(),
    offCooldownTick: proto.getOffCooldownTick(),
    prayerSet: proto.getActivePrayers(),
  };

  if (proto.hasHitpoints()) {
    player.hitpoints = proto.getHitpoints();
  }
  if (proto.hasPrayer()) {
    player.prayer = proto.getPrayer();
  }
  if (proto.hasAttack()) {
    player.attack = proto.getAttack();
  }
  if (proto.hasStrength()) {
    player.strength = proto.getStrength();
  }
  if (proto.hasDefence()) {
    player.defence = proto.getDefence();
  }
  if (proto.hasRanged()) {
    player.ranged = proto.getRanged();
  }
  if (proto.hasMagic()) {
    player.magic = proto.getMagic();
  }

  const equipmentDeltas = proto.getEquipmentDeltasList();
  if (equipmentDeltas.length > 0) {
    player.equipmentDeltas = equipmentDeltas;
  }

  return player;
}

function npcProtoToNpc(proto: EventProto.Npc): EventNpc {
  let base, current;
  let type = RoomNpcType.BASIC;
  if (proto.hasMaidenCrab()) {
    type = RoomNpcType.MAIDEN_CRAB;
  } else if (proto.hasNylo()) {
    type = RoomNpcType.NYLO;
  } else if (proto.hasVerzikCrab()) {
    type = RoomNpcType.VERZIK_CRAB;
  }

  const npc: EventNpc = {
    id: proto.getId(),
    roomId: proto.getRoomId(),
    type,
    hitpoints: proto.getHitpoints(),
  };

  if (proto.hasMaidenCrab()) {
    npc.maidenCrab = proto.getMaidenCrab()!.toObject();
  } else if (proto.hasNylo()) {
    npc.nylo = proto.getNylo()!.toObject();
  } else if (proto.hasVerzikCrab()) {
    npc.verzikCrab = proto.getVerzikCrab()!.toObject();
  }

  return npc;
}

/**
 * Converts a protobuf event to database format. Only processes fields which
 * are present in the database format, ignoring others.
 *
 * @param proto The protobuf event.
 * @returns Event in database format.
 */
export function protoToEvent(proto: EventProto): Partial<MergedEvent> {
  const event: Partial<MergedEvent> = {
    type: proto.getType(),
    cId: proto.getChallengeId(),
    stage: proto.getStage(),
    tick: proto.getTick(),
    xCoord: proto.getXCoord(),
    yCoord: proto.getYCoord(),
  };

  if (proto.hasPlayer()) {
    event.player = playerProtoToPlayer(proto.getPlayer()!);
  }

  if (proto.hasPlayerAttack()) {
    const playerAttack = proto.getPlayerAttack()!;
    event.attack = {
      type: playerAttack.getType(),
      distanceToTarget: playerAttack.getDistanceToTarget(),
    };

    if (playerAttack.hasWeapon()) {
      const weapon = playerAttack.getWeapon()!;
      // @ts-ignore: DB items don't have a name.
      event.attack.weapon = {
        id: weapon.getId(),
        quantity: weapon.getQuantity(),
      };
    }

    if (playerAttack.hasTarget()) {
      const target = playerAttack.getTarget()!;
      event.attack.target = {
        id: target.getId(),
        roomId: target.getRoomId(),
      };
    }
  }

  if (proto.hasNpc()) {
    event.npc = npcProtoToNpc(proto.getNpc()!);
  }

  if (proto.hasNpcAttack()) {
    const npcAttack = proto.getNpcAttack()!;
    event.npcAttack = {
      attack: npcAttack.getAttack(),
    };

    if (npcAttack.hasTarget()) {
      event.npcAttack!.target = npcAttack.getTarget();
    }
  }

  const maidenBloodSplats = proto.getMaidenBloodSplatsList();
  if (maidenBloodSplats.length > 0) {
    event.maidenBloodSplats = maidenBloodSplats.map((splat) => ({
      x: splat.getX(),
      y: splat.getY(),
    }));
  }

  if (proto.hasBloatDown()) {
    event.bloatDown = proto.getBloatDown()!.toObject();
  }

  if (proto.hasNyloWave()) {
    event.nyloWave = proto.getNyloWave()!.toObject();
  }

  if (proto.hasSoteMaze()) {
    const maze = proto.getSoteMaze()!;
    if (event.type === EventProto.Type.TOB_SOTE_MAZE_PATH) {
      if (maze.getOverworldTilesList().length > 0) {
        event.soteMaze = {
          maze: maze.getMaze(),
          activeTiles: maze.getOverworldTilesList().map((tile) => ({
            x: tile.getX(),
            y: tile.getY(),
          })),
        };
      }
    } else {
      // @ts-ignore: activeTiles is optional in the database format.
      event.soteMaze = { maze: maze.getMaze() };
    }
  }

  if (proto.hasXarpusPhase()) {
    event.xarpusPhase = proto.getXarpusPhase();
  }

  if (proto.hasVerzikPhase()) {
    event.verzikPhase = proto.getVerzikPhase();
  }

  if (proto.hasHandicap()) {
    event.handicap = proto.getHandicap();
  }

  return event;
}
