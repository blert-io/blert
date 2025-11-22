import { ResolvingMetadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';

import Article from '@/components/article';
import { basicMetadata } from '@/utils/metadata';

import styles from '../style.module.scss';

export default function GettingStarted() {
  return (
    <Article.Page className={styles.blertGuide}>
      <Article.Heading level={1} text="Getting Started with Blert" />

      <p>
        Once Blert is installed, you’ll need to link it to your Blert.io account
        using an API key. This allows the plugin to securely upload your raid
        data and tie it to your account.
      </p>

      <Article.Heading level={2} text="Step 1: Create a Blert Account" />
      <p>
        If you don’t already have a Blert account,{' '}
        <Link href="/register" target="_blank">
          sign up here
        </Link>{' '}
        (opens in a new tab). Your Blert username doesn’t have to be the same as
        your OSRS account.
      </p>

      <Article.Heading level={2} text="Step 2: Request API Key Access" />
      <p>
        Join the{' '}
        <Link href="https://discord.gg/c5Hgv3NnYe" target="_blank">
          Blert Discord
        </Link>{' '}
        and ping a <strong style={{ color: '#e91e63' }}>@Support</strong> member
        with your Blert username. They’ll enable API key access on your account.
      </p>

      <Article.Heading level={2} text="Step 3: Generate Your API Key" />
      <ol>
        <li>
          Once logged in, go to the{' '}
          <Link href="/settings" target="_blank">
            Settings page
          </Link>
          .
        </li>
        <li>
          In the <strong>API Keys</strong> section, under{' '}
          <strong>Generate new API key</strong>, enter your OSRS username and
          click <strong>Generate API Key</strong>.
        </li>
        <li>
          Copy the generated key using the <i className="fas fa-copy" /> copy
          icon.
        </li>
      </ol>
      <Image
        src="/images/guides/blert/api-key-panel.png"
        alt="API key generation panel"
        width={600}
        height={168}
        unoptimized
        sizes="(max-width: 768px) 100vw, 600px"
        style={{ width: '100%', height: 'auto', maxWidth: '600px' }}
      />

      <Article.Heading level={2} text="Step 4: Enter the Key in RuneLite" />
      <ol>
        <li>
          Open RuneLite and go to the <strong>Blert</strong> plugin settings
        </li>
        <li>
          Paste your API key into the <strong>Blert API Key</strong> field
        </li>
        <li>Close the settings tab — that’s it!</li>
      </ol>

      <Article.Notice type="success">
        <p>
          You can confirm the plugin is connected by clicking the Bloat icon in
          your RuneLite sidebar. If everything is working, you’ll see your
          username and connection status listed at the top of the plugin panel.
        </p>
        <Image
          src="/images/guides/blert/plugin-connected.png"
          alt="Plugin connected status"
          width={149}
          height={68}
          unoptimized
          style={{
            margin: '1em 0 0 0',
            width: '100%',
            height: 'auto',
            maxWidth: '149px',
          }}
          sizes="(max-width: 768px) 100vw, 149px"
        />
      </Article.Notice>

      <Article.Heading
        level={2}
        text="Step 5: Record Your First PvM Challenge"
      />
      <p>
        You’re now ready to start recording! Start a raid in the Theatre of
        Blood or enter the Colosseum — Blert will automatically detect your run
        and begin tracking data.
      </p>

      <Article.Heading level={2} text="Troubleshooting" />

      <Article.Heading level={3} text="Invalid API Key" />
      <ul>
        <li>Double-check that you copied the full key.</li>
        <li>
          Ensure the key is associated with the OSRS name you’re logged into
        </li>
        <li>
          If needed, regenerate the key from the{' '}
          <Link href="/settings" target="_blank">
            Settings page
          </Link>
          .
        </li>
      </ul>

      <Article.Heading level={3} text="No Data Uploading" />
      <ul>
        <li>
          Open the plugin sidebar and confirm you see your username connected.
        </li>
        <li>Ensure the raid was properly started (e.g. not in a lobby).</li>
        <li>
          Data is uploaded at the end of challenge stages (e.g. rooms/waves), so
          if you’re still in the middle of one, you won’t see anything.
        </li>
        <li>
          If you were spectating a raid and left early, it won’t be uploaded.
        </li>
      </ul>

      <Article.Heading level={3} text="No Permission to Generate Key" />
      <ul>
        <li>You haven’t been granted API access yet.</li>
        <li>
          Ping <strong style={{ color: '#e91e63' }}>@Support</strong> in Discord
          to request access.
        </li>
      </ul>
    </Article.Page>
  );
}

export async function generateMetadata(
  _props: object,
  parent: ResolvingMetadata,
) {
  return basicMetadata(await parent, {
    title: 'Getting Started with Blert',
    description:
      'Learn how to generate and apply your Blert API key to link your RuneLite ' +
      'plugin with your account and start recording your first challenge. ' +
      'Includes account setup, permissions, and troubleshooting.',
  });
}
