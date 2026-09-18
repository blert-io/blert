//! Blert's event model.
//!
//! This file represents half of Blert's in-memory data model, containing
//! definitions of notable occurrences throughout a timeline. The other half
//! describes the state of of the game world itself.

use crate::actor::Actor;
use crate::item::{EquipmentSlot, Item};
use crate::tick::{Tick, Ticks};
use crate::{
    ColosseumHandicap, CombatStyle, NpcAttack, PartyIndex, PlayerAttack, PlayerSpell, Point,
    RoomId, Source,
};

pub use crate::proto::event::colosseum_sol_dust::Direction as SolDustDirection;
pub use crate::proto::event::colosseum_sol_grapple::Outcome as SolGrappleOutcome;
pub use crate::proto::event::colosseum_sol_lasers::Phase as SolLaserPhase;
pub use crate::proto::event::mokhaiotl_orb::Source as MokhaiotlOrbSource;
pub use crate::proto::event::{VerzikPhase, XarpusPhase};

/// A semantic event occurring in a stage.
///
/// Events describe specific things that happen throughout an encounter. This is
/// different to "state", which represents server-authoritative facts about the
/// game world. This distinction is not made in the wire format, which sends
/// every game observation as an event; only a subset of those are defined here.
#[derive(Debug, Clone)]
pub struct Event {
    pub tick: Tick,
    pub source: Source,
    pub kind: EventKind,
}

/// The payload of an event.
///
/// In addition to only defining a subset of wire events, these payloads omit
/// wire fields that are trivially derivable from world state.
#[derive(Debug, Clone)]
pub enum EventKind {
    /// A player has died.
    /// Typically sent on the tick on which the player's HP reaches zero, but
    /// can be observed later if the player is not in render distance (e.g.
    /// indirectly through a varbit).
    PlayerDeath(PartyIndex),
    PlayerAttack(PlayerAttacked),
    PlayerSpell(PlayerCast),

    /// The first appearance of an NPC in the client.
    /// Render distance may mean that this is not actually when it spawned.
    NpcSpawn(RoomId),
    /// An NPC has despawned following the completion of its death animation.
    NpcDeath(NpcDeath),
    NpcAttack(NpcAttacked),

    /// A crab has reached Maiden with HP remaining.
    MaidenCrabLeak(RoomId),
    BloatDown(BloatDown),
    BloatUp,
    BloatHandsDrop(Vec<Point>),
    BloatHandsSplat(Vec<Point>),
    NyloWaveSpawn(NyloWave),
    NyloWaveStall(NyloWave),
    NyloCleanupEnd,
    NyloBossSpawn,
    SoteMazeProc(Maze),
    SoteMazePivots(SoteMazePivots),
    SoteMazeEnd(SoteMazeEnd),
    XarpusPhase(XarpusPhase),
    XarpusExhumed(XarpusExhumed),
    XarpusSplat(XarpusSplat),
    VerzikPhase(VerzikPhase),
    VerzikDawnDropped(Point),
    VerzikDawnPickedUp(Point),
    VerzikDawnHit(VerzikDawnHit),
    VerzikBounce(VerzikBounce),
    VerzikAttackStyle(AttackStyle),
    VerzikHeal(VerzikHeal),

    HandicapChoice(HandicapChoice),
    DoomApplied,
    TotemHeal(TotemHeal),
    SolDust(SolDust),
    SolGrapple(SolGrapple),
    SolPools(Vec<Point>),
    SolLasers(SolLaserPhase),

    MokhaiotlAttackStyle(AttackStyle),
    MokhaiotlOrb(MokhaiotlOrb),
    MokhaiotlLarvaLeak(MokhaiotlLarvaLeak),

    /// Not really an "event" in the normal sense, as it doesn't describe
    /// anything that happened within a stage. The plugin sends one of these
    /// on tick 0 of each wave with its own accounting of the ticks elapsed
    /// since the start of the challenge, including inter-wave gaps.
    /// Not sent if the player ever logs out since the clock is no longer
    /// monotonic.
    InfernoWaveStart(Ticks),
}

/// An attack performed by a player.
#[derive(Debug, Clone)]
pub struct PlayerAttacked {
    pub player: PartyIndex,
    pub attack: PlayerAttack,
    pub weapon: Option<Item>,
    pub target: Option<Actor>,
}

/// A spell cast by a player.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlayerCast {
    pub player: PartyIndex,
    pub spell: PlayerSpell,
    pub target: Option<Actor>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NpcDeath {
    pub position: Point,
    pub npc: RoomId,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NpcAttacked {
    pub npc: RoomId,
    pub attack: NpcAttack,
    pub target: Option<Actor>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BloatDown {
    pub down_number: u32,
    /// Number of ticks since Bloat last got up (or the start of the fight).
    /// Note: you almost certainly want [`BloatDown::walk_ticks`] instead.
    pub up_ticks: Ticks,
}

impl BloatDown {
    /// Returns Bloat's walk duration.
    #[must_use]
    pub fn walk_ticks(&self) -> Ticks {
        self.up_ticks.dec()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NyloWave {
    /// Wave number 1-31.
    pub wave: u8,
    pub nylos_alive: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Maze {
    Maze66 = 0,
    Maze33 = 1,
}

#[derive(Debug, Clone)]
pub struct SoteMazePivots {
    pub maze: Maze,
    pub overworld: Vec<Point>,
    pub underworld: Vec<Point>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SoteMazeEnd {
    pub maze: Maze,
    pub chosen: Option<PartyIndex>,
}

/// The lifecycle of an exhumed, emitted after it despawns.
#[derive(Debug, Clone)]
pub struct XarpusExhumed {
    pub position: Point,
    pub spawn_tick: Tick,
    pub heal_ticks: Vec<Tick>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct XarpusSplat {
    pub position: Point,
    pub source: XarpusSplatSource,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum XarpusSplatSource {
    Unknown,
    Xarpus,
    Bounce(Point),
}

// TODO(frolv): consider a generic event that retroactively attaches damage
// to player attacks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VerzikDawnHit {
    pub player: PartyIndex,
    pub attack_tick: Tick,
    pub damage: u32,
}

/// Tracks the chance of Verzik bounces. Sent following every P2 attack.
/// If the attack was a bounce, `bounced` stores the player who bounced.
/// Otherwise, Verzik used a different attack and the players in range
/// indicate whether anyone chanced a bounce.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VerzikBounce {
    pub attack_tick: Tick,
    /// Number of players adjacent to or under Verzik. Always set.
    pub players_in_range: u8,
    pub bounced: Option<PartyIndex>,
}

/// Identifies the style of a previous NPC attack.
// TODO(frolv): Replace disjoint uses of this with a generic attack style event.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AttackStyle {
    pub attack_tick: Tick,
    pub style: CombatStyle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VerzikHeal {
    pub player: PartyIndex,
    pub amount: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HandicapChoice {
    pub handicap: ColosseumHandicap,
    pub options: [ColosseumHandicap; 3],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TotemHeal {
    pub totem: RoomId,
    pub target: RoomId,
    pub start_tick: Tick,
    pub amount: u32,
}

/// The patterns of Sol's basic attacks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SolDust {
    Trident1(SolDustDirection),
    Trident2(SolDustDirection),
    Shield1,
    Shield2,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SolGrapple {
    pub attack_tick: Tick,
    pub target: EquipmentSlot,
    pub outcome: SolGrappleOutcome,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MokhaiotlOrb {
    pub source: MokhaiotlOrbSource,
    pub source_point: Point,
    pub style: CombatStyle,
    pub spawn_tick: Tick,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MokhaiotlLarvaLeak {
    pub larva: RoomId,
    pub heal_amount: u32,
}
