//! Grand Exchange item price lookups.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper_rustls::HttpsConnector;
use hyper_util::client::legacy::Client;
use hyper_util::client::legacy::connect::HttpConnector;
use hyper_util::rt::TokioExecutor;
use serde::Deserialize;

const OSRS_WIKI_PRICES_ENDPOINT: &str = "https://prices.runescape.wiki/api/v1/osrs";
const CACHE_TTL: Duration = Duration::from_hours(1);
const USER_AGENT: &str = "blert.io challenge-server (https://blert.io)";

/// An error returned by a price lookup.
#[derive(Debug, thiserror::Error)]
pub enum PriceError {
    #[error("price request failed: {0}")]
    Request(String),
    #[error("no price data for item {0}")]
    MissingItem(i32),
}

/// OSRS wiki price response format.
#[derive(Deserialize)]
struct LatestPrices {
    data: HashMap<String, ItemPrice>,
}

#[derive(Deserialize)]
struct ItemPrice {
    high: Option<u64>,
    low: Option<u64>,
}

struct PriceMap {
    prices: HashMap<i32, u64>,
    fetched: Instant,
}

/// Looks up and caches Grand Exchange item prices.
pub struct PriceResolver {
    client: Client<HttpsConnector<HttpConnector>, Full<Bytes>>,
    endpoint: String,
    /// Bound on a single fetch.
    /// `None` disables fetching, using only prepopulated cached prices.
    fetch_timeout: Option<Duration>,
    prices: Mutex<Option<PriceMap>>,
    /// Serializes refreshes to avoid concurrent fetches.
    refresh_lock: tokio::sync::Mutex<()>,
}

impl PriceResolver {
    pub fn new(fetch_timeout: Option<Duration>) -> PriceResolver {
        let https = hyper_rustls::HttpsConnectorBuilder::new()
            .with_native_roots()
            .expect("native roots")
            .https_or_http()
            .enable_http1()
            .build();
        PriceResolver {
            client: Client::builder(TokioExecutor::new()).build(https),
            endpoint: OSRS_WIKI_PRICES_ENDPOINT.to_string(),
            fetch_timeout,
            prices: Mutex::new(None),
            refresh_lock: tokio::sync::Mutex::new(()),
        }
    }

    /// Fetches every item's price into the cache if it is stale.
    /// The wait is bounded by the configured fetch timeout.
    pub async fn refresh(&self) -> Result<(), PriceError> {
        let Some(timeout) = self.fetch_timeout else {
            return Err(PriceError::Request("fetching is disabled".to_string()));
        };
        let refresh = async {
            let _lock = self.refresh_lock.lock().await;
            // Another caller may have refreshed while this one waited.
            if self.is_fresh() {
                return Ok(());
            }
            let prices = self.fetch_all().await?;
            *self.prices.lock().expect("price map lock") = Some(PriceMap {
                prices,
                fetched: Instant::now(),
            });
            Ok(())
        };
        tokio::time::timeout(timeout, refresh)
            .await
            .map_err(|_| PriceError::Request("timed out".to_string()))?
    }

    /// Returns the current price of an item, refreshing a stale cache first.
    /// The wait is bounded by the configured fetch timeout.
    pub async fn get_price(&self, item_id: i32) -> Result<u64, PriceError> {
        if let Some(result) = self.cached_price(item_id) {
            return result;
        }

        if self.fetch_timeout.is_some()
            && let Err(error) = self.refresh().await
        {
            tracing::warn!(error = %error, "price_refresh_failed");
        }

        let guard = self.prices.lock().expect("price map lock");
        match guard.as_ref() {
            Some(map) => Self::lookup(&map.prices, item_id),
            None => Err(PriceError::MissingItem(item_id)),
        }
    }

    fn is_fresh(&self) -> bool {
        let guard = self.prices.lock().expect("price map lock");
        guard
            .as_ref()
            .is_some_and(|map| map.fetched.elapsed() < CACHE_TTL)
    }

    fn cached_price(&self, item_id: i32) -> Option<Result<u64, PriceError>> {
        let guard = self.prices.lock().expect("price map lock");
        match guard.as_ref() {
            Some(map) if map.fetched.elapsed() < CACHE_TTL => {
                Some(Self::lookup(&map.prices, item_id))
            }
            _ => None,
        }
    }

    fn lookup(prices: &HashMap<i32, u64>, item_id: i32) -> Result<u64, PriceError> {
        prices
            .get(&item_id)
            .copied()
            .ok_or(PriceError::MissingItem(item_id))
    }

    async fn fetch_all(&self) -> Result<HashMap<i32, u64>, PriceError> {
        let request = axum::http::Request::get(format!("{}/latest", self.endpoint))
            .header(axum::http::header::USER_AGENT, USER_AGENT)
            .body(Full::<Bytes>::default())
            .expect("request is valid");

        let response = self
            .client
            .request(request)
            .await
            .map_err(|error| PriceError::Request(error.to_string()))?;
        let body = response
            .into_body()
            .collect()
            .await
            .map_err(|error| PriceError::Request(error.to_string()))?
            .to_bytes();

        let latest: LatestPrices = serde_json::from_slice(&body)
            .map_err(|error| PriceError::Request(error.to_string()))?;
        Ok(latest
            .data
            .into_iter()
            .filter_map(|(id, item)| {
                let id = id.parse().ok()?;
                let price = match (item.high, item.low) {
                    (Some(high), Some(low)) => u64::midpoint(high, low),
                    (Some(high), None) => high,
                    (None, Some(low)) => low,
                    (None, None) => 0,
                };
                Some((id, price))
            })
            .collect())
    }
}
