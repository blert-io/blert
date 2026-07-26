import { SplitType } from '../split';
import { SplitType as SplitTypeProto } from '../generated/challenge_storage_pb';

// `SplitType` in proto/challenge_storage.proto is the source of truth for
// split values. The `SplitType` enum in split.ts keeps literal values because
// initializing its members from the generated bindings degrades the enum to
// computed members, weakening type checking for every consumer. These tests
// enforce that the two stay identical.
// TODO(frolv): Move to a different proto library and kill this (#366).
describe('SplitType proto parity', () => {
  const protoMembers = Object.entries(SplitTypeProto).filter(
    (entry): entry is [string, number] => typeof entry[1] === 'number',
  );
  const enumMembers = Object.entries(SplitType).filter(
    (entry): entry is [string, number] => typeof entry[1] === 'number',
  );

  it('defines every proto split with an identical value', () => {
    const mismatches: string[] = [];
    for (const [protoName, protoValue] of protoMembers) {
      const member = protoName.replace(/^SPLIT_TYPE_/, '');
      const value = (SplitType as Record<string, unknown>)[member] as number;
      if (value !== protoValue) {
        mismatches.push(
          `proto ${protoName} = ${protoValue}, but SplitType.${member} is ${value}`,
        );
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('has a proto split for every enum value', () => {
    const protoValues = new Set(protoMembers.map(([, value]) => value));
    const unmapped = enumMembers
      .filter(([, value]) => !protoValues.has(value))
      .map(([name, value]) => `SplitType.${name} = ${value}`);
    expect(unmapped).toEqual([]);
  });
});
