'use client';

import { useContext, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Display, DisplayContext } from '@/display';

import styles from './style.module.scss';

type TableOfContentsProps = Record<string, never>;

const HEADING_HEIGHT = 32;
const COMPACT_TOPBAR_OFFSET = 70;
const SCROLL_OFFSET = 20;

export function TableOfContents(_props: TableOfContentsProps) {
  const display = useContext(DisplayContext);
  const router = useRouter();

  const [headings, setHeadings] = useState<Element[]>([]);
  const [tocRight, setTocRight] = useState(0);
  const [activeHeading, setActiveHeading] = useState<Element | null>(null);
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimeout = useRef<number | null>(null);
  const intersectionObserver = useRef<IntersectionObserver | null>(null);
  const mutationObserver = useRef<MutationObserver | null>(null);
  const rafId = useRef<number | null>(null);

  useEffect(() => {
    const findAndFilterHeadings = () => {
      const wrapper = document.getElementById('blert-article-wrapper');
      let headings = Array.from(
        (wrapper ?? document).querySelectorAll('h2, h3, h4, h5, h6'),
      );

      headings = headings.filter((heading) => {
        const tocElement = heading.closest(`.${styles.tableOfContents}`);
        if (tocElement) {
          return false;
        }

        const isAppendixHeading =
          heading.tagName === 'H2' && heading.id === 'appendix';
        const isChildOfAppendix = !!heading.closest('#appendix');
        if (isChildOfAppendix && !isAppendixHeading) {
          return false;
        }

        return true;
      });

      // Limit the table of contents to fit in the window, by removing
      // lower-leveled headings until it fits.
      const maxHeight = Math.floor(window.innerHeight * 0.8) - 120;
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

    // Watch for dynamic content (e.g., Appendix mounted later).
    const wrapper = document.getElementById('blert-article-wrapper');
    if (wrapper && !mutationObserver.current) {
      mutationObserver.current = new MutationObserver(() => {
        // Debounce to next frame.
        if (rafId.current) {
          cancelAnimationFrame(rafId.current);
        }
        rafId.current = requestAnimationFrame(() => findAndFilterHeadings());
      });
      mutationObserver.current.observe(wrapper, {
        childList: true,
        subtree: true,
      });
    }
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (intersectionObserver.current) {
      intersectionObserver.current.disconnect();
    }

    if (headings.length === 0) {
      return;
    }

    intersectionObserver.current = new IntersectionObserver(
      (entries) => {
        if (isScrolling) {
          return;
        }

        const visibleHeadings = entries
          .filter((entry) => entry.isIntersecting)
          .map((entry) => entry.target);

        if (visibleHeadings.length > 0) {
          const closestHeading = visibleHeadings.reduce((closest, current) => {
            const closestRect = closest.getBoundingClientRect();
            const currentRect = current.getBoundingClientRect();

            const closestDistance = Math.abs(closestRect.top - SCROLL_OFFSET);
            const currentDistance = Math.abs(currentRect.top - SCROLL_OFFSET);

            return currentDistance < closestDistance ? current : closest;
          });

          setActiveHeading(closestHeading);
        } else {
          const scrollPosition = window.scrollY + SCROLL_OFFSET;

          let newActiveHeading = null;
          for (let i = headings.length - 1; i >= 0; i--) {
            const heading = headings[i];
            const headingTop =
              heading.getBoundingClientRect().top + window.scrollY;

            if (scrollPosition >= headingTop) {
              newActiveHeading = heading;
              break;
            }
          }

          if (newActiveHeading) {
            setActiveHeading(newActiveHeading);
          } else if (headings.length > 0) {
            setActiveHeading(headings[0]);
          }
        }
      },
      {
        rootMargin: `-${SCROLL_OFFSET}px 0px -60% 0px`,
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
      },
    );

    headings.forEach((heading) => {
      intersectionObserver.current?.observe(heading);
    });

    const handleScroll = () => {
      if (isScrolling) {
        return;
      }

      clearTimeout(scrollTimeout.current!);
      scrollTimeout.current = window.setTimeout(() => {
        const scrollPosition = window.scrollY + SCROLL_OFFSET;

        let newActiveHeading = null;
        for (let i = headings.length - 1; i >= 0; i--) {
          const heading = headings[i];
          const headingTop =
            heading.getBoundingClientRect().top + window.scrollY;

          if (scrollPosition >= headingTop) {
            newActiveHeading = heading;
            break;
          }
        }

        if (newActiveHeading && newActiveHeading !== activeHeading) {
          setActiveHeading(newActiveHeading);
        } else if (!newActiveHeading && headings.length > 0) {
          setActiveHeading(headings[0]);
        }
      }, 50);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      intersectionObserver.current?.disconnect();
      if (mutationObserver.current) {
        mutationObserver.current.disconnect();
        mutationObserver.current = null;
      }
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
      }
      window.removeEventListener('scroll', handleScroll);
      if (scrollTimeout.current) {
        clearTimeout(scrollTimeout.current);
      }
    };
  }, [headings, isScrolling, activeHeading]);

  const handleHeadingClick = (heading: Element) => {
    if (!heading.id) {
      return;
    }

    setIsScrolling(true);

    router.replace(`#${heading.id}`, { scroll: false });

    const offset = display.isCompact() ? COMPACT_TOPBAR_OFFSET : SCROLL_OFFSET;
    const targetPosition =
      heading.getBoundingClientRect().top + window.scrollY - offset;

    const startPosition = window.scrollY;
    const distance = targetPosition - startPosition;
    const duration = Math.min(800, Math.abs(distance) * 0.5 + 300);
    const startTime = performance.now();

    const easeInOutCubic = (t: number): number => {
      return t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;
    };

    const animateScroll = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easedProgress = easeInOutCubic(progress);

      window.scrollTo(0, startPosition + distance * easedProgress);

      if (progress < 1) {
        requestAnimationFrame(animateScroll);
      } else {
        setTimeout(() => setIsScrolling(false), 100);
      }
    };

    requestAnimationFrame(animateScroll);
  };

  if (headings.length === 0) {
    return null;
  }

  return (
    <nav className={styles.tableOfContents} style={{ right: tocRight }}>
      <div className={styles.title}>On this page</div>
      {headings.map((heading, index) => {
        const level = parseInt(heading.tagName[1]);
        const baseIndent = 12;
        const levelIndent = (level - 2) * 20;
        const paddingLeft = `${baseIndent + levelIndent}px`;
        const isActive = heading === activeHeading;

        let className = styles.heading;
        if (isActive) {
          className += ` ${styles.active}`;
        }

        return (
          <button
            key={index}
            type="button"
            className={className}
            onClick={() => handleHeadingClick(heading)}
            style={{
              paddingLeft,
              height: HEADING_HEIGHT,
              textAlign: 'left',
              background: 'none',
              border: 'none',
              width: '100%',
              fontSize: 'inherit',
              fontFamily: 'inherit',
            }}
            title={heading.textContent ?? ''}
          >
            {heading.textContent}
          </button>
        );
      })}
    </nav>
  );
}
