import Image from 'next/image';
import Link from 'next/link';
import React from 'react';

import Article from '@/components/article';
import YoutubeEmbed from '@/components/youtube-embed';
import GuideTags from '@/guides/guide-tags';

import { MdxHashLink } from './mdx-hash-link';

import styles from './style.module.scss';

type GuideComponents = Record<string, React.ComponentType<any>>;

function mdxHeading(level: 1 | 2 | 3 | 4 | 5 | 6) {
  return function MdxHeading(props: {
    children?: React.ReactNode;
    id?: string;
  }) {
    return (
      <Article.Heading level={level} id={props.id}>
        {props.children}
      </Article.Heading>
    );
  };
}

export const guideComponents: GuideComponents = {
  // Map standard markdown elements to Article components.
  h1: mdxHeading(1),
  h2: mdxHeading(2),
  h3: mdxHeading(3),
  h4: mdxHeading(4),
  h5: mdxHeading(5),
  h6: mdxHeading(6),

  pre: (props: { children?: React.ReactNode }) => {
    // MDX renders fenced code blocks as
    // ```
    // <pre>
    //   <code className="language-X">{content}</code>
    // </pre>
    // ```
    // Extract the language and text content to pass to Article.Code.
    const { children } = props;
    if (React.isValidElement(children) && children.type === 'code') {
      const codeProps = children.props as {
        className?: string;
        children?: React.ReactNode;
      };
      const className = codeProps.className ?? '';
      const language = className.replace('language-', '') || undefined;
      const text =
        typeof codeProps.children === 'string' ? codeProps.children : '';
      return <Article.Code language={language}>{text}</Article.Code>;
    }
    return <pre>{children}</pre>;
  },

  a: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
    const { href, children, ...rest } = props;
    if (!href) {
      return <a {...rest}>{children}</a>;
    }
    if (href.startsWith('#')) {
      return (
        <MdxHashLink href={href} {...rest}>
          {children}
        </MdxHashLink>
      );
    }
    const isExternal =
      href.startsWith('http://') || href.startsWith('https://');
    if (isExternal) {
      return (
        <Link href={href} target="_blank" rel="noreferrer noopener" {...rest}>
          {children}
          <i className="fas fa-external-link-alt" />
        </Link>
      );
    }
    return (
      <Link href={href} {...rest}>
        {children}
      </Link>
    );
  },

  // Custom Article components available in MDX without imports.
  Notice: Article.Notice,
  Tabs: Article.Tabs,
  Code: Article.Code,
  Heading: Article.Heading,
  Tooltip: Article.Tooltip,
  AppendixDefine: Article.Appendix.Define,
  AppendixRef: Article.Appendix.Ref,
  Image: Image as GuideComponents[string],
  Link: Link as GuideComponents[string],
  YoutubeEmbed: YoutubeEmbed as GuideComponents[string],
  GuideTags: GuideTags as GuideComponents[string],
  AuthorCredits: (props: { children?: React.ReactNode }) => (
    <span className={styles.authorCredits}>{props.children}</span>
  ),
};
