//! Blob storage for challenge data files.
//!
//! Matches `DataRepository` in `//common/data-repository/data-repository.ts`,
//! which defines the layout that the web app reads.

#![cfg_attr(not(test), expect(dead_code))]

use futures_util::stream::BoxStream;
use prost::Message;

use crate::lifecycle::core::types::{Stage, Uuid};
use crate::proto::{ChallengeData, ChallengeEvents, Event, event};

mod fs;
mod s3;

pub use fs::FilesystemBackend;
pub use s3::S3Backend;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("no data file for stage {0:?}")]
    UnsupportedStage(Stage),
    #[error("no challenge data found for {0}")]
    NotFound(String),
    #[error("backend operation failed: {0}")]
    Backend(String),
    #[error("stored data failed to decode: {0}")]
    Decode(#[from] prost::DecodeError),
}

/// Raw storage backing the repository. Addressed by paths relative to its root.
#[async_trait::async_trait]
pub trait Backend: Send + Sync {
    /// Reads the contents of a file.
    async fn read(&self, path: &str) -> Result<Vec<u8>, Error>;

    /// Writes to a file.
    async fn write(&self, path: &str, data: &[u8]) -> Result<(), Error>;

    /// Deletes a file, succeeding if it doesn't exist.
    async fn delete_file(&self, path: &str) -> Result<(), Error>;

    /// Recursively deletes the directory at `path`, if it exists.
    async fn delete_dir(&self, path: &str) -> Result<(), Error>;

    /// Recursively lists the files under `path`.
    fn list_dir(&self, path: &str) -> BoxStream<'_, Result<String, Error>>;
}

/// Stores and retrieves a challenge's data files through a [`Backend`].
pub struct DataRepository {
    backend: Box<dyn Backend>,
}

impl DataRepository {
    const CHALLENGE_FILE: &'static str = "challenge";

    pub fn new(backend: Box<dyn Backend>) -> Self {
        Self { backend }
    }

    /// Creates a data repository from a URI, supporting two schemes:
    ///
    /// - `file://path/to/root/` for local filesystem storage
    /// - `s3://bucket` for S3-compatible storage
    ///
    pub async fn from_uri(uri: &str) -> Result<Self, Error> {
        if let Some(root) = uri.strip_prefix("file://") {
            Ok(Self::new(Box::new(FilesystemBackend::new(root.into()))))
        } else if let Some(bucket) = uri.strip_prefix("s3://") {
            Ok(Self::new(Box::new(
                S3Backend::from_env(bucket.into()).await,
            )))
        } else {
            Err(Error::Backend(format!("unsupported repository uri {uri}")))
        }
    }

    pub async fn load_challenge(&self, uuid: Uuid) -> Result<ChallengeData, Error> {
        let data = self
            .backend
            .read(&relative_path(uuid, Self::CHALLENGE_FILE))
            .await?;
        Ok(ChallengeData::decode(data.as_slice())?)
    }

    pub async fn save_challenge(&self, uuid: Uuid, data: &ChallengeData) -> Result<(), Error> {
        self.backend
            .write(
                &relative_path(uuid, Self::CHALLENGE_FILE),
                &data.encode_to_vec(),
            )
            .await
    }

    /// Deletes every stored file of the challenge.
    pub async fn delete_challenge(&self, uuid: Uuid) -> Result<(), Error> {
        self.backend.delete_dir(&relative_dir(uuid)).await
    }

    /// Stores a stage's events.
    pub async fn save_stage_events(
        &self,
        uuid: Uuid,
        stage: Stage,
        attempt: Option<u32>,
        party: &[String],
        mut events: Vec<Event>,
    ) -> Result<(), Error> {
        let party_index = |name: &str| {
            party
                .iter()
                .position(|p| p == name)
                .map(|i| u32::try_from(i).expect("party index fits in a u32"))
        };

        for event in &mut events {
            // Legacy, never set, but clear it just in case.
            event.challenge_id = String::new();

            if let Some(player) = &mut event.player
                && let Some(index) = party_index(&player.name)
            {
                player.party_index = index;
                player.name = String::new();
            }

            // NPC attack targets are stored as a player party index.
            if event.r#type() == event::Type::NpcAttack
                && let Some(npc_attack) = &mut event.npc_attack
                && let Some(target) = npc_attack.target.take()
            {
                let mut player = event::Player::default();
                if let Some(index) = party_index(&target) {
                    player.party_index = index;
                }
                event.player = Some(player);
            }
        }

        let contents = ChallengeEvents {
            events,
            stage: stage as i32,
            party_names: party.to_vec(),
        };
        self.backend
            .write(
                &relative_path(uuid, &file_for_stage(stage, attempt)?),
                &contents.encode_to_vec(),
            )
            .await
    }

    /// Loads events for a stage.
    pub async fn load_stage_events(
        &self,
        uuid: Uuid,
        stage: Stage,
        attempt: Option<u32>,
    ) -> Result<Vec<Event>, Error> {
        let data = self
            .backend
            .read(&relative_path(uuid, &file_for_stage(stage, attempt)?))
            .await?;
        let contents = ChallengeEvents::decode(data.as_slice())?;

        let party = contents.party_names;
        let mut events = contents.events;
        for event in &mut events {
            if let Some(player) = &mut event.player
                && player.name.is_empty()
            {
                player.name = party
                    .get(player.party_index as usize)
                    .cloned()
                    .unwrap_or_default();
            }

            if event.r#type() == event::Type::NpcAttack
                && let Some(player) = event.player.take()
                && let Some(npc_attack) = &mut event.npc_attack
            {
                npc_attack.target = Some(player.name);
            }
        }
        Ok(events)
    }
}

/// Returns the path to a challenge file relative to the repository root.
fn relative_path(uuid: Uuid, file: &str) -> String {
    format!("{}/{file}", relative_dir(uuid))
}

/// Returns the path to a challenge's directory relative to the repository root.
fn relative_dir(uuid: Uuid) -> String {
    let uuid = uuid.to_string();
    format!("{}/{}", &uuid[0..2], uuid.replace('-', ""))
}

/// Returns the basename of the file storing a stage's events.
fn file_for_stage(stage: Stage, attempt: Option<u32>) -> Result<String, Error> {
    let name = match stage {
        Stage::TobMaiden => "maiden".into(),
        Stage::TobBloat => "bloat".into(),
        Stage::TobNylocas => "nylocas".into(),
        Stage::TobSotetseg => "sotetseg".into(),
        Stage::TobXarpus => "xarpus".into(),
        Stage::TobVerzik => "verzik".into(),
        Stage::MokhaiotlDelve8plus => "delve-8plus".into(),
        stage => {
            let value = stage as i32;
            match value {
                50..=57 => format!("delve-{}", value - Stage::MokhaiotlDelve1 as i32 + 1),
                100..=111 => format!("wave-{}", value - Stage::ColosseumWave1 as i32 + 1),
                200..=268 => format!("wave-{}", value - Stage::InfernoWave1 as i32 + 1),
                _ => return Err(Error::UnsupportedStage(stage)),
            }
        }
    };
    Ok(match attempt {
        Some(attempt) => format!("{name}:{attempt}"),
        None => name,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::proto::challenge_data;

    #[test]
    fn relative_paths_match_the_data_repository() {
        let uuid = Uuid::try_parse("d6a81e14-5f9a-4314-91d2-16eaee45b1d0").unwrap();
        assert_eq!(relative_dir(uuid), "d6/d6a81e145f9a431491d216eaee45b1d0");
        assert_eq!(
            relative_path(uuid, "challenge"),
            "d6/d6a81e145f9a431491d216eaee45b1d0/challenge",
        );
    }

    #[test]
    fn stage_file_names_match_the_data_repository() {
        let cases = [
            (Stage::TobMaiden, "maiden"),
            (Stage::TobBloat, "bloat"),
            (Stage::TobNylocas, "nylocas"),
            (Stage::TobSotetseg, "sotetseg"),
            (Stage::TobXarpus, "xarpus"),
            (Stage::TobVerzik, "verzik"),
            (Stage::ColosseumWave1, "wave-1"),
            (Stage::ColosseumWave12, "wave-12"),
            (Stage::InfernoWave1, "wave-1"),
            (Stage::InfernoWave69, "wave-69"),
            (Stage::MokhaiotlDelve1, "delve-1"),
            (Stage::MokhaiotlDelve8, "delve-8"),
            (Stage::MokhaiotlDelve8plus, "delve-8plus"),
        ];
        for (stage, expected) in cases {
            assert_eq!(file_for_stage(stage, None).unwrap(), expected, "{stage:?}");
        }

        assert_eq!(
            file_for_stage(Stage::MokhaiotlDelve8plus, Some(4)).unwrap(),
            "delve-8plus:4",
        );
    }

    #[test]
    fn stages_without_data_files_are_errors() {
        for stage in [Stage::UnknownStage, Stage::CoxTekton, Stage::ToaWardens] {
            assert!(matches!(
                file_for_stage(stage, None),
                Err(Error::UnsupportedStage(s)) if s == stage,
            ));
        }
    }

    const UUID: &str = "d6a81e14-5f9a-4314-91d2-16eaee45b1d0";

    fn repository(dir: &tempfile::TempDir) -> DataRepository {
        DataRepository::new(Box::new(FilesystemBackend::new(dir.path().to_path_buf())))
    }

    fn events() -> Vec<Event> {
        vec![
            Event {
                r#type: event::Type::PlayerUpdate as i32,
                stage: Stage::TobMaiden as i32,
                tick: 19,
                player: Some(event::Player {
                    name: "WWWWWWWWWWQQ".into(),
                    ..Default::default()
                }),
                ..Default::default()
            },
            Event {
                r#type: event::Type::PlayerUpdate as i32,
                stage: Stage::TobMaiden as i32,
                tick: 19,
                player: Some(event::Player {
                    name: "1Ogp".into(),
                    ..Default::default()
                }),
                ..Default::default()
            },
            Event {
                r#type: event::Type::NpcUpdate as i32,
                stage: Stage::TobMaiden as i32,
                tick: 19,
                npc: Some(event::Npc {
                    id: 8360,
                    room_id: 42683,
                    hitpoints: 162_531_905,
                    ..Default::default()
                }),
                ..Default::default()
            },
            Event {
                r#type: event::Type::NpcAttack as i32,
                stage: Stage::TobMaiden as i32,
                tick: 19,
                npc_attack: Some(event::NpcAttacked {
                    target: Some("1Ogp".into()),
                    ..Default::default()
                }),
                ..Default::default()
            },
        ]
    }

    #[tokio::test]
    async fn from_uri_selects_the_backend() {
        let dir = tempfile::tempdir().unwrap();
        let uri = format!("file://{}", dir.path().display());
        let repository = DataRepository::from_uri(&uri).await.unwrap();

        let uuid = Uuid::try_parse(UUID).unwrap();
        let data = ChallengeData::default();
        repository.save_challenge(uuid, &data).await.unwrap();
        assert_eq!(repository.load_challenge(uuid).await.unwrap(), data);

        assert!(matches!(
            DataRepository::from_uri("gopher://challenges").await,
            Err(Error::Backend(_)),
        ));
    }

    #[tokio::test]
    async fn challenge_files_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let repository = repository(&dir);
        let uuid = Uuid::try_parse(UUID).unwrap();

        assert!(matches!(
            repository.load_challenge(uuid).await,
            Err(Error::NotFound(_)),
        ));

        let data = ChallengeData {
            challenge_id: UUID.into(),
            stage_data: Some(challenge_data::StageData::TobRooms(
                challenge_data::TobRooms {
                    maiden: Some(challenge_data::TobRoom {
                        stage: Stage::TobMaiden as i32,
                        ticks_lost: 3,
                        deaths: vec!["1Ogp".into()],
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            )),
        };
        repository.save_challenge(uuid, &data).await.unwrap();
        assert_eq!(repository.load_challenge(uuid).await.unwrap(), data);
    }

    #[tokio::test]
    async fn stage_events_are_stored_at_rest_and_restored_to_wire_format() {
        let dir = tempfile::tempdir().unwrap();
        let repository = repository(&dir);
        let uuid = Uuid::try_parse(UUID).unwrap();
        let party = vec!["1Ogp".to_string(), "WWWWWWWWWWQQ".to_string()];

        repository
            .save_stage_events(uuid, Stage::TobMaiden, None, &party, events())
            .await
            .unwrap();

        // The stored artifact holds the at-rest form, with party members
        // reduced to indices and NPC events untouched.
        let raw = repository
            .backend
            .read(&format!("{}/maiden", relative_dir(uuid)))
            .await
            .unwrap();
        let stored = ChallengeEvents::decode(raw.as_slice()).unwrap();
        assert_eq!(stored.stage, Stage::TobMaiden as i32);
        assert_eq!(stored.party_names, party);
        assert_eq!(
            stored.events,
            vec![
                Event {
                    r#type: event::Type::PlayerUpdate as i32,
                    stage: Stage::TobMaiden as i32,
                    tick: 19,
                    player: Some(event::Player {
                        party_index: 1,
                        ..Default::default()
                    }),
                    ..Default::default()
                },
                Event {
                    r#type: event::Type::PlayerUpdate as i32,
                    stage: Stage::TobMaiden as i32,
                    tick: 19,
                    player: Some(event::Player {
                        party_index: 0,
                        ..Default::default()
                    }),
                    ..Default::default()
                },
                Event {
                    r#type: event::Type::NpcUpdate as i32,
                    stage: Stage::TobMaiden as i32,
                    tick: 19,
                    npc: Some(event::Npc {
                        id: 8360,
                        room_id: 42683,
                        hitpoints: 162_531_905,
                        ..Default::default()
                    }),
                    ..Default::default()
                },
                Event {
                    r#type: event::Type::NpcAttack as i32,
                    stage: Stage::TobMaiden as i32,
                    tick: 19,
                    npc_attack: Some(event::NpcAttacked::default()),
                    player: Some(event::Player {
                        party_index: 0,
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            ],
        );

        // Loading restores player names but keeps the stored party indices.
        let mut expected = events();
        expected[0].player.as_mut().unwrap().party_index = 1;
        let loaded = repository
            .load_stage_events(uuid, Stage::TobMaiden, None)
            .await
            .unwrap();
        assert_eq!(loaded, expected);
    }

    #[tokio::test]
    async fn delete_challenge_removes_every_file() {
        let dir = tempfile::tempdir().unwrap();
        let repository = repository(&dir);
        let uuid = Uuid::try_parse(UUID).unwrap();
        let party = vec!["1Ogp".to_string(), "WWWWWWWWWWQQ".to_string()];

        repository
            .save_challenge(uuid, &ChallengeData::default())
            .await
            .unwrap();
        repository
            .save_stage_events(uuid, Stage::TobMaiden, None, &party, events())
            .await
            .unwrap();

        repository.delete_challenge(uuid).await.unwrap();
        assert!(matches!(
            repository.load_challenge(uuid).await,
            Err(Error::NotFound(_)),
        ));
        assert!(matches!(
            repository
                .load_stage_events(uuid, Stage::TobMaiden, None)
                .await,
            Err(Error::NotFound(_)),
        ));
    }
}
