//! Colosseum challenge processing.

use std::collections::BTreeSet;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use super::StoredState;
use super::challenge_processor::{
    ChallengeContext, ChallengeProcessor, EventCursor, RoomNpc, StageContext,
};
use super::db;
use super::split::SplitType;
use crate::lifecycle::core::types::{
    ChallengeInfo, ChallengeStatus, ProcessingError, Stage, StageStatus,
};
use crate::merging::MergedEvents;
use crate::proto::{ChallengeData, challenge_data, event};

/// ID increment between consecutive levels of a handicap.
const HANDICAP_LEVEL_INCREMENT: u32 = 30;

const NUM_HANDICAPS: usize = 14;

/// In-flight Colosseum state stored between stages.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CustomData {
    waves: Vec<WaveData>,
    /// Leveled ID of every handicap picked in wave order.
    handicaps: Vec<u32>,
    /// Times each base handicap has been picked, indexed by base ID.
    handicap_levels: [u32; NUM_HANDICAPS],
}

/// Final state of a processed wave.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WaveData {
    stage: Stage,
    ticks_lost: u32,
    handicap: u32,
    options: Vec<u32>,
    npcs: Vec<RoomNpc>,
}

impl WaveData {
    fn to_proto(&self) -> challenge_data::ColosseumWave {
        challenge_data::ColosseumWave {
            stage: self.stage as i32,
            ticks_lost: self.ticks_lost,
            handicap_chosen: self.handicap,
            handicap_options: self.options.clone(),
            npcs: self.npcs.iter().map(Into::into).collect(),
        }
    }
}

fn wave_index(stage: Stage) -> i32 {
    (stage as i32) - (Stage::ColosseumWave1 as i32)
}

#[derive(Debug)]
pub struct ColosseumProcessor {
    challenge: ChallengeInfo,
    data: CustomData,
    /// Leveled ID of the handicap chosen this wave.
    selected_handicap: Option<u32>,
    /// Leveled IDs of the handicaps offered this wave.
    wave_handicap_options: Vec<u32>,
}

impl ColosseumProcessor {
    pub fn new(
        challenge: ChallengeInfo,
        custom_data: Option<&serde_json::Value>,
    ) -> Result<ColosseumProcessor, ProcessingError> {
        let data = match custom_data {
            Some(value) => {
                serde_json::from_value(value.clone()).map_err(|error| ProcessingError {
                    retriable: false,
                    message: format!("custom data deserialization failed: {error}"),
                })?
            }
            None => CustomData {
                waves: Vec::new(),
                handicaps: Vec::new(),
                handicap_levels: [0; NUM_HANDICAPS],
            },
        };
        Ok(ColosseumProcessor {
            challenge,
            data,
            selected_handicap: None,
            wave_handicap_options: Vec::new(),
        })
    }

    /// Returns the leveled ID of a base handicap at its current level.
    fn level_handicap(&self, handicap: u32) -> u32 {
        let level = self
            .data
            .handicap_levels
            .get(handicap as usize)
            .copied()
            .unwrap_or(0);
        handicap + level * HANDICAP_LEVEL_INCREMENT
    }
}

#[async_trait]
impl ChallengeProcessor for ColosseumProcessor {
    fn process_challenge_event(
        &mut self,
        _ctx: &mut StageContext,
        events: &mut EventCursor<'_>,
    ) -> bool {
        if events.current().r#type() == event::Type::ColosseumHandicapChoice {
            let event = events.current();
            let base = event.handicap.unwrap_or(0).cast_unsigned();
            let selected = self.level_handicap(base);
            let options = event
                .handicap_options
                .iter()
                .map(|&option| self.level_handicap(option.cast_unsigned()))
                .collect();

            self.selected_handicap = Some(selected);
            self.wave_handicap_options = options;

            if let Some(level) = self.data.handicap_levels.get_mut(base as usize) {
                *level += 1;
            }

            match self
                .data
                .handicaps
                .iter()
                .position(|&handicap| handicap + HANDICAP_LEVEL_INCREMENT == selected)
            {
                Some(index) => self.data.handicaps[index] = selected,
                None => self.data.handicaps.push(base),
            }
        }
        true
    }

    async fn on_create(&mut self, txn: &db::Transaction) -> Result<(), db::Error> {
        txn.execute(
            "INSERT INTO colosseum_challenge_stats (challenge_id) VALUES ($1)",
            &[&txn.challenge_id()],
        )
        .await?;
        Ok(())
    }

    async fn on_stage_finished(
        &mut self,
        txn: &db::Transaction,
        stored: &StoredState,
        ctx: &mut StageContext,
        stage: Stage,
        events: &MergedEvents,
    ) -> Result<(), db::Error> {
        let completed = events.status() == StageStatus::Completed;
        let challenge_ticks = stored.challenge_ticks + events.last_tick();
        let index = wave_index(stage);

        self.data.waves.push(WaveData {
            stage,
            ticks_lost: events.missing_tick_count(),
            handicap: self.selected_handicap.unwrap_or(0),
            options: self.wave_handicap_options.clone(),
            npcs: ctx.npcs().cloned().collect(),
        });

        let split = SplitType::try_from(SplitType::ColosseumWave1 as i32 + index)
            .expect("wave splits are consecutive");
        ctx.set_stage_split(split, events.last_tick(), 0, true);

        if completed
            && stage > Stage::ColosseumWave1
            && stage < Stage::ColosseumWave12
            && self.has_fully_recorded_up_to(stage)
        {
            let split = SplitType::try_from(SplitType::ColosseumWave3Start as i32 + index - 1)
                .expect("wave start splits are consecutive");
            ctx.set_challenge_split(
                split,
                challenge_ticks,
                Some(!self.challenge.party_changed && events.has_precise_server_tick_count()),
            );
        }

        // Store all handicaps selected, once per level.
        let handicaps: Vec<i16> = self
            .data
            .handicaps
            .iter()
            .flat_map(|&handicap| {
                let base = i16::try_from(handicap % HANDICAP_LEVEL_INCREMENT)
                    .expect("handicap bases fit in smallint");
                let level = handicap / HANDICAP_LEVEL_INCREMENT + 1;
                std::iter::repeat_n(base, level as usize)
            })
            .collect();
        txn.execute(
            "UPDATE colosseum_challenge_stats SET handicaps = $1 WHERE challenge_id = $2",
            &[&handicaps, &txn.challenge_id()],
        )
        .await?;
        Ok(())
    }

    async fn on_finish(
        &mut self,
        _txn: &db::Transaction,
        ctx: &mut ChallengeContext,
        final_ticks: u32,
    ) -> Result<(), db::Error> {
        ctx.set_challenge_split(SplitType::ColosseumChallenge, final_ticks, None);

        for index in 0..self.challenge.party.len() {
            if let Some(player) = ctx.player_mut(index) {
                match self.challenge.status {
                    ChallengeStatus::Completed => player.stats.colosseum_completions += 1,
                    ChallengeStatus::Reset => player.stats.colosseum_resets += 1,
                    ChallengeStatus::Wiped => player.stats.colosseum_wipes += 1,
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
            stage_data: Some(challenge_data::StageData::Colosseum(
                challenge_data::Colosseum {
                    waves: self.data.waves.iter().map(WaveData::to_proto).collect(),
                    all_handicaps: self.data.handicaps.clone(),
                },
            )),
        })
    }

    fn has_fully_recorded_up_to(&self, stage: Stage) -> bool {
        if !(Stage::ColosseumWave1..=Stage::ColosseumWave12).contains(&stage) {
            return false;
        }
        let recorded: BTreeSet<i32> = self
            .data
            .waves
            .iter()
            .map(|wave| wave.stage as i32)
            .collect();
        (Stage::ColosseumWave1 as i32..=stage as i32).all(|value| recorded.contains(&value))
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::lifecycle::core::state::Trigger;
    use crate::lifecycle::core::types::{
        ChallengeMode, ChallengeStatus, ChallengeType, JournalSeq, StageStatus, Uuid,
    };
    use crate::merging::fixtures::{ServerTicks, colosseum_handicap_choice_event, merged_events};
    use crate::processing::split::ChallengeSplit;
    use crate::processing::stats::PlayerStatsDelta;
    use crate::proto::event::ColosseumHandicap;

    #[test]
    fn processor_starts_with_empty_data() {
        let processor = ColosseumProcessor::new(
            ChallengeInfo {
                uuid: "a8cb035f-410a-45de-a4d3-2b0a5d8b464d".parse().unwrap(),
                session_uuid: "5e55b41c-6a3f-4a89-9e10-c1a7d2f3b804".parse().unwrap(),
                challenge_type: ChallengeType::Colosseum,
                mode: ChallengeMode::NoMode,
                party: vec!["aSaradomin".to_string()],
                party_changed: false,
                stage: Stage::ColosseumWave1,
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
            Some(json!({
                "waves": [],
                "handicaps": [],
                "handicapLevels": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            })),
        );
    }

    #[test]
    fn malformed_custom_data_fails_construction() {
        let error = ColosseumProcessor::new(
            ChallengeInfo {
                uuid: "a8cb035f-410a-45de-a4d3-2b0a5d8b464d".parse().unwrap(),
                session_uuid: "5e55b41c-6a3f-4a89-9e10-c1a7d2f3b804".parse().unwrap(),
                challenge_type: ChallengeType::Colosseum,
                mode: ChallengeMode::NoMode,
                party: vec!["aSaradomin".to_string()],
                party_changed: false,
                stage: Stage::ColosseumWave1,
                stage_attempt: None,
                status: ChallengeStatus::InProgress,
                created_unix_ms: 0,
                reported_times: None,
                finished_unix_ms: None,
            },
            Some(&json!({"waves": 51})),
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
    fn handicap_choices_accumulate() {
        let challenge = ChallengeInfo {
            uuid: "a8cb035f-410a-45de-a4d3-2b0a5d8b464d".parse().unwrap(),
            session_uuid: "5e55b41c-6a3f-4a89-9e10-c1a7d2f3b804".parse().unwrap(),
            challenge_type: ChallengeType::Colosseum,
            mode: ChallengeMode::NoMode,
            party: vec!["aSaradomin".to_string()],
            party_changed: false,
            stage: Stage::ColosseumWave1,
            stage_attempt: None,
            status: ChallengeStatus::InProgress,
            created_unix_ms: 0,
            reported_times: None,
            finished_unix_ms: None,
        };
        let mut processor = ColosseumProcessor::new(challenge.clone(), None).unwrap();
        let mut ctx = StageContext::new(vec!["aSaradomin".to_string()]);
        let mut events = merged_events(
            vec![colosseum_handicap_choice_event(
                0,
                Stage::ColosseumWave1,
                ColosseumHandicap::Blasphemy,
                &[
                    ColosseumHandicap::Blasphemy,
                    ColosseumHandicap::Relentless,
                    ColosseumHandicap::Frailty,
                ],
            )],
            StageStatus::Started,
            ServerTicks::Missing,
        );

        let mut cursor = EventCursor::new(&mut events, 0);
        assert!(processor.process_challenge_event(&mut ctx, &mut cursor));
        assert_eq!(processor.selected_handicap, Some(4));
        assert_eq!(processor.wave_handicap_options, vec![4, 5, 12]);
        assert_eq!(processor.data.handicaps, vec![4]);

        let custom_data = processor.custom_data().unwrap();
        let mut processor = ColosseumProcessor::new(
            ChallengeInfo {
                stage: Stage::ColosseumWave2,
                ..challenge
            },
            Some(&custom_data),
        )
        .unwrap();
        let mut ctx = StageContext::new(vec!["aSaradomin".to_string()]);
        let mut events = merged_events(
            vec![colosseum_handicap_choice_event(
                0,
                Stage::ColosseumWave2,
                ColosseumHandicap::Blasphemy,
                &[
                    ColosseumHandicap::Blasphemy,
                    ColosseumHandicap::Myopia,
                    ColosseumHandicap::Totemic,
                ],
            )],
            StageStatus::Started,
            ServerTicks::Missing,
        );

        let mut cursor = EventCursor::new(&mut events, 0);
        assert!(processor.process_challenge_event(&mut ctx, &mut cursor));
        assert_eq!(processor.selected_handicap, Some(34));
        assert_eq!(processor.wave_handicap_options, vec![34, 11, 7]);
        assert_eq!(processor.data.handicaps, vec![34]);

        assert_eq!(
            processor.custom_data(),
            Some(json!({
                "waves": [],
                "handicaps": [34],
                "handicapLevels": [0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            })),
        );
    }

    #[test]
    fn full_recording_requires_every_wave_from_the_first() {
        fn wave_data(stage: Stage) -> WaveData {
            WaveData {
                stage,
                ticks_lost: 0,
                handicap: 3,
                options: vec![3, 7, 11],
                npcs: Vec::new(),
            }
        }

        let challenge = ChallengeInfo {
            uuid: "a8cb035f-410a-45de-a4d3-2b0a5d8b464d".parse().unwrap(),
            session_uuid: "5e55b41c-6a3f-4a89-9e10-c1a7d2f3b804".parse().unwrap(),
            challenge_type: ChallengeType::Colosseum,
            mode: ChallengeMode::NoMode,
            party: vec!["1Ogp".to_string()],
            party_changed: false,
            stage: Stage::ColosseumWave3,
            stage_attempt: None,
            status: ChallengeStatus::InProgress,
            created_unix_ms: 0,
            reported_times: None,
            finished_unix_ms: None,
        };

        let contiguous = ColosseumProcessor {
            challenge: challenge.clone(),
            data: CustomData {
                waves: vec![
                    wave_data(Stage::ColosseumWave1),
                    wave_data(Stage::ColosseumWave2),
                    wave_data(Stage::ColosseumWave3),
                ],
                handicaps: Vec::new(),
                handicap_levels: [0; NUM_HANDICAPS],
            },
            selected_handicap: None,
            wave_handicap_options: Vec::new(),
        };
        assert!(contiguous.has_fully_recorded_up_to(Stage::ColosseumWave3));
        assert!(contiguous.has_fully_recorded_up_to(Stage::ColosseumWave2));
        assert!(!contiguous.has_fully_recorded_up_to(Stage::ColosseumWave4));
        assert!(!contiguous.has_fully_recorded_up_to(Stage::TobMaiden));

        let gapped = ColosseumProcessor {
            challenge: challenge.clone(),
            data: CustomData {
                waves: vec![
                    wave_data(Stage::ColosseumWave1),
                    wave_data(Stage::ColosseumWave2),
                    wave_data(Stage::ColosseumWave4),
                    wave_data(Stage::ColosseumWave5),
                ],
                handicaps: Vec::new(),
                handicap_levels: [0; NUM_HANDICAPS],
            },
            selected_handicap: None,
            wave_handicap_options: Vec::new(),
        };
        assert!(!gapped.has_fully_recorded_up_to(Stage::ColosseumWave5));
        assert!(!gapped.has_fully_recorded_up_to(Stage::ColosseumWave4));
        assert!(!gapped.has_fully_recorded_up_to(Stage::ColosseumWave3));
        assert!(gapped.has_fully_recorded_up_to(Stage::ColosseumWave2));
        assert!(gapped.has_fully_recorded_up_to(Stage::ColosseumWave1));

        let empty = ColosseumProcessor {
            challenge,
            data: CustomData {
                waves: Vec::new(),
                handicaps: Vec::new(),
                handicap_levels: [0; NUM_HANDICAPS],
            },
            selected_handicap: None,
            wave_handicap_options: Vec::new(),
        };
        assert!(!empty.has_fully_recorded_up_to(Stage::ColosseumWave1));
    }

    #[tokio::test]
    async fn on_finish_records_challenge_splits_and_stats() {
        let Some(db) = db::test_database().await else {
            return;
        };
        let txn = db
            .start_transaction(Uuid::new_v4(), Trigger::Create { seq: JournalSeq(1) })
            .await
            .expect("guard should pass");

        for (stage, status, expected) in [
            (
                Stage::ColosseumWave12,
                ChallengeStatus::Completed,
                PlayerStatsDelta {
                    colosseum_completions: 1,
                    ..PlayerStatsDelta::default()
                },
            ),
            (
                Stage::ColosseumWave5,
                ChallengeStatus::Reset,
                PlayerStatsDelta {
                    colosseum_resets: 1,
                    ..PlayerStatsDelta::default()
                },
            ),
            (
                Stage::ColosseumWave3,
                ChallengeStatus::Wiped,
                PlayerStatsDelta {
                    colosseum_wipes: 1,
                    ..PlayerStatsDelta::default()
                },
            ),
            (
                Stage::ColosseumWave2,
                ChallengeStatus::Abandoned,
                PlayerStatsDelta::default(),
            ),
        ] {
            let mut processor = ColosseumProcessor::new(
                ChallengeInfo {
                    uuid: "a8cb035f-410a-45de-a4d3-2b0a5d8b464d".parse().unwrap(),
                    session_uuid: "5e55b41c-6a3f-4a89-9e10-c1a7d2f3b804".parse().unwrap(),
                    challenge_type: ChallengeType::Colosseum,
                    mode: ChallengeMode::NoMode,
                    party: vec!["1Ogp".to_string()],
                    party_changed: false,
                    stage,
                    stage_attempt: None,
                    status,
                    created_unix_ms: 0,
                    reported_times: None,
                    finished_unix_ms: None,
                },
                None,
            )
            .unwrap();

            let mut ctx = ChallengeContext::new(vec!["1Ogp".to_string()]);
            processor.on_finish(&txn, &mut ctx, 1743).await.unwrap();

            assert_eq!(
                ctx.challenge_splits().collect::<Vec<_>>(),
                vec![(
                    SplitType::ColosseumChallenge,
                    ChallengeSplit {
                        ticks: 1743,
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
