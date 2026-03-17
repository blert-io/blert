use tokio::sync::mpsc;

use crate::message::SseMessage;

/// Unique subscriber ID.
pub type SubscriberId = u64;

/// Tracks which phase of the event stream a subscriber is in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SubscriberState {
    /// Receiving historical events to catch up to the live cursor.
    Replaying,
    /// Caught up and receiving events in real time.
    Live,
}

/// A connected SSE client watching a challenge.
#[derive(Debug)]
pub struct Subscriber {
    /// Unique identifier for this subscriber.
    pub id: SubscriberId,
    /// If set, the subscriber only wants events for this stage.
    /// `None` means the subscriber receives only control messages.
    pub requested_stage: Option<i32>,
    /// Current state of this subscriber's event stream.
    pub state: SubscriberState,
    /// Channel to push SSE messages to the subscriber's response stream.
    sender: mpsc::UnboundedSender<SseMessage>,
}

impl Subscriber {
    pub fn new(
        id: SubscriberId,
        requested_stage: Option<i32>,
        sender: mpsc::UnboundedSender<SseMessage>,
    ) -> Self {
        Self {
            id,
            requested_stage,
            state: SubscriberState::Replaying,
            sender,
        }
    }

    /// Sends a message to this subscriber. Returns `false` if the subscriber
    /// has disconnected.
    pub fn send(&self, msg: SseMessage) -> bool {
        self.sender.send(msg).is_ok()
    }
}
