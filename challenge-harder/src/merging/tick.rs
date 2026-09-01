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
    pub fn at(ticks: Ticks) -> Self {
        Self::START + ticks
    }

    #[inline]
    pub fn succ(self) -> Self {
        self + Ticks(1)
    }

    #[inline]
    pub fn pred(self) -> Self {
        self - Ticks(1)
    }

    /// Returns the duration spanning up to this tick.
    #[inline]
    pub fn duration(self) -> Ticks {
        self - Self::START
    }

    /// Returns an iterator over all ticks prior to this one.
    #[inline]
    #[expect(dead_code)]
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
    pub(super) fn as_usize(self) -> usize {
        self.0 as usize
    }

    #[inline]
    pub(super) fn from_usize(tick: usize) -> Self {
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
    pub fn is_zero(self) -> bool {
        self.0 == 0
    }

    /// Returns `true` if the number of ticks is positive.
    pub fn is_nonzero(self) -> bool {
        self.0 != 0
    }

    pub fn inc(self) -> Self {
        Self(self.0.saturating_add(1))
    }

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
