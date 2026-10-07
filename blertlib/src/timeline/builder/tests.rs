use super::*;
use crate::event::{
    MokhaiotlOrbSource, SolDustDirection, SolGrappleOutcome, SolLaserPhase, VerzikPhase,
    XarpusPhase,
};
use crate::{ChallengeMode, Stage, item};

#[test]
fn builder_ingest_returns_none_if_all_rejected() {
    let mut builder = RecordingBuilder::new(
        ClientId(7),
        Stage::TobBloat,
        ChallengeMode::TobRegular,
        vec![
            Rsn::try_from("1Ogp").unwrap(),
            Rsn::try_from("WWWWWWWWWWQQ").unwrap(),
        ],
        Some(Tick(120)),
    );

    let mut update = proto::Event {
        tick: 121,
        stage: Stage::TobBloat as i32,
        x_coord: 3298,
        y_coord: 4442,
        ..Default::default()
    };
    update.set_type(proto::event::Type::PlayerUpdate);
    update.player = Some(proto::event::Player {
        name: "WWWWWWWWWWQQ".to_string(),
        off_cooldown_tick: 125,
        hitpoints: Some(1_114_211),
        prayer: Some(3_014_747),
        attack: Some(7_733_347),
        strength: Some(7_733_347),
        defence: Some(7_733_347),
        ranged: Some(6_881_379),
        magic: Some(6_488_163),
        equipment_deltas: vec![1_184_536_947_851_265],
        active_prayers: Some(67_239_936),
        ..Default::default()
    });
    let mut attack = proto::Event {
        tick: 123,
        stage: Stage::TobBloat as i32,
        x_coord: 3298,
        y_coord: 4444,
        ..Default::default()
    };
    attack.set_type(proto::event::Type::PlayerAttack);
    attack.player = Some(proto::event::Player {
        name: "715".to_string(),
        ..Default::default()
    });
    attack.player_attack = Some(proto::event::Attack {
        r#type: proto::PlayerAttack::Scythe as i32,
        weapon: Some(proto::event::player::EquippedItem {
            slot: proto::event::player::EquipmentSlot::Weapon as i32,
            id: item::id::SCYTHE_OF_VITUR,
            quantity: 1,
        }),
        target: Some(proto::event::Npc {
            id: 8359,
            room_id: 61707,
            r#type: Some(proto::event::npc::Type::Basic(())),
            ..Default::default()
        }),
        distance_to_target: 1,
    });

    assert_eq!(builder.ingest([update, attack]), None);
    assert_eq!(builder.recording().unwrap().last_tick(), Tick(120));
    assert_eq!(
        builder.rejections().cloned().collect::<Vec<_>>(),
        [
            BuildRejection {
                tick: Tick(121),
                kind: proto::event::Type::PlayerUpdate,
                reason: RejectionReason::BeyondLastTick,
            },
            BuildRejection {
                tick: Tick(123),
                kind: proto::event::Type::PlayerAttack,
                reason: RejectionReason::BeyondLastTick,
            },
        ]
    );
}

#[test]
fn builder_ingest_rejects_event_from_another_stage() {
    let mut builder = RecordingBuilder::new(
        ClientId(13),
        Stage::TobMaiden,
        ChallengeMode::TobRegular,
        vec![Rsn::try_from("Dedion").unwrap()],
        None,
    );

    let mut phase = proto::Event {
        tick: 125,
        stage: Stage::TobVerzik as i32,
        ..Default::default()
    };
    phase.set_type(proto::event::Type::TobVerzikPhase);
    phase.verzik_phase = Some(proto::event::VerzikPhase::VerzikP2 as i32);

    assert_eq!(builder.ingest([phase]), None);
    assert!(builder.recording().is_none());
    assert_eq!(
        builder.rejections().cloned().collect::<Vec<_>>(),
        [BuildRejection {
            tick: Tick(125),
            kind: proto::event::Type::TobVerzikPhase,
            reason: RejectionReason::WrongStage(Stage::TobVerzik),
        }]
    );
}

#[test]
fn builder_ingest_drops_action_without_actor() {
    let mut builder = RecordingBuilder::new(
        ClientId(9),
        Stage::TobVerzik,
        ChallengeMode::TobRegular,
        vec![
            Rsn::try_from("Sacolyn").unwrap(),
            Rsn::try_from("715").unwrap(),
            Rsn::try_from("1Ogp").unwrap(),
            Rsn::try_from("WWWWWWWWWWQQ").unwrap(),
        ],
        None,
    );

    let mut scythe = proto::Event {
        tick: 385,
        stage: Stage::TobVerzik as i32,
        x_coord: 3164,
        y_coord: 4312,
        ..Default::default()
    };
    scythe.set_type(proto::event::Type::PlayerAttack);
    scythe.player = Some(proto::event::Player {
        name: "Sacolyn".to_string(),
        ..Default::default()
    });
    scythe.player_attack = Some(proto::event::Attack {
        r#type: proto::PlayerAttack::Scythe as i32,
        weapon: Some(proto::event::player::EquippedItem {
            slot: proto::event::player::EquipmentSlot::Weapon as i32,
            id: item::id::SCYTHE_OF_VITUR,
            quantity: 1,
        }),
        target: Some(proto::event::Npc {
            id: 8374,
            room_id: 60963,
            r#type: Some(proto::event::npc::Type::Basic(())),
            ..Default::default()
        }),
        distance_to_target: 1,
    });

    assert_eq!(builder.ingest([scythe]), Some(Tick(385)));
    let state = builder.recording().unwrap().get_state(Tick(385)).unwrap();
    assert!(state.players.is_empty());
    assert_eq!(state.events, []);
    assert_eq!(builder.rejections().count(), 0);
    assert_eq!(builder.warnings().count(), 0);
}

#[test]
fn builder_ingest_player_update() {
    let mut builder = RecordingBuilder::new(
        ClientId(9),
        Stage::TobNylocas,
        ChallengeMode::TobRegular,
        vec![
            Rsn::try_from("Sacolyn").unwrap(),
            Rsn::try_from("1Ogp").unwrap(),
        ],
        None,
    );

    let mut primary_snapshot = proto::Event {
        tick: 0,
        stage: Stage::TobNylocas as i32,
        x_coord: 3296,
        y_coord: 4254,
        ..Default::default()
    };
    primary_snapshot.set_type(proto::event::Type::PlayerUpdate);
    primary_snapshot.player = Some(proto::event::Player {
        name: "Sacolyn".to_string(),
        hitpoints: Some(6_488_163),
        prayer: Some(6_488_163),
        attack: Some(7_733_347),
        strength: Some(7_733_347),
        defence: Some(7_733_347),
        ranged: Some(7_340_131),
        magic: Some(7_340_131),
        equipment_deltas: vec![
            113_711_406_645_249,
            405_610_268_983_297,
            614_500_298_391_553,
            892_582_251_265_007,
            1_259_531_371_806_721,
            1_521_060_520_394_753,
            1_805_902_751_465_473,
            2_084_019_063_750_657,
            2_385_401_213_878_273,
            2_666_837_535_883_265,
            2_936_329_553_838_081,
            3_190_475_653_685_763,
        ],
        active_prayers: Some(0),
        data_source: proto::event::player::DataSource::Primary as i32,
        snapshot: true,
        ..Default::default()
    });
    let mut secondary_snapshot = proto::Event {
        tick: 0,
        stage: Stage::TobNylocas as i32,
        x_coord: 3295,
        y_coord: 4254,
        ..Default::default()
    };
    secondary_snapshot.set_type(proto::event::Type::PlayerUpdate);
    secondary_snapshot.player = Some(proto::event::Player {
        name: "1Ogp".to_string(),
        equipment_deltas: vec![
            113_711_406_645_249,
            405_610_268_983_297,
            658_510_828_273_665,
            1_216_083_482_640_385,
            1_521_060_520_394_753,
            2_084_019_063_750_657,
            2_365_476_860_592_129,
            2_666_837_535_883_265,
        ],
        data_source: proto::event::player::DataSource::Secondary as i32,
        snapshot: true,
        ..Default::default()
    });
    let mut primary_update = proto::Event {
        tick: 1,
        stage: Stage::TobNylocas as i32,
        x_coord: 3296,
        y_coord: 4254,
        ..Default::default()
    };
    primary_update.set_type(proto::event::Type::PlayerUpdate);
    primary_update.player = Some(proto::event::Player {
        name: "Sacolyn".to_string(),
        hitpoints: Some(6_488_163),
        prayer: Some(6_488_163),
        attack: Some(7_733_347),
        strength: Some(7_733_347),
        defence: Some(7_733_347),
        ranged: Some(7_340_131),
        magic: Some(7_340_131),
        equipment_deltas: vec![],
        active_prayers: Some(0),
        data_source: proto::event::player::DataSource::Primary as i32,
        snapshot: false,
        ..Default::default()
    });

    assert_eq!(
        builder.ingest([primary_snapshot, secondary_snapshot, primary_update]),
        Some(Tick(0))
    );
    let recording = builder.recording().unwrap();
    let first = recording.get_state(Tick(0)).unwrap();
    assert_eq!(
        first
            .players
            .iter()
            .map(|(index, _)| index)
            .collect::<Vec<_>>(),
        [PartyIndex::from_usize(0), PartyIndex::from_usize(1)]
    );
    assert_eq!(first.events, []);
    let second = recording.get_state(Tick(1)).unwrap();
    assert_eq!(
        second.players.iter().collect::<Vec<_>>(),
        [(
            PartyIndex::from_usize(0),
            first.players.get(PartyIndex::from_usize(0)).unwrap()
        )]
    );
    assert_eq!(second.events, []);
    assert_eq!(builder.rejections().count(), 0);
    assert_eq!(builder.warnings().count(), 0);
}

#[test]
fn builder_ingest_reverts_last_seen_when_cleared() {
    let mut builder = RecordingBuilder::new(
        ClientId(9),
        Stage::TobNylocas,
        ChallengeMode::TobRegular,
        vec![
            Rsn::try_from("Sacolyn").unwrap(),
            Rsn::try_from("1Ogp").unwrap(),
        ],
        None,
    );

    let mut snapshot = proto::Event {
        tick: 0,
        stage: Stage::TobNylocas as i32,
        x_coord: 3296,
        y_coord: 4254,
        ..Default::default()
    };
    snapshot.set_type(proto::event::Type::PlayerUpdate);
    snapshot.player = Some(proto::event::Player {
        name: "Sacolyn".to_string(),
        hitpoints: Some(6_488_163),
        prayer: Some(6_488_163),
        attack: Some(7_733_347),
        strength: Some(7_733_347),
        defence: Some(7_733_347),
        ranged: Some(7_340_131),
        magic: Some(7_340_131),
        equipment_deltas: vec![
            113_711_406_645_249,
            405_610_268_983_297,
            614_500_298_391_553,
            892_582_251_265_007,
            1_259_531_371_806_721,
            1_521_060_520_394_753,
            1_805_902_751_465_473,
            2_084_019_063_750_657,
            2_385_401_213_878_273,
            2_666_837_535_883_265,
            2_936_329_553_838_081,
            3_190_475_653_685_763,
        ],
        active_prayers: Some(0),
        data_source: proto::event::player::DataSource::Primary as i32,
        snapshot: true,
        ..Default::default()
    });
    let mut first = proto::Event {
        tick: 1,
        stage: Stage::TobNylocas as i32,
        x_coord: 3296,
        y_coord: 4254,
        ..Default::default()
    };
    first.set_type(proto::event::Type::PlayerUpdate);
    first.player = Some(proto::event::Player {
        name: "Sacolyn".to_string(),
        hitpoints: Some(6_488_163),
        prayer: Some(6_488_163),
        attack: Some(7_733_347),
        strength: Some(7_733_347),
        defence: Some(7_733_347),
        ranged: Some(7_340_131),
        magic: Some(7_340_131),
        equipment_deltas: vec![],
        active_prayers: Some(0),
        data_source: proto::event::player::DataSource::Primary as i32,
        snapshot: false,
        ..Default::default()
    });
    let mut second = proto::Event {
        tick: 2,
        stage: Stage::TobNylocas as i32,
        x_coord: 3296,
        y_coord: 4252,
        ..Default::default()
    };
    second.set_type(proto::event::Type::PlayerUpdate);
    second.player = Some(proto::event::Player {
        name: "Sacolyn".to_string(),
        hitpoints: Some(6_488_163),
        prayer: Some(6_488_163),
        attack: Some(7_733_347),
        strength: Some(7_733_347),
        defence: Some(7_733_347),
        ranged: Some(7_340_131),
        magic: Some(7_340_131),
        equipment_deltas: vec![],
        active_prayers: Some(0),
        data_source: proto::event::player::DataSource::Primary as i32,
        snapshot: false,
        ..Default::default()
    });

    assert_eq!(
        builder.ingest([snapshot, first.clone(), second]),
        Some(Tick(0))
    );
    let equipment = builder
        .recording()
        .unwrap()
        .get_state(Tick(0))
        .unwrap()
        .players
        .get(PartyIndex::from_usize(0))
        .unwrap()
        .equipment;

    assert_eq!(builder.ingest([first]), None);
    let recording = builder.recording().unwrap();
    for tick in [Tick(1), Tick(2)] {
        assert_eq!(
            recording
                .get_state(tick)
                .unwrap()
                .players
                .get(PartyIndex::from_usize(0))
                .unwrap()
                .equipment,
            equipment
        );
    }
    assert_eq!(builder.rejections().count(), 0);
}

#[test]
fn builder_ingest_npc_spawn() {
    let mut builder = RecordingBuilder::new(
        ClientId(3),
        Stage::TobNylocas,
        ChallengeMode::TobRegular,
        vec![Rsn::try_from("Caps lock13").unwrap()],
        None,
    );

    let mut spawn = proto::Event {
        tick: 4,
        stage: Stage::TobNylocas as i32,
        x_coord: 3281,
        y_coord: 4248,
        ..Default::default()
    };
    spawn.set_type(proto::event::Type::NpcSpawn);
    spawn.npc = Some(proto::event::Npc {
        id: 8343,
        room_id: 48416,
        hitpoints: 524_296,
        active_prayers: 0,
        r#type: Some(proto::event::npc::Type::Nylo(proto::event::npc::Nylo {
            wave: 1,
            parent_room_id: 0,
            big: false,
            style: proto::event::npc::nylo::Style::Range as i32,
            spawn_type: proto::event::npc::nylo::SpawnType::West as i32,
        })),
    });

    assert_eq!(builder.ingest([spawn]), Some(Tick(4)));
    let state = builder.recording().unwrap().get_state(Tick(4)).unwrap();
    assert_eq!(
        state.npcs,
        BTreeMap::from([(
            RoomId(48416),
            NpcState {
                source: Source::Client(ClientId(3)),
                npc_id: 8343,
                position: Rect::square(Point(3281, 4248), 1),
                hitpoints: SkillLevel::from_raw(524_296),
                prayers: PrayerSet::from_raw(0),
                properties: Some(NpcProperties::Nylo(Nylo {
                    wave: 1,
                    big: false,
                    style: CombatStyle::Ranged,
                    spawn: NyloSpawn::West,
                })),
            }
        )])
    );
    assert_eq!(state.events, []);
    assert_eq!(builder.rejections().count(), 0);
    assert_eq!(builder.warnings().count(), 0);
}

#[test]
fn builder_ingest_maiden_blood_splats() {
    let mut builder = RecordingBuilder::new(
        ClientId(4),
        Stage::TobMaiden,
        ChallengeMode::TobRegular,
        vec![Rsn::try_from("aSaradomin").unwrap()],
        None,
    );

    let mut splats = proto::Event {
        tick: 39,
        stage: Stage::TobMaiden as i32,
        ..Default::default()
    };
    splats.set_type(proto::event::Type::TobMaidenBloodSplats);
    splats.maiden_blood_splats = vec![
        proto::Coords { x: 3177, y: 4444 },
        proto::Coords { x: 3176, y: 4443 },
        proto::Coords { x: 3175, y: 4452 },
        proto::Coords { x: 3175, y: 4443 },
        proto::Coords { x: 3169, y: 4439 },
        proto::Coords { x: 3167, y: 4452 },
    ];

    assert_eq!(builder.ingest([splats]), Some(Tick(39)));
    let state = builder.recording().unwrap().get_state(Tick(39)).unwrap();
    assert_eq!(
        state
            .objects
            .iter_of(ObjectKind::MaidenBloodSplats)
            .collect::<Vec<_>>(),
        [
            Point(3167, 4452),
            Point(3169, 4439),
            Point(3175, 4443),
            Point(3175, 4452),
            Point(3176, 4443),
            Point(3177, 4444),
        ]
    );
    assert_eq!(state.objects.len(), 6);
    assert_eq!(builder.rejections().count(), 0);

    let mut out_of_domain = proto::Event {
        tick: 40,
        stage: Stage::TobMaiden as i32,
        ..Default::default()
    };
    out_of_domain.set_type(proto::event::Type::TobMaidenBloodSplats);
    out_of_domain.maiden_blood_splats = vec![
        proto::Coords { x: 3177, y: 4444 },
        proto::Coords { x: 70000, y: 4443 },
        proto::Coords { x: 3175, y: 4452 },
    ];

    assert_eq!(builder.ingest([out_of_domain]), None);
    assert!(builder.recording().unwrap().get_state(Tick(40)).is_none());
    assert_eq!(
        builder.rejections().cloned().collect::<Vec<_>>(),
        [BuildRejection {
            tick: Tick(40),
            kind: proto::event::Type::TobMaidenBloodSplats,
            reason: RejectionReason::InvalidField {
                field: "maiden_blood_splats",
                error: FieldError::OutOfDomain("(70000,4443)".to_string()),
            },
        }]
    );
}

#[test]
fn builder_ingest_verzik_yellows() {
    let mut builder = RecordingBuilder::new(
        ClientId(11),
        Stage::TobVerzik,
        ChallengeMode::TobRegular,
        vec![Rsn::try_from("LC8").unwrap()],
        None,
    );

    let mut yellows = proto::Event {
        tick: 463,
        stage: Stage::TobVerzik as i32,
        ..Default::default()
    };
    yellows.set_type(proto::event::Type::TobVerzikYellows);
    yellows.verzik_yellows = vec![
        proto::Coords { x: 3179, y: 4320 },
        proto::Coords { x: 3172, y: 4317 },
        proto::Coords { x: 3177, y: 4315 },
    ];

    assert_eq!(builder.ingest([yellows]), Some(Tick(463)));
    let state = builder.recording().unwrap().get_state(Tick(463)).unwrap();
    assert_eq!(
        state
            .objects
            .iter_of(ObjectKind::VerzikYellows)
            .collect::<Vec<_>>(),
        [Point(3172, 4317), Point(3177, 4315), Point(3179, 4320)]
    );
    assert_eq!(state.objects.len(), 3);
    assert_eq!(builder.rejections().count(), 0);

    let mut none = proto::Event {
        tick: 385,
        stage: Stage::TobVerzik as i32,
        ..Default::default()
    };
    none.set_type(proto::event::Type::TobVerzikYellows);

    assert_eq!(builder.ingest([none]), Some(Tick(385)));
    let state = builder.recording().unwrap().get_state(Tick(385)).unwrap();
    assert!(state.objects.is_empty());
    assert_eq!(builder.rejections().count(), 0);
}

#[test]
fn builder_ingest_mokhaiotl_shockwave() {
    let mut builder = RecordingBuilder::new(
        ClientId(2),
        Stage::MokhaiotlDelve8plus,
        ChallengeMode::NoMode,
        vec![Rsn::try_from("Dedion").unwrap()],
        None,
    );

    let mut shockwave = proto::Event {
        tick: 139,
        stage: Stage::MokhaiotlDelve8plus as i32,
        ..Default::default()
    };
    shockwave.set_type(proto::event::Type::MokhaiotlShockwave);
    shockwave.mokhaiotl_shockwave = Some(proto::event::MokhaiotlShockwave {
        tiles: vec![
            proto::Coords { x: 3539, y: 6443 },
            proto::Coords { x: 3540, y: 6449 },
            proto::Coords { x: 3542, y: 6446 },
            proto::Coords { x: 3540, y: 6447 },
            proto::Coords { x: 3541, y: 6440 },
            proto::Coords { x: 3540, y: 6445 },
            proto::Coords { x: 3542, y: 6442 },
            proto::Coords { x: 3539, y: 6441 },
            proto::Coords { x: 3541, y: 6438 },
            proto::Coords { x: 3541, y: 6436 },
            proto::Coords { x: 3541, y: 6449 },
            proto::Coords { x: 3539, y: 6439 },
            proto::Coords { x: 3541, y: 6447 },
            proto::Coords { x: 3539, y: 6437 },
            proto::Coords { x: 3541, y: 6434 },
            proto::Coords { x: 3540, y: 6443 },
            proto::Coords { x: 3542, y: 6440 },
            proto::Coords { x: 3539, y: 6448 },
            proto::Coords { x: 3541, y: 6445 },
            proto::Coords { x: 3540, y: 6441 },
            proto::Coords { x: 3540, y: 6439 },
            proto::Coords { x: 3542, y: 6449 },
            proto::Coords { x: 3541, y: 6432 },
            proto::Coords { x: 3539, y: 6446 },
            proto::Coords { x: 3541, y: 6443 },
            proto::Coords { x: 3543, y: 6438 },
            proto::Coords { x: 3540, y: 6448 },
            proto::Coords { x: 3539, y: 6444 },
            proto::Coords { x: 3541, y: 6441 },
            proto::Coords { x: 3543, y: 6449 },
            proto::Coords { x: 3539, y: 6442 },
            proto::Coords { x: 3541, y: 6439 },
            proto::Coords { x: 3539, y: 6440 },
            proto::Coords { x: 3541, y: 6437 },
            proto::Coords { x: 3540, y: 6446 },
            proto::Coords { x: 3542, y: 6441 },
            proto::Coords { x: 3540, y: 6444 },
            proto::Coords { x: 3540, y: 6442 },
            proto::Coords { x: 3539, y: 6438 },
            proto::Coords { x: 3541, y: 6435 },
            proto::Coords { x: 3541, y: 6448 },
            proto::Coords { x: 3540, y: 6440 },
            proto::Coords { x: 3539, y: 6449 },
            proto::Coords { x: 3539, y: 6436 },
            proto::Coords { x: 3541, y: 6433 },
            proto::Coords { x: 3541, y: 6446 },
            proto::Coords { x: 3541, y: 6444 },
            proto::Coords { x: 3544, y: 6434 },
            proto::Coords { x: 3539, y: 6447 },
            proto::Coords { x: 3539, y: 6445 },
            proto::Coords { x: 3541, y: 6442 },
            proto::Coords { x: 3542, y: 6448 },
            proto::Coords { x: 3540, y: 6438 },
        ],
    });

    assert_eq!(builder.ingest([shockwave]), Some(Tick(139)));
    let state = builder.recording().unwrap().get_state(Tick(139)).unwrap();
    assert_eq!(
        state
            .objects
            .iter_of(ObjectKind::MokhaiotlShockwave)
            .collect::<Vec<_>>(),
        [
            Point(3539, 6436),
            Point(3539, 6437),
            Point(3539, 6438),
            Point(3539, 6439),
            Point(3539, 6440),
            Point(3539, 6441),
            Point(3539, 6442),
            Point(3539, 6443),
            Point(3539, 6444),
            Point(3539, 6445),
            Point(3539, 6446),
            Point(3539, 6447),
            Point(3539, 6448),
            Point(3539, 6449),
            Point(3540, 6438),
            Point(3540, 6439),
            Point(3540, 6440),
            Point(3540, 6441),
            Point(3540, 6442),
            Point(3540, 6443),
            Point(3540, 6444),
            Point(3540, 6445),
            Point(3540, 6446),
            Point(3540, 6447),
            Point(3540, 6448),
            Point(3540, 6449),
            Point(3541, 6432),
            Point(3541, 6433),
            Point(3541, 6434),
            Point(3541, 6435),
            Point(3541, 6436),
            Point(3541, 6437),
            Point(3541, 6438),
            Point(3541, 6439),
            Point(3541, 6440),
            Point(3541, 6441),
            Point(3541, 6442),
            Point(3541, 6443),
            Point(3541, 6444),
            Point(3541, 6445),
            Point(3541, 6446),
            Point(3541, 6447),
            Point(3541, 6448),
            Point(3541, 6449),
            Point(3542, 6440),
            Point(3542, 6441),
            Point(3542, 6442),
            Point(3542, 6446),
            Point(3542, 6448),
            Point(3542, 6449),
            Point(3543, 6438),
            Point(3543, 6449),
            Point(3544, 6434),
        ]
    );
    assert_eq!(state.objects.len(), 53);
    assert_eq!(builder.rejections().count(), 0);

    let mut missing_mokhaiotl_shockwave = proto::Event {
        tick: 108,
        stage: Stage::MokhaiotlDelve8plus as i32,
        ..Default::default()
    };
    missing_mokhaiotl_shockwave.set_type(proto::event::Type::MokhaiotlShockwave);

    assert_eq!(builder.ingest([missing_mokhaiotl_shockwave]), None);
    assert!(builder.recording().unwrap().get_state(Tick(108)).is_none());
    assert_eq!(
        builder.rejections().cloned().collect::<Vec<_>>(),
        [BuildRejection {
            tick: Tick(108),
            kind: proto::event::Type::MokhaiotlShockwave,
            reason: RejectionReason::MissingPayload("mokhaiotl_shockwave"),
        }]
    );
}

#[test]
fn builder_ingest_colosseum_reentry_pools() {
    let mut builder = RecordingBuilder::new(
        ClientId(6),
        Stage::ColosseumWave12,
        ChallengeMode::NoMode,
        vec![Rsn::try_from("Sacolyn").unwrap()],
        None,
    );

    let mut existing = proto::Event {
        tick: 1,
        stage: Stage::ColosseumWave12 as i32,
        ..Default::default()
    };
    existing.set_type(proto::event::Type::ColosseumReentryPools);
    existing.colosseum_reentry_pools = Some(proto::event::ColosseumReentryPools {
        primary_spawned: vec![
            proto::Coords { x: 1816, y: 3116 },
            proto::Coords { x: 1818, y: 3112 },
            proto::Coords { x: 1822, y: 3118 },
            proto::Coords { x: 1824, y: 3118 },
            proto::Coords { x: 1832, y: 3117 },
        ],
        secondary_spawned: vec![
            proto::Coords { x: 1817, y: 3111 },
            proto::Coords { x: 1831, y: 3116 },
        ],
        primary_despawned: vec![],
        secondary_despawned: vec![],
    });

    assert_eq!(builder.ingest([existing]), Some(Tick(1)));
    let state = builder.recording().unwrap().get_state(Tick(1)).unwrap();
    assert_eq!(
        state
            .objects
            .iter_of(ObjectKind::ColosseumReentryPrimaryPool)
            .collect::<Vec<_>>(),
        [
            Point(1816, 3116),
            Point(1818, 3112),
            Point(1822, 3118),
            Point(1824, 3118),
            Point(1832, 3117),
        ]
    );
    assert_eq!(
        state
            .objects
            .iter_of(ObjectKind::ColosseumReentrySecondaryPool)
            .collect::<Vec<_>>(),
        [Point(1817, 3111), Point(1831, 3116)]
    );
    assert_eq!(state.objects.len(), 7);

    let mut shrunk = proto::Event {
        tick: 5,
        stage: Stage::ColosseumWave12 as i32,
        ..Default::default()
    };
    shrunk.set_type(proto::event::Type::ColosseumReentryPools);
    shrunk.colosseum_reentry_pools = Some(proto::event::ColosseumReentryPools {
        primary_spawned: vec![
            proto::Coords { x: 1818, y: 3112 },
            proto::Coords { x: 1816, y: 3116 },
            proto::Coords { x: 1822, y: 3118 },
            proto::Coords { x: 1824, y: 3118 },
            proto::Coords { x: 1832, y: 3117 },
        ],
        secondary_spawned: vec![
            proto::Coords { x: 1817, y: 3111 },
            proto::Coords { x: 1831, y: 3116 },
        ],
        primary_despawned: vec![
            proto::Coords { x: 1818, y: 3112 },
            proto::Coords { x: 1816, y: 3116 },
            proto::Coords { x: 1822, y: 3118 },
            proto::Coords { x: 1824, y: 3118 },
            proto::Coords { x: 1832, y: 3117 },
        ],
        secondary_despawned: vec![
            proto::Coords { x: 1817, y: 3111 },
            proto::Coords { x: 1831, y: 3116 },
        ],
    });

    assert_eq!(builder.ingest([shrunk]), Some(Tick(5)));
    let state = builder.recording().unwrap().get_state(Tick(5)).unwrap();
    assert!(state.objects.is_empty());
    assert_eq!(builder.rejections().count(), 0);

    let mut builder = RecordingBuilder::new(
        ClientId(6),
        Stage::ColosseumWave5,
        ChallengeMode::NoMode,
        vec![Rsn::try_from("Sacolyn").unwrap()],
        None,
    );
    let mut out_of_domain = proto::Event {
        tick: 46,
        stage: Stage::ColosseumWave5 as i32,
        ..Default::default()
    };
    out_of_domain.set_type(proto::event::Type::ColosseumReentryPools);
    out_of_domain.colosseum_reentry_pools = Some(proto::event::ColosseumReentryPools {
        primary_spawned: vec![proto::Coords { x: 1818, y: 70000 }],
        secondary_spawned: vec![],
        primary_despawned: vec![],
        secondary_despawned: vec![],
    });

    assert_eq!(builder.ingest([out_of_domain]), None);
    assert!(builder.recording().unwrap().get_state(Tick(46)).is_none());
    assert_eq!(
        builder.rejections().cloned().collect::<Vec<_>>(),
        [BuildRejection {
            tick: Tick(46),
            kind: proto::event::Type::ColosseumReentryPools,
            reason: RejectionReason::InvalidField {
                field: "colosseum_reentry_pools.primary_spawned",
                error: FieldError::OutOfDomain("(1818,70000)".to_string()),
            },
        }]
    );
}

#[test]
fn builder_ingest_mokhaiotl_objects() {
    let mut builder = RecordingBuilder::new(
        ClientId(8),
        Stage::MokhaiotlDelve8plus,
        ChallengeMode::NoMode,
        vec![Rsn::try_from("LC8").unwrap()],
        None,
    );

    let mut splats = proto::Event {
        tick: 37,
        stage: Stage::MokhaiotlDelve8plus as i32,
        ..Default::default()
    };
    splats.set_type(proto::event::Type::MokhaiotlObjects);
    splats.mokhaiotl_objects = Some(proto::event::MokhaiotlObjects {
        rocks_spawned: vec![],
        rocks_despawned: vec![],
        splats_spawned: vec![
            proto::Coords { x: 3556, y: 6439 },
            proto::Coords { x: 3555, y: 6440 },
        ],
        splats_despawned: vec![],
    });
    let mut splat = proto::Event {
        tick: 38,
        stage: Stage::MokhaiotlDelve8plus as i32,
        ..Default::default()
    };
    splat.set_type(proto::event::Type::MokhaiotlObjects);
    splat.mokhaiotl_objects = Some(proto::event::MokhaiotlObjects {
        rocks_spawned: vec![],
        rocks_despawned: vec![],
        splats_spawned: vec![proto::Coords { x: 3553, y: 6436 }],
        splats_despawned: vec![],
    });
    let mut rock = proto::Event {
        tick: 39,
        stage: Stage::MokhaiotlDelve8plus as i32,
        ..Default::default()
    };
    rock.set_type(proto::event::Type::MokhaiotlObjects);
    rock.mokhaiotl_objects = Some(proto::event::MokhaiotlObjects {
        rocks_spawned: vec![proto::Coords { x: 3547, y: 6440 }],
        rocks_despawned: vec![],
        splats_spawned: vec![],
        splats_despawned: vec![],
    });

    assert_eq!(builder.ingest([splats, splat, rock]), Some(Tick(37)));
    let recording = builder.recording().unwrap();
    assert_eq!(
        recording
            .get_state(Tick(37))
            .unwrap()
            .objects
            .iter()
            .collect::<Vec<_>>(),
        [
            (ObjectKind::MokhaiotlSplat, Point(3555, 6440)),
            (ObjectKind::MokhaiotlSplat, Point(3556, 6439)),
        ]
    );
    assert_eq!(
        recording
            .get_state(Tick(38))
            .unwrap()
            .objects
            .iter()
            .collect::<Vec<_>>(),
        [
            (ObjectKind::MokhaiotlSplat, Point(3553, 6436)),
            (ObjectKind::MokhaiotlSplat, Point(3555, 6440)),
            (ObjectKind::MokhaiotlSplat, Point(3556, 6439)),
        ]
    );
    assert_eq!(
        recording
            .get_state(Tick(39))
            .unwrap()
            .objects
            .iter()
            .collect::<Vec<_>>(),
        [
            (ObjectKind::MokhaiotlRock, Point(3547, 6440)),
            (ObjectKind::MokhaiotlSplat, Point(3553, 6436)),
            (ObjectKind::MokhaiotlSplat, Point(3555, 6440)),
            (ObjectKind::MokhaiotlSplat, Point(3556, 6439)),
        ]
    );
    assert_eq!(builder.rejections().count(), 0);

    let mut missing_mokhaiotl_objects = proto::Event {
        tick: 42,
        stage: Stage::MokhaiotlDelve8plus as i32,
        ..Default::default()
    };
    missing_mokhaiotl_objects.set_type(proto::event::Type::MokhaiotlObjects);

    assert_eq!(builder.ingest([missing_mokhaiotl_objects]), None);
    assert!(builder.recording().unwrap().get_state(Tick(42)).is_none());
    assert_eq!(
        builder.rejections().cloned().collect::<Vec<_>>(),
        [BuildRejection {
            tick: Tick(42),
            kind: proto::event::Type::MokhaiotlObjects,
            reason: RejectionReason::MissingPayload("mokhaiotl_objects"),
        }]
    );
}

#[test]
fn builder_ingest_sote_maze_tiles() {
    let mut builder = RecordingBuilder::new(
        ClientId(6),
        Stage::TobSotetseg,
        ChallengeMode::TobRegular,
        vec![Rsn::try_from("Yieldofin").unwrap()],
        None,
    );

    let mut first = proto::Event {
        tick: 71,
        stage: Stage::TobSotetseg as i32,
        ..Default::default()
    };
    first.set_type(proto::event::Type::TobSoteMazePath);
    first.sote_maze = Some(proto::event::SoteMaze {
        maze: proto::event::sote_maze::Maze::Maze66 as i32,
        overworld_tiles: vec![proto::Coords { x: 11, y: 0 }],
        overworld_pivots: vec![],
        underworld_pivots: vec![],
        chosen_player: None,
    });
    let mut second = proto::Event {
        tick: 72,
        stage: Stage::TobSotetseg as i32,
        ..Default::default()
    };
    second.set_type(proto::event::Type::TobSoteMazePath);
    second.sote_maze = Some(proto::event::SoteMaze {
        maze: proto::event::sote_maze::Maze::Maze66 as i32,
        overworld_tiles: vec![proto::Coords { x: 10, y: 1 }],
        overworld_pivots: vec![],
        underworld_pivots: vec![],
        chosen_player: None,
    });

    assert_eq!(builder.ingest([first, second]), Some(Tick(71)));
    let recording = builder.recording().unwrap();
    let state = recording.get_state(Tick(71)).unwrap();
    assert_eq!(
        state.objects.iter().collect::<Vec<_>>(),
        [(ObjectKind::SoteMazeTiles, Point(11, 0))]
    );
    assert_eq!(state.events, []);
    let state = recording.get_state(Tick(72)).unwrap();
    assert_eq!(
        state.objects.iter().collect::<Vec<_>>(),
        [(ObjectKind::SoteMazeTiles, Point(10, 1))]
    );
    assert_eq!(state.events, []);
    assert_eq!(builder.rejections().count(), 0);
}

#[test]
fn builder_ingest_sote_maze_pivots() {
    let mut builder = RecordingBuilder::new(
        ClientId(6),
        Stage::TobSotetseg,
        ChallengeMode::TobRegular,
        vec![Rsn::try_from("Yieldofin").unwrap()],
        None,
    );

    let mut overworld = proto::Event {
        tick: 94,
        stage: Stage::TobSotetseg as i32,
        ..Default::default()
    };
    overworld.set_type(proto::event::Type::TobSoteMazePath);
    overworld.sote_maze = Some(proto::event::SoteMaze {
        maze: proto::event::sote_maze::Maze::Maze66 as i32,
        overworld_tiles: vec![],
        overworld_pivots: vec![
            proto::Coords { x: 11, y: 0 },
            proto::Coords { x: 7, y: 2 },
            proto::Coords { x: 12, y: 4 },
            proto::Coords { x: 11, y: 6 },
            proto::Coords { x: 11, y: 8 },
            proto::Coords { x: 9, y: 10 },
            proto::Coords { x: 6, y: 12 },
            proto::Coords { x: 6, y: 14 },
        ],
        underworld_pivots: vec![],
        chosen_player: None,
    });

    assert_eq!(builder.ingest([overworld]), Some(Tick(94)));
    let state = builder.recording().unwrap().get_state(Tick(94)).unwrap();
    assert!(state.objects.is_empty());
    assert_eq!(
        state.events,
        [Event::recorded(
            ClientId(6),
            EventKind::SoteMazePivots(SoteMazePivots {
                maze: Maze::Maze66,
                overworld: vec![
                    Point(11, 0),
                    Point(7, 2),
                    Point(12, 4),
                    Point(11, 6),
                    Point(11, 8),
                    Point(9, 10),
                    Point(6, 12),
                    Point(6, 14),
                ],
                underworld: vec![],
            })
        )]
    );
    assert_eq!(builder.rejections().count(), 0);

    let mut builder = RecordingBuilder::new(
        ClientId(11),
        Stage::TobSotetseg,
        ChallengeMode::TobRegular,
        vec![Rsn::try_from("Caywu").unwrap()],
        None,
    );

    let mut underworld = proto::Event {
        tick: 91,
        stage: Stage::TobSotetseg as i32,
        ..Default::default()
    };
    underworld.set_type(proto::event::Type::TobSoteMazePath);
    underworld.sote_maze = Some(proto::event::SoteMaze {
        maze: proto::event::sote_maze::Maze::Maze66 as i32,
        overworld_tiles: vec![],
        overworld_pivots: vec![],
        underworld_pivots: vec![
            proto::Coords { x: 11, y: 0 },
            proto::Coords { x: 11, y: 8 },
            proto::Coords { x: 11, y: 6 },
            proto::Coords { x: 12, y: 4 },
            proto::Coords { x: 7, y: 2 },
            proto::Coords { x: 6, y: 14 },
            proto::Coords { x: 6, y: 12 },
            proto::Coords { x: 9, y: 10 },
        ],
        chosen_player: None,
    });

    assert_eq!(builder.ingest([underworld]), Some(Tick(91)));
    let state = builder.recording().unwrap().get_state(Tick(91)).unwrap();
    assert!(state.objects.is_empty());
    assert_eq!(
        state.events,
        [Event::recorded(
            ClientId(11),
            EventKind::SoteMazePivots(SoteMazePivots {
                maze: Maze::Maze66,
                overworld: vec![],
                underworld: vec![
                    Point(11, 0),
                    Point(11, 8),
                    Point(11, 6),
                    Point(12, 4),
                    Point(7, 2),
                    Point(6, 14),
                    Point(6, 12),
                    Point(9, 10),
                ],
            })
        )]
    );
    assert_eq!(builder.rejections().count(), 0);

    let mut missing_sote_maze = proto::Event {
        tick: 95,
        stage: Stage::TobSotetseg as i32,
        ..Default::default()
    };
    missing_sote_maze.set_type(proto::event::Type::TobSoteMazePath);
    let mut missing_pivots = proto::Event {
        tick: 96,
        stage: Stage::TobSotetseg as i32,
        ..Default::default()
    };
    missing_pivots.set_type(proto::event::Type::TobSoteMazePath);
    missing_pivots.sote_maze = Some(proto::event::SoteMaze {
        maze: proto::event::sote_maze::Maze::Maze66 as i32,
        overworld_tiles: vec![],
        overworld_pivots: vec![],
        underworld_pivots: vec![],
        chosen_player: None,
    });

    assert_eq!(builder.ingest([missing_sote_maze, missing_pivots]), None);
    let recording = builder.recording().unwrap();
    assert!(recording.get_state(Tick(95)).is_none());
    assert!(recording.get_state(Tick(96)).is_none());
    assert_eq!(
        builder.rejections().cloned().collect::<Vec<_>>(),
        [
            BuildRejection {
                tick: Tick(95),
                kind: proto::event::Type::TobSoteMazePath,
                reason: RejectionReason::MissingPayload("sote_maze"),
            },
            BuildRejection {
                tick: Tick(96),
                kind: proto::event::Type::TobSoteMazePath,
                reason: RejectionReason::MissingPayload("sote_maze.overworld_pivots"),
            },
        ]
    );
}

#[test]
fn builder_ingest_attack_style() {
    let mut builder = RecordingBuilder::new(
        ClientId(2),
        Stage::TobVerzik,
        ChallengeMode::TobRegular,
        vec![
            Rsn::try_from("Sacolyn").unwrap(),
            Rsn::try_from("1Ogp").unwrap(),
        ],
        None,
    );

    let mut verzik = proto::Event {
        tick: 271,
        stage: Stage::TobVerzik as i32,
        x_coord: 3165,
        y_coord: 4311,
        ..Default::default()
    };
    verzik.set_type(proto::event::Type::NpcUpdate);
    verzik.npc = Some(proto::event::Npc {
        id: 8374,
        room_id: 45910,
        hitpoints: 152_963_461,
        active_prayers: 0,
        r#type: Some(proto::event::npc::Type::Basic(())),
    });
    let mut auto = proto::Event {
        tick: 271,
        stage: Stage::TobVerzik as i32,
        x_coord: 3165,
        y_coord: 4311,
        ..Default::default()
    };
    auto.set_type(proto::event::Type::NpcAttack);
    auto.npc = Some(proto::event::Npc {
        id: 8374,
        room_id: 45910,
        r#type: Some(proto::event::npc::Type::Basic(())),
        ..Default::default()
    });
    auto.npc_attack = Some(proto::event::NpcAttacked {
        attack: proto::NpcAttack::TobVerzikP3Auto as i32,
        target: Some("1Ogp".to_string()),
    });

    assert_eq!(builder.ingest([verzik, auto]), Some(Tick(271)));

    let mut style = proto::Event {
        tick: 273,
        stage: Stage::TobVerzik as i32,
        ..Default::default()
    };
    style.set_type(proto::event::Type::TobVerzikAttackStyle);
    style.verzik_attack_style = Some(proto::event::AttackStyle {
        style: proto::event::attack_style::Style::Mage as i32,
        npc_attack_tick: 271,
    });

    assert_eq!(builder.ingest([style.clone()]), Some(Tick(271)));
    let recording = builder.recording().unwrap();
    assert_eq!(
        recording.get_state(Tick(271)).unwrap().events,
        [Event::recorded(
            ClientId(2),
            EventKind::NpcAttack(NpcAttacked {
                npc: RoomId(45910),
                attack: NpcAttack::TobVerzikP3Mage,
                target: Some(Actor::Player(PartyIndex::from_usize(1))),
            })
        )]
    );
    assert_eq!(recording.get_state(Tick(273)).unwrap().events, []);
    assert_eq!(builder.rejections().count(), 0);

    assert_eq!(builder.ingest([style]), None);
    assert_eq!(
        builder
            .recording()
            .unwrap()
            .get_state(Tick(271))
            .unwrap()
            .events,
        [Event::recorded(
            ClientId(2),
            EventKind::NpcAttack(NpcAttacked {
                npc: RoomId(45910),
                attack: NpcAttack::TobVerzikP3Mage,
                target: Some(Actor::Player(PartyIndex::from_usize(1))),
            })
        )]
    );
    assert_eq!(builder.rejections().count(), 0);

    let mut unmatched = proto::Event {
        tick: 280,
        stage: Stage::TobVerzik as i32,
        ..Default::default()
    };
    unmatched.set_type(proto::event::Type::TobVerzikAttackStyle);
    unmatched.verzik_attack_style = Some(proto::event::AttackStyle {
        style: proto::event::attack_style::Style::Mage as i32,
        npc_attack_tick: 278,
    });

    assert_eq!(builder.ingest([unmatched]), None);
    assert!(builder.recording().unwrap().get_state(Tick(280)).is_none());
    assert_eq!(
        builder.rejections().cloned().collect::<Vec<_>>(),
        [BuildRejection {
            tick: Tick(280),
            kind: proto::event::Type::TobVerzikAttackStyle,
            reason: RejectionReason::AttackNotFound,
        }]
    );
}

#[test]
fn builder_ingest_attack_style_same_tick() {
    let mut builder = RecordingBuilder::new(
        ClientId(378),
        Stage::MokhaiotlDelve4,
        ChallengeMode::NoMode,
        vec![Rsn::try_from("1Ogp").unwrap()],
        None,
    );

    let mut doom = proto::Event {
        tick: 25,
        stage: Stage::MokhaiotlDelve4 as i32,
        x_coord: 3421,
        y_coord: 6435,
        ..Default::default()
    };
    doom.set_type(proto::event::Type::NpcUpdate);
    doom.npc = Some(proto::event::Npc {
        id: 14707,
        room_id: 47491,
        hitpoints: 29_557_336,
        active_prayers: 0,
        r#type: Some(proto::event::npc::Type::Basic(())),
    });
    let mut auto = proto::Event {
        tick: 26,
        stage: Stage::MokhaiotlDelve4 as i32,
        x_coord: 3421,
        y_coord: 6435,
        ..Default::default()
    };
    auto.set_type(proto::event::Type::NpcAttack);
    auto.npc = Some(proto::event::Npc {
        id: 14707,
        room_id: 47491,
        r#type: Some(proto::event::npc::Type::Basic(())),
        ..Default::default()
    });
    auto.npc_attack = Some(proto::event::NpcAttacked {
        attack: proto::NpcAttack::MokhaiotlAuto as i32,
        target: Some("1Ogp".to_string()),
    });

    builder.ingest([doom.clone(), auto]);

    let mut style = proto::Event {
        tick: 26,
        stage: Stage::MokhaiotlDelve4 as i32,
        ..Default::default()
    };
    style.set_type(proto::event::Type::MokhaiotlAttackStyle);
    style.mokhaiotl_attack_style = Some(proto::event::AttackStyle {
        style: proto::event::attack_style::Style::Mage as i32,
        npc_attack_tick: 26,
    });
    doom.tick = 26;

    assert_eq!(builder.ingest([style, doom]), Some(Tick(26)));
    assert_eq!(
        builder
            .recording()
            .unwrap()
            .get_state(Tick(26))
            .unwrap()
            .events,
        [Event::recorded(
            ClientId(378),
            EventKind::NpcAttack(NpcAttacked {
                npc: RoomId(47491),
                attack: NpcAttack::MokhaiotlMageAuto,
                target: Some(Actor::Player(PartyIndex::from_usize(0))),
            })
        )]
    );
    assert_eq!(builder.rejections().count(), 0);
}

#[test]
fn builder_ingest_attack_reference() {
    let mut builder = RecordingBuilder::new(
        ClientId(2),
        Stage::TobVerzik,
        ChallengeMode::TobRegular,
        vec![
            Rsn::try_from("Sacolyn").unwrap(),
            Rsn::try_from("1Ogp").unwrap(),
        ],
        None,
    );

    let mut verzik_cabbage = proto::Event {
        tick: 83,
        stage: Stage::TobVerzik as i32,
        x_coord: 3167,
        y_coord: 4313,
        ..Default::default()
    };
    verzik_cabbage.set_type(proto::event::Type::NpcUpdate);
    verzik_cabbage.npc = Some(proto::event::Npc {
        id: 8372,
        room_id: 45910,
        hitpoints: 157_223_301,
        active_prayers: 0,
        r#type: Some(proto::event::npc::Type::Basic(())),
    });
    let mut cabbage = proto::Event {
        tick: 83,
        stage: Stage::TobVerzik as i32,
        x_coord: 3167,
        y_coord: 4313,
        ..Default::default()
    };
    cabbage.set_type(proto::event::Type::NpcAttack);
    cabbage.npc = Some(proto::event::Npc {
        id: 8372,
        room_id: 45910,
        r#type: Some(proto::event::npc::Type::Basic(())),
        ..Default::default()
    });
    cabbage.npc_attack = Some(proto::event::NpcAttacked {
        attack: proto::NpcAttack::TobVerzikP2Cabbage as i32,
        target: None,
    });
    let mut bounce_chance = proto::Event {
        tick: 83,
        stage: Stage::TobVerzik as i32,
        ..Default::default()
    };
    bounce_chance.set_type(proto::event::Type::TobVerzikBounce);
    bounce_chance.verzik_bounce = Some(proto::event::VerzikBounce {
        npc_attack_tick: 83,
        players_in_range: 0,
        players_not_in_range: 3,
        bounced_player: None,
    });
    let mut verzik_bounce = proto::Event {
        tick: 215,
        stage: Stage::TobVerzik as i32,
        x_coord: 3167,
        y_coord: 4313,
        ..Default::default()
    };
    verzik_bounce.set_type(proto::event::Type::NpcUpdate);
    verzik_bounce.npc = Some(proto::event::Npc {
        id: 8372,
        room_id: 45910,
        hitpoints: 35_129_733,
        active_prayers: 0,
        r#type: Some(proto::event::npc::Type::Basic(())),
    });
    let mut bounce = proto::Event {
        tick: 215,
        stage: Stage::TobVerzik as i32,
        x_coord: 3167,
        y_coord: 4313,
        ..Default::default()
    };
    bounce.set_type(proto::event::Type::NpcAttack);
    bounce.npc = Some(proto::event::Npc {
        id: 8372,
        room_id: 45910,
        r#type: Some(proto::event::npc::Type::Basic(())),
        ..Default::default()
    });
    bounce.npc_attack = Some(proto::event::NpcAttacked {
        attack: proto::NpcAttack::TobVerzikP2Bounce as i32,
        target: None,
    });
    let mut bounced = proto::Event {
        tick: 216,
        stage: Stage::TobVerzik as i32,
        ..Default::default()
    };
    bounced.set_type(proto::event::Type::TobVerzikBounce);
    bounced.verzik_bounce = Some(proto::event::VerzikBounce {
        npc_attack_tick: 215,
        players_in_range: 1,
        players_not_in_range: 2,
        bounced_player: Some("Sacolyn".to_string()),
    });

    assert_eq!(
        builder.ingest([
            verzik_cabbage,
            cabbage,
            bounce_chance,
            verzik_bounce.clone(),
            bounce,
            bounced.clone()
        ]),
        Some(Tick(83))
    );
    let recording = builder.recording().unwrap();
    assert_eq!(
        recording.get_state(Tick(83)).unwrap().events,
        [
            Event::recorded(
                ClientId(2),
                EventKind::NpcAttack(NpcAttacked {
                    npc: RoomId(45910),
                    attack: NpcAttack::TobVerzikP2Cabbage,
                    target: None,
                })
            ),
            Event::recorded(
                ClientId(2),
                EventKind::VerzikBounce(VerzikBounce {
                    attack_tick: Tick(83),
                    players_in_range: 0,
                    bounced: None,
                })
            ),
        ]
    );
    assert_eq!(
        recording.get_state(Tick(215)).unwrap().events,
        [Event::recorded(
            ClientId(2),
            EventKind::NpcAttack(NpcAttacked {
                npc: RoomId(45910),
                attack: NpcAttack::TobVerzikP2Bounce,
                target: None,
            })
        )]
    );
    assert_eq!(
        recording.get_state(Tick(216)).unwrap().events,
        [Event::recorded(
            ClientId(2),
            EventKind::VerzikBounce(VerzikBounce {
                attack_tick: Tick(215),
                players_in_range: 1,
                bounced: Some(PartyIndex::from_usize(0)),
            })
        )]
    );
    assert_eq!(builder.rejections().count(), 0);

    let mut builder = RecordingBuilder::new(
        ClientId(2),
        Stage::TobVerzik,
        ChallengeMode::TobRegular,
        vec![
            Rsn::try_from("Sacolyn").unwrap(),
            Rsn::try_from("1Ogp").unwrap(),
        ],
        None,
    );
    assert_eq!(builder.ingest([verzik_bounce, bounced]), Some(Tick(215)));
    assert!(builder.recording().unwrap().get_state(Tick(216)).is_none());
    assert_eq!(
        builder.rejections().cloned().collect::<Vec<_>>(),
        [BuildRejection {
            tick: Tick(216),
            kind: proto::event::Type::TobVerzikBounce,
            reason: RejectionReason::AttackNotFound,
        }]
    );
}

#[test]
fn extract_player_state_snapshot() {
    let party = vec![
        Rsn::try_from("Sacolyn").unwrap(),
        Rsn::try_from("1Ogp").unwrap(),
    ];
    let recording = Recording::vacant(
        Stage::TobNylocas,
        ChallengeMode::TobRegular,
        party.clone(),
        Tick(6),
    );
    let last_seen_actors = HashMap::new();

    let mut snapshot = proto::Event {
        tick: 0,
        stage: Stage::TobNylocas as i32,
        x_coord: 3296,
        y_coord: 4254,
        ..Default::default()
    };
    snapshot.set_type(proto::event::Type::PlayerUpdate);
    snapshot.player = Some(proto::event::Player {
        name: "Sacolyn".to_string(),
        hitpoints: Some(6_488_163),
        prayer: Some(6_488_163),
        attack: Some(7_733_347),
        strength: Some(7_733_347),
        defence: Some(7_733_347),
        ranged: Some(7_340_131),
        magic: Some(7_340_131),
        equipment_deltas: vec![
            113_711_406_645_249,
            405_610_268_983_297,
            614_500_298_391_553,
            892_582_251_265_007,
            1_259_531_371_806_721,
            1_521_060_520_394_753,
            1_805_902_751_465_473,
            2_084_019_063_750_657,
            2_385_401_213_878_273,
            2_666_837_535_883_265,
            2_936_329_553_838_081,
            3_190_475_653_685_763,
        ],
        active_prayers: Some(0),
        data_source: proto::event::player::DataSource::Primary as i32,
        snapshot: true,
        ..Default::default()
    });
    assert_eq!(
        extract_player_state(
            ClientId(9),
            &party,
            &recording,
            &last_seen_actors,
            &snapshot
        ),
        Ok((
            PartyIndex::from_usize(0),
            PlayerState {
                source: Source::Client(ClientId(9)),
                position: Point(3296, 4254),
                equipment: [
                    Some(Item {
                        id: 26475,
                        quantity: 1,
                    }),
                    Some(Item {
                        id: 28902,
                        quantity: 1,
                    }),
                    Some(Item {
                        id: 12002,
                        quantity: 1,
                    }),
                    Some(Item {
                        id: 11212,
                        quantity: 326_639,
                    }),
                    Some(Item {
                        id: 31113,
                        quantity: 1,
                    }),
                    Some(Item {
                        id: 26469,
                        quantity: 1,
                    }),
                    Some(Item {
                        id: 27253,
                        quantity: 1,
                    }),
                    Some(Item {
                        id: 26471,
                        quantity: 1,
                    }),
                    Some(Item {
                        id: 31106,
                        quantity: 1,
                    }),
                    Some(Item {
                        id: 31097,
                        quantity: 1,
                    }),
                    Some(Item {
                        id: 28307,
                        quantity: 1,
                    }),
                    Some(Item {
                        id: 21944,
                        quantity: 41475,
                    }),
                ],
                prayers: PrayerSet::from_raw(0),
                data: DataSource::Primary(Stats {
                    hitpoints: SkillLevel::from_raw(6_488_163),
                    prayer: SkillLevel::from_raw(6_488_163),
                    attack: SkillLevel::from_raw(7_733_347),
                    strength: SkillLevel::from_raw(7_733_347),
                    defence: SkillLevel::from_raw(7_733_347),
                    ranged: SkillLevel::from_raw(7_340_131),
                    magic: SkillLevel::from_raw(7_340_131),
                }),
            }
        ))
    );

    let mut secondary = proto::Event {
        tick: 0,
        stage: Stage::TobNylocas as i32,
        x_coord: 3295,
        y_coord: 4254,
        ..Default::default()
    };
    secondary.set_type(proto::event::Type::PlayerUpdate);
    secondary.player = Some(proto::event::Player {
        name: "1Ogp".to_string(),
        equipment_deltas: vec![
            113_711_406_645_249,
            405_610_268_983_297,
            658_510_828_273_665,
            1_216_083_482_640_385,
            1_521_060_520_394_753,
            2_084_019_063_750_657,
            2_365_476_860_592_129,
            2_666_837_535_883_265,
        ],
        data_source: proto::event::player::DataSource::Secondary as i32,
        snapshot: true,
        ..Default::default()
    });
    assert_eq!(
        extract_player_state(
            ClientId(9),
            &party,
            &recording,
            &last_seen_actors,
            &secondary
        ),
        Ok((
            PartyIndex::from_usize(1),
            PlayerState {
                source: Source::Client(ClientId(9)),
                position: Point(3295, 4254),
                equipment: [
                    Some(Item {
                        id: 26475,
                        quantity: 1,
                    }),
                    Some(Item {
                        id: 28902,
                        quantity: 1,
                    }),
                    Some(Item {
                        id: 22249,
                        quantity: 1,
                    }),
                    None,
                    Some(Item {
                        id: 20997,
                        quantity: 1,
                    }),
                    Some(Item {
                        id: 26469,
                        quantity: 1,
                    }),
                    None,
                    Some(Item {
                        id: 26471,
                        quantity: 1,
                    }),
                    Some(Item {
                        id: 26467,
                        quantity: 1,
                    }),
                    Some(Item {
                        id: 31097,
                        quantity: 1,
                    }),
                    None,
                    None,
                ],
                prayers: PrayerSet::from_raw(0),
                data: DataSource::Secondary,
            }
        ))
    );

    let mut missing_player = proto::Event {
        tick: 1,
        stage: Stage::TobNylocas as i32,
        x_coord: 3296,
        y_coord: 4254,
        ..Default::default()
    };
    missing_player.set_type(proto::event::Type::PlayerUpdate);
    assert_eq!(
        extract_player_state(
            ClientId(9),
            &party,
            &recording,
            &last_seen_actors,
            &missing_player
        ),
        Err(RejectionReason::MissingPayload("player"))
    );

    let mut unknown_player = proto::Event {
        tick: 0,
        stage: Stage::TobNylocas as i32,
        x_coord: 3295,
        y_coord: 4254,
        ..Default::default()
    };
    unknown_player.set_type(proto::event::Type::PlayerUpdate);
    unknown_player.player = Some(proto::event::Player {
        name: "YearOfCow".to_string(),
        equipment_deltas: vec![
            113_711_406_645_249,
            405_837_902_249_985,
            690_946_421_293_057,
            1_259_531_371_806_721,
            1_521_060_520_394_753,
            1_799_739_473_395_713,
            2_084_019_063_750_657,
            2_365_476_860_592_129,
            2_666_837_535_883_265,
        ],
        data_source: proto::event::player::DataSource::Secondary as i32,
        snapshot: true,
        ..Default::default()
    });
    assert_eq!(
        extract_player_state(
            ClientId(9),
            &party,
            &recording,
            &last_seen_actors,
            &unknown_player
        ),
        Err(RejectionReason::InvalidField {
            field: "player.name",
            error: FieldError::UnknownActor(RawActor::Player("YearOfCow".to_string())),
        })
    );

    let mut missing_stat = proto::Event {
        tick: 1,
        stage: Stage::TobNylocas as i32,
        x_coord: 3296,
        y_coord: 4254,
        ..Default::default()
    };
    missing_stat.set_type(proto::event::Type::PlayerUpdate);
    missing_stat.player = Some(proto::event::Player {
        name: "Sacolyn".to_string(),
        hitpoints: Some(6_488_163),
        prayer: Some(6_488_163),
        attack: Some(7_733_347),
        strength: Some(7_733_347),
        defence: Some(7_733_347),
        ranged: Some(7_340_131),
        magic: None,
        equipment_deltas: vec![],
        active_prayers: Some(0),
        data_source: proto::event::player::DataSource::Primary as i32,
        snapshot: false,
        ..Default::default()
    });
    assert_eq!(
        extract_player_state(
            ClientId(9),
            &party,
            &recording,
            &last_seen_actors,
            &missing_stat
        ),
        Err(RejectionReason::MissingPayload("player.magic"))
    );

    let mut unknown_data_source = proto::Event {
        tick: 1,
        stage: Stage::TobNylocas as i32,
        x_coord: 3296,
        y_coord: 4254,
        ..Default::default()
    };
    unknown_data_source.set_type(proto::event::Type::PlayerUpdate);
    unknown_data_source.player = Some(proto::event::Player {
        name: "Sacolyn".to_string(),
        hitpoints: Some(6_488_163),
        prayer: Some(6_488_163),
        attack: Some(7_733_347),
        strength: Some(7_733_347),
        defence: Some(7_733_347),
        ranged: Some(7_340_131),
        magic: Some(7_340_131),
        equipment_deltas: vec![],
        active_prayers: Some(0),
        data_source: 7,
        snapshot: false,
        ..Default::default()
    });
    assert_eq!(
        extract_player_state(
            ClientId(9),
            &party,
            &recording,
            &last_seen_actors,
            &unknown_data_source
        ),
        Err(RejectionReason::InvalidField {
            field: "player.data_source",
            error: FieldError::OutOfDomain("7".to_string()),
        })
    );

    let mut unknown_slot = proto::Event {
        tick: 0,
        stage: Stage::TobNylocas as i32,
        x_coord: 3295,
        y_coord: 4254,
        ..Default::default()
    };
    unknown_slot.set_type(proto::event::Type::PlayerUpdate);
    unknown_slot.player = Some(proto::event::Player {
        name: "1Ogp".to_string(),
        equipment_deltas: vec![3_491_411_127_173_121],
        data_source: proto::event::player::DataSource::Secondary as i32,
        snapshot: true,
        ..Default::default()
    });
    assert_eq!(
        extract_player_state(
            ClientId(9),
            &party,
            &recording,
            &last_seen_actors,
            &unknown_slot
        ),
        Err(RejectionReason::InvalidField {
            field: "player.equipment_deltas",
            error: FieldError::OutOfDomain("3491411127173121".to_string()),
        })
    );
}

#[test]
fn extract_player_state_update_from_last_seen_tick() {
    let party = vec![
        Rsn::try_from("Sacolyn").unwrap(),
        Rsn::try_from("1Ogp").unwrap(),
    ];
    let mut recording = Recording::vacant(
        Stage::TobNylocas,
        ChallengeMode::TobRegular,
        party.clone(),
        Tick(400),
    );
    let mut players = Players::empty(2);
    players[PartyIndex::from_usize(0)] = Some(PlayerState {
        source: Source::Client(ClientId(9)),
        position: Point(3296, 4254),
        equipment: [
            Some(Item {
                id: 26475,
                quantity: 1,
            }),
            Some(Item {
                id: 28902,
                quantity: 1,
            }),
            Some(Item {
                id: 12002,
                quantity: 1,
            }),
            Some(Item {
                id: 11212,
                quantity: 326_639,
            }),
            Some(Item {
                id: 31113,
                quantity: 1,
            }),
            Some(Item {
                id: 26469,
                quantity: 1,
            }),
            Some(Item {
                id: 27253,
                quantity: 1,
            }),
            Some(Item {
                id: 26471,
                quantity: 1,
            }),
            Some(Item {
                id: 31106,
                quantity: 1,
            }),
            Some(Item {
                id: 31097,
                quantity: 1,
            }),
            Some(Item {
                id: 28307,
                quantity: 1,
            }),
            Some(Item {
                id: 21944,
                quantity: 41475,
            }),
        ],
        prayers: PrayerSet::from_raw(0),
        data: DataSource::Primary(Stats {
            hitpoints: SkillLevel::from_raw(6_488_163),
            prayer: SkillLevel::from_raw(6_488_163),
            attack: SkillLevel::from_raw(7_733_347),
            strength: SkillLevel::from_raw(7_733_347),
            defence: SkillLevel::from_raw(7_733_347),
            ranged: SkillLevel::from_raw(7_340_131),
            magic: SkillLevel::from_raw(7_340_131),
        }),
    });
    recording.set_state(
        Tick(0),
        TickState {
            players,
            npcs: BTreeMap::new(),
            objects: TickObjects::default(),
            events: vec![],
        },
    );
    let last_seen_actors = HashMap::from([(Actor::Player(PartyIndex::from_usize(0)), Tick(0))]);

    let mut swap = proto::Event {
        tick: 24,
        stage: Stage::TobNylocas as i32,
        x_coord: 3301,
        y_coord: 4248,
        ..Default::default()
    };
    swap.set_type(proto::event::Type::PlayerUpdate);
    swap.player = Some(proto::event::Player {
        name: "Sacolyn".to_string(),
        hitpoints: Some(6_488_163),
        prayer: Some(6_291_555),
        attack: Some(7_733_347),
        strength: Some(7_733_347),
        defence: Some(7_733_347),
        ranged: Some(7_340_131),
        magic: Some(7_340_131),
        equipment_deltas: vec![1_184_536_947_851_265, 1_805_900_603_981_825],
        active_prayers: Some(67_108_864),
        data_source: proto::event::player::DataSource::Primary as i32,
        snapshot: false,
        ..Default::default()
    });
    assert_eq!(
        extract_player_state(ClientId(9), &party, &recording, &last_seen_actors, &swap),
        Ok((
            PartyIndex::from_usize(0),
            PlayerState {
                source: Source::Client(ClientId(9)),
                position: Point(3301, 4248),
                equipment: [
                    Some(Item {
                        id: 26475,
                        quantity: 1,
                    }),
                    Some(Item {
                        id: 28902,
                        quantity: 1,
                    }),
                    Some(Item {
                        id: 12002,
                        quantity: 1,
                    }),
                    Some(Item {
                        id: 11212,
                        quantity: 326_639,
                    }),
                    Some(Item {
                        id: 13652,
                        quantity: 1,
                    }),
                    Some(Item {
                        id: 26469,
                        quantity: 1,
                    }),
                    None,
                    Some(Item {
                        id: 26471,
                        quantity: 1,
                    }),
                    Some(Item {
                        id: 31106,
                        quantity: 1,
                    }),
                    Some(Item {
                        id: 31097,
                        quantity: 1,
                    }),
                    Some(Item {
                        id: 28307,
                        quantity: 1,
                    }),
                    Some(Item {
                        id: 21944,
                        quantity: 41475,
                    }),
                ],
                prayers: PrayerSet::from_raw(67_108_864),
                data: DataSource::Primary(Stats {
                    hitpoints: SkillLevel::from_raw(6_488_163),
                    prayer: SkillLevel::from_raw(6_291_555),
                    attack: SkillLevel::from_raw(7_733_347),
                    strength: SkillLevel::from_raw(7_733_347),
                    defence: SkillLevel::from_raw(7_733_347),
                    ranged: SkillLevel::from_raw(7_340_131),
                    magic: SkillLevel::from_raw(7_340_131),
                }),
            }
        ))
    );

    let mut ammo = proto::Event {
        tick: 306,
        stage: Stage::TobNylocas as i32,
        x_coord: 3298,
        y_coord: 4249,
        ..Default::default()
    };
    ammo.set_type(proto::event::Type::PlayerUpdate);
    ammo.player = Some(proto::event::Player {
        name: "Sacolyn".to_string(),
        hitpoints: Some(6_291_555),
        prayer: Some(4_653_155),
        attack: Some(7_733_347),
        strength: Some(7_733_347),
        defence: Some(7_733_347),
        ranged: Some(7_340_131),
        magic: Some(7_340_131),
        equipment_deltas: vec![892_580_103_454_721],
        active_prayers: Some(134_348_800),
        data_source: proto::event::player::DataSource::Primary as i32,
        snapshot: false,
        ..Default::default()
    });
    let (index, state) =
        extract_player_state(ClientId(9), &party, &recording, &last_seen_actors, &ammo).unwrap();
    assert_eq!(index, PartyIndex::from_usize(0));
    assert_eq!(state.position, Point(3298, 4249));
    assert_eq!(
        state.equipped(EquipmentSlot::Ammo),
        Some(Item {
            id: 11212,
            quantity: 326_638,
        })
    );
    assert_eq!(
        state.equipped(EquipmentSlot::Weapon),
        Some(Item {
            id: 31113,
            quantity: 1,
        })
    );
    assert_eq!(state.prayers, PrayerSet::from_raw(134_348_800));
    assert_eq!(
        state.data,
        DataSource::Primary(Stats {
            hitpoints: SkillLevel::from_raw(6_291_555),
            prayer: SkillLevel::from_raw(4_653_155),
            attack: SkillLevel::from_raw(7_733_347),
            strength: SkillLevel::from_raw(7_733_347),
            defence: SkillLevel::from_raw(7_733_347),
            ranged: SkillLevel::from_raw(7_340_131),
            magic: SkillLevel::from_raw(7_340_131),
        })
    );
}

#[test]
fn extract_npc_state_spawn() {
    let recording = Recording::vacant(
        Stage::TobNylocas,
        ChallengeMode::TobRegular,
        vec![Rsn::try_from("TobDataEgirl").unwrap()],
        Tick(6),
    );
    let last_seen_actors = HashMap::new();

    let mut spawn = proto::Event {
        tick: 4,
        stage: Stage::TobNylocas as i32,
        x_coord: 3281,
        y_coord: 4248,
        ..Default::default()
    };
    spawn.set_type(proto::event::Type::NpcSpawn);
    spawn.npc = Some(proto::event::Npc {
        id: 8343,
        room_id: 48416,
        hitpoints: 524_296,
        active_prayers: 0,
        r#type: Some(proto::event::npc::Type::Nylo(proto::event::npc::Nylo {
            wave: 1,
            parent_room_id: 0,
            big: false,
            style: proto::event::npc::nylo::Style::Range as i32,
            spawn_type: proto::event::npc::nylo::SpawnType::West as i32,
        })),
    });
    assert_eq!(
        extract_npc_state(ClientId(3), &recording, &last_seen_actors, &spawn),
        Ok((
            RoomId(48416),
            NpcState {
                source: Source::Client(ClientId(3)),
                npc_id: 8343,
                position: Rect::square(Point(3281, 4248), 1),
                hitpoints: SkillLevel::from_raw(524_296),
                prayers: PrayerSet::from_raw(0),
                properties: Some(NpcProperties::Nylo(Nylo {
                    wave: 1,
                    big: false,
                    style: CombatStyle::Ranged,
                    spawn: NyloSpawn::West,
                })),
            }
        ))
    );

    let mut missing_npc = proto::Event {
        tick: 5,
        stage: Stage::TobNylocas as i32,
        x_coord: 3282,
        y_coord: 4248,
        ..Default::default()
    };
    missing_npc.set_type(proto::event::Type::NpcUpdate);
    assert_eq!(
        extract_npc_state(ClientId(3), &recording, &last_seen_actors, &missing_npc),
        Err(RejectionReason::MissingPayload("npc"))
    );

    let mut unknown_style = proto::Event {
        tick: 4,
        stage: Stage::TobNylocas as i32,
        x_coord: 3281,
        y_coord: 4248,
        ..Default::default()
    };
    unknown_style.set_type(proto::event::Type::NpcSpawn);
    unknown_style.npc = Some(proto::event::Npc {
        id: 8343,
        room_id: 48416,
        hitpoints: 524_296,
        active_prayers: 0,
        r#type: Some(proto::event::npc::Type::Nylo(proto::event::npc::Nylo {
            wave: 1,
            parent_room_id: 0,
            big: false,
            style: 7,
            spawn_type: proto::event::npc::nylo::SpawnType::West as i32,
        })),
    });
    assert_eq!(
        extract_npc_state(ClientId(3), &recording, &last_seen_actors, &unknown_style),
        Err(RejectionReason::InvalidField {
            field: "npc.nylo.style",
            error: FieldError::OutOfDomain("7".to_string()),
        })
    );
}

#[test]
fn extract_npc_state_update_last_seen_tick() {
    let nylo = NpcProperties::Nylo(Nylo {
        wave: 1,
        big: false,
        style: CombatStyle::Ranged,
        spawn: NyloSpawn::West,
    });
    let mut recording = Recording::vacant(
        Stage::TobNylocas,
        ChallengeMode::TobRegular,
        vec![Rsn::try_from("TobDataEgirl").unwrap()],
        Tick(6),
    );
    recording.set_state(
        Tick(4),
        TickState {
            players: Players::empty(1),
            npcs: BTreeMap::from([(
                RoomId(48416),
                NpcState {
                    source: Source::Client(ClientId(3)),
                    npc_id: 8343,
                    position: Rect::square(Point(3281, 4248), 1),
                    hitpoints: SkillLevel::from_raw(524_296),
                    prayers: PrayerSet::from_raw(0),
                    properties: Some(nylo.clone()),
                },
            )]),
            objects: TickObjects::default(),
            events: vec![],
        },
    );
    let last_seen_actors = HashMap::from([(Actor::Npc(RoomId(48416)), Tick(4))]);

    let mut update = proto::Event {
        tick: 6,
        stage: Stage::TobNylocas as i32,
        x_coord: 3283,
        y_coord: 4248,
        ..Default::default()
    };
    update.set_type(proto::event::Type::NpcUpdate);
    update.npc = Some(proto::event::Npc {
        id: 8343,
        room_id: 48416,
        hitpoints: 524_296,
        active_prayers: 0,
        r#type: Some(proto::event::npc::Type::Basic(())),
    });
    assert_eq!(
        extract_npc_state(ClientId(3), &recording, &last_seen_actors, &update),
        Ok((
            RoomId(48416),
            NpcState {
                source: Source::Client(ClientId(3)),
                npc_id: 8343,
                position: Rect::square(Point(3283, 4248), 1),
                hitpoints: SkillLevel::from_raw(524_296),
                prayers: PrayerSet::from_raw(0),
                properties: Some(nylo),
            }
        ))
    );
}

#[test]
fn convert_player_attack() {
    let party = vec![
        Rsn::try_from("715").unwrap(),
        Rsn::try_from("1Ogp").unwrap(),
        Rsn::try_from("WWWWWWWWWWQQ").unwrap(),
    ];

    let mut scythe = proto::Event {
        tick: 385,
        stage: Stage::TobVerzik as i32,
        x_coord: 3164,
        y_coord: 4312,
        ..Default::default()
    };
    scythe.set_type(proto::event::Type::PlayerAttack);
    scythe.player = Some(proto::event::Player {
        name: "1Ogp".to_string(),
        ..Default::default()
    });
    scythe.player_attack = Some(proto::event::Attack {
        r#type: proto::PlayerAttack::Scythe as i32,
        weapon: Some(proto::event::player::EquippedItem {
            slot: proto::event::player::EquipmentSlot::Weapon as i32,
            id: item::id::SCYTHE_OF_VITUR,
            quantity: 1,
        }),
        target: Some(proto::event::Npc {
            id: 8374,
            room_id: 60963,
            r#type: Some(proto::event::npc::Type::Basic(())),
            ..Default::default()
        }),
        distance_to_target: 1,
    });
    assert_eq!(
        convert_event(&party, &scythe),
        EventOutcome::Accepted(EventKind::PlayerAttack(PlayerAttacked {
            player: PartyIndex::from_usize(1),
            attack: proto::PlayerAttack::Scythe,
            weapon: Some(Item {
                id: item::id::SCYTHE_OF_VITUR,
                quantity: 1,
            }),
            target: Some(Actor::Npc(RoomId(60963))),
        }))
    );

    let mut invalid_target = proto::Event {
        tick: 1,
        stage: Stage::TobVerzik as i32,
        x_coord: 3166,
        y_coord: 4322,
        ..Default::default()
    };
    invalid_target.set_type(proto::event::Type::PlayerAttack);
    invalid_target.player = Some(proto::event::Player {
        name: "WWWWWWWWWWQQ".to_string(),
        ..Default::default()
    });
    invalid_target.player_attack = Some(proto::event::Attack {
        r#type: proto::PlayerAttack::Scythe as i32,
        weapon: Some(proto::event::player::EquippedItem {
            slot: proto::event::player::EquipmentSlot::Weapon as i32,
            id: item::id::SANGUINE_SCYTHE_OF_VITUR,
            quantity: 1,
        }),
        target: Some(proto::event::Npc {
            r#type: Some(proto::event::npc::Type::Basic(())),
            ..Default::default()
        }),
        distance_to_target: -1,
    });
    assert_eq!(
        convert_event(&party, &invalid_target),
        EventOutcome::Accepted(EventKind::PlayerAttack(PlayerAttacked {
            player: PartyIndex::from_usize(2),
            attack: proto::PlayerAttack::Scythe,
            weapon: Some(Item {
                id: item::id::SANGUINE_SCYTHE_OF_VITUR,
                quantity: 1,
            }),
            target: None,
        }))
    );

    let mut unknown_player = proto::Event {
        tick: 1,
        stage: Stage::TobVerzik as i32,
        x_coord: 3166,
        y_coord: 4322,
        ..Default::default()
    };
    unknown_player.set_type(proto::event::Type::PlayerAttack);
    unknown_player.player = Some(proto::event::Player {
        name: "Sacolyn".to_string(),
        ..Default::default()
    });
    unknown_player.player_attack = Some(proto::event::Attack {
        r#type: proto::PlayerAttack::DawnAuto as i32,
        weapon: Some(proto::event::player::EquippedItem {
            slot: proto::event::player::EquipmentSlot::Weapon as i32,
            id: item::id::DAWNBRINGER,
            quantity: 1,
        }),
        target: Some(proto::event::Npc {
            id: 10848,
            room_id: 45117,
            r#type: Some(proto::event::npc::Type::Basic(())),
            ..Default::default()
        }),
        distance_to_target: 1,
    });
    assert_eq!(
        convert_event(&party, &unknown_player),
        EventOutcome::Rejected(RejectionReason::InvalidField {
            field: "player.name",
            error: FieldError::UnknownActor(RawActor::Player("Sacolyn".to_string())),
        })
    );

    let mut missing_attack = proto::Event {
        tick: 386,
        stage: Stage::TobVerzik as i32,
        x_coord: 3164,
        y_coord: 4317,
        ..Default::default()
    };
    missing_attack.set_type(proto::event::Type::PlayerAttack);
    missing_attack.player = Some(proto::event::Player {
        name: "715".to_string(),
        ..Default::default()
    });
    assert_eq!(
        convert_event(&party, &missing_attack),
        EventOutcome::Rejected(RejectionReason::MissingPayload("player_attack"))
    );

    let mut missing_player = proto::Event {
        tick: 390,
        stage: Stage::TobVerzik as i32,
        x_coord: 3168,
        y_coord: 4310,
        ..Default::default()
    };
    missing_player.set_type(proto::event::Type::PlayerAttack);
    missing_player.player_attack = Some(proto::event::Attack {
        r#type: proto::PlayerAttack::Scythe as i32,
        weapon: Some(proto::event::player::EquippedItem {
            slot: proto::event::player::EquipmentSlot::Weapon as i32,
            id: item::id::SCYTHE_OF_VITUR,
            quantity: 1,
        }),
        target: Some(proto::event::Npc {
            id: 8374,
            room_id: 60963,
            r#type: Some(proto::event::npc::Type::Basic(())),
            ..Default::default()
        }),
        distance_to_target: 1,
    });
    assert_eq!(
        convert_event(&party, &missing_player),
        EventOutcome::Rejected(RejectionReason::MissingPayload("player"))
    );
}

#[test]
fn convert_player_death() {
    let party = vec![
        Rsn::try_from("1Ogp").unwrap(),
        Rsn::try_from("WWWWWWWWWWQQ").unwrap(),
    ];

    let mut death = proto::Event {
        tick: 129,
        stage: Stage::TobMaiden as i32,
        x_coord: 3173,
        y_coord: 4443,
        ..Default::default()
    };
    death.set_type(proto::event::Type::PlayerDeath);
    death.player = Some(proto::event::Player {
        name: "WWWWWWWWWWQQ".to_string(),
        ..Default::default()
    });
    assert_eq!(
        convert_event(&party, &death),
        EventOutcome::Accepted(EventKind::PlayerDeath(PartyIndex::from_usize(1)))
    );

    let mut unknown_player = proto::Event {
        tick: 133,
        stage: Stage::TobMaiden as i32,
        x_coord: 3168,
        y_coord: 4447,
        ..Default::default()
    };
    unknown_player.set_type(proto::event::Type::PlayerDeath);
    unknown_player.player = Some(proto::event::Player {
        name: "715".to_string(),
        ..Default::default()
    });
    assert_eq!(
        convert_event(&party, &unknown_player),
        EventOutcome::Rejected(RejectionReason::InvalidField {
            field: "player.name",
            error: FieldError::UnknownActor(RawActor::Player("715".to_string())),
        })
    );

    let mut missing_player = proto::Event {
        tick: 129,
        stage: Stage::TobMaiden as i32,
        x_coord: 3173,
        y_coord: 4443,
        ..Default::default()
    };
    missing_player.set_type(proto::event::Type::PlayerDeath);
    assert_eq!(
        convert_event(&party, &missing_player),
        EventOutcome::Rejected(RejectionReason::MissingPayload("player"))
    );
}

#[test]
fn convert_player_spell() {
    let party = vec![
        Rsn::try_from("WWWWWWWWWWQQ").unwrap(),
        Rsn::try_from("Sacolyn").unwrap(),
        Rsn::try_from("715").unwrap(),
        Rsn::try_from("1Ogp").unwrap(),
    ];

    let mut spellbook_swap = proto::Event {
        tick: 63,
        stage: Stage::TobXarpus as i32,
        x_coord: 3168,
        y_coord: 4389,
        ..Default::default()
    };
    spellbook_swap.set_type(proto::event::Type::PlayerSpell);
    spellbook_swap.player = Some(proto::event::Player {
        name: "Sacolyn".to_string(),
        ..Default::default()
    });
    spellbook_swap.player_spell = Some(proto::event::Spell {
        r#type: proto::PlayerSpell::SpellbookSwap as i32,
        target: Some(proto::event::spell::Target::NoTarget(())),
    });
    assert_eq!(
        convert_event(&party, &spellbook_swap),
        EventOutcome::Accepted(EventKind::PlayerSpell(PlayerCast {
            player: PartyIndex::from_usize(1),
            spell: proto::PlayerSpell::SpellbookSwap,
            target: None,
        }))
    );

    let mut vengeance_other = proto::Event {
        tick: 54,
        stage: Stage::TobXarpus as i32,
        x_coord: 3170,
        y_coord: 4392,
        ..Default::default()
    };
    vengeance_other.set_type(proto::event::Type::PlayerSpell);
    vengeance_other.player = Some(proto::event::Player {
        name: "715".to_string(),
        ..Default::default()
    });
    vengeance_other.player_spell = Some(proto::event::Spell {
        r#type: proto::PlayerSpell::VengeanceOther as i32,
        target: Some(proto::event::spell::Target::TargetPlayer(
            "1Ogp".to_string(),
        )),
    });
    assert_eq!(
        convert_event(&party, &vengeance_other),
        EventOutcome::Accepted(EventKind::PlayerSpell(PlayerCast {
            player: PartyIndex::from_usize(2),
            spell: proto::PlayerSpell::VengeanceOther,
            target: Some(Actor::Player(PartyIndex::from_usize(3))),
        }))
    );

    let mut unknown_target = proto::Event {
        tick: 68,
        stage: Stage::TobXarpus as i32,
        x_coord: 3167,
        y_coord: 4385,
        ..Default::default()
    };
    unknown_target.set_type(proto::event::Type::PlayerSpell);
    unknown_target.player = Some(proto::event::Player {
        name: "1Ogp".to_string(),
        ..Default::default()
    });
    unknown_target.player_spell = Some(proto::event::Spell {
        r#type: proto::PlayerSpell::VengeanceOther as i32,
        target: Some(proto::event::spell::Target::TargetPlayer(
            "Caps lock13".to_string(),
        )),
    });
    assert_eq!(
        convert_event(&party, &unknown_target),
        EventOutcome::PartiallyAccepted {
            event: EventKind::PlayerSpell(PlayerCast {
                player: PartyIndex::from_usize(3),
                spell: proto::PlayerSpell::VengeanceOther,
                target: None,
            }),
            field: "player_spell.target_player",
            error: FieldError::UnknownActor(RawActor::Player("Caps lock13".to_string())),
        }
    );

    let mut unknown_player = proto::Event {
        tick: 114,
        stage: Stage::TobXarpus as i32,
        x_coord: 3167,
        y_coord: 4387,
        ..Default::default()
    };
    unknown_player.set_type(proto::event::Type::PlayerSpell);
    unknown_player.player = Some(proto::event::Player {
        name: "versik mele".to_string(),
        ..Default::default()
    });
    unknown_player.player_spell = Some(proto::event::Spell {
        r#type: proto::PlayerSpell::ResurrectGreaterGhost as i32,
        target: Some(proto::event::spell::Target::NoTarget(())),
    });
    assert_eq!(
        convert_event(&party, &unknown_player),
        EventOutcome::Rejected(RejectionReason::InvalidField {
            field: "player.name",
            error: FieldError::UnknownActor(RawActor::Player("versik mele".to_string())),
        })
    );

    let mut missing_spell = proto::Event {
        tick: 21,
        stage: Stage::TobXarpus as i32,
        x_coord: 3169,
        y_coord: 4382,
        ..Default::default()
    };
    missing_spell.set_type(proto::event::Type::PlayerSpell);
    missing_spell.player = Some(proto::event::Player {
        name: "715".to_string(),
        ..Default::default()
    });
    assert_eq!(
        convert_event(&party, &missing_spell),
        EventOutcome::Rejected(RejectionReason::MissingPayload("player_spell"))
    );
}

#[test]
fn convert_npc_death() {
    let party = vec![
        Rsn::try_from("aSaradomin").unwrap(),
        Rsn::try_from("servido").unwrap(),
    ];

    let mut death = proto::Event {
        tick: 250,
        stage: Stage::TobVerzik as i32,
        x_coord: 3164,
        y_coord: 4315,
        ..Default::default()
    };
    death.set_type(proto::event::Type::NpcDeath);
    death.npc = Some(proto::event::Npc {
        id: 8385,
        room_id: 62870,
        hitpoints: 2_228_374,
        r#type: Some(proto::event::npc::Type::Basic(())),
        ..Default::default()
    });
    assert_eq!(
        convert_event(&party, &death),
        EventOutcome::Accepted(EventKind::NpcDeath(NpcDeath {
            position: Point(3164, 4315),
            npc: RoomId(62870),
            npc_id: Some(8385),
        }))
    );

    let mut death_without_id = proto::Event {
        tick: 462,
        stage: Stage::TobVerzik as i32,
        x_coord: 3164,
        y_coord: 4309,
        ..Default::default()
    };
    death_without_id.set_type(proto::event::Type::NpcDeath);
    death_without_id.npc = Some(proto::event::Npc {
        room_id: 43436,
        r#type: Some(proto::event::npc::Type::Basic(())),
        ..Default::default()
    });
    assert_eq!(
        convert_event(&party, &death_without_id),
        EventOutcome::Accepted(EventKind::NpcDeath(NpcDeath {
            position: Point(3164, 4309),
            npc: RoomId(43436),
            npc_id: None,
        }))
    );

    let mut missing_npc = proto::Event {
        tick: 269,
        stage: Stage::TobVerzik as i32,
        x_coord: 3170,
        y_coord: 4313,
        ..Default::default()
    };
    missing_npc.set_type(proto::event::Type::NpcDeath);
    assert_eq!(
        convert_event(&party, &missing_npc),
        EventOutcome::Rejected(RejectionReason::MissingPayload("npc"))
    );

    let mut invalid_x = proto::Event {
        tick: 250,
        stage: Stage::TobVerzik as i32,
        x_coord: -4,
        y_coord: 4315,
        ..Default::default()
    };
    invalid_x.set_type(proto::event::Type::NpcDeath);
    invalid_x.npc = Some(proto::event::Npc {
        id: 8385,
        room_id: 62870,
        hitpoints: 2_228_374,
        r#type: Some(proto::event::npc::Type::Basic(())),
        ..Default::default()
    });
    assert_eq!(
        convert_event(&party, &invalid_x),
        EventOutcome::Rejected(RejectionReason::InvalidField {
            field: "x_coord",
            error: FieldError::OutOfDomain("-4".to_string()),
        })
    );

    let mut invalid_y = proto::Event {
        tick: 269,
        stage: Stage::TobVerzik as i32,
        x_coord: 3170,
        y_coord: 70_000,
        ..Default::default()
    };
    invalid_y.set_type(proto::event::Type::NpcDeath);
    invalid_y.npc = Some(proto::event::Npc {
        id: 8385,
        room_id: 63167,
        hitpoints: 150,
        r#type: Some(proto::event::npc::Type::Basic(())),
        ..Default::default()
    });
    assert_eq!(
        convert_event(&party, &invalid_y),
        EventOutcome::Rejected(RejectionReason::InvalidField {
            field: "y_coord",
            error: FieldError::OutOfDomain("70000".to_string()),
        })
    );
}

#[test]
fn convert_npc_attack() {
    let party = vec![
        Rsn::try_from("Caywu").unwrap(),
        Rsn::try_from("LC8").unwrap(),
    ];

    let mut mage = proto::Event {
        tick: 284,
        stage: Stage::TobVerzik as i32,
        x_coord: 3167,
        y_coord: 4313,
        ..Default::default()
    };
    mage.set_type(proto::event::Type::NpcAttack);
    mage.npc = Some(proto::event::Npc {
        id: 8372,
        room_id: 60963,
        r#type: Some(proto::event::npc::Type::Basic(())),
        ..Default::default()
    });
    mage.npc_attack = Some(proto::event::NpcAttacked {
        attack: proto::NpcAttack::TobVerzikP2Mage as i32,
        target: Some("LC8".to_string()),
    });
    assert_eq!(
        convert_event(&party, &mage),
        EventOutcome::Accepted(EventKind::NpcAttack(NpcAttacked {
            npc: RoomId(60963),
            attack: proto::NpcAttack::TobVerzikP2Mage,
            target: Some(Actor::Player(PartyIndex::from_usize(1))),
        }))
    );

    let mut cabbage = proto::Event {
        tick: 288,
        stage: Stage::TobVerzik as i32,
        x_coord: 3167,
        y_coord: 4313,
        ..Default::default()
    };
    cabbage.set_type(proto::event::Type::NpcAttack);
    cabbage.npc = Some(proto::event::Npc {
        id: 8372,
        room_id: 60963,
        r#type: Some(proto::event::npc::Type::Basic(())),
        ..Default::default()
    });
    cabbage.npc_attack = Some(proto::event::NpcAttacked {
        attack: proto::NpcAttack::TobVerzikP2Cabbage as i32,
        target: None,
    });
    assert_eq!(
        convert_event(&party, &cabbage),
        EventOutcome::Accepted(EventKind::NpcAttack(NpcAttacked {
            npc: RoomId(60963),
            attack: proto::NpcAttack::TobVerzikP2Cabbage,
            target: None,
        }))
    );

    let mut unknown_target = proto::Event {
        tick: 312,
        stage: Stage::TobVerzik as i32,
        x_coord: 3167,
        y_coord: 4313,
        ..Default::default()
    };
    unknown_target.set_type(proto::event::Type::NpcAttack);
    unknown_target.npc = Some(proto::event::Npc {
        id: 8372,
        room_id: 60963,
        r#type: Some(proto::event::npc::Type::Basic(())),
        ..Default::default()
    });
    unknown_target.npc_attack = Some(proto::event::NpcAttacked {
        attack: proto::NpcAttack::TobVerzikP2Mage as i32,
        target: Some("715".to_string()),
    });
    assert_eq!(
        convert_event(&party, &unknown_target),
        EventOutcome::PartiallyAccepted {
            event: EventKind::NpcAttack(NpcAttacked {
                npc: RoomId(60963),
                attack: proto::NpcAttack::TobVerzikP2Mage,
                target: None,
            }),
            field: "npc_attack.target",
            error: FieldError::UnknownActor(RawActor::Player("715".to_string())),
        }
    );

    let mut missing_npc = proto::Event {
        tick: 308,
        stage: Stage::TobVerzik as i32,
        x_coord: 3167,
        y_coord: 4313,
        ..Default::default()
    };
    missing_npc.set_type(proto::event::Type::NpcAttack);
    missing_npc.npc_attack = Some(proto::event::NpcAttacked {
        attack: proto::NpcAttack::TobVerzikP2Bounce as i32,
        target: None,
    });
    assert_eq!(
        convert_event(&party, &missing_npc),
        EventOutcome::Rejected(RejectionReason::MissingPayload("npc"))
    );

    let mut missing_attack = proto::Event {
        tick: 288,
        stage: Stage::TobVerzik as i32,
        x_coord: 3167,
        y_coord: 4313,
        ..Default::default()
    };
    missing_attack.set_type(proto::event::Type::NpcAttack);
    missing_attack.npc = Some(proto::event::Npc {
        id: 8372,
        room_id: 60963,
        r#type: Some(proto::event::npc::Type::Basic(())),
        ..Default::default()
    });
    assert_eq!(
        convert_event(&party, &missing_attack),
        EventOutcome::Rejected(RejectionReason::MissingPayload("npc_attack"))
    );
}

#[test]
fn convert_maiden_crab_leak() {
    let party = vec![Rsn::try_from("aSaradomin").unwrap()];

    let mut leak = proto::Event {
        tick: 83,
        stage: Stage::TobMaiden as i32,
        x_coord: 3168,
        y_coord: 4444,
        ..Default::default()
    };
    leak.set_type(proto::event::Type::TobMaidenCrabLeak);
    leak.npc = Some(proto::event::Npc {
        id: 8366,
        room_id: 40493,
        hitpoints: 5_701_719,
        r#type: Some(proto::event::npc::Type::Basic(())),
        ..Default::default()
    });
    assert_eq!(
        convert_event(&party, &leak),
        EventOutcome::Accepted(EventKind::MaidenCrabLeak(RoomId(40493)))
    );

    let mut missing_npc = proto::Event {
        tick: 78,
        stage: Stage::TobMaiden as i32,
        x_coord: 3167,
        y_coord: 4442,
        ..Default::default()
    };
    missing_npc.set_type(proto::event::Type::TobMaidenCrabLeak);
    assert_eq!(
        convert_event(&party, &missing_npc),
        EventOutcome::Rejected(RejectionReason::MissingPayload("npc"))
    );
}

#[test]
fn convert_bloat_down() {
    let party = vec![Rsn::try_from("Caywu").unwrap()];

    let mut down = proto::Event {
        tick: 41,
        stage: Stage::TobBloat as i32,
        x_coord: 3294,
        y_coord: 4451,
        ..Default::default()
    };
    down.set_type(proto::event::Type::TobBloatDown);
    down.bloat_down = Some(proto::event::BloatDown {
        down_number: 1,
        up_ticks: 42,
    });
    assert_eq!(
        convert_event(&party, &down),
        EventOutcome::Accepted(EventKind::BloatDown(BloatDown {
            down_number: 1,
            up_ticks: Ticks(42),
        }))
    );

    let mut missing_bloat_down = proto::Event {
        tick: 41,
        stage: Stage::TobBloat as i32,
        x_coord: 3294,
        y_coord: 4451,
        ..Default::default()
    };
    missing_bloat_down.set_type(proto::event::Type::TobBloatDown);
    assert_eq!(
        convert_event(&party, &missing_bloat_down),
        EventOutcome::Rejected(RejectionReason::MissingPayload("bloat_down"))
    );
}

#[test]
fn convert_bloat_up() {
    let party = vec![Rsn::try_from("Amili").unwrap()];

    let mut up = proto::Event {
        tick: 74,
        stage: Stage::TobBloat as i32,
        x_coord: 3296,
        y_coord: 4451,
        ..Default::default()
    };
    up.set_type(proto::event::Type::TobBloatUp);
    assert_eq!(
        convert_event(&party, &up),
        EventOutcome::Accepted(EventKind::BloatUp)
    );
}

#[test]
fn convert_bloat_hands_drop() {
    let party = vec![Rsn::try_from("Dedion").unwrap()];

    let mut hands = proto::Event {
        tick: 74,
        stage: Stage::TobBloat as i32,
        ..Default::default()
    };
    hands.set_type(proto::event::Type::TobBloatHandsDrop);
    hands.bloat_hands = vec![
        proto::Coords { x: 3302, y: 4449 },
        proto::Coords { x: 3299, y: 4453 },
        proto::Coords { x: 3303, y: 4455 },
        proto::Coords { x: 3294, y: 4454 },
        proto::Coords { x: 3295, y: 4451 },
        proto::Coords { x: 3291, y: 4449 },
        proto::Coords { x: 3292, y: 4448 },
        proto::Coords { x: 3292, y: 4452 },
        proto::Coords { x: 3292, y: 4455 },
        proto::Coords { x: 3294, y: 4443 },
        proto::Coords { x: 3294, y: 4441 },
        proto::Coords { x: 3291, y: 4440 },
        proto::Coords { x: 3289, y: 4442 },
        proto::Coords { x: 3300, y: 4446 },
        proto::Coords { x: 3301, y: 4444 },
        proto::Coords { x: 3300, y: 4443 },
    ];
    assert_eq!(
        convert_event(&party, &hands),
        EventOutcome::Accepted(EventKind::BloatHandsDrop(vec![
            Point(3302, 4449),
            Point(3299, 4453),
            Point(3303, 4455),
            Point(3294, 4454),
            Point(3295, 4451),
            Point(3291, 4449),
            Point(3292, 4448),
            Point(3292, 4452),
            Point(3292, 4455),
            Point(3294, 4443),
            Point(3294, 4441),
            Point(3291, 4440),
            Point(3289, 4442),
            Point(3300, 4446),
            Point(3301, 4444),
            Point(3300, 4443),
        ]))
    );

    let mut missing_bloat_hands = proto::Event {
        tick: 78,
        stage: Stage::TobBloat as i32,
        ..Default::default()
    };
    missing_bloat_hands.set_type(proto::event::Type::TobBloatHandsDrop);
    assert_eq!(
        convert_event(&party, &missing_bloat_hands),
        EventOutcome::Rejected(RejectionReason::MissingPayload("bloat_hands"))
    );

    let mut invalid_bloat_hands = proto::Event {
        tick: 78,
        stage: Stage::TobBloat as i32,
        ..Default::default()
    };
    invalid_bloat_hands.set_type(proto::event::Type::TobBloatHandsDrop);
    invalid_bloat_hands.bloat_hands = vec![
        proto::Coords { x: 3299, y: 4448 },
        proto::Coords { x: 3301, y: 4453 },
        proto::Coords { x: 3302, y: 70_001 },
        proto::Coords { x: 3295, y: 4454 },
        proto::Coords { x: 3295, y: 4453 },
        proto::Coords { x: 3290, y: 4449 },
        proto::Coords { x: 3291, y: 4448 },
        proto::Coords { x: 3288, y: 4452 },
        proto::Coords { x: 3291, y: 4453 },
        proto::Coords { x: 3295, y: 4441 },
        proto::Coords { x: 3292, y: 4440 },
        proto::Coords { x: 3290, y: 4444 },
        proto::Coords { x: 3296, y: 4444 },
        proto::Coords { x: 3299, y: 4447 },
        proto::Coords { x: 3302, y: 4441 },
        proto::Coords { x: 3300, y: 4444 },
    ];
    assert_eq!(
        convert_event(&party, &invalid_bloat_hands),
        EventOutcome::Rejected(RejectionReason::InvalidField {
            field: "bloat_hands",
            error: FieldError::OutOfDomain("(3302,70001)".to_string()),
        })
    );
}

#[test]
fn convert_bloat_hands_splat() {
    let party = vec![Rsn::try_from("Yieldofin").unwrap()];

    let mut hands = proto::Event {
        tick: 77,
        stage: Stage::TobBloat as i32,
        ..Default::default()
    };
    hands.set_type(proto::event::Type::TobBloatHandsSplat);
    hands.bloat_hands = vec![
        proto::Coords { x: 3302, y: 4449 },
        proto::Coords { x: 3299, y: 4453 },
        proto::Coords { x: 3303, y: 4455 },
        proto::Coords { x: 3294, y: 4454 },
        proto::Coords { x: 3295, y: 4451 },
        proto::Coords { x: 3291, y: 4449 },
        proto::Coords { x: 3292, y: 4448 },
        proto::Coords { x: 3292, y: 4452 },
        proto::Coords { x: 3292, y: 4455 },
        proto::Coords { x: 3294, y: 4443 },
        proto::Coords { x: 3294, y: 4441 },
        proto::Coords { x: 3291, y: 4440 },
        proto::Coords { x: 3289, y: 4442 },
        proto::Coords { x: 3300, y: 4446 },
        proto::Coords { x: 3301, y: 4444 },
        proto::Coords { x: 3300, y: 4443 },
    ];
    assert_eq!(
        convert_event(&party, &hands),
        EventOutcome::Accepted(EventKind::BloatHandsSplat(vec![
            Point(3302, 4449),
            Point(3299, 4453),
            Point(3303, 4455),
            Point(3294, 4454),
            Point(3295, 4451),
            Point(3291, 4449),
            Point(3292, 4448),
            Point(3292, 4452),
            Point(3292, 4455),
            Point(3294, 4443),
            Point(3294, 4441),
            Point(3291, 4440),
            Point(3289, 4442),
            Point(3300, 4446),
            Point(3301, 4444),
            Point(3300, 4443),
        ]))
    );

    let mut invalid_bloat_hands = proto::Event {
        tick: 81,
        stage: Stage::TobBloat as i32,
        ..Default::default()
    };
    invalid_bloat_hands.set_type(proto::event::Type::TobBloatHandsSplat);
    invalid_bloat_hands.bloat_hands = vec![
        proto::Coords { x: 3299, y: 4448 },
        proto::Coords { x: 3301, y: 4453 },
        proto::Coords { x: 3302, y: 4453 },
        proto::Coords { x: 3295, y: 4454 },
        proto::Coords { x: 3295, y: 4453 },
        proto::Coords { x: 3290, y: 4449 },
        proto::Coords { x: 3291, y: 4448 },
        proto::Coords { x: -12, y: 4452 },
        proto::Coords { x: 3291, y: 4453 },
        proto::Coords { x: 3295, y: 4441 },
        proto::Coords { x: 3292, y: 4440 },
        proto::Coords { x: 3290, y: 4444 },
        proto::Coords { x: 3296, y: 4444 },
        proto::Coords { x: 3299, y: 4447 },
        proto::Coords { x: 3302, y: 4441 },
        proto::Coords { x: 3300, y: 4444 },
    ];
    assert_eq!(
        convert_event(&party, &invalid_bloat_hands),
        EventOutcome::Rejected(RejectionReason::InvalidField {
            field: "bloat_hands",
            error: FieldError::OutOfDomain("(-12,4452)".to_string()),
        })
    );
}

#[test]
fn convert_nylo_wave_spawn() {
    let party = vec![Rsn::try_from("Caywu").unwrap()];

    let mut spawn = proto::Event {
        tick: 76,
        stage: Stage::TobNylocas as i32,
        ..Default::default()
    };
    spawn.set_type(proto::event::Type::TobNyloWaveSpawn);
    spawn.nylo_wave = Some(proto::event::NyloWave {
        wave: 11,
        nylos_alive: 16,
        room_cap: 12,
    });
    assert_eq!(
        convert_event(&party, &spawn),
        EventOutcome::Accepted(EventKind::NyloWaveSpawn(NyloWave {
            wave: 11,
            nylos_alive: 16,
        }))
    );

    let mut missing_nylo_wave = proto::Event {
        tick: 84,
        stage: Stage::TobNylocas as i32,
        ..Default::default()
    };
    missing_nylo_wave.set_type(proto::event::Type::TobNyloWaveSpawn);
    assert_eq!(
        convert_event(&party, &missing_nylo_wave),
        EventOutcome::Rejected(RejectionReason::MissingPayload("nylo_wave"))
    );

    let mut invalid_wave = proto::Event {
        tick: 84,
        stage: Stage::TobNylocas as i32,
        ..Default::default()
    };
    invalid_wave.set_type(proto::event::Type::TobNyloWaveSpawn);
    invalid_wave.nylo_wave = Some(proto::event::NyloWave {
        wave: 32,
        nylos_alive: 16,
        room_cap: 12,
    });
    assert_eq!(
        convert_event(&party, &invalid_wave),
        EventOutcome::Rejected(RejectionReason::InvalidField {
            field: "nylo_wave.wave",
            error: FieldError::OutOfDomain("32".to_string()),
        })
    );

    let mut invalid_nylos_alive = proto::Event {
        tick: 92,
        stage: Stage::TobNylocas as i32,
        ..Default::default()
    };
    invalid_nylos_alive.set_type(proto::event::Type::TobNyloWaveSpawn);
    invalid_nylos_alive.nylo_wave = Some(proto::event::NyloWave {
        wave: 13,
        nylos_alive: 300,
        room_cap: 12,
    });
    assert_eq!(
        convert_event(&party, &invalid_nylos_alive),
        EventOutcome::Rejected(RejectionReason::InvalidField {
            field: "nylo_wave.nylos_alive",
            error: FieldError::OutOfDomain("300".to_string()),
        })
    );
}

#[test]
fn convert_sote_maze_proc() {
    let party = vec![Rsn::try_from("LC8").unwrap()];

    let mut proc = proto::Event {
        tick: 63,
        stage: Stage::TobSotetseg as i32,
        ..Default::default()
    };
    proc.set_type(proto::event::Type::TobSoteMazeProc);
    proc.sote_maze = Some(proto::event::SoteMaze {
        maze: proto::event::sote_maze::Maze::Maze66 as i32,
        ..Default::default()
    });
    assert_eq!(
        convert_event(&party, &proc),
        EventOutcome::Accepted(EventKind::SoteMazeProc(Maze::Maze66))
    );

    let mut invalid_maze = proto::Event {
        tick: 159,
        stage: Stage::TobSotetseg as i32,
        ..Default::default()
    };
    invalid_maze.set_type(proto::event::Type::TobSoteMazeProc);
    invalid_maze.sote_maze = Some(proto::event::SoteMaze {
        maze: 5,
        ..Default::default()
    });
    assert_eq!(
        convert_event(&party, &invalid_maze),
        EventOutcome::Rejected(RejectionReason::InvalidField {
            field: "sote_maze.maze",
            error: FieldError::OutOfDomain("5".to_string()),
        })
    );

    let mut missing_sote_maze = proto::Event {
        tick: 63,
        stage: Stage::TobSotetseg as i32,
        ..Default::default()
    };
    missing_sote_maze.set_type(proto::event::Type::TobSoteMazeProc);
    assert_eq!(
        convert_event(&party, &missing_sote_maze),
        EventOutcome::Rejected(RejectionReason::MissingPayload("sote_maze"))
    );
}

#[test]
fn convert_sote_maze_end() {
    let party = vec![
        Rsn::try_from("Caps lock13").unwrap(),
        Rsn::try_from("Yieldofin").unwrap(),
    ];

    let mut valid = proto::Event {
        tick: 194,
        stage: Stage::TobSotetseg as i32,
        ..Default::default()
    };
    valid.set_type(proto::event::Type::TobSoteMazeEnd);
    valid.sote_maze = Some(proto::event::SoteMaze {
        maze: proto::event::sote_maze::Maze::Maze33 as i32,
        chosen_player: Some("Yieldofin".to_string()),
        ..Default::default()
    });
    assert_eq!(
        convert_event(&party, &valid),
        EventOutcome::Accepted(EventKind::SoteMazeEnd(SoteMazeEnd {
            maze: Maze::Maze33,
            chosen: Some(PartyIndex::from_usize(1)),
        }))
    );

    let mut no_chosen = proto::Event {
        tick: 94,
        stage: Stage::TobSotetseg as i32,
        ..Default::default()
    };
    no_chosen.set_type(proto::event::Type::TobSoteMazeEnd);
    no_chosen.sote_maze = Some(proto::event::SoteMaze {
        maze: proto::event::sote_maze::Maze::Maze66 as i32,
        ..Default::default()
    });
    assert_eq!(
        convert_event(&party, &no_chosen),
        EventOutcome::Accepted(EventKind::SoteMazeEnd(SoteMazeEnd {
            maze: Maze::Maze66,
            chosen: None,
        }))
    );

    let mut unknown_chosen = proto::Event {
        tick: 91,
        stage: Stage::TobSotetseg as i32,
        ..Default::default()
    };
    unknown_chosen.set_type(proto::event::Type::TobSoteMazeEnd);
    unknown_chosen.sote_maze = Some(proto::event::SoteMaze {
        maze: proto::event::sote_maze::Maze::Maze66 as i32,
        chosen_player: Some("vShawneh".to_string()),
        ..Default::default()
    });
    assert_eq!(
        convert_event(&party, &unknown_chosen),
        EventOutcome::PartiallyAccepted {
            event: EventKind::SoteMazeEnd(SoteMazeEnd {
                maze: Maze::Maze66,
                chosen: None,
            }),
            field: "sote_maze.chosen_player",
            error: FieldError::UnknownActor(RawActor::Player("vShawneh".to_string())),
        }
    );

    let mut bad_maze = proto::Event {
        tick: 194,
        stage: Stage::TobSotetseg as i32,
        ..Default::default()
    };
    bad_maze.set_type(proto::event::Type::TobSoteMazeEnd);
    bad_maze.sote_maze = Some(proto::event::SoteMaze {
        maze: 7,
        chosen_player: Some("Caps lock13".to_string()),
        ..Default::default()
    });
    assert_eq!(
        convert_event(&party, &bad_maze),
        EventOutcome::Rejected(RejectionReason::InvalidField {
            field: "sote_maze.maze",
            error: FieldError::OutOfDomain("7".to_string()),
        })
    );

    let mut missing_maze = proto::Event {
        tick: 94,
        stage: Stage::TobSotetseg as i32,
        ..Default::default()
    };
    missing_maze.set_type(proto::event::Type::TobSoteMazeEnd);
    assert_eq!(
        convert_event(&party, &missing_maze),
        EventOutcome::Rejected(RejectionReason::MissingPayload("sote_maze"))
    );
}

#[test]
fn convert_xarpus_phase() {
    let party = vec![Rsn::try_from("aSaradomin").unwrap()];

    let mut phase = proto::Event {
        tick: 259,
        stage: Stage::TobXarpus as i32,
        x_coord: 3168,
        y_coord: 4385,
        ..Default::default()
    };
    phase.set_type(proto::event::Type::TobXarpusPhase);
    phase.xarpus_phase = Some(proto::event::XarpusPhase::XarpusP3 as i32);
    assert_eq!(
        convert_event(&party, &phase),
        EventOutcome::Accepted(EventKind::XarpusPhase(XarpusPhase::XarpusP3))
    );

    let mut invalid_xarpus_phase = proto::Event {
        tick: 119,
        stage: Stage::TobXarpus as i32,
        x_coord: 3168,
        y_coord: 4385,
        ..Default::default()
    };
    invalid_xarpus_phase.set_type(proto::event::Type::TobXarpusPhase);
    invalid_xarpus_phase.xarpus_phase = Some(4);
    assert_eq!(
        convert_event(&party, &invalid_xarpus_phase),
        EventOutcome::Rejected(RejectionReason::InvalidField {
            field: "xarpus_phase",
            error: FieldError::OutOfDomain("4".to_string()),
        })
    );

    let mut missing_xarpus_phase = proto::Event {
        tick: 119,
        stage: Stage::TobXarpus as i32,
        x_coord: 3168,
        y_coord: 4385,
        ..Default::default()
    };
    missing_xarpus_phase.set_type(proto::event::Type::TobXarpusPhase);
    assert_eq!(
        convert_event(&party, &missing_xarpus_phase),
        EventOutcome::Rejected(RejectionReason::MissingPayload("xarpus_phase"))
    );
}

#[test]
fn convert_xarpus_exhumed() {
    let party = vec![Rsn::try_from("Amili").unwrap()];

    let mut exhumed = proto::Event {
        tick: 22,
        stage: Stage::TobXarpus as i32,
        x_coord: 3164,
        y_coord: 4386,
        ..Default::default()
    };
    exhumed.set_type(proto::event::Type::TobXarpusExhumed);
    exhumed.xarpus_exhumed = Some(proto::event::XarpusExhumed {
        spawn_tick: 11,
        heal_amount: 12,
        heal_ticks: vec![14, 15, 16],
    });
    assert_eq!(
        convert_event(&party, &exhumed),
        EventOutcome::Accepted(EventKind::XarpusExhumed(XarpusExhumed {
            position: Point(3164, 4386),
            spawn_tick: Tick(11),
            heal_ticks: vec![Tick(14), Tick(15), Tick(16)],
        }))
    );

    let mut missing_xarpus_exhumed = proto::Event {
        tick: 30,
        stage: Stage::TobXarpus as i32,
        x_coord: 3168,
        y_coord: 4382,
        ..Default::default()
    };
    missing_xarpus_exhumed.set_type(proto::event::Type::TobXarpusExhumed);
    assert_eq!(
        convert_event(&party, &missing_xarpus_exhumed),
        EventOutcome::Rejected(RejectionReason::MissingPayload("xarpus_exhumed"))
    );

    let mut spawn_after_despawn = proto::Event {
        tick: 38,
        stage: Stage::TobXarpus as i32,
        x_coord: 3165,
        y_coord: 4387,
        ..Default::default()
    };
    spawn_after_despawn.set_type(proto::event::Type::TobXarpusExhumed);
    spawn_after_despawn.xarpus_exhumed = Some(proto::event::XarpusExhumed {
        spawn_tick: 40,
        heal_amount: 12,
        heal_ticks: vec![30],
    });
    assert_eq!(
        convert_event(&party, &spawn_after_despawn),
        EventOutcome::Rejected(RejectionReason::Inconsistent(
            "exhumed spawned after despawning"
        ))
    );

    let mut heal_before_spawn = proto::Event {
        tick: 30,
        stage: Stage::TobXarpus as i32,
        x_coord: 3168,
        y_coord: 4382,
        ..Default::default()
    };
    heal_before_spawn.set_type(proto::event::Type::TobXarpusExhumed);
    heal_before_spawn.xarpus_exhumed = Some(proto::event::XarpusExhumed {
        spawn_tick: 19,
        heal_amount: 12,
        heal_ticks: vec![22, 17],
    });
    assert_eq!(
        convert_event(&party, &heal_before_spawn),
        EventOutcome::Rejected(RejectionReason::Inconsistent(
            "exhumed heal tick outside its lifetime"
        ))
    );
}

#[test]
fn convert_xarpus_splat() {
    let party = vec![Rsn::try_from("WWWWWWWWWWQQ").unwrap()];

    let mut xarpus = proto::Event {
        tick: 103,
        stage: Stage::TobXarpus as i32,
        x_coord: 3167,
        y_coord: 4387,
        ..Default::default()
    };
    xarpus.set_type(proto::event::Type::TobXarpusSplat);
    xarpus.xarpus_splat = Some(proto::event::XarpusSplat {
        source: proto::event::xarpus_splat::Source::Xarpus as i32,
        bounce_from: None,
    });
    assert_eq!(
        convert_event(&party, &xarpus),
        EventOutcome::Accepted(EventKind::XarpusSplat(XarpusSplat {
            position: Point(3167, 4387),
            source: XarpusSplatSource::Xarpus,
        }))
    );

    let mut bounce = proto::Event {
        tick: 103,
        stage: Stage::TobXarpus as i32,
        x_coord: 3167,
        y_coord: 4387,
        ..Default::default()
    };
    bounce.set_type(proto::event::Type::TobXarpusSplat);
    bounce.xarpus_splat = Some(proto::event::XarpusSplat {
        source: proto::event::xarpus_splat::Source::Bounce as i32,
        bounce_from: Some(proto::Coords { x: 3173, y: 4387 }),
    });
    assert_eq!(
        convert_event(&party, &bounce),
        EventOutcome::Accepted(EventKind::XarpusSplat(XarpusSplat {
            position: Point(3167, 4387),
            source: XarpusSplatSource::Bounce(Point(3173, 4387)),
        }))
    );

    let mut unknown_source = proto::Event {
        tick: 153,
        stage: Stage::TobXarpus as i32,
        x_coord: 3174,
        y_coord: 4384,
        ..Default::default()
    };
    unknown_source.set_type(proto::event::Type::TobXarpusSplat);
    unknown_source.xarpus_splat = Some(proto::event::XarpusSplat {
        source: proto::event::xarpus_splat::Source::Unknown as i32,
        bounce_from: None,
    });
    assert_eq!(
        convert_event(&party, &unknown_source),
        EventOutcome::Accepted(EventKind::XarpusSplat(XarpusSplat {
            position: Point(3174, 4384),
            source: XarpusSplatSource::Unknown,
        }))
    );

    let mut missing_bounce_from = proto::Event {
        tick: 108,
        stage: Stage::TobXarpus as i32,
        x_coord: 3172,
        y_coord: 4382,
        ..Default::default()
    };
    missing_bounce_from.set_type(proto::event::Type::TobXarpusSplat);
    missing_bounce_from.xarpus_splat = Some(proto::event::XarpusSplat {
        source: proto::event::xarpus_splat::Source::Bounce as i32,
        bounce_from: None,
    });
    assert_eq!(
        convert_event(&party, &missing_bounce_from),
        EventOutcome::Rejected(RejectionReason::MissingPayload("xarpus_splat.bounce_from"))
    );

    let mut invalid_bounce_from = proto::Event {
        tick: 108,
        stage: Stage::TobXarpus as i32,
        x_coord: 3172,
        y_coord: 4382,
        ..Default::default()
    };
    invalid_bounce_from.set_type(proto::event::Type::TobXarpusSplat);
    invalid_bounce_from.xarpus_splat = Some(proto::event::XarpusSplat {
        source: proto::event::xarpus_splat::Source::Bounce as i32,
        bounce_from: Some(proto::Coords { x: 3170, y: -3 }),
    });
    assert_eq!(
        convert_event(&party, &invalid_bounce_from),
        EventOutcome::Rejected(RejectionReason::InvalidField {
            field: "xarpus_splat.bounce_from",
            error: FieldError::OutOfDomain("(3170,-3)".to_string()),
        })
    );

    let mut invalid_source = proto::Event {
        tick: 103,
        stage: Stage::TobXarpus as i32,
        x_coord: 3167,
        y_coord: 4387,
        ..Default::default()
    };
    invalid_source.set_type(proto::event::Type::TobXarpusSplat);
    invalid_source.xarpus_splat = Some(proto::event::XarpusSplat {
        source: 5,
        bounce_from: None,
    });
    assert_eq!(
        convert_event(&party, &invalid_source),
        EventOutcome::Rejected(RejectionReason::InvalidField {
            field: "xarpus_splat.source",
            error: FieldError::OutOfDomain("5".to_string()),
        })
    );

    let mut missing_xarpus_splat = proto::Event {
        tick: 108,
        stage: Stage::TobXarpus as i32,
        x_coord: 3172,
        y_coord: 4382,
        ..Default::default()
    };
    missing_xarpus_splat.set_type(proto::event::Type::TobXarpusSplat);
    assert_eq!(
        convert_event(&party, &missing_xarpus_splat),
        EventOutcome::Rejected(RejectionReason::MissingPayload("xarpus_splat"))
    );
}

#[test]
fn convert_verzik_phase() {
    let party = vec![Rsn::try_from("1Ogp").unwrap()];

    let mut phase = proto::Event {
        tick: 104,
        stage: Stage::TobVerzik as i32,
        ..Default::default()
    };
    phase.set_type(proto::event::Type::TobVerzikPhase);
    phase.verzik_phase = Some(proto::event::VerzikPhase::VerzikP2 as i32);
    assert_eq!(
        convert_event(&party, &phase),
        EventOutcome::Accepted(EventKind::VerzikPhase(VerzikPhase::VerzikP2))
    );

    let mut invalid_verzik_phase = proto::Event {
        tick: 327,
        stage: Stage::TobVerzik as i32,
        ..Default::default()
    };
    invalid_verzik_phase.set_type(proto::event::Type::TobVerzikPhase);
    invalid_verzik_phase.verzik_phase = Some(6);
    assert_eq!(
        convert_event(&party, &invalid_verzik_phase),
        EventOutcome::Rejected(RejectionReason::InvalidField {
            field: "verzik_phase",
            error: FieldError::OutOfDomain("6".to_string()),
        })
    );

    let mut missing_verzik_phase = proto::Event {
        tick: 104,
        stage: Stage::TobVerzik as i32,
        ..Default::default()
    };
    missing_verzik_phase.set_type(proto::event::Type::TobVerzikPhase);
    assert_eq!(
        convert_event(&party, &missing_verzik_phase),
        EventOutcome::Rejected(RejectionReason::MissingPayload("verzik_phase"))
    );
}

#[test]
fn convert_verzik_dawn_drop() {
    let party = vec![Rsn::try_from("j shep98").unwrap()];

    let mut dropped = proto::Event {
        tick: 7,
        stage: Stage::TobVerzik as i32,
        x_coord: 3166,
        y_coord: 4322,
        ..Default::default()
    };
    dropped.set_type(proto::event::Type::TobVerzikDawnDrop);
    dropped.verzik_dawn_drop = Some(proto::event::VerzikDawnDrop { dropped: true });
    assert_eq!(
        convert_event(&party, &dropped),
        EventOutcome::Accepted(EventKind::VerzikDawnDropped(Point(3166, 4322)))
    );

    let mut picked_up = proto::Event {
        tick: 8,
        stage: Stage::TobVerzik as i32,
        x_coord: 3166,
        y_coord: 4322,
        ..Default::default()
    };
    picked_up.set_type(proto::event::Type::TobVerzikDawnDrop);
    picked_up.verzik_dawn_drop = Some(proto::event::VerzikDawnDrop { dropped: false });
    assert_eq!(
        convert_event(&party, &picked_up),
        EventOutcome::Accepted(EventKind::VerzikDawnPickedUp(Point(3166, 4322)))
    );

    let mut missing_verzik_dawn_drop = proto::Event {
        tick: 18,
        stage: Stage::TobVerzik as i32,
        x_coord: 3162,
        y_coord: 4317,
        ..Default::default()
    };
    missing_verzik_dawn_drop.set_type(proto::event::Type::TobVerzikDawnDrop);
    assert_eq!(
        convert_event(&party, &missing_verzik_dawn_drop),
        EventOutcome::Rejected(RejectionReason::MissingPayload("verzik_dawn_drop"))
    );
}

#[test]
fn convert_verzik_dawn_hit() {
    let party = vec![
        Rsn::try_from("Caywu").unwrap(),
        Rsn::try_from("LC8").unwrap(),
    ];

    let mut hit = proto::Event {
        tick: 3,
        stage: Stage::TobVerzik as i32,
        x_coord: 3166,
        y_coord: 4323,
        ..Default::default()
    };
    hit.set_type(proto::event::Type::TobVerzikDawn);
    hit.verzik_dawn = Some(proto::event::VerzikDawn {
        attack_tick: 1,
        damage: 130,
        player: "LC8".to_string(),
    });
    assert_eq!(
        convert_event(&party, &hit),
        EventOutcome::Accepted(EventKind::VerzikDawnHit(VerzikDawnHit {
            player: PartyIndex::from_usize(1),
            attack_tick: Tick(1),
            damage: 130,
        }))
    );

    let mut unknown_player = proto::Event {
        tick: 7,
        stage: Stage::TobVerzik as i32,
        x_coord: 3166,
        y_coord: 4323,
        ..Default::default()
    };
    unknown_player.set_type(proto::event::Type::TobVerzikDawn);
    unknown_player.verzik_dawn = Some(proto::event::VerzikDawn {
        attack_tick: 5,
        damage: 118,
        player: "Caps lock13".to_string(),
    });
    assert_eq!(
        convert_event(&party, &unknown_player),
        EventOutcome::Rejected(RejectionReason::InvalidField {
            field: "verzik_dawn.player",
            error: FieldError::UnknownActor(RawActor::Player("Caps lock13".to_string())),
        })
    );

    let mut attack_after_tick = proto::Event {
        tick: 13,
        stage: Stage::TobVerzik as i32,
        x_coord: 3166,
        y_coord: 4323,
        ..Default::default()
    };
    attack_after_tick.set_type(proto::event::Type::TobVerzikDawn);
    attack_after_tick.verzik_dawn = Some(proto::event::VerzikDawn {
        attack_tick: 14,
        damage: 112,
        player: "LC8".to_string(),
    });
    assert_eq!(
        convert_event(&party, &attack_after_tick),
        EventOutcome::Rejected(RejectionReason::Inconsistent(
            "dawn attack_tick after event tick"
        ))
    );

    let mut missing_verzik_dawn = proto::Event {
        tick: 19,
        stage: Stage::TobVerzik as i32,
        x_coord: 3166,
        y_coord: 4323,
        ..Default::default()
    };
    missing_verzik_dawn.set_type(proto::event::Type::TobVerzikDawn);
    assert_eq!(
        convert_event(&party, &missing_verzik_dawn),
        EventOutcome::Rejected(RejectionReason::MissingPayload("verzik_dawn"))
    );
}

#[test]
fn convert_verzik_bounce() {
    let party = vec![
        Rsn::try_from("Sacolyn").unwrap(),
        Rsn::try_from("715").unwrap(),
        Rsn::try_from("1Ogp").unwrap(),
        Rsn::try_from("WWWWWWWWWWQQ").unwrap(),
    ];

    let mut bounced = proto::Event {
        tick: 178,
        stage: Stage::TobVerzik as i32,
        ..Default::default()
    };
    bounced.set_type(proto::event::Type::TobVerzikBounce);
    bounced.verzik_bounce = Some(proto::event::VerzikBounce {
        npc_attack_tick: 177,
        players_in_range: 1,
        players_not_in_range: 3,
        bounced_player: Some("715".to_string()),
    });
    assert_eq!(
        convert_event(&party, &bounced),
        EventOutcome::Accepted(EventKind::VerzikBounce(VerzikBounce {
            attack_tick: Tick(177),
            players_in_range: 1,
            bounced: Some(PartyIndex::from_usize(1)),
        }))
    );

    let mut no_bounce = proto::Event {
        tick: 165,
        stage: Stage::TobVerzik as i32,
        ..Default::default()
    };
    no_bounce.set_type(proto::event::Type::TobVerzikBounce);
    no_bounce.verzik_bounce = Some(proto::event::VerzikBounce {
        npc_attack_tick: 165,
        players_in_range: 1,
        players_not_in_range: 3,
        bounced_player: None,
    });
    assert_eq!(
        convert_event(&party, &no_bounce),
        EventOutcome::Accepted(EventKind::VerzikBounce(VerzikBounce {
            attack_tick: Tick(165),
            players_in_range: 1,
            bounced: None,
        }))
    );

    let mut invalid_npc_attack_tick = proto::Event {
        tick: 136,
        stage: Stage::TobVerzik as i32,
        ..Default::default()
    };
    invalid_npc_attack_tick.set_type(proto::event::Type::TobVerzikBounce);
    invalid_npc_attack_tick.verzik_bounce = Some(proto::event::VerzikBounce {
        npc_attack_tick: -1,
        players_in_range: 0,
        players_not_in_range: 3,
        bounced_player: None,
    });
    assert_eq!(
        convert_event(&party, &invalid_npc_attack_tick),
        EventOutcome::Rejected(RejectionReason::InvalidField {
            field: "verzik_bounce.npc_attack_tick",
            error: FieldError::OutOfDomain("-1".to_string()),
        })
    );

    let mut attack_after_tick = proto::Event {
        tick: 342,
        stage: Stage::TobVerzik as i32,
        ..Default::default()
    };
    attack_after_tick.set_type(proto::event::Type::TobVerzikBounce);
    attack_after_tick.verzik_bounce = Some(proto::event::VerzikBounce {
        npc_attack_tick: 343,
        players_in_range: 1,
        players_not_in_range: 3,
        bounced_player: Some("715".to_string()),
    });
    assert_eq!(
        convert_event(&party, &attack_after_tick),
        EventOutcome::Rejected(RejectionReason::Inconsistent(
            "bounce attack_tick after event tick"
        ))
    );

    let mut invalid_players_in_range = proto::Event {
        tick: 161,
        stage: Stage::TobVerzik as i32,
        ..Default::default()
    };
    invalid_players_in_range.set_type(proto::event::Type::TobVerzikBounce);
    invalid_players_in_range.verzik_bounce = Some(proto::event::VerzikBounce {
        npc_attack_tick: 161,
        players_in_range: 300,
        players_not_in_range: 4,
        bounced_player: None,
    });
    assert_eq!(
        convert_event(&party, &invalid_players_in_range),
        EventOutcome::Rejected(RejectionReason::InvalidField {
            field: "verzik_bounce.players_in_range",
            error: FieldError::OutOfDomain("300".to_string()),
        })
    );

    let mut unknown_bounced_player = proto::Event {
        tick: 290,
        stage: Stage::TobVerzik as i32,
        ..Default::default()
    };
    unknown_bounced_player.set_type(proto::event::Type::TobVerzikBounce);
    unknown_bounced_player.verzik_bounce = Some(proto::event::VerzikBounce {
        npc_attack_tick: 289,
        players_in_range: 1,
        players_not_in_range: 3,
        bounced_player: Some("Dedion".to_string()),
    });
    assert_eq!(
        convert_event(&party, &unknown_bounced_player),
        EventOutcome::Rejected(RejectionReason::InvalidField {
            field: "verzik_bounce.bounced_player",
            error: FieldError::UnknownActor(RawActor::Player("Dedion".to_string())),
        })
    );

    let mut missing_verzik_bounce = proto::Event {
        tick: 169,
        stage: Stage::TobVerzik as i32,
        ..Default::default()
    };
    missing_verzik_bounce.set_type(proto::event::Type::TobVerzikBounce);
    assert_eq!(
        convert_event(&party, &missing_verzik_bounce),
        EventOutcome::Rejected(RejectionReason::MissingPayload("verzik_bounce"))
    );
}

#[test]
fn convert_verzik_heal() {
    let party = vec![
        Rsn::try_from("Caps lock13").unwrap(),
        Rsn::try_from("vShawneh").unwrap(),
        Rsn::try_from("Yieldofin").unwrap(),
    ];

    let mut heal = proto::Event {
        tick: 491,
        stage: Stage::TobVerzik as i32,
        x_coord: 3170,
        y_coord: 4308,
        ..Default::default()
    };
    heal.set_type(proto::event::Type::TobVerzikHeal);
    heal.verzik_heal = Some(proto::event::VerzikHeal {
        player: "Yieldofin".to_string(),
        heal_amount: 141,
    });
    assert_eq!(
        convert_event(&party, &heal),
        EventOutcome::Accepted(EventKind::VerzikHeal(VerzikHeal {
            player: PartyIndex::from_usize(2),
            amount: Some(141),
        }))
    );

    let mut unknown_amount = proto::Event {
        tick: 465,
        stage: Stage::TobVerzik as i32,
        x_coord: 3176,
        y_coord: 4312,
        ..Default::default()
    };
    unknown_amount.set_type(proto::event::Type::TobVerzikHeal);
    unknown_amount.verzik_heal = Some(proto::event::VerzikHeal {
        player: "Caps lock13".to_string(),
        heal_amount: -1,
    });
    assert_eq!(
        convert_event(&party, &unknown_amount),
        EventOutcome::Accepted(EventKind::VerzikHeal(VerzikHeal {
            player: PartyIndex::from_usize(0),
            amount: None,
        }))
    );

    let mut invalid_heal_amount = proto::Event {
        tick: 465,
        stage: Stage::TobVerzik as i32,
        x_coord: 3176,
        y_coord: 4312,
        ..Default::default()
    };
    invalid_heal_amount.set_type(proto::event::Type::TobVerzikHeal);
    invalid_heal_amount.verzik_heal = Some(proto::event::VerzikHeal {
        player: "vShawneh".to_string(),
        heal_amount: -30,
    });
    assert_eq!(
        convert_event(&party, &invalid_heal_amount),
        EventOutcome::Rejected(RejectionReason::InvalidField {
            field: "verzik_heal.heal_amount",
            error: FieldError::OutOfDomain("-30".to_string()),
        })
    );

    let mut unknown_player = proto::Event {
        tick: 491,
        stage: Stage::TobVerzik as i32,
        x_coord: 3170,
        y_coord: 4308,
        ..Default::default()
    };
    unknown_player.set_type(proto::event::Type::TobVerzikHeal);
    unknown_player.verzik_heal = Some(proto::event::VerzikHeal {
        player: "Sacolyn".to_string(),
        heal_amount: 141,
    });
    assert_eq!(
        convert_event(&party, &unknown_player),
        EventOutcome::Rejected(RejectionReason::InvalidField {
            field: "verzik_heal.player",
            error: FieldError::UnknownActor(RawActor::Player("Sacolyn".to_string())),
        })
    );

    let mut missing_verzik_heal = proto::Event {
        tick: 465,
        stage: Stage::TobVerzik as i32,
        x_coord: 3176,
        y_coord: 4312,
        ..Default::default()
    };
    missing_verzik_heal.set_type(proto::event::Type::TobVerzikHeal);
    assert_eq!(
        convert_event(&party, &missing_verzik_heal),
        EventOutcome::Rejected(RejectionReason::MissingPayload("verzik_heal"))
    );
}

#[test]
fn convert_handicap_choice() {
    let party = vec![Rsn::try_from("Supalosa").unwrap()];

    let mut choice = proto::Event {
        tick: 0,
        stage: Stage::ColosseumWave3 as i32,
        ..Default::default()
    };
    choice.set_type(proto::event::Type::ColosseumHandicapChoice);
    choice.handicap = Some(ColosseumHandicap::Blasphemy as i32);
    choice.handicap_options = vec![
        ColosseumHandicap::Blasphemy as i32,
        ColosseumHandicap::Reentry as i32,
        ColosseumHandicap::Mantimayhem as i32,
    ];
    assert_eq!(
        convert_event(&party, &choice),
        EventOutcome::Accepted(EventKind::HandicapChoice(HandicapChoice {
            handicap: ColosseumHandicap::Blasphemy,
            options: [
                ColosseumHandicap::Blasphemy,
                ColosseumHandicap::Reentry,
                ColosseumHandicap::Mantimayhem,
            ],
        }))
    );

    let mut invalid_handicap = proto::Event {
        tick: 0,
        stage: Stage::ColosseumWave5 as i32,
        ..Default::default()
    };
    invalid_handicap.set_type(proto::event::Type::ColosseumHandicapChoice);
    invalid_handicap.handicap = Some(40);
    invalid_handicap.handicap_options = vec![
        ColosseumHandicap::Blasphemy as i32,
        ColosseumHandicap::Mantimayhem as i32,
        ColosseumHandicap::Frailty as i32,
    ];
    assert_eq!(
        convert_event(&party, &invalid_handicap),
        EventOutcome::Rejected(RejectionReason::InvalidField {
            field: "handicap",
            error: FieldError::OutOfDomain("40".to_string()),
        })
    );

    let mut invalid_handicap_options = proto::Event {
        tick: 0,
        stage: Stage::ColosseumWave6 as i32,
        ..Default::default()
    };
    invalid_handicap_options.set_type(proto::event::Type::ColosseumHandicapChoice);
    invalid_handicap_options.handicap = Some(ColosseumHandicap::Doom as i32);
    invalid_handicap_options.handicap_options = vec![
        ColosseumHandicap::Relentless as i32,
        27,
        ColosseumHandicap::Doom as i32,
    ];
    assert_eq!(
        convert_event(&party, &invalid_handicap_options),
        EventOutcome::Rejected(RejectionReason::InvalidField {
            field: "handicap_options",
            error: FieldError::OutOfDomain("27".to_string()),
        })
    );

    let mut two_handicap_options = proto::Event {
        tick: 0,
        stage: Stage::ColosseumWave9 as i32,
        ..Default::default()
    };
    two_handicap_options.set_type(proto::event::Type::ColosseumHandicapChoice);
    two_handicap_options.handicap = Some(ColosseumHandicap::Quartet as i32);
    two_handicap_options.handicap_options = vec![
        ColosseumHandicap::Frailty as i32,
        ColosseumHandicap::Quartet as i32,
    ];
    assert_eq!(
        convert_event(&party, &two_handicap_options),
        EventOutcome::Rejected(RejectionReason::InvalidField {
            field: "handicap_options",
            error: FieldError::OutOfDomain("[12, 6]".to_string()),
        })
    );

    let mut handicap_not_offered = proto::Event {
        tick: 0,
        stage: Stage::ColosseumWave7 as i32,
        ..Default::default()
    };
    handicap_not_offered.set_type(proto::event::Type::ColosseumHandicapChoice);
    handicap_not_offered.handicap = Some(ColosseumHandicap::Bees as i32);
    handicap_not_offered.handicap_options = vec![
        ColosseumHandicap::Doom as i32,
        ColosseumHandicap::Solarflare as i32,
        ColosseumHandicap::RedFlag as i32,
    ];
    assert_eq!(
        convert_event(&party, &handicap_not_offered),
        EventOutcome::Rejected(RejectionReason::Inconsistent(
            "handicap not among its options"
        ))
    );

    let mut missing_handicap = proto::Event {
        tick: 0,
        stage: Stage::ColosseumWave2 as i32,
        ..Default::default()
    };
    missing_handicap.set_type(proto::event::Type::ColosseumHandicapChoice);
    missing_handicap.handicap_options = vec![
        ColosseumHandicap::Frailty as i32,
        ColosseumHandicap::Blasphemy as i32,
        ColosseumHandicap::Quartet as i32,
    ];
    assert_eq!(
        convert_event(&party, &missing_handicap),
        EventOutcome::Rejected(RejectionReason::MissingPayload("handicap"))
    );

    let mut missing_handicap_options = proto::Event {
        tick: 0,
        stage: Stage::ColosseumWave1 as i32,
        ..Default::default()
    };
    missing_handicap_options.set_type(proto::event::Type::ColosseumHandicapChoice);
    missing_handicap_options.handicap = Some(ColosseumHandicap::Blasphemy as i32);
    assert_eq!(
        convert_event(&party, &missing_handicap_options),
        EventOutcome::Rejected(RejectionReason::MissingPayload("handicap_options"))
    );
}

#[test]
fn convert_doom_applied() {
    let party = vec![Rsn::try_from("Caywu").unwrap()];

    let mut doom = proto::Event {
        tick: 14,
        stage: Stage::ColosseumWave4 as i32,
        x_coord: 1823,
        y_coord: 3103,
        ..Default::default()
    };
    doom.set_type(proto::event::Type::ColosseumDoomApplied);
    assert_eq!(
        convert_event(&party, &doom),
        EventOutcome::Accepted(EventKind::DoomApplied)
    );
}

#[test]
fn convert_totem_heal() {
    let party = vec![Rsn::try_from("715").unwrap()];

    let mut heal = proto::Event {
        tick: 89,
        stage: Stage::ColosseumWave5 as i32,
        x_coord: 1819,
        y_coord: 3112,
        ..Default::default()
    };
    heal.set_type(proto::event::Type::ColosseumTotemHeal);
    heal.colosseum_totem_heal = Some(proto::event::ColosseumTotemHeal {
        source: Some(proto::event::Npc {
            id: 12825,
            room_id: 55619,
            r#type: Some(proto::event::npc::Type::Basic(())),
            ..Default::default()
        }),
        target: Some(proto::event::Npc {
            id: 12817,
            room_id: 54541,
            r#type: Some(proto::event::npc::Type::Basic(())),
            ..Default::default()
        }),
        start_tick: 86,
        heal_amount: 66,
    });
    assert_eq!(
        convert_event(&party, &heal),
        EventOutcome::Accepted(EventKind::TotemHeal(TotemHeal {
            totem: RoomId(55619),
            target: RoomId(54541),
            start_tick: Tick(86),
            amount: 66,
        }))
    );

    let mut start_after_end = proto::Event {
        tick: 95,
        stage: Stage::ColosseumWave5 as i32,
        x_coord: 1819,
        y_coord: 3112,
        ..Default::default()
    };
    start_after_end.set_type(proto::event::Type::ColosseumTotemHeal);
    start_after_end.colosseum_totem_heal = Some(proto::event::ColosseumTotemHeal {
        source: Some(proto::event::Npc {
            id: 12825,
            room_id: 55619,
            r#type: Some(proto::event::npc::Type::Basic(())),
            ..Default::default()
        }),
        target: Some(proto::event::Npc {
            id: 12817,
            room_id: 54541,
            r#type: Some(proto::event::npc::Type::Basic(())),
            ..Default::default()
        }),
        start_tick: 98,
        heal_amount: 66,
    });
    assert_eq!(
        convert_event(&party, &start_after_end),
        EventOutcome::Rejected(RejectionReason::Inconsistent(
            "totem heal started after it ended"
        ))
    );

    let mut missing_source = proto::Event {
        tick: 101,
        stage: Stage::ColosseumWave5 as i32,
        x_coord: 1819,
        y_coord: 3112,
        ..Default::default()
    };
    missing_source.set_type(proto::event::Type::ColosseumTotemHeal);
    missing_source.colosseum_totem_heal = Some(proto::event::ColosseumTotemHeal {
        source: None,
        target: Some(proto::event::Npc {
            id: 12817,
            room_id: 54541,
            r#type: Some(proto::event::npc::Type::Basic(())),
            ..Default::default()
        }),
        start_tick: 98,
        heal_amount: 59,
    });
    assert_eq!(
        convert_event(&party, &missing_source),
        EventOutcome::Rejected(RejectionReason::MissingPayload(
            "colosseum_totem_heal.source"
        ))
    );

    let mut missing_target = proto::Event {
        tick: 113,
        stage: Stage::ColosseumWave5 as i32,
        x_coord: 1819,
        y_coord: 3112,
        ..Default::default()
    };
    missing_target.set_type(proto::event::Type::ColosseumTotemHeal);
    missing_target.colosseum_totem_heal = Some(proto::event::ColosseumTotemHeal {
        source: Some(proto::event::Npc {
            id: 12825,
            room_id: 55619,
            r#type: Some(proto::event::npc::Type::Basic(())),
            ..Default::default()
        }),
        target: None,
        start_tick: 110,
        heal_amount: 2,
    });
    assert_eq!(
        convert_event(&party, &missing_target),
        EventOutcome::Rejected(RejectionReason::MissingPayload(
            "colosseum_totem_heal.target"
        ))
    );

    let mut missing_colosseum_totem_heal = proto::Event {
        tick: 221,
        stage: Stage::ColosseumWave5 as i32,
        x_coord: 1819,
        y_coord: 3112,
        ..Default::default()
    };
    missing_colosseum_totem_heal.set_type(proto::event::Type::ColosseumTotemHeal);
    assert_eq!(
        convert_event(&party, &missing_colosseum_totem_heal),
        EventOutcome::Rejected(RejectionReason::MissingPayload("colosseum_totem_heal"))
    );
}

#[test]
fn convert_sol_dust() {
    let party = vec![Rsn::try_from("aSaradomin").unwrap()];

    let mut trident_1 = proto::Event {
        tick: 14,
        stage: Stage::ColosseumWave12 as i32,
        x_coord: 1823,
        y_coord: 3108,
        ..Default::default()
    };
    trident_1.set_type(proto::event::Type::ColosseumSolDust);
    trident_1.colosseum_sol_dust = Some(proto::event::ColosseumSolDust {
        pattern: proto::event::colosseum_sol_dust::Pattern::Trident1 as i32,
        direction: Some(SolDustDirection::South as i32),
    });
    assert_eq!(
        convert_event(&party, &trident_1),
        EventOutcome::Accepted(EventKind::SolDust(SolDust::Trident1(
            SolDustDirection::South
        )))
    );

    let mut trident_2 = proto::Event {
        tick: 210,
        stage: Stage::ColosseumWave12 as i32,
        x_coord: 1823,
        y_coord: 3103,
        ..Default::default()
    };
    trident_2.set_type(proto::event::Type::ColosseumSolDust);
    trident_2.colosseum_sol_dust = Some(proto::event::ColosseumSolDust {
        pattern: proto::event::colosseum_sol_dust::Pattern::Trident2 as i32,
        direction: Some(SolDustDirection::West as i32),
    });
    assert_eq!(
        convert_event(&party, &trident_2),
        EventOutcome::Accepted(EventKind::SolDust(SolDust::Trident2(
            SolDustDirection::West
        )))
    );

    let mut shield_1 = proto::Event {
        tick: 49,
        stage: Stage::ColosseumWave12 as i32,
        x_coord: 1823,
        y_coord: 3107,
        ..Default::default()
    };
    shield_1.set_type(proto::event::Type::ColosseumSolDust);
    shield_1.colosseum_sol_dust = Some(proto::event::ColosseumSolDust {
        pattern: proto::event::colosseum_sol_dust::Pattern::Shield1 as i32,
        direction: None,
    });
    assert_eq!(
        convert_event(&party, &shield_1),
        EventOutcome::Accepted(EventKind::SolDust(SolDust::Shield1))
    );

    let mut shield_2 = proto::Event {
        tick: 55,
        stage: Stage::ColosseumWave12 as i32,
        x_coord: 1823,
        y_coord: 3107,
        ..Default::default()
    };
    shield_2.set_type(proto::event::Type::ColosseumSolDust);
    shield_2.colosseum_sol_dust = Some(proto::event::ColosseumSolDust {
        pattern: proto::event::colosseum_sol_dust::Pattern::Shield2 as i32,
        direction: None,
    });
    assert_eq!(
        convert_event(&party, &shield_2),
        EventOutcome::Accepted(EventKind::SolDust(SolDust::Shield2))
    );

    let mut missing_direction = proto::Event {
        tick: 21,
        stage: Stage::ColosseumWave12 as i32,
        x_coord: 1823,
        y_coord: 3108,
        ..Default::default()
    };
    missing_direction.set_type(proto::event::Type::ColosseumSolDust);
    missing_direction.colosseum_sol_dust = Some(proto::event::ColosseumSolDust {
        pattern: proto::event::colosseum_sol_dust::Pattern::Trident2 as i32,
        direction: None,
    });
    assert_eq!(
        convert_event(&party, &missing_direction),
        EventOutcome::Rejected(RejectionReason::MissingPayload(
            "colosseum_sol_dust.direction"
        ))
    );

    let mut invalid_direction = proto::Event {
        tick: 28,
        stage: Stage::ColosseumWave12 as i32,
        x_coord: 1823,
        y_coord: 3108,
        ..Default::default()
    };
    invalid_direction.set_type(proto::event::Type::ColosseumSolDust);
    invalid_direction.colosseum_sol_dust = Some(proto::event::ColosseumSolDust {
        pattern: proto::event::colosseum_sol_dust::Pattern::Trident1 as i32,
        direction: Some(4),
    });
    assert_eq!(
        convert_event(&party, &invalid_direction),
        EventOutcome::Rejected(RejectionReason::InvalidField {
            field: "colosseum_sol_dust.direction",
            error: FieldError::OutOfDomain("4".to_string()),
        })
    );

    let mut invalid_pattern = proto::Event {
        tick: 42,
        stage: Stage::ColosseumWave12 as i32,
        x_coord: 1823,
        y_coord: 3107,
        ..Default::default()
    };
    invalid_pattern.set_type(proto::event::Type::ColosseumSolDust);
    invalid_pattern.colosseum_sol_dust = Some(proto::event::ColosseumSolDust {
        pattern: 7,
        direction: Some(SolDustDirection::South as i32),
    });
    assert_eq!(
        convert_event(&party, &invalid_pattern),
        EventOutcome::Rejected(RejectionReason::InvalidField {
            field: "colosseum_sol_dust.pattern",
            error: FieldError::OutOfDomain("7".to_string()),
        })
    );

    let mut missing_colosseum_sol_dust = proto::Event {
        tick: 80,
        stage: Stage::ColosseumWave12 as i32,
        x_coord: 1823,
        y_coord: 3105,
        ..Default::default()
    };
    missing_colosseum_sol_dust.set_type(proto::event::Type::ColosseumSolDust);
    assert_eq!(
        convert_event(&party, &missing_colosseum_sol_dust),
        EventOutcome::Rejected(RejectionReason::MissingPayload("colosseum_sol_dust"))
    );
}

#[test]
fn convert_sol_grapple() {
    let party = vec![Rsn::try_from("Supalosa").unwrap()];

    let mut parried = proto::Event {
        tick: 130,
        stage: Stage::ColosseumWave12 as i32,
        x_coord: 1819,
        y_coord: 3108,
        ..Default::default()
    };
    parried.set_type(proto::event::Type::ColosseumSolGrapple);
    parried.colosseum_sol_grapple = Some(proto::event::ColosseumSolGrapple {
        attack_tick: 126,
        target: item::EquipmentSlot::Boots as i32,
        outcome: SolGrappleOutcome::Parry as i32,
    });
    assert_eq!(
        convert_event(&party, &parried),
        EventOutcome::Accepted(EventKind::SolGrapple(SolGrapple {
            attack_tick: Tick(126),
            target: item::EquipmentSlot::Boots,
            outcome: SolGrappleOutcome::Parry,
        }))
    );

    let mut hit = proto::Event {
        tick: 104,
        stage: Stage::ColosseumWave12 as i32,
        x_coord: 1823,
        y_coord: 3107,
        ..Default::default()
    };
    hit.set_type(proto::event::Type::ColosseumSolGrapple);
    hit.colosseum_sol_grapple = Some(proto::event::ColosseumSolGrapple {
        attack_tick: 99,
        target: item::EquipmentSlot::Cape as i32,
        outcome: SolGrappleOutcome::Hit as i32,
    });
    assert_eq!(
        convert_event(&party, &hit),
        EventOutcome::Accepted(EventKind::SolGrapple(SolGrapple {
            attack_tick: Tick(99),
            target: item::EquipmentSlot::Cape,
            outcome: SolGrappleOutcome::Hit,
        }))
    );

    let mut attack_after_tick = proto::Event {
        tick: 175,
        stage: Stage::ColosseumWave12 as i32,
        x_coord: 1826,
        y_coord: 3109,
        ..Default::default()
    };
    attack_after_tick.set_type(proto::event::Type::ColosseumSolGrapple);
    attack_after_tick.colosseum_sol_grapple = Some(proto::event::ColosseumSolGrapple {
        attack_tick: 176,
        target: item::EquipmentSlot::Cape as i32,
        outcome: SolGrappleOutcome::Parry as i32,
    });
    assert_eq!(
        convert_event(&party, &attack_after_tick),
        EventOutcome::Rejected(RejectionReason::Inconsistent(
            "grapple attack_tick after event tick"
        ))
    );

    let mut invalid_target = proto::Event {
        tick: 207,
        stage: Stage::ColosseumWave12 as i32,
        x_coord: 1822,
        y_coord: 3109,
        ..Default::default()
    };
    invalid_target.set_type(proto::event::Type::ColosseumSolGrapple);
    invalid_target.colosseum_sol_grapple = Some(proto::event::ColosseumSolGrapple {
        attack_tick: 203,
        target: 12,
        outcome: SolGrappleOutcome::Parry as i32,
    });
    assert_eq!(
        convert_event(&party, &invalid_target),
        EventOutcome::Rejected(RejectionReason::InvalidField {
            field: "colosseum_sol_grapple.target",
            error: FieldError::OutOfDomain("12".to_string()),
        })
    );

    let mut invalid_outcome = proto::Event {
        tick: 136,
        stage: Stage::ColosseumWave12 as i32,
        x_coord: 1829,
        y_coord: 3110,
        ..Default::default()
    };
    invalid_outcome.set_type(proto::event::Type::ColosseumSolGrapple);
    invalid_outcome.colosseum_sol_grapple = Some(proto::event::ColosseumSolGrapple {
        attack_tick: 132,
        target: item::EquipmentSlot::Boots as i32,
        outcome: 3,
    });
    assert_eq!(
        convert_event(&party, &invalid_outcome),
        EventOutcome::Rejected(RejectionReason::InvalidField {
            field: "colosseum_sol_grapple.outcome",
            error: FieldError::OutOfDomain("3".to_string()),
        })
    );

    let mut missing_colosseum_sol_grapple = proto::Event {
        tick: 194,
        stage: Stage::ColosseumWave12 as i32,
        x_coord: 1819,
        y_coord: 3106,
        ..Default::default()
    };
    missing_colosseum_sol_grapple.set_type(proto::event::Type::ColosseumSolGrapple);
    assert_eq!(
        convert_event(&party, &missing_colosseum_sol_grapple),
        EventOutcome::Rejected(RejectionReason::MissingPayload("colosseum_sol_grapple"))
    );
}

#[test]
fn convert_sol_pools() {
    let party = vec![Rsn::try_from("1Ogp").unwrap()];

    let mut pools = proto::Event {
        tick: 34,
        stage: Stage::ColosseumWave12 as i32,
        ..Default::default()
    };
    pools.set_type(proto::event::Type::ColosseumSolPools);
    pools.colosseum_sol_pools = Some(proto::event::ColosseumSolPools {
        pools: vec![
            proto::Coords { x: 1830, y: 3108 },
            proto::Coords { x: 1831, y: 3107 },
            proto::Coords { x: 1829, y: 3110 },
            proto::Coords { x: 1828, y: 3111 },
            proto::Coords { x: 1830, y: 3112 },
        ],
    });
    assert_eq!(
        convert_event(&party, &pools),
        EventOutcome::Accepted(EventKind::SolPools(vec![
            Point(1830, 3108),
            Point(1831, 3107),
            Point(1829, 3110),
            Point(1828, 3111),
            Point(1830, 3112),
        ]))
    );

    let mut invalid_pools = proto::Event {
        tick: 173,
        stage: Stage::ColosseumWave12 as i32,
        ..Default::default()
    };
    invalid_pools.set_type(proto::event::Type::ColosseumSolPools);
    invalid_pools.colosseum_sol_pools = Some(proto::event::ColosseumSolPools {
        pools: vec![proto::Coords { x: 1825, y: 70_001 }],
    });
    assert_eq!(
        convert_event(&party, &invalid_pools),
        EventOutcome::Rejected(RejectionReason::InvalidField {
            field: "colosseum_sol_pools.pools",
            error: FieldError::OutOfDomain("(1825,70001)".to_string()),
        })
    );

    let mut missing_pools = proto::Event {
        tick: 62,
        stage: Stage::ColosseumWave12 as i32,
        ..Default::default()
    };
    missing_pools.set_type(proto::event::Type::ColosseumSolPools);
    missing_pools.colosseum_sol_pools = Some(proto::event::ColosseumSolPools { pools: vec![] });
    assert_eq!(
        convert_event(&party, &missing_pools),
        EventOutcome::Rejected(RejectionReason::MissingPayload("colosseum_sol_pools.pools"))
    );

    let mut missing_colosseum_sol_pools = proto::Event {
        tick: 107,
        stage: Stage::ColosseumWave12 as i32,
        ..Default::default()
    };
    missing_colosseum_sol_pools.set_type(proto::event::Type::ColosseumSolPools);
    assert_eq!(
        convert_event(&party, &missing_colosseum_sol_pools),
        EventOutcome::Rejected(RejectionReason::MissingPayload("colosseum_sol_pools"))
    );
}

#[test]
fn convert_sol_lasers() {
    let party = vec![Rsn::try_from("Sacolyn").unwrap()];

    let mut scan = proto::Event {
        tick: 43,
        stage: Stage::ColosseumWave12 as i32,
        ..Default::default()
    };
    scan.set_type(proto::event::Type::ColosseumSolLasers);
    scan.colosseum_sol_lasers = Some(proto::event::ColosseumSolLasers {
        phase: SolLaserPhase::Scan as i32,
    });
    assert_eq!(
        convert_event(&party, &scan),
        EventOutcome::Accepted(EventKind::SolLasers(SolLaserPhase::Scan))
    );

    let mut shot = proto::Event {
        tick: 47,
        stage: Stage::ColosseumWave12 as i32,
        ..Default::default()
    };
    shot.set_type(proto::event::Type::ColosseumSolLasers);
    shot.colosseum_sol_lasers = Some(proto::event::ColosseumSolLasers {
        phase: SolLaserPhase::Shot as i32,
    });
    assert_eq!(
        convert_event(&party, &shot),
        EventOutcome::Accepted(EventKind::SolLasers(SolLaserPhase::Shot))
    );

    let mut invalid_phase = proto::Event {
        tick: 79,
        stage: Stage::ColosseumWave12 as i32,
        ..Default::default()
    };
    invalid_phase.set_type(proto::event::Type::ColosseumSolLasers);
    invalid_phase.colosseum_sol_lasers = Some(proto::event::ColosseumSolLasers { phase: 2 });
    assert_eq!(
        convert_event(&party, &invalid_phase),
        EventOutcome::Rejected(RejectionReason::InvalidField {
            field: "colosseum_sol_lasers.phase",
            error: FieldError::OutOfDomain("2".to_string()),
        })
    );

    let mut missing_colosseum_sol_lasers = proto::Event {
        tick: 83,
        stage: Stage::ColosseumWave12 as i32,
        ..Default::default()
    };
    missing_colosseum_sol_lasers.set_type(proto::event::Type::ColosseumSolLasers);
    assert_eq!(
        convert_event(&party, &missing_colosseum_sol_lasers),
        EventOutcome::Rejected(RejectionReason::MissingPayload("colosseum_sol_lasers"))
    );
}

#[test]
fn convert_mokhaiotl_orb() {
    let party = vec![Rsn::try_from("LC8").unwrap()];

    let mut ranged = proto::Event {
        tick: 13,
        stage: Stage::MokhaiotlDelve2 as i32,
        ..Default::default()
    };
    ranged.set_type(proto::event::Type::MokhaiotlOrb);
    ranged.mokhaiotl_orb = Some(proto::event::MokhaiotlOrb {
        source: MokhaiotlOrbSource::Mokhaiotl as i32,
        source_point: Some(proto::Coords { x: 3423, y: 6437 }),
        style: proto::event::attack_style::Style::Range as i32,
        start_tick: 6,
        end_tick: 13,
    });
    assert_eq!(
        convert_event(&party, &ranged),
        EventOutcome::Accepted(EventKind::MokhaiotlOrb(MokhaiotlOrb {
            source: MokhaiotlOrbSource::Mokhaiotl,
            source_point: Point(3423, 6437),
            style: CombatStyle::Ranged,
            spawn_tick: Tick(6),
            end_tick: Tick(13),
        }))
    );

    let mut melee = proto::Event {
        tick: 19,
        stage: Stage::MokhaiotlDelve2 as i32,
        ..Default::default()
    };
    melee.set_type(proto::event::Type::MokhaiotlOrb);
    melee.mokhaiotl_orb = Some(proto::event::MokhaiotlOrb {
        source: MokhaiotlOrbSource::Mokhaiotl as i32,
        source_point: Some(proto::Coords { x: 3423, y: 6437 }),
        style: proto::event::attack_style::Style::Melee as i32,
        start_tick: 12,
        end_tick: 19,
    });
    assert_eq!(
        convert_event(&party, &melee),
        EventOutcome::Accepted(EventKind::MokhaiotlOrb(MokhaiotlOrb {
            source: MokhaiotlOrbSource::Mokhaiotl,
            source_point: Point(3423, 6437),
            style: CombatStyle::Melee,
            spawn_tick: Tick(12),
            end_tick: Tick(19),
        }))
    );

    let mut from_ball = proto::Event {
        tick: 34,
        stage: Stage::MokhaiotlDelve2 as i32,
        ..Default::default()
    };
    from_ball.set_type(proto::event::Type::MokhaiotlOrb);
    from_ball.mokhaiotl_orb = Some(proto::event::MokhaiotlOrb {
        source: MokhaiotlOrbSource::Ball as i32,
        source_point: Some(proto::Coords { x: 3419, y: 6432 }),
        style: proto::event::attack_style::Style::Mage as i32,
        start_tick: 28,
        end_tick: 34,
    });
    assert_eq!(
        convert_event(&party, &from_ball),
        EventOutcome::Accepted(EventKind::MokhaiotlOrb(MokhaiotlOrb {
            source: MokhaiotlOrbSource::Ball,
            source_point: Point(3419, 6432),
            style: CombatStyle::Magic,
            spawn_tick: Tick(28),
            end_tick: Tick(34),
        }))
    );

    let mut invalid_source = proto::Event {
        tick: 33,
        stage: Stage::MokhaiotlDelve2 as i32,
        ..Default::default()
    };
    invalid_source.set_type(proto::event::Type::MokhaiotlOrb);
    invalid_source.mokhaiotl_orb = Some(proto::event::MokhaiotlOrb {
        source: 5,
        source_point: Some(proto::Coords { x: 3422, y: 6429 }),
        style: proto::event::attack_style::Style::Range as i32,
        start_tick: 28,
        end_tick: 33,
    });
    assert_eq!(
        convert_event(&party, &invalid_source),
        EventOutcome::Rejected(RejectionReason::InvalidField {
            field: "mokhaiotl_orb.source",
            error: FieldError::OutOfDomain("5".to_string()),
        })
    );

    let mut missing_source_point = proto::Event {
        tick: 47,
        stage: Stage::MokhaiotlDelve2 as i32,
        ..Default::default()
    };
    missing_source_point.set_type(proto::event::Type::MokhaiotlOrb);
    missing_source_point.mokhaiotl_orb = Some(proto::event::MokhaiotlOrb {
        source: MokhaiotlOrbSource::Ball as i32,
        source_point: None,
        style: proto::event::attack_style::Style::Range as i32,
        start_tick: 42,
        end_tick: 47,
    });
    assert_eq!(
        convert_event(&party, &missing_source_point),
        EventOutcome::Rejected(RejectionReason::MissingPayload(
            "mokhaiotl_orb.source_point"
        ))
    );

    let mut invalid_source_point = proto::Event {
        tick: 48,
        stage: Stage::MokhaiotlDelve2 as i32,
        ..Default::default()
    };
    invalid_source_point.set_type(proto::event::Type::MokhaiotlOrb);
    invalid_source_point.mokhaiotl_orb = Some(proto::event::MokhaiotlOrb {
        source: MokhaiotlOrbSource::Ball as i32,
        source_point: Some(proto::Coords { x: 3427, y: -6426 }),
        style: proto::event::attack_style::Style::Mage as i32,
        start_tick: 42,
        end_tick: 48,
    });
    assert_eq!(
        convert_event(&party, &invalid_source_point),
        EventOutcome::Rejected(RejectionReason::InvalidField {
            field: "mokhaiotl_orb.source_point",
            error: FieldError::OutOfDomain("(3427,-6426)".to_string()),
        })
    );

    let mut invalid_style = proto::Event {
        tick: 51,
        stage: Stage::MokhaiotlDelve2 as i32,
        ..Default::default()
    };
    invalid_style.set_type(proto::event::Type::MokhaiotlOrb);
    invalid_style.mokhaiotl_orb = Some(proto::event::MokhaiotlOrb {
        source: MokhaiotlOrbSource::Mokhaiotl as i32,
        source_point: Some(proto::Coords { x: 3423, y: 6437 }),
        style: 3,
        start_tick: 44,
        end_tick: 51,
    });
    assert_eq!(
        convert_event(&party, &invalid_style),
        EventOutcome::Rejected(RejectionReason::InvalidField {
            field: "mokhaiotl_orb.style",
            error: FieldError::OutOfDomain("3".to_string()),
        })
    );

    let mut start_after_end = proto::Event {
        tick: 57,
        stage: Stage::MokhaiotlDelve2 as i32,
        ..Default::default()
    };
    start_after_end.set_type(proto::event::Type::MokhaiotlOrb);
    start_after_end.mokhaiotl_orb = Some(proto::event::MokhaiotlOrb {
        source: MokhaiotlOrbSource::Mokhaiotl as i32,
        source_point: Some(proto::Coords { x: 3423, y: 6437 }),
        style: proto::event::attack_style::Style::Melee as i32,
        start_tick: 60,
        end_tick: 57,
    });
    assert_eq!(
        convert_event(&party, &start_after_end),
        EventOutcome::Rejected(RejectionReason::Inconsistent(
            "orb start_tick after end_tick"
        ))
    );

    let mut end_after_tick = proto::Event {
        tick: 71,
        stage: Stage::MokhaiotlDelve2 as i32,
        ..Default::default()
    };
    end_after_tick.set_type(proto::event::Type::MokhaiotlOrb);
    end_after_tick.mokhaiotl_orb = Some(proto::event::MokhaiotlOrb {
        source: MokhaiotlOrbSource::Mokhaiotl as i32,
        source_point: Some(proto::Coords { x: 3423, y: 6438 }),
        style: proto::event::attack_style::Style::Mage as i32,
        start_tick: 66,
        end_tick: 74,
    });
    assert_eq!(
        convert_event(&party, &end_after_tick),
        EventOutcome::Rejected(RejectionReason::Inconsistent(
            "orb end_tick after event tick"
        ))
    );

    let mut missing_mokhaiotl_orb = proto::Event {
        tick: 72,
        stage: Stage::MokhaiotlDelve2 as i32,
        ..Default::default()
    };
    missing_mokhaiotl_orb.set_type(proto::event::Type::MokhaiotlOrb);
    assert_eq!(
        convert_event(&party, &missing_mokhaiotl_orb),
        EventOutcome::Rejected(RejectionReason::MissingPayload("mokhaiotl_orb"))
    );
}

#[test]
fn convert_mokhaiotl_larva_leak() {
    let party = vec![Rsn::try_from("1Ogp").unwrap()];

    let mut leak = proto::Event {
        tick: 78,
        stage: Stage::MokhaiotlDelve8 as i32,
        ..Default::default()
    };
    leak.set_type(proto::event::Type::MokhaiotlLarvaLeak);
    leak.mokhaiotl_larva_leak = Some(proto::event::MokhaiotlLarvaLeak {
        room_id: 45389,
        heal_amount: 23,
    });
    assert_eq!(
        convert_event(&party, &leak),
        EventOutcome::Accepted(EventKind::MokhaiotlLarvaLeak(MokhaiotlLarvaLeak {
            larva: RoomId(45389),
            heal_amount: 23,
        }))
    );

    let mut missing_mokhaiotl_larva_leak = proto::Event {
        tick: 93,
        stage: Stage::MokhaiotlDelve8 as i32,
        ..Default::default()
    };
    missing_mokhaiotl_larva_leak.set_type(proto::event::Type::MokhaiotlLarvaLeak);
    assert_eq!(
        convert_event(&party, &missing_mokhaiotl_larva_leak),
        EventOutcome::Rejected(RejectionReason::MissingPayload("mokhaiotl_larva_leak"))
    );
}

#[test]
fn convert_inferno_wave_start() {
    let party = vec![Rsn::try_from("Caywu").unwrap()];

    let mut start = proto::Event {
        tick: 0,
        stage: Stage::InfernoWave21 as i32,
        ..Default::default()
    };
    start.set_type(proto::event::Type::InfernoWaveStart);
    start.inferno_wave_start = Some(proto::event::InfernoWaveStart {
        wave: 21,
        overall_ticks: 803,
    });
    assert_eq!(
        convert_event(&party, &start),
        EventOutcome::Accepted(EventKind::InfernoWaveStart(Ticks(803)))
    );

    let mut missing_inferno_wave_start = proto::Event {
        tick: 0,
        stage: Stage::InfernoWave34 as i32,
        ..Default::default()
    };
    missing_inferno_wave_start.set_type(proto::event::Type::InfernoWaveStart);
    assert_eq!(
        convert_event(&party, &missing_inferno_wave_start),
        EventOutcome::Rejected(RejectionReason::MissingPayload("inferno_wave_start"))
    );
}
