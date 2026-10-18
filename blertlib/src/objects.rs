//! Handling of world objects, i.e. Runelite `GameObject` and `GraphicsObject`.

use std::collections::BTreeMap;

use crate::{Point, Source};

/// A type of object that appears in some encounter.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ObjectKind {
    MaidenBloodSplats,
    SoteMazeTiles,
    VerzikYellows,

    ColosseumReentryPrimaryPool,
    ColosseumReentrySecondaryPool,

    MokhaiotlRock,
    MokhaiotlSplat,
    MokhaiotlShockwave,
}

/// The set of objects present in the world on a tick.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct TickObjects(BTreeMap<ObjectKind, BTreeMap<Point, Source>>);

impl TickObjects {
    /// Returns the number of objects on this tick.
    #[must_use]
    pub fn len(&self) -> usize {
        self.0.values().map(BTreeMap::len).sum()
    }

    /// Returns `true` if there are no objects on this tick.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.0.values().all(BTreeMap::is_empty)
    }

    /// Returns an iterator over each object on this tick and its source.
    pub fn iter(&self) -> impl Iterator<Item = (ObjectKind, Point, Source)> + '_ {
        self.0.iter().flat_map(|(kind, points)| {
            points
                .iter()
                .map(move |(point, source)| (*kind, *point, *source))
        })
    }

    /// Returns an iterator over each kind of object present on this tick.
    pub fn kinds(&self) -> impl Iterator<Item = ObjectKind> + '_ {
        self.0
            .iter()
            .filter(|(_, points)| !points.is_empty())
            .map(|(kind, _)| *kind)
    }

    /// Returns an iterator over each object of `kind` on this tick.
    pub fn iter_of(&self, kind: ObjectKind) -> impl Iterator<Item = Point> + '_ {
        self.0
            .get(&kind)
            .map(|points| points.keys().copied())
            .unwrap_or_default()
    }

    /// Returns `true` if an object of `kind` is present at `point`.
    #[must_use]
    pub fn contains(&self, kind: ObjectKind, point: Point) -> bool {
        self.0
            .get(&kind)
            .is_some_and(|map| map.contains_key(&point))
    }

    /// Returns `true` if an object of `kind` is present.
    #[must_use]
    pub fn contains_kind(&self, kind: ObjectKind) -> bool {
        self.0.get(&kind).is_some_and(|map| !map.is_empty())
    }

    /// Adds objects of `kind` at locations `points`, observed by `source`.
    ///
    /// Any points that are already present keep their original source.
    pub fn insert(
        &mut self,
        kind: ObjectKind,
        source: Source,
        points: impl IntoIterator<Item = Point>,
    ) {
        let map = self.0.entry(kind).or_default();
        for point in points {
            map.entry(point).or_insert(source);
        }
    }

    /// Adds objects in `other` that don't exist already, keeping the original
    /// source for those that do.
    pub fn extend(&mut self, other: &TickObjects) {
        for (kind, points) in &other.0 {
            let map = self.0.entry(*kind).or_default();
            for (point, source) in points {
                map.entry(*point).or_insert(*source);
            }
        }
    }

    /// Removes the objects of `kind` at locations `points`, if present.
    pub fn remove(&mut self, kind: ObjectKind, points: impl IntoIterator<Item = Point>) {
        let Some(map) = self.0.get_mut(&kind) else {
            return;
        };
        for point in points {
            map.remove(&point);
        }
    }

    /// Removes every object of `kind`.
    pub fn clear(&mut self, kind: ObjectKind) {
        self.0.remove(&kind);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ClientId;

    #[test]
    fn tick_objects_insert_iter() {
        let mut objects = TickObjects::default();
        assert!(objects.is_empty());
        assert_eq!(objects.len(), 0);
        assert_eq!(objects.iter().count(), 0);
        assert_eq!(objects.iter_of(ObjectKind::MaidenBloodSplats).count(), 0);

        objects.insert(
            ObjectKind::MokhaiotlSplat,
            Source::Client(ClientId(1)),
            [Point(5, 6), Point(3, 4)],
        );
        objects.insert(
            ObjectKind::MokhaiotlRock,
            Source::Client(ClientId(2)),
            [Point(3, 4)],
        );
        objects.insert(
            ObjectKind::MokhaiotlSplat,
            Source::Synthetic,
            [Point(3, 4), Point(7, 8)],
        );
        objects.insert(ObjectKind::MokhaiotlRock, Source::Synthetic, []);

        assert!(!objects.is_empty());
        assert_eq!(objects.len(), 4);
        assert_eq!(
            objects.iter().collect::<Vec<_>>(),
            [
                (
                    ObjectKind::MokhaiotlRock,
                    Point(3, 4),
                    Source::Client(ClientId(2))
                ),
                (
                    ObjectKind::MokhaiotlSplat,
                    Point(3, 4),
                    Source::Client(ClientId(1))
                ),
                (
                    ObjectKind::MokhaiotlSplat,
                    Point(5, 6),
                    Source::Client(ClientId(1))
                ),
                (ObjectKind::MokhaiotlSplat, Point(7, 8), Source::Synthetic),
            ]
        );
        assert_eq!(
            objects
                .iter_of(ObjectKind::MokhaiotlRock)
                .collect::<Vec<_>>(),
            [Point(3, 4)]
        );
        assert_eq!(
            objects.kinds().collect::<Vec<_>>(),
            [ObjectKind::MokhaiotlRock, ObjectKind::MokhaiotlSplat]
        );
    }

    #[test]
    fn tick_objects_fountains_remove() {
        let mut objects = TickObjects::default();
        objects.insert(
            ObjectKind::MokhaiotlSplat,
            Source::Client(ClientId(1)),
            [Point(3, 4), Point(5, 6), Point(7, 8)],
        );
        objects.insert(
            ObjectKind::MokhaiotlRock,
            Source::Client(ClientId(1)),
            [Point(3, 4)],
        );

        assert!(objects.contains(ObjectKind::MokhaiotlSplat, Point(3, 4)));
        assert!(objects.contains(ObjectKind::MokhaiotlRock, Point(3, 4)));
        assert!(!objects.contains(ObjectKind::MaidenBloodSplats, Point(3, 4)));
        assert!(!objects.contains(ObjectKind::MokhaiotlSplat, Point(9, 9)));
        assert!(objects.contains_kind(ObjectKind::MokhaiotlSplat));
        assert!(objects.contains_kind(ObjectKind::MokhaiotlRock));

        objects.remove(ObjectKind::MokhaiotlSplat, [Point(3, 4), Point(9, 9)]);
        objects.remove(ObjectKind::MaidenBloodSplats, [Point(5, 6)]);

        assert!(!objects.contains(ObjectKind::MokhaiotlSplat, Point(3, 4)));
        assert!(objects.contains(ObjectKind::MokhaiotlRock, Point(3, 4)));
        assert_eq!(objects.len(), 3);
        assert_eq!(
            objects.iter().collect::<Vec<_>>(),
            [
                (
                    ObjectKind::MokhaiotlRock,
                    Point(3, 4),
                    Source::Client(ClientId(1))
                ),
                (
                    ObjectKind::MokhaiotlSplat,
                    Point(5, 6),
                    Source::Client(ClientId(1))
                ),
                (
                    ObjectKind::MokhaiotlSplat,
                    Point(7, 8),
                    Source::Client(ClientId(1))
                ),
            ]
        );

        objects.remove(ObjectKind::MokhaiotlSplat, [Point(5, 6)]);
        objects.remove(ObjectKind::MokhaiotlRock, [Point(3, 4)]);
        assert!(objects.contains_kind(ObjectKind::MokhaiotlSplat));
        assert!(!objects.contains_kind(ObjectKind::MokhaiotlRock));
        assert_eq!(objects.iter_of(ObjectKind::MokhaiotlSplat).count(), 1);
        assert_eq!(
            objects.kinds().collect::<Vec<_>>(),
            [ObjectKind::MokhaiotlSplat]
        );
    }

    #[test]
    fn tick_objects_extend() {
        let mut objects = TickObjects::default();
        objects.insert(
            ObjectKind::MokhaiotlSplat,
            Source::Client(ClientId(4)),
            [Point(9, 10), Point(11, 12)],
        );

        let mut other = TickObjects::default();
        other.insert(
            ObjectKind::MokhaiotlSplat,
            Source::Client(ClientId(5)),
            [Point(11, 12), Point(13, 14)],
        );
        other.insert(
            ObjectKind::MokhaiotlRock,
            Source::Client(ClientId(5)),
            [Point(15, 16)],
        );

        objects.extend(&other);

        assert_eq!(
            objects.iter().collect::<Vec<_>>(),
            [
                (
                    ObjectKind::MokhaiotlRock,
                    Point(15, 16),
                    Source::Client(ClientId(5))
                ),
                (
                    ObjectKind::MokhaiotlSplat,
                    Point(9, 10),
                    Source::Client(ClientId(4))
                ),
                (
                    ObjectKind::MokhaiotlSplat,
                    Point(11, 12),
                    Source::Client(ClientId(4))
                ),
                (
                    ObjectKind::MokhaiotlSplat,
                    Point(13, 14),
                    Source::Client(ClientId(5))
                ),
            ]
        );
    }

    #[test]
    fn tick_objects_clear() {
        let mut objects = TickObjects::default();
        objects.insert(
            ObjectKind::ColosseumReentryPrimaryPool,
            Source::Client(ClientId(3)),
            [Point(1816, 3116), Point(1818, 3112)],
        );
        objects.insert(
            ObjectKind::ColosseumReentrySecondaryPool,
            Source::Client(ClientId(3)),
            [Point(1817, 3111)],
        );

        objects.clear(ObjectKind::ColosseumReentryPrimaryPool);

        assert!(!objects.contains_kind(ObjectKind::ColosseumReentryPrimaryPool));
        assert_eq!(
            objects.iter().collect::<Vec<_>>(),
            [(
                ObjectKind::ColosseumReentrySecondaryPool,
                Point(1817, 3111),
                Source::Client(ClientId(3))
            )]
        );
    }
}
