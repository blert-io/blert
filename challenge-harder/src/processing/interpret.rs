//! Stage event reconstruction and interpretation.

use std::collections::BTreeSet;
use std::panic::{self, AssertUnwindSafe};
use std::time::Instant;

use blert::{EquipmentSlot, EventKind, PlayerState, Tick, TickState, item};

use crate::lifecycle::core::types::{ClientStageStream, PrimaryMeleeGear};
use crate::merging::{self, MergeReport, MergedTimeline};
use crate::metrics;

use super::ChallengeInfo;
use super::challenge_processor::{ChallengeProcessor, StageContext};

/// The interpreted result of a stage's events.
#[derive(Debug)]
pub struct InterpretOutput {
    pub(super) merged: MergedTimeline,
    pub(super) ctx: StageContext,
    pub(super) report: MergeReport,
}

/// A failure to interpret a stage's recorded data.
#[derive(Debug)]
pub enum InterpretError {
    /// The stage has no recorded data to process.
    NoData,
    BadData(MergeReport),
    Panicked(String),
}

/// Processes a stage's raw events into a canonical timeline.
pub fn interpret(
    challenge: ChallengeInfo,
    records: &[ClientStageStream],
    processor: &mut dyn ChallengeProcessor,
) -> Result<InterpretOutput, InterpretError> {
    match panic::catch_unwind(AssertUnwindSafe(|| {
        run_interpret(challenge, records, processor)
    })) {
        Ok(result) => result,
        Err(payload) => Err(InterpretError::Panicked(
            payload
                .downcast_ref::<&str>()
                .map(|&s| s.to_string())
                .or_else(|| payload.downcast_ref::<String>().cloned())
                .unwrap_or("unknown panic".to_string()),
        )),
    }
}

fn run_interpret(
    challenge: ChallengeInfo,
    records: &[ClientStageStream],
    processor: &mut dyn ChallengeProcessor,
) -> Result<InterpretOutput, InterpretError> {
    let ChallengeInfo {
        uuid,
        challenge_type,
        mode,
        stage,
        party,
        party_changed,
        ..
    } = challenge;

    let merge_info = merging::ChallengeInfo {
        uuid,
        challenge_type,
        mode,
        party: &party,
    };

    let mut client_ids = BTreeSet::new();
    let mut total_bytes = 0;
    for record in records {
        client_ids.insert(record.client_id());
        if let ClientStageStream::Events { events, .. } = record {
            total_bytes += events.len();
        }
    }
    metrics::record_stage_event_payload(stage, total_bytes, client_ids.len());

    let started = Instant::now();
    let (merged, report) = merging::merge(&merge_info, stage, records, None);
    metrics::observe_merge_duration(stage, started.elapsed().as_secs_f64() * 1000.0);
    let Some(mut merged) = merged else {
        return Err(if report.clients.is_empty() {
            InterpretError::NoData
        } else {
            InterpretError::BadData(report)
        });
    };

    let mut ctx = StageContext::new(stage, party);

    let timeline = merged.timeline();
    for tick in Tick(0).through(timeline.last_tick()) {
        let Some(state) = timeline.get_state(tick) else {
            continue;
        };
        track_tick(&mut ctx, state);
        processor.process_tick(&mut ctx, tick, state, timeline);
    }

    if party_changed {
        merged.restrict_accuracy_to(Tick(0));
    }

    Ok(InterpretOutput {
        merged,
        ctx,
        report,
    })
}

/// Records a tick's player deaths and any newly determined player gear.
fn track_tick(ctx: &mut StageContext, state: &TickState) {
    for event in &state.events {
        if let EventKind::PlayerDeath(index) = event.kind {
            ctx.record_death(index.as_usize());
        }
    }

    for (index, player) in state.players.iter() {
        if let Some(data) = ctx.player_mut(index.as_usize())
            && data.gear.is_none()
            && let Some(gear) = try_determine_gear(player)
        {
            data.gear = Some(gear);
        }
    }
}

/// Determines a player's primary melee gear from their equipped torso and head.
fn try_determine_gear(player: &PlayerState) -> Option<PrimaryMeleeGear> {
    let mut gear = player
        .equipped(EquipmentSlot::Torso)
        .and_then(|item| match item.id {
            item::id::RADIANT_OATHPLATE_CHEST => Some(PrimaryMeleeGear::RadiantOathplate),
            item::id::OATHPLATE_CHEST => Some(PrimaryMeleeGear::Oathplate),
            item::id::SANGUINE_TORVA_PLATEBODY => Some(PrimaryMeleeGear::Blorva),
            item::id::TORVA_PLATEBODY => Some(PrimaryMeleeGear::Torva),
            item::id::BANDOS_CHESTPLATE => Some(PrimaryMeleeGear::Bandos),
            _ => None,
        });

    if player.equipped(EquipmentSlot::Head).is_some_and(|item| {
        matches!(
            item.id,
            item::id::VOID_MELEE_HELM | item::id::VOID_MELEE_HELM_OR
        )
    }) {
        gear = Some(PrimaryMeleeGear::EliteVoid);
    }

    gear
}

#[cfg(test)]
mod tests {
    use blert::{Item, ItemDelta, Rsn, Slot, Ticks, Timeline};
    use bytes::Bytes;
    use prost::Message;

    use super::super::challenge_processor::{ChallengeContext, ChallengeTicks};
    use super::super::db;
    use super::*;
    use crate::lifecycle::core::types::{
        ChallengeMode, ChallengeStatus, ChallengeType, ClientId, Stage, StageStatus, UserId,
    };
    use crate::merging::fixtures::{
        PlayerUpdateEvent, ServerTicks, merged_events, player_death_event,
    };
    use crate::proto::ChallengeEvents;

    fn context() -> StageContext {
        StageContext::new(
            Stage::TobMaiden,
            vec![
                Rsn::try_from("1Ogp").unwrap(),
                Rsn::try_from("WWWWWWWWWWQQ").unwrap(),
            ],
        )
    }

    #[test]
    fn player_deaths_are_recorded_by_party_index() {
        let merged = merged_events(
            Stage::TobMaiden,
            ChallengeMode::TobRegular,
            vec![
                Rsn::try_from("1Ogp").unwrap(),
                Rsn::try_from("WWWWWWWWWWQQ").unwrap(),
            ],
            vec![
                player_death_event(Tick(10), Stage::TobMaiden, (3167, 4450), "WWWWWWWWWWQQ", 1),
                player_death_event(Tick(25), Stage::TobMaiden, (3170, 4439), "1Ogp", 0),
            ],
            StageStatus::Started,
            ServerTicks::Missing,
        );

        let mut ctx = context();
        let timeline = merged.timeline();
        for tick in Tick(0).through(timeline.last_tick()) {
            if let Some(state) = timeline.get_state(tick) {
                track_tick(&mut ctx, state);
            }
        }
        assert_eq!(ctx.deaths(), &[1, 0]);
    }

    #[test]
    fn gear_is_determined_once_from_added_equipment() {
        let torva = ItemDelta::Add(
            Slot(EquipmentSlot::Torso as u8),
            Item {
                id: item::id::TORVA_PLATEBODY,
                quantity: 1,
            },
        );
        let bandos = [
            ItemDelta::Remove(
                Slot(EquipmentSlot::Torso as u8),
                Item {
                    id: item::id::TORVA_PLATEBODY,
                    quantity: 1,
                },
            ),
            ItemDelta::Add(
                Slot(EquipmentSlot::Torso as u8),
                Item {
                    id: item::id::BANDOS_CHESTPLATE,
                    quantity: 1,
                },
            ),
        ];
        let merged = merged_events(
            Stage::TobMaiden,
            ChallengeMode::TobRegular,
            vec![
                Rsn::try_from("1Ogp").unwrap(),
                Rsn::try_from("WWWWWWWWWWQQ").unwrap(),
            ],
            vec![
                PlayerUpdateEvent::new(Tick(1), Stage::TobMaiden, "1Ogp", (3167, 4450))
                    .equipment_deltas(&[torva])
                    .build(),
                PlayerUpdateEvent::new(Tick(1), Stage::TobMaiden, "WWWWWWWWWWQQ", (3170, 4439))
                    .party_index(1)
                    .build(),
                PlayerUpdateEvent::new(Tick(2), Stage::TobMaiden, "1Ogp", (3167, 4450))
                    .equipment_deltas(&bandos)
                    .build(),
            ],
            StageStatus::Started,
            ServerTicks::Missing,
        );

        let mut ctx = context();
        let timeline = merged.timeline();
        for tick in Tick(0).through(timeline.last_tick()) {
            if let Some(state) = timeline.get_state(tick) {
                track_tick(&mut ctx, state);
            }
        }
        let gear: Vec<_> = ctx.players().iter().map(|p| p.gear).collect();
        assert_eq!(gear, [Some(PrimaryMeleeGear::Torva), None]);
    }

    #[test]
    fn panic_during_processing_errors_with_the_panic_message() {
        struct PanicOnEvent;

        #[async_trait::async_trait]
        impl ChallengeProcessor for PanicOnEvent {
            fn process_tick(
                &mut self,
                _ctx: &mut StageContext,
                _tick: Tick,
                _state: &TickState,
                _timeline: &Timeline,
            ) {
                panic!("Cannot read properties of undefined (reading 'event')")
            }

            async fn on_create(&mut self, _txn: &db::Transaction) -> Result<(), db::Error> {
                Ok(())
            }

            async fn on_stage_finished(
                &mut self,
                _txn: &db::Transaction,
                _price_resolver: &crate::price::PriceResolver,
                _stored: &super::super::StoredState,
                _ctx: &mut StageContext,
                _stage: Stage,
                merged: &MergedTimeline,
            ) -> Result<ChallengeTicks, db::Error> {
                Ok(ChallengeTicks::Add(merged.duration()))
            }

            async fn on_finish(
                &mut self,
                _txn: &db::Transaction,
                _stored: &super::super::StoredState,
                _ctx: &mut ChallengeContext,
                _final_ticks: Ticks,
            ) -> Result<(), db::Error> {
                Ok(())
            }

            fn custom_data(&self) -> Option<serde_json::Value> {
                None
            }

            fn challenge_data(&self) -> Option<crate::proto::ChallengeData> {
                None
            }

            fn has_fully_recorded_up_to(&self, _stage: Stage) -> bool {
                false
            }
        }

        let message = ChallengeEvents {
            events: vec![crate::merging::fixtures::mokhaiotl_larva_leak_event(
                Tick(0),
                Stage::MokhaiotlDelve1,
                40_123,
                5,
            )],
            ..Default::default()
        };
        let info = ChallengeInfo {
            uuid: "a8cb035f-410a-45de-a4d3-2b0a5d8b464d".parse().unwrap(),
            session_uuid: "5e55b41c-6a3f-4a89-9e10-c1a7d2f3b804".parse().unwrap(),
            challenge_type: ChallengeType::Mokhaiotl,
            mode: ChallengeMode::NoMode,
            party: vec![Rsn::try_from("aSaradomin").unwrap()],
            party_changed: false,
            stage: Stage::MokhaiotlDelve1,
            stage_attempt: None,
            status: ChallengeStatus::InProgress,
            created_unix_ms: 0,
            reported_times: None,
            finished_unix_ms: None,
        };

        let result = interpret(
            info,
            &[
                ClientStageStream::Metadata {
                    client_id: ClientId(1),
                    user_id: UserId(10),
                    plugin_version: "0.10.0-RUNELITE".into(),
                    runelite_version: "runelite-1.13.2".into(),
                    recording_config_version: Some(1),
                },
                ClientStageStream::Events {
                    client_id: ClientId(1),
                    events: Bytes::from(message.encode_to_vec()),
                },
            ],
            &mut PanicOnEvent,
        );

        let Err(InterpretError::Panicked(message)) = result else {
            panic!("didn't get a panic? here you go");
        };
        assert_eq!(
            message,
            "Cannot read properties of undefined (reading 'event')"
        );
    }
}
