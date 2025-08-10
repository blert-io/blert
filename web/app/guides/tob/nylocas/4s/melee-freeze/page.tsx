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

export default function MeleeFreezeNyloGuide() {
  return (
    <Article.Page>
      <Article.Heading level={1} text="4s Nylocas Melee Freeze Waves" />
      <span className={guideStyles.authorCredits}>
        Written by Alex (StillRemains) and contributed by the{' '}
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
      <RoleLinks active="melee-freeze" />
      <p>
        Refer to the <Link href="/guides/tob/plugins">ToB Plugins guide</Link>{' '}
        for information about useful plugins. Of particular note are the Nyloer
        plugin to track spawns and splits, and Nylo Death Indicators to avoid
        doubling up on dead Nylos.
      </p>

      <Article.Heading level={2} text="Overview" />
      <p>
        As a Melee Freeze, your role is to prefire Nylos in the east lane and to
        help clear out melees.
      </p>
      <p>
        It is essential to be on time (1<sup>st</sup> or 2<sup>nd</sup> tick) to
        your prefires. As you improve at the role, you will be able to identify
        how many hits you can fit between prefires.
      </p>
      <p>
        When killing splits, you should prioritize them in the following order:{' '}
        <Melee>melee</Melee>, <Mage>mage</Mage>, <Range>ranged</Range>.
        Prioritize splits in the east and north parts of the room.
      </p>
      <p>
        You should look out for barrage stacks that have formed or are about to
        form, especially during the later waves. As a Melee Freeze, you should
        not be barraging &mdash; that is the Mage’s job. If you notice Nylos
        that will form a stack, ignore them and hit something else.
      </p>
      <p>
        The largest difficulty with Melee Freeze role is undoubtedly inventory
        management. To keep your inventory clean, you should do the following:
      </p>
      <ul>
        <li>
          Keep an empty inventory slot and put all of your two-handed weapons
          around it, so that your defender/shield always ends up next to your
          weapon.
        </li>
        <li>
          When switching between three styles, re-equip your previous switches
          before your new ones so that everything ends up in its original place.
          This can be seen in the <Link href="#example-vod">example VOD</Link>{' '}
          &mdash; pay attention to how the player performs their switches.
        </li>
        <li>
          An example inventory arrangement is shown below.
          <Image
            src="/images/guides/tob/melee-freeze-inventory.png"
            alt="Example inventory"
            width={230}
            height={336}
            unoptimized
            style={{ borderRadius: 8 }}
          />
        </li>
      </ul>
      <Article.Heading level={2} text="Pre-cap" />
      <Article.Heading level={3} text="Waves 1-2" />
      <p>
        Sang <Mage>wave 1 south</Mage>, then Swift the{' '}
        <Melee>wave 1 east melee</Melee>. Swift it again if it didn’t die.
      </p>
      <p>
        If you bring a Volatile nightmare staff as your barrage weapon, spec the
        wave 1 small instead of Sanging it to get Chally and ZCB specs for the
        boss. If your team gets inconsistent boss spawns (slower than 2:57.6)
        you can spec a later Nylo, but no later than wave 4.
      </p>
      <Article.Heading level={3} text="Waves 3-4" />
      <p>
        Sang the <Mage>wave 3 east small</Mage>, then the{' '}
        <Mage>wave 4 south big</Mage>.
      </p>
      <Article.Heading level={3} text="Wave 5" />
      <p>
        Sang the <Mage>wave 5 east small</Mage>, then Swift the{' '}
        <Melee>wave 4 east melee</Melee>. Clean up any smalls that survived and
        splits in the room until the next wave.
      </p>
      <Article.Heading level={3} text="Wave 6" />
      <p>
        Scythe the <Melee>east big</Melee> as it enters the room. Finish it with
        your Swift if it doesn’t die.
      </p>
      <Article.Heading level={3} text="Waves 7-8" />
      <p>
        Kill the <Melee>wave 7 east melee</Melee>, then clean up the east side
        and splits from the wave 6 big you killed.
      </p>
      <Article.Heading level={3} text="Wave 9" />
      <p>
        Sang the <Mage>east mage small</Mage>.
      </p>
      <Article.Heading level={3} text="Wave 10" />
      <p>
        Bow the <Range>east big</Range> on the first tick, ideally wearing full
        Void, then Blowpipe either the big (if it’s still alive) or the small.
      </p>
      <Article.Heading level={3} text="Wave 11" />
      <p>
        Barrage the <Mage>east mage doubles</Mage>. Clean up splits from range
        big and finish off the barraged Nylos if they survived.
      </p>
      <Article.Heading level={3} text="Wave 12" />
      <p>
        Scythe the <Melee>east melee doubles</Melee>. If one survived, swift it
        once.
      </p>
      <Article.Heading level={3} text="Waves 13-14" />
      <p>
        Scythe the <Melee>wave 13 east big</Melee> as it enters the room. If it
        doesn’t die, finish it with your Swift, then clean up smalls and splits
        in the room.
      </p>
      <Article.Heading level={3} text="Wave 15" />
      <p>
        Sang the <Mage>east mage small</Mage>, then clean up splits from the 13
        melee big.
      </p>
      <Article.Heading level={3} text="Wave 16" />
      <p>
        Sang the <Mage>east mage small</Mage>.
      </p>
      <Article.Heading level={3} text="Wave 17" />
      <p>
        Sang the <Mage>east mage big</Mage>, and commit to the kill. Note that
        this (and many of your upcoming prefires) will flash in lane, so you can
        hit something in the room after the first Sang, then return to finish it
        off.
      </p>
      <Article.Heading level={3} text="Wave 18" />
      <p>Clean up splits in the room.</p>
      <Article.Heading level={3} text="Wave 19" />
      <p>
        Sang the <Mage>east mage big</Mage> and commit after it flashes.
      </p>
      <p>
        <strong style={{ color: '#fff' }}>
          If you are first tick to this, stand one tile back from the gate.
        </strong>{' '}
        This will cause the splits to spawn after the wave 20 check, avoiding a
        potential chain stall.
      </p>
      <p>Finish off any remaining bigs afterwards.</p>
      <p>
        <strong style={{ color: '#fff' }}>
          Pay attention to how many 17s entered the room.
        </strong>{' '}
        If 2 or more popped in the room, consider cleaning up smalls instead of
        instantly prefiring the 19 to avoid stalling.
      </p>
      <Article.Heading level={2} text="Post-cap" />
      <p>
        You should aim to be first tick to all of your mage big prefires. This
        is important for your rotation as it causes the splits to spawn earlier,
        preventing your team from falling behind.
      </p>
      <Article.Heading level={3} text="Wave 20" />
      <p>
        Scythe the <Melee>east melee big</Melee> as it enters the room.
      </p>
      <Article.Heading level={3} text="Wave 21" />
      <p>Clean up splits, and be ready to first tick your wave 22 prefire.</p>
      <Article.Heading level={3} text="Wave 22" />
      <p>
        Sang the <Mage>east mage big</Mage>. If it survives, you can Blowpipe it
        as it flashes, then Scythe to finish it off.
      </p>
      <p>
        If it dies to your Sang, kill splits. You only have 8 ticks to fill
        before your next prefire, so don’t greed hits.
      </p>
      <Article.Heading level={3} text="Wave 23" />
      <p>
        Sang the <Mage>east mage big</Mage>. If it survives, you can Blowpipe it
        as it flashes, then Scythe to finish it off. Kill splits afterwards, but
        be ready to Scythe the next melee big.
      </p>
      <p>
        <strong style={{ color: '#fff', fontWeight: 500 }}>
          From this point, avoid hitting any smalls that spawned earlier than
          wave 23, as they will expire around wave 28.
        </strong>
      </p>
      <Article.Heading level={3} text="Wave 24" />
      <p>
        Scythe the <Melee>east melee big</Melee> as soon as it enters the room.
        While you’re waiting for it to enter, you can clean up any splits which
        spawned on wave 23 or higher.
      </p>
      <p>
        If you first ticked the 23 mage and one-shot it, you can kill one split
        then Sang the 24 south mage on the first tick, Blowpipe 24 east once and
        you will be on tick to Scythe the 24 east melee big.
      </p>
      <Article.Heading level={3} text="Wave 25" />
      <p>
        After Scything the 24 melee big, you have 5 ticks to fill, giving you
        several options:
      </p>
      <ul>
        <li>If the big survived, Scythe it again.</li>
        <li>
          If your Mage didn’t kill 25 east mage, back them up. Then, either lose
          a tick before your next prefire, or Blowpipe once and be a tick late.
        </li>
        <li>
          If both your 24 melee and the 25 mage bigs died, hit splits in the
          room. It is okay to fill 6 ticks and be a tick late to your next
          prefire.
        </li>
      </ul>
      <Article.Heading level={3} text="Waves 26-27" />
      <p>
        The two <Mage>east mage bigs</Mage> spawning on waves 26 and 27 need to
        die as quickly as possible. Killing them takes priority over everything
        else.
      </p>
      <p>
        If you are first tick to wave 26, Sang it standing right by the gate.
        Then, make sure to step back a tile to Sang 27 on the first tick, as
        this will cause its splits to spawn after the wave 28 check.
      </p>
      <p>After the two bigs die, focus splits on the east side of the room.</p>
      <Article.Heading level={3} text="Waves 28-29" />
      <p>
        These two waves spawn pairs of north and south smalls which flash in the
        lane. There will be many splits in the room, especially with the 26 and
        27 bigs popping, which you should be prepared to hit.
      </p>
      <p>
        You can fill ticks by Sanging the north 28 small. This is a flasher that
        will later turn melee, which could cause trouble on cleanup.
      </p>
      <p>
        The southern 28 and northern 29 smalls enter the room as melee, so you
        should Swift them.
      </p>
      <Article.Heading level={3} text="Wave 30" />
      <p>
        Continue killing splits. You may optionally help your Mage with by
        Sanging the <Mage>east mage big</Mage> once, though this depends on the
        state of the room:
      </p>
      <ul>
        <li>
          If there are a lot of barrage clumps, you can kill the 30 big for your
          Mage so that they can focus on barraging.
        </li>
        <li>
          If there aren’t many mage Nylos in the room, the Mage will kill the
          30, so focus on cleaning the north side of the room.
        </li>
      </ul>
      <Article.Heading level={3} text="Wave 31" />
      <p>
        Focus on cleaning up the northeast pillar and avoid running south. You
        should also scan the northwest pillar as you may have to move there
        during cleanup if it has a lot of melee Nylos.
      </p>
      <p>
        Sometimes, if you are trying to Sang the 30 big, your Mage might kill it
        before you can Sang it. In this case, you can quickly Sang the 31 north
        mage small to avoid losing ticks switching back to melee.
      </p>
      <p>
        If there are melee aggros in the middle of the room, you can hit them
        while transitioning between pillars to fill ticks.
      </p>
      <p>
        Alternatively, you can choose to Blowpipe the wave 31 east smalls in
        lane, hitting the north one followed by the south one.
      </p>
      <Article.Heading level={2} text="Cleanup" />
      <p>
        Your responsibility is to clean up north. Do not leave the north side of
        the room while Nylos there are still alive. The only exception is if
        there are an overwhelming number of melees on the south side which your
        Melee will need assistance to kill. Make sure not to double up with your
        Melee or Ranger.
      </p>
      <p>
        It is important to follow your role’s style prioritization, but you
        should avoid destroying barrage value. Look for single mage Nylos if
        there are no melees left, or to fill ticks while pathing to the
        northwest pillar.
      </p>
      <p>
        If the last Nylo in the room is a melee, you can BGS or Elder maul whack
        it for a higher chance of killing it.
      </p>
      <Article.Heading level={2} text="Example VOD" />
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <YoutubeEmbed id="3fG9nwaccXE" width={800} compactWidth={330} />
      </div>
    </Article.Page>
  );
}

export async function generateMetadata(_props: {}, parent: ResolvingMetadata) {
  return basicMetadata(await parent, {
    title: 'OSRS ToB 4s Nylocas Melee Freeze Guide - Waves & Rotations',
    description:
      'Step-by-step OSRS Theatre of Blood 4s Nylocas Melee Freeze guide: ' +
      'east-lane prefires, split priority, wave-by-wave rotations, ' +
      'inventory tips, and POV VOD.',
  });
}
