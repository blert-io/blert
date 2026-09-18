//! A library for working with Blert's data format.
#![forbid(unsafe_code)]

mod actor;
mod event;
mod item;
mod objects;
mod prayer;
mod skill;
mod tick;

pub mod proto;
pub use proto::event::ColosseumHandicap;
pub use proto::{NpcAttack, PlayerAttack, PlayerSpell};

pub use actor::{
    Actor, DataSource, MaidenCrab, MaidenCrabPosition, MaidenCrabSpawn, NpcProperties, NpcState,
    Nylo, NyloSpawn, PartyIndex, PlayerState, RoomId, Stats, VerzikCrab, VerzikCrabSpawn,
};
pub use event::*;
pub use item::{EquipmentSlot, Item, ItemDelta, Slot};
pub use objects::{ObjectKind, TickObjects};
pub use prayer::{Prayer, PrayerBook, PrayerSet};
pub use skill::SkillLevel;
pub use tick::{Tick, Ticks};

/// A location in the game world.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
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

/// Unique identifier for a Blert client.
#[derive(
    Debug, Clone, Copy, Hash, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize,
)]
pub struct ClientId(pub u32);

impl std::fmt::Display for ClientId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Where recorded data came from.
///
/// A source displays and serializes as its underlying client's ID,
/// or `synthetic` for events created programmatically.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Source {
    /// Recorded by a client.
    Client(ClientId),
    /// Created during processing rather than recorded.
    Synthetic,
}

impl Source {
    const SYNTHETIC: &str = "synthetic";
}

impl std::fmt::Display for Source {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Source::Client(id) => write!(f, "{id}"),
            Source::Synthetic => f.write_str(Self::SYNTHETIC),
        }
    }
}

impl std::str::FromStr for Source {
    type Err = std::num::ParseIntError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        if s == Self::SYNTHETIC {
            return Ok(Source::Synthetic);
        }
        s.parse().map(|id| Source::Client(ClientId(id)))
    }
}

impl serde::Serialize for Source {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_str(self)
    }
}

impl<'de> serde::Deserialize<'de> for Source {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let s = <std::borrow::Cow<'de, str>>::deserialize(deserializer)?;
        s.parse().map_err(serde::de::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_string_form() {
        assert_eq!(Source::Client(ClientId(42)).to_string(), "42");
        assert_eq!(Source::Synthetic.to_string(), "synthetic");
        assert_eq!(
            "42".parse::<Source>().unwrap(),
            Source::Client(ClientId(42))
        );
        assert_eq!("synthetic".parse::<Source>().unwrap(), Source::Synthetic);
        assert!("client".parse::<Source>().is_err());

        assert_eq!(
            serde_json::to_string(&Source::Client(ClientId(42))).unwrap(),
            "\"42\""
        );
        assert_eq!(
            serde_json::to_string(&Source::Synthetic).unwrap(),
            "\"synthetic\""
        );
        assert_eq!(
            serde_json::from_str::<Source>("\"42\"").unwrap(),
            Source::Client(ClientId(42))
        );
        assert_eq!(
            serde_json::from_str::<Source>("\"synthetic\"").unwrap(),
            Source::Synthetic
        );
        assert!(serde_json::from_str::<Source>("42").is_err());
        assert!(serde_json::from_str::<Source>("-67").is_err());
    }

    #[test]
    fn point_round_trips_through_coords() {
        let point = Point(3172, 4382);
        let coords = proto::Coords::from(point);
        assert_eq!(coords, proto::Coords { x: 3172, y: 4382 });
        assert_eq!(Point::try_from(coords), Ok(point));
        assert_eq!(
            Point::try_from(proto::Coords { x: 0, y: 0 }),
            Ok(Point(0, 0))
        );
        assert!(Point::try_from(proto::Coords { x: -1, y: 0 }).is_err());
        assert!(Point::try_from(proto::Coords { x: 0, y: 65536 }).is_err());
    }
}
