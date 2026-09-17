//! A library for working with Blert's data format.
#![forbid(unsafe_code)]

mod actor;
mod event;
mod item;
mod prayer;
mod skill;
mod tick;

pub mod proto;
pub use proto::event::ColosseumHandicap;
pub use proto::{NpcAttack, PlayerAttack, PlayerSpell};

pub use actor::{
    Actor, MaidenCrab, MaidenCrabPosition, MaidenCrabSpawn, NpcProperties, Nylo, NyloSpawn,
    PartyIndex, RoomId, VerzikCrab, VerzikCrabSpawn,
};
pub use event::*;
pub use item::EquipmentSlot;
pub use prayer::{Prayer, PrayerBook, PrayerSet};
pub use skill::SkillLevel;
pub use tick::{Tick, Ticks};

/// A location in the game world.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Point(pub u16, pub u16);

impl std::fmt::Display for Point {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "({},{})", self.0, self.1)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CombatStyle {
    Melee = 0,
    Ranged = 1,
    Magic = 2,
}
