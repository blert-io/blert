//! Skill level handling.

/// A skill's current and base levels.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SkillLevel {
    pub current: u16,
    pub base: u16,
}

impl SkillLevel {
    /// Unpacks a skill level from its raw numeric representation.
    pub fn from_raw(raw: u32) -> SkillLevel {
        SkillLevel {
            current: (raw >> 16) as u16,
            base: (raw & 0xffff) as u16,
        }
    }

    /// Packs the skill level into its numeric representation.
    #[cfg_attr(not(test), expect(dead_code))]
    pub fn to_raw(self) -> u32 {
        u32::from(self.current) << 16 | u32::from(self.base)
    }

    /// Returns the current level as a percentage of the base.
    pub fn percentage(self) -> f32 {
        if self.base == 0 {
            0.0
        } else {
            f32::from(self.current) / f32::from(self.base) * 100.0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_raw_unpacks_current_and_base() {
        assert_eq!(
            SkillLevel::from_raw(0x001d_0063),
            SkillLevel {
                current: 29,
                base: 99,
            },
        );
    }

    #[test]
    fn to_raw_packs_the_parsed_representation() {
        assert_eq!(
            SkillLevel {
                current: 85,
                base: 99,
            }
            .to_raw(),
            0x0055_0063,
        );
    }
}
