//! A library for working with Blert's data format.
#![forbid(unsafe_code)]
#![cfg_attr(test, allow(clippy::too_many_lines))]

mod actor;
mod event;
mod objects;
mod prayer;
mod skill;
mod tick;
mod timeline;

#[cfg(feature = "golden")]
pub mod golden;
pub mod item;
pub mod npc;
pub mod proto;
pub use proto::event::ColosseumHandicap;
pub use proto::{ChallengeMode, NpcAttack, PlayerAttack, PlayerSpell, Stage};

pub use actor::{
    Actor, DataSource, InvalidRsn, MaidenCrab, MaidenCrabPosition, MaidenCrabSpawn, Mokhaiotl,
    NpcProperties, NpcState, Nylo, NyloSpawn, PartyIndex, PlayerState, Players, RoomId, Rsn, Stats,
    VerzikCrab, VerzikCrabSpawn,
};
pub use event::*;
pub use item::{EquipmentSlot, Item, ItemDelta, Slot};
pub use objects::{ObjectKind, TickObjects};
pub use prayer::{Prayer, PrayerBook, PrayerSet};
pub use skill::SkillLevel;
pub use tick::{Tick, Ticks};
pub use timeline::{
    BuildMismatch, BuildRejection, BuildWarning, ConfigVersion, FieldError, InvalidVersion,
    Modified, RawActor, Recording, RecordingBuilder, RejectionReason, SoteMazePivots, StageData,
    StageNpc, TickState, Timeline,
};

/// A location in the game world.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Point(pub u16, pub u16);

impl Point {
    /// Returns the Chebyshev distance between two points.
    #[must_use]
    pub fn distance(self, other: Self) -> u16 {
        let dx = self.0.abs_diff(other.0);
        let dy = self.1.abs_diff(other.1);
        dx.max(dy)
    }

    /// Returns the Euclidean distance between two points.
    #[must_use]
    pub fn euclidean(self, other: Self) -> f64 {
        let dx = f64::from(self.0.abs_diff(other.0));
        let dy = f64::from(self.1.abs_diff(other.1));
        dx.hypot(dy)
    }
}

impl std::fmt::Display for Point {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "({},{})", self.0, self.1)
    }
}

/// A rectangular area of the game world anchored at its southwest tile.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Rect {
    pub point: Point,
    pub width: u16,
    pub height: u16,
}

impl Rect {
    /// Creates a square area of `size` anchored at `point`.
    #[must_use]
    pub fn square(point: Point, size: u16) -> Self {
        Self {
            point,
            width: size,
            height: size,
        }
    }

    /// Returns the point inside the rectangle nearest to `point`.
    #[must_use]
    pub fn clamp(self, point: Point) -> Point {
        let max_x = self.point.0.saturating_add(self.width.saturating_sub(1));
        let max_y = self.point.1.saturating_add(self.height.saturating_sub(1));
        Point(
            point.0.clamp(self.point.0, max_x),
            point.1.clamp(self.point.1, max_y),
        )
    }

    /// Returns the Chebyshev distance from `point` to the nearest tile of the
    /// rectangle, or 0 if it is inside.
    #[must_use]
    pub fn distance(self, point: Point) -> u16 {
        self.clamp(point).distance(point)
    }

    /// Returns `true` if `point` is located inside the rectangle.
    #[must_use]
    pub fn contains(self, point: Point) -> bool {
        self.distance(point) == 0
    }

    /// Returns the center tile of the rectangle, rounding toward its southwest
    /// corner along even sides.
    #[must_use]
    pub fn center(self) -> Point {
        let dx = self.width.saturating_sub(1) / 2;
        let dy = self.height.saturating_sub(1) / 2;
        Point(
            self.point.0.saturating_add(dx),
            self.point.1.saturating_add(dy),
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CombatStyle {
    Melee = 0,
    Ranged = 1,
    Magic = 2,
}

/// Special behaviors that player attacks can have.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttackClass {
    Demonbane,
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
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

    #[test]
    fn point_distance() {
        assert_eq!(Point(3168, 4318).distance(Point(3165, 4314)), 4);
        assert_eq!(Point(3165, 4314).distance(Point(3168, 4318)), 4);
        assert_eq!(Point(3164, 4317).distance(Point(3176, 4322)), 12);
        assert_eq!(Point(3166, 4323).distance(Point(3166, 4330)), 7);
        assert_eq!(Point(3173, 4314).distance(Point(3171, 4316)), 2);

        assert!((Point(3168, 4318).euclidean(Point(3165, 4314)) - 5.0).abs() < 1e-9);
        assert!((Point(3165, 4314).euclidean(Point(3168, 4318)) - 5.0).abs() < 1e-9);
        assert!((Point(3164, 4317).euclidean(Point(3176, 4322)) - 13.0).abs() < 1e-9);
        assert!((Point(3166, 4323).euclidean(Point(3166, 4330)) - 7.0).abs() < 1e-9);
        assert!(
            (Point(3173, 4314).euclidean(Point(3171, 4316)) - 2.828_427_124_746_19).abs() < 1e-9
        );
    }

    #[test]
    fn rect_distance_to_point() {
        let verzik_p1 = Rect::square(Point(3166, 4323), 5);
        assert_eq!(verzik_p1.distance(Point(3164, 4317)), 6);
        assert_eq!(verzik_p1.distance(Point(3168, 4320)), 3);
        assert_eq!(verzik_p1.distance(Point(3167, 4322)), 1);

        let athanatos = Rect::square(Point(3171, 4316), 3);
        assert_eq!(athanatos.distance(Point(3173, 4314)), 2);

        let matomenos = Rect::square(Point(3161, 4312), 2);
        assert_eq!(matomenos.distance(Point(3165, 4315)), 3);

        let verzik_p3 = Rect::square(Point(3165, 4311), 7);
        assert_eq!(verzik_p3.distance(Point(3168, 4318)), 1);
        assert_eq!(verzik_p3.distance(Point(3164, 4314)), 1);
        assert_eq!(verzik_p3.distance(Point(3169, 4315)), 0);
    }

    #[test]
    fn rect_contains_point() {
        let sote_maze = Rect {
            point: Point(3273, 4310),
            width: 14,
            height: 15,
        };
        assert!(sote_maze.contains(Point(3282, 4310)));
        assert!(sote_maze.contains(Point(3286, 4324)));
        assert!(sote_maze.contains(Point(3273, 4318)));
        assert!(!sote_maze.contains(Point(3287, 4317)));
        assert!(!sote_maze.contains(Point(3279, 4325)));
        assert!(!sote_maze.contains(Point(3272, 4313)));
        assert!(!sote_maze.contains(Point(3281, 4309)));
    }

    #[test]
    fn rect_center() {
        let verzik_p3 = Rect::square(Point(3165, 4311), 7);
        assert_eq!(verzik_p3.center(), Point(3168, 4314));

        let verzik_p1 = Rect::square(Point(3166, 4323), 5);
        assert_eq!(verzik_p1.center(), Point(3168, 4325));

        let matomenos = Rect::square(Point(3161, 4312), 2);
        assert_eq!(matomenos.center(), Point(3161, 4312));

        let sote_maze = Rect {
            point: Point(3273, 4310),
            width: 14,
            height: 15,
        };
        assert_eq!(sote_maze.center(), Point(3279, 4317));
    }
}
