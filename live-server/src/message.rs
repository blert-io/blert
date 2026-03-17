/// Messages sent to SSE subscribers.
///
/// Each variant maps to an SSE `event:` type that the web client handles.
#[derive(Debug, Clone)]
pub enum SseMessage {
    /// Initial challenge metadata sent on subscribe.
    Metadata {
        challenge_type: i32,
        mode: i32,
        stage: i32,
        attempt: Option<u32>,
        stage_active: bool,
        party: Vec<String>,
    },

    /// Signals the start of a catch-up sequence from cached history.
    Reset {
        reason: ResetReason,
        stage: i32,
        attempt: Option<u32>,
        stage_active: bool,
        generation: u64,
    },

    /// A chunk of historical events during catch-up.
    /// Split on tick boundaries so no two chunks overlap in time.
    ReplayChunk {
        generation: u64,
        start_tick: u32,
        tick_count: u32,
        data: Vec<u8>,
    },

    /// Marks the end of the catch-up sequence.
    ReplayEnd { generation: u64, tick: u32 },

    /// A single live tick's events, broadcast at 600ms cadence.
    /// `tick_count` is normally 1 but may be higher during lag recovery.
    Tick {
        generation: u64,
        tick: u32,
        tick_count: u32,
        data: Vec<u8>,
    },

    /// The challenge's current stage has changed.
    StageChange { stage: i32, attempt: Option<u32> },

    /// The current stage has ended.
    StageEnd { stage: i32, attempt: Option<u32> },

    /// All recording clients have disconnected.
    Stalled { reason: String },

    /// The challenge has finished. Clients should close the stream and refetch.
    Complete,

    /// The server is shutting down. Clients should reconnect after a delay.
    Shutdown { retry_window_secs: u32 },

    /// Keep-alive comment to prevent proxy/client timeouts.
    KeepAlive,
}

/// Reason for a stream reset.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResetReason {
    /// Subscriber reconnected after a disconnect.
    Reconnect,
    /// The primary recording client changed.
    PrimaryChange,
    /// A new attempt started on the same stage.
    NewAttempt,
}
