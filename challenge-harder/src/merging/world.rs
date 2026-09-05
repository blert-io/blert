//! OSRS game info.

use crate::lifecycle::core::types::ChallengeMode;
use crate::proto::{Coords, Stage};

use super::Ticks;

#[derive(Debug, Clone, Copy)]
pub(super) struct Area {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

impl Area {
    const fn new(coords: Coords, width: i32, height: i32) -> Self {
        Area {
            x: coords.x,
            y: coords.y,
            width,
            height,
        }
    }

    pub(super) const fn contains(self, coords: Coords) -> bool {
        coords.x >= self.x
            && coords.x < self.x + self.width
            && coords.y >= self.y
            && coords.y < self.y + self.height
    }
}

pub(super) fn chebyshev(a: Coords, b: Coords) -> u32 {
    a.x.abs_diff(b.x).max(a.y.abs_diff(b.y))
}

pub(super) fn euclidean(a: Coords, b: Coords) -> f64 {
    let dx = f64::from(a.x - b.x);
    let dy = f64::from(a.y - b.y);
    dx.hypot(dy)
}

/// Tile to which players are teleported at the start of Sotetseg's maze.
pub(super) const SOTETSEG_OVERWORLD_MAZE_START_TILE: Coords = Coords { x: 3274, y: 4307 };
pub(super) const SOTETSEG_ROOM_AREA: Area = Area::new(Coords { x: 3271, y: 4304 }, 17, 30);
pub(super) const SOTETSEG_UNDERWORLD_AREA: Area = Area::new(Coords { x: 3354, y: 4309 }, 14, 22);

/// Tiles within melee range of Verzik's fixed 3x3 P2 location.
pub(super) const VERZIK_P2_BOUNCEABLE_AREA: Area = Area::new(Coords { x: 3166, y: 4312 }, 5, 5);
const VERZIK_P2_CENTER_TILE: Coords = Coords { x: 3168, y: 4314 };

/// Tiles within Verzik's 7x7 P3 location during webs.
pub(super) const VERZIK_P3_WEBS_AREA: Area = Area::new(Coords { x: 3165, y: 4309 }, 7, 7);
const VERZIK_P3_WEBS_CENTER_TILE: Coords = Coords { x: 3168, y: 4312 };

/// Tile to which players are teleported at the start of Colosseum's boss fight.
pub(super) const COLOSSEUM_BOSS_START_TILE: Coords = Coords { x: 1825, y: 3103 };

pub(super) fn is_valid_p2_bounce_destination(coords: Coords) -> bool {
    matches!(chebyshev(coords, VERZIK_P2_CENTER_TILE), 5 | 6)
}

pub(super) fn is_valid_p3_webs_push_destination(coords: Coords) -> bool {
    chebyshev(coords, VERZIK_P3_WEBS_CENTER_TILE) == 4
}

static MAIDEN_DEATH_AREAS: [Area; 2] = [
    Area::new(Coords { x: 3166, y: 4433 }, 2, 1),
    Area::new(Coords { x: 3166, y: 4460 }, 2, 1),
];
static BLOAT_DEATH_AREAS: [Area; 2] = [
    Area::new(Coords { x: 3295, y: 4436 }, 2, 1),
    Area::new(Coords { x: 3295, y: 4459 }, 2, 1),
];
static NYLOCAS_DEATH_AREAS: [Area; 8] = [
    Area::new(Coords { x: 3290, y: 4240 }, 1, 1),
    Area::new(Coords { x: 3301, y: 4240 }, 1, 1),
    Area::new(Coords { x: 3287, y: 4243 }, 1, 1),
    Area::new(Coords { x: 3304, y: 4243 }, 1, 1),
    Area::new(Coords { x: 3287, y: 4254 }, 1, 1),
    Area::new(Coords { x: 3304, y: 4254 }, 1, 1),
    Area::new(Coords { x: 3290, y: 4257 }, 1, 1),
    Area::new(Coords { x: 3301, y: 4257 }, 1, 1),
];
static SOTETSEG_DEATH_AREAS: [Area; 2] = [
    Area::new(Coords { x: 3270, y: 4313 }, 1, 2),
    Area::new(Coords { x: 3289, y: 4313 }, 1, 2),
];
static XARPUS_DEATH_AREAS: [Area; 1] = [Area::new(Coords { x: 3156, y: 4381 }, 2, 13)];
static VERZIK_DEATH_AREAS: [Area; 2] = [
    Area::new(Coords { x: 3157, y: 4325 }, 5, 1),
    Area::new(Coords { x: 3175, y: 4325 }, 5, 1),
];

fn death_areas(stage: Stage) -> &'static [Area] {
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

pub(super) fn is_in_death_area(stage: Stage, coords: Coords) -> bool {
    death_areas(stage).iter().any(|area| area.contains(coords))
}

const NATURAL_STALLS: [Ticks; 31] = [
    Ticks(4),
    Ticks(4),
    Ticks(4),
    Ticks(4),
    Ticks(16),
    Ticks(4),
    Ticks(12),
    Ticks(4),
    Ticks(12),
    Ticks(8),
    Ticks(8),
    Ticks(8),
    Ticks(8),
    Ticks(8),
    Ticks(8),
    Ticks(4),
    Ticks(12),
    Ticks(8),
    Ticks(12),
    Ticks(16),
    Ticks(8),
    Ticks(12),
    Ticks(8),
    Ticks(8),
    Ticks(8),
    Ticks(4),
    Ticks(8),
    Ticks(4),
    Ticks(4),
    Ticks(4),
    Ticks(0),
];

fn is_prince_wave(wave: u32) -> bool {
    matches!(wave, 10 | 20 | 30)
}

/// Returns the natural stall duration for a given Nylocas wave.
pub(super) fn natural_stall_for_wave(mode: ChallengeMode, wave: u32) -> Ticks {
    if mode == ChallengeMode::TobHard && is_prince_wave(wave) {
        return Ticks(16);
    }
    NATURAL_STALLS
        .get(wave as usize - 1)
        .copied()
        .expect("client consistency checks ensure validity")
}

/// Returns the sum of the natural stall durations of the Nylocas waves in
/// `[last_wave, wave)`.
pub(super) fn sum_natural_stalls(mode: ChallengeMode, last_wave: u32, wave: u32) -> Ticks {
    (last_wave..wave)
        .map(|w| natural_stall_for_wave(mode, w))
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn area_is_inclusive_of_corners() {
        assert!(SOTETSEG_ROOM_AREA.contains((3271, 4304).into()));
        assert!(SOTETSEG_ROOM_AREA.contains((3287, 4333).into()));
        assert!(SOTETSEG_ROOM_AREA.contains((3280, 4320).into()));
        assert!(!SOTETSEG_ROOM_AREA.contains((3288, 4333).into()));
        assert!(!SOTETSEG_ROOM_AREA.contains((3287, 4334).into()));
        assert!(!SOTETSEG_ROOM_AREA.contains((3270, 4304).into()));
    }
}
