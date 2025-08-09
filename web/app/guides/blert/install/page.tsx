import { ResolvingMetadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';

import Article from '@/components/article';
import { basicMetadata } from '@/utils/metadata';

import styles from '../style.module.scss';

export default function BlertInstallGuide() {
  return (
    <Article.Page className={styles.blertGuide}>
      <Article.Heading level={1} text="How to Install Blert" />

      <p>
        Blert isn’t on the RuneLite Plugin Hub yet, so you’ll need to run a{' '}
        <strong>developer version of RuneLite</strong> to use it. Don’t worry,
        this guide will walk you through every step.
      </p>

      <Article.Heading level={2} text="Option 1: Full Setup (for new users)" />
      <p>
        This is the recommended path if you don’t already have a developer
        RuneLite client.
      </p>

      <Article.Heading level={3} text="Step 1: Install Git" />
      <p>
        Blert uses Git behind the scenes to manage its code. You’ll need to
        install Git <strong>system-wide</strong>.
      </p>
      <Article.Notice type="warning">
        <p>
          IntelliJ’s bundled Git will not work. You must install Git system-wide
          for Blert to build correctly.
        </p>
      </Article.Notice>
      <ul>
        <li>
          <Link href="https://git-scm.com/downloads">Download Git</Link>
        </li>
        <li>Choose default settings during installation.</li>
      </ul>

      <Article.Heading
        level={3}
        text="Step 2: Install IntelliJ IDEA (Community Edition)"
      />
      <p>
        You’ll need <strong>IntelliJ IDEA Community Edition</strong> — the free
        version.
      </p>
      <Article.Notice type="warning">
        <p>
          <strong>Do not download IntelliJ Ultimate.</strong> It’s paid and
          unnecessary.
        </p>
      </Article.Notice>
      <ul>
        <li>
          <Link href="https://www.jetbrains.com/idea/download">
            Download IntelliJ IDEA Community Edition
          </Link>
          . It’s typically the second link on the page.
        </li>
        <li>Install with default settings.</li>
      </ul>

      <Article.Heading level={3} text="Step 3: Clone the Blert Repository" />
      <ol>
        <li>
          <p>
            Open IntelliJ, then click <strong>Get from VCS</strong> on the
            welcome screen.
          </p>
          <p>
            If you don’t see the welcome screen, click <strong>File</strong> →{' '}
            <strong>New</strong> →{' '}
            <strong>Project from Version Control…</strong>
          </p>
        </li>
        <li>
          Make sure the <strong>Version Control</strong> dropdown is set to{' '}
          <strong>Git</strong>, then choose a folder to save the project and
          paste the following into the <strong>URL</strong> field:
          <Article.Code language="plaintext">
            https://github.com/blert-io/plugin
          </Article.Code>
          <Image
            src="/images/guides/blert/intellij-clone.png"
            alt="IntelliJ clone repository"
            width={589}
            height={130}
            unoptimized
            sizes="(max-width: 768px) 100vw, 589px"
            style={{ width: '100%', height: 'auto', maxWidth: '589px' }}
          />
        </li>
        <li>Wait for Gradle sync to complete (watch the bottom status bar).</li>
      </ol>

      <Article.Heading level={3} text="Step 4: Set Up the Run Configuration" />
      <ol>
        <li>
          In the sidebar, navigate through the folders
          <br />
          <i className="fa-solid fa-folder-open" />
          <code>plugin</code> → <i className="fa-solid fa-folder-open" />
          <code>src</code> → <i className="fa-solid fa-folder-open" />
          <code>main</code> → <i className="fa-solid fa-folder-open" />
          <code>java</code> → <i className="fa-solid fa-folder-open" />
          <code>io.blert</code>
        </li>
        <li>
          Right-click on <code>BlertPluginTest</code> and select{' '}
          <strong>Modify Run Configuration…</strong>
        </li>
        <li>
          From the <strong>Modify options</strong> dropdown, select{' '}
          <strong>Add VM options</strong>.
        </li>
        <li>
          In the <strong>VM options</strong> field, enter <code>-ea</code>.
        </li>
        <li>
          Click <strong>OK</strong> to save the configuration.
        </li>
      </ol>
      <p>
        Once complete, your run configuration should look similar to the image
        below (your Java version may differ).
      </p>
      <Image
        src="/images/guides/blert/intellij-run-configuration.png"
        alt="IntelliJ run configuration"
        width={500}
        height={200}
        unoptimized
        sizes="(max-width: 768px) 100vw, 500px"
        style={{ width: '100%', height: 'auto', maxWidth: '500px' }}
      />

      <Article.Heading level={3} text="Step 5: Run Blert" />
      <p>
        Either right-click on <code>BlertPluginTest</code> and select{' '}
        <strong>Run &apos;BlertPluginTest.main()&apos;</strong>, or click the
        green Run{' '}
        <i style={{ color: 'var(--blert-green)' }} className="fas fa-play" />{' '}
        button in the top-right corner of IntelliJ. This will launch a RuneLite
        client with Blert loaded.
      </p>
      <Article.Notice type="success">
        <p>
          If you see the Bloat icon in your RuneLite sidebar, you’ve
          successfully installed Blert!
        </p>
      </Article.Notice>

      <Article.Heading
        level={3}
        text="Optional: Logging in with a Jagex Account"
      />
      <p>
        If you use a <strong>Jagex Account</strong> to log in to Old School
        RuneScape, you&apos;ll need to enable support for it in your developer
        RuneLite client. Follow the official RuneLite guide here:
      </p>
      <p>
        <Link
          href="https://github.com/runelite/runelite/wiki/Using-Jagex-Accounts"
          target="_blank"
          rel="noreferrer noopener"
        >
          RuneLite Wiki: Using Jagex Accounts
        </Link>
      </p>
      <Article.Notice type="info">
        <p>
          Jagex Account login requires extra configuration compared to email and
          password login. Make sure you complete these steps before trying to
          sign in with your Jagex Account.
        </p>
      </Article.Notice>

      <Article.Heading
        level={2}
        text="Option 2: Sideload Blert (for users with an existing dev RuneLite setup)"
      />

      <Article.Heading level={3} text="Step 1: Download the Blert JAR" />
      <p>
        Ping a <strong style={{ color: '#e91e63' }}>@Support</strong> member in{' '}
        <Link
          href="https://discord.gg/c5Hgv3NnYe"
          target="_blank"
          rel="noreferrer noopener"
        >
          Blert’s Discord
        </Link>{' '}
        telling them you’d like to sideload Blert. They’ll give you access to a
        channel where you can download the latest plugin <code>.jar</code> file.
      </p>

      <Article.Heading
        level={3}
        text="Step 2: Move the File into sideloaded-plugins"
      />
      <p>
        Go to your RuneLite user folder and create a folder named{' '}
        <code>sideloaded-plugins</code>. Then move the <code>.jar</code> file
        into it.
      </p>
      <Article.Tabs
        tabs={[
          {
            id: 'windows',
            label: 'Windows',
            content: (
              <Article.Code language="plaintext">
                C:\Users\&lt;yourname&gt;\.runelite\sideloaded-plugins
              </Article.Code>
            ),
          },
          {
            id: 'macos',
            label: 'macOS',
            content: (
              <Article.Code language="plaintext">
                /Users/&lt;yourname&gt;/.runelite/sideloaded-plugins
              </Article.Code>
            ),
          },
          {
            id: 'linux',
            label: 'Linux',
            content: (
              <Article.Code language="plaintext">
                ~/.runelite/sideloaded-plugins
              </Article.Code>
            ),
          },
        ]}
        defaultTab="windows"
      />

      <Article.Heading level={3} text="Step 3: Launch Your Dev Client" />
      <p>
        Open your development RuneLite client. Blert should appear in the plugin
        list automatically.
      </p>

      <Article.Heading level={2} text="Next: Generate Your API Key" />
      <p>
        Once Blert is running, you’ll need to generate an API key and paste it
        into the plugin’s settings.
      </p>
      <p>
        <Link href="/guides/blert/getting-started">
          Click here to continue setting up your plugin{' '}
          <i className="fas fa-arrow-right" />
        </Link>
      </p>
    </Article.Page>
  );
}

export async function generateMetadata(_props: {}, parent: ResolvingMetadata) {
  return basicMetadata(await parent, {
    title: 'How to Install Blert',
    description:
      'Step-by-step guide to installing the Blert plugin for Old School RuneScape ' +
      'PvM tracking. Learn how to set up a developer RuneLite client and get Blert ' +
      'running in minutes.',
  });
}
