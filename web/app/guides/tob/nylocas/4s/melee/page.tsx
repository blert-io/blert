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

export default function MeleeNyloGuide() {
  return (
    <Article.Page>
      <Article.Heading level={1} text="4s Nylocas Melee Waves" />
      <span className={guideStyles.authorCredits}>
        Written by Tiikzu and contributed by the{' '}
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
      <RoleLinks active="melee" />
      <p>
        Refer to the <Link href="/guides/tob/plugins">ToB Plugins guide</Link>{' '}
        for information about useful plugins. Of particular note are the Nyloer
        plugin to track spawns and splits, and Nylo Death Indicators to avoid
        doubling up on dead Nylos.
      </p>

      <Article.Heading level={2} text="Overview" />
      <p>
        As a Melee, there are several things you should keep in mind throughout
        the waves:
      </p>
      <ul>
        <li>
          When killing splits, prioritize them in the following order:{' '}
          <Melee>melee</Melee>, <Range>ranged</Range>, <Mage>mage</Mage>.
        </li>
        <li>
          In the later waves, don’t overuse your Blowpipe or Sang, as you’re the
          only person on the team killing melees in the south and west.
        </li>
        <li>
          Remember to regularly cast Vengeance on yourself and your teammates
          throughout the waves.
        </li>
        <li>
          <p>
            Keep an empty inventory slot and put all of your two-handed weapons
            around it, so that your defender always ends up next to your weapon.
          </p>
          <p>An example inventory arrangement is shown below.</p>
          <Image
            src="/images/guides/tob/4s-melee-inventory.png"
            alt="Example inventory"
            width={230}
            height={336}
            unoptimized
            style={{ borderRadius: 8 }}
          />
        </li>
      </ul>
      <Article.Heading level={2} text="Pre-cap" />
      <Article.Heading level={3} text="Wave 1" />
      <p>You have two options for starting the waves:</p>
      <ul>
        <li>
          Double up with your Mage by Sanging the <Mage>wave 1 south</Mage> and
          the <Mage>wave 2 west</Mage>.
        </li>
        <li>
          Double up with your Ranger by bowing the <Range>wave 1 west</Range>{' '}
          and the <Range>wave 2 east</Range>.
        </li>
      </ul>
      <Article.Heading level={3} text="Waves 2-3" />
      <p>
        After your second attack, kill the <Melee>wave 2 south small</Melee>,
        then the <Melee>wave 3 west small</Melee>.
      </p>
      <Article.Heading level={3} text="Waves 4-5" />
      <p>
        Help your Ranger by Blowpiping the <Range>wave 4 west small</Range>{' '}
        followed by the <Range>wave 5 west big</Range>, then move south to hit
        the <Melee>wave 5 melee</Melee>.
      </p>
      <Article.Heading level={3} text="Waves 6-7" />
      <p>
        Clean up splits from the south and west, and help your Ranger with the
        <Range>wave 7 south big</Range>.
      </p>
      <Article.Heading level={3} text="Waves 8-9" />
      <p>
        Sang the <Mage>wave 8 west big</Mage> first tick, then bow the{' '}
        <Range>wave 9 west ranged big</Range> immediately after.
      </p>
      <Article.Heading level={3} text="Wave 10" />
      <p>Clean up splits from the bigs that died.</p>
      <Article.Heading level={3} text="Wave 11" />
      <p>
        Sang the <Mage>wave 11 west big</Mage> first tick and commit to the
        kill. If any rangers from wave 10 west are still alive, you can Blowpipe
        once before Sanging 11.
      </p>
      <Article.Heading level={3} text="Wave 12" />
      <p>
        Scythe the <Melee>west melee doubles</Melee>. If the wave 11 mage big
        died first tick, you have time to Swift or Blowpipe a split before
        Scything the doubles.
      </p>
      <p>Afterwards, clean up splits before the next wave.</p>
      <Article.Heading level={3} text="Wave 13" />
      <p>
        Kill the <Melee>south melee small</Melee>. If there are no melees in the
        room at this point, you can Blowpipe the west ranger before dealing with
        south.
      </p>
      <Article.Heading level={3} text="Wave 14" />
      <p>
        Kill the <Melee>west melee small</Melee>.
      </p>
      <Article.Heading level={3} text="Waves 15-16" />
      <p>
        Blowpipe the <Range>15 west ranged small</Range>, then Swift the{' '}
        <Melee>melee small</Melee> next to it. Stay west and hit something in
        the room before your next prefire.
      </p>
      <Article.Heading level={3} text="Wave 17" />
      <p>
        Sang the <Mage>west mage big</Mage> on the first tick. If it doesn’t
        die, do one Swift or Blowpipe before Sanging it again.
      </p>
      <Article.Heading level={3} text="Wave 18" />
      <p>Clean up splits in the room.</p>
      <Article.Heading level={3} text="Wave 19" />
      <p>
        If the room is clean and you killed wave 17 first tick, you can Sang the
        west mage big first tick. If you do this, make sure to stand one tile
        away from the gate when you attack it, so that its splits spawn
        following the wave 20 check.
      </p>
      <p>
        If there are many splits in the room, focus on killing them instead of
        prefiring 19.
      </p>
      <Article.Heading level={2} text="Post-cap" />
      <Article.Heading level={3} text="Wave 20" />
      <p>
        Clean as many splits in the room as you can. Be prepared to Scythe the
        <Melee>west big</Melee> as soon as it enters the room if your Ranger
        didn’t kill it.
      </p>
      <Article.Heading level={3} text="Wave 21" />
      <p>
        Scythe the <Melee>south melee doubles</Melee>, then do one Swift.
      </p>
      <Article.Heading level={3} text="Wave 22" />
      <p>
        Scythe the <Melee>south melee doubles</Melee>, then path west.
      </p>
      <p>
        Optionally, you can choose to do a more advanced method for this wave:
      </p>
      <ol>
        <li>
          Blowpipe the western 22 small in the south lane as it flickers ranged.
        </li>
        <li>Swift the other south small when it enters the room.</li>
        <li>
          Bow the 23 south big first tick and continue your regular rotation.
        </li>
      </ol>
      <p>
        If you do this, pay attention to 22 west &mdash; if your Ranger doesn’t
        kill it, finish it off instead of bowing 23.
      </p>
      <Article.Heading level={3} text="Wave 23" />
      <p>
        Kill splits that spawned from the wave 22 west big. At this point, only
        hit Nylos that are 23 or above, as the rest will expire before wave 28.
      </p>
      <Article.Heading level={3} text="Wave 24" />
      <p>Path south and kill splits from the wave 23 south big.</p>
      <p>
        Be prepared to finish the wave 24 west big as it enters the room if your
        Ranger didn’t kill it. (Advanced: If you notice your Ranger doesn’t
        instantly kill 24, you can Blowpipe it once in lane before it switches
        to melee.)
      </p>
      <Article.Heading level={3} text="Wave 25" />
      <p>
        Scythe the <Melee>west big</Melee> as soon as it enters the room. If
        your Ranger killed the 24 big, you can Blowpipe one of its splits once
        before Scything 25.
      </p>
      <p>
        After Scything the 25, you have 4 ticks to fill. You can Swift once and
        lose a tick, Blowpipe twice or Sang once. Path south as you do this.
      </p>
      <Article.Heading level={3} text="Wave 26" />
      <p>
        Scythe the <Melee>south big</Melee> as it enters the room. From this
        point on, you should stay south.
      </p>
      <Article.Heading level={3} text="Waves 27-28" />
      <p>Clean up the room as much as you can.</p>
      <p>
        Keep an eye on the 28 south flashers: if your Ranger doesn’t kill the
        eastern one, it will enter the room as melee and you must kill it as
        quickly as possible.
      </p>
      <Article.Heading level={3} text="Wave 29" />
      <p>
        Scythe the <Melee>south melee big</Melee> as soon as it enters the room.
      </p>
      <p>
        If the wave 28 flasher didn’t die before this, kill it immediately after
        the 29 big.
      </p>
      <Article.Heading level={3} text="Wave 30" />
      <p>
        Scythe the <Melee>south melee doubles</Melee>. If either of them
        survive, prioritize killing them.
      </p>
      <Article.Heading level={3} text="Wave 31" />
      <p>
        Watch the splits spawning from the 30 west range and east mage bigs
        &mdash; if they walk south, prioritize them over other Nylos.
      </p>
      <Article.Heading level={2} text="Cleanup" />
      <p>
        During cleanup, your job is to kill clear out melees in the south side
        of the room. Make sure to always hit higher wave Nylos first.
      </p>
      <Article.Heading level={2} text="Example POV" />
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <YoutubeEmbed id="HeNFWT82ju8" width={800} compactWidth={330} />
      </div>
    </Article.Page>
  );
}

export async function generateMetadata(_props: {}, parent: ResolvingMetadata) {
  return basicMetadata(await parent, {
    title: '4s Nylocas Melee Waves Guide',
    description:
      "Learn the Melee role's rotation for the Nylocas waves in a Theatre of Blood 4s raid.",
  });
}
