import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { Stage } from '../challenge';
import { DataRepository } from '../data-repository/data-repository';
import { ChallengeData } from '../generated/challenge_storage_pb';

const UUID = '25252525-2525-2525-2525-252525252525';

describe('DataRepository', () => {
  let root: string;
  let repository: DataRepository;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'data-repository-'));
    repository = new DataRepository(new DataRepository.FilesystemBackend(root));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe('loadTfaChallengeData', () => {
    it('loads TFA data with bosses in stage order', async () => {
      const necromancer = new ChallengeData.TfaBoss();
      necromancer.setTicksLost(2);
      necromancer.setDeathsList(['Sacolyn', '1Ogp']);
      necromancer.setOffset(14);
      necromancer.setNecromancer(new ChallengeData.TfaBoss.Necromancer());

      const guardian = new ChallengeData.TfaBoss();
      guardian.setTicksLost(1);
      guardian.setGuardian(new ChallengeData.TfaBoss.Guardian());

      const ezekiel = new ChallengeData.TfaBoss();
      ezekiel.setTicksLost(3);
      ezekiel.setDeathsList(['Sacolyn']);
      ezekiel.setEzekiel(new ChallengeData.TfaBoss.Ezekiel());

      const raid = new ChallengeData.TfaRaid();
      raid.setBossesList([necromancer, guardian, ezekiel]);
      const data = new ChallengeData();
      data.setChallengeId(UUID);
      data.setTfa(raid);
      await repository.saveChallengeDataProto(UUID, data);

      expect(await repository.loadTfaChallengeData(UUID)).toEqual({
        bosses: [
          {
            stage: Stage.TFA_GUARDIAN,
            ticksLost: 1,
            offset: undefined,
            deaths: [],
            npcs: {},
          },
          {
            stage: Stage.TFA_EZEKIEL,
            ticksLost: 3,
            offset: undefined,
            deaths: ['Sacolyn'],
            npcs: {},
          },
          {
            stage: Stage.TFA_NECROMANCER,
            ticksLost: 2,
            offset: 14,
            deaths: ['Sacolyn', '1Ogp'],
            npcs: {},
          },
        ],
      });
    });

    it('errors if the challenge does not have TFA data', async () => {
      const data = new ChallengeData();
      data.setChallengeId(UUID);
      data.setTobRooms(new ChallengeData.TobRooms());
      await repository.saveChallengeDataProto(UUID, data);

      await expect(repository.loadTfaChallengeData(UUID)).rejects.toThrow(
        DataRepository.InvalidType,
      );
    });
  });
});
