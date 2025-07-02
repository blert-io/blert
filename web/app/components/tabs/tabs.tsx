'use client';

import { JSX, useEffect, useRef, useState } from 'react';

import styles from './style.module.scss';

type Tab = {
  icon: string;
  title?: string;
  content: JSX.Element;
};

type TabsProps = {
  fluid?: boolean;
  maxHeight?: number;
  tabs: Tab[];
  small?: boolean;
};

const NAV_HEIGHT = 50;
const NAV_MARGIN = 10;

export default function Tabs({
  fluid,
  maxHeight,
  tabs,
  small = false,
}: TabsProps) {
  const [activeTab, setActiveTab] = useState(0);
  const [indicatorStyle, setIndicatorStyle] = useState<React.CSSProperties>({});
  const tabsRef = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const activeTabElement = tabsRef.current[activeTab];
    if (activeTabElement) {
      setIndicatorStyle({
        width: `${activeTabElement.offsetWidth}px`,
        transform: `translateX(${activeTabElement.offsetLeft}px)`,
      });
    }
  }, [activeTab]);

  let className = styles.tabs;
  if (fluid) {
    className += ` ${styles.fluid}`;
  }
  if (small) {
    className += ` ${styles.small}`;
  }

  let contentStyle: React.CSSProperties = {};
  if (maxHeight) {
    contentStyle.maxHeight = maxHeight - NAV_HEIGHT - NAV_MARGIN;
  }

  return (
    <div className={className}>
      <div
        className={styles.navigation}
        style={{ height: NAV_HEIGHT, marginBottom: NAV_MARGIN }}
      >
        {tabs.map((tab, index) => (
          <button
            key={index}
            ref={(el) => {
              tabsRef.current[index] = el;
            }}
            onClick={() => setActiveTab(index)}
            className={`${styles.tab} ${activeTab === index ? styles.active : ''}`}
          >
            <i className={`${tab.icon} ${styles.icon}`} />
            <span className={styles.title}>{tab.title}</span>
          </button>
        ))}
        <div className={styles.indicator} style={indicatorStyle} />
      </div>
      <div className={styles.content} style={contentStyle}>
        {tabs[activeTab]?.content}
      </div>
    </div>
  );
}
