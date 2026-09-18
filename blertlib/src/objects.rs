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
}

/// The set of objects present in the world on a tick.
#[derive(Debug, Default, Clone)]
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

    /// Returns an iterator over each object on this tick.
    pub fn iter(&self) -> impl Iterator<Item = (ObjectKind, Point)> + '_ {
        self.0
            .iter()
            .flat_map(|(kind, points)| points.keys().map(move |point| (*kind, *point)))
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

    /// Removes the objects of `kind` at locations `points`, if present.
    pub fn remove(&mut self, kind: ObjectKind, points: impl IntoIterator<Item = Point>) {
        let Some(map) = self.0.get_mut(&kind) else {
            return;
        };
        for point in points {
            map.remove(&point);
        }
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
                (ObjectKind::MokhaiotlRock, Point(3, 4)),
                (ObjectKind::MokhaiotlSplat, Point(3, 4)),
                (ObjectKind::MokhaiotlSplat, Point(5, 6)),
                (ObjectKind::MokhaiotlSplat, Point(7, 8)),
            ]
        );
        assert_eq!(
            objects
                .iter_of(ObjectKind::MokhaiotlRock)
                .collect::<Vec<_>>(),
            [Point(3, 4)]
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
                (ObjectKind::MokhaiotlRock, Point(3, 4)),
                (ObjectKind::MokhaiotlSplat, Point(5, 6)),
                (ObjectKind::MokhaiotlSplat, Point(7, 8)),
            ]
        );

        objects.remove(ObjectKind::MokhaiotlSplat, [Point(5, 6)]);
        objects.remove(ObjectKind::MokhaiotlRock, [Point(3, 4)]);
        assert!(objects.contains_kind(ObjectKind::MokhaiotlSplat));
        assert!(!objects.contains_kind(ObjectKind::MokhaiotlRock));
        assert_eq!(objects.iter_of(ObjectKind::MokhaiotlSplat).count(), 1);
    }
}
