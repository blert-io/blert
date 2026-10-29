use std::collections::BTreeMap;

use crate::timeline::PlayerCooldowns;
use crate::{
    Actor, BuildWarning, EventKind, PartyIndex, PlayerAttack, PlayerAttacked, Recording, Tick,
    TickState, Ticks, WarningReason, proto,
};

use super::Interpreter;

const ZORYAS_TOME_SPEC_HIT_SPOT_ANIM: u32 = 4430;
const ZORYAS_TOME_BUFFED_CASTS: u8 = 3;
const ZORYAS_TOME_BUFF_DURATION: Ticks = Ticks(50);

#[derive(Clone, Copy)]
enum Buff {
    None,
    ZoryasTome(u8),
}

struct PlayerBuffs {
    players: Vec<(Tick, Buff)>,
}

impl PlayerBuffs {
    fn new(party_size: usize) -> Self {
        Self {
            players: vec![(Tick(0), Buff::None); party_size],
        }
    }

    fn get(&self, tick: Tick, party_index: PartyIndex) -> &Buff {
        match &self.players[party_index.as_usize()] {
            (start, buff @ Buff::ZoryasTome(_)) if tick - *start < ZORYAS_TOME_BUFF_DURATION => {
                buff
            }
            _ => &Buff::None,
        }
    }

    fn set(&mut self, tick: Tick, party_index: PartyIndex, buff: Buff) {
        self.players[party_index.as_usize()] = (tick, buff);
    }

    fn consume(&mut self, party_index: PartyIndex) {
        let (_, buff) = &mut self.players[party_index.as_usize()];
        *buff = match *buff {
            Buff::ZoryasTome(stacks) if stacks > 1 => Buff::ZoryasTome(stacks - 1),
            _ => Buff::None,
        };
    }
}

pub(super) struct PlayerAttackInterpreter<'a> {
    warnings: &'a mut BTreeMap<Tick, Vec<BuildWarning>>,
    attacks_to_relabel: Vec<(Tick, PartyIndex, PlayerAttack)>,
    attacks_to_drop: Vec<(Tick, PartyIndex)>,
}

impl<'a> PlayerAttackInterpreter<'a> {
    pub(super) fn new(warnings: &'a mut BTreeMap<Tick, Vec<BuildWarning>>) -> Self {
        Self {
            warnings,
            attacks_to_relabel: Vec::new(),
            attacks_to_drop: Vec::new(),
        }
    }

    fn resolve_attack(
        buffs: &mut PlayerBuffs,
        tick: Tick,
        state: &TickState,
        attack: &PlayerAttacked,
    ) -> PlayerAttack {
        match attack.attack {
            PlayerAttack::ZoryasTomeSpec => {
                if let Some(Actor::Npc(room_id)) = attack.target
                    && state
                        .raw_npcs
                        .get(&room_id)
                        .is_some_and(|npc| npc.spot_anims.contains(&ZORYAS_TOME_SPEC_HIT_SPOT_ANIM))
                {
                    buffs.set(
                        tick,
                        attack.player,
                        Buff::ZoryasTome(ZORYAS_TOME_BUFFED_CASTS),
                    );
                }
                attack.attack
            }
            PlayerAttack::ZoryasTomeAuto | PlayerAttack::ZoryasTomeBuffed => {
                if matches!(buffs.get(tick, attack.player), Buff::ZoryasTome(_)) {
                    buffs.consume(attack.player);
                    PlayerAttack::ZoryasTomeBuffed
                } else {
                    PlayerAttack::ZoryasTomeAuto
                }
            }
            other => other,
        }
    }
}

impl Interpreter for PlayerAttackInterpreter<'_> {
    fn decide(&mut self, recording: &Recording) {
        let mut cooldowns = PlayerCooldowns::new(recording.party().len());
        let mut buffs = PlayerBuffs::new(recording.party().len());
        for (tick, state) in recording.states() {
            for event in &state.events {
                let EventKind::PlayerAttack(attack) = &event.kind else {
                    continue;
                };
                if !cooldowns.can_attack(attack.player, tick, state, attack.attack, attack.target) {
                    self.attacks_to_drop.push((tick, attack.player));
                    continue;
                }

                let resolved = Self::resolve_attack(&mut buffs, tick, state, attack);
                if resolved != attack.attack {
                    self.attacks_to_relabel
                        .push((tick, attack.player, resolved));
                }
                cooldowns.track_attack(attack.player, tick, state, resolved, attack.target);
            }
        }
    }

    fn apply(self, recording: &mut Recording) -> Option<Tick> {
        for &(tick, player, resolved) in &self.attacks_to_relabel {
            if let Some(state) = recording.get_state_mut(tick) {
                for event in &mut state.events {
                    if let EventKind::PlayerAttack(attack) = &mut event.kind
                        && attack.player == player
                    {
                        attack.attack = resolved;
                    }
                }
            }
        }
        for attacks in self.attacks_to_drop.chunk_by(|a, b| a.0 == b.0) {
            let (tick, _) = attacks[0];
            if let Some(state) = recording.get_state_mut(tick) {
                state.events.retain(|event| {
                    !matches!(
                        &event.kind,
                        EventKind::PlayerAttack(attack)
                            if attacks.iter().any(|&(_, player)| player == attack.player)
                    )
                });
            }
            self.warnings
                .entry(tick)
                .or_default()
                .extend(attacks.iter().map(|_| BuildWarning {
                    tick,
                    kind: proto::event::Type::PlayerAttack,
                    reason: WarningReason::OnCooldown,
                }));
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::timeline::interpret::{RawNpc, RawObjects, Vars};
    use crate::{
        ChallengeMode, ClientId, Event, Item, Mokhaiotl, NpcProperties, NpcState, Players, Point,
        PrayerBook, PrayerSet, Rect, RoomId, Rsn, SkillLevel, Source, Stage, TickObjects, item,
        npc,
    };

    #[test]
    fn player_attack_interpreter_drops_attacks_made_on_cooldown() {
        let doom = RoomId(47491);
        let larva = RoomId(47520);
        let state = |charging: bool, attack: PlayerAttack, weapon: u32, target: RoomId| TickState {
            players: Players::empty(1),
            npcs: BTreeMap::from([
                (
                    doom,
                    NpcState {
                        source: Source::Client(ClientId(31)),
                        id: npc::id::MOKHAIOTL,
                        position: Rect::square(Point(3421, 6435), 5),
                        hitpoints: SkillLevel::from_raw(29_557_336),
                        prayers: PrayerSet::empty(PrayerBook::Normal),
                        properties: Some(NpcProperties::Mokhaiotl(Mokhaiotl {
                            charging,
                            shield: None,
                        })),
                    },
                ),
                (
                    larva,
                    NpcState {
                        source: Source::Client(ClientId(31)),
                        id: npc::id::DEMONIC_LARVA,
                        position: Rect::square(Point(3418, 6438), 1),
                        hitpoints: SkillLevel::from_raw(131_074),
                        prayers: PrayerSet::empty(PrayerBook::Normal),
                        properties: None,
                    },
                ),
            ]),
            objects: TickObjects::default(),
            raw_objects: RawObjects::default(),
            raw_npcs: BTreeMap::new(),
            vars: Vars::default(),
            events: vec![Event::recorded(
                ClientId(31),
                EventKind::PlayerAttack(PlayerAttacked {
                    player: PartyIndex::from_usize(0),
                    attack,
                    weapon: Some(Item {
                        id: weapon,
                        quantity: 1,
                    }),
                    target: Some(Actor::Npc(target)),
                }),
            )],
        };

        let mut recording = Recording::vacant(
            Stage::MokhaiotlDelve4,
            ChallengeMode::NoMode,
            vec![Rsn::try_from("1Ogp").unwrap()],
            Tick(28),
        );
        let bow = (PlayerAttack::TwistedBow, item::id::TWISTED_BOW);
        let blowpipe = (PlayerAttack::Blowpipe, item::id::TOXIC_BLOWPIPE);
        let emberlight = (PlayerAttack::EmberlightAuto, item::id::EMBERLIGHT);
        let halberd = (PlayerAttack::NoxiousHalberd, item::id::NOXIOUS_HALBERD);
        for (tick, charging, (attack, weapon), target) in [
            (20, false, bow, doom),
            (22, false, bow, doom),
            (23, false, blowpipe, larva),
            (25, false, emberlight, larva),
            (26, false, bow, doom),
            (27, true, halberd, doom),
            (28, true, bow, doom),
        ] {
            recording.set_state(Tick(tick), state(charging, attack, weapon, target));
        }

        let mut warnings = BTreeMap::new();
        assert_eq!(
            PlayerAttackInterpreter::new(&mut warnings).interpret(&mut recording),
            None
        );
        assert_eq!(
            recording
                .states()
                .flat_map(|(tick, state)| {
                    state
                        .events
                        .iter()
                        .filter_map(move |event| match &event.kind {
                            EventKind::PlayerAttack(attack) => Some((tick, attack.attack)),
                            _ => None,
                        })
                })
                .collect::<Vec<_>>(),
            [
                (Tick(20), PlayerAttack::TwistedBow),
                (Tick(23), PlayerAttack::Blowpipe),
                (Tick(25), PlayerAttack::EmberlightAuto),
                (Tick(26), PlayerAttack::TwistedBow),
                (Tick(27), PlayerAttack::NoxiousHalberd),
            ]
        );
        assert_eq!(
            warnings,
            BTreeMap::from([
                (
                    Tick(22),
                    vec![BuildWarning {
                        tick: Tick(22),
                        kind: proto::event::Type::PlayerAttack,
                        reason: WarningReason::OnCooldown,
                    }]
                ),
                (
                    Tick(28),
                    vec![BuildWarning {
                        tick: Tick(28),
                        kind: proto::event::Type::PlayerAttack,
                        reason: WarningReason::OnCooldown,
                    }]
                ),
            ])
        );
    }

    #[test]
    fn player_attack_interpreter_relabels_buffed_zoryas_tome_casts() {
        let guardian = RoomId(39540);
        let state = |attack: PlayerAttack, spot_anim: u32| TickState {
            players: Players::empty(1),
            npcs: BTreeMap::new(),
            objects: TickObjects::default(),
            raw_objects: RawObjects::default(),
            raw_npcs: BTreeMap::from([(
                guardian,
                RawNpc {
                    spot_anims: vec![spot_anim],
                    ..Default::default()
                },
            )]),
            vars: Vars::default(),
            events: vec![Event::recorded(
                ClientId(31),
                EventKind::PlayerAttack(PlayerAttacked {
                    player: PartyIndex::from_usize(0),
                    attack,
                    weapon: Some(Item {
                        id: 34725,
                        quantity: 1,
                    }),
                    target: Some(Actor::Npc(guardian)),
                }),
            )],
        };

        let mut recording = Recording::vacant(
            Stage::TfaGuardian,
            ChallengeMode::NoMode,
            vec![Rsn::try_from("1Ogp").unwrap()],
            Tick(3017),
        );
        for (tick, attack, spot_anim) in [
            (2981, PlayerAttack::ZoryasTomeSpec, 85),
            (2984, PlayerAttack::ZoryasTomeAuto, 85),
            (3008, PlayerAttack::ZoryasTomeSpec, 4430),
            (3011, PlayerAttack::ZoryasTomeAuto, 4431),
            (3013, PlayerAttack::ZoryasTomeAuto, 4431),
            (3015, PlayerAttack::ZoryasTomeAuto, 4431),
            (3017, PlayerAttack::ZoryasTomeAuto, 85),
        ] {
            recording.set_state(Tick(tick), state(attack, spot_anim));
        }

        let mut warnings = BTreeMap::new();
        assert_eq!(
            PlayerAttackInterpreter::new(&mut warnings).interpret(&mut recording),
            None
        );
        assert_eq!(
            recording
                .states()
                .flat_map(|(tick, state)| {
                    state
                        .events
                        .iter()
                        .filter_map(move |event| match &event.kind {
                            EventKind::PlayerAttack(attack) => Some((tick, attack.attack)),
                            _ => None,
                        })
                })
                .collect::<Vec<_>>(),
            [
                (Tick(2981), PlayerAttack::ZoryasTomeSpec),
                (Tick(2984), PlayerAttack::ZoryasTomeAuto),
                (Tick(3008), PlayerAttack::ZoryasTomeSpec),
                (Tick(3011), PlayerAttack::ZoryasTomeBuffed),
                (Tick(3013), PlayerAttack::ZoryasTomeBuffed),
                (Tick(3015), PlayerAttack::ZoryasTomeBuffed),
                (Tick(3017), PlayerAttack::ZoryasTomeAuto),
            ]
        );
        assert_eq!(warnings, BTreeMap::new());
    }

    #[test]
    fn player_attack_interpreter_expires_zoryas_tome_buff() {
        let state = |attack: PlayerAttack, target: RoomId, spot_anim: u32| TickState {
            players: Players::empty(1),
            npcs: BTreeMap::new(),
            objects: TickObjects::default(),
            raw_objects: RawObjects::default(),
            raw_npcs: BTreeMap::from([(
                target,
                RawNpc {
                    spot_anims: vec![spot_anim],
                    ..Default::default()
                },
            )]),
            vars: Vars::default(),
            events: vec![Event::recorded(
                ClientId(31),
                EventKind::PlayerAttack(PlayerAttacked {
                    player: PartyIndex::from_usize(0),
                    attack,
                    weapon: Some(Item {
                        id: 34725,
                        quantity: 1,
                    }),
                    target: Some(Actor::Npc(target)),
                }),
            )],
        };

        let mut recording = Recording::vacant(
            Stage::TfaGuardian,
            ChallengeMode::NoMode,
            vec![Rsn::try_from("1Ogp").unwrap()],
            Tick(113),
        );
        for (tick, attack, target, spot_anim) in [
            (43, PlayerAttack::ZoryasTomeSpec, RoomId(26627), 4430),
            (48, PlayerAttack::ZoryasTomeAuto, RoomId(26620), 4431),
            (113, PlayerAttack::ZoryasTomeAuto, RoomId(27768), 4429),
        ] {
            recording.set_state(Tick(tick), state(attack, target, spot_anim));
        }

        let mut warnings = BTreeMap::new();
        assert_eq!(
            PlayerAttackInterpreter::new(&mut warnings).interpret(&mut recording),
            None
        );
        assert_eq!(
            recording
                .states()
                .flat_map(|(tick, state)| {
                    state
                        .events
                        .iter()
                        .filter_map(move |event| match &event.kind {
                            EventKind::PlayerAttack(attack) => Some((tick, attack.attack)),
                            _ => None,
                        })
                })
                .collect::<Vec<_>>(),
            [
                (Tick(43), PlayerAttack::ZoryasTomeSpec),
                (Tick(48), PlayerAttack::ZoryasTomeBuffed),
                (Tick(113), PlayerAttack::ZoryasTomeAuto),
            ]
        );
        assert_eq!(warnings, BTreeMap::new());
    }
}
