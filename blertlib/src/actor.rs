use crate::{CombatStyle, VerzikPhase};

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
