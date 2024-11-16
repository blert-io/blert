'use client';

import { useState } from 'react';

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
};

const NAV_HEIGHT = 50;
const NAV_MARGIN = 10;

export default function Tabs({ fluid, maxHeight, tabs }: TabsProps) {
  const [activeTab, setActiveTab] = useState(0);

  let className = styles.tabs;
  if (fluid) {
    className += ` ${styles.fluid}`;
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
            onClick={() => setActiveTab(index)}
            className={`${styles.tab} ${activeTab === index ? styles.active : ''}`}
          >
            <i className={`${tab.icon} ${styles.icon}`} />
            {tab.title}
          </button>
        ))}
      </div>
      <div className={styles.content} style={contentStyle}>
        {tabs[activeTab]?.content}
      </div>
    </div>
  );
}
