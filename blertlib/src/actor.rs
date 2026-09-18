use crate::item::{EQUIPMENT_SLOTS, EquipmentSlot, Item};
use crate::prayer::PrayerSet;
use crate::skill::SkillLevel;
use crate::tick::Tick;
use crate::{CombatStyle, Point, Source, VerzikPhase};

pub use crate::proto::event::npc::maiden_crab::{
    Position as MaidenCrabPosition, Spawn as MaidenCrabSpawn,
};
pub use crate::proto::event::npc::verzik_crab::Spawn as VerzikCrabSpawn;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct PartyIndex(u8);

impl PartyIndex {
    #[must_use]
    pub fn as_usize(self) -> usize {
        self.0 as usize
    }
}

/// A unique identifier for an NPC within a timeline.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct RoomId(u64);

/// A tracked actor in the stage.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Actor {
    Player(PartyIndex),
    Npc(RoomId),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Stats {
    pub hitpoints: SkillLevel,
    pub prayer: SkillLevel,
    pub attack: SkillLevel,
    pub strength: SkillLevel,
    pub defence: SkillLevel,
    pub ranged: SkillLevel,
    pub magic: SkillLevel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DataSource {
    Primary(Stats),
    Secondary,
}

/// A party member's state on a tick.
#[derive(Debug, Clone)]
pub struct PlayerState {
    pub source: Source,
    pub position: Point,
    pub off_cooldown_tick: Tick,
    pub equipment: [Option<Item>; EQUIPMENT_SLOTS],
    pub prayers: PrayerSet,
    pub data: DataSource,
}

impl PlayerState {
    /// Returns the item equipped in the given slot, if any.
    #[must_use]
    pub fn equipped(&self, slot: EquipmentSlot) -> Option<Item> {
        self.equipment[slot as usize]
    }
}

/// An NPC's state on a tick.
#[derive(Debug, Clone)]
pub struct NpcState {
    pub source: Source,
    pub npc_id: u32,
    pub position: Point,
    pub hitpoints: SkillLevel,
    pub prayers: PrayerSet,
    pub properties: Option<NpcProperties>,
}

#[derive(Debug, Clone)]
pub enum NpcProperties {
    MaidenCrab(MaidenCrab),
    Nylo(Nylo),
    VerzikCrab(VerzikCrab),
}

#[derive(Debug, Clone)]
pub struct MaidenCrab {
    pub spawn: MaidenCrabSpawn,
    pub position: MaidenCrabPosition,
    /// The crab's index is lower than Maiden's index due to rollover, causing
    /// its actions to be delayed by a tick compared to usual.
    pub scuffed: bool,
}

#[derive(Debug, Clone)]
pub struct Nylo {
    pub wave: u32,
    pub big: bool,
    pub style: CombatStyle,
    pub spawn: NyloSpawn,
}

#[derive(Debug, Clone)]
pub enum NyloSpawn {
    Split(Option<RoomId>),
    West,
    South,
    East,
    Unknown,
}

#[derive(Debug, Clone)]
pub struct VerzikCrab {
    pub phase: VerzikPhase,
    pub spawn: VerzikCrabSpawn,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ClientId, PrayerBook};

    #[test]
    fn player_equipped_by_slot() {
        let scythe = Item {
            id: 22325,
            quantity: 1,
        };
        let bolts = Item {
            id: 21944,
            quantity: 271_828,
        };
        let mut equipment = [None; EQUIPMENT_SLOTS];
        equipment[EquipmentSlot::Weapon as usize] = Some(scythe);
        equipment[EquipmentSlot::Quiver as usize] = Some(bolts);
        let player = PlayerState {
            source: Source::Client(ClientId(1)),
            position: Point(1234, 4321),
            off_cooldown_tick: Tick(0),
            equipment,
            prayers: PrayerSet::empty(PrayerBook::Normal),
            data: DataSource::Secondary,
        };

        assert_eq!(player.equipped(EquipmentSlot::Weapon), Some(scythe));
        assert_eq!(player.equipped(EquipmentSlot::Quiver), Some(bolts));
        assert_eq!(player.equipped(EquipmentSlot::Head), None);
        assert_eq!(player.equipped(EquipmentSlot::Shield), None);
    }
}
