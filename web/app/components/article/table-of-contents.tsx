'use client';

import { useContext, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Display, DisplayContext } from '@/display';

import styles from './style.module.scss';

type TableOfContentsProps = {};

const HEADING_HEIGHT = 28;
const COMPACT_TOPBAR_OFFSET = 70;

export function TableOfContents(props: TableOfContentsProps) {
  const display = useContext(DisplayContext);
  const router = useRouter();

  const [headings, setHeadings] = useState<Element[]>([]);
  const [tocRight, setTocRight] = useState(0);
  const [activeHeading, setActiveHeading] = useState<Element | null>(null);
  const scrollTimeout = useRef<number | null>(null);

  useEffect(() => {
    const findAndFilterHeadings = () => {
      let headings = Array.from(
        document.querySelectorAll('h2, h3, h4, h5, h6'),
      );

      // Limit the table of contents to fit in the window, by removing
      // lower-leveled headings until it fits.
      const maxHeight = Math.floor(window.innerHeight * 0.9) - 100;
      let maxLevel = 6;

      while (headings.length > 0) {
        const calculatedHeight = headings.length * HEADING_HEIGHT;
        if (calculatedHeight <= maxHeight) {
          break;
        }

        maxLevel -= 1;
        headings = headings.filter(
          (heading) => parseInt(heading.tagName[1]) <= maxLevel,
        );
      }

      setHeadings(headings);
    };

    const onResize = () => {
      findAndFilterHeadings();

      const wrapper = document.getElementById('blert-article-wrapper');
      if (window.innerWidth > Display.COMPACT_THRESHOLD && wrapper) {
        setTocRight(window.innerWidth - wrapper.getBoundingClientRect().right);
      }
    };

    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const onScroll = () => {
      const scrollPosition = window.scrollY;

      const newActiveHeading = headings.findLast((heading) => {
        const rect = heading.getBoundingClientRect();
        const headingTop = rect.top + scrollPosition - 1;
        return scrollPosition >= headingTop;
      });

      if (newActiveHeading) {
        setActiveHeading(newActiveHeading);
      }

      if (scrollTimeout.current) {
        clearTimeout(scrollTimeout.current);
      }
      setTimeout(() => {
        scrollTimeout.current = null;
      }, 100);
    };
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, [headings]);

  return (
    <div className={styles.tableOfContents} style={{ right: tocRight }}>
      <div className={styles.title}>On this page</div>
      {headings.map((heading, index) => {
        const level = parseInt(heading.tagName[1]);
        const paddingLeft = `${(level - 2) * 16}px`;

        const onClick = () => {
          if (heading.id) {
            router.replace(`#${heading.id}`, {
              scroll: false,
            });

            const offset = display.isCompact() ? COMPACT_TOPBAR_OFFSET : 10;
            window.scrollTo({
              top:
                heading.getBoundingClientRect().top + window.scrollY - offset,
              behavior: 'smooth',
            });
          }
        };

        let className = styles.heading;
        if (heading === activeHeading) {
          className += ` ${styles.active}`;
        }

        return (
          <div
            key={index}
            className={className}
            onClick={onClick}
            style={{ paddingLeft, height: HEADING_HEIGHT }}
          >
            {heading.textContent}
          </div>
        );
      })}
    </div>
  );
}
