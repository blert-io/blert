use std::ops::{Add, AddAssign, Div, DivAssign, Mul, MulAssign, Sub, SubAssign};

use serde::{Deserialize, Serialize};

/// An instant in a timeline.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
)]
pub struct Tick(pub u32);

impl Tick {
    const START: Self = Self(0);

    /// Returns the tick that occurs at a given duration from the start.
    #[inline]
    #[must_use]
    pub fn at(ticks: Ticks) -> Self {
        Self::START + ticks
    }

    /// Returns the tick that occurs after this one.
    #[inline]
    #[must_use]
    pub fn succ(self) -> Self {
        self + Ticks(1)
    }

    /// Returns the tick that occurs before this one.
    #[inline]
    #[must_use]
    pub fn pred(self) -> Self {
        self - Ticks(1)
    }

    /// Returns the duration spanning up to this tick.
    #[inline]
    #[must_use]
    pub fn duration(self) -> Ticks {
        self - Self::START
    }

    /// Returns the absolute duration between this tick and `other`.
    #[inline]
    #[must_use]
    pub fn abs_diff(self, other: Self) -> Ticks {
        Ticks(self.0.abs_diff(other.0))
    }

    /// Returns an iterator over all ticks prior to this one.
    #[inline]
    pub fn up_to(self) -> impl Iterator<Item = Self> + Clone {
        (0..self.0).map(Self)
    }

    /// Returns an iterator over all ticks up to and including this one.
    #[inline]
    pub fn up_to_inclusive(self) -> impl Iterator<Item = Self> + Clone {
        (0..=self.0).map(Self)
    }

    /// Returns an iterator over the ticks from this one up to and including `tick`.
    #[inline]
    pub fn through(self, tick: Self) -> impl Iterator<Item = Self> + Clone {
        (self.0..=tick.0).map(Self)
    }

    #[inline]
    #[must_use]
    pub fn as_usize(self) -> usize {
        self.0 as usize
    }

    /// Parses a tick from a `usize` value.
    ///
    /// # Panics
    ///
    /// Panics if `tick` is too large to fit in a `u32`.
    #[inline]
    #[must_use]
    pub fn from_usize(tick: usize) -> Self {
        Self(u32::try_from(tick).expect("tick count is small"))
    }
}

impl Add<Ticks> for Tick {
    type Output = Tick;

    fn add(self, rhs: Ticks) -> Tick {
        Tick(self.0.saturating_add(rhs.0))
    }
}

impl AddAssign<Ticks> for Tick {
    fn add_assign(&mut self, rhs: Ticks) {
        self.0 = self.0.saturating_add(rhs.0);
    }
}

impl Sub<Ticks> for Tick {
    type Output = Tick;

    fn sub(self, rhs: Ticks) -> Tick {
        Tick(self.0.saturating_sub(rhs.0))
    }
}

impl SubAssign<Ticks> for Tick {
    fn sub_assign(&mut self, rhs: Ticks) {
        self.0 = self.0.saturating_sub(rhs.0);
    }
}

impl Sub<Tick> for Tick {
    type Output = Ticks;

    fn sub(self, rhs: Tick) -> Ticks {
        Ticks(self.0.saturating_sub(rhs.0))
    }
}

impl std::fmt::Display for Tick {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// A nonnegative span of game ticks.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Ticks(pub u32);

impl Ticks {
    /// Returns `true` if the number of ticks zero.
    #[must_use]
    pub fn is_zero(self) -> bool {
        self.0 == 0
    }

    /// Returns `true` if the number of ticks is positive.
    #[must_use]
    pub fn is_nonzero(self) -> bool {
        self.0 != 0
    }

    #[must_use]
    pub fn inc(self) -> Self {
        Self(self.0.saturating_add(1))
    }

    #[must_use]
    pub fn dec(self) -> Self {
        Self(self.0.saturating_sub(1))
    }
}

impl From<u32> for Ticks {
    fn from(ticks: u32) -> Self {
        Self(ticks)
    }
}

impl From<Ticks> for u32 {
    fn from(ticks: Ticks) -> Self {
        ticks.0
    }
}

impl Add for Ticks {
    type Output = Self;

    fn add(self, rhs: Self) -> Self::Output {
        Self(self.0.saturating_add(rhs.0))
    }
}

impl AddAssign for Ticks {
    fn add_assign(&mut self, rhs: Self) {
        self.0 = self.0.saturating_add(rhs.0);
    }
}

impl Sub for Ticks {
    type Output = Self;

    fn sub(self, rhs: Self) -> Self::Output {
        Self(self.0.saturating_sub(rhs.0))
    }
}

impl SubAssign for Ticks {
    fn sub_assign(&mut self, rhs: Self) {
        self.0 = self.0.saturating_sub(rhs.0);
    }
}

impl Mul<u32> for Ticks {
    type Output = Self;

    fn mul(self, rhs: u32) -> Self::Output {
        Self(self.0.saturating_mul(rhs))
    }
}

impl MulAssign<u32> for Ticks {
    fn mul_assign(&mut self, rhs: u32) {
        self.0 = self.0.saturating_mul(rhs);
    }
}

impl Div<u32> for Ticks {
    type Output = Self;

    fn div(self, rhs: u32) -> Self::Output {
        Self(self.0 / rhs)
    }
}

impl DivAssign<u32> for Ticks {
    fn div_assign(&mut self, rhs: u32) {
        self.0 /= rhs;
    }
}

impl Div<Ticks> for Ticks {
    type Output = u32;

    fn div(self, rhs: Ticks) -> Self::Output {
        self.0 / rhs.0
    }
}

impl PartialEq<u32> for Ticks {
    fn eq(&self, other: &u32) -> bool {
        self.0 == *other
    }
}

impl std::fmt::Display for Ticks {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::iter::Sum for Ticks {
    fn sum<I: Iterator<Item = Self>>(iter: I) -> Self {
        iter.fold(Ticks(0), |a, b| a + b)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tick_add() {
        assert_eq!(Tick(1) + Ticks(2), Tick(3));
        assert_eq!(Tick(0) + Ticks(0), Tick(0));
        assert_eq!(Tick(u32::MAX - 3) + Ticks(3), Tick(u32::MAX));
        assert_eq!(Tick(u32::MAX) + Ticks(3), Tick(u32::MAX));
        assert_eq!(Tick(5) + Ticks(u32::MAX), Tick(u32::MAX));

        let mut t = Tick(7);
        t += Ticks(3);
        assert_eq!(t, Tick(10));
        t += Ticks(0);
        assert_eq!(t, Tick(10));
        t += Ticks(u32::MAX);
        assert_eq!(t, Tick(u32::MAX));
    }

    #[test]
    fn tick_sub() {
        assert_eq!(Tick(3) - Ticks(2), Tick(1));
        assert_eq!(Tick(0) - Ticks(0), Tick(0));
        assert_eq!(Tick(3) - Ticks(3), Tick(0));
        assert_eq!(Tick(3) - Ticks(10), Tick(0));
        assert_eq!(Tick(10) - Tick(3), Ticks(7));
        assert_eq!(Tick(3) - Tick(10), Ticks(0));

        let mut t = Tick(10);
        t -= Ticks(3);
        assert_eq!(t, Tick(7));
        t -= Ticks(0);
        assert_eq!(t, Tick(7));
        t -= Ticks(u32::MAX);
        assert_eq!(t, Tick(0));
    }

    #[test]
    fn ticks_add() {
        assert_eq!(Ticks(1) + Ticks(2), Ticks(3));
        assert_eq!(Ticks(0) + Ticks(0), Ticks(0));
        assert_eq!(Ticks(u32::MAX - 3) + Ticks(3), Ticks(u32::MAX));
        assert_eq!(Ticks(u32::MAX) + Ticks(3), Ticks(u32::MAX));
        assert_eq!(
            [Ticks(1), Ticks(2), Ticks(3)].into_iter().sum::<Ticks>(),
            Ticks(6)
        );

        let mut t = Ticks(7);
        t += Ticks(3);
        assert_eq!(t, Ticks(10));
        t += Ticks(u32::MAX);
        assert_eq!(t, Ticks(u32::MAX));
    }

    #[test]
    fn ticks_sub() {
        assert_eq!(Ticks(3) - Ticks(2), Ticks(1));
        assert_eq!(Ticks(0) - Ticks(0), Ticks(0));
        assert_eq!(Ticks(3) - Ticks(3), Ticks(0));
        assert_eq!(Ticks(3) - Ticks(10), Ticks(0));

        let mut t = Ticks(10);
        t -= Ticks(3);
        assert_eq!(t, Ticks(7));
        t -= Ticks(u32::MAX);
        assert_eq!(t, Ticks(0));
    }

    #[test]
    #[expect(clippy::erasing_op)]
    fn ticks_mul() {
        assert_eq!(Ticks(3) * 4, Ticks(12));
        assert_eq!(Ticks(3) * 0, Ticks(0));
        assert_eq!(Ticks(0) * 4, Ticks(0));
        assert_eq!(Ticks(u32::MAX) * 2, Ticks(u32::MAX));

        let mut t = Ticks(3);
        t *= 4;
        assert_eq!(t, Ticks(12));
        t *= u32::MAX;
        assert_eq!(t, Ticks(u32::MAX));
    }

    #[test]
    fn ticks_div() {
        assert_eq!(Ticks(12) / 4, Ticks(3));
        assert_eq!(Ticks(12) / 5, Ticks(2));
        assert_eq!(Ticks(3) / 4, Ticks(0));
        assert_eq!(Ticks(12) / Ticks(4), 3);
        assert_eq!(Ticks(3) / Ticks(4), 0);

        let mut t = Ticks(12);
        t /= 4;
        assert_eq!(t, Ticks(3));
    }

    #[test]
    #[should_panic(expected = "divide by zero")]
    fn ticks_div_by_zero() {
        let mut t = Ticks(12);
        t /= 0;
    }

    #[test]
    fn tick_at_and_duration() {
        assert_eq!(Tick::at(Ticks(7)), Tick(7));
        assert_eq!(Tick::at(Ticks(0)), Tick(0));
        assert_eq!(Tick(7).duration(), Ticks(7));
        assert_eq!(Tick::at(Tick(7).duration()), Tick(7));
    }

    #[test]
    fn tick_succ_and_pred() {
        assert_eq!(Tick(7).succ(), Tick(8));
        assert_eq!(Tick(7).pred(), Tick(6));
        assert_eq!(Tick(0).pred(), Tick(0));
        assert_eq!(Tick(u32::MAX).succ(), Tick(u32::MAX));
    }

    #[test]
    fn tick_abs_diff() {
        assert_eq!(Tick(3).abs_diff(Tick(10)), Ticks(7));
        assert_eq!(Tick(10).abs_diff(Tick(3)), Ticks(7));
        assert_eq!(Tick(3).abs_diff(Tick(3)), Ticks(0));
    }

    #[test]
    fn tick_iterators() {
        assert_eq!(
            Tick(3).up_to().collect::<Vec<_>>(),
            [Tick(0), Tick(1), Tick(2)]
        );
        assert_eq!(Tick(0).up_to().count(), 0);
        assert_eq!(
            Tick(3).up_to_inclusive().collect::<Vec<_>>(),
            [Tick(0), Tick(1), Tick(2), Tick(3)]
        );
        assert_eq!(
            Tick(3).through(Tick(5)).collect::<Vec<_>>(),
            [Tick(3), Tick(4), Tick(5)]
        );
        assert_eq!(Tick(3).through(Tick(3)).collect::<Vec<_>>(), [Tick(3)]);
        assert_eq!(Tick(5).through(Tick(3)).count(), 0);
    }

    #[test]
    fn tick_usize_conversions() {
        assert_eq!(Tick(7).as_usize(), 7);
        assert_eq!(Tick::from_usize(7), Tick(7));
        assert_eq!(Tick::from_usize(Tick(u32::MAX).as_usize()), Tick(u32::MAX));
    }

    #[test]
    #[should_panic(expected = "tick count is small")]
    fn tick_from_usize_too_large() {
        let _ = Tick::from_usize(u32::MAX as usize + 1);
    }

    #[test]
    fn ticks_inc_and_dec() {
        assert_eq!(Ticks(7).inc(), Ticks(8));
        assert_eq!(Ticks(7).dec(), Ticks(6));
        assert_eq!(Ticks(0).dec(), Ticks(0));
        assert_eq!(Ticks(u32::MAX).inc(), Ticks(u32::MAX));
    }

    #[test]
    fn ticks_predicates() {
        assert!(Ticks(0).is_zero());
        assert!(!Ticks(7).is_zero());
        assert!(Ticks(7).is_nonzero());
        assert!(!Ticks(0).is_nonzero());
    }

    #[test]
    fn ticks_conversions() {
        assert_eq!(Ticks::from(7), Ticks(7));
        assert_eq!(u32::from(Ticks(7)), 7);
        assert_eq!(Ticks(7), 7);
    }

    #[test]
    fn tick_serialization() {
        assert_eq!(serde_json::to_string(&Tick(67)).unwrap(), "67");
        assert_eq!(serde_json::to_string(&Ticks(67)).unwrap(), "67");
        assert_eq!(serde_json::from_str::<Tick>("76").unwrap(), Tick(76));
        assert_eq!(serde_json::from_str::<Ticks>("76").unwrap(), Ticks(76));
    }

    #[test]
    fn tick_display() {
        assert_eq!(Tick(867).to_string(), "867");
        assert_eq!(Ticks(5309).to_string(), "5309");
    }
}
