//! Mokhaiotl challenge processing.

use std::collections::BTreeSet;

use async_trait::async_trait;
use blert::{EventKind, Tick, TickState, Ticks, Timeline};
use serde::{Deserialize, Serialize};

use super::StoredState;
use super::challenge_processor::{
    ChallengeContext, ChallengeProcessor, ChallengeTicks, RoomNpc, StageContext,
};
use super::db;
use super::split::SplitType;
use crate::lifecycle::core::types::{
    ChallengeInfo, ChallengeStatus, ProcessingError, Stage, StageStatus,
};
use crate::merging::MergedTimeline;
use crate::price::PriceResolver;
use crate::proto::{ChallengeData, challenge_data};

/// In-flight mokhaiotl state stored between stages.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CustomData {
    delves: Vec<DelveData>,
    delve_1_to_8_ticks: Option<Ticks>,
}

impl CustomData {
    fn avg_deep_delve_ticks(&self) -> Option<Ticks> {
        let (total, count) = self
            .delves
            .iter()
            .filter(|delve| delve.stage == Stage::MokhaiotlDelve8plus)
            .fold((Ticks(0), 0_u32), |(total, count), delve| {
                (total + delve.challenge_ticks, count + 1)
            });
        if count == 0 {
            return None;
        }
        Some((total + Ticks(count / 2)) / count)
    }
}

/// Final state of a processed delve.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DelveData {
    stage: Stage,
    ticks_lost: u32,
    offset: Ticks,
    npcs: Vec<RoomNpc>,
    delve: u32,
    challenge_ticks: Ticks,
    larvae_leaked: u32,
}

impl DelveData {
    fn to_proto(&self) -> challenge_data::MokhaiotlDelve {
        challenge_data::MokhaiotlDelve {
            stage: self.stage as i32,
            ticks_lost: self.ticks_lost,
            offset: Some(self.offset.0),
            npcs: self.npcs.iter().map(Into::into).collect(),
            delve: self.delve,
            challenge_ticks: self.challenge_ticks.0,
            larvae_leaked: self.larvae_leaked,
        }
    }
}

fn delve(stage: Stage, attempt: Option<u32>) -> u32 {
    if stage == Stage::MokhaiotlDelve8plus {
        8 + attempt.unwrap_or(1)
    } else {
        (stage as u32) - (Stage::MokhaiotlDelve1 as u32) + 1
    }
}

/// In-flight state of the current delve.
#[derive(Debug, Default)]
struct DelveState {
    larvae_leaked: u32,
}

#[derive(Debug)]
pub struct MokhaiotlProcessor {
    challenge: ChallengeInfo,
    data: CustomData,
    current_delve: DelveState,
}

impl MokhaiotlProcessor {
    pub fn new(
        challenge: ChallengeInfo,
        custom_data: Option<&serde_json::Value>,
    ) -> Result<MokhaiotlProcessor, ProcessingError> {
        let data = match custom_data {
            Some(value) => {
                serde_json::from_value(value.clone()).map_err(|error| ProcessingError {
                    retriable: false,
                    message: format!("custom data deserialization failed: {error}"),
                })?
            }
            None => CustomData {
                delves: Vec::new(),
                delve_1_to_8_ticks: None,
            },
        };
        Ok(MokhaiotlProcessor {
            challenge,
            data,
            current_delve: DelveState::default(),
        })
    }
}

#[async_trait]
impl ChallengeProcessor for MokhaiotlProcessor {
    fn process_tick(
        &mut self,
        _ctx: &mut StageContext,
        _tick: Tick,
        state: &TickState,
        _timeline: &Timeline,
    ) {
        for event in &state.events {
            if matches!(event.kind, EventKind::MokhaiotlLarvaLeak(_)) {
                self.current_delve.larvae_leaked += 1;
            }
        }
    }

    async fn on_create(&mut self, txn: &db::Transaction) -> Result<(), db::Error> {
        txn.execute(
            "INSERT INTO mokhaiotl_challenge_stats (challenge_id, delve)
             VALUES ($1, $2)",
            &[
                &txn.challenge_id(),
                &delve(self.challenge.stage, self.challenge.stage_attempt).cast_signed(),
            ],
        )
        .await?;
        Ok(())
    }

    async fn on_stage_finished(
        &mut self,
        txn: &db::Transaction,
        _price_resolver: &PriceResolver,
        stored: &StoredState,
        ctx: &mut StageContext,
        stage: Stage,
        merged: &MergedTimeline,
    ) -> Result<ChallengeTicks, db::Error> {
        let completed = merged.status() == StageStatus::Completed;
        let challenge_ticks = stored.challenge_ticks + merged.duration();
        let delve = delve(stage, self.challenge.stage_attempt);
        let timeline = merged.timeline();

        self.data.delves.push(DelveData {
            stage,
            ticks_lost: merged.missing_tick_count(),
            offset: merged.offset(),
            npcs: timeline
                .npcs()
                .map(|(room_id, _)| RoomNpc::new(timeline, room_id))
                .collect(),
            delve,
            challenge_ticks: merged.duration(),
            larvae_leaked: self.current_delve.larvae_leaked,
        });

        if stage != Stage::MokhaiotlDelve8plus {
            if stage == Stage::MokhaiotlDelve8 {
                self.data.delve_1_to_8_ticks = Some(challenge_ticks);
            }
            let index = (stage as i32) - (Stage::MokhaiotlDelve1 as i32);
            let split = SplitType::try_from(SplitType::MokhaiotlDelve1 as i32 + index)
                .expect("delve splits are consecutive");
            ctx.set_stage_split(split, merged.last_tick(), Tick(0), true);

            if completed
                && stage > Stage::MokhaiotlDelve1
                && stage < Stage::MokhaiotlDelve8
                && self.has_fully_recorded_up_to(stage)
            {
                let split = SplitType::try_from(SplitType::MokhaiotlDelve3Start as i32 + index - 1)
                    .expect("delve start splits are consecutive");
                ctx.set_challenge_split(
                    split,
                    challenge_ticks,
                    Some(!self.challenge.party_changed && merged.has_precise_server_tick_count()),
                );
            }
        }

        for index in 0..self.challenge.party.len() {
            if let Some(player) = ctx.player_mut(index) {
                player.stats.mokhaiotl_total_delves += 1;
                if completed {
                    player.stats.mokhaiotl_delves_completed += 1;
                    if delve >= 8 {
                        player.stats.mokhaiotl_deep_delves_completed += 1;
                    }
                }
            }
        }

        let avg_deep_delve_ticks = (completed && stage == Stage::MokhaiotlDelve8plus)
            .then(|| self.data.avg_deep_delve_ticks())
            .flatten()
            .map(|ticks| ticks.0.cast_signed());

        txn.execute(
            "UPDATE mokhaiotl_challenge_stats
             SET delve = $1,
                 larvae_leaked = larvae_leaked + $2,
                 max_completed_delve = COALESCE($3, max_completed_delve),
                 avg_deep_delve_ticks = COALESCE($4, avg_deep_delve_ticks)
             WHERE challenge_id = $5",
            &[
                &delve.cast_signed(),
                &self.current_delve.larvae_leaked.cast_signed(),
                &completed.then_some(delve.cast_signed()),
                &avg_deep_delve_ticks,
                &txn.challenge_id(),
            ],
        )
        .await?;

        Ok(ChallengeTicks::Add(merged.duration()))
    }

    async fn on_finish(
        &mut self,
        _txn: &db::Transaction,
        _stored: &StoredState,
        ctx: &mut ChallengeContext,
        final_ticks: Ticks,
    ) -> Result<(), db::Error> {
        ctx.set_challenge_split(SplitType::MokhaiotlChallenge, final_ticks, None);

        for index in 0..self.challenge.party.len() {
            if let Some(player) = ctx.player_mut(index) {
                match self.challenge.status {
                    ChallengeStatus::Completed => player.stats.mokhaiotl_completions += 1,
                    ChallengeStatus::Reset => player.stats.mokhaiotl_resets += 1,
                    ChallengeStatus::Wiped => player.stats.mokhaiotl_wipes += 1,
                    ChallengeStatus::InProgress | ChallengeStatus::Abandoned => {}
                }
            }
        }

        Ok(())
    }

    fn custom_data(&self) -> Option<serde_json::Value> {
        Some(serde_json::to_value(&self.data).expect("custom data serializes"))
    }

    fn challenge_data(&self) -> Option<ChallengeData> {
        Some(ChallengeData {
            challenge_id: self.challenge.uuid.to_string(),
            stage_data: Some(challenge_data::StageData::Mokhaiotl(
                challenge_data::Mokhaiotl {
                    delves: self.data.delves.iter().map(DelveData::to_proto).collect(),
                },
            )),
        })
    }

    fn final_challenge_ticks(&self, total: Ticks) -> Ticks {
        self.data.delve_1_to_8_ticks.unwrap_or(total)
    }

    fn has_fully_recorded_up_to(&self, stage: Stage) -> bool {
        if !(Stage::MokhaiotlDelve1..=Stage::MokhaiotlDelve8plus).contains(&stage) {
            return false;
        }
        let recorded: BTreeSet<i32> = self
            .data
            .delves
            .iter()
            .map(|delve| delve.stage as i32)
            .collect();
        (Stage::MokhaiotlDelve1 as i32..=stage as i32).all(|value| recorded.contains(&value))
    }
}

#[cfg(test)]
mod tests {
    use blert::Rsn;
    use serde_json::json;

    use super::*;
    use crate::lifecycle::core::state::Trigger;
    use crate::lifecycle::core::types::{
        ChallengeMode, ChallengeStatus, ChallengeType, JournalSeq, PlayerId, PrimaryMeleeGear,
        StageStatus, Uuid,
    };
    use crate::merging::fixtures::{ServerTicks, merged_events, mokhaiotl_larva_leak_event};
    use crate::processing::StoredPlayerInfo;
    use crate::processing::split::ChallengeSplit;
    use crate::processing::stats::PlayerStatsDelta;

    #[test]
    fn processor_starts_with_empty_data() {
        let processor = MokhaiotlProcessor::new(
            ChallengeInfo {
                uuid: "a8cb035f-410a-45de-a4d3-2b0a5d8b464d".parse().unwrap(),
                session_uuid: "5e55b41c-6a3f-4a89-9e10-c1a7d2f3b804".parse().unwrap(),
                challenge_type: ChallengeType::Mokhaiotl,
                mode: ChallengeMode::NoMode,
                party: vec![Rsn::try_from("1Ogp").unwrap()],
                party_changed: false,
                stage: Stage::MokhaiotlDelve1,
                stage_attempt: None,
                status: ChallengeStatus::InProgress,
                created_unix_ms: 0,
                reported_times: None,
                finished_unix_ms: None,
            },
            None,
        )
        .unwrap();
        assert_eq!(
            processor.custom_data(),
            Some(json!({"delves": [], "delve1To8Ticks": null})),
        );
    }

    #[test]
    fn malformed_custom_data_fails_construction() {
        let error = MokhaiotlProcessor::new(
            ChallengeInfo {
                uuid: "a8cb035f-410a-45de-a4d3-2b0a5d8b464d".parse().unwrap(),
                session_uuid: "5e55b41c-6a3f-4a89-9e10-c1a7d2f3b804".parse().unwrap(),
                challenge_type: ChallengeType::Mokhaiotl,
                mode: ChallengeMode::NoMode,
                party: vec![Rsn::try_from("1Ogp").unwrap()],
                party_changed: false,
                stage: Stage::MokhaiotlDelve1,
                stage_attempt: None,
                status: ChallengeStatus::InProgress,
                created_unix_ms: 0,
                reported_times: None,
                finished_unix_ms: None,
            },
            Some(&json!({"delves": 51})),
        )
        .unwrap_err();
        assert!(!error.retriable);
        assert!(
            error
                .message
                .starts_with("custom data deserialization failed")
        );
    }

    #[test]
    fn delve_numbers() {
        for (stage, attempt, expected) in [
            (Stage::MokhaiotlDelve1, None, 1),
            (Stage::MokhaiotlDelve4, None, 4),
            (Stage::MokhaiotlDelve8, None, 8),
            (Stage::MokhaiotlDelve8plus, None, 9),
            (Stage::MokhaiotlDelve8plus, Some(1), 9),
            (Stage::MokhaiotlDelve8plus, Some(134), 142),
        ] {
            assert_eq!(
                delve(stage, attempt),
                expected,
                "{stage:?} attempt {attempt:?}"
            );
        }
    }

    fn delve_data(stage: Stage) -> DelveData {
        DelveData {
            stage,
            ticks_lost: 0,
            offset: Ticks(0),
            npcs: Vec::new(),
            delve: delve(stage, None),
            challenge_ticks: Ticks(90),
            larvae_leaked: 0,
        }
    }

    #[test]
    fn full_recording_requires_every_delve_from_the_first() {
        let challenge = ChallengeInfo {
            uuid: "a8cb035f-410a-45de-a4d3-2b0a5d8b464d".parse().unwrap(),
            session_uuid: "5e55b41c-6a3f-4a89-9e10-c1a7d2f3b804".parse().unwrap(),
            challenge_type: ChallengeType::Mokhaiotl,
            mode: ChallengeMode::NoMode,
            party: vec![Rsn::try_from("1Ogp").unwrap()],
            party_changed: false,
            stage: Stage::MokhaiotlDelve3,
            stage_attempt: None,
            status: ChallengeStatus::InProgress,
            created_unix_ms: 0,
            reported_times: None,
            finished_unix_ms: None,
        };

        let contiguous = MokhaiotlProcessor {
            challenge: challenge.clone(),
            data: CustomData {
                delves: vec![
                    delve_data(Stage::MokhaiotlDelve1),
                    delve_data(Stage::MokhaiotlDelve2),
                    delve_data(Stage::MokhaiotlDelve3),
                ],
                delve_1_to_8_ticks: None,
            },
            current_delve: DelveState::default(),
        };
        assert!(contiguous.has_fully_recorded_up_to(Stage::MokhaiotlDelve3));
        assert!(contiguous.has_fully_recorded_up_to(Stage::MokhaiotlDelve2));
        assert!(!contiguous.has_fully_recorded_up_to(Stage::MokhaiotlDelve4));
        assert!(!contiguous.has_fully_recorded_up_to(Stage::TobMaiden));

        let gapped = MokhaiotlProcessor {
            challenge: challenge.clone(),
            data: CustomData {
                delves: vec![
                    delve_data(Stage::MokhaiotlDelve1),
                    delve_data(Stage::MokhaiotlDelve2),
                    delve_data(Stage::MokhaiotlDelve4),
                    delve_data(Stage::MokhaiotlDelve5),
                ],
                delve_1_to_8_ticks: None,
            },
            current_delve: DelveState::default(),
        };
        assert!(!gapped.has_fully_recorded_up_to(Stage::MokhaiotlDelve5));
        assert!(!gapped.has_fully_recorded_up_to(Stage::MokhaiotlDelve4));
        assert!(!gapped.has_fully_recorded_up_to(Stage::MokhaiotlDelve3));
        assert!(gapped.has_fully_recorded_up_to(Stage::MokhaiotlDelve2));
        assert!(gapped.has_fully_recorded_up_to(Stage::MokhaiotlDelve1));

        let empty = MokhaiotlProcessor {
            challenge,
            data: CustomData {
                delves: Vec::new(),
                delve_1_to_8_ticks: None,
            },
            current_delve: DelveState::default(),
        };
        assert!(!empty.has_fully_recorded_up_to(Stage::MokhaiotlDelve1));
    }

    #[test]
    fn final_ticks_uses_delves_1_to_8() {
        let challenge = ChallengeInfo {
            uuid: "a8cb035f-410a-45de-a4d3-2b0a5d8b464d".parse().unwrap(),
            session_uuid: "5e55b41c-6a3f-4a89-9e10-c1a7d2f3b804".parse().unwrap(),
            challenge_type: ChallengeType::Mokhaiotl,
            mode: ChallengeMode::NoMode,
            party: vec![Rsn::try_from("1Ogp").unwrap()],
            party_changed: false,
            stage: Stage::MokhaiotlDelve8plus,
            stage_attempt: Some(2),
            status: ChallengeStatus::InProgress,
            created_unix_ms: 0,
            reported_times: None,
            finished_unix_ms: None,
        };

        let capped = MokhaiotlProcessor {
            challenge: challenge.clone(),
            data: CustomData {
                delves: Vec::new(),
                delve_1_to_8_ticks: Some(Ticks(723)),
            },
            current_delve: DelveState::default(),
        };
        assert_eq!(capped.final_challenge_ticks(Ticks(3390)), Ticks(723));

        let uncapped = MokhaiotlProcessor {
            challenge,
            data: CustomData {
                delves: Vec::new(),
                delve_1_to_8_ticks: None,
            },
            current_delve: DelveState::default(),
        };
        assert_eq!(uncapped.final_challenge_ticks(Ticks(3390)), Ticks(3390));
    }

    #[test]
    fn deep_delve_average() {
        let deep = CustomData {
            delves: vec![
                delve_data(Stage::MokhaiotlDelve8),
                DelveData {
                    challenge_ticks: Ticks(100),
                    ..delve_data(Stage::MokhaiotlDelve8plus)
                },
                DelveData {
                    delve: 10,
                    challenge_ticks: Ticks(101),
                    ..delve_data(Stage::MokhaiotlDelve8plus)
                },
            ],
            delve_1_to_8_ticks: Some(Ticks(723)),
        };
        assert_eq!(deep.avg_deep_delve_ticks(), Some(Ticks(101)));

        let shallow = CustomData {
            delves: vec![delve_data(Stage::MokhaiotlDelve8)],
            delve_1_to_8_ticks: Some(Ticks(741)),
        };
        assert_eq!(shallow.avg_deep_delve_ticks(), None);
    }

    #[test]
    fn larva_leaks_are_counted() {
        let challenge = ChallengeInfo {
            uuid: "a8cb035f-410a-45de-a4d3-2b0a5d8b464d".parse().unwrap(),
            session_uuid: "5e55b41c-6a3f-4a89-9e10-c1a7d2f3b804".parse().unwrap(),
            challenge_type: ChallengeType::Mokhaiotl,
            mode: ChallengeMode::NoMode,
            party: vec![Rsn::try_from("1Ogp").unwrap()],
            party_changed: false,
            stage: Stage::MokhaiotlDelve8,
            stage_attempt: None,
            status: ChallengeStatus::InProgress,
            created_unix_ms: 0,
            reported_times: None,
            finished_unix_ms: None,
        };
        let mut processor = MokhaiotlProcessor::new(challenge, None).unwrap();
        let mut ctx =
            StageContext::new(Stage::MokhaiotlDelve8, vec![Rsn::try_from("1Ogp").unwrap()]);
        let merged = merged_events(
            Stage::MokhaiotlDelve8,
            ChallengeMode::NoMode,
            vec![Rsn::try_from("1Ogp").unwrap()],
            vec![
                mokhaiotl_larva_leak_event(Tick(78), Stage::MokhaiotlDelve8, 45389, 23),
                mokhaiotl_larva_leak_event(Tick(93), Stage::MokhaiotlDelve8, 45662, 24),
            ],
            StageStatus::Started,
            ServerTicks::Missing,
        );

        let timeline = merged.timeline();
        for tick in Tick(0).through(timeline.last_tick()) {
            if let Some(state) = timeline.get_state(tick) {
                processor.process_tick(&mut ctx, tick, state, timeline);
            }
        }
        assert_eq!(processor.current_delve.larvae_leaked, 2);
    }

    #[tokio::test]
    async fn on_finish_records_the_challenge_split_and_status_counts() {
        let Some(db) = db::test_database().await else {
            return;
        };
        let txn = db
            .start_transaction(Uuid::new_v4(), Trigger::Create { seq: JournalSeq(1) })
            .await
            .expect("guard should pass");

        for (stage, stage_attempt, status, expected) in [
            (
                Stage::MokhaiotlDelve8plus,
                Some(2),
                ChallengeStatus::Completed,
                PlayerStatsDelta {
                    mokhaiotl_completions: 1,
                    ..PlayerStatsDelta::default()
                },
            ),
            (
                Stage::MokhaiotlDelve5,
                None,
                ChallengeStatus::Reset,
                PlayerStatsDelta {
                    mokhaiotl_resets: 1,
                    ..PlayerStatsDelta::default()
                },
            ),
            (
                Stage::MokhaiotlDelve3,
                None,
                ChallengeStatus::Wiped,
                PlayerStatsDelta {
                    mokhaiotl_wipes: 1,
                    ..PlayerStatsDelta::default()
                },
            ),
            (
                Stage::MokhaiotlDelve2,
                None,
                ChallengeStatus::Abandoned,
                PlayerStatsDelta::default(),
            ),
        ] {
            let mut processor = MokhaiotlProcessor::new(
                ChallengeInfo {
                    uuid: "a8cb035f-410a-45de-a4d3-2b0a5d8b464d".parse().unwrap(),
                    session_uuid: "5e55b41c-6a3f-4a89-9e10-c1a7d2f3b804".parse().unwrap(),
                    challenge_type: ChallengeType::Mokhaiotl,
                    mode: ChallengeMode::NoMode,
                    party: vec![Rsn::try_from("1Ogp").unwrap()],
                    party_changed: false,
                    stage,
                    stage_attempt,
                    status,
                    created_unix_ms: 0,
                    reported_times: None,
                    finished_unix_ms: None,
                },
                None,
            )
            .unwrap();

            let mut ctx = ChallengeContext::new(vec![Rsn::try_from("1Ogp").unwrap()]);
            let stored = StoredState {
                players: vec![StoredPlayerInfo {
                    id: PlayerId(1),
                    gear: PrimaryMeleeGear::Unknown,
                }],
                challenge_ticks: Ticks(723),
                custom_data: None,
            };
            processor
                .on_finish(&txn, &stored, &mut ctx, Ticks(723))
                .await
                .unwrap();

            assert_eq!(
                ctx.challenge_splits().collect::<Vec<_>>(),
                vec![(
                    SplitType::MokhaiotlChallenge,
                    ChallengeSplit {
                        ticks: Ticks(723),
                        accurate: None,
                    },
                )],
                "{status:?}",
            );
            let stats: Vec<_> = ctx.players().iter().map(|player| player.stats).collect();
            assert_eq!(stats, [expected], "{status:?}");
        }
    }
}
