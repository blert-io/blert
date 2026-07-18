//! Lua scripts executed against the Redis storage layer.

use std::sync::LazyLock;

use redis::Script;

use super::{
    CHALLENGE_KEY_PREFIX, CHALLENGE_UPDATES_CHANNEL, INBOX_KEY_PREFIX, LEASE_KEY_PREFIX,
    SIGNAL_CHANNEL,
};
use crate::lifecycle::core::{state::ChallengePhase, types::Epoch};

/// Claims up to a batch of claimable challenges for the claimant, bumping
/// each one's fence to a fresh epoch so any stalled previous owner's writes
/// are rejected. A challenge is claimable if its lease deadline has lapsed,
/// or if it is already recorded as owned by this claimant.
///
/// ## Arguments
///
/// - `KEYS[1]` = Challenge index
///
/// - `ARGV[1]` = Claimant identity
/// - `ARGV[2]` = Current time, as a unix millisecond timestamp
/// - `ARGV[3]` = New lease deadline, as a unix millisecond timestamp
/// - `ARGV[4]` = Batch size
/// - `ARGV[5..]` = Uuids of challenges to skip
///
/// ## Return value
///
/// A flat list of alternating uuid, epoch pairs for each claimed challenge.
/// Empty when nothing was claimable.
pub(super) static CLAIM_SCRIPT: LazyLock<Script> = LazyLock::new(|| {
    Script::new(&format!(
        r"
        local skip = {{}}
        for i = 5, #ARGV do
            skip[ARGV[i]] = true
        end
        local claimed = {{}}
        local index = redis.call('ZRANGE', KEYS[1], 0, -1, 'WITHSCORES')
        for i = 1, #index, 2 do
            if #claimed >= 2 * tonumber(ARGV[4]) then
                break
            end
            local uuid = index[i]
            local lease = '{LEASE_KEY_PREFIX}' .. uuid
            if not skip[uuid]
                and (tonumber(index[i + 1]) <= tonumber(ARGV[2])
                    or redis.call('HGET', lease, 'owner') == ARGV[1]) then
                local epoch = redis.call('HINCRBY', lease, 'fence', 1)
                redis.call('HSET', lease, 'owner', ARGV[1])
                redis.call('ZADD', KEYS[1], ARGV[3], uuid)
                claimed[#claimed + 1] = uuid
                claimed[#claimed + 1] = epoch
            end
        end
        return claimed
        ",
    ))
});

/// Extends a challenge's lease deadline, provided the renewer's epoch still
/// holds the challenge's fence.
///
/// ## Arguments
///
/// - `KEYS[1]` = Challenge's lease hash
/// - `KEYS[2]` = Challenge index
///
/// - `ARGV[1]` = Lease epoch
/// - `ARGV[2]` = Challenge uuid
/// - `ARGV[3]` = New lease deadline, as a unix millisecond timestamp
///
/// ## Return value
///
/// - `1`: The lease was renewed.
/// - `0`: The epoch no longer holds the fence.
pub(super) static RENEW_SCRIPT: LazyLock<Script> = LazyLock::new(|| {
    Script::new(
        r"
        if redis.call('HGET', KEYS[1], 'fence') ~= ARGV[1] then
            return 0
        end
        redis.call('ZADD', KEYS[2], ARGV[3], ARGV[2])
        return 1
        ",
    )
});

/// Releases a challenge's lease by zeroing its deadline, provided the
/// releaser's epoch still holds the challenge's fence, leaving the challenge
/// immediately claimable by any instance.
///
/// ## Arguments
///
/// - `KEYS[1]` = Challenge's lease hash
/// - `KEYS[2]` = Challenge index
///
/// - `ARGV[1]` = Lease epoch
/// - `ARGV[2]` = Challenge uuid
///
/// ## Return value
///
/// - `1`: The lease was released.
/// - `0`: The epoch no longer holds the fence.
pub(super) static RELEASE_SCRIPT: LazyLock<Script> = LazyLock::new(|| {
    Script::new(
        r"
        if redis.call('HGET', KEYS[1], 'fence') ~= ARGV[1] then
            return 0
        end
        redis.call('ZADD', KEYS[2], 0, ARGV[2])
        return 1
        ",
    )
});

/// Appends a batch of journal entries as a single stream entry, provided the
/// appender's epoch still holds the challenge's fence.
///
/// ## Arguments
///
/// - `KEYS[1]` = Challenge's lease hash
/// - `KEYS[2]` = Challenge's journal stream
///
/// - `ARGV[1]` = Lease epoch
/// - `ARGV[2]` = Serialized journal entries
///
/// ## Return value
///
/// - `1`: The batch was appended.
/// - `0`: The epoch no longer holds the fence.
pub(super) static APPEND_SCRIPT: LazyLock<Script> = LazyLock::new(|| {
    Script::new(
        r"
        if redis.call('HGET', KEYS[1], 'fence') ~= ARGV[1] then
            return 0
        end
        redis.call('XADD', KEYS[2], '*', 'epoch', ARGV[1], 'batch', ARGV[2])
        return 1
        ",
    )
});

/// Writes the challenge's state and clients hashes and signals the update,
/// provided the writer's epoch still holds the challenge's fence.
///
/// `stageAttempt` is cleared before the pairs apply, as it is present in the
/// state hash only while the challenge's stage tracks attempts. The clients
/// hash is rewritten whole so departed clients disappear.
///
/// ## Arguments
///
/// - `KEYS[1]` = Challenge's state hash
/// - `KEYS[2]` = Challenge's lease hash
/// - `KEYS[3]` = Challenge's clients hash
///
/// - `ARGV[1]` = Lease epoch
/// - `ARGV[2]` = Serialized update signal
/// - `ARGV[3]` = Number of state hash key-value arguments `n`
/// - `ARGV[4..3+n]` = Key-value pairs to set in the state hash
/// - `ARGV[4+n..]` = Key-value pairs to set in the clients hash
///
/// ## Return value
///
/// - `1`: The state was projected.
/// - `0`: The epoch no longer holds the fence.
pub(super) static PROJECT_SCRIPT: LazyLock<Script> = LazyLock::new(|| {
    Script::new(&format!(
        r"
        if redis.call('HGET', KEYS[2], 'fence') ~= ARGV[1] then
            return 0
        end
        local n = tonumber(ARGV[3])
        redis.call('HDEL', KEYS[1], 'stageAttempt')
        redis.call('HSET', KEYS[1], unpack(ARGV, 4, 3 + n))
        redis.call('DEL', KEYS[3])
        if #ARGV > 3 + n then
            redis.call('HSET', KEYS[3], unpack(ARGV, 4 + n))
        end
        redis.call('PUBLISH', '{SIGNAL_CHANNEL}', ARGV[2])
        return 1
        ",
    ))
});

/// Broadcasts a challenge lifecycle update to the updates pubsub channel,
/// provided the writer's epoch still holds the challenge's fence.
///
/// ## Arguments
///
/// - `KEYS[1]` = Challenge's lease hash
///
/// - `ARGV[1]` = Lease epoch
/// - `ARGV[2]` = Serialized challenge update
///
/// ## Return value
///
/// - `1`: The update was announced.
/// - `0`: The epoch no longer holds the fence.
pub(super) static ANNOUNCE_SCRIPT: LazyLock<Script> = LazyLock::new(|| {
    Script::new(&format!(
        r"
        if redis.call('HGET', KEYS[1], 'fence') ~= ARGV[1] then
            return 0
        end
        redis.call('PUBLISH', '{CHALLENGE_UPDATES_CHANNEL}', ARGV[2])
        return 1
        ",
    ))
});

/// Starts a challenge for a client, either creating a new challenge for the
/// party, or joining the party's existing one if it is live. A live challenge
/// is either active or does not yet have any state because it is initializing.
/// If the incoming stage is earlier than the active challenge's stage, it is
/// counted as the start of a new challenge.
///
/// If creating a challenge, adds its UUID to the index owned until the given
/// lease deadline, establishes its fence at the initial epoch under the
/// creator's ownership, points each party member's player key at it, and
/// pushes an initial creation command to its inbox.
/// If joining, pushes the join command to the incumbent's inbox instead,
/// leaving the player keys alone as the party is unchanged.
///
/// If the client is listed in another challenge, sends a removal command to it.
///
/// ## Arguments
///
/// - `KEYS[1]` = Party directory key
/// - `KEYS[2]` = Challenge index
/// - `KEYS[3]` = New challenge's lease hash
/// - `KEYS[4]` = The client's active challenge key
/// - `KEYS[5]` = New challenge's inbox stream
/// - `KEYS[6..]` = Party members' player keys
///
/// - `ARGV[1]` = Fresh challenge uuid
/// - `ARGV[2]` = Creating instance's identity
/// - `ARGV[3]` = Lease deadline for the created challenge
/// - `ARGV[4]` = List of stages for the challenge beyond the incoming one
/// - `ARGV[5]` = Serialized create command
/// - `ARGV[6]` = Serialized join command
/// - `ARGV[7]` = Serialized removal command for an existing challenge
///
/// ## Return value
///
/// - `["CREATE", id]`: A new challenge was created and its create command
///   was queued at `id`.
/// - `["JOIN", uuid, id]`: The client joined existing challenge `uuid` and its
///   join command was queued at `id`.
pub(super) static START_SCRIPT: LazyLock<Script> = LazyLock::new(|| {
    Script::new(&format!(
        r"
        local function leave_previous(target)
            local previous = redis.call('GET', KEYS[4])
            if previous and previous ~= target
                and redis.call('ZSCORE', KEYS[2], previous) then
                redis.call('XADD', '{INBOX_KEY_PREFIX}' .. previous, '*', 'cmd', ARGV[7])
            end
        end

        local incumbent = redis.call('GET', KEYS[1])
        if incumbent then
            local challenge = '{CHALLENGE_KEY_PREFIX}' .. incumbent
            local phase = redis.call('HGET', challenge, 'phase')
            local joinable = phase == false
            if phase == '{active}' then
                local stage = redis.call('HGET', challenge, 'stage')
                joinable = not (stage and string.find(ARGV[4], ',' .. stage .. ',', 1, true))
            end
            if joinable then
                leave_previous(incumbent)
                redis.call('SET', KEYS[4], incumbent)
                local id = redis.call('XADD', '{INBOX_KEY_PREFIX}' .. incumbent, '*', 'cmd', ARGV[6])
                return {{'JOIN', incumbent, id}}
            end
        end
        leave_previous(ARGV[1])
        redis.call('SET', KEYS[1], ARGV[1])
        redis.call('HSET', KEYS[3], 'fence', {initial_epoch}, 'owner', ARGV[2])
        redis.call('ZADD', KEYS[2], ARGV[3], ARGV[1])
        redis.call('SET', KEYS[4], ARGV[1])
        for i = 6, #KEYS do
            redis.call('SET', KEYS[i], ARGV[1])
        end
        local id = redis.call('XADD', KEYS[5], '*', 'cmd', ARGV[5])
        return {{'CREATE', id}}
        ",
        active = ChallengePhase::Active.tag(),
        initial_epoch = Epoch::INITIAL,
    ))
});

/// Deletes a terminated challenge's state, provided the deleter's epoch still
/// holds the challenge's fence, permanently removing it from the existence
/// index.
///
/// Routing keys are removed only if they still point to the challenge, as a
/// successor may have overwritten them. Stage event streams are swept through
/// the challenge's stream set. The journal and inbox are not deleted but left
/// to expire, so that recently ended challenges can be inspected. The state
/// and clients hashes are also left to expire, briefly, so that response
/// waiters racing the deletion can still read the state their commands
/// produced.
///
/// ## Arguments
///
/// - `KEYS[1]` = Challenge's lease hash
/// - `KEYS[2]` = Challenge index
/// - `KEYS[3]` = Challenge's state hash
/// - `KEYS[4]` = Challenge's journal stream
/// - `KEYS[5]` = Challenge's inbox stream
/// - `KEYS[6]` = Challenge's stage streams set
/// - `KEYS[7]` = Challenge's clients hash
/// - `KEYS[8..]` = The challenge's routing keys (directory, client, and player)
///
/// - `ARGV[1]` = Lease epoch
/// - `ARGV[2]` = Challenge uuid
/// - `ARGV[3]` = Serialized deletion signal
/// - `ARGV[4]` = Journal and inbox retention, in seconds
/// - `ARGV[5]` = State hash retention, in seconds
///
/// ## Return value
///
/// - `1`: The challenge was deleted.
/// - `0`: The epoch no longer holds the fence.
pub(super) static DELETE_SCRIPT: LazyLock<Script> = LazyLock::new(|| {
    Script::new(&format!(
        r"
        if redis.call('HGET', KEYS[1], 'fence') ~= ARGV[1] then
            return 0
        end
        redis.call('EXPIRE', KEYS[3], ARGV[5])
        redis.call('EXPIRE', KEYS[7], ARGV[5])
        for i = 8, #KEYS do
            if redis.call('GET', KEYS[i]) == ARGV[2] then
                redis.call('DEL', KEYS[i])
            end
        end
        local streams = redis.call('SMEMBERS', KEYS[6])
        for _, stream in ipairs(streams) do
            redis.call('DEL', stream)
        end
        redis.call('DEL', KEYS[6])
        redis.call('EXPIRE', KEYS[4], ARGV[4])
        redis.call('EXPIRE', KEYS[5], ARGV[4])
        redis.call('PUBLISH', '{SIGNAL_CHANNEL}', ARGV[3])
        redis.call('ZREM', KEYS[2], ARGV[2])
        redis.call('DEL', KEYS[1])
        return 1
        ",
    ))
});

/// Queues a join command into a challenge's inbox and links the client to
/// it, provided the challenge exists and has not terminated. Fails if the
/// client is already in another challenge.
/// A challenge with no state hash is still applying its create, and accepts.
///
/// ## Arguments
///
/// - `KEYS[1]` = Existence index
/// - `KEYS[2]` = Challenge's state hash
/// - `KEYS[3]` = Client routing key
/// - `KEYS[4]` = Challenge's inbox stream
///
/// - `ARGV[1]` = Challenge uuid
/// - `ARGV[2]` = Serialized join command
///
/// ## Return value
///
/// - `["OK", id]`: The join was queued with sequence `id`.
/// - `["UNKNOWN"]`: The challenge does not exist or has terminated.
/// - `["ELSEWHERE"]`: The client is already in another challenge.
pub(super) static REJOIN_SCRIPT: LazyLock<Script> = LazyLock::new(|| {
    Script::new(&format!(
        r"
        if redis.call('ZSCORE', KEYS[1], ARGV[1]) == false then
            return {{'UNKNOWN'}}
        end
        if redis.call('HGET', KEYS[2], 'phase') == '{terminated}' then
            return {{'UNKNOWN'}}
        end
        local current = redis.call('GET', KEYS[3])
        if current and current ~= ARGV[1] then
            return {{'ELSEWHERE'}}
        end
        redis.call('SET', KEYS[3], ARGV[1])
        local id = redis.call('XADD', KEYS[4], '*', 'cmd', ARGV[2])
        return {{'OK', id}}
        ",
        terminated = ChallengePhase::Terminated.tag(),
    ))
});

/// Queues a command into a challenge's inbox, provided the challenge exists.
///
/// ## Arguments
///
/// - `KEYS[1]` = Existence index
/// - `KEYS[2]` = Challenge's inbox stream
///
/// - `ARGV[1]` = Challenge uuid
/// - `ARGV[2]` = Serialized command
///
/// ## Return value
///
/// - Stream entry id: The command was queued.
/// - `false`: The challenge does not exist.
pub(super) static SEND_SCRIPT: LazyLock<Script> = LazyLock::new(|| {
    Script::new(
        r"
        if redis.call('ZSCORE', KEYS[1], ARGV[1]) == false then
            return false
        end
        return redis.call('XADD', KEYS[2], '*', 'cmd', ARGV[2])
        ",
    )
});

/// Queues a command into the inbox of the challenge a client is currently
/// recording, ruled from the client's routing key: no key or a terminated
/// challenge means none. A challenge with no state yet is still applying its
/// create, and accepts. The challenge's state hash and inbox are addressed
/// dynamically from the routing key's value.
///
/// ## Arguments
///
/// - `KEYS[1]` = Client routing key
///
/// - `ARGV[1]` = Serialized command
///
/// ## Return value
///
/// - `[uuid, id]`: The command was queued to the client's current challenge.
/// - `false`: The client has no current challenge, or it has terminated.
pub(super) static CLIENT_SEND_SCRIPT: LazyLock<Script> = LazyLock::new(|| {
    Script::new(&format!(
        r"
        local uuid = redis.call('GET', KEYS[1])
        if not uuid then
            return false
        end
        local phase = redis.call('HGET', '{CHALLENGE_KEY_PREFIX}' .. uuid, 'phase')
        if phase == '{terminated}' then
            return false
        end
        local id = redis.call('XADD', '{INBOX_KEY_PREFIX}' .. uuid, '*', 'cmd', ARGV[1])
        return {{uuid, id}}
        ",
        terminated = ChallengePhase::Terminated.tag(),
    ))
});
