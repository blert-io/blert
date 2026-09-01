//! Event classification by merge policy.

use crate::lifecycle::core::types::ClientId;
use crate::proto::{Event, NpcAttack, PlayerAttack, event};

use super::Tick;

#[derive(Debug, Clone)]
pub struct TaggedEvent(ClientId, Event);

impl TaggedEvent {
    const SYNTHETIC_CLIENT_ID: ClientId = ClientId(0);

    /// Tags an event with the client that recorded it.
    pub fn new(client_id: ClientId, event: Event) -> Self {
        Self(client_id, event)
    }

    /// Tags an event originating from the merger.
    pub fn synthetic(event: Event) -> Self {
        Self(Self::SYNTHETIC_CLIENT_ID, event)
    }

    /// Returns the client that recorded this event.
    pub fn source(&self) -> ClientId {
        self.0
    }

    pub fn split(self) -> (ClientId, Event) {
        (self.0, self.1)
    }
}

impl std::ops::Deref for TaggedEvent {
    type Target = Event;

    fn deref(&self) -> &Self::Target {
        &self.1
    }
}

impl std::ops::DerefMut for TaggedEvent {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.1
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum MalformedEvent {
    #[error("{kind:?}:{tick} is missing required payload {field:?}")]
    MissingPayload {
        kind: event::Type,
        tick: Tick,
        field: &'static str,
    },
    #[error("{kind:?}:{tick} has out-of-domain {field:?} value {value}")]
    OutOfDomain {
        kind: event::Type,
        tick: Tick,
        field: &'static str,
        value: String,
    },
}

/// Checks that an event has the required payload for its type.
// TODO(frolv): Replace this with an in-memory structured model.
#[expect(clippy::too_many_lines)]
pub(super) fn validate(event: &Event) -> Result<(), MalformedEvent> {
    let kind = event.r#type();
    let require = |present: bool, field: &'static str| {
        if present {
            Ok(())
        } else {
            Err(MalformedEvent::MissingPayload {
                kind,
                tick: Tick(event.tick),
                field,
            })
        }
    };

    match kind {
        event::Type::Unspecified => Err(MalformedEvent::MissingPayload {
            kind,
            tick: Tick(event.tick),
            field: "type",
        }),

        event::Type::PlayerUpdate | event::Type::PlayerDeath => {
            require(event.player.is_some(), "player")
        }
        event::Type::PlayerAttack => {
            require(event.player.is_some(), "player")?;
            require(event.player_attack.is_some(), "player_attack")
        }
        event::Type::PlayerSpell => {
            require(event.player.is_some(), "player")?;
            require(event.player_spell.is_some(), "player_spell")
        }
        event::Type::NpcSpawn
        | event::Type::NpcUpdate
        | event::Type::NpcDeath
        | event::Type::TobMaidenCrabLeak => require(event.npc.is_some(), "npc"),
        event::Type::NpcAttack => {
            require(event.npc.is_some(), "npc")?;
            require(event.npc_attack.is_some(), "npc_attack")
        }

        event::Type::TobMaidenBloodSplats => {
            require(!event.maiden_blood_splats.is_empty(), "maiden_blood_splats")
        }
        event::Type::TobBloatHandsDrop | event::Type::TobBloatHandsSplat => {
            require(!event.bloat_hands.is_empty(), "bloat_hands")
        }
        event::Type::TobBloatDown => require(event.bloat_down.is_some(), "bloat_down"),
        event::Type::TobNyloWaveSpawn | event::Type::TobNyloWaveStall => {
            require(event.nylo_wave.is_some(), "nylo_wave")
        }
        event::Type::TobSoteMazeProc
        | event::Type::TobSoteMazeEnd
        | event::Type::TobSoteMazePath => require(event.sote_maze.is_some(), "sote_maze"),
        event::Type::TobXarpusPhase => require(event.xarpus_phase.is_some(), "xarpus_phase"),
        event::Type::TobXarpusExhumed => require(event.xarpus_exhumed.is_some(), "xarpus_exhumed"),
        event::Type::TobXarpusSplat => require(event.xarpus_splat.is_some(), "xarpus_splat"),
        event::Type::TobVerzikPhase => require(event.verzik_phase.is_some(), "verzik_phase"),
        event::Type::TobVerzikAttackStyle => {
            require(event.verzik_attack_style.is_some(), "verzik_attack_style")
        }
        event::Type::TobVerzikBounce => require(event.verzik_bounce.is_some(), "verzik_bounce"),
        event::Type::TobVerzikDawn => require(event.verzik_dawn.is_some(), "verzik_dawn"),
        event::Type::TobVerzikDawnDrop => {
            require(event.verzik_dawn_drop.is_some(), "verzik_dawn_drop")
        }
        event::Type::TobVerzikHeal => require(event.verzik_heal.is_some(), "verzik_heal"),

        event::Type::ColosseumHandicapChoice => require(event.handicap.is_some(), "handicap"),
        event::Type::ColosseumTotemHeal => {
            require(event.colosseum_totem_heal.is_some(), "colosseum_totem_heal")
        }
        event::Type::ColosseumReentryPools => require(
            event.colosseum_reentry_pools.is_some(),
            "colosseum_reentry_pools",
        ),
        event::Type::ColosseumSolDust => {
            require(event.colosseum_sol_dust.is_some(), "colosseum_sol_dust")
        }
        event::Type::ColosseumSolGrapple => require(
            event.colosseum_sol_grapple.is_some(),
            "colosseum_sol_grapple",
        ),
        event::Type::ColosseumSolPools => {
            require(event.colosseum_sol_pools.is_some(), "colosseum_sol_pools")
        }
        event::Type::ColosseumSolLasers => {
            require(event.colosseum_sol_lasers.is_some(), "colosseum_sol_lasers")
        }

        event::Type::MokhaiotlAttackStyle => require(
            event.mokhaiotl_attack_style.is_some(),
            "mokhaiotl_attack_style",
        ),
        event::Type::MokhaiotlOrb => require(event.mokhaiotl_orb.is_some(), "mokhaiotl_orb"),
        event::Type::MokhaiotlObjects => {
            require(event.mokhaiotl_objects.is_some(), "mokhaiotl_objects")
        }
        event::Type::MokhaiotlLarvaLeak => {
            require(event.mokhaiotl_larva_leak.is_some(), "mokhaiotl_larva_leak")
        }
        event::Type::MokhaiotlShockwave => {
            require(event.mokhaiotl_shockwave.is_some(), "mokhaiotl_shockwave")
        }

        event::Type::InfernoWaveStart => {
            require(event.inferno_wave_start.is_some(), "inferno_wave_start")
        }

        event::Type::TobBloatUp
        | event::Type::TobNyloCleanupEnd
        | event::Type::TobNyloBossSpawn
        | event::Type::TobVerzikRedsSpawn
        | event::Type::TobVerzikYellows
        | event::Type::ColosseumDoomApplied => Ok(()),
    }
}

/// The category of an event within the merger, determining its handling.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub enum Class {
    /// The default, empty event type. Always invalid.
    Unspecified,

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
        event::Type::Unspecified => Class::Unspecified,

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

// Some player and NPC attacks share the same animation and are identified by
// which projectile is fired. However, projectiles have a shorter render
// distance than actors, so two clients could report contradictory attacks from
// the same actor on what is legitimately the same tick.

/// Collapses a projectile-ambiguous player attack to its canonical value.
pub(super) fn normalize_player_attack(attack: PlayerAttack) -> PlayerAttack {
    // DAWN_AUTO/DAWN_SPEC are deliberately ignored, as there isn't a realistic
    // case where someone would be out of render distance of the projectile.
    match attack {
        PlayerAttack::BlowpipeSpec => PlayerAttack::Blowpipe,
        PlayerAttack::ZcbSpec => PlayerAttack::ZcbAuto,
        other => other,
    }
}

/// Collapses a projectile-ambiguous NPC attack to its canonical value.
pub(super) fn normalize_npc_attack(attack: NpcAttack) -> NpcAttack {
    match attack {
        NpcAttack::TobSoteDeathBall => NpcAttack::TobSoteBall,
        other => other,
    }
}

/// Rewrites all of an event's tick references with a mapping function.
pub(super) fn remap_event_tick(event: &mut Event, remap: impl Fn(Tick) -> Tick) {
    debug_assert_ne!(classify(event.r#type()), Class::TickState);

    // TODO(frolv): eventually unpack proto events...
    let t = |tick: u32| remap(Tick(tick)).0;

    match event.r#type() {
        event::Type::TobXarpusExhumed => {
            let exhumed = event.xarpus_exhumed.as_mut().expect("validated at build");
            exhumed.spawn_tick = t(exhumed.spawn_tick);
            for heal_tick in &mut exhumed.heal_ticks {
                *heal_tick = t(*heal_tick);
            }
        }
        event::Type::TobVerzikAttackStyle => {
            let style = event
                .verzik_attack_style
                .as_mut()
                .expect("validated at build");
            style.npc_attack_tick = t(style.npc_attack_tick);
        }
        event::Type::TobVerzikBounce => {
            let bounce = event.verzik_bounce.as_mut().expect("validated at build");
            // signed for hysterical reasons
            let remapped = t(bounce.npc_attack_tick.cast_unsigned());
            bounce.npc_attack_tick = remapped.cast_signed();
        }
        event::Type::TobVerzikDawn => {
            let dawn = event.verzik_dawn.as_mut().expect("validated at build");
            dawn.attack_tick = t(dawn.attack_tick);
        }
        event::Type::MokhaiotlAttackStyle => {
            let style = event
                .mokhaiotl_attack_style
                .as_mut()
                .expect("validated at build");
            style.npc_attack_tick = t(style.npc_attack_tick);
        }
        _ => {}
    }

    event.tick = t(event.tick);
}
