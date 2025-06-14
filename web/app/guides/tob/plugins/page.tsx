import { ResolvingMetadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';

import Article from '@/components/article';
import { basicMetadata } from '@/utils/metadata';

export default function PluginGuide() {
  return (
    <Article.Page>
      <Article.Heading level={1} text="Theatre of Blood Plugins" />
      <em>
        Note: This list of plugins is incomplete and will be updated over time.
      </em>
      <Article.Heading level={2} text="General" />
      <Article.Heading level={3} text="Party / Hub Party Panel" />
      <p>
        While not ToB-specific, the Party plugin is perhaps the most essential
        plugin to have when doing any group PvM. At its core, it shares basic
        information about your character with your teammates, such as your
        current hitpoints, prayer points, and special attack energy. More
        importantly, it provides a mechanism for other plugins to share
        information, enabling many features which greatly improve your raid
        experience.
      </p>
      <p>
        One such plugin that builds on Party is the{' '}
        <Link href="https://runelite.net/plugin-hub/show/party-panel">
          Hub Party Panel
        </Link>
        . This extends the shared party data to include your stats, gear,
        inventory, and prayers.
      </p>
      <Article.Heading level={3} text="Special Attack Counter" />
      <p>
        Special Attack Counter is a builtin Runelite plugin which tracks how
        many defence-reducing special attacks you&apos;ve landed on a boss. It
        integrates with the Party plugin to share this information with your
        teammates.
      </p>
      <Article.Heading level={3} text="Party Defence Tracker" />
      <p>
        <Link href="https://runelite.net/plugin-hub/show/party-defence-tracker">
          Party Defence Tracker
        </Link>{' '}
        builds on top of the Special Attack Counter plugin to automatically
        calculate the Defence level of a boss as your team hits special attacks
        and display it in an infobox, removing the need for you to remember
        special attack counts.
      </p>
      <Article.Heading level={3} text="ToB QoL" />
      <p>
        <Link href="https://runelite.net/plugin-hub/show/tob-qol">ToB QoL</Link>{' '}
        offers a variety of quality of life features throughout every room of
        the Theatre of Blood. There are too many to list here; we encourage you
        to try them out to see which you find useful. A selection of the most
        notable features include:
      </p>
      <ul>
        <li>
          <p>
            <strong>Instance Timers</strong>. This is an essential toggle for
            both the Nylocas and Xarpus. It displays the game&apos;s internal
            instance timer on which these rooms operate, allowing you to time
            your entry to start the room as quickly as possible.
          </p>
          <p>
            When you enter the Nylocas or Xarpus instance, a tick counter from
            0-3 will appear over your head. If you are the player starting the
            room, click the barrier to bring up the start menu, then click to
            enter when the displayed tick is 0.
          </p>
        </li>
        <li>
          <p>
            <strong>Maiden & Verzik crab health</strong>. These options display
            the hitpoints of red crabs at Maiden and Verzik as a number,
            allowing you to know when to stop attacking them.
          </p>
        </li>
        <li>
          <p>
            <strong>Object hiders</strong>. You can hide the ceiling chains at
            Bloat, along with various objects in the Nylocas room, reducing
            visual clutter.
          </p>
        </li>
        <li>
          <p>
            <strong>Room timers</strong>. Displays live timers in each room,
            showing important splits.
          </p>
        </li>
      </ul>

      <Article.Heading level={2} text="The Pestilent Bloat" />
      <Article.Heading level={3} text="Ground Object Hider" />
      <p>
        It can be difficult to see shadows on Bloat’s floor through its default
        texture, leading to embarrassing deaths. The{' '}
        <Link href="https://runelite.net/plugin-hub/show/object-hider">
          Ground Object Hider
        </Link>{' '}
        plugin allows you to remove this floor texture. To achieve this, list
        the following object IDs in the plugin’s settings:
      </p>
      <Article.Code language="plaintext">
        32941, 32942, 32943, 32944, 32945, 32946, 32947, 32948
      </Article.Code>
      <p>
        However, this alone isn’t enough, since the floor otherwise appears as a
        black void. To change this, use the builtin Skybox plugin to set both
        the Overworld and Cave skyboxes to a color of your choice.
      </p>
      <Article.Notice type="warning">
        <p>
          You must set <em>both</em> the Overworld and Cave skyboxes, or the
          floor will still occasionally appear black.
        </p>
      </Article.Notice>

      <Image
        src="/images/guides/tob/plugins/skybox.png"
        alt="Skybox plugin settings"
        width={236}
        height={95}
        unoptimized
        style={{ borderRadius: 0 }}
      />

      <Article.Heading level={2} text="The Nylocas" />
      <Article.Heading level={3} text="Nyloer" />
      <p>
        <Link href="https://runelite.net/plugin-hub/show/nyloer">Nyloer</Link>{' '}
        offers several helpful tools for the Nylocas room.
      </p>
      <Article.Heading level={4} idPrefix="nyloer" text="Wave numbers" />
      <p>
        Nyloer’s most useful feature is its wave indicators, which display the
        wave number over every Nylo that spawns, as well as whether the Nylo is
        a split. This makes it easy to prioritize Nylos which are newer,
        avoiding killing those which will expire soon.
      </p>
      <p>
        To enable wave numbers, tick the <em>Show Nylocas Wave</em> option in
        the plugin&apos;s <em>General Settings</em>:
      </p>
      <Image
        src="/images/guides/tob/plugins/nyloer-wave.webp"
        alt="Nyloer wave number setting"
        width={229}
        height={270}
        unoptimized
        style={{ borderRadius: 0 }}
      />
      <Article.Heading level={4} idPrefix="nyloer" text="Dimming" />
      <p>
        A related feature is the ability to visually darken the wave numbers of
        any Nylos currently in the room (&quot;dimming&quot;). Doing so provides
        a visual indicator of which Nylos to avoid targeting, as they will
        expire naturally before a key threshold.
      </p>
      <p>
        Most commonly, players will set a <em>Darker Wave</em> (and sometimes{' '}
        <em>Darker Wave Offset</em>) under Nyloer’s <em>Font Settings</em>{' '}
        before starting the room. Nyloer will then automatically dim Nylos as
        soon as the specified wave and tick offsets are reached. The specific
        wave and tick offsets are determined based on the boss spawn time a team
        is targeting. The most common configurations are listed below.
      </p>
      <table>
        <thead>
          <tr>
            <th
              colSpan={3}
              style={{ textAlign: 'center', fontSize: '1.05rem' }}
            >
              <strong>Common dim settings (assuming no pre-28 stalls)</strong>
            </th>
          </tr>
          <tr>
            <th>Boss spawn time</th>
            <th>Darker wave</th>
            <th>Tick offset</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>2:48.0</td>
            <td>26</td>
            <td>0</td>
          </tr>
          <tr>
            <td>2:50.4</td>
            <td>27</td>
            <td>0</td>
          </tr>
          <tr>
            <td>2:52.8</td>
            <td>27</td>
            <td>4</td>
          </tr>
          <tr>
            <td>2:55.2</td>
            <td>28</td>
            <td>0</td>
          </tr>
        </tbody>
      </table>
      <p>
        Nyloer also allows setting a <em>Make Darker Hotkey</em> to manually dim
        Nylos on demand. This is more advanced, requiring an understanding of
        the Nylocas room cycle, but can be invaluable to experienced players.
      </p>
      <Image
        src="/images/guides/tob/plugins/nyloer-dim.png"
        alt="Nyloer darken hotkey setting"
        width={226}
        height={82}
        unoptimized
        style={{ borderRadius: 0 }}
      />
      <Article.Heading level={4} idPrefix="nyloer" text="Role menu swaps" />
      <p>
        Nyloer also allows you to configure menu priorities for your role,
        prioritizing its relevant Nylo style(s), allowing you to simply left
        click on a stack of Nylos to attack the one you want. This replaces the
        need for the Custom Menu Swaps plugin which players previously used for
        this purpose.
      </p>
      <p>
        Nyloer comes with default menu swaps for the Mage, Ranger, and Melee
        roles, which you can quickly switch between by clicking a button in the
        plugin’s sidebar panel. You can also customize these menu swaps to your
        preference in the plugin’s settings.
      </p>
      <Article.Heading level={3} text="Nylo Death Indicators" />
      <p>
        <Link href="https://runelite.net/plugin-hub/show/nylo-death-indicators">
          Nylo Death Indicators
        </Link>{' '}
        tracks your experience drops as you attack Nylos and immediately hides
        Nylos that will die to your attacks, before the client visually
        registers their death. Better yet, it integrates with the Party plugin,
        also removing the dead Nylo from your teammates&apos; screens. This is
        incredibly useful to avoid doubling up on Nylos that your teammates have
        already killed.
      </p>
    </Article.Page>
  );
}

export async function generateMetadata(_props: {}, parent: ResolvingMetadata) {
  return basicMetadata(await parent, {
    title: 'Theatre of Blood Plugins Guide',
    description:
      'Learn about the best Runelite plugins to enhance your Theatre of Blood raids.',
  });
}
