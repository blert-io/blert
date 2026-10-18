#![allow(clippy::too_many_lines)]

use std::collections::BTreeMap;

use blert::proto::Event;
use blert::proto::event::XarpusPhase;
use blert::proto::event::player::DataSource;
use blert::{Rsn, SkillLevel, VerzikBounce};

use crate::lifecycle::core::types::{ChallengeMode, ClientId, Stage};
use crate::merging::ChallengeInfo;
use crate::merging::alignment::AlignmentEntry;
use crate::merging::fixtures::{
    self, ClientBuilder, NpcEvent, PlayerAttackEvent, PlayerUpdateEvent,
};
use crate::merging::mapping::TickMapping;

use super::*;

const BASE_CLIENT_ID: ClientId = ClientId(1);
const TARGET_CLIENT_ID: ClientId = ClientId(2);

/// Creates a merge context with identity mappings and an active merge step.
fn test_ctx<'a>(
    challenge: &'a ChallengeInfo<'a>,
    base: ClientBuilder,
    target: ClientBuilder,
) -> MergeContext<'a> {
    let (base, target) = (base.build(), target.build());
    let (base_last_tick, target_last_tick) =
        (base.info.last_recorded_tick, target.info.last_recorded_tick);
    let target_client_id = target.info.id;
    let mut ctx = fixtures::merge_context(challenge)
        .client(base)
        .client(target)
        .build();
    ctx.mapping.begin(
        target_client_id,
        Mappings {
            base: TickMapping::identity(base_last_tick),
            target: TickMapping::identity(target_last_tick),
            merged_last_tick: base_last_tick,
        },
    );
    ctx
}

/// Builds a simple recording of ticks with player updates and optional extra
/// events per tick. Each tick has a player at position (tick, 0).
fn build_recording(
    client_id: ClientId,
    stage: Stage,
    challenge: &ChallengeInfo,
    num_ticks: u32,
    player: &str,
    source: DataSource,
    mut extra_events: BTreeMap<Tick, Vec<Event>>,
) -> Recording {
    let last_tick = Tick(num_ticks - 1);
    let mut events = Vec::new();

    for tick in last_tick.up_to_inclusive() {
        let x = i32::try_from(tick.0).expect("tick count is small");
        events.push(
            PlayerUpdateEvent::new(tick, stage, player, (x, 0))
                .source(source)
                .build(),
        );
        events.extend(extra_events.remove(&tick).unwrap_or_default());
    }

    fixtures::recording(
        client_id,
        stage,
        challenge.mode,
        challenge.party,
        last_tick,
        events,
    )
}

fn event_types(recording: &Recording, tick: Tick) -> Vec<event::Type> {
    let mut types: Vec<event::Type> = recording
        .get_state(tick)
        .map(|state| {
            state
                .events
                .iter()
                .map(|event| event_type(&event.kind))
                .collect()
        })
        .unwrap_or_default();
    types.sort_unstable();
    types
}

fn assert_set_eq<T: PartialEq + std::fmt::Debug>(mut actual: Vec<T>, expected: &[T]) {
    for item in expected {
        let index = actual
            .iter()
            .position(|candidate| candidate == item)
            .unwrap_or_else(|| panic!("missing {item:?} in {actual:?}"));
        actual.swap_remove(index);
    }
    assert!(actual.is_empty(), "unexpected {actual:?}");
}

#[test]
fn merges_tick_states_and_extracts_stream_events() {
    let stage = Stage::TobVerzik;
    let party = vec![Rsn::try_from("1Ogp").unwrap()];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);
    let verzik_hitpoints: [u16; 5] = [100, 95, 90, 85, 80];
    let verzik_updates = || -> BTreeMap<Tick, Vec<Event>> {
        verzik_hitpoints
            .iter()
            .enumerate()
            .map(|(i, &current)| {
                let tick = Tick::from_usize(i);
                let update = fixtures::npc_update_event(NpcEvent {
                    tick,
                    stage,
                    coords: (50, 50),
                    npc_id: npc::id::VERZIK_P1_REGULAR,
                    room_id: 1,
                    hitpoints: SkillLevel {
                        current,
                        base: 2000,
                    },
                    ..Default::default()
                });
                (tick, vec![update])
            })
            .collect()
    };

    let base = build_recording(
        BASE_CLIENT_ID,
        stage,
        &challenge,
        5,
        "1Ogp",
        DataSource::Secondary,
        verzik_updates(),
    );
    let mut target_events = verzik_updates();
    target_events
        .entry(Tick(2))
        .or_default()
        .push(fixtures::player_death_event(
            Tick(2),
            stage,
            (0, 0),
            "1Ogp",
            0,
        ));
    let target = build_recording(
        TARGET_CLIENT_ID,
        stage,
        &challenge,
        5,
        "1Ogp",
        DataSource::Primary,
        target_events,
    );

    let ctx = test_ctx(
        &challenge,
        ClientBuilder::new(BASE_CLIENT_ID.0, base.clone()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, target.clone()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    let party_index = result.recording.party_index(&party[0]).unwrap();
    // Player update should be overridden with PRIMARY on all ticks.
    for (i, &current) in verzik_hitpoints.iter().enumerate() {
        let tick = Tick::from_usize(i);
        let tick_state = result
            .recording
            .get_state(tick)
            .expect("every tick is recorded");
        let player = tick_state
            .players
            .get(party_index)
            .expect("player is on every tick");
        assert!(
            matches!(player.data, blert::DataSource::Primary(_)),
            "tick {tick}"
        );

        let verzik = tick_state
            .npcs
            .get(&RoomId(1))
            .expect("npc is on every tick");
        assert_eq!(verzik.id, npc::id::VERZIK_P1_REGULAR, "tick {tick}");
        assert_eq!(
            verzik.hitpoints,
            SkillLevel {
                current,
                base: 2000
            },
            "tick {tick}"
        );
    }

    assert_eq!(
        event_types(&result.recording, Tick(2)),
        vec![event::Type::PlayerDeath]
    );
    assert_eq!(result.quality_flags, vec![]);
    assert_eq!(result.counters, ReconciliationCounters::default());
}

#[test]
fn fills_gaps_in_the_base_from_the_target() {
    let stage = Stage::TobVerzik;
    let party = vec![Rsn::try_from("1Ogp").unwrap()];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);
    let base = fixtures::recording(
        BASE_CLIENT_ID,
        stage,
        challenge.mode,
        &party,
        Tick(2),
        vec![
            PlayerUpdateEvent::new(Tick(0), stage, "1Ogp", (0, 0)).build(),
            PlayerUpdateEvent::new(Tick(2), stage, "1Ogp", (2, 0)).build(),
        ],
    );
    let target = build_recording(
        TARGET_CLIENT_ID,
        stage,
        &challenge,
        3,
        "1Ogp",
        DataSource::Secondary,
        BTreeMap::new(),
    );

    let ctx = test_ctx(
        &challenge,
        ClientBuilder::new(BASE_CLIENT_ID.0, base.clone()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, target.clone()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    let filled = result
        .recording
        .get_state(Tick(1))
        .expect("gap filled from target");
    let party_index = result.recording.party_index(&party[0]).unwrap();
    let player = filled
        .players
        .get(party_index)
        .expect("player is on the filled tick");
    assert_eq!(player.source, Source::Client(TARGET_CLIENT_ID));
    assert_eq!(player.position, Point(1, 0));

    assert_eq!(result.quality_flags, vec![]);
    assert_eq!(result.counters, ReconciliationCounters::default());
}

#[test]
fn populates_leading_or_trailing_ticks_from_the_target() {
    // base:   _,_,0,1,2,3,4,5
    // target: 0,1,2,3,_,_,_,_
    let stage = Stage::TobVerzik;
    let party = vec![Rsn::try_from("1Ogp").unwrap()];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);
    let base = build_recording(
        BASE_CLIENT_ID,
        stage,
        &challenge,
        6,
        "1Ogp",
        DataSource::Secondary,
        BTreeMap::from([(
            Tick(5),
            vec![fixtures::player_death_event(
                Tick(5),
                stage,
                (0, 0),
                "1Ogp",
                0,
            )],
        )]),
    );
    let target = build_recording(
        TARGET_CLIENT_ID,
        stage,
        &challenge,
        4,
        "1Ogp",
        DataSource::Primary,
        BTreeMap::new(),
    );

    let alignments = vec![vec![
        AlignmentEntry::Merge {
            base_index: 0,
            target_index: 2,
            score: 1.0,
        },
        AlignmentEntry::Merge {
            base_index: 1,
            target_index: 3,
            score: 1.0,
        },
    ]];
    let mut ctx = fixtures::merge_context(&challenge)
        .client(ClientBuilder::new(BASE_CLIENT_ID.0, base.clone()).build())
        .client(ClientBuilder::new(TARGET_CLIENT_ID.0, target.clone()).build())
        .build();
    ctx.mapping.begin(
        TARGET_CLIENT_ID,
        TickMapping::from_alignment(base.last_tick(), target.last_tick(), &alignments),
    );

    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    assert_eq!(result.recording.last_tick(), Tick(7));
    let expected_players = [
        (TARGET_CLIENT_ID, DataSource::Primary, 0),
        (TARGET_CLIENT_ID, DataSource::Primary, 1),
        (TARGET_CLIENT_ID, DataSource::Primary, 2),
        (TARGET_CLIENT_ID, DataSource::Primary, 3),
        (BASE_CLIENT_ID, DataSource::Secondary, 2),
        (BASE_CLIENT_ID, DataSource::Secondary, 3),
        (BASE_CLIENT_ID, DataSource::Secondary, 4),
        (BASE_CLIENT_ID, DataSource::Secondary, 5),
    ];
    let party_index = result.recording.party_index(&party[0]).unwrap();
    for (i, &(source, data_source, x)) in expected_players.iter().enumerate() {
        let tick = Tick::from_usize(i);
        let tick_state = result
            .recording
            .get_state(tick)
            .expect("every tick is recorded");
        let player = tick_state
            .players
            .get(party_index)
            .expect("player is on every tick");
        assert_eq!(player.source, Source::Client(source), "tick {tick}");
        assert_eq!(
            matches!(player.data, blert::DataSource::Primary(_)),
            data_source == DataSource::Primary,
            "tick {tick}"
        );
        assert_eq!(player.position, Point(x, 0), "tick {tick}");
    }

    assert_eq!(
        event_types(&result.recording, Tick(7)),
        vec![event::Type::PlayerDeath]
    );
    assert_eq!(result.quality_flags, vec![]);
    assert_eq!(result.counters, ReconciliationCounters::default());
}

#[test]
fn deduplicates_deaths_globally_in_regular_challenges() {
    let stage = Stage::TobVerzik;
    let party = vec![Rsn::try_from("1Ogp").unwrap()];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);
    let base = build_recording(
        BASE_CLIENT_ID,
        stage,
        &challenge,
        25,
        "1Ogp",
        DataSource::Secondary,
        BTreeMap::from([(
            Tick(2),
            vec![fixtures::player_death_event(
                Tick(2),
                stage,
                (0, 0),
                "1Ogp",
                0,
            )],
        )]),
    );
    let target = build_recording(
        TARGET_CLIENT_ID,
        stage,
        &challenge,
        25,
        "1Ogp",
        DataSource::Primary,
        BTreeMap::from([(
            Tick(20),
            vec![fixtures::player_death_event(
                Tick(20),
                stage,
                (0, 0),
                "1Ogp",
                0,
            )],
        )]),
    );

    let ctx = test_ctx(
        &challenge,
        ClientBuilder::new(BASE_CLIENT_ID.0, base.clone()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, target.clone()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    // Earliest observation wins.
    assert_eq!(
        event_types(&result.recording, Tick(2)),
        vec![event::Type::PlayerDeath]
    );
    assert_eq!(event_types(&result.recording, Tick(20)), vec![]);

    // Gap of 18 is below the threshold.
    assert_eq!(result.quality_flags, vec![]);
    assert_eq!(
        result.counters,
        ReconciliationCounters {
            stream_event_pairs: 1,
            ..Default::default()
        }
    );
}

#[test]
fn deduplicates_deaths_within_window_in_respawnable_challenges() {
    let stage = Stage::CoxOlm;
    let party = vec![Rsn::try_from("1Ogp").unwrap()];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::CoxRegular, &party);
    let death = |tick: Tick| vec![fixtures::player_death_event(tick, stage, (0, 0), "1Ogp", 0)];

    let base = build_recording(
        BASE_CLIENT_ID,
        stage,
        &challenge,
        45,
        "1Ogp",
        DataSource::Secondary,
        BTreeMap::from([(Tick(2), death(Tick(2))), (Tick(22), death(Tick(22)))]),
    );
    let target = build_recording(
        TARGET_CLIENT_ID,
        stage,
        &challenge,
        45,
        "1Ogp",
        DataSource::Primary,
        BTreeMap::from([(Tick(5), death(Tick(5))), (Tick(40), death(Tick(40)))]),
    );

    let ctx = test_ctx(
        &challenge,
        ClientBuilder::new(BASE_CLIENT_ID.0, base.clone()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, target.clone()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    // The deaths on 2 and 5 are the same death seen 3 ticks apart.
    // The deaths on 22 and 40 are beyond the window and counted distinctly.
    assert_eq!(
        event_types(&result.recording, Tick(2)),
        vec![event::Type::PlayerDeath]
    );
    assert_eq!(event_types(&result.recording, Tick(5)), vec![]);
    assert_eq!(
        event_types(&result.recording, Tick(22)),
        vec![event::Type::PlayerDeath]
    );
    assert_eq!(
        event_types(&result.recording, Tick(40)),
        vec![event::Type::PlayerDeath]
    );

    assert_eq!(result.quality_flags, vec![]);
    assert_eq!(
        result.counters,
        ReconciliationCounters {
            stream_event_pairs: 1,
            ..Default::default()
        }
    );
}

#[test]
fn flags_large_temporal_gaps_between_paired_stream_events() {
    let stage = Stage::TobVerzik;
    let party = vec![Rsn::try_from("1Ogp").unwrap()];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);
    let crab_death = |tick: Tick| {
        fixtures::npc_death_event(NpcEvent {
            tick,
            stage,
            coords: (10, 10),
            npc_id: npc::id::VERZIK_MATOMENOS_REGULAR,
            room_id: 1,
            ..Default::default()
        })
    };

    let base = build_recording(
        BASE_CLIENT_ID,
        stage,
        &challenge,
        30,
        "1Ogp",
        DataSource::Secondary,
        BTreeMap::from([
            (Tick(1), vec![crab_death(Tick(1))]),
            (
                Tick(2),
                vec![fixtures::player_death_event(
                    Tick(2),
                    stage,
                    (0, 0),
                    "1Ogp",
                    0,
                )],
            ),
        ]),
    );
    let target = build_recording(
        TARGET_CLIENT_ID,
        stage,
        &challenge,
        30,
        "1Ogp",
        DataSource::Primary,
        BTreeMap::from([
            (Tick(7), vec![crab_death(Tick(7))]),
            (
                Tick(25),
                vec![fixtures::player_death_event(
                    Tick(25),
                    stage,
                    (0, 0),
                    "1Ogp",
                    0,
                )],
            ),
        ]),
    );

    let ctx = test_ctx(
        &challenge,
        ClientBuilder::new(BASE_CLIENT_ID.0, base.clone()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, target.clone()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    assert_eq!(
        event_types(&result.recording, Tick(1)),
        vec![event::Type::NpcDeath]
    );
    assert_eq!(
        event_types(&result.recording, Tick(2)),
        vec![event::Type::PlayerDeath]
    );
    assert_eq!(event_types(&result.recording, Tick(7)), vec![]);
    assert_eq!(event_types(&result.recording, Tick(25)), vec![]);

    assert_set_eq(
        result.quality_flags,
        &[
            QualityFlag::LargeTemporalGap {
                kind: event::Type::NpcDeath,
                gap: Ticks(6),
                base_tick: Tick(1),
                target_tick: Tick(7),
            },
            QualityFlag::LargeTemporalGap {
                kind: event::Type::PlayerDeath,
                gap: Ticks(23),
                base_tick: Tick(2),
                target_tick: Tick(25),
            },
        ],
    );
    assert_eq!(
        result.counters,
        ReconciliationCounters {
            stream_event_pairs: 2,
            ..Default::default()
        }
    );
}

#[test]
fn deduplicates_npc_deaths_by_room_id() {
    let stage = Stage::TobVerzik;
    let party = vec![Rsn::try_from("1Ogp").unwrap()];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);
    let crab_death = |room_id: u64| {
        fixtures::npc_death_event(NpcEvent {
            tick: Tick(5),
            stage,
            coords: (10, 10),
            npc_id: npc::id::VERZIK_MATOMENOS_REGULAR,
            room_id,
            ..Default::default()
        })
    };

    let base = build_recording(
        BASE_CLIENT_ID,
        stage,
        &challenge,
        10,
        "1Ogp",
        DataSource::Secondary,
        BTreeMap::from([(Tick(5), vec![crab_death(1), crab_death(2)])]),
    );
    let target = build_recording(
        TARGET_CLIENT_ID,
        stage,
        &challenge,
        10,
        "1Ogp",
        DataSource::Primary,
        BTreeMap::from([(Tick(5), vec![crab_death(1), crab_death(3)])]),
    );

    let ctx = test_ctx(
        &challenge,
        ClientBuilder::new(BASE_CLIENT_ID.0, base.clone()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, target.clone()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    // Room ID 1 died on both sides and is placed once from the base. Deaths for
    // 2 and 3 were only observed by one client each and use their own events.
    let mut deaths: Vec<(RoomId, Source)> = result
        .recording
        .get_state(Tick(5))
        .expect("tick is recorded")
        .events
        .iter()
        .filter_map(|event| match event.kind {
            EventKind::NpcDeath(death) => Some((death.npc, event.source)),
            _ => None,
        })
        .collect();
    deaths.sort_unstable();
    assert_eq!(
        deaths,
        vec![
            (RoomId(1), Source::Client(BASE_CLIENT_ID)),
            (RoomId(2), Source::Client(BASE_CLIENT_ID)),
            (RoomId(3), Source::Client(TARGET_CLIENT_ID)),
        ]
    );

    assert_eq!(result.quality_flags, vec![]);
    assert_eq!(
        result.counters,
        ReconciliationCounters {
            stream_event_pairs: 1,
            ..Default::default()
        }
    );
}

#[test]
fn deduplicates_unique_events_regardless_of_tick_gap() {
    let stage = Stage::TobXarpus;
    let party = vec![Rsn::try_from("1Ogp").unwrap()];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);

    let base = build_recording(
        BASE_CLIENT_ID,
        stage,
        &challenge,
        15,
        "1Ogp",
        DataSource::Secondary,
        BTreeMap::from([(
            Tick(3),
            vec![fixtures::xarpus_phase_event(Tick(3), XarpusPhase::XarpusP2)],
        )]),
    );
    let target = build_recording(
        TARGET_CLIENT_ID,
        stage,
        &challenge,
        15,
        "1Ogp",
        DataSource::Primary,
        BTreeMap::from([(
            Tick(12),
            vec![fixtures::xarpus_phase_event(
                Tick(12),
                XarpusPhase::XarpusP2,
            )],
        )]),
    );

    let ctx = test_ctx(
        &challenge,
        ClientBuilder::new(BASE_CLIENT_ID.0, base.clone()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, target.clone()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    assert_eq!(
        event_types(&result.recording, Tick(3)),
        vec![event::Type::TobXarpusPhase]
    );
    assert_eq!(event_types(&result.recording, Tick(12)), vec![]);

    assert_eq!(result.quality_flags, vec![]);
    assert_eq!(
        result.counters,
        ReconciliationCounters {
            stream_event_pairs: 1,
            ..Default::default()
        }
    );
}

#[test]
fn directly_copies_stream_events_only_recorded_by_one_side() {
    let stage = Stage::TobVerzik;
    let party = vec![Rsn::try_from("1Ogp").unwrap()];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);

    let base = build_recording(
        BASE_CLIENT_ID,
        stage,
        &challenge,
        10,
        "1Ogp",
        DataSource::Secondary,
        BTreeMap::from([(
            Tick(4),
            vec![fixtures::player_death_event(
                Tick(4),
                stage,
                (0, 0),
                "1Ogp",
                0,
            )],
        )]),
    );
    let target = build_recording(
        TARGET_CLIENT_ID,
        stage,
        &challenge,
        10,
        "1Ogp",
        DataSource::Primary,
        BTreeMap::from([(
            Tick(7),
            vec![fixtures::npc_death_event(NpcEvent {
                tick: Tick(7),
                stage,
                coords: (10, 10),
                npc_id: npc::id::VERZIK_MATOMENOS_REGULAR,
                room_id: 1,
                ..Default::default()
            })],
        )]),
    );

    let ctx = test_ctx(
        &challenge,
        ClientBuilder::new(BASE_CLIENT_ID.0, base.clone()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, target.clone()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    let death = result
        .recording
        .get_state(Tick(4))
        .expect("tick is recorded")
        .events
        .iter()
        .filter(|event| matches!(event.kind, EventKind::PlayerDeath(_)))
        .map(|event| event.source)
        .collect::<Vec<_>>();
    assert_eq!(death, vec![Source::Client(BASE_CLIENT_ID)]);

    let crab_death = result
        .recording
        .get_state(Tick(7))
        .expect("tick is recorded")
        .events
        .iter()
        .filter(|event| matches!(event.kind, EventKind::NpcDeath(_)))
        .map(|event| event.source)
        .collect::<Vec<_>>();
    assert_eq!(crab_death, vec![Source::Client(TARGET_CLIENT_ID)]);

    assert_eq!(result.quality_flags, vec![]);
    assert_eq!(result.counters, ReconciliationCounters::default());
}

/// Builds a recording with Verzik P3 on every tick, inserting each of `attacks`
/// on its tick targeting an optional player.
fn build_p3_recording(
    client_id: ClientId,
    challenge: &ChallengeInfo,
    num_ticks: u32,
    player: &str,
    source: DataSource,
    attacks: BTreeMap<Tick, (NpcAttack, Option<&str>)>,
) -> Recording {
    let stage = Stage::TobVerzik;
    let mut extra_events: BTreeMap<Tick, Vec<Event>> = BTreeMap::new();

    for tick in Tick(num_ticks - 1).up_to_inclusive() {
        extra_events
            .entry(tick)
            .or_default()
            .push(fixtures::npc_update_event(NpcEvent {
                tick,
                stage,
                coords: (10, 10),
                npc_id: npc::id::VERZIK_P3_REGULAR,
                room_id: 1,
                hitpoints: SkillLevel {
                    current: 100,
                    base: 3250,
                },
                ..Default::default()
            }));
    }
    for (tick, (attack, target)) in attacks {
        extra_events
            .entry(tick)
            .or_default()
            .push(fixtures::npc_attack_event(
                tick,
                stage,
                (10, 10),
                npc::id::VERZIK_P3_REGULAR,
                1,
                attack,
                target,
            ));
    }

    build_recording(
        client_id,
        stage,
        challenge,
        num_ticks,
        player,
        source,
        extra_events,
    )
}

#[test]
fn places_a_bounce_event_the_tick_after_its_attack() {
    let stage = Stage::TobVerzik;
    let party = vec![Rsn::try_from("WWWWWWWWWWQQ").unwrap()];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);
    let mut base_events: BTreeMap<Tick, Vec<Event>> = Tick(14)
        .up_to_inclusive()
        .map(|tick| {
            let verzik = fixtures::npc_update_event(NpcEvent {
                tick,
                stage,
                coords: (10, 10),
                npc_id: npc::id::VERZIK_P2_REGULAR,
                room_id: 1,
                hitpoints: SkillLevel {
                    current: 100,
                    base: 3250,
                },
                ..Default::default()
            });
            (tick, vec![verzik])
        })
        .collect();
    base_events
        .entry(Tick(5))
        .or_default()
        .push(fixtures::npc_attack_event(
            Tick(5),
            stage,
            (10, 10),
            npc::id::VERZIK_P2_REGULAR,
            1,
            NpcAttack::TobVerzikP2Bounce,
            Some("WWWWWWWWWWQQ"),
        ));
    base_events
        .entry(Tick(7))
        .or_default()
        .push(fixtures::verzik_bounce_event(
            Tick(7),
            Tick(5),
            1,
            0,
            Some("WWWWWWWWWWQQ"),
        ));
    let base = build_recording(
        BASE_CLIENT_ID,
        stage,
        &challenge,
        15,
        "WWWWWWWWWWQQ",
        DataSource::Secondary,
        base_events,
    );
    let target = build_recording(
        TARGET_CLIENT_ID,
        stage,
        &challenge,
        15,
        "WWWWWWWWWWQQ",
        DataSource::Primary,
        BTreeMap::new(),
    );

    let ctx = test_ctx(
        &challenge,
        ClientBuilder::new(BASE_CLIENT_ID.0, base.clone()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, target.clone()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    assert_eq!(event_types(&result.recording, Tick(7)), vec![]);
    let party_index = result.recording.party_index(&party[0]).unwrap();
    assert_eq!(
        result
            .recording
            .get_state(Tick(6))
            .expect("tick is recorded")
            .events,
        vec![blert::Event {
            source: Source::Client(BASE_CLIENT_ID),
            kind: EventKind::VerzikBounce(VerzikBounce {
                attack_tick: Tick(5),
                players_in_range: 1,
                bounced: Some(party_index),
            }),
        }]
    );

    assert_eq!(result.quality_flags, vec![]);
    assert_eq!(
        result.counters,
        ReconciliationCounters {
            attack_mapped_events: 1,
            ..Default::default()
        }
    );
}

#[test]
fn deduplicates_bounce_events_across_clients() {
    let stage = Stage::TobVerzik;
    let party = vec![Rsn::try_from("WWWWWWWWWWQQ").unwrap()];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);
    let bounce_events = || -> BTreeMap<Tick, Vec<Event>> {
        let mut events: BTreeMap<Tick, Vec<Event>> = Tick(14)
            .up_to_inclusive()
            .map(|tick| {
                let verzik = fixtures::npc_update_event(NpcEvent {
                    tick,
                    stage,
                    coords: (10, 10),
                    npc_id: npc::id::VERZIK_P2_REGULAR,
                    room_id: 1,
                    hitpoints: SkillLevel {
                        current: 100,
                        base: 3250,
                    },
                    ..Default::default()
                });
                (tick, vec![verzik])
            })
            .collect();
        events
            .entry(Tick(5))
            .or_default()
            .push(fixtures::npc_attack_event(
                Tick(5),
                stage,
                (10, 10),
                npc::id::VERZIK_P2_REGULAR,
                1,
                NpcAttack::TobVerzikP2Bounce,
                Some("WWWWWWWWWWQQ"),
            ));
        events
            .entry(Tick(6))
            .or_default()
            .push(fixtures::verzik_bounce_event(
                Tick(6),
                Tick(5),
                1,
                0,
                Some("WWWWWWWWWWQQ"),
            ));
        events
    };
    let base = build_recording(
        BASE_CLIENT_ID,
        stage,
        &challenge,
        15,
        "WWWWWWWWWWQQ",
        DataSource::Secondary,
        bounce_events(),
    );
    let target = build_recording(
        TARGET_CLIENT_ID,
        stage,
        &challenge,
        15,
        "WWWWWWWWWWQQ",
        DataSource::Primary,
        bounce_events(),
    );

    let ctx = test_ctx(
        &challenge,
        ClientBuilder::new(BASE_CLIENT_ID.0, base.clone()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, target.clone()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    let party_index = result.recording.party_index(&party[0]).unwrap();
    assert_eq!(
        result
            .recording
            .get_state(Tick(6))
            .expect("tick is recorded")
            .events,
        vec![blert::Event {
            source: Source::Client(BASE_CLIENT_ID),
            kind: EventKind::VerzikBounce(VerzikBounce {
                attack_tick: Tick(5),
                players_in_range: 1,
                bounced: Some(party_index),
            }),
        }]
    );

    assert_eq!(result.quality_flags, vec![]);
    assert_eq!(
        result.counters,
        ReconciliationCounters {
            npc_attack_pairs: 1,
            attack_mapped_events: 2,
            ..Default::default()
        }
    );
}

#[test]
fn keeps_the_base_bounce_event_in_a_conflict_and_flags() {
    let stage = Stage::TobVerzik;
    let party = vec![Rsn::try_from("1Ogp").unwrap()];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);
    let bounce_events = |bounced: Option<&str>| -> BTreeMap<Tick, Vec<Event>> {
        let mut events: BTreeMap<Tick, Vec<Event>> = Tick(14)
            .up_to_inclusive()
            .map(|tick| {
                let verzik = fixtures::npc_update_event(NpcEvent {
                    tick,
                    stage,
                    coords: (10, 10),
                    npc_id: npc::id::VERZIK_P2_REGULAR,
                    room_id: 1,
                    hitpoints: SkillLevel {
                        current: 100,
                        base: 3250,
                    },
                    ..Default::default()
                });
                (tick, vec![verzik])
            })
            .collect();
        events
            .entry(Tick(5))
            .or_default()
            .push(fixtures::npc_attack_event(
                Tick(5),
                stage,
                (10, 10),
                npc::id::VERZIK_P2_REGULAR,
                1,
                NpcAttack::TobVerzikP2Bounce,
                bounced,
            ));
        events
            .entry(Tick(6))
            .or_default()
            .push(fixtures::verzik_bounce_event(
                Tick(6),
                Tick(5),
                1,
                0,
                bounced,
            ));
        events
    };
    let base = build_recording(
        BASE_CLIENT_ID,
        stage,
        &challenge,
        15,
        "1Ogp",
        DataSource::Secondary,
        bounce_events(None),
    );
    let target = build_recording(
        TARGET_CLIENT_ID,
        stage,
        &challenge,
        15,
        "1Ogp",
        DataSource::Primary,
        bounce_events(Some("1Ogp")),
    );

    let ctx = test_ctx(
        &challenge,
        ClientBuilder::new(BASE_CLIENT_ID.0, base.clone()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, target.clone()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    assert_eq!(
        result
            .recording
            .get_state(Tick(6))
            .expect("tick is recorded")
            .events,
        vec![blert::Event {
            source: Source::Client(BASE_CLIENT_ID),
            kind: EventKind::VerzikBounce(VerzikBounce {
                attack_tick: Tick(5),
                players_in_range: 1,
                bounced: None,
            }),
        }]
    );

    assert_eq!(
        result.quality_flags,
        vec![QualityFlag::Disagreement {
            tick: Tick(5),
            kept_source: Source::Client(BASE_CLIENT_ID),
            discarded_source: Source::Client(TARGET_CLIENT_ID),
            subject: Disagreement::AttackMapped {
                kind: event::Type::TobVerzikBounce,
            },
        }]
    );
    assert_eq!(
        result.counters,
        ReconciliationCounters {
            npc_attack_pairs: 1,
            attack_mapped_events: 2,
            ..Default::default()
        }
    );
}

#[test]
fn discards_bounce_events_whose_attack_does_not_exist() {
    let stage = Stage::TobVerzik;
    let party = vec![Rsn::try_from("WWWWWWWWWWQQ").unwrap()];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);
    let verzik_events = |attack: NpcAttack| -> BTreeMap<Tick, Vec<Event>> {
        let mut events: BTreeMap<Tick, Vec<Event>> = Tick(14)
            .up_to_inclusive()
            .map(|tick| {
                let verzik = fixtures::npc_update_event(NpcEvent {
                    tick,
                    stage,
                    coords: (10, 10),
                    npc_id: npc::id::VERZIK_P2_REGULAR,
                    room_id: 1,
                    hitpoints: SkillLevel {
                        current: 100,
                        base: 3250,
                    },
                    ..Default::default()
                });
                (tick, vec![verzik])
            })
            .collect();
        events
            .entry(Tick(5))
            .or_default()
            .push(fixtures::npc_attack_event(
                Tick(5),
                stage,
                (10, 10),
                npc::id::VERZIK_P2_REGULAR,
                1,
                attack,
                Some("WWWWWWWWWWQQ"),
            ));
        events
    };
    let mut target_events = verzik_events(NpcAttack::TobVerzikP2Bounce);
    target_events
        .entry(Tick(6))
        .or_default()
        .push(fixtures::verzik_bounce_event(
            Tick(6),
            Tick(5),
            1,
            0,
            Some("WWWWWWWWWWQQ"),
        ));
    let base = build_recording(
        BASE_CLIENT_ID,
        stage,
        &challenge,
        15,
        "WWWWWWWWWWQQ",
        DataSource::Secondary,
        verzik_events(NpcAttack::TobVerzikP2Mage),
    );
    let target = build_recording(
        TARGET_CLIENT_ID,
        stage,
        &challenge,
        15,
        "WWWWWWWWWWQQ",
        DataSource::Primary,
        target_events,
    );

    let ctx = test_ctx(
        &challenge,
        ClientBuilder::new(BASE_CLIENT_ID.0, base.clone()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, target.clone()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    assert_eq!(event_types(&result.recording, Tick(6)), vec![]);

    assert_set_eq(
        result.quality_flags,
        &[
            QualityFlag::Disagreement {
                tick: Tick(5),
                kept_source: Source::Client(BASE_CLIENT_ID),
                discarded_source: Source::Client(TARGET_CLIENT_ID),
                subject: Disagreement::NpcAttackKind {
                    room_id: RoomId(1),
                    npc_id: npc::id::VERZIK_P2_REGULAR,
                    kept: NpcAttack::TobVerzikP2Mage,
                    discarded: NpcAttack::TobVerzikP2Bounce,
                },
            },
            QualityFlag::AttackMappedNotFound {
                kind: event::Type::TobVerzikBounce,
                side: Side::Target,
                client_tick: Tick(6),
                client_attack_tick: Tick(5),
            },
        ],
    );
    assert_eq!(
        result.counters,
        ReconciliationCounters {
            npc_attack_pairs: 1,
            attack_mapped_events: 1,
            ..Default::default()
        }
    );
}

#[test]
fn matches_a_bounce_event_to_a_p2_attack_depending_on_target() {
    let stage = Stage::TobVerzik;

    let p2_tick = |attack: Option<NpcAttack>| -> TickState {
        let mut events = vec![fixtures::npc_update_event(NpcEvent {
            tick: Tick(0),
            stage,
            coords: (10, 10),
            npc_id: npc::id::VERZIK_P2_REGULAR,
            room_id: 1,
            hitpoints: SkillLevel {
                current: 100,
                base: 3250,
            },
            ..Default::default()
        })];
        if let Some(attack) = attack {
            events.push(fixtures::npc_attack_event(
                Tick(0),
                stage,
                (10, 10),
                npc::id::VERZIK_P2_REGULAR,
                1,
                attack,
                None,
            ));
        }
        fixtures::timeline(stage, ChallengeMode::TobRegular, &[], Tick(0), events)
            .get_state(Tick(0))
            .cloned()
            .expect("tick is recorded")
    };
    let mage = p2_tick(Some(NpcAttack::TobVerzikP2Mage));
    let bounce = p2_tick(Some(NpcAttack::TobVerzikP2Bounce));
    let idle = p2_tick(None);
    let party = vec![Rsn::try_from("1Ogp").unwrap()];
    let timeline = fixtures::timeline(
        stage,
        ChallengeMode::TobRegular,
        &party,
        Tick(0),
        vec![PlayerUpdateEvent::new(Tick(0), stage, "1Ogp", (0, 0)).build()],
    );
    let without_verzik = timeline
        .get_state(Tick(0))
        .cloned()
        .expect("tick is recorded");
    let party_index = timeline.party_index(&party[0]).unwrap();
    let untargeted = EventKind::VerzikBounce(VerzikBounce {
        attack_tick: Tick(0),
        players_in_range: 1,
        bounced: None,
    });
    let targeted = EventKind::VerzikBounce(VerzikBounce {
        attack_tick: Tick(0),
        players_in_range: 1,
        bounced: Some(party_index),
    });

    assert!(attack_present(&mage, &untargeted));
    assert!(attack_present(&bounce, &untargeted));
    assert!(attack_present(&bounce, &targeted));
    assert!(!attack_present(&mage, &targeted));
    assert!(!attack_present(&idle, &untargeted));
    assert!(!attack_present(&idle, &targeted));
    assert!(!attack_present(&without_verzik, &untargeted));
}

#[test]
fn resolves_projectile_ambiguous_player_attacks_by_primary_proximity_to_attacker() {
    // 715 ZCBs on tick 5. 1Ogp (base primary, far from 715) sees an auto.
    // WWWWWWWWWWQQ (target primary, close to 715) sees a spec.
    let stage = Stage::TobVerzik;
    let party = vec![
        Rsn::try_from("1Ogp").unwrap(),
        Rsn::try_from("WWWWWWWWWWQQ").unwrap(),
        Rsn::try_from("715").unwrap(),
    ];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);

    let recording =
        |client_id: ClientId, primary_player: &str, attack: PlayerAttack| -> Recording {
            let source = |player: &str| {
                if player == primary_player {
                    DataSource::Primary
                } else {
                    DataSource::Secondary
                }
            };
            let mut events = Vec::new();
            for tick in Tick(9).up_to_inclusive() {
                events.push(
                    PlayerUpdateEvent::new(tick, stage, "1Ogp", (0, 0))
                        .source(source("1Ogp"))
                        .build(),
                );
                events.push(
                    PlayerUpdateEvent::new(tick, stage, "WWWWWWWWWWQQ", (10, 10))
                        .party_index(1)
                        .source(source("WWWWWWWWWWQQ"))
                        .build(),
                );
                events.push(
                    PlayerUpdateEvent::new(tick, stage, "715", (9, 10))
                        .party_index(2)
                        .build(),
                );
                if tick == Tick(5) {
                    events.push(fixtures::player_attack_event(PlayerAttackEvent {
                        tick,
                        stage,
                        coords: (9, 10),
                        name: "715",
                        party_index: Some(2),
                        attack,
                        weapon_id: 26374,
                        distance_to_target: 1,
                        target: Some(event::Npc {
                            id: npc::id::VERZIK_P1_REGULAR,
                            room_id: 1,
                            ..Default::default()
                        }),
                    }));
                }
            }
            fixtures::recording(client_id, stage, challenge.mode, &party, Tick(9), events)
        };
    let base = recording(BASE_CLIENT_ID, "1Ogp", PlayerAttack::ZcbAuto);
    let target = recording(TARGET_CLIENT_ID, "WWWWWWWWWWQQ", PlayerAttack::ZcbSpec);

    let ctx = test_ctx(
        &challenge,
        ClientBuilder::new(BASE_CLIENT_ID.0, base.clone()).primary_player("1Ogp"),
        ClientBuilder::new(TARGET_CLIENT_ID.0, target.clone()).primary_player("WWWWWWWWWWQQ"),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    let player = result.recording.party_index(&party[2]).unwrap();
    let attacks: Vec<(Source, PlayerAttack)> = result
        .recording
        .get_state(Tick(5))
        .expect("tick is recorded")
        .events
        .iter()
        .filter_map(|event| match &event.kind {
            EventKind::PlayerAttack(attacked) if attacked.player == player => {
                Some((event.source, attacked.attack))
            }
            _ => None,
        })
        .collect();
    assert_eq!(
        attacks,
        vec![(Source::Client(TARGET_CLIENT_ID), PlayerAttack::ZcbSpec)]
    );

    assert_eq!(result.quality_flags, vec![]);
    assert_eq!(
        result.counters,
        ReconciliationCounters {
            player_attack_pairs: 1,
            ..Default::default()
        }
    );
}

fn single_tick_with_attack(
    client_id: ClientId,
    stage: Stage,
    challenge: &ChallengeInfo,
    attack: Option<PlayerAttack>,
    target: Option<event::Npc>,
) -> Recording {
    let mut events = vec![PlayerUpdateEvent::new(Tick(0), stage, "WWWWWWWWWWQQ", (0, 0)).build()];
    if let Some(attack) = attack {
        events.push(fixtures::player_attack_event(PlayerAttackEvent {
            tick: Tick(0),
            stage,
            coords: (0, 0),
            name: "WWWWWWWWWWQQ",
            party_index: None,
            attack,
            weapon_id: 0,
            distance_to_target: 1,
            target,
        }));
    }
    fixtures::recording(
        client_id,
        stage,
        challenge.mode,
        challenge.party,
        Tick(0),
        events,
    )
}

#[test]
fn deduplicates_agreeing_player_attacks() {
    let stage = Stage::TobMaiden;
    let party = vec![Rsn::try_from("WWWWWWWWWWQQ").unwrap()];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);
    let maiden = event::Npc {
        id: npc::id::MAIDEN_REGULAR,
        room_id: 1,
        ..Default::default()
    };
    let base = single_tick_with_attack(
        BASE_CLIENT_ID,
        stage,
        &challenge,
        Some(PlayerAttack::Scythe),
        Some(maiden),
    );
    let target = single_tick_with_attack(
        TARGET_CLIENT_ID,
        stage,
        &challenge,
        Some(PlayerAttack::Scythe),
        Some(maiden),
    );

    let ctx = test_ctx(
        &challenge,
        ClientBuilder::new(BASE_CLIENT_ID.0, base.clone()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, target.clone()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    let player = result.recording.party_index(&party[0]).unwrap();
    assert_eq!(
        result
            .recording
            .get_state(Tick(0))
            .expect("tick is recorded")
            .events,
        vec![blert::Event {
            source: Source::Client(BASE_CLIENT_ID),
            kind: EventKind::PlayerAttack(PlayerAttacked {
                player,
                attack: PlayerAttack::Scythe,
                weapon: None,
                target: Some(Actor::Npc(RoomId(1))),
            }),
        }]
    );

    assert_eq!(result.quality_flags, vec![]);
    assert_eq!(
        result.counters,
        ReconciliationCounters {
            player_attack_pairs: 1,
            ..Default::default()
        }
    );
}

#[test]
fn inserts_a_player_attack_only_the_target_recorded() {
    let stage = Stage::TobMaiden;
    let party = vec![Rsn::try_from("WWWWWWWWWWQQ").unwrap()];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);
    let maiden = event::Npc {
        id: npc::id::MAIDEN_REGULAR,
        room_id: 1,
        ..Default::default()
    };
    let base = single_tick_with_attack(BASE_CLIENT_ID, stage, &challenge, None, None);
    let target = single_tick_with_attack(
        TARGET_CLIENT_ID,
        stage,
        &challenge,
        Some(PlayerAttack::Scythe),
        Some(maiden),
    );

    let ctx = test_ctx(
        &challenge,
        ClientBuilder::new(BASE_CLIENT_ID.0, base.clone()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, target.clone()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    let player = result.recording.party_index(&party[0]).unwrap();
    assert_eq!(
        result
            .recording
            .get_state(Tick(0))
            .expect("tick is recorded")
            .events,
        vec![blert::Event {
            source: Source::Client(TARGET_CLIENT_ID),
            kind: EventKind::PlayerAttack(PlayerAttacked {
                player,
                attack: PlayerAttack::Scythe,
                weapon: None,
                target: Some(Actor::Npc(RoomId(1))),
            }),
        }]
    );

    assert_eq!(result.quality_flags, vec![]);
    assert_eq!(result.counters, ReconciliationCounters::default());
}

#[test]
fn fills_a_missing_player_attack_target_from_the_other_client() {
    // Tick 0: only the target saw who was attacked. Tick 1: only the base did.
    let stage = Stage::TobMaiden;
    let party = vec![Rsn::try_from("WWWWWWWWWWQQ").unwrap()];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);
    let maiden = event::Npc {
        id: npc::id::MAIDEN_REGULAR,
        room_id: 1,
        ..Default::default()
    };
    let recording = |client_id: ClientId, targets: [Option<event::Npc>; 2]| -> Recording {
        let events = targets
            .into_iter()
            .enumerate()
            .flat_map(|(i, target)| {
                let tick = Tick::from_usize(i);
                [
                    PlayerUpdateEvent::new(tick, stage, "WWWWWWWWWWQQ", (0, 0)).build(),
                    fixtures::player_attack_event(PlayerAttackEvent {
                        tick,
                        stage,
                        coords: (0, 0),
                        name: "WWWWWWWWWWQQ",
                        party_index: None,
                        attack: PlayerAttack::Scythe,
                        weapon_id: 0,
                        distance_to_target: 1,
                        target,
                    }),
                ]
            })
            .collect();
        fixtures::recording(client_id, stage, challenge.mode, &party, Tick(1), events)
    };
    let base = recording(BASE_CLIENT_ID, [None, Some(maiden)]);
    let target = recording(TARGET_CLIENT_ID, [Some(maiden), None]);

    let ctx = test_ctx(
        &challenge,
        ClientBuilder::new(BASE_CLIENT_ID.0, base.clone()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, target.clone()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    let player = result.recording.party_index(&party[0]).unwrap();
    for tick in [Tick(0), Tick(1)] {
        assert_eq!(
            result
                .recording
                .get_state(tick)
                .expect("tick is recorded")
                .events,
            vec![blert::Event {
                source: Source::Client(BASE_CLIENT_ID),
                kind: EventKind::PlayerAttack(PlayerAttacked {
                    player,
                    attack: PlayerAttack::Scythe,
                    weapon: None,
                    target: Some(Actor::Npc(RoomId(1))),
                }),
            }],
            "tick {tick}"
        );
    }

    assert_eq!(result.quality_flags, vec![]);
    assert_eq!(
        result.counters,
        ReconciliationCounters {
            player_attack_pairs: 2,
            ..Default::default()
        }
    );
}

#[test]
fn keeps_the_base_player_attack_in_a_conflict_and_flags() {
    // Tick 0: the clients disagree on who was attacked.
    // Tick 1: they disagree on the attack.
    let stage = Stage::TobMaiden;
    let party = vec![Rsn::try_from("WWWWWWWWWWQQ").unwrap()];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);
    let maiden = event::Npc {
        id: npc::id::MAIDEN_REGULAR,
        room_id: 1,
        ..Default::default()
    };
    let crab = event::Npc {
        id: npc::id::MAIDEN_MATOMENOS_REGULAR,
        room_id: 2,
        ..Default::default()
    };
    let recording = |client_id: ClientId, attacks: [(PlayerAttack, event::Npc); 2]| -> Recording {
        let events = attacks
            .into_iter()
            .enumerate()
            .flat_map(|(i, (attack, target))| {
                let tick = Tick::from_usize(i);
                [
                    PlayerUpdateEvent::new(tick, stage, "WWWWWWWWWWQQ", (0, 0)).build(),
                    fixtures::player_attack_event(PlayerAttackEvent {
                        tick,
                        stage,
                        coords: (0, 0),
                        name: "WWWWWWWWWWQQ",
                        party_index: None,
                        attack,
                        weapon_id: 0,
                        distance_to_target: 1,
                        target: Some(target),
                    }),
                ]
            })
            .collect();
        fixtures::recording(client_id, stage, challenge.mode, &party, Tick(1), events)
    };
    let base = recording(
        BASE_CLIENT_ID,
        [
            (PlayerAttack::Scythe, maiden),
            (PlayerAttack::Scythe, maiden),
        ],
    );
    let target = recording(
        TARGET_CLIENT_ID,
        [(PlayerAttack::Scythe, crab), (PlayerAttack::Punch, maiden)],
    );

    let ctx = test_ctx(
        &challenge,
        ClientBuilder::new(BASE_CLIENT_ID.0, base.clone()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, target.clone()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    let player = result.recording.party_index(&party[0]).unwrap();
    for tick in [Tick(0), Tick(1)] {
        assert_eq!(
            result
                .recording
                .get_state(tick)
                .expect("tick is recorded")
                .events,
            vec![blert::Event {
                source: Source::Client(BASE_CLIENT_ID),
                kind: EventKind::PlayerAttack(PlayerAttacked {
                    player,
                    attack: PlayerAttack::Scythe,
                    weapon: None,
                    target: Some(Actor::Npc(RoomId(1))),
                }),
            }],
            "tick {tick}"
        );
    }

    assert_set_eq(
        result.quality_flags,
        &[
            QualityFlag::Disagreement {
                tick: Tick(0),
                kept_source: Source::Client(BASE_CLIENT_ID),
                discarded_source: Source::Client(TARGET_CLIENT_ID),
                subject: Disagreement::PlayerAttackTarget {
                    player,
                    kept: Actor::Npc(RoomId(1)),
                    discarded: Actor::Npc(RoomId(2)),
                },
            },
            QualityFlag::Disagreement {
                tick: Tick(1),
                kept_source: Source::Client(BASE_CLIENT_ID),
                discarded_source: Source::Client(TARGET_CLIENT_ID),
                subject: Disagreement::PlayerAttackKind {
                    player,
                    kept: PlayerAttack::Scythe,
                    discarded: PlayerAttack::Punch,
                },
            },
        ],
    );
    assert_eq!(
        result.counters,
        ReconciliationCounters {
            player_attack_pairs: 2,
            ..Default::default()
        }
    );
}

#[test]
fn deduplicates_agreeing_player_spells_and_fills_a_missing_target() {
    let stage = Stage::TobMaiden;
    let party = vec![
        Rsn::try_from("1Ogp").unwrap(),
        Rsn::try_from("WWWWWWWWWWQQ").unwrap(),
    ];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);
    let heal_target = event::spell::Target::TargetPlayer("WWWWWWWWWWQQ".to_string());
    let recording =
        |client_id: ClientId, targets: [Option<event::spell::Target>; 2]| -> Recording {
            let events = targets
                .into_iter()
                .enumerate()
                .flat_map(|(i, target)| {
                    let tick = Tick::from_usize(i);
                    [
                        PlayerUpdateEvent::new(tick, stage, "1Ogp", (0, 0)).build(),
                        fixtures::player_spell_event(
                            tick,
                            stage,
                            (0, 0),
                            "1Ogp",
                            PlayerSpell::HealOther,
                            target,
                        ),
                    ]
                })
                .collect();
            fixtures::recording(client_id, stage, challenge.mode, &party, Tick(1), events)
        };
    let base = recording(BASE_CLIENT_ID, [Some(heal_target.clone()), None]);
    let target = recording(
        TARGET_CLIENT_ID,
        [Some(heal_target.clone()), Some(heal_target)],
    );

    let ctx = test_ctx(
        &challenge,
        ClientBuilder::new(BASE_CLIENT_ID.0, base.clone()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, target.clone()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    let player = result.recording.party_index(&party[0]).unwrap();
    for tick in [Tick(0), Tick(1)] {
        assert_eq!(
            result
                .recording
                .get_state(tick)
                .expect("tick is recorded")
                .events,
            vec![blert::Event {
                source: Source::Client(BASE_CLIENT_ID),
                kind: EventKind::PlayerSpell(PlayerCast {
                    player,
                    spell: PlayerSpell::HealOther,
                    target: Some(Actor::Player(
                        result.recording.party_index(&party[1]).unwrap(),
                    )),
                }),
            }],
            "tick {tick}"
        );
    }

    assert_eq!(result.quality_flags, vec![]);
    assert_eq!(
        result.counters,
        ReconciliationCounters {
            player_spell_pairs: 2,
            ..Default::default()
        }
    );
}

#[test]
fn clears_targets_from_untargeted_spells() {
    // Tick 0: neither side recorded a target.
    // Tick 1: the base recorded one.
    // Tick 2: the target did.
    let stage = Stage::TobMaiden;
    let party = vec![
        Rsn::try_from("1Ogp").unwrap(),
        Rsn::try_from("WWWWWWWWWWQQ").unwrap(),
    ];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);
    let spurious = event::spell::Target::TargetPlayer("WWWWWWWWWWQQ".to_string());
    let recording =
        |client_id: ClientId, targets: [Option<event::spell::Target>; 3]| -> Recording {
            let events = targets
                .into_iter()
                .enumerate()
                .flat_map(|(i, target)| {
                    let tick = Tick::from_usize(i);
                    [
                        PlayerUpdateEvent::new(tick, stage, "1Ogp", (0, 0)).build(),
                        fixtures::player_spell_event(
                            tick,
                            stage,
                            (0, 0),
                            "1Ogp",
                            PlayerSpell::SpellbookSwap,
                            target,
                        ),
                    ]
                })
                .collect();
            fixtures::recording(client_id, stage, challenge.mode, &party, Tick(2), events)
        };
    let base = recording(BASE_CLIENT_ID, [None, Some(spurious.clone()), None]);
    let target = recording(TARGET_CLIENT_ID, [None, None, Some(spurious)]);

    let ctx = test_ctx(
        &challenge,
        ClientBuilder::new(BASE_CLIENT_ID.0, base.clone()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, target.clone()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    let player = result.recording.party_index(&party[0]).unwrap();
    for tick in Tick(2).up_to_inclusive() {
        assert_eq!(
            result
                .recording
                .get_state(tick)
                .expect("tick is recorded")
                .events,
            vec![blert::Event {
                source: Source::Client(BASE_CLIENT_ID),
                kind: EventKind::PlayerSpell(PlayerCast {
                    player,
                    spell: PlayerSpell::SpellbookSwap,
                    target: None,
                }),
            }],
            "tick {tick}"
        );
    }

    assert_eq!(result.quality_flags, vec![]);
    assert_eq!(
        result.counters,
        ReconciliationCounters {
            player_spell_pairs: 3,
            ..Default::default()
        }
    );
}

#[test]
fn keeps_the_base_player_spell_in_a_conflict_and_flags() {
    // Tick 0: the clients disagree on the target..
    // Tick 1: they disagree on the spell.
    let stage = Stage::TobMaiden;
    let party = vec![
        Rsn::try_from("1Ogp").unwrap(),
        Rsn::try_from("WWWWWWWWWWQQ").unwrap(),
        Rsn::try_from("715").unwrap(),
    ];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);
    let recording = |client_id: ClientId, spells: [(PlayerSpell, &str); 2]| -> Recording {
        let events = spells
            .into_iter()
            .enumerate()
            .flat_map(|(i, (spell, target))| {
                let tick = Tick::from_usize(i);
                [
                    PlayerUpdateEvent::new(tick, stage, "1Ogp", (0, 0)).build(),
                    fixtures::player_spell_event(
                        tick,
                        stage,
                        (0, 0),
                        "1Ogp",
                        spell,
                        Some(event::spell::Target::TargetPlayer(target.to_string())),
                    ),
                ]
            })
            .collect();
        fixtures::recording(client_id, stage, challenge.mode, &party, Tick(1), events)
    };
    let base = recording(
        BASE_CLIENT_ID,
        [
            (PlayerSpell::HealOther, "WWWWWWWWWWQQ"),
            (PlayerSpell::HealOther, "WWWWWWWWWWQQ"),
        ],
    );
    let target = recording(
        TARGET_CLIENT_ID,
        [
            (PlayerSpell::HealOther, "715"),
            (PlayerSpell::VengeanceOther, "WWWWWWWWWWQQ"),
        ],
    );

    let ctx = test_ctx(
        &challenge,
        ClientBuilder::new(BASE_CLIENT_ID.0, base.clone()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, target.clone()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    let player = result.recording.party_index(&party[0]).unwrap();
    for tick in [Tick(0), Tick(1)] {
        assert_eq!(
            result
                .recording
                .get_state(tick)
                .expect("tick is recorded")
                .events,
            vec![blert::Event {
                source: Source::Client(BASE_CLIENT_ID),
                kind: EventKind::PlayerSpell(PlayerCast {
                    player,
                    spell: PlayerSpell::HealOther,
                    target: Some(Actor::Player(
                        result.recording.party_index(&party[1]).unwrap(),
                    )),
                }),
            }],
            "tick {tick}"
        );
    }

    assert_set_eq(
        result.quality_flags,
        &[
            QualityFlag::Disagreement {
                tick: Tick(0),
                kept_source: Source::Client(BASE_CLIENT_ID),
                discarded_source: Source::Client(TARGET_CLIENT_ID),
                subject: Disagreement::PlayerSpellTarget {
                    player,
                    kept: Actor::Player(result.recording.party_index(&party[1]).unwrap()),
                    discarded: Actor::Player(result.recording.party_index(&party[2]).unwrap()),
                },
            },
            QualityFlag::Disagreement {
                tick: Tick(1),
                kept_source: Source::Client(BASE_CLIENT_ID),
                discarded_source: Source::Client(TARGET_CLIENT_ID),
                subject: Disagreement::PlayerSpellKind {
                    player,
                    kept: PlayerSpell::HealOther,
                    discarded: PlayerSpell::VengeanceOther,
                },
            },
        ],
    );
    assert_eq!(
        result.counters,
        ReconciliationCounters {
            player_spell_pairs: 2,
            ..Default::default()
        }
    );
}

#[test]
fn inserts_a_player_spell_only_the_target_recorded() {
    let stage = Stage::TobMaiden;
    let party = vec![
        Rsn::try_from("1Ogp").unwrap(),
        Rsn::try_from("WWWWWWWWWWQQ").unwrap(),
    ];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);
    let recording = |client_id: ClientId, spell: Option<PlayerSpell>| -> Recording {
        let mut events = vec![PlayerUpdateEvent::new(Tick(0), stage, "1Ogp", (0, 0)).build()];
        if let Some(spell) = spell {
            events.push(fixtures::player_spell_event(
                Tick(0),
                stage,
                (0, 0),
                "1Ogp",
                spell,
                Some(event::spell::Target::TargetPlayer(
                    "WWWWWWWWWWQQ".to_string(),
                )),
            ));
        }
        fixtures::recording(client_id, stage, challenge.mode, &party, Tick(0), events)
    };
    let base = recording(BASE_CLIENT_ID, None);
    let target = recording(TARGET_CLIENT_ID, Some(PlayerSpell::HealOther));

    let ctx = test_ctx(
        &challenge,
        ClientBuilder::new(BASE_CLIENT_ID.0, base.clone()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, target.clone()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    assert_eq!(
        result
            .recording
            .get_state(Tick(0))
            .expect("tick is recorded")
            .events,
        vec![blert::Event {
            source: Source::Client(TARGET_CLIENT_ID),
            kind: EventKind::PlayerSpell(PlayerCast {
                player: result.recording.party_index(&party[0]).unwrap(),
                spell: PlayerSpell::HealOther,
                target: Some(Actor::Player(
                    result.recording.party_index(&party[1]).unwrap(),
                )),
            }),
        }]
    );

    assert_eq!(result.quality_flags, vec![]);
    assert_eq!(result.counters, ReconciliationCounters::default());
}

#[test]
fn deduplicates_agreeing_npc_attacks_and_fills_a_missing_target() {
    // Tick 0: both clients saw Verzik attack 1Ogp.
    // Tick 1: only the target saw who was attacked.
    let stage = Stage::TobVerzik;
    let party = vec![Rsn::try_from("1Ogp").unwrap()];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);
    let base = build_p3_recording(
        BASE_CLIENT_ID,
        &challenge,
        2,
        "1Ogp",
        DataSource::Secondary,
        BTreeMap::from([
            (Tick(0), (NpcAttack::TobVerzikP3Auto, Some("1Ogp"))),
            (Tick(1), (NpcAttack::TobVerzikP3Auto, None)),
        ]),
    );
    let target = build_p3_recording(
        TARGET_CLIENT_ID,
        &challenge,
        2,
        "1Ogp",
        DataSource::Primary,
        BTreeMap::from([
            (Tick(0), (NpcAttack::TobVerzikP3Auto, Some("1Ogp"))),
            (Tick(1), (NpcAttack::TobVerzikP3Auto, Some("1Ogp"))),
        ]),
    );

    let ctx = test_ctx(
        &challenge,
        ClientBuilder::new(BASE_CLIENT_ID.0, base.clone()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, target.clone()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    let player = result.recording.party_index(&party[0]).unwrap();
    for tick in [Tick(0), Tick(1)] {
        assert_eq!(
            result
                .recording
                .get_state(tick)
                .expect("tick is recorded")
                .events,
            vec![blert::Event {
                source: Source::Client(BASE_CLIENT_ID),
                kind: EventKind::NpcAttack(NpcAttacked {
                    npc: RoomId(1),
                    attack: NpcAttack::TobVerzikP3Auto,
                    target: Some(Actor::Player(player)),
                }),
            }],
            "tick {tick}"
        );
    }

    assert_eq!(result.quality_flags, vec![]);
    assert_eq!(
        result.counters,
        ReconciliationCounters {
            npc_attack_pairs: 2,
            ..Default::default()
        }
    );
}

#[test]
fn inserts_an_npc_attack_only_the_target_recorded() {
    let stage = Stage::TobVerzik;
    let party = vec![Rsn::try_from("1Ogp").unwrap()];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);
    let base = build_p3_recording(
        BASE_CLIENT_ID,
        &challenge,
        1,
        "1Ogp",
        DataSource::Secondary,
        BTreeMap::new(),
    );
    let target = build_p3_recording(
        TARGET_CLIENT_ID,
        &challenge,
        1,
        "1Ogp",
        DataSource::Primary,
        BTreeMap::from([(Tick(0), (NpcAttack::TobVerzikP3Auto, Some("1Ogp")))]),
    );

    let ctx = test_ctx(
        &challenge,
        ClientBuilder::new(BASE_CLIENT_ID.0, base.clone()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, target.clone()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    let player = result.recording.party_index(&party[0]).unwrap();
    assert_eq!(
        result
            .recording
            .get_state(Tick(0))
            .expect("tick is recorded")
            .events,
        vec![blert::Event {
            source: Source::Client(TARGET_CLIENT_ID),
            kind: EventKind::NpcAttack(NpcAttacked {
                npc: RoomId(1),
                attack: NpcAttack::TobVerzikP3Auto,
                target: Some(Actor::Player(player)),
            }),
        }]
    );

    assert_eq!(result.quality_flags, vec![]);
    assert_eq!(result.counters, ReconciliationCounters::default());
}

#[test]
fn keeps_the_base_npc_attack_in_a_conflict_and_flags() {
    // Tick 0: the clients disagree on the target.
    // Tick 1: they disagree on the attack.
    let stage = Stage::TobVerzik;
    let party = vec![
        Rsn::try_from("1Ogp").unwrap(),
        Rsn::try_from("WWWWWWWWWWQQ").unwrap(),
    ];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);
    let recording = |client_id: ClientId, attacks: [(NpcAttack, Option<&str>); 3]| -> Recording {
        let events = attacks
            .into_iter()
            .enumerate()
            .flat_map(|(i, (attack, target))| {
                let tick = Tick::from_usize(i);
                [
                    PlayerUpdateEvent::new(tick, stage, "1Ogp", (0, 0)).build(),
                    PlayerUpdateEvent::new(tick, stage, "WWWWWWWWWWQQ", (5, 5))
                        .party_index(1)
                        .build(),
                    fixtures::npc_update_event(NpcEvent {
                        tick,
                        stage,
                        coords: (10, 10),
                        npc_id: npc::id::VERZIK_P3_REGULAR,
                        room_id: 1,
                        hitpoints: SkillLevel {
                            current: 100,
                            base: 3250,
                        },
                        ..Default::default()
                    }),
                    fixtures::npc_attack_event(
                        tick,
                        stage,
                        (10, 10),
                        npc::id::VERZIK_P3_REGULAR,
                        1,
                        attack,
                        target,
                    ),
                ]
            })
            .collect();
        fixtures::recording(client_id, stage, challenge.mode, &party, Tick(2), events)
    };
    let base = recording(
        BASE_CLIENT_ID,
        [
            (NpcAttack::TobVerzikP3Auto, Some("1Ogp")),
            (NpcAttack::TobVerzikP3Auto, Some("1Ogp")),
            (NpcAttack::TobVerzikP3Range, None),
        ],
    );
    let target = recording(
        TARGET_CLIENT_ID,
        [
            (NpcAttack::TobVerzikP3Auto, Some("WWWWWWWWWWQQ")),
            (NpcAttack::TobVerzikP3Melee, Some("WWWWWWWWWWQQ")),
            (NpcAttack::TobVerzikP3Auto, Some("1Ogp")),
        ],
    );

    let ctx = test_ctx(
        &challenge,
        ClientBuilder::new(BASE_CLIENT_ID.0, base.clone()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, target.clone()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    let player = result.recording.party_index(&party[0]).unwrap();
    for (tick, attack, target) in [
        (
            Tick(0),
            NpcAttack::TobVerzikP3Auto,
            Some(Actor::Player(player)),
        ),
        (
            Tick(1),
            NpcAttack::TobVerzikP3Auto,
            Some(Actor::Player(player)),
        ),
        (Tick(2), NpcAttack::TobVerzikP3Range, None),
    ] {
        assert_eq!(
            result
                .recording
                .get_state(tick)
                .expect("tick is recorded")
                .events,
            vec![blert::Event {
                source: Source::Client(BASE_CLIENT_ID),
                kind: EventKind::NpcAttack(NpcAttacked {
                    npc: RoomId(1),
                    attack,
                    target,
                }),
            }],
            "tick {tick}"
        );
    }

    assert_set_eq(
        result.quality_flags,
        &[
            QualityFlag::Disagreement {
                tick: Tick(0),
                kept_source: Source::Client(BASE_CLIENT_ID),
                discarded_source: Source::Client(TARGET_CLIENT_ID),
                subject: Disagreement::NpcAttackTarget {
                    room_id: RoomId(1),
                    npc_id: npc::id::VERZIK_P3_REGULAR,
                    kept: Actor::Player(player),
                    discarded: Actor::Player(result.recording.party_index(&party[1]).unwrap()),
                },
            },
            QualityFlag::Disagreement {
                tick: Tick(1),
                kept_source: Source::Client(BASE_CLIENT_ID),
                discarded_source: Source::Client(TARGET_CLIENT_ID),
                subject: Disagreement::NpcAttackKind {
                    room_id: RoomId(1),
                    npc_id: npc::id::VERZIK_P3_REGULAR,
                    kept: NpcAttack::TobVerzikP3Auto,
                    discarded: NpcAttack::TobVerzikP3Melee,
                },
            },
            QualityFlag::Disagreement {
                tick: Tick(2),
                kept_source: Source::Client(BASE_CLIENT_ID),
                discarded_source: Source::Client(TARGET_CLIENT_ID),
                subject: Disagreement::NpcAttackKind {
                    room_id: RoomId(1),
                    npc_id: npc::id::VERZIK_P3_REGULAR,
                    kept: NpcAttack::TobVerzikP3Range,
                    discarded: NpcAttack::TobVerzikP3Auto,
                },
            },
        ],
    );
    assert_eq!(
        result.counters,
        ReconciliationCounters {
            npc_attack_pairs: 3,
            ..Default::default()
        }
    );
}

#[test]
fn resolves_projectile_ambiguous_npc_attacks_by_primary_proximity() {
    // Sotetseg at (50, 50) launches a ball at 1Ogp. 1Ogp (base primary) is far
    // at (0, 0) and sees a regular ball; WWWWWWWWWWQQ (target primary) is next
    // to Sotetseg at (49, 50) and sees a death ball.
    let stage = Stage::TobSotetseg;
    let party = vec![
        Rsn::try_from("1Ogp").unwrap(),
        Rsn::try_from("WWWWWWWWWWQQ").unwrap(),
    ];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);
    let recording = |client_id: ClientId,
                     primary_player: (&str, u32, (i32, i32)),
                     attack: NpcAttack|
     -> Recording {
        let (name, party_index, coords) = primary_player;
        let events = vec![
            PlayerUpdateEvent::new(Tick(0), stage, name, coords)
                .party_index(party_index)
                .source(DataSource::Primary)
                .build(),
            fixtures::npc_update_event(NpcEvent {
                tick: Tick(0),
                stage,
                coords: (50, 50),
                npc_id: npc::id::SOTETSEG_REGULAR,
                room_id: 1,
                hitpoints: SkillLevel {
                    current: 500,
                    base: 4000,
                },
                ..Default::default()
            }),
            fixtures::npc_attack_event(
                Tick(0),
                stage,
                (50, 50),
                npc::id::SOTETSEG_REGULAR,
                1,
                attack,
                Some("1Ogp"),
            ),
        ];
        fixtures::recording(client_id, stage, challenge.mode, &party, Tick(0), events)
    };
    let base = recording(BASE_CLIENT_ID, ("1Ogp", 0, (0, 0)), NpcAttack::TobSoteBall);
    let target = recording(
        TARGET_CLIENT_ID,
        ("WWWWWWWWWWQQ", 1, (49, 50)),
        NpcAttack::TobSoteDeathBall,
    );

    let ctx = test_ctx(
        &challenge,
        ClientBuilder::new(BASE_CLIENT_ID.0, base.clone()).primary_player("1Ogp"),
        ClientBuilder::new(TARGET_CLIENT_ID.0, target.clone()).primary_player("WWWWWWWWWWQQ"),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    let player = result.recording.party_index(&party[0]).unwrap();
    assert_eq!(
        result
            .recording
            .get_state(Tick(0))
            .expect("tick is recorded")
            .events,
        vec![blert::Event {
            source: Source::Client(TARGET_CLIENT_ID),
            kind: EventKind::NpcAttack(NpcAttacked {
                npc: RoomId(1),
                attack: NpcAttack::TobSoteDeathBall,
                target: Some(Actor::Player(player)),
            }),
        }]
    );

    assert_eq!(result.quality_flags, vec![]);
    assert_eq!(
        result.counters,
        ReconciliationCounters {
            npc_attack_pairs: 1,
            ..Default::default()
        }
    );
}
