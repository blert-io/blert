//! State representation and operations on a recording of a challenge stage.

use std::collections::BTreeMap;

use crate::actor::{NpcState, Players, RoomId};
use crate::event::Event;
use crate::objects::TickObjects;

mod builder;
mod recording;

pub use builder::{
    BuildRejection, BuildWarning, FieldError, RawActor, RecordingBuilder, RejectionReason,
};

pub use recording::Recording;

/// The state of the world on a single tick alongside the events that occurred.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TickState {
    pub players: Players,
    pub npcs: BTreeMap<RoomId, NpcState>,
    pub objects: TickObjects,
    pub events: Vec<Event>,
}

#[derive(Debug)]
pub struct Timeline;
