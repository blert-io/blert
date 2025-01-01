import { S3Client } from '@aws-sdk/client-s3';
import { DataRepository } from '@blert/common';

function initializeRepository(envVar: string): DataRepository {
  if (!process.env[envVar]) {
    throw new Error(`${envVar} is not set`);
  }

  const uri = process.env[envVar]!;
  if (uri.startsWith('file://')) {
    const root = uri.slice('file://'.length);
    return new DataRepository(new DataRepository.FilesystemBackend(root));
  }

  if (uri.startsWith('s3://')) {
    const s3Client = new S3Client({
      forcePathStyle: false,
      region: process.env.BLERT_REGION,
      endpoint: process.env.BLERT_ENDPOINT,
      credentials: {
        accessKeyId: process.env.BLERT_ACCESS_KEY_ID!,
        secretAccessKey: process.env.BLERT_SECRET_ACCESS_KEY!,
      },
    });
    const bucket = uri.slice('s3://'.length);
    return new DataRepository(new DataRepository.S3Backend(s3Client, bucket));
  }

  throw new Error(`Unknown repository backend: ${uri}`);
}

const repository = initializeRepository('BLERT_DATA_REPOSITORY');
export const webRepository = initializeRepository('BLERT_WEB_REPOSITORY');

export default repository;
