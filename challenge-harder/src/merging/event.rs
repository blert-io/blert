//! Event classification by merge policy.

use crate::lifecycle::core::types::ClientId;
use crate::proto::{Event, event};

#[derive(Debug, Clone)]
pub struct TaggedEvent(ClientId, Event);

impl TaggedEvent {
    const SYNTHETIC_CLIENT_ID: ClientId = ClientId(0);

    /// Tags an event with the client that recorded it.
    pub fn new(client_id: ClientId, event: Event) -> TaggedEvent {
        TaggedEvent(client_id, event)
    }

    /// Tags an event originating from the merger.
    pub fn synthetic(event: Event) -> TaggedEvent {
        TaggedEvent(Self::SYNTHETIC_CLIENT_ID, event)
    }
}

/// The category of an event within the merger, determining its handling.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub enum Class {
    /// Legacy protocol events that are not sent by clients.
    Deprecated,

    /// Event types from solo-only challenges that never have to be merged.
    /// They pass through the pipeline as-is.
    Solo,

    /// Event types derived from the final merged timeline rather than
    /// reconciled between clients.
    Derived,

    /// Event types representing per-tick game state. Consumed into tick state
    /// on ingest, merged tick by tick, and reconstructed afterwards.
    TickState,

    /// Event types that are temporally deduplicated between clients.
    Stream,

    /// Event types that augment a previous attack with additional context.
    /// Resolved by mapping them back to their attack in the merged timeline.
    AttackMapped,
}

pub const fn classify(kind: event::Type) -> Class {
    match kind {
        event::Type::DeprecatedChallengeStart
        | event::Type::DeprecatedChallengeEnd
        | event::Type::DeprecatedChallengeUpdate
        | event::Type::DeprecatedStageUpdate => Class::Deprecated,

        event::Type::ColosseumHandicapChoice
        | event::Type::ColosseumDoomApplied
        | event::Type::ColosseumTotemHeal
        | event::Type::ColosseumReentryPools
        | event::Type::ColosseumSolDust
        | event::Type::ColosseumSolGrapple
        | event::Type::ColosseumSolPools
        | event::Type::ColosseumSolLasers
        | event::Type::MokhaiotlAttackStyle
        | event::Type::MokhaiotlOrb
        | event::Type::MokhaiotlObjects
        | event::Type::MokhaiotlLarvaLeak
        | event::Type::MokhaiotlShockwave
        | event::Type::InfernoWaveStart => Class::Solo,

        event::Type::TobNyloWaveStall
        | event::Type::TobNyloCleanupEnd
        | event::Type::TobNyloBossSpawn
        | event::Type::TobVerzikRedsSpawn => Class::Derived,

        event::Type::PlayerUpdate
        | event::Type::PlayerAttack
        | event::Type::PlayerSpell
        | event::Type::NpcUpdate
        | event::Type::NpcAttack
        | event::Type::TobMaidenBloodSplats
        | event::Type::TobVerzikYellows
        | event::Type::TobSoteMazePath => Class::TickState,

        event::Type::PlayerDeath
        | event::Type::NpcSpawn
        | event::Type::NpcDeath
        | event::Type::TobMaidenCrabLeak
        | event::Type::TobBloatDown
        | event::Type::TobBloatUp
        | event::Type::TobBloatHandsDrop
        | event::Type::TobBloatHandsSplat
        | event::Type::TobNyloWaveSpawn
        | event::Type::TobSoteMazeProc
        | event::Type::TobSoteMazeEnd
        | event::Type::TobXarpusPhase
        | event::Type::TobXarpusExhumed
        | event::Type::TobXarpusSplat
        | event::Type::TobVerzikPhase
        | event::Type::TobVerzikDawnDrop
        | event::Type::TobVerzikHeal => Class::Stream,

        event::Type::TobVerzikAttackStyle
        | event::Type::TobVerzikBounce
        | event::Type::TobVerzikDawn => Class::AttackMapped,
    }
}
