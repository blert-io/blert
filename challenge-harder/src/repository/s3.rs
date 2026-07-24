//! S3 backend for a data repository.

use async_stream::try_stream;
use aws_sdk_s3::Client;
use aws_sdk_s3::error::DisplayErrorContext;
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::types::{Delete, ObjectIdentifier};
use futures_util::StreamExt;
use futures_util::stream::BoxStream;

use super::{Backend, Error};

pub struct S3Backend {
    client: Client,
    bucket: String,
}

impl S3Backend {
    pub fn new(client: Client, bucket: String) -> Self {
        Self { client, bucket }
    }

    /// Builds a client from configured S3 `BLERT_*` environment variables.
    pub async fn from_env(bucket: String) -> Self {
        let credentials = aws_sdk_s3::config::Credentials::new(
            std::env::var("BLERT_ACCESS_KEY_ID").expect("BLERT_ACCESS_KEY_ID must be set"),
            std::env::var("BLERT_SECRET_ACCESS_KEY").expect("BLERT_SECRET_ACCESS_KEY must be set"),
            None,
            None,
            "blert-environment",
        );
        let mut loader = aws_config::defaults(aws_config::BehaviorVersion::latest())
            .credentials_provider(credentials);
        if let Ok(region) = std::env::var("BLERT_REGION") {
            loader = loader.region(aws_config::Region::new(region));
        }
        if let Ok(endpoint) = std::env::var("BLERT_ENDPOINT") {
            loader = loader.endpoint_url(endpoint);
        }
        let config = loader.load().await;
        Self::new(Client::new(&config), bucket)
    }

    fn backend_error<E: std::error::Error + 'static>(error: E) -> Error {
        Error::Backend(DisplayErrorContext(error).to_string())
    }

    /// Normalizes a directory path into a delimited prefix so it can't clash.
    fn dir_prefix(path: &str) -> String {
        if path.is_empty() || path.ends_with('/') {
            path.to_string()
        } else {
            format!("{path}/")
        }
    }
}

#[async_trait::async_trait]
impl Backend for S3Backend {
    async fn read(&self, path: &str) -> Result<Vec<u8>, Error> {
        let object = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(path)
            .send()
            .await
            .map_err(|e| match e.into_service_error() {
                err if err.is_no_such_key() => Error::NotFound(path.into()),
                err => Self::backend_error(err),
            })?;
        let data = object.body.collect().await.map_err(Self::backend_error)?;
        Ok(data.into_bytes().to_vec())
    }

    async fn write(&self, path: &str, data: &[u8]) -> Result<(), Error> {
        self.client
            .put_object()
            .bucket(&self.bucket)
            .key(path)
            .body(ByteStream::from(data.to_vec()))
            .send()
            .await
            .map(|_| ())
            .map_err(Self::backend_error)
    }

    async fn delete_file(&self, path: &str) -> Result<(), Error> {
        self.client
            .delete_object()
            .bucket(&self.bucket)
            .key(path)
            .send()
            .await
            .map(|_| ())
            .map_err(Self::backend_error)
    }

    async fn delete_dir(&self, path: &str) -> Result<(), Error> {
        let mut pages = self
            .client
            .list_objects_v2()
            .bucket(&self.bucket)
            .prefix(Self::dir_prefix(path))
            .into_paginator()
            .send();
        while let Some(page) = pages.next().await {
            let page = page.map_err(Self::backend_error)?;
            let objects: Vec<ObjectIdentifier> = page
                .contents
                .unwrap_or_default()
                .into_iter()
                .filter_map(|object| object.key)
                .map(|key| ObjectIdentifier::builder().key(key).build())
                .collect::<Result<_, _>>()
                .map_err(Self::backend_error)?;
            if objects.is_empty() {
                continue;
            }
            let delete = Delete::builder()
                .set_objects(Some(objects))
                .build()
                .map_err(Self::backend_error)?;
            let output = self
                .client
                .delete_objects()
                .bucket(&self.bucket)
                .delete(delete)
                .send()
                .await
                .map_err(Self::backend_error)?;

            // A batch delete can succeed while rejecting individual keys.
            let errors = output.errors.unwrap_or_default();
            if let Some(first) = errors.first() {
                return Err(Error::Backend(format!(
                    "failed to delete {} objects under {path}, first {}, {}",
                    errors.len(),
                    first.key().unwrap_or("<unknown>"),
                    first.message().unwrap_or("<no message>"),
                )));
            }
        }
        Ok(())
    }

    fn list_dir(&self, path: &str) -> BoxStream<'_, Result<String, Error>> {
        let mut pages = self
            .client
            .list_objects_v2()
            .bucket(&self.bucket)
            .prefix(Self::dir_prefix(path))
            .into_paginator()
            .send();
        let path = path.to_string();
        try_stream! {
            let mut found = false;
            while let Some(page) = pages.next().await {
                let page = page.map_err(Self::backend_error)?;
                for object in page.contents.unwrap_or_default() {
                    found = true;
                    yield object.key.unwrap_or_default();
                }
            }
            // Fail for a missing directory.
            if !found && !path.is_empty() {
                Err(Error::NotFound(path))?;
            }
        }
        .boxed()
    }
}
