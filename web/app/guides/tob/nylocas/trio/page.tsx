import { ChallengeType } from '@blert/common';
import { ResolvingMetadata } from 'next';
import Link from 'next/link';

import Article from '@/components/article';
import GuideTags from '@/guides/guide-tags';
import { basicMetadata } from '@/utils/metadata';

function Mage({ children }: { children: React.ReactNode }) {
  return <span style={{ color: '#42c6d7' }}>{children}</span>;
}

function Range({ children }: { children: React.ReactNode }) {
  return <span style={{ color: '#408d43' }}>{children}</span>;
}

function Melee({ children }: { children: React.ReactNode }) {
  return <span style={{ color: '#fff' }}>{children}</span>;
}

export default function TrioNylo() {
  return (
    <Article.Page>
      <Article.Heading level={1} text="Trio Nylocas Waves" />
      <em>Written by Nick Ints, Aramaxis, and Lo Sugar</em>
      <GuideTags challenge={ChallengeType.TOB} scale={3} level="max-eff" />
      <Article.TableOfContents />

      <Article.Heading level={2} text="Overview" />
      <p>
        This guide is targeted at players learning max-eff trio moneys or
        speedruns, and assumes a base understanding of the Nylocas room
        mechanics. Teams following these rotations should consistently be
        getting boss spawns below 3:04.8, with 2:57.6 being a good target to
        demonstrate proficiency in a role.
      </p>
      {/*<Article.Heading level={3} text="Team priorities" />
      <p>
        In cleanup, the melee starts south while the mage and ranger start
        north. Everyone should prioritize Nylos of their style, then assist
        their teammates with Nylos of other styles in different areas of the
        room.
      </p>*/}
      <Article.Heading level={3} text="Plugins" />
      <p>
        Refer to the <Link href="/guides/tob/plugins">Plugins guide</Link> for
        information about setting up useful ToB plugins.
      </p>
      <p>
        Setting a <em>Make Darker Hotkey</em> in the Nyloer plugin allows you to
        dim every Nylo currently in the room, helping to distinguish relevant
        smalls to attack from those which will automatically expire by certain
        time thresholds.
      </p>
      <p>
        Dimming when wave 23 spawns will hide Nylos expiring before the wave 28
        check. If playing for 2:55 or 2:57 boss spawns, dim on wave 28 to know
        which Nylos to ignore during cleanup.
      </p>

      {/*
       * MAGE ROTATION
       */}
      <Article.Heading level={2} text="Mage" />
      <Article.Heading level={3} idPrefix="mage" text="Pre-cap" />
      <Article.Heading level={4} idPrefix="mage" text="Waves 1-3" />
      <p>
        Sang the <Mage>w1 south small</Mage>, the <Mage>w2 west small</Mage>,
        and the <Mage>w3 east small</Mage>.
      </p>
      <Article.Heading level={4} idPrefix="mage" text="Wave 4" />
      <p>
        Sang the <Mage>south big</Mage> until it is dead, hugging the south
        barrier.
      </p>
      <Article.Heading level={4} idPrefix="mage" text="Wave 5" />
      <p>
        Sang the <Mage>east small</Mage> until it is dead, then clean up any
        mages in the room. If the w5 west big split into two mages, prioritize
        the northern one.
      </p>
      <Article.Heading level={4} idPrefix="mage" text="Waves 6-7" />
      <p>
        Sang the <Mage>w6 east small</Mage>, then the{' '}
        <Mage>w7 south small</Mage>. Blowpipe the south rangers if they are
        still alive, prioritizing the big.
      </p>
      <Article.Heading level={4} idPrefix="mage" text="Waves 8-9" />
      <p>
        Sang the <Mage>wave 8 west big</Mage> until it is dead.
      </p>
      <ul>
        <li>
          If it takes 1 Sang, switch to ranged gear and bow the{' '}
          <Range>9 west big</Range>.
        </li>
        <li>
          If it takes 2 Sangs, Blowpipe the <Range>9 west big</Range> twice.
        </li>
        <li>If it takes 3 or more Sangs, ignore the ranged big.</li>
      </ul>
      <p>
        Sang the <Mage>9 east small</Mage>. If you managed to one-shot the 8
        big, Sang another small in the room.
      </p>
      <Article.Heading level={4} idPrefix="mage" text="Waves 10-12" />
      <p>
        Bow the <Range>10 east big</Range> once, then Blowpipe the{' '}
        <Range>10 east small</Range> once.
      </p>
      <p>
        Barrage the <Mage>11 east doubles</Mage>, then the{' '}
        <Mage>11 south doubles</Mage>. If you one-hit both sets of doubles, Sang
        a small mage from the 10 east big or 11 west big.
      </p>
      <p>
        If there are only 2 smalls in the room, Claw spec the{' '}
        <Melee>12 south melee big</Melee>. Equip a Lightbearer to regenerate
        100% spec for the boss. Otherwise, hit remaining smalls.
      </p>
      <Article.Heading level={4} idPrefix="mage" text="Waves 13-15" />
      <p>
        Sang the <Mage>13 west small</Mage>, the <Mage>14 west small</Mage>, and
        the <Mage>14 south small</Mage>. Sang the{' '}
        <Mage>15 east mage small</Mage> and Blowpipe the{' '}
        <Range>15 west ranged small</Range> if your ranger hasn&apos;t killed
        it.
      </p>
      <Article.Heading level={4} idPrefix="mage" text="Waves 16-19" />
      <p>
        Sang the <Mage>16 east small</Mage>, the <Mage>17 east big</Mage>, then
        kill splits in the room.
      </p>
      <p>
        When wave 19 spawns, Sang the <Mage>19 east mage big</Mage> on the first
        tick standing one tile away from the east barrier to increase the
        projectile&apos;s travel time, causing its splits to spawn after the
        wave 20 check. Follow up by Sanging the <Mage>17 south big</Mage> on the
        southeast pillar, then the <Mage>19 south big</Mage> in lane.
      </p>
      <Article.Heading level={3} idPrefix="mage" text="Post-cap" />
      <Article.Heading level={4} idPrefix="mage" text="Wave 20" />
      <p>
        Sang the <Mage>20 south mage big</Mage> on the first tick.
      </p>
      <ul>
        <li>
          If you one-shot it, do 3 more Sangs before wave 21, prioritizing any
          remaining bigs.
        </li>
        <li>
          If it doesn&apos;t die, Blowpipe it when it flickers, then Scythe to
          finish it off.
        </li>
      </ul>
      <Article.Heading level={4} idPrefix="mage" text="Waves 21-23" />
      <p>
        Barrage the <Mage>21 west doubles</Mage>. Then, either Sang a small in
        the room or barrage once if you see a value clump.
      </p>
      <p>
        Sang the <Mage>22 east big</Mage>.
      </p>
      <ul>
        <li>If it dies in one Sang, Sang 2 smalls in the room.</li>
        <li>
          If it does not die, Scythe it on the first tick it enters the room.
        </li>
      </ul>
      <p>
        Sang the <Mage>23 east big</Mage>. If your ranger didn&apos;t kill the{' '}
        <Range>23 south big</Range>, Sang it when it flickers. Otherwise, hit a
        small.
      </p>
      <Article.Heading level={4} idPrefix="mage" text="Waves 24-27" />
      <p>
        During these waves, your job is to quickly kill all of the mage bigs
        which spawn to get their splits out early.
      </p>
      <ul>
        <li>
          Sang the <Mage>24 south big</Mage> until it dies.
        </li>
        <li>
          Sang the <Mage>25 east big</Mage> until it dies. (If you attack on the
          first tick it spawns, it will flicker melee at the time of the second
          Sang.)
        </li>
        <li>
          Sang the <Mage>26 west big</Mage> until it dies.
        </li>
        <li>
          Sang the <Mage>27 west big</Mage> until it dies.
        </li>
        <li>
          Barrage the <Mage>26 east big</Mage> alongside any splits on the
          northeast pillar.
        </li>
        <li>
          Sang the <Mage>27 east big</Mage> until it dies.
        </li>
      </ul>
      <Article.Heading level={4} idPrefix="mage" text="Waves 28-29" />
      <p>
        Finish off any remaining mage bigs, while looking out for high value
        barrages. Continue Sanging smalls with the highest wave number.
      </p>
      <Article.Heading level={4} idPrefix="mage" text="Waves 30-31" />
      <p>
        Kill the <Mage>30 east big</Mage> as quickly as possible, followed by
        the <Mage>31 east small</Mage>.
      </p>
      <Article.Heading level={3} idPrefix="mage" text="Cleanup" />
      <p>
        During cleanup, you should primarily focus the north side of the room,
        prioritizing high value barrages and Nylos with the highest wave number.
        When Sanging or barraging, try to run up as close as possible to your
        targets to minimize projectile travel time.
      </p>

      {/*
       * RANGER ROTATION
       */}
      <Article.Heading level={2} text="Ranger" />
      <Article.Heading level={3} idPrefix="ranger" text="Pre-cap" />
      <Article.Heading level={4} idPrefix="ranger" text="Waves 1-3" />
      <p>
        Bow the <Range>w1 west small</Range>, the <Range>w2 east small</Range>,
        and the <Range>w3 south small</Range>.
      </p>
      <Article.Heading level={4} idPrefix="ranger" text="Waves 4-7" />
      <p>
        Blowpipe the <Range>wave 4 west small</Range> and bow the{' '}
        <Range>wave 5 big</Range> behind it (which your melee will double up
        on). Claw scratch the <Melee>wave 5 south melee small</Melee>. The
        splits will spawn from the wave 4 mage big the same tick you claw
        scratch this (if the mage one-shots it), so be careful not to null. Kill
        any ranged splits from the wave 4 mage big and the wave 5 ranged big.
        You can Blowpipe 2 splits and tick perfectly chin into bow the{' '}
        <Range>wave 6 ranged small</Range> and <Range>wave 7 big</Range>.
      </p>
      <Article.Heading level={4} idPrefix="ranger" text="Waves 8-10" />
      <p>
        Path east and be ready to kill the <Range>wave 8 ranged small</Range>{' '}
        and splits from the wave 6 melee big and wave 7 ranged big. You can claw
        scratch the <Melee>east wave 7 melee small</Melee> if your meleer
        didn&apos;t one shot the wave 6 big.
      </p>
      <p>
        Continue killing splits and be ready to Blowpipe the{' '}
        <Range>wave 9 ranged big</Range> if your mage didn&apos;t kill it. Chin
        the <Range>wave 10 west and south doubles</Range>, and Blowpipe anything
        your mage didn&apos;t kill from the east.
      </p>
      <Article.Heading level={4} idPrefix="ranger" text="Waves 11-12" />
      <p>
        Continue killing splits and be ready to Scythe the{' '}
        <Melee>wave 12 west melee</Melee> doubles. If your melee one-shot the
        wave 11 mage big, its splits will spawn in front of your wave 12 melee
        doubles, so you can Blowpipe 1 or 2 of these before you Scythe.
      </p>
      <Article.Heading level={4} idPrefix="ranger" text="Wave 13" />
      <p>
        Pipe the <Range>west wave 13 ranged small</Range> and make your way
        south. Kill the <Range>south wave 13 ranged small</Range>, along with
        any ranged splits in the room.
      </p>
      <Article.Heading level={4} idPrefix="ranger" text="Waves 14-15" />
      <p>
        Pay attention to how far ahead your mage is. If they are behind, Sang
        the <Mage>wave 14 south small</Mage> then pipe the{' '}
        <Range>ranged small</Range> next to it and move east. Pipe the{' '}
        <Range>15 east ranged small</Range> then kill the{' '}
        <Range>14 ranged big aggro</Range> immediately after it enters the room
        and make your way west to kill the <Range>wave 15 ranged small</Range>.
      </p>
      <Article.Heading level={4} idPrefix="ranger" text="Waves 16-17" />
      <p>
        If you didn&apos;t noodle on previous waves, you can chin the incoming{' '}
        <Range>wave 16 ranged small</Range> before it flashes then Sang the{' '}
        <Mage>wave 17 west mage big</Mage> before it flashes as well.
      </p>
      <Article.Heading level={4} idPrefix="ranger" text="Waves 18-20" />
      <p>
        Kill splits from the 17 big(s) while waiting for the 18 big rangers to
        come into the room. Blowpipe the <Range>west 18 big aggro</Range> on
        tick 14 so splits spawn after the cap increase. Kill the other 2 after
        the west one is dead. If you kill these early enough, hit splits until
        the <Melee>wave 20 west big</Melee> flashes green then bow it.
      </p>
      <Article.Heading level={3} idPrefix="ranger" text="Post-cap" />
      <Article.Heading level={4} idPrefix="ranger" text="Waves 21-22" />
      <p>
        After you bow the 20 west big, you can do 6-8 ticks worth of attacks and
        then chin the <Range>east wave 21 ranged doubles</Range>. 6 ticks of
        attacks will let you chin them tick perfect; you don&apos;t want to do
        more than 8 or you will chin after the wave 22 check. After you chin,
        kill splits in the room until the <Melee>wave 22 west big</Melee>{' '}
        flashes green and bow it.
      </p>
      <Article.Heading level={4} idPrefix="ranger" text="Waves 23-25" />
      <p>
        After bowing the 22 west big, make your way to the south lane. You can
        do 1 Blowpipe then bow the <Range>south wave 23 ranged big</Range> tick
        perfect. After you bow it, run west and kill the right (N) then left (S)
        smalls as they flash ranged. Bow the <Range>24 west big</Range> after
        the second Blowpipe.
      </p>
      <p>
        Head south. You can do 1 Blowpipe before bowing the{' '}
        <Range>wave 25 south big</Range>. If you one-shot the wave 23 south
        range big earlier, its splits will spawn in the lane and you should
        Blowpipe one of these if either are range.
      </p>
      <Article.Heading level={4} idPrefix="ranger" text="Waves 26-27" />
      <p>
        After you bow the wave 25 south big, start cleaning up any range splits
        you see. Don&apos;t get baited into killing splits that will soon expire
        (any splits from wave 20 or 21 will expire before 28 check), and try to
        stay on tick with the room (Blowpipe or Sang will keep you on tick with
        the room assuming you don&apos;t lose any ticks; if you chin, you will
        have to either throw a second chin or lose a tick). Kill the{' '}
        <Range>wave 27 south big</Range> once it turns green.
      </p>
      <Article.Heading level={4} idPrefix="ranger" text="Waves 28-29" />
      <p>
        Start looking for splits that spawned after wave 28 while making your
        way west, and Blowpipe these instead of the wave 28 south flashers
        (which will expire in cleanup). Blowpipe the wave 29 west flashers. Your
        team will likely stall after this. Stay on the west side of the room and
        hit splits/smalls that spawned after wave 28 while staying on tick (you
        are on tick with the room after Blowpiping the 29 flashers).
      </p>
      <Article.Heading level={4} idPrefix="ranger" text="Waves 30-31" />
      <p>
        When wave 30 spawns, Blowpipe the <Range>west ranged big</Range> from 2
        tiles off the lane, then run 2 tiles back and chin the wave 30 south
        doubles when they flash green (you must be on tick with the room for
        this; make sure you target the eastern Nylo of the doubles). Blowpipe
        the wave 31 west flashers, then chin the <Range>31 south doubles</Range>
        .
      </p>
      <Article.Heading level={3} idPrefix="ranger" text="Cleanup" />
      <p>
        Kill any wave 31 smalls first as these will change color if you
        don&apos;t kill them quickly enough. Don&apos;t get baited into chinning
        a clump with 28s in it as 28s will expire. After killing any 29+
        rangers, look to kill other colors, prioritizing the north side.
      </p>

      {/*
       * MELEE ROTATION
       */}
      <Article.Heading level={2} text="Melee" />
      <Article.Heading level={3} idPrefix="melee" text="Pre-cap" />
      <Article.Heading level={4} idPrefix="melee" text="Waves 1-5" />
      <p>
        Sang the <Mage>wave 1 south mage</Mage>, swift the{' '}
        <Melee>east small</Melee>, sang the <Mage>south wave 4 big</Mage> and
        then bow the <Range>west wave 5 ranged big</Range>. Kill the{' '}
        <Melee>melee aggro from wave 2</Melee>, and then the splits from the big
        mage south. Hit splits from west ranged big until wave 6 enters the
        lane.
      </p>
      <Article.Heading level={4} idPrefix="melee" text="Waves 6-9" />
      <p>
        Claw the <Melee>wave 6 east big</Melee> as soon as it enters the room,
        then swift <Melee>the small</Melee> behind it. If you intend to
        Dinh&apos;s spec later, scythe the big instead. After killing the small,
        the splits from the w6 big you just killed and the ranged south big will
        spawn: first, kill any melee splits from the east big melee before
        pathing south to hit the ranged big&apos;s splits and the{' '}
        <Melee>wave 8 melee small</Melee>. Then, go west for the{' '}
        <Melee>wave 9 melee</Melee>.
      </p>
      <Article.Heading level={4} idPrefix="melee" text="Wave 10" />
      <p>
        Clean up splits from the wave 8 and 9 bigs while your ranger and mage
        deal with wave 10.
      </p>
      <Article.Heading level={4} idPrefix="melee" text="Wave 11" />
      <p>
        Sang or{' '}
        <Article.Tooltip
          text={
            "The dragonfire shield's special effect is used by players " +
            "attempting Nylo wave speedruns. If you're just running regular " +
            'raids, ignore this.'
          }
        >
          DFS
        </Article.Tooltip>{' '}
        the <Mage>west big mage aggro</Mage>, then path east to hit splits from
        the wave 10 east big.
      </p>
      <Article.Heading level={4} idPrefix="melee" text="Wave 12" />
      <p>
        Scythe the <Melee>east melee doubles</Melee>. If they survive, finish
        them with your Swift, then head south for wave 13.
      </p>
      <Article.Heading level={4} idPrefix="melee" text="Wave 13" />
      <p>
        Swift the <Melee>south melee</Melee>, filling ticks on the splits from
        the w10 or w11 bigs (or Blowpipe the <Range>south w13</Range> in the
        lane). Leave the <Melee>w13 big melee aggro</Melee> until tick 22, then
        kill it (clicking on tick 21). You can base when to kill it off of where
        wave 15 is in the lane.
      </p>
      <Article.Heading level={4} idPrefix="melee" text="Waves 14-15" />
      <p>
        Kill the <Melee>w14 west small</Melee>, pop your delayed wave 13 big,
        then kill the <Melee>w15 west small</Melee>.
      </p>
      <Article.Heading level={4} idPrefix="melee" text="Waves 16-17" />
      <p>
        If the room looks clean, and especially if your mage killed the wave 12
        big, Sang or DFS the <Mage>w17 west big mage</Mage> in the lane.
        Otherwise, help with splits and any w16s.
      </p>
      <Article.Heading level={4} idPrefix="melee" text="Wave 18" />
      <p>
        Kill splits from any popped w17 bigs while waiting for wave 19 to spawn,
        and clean up other splits in room if necessary.
      </p>
      <Article.Heading level={4} idPrefix="melee" text="Wave 19" />
      <p>
        For the wave 20 check, 1 w15, 3 w18s and 3 w19s will always be alive
        (7/12). This means that the number of smalls you can have in the room
        depends on how many of the wave 17 bigs were killed:
      </p>
      <ul>
        <li>All 3 w17s died: up to 4 smalls</li>
        <li>2 w17s died: up to 3 smalls</li>
        <li>1 w17 died: up to 2 smalls</li>
      </ul>
      <p>
        Prioritize killing smalls until you get below this threshold. If you
        recognize that you are not going to stall, sang the <Mage>west 19</Mage>{' '}
        in the lane and start helping with other 18s/19s.
      </p>
      <Article.Heading level={3} idPrefix="melee" text="Post-cap" />
      <Article.Heading level={4} idPrefix="melee" text="Waves 20-22" />
      <p>
        Kill the <Melee>east big</Melee> (Scythe or Blowpipe{' '}
        <i className="fas fa-arrow-right" /> Swift). If the mage and ranger have
        not managed to kill the south and west bigs, finish them off. Splits
        need to spawn by 1:45.6 to expire before the stall check on wave 28.
        After these bigs hit stuff in the room until it&apos;s time to Scythe
        the <Melee>21 and 22 south doubles</Melee>.
      </p>
      <Article.Heading level={4} idPrefix="melee" text="Wave 23" />
      <p>
        Focus the splits from the new bigs your mage and ranger should have just
        killed, ignoring any Nylos from wave 22 or before. Finish the{' '}
        <Melee>east 23 big</Melee> if the mage noodled.
      </p>
      <Article.Heading level={4} idPrefix="melee" text="Waves 24-26" />
      <p>
        Scythe the <Melee>w24 east big aggro</Melee> as soon as it enters the
        room then Swift something. Scythe the <Melee>w25 west big aggro</Melee>{' '}
        then Swift something. Scythe the <Melee>w26 south big</Melee>.
      </p>
      <Article.Heading level={4} idPrefix="melee" text="Waves 27-28" />
      <p>
        By the time you kill the 26 big, 28 should have spawned. A lot of bigs
        will just have died and be spawning splits. Kill as many of the splits
        that spawned after wave 28 as you can until it&apos;s time to hit wave
        29.
      </p>
      <Article.Heading level={4} idPrefix="melee" text="Wave 29" />
      <p>
        Kill the <Melee>south big melee</Melee> on the first tick possible, then
        go east to kill the <Melee>small melee</Melee> from the same wave before
        it turns.
      </p>
      <Article.Heading level={4} idPrefix="melee" text="Wave 30" />
      <p>
        If the ranger didn&apos;t kill both of the south 30s, make sure they are
        dead before they turn.
      </p>
      <Article.Heading level={3} idPrefix="melee" text="Cleanup" />
      <p>
        At this point, kill all relevant melees starting from the south. Fill
        ticks on rangers or mages at your discretion if you need to. Ranger and
        or mage should help with north melees if they finish before you; if you
        finish the melees first, help them as needed.
      </p>
    </Article.Page>
  );
}

export async function generateMetadata(_props: {}, parent: ResolvingMetadata) {
  return basicMetadata(await parent, {
    title: 'Theatre of Blood Guides',
    description: 'Browse top-tier guides for the Theatre of Blood.',
  });
}
