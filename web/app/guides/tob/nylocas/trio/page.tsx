import { ChallengeType } from '@blert/common';
import { ResolvingMetadata } from 'next';
import Link from 'next/link';

import Article from '@/components/article';
import YoutubeEmbed from '@/components/youtube-embed';
import GuideTags from '@/guides/guide-tags';
import { basicMetadata } from '@/utils/metadata';

import { Mage, Melee, Range } from '../nylos';

import guideStyles from '../../../style.module.scss';

export default function TrioNylo() {
  return (
    <Article.Page>
      <Article.Heading level={1} text="Trio Nylocas Waves" />
      <span className={guideStyles.authorCredits}>
        Originally written by Nick Ints, Aramaxis, and Lo Sugar. Maintained by
        the Blert community. POV VoDs by{' '}
        <Link href="https://www.youtube.com/@verix3983">Verix</Link> and{' '}
        <Link href="https://www.youtube.com/channel/UCrAY8CVj9-lxhG-4GML4gjg">
          Crayy
        </Link>
        .
      </span>
      <GuideTags challenge={ChallengeType.TOB} scale={3} level="max-eff" />

      <Article.Heading level={2} text="Overview" />
      <p>
        This guide is targeted at players learning max-eff trio moneys or
        speedruns. It assumes a base understanding of the room&apos;s mechanics,
        which you can learn in the{' '}
        <Link href="/guides/tob/nylocas/mechanics">
          Nylocas mechanics guide
        </Link>
        .
      </p>
      <Article.Heading level={3} text="Team goals" />
      <p>
        In trio waves, you are aiming for 2:55.2 or 2:57.6 boss spawn. Your goal
        is to:
      </p>
      <ol>
        <li>Avoid stalling at all until at least wave 28.</li>
        <li>
          Allow all the existing Nylos in the room to auto-pop once wave 28/29
          spawns.
        </li>
        <li>
          Kill all new Nylos after the wave 28 spawn (not including wave 28, but
          the Nylos that spawn afterwards&mdash;both splits and waves 29/30/31).
        </li>
      </ol>
      <p>
        With no mistakes, you should be able to avoid stalling until at least
        wave 28 almost 100% of the time.
      </p>
      <Article.Heading level={3} text="Plugins" />
      <p>
        Refer to the <Link href="/guides/tob/plugins">Plugins guide</Link> for
        information about setting up useful ToB plugins.
      </p>
      <p>
        The Nyloer plugin allows you to automatically dim every Nylo currently
        in the room at a specific wave by setting the{' '}
        <Link href="/guides/tob/plugins#nyloer-dimming">Darker Wave</Link>{' '}
        option within its <em>Font Settings</em> tab. This visually
        distinguishes relevant smalls from those which will automatically expire
        by certain time thresholds.
      </p>
      <Article.Notice type="info">
        <p>
          When playing for a 2:55.2 boss spawn, set your <em>Darker Wave</em> to{' '}
          <strong>28</strong>.
        </p>
      </Article.Notice>
      <p>
        Additionally, you can set a <em>Make Darker Hotkey</em> to manually dim
        existing Nylos. Dimming on the wave 22 spawn (1:45.6 room time) is
        recommended, as wave 22 and older Nylos will explode naturally before
        the stall check on 28, whereas killing Nylos spawning after 22 will help
        reduce stalls on the last few waves.
      </p>

      {/*
       * MAGE ROTATION
       */}
      <Article.Heading level={2} text="Mage Waves" />
      <Article.Heading level={3} idPrefix="mage" text="Pre-cap" />
      <Article.Heading level={4} idPrefix="mage" text="Waves 1-3" />
      <p>
        Ayak the <Mage>w1 south small</Mage>, <strong>ignore</strong> the w2
        west small, and Ayak <Mage>w3 east small</Mage>.
      </p>
      <Article.Heading level={4} idPrefix="mage" text="Wave 4" />
      <p>
        Ayak the <Mage>south big</Mage> first tick until it is dead, hugging the
        south barrier.
      </p>
      <Article.Heading level={4} idPrefix="mage" text="Wave 5" />
      <p>
        Ayak the <Mage>east small</Mage> until it is dead, then clean up any
        mages in the room. If the w5 west big split into two mages, prioritize
        the northern one.
      </p>
      <Article.Heading level={4} idPrefix="mage" text="Waves 6-7" />
      <p>
        Ayak the <Mage>w6 west small</Mage>, then the{' '}
        <Mage>w7 south small</Mage>. Blowpipe the south rangers if they are
        still alive, prioritizing the big.
      </p>
      <Article.Heading level={4} idPrefix="mage" text="Waves 8-9" />
      <p>
        Ayak the <Mage>wave 8 west big</Mage> until it is dead.
      </p>
      <ul>
        <li>
          If it takes 1 Ayak, switch to ranged gear and bow the{' '}
          <Range>9 west big</Range>.
        </li>
        <li>
          If it takes 2 Ayaks, bow the <Range>9 west big</Range> once.
        </li>
        <li>If it takes 3 or more Ayaks, Blowpipe the ranged big once.</li>
      </ul>
      <p>
        Ayak the <Mage>9 east small</Mage>. If you managed to one-shot the 8
        big, Ayak another small in the room.
      </p>
      <Article.Heading level={4} idPrefix="mage" text="Waves 10-12" />
      <p>
        Bow the <Range>10 east big</Range> once, then Blowpipe the{' '}
        <Range>10 east small</Range> once.
      </p>
      <p>
        Barrage the <Mage>11 east doubles</Mage>, then the{' '}
        <Mage>11 south doubles</Mage>. If you one-hit both sets of doubles, Ayak
        a small mage from the 10 east big or 11 west big.
      </p>
      <p>
        If there are only 2 smalls in the room, Scythe the{' '}
        <Melee>12 south melee big</Melee>. Hit remaining smalls.
      </p>
      <Article.Heading level={4} idPrefix="mage" text="Waves 13-15" />
      <p>
        Ayak the <Mage>13 west small</Mage>, the <Mage>14 west small</Mage>, and
        the <Mage>14 south small</Mage>. Ayak the{' '}
        <Mage>15 east mage small</Mage> and Blowpipe the{' '}
        <Range>15 west ranged small</Range> if your ranger hasn&apos;t killed
        it.
      </p>
      <Article.Heading level={4} idPrefix="mage" text="Waves 16-19" />
      <p>
        Ayak the <Mage>16 east small</Mage>, the <Mage>17 east big</Mage>, then
        kill splits in the room.
      </p>
      <p>
        When wave 19 spawns, Sang the <Mage>19 east mage big</Mage> on the
        second tick standing one tile away from the east barrier to increase the
        projectile&apos;s travel time, causing its splits to spawn after the
        wave 20 check. Follow up by Ayaking the <Mage>19 west big</Mage>, then
        the <Mage>19 south big</Mage> in lane.
      </p>
      <Article.Notice>
        In a proficient team, if the 12 big was popped and the room state is
        clean, you can Ayak the 17 south big before cleaning up splits. Be ready
        to Ayak the 19 big two ticks after it spawns.
      </Article.Notice>
      <Article.Heading level={3} idPrefix="mage" text="Post-cap" />
      <Article.Heading level={4} idPrefix="mage" text="Wave 20" />
      <p>
        Ayak the <Mage>20 south mage big</Mage>, ideally on the first tick. If
        you attack on the first tick and it doesn&apos;t die, you can hit a
        second Ayak before it flickers. Otherwise, Blowpipe it when it flickers,
        then Scythe to finish it off.
      </p>
      <p>
        If the big dies in one Ayak, you can do 4 more Ayaks before wave 21,
        prioritizing any remaining bigs.
      </p>
      <Article.Heading level={4} idPrefix="mage" text="Waves 21-23" />
      <p>
        Barrage the <Mage>21 west doubles</Mage>. Then, either Ayak a small in
        the room or Barrage once if you see a value clump. Barrage value here is
        good if the room appears full.
      </p>
      <p>
        Ayak the <Mage>22 east big</Mage>.
      </p>
      <ul>
        <li>
          If it dies in one Ayak, Ayak 2 smalls in the room. You can look for
          another value Barrage to push waves if the room is full.
        </li>
        <li>
          If it does not die, Scythe it on the first tick it enters the room, or
          Claw scratch if it is low HP.
        </li>
      </ul>
      <p>
        Ayak the <Mage>23 east big</Mage>. If your ranger didn&apos;t kill the{' '}
        <Range>23 south big</Range>, Ayak it when it flickers. Otherwise, hit a
        small.
      </p>
      <Article.Heading level={4} idPrefix="mage" text="Waves 24-27" />
      <p>
        During these waves, your job is to quickly kill all of the mage bigs
        which spawn to get their splits out early.
      </p>
      <ul>
        <li>
          Ayak the <Mage>24 south big</Mage> until it dies.
        </li>
        <li>
          Ayak the <Mage>25 east big</Mage>. If you attack on the first tick it
          spawns, you can get a second Ayak before it flickers. If you one-shot
          it, Ayak a small in the room while moving west.
        </li>
        <li>
          Ayak the <Mage>26 west big</Mage> once. If it dies in one Ayak, hit a
          small before hitting 27.
        </li>
        <li>
          Ayak the <Mage>27 west big</Mage> until it dies. Return to the{' '}
          <Mage>26 west big</Mage> if your previous Ayak didn&apos;t kill it.
        </li>
        <li>
          Ayak the <Mage>27 east big</Mage> until it dies.
        </li>
        <li>
          Kill the <Mage>26 east big</Mage> on the northeast pillar. There are
          often mage splits around it allowing you to Barrage.
        </li>
      </ul>
      <Article.Heading level={4} idPrefix="mage" text="Waves 28-29" />
      <p>
        Finish off any remaining mage bigs, while looking out for high value
        Barrages. Continue Ayaking smalls with the highest wave number.
      </p>
      <Article.Heading level={4} idPrefix="mage" text="Waves 30-31" />
      <p>
        Kill the <Mage>30 east big</Mage> as quickly as possible, followed by
        the <Mage>31 east small</Mage>. If the 30 dies in one hit, you can
        Blowpipe both the 31 east smalls (the mage flickers ranged) to help your
        ranger.
      </p>
      <Article.Heading level={3} idPrefix="mage" text="Cleanup" />
      <ul>
        <li>
          Prioritize cleaning up the north side of the room after the 31s are
          dead. Look for high value Barrages, but avoid clumps with dimmed
          Nylos.
        </li>
        <li>
          If a dimmed and undimmed Nylo are stacked, right click and target the
          bottom one in the menu, as it is the newest.
        </li>
        <li>
          When Ayaking or Barraging, move as close as possible to your targets
          to minimize projectile travel time.
        </li>
      </ul>
      <Article.Heading level={3} idPrefix="mage" text="Example POV" />
      <YoutubeEmbed id="z3Zrlr0-0K4" />

      {/*
       * RANGER ROTATION
       */}
      <Article.Heading level={2} text="Ranger Waves" />
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
        on). Hover the splits that will spawn from the wave 4 mage big and the
        wave 5 ranged big, prioritizing the ranged and mage splits. You can
        Blowpipe 2 splits and tick-perfectly chin into bow the{' '}
        <Range>wave 6 ranged small</Range> and <Range>wave 7 big</Range>.
      </p>
      <Article.Heading level={4} idPrefix="ranger" text="Waves 8-10" />
      <p>
        Path west and stand 1 tile away from the west barrier. Ayak the{' '}
        <Mage>8 mage big</Mage> then chin the <Range>9 ranged big</Range>. If
        the mage big lives, let the mage finish it; bow the 9 ranged big
        instead.
      </p>
      <p>
        After attacking the 9 ranged big, move east and Blowpipe the{' '}
        <Range>8 ranged small</Range> that is now entering the room. Afterwards,
        return to the west, killing splits along the way.
      </p>
      <p>
        Chin the <Range>wave 10 west and south doubles</Range>, then clean up
        any ranged smalls that lived. You can chin west and south then do 1
        Blowpipe before first tick Ayaking the <Mage>11 west mage big</Mage>. If
        you noodled on the chins, prioritize cleaning up the room before Ayaking
        the mage big.
      </p>
      <Article.Heading level={4} idPrefix="ranger" text="Waves 11-12" />
      <p>
        Continue killing splits and be ready to Scythe the{' '}
        <Melee>wave 12 west melee</Melee> doubles. If your melee one-shot the
        wave 11 mage big, its splits will spawn in front of your wave 12 melee
        doubles, so you can Blowpipe 1 or 2 of these before you Scythe.
      </p>
      <p>
        Stand one tile back from the barrier after Scything the doubles. If you
        wait briefly after Scything the double before switching back to your
        ranged gear, you will automatically be pushed back 1 tile. You can see
        this in the <Link href="#ranger-example-pov">example VOD</Link>.
      </p>
      <Article.Heading level={4} idPrefix="ranger" text="Wave 13" />
      <p>
        Blowpipe the <Range>west wave 13 ranged small</Range> and path
        diagonally toward the south. Kill the{' '}
        <Range>south wave 13 ranged small</Range> along with any ranged splits
        in the room.
      </p>
      <Article.Heading level={4} idPrefix="ranger" text="Waves 14-15" />
      <p>
        Pay attention to how far ahead your mage is. If they are behind, Ayak
        the <Mage>wave 14 south small</Mage> then Blowpipe the{' '}
        <Range>ranged small</Range> next to it and move east. Blowpipe the{' '}
        <Range>14 east ranged big</Range> if you are ahead. Otherwise, Ayak the{' '}
        <Mage>15 east mage small</Mage> and Blowpipe the{' '}
        <Range>ranged small</Range> next to it before killing the 14 big.
      </p>
      <Article.Heading level={4} idPrefix="ranger" text="Waves 16-17" />
      <p>
        If you didn&apos;t noodle on previous waves, you can blowpipe the{' '}
        <Range>15 west ranged small</Range> or chin the incoming{' '}
        <Range>wave 16 ranged small</Range> before it flashes then Ayak the{' '}
        <Mage>wave 17 west mage big</Mage> before it flashes as well.
      </p>
      <Article.Heading level={4} idPrefix="ranger" text="Waves 18-20" />
      <p>
        Kill splits from the 17 big(s) while waiting for the 18 big rangers to
        come into the room. Blowpipe the <Range>west 18 big aggro</Range> on{' '}
        <Article.Tooltip text="When the wave 19 mage bigs flicker melee. The ranged big will be roughly in the center of the room.">
          tick 14
        </Article.Tooltip>{' '}
        so splits spawn after the cap increase. Kill the other 2 after the west
        one is dead. If you kill these early enough, hit splits until the{' '}
        <Melee>wave 20 west big</Melee> flashes green then bow it.
      </p>
      <Article.Notice>
        <p>
          Proficient teams can opt to play waves 17&ndash;20 more aggressively
          depending on the room state.
        </p>
        <ul>
          <li>
            If the 12 melee big is killed, you can commit to killing the 17 west
            mage big.
          </li>
          <li>
            If the 17 east and west mage bigs are killed, you should clean up
            splits before bowing the 18 west ranged big when it spawns. Continue
            kiling splits until the 19 mage bigs are about to flash melee, then
            kill the rest of the 18 ranged bigs.
          </li>
          <li>
            If the room is not clean enough to bow the 18 west ranged big, clean
            splits until wave 19 spawns. Wait 2 ticks then Ayak the 19 south
            mage big and start killing all the 18 ranged bigs. (Tip: Blowpipe a
            non-aggro 18 big before Blowpiping the west aggro big to prevent
            overkill from Veng/thralls.)
          </li>
        </ul>
      </Article.Notice>
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
      <p>
        A more advanced method is to Claw spec the <Melee>20 west big</Melee>,
        then fill 5 ticks worth of attacks before first tick chinning the{' '}
        <Range>east wave 21 ranged doubles</Range>. Cast Death Charge any time
        after the Claw spec to regen 100 spec for the boss.
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
        <Range>wave 25 south ranged big</Range> if the room is clean. If you
        one-shot the wave 23 south range big earlier, its splits will spawn in
        the lane and you should Blowpipe one of these if either are range. If
        the room is not clean, clean up some smalls before Blowpiping the 25
        south ranged big.
      </p>
      <Article.Heading level={4} idPrefix="ranger" text="Waves 26-27" />
      <p>
        After you bow the wave 25 south big, start cleaning up any range splits
        you see. Don&apos;t get baited into killing splits that will soon expire
        (any splits from wave 20 or 21 will expire before 28 check), and try to
        stay on tick with the room (Blowpipe will keep you on tick with the room
        assuming you don&apos;t lose any ticks; if you chin or Ayak, you will
        have to either do a second chin/Ayak or lose a tick). Kill the{' '}
        <Range>wave 27 south big</Range> once it turns green.
      </p>
      <p>
        A more advanced method you can use if the room is clean after killing
        the 25 south ranged big is to help Ayak the 26 or 27 east mage bigs
        before Blowpiping the 27 south ranged big once it turns green.
      </p>
      <Article.Heading level={4} idPrefix="ranger" text="Waves 28-29" />
      <p>
        Start looking for ranged/mage splits that spawned after wave 28 while
        making your way west, and prioritize Blowpiping or Ayaking these instead
        of the wave 28 south flashers (which will expire in cleanup). Kill
        splits on the east side of the room first as you move west.
      </p>
      <p>
        Blowpipe the wave 29 west flashers. Your team will likely stall after
        this. Stay on the west side of the room and hit splits/smalls that
        spawned after wave 28 while staying on tick (you are on tick with the
        room after Blowpiping the 29 flashers).
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
      <p>
        Alternatively, if wave 29 stalled and you are waiting for wave 30 after
        running out of new splits to kill, you can first tick Blowpipe the wave
        30 west ranged big from the barrier, then run 4 tiles back to chin the
        wave 30 south doubles.
      </p>
      <Article.Heading level={3} idPrefix="ranger" text="Cleanup" />
      <p>
        Kill any wave 29/31 smalls first as these will change color if you
        don&apos;t kill them quickly enough. Don&apos;t get baited into chinning
        a clump with 28s in it as 28s will expire. After killing any 29+
        rangers, look to kill other colors (mage &gt; melee), working from the
        south to the north side.
      </p>
      <Article.Heading level={3} idPrefix="ranger" text="Example POV" />
      <YoutubeEmbed id="i5o31g" source="streamable" />

      {/*
       * MELEE ROTATION
       */}
      <Article.Heading level={2} text="Melee Waves" />
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
      <Article.Heading level={3} idPrefix="melee" text="Example POV" />
      <YoutubeEmbed id="Zg9wZKUWk7o" />
    </Article.Page>
  );
}

export async function generateMetadata(
  _props: object,
  parent: ResolvingMetadata,
) {
  return basicMetadata(await parent, {
    title: 'OSRS ToB Trio Nylocas Guide - Mage, Range & Melee Rotations',
    description:
      'Complete Theatre of Blood Trio Nylocas guide with optimal mage, range, ' +
      'and melee rotations, wave timings, and strategies for max efficiency runs.',
  });
}
