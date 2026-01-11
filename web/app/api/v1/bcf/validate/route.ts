import { NextRequest } from 'next/server';

import {
  BCFVersion,
  parseAndValidate,
  SUPPORTED_VERSIONS,
  ValidationError,
} from '@blert/bcf';

const MAX_BODY_SIZE = 5 * 1024 * 1024;

type ValidateResponse =
  | { valid: true; version: string }
  | { valid: false; errors: ValidationError[] };

export async function POST(request: NextRequest): Promise<Response> {
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
    return Response.json({ error: 'payload_too_large' }, { status: 413 });
  }

  const searchParams = request.nextUrl.searchParams;

  const versionParam = searchParams.get('version');
  let version: BCFVersion | undefined;
  if (versionParam !== null) {
    if (!SUPPORTED_VERSIONS.includes(versionParam as BCFVersion)) {
      return Response.json(
        {
          error: 'invalid_version',
          supportedVersions: SUPPORTED_VERSIONS,
        },
        { status: 400 },
      );
    }
    version = versionParam as BCFVersion;
  }

  const strictParam = searchParams.get('strict');
  let strict: boolean | undefined;
  if (strictParam !== null) {
    if (strictParam !== 'true' && strictParam !== 'false') {
      return Response.json({ error: 'invalid_strict_param' }, { status: 400 });
    }
    strict = strictParam === 'true';
  }

  let body: string;
  try {
    body = await request.text();
  } catch {
    return Response.json({ error: 'invalid_body' }, { status: 400 });
  }

  const result = parseAndValidate(body, { version, strict });

  let response: ValidateResponse;
  if (result.valid) {
    response = { valid: true, version: result.version };
  } else {
    response = { valid: false, errors: result.errors };
  }

  return Response.json(response);
}
