//! OSRS game info.

use blert::{Point, Rect, Stage};

/// Tile to which players are teleported at the start of Sotetseg's maze.
pub(super) const SOTETSEG_OVERWORLD_MAZE_START_TILE: Point = Point(3274, 4307);
pub(super) const SOTETSEG_ROOM_AREA: Rect = Rect {
    point: Point(3271, 4304),
    width: 17,
    height: 30,
};
pub(super) const SOTETSEG_UNDERWORLD_AREA: Rect = Rect {
    point: Point(3354, 4309),
    width: 14,
    height: 22,
};

/// Tiles within melee range of Verzik's fixed 3x3 P2 location.
pub(super) const VERZIK_P2_BOUNCEABLE_AREA: Rect = Rect {
    point: Point(3166, 4312),
    width: 5,
    height: 5,
};
const VERZIK_P2_CENTER_TILE: Point = Point(3168, 4314);

/// Tiles within Verzik's 7x7 P3 location during webs.
pub(super) const VERZIK_P3_WEBS_AREA: Rect = Rect {
    point: Point(3165, 4309),
    width: 7,
    height: 7,
};
const VERZIK_P3_WEBS_CENTER_TILE: Point = Point(3168, 4312);

/// Tile to which players are teleported at the start of Colosseum's boss fight.
pub(super) const COLOSSEUM_BOSS_START_TILE: Point = Point(1825, 3103);

pub(super) fn is_valid_p2_bounce_destination(point: Point) -> bool {
    matches!(point.distance(VERZIK_P2_CENTER_TILE), 5 | 6)
}

pub(super) fn is_valid_p3_webs_push_destination(point: Point) -> bool {
    point.distance(VERZIK_P3_WEBS_CENTER_TILE) == 4
}

pub(super) fn crosses_tfa_arena_boundary(stage: Stage, last: Point, current: Point) -> bool {
    let arena = match stage {
        Stage::TfaGuardian => Rect {
            point: Point(4113, 5569),
            width: 29,
            height: 44,
        },
        Stage::TfaEzekiel => Rect::square(Point(4059, 5531), 9),
        Stage::TfaBork => Rect {
            point: Point(4184, 5591),
            width: 15,
            height: 17,
        },
        Stage::TfaMoia => Rect::square(Point(4059, 5659), 9),
        Stage::TfaDreadnoth => Rect::square(Point(4184, 5656), 15),
        Stage::TfaDagonhai => Rect {
            point: Point(4055, 5590),
            width: 20,
            height: 19,
        },
        Stage::TfaXarth => Rect::square(Point(4183, 5527), 17),
        Stage::TfaOcellus => Rect::square(Point(4115, 5661), 26),
        _ => return false,
    };
    arena.contains(last) != arena.contains(current)
}

static MAIDEN_DEATH_AREAS: [Rect; 2] = [
    Rect {
        point: Point(3166, 4433),
        width: 2,
        height: 1,
    },
    Rect {
        point: Point(3166, 4460),
        width: 2,
        height: 1,
    },
];
static BLOAT_DEATH_AREAS: [Rect; 2] = [
    Rect {
        point: Point(3295, 4436),
        width: 2,
        height: 1,
    },
    Rect {
        point: Point(3295, 4459),
        width: 2,
        height: 1,
    },
];
static NYLOCAS_DEATH_AREAS: [Rect; 8] = [
    Rect {
        point: Point(3290, 4240),
        width: 1,
        height: 1,
    },
    Rect {
        point: Point(3301, 4240),
        width: 1,
        height: 1,
    },
    Rect {
        point: Point(3287, 4243),
        width: 1,
        height: 1,
    },
    Rect {
        point: Point(3304, 4243),
        width: 1,
        height: 1,
    },
    Rect {
        point: Point(3287, 4254),
        width: 1,
        height: 1,
    },
    Rect {
        point: Point(3304, 4254),
        width: 1,
        height: 1,
    },
    Rect {
        point: Point(3290, 4257),
        width: 1,
        height: 1,
    },
    Rect {
        point: Point(3301, 4257),
        width: 1,
        height: 1,
    },
];
static SOTETSEG_DEATH_AREAS: [Rect; 2] = [
    Rect {
        point: Point(3270, 4313),
        width: 1,
        height: 2,
    },
    Rect {
        point: Point(3289, 4313),
        width: 1,
        height: 2,
    },
];
static XARPUS_DEATH_AREAS: [Rect; 1] = [Rect {
    point: Point(3156, 4381),
    width: 2,
    height: 13,
}];
static VERZIK_DEATH_AREAS: [Rect; 2] = [
    Rect {
        point: Point(3157, 4325),
        width: 5,
        height: 1,
    },
    Rect {
        point: Point(3175, 4325),
        width: 5,
        height: 1,
    },
];

fn death_areas(stage: Stage) -> &'static [Rect] {
    match stage {
        Stage::TobMaiden => &MAIDEN_DEATH_AREAS,
        Stage::TobBloat => &BLOAT_DEATH_AREAS,
        Stage::TobNylocas => &NYLOCAS_DEATH_AREAS,
        Stage::TobSotetseg => &SOTETSEG_DEATH_AREAS,
        Stage::TobXarpus => &XARPUS_DEATH_AREAS,
        Stage::TobVerzik => &VERZIK_DEATH_AREAS,
        _ => &[],
    }
}

pub(super) fn is_in_death_area(stage: Stage, point: Point) -> bool {
    death_areas(stage).iter().any(|area| area.contains(point))
}
