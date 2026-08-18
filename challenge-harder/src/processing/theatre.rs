//! Theatre of Blood challenge processing.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use super::challenge_processor::{
    ChallengeContext, ChallengeProcessor, ChallengeTicks, EventCursor, RoomNpc, StageContext,
};
use super::db;
use super::split::SplitType;
use super::{StoredState, TheatreConfig};
use crate::lifecycle::core::types::{ChallengeInfo, ChallengeStatus, ProcessingError, Stage};
use crate::merging::MergedEvents;
use crate::npc;
use crate::price::PriceResolver;
use crate::proto::event::npc::maiden_crab::Spawn as MaidenCrabSpawn;
use crate::proto::event::npc::nylo::Style as NyloStyle;
use crate::proto::{ChallengeData, Coords, PlayerAttack, challenge_data, event};
use crate::skill::SkillLevel;

/// Southwest corner of the Bloat room.
const BLOAT_ROOM_ORIGIN: (i32, i32) = (3288, 4440);

/// In-flight state stored between stages.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CustomData {
    maiden: Option<RoomData>,
    bloat: Option<RoomData>,
    nylocas: Option<RoomData>,
    sotetseg: Option<RoomData>,
    xarpus: Option<RoomData>,
    verzik: Option<RoomData>,
}

/// Final state of a processed room, following the `TobRoom` proto message.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RoomData {
    stage: Stage,
    ticks_lost: u32,
    deaths: Vec<String>,
    npcs: Vec<RoomNpc>,
    bloat_down_ticks: Vec<u32>,
    nylo_waves_stalled: Vec<u32>,
    sotetseg_maze_1_pivots: Vec<u32>,
    sotetseg_maze_2_pivots: Vec<u32>,
    sotetseg_maze_1_chosen: Option<String>,
    sotetseg_maze_2_chosen: Option<String>,
    verzik_reds_count: u32,
}

impl RoomData {
    fn to_proto(&self) -> challenge_data::TobRoom {
        challenge_data::TobRoom {
            stage: self.stage as i32,
            ticks_lost: self.ticks_lost,
            deaths: self.deaths.clone(),
            npcs: self.npcs.iter().map(Into::into).collect(),
            bloat_down_ticks: self.bloat_down_ticks.clone(),
            nylo_waves_stalled: self.nylo_waves_stalled.clone(),
            sotetseg_maze_1_pivots: self.sotetseg_maze_1_pivots.clone(),
            sotetseg_maze_2_pivots: self.sotetseg_maze_2_pivots.clone(),
            sotetseg_maze_1_chosen: self.sotetseg_maze_1_chosen.clone(),
            sotetseg_maze_2_chosen: self.sotetseg_maze_2_chosen.clone(),
            verzik_reds_count: self.verzik_reds_count,
        }
    }
}

fn room_split(stage: Stage) -> SplitType {
    match stage {
        Stage::TobMaiden => SplitType::TobEntryMaiden,
        Stage::TobBloat => SplitType::TobEntryBloat,
        Stage::TobNylocas => SplitType::TobEntryNyloRoom,
        Stage::TobSotetseg => SplitType::TobEntrySotetseg,
        Stage::TobXarpus => SplitType::TobEntryXarpus,
        Stage::TobVerzik => SplitType::TobEntryVerzikRoom,
        _ => panic!("invalid ToB stage {stage:?}"),
    }
}

fn next_stage_entry_split(stage: Stage) -> Option<SplitType> {
    match stage {
        Stage::TobBloat => Some(SplitType::TobEntryNyloStart),
        Stage::TobNylocas => Some(SplitType::TobEntrySotetsegStart),
        Stage::TobSotetseg => Some(SplitType::TobEntryXarpusStart),
        Stage::TobXarpus => Some(SplitType::TobEntryVerzikStart),
        _ => None,
    }
}

#[derive(Debug, Default)]
struct MaidenState {
    full_leaks: u32,
    scuffed_spawns: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct BloatDown {
    down_number: u32,
    tick: u32,
    walk_ticks: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct BloatHand {
    wave_number: i16,
    tile_id: i16,
    chunk: i16,
    intra_chunk_order: i16,
}

#[derive(Debug)]
struct BloatState {
    downs: Vec<BloatDown>,
    hands: Vec<BloatHand>,
    wave_number: u32,
    first_down_hp_percent: Option<f32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
struct NylocasStyles {
    mage: i32,
    ranged: i32,
    melee: i32,
}

#[derive(Debug, Default)]
struct NylocasState {
    stalled_waves: Vec<u32>,
    split_styles: NylocasStyles,
    boss_styles: NylocasStyles,
    prev_boss_style: Option<NyloStyle>,
}

impl Default for BloatState {
    fn default() -> Self {
        BloatState {
            downs: Vec::new(),
            hands: Vec::new(),
            wave_number: 1,
            first_down_hp_percent: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ChinThrow {
    party_index: usize,
    weapon_id: u32,
}

#[derive(Debug)]
pub struct TheatreProcessor {
    config: TheatreConfig,
    challenge: ChallengeInfo,
    data: CustomData,
    maiden: MaidenState,
    bloat: BloatState,
    nylocas: NylocasState,
    chins_thrown: Vec<ChinThrow>,
}

impl TheatreProcessor {
    pub fn new(
        config: TheatreConfig,
        challenge: ChallengeInfo,
        custom_data: Option<&serde_json::Value>,
    ) -> Result<TheatreProcessor, ProcessingError> {
        let data = match custom_data {
            Some(value) => {
                serde_json::from_value(value.clone()).map_err(|error| ProcessingError {
                    retriable: false,
                    message: format!("custom data deserialization failed: {error}"),
                })?
            }
            None => CustomData::default(),
        };
        Ok(TheatreProcessor {
            challenge,
            config,
            data,
            maiden: MaidenState::default(),
            bloat: BloatState::default(),
            nylocas: NylocasState::default(),
            chins_thrown: Vec::new(),
        })
    }

    fn rooms(&self) -> [&Option<RoomData>; 6] {
        [
            &self.data.maiden,
            &self.data.bloat,
            &self.data.nylocas,
            &self.data.sotetseg,
            &self.data.xarpus,
            &self.data.verzik,
        ]
    }

    fn room_mut(&mut self, stage: Stage) -> &mut Option<RoomData> {
        match stage {
            Stage::TobMaiden => &mut self.data.maiden,
            Stage::TobBloat => &mut self.data.bloat,
            Stage::TobNylocas => &mut self.data.nylocas,
            Stage::TobSotetseg => &mut self.data.sotetseg,
            Stage::TobXarpus => &mut self.data.xarpus,
            Stage::TobVerzik => &mut self.data.verzik,
            _ => panic!("invalid ToB stage {stage:?}"),
        }
    }

    fn process_npc_spawn(&mut self, ctx: &mut StageContext, tick: u32, npc: &event::Npc) {
        match &npc.r#type {
            Some(event::npc::Type::MaidenCrab(crab)) => {
                match crab.spawn() {
                    MaidenCrabSpawn::Seventies => {
                        ctx.set_stage_split(SplitType::TobEntryMaiden70s, tick, 0, false);
                    }
                    MaidenCrabSpawn::Fifties => {
                        ctx.set_stage_split(SplitType::TobEntryMaiden50s, tick, 0, false);
                        if let Some(seventies) = ctx.stage_split(SplitType::TobEntryMaiden70s) {
                            ctx.set_stage_split(
                                SplitType::TobEntryMaiden70s50s,
                                tick,
                                seventies.tick,
                                false,
                            );
                        }
                    }
                    MaidenCrabSpawn::Thirties => {
                        ctx.set_stage_split(SplitType::TobEntryMaiden30s, tick, 0, false);
                        if let Some(fifties) = ctx.stage_split(SplitType::TobEntryMaiden50s) {
                            ctx.set_stage_split(
                                SplitType::TobEntryMaiden50s30s,
                                tick,
                                fifties.tick,
                                false,
                            );
                        }
                    }
                }

                if crab.scuffed {
                    self.maiden.scuffed_spawns = true;
                }
            }
            Some(event::npc::Type::Nylo(nylo)) => {
                if let event::npc::nylo::SpawnType::Split = nylo.spawn_type() {
                    match nylo.style() {
                        NyloStyle::Mage => self.nylocas.split_styles.mage += 1,
                        NyloStyle::Range => self.nylocas.split_styles.ranged += 1,
                        NyloStyle::Melee => self.nylocas.split_styles.melee += 1,
                    }
                }
            }
            _ => {}
        }

        if let Some(style) = npc::nylocas_vasilias_style(npc.id) {
            self.update_nylocas_boss_style(style);
        }
    }

    fn process_npc_update(&mut self, ctx: &mut StageContext, _tick: u32, npc: &event::Npc) {
        if ctx.stage() == Stage::TobNylocas
            && let Some(style) = npc::nylocas_vasilias_style(npc.id)
        {
            self.update_nylocas_boss_style(style);
        }
    }

    fn process_player_attack(
        &mut self,
        ctx: &mut StageContext,
        stage: Stage,
        player: &event::Player,
        attack: &event::Attack,
    ) {
        let target = attack.target.as_ref();
        let in_nylo_cleanup = ctx.stage_split(SplitType::TobEntryNyloWaves).is_some()
            && ctx.stage_split(SplitType::TobEntryNyloCleanup).is_none();

        let Some(data) = ctx.player_mut(player.party_index as usize) else {
            return;
        };
        let stats = &mut data.stats;

        match attack.r#type() {
            PlayerAttack::GodswordSmack
            | PlayerAttack::HammerBop
            | PlayerAttack::ChallySwipe
            | PlayerAttack::ElderMaul
            | PlayerAttack::TonalzticsAuto => {
                if stage == Stage::TobVerzik
                    && target.is_some_and(|npc| npc::is_verzik_matomenos(npc.id))
                {
                    // Can 6t or 7t a red crab to tick fix; not a troll.
                    return;
                }

                if attack.r#type() != PlayerAttack::TonalzticsAuto
                    && stage == Stage::TobNylocas
                    && in_nylo_cleanup
                    && target.is_none_or(|npc| npc::is_nylocas(npc.id))
                {
                    // Ok to overkill a nylo during cleanup.
                    return;
                }

                match attack.r#type() {
                    PlayerAttack::GodswordSmack => stats.bgs_smacks += 1,
                    PlayerAttack::HammerBop => stats.hammer_bops += 1,
                    PlayerAttack::ChallySwipe => stats.chally_pokes += 1,
                    PlayerAttack::ElderMaul => stats.elder_maul_smacks += 1,
                    _ => stats.ralos_autos += 1,
                }
            }

            PlayerAttack::ChinBlack | PlayerAttack::ChinGrey | PlayerAttack::ChinRed => {
                if let Some(weapon) = &attack.weapon {
                    self.chins_thrown.push(ChinThrow {
                        party_index: player.party_index as usize,
                        weapon_id: weapon.id,
                    });
                }

                let is_wrong_throw_distance = attack.distance_to_target != -1
                    && !(4..=6).contains(&attack.distance_to_target);

                stats.chins_thrown_total += 1;

                match stage {
                    Stage::TobMaiden => stats.chins_thrown_maiden += 1,
                    Stage::TobNylocas => stats.chins_thrown_nylocas += 1,
                    _ => {}
                }

                match attack.r#type() {
                    PlayerAttack::ChinBlack => stats.chins_thrown_black += 1,
                    PlayerAttack::ChinRed => stats.chins_thrown_red += 1,
                    _ => stats.chins_thrown_grey += 1,
                }

                // Only consider incorrect throw distances on Maiden crabs.
                if is_wrong_throw_distance
                    && target.is_some_and(|npc| npc::is_maiden_matomenos(npc.id))
                {
                    stats.chins_thrown_incorrectly_maiden += 1;
                }
            }

            PlayerAttack::ClawSpec
            | PlayerAttack::BgsSpec
            | PlayerAttack::DinhsSpec
            | PlayerAttack::ChallySpec
            | PlayerAttack::HammerSpec
            | PlayerAttack::VoidwakerSpec
            | PlayerAttack::ElderMaulSpec
            | PlayerAttack::TonalzticsSpec
            | PlayerAttack::VolatileNmSpec => {
                if target.is_some_and(|npc| npc::is_verzik_p1(npc.id)) {
                    stats.tob_verzik_p1_troll_specs += 1;
                }
            }

            PlayerAttack::ScytheUncharged => stats.uncharged_scythe_swings += 1,

            PlayerAttack::SangBarrage
            | PlayerAttack::ShadowBarrage
            | PlayerAttack::ToxicTridentBarrage
            | PlayerAttack::TridentBarrage
            | PlayerAttack::UnknownBarrage => stats.tob_barrages_without_proper_weapon += 1,

            _ => {}
        }
    }

    fn capture_bloat_hands(&mut self, tick: u32, hands: &[Coords]) {
        #![allow(clippy::cast_possible_truncation, reason = "16x16")]
        let mut hands_by_chunk: [Vec<i16>; 4] = [const { Vec::new() }; 4];

        for hand in hands {
            let x = hand.x - BLOAT_ROOM_ORIGIN.0;
            let y = hand.y - BLOAT_ROOM_ORIGIN.1;

            if !(0..16).contains(&x) || !(0..16).contains(&y) {
                tracing::warn!(
                    tick,
                    x = hand.x,
                    y = hand.y,
                    "tob_bloat_hand_invalid_coordinates",
                );
                continue;
            }

            let tile_id = (y * 16 + x) as i16;
            let chunk = ((y / 8) * 2 + x / 8).cast_unsigned() as usize;
            hands_by_chunk[chunk].push(tile_id);
        }

        let wave_number = i16::try_from(self.bloat.wave_number).expect("waves fit in smallint");
        for (chunk, tiles) in hands_by_chunk.into_iter().enumerate() {
            for (index, tile_id) in tiles.into_iter().enumerate() {
                self.bloat.hands.push(BloatHand {
                    wave_number,
                    tile_id,
                    chunk: chunk.cast_signed() as i16,
                    intra_chunk_order: index.cast_signed() as i16,
                });
            }
        }

        self.bloat.wave_number += 1;
    }

    fn update_nylocas_boss_style(&mut self, style: NyloStyle) {
        if self
            .nylocas
            .prev_boss_style
            .is_none_or(|prev| prev != style)
        {
            match style {
                NyloStyle::Mage => self.nylocas.boss_styles.mage += 1,
                NyloStyle::Range => self.nylocas.boss_styles.ranged += 1,
                NyloStyle::Melee => self.nylocas.boss_styles.melee += 1,
            }
        }
        self.nylocas.prev_boss_style = Some(style);
    }

    async fn finish_maiden(
        &mut self,
        txn: &db::Transaction,
        ctx: &mut StageContext,
        _events: &MergedEvents,
        _room: &mut RoomData,
        last_tick: u32,
        deaths: i32,
    ) -> Result<(), db::Error> {
        if let Some(thirties) = ctx.stage_split(SplitType::TobEntryMaiden30s) {
            ctx.set_stage_split(
                SplitType::TobEntryMaiden30sEnd,
                last_tick,
                thirties.tick,
                true,
            );
        }
        txn.execute(
            "UPDATE tob_challenge_stats
             SET maiden_deaths = $1,
                 maiden_full_leaks = $2,
                 maiden_scuffed_spawns = $3
             WHERE challenge_id = $4",
            &[
                &deaths,
                &self.maiden.full_leaks.cast_signed(),
                &self.maiden.scuffed_spawns,
                &txn.challenge_id(),
            ],
        )
        .await?;

        Ok(())
    }

    async fn finish_bloat(
        &mut self,
        txn: &db::Transaction,
        _ctx: &mut StageContext,
        events: &MergedEvents,
        room: &mut RoomData,
        _last_tick: u32,
        deaths: i32,
    ) -> Result<(), db::Error> {
        room.bloat_down_ticks = self.bloat.downs.iter().map(|down| down.tick).collect();

        let save_stats = async {
            txn.execute(
                "UPDATE tob_challenge_stats
                 SET bloat_deaths = $1,
                     bloat_down_count = $2,
                     bloat_first_down_hp_percent = $3
                 WHERE challenge_id = $4",
                &[
                    &deaths,
                    &i16::try_from(self.bloat.downs.len()).expect("downs fit in smallint"),
                    &self.bloat.first_down_hp_percent,
                    &txn.challenge_id(),
                ],
            )
            .await?;
            Ok(())
        };

        let save_hands = async {
            if events.fully_queryable() {
                self.save_bloat_hands(txn).await
            } else {
                Ok(())
            }
        };
        tokio::try_join!(
            save_stats,
            self.save_bloat_downs(txn, events.accurate_until()),
            save_hands,
        )?;

        Ok(())
    }

    async fn finish_nylocas(
        &mut self,
        txn: &db::Transaction,
        ctx: &mut StageContext,
        _events: &MergedEvents,
        room: &mut RoomData,
        last_tick: u32,
        deaths: i32,
    ) -> Result<(), db::Error> {
        if let Some(boss_spawn) = ctx.stage_split(SplitType::TobEntryNyloBossSpawn) {
            ctx.set_stage_split(
                SplitType::TobEntryNyloBoss,
                last_tick,
                boss_spawn.tick,
                true,
            );
        }

        room.nylo_waves_stalled
            .clone_from(&self.nylocas.stalled_waves);

        let mut stalls = [0i32; 31];
        let mut pre_cap_stalls = 0i32;
        let mut post_cap_stalls = 0i32;
        for &wave in &self.nylocas.stalled_waves {
            if wave < 20 {
                pre_cap_stalls += 1;
            } else {
                post_cap_stalls += 1;
            }
            if let Some(count) = wave
                .checked_sub(1)
                .and_then(|index| stalls.get_mut(index as usize))
            {
                *count += 1;
            }
        }
        let stalls = stalls.to_vec();

        txn.execute(
            "UPDATE tob_challenge_stats
             SET nylocas_deaths = $1,
                 nylocas_stalls = $2,
                 nylocas_pre_cap_stalls = $3,
                 nylocas_post_cap_stalls = $4,
                 nylocas_mage_splits = $5,
                 nylocas_ranged_splits = $6,
                 nylocas_melee_splits = $7,
                 nylocas_boss_mage = $8,
                 nylocas_boss_ranged = $9,
                 nylocas_boss_melee = $10
             WHERE challenge_id = $11",
            &[
                &deaths,
                &stalls,
                &pre_cap_stalls,
                &post_cap_stalls,
                &self.nylocas.split_styles.mage,
                &self.nylocas.split_styles.ranged,
                &self.nylocas.split_styles.melee,
                &self.nylocas.boss_styles.mage,
                &self.nylocas.boss_styles.ranged,
                &self.nylocas.boss_styles.melee,
                &txn.challenge_id(),
            ],
        )
        .await?;

        Ok(())
    }

    async fn save_bloat_downs(
        &self,
        txn: &db::Transaction,
        accurate_until: u32,
    ) -> Result<(), db::Error> {
        if self.bloat.downs.is_empty() {
            return Ok(());
        }

        let mut down_numbers = Vec::with_capacity(self.bloat.downs.len());
        let mut down_ticks = Vec::with_capacity(self.bloat.downs.len());
        let mut walk_ticks = Vec::with_capacity(self.bloat.downs.len());
        let mut accurate = Vec::with_capacity(self.bloat.downs.len());
        for down in &self.bloat.downs {
            down_numbers
                .push(i16::try_from(down.down_number).expect("down number fits in smallint"));
            down_ticks.push(down.tick.cast_signed());
            walk_ticks.push(i16::try_from(down.walk_ticks).expect("walk ticks fit in smallint"));
            accurate.push(down.tick < accurate_until);
        }

        txn.execute(
            "INSERT INTO bloat_downs (challenge_id, down_number, down_tick, walk_ticks, accurate)
             SELECT $1, down_number, down_tick, walk_ticks, accurate
             FROM unnest($2::smallint[], $3::int[], $4::smallint[], $5::bool[])
                 AS down(down_number, down_tick, walk_ticks, accurate)",
            &[
                &i64::from(txn.challenge_id()),
                &down_numbers,
                &down_ticks,
                &walk_ticks,
                &accurate,
            ],
        )
        .await?;
        Ok(())
    }

    /// Records hand positions observed at Bloat.
    ///
    /// Only a relatively small number of hands is required for statistically
    /// significant analysis, so the cap limits the growth of the table while
    /// continuing to ingest hands regularly. The cap is soft by design;
    /// challenges processing concurrently could exceed it.
    async fn save_bloat_hands(&self, txn: &db::Transaction) -> Result<(), db::Error> {
        if self.bloat.hands.is_empty() {
            return Ok(());
        }

        let today = txn
            .query_opt(
                "SELECT id FROM challenges
                 WHERE start_time >= date_trunc('day', now() AT TIME ZONE 'UTC')
                 ORDER BY start_time ASC
                 LIMIT 1",
                &[],
            )
            .await?;
        let hands_recorded_today: i64 = match today {
            Some(row) => {
                let first_challenge_id: i32 = row.get(0);
                txn.query_one(
                    "SELECT COUNT(*) FROM bloat_hands WHERE challenge_id >= $1",
                    &[&i64::from(first_challenge_id)],
                )
                .await?
                .get(0)
            }
            None => 0,
        };

        if hands_recorded_today >= self.config.daily_bloat_hand_limit {
            return Ok(());
        }

        let wave_numbers: Vec<i16> = self.bloat.hands.iter().map(|h| h.wave_number).collect();
        let tile_ids: Vec<i16> = self.bloat.hands.iter().map(|h| h.tile_id).collect();
        let chunks: Vec<i16> = self.bloat.hands.iter().map(|h| h.chunk).collect();
        let orders: Vec<i16> = self
            .bloat
            .hands
            .iter()
            .map(|h| h.intra_chunk_order)
            .collect();

        txn.execute(
            "INSERT INTO bloat_hands
                 (challenge_id, wave_number, tile_id, chunk, intra_chunk_order)
             SELECT $1, wave_number, tile_id, chunk, intra_chunk_order
             FROM unnest($2::smallint[], $3::smallint[], $4::smallint[], $5::smallint[])
                 AS hand(wave_number, tile_id, chunk, intra_chunk_order)",
            &[
                &i64::from(txn.challenge_id()),
                &wave_numbers,
                &tile_ids,
                &chunks,
                &orders,
            ],
        )
        .await?;

        tracing::debug!(
            hands_saved = self.bloat.hands.len(),
            "tob_bloat_hands_saved"
        );
        Ok(())
    }
}

#[async_trait]
impl ChallengeProcessor for TheatreProcessor {
    fn process_challenge_event(
        &mut self,
        ctx: &mut StageContext,
        events: &mut EventCursor<'_>,
    ) -> bool {
        let event = events.current();
        match event.r#type() {
            event::Type::PlayerDeath => {
                if let Some(player) = &event.player
                    && let Some(data) = ctx.player_mut(player.party_index as usize)
                {
                    data.stats.deaths_total += 1;
                    match event.stage() {
                        Stage::TobMaiden => data.stats.deaths_maiden += 1,
                        Stage::TobBloat => data.stats.deaths_bloat += 1,
                        Stage::TobNylocas => data.stats.deaths_nylocas += 1,
                        Stage::TobSotetseg => data.stats.deaths_sotetseg += 1,
                        Stage::TobXarpus => data.stats.deaths_xarpus += 1,
                        Stage::TobVerzik => data.stats.deaths_verzik += 1,
                        _ => {}
                    }
                }
                true
            }
            event::Type::PlayerAttack => {
                if let Some(player) = &event.player
                    && let Some(attack) = &event.player_attack
                {
                    self.process_player_attack(ctx, event.stage(), player, attack);
                }
                true
            }
            event::Type::NpcSpawn => {
                if let Some(npc) = &event.npc {
                    self.process_npc_spawn(ctx, event.tick, npc);
                }
                true
            }
            event::Type::NpcUpdate => {
                if let Some(npc) = &event.npc {
                    self.process_npc_update(ctx, event.tick, npc);
                }
                true
            }
            event::Type::TobMaidenCrabLeak => {
                if let Some(npc) = &event.npc
                    && matches!(npc.r#type, Some(event::npc::Type::MaidenCrab(_)))
                {
                    let hitpoints = SkillLevel::from_raw(npc.hitpoints);
                    if hitpoints.current == hitpoints.base {
                        self.maiden.full_leaks += 1;
                    }
                }
                true
            }
            event::Type::TobBloatDown => {
                if let Some(down) = &event.bloat_down {
                    self.bloat.downs.push(BloatDown {
                        down_number: down.down_number,
                        tick: event.tick,
                        walk_ticks: down.up_ticks.saturating_sub(1),
                    });

                    if down.down_number == 1 {
                        let bloat = events.events_for_tick(event.tick).iter().find(|e| {
                            e.r#type() == event::Type::NpcUpdate
                                && e.npc.as_ref().is_some_and(|npc| npc::is_bloat(npc.id))
                        });
                        if let Some(npc) = bloat.and_then(|e| e.npc.as_ref()) {
                            self.bloat.first_down_hp_percent =
                                Some(SkillLevel::from_raw(npc.hitpoints).percentage());
                        }
                    }
                }
                true
            }
            event::Type::TobBloatHandsDrop => {
                self.capture_bloat_hands(event.tick, &event.bloat_hands);
                true
            }
            event::Type::TobNyloWaveSpawn => {
                if let Some(wave) = event.nylo_wave {
                    if wave.wave == 20 {
                        ctx.set_stage_split(SplitType::TobEntryNyloCap, event.tick, 0, false);
                    } else if wave.wave == 31 {
                        ctx.set_stage_split(SplitType::TobEntryNyloWaves, event.tick, 0, false);
                    }
                }
                true
            }
            event::Type::TobNyloWaveStall => {
                if let Some(wave) = event.nylo_wave {
                    self.nylocas.stalled_waves.push(wave.wave);
                }
                true
            }
            event::Type::TobNyloCleanupEnd => {
                ctx.set_stage_split(SplitType::TobEntryNyloCleanup, event.tick, 0, false);
                true
            }
            event::Type::TobNyloBossSpawn => {
                ctx.set_stage_split(SplitType::TobEntryNyloBossSpawn, event.tick, 0, false);
                true
            }
            _ => true,
        }
    }

    async fn on_create(&mut self, txn: &db::Transaction) -> Result<(), db::Error> {
        txn.execute(
            "INSERT INTO tob_challenge_stats (challenge_id) VALUES ($1)",
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
        events: &MergedEvents,
    ) -> Result<ChallengeTicks, db::Error> {
        let last_tick = events.last_tick();

        let deaths: Vec<String> = ctx
            .deaths()
            .iter()
            .map(|&index| self.challenge.party[index].clone())
            .collect();
        let mut room = RoomData {
            stage,
            ticks_lost: events.missing_tick_count(),
            deaths,
            npcs: ctx.npcs().cloned().collect(),
            ..RoomData::default()
        };
        let deaths = i32::try_from(room.deaths.len()).expect("max 5 deaths");

        match stage {
            Stage::TobMaiden => {
                self.finish_maiden(txn, ctx, events, &mut room, last_tick, deaths)
                    .await?;
            }
            Stage::TobBloat => {
                self.finish_bloat(txn, ctx, events, &mut room, last_tick, deaths)
                    .await?;
            }
            Stage::TobNylocas => {
                self.finish_nylocas(txn, ctx, events, &mut room, last_tick, deaths)
                    .await?;
            }
            _ => {}
        }

        *self.room_mut(stage) = Some(room);

        ctx.set_stage_split(room_split(stage), last_tick, 0, true);

        if events.status() == event::stage_update::Status::Completed
            && self.has_fully_recorded_up_to(stage)
            && let Some(next_entry) = next_stage_entry_split(stage)
        {
            ctx.set_challenge_split(
                next_entry,
                stored.challenge_ticks + last_tick,
                Some(!self.challenge.party_changed && events.has_precise_server_tick_count()),
            );
        }

        Ok(ChallengeTicks::Add(last_tick))
    }

    async fn on_finish(
        &mut self,
        _txn: &db::Transaction,
        _stored: &StoredState,
        ctx: &mut ChallengeContext,
        final_ticks: u32,
    ) -> Result<(), db::Error> {
        ctx.set_challenge_split(SplitType::TobEntryChallenge, final_ticks, None);
        if let Some(overall) = self
            .challenge
            .reported_times
            .and_then(|times| times.overall)
        {
            ctx.set_challenge_split(SplitType::TobEntryOverall, overall, None);
        }

        for index in 0..self.challenge.party.len() {
            if let Some(player) = ctx.player_mut(index) {
                match self.challenge.status {
                    ChallengeStatus::Completed => player.stats.tob_completions += 1,
                    ChallengeStatus::Reset => player.stats.tob_resets += 1,
                    ChallengeStatus::Wiped => player.stats.tob_wipes += 1,
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
            stage_data: Some(challenge_data::StageData::TobRooms(
                challenge_data::TobRooms {
                    maiden: self.data.maiden.as_ref().map(RoomData::to_proto),
                    bloat: self.data.bloat.as_ref().map(RoomData::to_proto),
                    nylocas: self.data.nylocas.as_ref().map(RoomData::to_proto),
                    sotetseg: self.data.sotetseg.as_ref().map(RoomData::to_proto),
                    xarpus: self.data.xarpus.as_ref().map(RoomData::to_proto),
                    verzik: self.data.verzik.as_ref().map(RoomData::to_proto),
                },
            )),
        })
    }

    fn has_fully_recorded_up_to(&self, stage: Stage) -> bool {
        if !(Stage::TobMaiden..=Stage::TobVerzik).contains(&stage) {
            return false;
        }
        let recorded = (stage as usize) - (Stage::TobMaiden as usize) + 1;
        self.rooms()[..recorded].iter().all(|r| r.is_some())
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::too_many_lines)]
    use serde_json::json;

    use super::*;
    use crate::lifecycle::core::state::Trigger;
    use crate::lifecycle::core::types::{
        ChallengeMode, ChallengeType, JournalSeq, ReportedTimes, StageStatus, Uuid,
    };
    use crate::merging::fixtures::{
        NpcEvent, PlayerAttackEvent, ServerTicks, bloat_down_event, bloat_hands_drop_event,
        maiden_crab_leak_event, merged_events, npc_spawn_event, npc_update_event, nylo_split_event,
        nylo_wave_event, player_attack_event, player_death_event,
    };
    use crate::processing::split::{SavedSplit, StageSplit};
    use crate::processing::stats::PlayerStatsDelta;
    use crate::proto::Event;
    use crate::proto::event::npc::MaidenCrab;
    use crate::proto::event::npc::maiden_crab::Position as MaidenCrabPosition;

    fn challenge_info(stage: Stage, status: ChallengeStatus) -> ChallengeInfo {
        ChallengeInfo {
            uuid: "40cca35b-9c17-4e0a-b7d2-91e5f83a6c0d".parse().unwrap(),
            session_uuid: "1de5b70a-3f52-4c68-9b1d-c2a4e87f30b6".parse().unwrap(),
            challenge_type: ChallengeType::Tob,
            mode: ChallengeMode::TobRegular,
            party: vec!["1Ogp".to_string(), "WWWWWWWWWWQQ".to_string()],
            party_changed: false,
            stage,
            stage_attempt: None,
            status,
            created_unix_ms: 1_786_861_880_765,
            reported_times: None,
            finished_unix_ms: None,
        }
    }

    #[test]
    fn processor_starts_with_empty_data() {
        let processor = TheatreProcessor::new(
            TheatreConfig::default(),
            challenge_info(Stage::TobMaiden, ChallengeStatus::InProgress),
            None,
        )
        .unwrap();
        assert_eq!(
            processor.custom_data(),
            Some(json!({
                "maiden": null,
                "bloat": null,
                "nylocas": null,
                "sotetseg": null,
                "xarpus": null,
                "verzik": null,
            })),
        );
        assert!(!processor.has_fully_recorded_up_to(Stage::TobMaiden));
    }

    #[test]
    fn malformed_custom_data_fails_construction() {
        let error = TheatreProcessor::new(
            TheatreConfig::default(),
            challenge_info(Stage::TobMaiden, ChallengeStatus::InProgress),
            Some(&json!({"maiden": 51})),
        )
        .unwrap_err();
        assert!(!error.retriable);
        assert!(
            error
                .message
                .starts_with("custom data deserialization failed")
        );
    }

    fn maiden_crab(
        spawn: MaidenCrabSpawn,
        position: MaidenCrabPosition,
        scuffed: bool,
    ) -> event::npc::Type {
        event::npc::Type::MaidenCrab(MaidenCrab {
            spawn: spawn as i32,
            position: position as i32,
            scuffed,
        })
    }

    fn crab_spawn(tick: u32, room_id: u64, coords: (i32, i32), kind: event::npc::Type) -> Event {
        npc_spawn_event(NpcEvent {
            tick,
            stage: Stage::TobMaiden,
            coords,
            npc_id: npc::id::MAIDEN_MATOMENOS_REGULAR,
            room_id,
            hitpoints: SkillLevel {
                current: 75,
                base: 75,
            },
            kind: Some(kind),
            ..Default::default()
        })
    }

    fn crab_leak(
        tick: u32,
        room_id: u64,
        coords: (i32, i32),
        current: u16,
        kind: event::npc::Type,
    ) -> Event {
        maiden_crab_leak_event(NpcEvent {
            tick,
            stage: Stage::TobMaiden,
            coords,
            npc_id: npc::id::MAIDEN_MATOMENOS_REGULAR,
            room_id,
            hitpoints: SkillLevel { current, base: 75 },
            kind: Some(kind),
            ..Default::default()
        })
    }

    #[test]
    fn maiden_crab_spawns_record_splits() {
        let mut processor = TheatreProcessor::new(
            TheatreConfig::default(),
            challenge_info(Stage::TobMaiden, ChallengeStatus::InProgress),
            None,
        )
        .unwrap();
        let mut ctx = StageContext::new(
            Stage::TobMaiden,
            vec!["1Ogp".to_string(), "WWWWWWWWWWQQ".to_string()],
        );
        let mut events = merged_events(
            vec![
                crab_spawn(
                    56,
                    45952,
                    (3185, 4454),
                    maiden_crab(
                        MaidenCrabSpawn::Seventies,
                        MaidenCrabPosition::N4Inner,
                        false,
                    ),
                ),
                crab_spawn(
                    56,
                    45954,
                    (3173, 4456),
                    maiden_crab(MaidenCrabSpawn::Seventies, MaidenCrabPosition::N1, false),
                ),
                crab_leak(
                    62,
                    45954,
                    (3167, 4450),
                    75,
                    maiden_crab(MaidenCrabSpawn::Seventies, MaidenCrabPosition::N1, false),
                ),
                crab_leak(
                    108,
                    45952,
                    (3168, 4444),
                    3,
                    maiden_crab(
                        MaidenCrabSpawn::Seventies,
                        MaidenCrabPosition::N4Inner,
                        false,
                    ),
                ),
                crab_spawn(
                    108,
                    47648,
                    (3173, 4456),
                    maiden_crab(MaidenCrabSpawn::Fifties, MaidenCrabPosition::N1, true),
                ),
                crab_leak(
                    114,
                    47648,
                    (3167, 4450),
                    17,
                    maiden_crab(MaidenCrabSpawn::Fifties, MaidenCrabPosition::N1, true),
                ),
                crab_spawn(
                    173,
                    49452,
                    (3181, 4436),
                    maiden_crab(MaidenCrabSpawn::Thirties, MaidenCrabPosition::S3, false),
                ),
                crab_leak(
                    179,
                    49452,
                    (3167, 4450),
                    15,
                    maiden_crab(MaidenCrabSpawn::Thirties, MaidenCrabPosition::S3, false),
                ),
                player_death_event(231, Stage::TobMaiden, (3167, 4450), "WWWWWWWWWWQQ", 1),
            ],
            StageStatus::Started,
            ServerTicks::Missing,
        );

        for index in 0..events.len() {
            let mut cursor = EventCursor::new(&mut events, index);
            assert!(processor.process_challenge_event(&mut ctx, &mut cursor));
        }

        assert_eq!(
            ctx.stage_splits().collect::<Vec<_>>(),
            vec![
                (
                    SplitType::TobEntryMaiden70s,
                    StageSplit {
                        tick: 56,
                        start: 0,
                        requires_completion: false,
                    },
                ),
                (
                    SplitType::TobEntryMaiden50s,
                    StageSplit {
                        tick: 108,
                        start: 0,
                        requires_completion: false,
                    },
                ),
                (
                    SplitType::TobEntryMaiden30s,
                    StageSplit {
                        tick: 173,
                        start: 0,
                        requires_completion: false,
                    },
                ),
                (
                    SplitType::TobEntryMaiden70s50s,
                    StageSplit {
                        tick: 108,
                        start: 56,
                        requires_completion: false,
                    },
                ),
                (
                    SplitType::TobEntryMaiden50s30s,
                    StageSplit {
                        tick: 173,
                        start: 108,
                        requires_completion: false,
                    },
                ),
            ],
        );
        assert!(processor.maiden.scuffed_spawns);
        assert_eq!(processor.maiden.full_leaks, 1);

        let stats: Vec<_> = ctx.players().iter().map(|player| player.stats).collect();
        assert_eq!(
            stats,
            [
                PlayerStatsDelta::default(),
                PlayerStatsDelta {
                    deaths_total: 1,
                    deaths_maiden: 1,
                    ..PlayerStatsDelta::default()
                },
            ],
        );
    }

    #[test]
    fn maiden_player_attacks_record_stats_and_queue_chins() {
        let mut processor = TheatreProcessor::new(
            TheatreConfig::default(),
            challenge_info(Stage::TobMaiden, ChallengeStatus::InProgress),
            None,
        )
        .unwrap();
        let mut ctx = StageContext::new(
            Stage::TobMaiden,
            vec!["1Ogp".to_string(), "WWWWWWWWWWQQ".to_string()],
        );
        let maiden = Some(event::Npc {
            id: 8360,
            room_id: 45947,
            ..Default::default()
        });
        let crab = Some(event::Npc {
            id: npc::id::MAIDEN_MATOMENOS_REGULAR,
            room_id: 45952,
            ..Default::default()
        });
        let mut events = merged_events(
            vec![
                player_attack_event(PlayerAttackEvent {
                    tick: 21,
                    stage: Stage::TobMaiden,
                    coords: (3167, 4450),
                    name: "1Ogp",
                    party_index: Some(0),
                    attack: PlayerAttack::ElderMaul,
                    weapon_id: crate::item::id::ELDER_MAUL.cast_unsigned(),
                    distance_to_target: 1,
                    target: maiden,
                }),
                player_attack_event(PlayerAttackEvent {
                    tick: 71,
                    stage: Stage::TobMaiden,
                    coords: (3170, 4439),
                    name: "WWWWWWWWWWQQ",
                    party_index: Some(1),
                    attack: PlayerAttack::ChinBlack,
                    weapon_id: crate::item::id::BLACK_CHINCHOMPA.cast_unsigned(),
                    distance_to_target: 5,
                    target: crab,
                }),
                player_attack_event(PlayerAttackEvent {
                    tick: 74,
                    stage: Stage::TobMaiden,
                    coords: (3168, 4439),
                    name: "WWWWWWWWWWQQ",
                    party_index: Some(1),
                    attack: PlayerAttack::ChinBlack,
                    weapon_id: crate::item::id::BLACK_CHINCHOMPA.cast_unsigned(),
                    distance_to_target: 5,
                    target: crab,
                }),
                player_attack_event(PlayerAttackEvent {
                    tick: 80,
                    stage: Stage::TobMaiden,
                    coords: (3166, 4441),
                    name: "WWWWWWWWWWQQ",
                    party_index: Some(1),
                    attack: PlayerAttack::ChinBlack,
                    weapon_id: crate::item::id::BLACK_CHINCHOMPA.cast_unsigned(),
                    distance_to_target: 3,
                    target: crab,
                }),
                player_attack_event(PlayerAttackEvent {
                    tick: 92,
                    stage: Stage::TobMaiden,
                    coords: (3167, 4450),
                    name: "1Ogp",
                    party_index: Some(0),
                    attack: PlayerAttack::ScytheUncharged,
                    weapon_id: crate::item::id::SCYTHE_OF_VITUR_UNCHARGED.cast_unsigned(),
                    distance_to_target: 1,
                    target: maiden,
                }),
            ],
            StageStatus::Started,
            ServerTicks::Missing,
        );

        for index in 0..events.len() {
            let mut cursor = EventCursor::new(&mut events, index);
            assert!(processor.process_challenge_event(&mut ctx, &mut cursor));
        }

        assert_eq!(
            processor.chins_thrown,
            vec![
                ChinThrow {
                    party_index: 1,
                    weapon_id: crate::item::id::BLACK_CHINCHOMPA.cast_unsigned(),
                };
                3
            ],
        );
        let stats: Vec<_> = ctx.players().iter().map(|player| player.stats).collect();
        assert_eq!(
            stats,
            [
                PlayerStatsDelta {
                    elder_maul_smacks: 1,
                    uncharged_scythe_swings: 1,
                    ..PlayerStatsDelta::default()
                },
                PlayerStatsDelta {
                    chins_thrown_total: 3,
                    chins_thrown_black: 3,
                    chins_thrown_maiden: 3,
                    chins_thrown_incorrectly_maiden: 1,
                    ..PlayerStatsDelta::default()
                },
            ],
        );
    }

    #[test]
    fn bloat_downs_and_hands_are_captured() {
        let mut processor = TheatreProcessor::new(
            TheatreConfig::default(),
            challenge_info(Stage::TobBloat, ChallengeStatus::InProgress),
            None,
        )
        .unwrap();
        let mut ctx = StageContext::new(
            Stage::TobBloat,
            vec!["1Ogp".to_string(), "WWWWWWWWWWQQ".to_string()],
        );
        let mut events = merged_events(
            vec![
                npc_update_event(NpcEvent {
                    tick: 41,
                    stage: Stage::TobBloat,
                    coords: (3291, 4440),
                    npc_id: npc::id::BLOAT_REGULAR,
                    room_id: 61707,
                    hitpoints: SkillLevel {
                        current: 1394,
                        base: 1500,
                    },
                    ..Default::default()
                }),
                bloat_down_event(41, (3291, 4440), 1, 42),
                bloat_hands_drop_event(
                    74,
                    &[
                        (3302, 4449),
                        (3299, 4453),
                        (3303, 4455),
                        (3294, 4454),
                        (3295, 4451),
                        (3291, 4449),
                        (3292, 4448),
                        (3292, 4452),
                        (3292, 4455),
                        (3294, 4443),
                        (3294, 4441),
                        (3291, 4440),
                        (3289, 4442),
                        (3300, 4446),
                        (3301, 4444),
                        (3300, 4443),
                    ],
                ),
                bloat_hands_drop_event(
                    78,
                    &[
                        (3299, 4448),
                        (3301, 4453),
                        (3302, 4453),
                        (3295, 4454),
                        (3295, 4453),
                        (3290, 4449),
                        (3291, 4448),
                        (3287, 4452), // oh no plugin bug
                        (3291, 4453),
                        (3295, 4441),
                        (3292, 4440),
                        (3290, 4444),
                        (3296, 4444),
                        (3299, 4447),
                        (3302, 4441),
                        (3300, 4444),
                    ],
                ),
                player_death_event(93, Stage::TobBloat, (3292, 4447), "1Ogp", 0),
                npc_update_event(NpcEvent {
                    tick: 109,
                    stage: Stage::TobBloat,
                    coords: (3299, 4440),
                    npc_id: npc::id::BLOAT_REGULAR,
                    room_id: 61707,
                    hitpoints: SkillLevel {
                        current: 698,
                        base: 1500,
                    },
                    ..Default::default()
                }),
                bloat_down_event(109, (3299, 4440), 2, 35),
            ],
            StageStatus::Started,
            ServerTicks::Missing,
        );

        for index in 0..events.len() {
            let mut cursor = EventCursor::new(&mut events, index);
            assert!(processor.process_challenge_event(&mut ctx, &mut cursor));
        }

        assert_eq!(
            processor.bloat.downs,
            vec![
                BloatDown {
                    down_number: 1,
                    tick: 41,
                    walk_ticks: 41,
                },
                BloatDown {
                    down_number: 2,
                    tick: 109,
                    walk_ticks: 34,
                },
            ],
        );
        assert_eq!(processor.bloat.first_down_hp_percent, Some(92.933_334));
        assert_eq!(processor.bloat.wave_number, 3);

        let hand = |wave_number, tile_id, chunk, intra_chunk_order| BloatHand {
            wave_number,
            tile_id,
            chunk,
            intra_chunk_order,
        };
        assert_eq!(
            processor.bloat.hands,
            vec![
                // First drop
                hand(1, 54, 0, 0),
                hand(1, 22, 0, 1),
                hand(1, 3, 0, 2),
                hand(1, 33, 0, 3),
                hand(1, 108, 1, 0),
                hand(1, 77, 1, 1),
                hand(1, 60, 1, 2),
                hand(1, 230, 2, 0),
                hand(1, 183, 2, 1),
                hand(1, 147, 2, 2),
                hand(1, 132, 2, 3),
                hand(1, 196, 2, 4),
                hand(1, 244, 2, 5),
                hand(1, 158, 3, 0),
                hand(1, 219, 3, 1),
                hand(1, 255, 3, 2),
                // Second drop, minus bugged hand
                hand(2, 23, 0, 0),
                hand(2, 4, 0, 1),
                hand(2, 66, 0, 2),
                hand(2, 72, 1, 0),
                hand(2, 123, 1, 1),
                hand(2, 30, 1, 2),
                hand(2, 76, 1, 3),
                hand(2, 231, 2, 0),
                hand(2, 215, 2, 1),
                hand(2, 146, 2, 2),
                hand(2, 131, 2, 3),
                hand(2, 211, 2, 4),
                hand(2, 139, 3, 0),
                hand(2, 221, 3, 1),
                hand(2, 222, 3, 2),
            ],
        );

        let stats: Vec<_> = ctx.players().iter().map(|player| player.stats).collect();
        assert_eq!(
            stats,
            [
                PlayerStatsDelta {
                    deaths_total: 1,
                    deaths_bloat: 1,
                    ..PlayerStatsDelta::default()
                },
                PlayerStatsDelta::default(),
            ],
        );
    }

    fn nylo_split_spawn(
        tick: u32,
        room_id: u64,
        coords: (i32, i32),
        npc_id: u32,
        wave: u32,
        style: NyloStyle,
    ) -> Event {
        npc_spawn_event(NpcEvent {
            tick,
            stage: Stage::TobNylocas,
            coords,
            npc_id,
            room_id,
            hitpoints: SkillLevel {
                current: 9,
                base: 9,
            },
            kind: Some(event::npc::Type::Nylo(event::npc::Nylo {
                wave,
                parent_room_id: room_id - 100,
                big: false,
                style: style as i32,
                spawn_type: event::npc::nylo::SpawnType::Split as i32,
            })),
            ..Default::default()
        })
    }

    fn nylo_boss_update(tick: u32, npc_id: u32, current: u16) -> Event {
        npc_update_event(NpcEvent {
            tick,
            stage: Stage::TobNylocas,
            coords: (3294, 4247),
            npc_id,
            room_id: 58175,
            hitpoints: SkillLevel {
                current,
                base: 2187,
            },
            ..Default::default()
        })
    }

    #[test]
    fn nylocas_events_record_splits_stalls_and_styles() {
        let mut processor = TheatreProcessor::new(
            TheatreConfig::default(),
            challenge_info(Stage::TobNylocas, ChallengeStatus::InProgress),
            None,
        )
        .unwrap();
        let mut ctx = StageContext::new(
            Stage::TobNylocas,
            vec!["1Ogp".to_string(), "WWWWWWWWWWQQ".to_string()],
        );
        let mut events = merged_events(
            vec![
                nylo_split_spawn(26, 53938, (3295, 4237), 8342, 5, NyloStyle::Melee),
                nylo_split_spawn(31, 54068, (3287, 4248), 8343, 5, NyloStyle::Range),
                nylo_split_spawn(51, 54374, (3296, 4239), 8344, 7, NyloStyle::Mage),
                nylo_wave_event(event::Type::TobNyloWaveSpawn, 152, 20, 12, 24),
                nylo_wave_event(event::Type::TobNyloWaveStall, 232, 29, 28, 24),
                nylo_wave_event(event::Type::TobNyloWaveStall, 236, 29, 28, 24),
                nylo_wave_event(event::Type::TobNyloWaveStall, 240, 29, 25, 24),
                nylo_wave_event(event::Type::TobNyloWaveSpawn, 244, 30, 23, 24),
                nylo_wave_event(event::Type::TobNyloWaveSpawn, 248, 31, 26, 24),
                nylo_split_event(event::Type::TobNyloCleanupEnd, 273),
                nylo_split_event(event::Type::TobNyloBossSpawn, 292),
                npc_spawn_event(NpcEvent {
                    tick: 292,
                    stage: Stage::TobNylocas,
                    coords: (3294, 4247),
                    npc_id: npc::id::NYLOCAS_VASILIAS_DROPPING_REGULAR,
                    room_id: 58175,
                    hitpoints: SkillLevel {
                        current: 2187,
                        base: 2187,
                    },
                    ..Default::default()
                }),
                nylo_boss_update(293, npc::id::NYLOCAS_VASILIAS_DROPPING_REGULAR, 2187),
                nylo_boss_update(294, npc::id::NYLOCAS_VASILIAS_MELEE_REGULAR, 2187),
                nylo_boss_update(303, npc::id::NYLOCAS_VASILIAS_MAGE_REGULAR, 1801),
                nylo_boss_update(313, npc::id::NYLOCAS_VASILIAS_MELEE_REGULAR, 1686),
                nylo_boss_update(323, npc::id::NYLOCAS_VASILIAS_RANGE_REGULAR, 1346),
                nylo_boss_update(333, npc::id::NYLOCAS_VASILIAS_MELEE_REGULAR, 1008),
                nylo_boss_update(343, npc::id::NYLOCAS_VASILIAS_RANGE_REGULAR, 321),
                nylo_boss_update(353, npc::id::NYLOCAS_VASILIAS_MAGE_REGULAR, 43),
            ],
            StageStatus::Completed,
            ServerTicks::Precise(362),
        );

        for index in 0..events.len() {
            let mut cursor = EventCursor::new(&mut events, index);
            assert!(processor.process_challenge_event(&mut ctx, &mut cursor));
        }

        assert_eq!(
            ctx.stage_splits().collect::<Vec<_>>(),
            vec![
                (
                    SplitType::TobEntryNyloCap,
                    StageSplit {
                        tick: 152,
                        start: 0,
                        requires_completion: false,
                    },
                ),
                (
                    SplitType::TobEntryNyloWaves,
                    StageSplit {
                        tick: 248,
                        start: 0,
                        requires_completion: false,
                    },
                ),
                (
                    SplitType::TobEntryNyloCleanup,
                    StageSplit {
                        tick: 273,
                        start: 0,
                        requires_completion: false,
                    },
                ),
                (
                    SplitType::TobEntryNyloBossSpawn,
                    StageSplit {
                        tick: 292,
                        start: 0,
                        requires_completion: false,
                    },
                ),
            ],
        );
        assert_eq!(processor.nylocas.stalled_waves, vec![29, 29, 29]);
        assert_eq!(
            processor.nylocas.split_styles,
            NylocasStyles {
                mage: 1,
                ranged: 1,
                melee: 1,
            },
        );
        assert_eq!(
            processor.nylocas.boss_styles,
            NylocasStyles {
                mage: 2,
                ranged: 2,
                melee: 3,
            },
        );
        assert_eq!(processor.nylocas.prev_boss_style, Some(NyloStyle::Mage));
    }

    #[tokio::test]
    async fn on_finish_writes_challenge_splits_and_stats() {
        let Some(db) = db::test_database().await else {
            return;
        };
        let txn = db
            .start_transaction(Uuid::new_v4(), Trigger::Create { seq: JournalSeq(1) })
            .await
            .unwrap();
        let stored = StoredState {
            players: Vec::new(),
            challenge_ticks: 2109,
            custom_data: None,
        };

        let mut info = challenge_info(Stage::TobVerzik, ChallengeStatus::Completed);
        info.reported_times = Some(ReportedTimes {
            challenge: 2109,
            overall: Some(2485),
        });
        let mut processor = TheatreProcessor::new(TheatreConfig::default(), info, None).unwrap();
        let mut ctx = ChallengeContext::new(vec!["1Ogp".to_string(), "WWWWWWWWWWQQ".to_string()]);
        processor
            .on_finish(&txn, &stored, &mut ctx, 2109)
            .await
            .unwrap();
        assert_eq!(
            ctx.splits(false),
            vec![
                SavedSplit {
                    split: SplitType::TobEntryChallenge,
                    ticks: 2109,
                    accurate: false,
                },
                SavedSplit {
                    split: SplitType::TobEntryOverall,
                    ticks: 2485,
                    accurate: false,
                },
            ],
        );
        for player in ctx.players() {
            assert_eq!(player.stats.tob_completions, 1);
            assert_eq!(player.stats.tob_wipes, 0);
        }

        let mut processor = TheatreProcessor::new(
            TheatreConfig::default(),
            challenge_info(Stage::TobSotetseg, ChallengeStatus::Wiped),
            None,
        )
        .unwrap();
        let mut ctx = ChallengeContext::new(vec!["1Ogp".to_string(), "WWWWWWWWWWQQ".to_string()]);
        processor
            .on_finish(&txn, &stored, &mut ctx, 1121)
            .await
            .unwrap();
        assert_eq!(
            ctx.splits(false),
            vec![SavedSplit {
                split: SplitType::TobEntryChallenge,
                ticks: 1121,
                accurate: false,
            }],
        );
        for player in ctx.players() {
            assert_eq!(player.stats.tob_completions, 0);
            assert_eq!(player.stats.tob_wipes, 1);
        }
    }
}
