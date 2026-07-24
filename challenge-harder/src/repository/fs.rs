//! Filesystem backend for a data repository.

use std::path::{Path, PathBuf};

use async_stream::try_stream;
use futures_util::StreamExt;
use futures_util::stream::BoxStream;

use super::{Backend, Error};

pub struct FilesystemBackend {
    root: PathBuf,
}

impl FilesystemBackend {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    fn full_path(&self, path: &str) -> PathBuf {
        self.root.join(path)
    }

    /// Returns `path` as a string relative to the backend root.
    fn root_relative(&self, path: &Path) -> Result<String, Error> {
        path.strip_prefix(&self.root)
            .map(|p| p.to_string_lossy().into_owned())
            .map_err(|e| Error::Backend(e.to_string()))
    }
}

#[async_trait::async_trait]
impl Backend for FilesystemBackend {
    async fn read(&self, path: &str) -> Result<Vec<u8>, Error> {
        match tokio::fs::read(self.full_path(path)).await {
            Ok(data) => Ok(data),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(Error::NotFound(path.into())),
            Err(e) => Err(Error::Backend(e.to_string())),
        }
    }

    async fn write(&self, path: &str, data: &[u8]) -> Result<(), Error> {
        let full_path = self.full_path(path);
        if let Some(parent) = full_path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| Error::Backend(e.to_string()))?;
        }
        tokio::fs::write(full_path, data)
            .await
            .map_err(|e| Error::Backend(e.to_string()))
    }

    async fn delete_file(&self, path: &str) -> Result<(), Error> {
        match tokio::fs::remove_file(self.full_path(path)).await {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(Error::Backend(e.to_string())),
        }
    }

    async fn delete_dir(&self, path: &str) -> Result<(), Error> {
        match tokio::fs::remove_dir_all(self.full_path(path)).await {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(Error::Backend(e.to_string())),
        }
    }

    fn list_dir(&self, path: &str) -> BoxStream<'_, Result<String, Error>> {
        let start = self.full_path(path);
        let path = path.to_string();

        try_stream! {
            let mut entries = match tokio::fs::read_dir(&start).await {
                Ok(entries) => entries,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    Err(Error::NotFound(path))?
                }
                Err(e) => Err(Error::Backend(e.to_string()))?,
            };

            let mut pending = Vec::new();
            loop {
                while let Some(entry) = entries
                    .next_entry()
                    .await
                    .map_err(|e| Error::Backend(e.to_string()))?
                {
                    let file_type = entry
                        .file_type()
                        .await
                        .map_err(|e| Error::Backend(e.to_string()))?;
                    if file_type.is_dir() {
                        pending.push(entry.path());
                    } else {
                        yield self.root_relative(&entry.path())?;
                    }
                }
                let Some(dir) = pending.pop() else { break };
                entries = tokio::fs::read_dir(&dir)
                    .await
                    .map_err(|e| Error::Backend(e.to_string()))?;
            }
        }
        .boxed()
    }
}

#[cfg(test)]
mod tests {
    use futures_util::TryStreamExt;

    use super::*;

    const CHALLENGE_DIR: &str = "d6/d6a81e145f9a431491d216eaee45b1d0";

    #[tokio::test]
    async fn round_trips_files() {
        let dir = tempfile::tempdir().unwrap();
        let backend = FilesystemBackend::new(dir.path().to_path_buf());

        let challenge = format!("{CHALLENGE_DIR}/challenge");
        backend.write(&challenge, b"blert").await.unwrap();
        assert_eq!(backend.read(&challenge).await.unwrap(), b"blert");

        let missing = format!("{CHALLENGE_DIR}/maiden");
        assert!(matches!(
            backend.read(&missing).await,
            Err(Error::NotFound(p)) if p == missing,
        ));
    }

    #[tokio::test]
    async fn deletes_files_and_directories() {
        let dir = tempfile::tempdir().unwrap();
        let backend = FilesystemBackend::new(dir.path().to_path_buf());

        let challenge = format!("{CHALLENGE_DIR}/challenge");
        let maiden = format!("{CHALLENGE_DIR}/maiden");
        backend.write(&challenge, b"data").await.unwrap();
        backend.write(&maiden, b"events").await.unwrap();

        backend.delete_file(&maiden).await.unwrap();
        assert!(matches!(
            backend.read(&maiden).await,
            Err(Error::NotFound(_)),
        ));
        assert_eq!(backend.read(&challenge).await.unwrap(), b"data");

        // Deleting an already deleted file succeeds.
        backend.delete_file(&maiden).await.unwrap();

        backend.delete_dir(CHALLENGE_DIR).await.unwrap();
        assert!(matches!(
            backend.read(&challenge).await,
            Err(Error::NotFound(_)),
        ));

        // A missing directory deletes without error.
        backend.delete_dir(CHALLENGE_DIR).await.unwrap();
    }

    #[tokio::test]
    async fn lists_directories_recursively() {
        let dir = tempfile::tempdir().unwrap();
        let backend = FilesystemBackend::new(dir.path().to_path_buf());

        let other_dir = "d6/d6bb2ba64c334670a97a0837a325d90a";
        for path in [
            format!("{CHALLENGE_DIR}/challenge"),
            format!("{CHALLENGE_DIR}/maiden"),
            format!("{other_dir}/challenge"),
        ] {
            backend.write(&path, b"data").await.unwrap();
        }

        let mut files: Vec<String> = backend.list_dir("d6").try_collect().await.unwrap();
        files.sort();
        assert_eq!(
            files,
            vec![
                format!("{CHALLENGE_DIR}/challenge"),
                format!("{CHALLENGE_DIR}/maiden"),
                format!("{other_dir}/challenge"),
            ],
        );

        assert!(matches!(
            backend.list_dir("ff").try_collect::<Vec<String>>().await,
            Err(Error::NotFound(p)) if p == "ff",
        ));
    }
}
