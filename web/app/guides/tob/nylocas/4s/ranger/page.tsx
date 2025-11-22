import { ChallengeType } from '@blert/common';
import { ResolvingMetadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';

import Article from '@/components/article';
import YoutubeEmbed from '@/components/youtube-embed';
import GuideTags from '@/guides/guide-tags';
import { basicMetadata } from '@/utils/metadata';

import { Mage, Melee, Range } from '../../nylos';
import RoleLinks from '../role-links';

import guideStyles from '../../../../style.module.scss';

export default function RangerNyloGuide() {
  return (
    <Article.Page>
      <Article.Heading level={1} text="4s Nylocas Ranger Waves" />
      <span className={guideStyles.authorCredits}>
        Contributed by the{' '}
        <Link
          href="https://discord.gg/u6yXPrFFsf"
          target="_blank"
          rel="noreferrer noopener"
        >
          Money Tobs Discord
        </Link>
        , where you can find additional resources on max-eff ToB and teammates
        to raid with.
      </span>
      <GuideTags challenge={ChallengeType.TOB} scale={4} level="max-eff" />

      <Article.Heading level={2} text="Prelude" />
      <p>
        This guide is part of Blert’s series of max-eff Theatre of Blood 4s
        guides. It is intended for players who already have a basic knowledge of
        the Theatre of Blood and are looking to learn how to run efficient
        raids.
      </p>
      <p>
        View Nylocas waves guides for the other roles using the links below.{' '}
        {/*or return to the <Link href="/guides/tob/4s">Max-eff 4s Overview</Link>. */}
      </p>
      <RoleLinks active="ranger" />
      <p>
        Refer to the <Link href="/guides/tob/plugins">ToB Plugins guide</Link>{' '}
        for information about useful plugins. Of particular note are the Nyloer
        plugin to track spawns and splits, and Nylo Death Indicators to avoid
        doubling up on dead Nylos.
      </p>

      <Article.Heading level={2} text="Overview" />
      <p>
        As a Ranger, it is essential to know that the Nylocas room runs on a
        4-tick cycle and how your attacks line up with that cycle. In the later
        wave, it is extremely important to be on tick with the cycle, or you
        <strong>WILL</strong> miss prefires.
      </p>
      <p>
        Given this, in most cases it is not worth throwing chins at pillar
        stacks before cleanup, as it will require you to stall a tick to get
        back in cycle.
      </p>
      <p>
        When chinning pillar stacks, attack the corner tiles to hit Nylos on
        both sides.
        <Image
          src="/images/guides/tob/nylo-corner-tiles.png"
          alt="Nylocas"
          height={400}
          width={400}
          style={{ objectFit: 'contain', maxWidth: '100%' }}
          unoptimized
        />
      </p>
      <Article.Heading level={2} text="Pre-cap" />
      <Article.Heading level={3} text="Waves 1-3" />
      <p>
        Bow the <Range>wave 1 west small</Range>, the{' '}
        <Range>wave 2 east small</Range>, and the{' '}
        <Range>wave 3 south small</Range>.
      </p>
      <Article.Heading level={3} text="Waves 4-5" />
      <p>
        Blowpipe the <Range>wave 4 west small</Range>, then bow the{' '}
        <Range>wave 5 west big</Range>. If the big doesn’t die, finish it with
        your Blowpipe.
      </p>
      <p>
        If the wave 4 south mage big died instantly, get ready to hit any ranged
        splits from it. It it didn’t, you can Claw scratch the wave 5 south
        melee small before hitting the splits.
      </p>
      <Article.Heading level={3} text="Waves 6-7" />
      <p>
        Chin the <Range>wave 6 south small</Range>, then bow the{' '}
        <Range>wave 7 south big</Range>. Finish it with your Blowpipe.
      </p>
      <Article.Heading level={3} text="Wave 8" />
      <p>
        Sang the <Mage>wave 8 west mage big</Mage>.
      </p>
      <Article.Heading level={3} text="Wave 9" />
      <p>
        Bow the <Range>west ranged big</Range>, then kill any ranged splits from
        the wave 8 mage.
      </p>
      <Article.Heading level={3} text="Wave 10" />
      <p>
        Chin the <Range>west ranged doubles</Range> followed by the{' '}
        <Range>south ranged doubles</Range>. If you are on tick for these, you
        can do one Blowpipe before your next prefire.
      </p>
      <Article.Heading level={3} text="Wave 11" />
      <p>
        Sang the <Mage>west mage big</Mage>.
      </p>
      <p>
        If your Melee Freeze didn’t kill the wave 10 east ranged big, finish it
        instead of prefiring 11. You can also Blowpipe any wave 10 rangers that
        didn’t die.
      </p>
      <Article.Heading level={3} text="Wave 12" />
      <p>
        Scythe the <Melee>south melee big</Melee>. Make sure that you activate
        Piety and equip as many melee switches as you can.
      </p>
      <Article.Heading level={3} text="Wave 13" />
      <p>
        Clean up ranged smalls in the room, as well as those entering from the
        south and west lane.
      </p>
      <Article.Heading level={3} text="Wave 14" />
      <p>
        Keep hitting smalls, then kill the <Range>east ranged big</Range> when
        it enters the room. Waiting until it enters the room before attacking it
        lowers the chance of stalling when its splits spawn.
      </p>
      <Article.Heading level={3} text="Waves 15-16" />
      <p>Attack smalls coming down the lanes as well as those in the room.</p>
      <p>
        A more advanced method for these waves can optionally be done. If you
        kill the 14 big quickly, you can Blowpipe the 15 east ranged small as
        soon as it is in attack range, then run west to Blowpipe 15 west, chin
        16 west, then Sang 17 west first tick. An example is shown below.
      </p>
      <YoutubeEmbed id="Y5wo8qMR9Qg" width={600} compactWidth={330} />
      <Article.Heading level={3} text="Wave 17" />
      <p>
        Sang the <Mage>west mage big</Mage>. If you are first tick to this, you
        can then do 4 Blowpipes.
      </p>
      <Article.Heading level={3} text="Wave 18" />
      <p>
        Bow the <Range>west range big</Range> <strong>on the first tick</strong>
        . If it doesn’t die, don’t hit it again until it reaches the room and
        aggros someone to avoid stalling 19.
      </p>
      <Article.Heading level={3} text="Wave 19" />
      <p>Kill any 18 ranged bigs that are still alive.</p>
      <Article.Heading level={2} text="Post-cap" />
      <Article.Heading level={3} text="Wave 20" />
      <p>
        Bow the west big as it flashes ranged in lane. After this, you can fill
        6-8 ticks before your next prefire. (e.g. 3 Blowpipes, 2 Blowpipes and a
        Sang, etc.)
      </p>
      <Article.Heading level={3} text="Wave 21" />
      <p>
        Chin the <Range>east ranged doubles</Range>. If you chinned them first
        tick, you can Blowpipe 5 times before your next prefire; if you were
        late, only do 4.
      </p>
      <Article.Heading level={3} text="Wave 22" />
      <p>
        Bow the west big as it flashes ranged in lane, then move south. You can
        do 1 Blowpipe before your next prefire.
      </p>
      <Article.Heading level={3} text="Wave 23" />
      <p>
        Bow the <Range>south ranged big</Range>, then run west to Blowpipe the
        northern small flasher.
      </p>
      <Article.Heading level={3} text="Wave 24" />
      <p>
        Bow the west big, then move south again. You can do 1 Blowpipe before
        your next prefire.
      </p>
      <Article.Heading level={3} text="Waves 25-26" />
      <p>
        Bow the <Range>wave 25 south ranged big</Range>. Finish if off with your
        Blowpipe if not dead.
      </p>
      <p>
        From here until wave 27, kill as many smalls as possible. Only hit
        smalls that are 23 and above. If there are none, you can back up either
        27 east or west if your mages didn’t one-shot them.
      </p>
      <Article.Heading level={3} text="Wave 27" />
      <p>
        Blowpipe the <Range>south ranged big</Range> until it dies.
      </p>
      <p>
        From this point forward, you can expect to stall a couple times, so you
        may need to fill with Blowpipes between your lane prefires.
      </p>
      <Article.Heading level={3} text="Wave 28" />
      <p>
        Blowpipe the south smalls as they flash ranged: first the east, then the
        west one. Make sure the western flasher dies.
      </p>
      <p>
        If wave 29 doesn’t stall, path west so that you can hit the west
        flashers.
      </p>
      <p>
        If it took a while to kill the 27 big, you can choose to Blowpipe only
        the eastern flasher, as the other enters as ranged.
      </p>
      <Article.Heading level={3} text="Wave 29" />
      <p>
        Blowpipe the west small flashers: first north, then south. If wave 30
        doesn’t stall, you can only hit the northern flasher before having to
        hit the 30 west big.
      </p>
      <Article.Heading level={3} text="Wave 30" />
      <p>
        Blowpipe the <Range>west ranged big</Range> as soon as it enters
        Blowpipe range.
      </p>
      <p>
        It is essential that this big dies quickly. If your first Blowpipe
        doesn’t kill it, Blowpipe something else once then return to the big
        until it dies. (If the 28 south western flasher is still alive, you
        should Blowpipe it.)
      </p>
      <Article.Heading level={3} text="Wave 31" />
      <p>
        Blowpipe the west small flashers &mdash; first north then south &mdash;
        then chin the south doubles.
      </p>
      <p>
        If the 30 big didn’t die to your first Blowpipe and you didn’t stall,
        you can only hit the northern flasher before going back to finish the
        big.
      </p>
      <p>
        <strong style={{ color: '#fff' }}>
          If either of the 31 south smalls you chinned is still alive, they MUST
          die fast, as they will switch style, which can mess up cleanup.
        </strong>
      </p>
      <Article.Heading level={2} text="Cleanup" />
      <p>
        Chin and Blowpipe rangers, sweeping from south to north. Remember to
        chin on corner tiles.
      </p>
      <p>
        For a more consistent cleanup it is better to Blowpipe unless there are
        3 or more rangers stacked, though chins do have more potential for
        faster cleanups.
      </p>
      <Article.Heading level={2} text="Example POV" />
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <YoutubeEmbed id="9ohC-9No5vs" width={800} compactWidth={330} />
      </div>
    </Article.Page>
  );
}

export async function generateMetadata(
  _props: object,
  parent: ResolvingMetadata,
) {
  return basicMetadata(await parent, {
    title: 'OSRS ToB 4s Nylocas Ranger Guide - Waves & Rotations',
    description:
      'Step-by-step OSRS Theatre of Blood 4s Nylocas Ranger guide: on-tick prefires, ' +
      'chin/bow/blowpipe rotations, wave timings, cleanup tips, and POV VOD.',
  });
}
