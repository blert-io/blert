import { ResolvedMetadata } from 'next';

type TitleAndDescription = {
  title: string;
  description: string;
};

/**
 * Creates a basic page metadata object consisting of a title and description.
 *
 * This exists because the description must be set in multiple places in the
 * metadata object which are not merged by Next.js.
 *
 * @param parent The parent metadata object to merge.
 * @param metadata The title and description to set.
 * @returns The merged metadata object.
 */
export function basicMetadata(
  parent: ResolvedMetadata,
  { title, description }: TitleAndDescription,
) {
  return {
    title,
    description,
    openGraph: { ...parent.openGraph, description },
    twitter: {
      ...parent.twitter,
      title,
      description,
    },
  };
}
