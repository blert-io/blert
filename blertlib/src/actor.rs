use std::fmt;
use std::ops::{Index, IndexMut};

use serde::{Deserialize, Serialize, Serializer};

use crate::item::{EQUIPMENT_SLOTS, EquipmentSlot, Item};
use crate::prayer::PrayerSet;
use crate::skill::SkillLevel;
use crate::{AttackClass, CombatStyle, PlayerAttack, Point, Rect, Source, VerzikPhase, npc};

pub use crate::proto::event::npc::maiden_crab::{
    Position as MaidenCrabPosition, Spawn as MaidenCrabSpawn,
};
pub use crate::proto::event::npc::verzik_crab::Spawn as VerzikCrabSpawn;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct PartyIndex(pub(crate) u8);

impl PartyIndex {
    pub(crate) fn from_usize(index: usize) -> Self {
        Self(u8::try_from(index).expect("party is small"))
    }

    #[must_use]
    pub fn as_usize(self) -> usize {
        self.0 as usize
    }
}

/// A validated OSRS player name.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Deserialize)]
#[serde(try_from = "String")]
pub struct Rsn(String);

impl Serialize for Rsn {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

impl Rsn {
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Normalizes the RSN to Blert's stored representation.
    #[must_use]
    pub fn normalized(&self) -> String {
        // Same transformation as in `//common_player.ts`
        self.0.to_lowercase().replace(['-', ' '], "_")
    }
}

impl TryFrom<String> for Rsn {
    type Error = InvalidRsn;

    fn try_from(name: String) -> Result<Self, Self::Error> {
        let allowed = |c: char| c.is_ascii_alphanumeric() || matches!(c, ' ' | '_' | '-');
        let valid = (1..=12).contains(&name.len())
            && name.chars().all(allowed)
            && !name.starts_with(' ')
            && !name.ends_with(' ');
        if valid {
            Ok(Self(name))
        } else {
            Err(InvalidRsn(name))
        }
    }
}

impl TryFrom<&str> for Rsn {
    type Error = InvalidRsn;

    fn try_from(name: &str) -> Result<Self, Self::Error> {
        Self::try_from(name.to_owned())
    }
}

impl PartialEq<str> for Rsn {
    fn eq(&self, other: &str) -> bool {
        self.0 == other
    }
}

impl PartialEq<&str> for Rsn {
    fn eq(&self, other: &&str) -> bool {
        self.0 == *other
    }
}

impl fmt::Display for Rsn {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// A name that is not a valid [`Rsn`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvalidRsn(pub String);

impl fmt::Display for InvalidRsn {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "invalid RSN: {:?}", self.0)
    }
}

impl std::error::Error for InvalidRsn {}

/// A unique identifier for an NPC within a timeline.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct RoomId(pub(crate) u64);

/// A tracked actor in the stage.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Actor {
    Player(PartyIndex),
    Npc(RoomId),
}

/// The states of each player in the challenge on a tick.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Players {
    states: Vec<Option<PlayerState>>,
}

impl Players {
    pub(crate) fn empty(party_size: usize) -> Self {
        Self {
            states: vec![None; party_size],
        }
    }

    /// Returns the number of players recorded on the tick.
    #[must_use]
    pub fn len(&self) -> usize {
        self.states.iter().filter(|&s| s.is_some()).count()
    }

    /// Returns true if no players were recorded on the tick.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.states.iter().all(Option::is_none)
    }

    /// Returns the state of the player at `index`.
    #[must_use]
    pub fn get(&self, index: PartyIndex) -> Option<&PlayerState> {
        self.states.get(index.as_usize())?.as_ref()
    }

    /// Returns a mutable reference to the state of the player at `index`.
    #[must_use]
    pub fn get_mut(&mut self, index: PartyIndex) -> Option<&mut PlayerState> {
        self.states.get_mut(index.as_usize())?.as_mut()
    }

    /// Returns an iterator over the players visible on the tick.
    pub fn iter(&self) -> impl Iterator<Item = (PartyIndex, &PlayerState)> {
        self.states
            .iter()
            .enumerate()
            .filter_map(|(index, state)| Some((PartyIndex::from_usize(index), state.as_ref()?)))
    }
}

impl Index<PartyIndex> for Players {
    type Output = Option<PlayerState>;

    fn index(&self, index: PartyIndex) -> &Self::Output {
        &self.states[index.as_usize()]
    }
}

impl IndexMut<PartyIndex> for Players {
    fn index_mut(&mut self, index: PartyIndex) -> &mut Self::Output {
        &mut self.states[index.as_usize()]
    }
}

/// A party member's state on a tick.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlayerState {
    pub source: Source,
    pub position: Point,
    pub equipment: [Option<Item>; EQUIPMENT_SLOTS],
    pub prayers: PrayerSet,
    pub data: DataSource,
}

impl PlayerState {
    /// Returns the item equipped in the given slot, if any.
    #[must_use]
    pub fn equipped(&self, slot: EquipmentSlot) -> Option<Item> {
        self.equipment[slot as usize]
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Stats {
    pub hitpoints: SkillLevel,
    pub prayer: SkillLevel,
    pub attack: SkillLevel,
    pub strength: SkillLevel,
    pub defence: SkillLevel,
    pub ranged: SkillLevel,
    pub magic: SkillLevel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DataSource {
    Primary(Stats),
    Secondary,
}

/// An NPC's state on a tick.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NpcState {
    pub source: Source,
    pub npc_id: u32,
    pub position: Rect,
    pub hitpoints: SkillLevel,
    pub prayers: PrayerSet,
    pub properties: Option<NpcProperties>,
}

impl NpcState {
    /// Returns whether a player's attack on this NPC puts them on cooldown.
    #[must_use]
    pub fn attack_applies_cooldown(&self, attack: PlayerAttack) -> bool {
        if npc::is_mokhaiotl_larva(self.npc_id) {
            let ignores = attack.has_class(AttackClass::Demonbane)
                || matches!(
                    attack,
                    PlayerAttack::EyeOfAyakAuto | PlayerAttack::EyeOfAyakSpec
                );
            return !ignores;
        }

        true
    }

    /// Returns whether a player must be off cooldown to perform an attack
    /// on this NPC.
    #[must_use]
    pub fn attack_checks_cooldown(&self, attack: PlayerAttack) -> bool {
        let charging = matches!(
            self.properties,
            Some(NpcProperties::Mokhaiotl(Mokhaiotl { charging: true }))
        );
        !(npc::is_mokhaiotl_larva(self.npc_id)
            || self.npc_id == npc::id::VOLATILE_EARTH
            || (charging && attack.style() == Some(CombatStyle::Melee)))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NpcProperties {
    MaidenCrab(MaidenCrab),
    Nylo(Nylo),
    VerzikCrab(VerzikCrab),
    Mokhaiotl(Mokhaiotl),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MaidenCrab {
    pub spawn: MaidenCrabSpawn,
    pub position: MaidenCrabPosition,
    /// The crab's index is lower than Maiden's index due to rollover, causing
    /// its actions to be delayed by a tick compared to usual.
    pub scuffed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Nylo {
    pub wave: u32,
    pub big: bool,
    pub style: CombatStyle,
    pub spawn: NyloSpawn,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NyloSpawn {
    Split(Option<RoomId>),
    West,
    South,
    East,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerzikCrab {
    pub phase: VerzikPhase,
    pub spawn: VerzikCrabSpawn,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Mokhaiotl {
    pub charging: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ClientId, PrayerBook};

    fn player() -> PlayerState {
        PlayerState {
            source: Source::Client(ClientId(1)),
            position: Point(1234, 4321),
            equipment: [None; EQUIPMENT_SLOTS],
            prayers: PrayerSet::empty(PrayerBook::Normal),
            data: DataSource::Secondary,
        }
    }

    #[test]
    fn players_container() {
        let mut players = Players::empty(3);
        assert!(players.is_empty());
        assert_eq!(players.len(), 0);

        players[PartyIndex(1)] = Some(player());
        players[PartyIndex(2)] = Some(player());
        assert!(!players.is_empty());
        assert_eq!(players.len(), 2);
        assert_eq!(
            players.iter().map(|(index, _)| index).collect::<Vec<_>>(),
            [PartyIndex(1), PartyIndex(2)]
        );
        assert!(players.get(PartyIndex(0)).is_none());
        assert_eq!(
            players.get(PartyIndex(1)).map(|p| p.position),
            Some(Point(1234, 4321))
        );

        players.get_mut(PartyIndex(2)).unwrap().position = Point(1, 2);
        assert_eq!(
            players[PartyIndex(2)].as_ref().map(|p| p.position),
            Some(Point(1, 2))
        );
        assert!(players.get_mut(PartyIndex(0)).is_none());

        players[PartyIndex(1)] = None;
        assert_eq!(players.len(), 1);
        assert_eq!(
            players.iter().map(|(index, _)| index).collect::<Vec<_>>(),
            [PartyIndex(2)]
        );
    }

    #[test]
    fn player_equipped_by_slot() {
        let scythe = Item {
            id: 22325,
            quantity: 1,
        };
        let bolts = Item {
            id: 21944,
            quantity: 271_828,
        };
        let mut player = player();
        player.equipment[EquipmentSlot::Weapon as usize] = Some(scythe);
        player.equipment[EquipmentSlot::Quiver as usize] = Some(bolts);

        assert_eq!(player.equipped(EquipmentSlot::Weapon), Some(scythe));
        assert_eq!(player.equipped(EquipmentSlot::Quiver), Some(bolts));
        assert_eq!(player.equipped(EquipmentSlot::Head), None);
        assert_eq!(player.equipped(EquipmentSlot::Shield), None);
    }

    #[test]
    fn npc_attack_cooldown_rules() {
        let larva = NpcState {
            source: Source::Client(ClientId(179)),
            npc_id: npc::id::DEMONIC_LARVA,
            position: Rect::square(Point(1309, 9567), 1),
            hitpoints: SkillLevel::from_raw(131_074),
            prayers: PrayerSet::from_raw(262_144),
            properties: None,
        };
        assert!(larva.attack_applies_cooldown(PlayerAttack::Blowpipe));
        assert!(!larva.attack_checks_cooldown(PlayerAttack::Blowpipe));

        let range_larva = NpcState {
            source: Source::Client(ClientId(560)),
            npc_id: npc::id::DEMONIC_RANGE_LARVA,
            position: Rect::square(Point(3421, 6435), 1),
            hitpoints: SkillLevel::from_raw(131_074),
            prayers: PrayerSet::from_raw(327_680),
            properties: None,
        };
        assert!(!range_larva.attack_applies_cooldown(PlayerAttack::ScorchingBowAuto));
        assert!(!range_larva.attack_checks_cooldown(PlayerAttack::ScorchingBowAuto));

        let magic_larva = NpcState {
            source: Source::Client(ClientId(40)),
            npc_id: npc::id::DEMONIC_MAGIC_LARVA,
            position: Rect::square(Point(3549, 6439), 1),
            hitpoints: SkillLevel::from_raw(131_074),
            prayers: PrayerSet::from_raw(393_216),
            properties: None,
        };
        assert!(!magic_larva.attack_applies_cooldown(PlayerAttack::EyeOfAyakAuto));
        assert!(!magic_larva.attack_checks_cooldown(PlayerAttack::EyeOfAyakAuto));

        let volatile_earth = NpcState {
            source: Source::Client(ClientId(638)),
            npc_id: npc::id::VOLATILE_EARTH,
            position: Rect::square(Point(3547, 6435), 1),
            hitpoints: SkillLevel::from_raw(65_537),
            prayers: PrayerSet::from_raw(0),
            properties: None,
        };
        assert!(volatile_earth.attack_applies_cooldown(PlayerAttack::TwistedBow));
        assert!(!volatile_earth.attack_checks_cooldown(PlayerAttack::TwistedBow));

        let charging_doom = NpcState {
            source: Source::Client(ClientId(282)),
            npc_id: npc::id::MOKHAIOTL,
            position: Rect::square(Point(3549, 6435), 5),
            hitpoints: SkillLevel::from_raw(35_783_331),
            prayers: PrayerSet::from_raw(196_608),
            properties: Some(NpcProperties::Mokhaiotl(Mokhaiotl { charging: true })),
        };
        assert!(charging_doom.attack_applies_cooldown(PlayerAttack::NoxiousHalberd));
        assert!(!charging_doom.attack_checks_cooldown(PlayerAttack::NoxiousHalberd));
        assert!(charging_doom.attack_applies_cooldown(PlayerAttack::TwistedBow));
        assert!(charging_doom.attack_checks_cooldown(PlayerAttack::TwistedBow));

        let regular_doom = NpcState {
            source: Source::Client(ClientId(293)),
            npc_id: npc::id::MOKHAIOTL,
            position: Rect::square(Point(3549, 6435), 5),
            hitpoints: SkillLevel::from_raw(36_176_547),
            prayers: PrayerSet::from_raw(0),
            properties: Some(NpcProperties::Mokhaiotl(Mokhaiotl { charging: false })),
        };
        assert!(regular_doom.attack_applies_cooldown(PlayerAttack::NoxiousHalberd));
        assert!(regular_doom.attack_checks_cooldown(PlayerAttack::NoxiousHalberd));
    }

    #[test]
    fn rsn_accepts_valid_names() {
        let longest = Rsn::try_from("WWWWWWWWWWQQ".to_string()).unwrap();
        assert_eq!(longest.as_str(), "WWWWWWWWWWQQ");
        assert_eq!(longest.to_string(), "WWWWWWWWWWQQ");
        assert_eq!(
            Rsn::try_from("1O gp".to_string()).unwrap().as_str(),
            "1O gp"
        );
        assert_eq!(
            Rsn::try_from("-1Ogp".to_string()).unwrap().as_str(),
            "-1Ogp"
        );
        assert_eq!(
            Rsn::try_from("1Ogp_".to_string()).unwrap().as_str(),
            "1Ogp_"
        );

        let borrowed = Rsn::try_from("1Ogp").unwrap();
        assert_eq!(borrowed, "1Ogp");
        assert_eq!(&borrowed, "1Ogp");
        assert_ne!(borrowed, "1ogp");
        assert_eq!(Rsn::try_from("-1O gp").unwrap().normalized(), "_1o_gp");
        assert_eq!(serde_json::to_string(&borrowed).unwrap(), r#""1Ogp""#);
        assert_eq!(serde_json::from_str::<Rsn>(r#""1Ogp""#).unwrap(), borrowed);
        assert_eq!([borrowed, longest].as_slice(), ["1Ogp", "WWWWWWWWWWQQ"]);
    }

    #[test]
    fn rsn_rejects_invalid_names() {
        assert_eq!(
            Rsn::try_from("WWWWWWWWWWQQW".to_string()),
            Err(InvalidRsn("WWWWWWWWWWQQW".to_string()))
        );
        assert_eq!(
            Rsn::try_from("<col=ff0000>1Ogp</col>".to_string()),
            Err(InvalidRsn("<col=ff0000>1Ogp</col>".to_string()))
        );
        assert_eq!(Rsn::try_from(String::new()), Err(InvalidRsn(String::new())));
        assert_eq!(
            Rsn::try_from("1Ogp ".to_string()),
            Err(InvalidRsn("1Ogp ".to_string()))
        );
        assert_eq!(
            Rsn::try_from(" 1Ogp".to_string()),
            Err(InvalidRsn(" 1Ogp".to_string()))
        );
        assert_eq!(
            Rsn::try_from("1Ögp".to_string()),
            Err(InvalidRsn("1Ögp".to_string()))
        );

        let error: Box<dyn std::error::Error> =
            Box::new(Rsn::try_from("<col=ff0000>1Ogp</col>").unwrap_err());
        assert_eq!(
            error.to_string(),
            r#"invalid RSN: "<col=ff0000>1Ogp</col>""#
        );
        assert!(serde_json::from_str::<Rsn>(r#""<col=ff0000>1Ogp</col>""#).is_err());
    }
}
