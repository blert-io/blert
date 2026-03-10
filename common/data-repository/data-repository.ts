import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { mkdir, readFile, readdir, rm, writeFile } from 'fs/promises';
import { dirname } from 'path';
import jspb from 'google-protobuf';
import { Empty as EmptyProto } from 'google-protobuf/google/protobuf/empty_pb';

import {
  ChallengeData,
  ChallengeEvents,
} from '../generated/challenge_storage_pb';
import {
  Coords as CoordsProto,
  Event as EventProto,
  StageMap,
} from '../generated/event_pb';
import {
  ColosseumData,
  InfernoData,
  MaidenCrab,
  MokhaiotlData,
  Nylo,
  RoomNpc,
  RoomNpcMap,
  RoomNpcType,
  Stage,
  TobRoom,
  TobRooms,
  VerzikCrab,
} from '../challenge';
import { EventType } from '../event';

type Proto<T> = T[keyof T];

export class DataRepository {
  private static CHALLENGE_FILE = 'challenge';

  private backend: DataRepository.Backend;

  constructor(backend: DataRepository.Backend) {
    this.backend = backend;
  }

  public async loadChallengeDataProto(uuid: string): Promise<ChallengeData> {
    return await this.backend.loadChallengeFile(
      (data) => ChallengeData.deserializeBinary(data),
      uuid,
      DataRepository.CHALLENGE_FILE,
    );
  }

  public async saveChallengeDataProto(
    uuid: string,
    data: ChallengeData,
  ): Promise<void> {
    await this.backend.saveChallengeFile(
      uuid,
      DataRepository.CHALLENGE_FILE,
      data,
    );
  }

  public async deleteChallenge(uuid: string): Promise<void> {
    return this.backend.deleteAllChallengeFiles(uuid);
  }

  public async saveTobChallengeData(
    uuid: string,
    tobRooms: TobRooms,
  ): Promise<void> {
    const challengeData = new ChallengeData();
    challengeData.setChallengeId(uuid);
    const tobData = new ChallengeData.TobRooms();

    const setSharedRoomData = (tobRoom: TobRoom): ChallengeData.TobRoom => {
      const room = new ChallengeData.TobRoom();
      room.setStage(tobRoom.stage as Proto<StageMap>);
      room.setTicksLost(tobRoom.ticksLost);
      room.setDeathsList(tobRoom.deaths);
      room.setNpcsList(npcsToProto(tobRoom.npcs));
      return room;
    };

    if (tobRooms.maiden !== null) {
      const maiden = setSharedRoomData(tobRooms.maiden);
      tobData.setMaiden(maiden);
    }

    if (tobRooms.bloat !== null) {
      const bloat = setSharedRoomData(tobRooms.bloat);
      bloat.setBloatDownTicksList(tobRooms.bloat.downTicks);
      tobData.setBloat(bloat);
    }

    if (tobRooms.nylocas !== null) {
      const nylocas = setSharedRoomData(tobRooms.nylocas);
      nylocas.setNyloWavesStalledList(tobRooms.nylocas.stalledWaves);
      tobData.setNylocas(nylocas);
    }

    if (tobRooms.sotetseg !== null) {
      const sotetseg = setSharedRoomData(tobRooms.sotetseg);
      sotetseg.setSotetsegMaze1PivotsList(tobRooms.sotetseg.maze1Pivots);
      if (tobRooms.sotetseg.maze1Chosen !== null) {
        sotetseg.setSotetsegMaze1Chosen(tobRooms.sotetseg.maze1Chosen);
      }
      sotetseg.setSotetsegMaze2PivotsList(tobRooms.sotetseg.maze2Pivots);
      if (tobRooms.sotetseg.maze2Chosen !== null) {
        sotetseg.setSotetsegMaze2Chosen(tobRooms.sotetseg.maze2Chosen);
      }
      tobData.setSotetseg(sotetseg);
    }

    if (tobRooms.xarpus !== null) {
      const xarpus = setSharedRoomData(tobRooms.xarpus);
      tobData.setXarpus(xarpus);
    }

    if (tobRooms.verzik !== null) {
      const verzik = setSharedRoomData(tobRooms.verzik);
      verzik.setVerzikRedsCount(tobRooms.verzik.redsSpawnCount);
      tobData.setVerzik(verzik);
    }

    challengeData.setTobRooms(tobData);
    await this.backend.saveChallengeFile(
      uuid,
      DataRepository.CHALLENGE_FILE,
      challengeData,
    );
  }

  public async saveColosseumChallengeData(
    uuid: string,
    colosseumData: ColosseumData,
  ): Promise<void> {
    const challengeData = new ChallengeData();
    challengeData.setChallengeId(uuid);
    const colo = new ChallengeData.Colosseum();

    colo.setAllHandicapsList(colosseumData.handicaps);

    colo.setWavesList(
      colosseumData.waves.map((wave) => {
        const waveData = new ChallengeData.ColosseumWave();
        waveData.setStage(wave.stage as Proto<StageMap>);
        waveData.setTicksLost(wave.ticksLost);
        waveData.setHandicapChosen(wave.handicap);
        waveData.setHandicapOptionsList(wave.options);
        waveData.setNpcsList(npcsToProto(wave.npcs));
        return waveData;
      }),
    );

    challengeData.setColosseum(colo);
    await this.backend.saveChallengeFile(
      uuid,
      DataRepository.CHALLENGE_FILE,
      challengeData,
    );
  }

  public async saveInfernoChallengeData(
    uuid: string,
    infernoData: InfernoData,
  ): Promise<void> {
    const challengeData = new ChallengeData();
    challengeData.setChallengeId(uuid);

    const inferno = new ChallengeData.Inferno();

    inferno.setWavesList(
      infernoData.waves.map((wave) => {
        const waveData = new ChallengeData.InfernoWave();
        waveData.setStage(wave.stage as Proto<StageMap>);
        waveData.setTicks(wave.ticks);
        waveData.setStartTick(wave.startTick);
        waveData.setNpcsList(npcsToProto(wave.npcs));
        return waveData;
      }),
    );

    challengeData.setInferno(inferno);
    await this.backend.saveChallengeFile(
      uuid,
      DataRepository.CHALLENGE_FILE,
      challengeData,
    );
  }

  public async saveMokhaiotlChallengeData(
    uuid: string,
    mokhaiotlData: MokhaiotlData,
  ): Promise<void> {
    const challengeData = new ChallengeData();
    challengeData.setChallengeId(uuid);
    const mokhaiotl = new ChallengeData.Mokhaiotl();

    mokhaiotl.setDelvesList(
      mokhaiotlData.delves.map((delve) => {
        const delveData = new ChallengeData.MokhaiotlDelve();
        delveData.setStage(delve.stage as Proto<StageMap>);
        delveData.setTicksLost(delve.ticksLost);
        delveData.setNpcsList(npcsToProto(delve.npcs));
        delveData.setDelve(delve.delve);
        delveData.setChallengeTicks(delve.challengeTicks);
        delveData.setLarvaeLeaked(delve.larvaeLeaked);
        return delveData;
      }),
    );

    challengeData.setMokhaiotl(mokhaiotl);
    await this.backend.saveChallengeFile(
      uuid,
      DataRepository.CHALLENGE_FILE,
      challengeData,
    );
  }

  public async loadTobChallengeData(uuid: string): Promise<TobRooms> {
    const challengeData = await this.loadChallengeDataProto(uuid);

    if (!challengeData.hasTobRooms()) {
      throw new DataRepository.InvalidType();
    }

    return this.parseTobRooms(challengeData);
  }

  public async loadColosseumChallengeData(
    uuid: string,
  ): Promise<ColosseumData> {
    const challengeData = await this.loadChallengeDataProto(uuid);

    if (!challengeData.hasColosseum()) {
      throw new DataRepository.InvalidType();
    }

    return this.parseColosseumData(challengeData);
  }

  /**
   * Loads stored data for an Inferno challenge with the given UUID.
   * @param uuid UUID of the challenge.
   * @returns Parsed Inferno data.
   */
  public async loadInfernoChallengeData(uuid: string): Promise<InfernoData> {
    const challengeData = await this.loadChallengeDataProto(uuid);
    if (!challengeData.hasInferno()) {
      throw new DataRepository.InvalidType();
    }

    return this.parseInfernoData(challengeData);
  }

  public async loadMokhaiotlChallengeData(
    uuid: string,
  ): Promise<MokhaiotlData> {
    const challengeData = await this.loadChallengeDataProto(uuid);

    if (!challengeData.hasMokhaiotl()) {
      throw new DataRepository.InvalidType();
    }

    return this.parseMokhaiotlData(challengeData);
  }

  public async saveProtoStageEvents(
    uuid: string,
    stage: Stage,
    party: string[],
    events: EventProto[],
    attempt?: number,
  ): Promise<void> {
    const challengeEvents = new ChallengeEvents();
    challengeEvents.setStage(stage as Proto<StageMap>);
    challengeEvents.setPartyNamesList(party);

    // Translate events from their over-the-wire format to an at-rest format by
    // removing several redundant fields.
    events.forEach((e) => {
      e.setChallengeId('');

      if (e.hasPlayer()) {
        const player = e.getPlayer()!;
        const partyIndex = party.indexOf(player.getName());
        if (partyIndex !== -1) {
          player.setPartyIndex(partyIndex);
          player.setName('');
        }
      }

      if (e.getType() === EventType.NPC_ATTACK) {
        // Replace the target string of NPC attacks with the party index.
        const npcAttack = e.getNpcAttack()!;
        if (npcAttack.hasTarget()) {
          const target = npcAttack.getTarget();
          npcAttack.clearTarget();
          const player = new EventProto.Player();
          const partyIndex = party.indexOf(target);
          if (partyIndex !== -1) {
            player.setPartyIndex(partyIndex);
          }
          e.setPlayer(player);
        }
      }
    });

    challengeEvents.setEventsList(events);

    await this.backend.saveChallengeFile(
      uuid,
      DataRepository.fileForStage(stage, attempt),
      challengeEvents,
    );
  }

  /**
   * Loads stored event protos for a challenge stage.
   * @param uuid UUID of the challenge.
   * @param stage The stage to load events for.
   * @param attempt Optional attempt number.
   * @returns Event protos for the stage.
   */
  public async loadStageEvents(
    uuid: string,
    stage: Stage,
    attempt?: number,
  ): Promise<EventProto[]> {
    const protoEvents = await this.backend.loadChallengeFile(
      (data) => ChallengeEvents.deserializeBinary(data),
      uuid,
      DataRepository.fileForStage(stage, attempt),
    );

    const party = protoEvents.getPartyNamesList();

    return protoEvents.getEventsList().map((e) => {
      // Resolve partyIndex-based names back to player names.
      if (e.hasPlayer()) {
        const player = e.getPlayer()!;
        if (player.getName() === '') {
          player.setName(party[player.getPartyIndex()]);
        }
      }

      // NPC_ATTACK targets are stored in the player proto at rest;
      // move them back to npcAttack.target for the wire format.
      if (e.getType() === EventType.NPC_ATTACK && e.hasPlayer()) {
        const player = e.getPlayer()!;
        const npcAttack = e.getNpcAttack()!;
        npcAttack.setTarget(player.getName());
        e.clearPlayer();
      }

      return e;
    });
  }

  private parseTobRooms(data: ChallengeData): TobRooms {
    const tobRooms: TobRooms = {
      maiden: null,
      bloat: null,
      nylocas: null,
      sotetseg: null,
      xarpus: null,
      verzik: null,
    };

    if (data.hasTobRooms()) {
      const tobData = data.getTobRooms()!;

      if (tobData.hasMaiden()) {
        const maiden = tobData.getMaiden()!;
        tobRooms.maiden = {
          stage: Stage.TOB_MAIDEN,
          ticksLost: maiden.getTicksLost(),
          deaths: maiden.getDeathsList(),
          npcs: npcsFromProto(maiden.getNpcsList()),
        };
      }

      if (tobData.hasBloat()) {
        const bloat = tobData.getBloat()!;
        tobRooms.bloat = {
          stage: Stage.TOB_BLOAT,
          ticksLost: bloat.getTicksLost(),
          deaths: bloat.getDeathsList(),
          downTicks: bloat.getBloatDownTicksList(),
          npcs: npcsFromProto(bloat.getNpcsList()),
        };
      }

      if (tobData.hasNylocas()) {
        const nylocas = tobData.getNylocas()!;
        tobRooms.nylocas = {
          stage: Stage.TOB_NYLOCAS,
          ticksLost: nylocas.getTicksLost(),
          deaths: nylocas.getDeathsList(),
          stalledWaves: nylocas.getNyloWavesStalledList(),
          npcs: npcsFromProto(nylocas.getNpcsList()),
        };
      }

      if (tobData.hasSotetseg()) {
        const sotetseg = tobData.getSotetseg()!;
        tobRooms.sotetseg = {
          stage: Stage.TOB_SOTETSEG,
          ticksLost: sotetseg.getTicksLost(),
          deaths: sotetseg.getDeathsList(),
          maze1Pivots: sotetseg.getSotetsegMaze1PivotsList(),
          maze2Pivots: sotetseg.getSotetsegMaze2PivotsList(),
          maze1Chosen: sotetseg.getSotetsegMaze1Chosen() || null,
          maze2Chosen: sotetseg.getSotetsegMaze2Chosen() || null,
          npcs: npcsFromProto(sotetseg.getNpcsList()),
        };
      }

      if (tobData.hasXarpus()) {
        const xarpus = tobData.getXarpus()!;
        tobRooms.xarpus = {
          stage: Stage.TOB_XARPUS,
          ticksLost: xarpus.getTicksLost(),
          deaths: xarpus.getDeathsList(),
          npcs: npcsFromProto(xarpus.getNpcsList()),
        };
      }

      if (tobData.hasVerzik()) {
        const verzik = tobData.getVerzik()!;
        tobRooms.verzik = {
          stage: Stage.TOB_VERZIK,
          ticksLost: verzik.getTicksLost(),
          deaths: verzik.getDeathsList(),
          redsSpawnCount: verzik.getVerzikRedsCount(),
          npcs: npcsFromProto(verzik.getNpcsList()),
        };
      }
    }

    return tobRooms;
  }

  public async deleteDirectory(path: string): Promise<void> {
    await this.backend.deleteDir(path);
  }

  public async deleteFile(path: string): Promise<void> {
    await this.backend.deleteFile(path);
  }

  public async saveRaw(path: string, contents: Uint8Array): Promise<void> {
    await this.backend.write(path, contents);
  }

  public async loadRaw(path: string): Promise<Uint8Array> {
    return this.backend.read(path);
  }

  /**
   * Recursively lists the contents of a directory.
   * @param path Path to the directory to read.
   * @returns A list of filenames within the directory.
   */
  public async listFiles(path: string): Promise<string[]> {
    return this.backend.listDir(path);
  }

  private parseColosseumData(data: ChallengeData): ColosseumData {
    const colosseumData: ColosseumData = {
      handicaps: [],
      waves: [],
    };

    if (data.hasColosseum()) {
      const colo = data.getColosseum()!;

      colosseumData.handicaps = colo.getAllHandicapsList();

      colosseumData.waves = colo.getWavesList().map((wave) => ({
        stage: wave.getStage(),
        ticksLost: wave.getTicksLost(),
        handicap: wave.getHandicapChosen(),
        options: wave.getHandicapOptionsList(),
        npcs: npcsFromProto(wave.getNpcsList()),
      }));

      colosseumData.waves.sort((a, b) => a.stage - b.stage);
    }

    return colosseumData;
  }

  private parseInfernoData(data: ChallengeData): InfernoData {
    const infernoData: InfernoData = { waves: [] };

    if (data.hasInferno()) {
      const inferno = data.getInferno()!;
      infernoData.waves = inferno.getWavesList().map((wave) => ({
        stage: wave.getStage(),
        ticks: wave.getTicks(),
        ticksLost: wave.getTicksLost(),
        startTick: wave.getStartTick(),
        npcs: npcsFromProto(wave.getNpcsList()),
      }));
    }

    return infernoData;
  }

  private parseMokhaiotlData(data: ChallengeData): MokhaiotlData {
    const mokhaiotlData: MokhaiotlData = { delves: [] };

    if (data.hasMokhaiotl()) {
      const mokhaiotl = data.getMokhaiotl()!;
      mokhaiotlData.delves = mokhaiotl.getDelvesList().map((delve) => ({
        stage: delve.getStage(),
        ticksLost: delve.getTicksLost(),
        npcs: npcsFromProto(delve.getNpcsList()),
        delve: delve.getDelve(),
        challengeTicks: delve.getChallengeTicks(),
        larvaeLeaked: delve.getLarvaeLeaked(),
      }));

      mokhaiotlData.delves.sort((a, b) => a.delve - b.delve);
    }

    return mokhaiotlData;
  }

  /**
   * Returns the basename of the file in which a stage's events are stored.
   * @param stage The stage.
   * @returns Filename for the stage's events.
   */
  private static fileForStage(stage: Stage, attempt?: number): string {
    let fileName = '';

    if (stage >= Stage.INFERNO_WAVE_1 && stage <= Stage.INFERNO_WAVE_69) {
      return `wave-${stage - Stage.INFERNO_WAVE_1 + 1}`;
    }

    switch (stage) {
      case Stage.TOB_MAIDEN:
        fileName = 'maiden';
        break;
      case Stage.TOB_BLOAT:
        fileName = 'bloat';
        break;
      case Stage.TOB_NYLOCAS:
        fileName = 'nylocas';
        break;
      case Stage.TOB_SOTETSEG:
        fileName = 'sotetseg';
        break;
      case Stage.TOB_XARPUS:
        fileName = 'xarpus';
        break;
      case Stage.TOB_VERZIK:
        fileName = 'verzik';
        break;
      case Stage.COLOSSEUM_WAVE_1:
      case Stage.COLOSSEUM_WAVE_2:
      case Stage.COLOSSEUM_WAVE_3:
      case Stage.COLOSSEUM_WAVE_4:
      case Stage.COLOSSEUM_WAVE_5:
      case Stage.COLOSSEUM_WAVE_6:
      case Stage.COLOSSEUM_WAVE_7:
      case Stage.COLOSSEUM_WAVE_8:
      case Stage.COLOSSEUM_WAVE_9:
      case Stage.COLOSSEUM_WAVE_10:
      case Stage.COLOSSEUM_WAVE_11:
      case Stage.COLOSSEUM_WAVE_12:
        fileName = `wave-${stage - Stage.COLOSSEUM_WAVE_1 + 1}`;
        break;
      case Stage.MOKHAIOTL_DELVE_1:
      case Stage.MOKHAIOTL_DELVE_2:
      case Stage.MOKHAIOTL_DELVE_3:
      case Stage.MOKHAIOTL_DELVE_4:
      case Stage.MOKHAIOTL_DELVE_5:
      case Stage.MOKHAIOTL_DELVE_6:
      case Stage.MOKHAIOTL_DELVE_7:
      case Stage.MOKHAIOTL_DELVE_8:
        fileName = `delve-${stage - Stage.MOKHAIOTL_DELVE_1 + 1}`;
        break;
      case Stage.MOKHAIOTL_DELVE_8PLUS:
        fileName = 'delve-8plus';
        break;
      default:
        throw new Error(`Invalid stage: ${stage}`);
    }

    return attempt === undefined ? fileName : `${fileName}:${attempt}`;
  }
}

// TODO(frolv): Remove the namespace and just export the classes directly.
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace DataRepository {
  export abstract class Backend {
    public async loadChallengeFile<T extends jspb.Message>(
      deserialize: (data: Uint8Array) => T,
      uuid: string,
      file: string,
    ): Promise<T> {
      const path = this.relativePath(uuid, file);
      try {
        const data = await this.read(path);
        if (process.env.NODE_ENV === 'development') {
          console.log(`Loaded ${data.length}B of challenge data from ${path}`);
        }
        return deserialize(data);
      } catch {
        throw new DataRepository.NotFound(`${uuid}/${file}`);
      }
    }

    public async saveChallengeFile<T extends jspb.Message>(
      uuid: string,
      file: string,
      message: T,
    ): Promise<void> {
      const path = this.relativePath(uuid, file);
      const data = message.serializeBinary();
      await this.write(path, data);

      if (process.env.NODE_ENV === 'development') {
        console.log(`Saved ${data.length}B of challenge data to ${path}`);
      }
    }

    public async deleteAllChallengeFiles(uuid: string): Promise<void> {
      return this.deleteDir(this.relativePath(uuid));
    }

    /**
     * Reads the raw contents of the file at the specified path.
     * @param relativePath The path, relative to the backend's root.
     */
    public abstract read(relativePath: string): Promise<Uint8Array>;

    /**
     * Writes the raw contents of a file to the specified path.
     * @param relativePath The path, relative to the backend's root.
     */
    public abstract write(
      relativePath: string,
      data: Uint8Array,
    ): Promise<void>;

    /**
     * Recursively deletes content of a directory at the specified path.
     * @param relativePath The path, relative to the backend's root.
     */
    public abstract deleteDir(relativePath: string): Promise<void>;

    /**
     * Deletes a file at the specified path.
     * @param relativePath The path, relative to the backend's root.
     */
    public abstract deleteFile(relativePath: string): Promise<void>;

    /**
     * Recursively lists the contents of a directory at the specified path.
     * @param relativePath The path, relative to the backend's root.
     * @returns A list of filenames in the directory, prefixed by the relative
     *   path.
     */
    public abstract listDir(relativePath: string): Promise<string[]>;

    private relativePath(uuid: string, file?: string): string {
      const subdir = uuid.slice(0, 2);
      const challengeDir = `${subdir}/${uuid.replaceAll('-', '')}`;
      return file === undefined ? challengeDir : `${challengeDir}/${file}`;
    }
  }

  /**
   * A DataRepository backend that reads files from the local filesystem.
   */
  export class FilesystemBackend extends Backend {
    private root: string;

    public constructor(rootPath: string) {
      super();
      this.root = rootPath;
    }

    public override read(relativePath: string): Promise<Uint8Array> {
      try {
        return readFile(`${this.root}/${relativePath}`);
      } catch {
        throw new DataRepository.NotFound(relativePath);
      }
    }

    public override async write(
      relativePath: string,
      data: Uint8Array,
    ): Promise<void> {
      const fullPath = `${this.root}/${relativePath}`;
      await mkdir(dirname(fullPath), { recursive: true });
      return writeFile(fullPath, data);
    }

    public override async deleteFile(relativePath: string): Promise<void> {
      const fullPath = `${this.root}/${relativePath}`;
      return rm(fullPath);
    }

    public override async deleteDir(relativePath: string): Promise<void> {
      const dir = `${this.root}/${relativePath}`;
      return rm(dir, { recursive: true, force: true });
    }

    public override async listDir(relativePath: string): Promise<string[]> {
      const dir = `${this.root}/${relativePath}`;
      try {
        const entries = await readdir(dir, {
          withFileTypes: true,
          recursive: true,
        });
        return entries
          .filter((entry) => entry.isFile())
          .map(
            (entry) =>
              entry.parentPath.slice(this.root.length + 1) + '/' + entry.name,
          );
      } catch (e: unknown) {
        const err = e as NodeJS.ErrnoException;
        if (err.code === 'ENOENT') {
          return [];
        }
        console.error(`Failed to list directory: ${err.message}`);
        throw new DataRepository.BackendError();
      }
    }
  }

  export class S3Backend extends Backend {
    private client: S3Client;
    private bucket: string;

    public constructor(client: S3Client, bucket: string) {
      super();
      this.client = client;
      this.bucket = bucket;
    }

    public override async read(relativePath: string): Promise<Uint8Array> {
      const params = {
        Bucket: this.bucket,
        Key: relativePath,
      };

      try {
        const response = await this.client.send(new GetObjectCommand(params));
        if (response.Body === undefined) {
          throw new DataRepository.NotFound(relativePath);
        }
        return await response.Body.transformToByteArray();
      } catch (e: any) {
        if (e instanceof Error && e.name === 'NoSuchKey') {
          throw new DataRepository.NotFound(relativePath);
        }
        console.error(`Failed to read from S3: ${e}`);
        throw new DataRepository.BackendError();
      }
    }

    public override async write(
      relativePath: string,
      data: Uint8Array,
    ): Promise<void> {
      const params = {
        Bucket: this.bucket,
        Key: relativePath,
        Body: data,
      };

      try {
        await this.client.send(new PutObjectCommand(params));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`Failed to write to S3: ${msg}`);
        throw new DataRepository.BackendError();
      }
    }

    public override async deleteFile(relativePath: string): Promise<void> {
      try {
        await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: [{ Key: relativePath }] },
          }),
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`Failed to delete from S3: ${msg}`);
        throw new DataRepository.BackendError();
      }
    }

    public override async deleteDir(relativePath: string): Promise<void> {
      const objects = await this.listDir(relativePath).then((files) =>
        files.map((file) => ({ Key: file })),
      );

      if (objects.length > 0) {
        await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: objects },
          }),
        );
      }
    }

    public override async listDir(relativePath: string): Promise<string[]> {
      const params = {
        Bucket: this.bucket,
        Prefix: relativePath,
      };

      try {
        const response = await this.client.send(
          new ListObjectsV2Command(params),
        );
        if (response.Contents === undefined) {
          return [];
        }

        return response.Contents.map((obj) => obj.Key ?? '');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`Failed to list objects in S3: ${msg}`);
        throw new DataRepository.BackendError();
      }
    }
  }

  export class NotFound extends Error {
    constructor(which: string) {
      super(`No challenge data found for ${which}`);
    }
  }

  export class InvalidType extends Error {
    constructor() {
      super('Invalid challenge type');
    }
  }

  export class BackendError extends Error {
    constructor() {
      super('Failed to read/write challenge data');
    }
  }
}

/**
 * Translates protobuf NPC data into a map of room IDs to room NPCs.
 * @param npcs The list of NPCs to translate.
 * @returns Translated NPCs map.
 */
function npcsFromProto(npcs: ChallengeData.StageNpc[]): RoomNpcMap {
  const map: RoomNpcMap = {};

  npcs.forEach((npc) => {
    const roomNpc: RoomNpc = {
      type: RoomNpcType.BASIC,
      roomId: npc.getRoomId(),
      spawnNpcId: npc.getSpawnNpcId(),
      spawnTick: npc.getSpawnTick(),
      spawnPoint: {
        x: npc.getSpawnPoint()?.getX() ?? 0,
        y: npc.getSpawnPoint()?.getY() ?? 0,
      },
      deathTick: npc.getDeathTick(),
      deathPoint: {
        x: npc.getDeathPoint()?.getX() ?? 0,
        y: npc.getDeathPoint()?.getY() ?? 0,
      },
    };

    if (npc.hasMaidenCrab()) {
      roomNpc.type = RoomNpcType.MAIDEN_CRAB;
      (roomNpc as MaidenCrab).maidenCrab = npc.getMaidenCrab()!.toObject();
    }
    if (npc.hasNylo()) {
      roomNpc.type = RoomNpcType.NYLO;
      (roomNpc as Nylo).nylo = npc.getNylo()!.toObject();
    }
    if (npc.hasVerzikCrab()) {
      roomNpc.type = RoomNpcType.VERZIK_CRAB;
      (roomNpc as VerzikCrab).verzikCrab = npc.getVerzikCrab()!.toObject();
    }

    map[roomNpc.roomId] = roomNpc;
  });

  return map;
}

function npcsToProto(npcs: RoomNpcMap): ChallengeData.StageNpc[] {
  const protoNpcs: ChallengeData.StageNpc[] = [];

  Object.values(npcs).forEach((npc) => {
    const protoNpc = new ChallengeData.StageNpc();
    protoNpc.setSpawnNpcId(npc.spawnNpcId);
    protoNpc.setRoomId(npc.roomId);
    protoNpc.setSpawnTick(npc.spawnTick);
    protoNpc.setDeathTick(npc.deathTick);

    const spawnPoint = new CoordsProto();
    spawnPoint.setX(npc.spawnPoint.x);
    spawnPoint.setY(npc.spawnPoint.y);
    protoNpc.setSpawnPoint(spawnPoint);
    const deathPoint = new CoordsProto();
    deathPoint.setX(npc.deathPoint.x);
    deathPoint.setY(npc.deathPoint.y);
    protoNpc.setDeathPoint(deathPoint);

    switch (npc.type) {
      case RoomNpcType.BASIC:
        protoNpc.setBasic(new EmptyProto());
        break;
      case RoomNpcType.MAIDEN_CRAB: {
        const crab = (npc as MaidenCrab).maidenCrab;
        const maidenCrab = new EventProto.Npc.MaidenCrab();
        maidenCrab.setSpawn(
          crab.spawn as Proto<EventProto.Npc.MaidenCrab.SpawnMap>,
        );
        maidenCrab.setPosition(
          crab.position as Proto<EventProto.Npc.MaidenCrab.PositionMap>,
        );
        maidenCrab.setScuffed(crab.scuffed);
        protoNpc.setMaidenCrab(maidenCrab);
        break;
      }
      case RoomNpcType.NYLO: {
        const nylo = (npc as Nylo).nylo;
        const nyloProto = new EventProto.Npc.Nylo();
        nyloProto.setWave(nylo.wave);
        nyloProto.setParentRoomId(nylo.parentRoomId);
        nyloProto.setBig(nylo.big);
        nyloProto.setStyle(nylo.style as Proto<EventProto.Npc.Nylo.StyleMap>);
        nyloProto.setSpawnType(
          nylo.spawnType as Proto<EventProto.Npc.Nylo.SpawnTypeMap>,
        );
        protoNpc.setNylo(nyloProto);
        break;
      }
      case RoomNpcType.VERZIK_CRAB: {
        const crab = (npc as VerzikCrab).verzikCrab;
        const verzikCrab = new EventProto.Npc.VerzikCrab();
        verzikCrab.setPhase(crab.phase as Proto<EventProto.VerzikPhaseMap>);
        verzikCrab.setSpawn(
          crab.spawn as Proto<EventProto.Npc.VerzikCrab.SpawnMap>,
        );
        break;
      }
    }

    protoNpcs.push(protoNpc);
  });

  return protoNpcs;
}
