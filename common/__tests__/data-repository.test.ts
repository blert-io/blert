import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { Stage } from '../challenge';
import { DataRepository } from '../data-repository/data-repository';
import {
  ChallengeData,
  ChallengeEvents,
} from '../generated/challenge_storage_pb';
import { Event as EventProto } from '../generated/event_pb';

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
      const moia = new ChallengeData.TfaBoss();
      moia.setTicksLost(2);
      moia.setDeathsList(['Sacolyn', '1Ogp']);
      moia.setOffset(14);
      moia.setMoia(new ChallengeData.TfaBoss.Moia());

      const guardian = new ChallengeData.TfaBoss();
      guardian.setTicksLost(1);
      guardian.setGuardian(new ChallengeData.TfaBoss.Guardian());

      const ezekiel = new ChallengeData.TfaBoss();
      ezekiel.setTicksLost(3);
      ezekiel.setDeathsList(['Sacolyn']);
      ezekiel.setEzekiel(new ChallengeData.TfaBoss.Ezekiel());

      const raid = new ChallengeData.TfaRaid();
      raid.setBossesList([moia, guardian, ezekiel]);
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
            stage: Stage.TFA_MOIA,
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

  describe('stage events', () => {
    it('stores guardian rock targets as party indices', async () => {
      const rocks = new EventProto.TfaGuardianRocks();
      rocks.setTargetsList(['TobDataEgirl', '715']);
      rocks.setTargetPartyIndicesList([0, 1]);
      const event = new EventProto();
      event.setType(EventProto.Type.TFA_GUARDIAN_ROCKS);
      event.setStage(Stage.TFA_GUARDIAN);
      event.setTick(8803);
      event.setTfaGuardianRocks(rocks);

      await repository.saveProtoStageEvents(
        UUID,
        Stage.TFA_GUARDIAN,
        ['TobDataEgirl', '715'],
        [event.cloneMessage()],
      );

      const atRest = event.cloneMessage();
      atRest.getTfaGuardianRocks()!.clearTargetsList();
      const stored = ChallengeEvents.deserializeBinary(
        await readFile(join(root, '25', UUID.replaceAll('-', ''), 'guardian')),
      );
      expect(stored.getEventsList().map((e) => e.toObject())).toEqual([
        atRest.toObject(),
      ]);

      const loaded = await repository.loadStageEvents(UUID, Stage.TFA_GUARDIAN);
      expect(loaded.map((e) => e.toObject())).toEqual([event.toObject()]);
    });
  });
});
