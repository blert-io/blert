use std::ops::{Index, IndexMut};

use crate::item::{EQUIPMENT_SLOTS, EquipmentSlot, Item};
use crate::prayer::PrayerSet;
use crate::skill::SkillLevel;
use crate::{CombatStyle, Point, Source, VerzikPhase};

pub use crate::proto::event::npc::maiden_crab::{
    Position as MaidenCrabPosition, Spawn as MaidenCrabSpawn,
};
pub use crate::proto::event::npc::verzik_crab::Spawn as VerzikCrabSpawn;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct PartyIndex(u8);

impl PartyIndex {
    pub(crate) fn from_usize(index: usize) -> Self {
        Self(u8::try_from(index).expect("party is small"))
    }

    #[must_use]
    pub fn as_usize(self) -> usize {
        self.0 as usize
    }
}

/// A unique identifier for an NPC within a timeline.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct RoomId(pub(crate) u64);

/// A tracked actor in the stage.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Actor {
    Player(PartyIndex),
    Npc(RoomId),
}

/// The states of each player in the challenge on a tick.
#[derive(Debug, Clone)]
pub struct Players {
    states: Vec<Option<PlayerState>>,
}

impl Players {
    #[cfg_attr(not(test), expect(dead_code))]
    pub(crate) fn empty(party_size: usize) -> Self {
        Self {
            states: vec![None; party_size],
        }
    }

    /// Returns the number of players recorded on the tick.
    #[must_use]
    pub fn len(&self) -> usize {
        self.states.iter().filter(|&s| s.is_some()).count()
    }

    /// Returns true if no players were recorded on the tick.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.states.iter().all(Option::is_none)
    }

    /// Returns the state of the player at `index`.
    #[must_use]
    pub fn get(&self, index: PartyIndex) -> Option<&PlayerState> {
        self.states.get(index.as_usize())?.as_ref()
    }

    /// Returns a mutable reference to the state of the player at `index`.
    #[must_use]
    pub fn get_mut(&mut self, index: PartyIndex) -> Option<&mut PlayerState> {
        self.states.get_mut(index.as_usize())?.as_mut()
    }

    /// Returns an iterator over the players visible on the tick.
    pub fn iter(&self) -> impl Iterator<Item = (PartyIndex, &PlayerState)> {
        self.states
            .iter()
            .enumerate()
            .filter_map(|(index, state)| Some((PartyIndex::from_usize(index), state.as_ref()?)))
    }
}

impl Index<PartyIndex> for Players {
    type Output = Option<PlayerState>;

    fn index(&self, index: PartyIndex) -> &Self::Output {
        &self.states[index.as_usize()]
    }
}

impl IndexMut<PartyIndex> for Players {
    fn index_mut(&mut self, index: PartyIndex) -> &mut Self::Output {
        &mut self.states[index.as_usize()]
    }
}

/// A party member's state on a tick.
#[derive(Debug, Clone)]
pub struct PlayerState {
    pub source: Source,
    pub position: Point,
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

    fn player() -> PlayerState {
        PlayerState {
            source: Source::Client(ClientId(1)),
            position: Point(1234, 4321),
            equipment: [None; EQUIPMENT_SLOTS],
            prayers: PrayerSet::empty(PrayerBook::Normal),
            data: DataSource::Secondary,
        }
    }

    #[test]
    fn players_container() {
        let mut players = Players::empty(3);
        assert!(players.is_empty());
        assert_eq!(players.len(), 0);

        players[PartyIndex(1)] = Some(player());
        players[PartyIndex(2)] = Some(player());
        assert!(!players.is_empty());
        assert_eq!(players.len(), 2);
        assert_eq!(
            players.iter().map(|(index, _)| index).collect::<Vec<_>>(),
            [PartyIndex(1), PartyIndex(2)]
        );
        assert!(players.get(PartyIndex(0)).is_none());
        assert_eq!(
            players.get(PartyIndex(1)).map(|p| p.position),
            Some(Point(1234, 4321))
        );

        players.get_mut(PartyIndex(2)).unwrap().position = Point(1, 2);
        assert_eq!(
            players[PartyIndex(2)].as_ref().map(|p| p.position),
            Some(Point(1, 2))
        );
        assert!(players.get_mut(PartyIndex(0)).is_none());

        players[PartyIndex(1)] = None;
        assert_eq!(players.len(), 1);
        assert_eq!(
            players.iter().map(|(index, _)| index).collect::<Vec<_>>(),
            [PartyIndex(2)]
        );
    }

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
        let mut player = player();
        player.equipment[EquipmentSlot::Weapon as usize] = Some(scythe);
        player.equipment[EquipmentSlot::Quiver as usize] = Some(bolts);

        assert_eq!(player.equipped(EquipmentSlot::Weapon), Some(scythe));
        assert_eq!(player.equipped(EquipmentSlot::Quiver), Some(bolts));
        assert_eq!(player.equipped(EquipmentSlot::Head), None);
        assert_eq!(player.equipped(EquipmentSlot::Shield), None);
    }
}
