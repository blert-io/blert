use crate::tick::{Tick, Ticks};
use crate::{NpcProperties, Recording, RoomId, TickState, npc};

use super::Interpreter;

// Spotanims which render the star floor during P4, one per quadrant of the room.
const P4_RANGED_START_ANIMS: [u32; 4] = [4349, 4355, 4361, 4367];
const P4_MELEE_START_ANIMS: [u32; 4] = [4352, 4358, 4364, 4370];

/// State of Ocellus on a single tick.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OcellusProperties {
    P4(P4),
}

impl OcellusProperties {
    pub(crate) fn remap_ticks(&mut self, mut remap: impl FnMut(Tick) -> Tick) {
        match self {
            Self::P4(P4::Ranged(start) | P4::Melee(start)) => *start = remap(*start),
        }
    }
}

/// Ocellus' final quadrant cycle.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum P4 {
    /// Has been in the ranged half of the cycle since a specific tick.
    Ranged(Tick),
    /// Has been in the melee half of the cycle since a specific tick.
    Melee(Tick),
}

impl P4 {
    pub(crate) fn attacks_ignore_cooldown(&self, tick: Tick) -> bool {
        // In each phase of the P4 cycle, players can attack every 2t during
        // specific windows, observed relative to the start of the phase.
        match *self {
            Self::Ranged(start) => (Ticks(10)..=Ticks(20)).contains(&(tick - start)),
            Self::Melee(start) => (Ticks(10)..=Ticks(21)).contains(&(tick - start)),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum InterpretState {
    Start,
    P4 { marker: RoomId },
}

enum Decision {
    Properties(OcellusProperties),
}

pub(super) struct OcellusInterpreter {
    room_id: RoomId,
    state: InterpretState,
    decisions: Vec<(Tick, Decision)>,
}

impl OcellusInterpreter {
    pub(super) fn new(recording: &Recording) -> Option<Self> {
        let room_id = recording.states().find_map(|(_, state)| {
            state
                .npcs
                .iter()
                .find_map(|(id, npc)| npc::is_ocellus(npc.id).then_some(*id))
        })?;

        Some(Self {
            room_id,
            state: InterpretState::Start,
            decisions: Vec::new(),
        })
    }

    fn handle_start(&mut self, tick: Tick, state: &TickState) {
        let Some(marker) = state
            .npcs
            .iter()
            .find_map(|(&id, npc)| (npc.id == npc::id::OCELLUS_ENRAGE_MARKER).then_some(id))
        else {
            return;
        };

        self.state = InterpretState::P4 { marker };
        self.handle_p4(marker, tick, state);
    }

    fn handle_p4(&mut self, marker: RoomId, tick: Tick, state: &TickState) {
        let Some(marker) = state.raw_npcs.get(&marker) else {
            return;
        };

        let start = marker.spot_anims.iter().find_map(|anim| {
            if P4_RANGED_START_ANIMS.contains(anim) {
                Some(P4::Ranged(tick))
            } else if P4_MELEE_START_ANIMS.contains(anim) {
                Some(P4::Melee(tick))
            } else {
                None
            }
        });
        if let Some(p4) = start {
            self.decisions
                .push((tick, Decision::Properties(OcellusProperties::P4(p4))));
        }
    }
}

impl Interpreter for OcellusInterpreter {
    fn decide(&mut self, recording: &Recording) {
        for (tick, state) in recording.states() {
            match self.state {
                InterpretState::Start => self.handle_start(tick, state),
                InterpretState::P4 { marker } => self.handle_p4(marker, tick, state),
            }
        }
    }

    fn apply(self, recording: &mut Recording) -> Option<Tick> {
        let mut decisions = self.decisions.into_iter().peekable();
        let mut properties = None;
        for (tick, state) in recording.states_mut() {
            while let Some((_, decision)) = decisions.next_if(|&(decided, _)| decided <= tick) {
                match decision {
                    Decision::Properties(decided) => {
                        properties = Some(NpcProperties::Ocellus(decided));
                    }
                }
            }
            if let Some(ocellus) = state.npcs.get_mut(&self.room_id) {
                ocellus.properties.clone_from(&properties);
            }
        }
        None
    }
}
