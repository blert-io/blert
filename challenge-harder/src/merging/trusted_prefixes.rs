//! Computation of trust bounds for a merged timeline.

use std::collections::{BTreeMap, BTreeSet};

use crate::lifecycle::core::types::ClientId;

use super::classification::ReferenceMethod;
use super::client_consistency::ConsistencyIssue;
use super::mapping::MergeMapping;
use super::{MergeContext, MergeStatus, RegisteredClient, Tick, Ticks};

#[derive(Debug)]
pub(super) struct TimelineInfo {
    /// Final tick of the merged timeline.
    pub last_tick: Tick,
    /// Leading offset applied by end alignment.
    pub offset: Ticks,
    /// Whether the merged output inherited accuracy from an accurate base.
    pub inherited_accuracy: bool,
    /// How the stage's reference tick count was selected.
    pub reference_method: ReferenceMethod,
}

/// The two trust prefixes of a merged timeline.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct TrustedPrefixes {
    /// The exclusive tick at which the merged timeline can no longer be
    /// trusted to match the true server tick count.
    pub accurate_until: Tick,
    /// The exclusive tick at which the merged event stream can no longer be
    /// trusted for strict analysis.
    pub queryable_until: Tick,
}

#[derive(Debug)]
struct Contributor {
    id: ClientId,
    /// Earliest local tick on which the client detected a consistency issue.
    first_issue_tick: Option<Tick>,
    // Note: always `None` because there are no current game corrections.
    first_correction_tick: Option<Tick>,
    participant: bool,
}

/// What the contributors corroborate on a single tick.
struct TickSupport {
    /// Number of internally contiguous clients contributing to this tick.
    contiguous_count: u32,
    /// Subset of internally contiguous clients without game corrections.
    clean_count: u32,
    /// Whether any contiguous contributor is a participant.
    has_participant: bool,
    /// Whether any contributor's data was contested by other clients.
    contested: bool,
}

impl TickSupport {
    fn none() -> Self {
        Self {
            contiguous_count: 0,
            clean_count: 0,
            has_participant: false,
            contested: false,
        }
    }
}

fn collect_contributors(ctx: &MergeContext) -> Vec<Contributor> {
    let mut contributors = Vec::new();
    for RegisteredClient { client, status } in &ctx.clients {
        if !matches!(status, MergeStatus::Merged(_)) {
            continue;
        }
        contributors.push(Contributor {
            id: client.info.id,
            first_issue_tick: client
                .consistency_issues
                .iter()
                .map(ConsistencyIssue::tick)
                .min(),
            first_correction_tick: None,
            participant: client.is_participant(),
        });
    }
    contributors
}

/// Resolves what the contributors corroborate on a single tick.
fn support_at_tick(
    merged_tick: Tick,
    contributors: &[Contributor],
    mapping: &MergeMapping,
    contested_clients: &BTreeMap<ClientId, BTreeSet<Tick>>,
) -> TickSupport {
    let mut contiguous_count = 0;
    let mut clean_count = 0;
    let mut has_participant = false;
    let mut contested = false;

    for contributor in contributors {
        let Some(local_tick) = mapping.resolve_client_tick(merged_tick, contributor.id) else {
            continue;
        };

        if contested_clients
            .get(&contributor.id)
            .is_some_and(|ticks| ticks.contains(&local_tick))
        {
            contested = true;
        }

        if contributor
            .first_issue_tick
            .is_none_or(|tick| tick > local_tick)
        {
            contiguous_count += 1;
            if contributor.participant {
                has_participant = true;
            }
            if contributor
                .first_correction_tick
                .is_none_or(|tick| tick > local_tick)
            {
                clean_count += 1;
            }
        }
    }

    TickSupport {
        contiguous_count,
        clean_count,
        has_participant,
        contested,
    }
}

/// Computes the accurate and queryable prefixes of a merged timeline.
pub(super) fn compute_trusted_prefixes(ctx: &MergeContext, info: &TimelineInfo) -> TrustedPrefixes {
    let contributors = collect_contributors(ctx);

    let mut accurate_until = info.inherited_accuracy.then_some(info.last_tick.succ());
    let mut queryable_until = None;

    // A precise server count whose length the timeline matches exactly proves
    // the timeline spans server tick 0 to the end.
    let known_to_start_at_zero =
        info.offset == 0 && matches!(info.reference_method, ReferenceMethod::PreciseServer);

    let offset_tick = Tick::at(info.offset);
    for m in info.last_tick.up_to_inclusive() {
        let support = if m >= offset_tick {
            support_at_tick(
                m - info.offset,
                &contributors,
                &ctx.mapping,
                &ctx.contested_ticks,
            )
        } else {
            TickSupport::none()
        };

        // `accurate_until` requires at least two internally contiguous clients,
        // with either one participant or a server-verified tick 0.
        let lacks_sufficient_contributors =
            support.contiguous_count < 2 || !(support.has_participant || known_to_start_at_zero);

        if accurate_until.is_none() && lacks_sufficient_contributors {
            accurate_until = Some(m);
        }

        if queryable_until.is_none() {
            let has_timing_issues = !info.inherited_accuracy && lacks_sufficient_contributors;
            let too_few_clean_clients = support.clean_count < support.contiguous_count.min(2);
            let has_data_issues = support.contested || too_few_clean_clients;
            if has_timing_issues || has_data_issues {
                queryable_until = Some(m);
            }
        }

        if accurate_until.is_some() && queryable_until.is_some() {
            break;
        }
    }

    TrustedPrefixes {
        accurate_until: accurate_until.unwrap_or(info.last_tick.succ()),
        queryable_until: queryable_until.unwrap_or(info.last_tick.succ()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lifecycle::core::types::{ChallengeMode, Stage};
    use crate::merging::alignment::AlignmentEntry;
    use crate::merging::mapping::TickMapping;
    use crate::merging::{ChallengeInfo, fixtures};

    static PARTY: std::sync::LazyLock<Vec<String>> =
        std::sync::LazyLock::new(|| vec!["1Ogp".to_string(), "WWWWWWWWWWQQ".to_string()]);

    fn challenge_for(stage: Stage, mode: ChallengeMode) -> ChallengeInfo<'static> {
        fixtures::challenge_info(stage, mode, &PARTY)
    }

    fn commit_mapping_step(
        ctx: &mut MergeContext,
        timeline_last_tick: Tick,
        client_id: ClientId,
        client_last_tick: Tick,
    ) {
        let entries = vec![
            (0..=client_last_tick.as_usize())
                .map(|index| AlignmentEntry::Merge {
                    base_index: index,
                    target_index: index,
                    score: 1.0,
                })
                .collect(),
        ];
        ctx.mapping.begin(
            client_id,
            TickMapping::from_alignment(timeline_last_tick, client_last_tick, &entries),
        );
        ctx.mapping.commit();
    }

    #[test]
    fn inherited_accuracy_spans_the_full_timeline_ignoring_coverage() {
        const LAST_TICK: Tick = Tick(9);
        let challenge = challenge_for(Stage::TobMaiden, ChallengeMode::TobRegular);
        let mut ctx = fixtures::merge_context(&challenge, Stage::TobMaiden)
            .client(
                fixtures::ClientBuilder::new(1, Stage::TobMaiden, LAST_TICK)
                    .primary_player(&PARTY[0])
                    .build(),
            )
            .client(
                fixtures::ClientBuilder::new(2, Stage::TobMaiden, LAST_TICK)
                    .primary_player(&PARTY[1])
                    .build(),
            )
            .build();
        commit_mapping_step(&mut ctx, LAST_TICK, ClientId(2), Tick(5));

        assert_eq!(
            compute_trusted_prefixes(
                &ctx,
                &TimelineInfo {
                    last_tick: LAST_TICK,
                    offset: Ticks(0),
                    inherited_accuracy: true,
                    reference_method: ReferenceMethod::AccurateModal,
                },
            ),
            TrustedPrefixes {
                accurate_until: Tick(10),
                queryable_until: Tick(10),
            },
        );
    }

    #[test]
    fn two_clients_viewing_the_full_timeline_promote_it() {
        const LAST_TICK: Tick = Tick(9);
        let challenge = challenge_for(Stage::TobMaiden, ChallengeMode::TobRegular);
        let mut ctx = fixtures::merge_context(&challenge, Stage::TobMaiden)
            .client(
                fixtures::ClientBuilder::new(1, Stage::TobMaiden, LAST_TICK)
                    .primary_player(&PARTY[0])
                    .build(),
            )
            .client(
                fixtures::ClientBuilder::new(2, Stage::TobMaiden, LAST_TICK)
                    .primary_player(&PARTY[1])
                    .build(),
            )
            .build();
        commit_mapping_step(&mut ctx, LAST_TICK, ClientId(2), LAST_TICK);

        assert_eq!(
            compute_trusted_prefixes(
                &ctx,
                &TimelineInfo {
                    last_tick: LAST_TICK,
                    offset: Ticks(0),
                    inherited_accuracy: false,
                    reference_method: ReferenceMethod::RecordedTicks,
                },
            ),
            TrustedPrefixes {
                accurate_until: Tick(10),
                queryable_until: Tick(10),
            },
        );
    }

    #[test]
    fn accuracy_ends_where_there_are_fewer_than_two_clients() {
        const LAST_TICK: Tick = Tick(9);
        let challenge = challenge_for(Stage::TobMaiden, ChallengeMode::TobRegular);
        let mut ctx = fixtures::merge_context(&challenge, Stage::TobMaiden)
            .client(
                fixtures::ClientBuilder::new(1, Stage::TobMaiden, LAST_TICK)
                    .primary_player(&PARTY[0])
                    .build(),
            )
            .client(
                fixtures::ClientBuilder::new(2, Stage::TobMaiden, LAST_TICK)
                    .primary_player(&PARTY[1])
                    .build(),
            )
            .build();
        commit_mapping_step(&mut ctx, LAST_TICK, ClientId(2), Tick(3));

        assert_eq!(
            compute_trusted_prefixes(
                &ctx,
                &TimelineInfo {
                    last_tick: LAST_TICK,
                    offset: Ticks(0),
                    inherited_accuracy: false,
                    reference_method: ReferenceMethod::RecordedTicks,
                },
            ),
            TrustedPrefixes {
                accurate_until: Tick(4),
                queryable_until: Tick(4),
            },
        );
    }

    #[test]
    fn a_single_client_timeline_cannot_be_promoted() {
        const LAST_TICK: Tick = Tick(9);
        let challenge = challenge_for(Stage::TobMaiden, ChallengeMode::TobRegular);
        let ctx = fixtures::merge_context(&challenge, Stage::TobMaiden)
            .client(
                fixtures::ClientBuilder::new(1, Stage::TobMaiden, LAST_TICK)
                    .primary_player(&PARTY[0])
                    .build(),
            )
            .build();

        assert_eq!(
            compute_trusted_prefixes(
                &ctx,
                &TimelineInfo {
                    last_tick: LAST_TICK,
                    offset: Ticks(0),
                    inherited_accuracy: false,
                    reference_method: ReferenceMethod::RecordedTicks,
                },
            ),
            TrustedPrefixes {
                accurate_until: Tick(0),
                queryable_until: Tick(0),
            },
        );
    }

    #[test]
    fn spectators_cannot_promote_a_timeline_without_server_ticks() {
        const LAST_TICK: Tick = Tick(9);
        let challenge = challenge_for(Stage::TobMaiden, ChallengeMode::TobRegular);
        let mut ctx = fixtures::merge_context(&challenge, Stage::TobMaiden)
            .client(fixtures::ClientBuilder::new(1, Stage::TobMaiden, LAST_TICK).build())
            .client(fixtures::ClientBuilder::new(2, Stage::TobMaiden, LAST_TICK).build())
            .build();
        commit_mapping_step(&mut ctx, LAST_TICK, ClientId(2), LAST_TICK);

        assert_eq!(
            compute_trusted_prefixes(
                &ctx,
                &TimelineInfo {
                    last_tick: LAST_TICK,
                    offset: Ticks(0),
                    inherited_accuracy: false,
                    reference_method: ReferenceMethod::RecordedTicks,
                },
            ),
            TrustedPrefixes {
                accurate_until: Tick(0),
                queryable_until: Tick(0),
            },
        );
    }

    #[test]
    fn spectators_can_promote_a_timeline_with_a_precise_server_count_and_zero_offset() {
        const LAST_TICK: Tick = Tick(9);
        let challenge = challenge_for(Stage::TobMaiden, ChallengeMode::TobRegular);
        let mut ctx = fixtures::merge_context(&challenge, Stage::TobMaiden)
            .client(fixtures::ClientBuilder::new(1, Stage::TobMaiden, LAST_TICK).build())
            .client(fixtures::ClientBuilder::new(2, Stage::TobMaiden, LAST_TICK).build())
            .build();
        commit_mapping_step(&mut ctx, LAST_TICK, ClientId(2), LAST_TICK);

        let info = |method: ReferenceMethod, offset: Ticks| TimelineInfo {
            last_tick: LAST_TICK,
            offset,
            inherited_accuracy: false,
            reference_method: method,
        };

        assert_eq!(
            compute_trusted_prefixes(&ctx, &info(ReferenceMethod::PreciseServer, Ticks(0))),
            TrustedPrefixes {
                accurate_until: Tick(10),
                queryable_until: Tick(10),
            },
        );

        assert_eq!(
            compute_trusted_prefixes(&ctx, &info(ReferenceMethod::ImpreciseServer, Ticks(0))),
            TrustedPrefixes {
                accurate_until: Tick(0),
                queryable_until: Tick(0),
            },
        );

        assert_eq!(
            compute_trusted_prefixes(&ctx, &info(ReferenceMethod::PreciseServer, Ticks(1))),
            TrustedPrefixes {
                accurate_until: Tick(0),
                queryable_until: Tick(0),
            },
        );
    }

    #[test]
    fn accuracy_ends_at_a_client_consistency_issue() {
        const LAST_TICK: Tick = Tick(9);
        let challenge = challenge_for(Stage::TobMaiden, ChallengeMode::TobRegular);
        let mut ctx = fixtures::merge_context(&challenge, Stage::TobMaiden)
            .client(
                fixtures::ClientBuilder::new(1, Stage::TobMaiden, LAST_TICK)
                    .primary_player(&PARTY[0])
                    .build(),
            )
            .client(
                fixtures::ClientBuilder::new(2, Stage::TobMaiden, LAST_TICK)
                    .primary_player(&PARTY[1])
                    .consistency_issue(ConsistencyIssue::LargeJump {
                        player: PARTY[1].clone(),
                        tick: Tick(4),
                        last_tick: Tick(3),
                        start: (3168, 4436).into(),
                        end: (3184, 4450).into(),
                    })
                    .build(),
            )
            .build();
        commit_mapping_step(&mut ctx, LAST_TICK, ClientId(2), LAST_TICK);

        assert_eq!(
            compute_trusted_prefixes(
                &ctx,
                &TimelineInfo {
                    last_tick: LAST_TICK,
                    offset: Ticks(0),
                    inherited_accuracy: false,
                    reference_method: ReferenceMethod::RecordedTicks,
                },
            ),
            TrustedPrefixes {
                accurate_until: Tick(4),
                queryable_until: Tick(4),
            },
        );
    }

    #[test]
    fn queryable_ends_at_a_contested_tick() {
        const LAST_TICK: Tick = Tick(9);
        let challenge = challenge_for(Stage::TobMaiden, ChallengeMode::TobRegular);
        let mut ctx = fixtures::merge_context(&challenge, Stage::TobMaiden)
            .client(
                fixtures::ClientBuilder::new(1, Stage::TobMaiden, LAST_TICK)
                    .primary_player(&PARTY[0])
                    .build(),
            )
            .build();
        ctx.contested_ticks
            .insert(ClientId(1), BTreeSet::from([Tick(6)]));

        assert_eq!(
            compute_trusted_prefixes(
                &ctx,
                &TimelineInfo {
                    last_tick: LAST_TICK,
                    offset: Ticks(0),
                    inherited_accuracy: true,
                    reference_method: ReferenceMethod::AccurateModal,
                },
            ),
            TrustedPrefixes {
                accurate_until: Tick(10),
                queryable_until: Tick(6),
            },
        );
    }

    #[test]
    fn queryable_ends_at_a_contested_tick_before_coverage_loss() {
        const LAST_TICK: Tick = Tick(9);
        let challenge = challenge_for(Stage::TobMaiden, ChallengeMode::TobRegular);
        let mut ctx = fixtures::merge_context(&challenge, Stage::TobMaiden)
            .client(
                fixtures::ClientBuilder::new(1, Stage::TobMaiden, LAST_TICK)
                    .primary_player(&PARTY[0])
                    .build(),
            )
            .client(
                fixtures::ClientBuilder::new(2, Stage::TobMaiden, LAST_TICK)
                    .primary_player(&PARTY[1])
                    .build(),
            )
            .build();
        commit_mapping_step(&mut ctx, LAST_TICK, ClientId(2), Tick(6));
        ctx.contested_ticks
            .insert(ClientId(1), BTreeSet::from([Tick(3)]));

        assert_eq!(
            compute_trusted_prefixes(
                &ctx,
                &TimelineInfo {
                    last_tick: LAST_TICK,
                    offset: Ticks(0),
                    inherited_accuracy: false,
                    reference_method: ReferenceMethod::RecordedTicks,
                },
            ),
            TrustedPrefixes {
                accurate_until: Tick(7),
                queryable_until: Tick(3),
            },
        );
    }
}
