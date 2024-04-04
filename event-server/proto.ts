import {
  EquipmentMap,
  EquipmentSlot,
  EventPlayer,
  MergedEvent,
  RoomNpcType,
} from '@blert/common';
import { EventNpc } from '@blert/common/event';
import { Event as EventProto } from '@blert/common/generated/event_pb';

type ProtoEquipmentSlot =
  EventProto.Player.EquipmentSlotMap[keyof EventProto.Player.EquipmentSlotMap];
function equipmentSlotKey(slot: ProtoEquipmentSlot): keyof EquipmentMap {
  switch (slot) {
    case EventProto.Player.EquipmentSlot.HEAD:
      return EquipmentSlot.HEAD;
    case EventProto.Player.EquipmentSlot.CAPE:
      return EquipmentSlot.CAPE;
    case EventProto.Player.EquipmentSlot.AMULET:
      return EquipmentSlot.AMULET;
    case EventProto.Player.EquipmentSlot.AMMO:
      return EquipmentSlot.AMMO;
    case EventProto.Player.EquipmentSlot.WEAPON:
      return EquipmentSlot.WEAPON;
    case EventProto.Player.EquipmentSlot.TORSO:
      return EquipmentSlot.TORSO;
    case EventProto.Player.EquipmentSlot.SHIELD:
      return EquipmentSlot.SHIELD;
    case EventProto.Player.EquipmentSlot.LEGS:
      return EquipmentSlot.LEGS;
    case EventProto.Player.EquipmentSlot.GLOVES:
      return EquipmentSlot.GLOVES;
    case EventProto.Player.EquipmentSlot.BOOTS:
      return EquipmentSlot.BOOTS;
    case EventProto.Player.EquipmentSlot.RING:
      return EquipmentSlot.RING;
  }
}

function playerProtoToPlayer(proto: EventProto.Player): EventPlayer {
  const player: EventPlayer = {
    name: proto.getName(),
    offCooldownTick: proto.getOffCooldownTick(),
    prayerSet: proto.getActivePrayers(),
  };

  if (proto.hasHitpoints()) {
    const hitpoints = proto.getHitpoints()!;
    player.hitpoints = {
      base: hitpoints.getBase(),
      current: hitpoints.getCurrent(),
    };
  }
  if (proto.hasPrayer()) {
    const prayer = proto.getPrayer()!;
    player.prayer = {
      base: prayer.getBase(),
      current: prayer.getCurrent(),
    };
  }
  if (proto.hasAttack()) {
    const attack = proto.getAttack()!;
    player.attack = {
      base: attack.getBase(),
      current: attack.getCurrent(),
    };
  }
  if (proto.hasStrength()) {
    const strength = proto.getStrength()!;
    player.strength = {
      base: strength.getBase(),
      current: strength.getCurrent(),
    };
  }
  if (proto.hasDefence()) {
    const defence = proto.getDefence()!;
    player.defence = {
      base: defence.getBase(),
      current: defence.getCurrent(),
    };
  }
  if (proto.hasRanged()) {
    const ranged = proto.getRanged()!;
    player.ranged = {
      base: ranged.getBase(),
      current: ranged.getCurrent(),
    };
  }
  if (proto.hasMagic()) {
    const magic = proto.getMagic()!;
    player.magic = {
      base: magic.getBase(),
      current: magic.getCurrent(),
    };
  }

  proto.getEquipmentList().forEach((itemProto) => {
    // @ts-ignore: DB items don't have a name.
    const item: Item = {
      id: itemProto.getId(),
      quantity: itemProto.getQuantity(),
    };
    if (player.equipment === undefined) {
      player.equipment = {};
    }
    const key = equipmentSlotKey(itemProto.getSlot());
    player.equipment[key] = item;
  });

  return player;
}

function npcProtoToNpc(proto: EventProto.Npc): EventNpc {
  let base, current;
  if (proto.hasHitpoints()) {
    const hitpoints = proto.getHitpoints()!;
    base = hitpoints.getBase();
    current = hitpoints.getCurrent();
  } else {
    base = -1;
    current = -1;
  }

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
    hitpoints: { base, current },
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
    event.soteMaze = { maze: proto.getSoteMaze()!.getMaze() };
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
