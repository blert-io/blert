//! Remapping of challenge UUIDs from capture to replay.

use std::collections::BTreeMap;
use std::sync::Mutex;

use uuid::Uuid;

/// How a recorded response related to the existing mapping.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mapping {
    /// The response created a new mapping.
    New,
    /// The response matched the established mapping.
    Match,
    /// The response named a different challenge than the established mapping.
    Mismatch { existing: Uuid },
}

#[derive(Default)]
pub struct Remap {
    entries: Mutex<BTreeMap<Uuid, Uuid>>,
}

impl Remap {
    /// Records a response's mapping for a captured challenge.
    /// The first challenge for a captured UUID creates the mapping to which
    /// subsequent responses compare.
    pub fn record(&self, captured: Uuid, replayed: Uuid) -> Mapping {
        let mut entries = self.entries.lock().expect("remap lock");
        match entries.get(&captured) {
            Some(existing) if *existing == replayed => Mapping::Match,
            Some(existing) => Mapping::Mismatch {
                existing: *existing,
            },
            None => {
                entries.insert(captured, replayed);
                Mapping::New
            }
        }
    }

    /// Returns the established mapping for a captured challenge.
    pub fn get(&self, captured: Uuid) -> Option<Uuid> {
        self.entries
            .lock()
            .expect("remap lock")
            .get(&captured)
            .copied()
    }

    /// Returns a snapshot of the established mappings.
    pub fn table(&self) -> BTreeMap<Uuid, Uuid> {
        self.entries.lock().expect("remap lock").clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CAPTURED: &str = "11111111-1111-1111-1111-111111111111";
    const REPLAYED: &str = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const OTHER: &str = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

    fn uuid(value: &str) -> Uuid {
        value.parse().unwrap()
    }

    #[test]
    fn first_ruling_wins_and_conflicts_are_reported() {
        let remap = Remap::default();
        assert_eq!(remap.record(uuid(CAPTURED), uuid(REPLAYED)), Mapping::New,);
        assert_eq!(remap.record(uuid(CAPTURED), uuid(REPLAYED)), Mapping::Match);
        assert_eq!(
            remap.record(uuid(CAPTURED), uuid(OTHER)),
            Mapping::Mismatch {
                existing: uuid(REPLAYED),
            },
        );
        assert_eq!(
            remap.table(),
            [(uuid(CAPTURED), uuid(REPLAYED))].into_iter().collect(),
        );
    }
}
