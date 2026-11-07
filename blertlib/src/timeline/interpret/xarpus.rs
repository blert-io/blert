use std::collections::{BTreeMap, BTreeSet};

use crate::actor::{Actor, NpcState, RoomId};
use crate::event::{Event, EventKind, NpcAttacked, XarpusSplat, XarpusSplatSource};
use crate::proto::event::object_update;
use crate::tick::{Tick, Ticks};
use crate::timeline::Recording;
use crate::{ChallengeMode, NpcAttack, ObjectKind, PluginVersion, Point, Source, XarpusPhase, npc};

use super::{
    Direction, InterpretContext, Interpreter, ObjectDef, Orientation, RawNpc, SpotAnimPlacement,
};

pub(super) const GENERIC_VERSION: PluginVersion = PluginVersion::new(0, 10, 7);

const SPIT_ANIMATION: u32 = 8059;
const ACID_PROJECTILE: u32 = 1555;
const SPLAT_SPOT_ANIM: u32 = 1556;
const EXHUMED: ObjectDef = ObjectDef(object_update::Type::Ground, 32743);

/// Threshold above which overhead text cannot indicate P3.
///
/// This is deliberately set high as varbits can lag. It only matters for the
/// rare cases that a client runs some plugin which adds overhead text to Xarpus
/// before its screech happens, which has only been observed a handful of times.
/// The threshold itself doesn't decide anything; the interpreter will revert
/// its P3 decision if there are signs that P2 is still ongoing and look back to
/// find the real start tick once enough information exists. The threshold exists
/// simply to limit the amount of redundant work done by only running this
/// fallback when P3 is plausibly near.
const P3_HP_THRESHOLD: f32 = 30.0;

pub(super) struct XarpusInterpreter<'a> {
    ctx: &'a InterpretContext,
    room_id: RoomId,
    events: BTreeMap<Tick, Vec<EventKind>>,
}

impl<'a> XarpusInterpreter<'a> {
    pub(super) fn new(ctx: &'a InterpretContext, recording: &Recording) -> Option<Self> {
        if ctx.plugin_version < GENERIC_VERSION {
            return None;
        }

        let room_id = recording.states().find_map(|(_, state)| {
            state
                .npcs
                .iter()
                .find_map(|(&room_id, npc)| npc::is_xarpus(npc.id).then_some(room_id))
        })?;

        Some(Self {
            ctx,
            room_id,
            events: BTreeMap::new(),
        })
    }

    fn collect_signals(&self, recording: &Recording) -> Signals {
        let mut signals = Signals::default();
        let mut previous: Option<(&NpcState, &RawNpc)> = None;
        for (tick, state) in recording.states() {
            let Some((xarpus, raw)) = state.generic_npc(self.room_id) else {
                continue;
            };

            if !npc::is_xarpus_p1(xarpus.id) {
                if let Some((previous_xarpus, previous_raw)) = previous {
                    if npc::is_xarpus_p1(previous_xarpus.id) {
                        signals.p2.get_or_insert(tick);
                    }
                    if raw.orientation != previous_raw.orientation {
                        signals.orientation_changes.insert(tick, raw.orientation);
                    }
                }

                if raw.animation(tick) == Some(SPIT_ANIMATION) {
                    signals.spit_animations.insert(tick);
                }

                for projectile in &state.raw_projectiles {
                    if projectile.id == ACID_PROJECTILE
                        && projectile.target.is_none()
                        && xarpus.position.contains(projectile.source_coords)
                    {
                        signals
                            .spit_projectiles
                            .insert(tick, projectile.target_coords);
                    }
                }

                // Xarpus' screech shows up as overhead text. Some popular
                // plugins change the text of the screech, so the exact contents
                // aren't checked.
                if signals.potential_p3_start.is_none()
                    && raw.overhead_text.is_some()
                    && xarpus.hitpoints.percentage() < P3_HP_THRESHOLD
                {
                    signals.potential_p3_start = Some(tick);
                }
            }
            previous = Some((xarpus, raw));
        }
        signals
    }

    fn handle_splats(&mut self, recording: &Recording) {
        let mut landed = BTreeSet::new();
        let mut projectiles: BTreeMap<Point, Vec<AcidProjectile>> = BTreeMap::new();

        for (tick, state) in recording.states() {
            for spot_anim in state
                .raw_spot_anims
                .get(&SPLAT_SPOT_ANIM)
                .into_iter()
                .flatten()
            {
                let SpotAnimPlacement::Tile(position) = spot_anim.placement else {
                    continue;
                };

                let acid = projectiles.get_mut(&position).and_then(|pending| {
                    let earliest = pending
                        .iter()
                        .enumerate()
                        .min_by_key(|(_, acid)| acid.landing_tick)?
                        .0;
                    Some(pending.remove(earliest))
                });
                let source = match &acid {
                    Some(acid) if acid.from_xarpus => XarpusSplatSource::Xarpus,
                    Some(acid) if landed.contains(&acid.source_coords) => {
                        XarpusSplatSource::Bounce(acid.source_coords)
                    }
                    _ => XarpusSplatSource::Unknown,
                };
                landed.insert(position);

                self.events
                    .entry(spot_anim.draw_tick)
                    .or_default()
                    .push(EventKind::XarpusSplat(XarpusSplat {
                        position,
                        source,
                        start_tick: acid.map(|acid| acid.start_tick),
                    }));
            }

            let xarpus = state.npcs.get(&self.room_id);
            for projectile in &state.raw_projectiles {
                if projectile.id != ACID_PROJECTILE || projectile.target.is_some() {
                    continue;
                }

                projectiles
                    .entry(projectile.target_coords)
                    .or_default()
                    .push(AcidProjectile {
                        start_tick: tick,
                        landing_tick: projectile.landing_tick,
                        source_coords: projectile.source_coords,
                        from_xarpus: xarpus.is_some_and(|xarpus| {
                            xarpus.position.contains(projectile.source_coords)
                        }),
                    });
            }
        }
    }

    fn handle_p2(
        &mut self,
        recording: &Recording,
        signals: &Signals,
        p3_start: Option<Tick>,
        scan_for_p3: bool,
    ) -> Option<Tick> {
        let verified_spit_projectiles = signals
            .spit_animations
            .iter()
            .copied()
            .take_while(|&tick| p3_start.is_none_or(|start| tick < start))
            .filter_map(|tick| {
                signals
                    .spit_projectiles
                    .get(&tick)
                    .map(|&point| (tick, point))
            });

        let mut last_spit = None;
        for (tick, target_point) in verified_spit_projectiles {
            let spit_tick = tick - Ticks(2);

            // Xarpus turns on the tick before the animation plays, after the
            // scan tick. If the turn occurred on a different tick, the stream
            // must have lagged, and the spit cannot be accurately placed.
            if signals.orientation_changes.contains_key(&spit_tick)
                || signals.orientation_changes.contains_key(&tick)
            {
                continue;
            }

            let Some(state) = recording.get_state(spit_tick) else {
                continue;
            };

            // Only set a target if it's unambiguous.
            // TODO(frolv): Targets rotate in party order so it's possible to
            // determine who is next if we can be reasonably certain that there
            // hasn't been lag since the last attack, but that would require
            // separate bookkeeping.
            let mut on_tile = state.players.iter().filter_map(|(party_index, player)| {
                (player.position == target_point).then_some(party_index)
            });
            let Some(first) = on_tile.next() else {
                // No players on the tile, likely a sign of lag causing the
                // signals to be observed late. Ignore.
                continue;
            };
            let target = on_tile.next().is_none().then_some(Actor::Player(first));

            self.events
                .entry(spit_tick)
                .or_default()
                .push(EventKind::NpcAttack(NpcAttacked {
                    npc: self.room_id,
                    attack: NpcAttack::TobXarpusSpit,
                    target,
                }));
            last_spit = Some(spit_tick);
        }

        // With the overhead text ruled out, P3 can only be inferred from the
        // spits stopping. It goes 5 ticks after the last spit, once the
        // recording is far enough past it that the next spit's projectile would
        // have shown.
        if scan_for_p3
            && let Some(last_spit) = last_spit
            && recording.last_tick() >= last_spit + Ticks(6)
            && signals
                .spit_projectiles
                .range(last_spit + Ticks(3)..)
                .next()
                .is_none()
        {
            return Some(last_spit + Ticks(5));
        }

        p3_start
    }

    fn handle_p3(&mut self, signals: &Signals, screech: Option<Tick>) {
        let last_spit_projectile = signals
            .spit_projectiles
            .last_key_value()
            .map(|(&tick, _)| tick);
        let start = screech.or(last_spit_projectile).map_or(Tick(0), Tick::succ);

        let mut previous = screech;
        for (&tick, &orientation) in signals.orientation_changes.range(start..) {
            let on_cycle = previous.is_some_and(|previous| previous + Ticks(8) == tick);
            previous = Some(tick);
            if !on_cycle {
                continue;
            }

            let attack = match orientation.direction() {
                Direction::Northeast => NpcAttack::TobXarpusTurnNortheast,
                Direction::Southeast => NpcAttack::TobXarpusTurnSoutheast,
                Direction::Southwest => NpcAttack::TobXarpusTurnSouthwest,
                Direction::Northwest => NpcAttack::TobXarpusTurnNorthwest,
                Direction::North | Direction::East | Direction::South | Direction::West => {
                    continue;
                }
            };

            self.events
                .entry(tick)
                .or_default()
                .push(EventKind::NpcAttack(NpcAttacked {
                    npc: self.room_id,
                    attack,
                    target: None,
                }));
        }
    }
}

#[derive(Default)]
struct Signals {
    p2: Option<Tick>,
    potential_p3_start: Option<Tick>,
    orientation_changes: BTreeMap<Tick, Orientation>,
    spit_animations: BTreeSet<Tick>,
    spit_projectiles: BTreeMap<Tick, Point>,
}

struct AcidProjectile {
    start_tick: Tick,
    landing_tick: Tick,
    source_coords: Point,
    from_xarpus: bool,
}

impl Interpreter for XarpusInterpreter<'_> {
    fn decide(&mut self, recording: &Recording) {
        let signals = self.collect_signals(recording);
        self.handle_splats(recording);

        let in_p1 = recording
            .get_state(recording.last_tick())
            .and_then(|state| state.generic_npc(self.room_id))
            .is_some_and(|(xarpus, _)| npc::is_xarpus_p1(xarpus.id));
        if in_p1 {
            return;
        }

        // A couple of rare plugins in the wild have been observed to add fake
        // overhead text to Xarpus, preventing its presence from signaling the
        // screech. If any spits are observed after overhead text has appeared,
        // ignore the text tick and infer the P3 start from when the regular P2
        // cycle ended.
        let last_spit_projectile = signals
            .spit_projectiles
            .last_key_value()
            .map(|(&tick, _)| tick);
        let p3_start = signals
            .potential_p3_start
            .filter(|&start| last_spit_projectile.is_none_or(|last| last < start));
        let scan_for_p3 = signals.potential_p3_start.is_some() && p3_start.is_none();

        let mut p2 = signals.p2;
        let mut p3 = self.handle_p2(recording, &signals, p3_start, scan_for_p3);
        if recording.mode() != ChallengeMode::TobHard {
            self.handle_p3(&signals, p3);
        }

        // If the recording started late, place its current phase on the first tick.
        if p2.is_none() {
            let has_spits = !signals.spit_projectiles.is_empty();
            if has_spits || p3.is_some_and(|p3| p3 > Tick(0)) {
                p2 = Some(Tick(0));
            } else {
                p3 = Some(Tick(0));
            }
        }

        if let Some(p2) = p2 {
            self.events
                .entry(p2)
                .or_default()
                .push(EventKind::XarpusPhase(XarpusPhase::XarpusP2));
        }

        if let Some(p3) = p3 {
            self.events
                .entry(p3)
                .or_default()
                .push(EventKind::XarpusPhase(XarpusPhase::XarpusP3));
        }
    }

    fn apply(mut self, recording: &mut Recording) -> Option<Tick> {
        let mut changed = None;
        for (tick, state) in recording.states_mut() {
            let removed = state
                .events
                .extract_if(.., |event| match &event.kind {
                    EventKind::XarpusPhase(_) | EventKind::XarpusSplat(_) => true,
                    EventKind::NpcAttack(attack) => attack.npc == self.room_id,
                    _ => false,
                })
                .collect::<Vec<_>>();
            let added = self
                .events
                .remove(&tick)
                .into_iter()
                .flatten()
                .map(|kind| Event::recorded(self.ctx.client_id, kind))
                .collect::<Vec<_>>();
            if changed.is_none() && removed != added {
                changed = Some(tick);
            }
            state.events.extend(added);

            state.objects.clear(ObjectKind::XarpusExhumes);
            if let Some(points) = state.raw_objects.get(EXHUMED) {
                state.objects.insert(
                    ObjectKind::XarpusExhumes,
                    Source::Client(self.ctx.client_id),
                    points.iter().copied(),
                );
            }
        }
        changed
    }
}
