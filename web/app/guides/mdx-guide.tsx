import type { Heading } from 'mdast';
import type { Root } from 'mdast';
import { MDXContent, MDXRemote } from 'next-mdx-remote-client/rsc';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';
import React from 'react';

import Article from '@/components/article';

import { guideComponents } from './mdx-components';

type GuideComponents = Record<string, React.ComponentType<any>>;

type MdxGuideProps = {
  /** Raw MDX source. */
  // Note that this is always a string; there is no way to get an MDXContext
  // object with our setup. The MDXContent type is accepted because some build
  // environments are stubborn and don't recognize our custom loader.
  source: string | MDXContent;
  className?: string;
  /** Additional components to merge with the default guide set. */
  components?: GuideComponents;
};

/**
 * Remark plugin supporting `[#custom-id]` syntax on headings.
 * e.g. `#### Wave numbers [#nyloer-wave-numbers]`
 *
 * The `[#id]` appears as literal text in the last text node. This plugin strips
 * the marker and sets the heading's HTML id.
 */
function remarkHeadingId() {
  return (tree: Root) => {
    visit(tree, 'heading', (node: Heading) => {
      const last = node.children[node.children.length - 1];
      if (last?.type !== 'text') {
        return;
      }
      const match = /\s*\[#([a-zA-Z0-9-]+)\]\s*$/.exec(last.value);
      if (match === null) {
        return;
      }
      last.value = last.value.slice(0, match.index);
      const data = (node.data ??= {}) as Record<string, unknown>;
      const hProperties = (data.hProperties ??= {}) as Record<string, string>;
      hProperties.id = match[1].toLowerCase();
    });
  };
}

export function MdxGuide({ source, className, components }: MdxGuideProps) {
  const mergedComponents = components
    ? { ...guideComponents, ...components }
    : guideComponents;

  return (
    <Article.Page className={className}>
      <MDXRemote
        source={source as string}
        components={mergedComponents}
        options={{
          mdxOptions: {
            remarkPlugins: [remarkGfm, remarkHeadingId],
          },
        }}
      />
    </Article.Page>
  );
}
