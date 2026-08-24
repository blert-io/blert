//! Merge client classification.
//!
//! Selects both the reference client and tick count for a merge, and determines
//! how others should be merged into it.

use std::collections::BTreeMap;

use crate::lifecycle::core::types::Stage;

use super::client_events::ClientEvents;
use super::{ChallengeInfo, MergeAlert};

#[derive(Debug, PartialEq, Eq)]
pub(super) struct ClientClassification {
    /// Reference client for the merge.
    pub base: usize,
    /// Clients whose tick counts equal an accurate reference tick count.
    pub matching: Vec<usize>,
    /// Clients which require alignment to merge.
    pub mismatched: Vec<usize>,
    /// The reference tick count.
    pub reference_ticks: ReferenceTicks,
    /// Alert raised during classification.
    pub alert: Option<MergeAlert>,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) struct ReferenceTicks {
    /// The selected tick count.
    pub count: u32,
    /// How the count was chosen.
    pub method: ReferenceMethod,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum ReferenceMethod {
    AccurateModal,
    PreciseServer,
    ImpreciseServer,
    RecordedTicks,
}

/// Classifies a stage's nonempty clients ahead of a merge.
/// Clients claiming to be accurate while disagreeing with others are demoted.
pub(super) fn classify_clients(
    challenge: &ChallengeInfo,
    stage: Stage,
    clients: &mut [ClientEvents],
) -> ClientClassification {
    debug_assert!(!clients.is_empty());

    let mut alert = demote_conflicting_accuracy(challenge, stage, clients);

    let base = select_base_client(clients);
    let (matching, mismatched): (Vec<usize>, Vec<usize>) =
        (0..clients.len()).filter(|&i| i != base).partition(|&i| {
            clients[i].accurate && clients[i].recorded_ticks == clients[base].recorded_ticks
        });

    let ticks = if clients[base].accurate {
        ReferenceTicks {
            count: clients[base].recorded_ticks,
            method: ReferenceMethod::AccurateModal,
        }
    } else {
        let (ticks, ref_alert) = select_reference_ticks(clients);
        alert = alert.or(ref_alert);
        ticks
    };

    ClientClassification {
        base,
        matching,
        mismatched,
        reference_ticks: ticks,
        alert,
    }
}

/// Demotes clients claiming to be accurate whose tick counts disagree with the
/// consensus of accurate clients. Without a distinct consensus, all clients
/// are demoted.
fn demote_conflicting_accuracy(
    challenge: &ChallengeInfo,
    stage: Stage,
    clients: &mut [ClientEvents],
) -> Option<MergeAlert> {
    let mut counts: BTreeMap<u32, u32> = BTreeMap::new();
    for client in clients.iter().filter(|client| client.accurate) {
        *counts.entry(client.recorded_ticks).or_default() += 1;
    }
    let max_count = counts.values().copied().max()?;

    let modes: Vec<u32> = counts
        .iter()
        .filter(|&(_, &count)| count == max_count)
        .map(|(&ticks, _)| ticks)
        .collect();

    if let [modal_ticks] = modes[..] {
        for client in clients
            .iter_mut()
            .filter(|client| client.accurate && client.recorded_ticks != modal_ticks)
        {
            tracing::error!(
                uuid = %challenge.uuid,
                %client.client_id,
                ?stage,
                expected_ticks = modal_ticks,
                actual_ticks = client.recorded_ticks,
                "merge_client_accuracy_mismatch",
            );
            client.accurate = false;
        }
        None
    } else {
        tracing::error!(
            uuid = %challenge.uuid,
            ?stage,
            tick_counts = ?modes,
            "merge_multiple_accurate_tick_modes",
        );
        for client in clients.iter_mut().filter(|client| client.accurate) {
            client.accurate = false;
        }
        Some(MergeAlert::MultipleServerTickCounts {
            precise: true,
            tick_counts: modes,
        })
    }
}

/// Selects the reference client for the merge.
///
/// An accurate client is preferred, taking the lowest client ID, since after
/// the demotion pass every accurate client has the same tick count.
///
/// Without accurate clients, the most complete timeline is chosen, with
/// participants ahead of spectators and the ID as the final tiebreaker.
fn select_base_client(clients: &[ClientEvents]) -> usize {
    let accurate = (0..clients.len())
        .filter(|&i| clients[i].accurate)
        .min_by_key(|&i| clients[i].client_id);
    if let Some(index) = accurate {
        return index;
    }

    (0..clients.len())
        .min_by_key(|&i| {
            (
                std::cmp::Reverse(clients[i].recorded_ticks),
                clients[i].primary_player.is_none(),
                clients[i].client_id,
            )
        })
        .expect("clients is nonempty")
}

/// Selects the reference tick count for a stage without any accurate clients.
///
/// Server counts are preferred, with precise over imprecise, taking the
/// consensus if they disagree. Either should be consistent across behaving
/// clients, so disagreements are surfaced in the result for inspection.
///
/// Without any server tick count, the longest recording is used.
fn select_reference_ticks(clients: &[ClientEvents]) -> (ReferenceTicks, Option<MergeAlert>) {
    let precise_counts: Vec<u32> = clients
        .iter()
        .filter_map(|client| client.server_ticks.filter(|st| st.precise))
        .map(|st| st.count)
        .collect();
    let has_precise = !precise_counts.is_empty();
    let server_counts: Vec<u32> = if has_precise {
        precise_counts
    } else {
        clients
            .iter()
            .filter_map(|client| client.server_ticks)
            .map(|st| st.count)
            .collect()
    };

    if let Some(count) = consensus_ticks(server_counts.iter().copied()) {
        let mut server_tick_counts = server_counts;
        server_tick_counts.sort_unstable();
        server_tick_counts.dedup();
        let alert =
            (server_tick_counts.len() > 1).then_some(MergeAlert::MultipleServerTickCounts {
                precise: has_precise,
                tick_counts: server_tick_counts,
            });
        let method = if has_precise {
            ReferenceMethod::PreciseServer
        } else {
            ReferenceMethod::ImpreciseServer
        };
        return (ReferenceTicks { count, method }, alert);
    }

    (
        ReferenceTicks {
            count: clients
                .iter()
                .map(|client| client.recorded_ticks)
                .max()
                .expect("clients is nonempty"),
            method: ReferenceMethod::RecordedTicks,
        },
        None,
    )
}

/// Returns the modal count in `counts` with ties broken toward the largest,
/// or `None` if `counts` is empty.
fn consensus_ticks(counts: impl IntoIterator<Item = u32>) -> Option<u32> {
    let mut frequency: BTreeMap<u32, u32> = BTreeMap::new();
    for count in counts {
        *frequency.entry(count).or_default() += 1;
    }
    let max_frequency = frequency.values().copied().max()?;
    frequency
        .iter()
        .filter(|&(_, &freq)| freq == max_frequency)
        .map(|(&ticks, _)| ticks)
        .max()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lifecycle::core::types::{ChallengeMode, ClientId, ServerTicks, StageStatus};
    use crate::merging::client_events::StageData;
    use crate::merging::fixtures;
    use crate::merging::timeline::Timeline;

    fn maiden_challenge() -> ChallengeInfo<'static> {
        static PARTY: std::sync::LazyLock<Vec<String>> =
            std::sync::LazyLock::new(|| vec!["1Ogp".to_string()]);
        fixtures::challenge_info(Stage::TobMaiden, ChallengeMode::TobRegular, &PARTY)
    }

    fn client(
        id: i64,
        accurate: bool,
        recorded_ticks: u32,
        server_ticks: Option<ServerTicks>,
    ) -> ClientEvents {
        ClientEvents {
            client_id: ClientId(id),
            metadata: None,
            primary_player: None,
            status: StageStatus::Completed,
            accurate,
            recorded_ticks,
            server_ticks,
            timeline: Timeline::new(),
            stage_data: StageData::new(Stage::TobMaiden),
            anomalies: Vec::new(),
        }
    }

    #[expect(clippy::unnecessary_wraps)]
    fn precise(count: u32) -> Option<ServerTicks> {
        Some(ServerTicks {
            count,
            precise: true,
        })
    }

    #[expect(clippy::unnecessary_wraps)]
    fn imprecise(count: u32) -> Option<ServerTicks> {
        Some(ServerTicks {
            count,
            precise: false,
        })
    }

    fn accurate(id: i64, recorded: u32) -> ClientEvents {
        client(id, true, recorded, precise(recorded))
    }

    fn inaccurate(id: i64, recorded: u32, server: Option<ServerTicks>) -> ClientEvents {
        client(id, false, recorded, server)
    }

    #[test]
    fn accuracy_tie_demotes_every_client() {
        let challenge = maiden_challenge();
        let mut clients = vec![accurate(1, 100), accurate(2, 99), inaccurate(3, 80, None)];

        let alert = demote_conflicting_accuracy(&challenge, Stage::TobMaiden, &mut clients);

        assert_eq!(
            alert,
            Some(MergeAlert::MultipleServerTickCounts {
                precise: true,
                tick_counts: vec![99, 100],
            }),
        );
        let accurate: Vec<bool> = clients.iter().map(|client| client.accurate).collect();
        assert_eq!(accurate, vec![false, false, false]);
    }

    #[test]
    fn single_accurate_mode_demotes_disagreeing_clients() {
        let challenge = maiden_challenge();
        let mut clients = vec![
            accurate(1, 100),
            accurate(2, 100),
            accurate(3, 90),
            inaccurate(4, 80, None),
        ];

        let alert = demote_conflicting_accuracy(&challenge, Stage::TobMaiden, &mut clients);

        assert_eq!(alert, None);
        let accurate: Vec<bool> = clients.iter().map(|client| client.accurate).collect();
        assert_eq!(accurate, vec![true, true, false, false]);
    }

    #[test]
    fn no_accurate_clients_does_nothing() {
        let challenge = maiden_challenge();
        let mut clients = vec![inaccurate(1, 100, None), inaccurate(2, 90, None)];

        let alert = demote_conflicting_accuracy(&challenge, Stage::TobMaiden, &mut clients);

        assert_eq!(alert, None);
        let accurate: Vec<bool> = clients.iter().map(|client| client.accurate).collect();
        assert_eq!(accurate, vec![false, false]);
    }

    #[test]
    fn reference_prefers_precise_server_counts() {
        let clients = vec![
            inaccurate(1, 11, precise(12)),
            inaccurate(2, 10, precise(10)),
            inaccurate(3, 9, imprecise(13)),
        ];

        assert_eq!(
            select_reference_ticks(&clients),
            (
                ReferenceTicks {
                    count: 12,
                    method: ReferenceMethod::PreciseServer,
                },
                Some(MergeAlert::MultipleServerTickCounts {
                    precise: true,
                    tick_counts: vec![10, 12],
                }),
            ),
        );
    }

    #[test]
    fn reference_reports_a_single_count_when_clients_agree() {
        let clients = vec![
            inaccurate(1, 50, precise(500)),
            inaccurate(2, 50, precise(500)),
        ];

        assert_eq!(
            select_reference_ticks(&clients),
            (
                ReferenceTicks {
                    count: 500,
                    method: ReferenceMethod::PreciseServer,
                },
                None,
            ),
        );
    }

    #[test]
    fn reference_falls_back_to_imprecise_server_counts() {
        let clients = vec![
            inaccurate(1, 11, imprecise(12)),
            inaccurate(2, 10, imprecise(10)),
        ];

        assert_eq!(
            select_reference_ticks(&clients),
            (
                ReferenceTicks {
                    count: 12,
                    method: ReferenceMethod::ImpreciseServer,
                },
                Some(MergeAlert::MultipleServerTickCounts {
                    precise: false,
                    tick_counts: vec![10, 12],
                }),
            ),
        );
    }

    #[test]
    fn reference_falls_back_to_the_longest_recording() {
        let clients = vec![inaccurate(1, 11, None), inaccurate(2, 10, None)];

        assert_eq!(
            select_reference_ticks(&clients),
            (
                ReferenceTicks {
                    count: 11,
                    method: ReferenceMethod::RecordedTicks,
                },
                None,
            ),
        );
    }

    #[test]
    fn reference_takes_the_consensus_rather_than_the_maximum() {
        let clients = vec![
            inaccurate(1, 50, imprecise(90)),
            inaccurate(2, 50, imprecise(90)),
            inaccurate(3, 50, imprecise(95)),
        ];

        assert_eq!(
            select_reference_ticks(&clients),
            (
                ReferenceTicks {
                    count: 90,
                    method: ReferenceMethod::ImpreciseServer,
                },
                Some(MergeAlert::MultipleServerTickCounts {
                    precise: false,
                    tick_counts: vec![90, 95],
                }),
            ),
        );
    }

    #[test]
    fn reference_ignores_clients_without_server_counts() {
        let clients = vec![
            inaccurate(1, 11, imprecise(11)),
            inaccurate(2, 9, imprecise(9)),
            inaccurate(3, 11, imprecise(11)),
            inaccurate(4, 11, None),
        ];

        assert_eq!(
            select_reference_ticks(&clients),
            (
                ReferenceTicks {
                    count: 11,
                    method: ReferenceMethod::ImpreciseServer,
                },
                Some(MergeAlert::MultipleServerTickCounts {
                    precise: false,
                    tick_counts: vec![9, 11],
                }),
            ),
        );
    }

    #[test]
    fn classify_picks_a_single_client_as_the_base() {
        let challenge = maiden_challenge();

        let cases = [
            (
                accurate(1, 10),
                ReferenceTicks {
                    count: 10,
                    method: ReferenceMethod::AccurateModal,
                },
            ),
            (
                inaccurate(1, 10, precise(10)),
                ReferenceTicks {
                    count: 10,
                    method: ReferenceMethod::PreciseServer,
                },
            ),
            (
                inaccurate(1, 10, imprecise(10)),
                ReferenceTicks {
                    count: 10,
                    method: ReferenceMethod::ImpreciseServer,
                },
            ),
            (
                inaccurate(1, 10, None),
                ReferenceTicks {
                    count: 10,
                    method: ReferenceMethod::RecordedTicks,
                },
            ),
        ];

        for (client, reference_ticks) in cases {
            let mut clients = vec![client];
            let classification = classify_clients(&challenge, Stage::TobMaiden, &mut clients);
            assert_eq!(
                classification,
                ClientClassification {
                    base: 0,
                    matching: vec![],
                    mismatched: vec![],
                    reference_ticks,
                    alert: None,
                },
            );
        }
    }

    #[test]
    fn classify_prefers_an_accurate_client() {
        let challenge = maiden_challenge();
        let mut clients = vec![
            accurate(1, 10),
            accurate(2, 10),
            inaccurate(3, 9, imprecise(9)),
        ];

        let classification = classify_clients(&challenge, Stage::TobMaiden, &mut clients);

        assert_eq!(
            classification,
            ClientClassification {
                base: 0,
                matching: vec![1],
                mismatched: vec![2],
                reference_ticks: ReferenceTicks {
                    count: 10,
                    method: ReferenceMethod::AccurateModal,
                },
                alert: None,
            },
        );
    }

    #[test]
    fn classify_breaks_base_ties_with_the_lowest_client_id() {
        let challenge = maiden_challenge();
        let mut clients = vec![accurate(2, 10), accurate(1, 10), accurate(3, 10)];

        let classification = classify_clients(&challenge, Stage::TobMaiden, &mut clients);

        assert_eq!(
            classification,
            ClientClassification {
                base: 1,
                matching: vec![0, 2],
                mismatched: vec![],
                reference_ticks: ReferenceTicks {
                    count: 10,
                    method: ReferenceMethod::AccurateModal,
                },
                alert: None,
            },
        );
    }

    #[test]
    fn classify_chooses_the_highest_tick_count_in_a_multi_modal_scenario() {
        let challenge = maiden_challenge();
        let mut clients = vec![
            accurate(1, 100),
            accurate(2, 100),
            accurate(3, 101),
            accurate(4, 101),
            accurate(5, 99),
        ];

        let classification = classify_clients(&challenge, Stage::TobMaiden, &mut clients);

        assert_eq!(
            classification,
            ClientClassification {
                base: 2,
                matching: vec![],
                mismatched: vec![0, 1, 3, 4],
                reference_ticks: ReferenceTicks {
                    count: 101,
                    method: ReferenceMethod::PreciseServer,
                },
                alert: Some(MergeAlert::MultipleServerTickCounts {
                    precise: true,
                    tick_counts: vec![100, 101],
                }),
            },
        );
        let accurate: Vec<bool> = clients.iter().map(|client| client.accurate).collect();
        assert_eq!(accurate, vec![false, false, false, false, false]);
    }

    #[test]
    fn classify_selects_the_base_independently_of_the_reference_count() {
        let challenge = maiden_challenge();
        let mut clients = vec![
            inaccurate(1, 25, precise(270)),
            inaccurate(2, 270, imprecise(270)),
        ];
        clients[1].primary_player = Some("1Ogp".to_string());

        let classification = classify_clients(&challenge, Stage::TobMaiden, &mut clients);

        assert_eq!(
            classification,
            ClientClassification {
                base: 1,
                matching: vec![],
                mismatched: vec![0],
                reference_ticks: ReferenceTicks {
                    count: 270,
                    method: ReferenceMethod::PreciseServer,
                },
                alert: None,
            },
        );
    }

    #[test]
    fn classify_prioritizes_a_participant() {
        let challenge = maiden_challenge();
        let mut clients = vec![inaccurate(1, 100, None), inaccurate(2, 100, None)];
        clients[1].primary_player = Some("1Ogp".to_string());

        let classification = classify_clients(&challenge, Stage::TobMaiden, &mut clients);

        assert_eq!(
            classification,
            ClientClassification {
                base: 1,
                matching: vec![],
                mismatched: vec![0],
                reference_ticks: ReferenceTicks {
                    count: 100,
                    method: ReferenceMethod::RecordedTicks,
                },
                alert: None,
            },
        );
    }

    #[test]
    fn classify_flags_disagreeing_server_tick_counts() {
        let challenge = maiden_challenge();
        let mut clients = vec![inaccurate(1, 1, precise(1)), inaccurate(2, 1, precise(2))];

        let classification = classify_clients(&challenge, Stage::TobMaiden, &mut clients);

        assert_eq!(
            classification,
            ClientClassification {
                base: 0,
                matching: vec![],
                mismatched: vec![1],
                reference_ticks: ReferenceTicks {
                    count: 2,
                    method: ReferenceMethod::PreciseServer,
                },
                alert: Some(MergeAlert::MultipleServerTickCounts {
                    precise: true,
                    tick_counts: vec![1, 2],
                }),
            },
        );
    }
}
