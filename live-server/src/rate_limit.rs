use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::{Arc, Mutex};
use std::time::Instant;

/// Per-IP rate limiter and concurrent connection tracker.
///
/// Combines two protections:
/// - Rejects requests exceeding `max_requests` within `window`.
/// - Rejects requests when `max_concurrent` connections are already open from
///   the same IP.
pub struct RateLimiter {
    state: Mutex<HashMap<IpAddr, IpState>>,
    max_requests: u32,
    window: std::time::Duration,
    max_concurrent: u32,
}

struct IpState {
    /// Number of requests in the current window.
    request_count: u32,
    /// Start of the current rate limit window.
    window_start: Instant,
    /// Number of currently open connections.
    concurrent: u32,
}

impl RateLimiter {
    pub fn new(max_requests: u32, window: std::time::Duration, max_concurrent: u32) -> Self {
        Self {
            state: Mutex::new(HashMap::new()),
            max_requests,
            window,
            max_concurrent,
        }
    }

    /// Attempts to acquire a connection slot. Returns a [`ConnectionGuard`]
    /// on success, or the reason for rejection.
    pub fn try_acquire(self: &Arc<Self>, ip: IpAddr) -> Result<ConnectionGuard, RejectionReason> {
        let mut state = self.state.lock().unwrap();
        let entry = state.entry(ip).or_insert_with(|| IpState {
            request_count: 0,
            window_start: Instant::now(),
            concurrent: 0,
        });

        // Reset window if expired.
        if entry.window_start.elapsed() >= self.window {
            entry.request_count = 0;
            entry.window_start = Instant::now();
        }

        if entry.request_count >= self.max_requests {
            return Err(RejectionReason::RateLimited);
        }

        if entry.concurrent >= self.max_concurrent {
            return Err(RejectionReason::TooManyConnections);
        }

        entry.request_count += 1;
        entry.concurrent += 1;

        Ok(ConnectionGuard {
            limiter: Arc::clone(self),
            ip,
        })
    }
}

#[derive(Debug)]
pub enum RejectionReason {
    RateLimited,
    TooManyConnections,
}

/// RAII guard that decrements the concurrent connection count on drop.
pub struct ConnectionGuard {
    limiter: Arc<RateLimiter>,
    ip: IpAddr,
}

impl Drop for ConnectionGuard {
    fn drop(&mut self) {
        let mut state = self.limiter.state.lock().unwrap();
        if let Some(entry) = state.get_mut(&self.ip) {
            entry.concurrent = entry.concurrent.saturating_sub(1);
            // Clean up entries with no active connections to avoid unbounded
            // map growth from many unique IPs.
            if entry.concurrent == 0 && entry.window_start.elapsed() >= self.limiter.window {
                state.remove(&self.ip);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;
    use std::time::Duration;

    fn localhost() -> IpAddr {
        IpAddr::V4(Ipv4Addr::LOCALHOST)
    }

    fn other_ip() -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1))
    }

    fn limiter(max_requests: u32, max_concurrent: u32) -> Arc<RateLimiter> {
        Arc::new(RateLimiter::new(
            max_requests,
            Duration::from_secs(60),
            max_concurrent,
        ))
    }

    #[test]
    fn allows_requests_within_limits() {
        let lim = limiter(5, 5);
        let guards: Vec<_> = (0..5)
            .map(|_| lim.try_acquire(localhost()).unwrap())
            .collect();
        assert_eq!(guards.len(), 5);
    }

    #[test]
    fn rejects_when_rate_limited() {
        let lim = limiter(3, 10);
        let _guards: Vec<_> = (0..3)
            .map(|_| lim.try_acquire(localhost()).unwrap())
            .collect();

        let result = lim.try_acquire(localhost());
        assert!(matches!(result, Err(RejectionReason::RateLimited)));
    }

    #[test]
    fn rejects_when_too_many_concurrent() {
        let lim = limiter(10, 2);
        let _guards: Vec<_> = (0..2)
            .map(|_| lim.try_acquire(localhost()).unwrap())
            .collect();

        let result = lim.try_acquire(localhost());
        assert!(matches!(result, Err(RejectionReason::TooManyConnections)));
    }

    #[test]
    fn drop_releases_concurrent_slot() {
        let lim = limiter(10, 1);
        let guard = lim.try_acquire(localhost()).unwrap();

        // At capacity.
        assert!(lim.try_acquire(localhost()).is_err());

        // Dropping frees the slot.
        drop(guard);
        assert!(lim.try_acquire(localhost()).is_ok());
    }

    #[test]
    fn separate_ips_are_independent() {
        let lim = limiter(2, 1);

        let _g1 = lim.try_acquire(localhost()).unwrap();

        // Different IP is unaffected.
        let _g2 = lim.try_acquire(other_ip()).unwrap();

        // Same IP is blocked.
        assert!(lim.try_acquire(localhost()).is_err());
    }

    #[test]
    fn window_resets_request_count() {
        let lim = Arc::new(RateLimiter::new(
            2,
            Duration::from_millis(1), // tiny window
            10,
        ));

        let g1 = lim.try_acquire(localhost()).unwrap();
        let g2 = lim.try_acquire(localhost()).unwrap();
        drop(g1);
        drop(g2);

        // Rate limited.
        assert!(matches!(
            lim.try_acquire(localhost()),
            Err(RejectionReason::RateLimited)
        ));

        // Wait for window to expire.
        // TODO(frolv): sleep in unit tests is a grave sin
        std::thread::sleep(Duration::from_millis(5));

        // Should succeed after window reset.
        assert!(lim.try_acquire(localhost()).is_ok());
    }
}
