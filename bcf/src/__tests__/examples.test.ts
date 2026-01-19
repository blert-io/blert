import * as fs from 'fs';
import * as path from 'path';

import { parseAndValidate } from '../validator';
import { BCFResolver } from '../resolver';
import { BCFLaxAction } from '../types';

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
      throw new Error(
        `Validation errors in ${filename}:\n${result.errors.map((e) => `- ${e.path}: ${e.message}`).join('\n')}`,
      );
    }
  });

  describe('113-p1', () => {
    let resolver: BCFResolver<BCFLaxAction>;

    beforeEach(() => {
      const filepath = path.join(EXAMPLES_DIR, '113-p1.bcf.json');
      const json = fs.readFileSync(filepath, 'utf-8');
      const result = parseAndValidate(json);
      if (!result.valid) {
        throw new Error('Invalid BCF document');
      }
      resolver = new BCFResolver(result.document);
    });

    it('contains correct metadata', () => {
      expect(resolver.totalTicks).toBe(62);
      expect(resolver.maxTick).toBe(61);
      expect(resolver.startTick).toBe(1);
      expect(resolver.endTick).toBe(resolver.maxTick);
    });

    it('contains correct actors', () => {
      expect(resolver.getActors()).toHaveLength(4);
      expect(resolver.getActor('p1')).toBeDefined();
      expect(resolver.getActor('p2')).toBeDefined();
      expect(resolver.getActor('p3')).toBeDefined();
      expect(resolver.getActor('verzik')).toBeDefined();
    });
  });
});
