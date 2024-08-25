import { ChallengeType } from '@blert/common';
import { ResolvingMetadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';

import Article from '@/components/article';
import YoutubeEmbed from '@/components/youtube-embed';
import GuideTags from '@/guides/guide-tags';
import { basicMetadata } from '@/utils/metadata';

import { Mage, Range } from '../../nylos';
import RoleLinks from '../role-links';

export default function MageNyloGuide() {
  return (
    <Article.Page>
      <Article.Heading level={1} text="4s Nylocas Mage Waves" />
      <em>
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
      </em>
      <GuideTags challenge={ChallengeType.TOB} scale={4} level="max-eff" />
      <Article.TableOfContents />

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
      <RoleLinks active="mage" />
      <p>
        Refer to the <Link href="/guides/tob/plugins">ToB Plugins guide</Link>{' '}
        for information about useful plugins. Of particular note are the Nyloer
        plugin to track spawns and splits, and Nylo Death Indicators to avoid
        doubling up on dead Nylos.
      </p>

      <Article.Heading level={2} text="Overview" />
      <p>
        As a Mage, your priority is to prefire Mage bigs entering the room
        during later waves to ensure they die as quickly as possible. It is also
        your responsibility to look for high-value barrages across the room, as
        your melee freeze will rarely (if ever) barrage.
      </p>
      <p>Some general things to keep in mind during the waves include:</p>
      <ul>
        <li>
          Pray Augury throughout the waves and make sure you always barrage with
          a 15% staff equipped.
        </li>
        <li>
          Prioritize mage splits on the west side of the room to avoid doubling
          up with your melee freeze, who will be hitting splits on the east
          side.
        </li>
        <li>
          Always try to be on tick for your prefires. The Nylo room runs on a
          4-tick cycle, which is the same speed as your Sang. Knowing how many
          hits you can fill between waves is an important part of improving your
          waves.
        </li>
        <li>
          Look out for potential barrage stacks forming when Nylos path towards
          pillars.
        </li>
        <li>
          Ensure you use corner tiles for barraging to hit Nylos on both sides
          of a pillar.
          <Image
            src="/images/guides/tob/nylo-corner-tiles.png"
            alt="Nylocas"
            height={400}
            width={400}
            style={{ objectFit: 'contain', maxWidth: '100%' }}
            unoptimized
          />
        </li>
      </ul>
      <Article.Heading level={2} text="Pre-cap" />
      <Article.Heading level={3} text="Waves 1-3" />
      <p>
        Sang the <Mage>wave 1 south small</Mage>, the{' '}
        <Mage>wave 2 west small</Mage>, then the <Mage>wave 3 east small</Mage>.
      </p>
      <p>
        If you bring a Volatile nightmare staff as your barrage weapon, spec the
        wave 1 small instead of Sanging it to get Chally and ZCB specs for the
        boss. If your team gets inconsistent boss spawns (slower than 2:57.6)
        you can spec a later Nylo, but no later than wave 4.
      </p>
      <Article.Heading level={3} text="Wave 4" />
      <p>
        Sang the <Mage>wave 4 south big</Mage> until it dies.
      </p>
      <Article.Heading level={3} text="Wave 5" />
      <p>
        Sang the <Mage>wave 5 east small</Mage>, then kill splits in the room.
      </p>
      <Article.Heading level={3} text="Waves 6-7" />
      <p>
        Sang <Mage>wave 6 west</Mage> and <Mage>wave 7 south</Mage>. Help out
        with the <Range>south big</Range> if you kill both quickly.
      </p>
      <Article.Heading level={3} text="Wave 8" />
      <p>
        Sang the <Mage>west mage big</Mage> on the first tick it spawns and
        commit to the kill.
      </p>
      <Article.Heading level={3} text="Wave 9" />
      <p>
        Bow the <Range>west big</Range> once, then finish it with your blowpipe.
        If you didn’t one-shot the wave 8 big, skip the bow and just pipe. Clean
        up splits in the room afterwards.
      </p>
      <Article.Heading level={3} text="Wave 10" />
      <p>
        Continue cleaning splits. If the west range doubles are still alive, you
        can blowpipe them twice before wave 11 spawns.
      </p>
      <Article.Heading level={3} text="Waves 11-12" />
      <p>
        Sang the <Mage>west mage big</Mage>, then barrage the
        <Mage>south doubles</Mage>. If you hit the big on the first tick, you
        can Sang it again and still have time to barrage.
      </p>
      <p>Kill splits in the room afterwards.</p>
      <Article.Heading level={3} text="Wave 13" />
      <p>
        Sang the <Mage>west small</Mage> and kill another split. If your melee
        didn’ kill the ranger small and there are no mage splits to hit, you can
        blowpipe it once before wave 14.
      </p>
      <Article.Heading level={3} text="Wave 14" />
      <p>
        Sang the <Mage>west small</Mage> followed by the{' '}
        <Mage>south small</Mage>.
      </p>
      <Article.Heading level={3} text="Waves 15-16" />
      <p>
        Sang the <Mage>south big mage</Mage> first tick and commit to the kill.
        You can do another 2 sangs after your first &mdash; prioritize smalls in
        the room or hit the 16 east if there are none.
      </p>
      <Article.Heading level={3} text="Waves 17-18" />
      <p>
        Sang the <Mage>wave 17 south mage big</Mage>. If your first Sang doesn’t
        kill it, blowpipe the 16 south range small once as the 17 flashes, then
        finish it.
      </p>
      <p>
        After the big is dead, clean up smalls or the other 17 mage bigs.
        Prioritize south first, then west. You can do a total of 5 Sangs between
        17-19.
      </p>
      <Article.Heading level={3} text="Wave 19" />
      <p>
        Sang the <Mage>wave 19 south mage big</Mage>. If you hit it on the first
        tick, stand one tile away from the gate to increase your projectile
        travel time, ensuring it pops following the wave 20 check.
      </p>
      <p>
        Do 2 more Sangs before wave 20. If you were first tick to the south big,
        you can hit a 17 big on a pillar before it switches to melee.
      </p>
      <p>
        <strong style={{ color: '#fff' }}>
          Pay attention to how many 17s entered the room.
        </strong>{' '}
        If 2 or more popped in the room, consider cleaning up smalls instead of
        instantly prefiring the 19 to avoid stalling.
      </p>
      <Article.Heading level={2} text="Post-cap" />
      <Article.Heading level={3} text="Wave 20" />
      <p>
        Sang the <Mage>south mage big</Mage>, ideally on the first tick.
      </p>
      <ul>
        <li>
          If it dies to your Sang, you can Sang 3 more times before the next
          wave.
        </li>
        <li>
          If it doesn’t die, Blowpipe it once as it flashes ranged. If the
          Blowpipe kills it, you can Sang twice more before the next wave.
        </li>
        <li>
          If the Blowpipe doesn’t kill it, Scythe it as it enters the room, then
          do one more Sang.
        </li>
      </ul>
      <Article.Heading level={3} text="Wave 21" />
      <p>
        Barrage the <Mage>west mage doubles</Mage> on the first tick, then
        either blowpipe or Sang something in the room while running east.
      </p>
      <Article.Heading level={3} text="Wave 22" />
      <p>
        Sang the <Mage>east mage big</Mage>, then bow the{' '}
        <Range>west ranged big</Range> with your ranger as it flashes.
      </p>
      <p>
        <strong style={{ color: '#fff', fontWeight: 500 }}>
          From this point, avoid hitting any smalls that spawned earlier than
          wave 23, as they will expire around wave 28.
        </strong>
      </p>
      <Article.Heading level={3} text="Wave 23" />
      <p>
        Sang the <Mage>east mage big</Mage>, then path south. You can Sang
        something in the room before your next prefire.
      </p>
      <p>
        If your ranger doesn’t kill the 23 south big, don’t Sang it. Doing so
        will put you off tick for your following prefires. Your meleer should
        deal with it instead.
      </p>
      <Article.Heading level={3} text="Wave 24" />
      <p>
        Sang the <Mage>south mage big</Mage> and commit to the kill. You can
        Sang once more before the next wave. If your ranger doesn’t kill the
        west big, don’t Sang it when it flashes; just let your meleer deal with
        it.
      </p>
      <Article.Heading level={3} text="Wave 25" />
      <p>
        If the 24 south is dead, Sang the <Mage>east mage big</Mage> on the
        first tick, standing up against the gate. Sang one more thing before
        your next prefire. If 24 south or west died instantly, you can hit one
        of their splits.
      </p>
      <p>
        Being first tick to the 25 big ensures that its splits auto for 2:50.2.
        If the 24 south did not die in 2 Sangs, it is preferable to Sang it a
        third time over prefiring the 25, as only one of then will die for a
        potential 2:50, and the 24 likely has a higher chance of dying.
      </p>
      <Article.Heading level={3} text="Waves 26-27" />
      <p>
        Sang the <Mage>26 west mage big</Mage> on the first tick. Then,
        regardless of whether it died, Sang the <Mage>27 west mage big</Mage>{' '}
        immediately afterwards. Commit to killing the 27, then return to the 26.
      </p>
      <p>
        You should stand up against the gate when attacking the 26, but step
        back a tile for the 27, as the increased projectile travel time will
        cause its splits to spawn after the wave check.
      </p>
      <Article.Heading level={3} text="Waves 28-29" />
      <p>
        At this point, you should primarily be looking out for barrage clumps.
        Ideally, the clumps consist of 27s and above, but it is sometimes worth
        barraging earlier Nylos to avoid a stall.
      </p>
      <p>
        If your Melee Freeze did not kill their east bigs, you should clean
        these up, though avoid doubling up on them.
      </p>
      <p>
        You can Sang the <Mage>28 east small</Mage> as it later turns melee,
        which can cause issues during cleanup.
      </p>
      <p>
        Unless there are no other mages, you should <strong>not</strong> hit the
        small mage aggros from these waves, as they will turn melee and follow
        players around during cleanup.
      </p>
      <Article.Heading level={3} text="Wave 30" />
      <p>
        Sang the <Mage>east big</Mage> and commit until it dies. If there is a
        lot of barrage value in the room, let your melee freeze deal with the
        big and barrage instead.
      </p>
      <Article.Heading level={3} text="Wave 31" />
      <p>
        Prefire the <Mage>east small</Mage>. Note that this Nylo walks to the
        northeast pillar, so if you notice that it will form a barrage clump,
        hit other splits instead of prefiring it.
      </p>
      <p>If your ranger didn’t kill the 31 west flashers, Sang the mage one.</p>
      <Article.Heading level={2} text="Cleanup" />
      <p>
        During cleanup, you should primarily look out for barrage clumps that
        have formed or will form. Your melee freeze will not barrage during
        cleanup, so clumps in any part of the room are your responsibility.
      </p>
      <p>
        When attacking single mages, prioritize the south side of the room over
        the north. Pay attention to what other players are doing &mdash;
        especially your melee freeze &mdash; as you don’t want to double up.
      </p>
      <Article.Heading level={2} text="Example VOD" />
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <YoutubeEmbed id="l7bXBGjFjuQ" width={800} compactWidth={330} />
      </div>
    </Article.Page>
  );
}

export async function generateMetadata(_props: {}, parent: ResolvingMetadata) {
  return basicMetadata(await parent, {
    title: '4s Nylocas Mage Waves Guide',
    description:
      "Learn the Mage role's rotation for the Nylocas waves in a Theatre of Blood 4s raid.",
  });
}
