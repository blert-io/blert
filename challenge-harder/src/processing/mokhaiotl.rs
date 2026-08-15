//! Mokhaiotl challenge processing.

use std::collections::BTreeSet;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use super::StoredState;
use super::challenge_processor::{
    ChallengeContext, ChallengeProcessor, ChallengeTicks, EventCursor, RoomNpc, StageContext,
};
use super::db;
use super::split::SplitType;
use crate::lifecycle::core::types::{
    ChallengeInfo, ChallengeStatus, ProcessingError, Stage, StageStatus,
};
use crate::merging::MergedEvents;
use crate::proto::event::attack_style::Style;
use crate::proto::{ChallengeData, NpcAttack, challenge_data, event};

/// In-flight mokhaiotl state stored between stages.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CustomData {
    delves: Vec<DelveData>,
    delve_1_to_8_ticks: Option<u32>,
}

/// Final state of a processed delve.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DelveData {
    stage: Stage,
    ticks_lost: u32,
    npcs: Vec<RoomNpc>,
    delve: u32,
    challenge_ticks: u32,
    larvae_leaked: u32,
}

impl DelveData {
    fn to_proto(&self) -> challenge_data::MokhaiotlDelve {
        challenge_data::MokhaiotlDelve {
            stage: self.stage as i32,
            ticks_lost: self.ticks_lost,
            npcs: self.npcs.iter().map(Into::into).collect(),
            delve: self.delve,
            challenge_ticks: self.challenge_ticks,
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
    missing_npc_attacks: Vec<u32>,
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
    fn process_challenge_event(
        &mut self,
        _ctx: &mut StageContext,
        events: &mut EventCursor<'_>,
    ) -> bool {
        match events.current().r#type() {
            event::Type::MokhaiotlAttackStyle => {
                let Some(attack_style) = events.current().mokhaiotl_attack_style else {
                    return false;
                };
                let tick = attack_style.npc_attack_tick;
                let npc_attack = events
                    .events_for_tick_mut(tick)
                    .iter_mut()
                    .find_map(|event| {
                        if event.r#type() != event::Type::NpcAttack {
                            return None;
                        }
                        event.npc_attack.as_mut().filter(|attack| {
                            matches!(
                                attack.attack(),
                                NpcAttack::MokhaiotlAuto | NpcAttack::MokhaiotlBall
                            )
                        })
                    });
                let Some(npc_attack) = npc_attack else {
                    self.current_delve.missing_npc_attacks.push(tick);
                    return false;
                };

                let attack = if npc_attack.attack() == NpcAttack::MokhaiotlBall {
                    match attack_style.style() {
                        Style::Range => NpcAttack::MokhaiotlRangedBall,
                        Style::Mage => NpcAttack::MokhaiotlMageBall,
                        Style::Melee => {
                            tracing::warn!(
                                uuid = %self.challenge.uuid,
                                stage = ?self.challenge.stage,
                                tick = tick,
                                "mokhaiotl_attack_style_invalid",
                            );
                            NpcAttack::MokhaiotlBall
                        }
                    }
                } else {
                    match attack_style.style() {
                        Style::Melee => NpcAttack::MokhaiotlMeleeAuto,
                        Style::Range => NpcAttack::MokhaiotlRangedAuto,
                        Style::Mage => NpcAttack::MokhaiotlMageAuto,
                    }
                };
                npc_attack.set_attack(attack);
                false
            }
            event::Type::MokhaiotlLarvaLeak => {
                self.current_delve.larvae_leaked += 1;
                true
            }
            _ => true,
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
        stored: &StoredState,
        ctx: &mut StageContext,
        stage: Stage,
        events: &MergedEvents,
    ) -> Result<ChallengeTicks, db::Error> {
        let completed = events.status() == StageStatus::Completed;
        let challenge_ticks = stored.challenge_ticks + events.last_tick();
        let delve = delve(stage, self.challenge.stage_attempt);

        self.data.delves.push(DelveData {
            stage,
            ticks_lost: events.missing_tick_count(),
            npcs: ctx.npcs().cloned().collect(),
            delve,
            challenge_ticks: events.last_tick(),
            larvae_leaked: self.current_delve.larvae_leaked,
        });

        if stage != Stage::MokhaiotlDelve8plus {
            if stage == Stage::MokhaiotlDelve8 {
                self.data.delve_1_to_8_ticks = Some(challenge_ticks);
            }
            let index = (stage as i32) - (Stage::MokhaiotlDelve1 as i32);
            let split = SplitType::try_from(SplitType::MokhaiotlDelve1 as i32 + index)
                .expect("delve splits are consecutive");
            ctx.set_stage_split(split, events.last_tick(), 0, true);

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
                    Some(!self.challenge.party_changed && events.has_precise_server_tick_count()),
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

        txn.execute(
            "UPDATE mokhaiotl_challenge_stats
             SET delve = $1,
                 larvae_leaked = larvae_leaked + $2,
                 max_completed_delve = COALESCE($3, max_completed_delve)
             WHERE challenge_id = $4",
            &[
                &delve.cast_signed(),
                &self.current_delve.larvae_leaked.cast_signed(),
                &completed.then_some(delve.cast_signed()),
                &txn.challenge_id(),
            ],
        )
        .await?;

        if !self.current_delve.missing_npc_attacks.is_empty() {
            tracing::warn!(
                uuid = %self.challenge.uuid,
                ticks = ?self.current_delve.missing_npc_attacks,
                "challenge_events_missing_npc_attack",
            );
        }
        Ok(ChallengeTicks::Add(events.last_tick()))
    }

    async fn on_finish(
        &mut self,
        _txn: &db::Transaction,
        _stored: &StoredState,
        ctx: &mut ChallengeContext,
        final_ticks: u32,
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

    fn final_challenge_ticks(&self, total: u32) -> u32 {
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
    use serde_json::json;

    use super::*;
    use crate::lifecycle::core::state::Trigger;
    use crate::lifecycle::core::types::{
        ChallengeMode, ChallengeStatus, ChallengeType, JournalSeq, PlayerId, PrimaryMeleeGear,
        StageStatus, Uuid,
    };
    use crate::merging::fixtures::{
        ServerTicks, merged_events, mokhaiotl_attack_style_event, mokhaiotl_larva_leak_event,
        npc_attack_event,
    };
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
                party: vec!["1Ogp".to_string()],
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
                party: vec!["1Ogp".to_string()],
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
            npcs: Vec::new(),
            delve: delve(stage, None),
            challenge_ticks: 90,
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
            party: vec!["1Ogp".to_string()],
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
            party: vec!["1Ogp".to_string()],
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
                delve_1_to_8_ticks: Some(723),
            },
            current_delve: DelveState::default(),
        };
        assert_eq!(capped.final_challenge_ticks(3390), 723);

        let uncapped = MokhaiotlProcessor {
            challenge,
            data: CustomData {
                delves: Vec::new(),
                delve_1_to_8_ticks: None,
            },
            current_delve: DelveState::default(),
        };
        assert_eq!(uncapped.final_challenge_ticks(3390), 3390);
    }

    #[test]
    fn attack_style_events_update_the_referenced_attack() {
        let challenge = ChallengeInfo {
            uuid: "a8cb035f-410a-45de-a4d3-2b0a5d8b464d".parse().unwrap(),
            session_uuid: "5e55b41c-6a3f-4a89-9e10-c1a7d2f3b804".parse().unwrap(),
            challenge_type: ChallengeType::Mokhaiotl,
            mode: ChallengeMode::NoMode,
            party: vec!["1Ogp".to_string()],
            party_changed: false,
            stage: Stage::MokhaiotlDelve2,
            stage_attempt: None,
            status: ChallengeStatus::InProgress,
            created_unix_ms: 0,
            reported_times: None,
            finished_unix_ms: None,
        };
        for (initial, style, expected) in [
            (
                NpcAttack::MokhaiotlAuto,
                Style::Melee,
                NpcAttack::MokhaiotlMeleeAuto,
            ),
            (
                NpcAttack::MokhaiotlAuto,
                Style::Range,
                NpcAttack::MokhaiotlRangedAuto,
            ),
            (
                NpcAttack::MokhaiotlAuto,
                Style::Mage,
                NpcAttack::MokhaiotlMageAuto,
            ),
            (
                NpcAttack::MokhaiotlBall,
                Style::Range,
                NpcAttack::MokhaiotlRangedBall,
            ),
            (
                NpcAttack::MokhaiotlBall,
                Style::Mage,
                NpcAttack::MokhaiotlMageBall,
            ),
            (
                NpcAttack::MokhaiotlBall,
                Style::Melee,
                NpcAttack::MokhaiotlBall,
            ),
        ] {
            let mut processor = MokhaiotlProcessor::new(challenge.clone(), None).unwrap();
            let mut ctx = StageContext::new(vec!["1Ogp".to_string()]);
            let mut events = merged_events(
                vec![
                    npc_attack_event(
                        6,
                        Stage::MokhaiotlDelve2,
                        (3421, 6435),
                        14707,
                        54445,
                        initial,
                        Some("1Ogp"),
                    ),
                    mokhaiotl_attack_style_event(8, Stage::MokhaiotlDelve2, style, 6),
                ],
                StageStatus::Started,
                ServerTicks::Missing,
            );

            let mut cursor = EventCursor::new(&mut events, 1);
            assert!(!processor.process_challenge_event(&mut ctx, &mut cursor));
            assert_eq!(
                events.events_for_tick(6)[0]
                    .npc_attack
                    .as_ref()
                    .unwrap()
                    .attack(),
                expected,
                "{initial:?} + {style:?}",
            );
        }
    }

    #[test]
    fn unmatched_attack_style_events_are_collected() {
        let challenge = ChallengeInfo {
            uuid: "a8cb035f-410a-45de-a4d3-2b0a5d8b464d".parse().unwrap(),
            session_uuid: "5e55b41c-6a3f-4a89-9e10-c1a7d2f3b804".parse().unwrap(),
            challenge_type: ChallengeType::Mokhaiotl,
            mode: ChallengeMode::NoMode,
            party: vec!["1Ogp".to_string()],
            party_changed: false,
            stage: Stage::MokhaiotlDelve2,
            stage_attempt: None,
            status: ChallengeStatus::InProgress,
            created_unix_ms: 0,
            reported_times: None,
            finished_unix_ms: None,
        };
        let mut processor = MokhaiotlProcessor::new(challenge, None).unwrap();
        let mut ctx = StageContext::new(vec!["1Ogp".to_string()]);
        let mut events = merged_events(
            vec![
                npc_attack_event(
                    39,
                    Stage::MokhaiotlDelve2,
                    (3421, 6435),
                    14707,
                    54445,
                    NpcAttack::MokhaiotlCharge,
                    Some("1Ogp"),
                ),
                mokhaiotl_attack_style_event(41, Stage::MokhaiotlDelve2, Style::Range, 39),
                mokhaiotl_attack_style_event(45, Stage::MokhaiotlDelve2, Style::Mage, 43),
            ],
            StageStatus::Started,
            ServerTicks::Missing,
        );

        for index in [1, 2] {
            let mut cursor = EventCursor::new(&mut events, index);
            assert!(!processor.process_challenge_event(&mut ctx, &mut cursor));
        }
        assert_eq!(processor.current_delve.missing_npc_attacks, vec![39, 43]);
        assert_eq!(
            events.events_for_tick(39)[0]
                .npc_attack
                .as_ref()
                .unwrap()
                .attack(),
            NpcAttack::MokhaiotlCharge,
        );
    }

    #[test]
    fn larva_leaks_are_counted() {
        let challenge = ChallengeInfo {
            uuid: "a8cb035f-410a-45de-a4d3-2b0a5d8b464d".parse().unwrap(),
            session_uuid: "5e55b41c-6a3f-4a89-9e10-c1a7d2f3b804".parse().unwrap(),
            challenge_type: ChallengeType::Mokhaiotl,
            mode: ChallengeMode::NoMode,
            party: vec!["1Ogp".to_string()],
            party_changed: false,
            stage: Stage::MokhaiotlDelve8,
            stage_attempt: None,
            status: ChallengeStatus::InProgress,
            created_unix_ms: 0,
            reported_times: None,
            finished_unix_ms: None,
        };
        let mut processor = MokhaiotlProcessor::new(challenge, None).unwrap();
        let mut ctx = StageContext::new(vec!["1Ogp".to_string()]);
        let mut events = merged_events(
            vec![
                mokhaiotl_larva_leak_event(78, Stage::MokhaiotlDelve8, 45389, 23),
                mokhaiotl_larva_leak_event(93, Stage::MokhaiotlDelve8, 45662, 24),
            ],
            StageStatus::Started,
            ServerTicks::Missing,
        );

        for index in [0, 1] {
            let mut cursor = EventCursor::new(&mut events, index);
            assert!(processor.process_challenge_event(&mut ctx, &mut cursor));
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
                    party: vec!["1Ogp".to_string()],
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

            let mut ctx = ChallengeContext::new(vec!["1Ogp".to_string()]);
            let stored = StoredState {
                players: vec![StoredPlayerInfo {
                    id: PlayerId(1),
                    gear: PrimaryMeleeGear::Unknown,
                }],
                challenge_ticks: 723,
                custom_data: None,
            };
            processor
                .on_finish(&txn, &stored, &mut ctx, 723)
                .await
                .unwrap();

            assert_eq!(
                ctx.challenge_splits().collect::<Vec<_>>(),
                vec![(
                    SplitType::MokhaiotlChallenge,
                    ChallengeSplit {
                        ticks: 723,
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
