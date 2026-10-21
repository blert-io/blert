//! Fractured Archive challenge processing.

use async_trait::async_trait;
use blert::{Tick, TickState, Ticks, Timeline};
use serde::{Deserialize, Serialize};

use super::StoredState;
use super::challenge_processor::{
    ChallengeContext, ChallengeProcessor, ChallengeTicks, RoomNpc, StageContext,
};
use super::db;
use super::split::SplitType;
use crate::lifecycle::core::types::{
    ChallengeInfo, ChallengeStatus, ProcessingError, Stage, StageStatus, TFA_ROWS,
};
use crate::merging::MergedTimeline;
use crate::price::PriceResolver;
use crate::proto::challenge_data::tfa_boss;
use crate::proto::{ChallengeData, challenge_data};

/// In-flight state stored between stages.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CustomData {
    bosses: Vec<BossData>,
    inaccurate_room: bool,
}

impl CustomData {
    fn route(&self) -> i16 {
        self.bosses.iter().fold(0, |route, boss| {
            match TFA_ROWS
                .iter()
                .position(|row| row.get(1) == Some(&boss.stage))
            {
                Some(row) => route | (1 << (row - 1)),
                None => route,
            }
        })
    }
}

/// Final state of a processed boss, following the `TfaBoss` proto message.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BossData {
    stage: Stage,
    ticks_lost: u32,
    offset: Ticks,
    deaths: Vec<String>,
    npcs: Vec<RoomNpc>,
}

impl BossData {
    fn to_proto(&self) -> challenge_data::TfaBoss {
        let boss = match self.stage {
            Stage::TfaGuardian => tfa_boss::Boss::Guardian(tfa_boss::Guardian {}),
            Stage::TfaEzekiel => tfa_boss::Boss::Ezekiel(tfa_boss::Ezekiel {}),
            Stage::TfaBork => tfa_boss::Boss::Bork(tfa_boss::Bork {}),
            Stage::TfaMoia => tfa_boss::Boss::Moia(tfa_boss::Moia {}),
            Stage::TfaDreadnoth => tfa_boss::Boss::Dreadnoth(tfa_boss::Dreadnoth {}),
            Stage::TfaDagonhai => tfa_boss::Boss::Dagonhai(tfa_boss::Dagonhai {}),
            Stage::TfaXarth => tfa_boss::Boss::Xarth(tfa_boss::Xarth {}),
            Stage::TfaOcellus => tfa_boss::Boss::Ocellus(tfa_boss::Ocellus {}),
            stage => panic!("invalid TFA stage {stage:?}"),
        };
        challenge_data::TfaBoss {
            ticks_lost: self.ticks_lost,
            deaths: self.deaths.clone(),
            npcs: self.npcs.iter().map(Into::into).collect(),
            offset: Some(self.offset.0),
            boss: Some(boss),
        }
    }
}

fn boss_split(stage: Stage) -> SplitType {
    match stage {
        Stage::TfaGuardian => SplitType::TfaGuardian,
        Stage::TfaEzekiel => SplitType::TfaEzekiel,
        Stage::TfaBork => SplitType::TfaBork,
        Stage::TfaMoia => SplitType::TfaMoia,
        Stage::TfaDreadnoth => SplitType::TfaDreadnoth,
        Stage::TfaDagonhai => SplitType::TfaDagonhai,
        Stage::TfaXarth => SplitType::TfaXarth,
        Stage::TfaOcellus => SplitType::TfaOcellus,
        _ => panic!("invalid TFA stage {stage:?}"),
    }
}

fn next_row_start_split(stage: Stage) -> Option<SplitType> {
    match stage {
        Stage::TfaEzekiel | Stage::TfaBork => Some(SplitType::TfaRow2Start),
        Stage::TfaMoia | Stage::TfaDreadnoth => Some(SplitType::TfaRow3Start),
        Stage::TfaDagonhai | Stage::TfaXarth => Some(SplitType::TfaFinalStart),
        _ => None,
    }
}

fn deaths_column(stage: Stage) -> &'static str {
    match stage {
        Stage::TfaGuardian => "guardian_deaths",
        Stage::TfaEzekiel => "ezekiel_deaths",
        Stage::TfaBork => "bork_deaths",
        Stage::TfaMoia => "moia_deaths",
        Stage::TfaDreadnoth => "dreadnoth_deaths",
        Stage::TfaDagonhai => "dagonhai_deaths",
        Stage::TfaXarth => "xarth_deaths",
        Stage::TfaOcellus => "ocellus_deaths",
        _ => panic!("invalid TFA stage {stage:?}"),
    }
}

#[derive(Debug)]
pub struct ArchiveProcessor {
    challenge: ChallengeInfo,
    data: CustomData,
}

impl ArchiveProcessor {
    pub fn new(
        challenge: ChallengeInfo,
        custom_data: Option<&serde_json::Value>,
    ) -> Result<ArchiveProcessor, ProcessingError> {
        let data = match custom_data {
            Some(value) => {
                serde_json::from_value(value.clone()).map_err(|error| ProcessingError {
                    retriable: false,
                    message: format!("custom data deserialization failed: {error}"),
                })?
            }
            None => CustomData::default(),
        };
        Ok(ArchiveProcessor { challenge, data })
    }
}

#[async_trait]
impl ChallengeProcessor for ArchiveProcessor {
    fn process_tick(
        &mut self,
        _ctx: &mut StageContext,
        _tick: Tick,
        _state: &TickState,
        _timeline: &Timeline,
    ) {
    }

    async fn on_create(&mut self, txn: &db::Transaction) -> Result<(), db::Error> {
        txn.execute(
            "INSERT INTO tfa_challenge_stats (challenge_id) VALUES ($1)",
            &[&txn.challenge_id()],
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
        let timeline = merged.timeline();
        let last_tick = timeline.last_tick();

        self.data.bosses.push(BossData {
            stage,
            ticks_lost: merged.missing_tick_count(),
            offset: merged.offset(),
            deaths: ctx
                .deaths()
                .iter()
                .map(|&index| self.challenge.party[index].to_string())
                .collect(),
            npcs: timeline
                .npcs()
                .map(|(room_id, _)| RoomNpc::new(timeline, room_id))
                .collect(),
        });

        ctx.set_stage_split(boss_split(stage), last_tick, Tick(0), true);

        if merged.status() != StageStatus::Completed || !merged.fully_accurate() {
            self.data.inaccurate_room = true;
        }

        if merged.status() == StageStatus::Completed
            && self.has_fully_recorded_up_to(stage)
            && let Some(row_start) = next_row_start_split(stage)
        {
            ctx.set_challenge_split(
                row_start,
                stored.challenge_ticks + last_tick.duration(),
                Some(
                    !self.challenge.party_changed
                        && !self.data.inaccurate_room
                        && merged.has_precise_server_tick_count(),
                ),
            );
        }

        let deaths = i32::try_from(ctx.deaths().len()).expect("max 8 deaths");
        let route = self
            .has_fully_recorded_up_to(stage)
            .then(|| self.data.route());
        txn.execute(
            &format!(
                "UPDATE tfa_challenge_stats SET {} = $1, route = $2 WHERE challenge_id = $3",
                deaths_column(stage),
            ),
            &[&deaths, &route, &txn.challenge_id()],
        )
        .await?;

        Ok(ChallengeTicks::Add(last_tick.duration()))
    }

    async fn on_finish(
        &mut self,
        _txn: &db::Transaction,
        _stored: &StoredState,
        ctx: &mut ChallengeContext,
        final_ticks: Ticks,
    ) -> Result<(), db::Error> {
        ctx.set_challenge_split(
            SplitType::TfaChallenge,
            final_ticks,
            self.data.inaccurate_room.then_some(false),
        );
        if let Some(overall) = self
            .challenge
            .reported_times
            .and_then(|times| times.overall)
        {
            ctx.set_challenge_split(SplitType::TfaOverall, Ticks(overall), None);
        }

        for index in 0..self.challenge.party.len() {
            if let Some(player) = ctx.player_mut(index) {
                match self.challenge.status {
                    ChallengeStatus::Completed => player.stats.tfa_completions += 1,
                    ChallengeStatus::Reset => player.stats.tfa_resets += 1,
                    ChallengeStatus::Wiped => player.stats.tfa_wipes += 1,
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
            stage_data: Some(challenge_data::StageData::Tfa(challenge_data::TfaRaid {
                bosses: self.data.bosses.iter().map(BossData::to_proto).collect(),
            })),
        })
    }

    fn has_fully_recorded_up_to(&self, stage: Stage) -> bool {
        let Some(row) = TFA_ROWS.iter().position(|row| row.contains(&stage)) else {
            return false;
        };
        TFA_ROWS[..=row].iter().all(|row| {
            self.data
                .bosses
                .iter()
                .any(|boss| row.contains(&boss.stage))
        })
    }
}
