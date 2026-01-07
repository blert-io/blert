import * as fs from 'fs';
import * as path from 'path';

import { parseAndValidate } from '../validator';

const EXAMPLES_DIR = path.join(__dirname, '../../examples');

describe('BCF Examples', () => {
  const exampleFiles = fs
    .readdirSync(EXAMPLES_DIR)
    .filter((file) => file.endsWith('.bcf.json'));

  it.each(exampleFiles)('%s should be valid', (filename) => {
    const filepath = path.join(EXAMPLES_DIR, filename);
    const json = fs.readFileSync(filepath, 'utf-8');
    const result = parseAndValidate(json);

    if (!result.valid) {
      fail(
        `Validation errors in ${filename}: ${result.errors.map((e) => e.message).join(', ')}`,
      );
    }

    expect(result.valid).toBe(true);
  });
});
