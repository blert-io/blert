#![allow(clippy::too_many_lines)]

use std::collections::BTreeMap;

use crate::lifecycle::core::types::{ChallengeMode, Stage};
use crate::merging::ChallengeInfo;
use crate::merging::alignment::AlignmentEntry;
use crate::merging::fixtures::{
    self, ClientBuilder, NpcEvent, PlayerAttackEvent, PlayerUpdateEvent,
};
use crate::merging::mapping::TickMapping;
use crate::proto::event::XarpusPhase;
use crate::proto::event::attack_style::Style;
use crate::proto::event::player::DataSource;
use crate::skill::SkillLevel;

use super::*;

const BASE_CLIENT_ID: ClientId = ClientId(1);
const TARGET_CLIENT_ID: ClientId = ClientId(2);

/// Creates a merge context with identity mappings and an active merge step.
fn test_ctx<'a>(
    challenge: &'a ChallengeInfo<'a>,
    stage: Stage,
    base: ClientBuilder,
    target: ClientBuilder,
) -> MergeContext<'a> {
    let (base, target) = (base.build(), target.build());
    let (base_last_tick, target_last_tick) =
        (base.info.last_recorded_tick, target.info.last_recorded_tick);
    let target_client_id = target.info.id;
    let mut ctx = fixtures::merge_context(challenge, stage)
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

/// Builds a simple timeline of ticks with player updates and optional extra
/// events per tick. Each tick has a player at position (tick, 0).
fn build_timeline(
    client_id: ClientId,
    stage: Stage,
    num_ticks: u32,
    player: &str,
    source: DataSource,
    mut extra_events: BTreeMap<Tick, Vec<Event>>,
) -> Timeline {
    let party = vec![player.to_string()];
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

    let events = events
        .into_iter()
        .map(|event| TaggedEvent::new(client_id, event))
        .collect();
    Timeline::build(&party, last_tick, events).expect("fixture events are well formed")
}

fn event_types(timeline: &Timeline, tick: Tick) -> Vec<event::Type> {
    let mut types: Vec<event::Type> = timeline
        .get(tick)
        .map(|state| state.events().map(|event| event.r#type()).collect())
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
    let party = vec!["1Ogp".to_string()];
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

    let base = build_timeline(
        BASE_CLIENT_ID,
        stage,
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
    let target = build_timeline(
        TARGET_CLIENT_ID,
        stage,
        5,
        "1Ogp",
        DataSource::Primary,
        target_events,
    );

    let ctx = test_ctx(
        &challenge,
        stage,
        ClientBuilder::new(BASE_CLIENT_ID.0, stage, base.last_tick()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, stage, target.last_tick()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    // Player update should be overridden with PRIMARY on all ticks.
    for (i, &current) in verzik_hitpoints.iter().enumerate() {
        let tick = Tick::from_usize(i);
        let tick_state = result.timeline.get(tick).expect("every tick is recorded");
        let player = tick_state.player("1Ogp").expect("player is on every tick");
        assert_eq!(player.data_source, DataSource::Primary, "tick {tick}");

        let verzik = tick_state.npc(1).expect("npc is on every tick");
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
        event_types(&result.timeline, Tick(2)),
        vec![event::Type::PlayerDeath]
    );
    assert_eq!(result.quality_flags, vec![]);
    assert_eq!(result.counters, ReconciliationCounters::default());
}

#[test]
fn fills_gaps_in_the_base_from_the_target() {
    let stage = Stage::TobVerzik;
    let party = vec!["1Ogp".to_string()];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);
    let base = Timeline::build(
        &party,
        Tick(2),
        vec![
            TaggedEvent::new(
                BASE_CLIENT_ID,
                PlayerUpdateEvent::new(Tick(0), stage, "1Ogp", (0, 0)).build(),
            ),
            TaggedEvent::new(
                BASE_CLIENT_ID,
                PlayerUpdateEvent::new(Tick(2), stage, "1Ogp", (2, 0)).build(),
            ),
        ],
    )
    .expect("fixture events are well formed");
    let target = build_timeline(
        TARGET_CLIENT_ID,
        stage,
        3,
        "1Ogp",
        DataSource::Secondary,
        BTreeMap::new(),
    );

    let ctx = test_ctx(
        &challenge,
        stage,
        ClientBuilder::new(BASE_CLIENT_ID.0, stage, base.last_tick()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, stage, target.last_tick()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    let filled = result
        .timeline
        .get(Tick(1))
        .expect("gap filled from target");
    let player = filled.player("1Ogp").expect("player is on the filled tick");
    assert_eq!(player.source, TARGET_CLIENT_ID);
    assert_eq!(player.position, Coords { x: 1, y: 0 });

    assert_eq!(result.quality_flags, vec![]);
    assert_eq!(result.counters, ReconciliationCounters::default());
}

#[test]
fn populates_leading_or_trailing_ticks_from_the_target() {
    // base:   _,_,0,1,2,3,4,5
    // target: 0,1,2,3,_,_,_,_
    let stage = Stage::TobVerzik;
    let party = vec!["1Ogp".to_string()];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);
    let base = build_timeline(
        BASE_CLIENT_ID,
        stage,
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
    let target = build_timeline(
        TARGET_CLIENT_ID,
        stage,
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
    let mut ctx = fixtures::merge_context(&challenge, stage)
        .client(ClientBuilder::new(BASE_CLIENT_ID.0, stage, base.last_tick()).build())
        .client(ClientBuilder::new(TARGET_CLIENT_ID.0, stage, target.last_tick()).build())
        .build();
    ctx.mapping.begin(
        TARGET_CLIENT_ID,
        TickMapping::from_alignment(base.last_tick(), target.last_tick(), &alignments),
    );

    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    assert_eq!(result.timeline.last_tick(), Tick(7));
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
    for (i, &(source, data_source, x)) in expected_players.iter().enumerate() {
        let tick = Tick::from_usize(i);
        let tick_state = result.timeline.get(tick).expect("every tick is recorded");
        let player = tick_state.player("1Ogp").expect("player is on every tick");
        assert_eq!(player.source, source, "tick {tick}");
        assert_eq!(player.data_source, data_source, "tick {tick}");
        assert_eq!(player.position, Coords { x, y: 0 }, "tick {tick}");
    }

    assert_eq!(
        event_types(&result.timeline, Tick(7)),
        vec![event::Type::PlayerDeath]
    );
    assert_eq!(result.quality_flags, vec![]);
    assert_eq!(result.counters, ReconciliationCounters::default());
}

#[test]
fn deduplicates_deaths_globally_in_regular_challenges() {
    let stage = Stage::TobVerzik;
    let party = vec!["1Ogp".to_string()];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);
    let base = build_timeline(
        BASE_CLIENT_ID,
        stage,
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
    let target = build_timeline(
        TARGET_CLIENT_ID,
        stage,
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
        stage,
        ClientBuilder::new(BASE_CLIENT_ID.0, stage, base.last_tick()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, stage, target.last_tick()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    // Earliest observation wins.
    assert_eq!(
        event_types(&result.timeline, Tick(2)),
        vec![event::Type::PlayerDeath]
    );
    assert_eq!(event_types(&result.timeline, Tick(20)), vec![]);

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
    let party = vec!["1Ogp".to_string()];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::CoxRegular, &party);
    let death = |tick: Tick| vec![fixtures::player_death_event(tick, stage, (0, 0), "1Ogp", 0)];

    let base = build_timeline(
        BASE_CLIENT_ID,
        stage,
        45,
        "1Ogp",
        DataSource::Secondary,
        BTreeMap::from([(Tick(2), death(Tick(2))), (Tick(22), death(Tick(22)))]),
    );
    let target = build_timeline(
        TARGET_CLIENT_ID,
        stage,
        45,
        "1Ogp",
        DataSource::Primary,
        BTreeMap::from([(Tick(5), death(Tick(5))), (Tick(40), death(Tick(40)))]),
    );

    let ctx = test_ctx(
        &challenge,
        stage,
        ClientBuilder::new(BASE_CLIENT_ID.0, stage, base.last_tick()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, stage, target.last_tick()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    // The deaths on 2 and 5 are the same death seen 3 ticks apart.
    // The deaths on 22 and 40 are beyond the window and counted distinctly.
    assert_eq!(
        event_types(&result.timeline, Tick(2)),
        vec![event::Type::PlayerDeath]
    );
    assert_eq!(event_types(&result.timeline, Tick(5)), vec![]);
    assert_eq!(
        event_types(&result.timeline, Tick(22)),
        vec![event::Type::PlayerDeath]
    );
    assert_eq!(
        event_types(&result.timeline, Tick(40)),
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
    let party = vec!["1Ogp".to_string()];
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

    let base = build_timeline(
        BASE_CLIENT_ID,
        stage,
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
    let target = build_timeline(
        TARGET_CLIENT_ID,
        stage,
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
        stage,
        ClientBuilder::new(BASE_CLIENT_ID.0, stage, base.last_tick()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, stage, target.last_tick()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    assert_eq!(
        event_types(&result.timeline, Tick(1)),
        vec![event::Type::NpcDeath]
    );
    assert_eq!(
        event_types(&result.timeline, Tick(2)),
        vec![event::Type::PlayerDeath]
    );
    assert_eq!(event_types(&result.timeline, Tick(7)), vec![]);
    assert_eq!(event_types(&result.timeline, Tick(25)), vec![]);

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
    let party = vec!["1Ogp".to_string()];
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

    let base = build_timeline(
        BASE_CLIENT_ID,
        stage,
        10,
        "1Ogp",
        DataSource::Secondary,
        BTreeMap::from([(Tick(5), vec![crab_death(1), crab_death(2)])]),
    );
    let target = build_timeline(
        TARGET_CLIENT_ID,
        stage,
        10,
        "1Ogp",
        DataSource::Primary,
        BTreeMap::from([(Tick(5), vec![crab_death(1), crab_death(3)])]),
    );

    let ctx = test_ctx(
        &challenge,
        stage,
        ClientBuilder::new(BASE_CLIENT_ID.0, stage, base.last_tick()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, stage, target.last_tick()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    // Room ID 1 died on both sides and is placed once from the base. Deaths for
    // 2 and 3 were only observed by one client each and use their own events.
    let mut deaths: Vec<(u64, ClientId)> = result
        .timeline
        .get(Tick(5))
        .expect("tick is recorded")
        .events_of_type(event::Type::NpcDeath)
        .map(|death| {
            let npc = death.npc.as_ref().expect("death names its npc");
            (npc.room_id, death.source())
        })
        .collect();
    deaths.sort_unstable();
    assert_eq!(
        deaths,
        vec![
            (1, BASE_CLIENT_ID),
            (2, BASE_CLIENT_ID),
            (3, TARGET_CLIENT_ID),
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
    let party = vec!["1Ogp".to_string()];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);

    let base = build_timeline(
        BASE_CLIENT_ID,
        stage,
        15,
        "1Ogp",
        DataSource::Secondary,
        BTreeMap::from([(
            Tick(3),
            vec![fixtures::xarpus_phase_event(Tick(3), XarpusPhase::XarpusP2)],
        )]),
    );
    let target = build_timeline(
        TARGET_CLIENT_ID,
        stage,
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
        stage,
        ClientBuilder::new(BASE_CLIENT_ID.0, stage, base.last_tick()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, stage, target.last_tick()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    assert_eq!(
        event_types(&result.timeline, Tick(3)),
        vec![event::Type::TobXarpusPhase]
    );
    assert_eq!(event_types(&result.timeline, Tick(12)), vec![]);

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
    let party = vec!["1Ogp".to_string()];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);

    let base = build_timeline(
        BASE_CLIENT_ID,
        stage,
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
    let target = build_timeline(
        TARGET_CLIENT_ID,
        stage,
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
        stage,
        ClientBuilder::new(BASE_CLIENT_ID.0, stage, base.last_tick()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, stage, target.last_tick()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    let death = result
        .timeline
        .get(Tick(4))
        .expect("tick is recorded")
        .events_of_type(event::Type::PlayerDeath)
        .map(TaggedEvent::source)
        .collect::<Vec<_>>();
    assert_eq!(death, vec![BASE_CLIENT_ID]);

    let crab_death = result
        .timeline
        .get(Tick(7))
        .expect("tick is recorded")
        .events_of_type(event::Type::NpcDeath)
        .map(TaggedEvent::source)
        .collect::<Vec<_>>();
    assert_eq!(crab_death, vec![TARGET_CLIENT_ID]);

    assert_eq!(result.quality_flags, vec![]);
    assert_eq!(result.counters, ReconciliationCounters::default());
}

/// Builds a timeline with Verzik P3 on every tick, inserting each of `attacks`
/// on its tick targeting an optional player, and an attack style event on
/// each tick in `attack_style_events` referencing a given attack tick with
/// its style.
fn build_p3_timeline(
    client_id: ClientId,
    num_ticks: u32,
    player: &str,
    source: DataSource,
    attacks: BTreeMap<Tick, (NpcAttack, Option<&str>)>,
    attack_style_events: BTreeMap<Tick, (Tick, Style)>,
) -> Timeline {
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
    for (tick, (npc_attack_tick, style)) in attack_style_events {
        extra_events
            .entry(tick)
            .or_default()
            .push(fixtures::verzik_attack_style_event(
                tick,
                npc_attack_tick,
                style,
            ));
    }

    build_timeline(client_id, stage, num_ticks, player, source, extra_events)
}

#[test]
fn places_an_attack_style_event_the_tick_after_its_attack() {
    let stage = Stage::TobVerzik;
    let party = vec!["WWWWWWWWWWQQ".to_string()];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);
    let base = build_p3_timeline(
        BASE_CLIENT_ID,
        15,
        "WWWWWWWWWWQQ",
        DataSource::Secondary,
        BTreeMap::from([(Tick(5), (NpcAttack::TobVerzikP3Auto, Some("WWWWWWWWWWQQ")))]),
        BTreeMap::from([(Tick(7), (Tick(5), Style::Melee))]),
    );
    let target = build_timeline(
        TARGET_CLIENT_ID,
        stage,
        15,
        "WWWWWWWWWWQQ",
        DataSource::Primary,
        BTreeMap::new(),
    );

    let ctx = test_ctx(
        &challenge,
        stage,
        ClientBuilder::new(BASE_CLIENT_ID.0, stage, base.last_tick()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, stage, target.last_tick()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    assert_eq!(event_types(&result.timeline, Tick(7)), vec![]);
    let styles: Vec<&TaggedEvent> = result
        .timeline
        .get(Tick(6))
        .expect("tick is recorded")
        .events_of_type(event::Type::TobVerzikAttackStyle)
        .collect();
    let [placed] = styles.as_slice() else {
        panic!("one attack style event on tick 6, found {styles:?}");
    };
    assert_eq!(placed.source(), BASE_CLIENT_ID);
    assert_eq!(placed.tick, 6);
    let style = placed.verzik_attack_style.as_ref().expect("style is set");
    assert_eq!(style.npc_attack_tick, 5);
    assert_eq!(style.style(), Style::Melee);

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
fn deduplicates_attack_style_events_across_clients() {
    let stage = Stage::TobVerzik;
    let party = vec!["WWWWWWWWWWQQ".to_string()];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);
    let base = build_p3_timeline(
        BASE_CLIENT_ID,
        15,
        "WWWWWWWWWWQQ",
        DataSource::Secondary,
        BTreeMap::from([(Tick(5), (NpcAttack::TobVerzikP3Auto, Some("WWWWWWWWWWQQ")))]),
        BTreeMap::from([(Tick(6), (Tick(5), Style::Range))]),
    );
    let target = build_p3_timeline(
        TARGET_CLIENT_ID,
        15,
        "WWWWWWWWWWQQ",
        DataSource::Primary,
        BTreeMap::from([(Tick(5), (NpcAttack::TobVerzikP3Auto, Some("WWWWWWWWWWQQ")))]),
        BTreeMap::from([(Tick(6), (Tick(5), Style::Range))]),
    );

    let ctx = test_ctx(
        &challenge,
        stage,
        ClientBuilder::new(BASE_CLIENT_ID.0, stage, base.last_tick()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, stage, target.last_tick()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    let styles: Vec<(ClientId, Style)> = result
        .timeline
        .get(Tick(6))
        .expect("tick is recorded")
        .events_of_type(event::Type::TobVerzikAttackStyle)
        .map(|placed| {
            let style = placed.verzik_attack_style.as_ref().expect("style is set");
            (placed.source(), style.style())
        })
        .collect();
    assert_eq!(styles, vec![(BASE_CLIENT_ID, Style::Range)]);

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
fn resolves_disagreeing_attack_style_events_by_primary_proximity_to_verzik() {
    // Verzik at (10, 10). 1Ogp (base primary) is at (0, 0).
    // WWWWWWWWWWQQ (target primary) is nearer at (9, 10).
    let stage = Stage::TobVerzik;
    let party = vec!["1Ogp".to_string(), "WWWWWWWWWWQQ".to_string()];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);

    let recording = |client_id: ClientId, primary_player: &str, style: Style| -> Timeline {
        let source = |player: &str| {
            if player == primary_player {
                DataSource::Primary
            } else {
                DataSource::Secondary
            }
        };
        let mut events = Vec::new();
        for tick in Tick(14).up_to_inclusive() {
            events.push(
                PlayerUpdateEvent::new(tick, stage, "1Ogp", (0, 0))
                    .source(source("1Ogp"))
                    .build(),
            );
            events.push(
                PlayerUpdateEvent::new(tick, stage, "WWWWWWWWWWQQ", (9, 10))
                    .party_index(1)
                    .source(source("WWWWWWWWWWQQ"))
                    .build(),
            );
            events.push(fixtures::npc_update_event(NpcEvent {
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
            if tick == Tick(5) {
                events.push(fixtures::npc_attack_event(
                    tick,
                    stage,
                    (10, 10),
                    npc::id::VERZIK_P3_REGULAR,
                    1,
                    NpcAttack::TobVerzikP3Auto,
                    Some("1Ogp"),
                ));
            }
            if tick == Tick(6) {
                events.push(fixtures::verzik_attack_style_event(tick, Tick(5), style));
            }
        }
        let events = events
            .into_iter()
            .map(|event| TaggedEvent::new(client_id, event))
            .collect();
        Timeline::build(&party, Tick(14), events).expect("fixture events are well formed")
    };
    let base = recording(BASE_CLIENT_ID, "1Ogp", Style::Range);
    let target = recording(TARGET_CLIENT_ID, "WWWWWWWWWWQQ", Style::Mage);

    let ctx = test_ctx(
        &challenge,
        stage,
        ClientBuilder::new(BASE_CLIENT_ID.0, stage, base.last_tick()).primary_player("1Ogp"),
        ClientBuilder::new(TARGET_CLIENT_ID.0, stage, target.last_tick())
            .primary_player("WWWWWWWWWWQQ"),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    // Style from the target should win.
    let styles: Vec<(ClientId, Style)> = result
        .timeline
        .get(Tick(6))
        .expect("tick is recorded")
        .events_of_type(event::Type::TobVerzikAttackStyle)
        .map(|placed| {
            let style = placed.verzik_attack_style.as_ref().expect("style is set");
            (placed.source(), style.style())
        })
        .collect();
    assert_eq!(styles, vec![(TARGET_CLIENT_ID, Style::Mage)]);

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
fn keeps_the_base_conflicting_attack_style_event_when_clients_have_no_primary_players() {
    let stage = Stage::TobVerzik;
    let party = vec!["1Ogp".to_string()];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);
    let base = build_p3_timeline(
        BASE_CLIENT_ID,
        15,
        "1Ogp",
        DataSource::Secondary,
        BTreeMap::from([(Tick(5), (NpcAttack::TobVerzikP3Auto, Some("1Ogp")))]),
        BTreeMap::from([(Tick(6), (Tick(5), Style::Range))]),
    );
    let target = build_p3_timeline(
        TARGET_CLIENT_ID,
        15,
        "1Ogp",
        DataSource::Primary,
        BTreeMap::from([(Tick(5), (NpcAttack::TobVerzikP3Auto, Some("1Ogp")))]),
        BTreeMap::from([(Tick(6), (Tick(5), Style::Mage))]),
    );

    let ctx = test_ctx(
        &challenge,
        stage,
        ClientBuilder::new(BASE_CLIENT_ID.0, stage, base.last_tick()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, stage, target.last_tick()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    let styles: Vec<(ClientId, Style)> = result
        .timeline
        .get(Tick(6))
        .expect("tick is recorded")
        .events_of_type(event::Type::TobVerzikAttackStyle)
        .map(|placed| {
            let style = placed.verzik_attack_style.as_ref().expect("style is set");
            (placed.source(), style.style())
        })
        .collect();
    assert_eq!(styles, vec![(BASE_CLIENT_ID, Style::Range)]);

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
fn discards_attack_style_events_whose_attack_does_not_exist() {
    let stage = Stage::TobVerzik;
    let party = vec!["WWWWWWWWWWQQ".to_string()];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);
    let base = build_timeline(
        BASE_CLIENT_ID,
        stage,
        15,
        "WWWWWWWWWWQQ",
        DataSource::Secondary,
        BTreeMap::from([(
            Tick(6),
            vec![fixtures::verzik_attack_style_event(
                Tick(6),
                Tick(5),
                Style::Melee,
            )],
        )]),
    );
    let target = build_timeline(
        TARGET_CLIENT_ID,
        stage,
        15,
        "WWWWWWWWWWQQ",
        DataSource::Primary,
        BTreeMap::new(),
    );

    let ctx = test_ctx(
        &challenge,
        stage,
        ClientBuilder::new(BASE_CLIENT_ID.0, stage, base.last_tick()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, stage, target.last_tick()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    assert_eq!(event_types(&result.timeline, Tick(6)), vec![]);

    assert_eq!(
        result.quality_flags,
        vec![QualityFlag::AttackMappedNotFound {
            kind: event::Type::TobVerzikAttackStyle,
            side: Side::Base,
            client_tick: Tick(6),
            client_attack_tick: Tick(5),
        }]
    );
    assert_eq!(
        result.counters,
        ReconciliationCounters {
            attack_mapped_events: 1,
            ..Default::default()
        }
    );
}

#[test]
fn matches_a_bounce_event_to_a_p2_attack_depending_on_target() {
    let stage = Stage::TobVerzik;
    let attack_present = attack_mapped_config(event::Type::TobVerzikBounce).attack_present;
    let untargeted = fixtures::verzik_bounce_event(Tick(0), Tick(0), 1, 0, None);
    let targeted = fixtures::verzik_bounce_event(Tick(0), Tick(0), 1, 0, Some("1Ogp"));

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
        fixtures::timeline(&[], Tick(0), events)
            .get(Tick(0))
            .cloned()
            .expect("tick is recorded")
    };
    let mage = p2_tick(Some(NpcAttack::TobVerzikP2Mage));
    let bounce = p2_tick(Some(NpcAttack::TobVerzikP2Bounce));
    let idle = p2_tick(None);
    let party = vec!["1Ogp".to_string()];
    let without_verzik = fixtures::timeline(
        &party,
        Tick(0),
        vec![PlayerUpdateEvent::new(Tick(0), stage, "1Ogp", (0, 0)).build()],
    )
    .get(Tick(0))
    .cloned()
    .expect("tick is recorded");

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
        "1Ogp".to_string(),
        "WWWWWWWWWWQQ".to_string(),
        "715".to_string(),
    ];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);

    let recording = |client_id: ClientId, primary_player: &str, attack: PlayerAttack| -> Timeline {
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
        let events = events
            .into_iter()
            .map(|event| TaggedEvent::new(client_id, event))
            .collect();
        Timeline::build(&party, Tick(9), events).expect("fixture events are well formed")
    };
    let base = recording(BASE_CLIENT_ID, "1Ogp", PlayerAttack::ZcbAuto);
    let target = recording(TARGET_CLIENT_ID, "WWWWWWWWWWQQ", PlayerAttack::ZcbSpec);

    let ctx = test_ctx(
        &challenge,
        stage,
        ClientBuilder::new(BASE_CLIENT_ID.0, stage, base.last_tick()).primary_player("1Ogp"),
        ClientBuilder::new(TARGET_CLIENT_ID.0, stage, target.last_tick())
            .primary_player("WWWWWWWWWWQQ"),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    let attack = result
        .timeline
        .get(Tick(5))
        .expect("tick is recorded")
        .player("715")
        .expect("attacker is on the tick")
        .attack
        .as_ref()
        .expect("attack is kept");
    assert_eq!(attack.source, TARGET_CLIENT_ID);
    assert_eq!(attack.value.kind, PlayerAttack::ZcbSpec);

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
    attack: Option<PlayerAttack>,
    target: Option<event::Npc>,
) -> Timeline {
    let party = vec!["WWWWWWWWWWQQ".to_string()];
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
    let events = events
        .into_iter()
        .map(|event| TaggedEvent::new(client_id, event))
        .collect();
    Timeline::build(&party, Tick(0), events).expect("fixture events are well formed")
}

#[test]
fn deduplicates_agreeing_player_attacks() {
    let stage = Stage::TobMaiden;
    let party = vec!["WWWWWWWWWWQQ".to_string()];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);
    let maiden = event::Npc {
        id: npc::id::MAIDEN_REGULAR,
        room_id: 1,
        ..Default::default()
    };
    let base = single_tick_with_attack(
        BASE_CLIENT_ID,
        stage,
        Some(PlayerAttack::Scythe),
        Some(maiden),
    );
    let target = single_tick_with_attack(
        TARGET_CLIENT_ID,
        stage,
        Some(PlayerAttack::Scythe),
        Some(maiden),
    );

    let ctx = test_ctx(
        &challenge,
        stage,
        ClientBuilder::new(BASE_CLIENT_ID.0, stage, base.last_tick()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, stage, target.last_tick()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    let attack = result
        .timeline
        .get(Tick(0))
        .expect("tick is recorded")
        .player("WWWWWWWWWWQQ")
        .expect("player is on the tick")
        .attack
        .as_ref()
        .expect("attack is kept");
    assert_eq!(attack.source, BASE_CLIENT_ID);
    assert_eq!(attack.value.kind, PlayerAttack::Scythe);
    let target = attack.value.target.as_ref().expect("target is kept");
    assert_eq!(target.source, BASE_CLIENT_ID);
    assert_eq!(
        target.value,
        Target::Npc {
            id: npc::id::MAIDEN_REGULAR,
            room_id: 1,
        }
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
    let party = vec!["WWWWWWWWWWQQ".to_string()];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);
    let maiden = event::Npc {
        id: npc::id::MAIDEN_REGULAR,
        room_id: 1,
        ..Default::default()
    };
    let base = single_tick_with_attack(BASE_CLIENT_ID, stage, None, None);
    let target = single_tick_with_attack(
        TARGET_CLIENT_ID,
        stage,
        Some(PlayerAttack::Scythe),
        Some(maiden),
    );

    let ctx = test_ctx(
        &challenge,
        stage,
        ClientBuilder::new(BASE_CLIENT_ID.0, stage, base.last_tick()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, stage, target.last_tick()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    let attack = result
        .timeline
        .get(Tick(0))
        .expect("tick is recorded")
        .player("WWWWWWWWWWQQ")
        .expect("player is on the tick")
        .attack
        .as_ref()
        .expect("attack is filled");
    assert_eq!(attack.source, TARGET_CLIENT_ID);
    assert_eq!(attack.value.kind, PlayerAttack::Scythe);
    let target = attack.value.target.as_ref().expect("target is inserted");
    assert_eq!(target.source, TARGET_CLIENT_ID);
    assert_eq!(
        target.value,
        Target::Npc {
            id: npc::id::MAIDEN_REGULAR,
            room_id: 1,
        }
    );

    assert_eq!(result.quality_flags, vec![]);
    assert_eq!(result.counters, ReconciliationCounters::default());
}

#[test]
fn fills_a_missing_player_attack_target_from_the_other_client() {
    // Tick 0: only the target saw who was attacked. Tick 1: only the base did.
    let stage = Stage::TobMaiden;
    let party = vec!["WWWWWWWWWWQQ".to_string()];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);
    let maiden = event::Npc {
        id: npc::id::MAIDEN_REGULAR,
        room_id: 1,
        ..Default::default()
    };
    let recording = |client_id: ClientId, targets: [Option<event::Npc>; 2]| -> Timeline {
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
            .map(|event| TaggedEvent::new(client_id, event))
            .collect();
        Timeline::build(&party, Tick(1), events).expect("fixture events are well formed")
    };
    let base = recording(BASE_CLIENT_ID, [None, Some(maiden)]);
    let target = recording(TARGET_CLIENT_ID, [Some(maiden), None]);

    let ctx = test_ctx(
        &challenge,
        stage,
        ClientBuilder::new(BASE_CLIENT_ID.0, stage, base.last_tick()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, stage, target.last_tick()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    for (tick, target_source) in [(Tick(0), TARGET_CLIENT_ID), (Tick(1), BASE_CLIENT_ID)] {
        let attack = result
            .timeline
            .get(tick)
            .expect("tick is recorded")
            .player("WWWWWWWWWWQQ")
            .expect("player is on the tick")
            .attack
            .as_ref()
            .expect("attack is kept");
        assert_eq!(attack.source, BASE_CLIENT_ID, "tick {tick}");
        assert_eq!(attack.value.kind, PlayerAttack::Scythe, "tick {tick}");
        let target = attack.value.target.as_ref().expect("target is kept");
        assert_eq!(target.source, target_source, "tick {tick}");
        assert_eq!(
            target.value,
            Target::Npc {
                id: npc::id::MAIDEN_REGULAR,
                room_id: 1,
            },
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
    let party = vec!["WWWWWWWWWWQQ".to_string()];
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
    let recording = |client_id: ClientId, attacks: [(PlayerAttack, event::Npc); 2]| -> Timeline {
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
            .map(|event| TaggedEvent::new(client_id, event))
            .collect();
        Timeline::build(&party, Tick(1), events).expect("fixture events are well formed")
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
        stage,
        ClientBuilder::new(BASE_CLIENT_ID.0, stage, base.last_tick()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, stage, target.last_tick()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    for tick in [Tick(0), Tick(1)] {
        let attack = result
            .timeline
            .get(tick)
            .expect("tick is recorded")
            .player("WWWWWWWWWWQQ")
            .expect("player is on the tick")
            .attack
            .as_ref()
            .expect("attack is kept");
        assert_eq!(attack.source, BASE_CLIENT_ID, "tick {tick}");
        assert_eq!(attack.value.kind, PlayerAttack::Scythe, "tick {tick}");
        let target = attack.value.target.as_ref().expect("target is kept");
        assert_eq!(target.source, BASE_CLIENT_ID, "tick {tick}");
        assert_eq!(
            target.value,
            Target::Npc {
                id: npc::id::MAIDEN_REGULAR,
                room_id: 1,
            },
            "tick {tick}"
        );
    }

    assert_set_eq(
        result.quality_flags,
        &[
            QualityFlag::Disagreement {
                tick: Tick(0),
                kept_source: BASE_CLIENT_ID,
                discarded_source: TARGET_CLIENT_ID,
                subject: Disagreement::PlayerAttackTarget {
                    player: "WWWWWWWWWWQQ".to_string(),
                    kept: Target::Npc {
                        id: npc::id::MAIDEN_REGULAR,
                        room_id: 1,
                    },
                    discarded: Target::Npc {
                        id: npc::id::MAIDEN_MATOMENOS_REGULAR,
                        room_id: 2,
                    },
                },
            },
            QualityFlag::Disagreement {
                tick: Tick(1),
                kept_source: BASE_CLIENT_ID,
                discarded_source: TARGET_CLIENT_ID,
                subject: Disagreement::PlayerAttackKind {
                    player: "WWWWWWWWWWQQ".to_string(),
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
    let party = vec!["1Ogp".to_string(), "WWWWWWWWWWQQ".to_string()];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);
    let heal_target = event::spell::Target::TargetPlayer("WWWWWWWWWWQQ".to_string());
    let recording = |client_id: ClientId, targets: [Option<event::spell::Target>; 2]| -> Timeline {
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
            .map(|event| TaggedEvent::new(client_id, event))
            .collect();
        Timeline::build(&party, Tick(1), events).expect("fixture events are well formed")
    };
    let base = recording(BASE_CLIENT_ID, [Some(heal_target.clone()), None]);
    let target = recording(
        TARGET_CLIENT_ID,
        [Some(heal_target.clone()), Some(heal_target)],
    );

    let ctx = test_ctx(
        &challenge,
        stage,
        ClientBuilder::new(BASE_CLIENT_ID.0, stage, base.last_tick()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, stage, target.last_tick()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    for (tick, target_source) in [(Tick(0), BASE_CLIENT_ID), (Tick(1), TARGET_CLIENT_ID)] {
        let spell = result
            .timeline
            .get(tick)
            .expect("tick is recorded")
            .player("1Ogp")
            .expect("player is on the tick")
            .spell
            .as_ref()
            .expect("spell is kept");
        assert_eq!(spell.source, BASE_CLIENT_ID, "tick {tick}");
        assert_eq!(spell.value.kind, PlayerSpell::HealOther, "tick {tick}");
        let target = spell.value.target.as_ref().expect("target is kept");
        assert_eq!(target.source, target_source, "tick {tick}");
        assert_eq!(
            target.value,
            Target::Player("WWWWWWWWWWQQ".to_string()),
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
    let party = vec!["1Ogp".to_string(), "WWWWWWWWWWQQ".to_string()];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);
    let spurious = event::spell::Target::TargetPlayer("WWWWWWWWWWQQ".to_string());
    let recording = |client_id: ClientId, targets: [Option<event::spell::Target>; 3]| -> Timeline {
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
            .map(|event| TaggedEvent::new(client_id, event))
            .collect();
        Timeline::build(&party, Tick(2), events).expect("fixture events are well formed")
    };
    let base = recording(BASE_CLIENT_ID, [None, Some(spurious.clone()), None]);
    let target = recording(TARGET_CLIENT_ID, [None, None, Some(spurious)]);

    let ctx = test_ctx(
        &challenge,
        stage,
        ClientBuilder::new(BASE_CLIENT_ID.0, stage, base.last_tick()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, stage, target.last_tick()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    for tick in Tick(2).up_to_inclusive() {
        let spell = result
            .timeline
            .get(tick)
            .expect("tick is recorded")
            .player("1Ogp")
            .expect("player is on the tick")
            .spell
            .as_ref()
            .expect("spell is kept");
        assert_eq!(spell.source, BASE_CLIENT_ID, "tick {tick}");
        assert_eq!(spell.value.kind, PlayerSpell::SpellbookSwap, "tick {tick}");
        assert!(spell.value.target.is_none(), "tick {tick}");
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
        "1Ogp".to_string(),
        "WWWWWWWWWWQQ".to_string(),
        "715".to_string(),
    ];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);
    let recording = |client_id: ClientId, spells: [(PlayerSpell, &str); 2]| -> Timeline {
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
            .map(|event| TaggedEvent::new(client_id, event))
            .collect();
        Timeline::build(&party, Tick(1), events).expect("fixture events are well formed")
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
        stage,
        ClientBuilder::new(BASE_CLIENT_ID.0, stage, base.last_tick()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, stage, target.last_tick()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    for tick in [Tick(0), Tick(1)] {
        let spell = result
            .timeline
            .get(tick)
            .expect("tick is recorded")
            .player("1Ogp")
            .expect("player is on the tick")
            .spell
            .as_ref()
            .expect("spell is kept");
        assert_eq!(spell.source, BASE_CLIENT_ID, "tick {tick}");
        assert_eq!(spell.value.kind, PlayerSpell::HealOther, "tick {tick}");
        let target = spell.value.target.as_ref().expect("target is kept");
        assert_eq!(target.source, BASE_CLIENT_ID, "tick {tick}");
        assert_eq!(
            target.value,
            Target::Player("WWWWWWWWWWQQ".to_string()),
            "tick {tick}"
        );
    }

    assert_set_eq(
        result.quality_flags,
        &[
            QualityFlag::Disagreement {
                tick: Tick(0),
                kept_source: BASE_CLIENT_ID,
                discarded_source: TARGET_CLIENT_ID,
                subject: Disagreement::PlayerSpellTarget {
                    player: "1Ogp".to_string(),
                    kept: Target::Player("WWWWWWWWWWQQ".to_string()),
                    discarded: Target::Player("715".to_string()),
                },
            },
            QualityFlag::Disagreement {
                tick: Tick(1),
                kept_source: BASE_CLIENT_ID,
                discarded_source: TARGET_CLIENT_ID,
                subject: Disagreement::PlayerSpellKind {
                    player: "1Ogp".to_string(),
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
    let party = vec!["1Ogp".to_string(), "WWWWWWWWWWQQ".to_string()];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);
    let recording = |client_id: ClientId, spell: Option<PlayerSpell>| -> Timeline {
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
        let events = events
            .into_iter()
            .map(|event| TaggedEvent::new(client_id, event))
            .collect();
        Timeline::build(&party, Tick(0), events).expect("fixture events are well formed")
    };
    let base = recording(BASE_CLIENT_ID, None);
    let target = recording(TARGET_CLIENT_ID, Some(PlayerSpell::HealOther));

    let ctx = test_ctx(
        &challenge,
        stage,
        ClientBuilder::new(BASE_CLIENT_ID.0, stage, base.last_tick()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, stage, target.last_tick()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    let spell = result
        .timeline
        .get(Tick(0))
        .expect("tick is recorded")
        .player("1Ogp")
        .expect("player is on the tick")
        .spell
        .as_ref()
        .expect("spell is inserted");
    assert_eq!(spell.source, TARGET_CLIENT_ID);
    assert_eq!(spell.value.kind, PlayerSpell::HealOther);
    let target = spell.value.target.as_ref().expect("target is inserted");
    assert_eq!(target.source, TARGET_CLIENT_ID);
    assert_eq!(target.value, Target::Player("WWWWWWWWWWQQ".to_string()));

    assert_eq!(result.quality_flags, vec![]);
    assert_eq!(result.counters, ReconciliationCounters::default());
}

#[test]
fn deduplicates_agreeing_npc_attacks_and_fills_a_missing_target() {
    // Tick 0: both clients saw Verzik attack 1Ogp.
    // Tick 1: only the target saw who was attacked.
    let stage = Stage::TobVerzik;
    let party = vec!["1Ogp".to_string()];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);
    let base = build_p3_timeline(
        BASE_CLIENT_ID,
        2,
        "1Ogp",
        DataSource::Secondary,
        BTreeMap::from([
            (Tick(0), (NpcAttack::TobVerzikP3Auto, Some("1Ogp"))),
            (Tick(1), (NpcAttack::TobVerzikP3Auto, None)),
        ]),
        BTreeMap::new(),
    );
    let target = build_p3_timeline(
        TARGET_CLIENT_ID,
        2,
        "1Ogp",
        DataSource::Primary,
        BTreeMap::from([
            (Tick(0), (NpcAttack::TobVerzikP3Auto, Some("1Ogp"))),
            (Tick(1), (NpcAttack::TobVerzikP3Auto, Some("1Ogp"))),
        ]),
        BTreeMap::new(),
    );

    let ctx = test_ctx(
        &challenge,
        stage,
        ClientBuilder::new(BASE_CLIENT_ID.0, stage, base.last_tick()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, stage, target.last_tick()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    for (tick, target_source) in [(Tick(0), BASE_CLIENT_ID), (Tick(1), TARGET_CLIENT_ID)] {
        let attack = result
            .timeline
            .get(tick)
            .expect("tick is recorded")
            .npc(1)
            .expect("verzik is on the tick")
            .attack
            .as_ref()
            .expect("attack is kept");
        assert_eq!(attack.source, BASE_CLIENT_ID, "tick {tick}");
        assert_eq!(attack.value.kind, NpcAttack::TobVerzikP3Auto, "tick {tick}");
        let target = attack.value.target.as_ref().expect("target is kept");
        assert_eq!(target.source, target_source, "tick {tick}");
        assert_eq!(
            target.value,
            Target::Player("1Ogp".to_string()),
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
    let party = vec!["1Ogp".to_string()];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);
    let base = build_p3_timeline(
        BASE_CLIENT_ID,
        1,
        "1Ogp",
        DataSource::Secondary,
        BTreeMap::new(),
        BTreeMap::new(),
    );
    let target = build_p3_timeline(
        TARGET_CLIENT_ID,
        1,
        "1Ogp",
        DataSource::Primary,
        BTreeMap::from([(Tick(0), (NpcAttack::TobVerzikP3Auto, Some("1Ogp")))]),
        BTreeMap::new(),
    );

    let ctx = test_ctx(
        &challenge,
        stage,
        ClientBuilder::new(BASE_CLIENT_ID.0, stage, base.last_tick()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, stage, target.last_tick()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    let attack = result
        .timeline
        .get(Tick(0))
        .expect("tick is recorded")
        .npc(1)
        .expect("verzik is on the tick")
        .attack
        .as_ref()
        .expect("attack is inserted");
    assert_eq!(attack.source, TARGET_CLIENT_ID);
    assert_eq!(attack.value.kind, NpcAttack::TobVerzikP3Auto);
    let target = attack.value.target.as_ref().expect("target is inserted");
    assert_eq!(target.source, TARGET_CLIENT_ID);
    assert_eq!(target.value, Target::Player("1Ogp".to_string()));

    assert_eq!(result.quality_flags, vec![]);
    assert_eq!(result.counters, ReconciliationCounters::default());
}

#[test]
fn keeps_the_base_npc_attack_in_a_conflict_and_flags() {
    // Tick 0: the clients disagree on the target.
    // Tick 1: they disagree on the attack.
    let stage = Stage::TobVerzik;
    let party = vec!["1Ogp".to_string(), "WWWWWWWWWWQQ".to_string()];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);
    let recording = |client_id: ClientId, attacks: [(NpcAttack, &str); 2]| -> Timeline {
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
                        Some(target),
                    ),
                ]
            })
            .map(|event| TaggedEvent::new(client_id, event))
            .collect();
        Timeline::build(&party, Tick(1), events).expect("fixture events are well formed")
    };
    let base = recording(
        BASE_CLIENT_ID,
        [
            (NpcAttack::TobVerzikP3Auto, "1Ogp"),
            (NpcAttack::TobVerzikP3Auto, "1Ogp"),
        ],
    );
    let target = recording(
        TARGET_CLIENT_ID,
        [
            (NpcAttack::TobVerzikP3Auto, "WWWWWWWWWWQQ"),
            (NpcAttack::TobVerzikP3Melee, "1Ogp"),
        ],
    );

    let ctx = test_ctx(
        &challenge,
        stage,
        ClientBuilder::new(BASE_CLIENT_ID.0, stage, base.last_tick()),
        ClientBuilder::new(TARGET_CLIENT_ID.0, stage, target.last_tick()),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    for tick in [Tick(0), Tick(1)] {
        let attack = result
            .timeline
            .get(tick)
            .expect("tick is recorded")
            .npc(1)
            .expect("verzik is on the tick")
            .attack
            .as_ref()
            .expect("attack is kept");
        assert_eq!(attack.source, BASE_CLIENT_ID, "tick {tick}");
        assert_eq!(attack.value.kind, NpcAttack::TobVerzikP3Auto, "tick {tick}");
        let target = attack.value.target.as_ref().expect("target is kept");
        assert_eq!(target.source, BASE_CLIENT_ID, "tick {tick}");
        assert_eq!(
            target.value,
            Target::Player("1Ogp".to_string()),
            "tick {tick}"
        );
    }

    assert_set_eq(
        result.quality_flags,
        &[
            QualityFlag::Disagreement {
                tick: Tick(0),
                kept_source: BASE_CLIENT_ID,
                discarded_source: TARGET_CLIENT_ID,
                subject: Disagreement::NpcAttackTarget {
                    room_id: 1,
                    npc_id: npc::id::VERZIK_P3_REGULAR,
                    kept: Target::Player("1Ogp".to_string()),
                    discarded: Target::Player("WWWWWWWWWWQQ".to_string()),
                },
            },
            QualityFlag::Disagreement {
                tick: Tick(1),
                kept_source: BASE_CLIENT_ID,
                discarded_source: TARGET_CLIENT_ID,
                subject: Disagreement::NpcAttackKind {
                    room_id: 1,
                    npc_id: npc::id::VERZIK_P3_REGULAR,
                    kept: NpcAttack::TobVerzikP3Auto,
                    discarded: NpcAttack::TobVerzikP3Melee,
                },
            },
        ],
    );
    assert_eq!(
        result.counters,
        ReconciliationCounters {
            npc_attack_pairs: 2,
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
    let party = vec!["1Ogp".to_string(), "WWWWWWWWWWQQ".to_string()];
    let challenge = fixtures::challenge_info(stage, ChallengeMode::TobRegular, &party);
    let recording = |client_id: ClientId,
                     primary_player: (&str, u32, (i32, i32)),
                     attack: NpcAttack|
     -> Timeline {
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
        let events = events
            .into_iter()
            .map(|event| TaggedEvent::new(client_id, event))
            .collect();
        Timeline::build(&party, Tick(0), events).expect("fixture events are well formed")
    };
    let base = recording(BASE_CLIENT_ID, ("1Ogp", 0, (0, 0)), NpcAttack::TobSoteBall);
    let target = recording(
        TARGET_CLIENT_ID,
        ("WWWWWWWWWWQQ", 1, (49, 50)),
        NpcAttack::TobSoteDeathBall,
    );

    let ctx = test_ctx(
        &challenge,
        stage,
        ClientBuilder::new(BASE_CLIENT_ID.0, stage, base.last_tick()).primary_player("1Ogp"),
        ClientBuilder::new(TARGET_CLIENT_ID.0, stage, target.last_tick())
            .primary_player("WWWWWWWWWWQQ"),
    );
    let result = Consolidator::new(&base, &target, &ctx, None).consolidate();

    let attack = result
        .timeline
        .get(Tick(0))
        .expect("tick is recorded")
        .npc(1)
        .expect("sotetseg is on the tick")
        .attack
        .as_ref()
        .expect("attack is kept");
    assert_eq!(attack.source, TARGET_CLIENT_ID);
    assert_eq!(attack.value.kind, NpcAttack::TobSoteDeathBall);
    let target = attack.value.target.as_ref().expect("target is kept");
    assert_eq!(target.source, TARGET_CLIENT_ID);
    assert_eq!(target.value, Target::Player("1Ogp".to_string()));

    assert_eq!(result.quality_flags, vec![]);
    assert_eq!(
        result.counters,
        ReconciliationCounters {
            npc_attack_pairs: 1,
            ..Default::default()
        }
    );
}
