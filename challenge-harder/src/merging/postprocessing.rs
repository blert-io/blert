//! Post-merge event fiddling.

use crate::npc;
use crate::proto::{Stage, event};
use crate::skill::SkillLevel;

use super::timeline::Timeline;
use super::{MergeContext, Tick};

/// Applies post-merge event corrections to a timeline.
pub(super) fn postprocess(ctx: &MergeContext<'_>, timeline: &mut Timeline<'_>) {
    if ctx.stage == Stage::TobMaiden {
        correct_offset_maiden_spawn(timeline);
    }
}

fn correct_offset_maiden_spawn(timeline: &mut Timeline<'_>) {
    // On 2025-02-18, a RuneScape update limited clients to receiving events
    // from only actors that were rendered, rather than all actors in an
    // instance. This is likely to manifest in many ways, but the first known
    // issue is that Maiden only appears two ticks into the room from an
    // entering player's perspective.
    //
    // Correct this by moving Maiden's spawn event to the start of the stage and
    // inserting fake NPC update events during the missing ticks. Fortunately,
    // Maiden can't be attacked during this time, so we can just set her HP to
    // 100%.
    //
    // Update 2026-09-06: yep.
    let Some((tick, room_id, hitpoints)) = timeline
        .tick_states()
        .iter()
        .flatten()
        .flat_map(|state| state.events_of_type(event::Type::NpcSpawn))
        .find_map(|event| {
            let npc = event.npc.as_ref().expect("validated at build");
            npc::is_maiden(npc.id).then(|| {
                (
                    Tick(event.tick),
                    npc.room_id,
                    SkillLevel::from_raw(npc.hitpoints),
                )
            })
        })
    else {
        return;
    };

    // Confirm that Maiden is at full HP to try to avoid the case where the
    // client has lost ticks and recorded tick 2 isn't actually the second tick.
    if tick != Tick(2) || hitpoints.current != hitpoints.base {
        return;
    }

    let Some(state) = timeline.get_mut(tick) else {
        return;
    };

    let Some(spawn) = state
        .extract_events(|event| {
            event.r#type() == event::Type::NpcSpawn
                && event.npc.as_ref().expect("validated at build").room_id == room_id
        })
        .into_iter()
        .next()
    else {
        return;
    };
    let (_, mut spawn) = spawn.split();

    // On the affected tick, change the NPC spawn event to an NPC update.
    let mut update = spawn.clone();
    update.set_type(event::Type::NpcUpdate);
    state.add_synthetic_event(update.clone());

    spawn.tick = 0;

    // Add the appropriate NPC events for the initial ticks of the stage.
    for t in tick.up_to() {
        let Some(state) = timeline.get_mut(t) else {
            continue;
        };

        let event = if t == Tick(0) {
            spawn.clone()
        } else {
            let mut event = update.clone();
            event.tick = t.0;
            event
        };

        state.add_synthetic_event(event);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::merging::fixtures::{self, NpcEvent};
    use crate::merging::timeline::TickState;
    use crate::proto::Event;

    static PARTY: std::sync::LazyLock<Vec<String>> =
        std::sync::LazyLock::new(|| vec!["1Ogp".to_string()]);

    fn maiden_spawn(tick: Tick, hitpoints: SkillLevel) -> Event {
        fixtures::npc_spawn_event(NpcEvent {
            tick,
            stage: Stage::TobMaiden,
            coords: (3162, 4444),
            npc_id: npc::id::MAIDEN_REGULAR,
            room_id: 1,
            hitpoints,
            ..Default::default()
        })
    }

    fn player_update(tick: Tick) -> Event {
        fixtures::PlayerUpdateEvent::new(tick, Stage::TobMaiden, "1Ogp", (3184, 4448)).build()
    }

    fn npc_events(timeline: &Timeline<'_>) -> Vec<(Tick, event::Type, u64, SkillLevel)> {
        timeline
            .tick_states()
            .iter()
            .flatten()
            .flat_map(TickState::events)
            .map(|event| {
                let npc = event.npc.as_ref().expect("npc event");
                (
                    Tick(event.tick),
                    event.r#type(),
                    npc.room_id,
                    SkillLevel::from_raw(npc.hitpoints),
                )
            })
            .collect()
    }

    #[test]
    fn maiden_spawn_at_full_hp_on_tick_2_moves_to_tick_0_and_fills_updates() {
        let full = SkillLevel {
            current: 2625,
            base: 2625,
        };
        let mut timeline = fixtures::timeline(
            &PARTY,
            Tick(2),
            vec![
                player_update(Tick(0)),
                player_update(Tick(1)),
                player_update(Tick(2)),
                maiden_spawn(Tick(2), full),
            ],
        );

        correct_offset_maiden_spawn(&mut timeline);

        assert_eq!(
            npc_events(&timeline),
            vec![
                (Tick(0), event::Type::NpcSpawn, 1, full),
                (Tick(1), event::Type::NpcUpdate, 1, full),
                (Tick(2), event::Type::NpcUpdate, 1, full),
            ],
        );
    }

    #[test]
    fn maiden_spawn_after_tick_2_is_ignored() {
        let full = SkillLevel {
            current: 2625,
            base: 2625,
        };
        let mut timeline = fixtures::timeline(
            &PARTY,
            Tick(3),
            vec![
                player_update(Tick(0)),
                player_update(Tick(1)),
                player_update(Tick(2)),
                player_update(Tick(3)),
                maiden_spawn(Tick(3), full),
            ],
        );

        correct_offset_maiden_spawn(&mut timeline);

        assert_eq!(
            npc_events(&timeline),
            vec![(Tick(3), event::Type::NpcSpawn, 1, full)],
        );
    }

    #[test]
    fn maiden_spawn_damaged_on_tick_2_is_ignored() {
        let damaged = SkillLevel {
            current: 2500,
            base: 2625,
        };
        let mut timeline = fixtures::timeline(
            &PARTY,
            Tick(2),
            vec![
                player_update(Tick(0)),
                player_update(Tick(1)),
                player_update(Tick(2)),
                maiden_spawn(Tick(2), damaged),
            ],
        );

        correct_offset_maiden_spawn(&mut timeline);

        assert_eq!(
            npc_events(&timeline),
            vec![(Tick(2), event::Type::NpcSpawn, 1, damaged)],
        );
    }

    #[test]
    fn maiden_spawn_skips_leading_ticks_without_state() {
        let full = SkillLevel {
            current: 2625,
            base: 2625,
        };
        let mut timeline = fixtures::timeline(
            &PARTY,
            Tick(2),
            vec![player_update(Tick(2)), maiden_spawn(Tick(2), full)],
        );

        correct_offset_maiden_spawn(&mut timeline);

        assert!(timeline.get(Tick(0)).is_none());
        assert!(timeline.get(Tick(1)).is_none());
        assert_eq!(
            npc_events(&timeline),
            vec![(Tick(2), event::Type::NpcUpdate, 1, full)],
        );
    }
}
