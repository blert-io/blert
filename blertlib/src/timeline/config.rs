/// The version of a plugin recording config.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct ConfigVersion(pub(crate) u32);

impl std::fmt::Display for ConfigVersion {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "v{}", self.0)
    }
}

/// An unknown or unsupported config version.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct InvalidVersion(pub u32);

impl std::error::Error for InvalidVersion {}

impl std::fmt::Display for InvalidVersion {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "unsupported config version v{}", self.0)
    }
}

impl ConfigVersion {
    /// Recordings from plugins without a recording config.
    pub const NONE: Self = Self(0);

    /// The most current supported config version.
    pub const LATEST: Self = Self(2);

    /// Attempts to parse a config version from an integer value.
    ///
    /// # Errors
    ///
    /// Returns `InvalidVersion` if the value is newer than [`Self::LATEST`].
    pub fn parse(value: u32) -> Result<Self, InvalidVersion> {
        if value > Self::LATEST.0 {
            Err(InvalidVersion(value))
        } else {
            Ok(Self(value))
        }
    }

    /// Returns the integer value of this config version.
    #[must_use]
    pub fn get(&self) -> u32 {
        self.0
    }
}

impl Default for ConfigVersion {
    fn default() -> Self {
        Self::LATEST
    }
}
