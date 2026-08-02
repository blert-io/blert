//! Stage result persistence.

use std::collections::BTreeMap;

use crate::lifecycle::core::types::{
    PrimaryMeleeGear, ProcessingError, ProcessingPayload, Stage, StageStatus,
};
use crate::proto::{Event, event};
use crate::repository::DataRepository;
use crate::skill::SkillLevel;

use super::challenge_processor::{ChallengeProcessor, StageContext};
use super::db;
use super::interpret::{InterpretError, InterpretOutput};
use super::split::{SplitExt, SplitType};
use super::stats::PlayerStatsDelta;
use super::{ChallengeInfo, StoredPlayerInfo, StoredState};

/// Writes a stage's processed results to the database and blob store.
/// Returns the payload to be sent back to the challenge.
pub(super) async fn persist(
    txn: &db::Transaction,
    repository: &DataRepository,
    challenge: &ChallengeInfo,
    stored: &StoredState,
    result: Result<InterpretOutput, InterpretError>,
    processor: &mut dyn ChallengeProcessor,
) -> Result<ProcessingPayload, ProcessingError> {
    let payload = payload_from(&result);

    if let Ok(mut output) = result {
        processor
            .on_stage_finished(
                txn,
                stored,
                &mut output.ctx,
                challenge.stage,
                &output.events,
            )
            .await?;

        let splits = write_splits(
            txn,
            challenge,
            output.events.accurate_until(),
            output.events.status() == StageStatus::Completed,
            &output.ctx,
        )
        .await?;
        update_personal_bests(txn, challenge, &stored.players, &splits).await?;

        let ((), (), queryable_events, ()) = tokio::try_join!(
            update_players(txn, challenge.stage, &output.ctx, &stored.players),
            update_player_stats(txn, &output.ctx, &stored.players),
            write_queryable_events(txn, challenge, &output, &stored.players),
            update_challenge_row(txn, output.events.last_tick(), output.ctx.deaths().len())
        )?;

        let queryable_until = output.events.queryable_until();
        let events = output.into_kept_events();
        let total_events = events.len();

        let challenge_data = processor.challenge_data();
        let save_events = async {
            if let Some(data) = challenge_data {
                repository.save_challenge(challenge.uuid, &data).await
            } else {
                Ok(())
            }
        };

        tokio::try_join!(
            save_events,
            repository.save_stage_events(
                challenge.uuid,
                challenge.stage,
                challenge.stage_attempt,
                &challenge.party,
                events,
            )
        )?;

        tracing::info!(
            uuid = %challenge.uuid,
            stage = ?challenge.stage,
            total_events,
            queryable_events,
            queryable_until,
            "challenge_stage_events_saved",
        );
    }

    Ok(payload)
}

fn payload_from(result: &Result<InterpretOutput, InterpretError>) -> ProcessingPayload {
    match result {
        Ok(output) => ProcessingPayload::Stage {
            status: output.events.status(),
            ticks: output.events.last_tick(),
        },
        // TODO(frolv): Handle errors.
        Err(InterpretError::NoData) => ProcessingPayload::None,
    }
}

async fn update_players(
    txn: &db::Transaction,
    stage: Stage,
    ctx: &StageContext,
    players: &[StoredPlayerInfo],
) -> Result<(), db::Error> {
    let mut updates = Vec::new();
    for (index, player) in players.iter().enumerate() {
        let died: Vec<i16> = if ctx.deaths().contains(&index) {
            vec![stage as i16]
        } else {
            Vec::new()
        };
        let gear = match player.gear {
            PrimaryMeleeGear::Unknown => ctx.players()[index]
                .gear
                .unwrap_or(PrimaryMeleeGear::Unknown),
            gear => gear,
        };

        if died.is_empty() && gear == player.gear {
            continue;
        }

        updates.push((died, gear as i16, player.id));
    }

    futures_util::future::try_join_all(updates.iter().map(|(died, gear, player_id)| async move {
        txn.execute(
            "UPDATE challenge_players
             SET stage_deaths = stage_deaths || $1,
                 primary_gear = $2
             WHERE challenge_id = $3 AND player_id = $4",
            &[died, gear, &txn.challenge_id(), &player_id.0],
        )
        .await
    }))
    .await?;
    Ok(())
}

/// Applies each player's accumulated stat changes to their `player_stats`.
async fn update_player_stats(
    txn: &db::Transaction,
    ctx: &StageContext,
    players: &[StoredPlayerInfo],
) -> Result<(), db::Error> {
    let updates: Vec<_> = players
        .iter()
        .zip(ctx.players())
        .filter(|(_, data)| !data.stats.is_empty())
        .map(|(info, data)| (info.id, data.stats.columns()))
        .collect();
    if updates.is_empty() {
        return Ok(());
    }

    let sql = player_stats_sql(txn).await?;
    futures_util::future::try_join_all(updates.iter().map(|(id, deltas)| async move {
        let mut params: Vec<&(dyn tokio_postgres::types::ToSql + Sync)> =
            Vec::with_capacity(deltas.len() + 1);
        params.push(&id.0);
        for (_, value) in deltas {
            params.push(value);
        }
        txn.execute(sql, &params).await
    }))
    .await?;
    Ok(())
}

/// Returns a SQL query for writing player stats.
async fn player_stats_sql(txn: &db::Transaction) -> Result<&'static str, db::Error> {
    static SQL: tokio::sync::OnceCell<String> = tokio::sync::OnceCell::const_new();
    let sql = SQL
        .get_or_try_init(|| async {
            let statement = txn.prepare("SELECT * FROM player_stats").await?;
            Ok::<_, db::Error>(build_player_stats_sql(statement.columns()))
        })
        .await?;
    Ok(sql)
}

/// Assembles the clone-forward player stats upsert query.
///
/// The inserted row starts from the player's latest row (or zeroes) with the
/// provided deltas added on top, conflicting and updating when a stats row
/// already exists for today.
fn build_player_stats_sql(columns: &[tokio_postgres::Column]) -> String {
    let deltas = PlayerStatsDelta::default().columns();

    let mut names = vec!["player_id".to_string(), "date".to_string()];
    let mut exprs = vec![
        "$1".to_string(),
        "date_trunc('day', now(), 'UTC')".to_string(),
    ];
    let mut updates = Vec::new();
    let mut matched = 0;

    for column in columns {
        let name = column.name();
        if matches!(name, "id" | "player_id" | "date") {
            continue;
        }
        let base = format!("COALESCE(prev.{name}, 0)");
        let expr = if let Some(position) = deltas.iter().position(|(delta, _)| delta == name) {
            matched += 1;
            // $1 is the player ID; deltas bind in `columns()` order after it.
            format!("{base} + ${}", position + 2)
        } else {
            base
        };
        names.push(name.to_string());
        exprs.push(expr);
        updates.push(format!("{name} = EXCLUDED.{name}"));
    }
    assert_eq!(
        matched,
        deltas.len(),
        "player_stats lacks stat delta columns"
    );

    format!(
        "INSERT INTO player_stats ({})
         SELECT {}
         FROM (VALUES (1)) AS seed
         LEFT JOIN LATERAL (
             SELECT * FROM player_stats
             WHERE player_id = $1
             ORDER BY date DESC
             LIMIT 1
         ) prev ON true
         ON CONFLICT (player_id, date) DO UPDATE SET {}",
        names.join(", "),
        exprs.join(", "),
        updates.join(", "),
    )
}

struct InsertedSplit {
    id: i32,
    split: SplitType,
    ticks: u32,
    accurate: bool,
}

/// Inserts a stage's recorded splits, returning the inserted rows.
///
/// Stage splits count their ticks from their recorded start, and are accurate
/// when they lie within the timeline's accurate prefix.
/// Challenge splits are inaccurate unless explicitly overridden.
async fn write_splits(
    txn: &db::Transaction,
    challenge: &ChallengeInfo,
    accurate_until: u32,
    completed: bool,
    ctx: &StageContext,
) -> Result<Vec<InsertedSplit>, db::Error> {
    let mut rows = Vec::new();
    for (split, entry) in ctx.stage_splits() {
        rows.push((
            split.adjust_to(challenge.mode),
            entry.tick - entry.start,
            entry.tick < accurate_until && (!entry.requires_completion || completed),
        ));
    }
    for (split, entry) in ctx.challenge_splits() {
        rows.push((
            split.adjust_to(challenge.mode),
            entry.ticks,
            entry.accurate.unwrap_or(false),
        ));
    }

    if rows.is_empty() {
        return Ok(Vec::new());
    }

    let mut types = Vec::with_capacity(rows.len());
    let mut ticks = Vec::with_capacity(rows.len());
    let mut accurate = Vec::with_capacity(rows.len());
    for &(split, t, acc) in &rows {
        types.push(split as i16);
        ticks.push(t.cast_signed());
        accurate.push(acc);
    }

    let ids = txn
        .query(
            "INSERT INTO challenge_splits (challenge_id, type, scale, ticks, accurate)
             SELECT $1, type, $2, ticks, accurate
             FROM unnest($3::smallint[], $4::int[], $5::bool[]) AS split(type, ticks, accurate)
             RETURNING id",
            &[
                &txn.challenge_id(),
                &challenge.scale(),
                &types,
                &ticks,
                &accurate,
            ],
        )
        .await?;

    Ok(ids
        .into_iter()
        .zip(rows)
        .map(|(row, (split, ticks, accurate))| InsertedSplit {
            id: row.get(0),
            split,
            ticks,
            accurate,
        })
        .collect())
}

/// Compares the accurate inserted splits against each player's current
/// personal bests, recording any new or improved times.
async fn update_personal_bests(
    txn: &db::Transaction,
    challenge: &ChallengeInfo,
    players: &[StoredPlayerInfo],
    splits: &[InsertedSplit],
) -> Result<(), db::Error> {
    let accurate: Vec<&InsertedSplit> = splits.iter().filter(|split| split.accurate).collect();
    if accurate.is_empty() {
        return Ok(());
    }

    let player_ids: Vec<i32> = players.iter().map(|player| player.id.0).collect();
    let split_types: Vec<i16> = accurate.iter().map(|split| split.split as i16).collect();
    let scale = challenge.scale();

    let rows = txn
        .query(
            "WITH ranked_pbs AS (
               SELECT pbh.player_id, cs.type, cs.ticks,
                      ROW_NUMBER() OVER (
                          PARTITION BY pbh.player_id, cs.type, cs.scale
                          ORDER BY pbh.created_at DESC
                      ) AS rn
               FROM personal_best_history pbh
               JOIN challenge_splits cs ON pbh.challenge_split_id = cs.id
               WHERE pbh.player_id = ANY($1) AND cs.type = ANY($2) AND cs.scale = $3
             )
             SELECT player_id, type, ticks FROM ranked_pbs WHERE rn = 1",
            &[&player_ids, &split_types, &scale],
        )
        .await?;
    let mut current: BTreeMap<(i32, i16), i32> = BTreeMap::new();
    for row in rows {
        current.insert((row.get(0), row.get(1)), row.get(2));
    }

    let mut pb_players = Vec::new();
    let mut pb_split_ids = Vec::new();
    let mut pb_splits = Vec::new();

    for split in &accurate {
        for player in players {
            let new_best = match current.get(&(player.id.0, split.split as i16)) {
                None => true,
                Some(&ticks) => split.ticks.cast_signed() < ticks,
            };
            if new_best {
                pb_players.push(player.id.0);
                pb_split_ids.push(split.id);
                pb_splits.push(split.split);
            }
        }
    }

    if !pb_players.is_empty() {
        tracing::info!(
            scale,
            players = ?pb_players,
            splits = ?pb_splits,
            "challenge_personal_bests_updated",
        );
        txn.execute(
            "INSERT INTO personal_best_history (player_id, challenge_split_id)
             SELECT * FROM unnest($1::int[], $2::int[])",
            &[&pb_players, &pb_split_ids],
        )
        .await?;
    }

    Ok(())
}

async fn update_challenge_row(
    txn: &db::Transaction,
    stage_ticks: u32,
    new_deaths: usize,
) -> Result<(), db::Error> {
    txn.execute(
        "UPDATE challenges
         SET challenge_ticks = challenge_ticks + $1, total_deaths = total_deaths + $2
         WHERE id = $3",
        &[
            &stage_ticks.cast_signed(),
            &i32::try_from(new_deaths).expect("death count fits in an integer"),
            &txn.challenge_id(),
        ],
    )
    .await?;
    Ok(())
}

/// A row of the `queryable_events` table.
#[derive(Default)]
struct QueryableEvent {
    event_type: i16,
    tick: i32,
    x_coord: i16,
    y_coord: i16,
    subtype: Option<i16>,
    player_id: Option<i32>,
    npc_id: Option<i32>,
    custom_int_1: Option<i32>,
    custom_int_2: Option<i32>,
    custom_short_1: Option<i16>,
    custom_short_2: Option<i16>,
}

/// Writes the stage's kept events within the queryable prefix to the
/// `queryable_events` table. Returns the number of rows written.
async fn write_queryable_events(
    txn: &db::Transaction,
    challenge: &ChallengeInfo,
    output: &InterpretOutput,
    players: &[StoredPlayerInfo],
) -> Result<usize, db::Error> {
    let queryable_until = output.events.queryable_until();
    if queryable_until == 0 {
        return Ok(0);
    }

    let mut rows = Vec::new();
    for &index in &output.kept {
        let event = &output.events[index];
        if event.tick < queryable_until
            && let Some(row) = to_queryable_event(event, &output.ctx, players)
        {
            rows.push(row);
        }
    }
    if rows.is_empty() {
        return Ok(0);
    }

    let mut event_types = Vec::with_capacity(rows.len());
    let mut ticks = Vec::with_capacity(rows.len());
    let mut x_coords = Vec::with_capacity(rows.len());
    let mut y_coords = Vec::with_capacity(rows.len());
    let mut subtypes = Vec::with_capacity(rows.len());
    let mut player_ids = Vec::with_capacity(rows.len());
    let mut npc_ids = Vec::with_capacity(rows.len());
    let mut custom_int_1s = Vec::with_capacity(rows.len());
    let mut custom_int_2s = Vec::with_capacity(rows.len());
    let mut custom_short_1s = Vec::with_capacity(rows.len());
    let mut custom_short_2s = Vec::with_capacity(rows.len());
    for row in &rows {
        event_types.push(row.event_type);
        ticks.push(row.tick);
        x_coords.push(row.x_coord);
        y_coords.push(row.y_coord);
        subtypes.push(row.subtype);
        player_ids.push(row.player_id);
        npc_ids.push(row.npc_id);
        custom_int_1s.push(row.custom_int_1);
        custom_int_2s.push(row.custom_int_2);
        custom_short_1s.push(row.custom_short_1);
        custom_short_2s.push(row.custom_short_2);
    }

    txn.execute(
        "INSERT INTO queryable_events
           (challenge_id, event_type, stage, mode, tick, x_coord, y_coord, subtype,
            player_id, npc_id, custom_int_1, custom_int_2, custom_short_1, custom_short_2)
         SELECT $1, event.event_type, $2, $3, event.tick, event.x_coord, event.y_coord,
                event.subtype, event.player_id, event.npc_id, event.custom_int_1,
                event.custom_int_2, event.custom_short_1, event.custom_short_2
         FROM unnest($4::smallint[], $5::int[], $6::smallint[], $7::smallint[],
                     $8::smallint[], $9::int[], $10::int[], $11::int[], $12::int[],
                     $13::smallint[], $14::smallint[])
              AS event(event_type, tick, x_coord, y_coord, subtype, player_id, npc_id,
                       custom_int_1, custom_int_2, custom_short_1, custom_short_2)",
        &[
            &txn.challenge_id(),
            &(challenge.stage as i16),
            &(challenge.mode as i16),
            &event_types,
            &ticks,
            &x_coords,
            &y_coords,
            &subtypes,
            &player_ids,
            &npc_ids,
            &custom_int_1s,
            &custom_int_2s,
            &custom_short_1s,
            &custom_short_2s,
        ],
    )
    .await?;
    Ok(rows.len())
}

/// Maps an event to its queryable row, if its type is queryable.
#[expect(clippy::cast_possible_truncation, clippy::too_many_lines)]
fn to_queryable_event(
    event: &Event,
    ctx: &StageContext,
    players: &[StoredPlayerInfo],
) -> Option<QueryableEvent> {
    let base = || QueryableEvent {
        event_type: event.r#type as i16,
        tick: event.tick.cast_signed(),
        x_coord: event.x_coord as i16,
        y_coord: event.y_coord as i16,
        ..QueryableEvent::default()
    };
    let id_from_index = |index: u32| {
        players
            .get(index as usize)
            .map(|player: &StoredPlayerInfo| player.id.0)
    };
    let id_from_name = |name: &str| {
        ctx.party_index(name)
            .and_then(|index| players.get(index))
            .map(|player| player.id.0)
    };

    let row = match event.r#type() {
        event::Type::PlayerAttack => {
            let attack = event.player_attack.as_ref()?;
            let mut row = base();
            row.subtype = Some(attack.r#type as i16);
            row.player_id = event
                .player
                .as_ref()
                .and_then(|player| id_from_index(player.party_index));
            row.npc_id = attack.target.as_ref().map(|npc| npc.id.cast_signed());
            // PLAYER_ATTACK_WEAPON
            row.custom_int_1 = attack.weapon.as_ref().map(|weapon| weapon.id.cast_signed());
            // PLAYER_ATTACK_DISTANCE
            row.custom_short_1 = Some(attack.distance_to_target as i16);
            row
        }
        event::Type::PlayerSpell => {
            let spell = event.player_spell.as_ref()?;
            let mut row = base();
            row.subtype = Some(spell.r#type as i16);
            row.player_id = event
                .player
                .as_ref()
                .and_then(|player| id_from_index(player.party_index));
            match &spell.target {
                Some(event::spell::Target::TargetPlayer(name)) => {
                    // PLAYER_SPELL_TARGET_PLAYER
                    row.custom_int_1 = id_from_name(name);
                }
                Some(event::spell::Target::TargetNpc(npc)) => {
                    row.npc_id = Some(npc.id.cast_signed());
                }
                Some(event::spell::Target::NoTarget(())) | None => {}
            }
            row
        }
        event::Type::PlayerDeath => {
            let player = event.player.as_ref()?;
            let mut row = base();
            row.player_id = id_from_index(player.party_index);
            row
        }
        event::Type::NpcSpawn | event::Type::NpcDeath => {
            let npc = event.npc.as_ref()?;
            let mut row = base();
            row.npc_id = Some(npc.id.cast_signed());
            if let Some(kind) = ctx
                .npc(npc.room_id)
                .and_then(|tracked| tracked.kind.as_ref())
            {
                match kind {
                    event::npc::Type::Basic(()) => row.subtype = Some(0),
                    event::npc::Type::MaidenCrab(crab) => {
                        row.subtype = Some(1);
                        // NPC_MAIDEN_CRAB_SPAWN and NPC_MAIDEN_CRAB_POSITION
                        row.custom_short_1 = Some(crab.spawn as i16);
                        row.custom_short_2 = Some(crab.position as i16);
                    }
                    event::npc::Type::Nylo(nylo) => {
                        row.subtype = Some(2);
                        // NPC_NYLO_SPAWN_TYPE and NPC_NYLO_STYLE
                        row.custom_short_1 = Some(nylo.spawn_type as i16);
                        row.custom_short_2 = Some(nylo.style as i16);
                    }
                    event::npc::Type::VerzikCrab(crab) => {
                        row.subtype = Some(3);
                        // NPC_VERZIK_CRAB_PHASE and NPC_VERZIK_CRAB_SPAWN
                        row.custom_short_1 = Some(crab.phase as i16);
                        row.custom_short_2 = Some(crab.spawn as i16);
                    }
                }
            }
            row
        }
        event::Type::NpcAttack => {
            let attack = event.npc_attack.as_ref()?;
            let mut row = base();
            row.subtype = Some(attack.attack as i16);
            row.npc_id = event.npc.as_ref().map(|npc| npc.id.cast_signed());
            row.player_id = attack.target.as_deref().and_then(id_from_name);
            row
        }
        event::Type::TobMaidenCrabLeak => {
            let npc = event.npc.as_ref()?;
            let Some(event::npc::Type::MaidenCrab(crab)) = ctx
                .npc(npc.room_id)
                .and_then(|tracked| tracked.kind.as_ref())
            else {
                return None;
            };
            let mut row = base();
            row.npc_id = Some(npc.id.cast_signed());
            // TOB_MAIDEN_CRAB_LEAK_SPAWN and TOB_MAIDEN_CRAB_LEAK_POSITION
            row.custom_short_1 = Some(crab.spawn as i16);
            row.custom_short_2 = Some(crab.position as i16);
            // TOB_MAIDEN_CRAB_LEAK_CURRENT_HP and TOB_MAIDEN_CRAB_LEAK_BASE_HP
            let hitpoints = SkillLevel::from_raw(npc.hitpoints);
            row.custom_int_1 = Some(i32::from(hitpoints.current));
            row.custom_int_2 = Some(i32::from(hitpoints.base));
            row
        }
        event::Type::TobBloatDown => {
            let down = event.bloat_down.as_ref()?;
            let mut row = base();
            // TOB_BLOAT_DOWN_NUMBER
            row.custom_short_1 = Some(down.down_number as i16);
            // TOB_BLOAT_DOWN_WALK_TIME
            row.custom_short_2 = Some((down.up_ticks.cast_signed() - 1) as i16);
            row
        }
        event::Type::TobNyloWaveStall => {
            let wave = event.nylo_wave.as_ref()?;
            let mut row = base();
            // TOB_NYLO_WAVE_NUMBER and TOB_NYLO_WAVE_NYLO_COUNT
            row.custom_short_1 = Some(wave.wave as i16);
            row.custom_short_2 = Some(wave.nylos_alive as i16);
            row
        }
        event::Type::TobXarpusExhumed => {
            let exhumed = event.xarpus_exhumed.as_ref()?;
            let mut row = base();
            row.tick = exhumed.spawn_tick.cast_signed();
            // TOB_XARPUS_EXHUMED_HEAL_COUNT
            row.custom_short_1 = Some(
                i16::try_from(exhumed.heal_ticks.len()).expect("heal count fits in a smallint"),
            );
            row
        }
        event::Type::TobVerzikBounce => {
            let bounce = event.verzik_bounce.as_ref()?;
            let mut row = base();
            row.player_id = bounce.bounced_player.as_deref().and_then(id_from_name);
            // TOB_VERZIK_BOUNCE_PLAYERS_IN_RANGE and
            row.custom_short_1 = Some(bounce.players_in_range as i16);
            // TOB_VERZIK_BOUNCE_PLAYERS_NOT_IN_RANGE
            row.custom_short_2 = Some(bounce.players_not_in_range as i16);
            row
        }
        event::Type::TobVerzikHeal => {
            let heal = event.verzik_heal.as_ref()?;
            let mut row = base();
            row.player_id = id_from_name(&heal.player);
            // TOB_VERZIK_HEAL_AMOUNT
            row.custom_short_1 = Some(heal.heal_amount as i16);
            row
        }
        event::Type::TobVerzikDawnDrop => {
            let drop = event.verzik_dawn_drop.as_ref()?;
            let mut row = base();
            row.subtype = Some(i16::from(drop.dropped));
            row
        }
        event::Type::ColosseumSolGrapple => {
            let grapple = event.colosseum_sol_grapple.as_ref()?;
            let mut row = base();
            row.player_id = players.first().map(|player| player.id.0);
            // SOL_GRAPPLE_TARGET
            row.custom_short_1 = Some(grapple.target as i16);
            // SOL_GRAPPLE_OUTCOME
            row.custom_short_2 = Some(grapple.outcome as i16);
            row
        }
        _ => return None,
    };

    Some(row)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_data_yields_no_payload() {
        assert_eq!(
            payload_from(&Err(InterpretError::NoData)),
            ProcessingPayload::None,
        );
    }
}
