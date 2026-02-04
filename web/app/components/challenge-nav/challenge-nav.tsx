'use client';

import {
  Challenge,
  ChallengeType,
  ColosseumChallenge,
  InfernoChallenge,
  MokhaiotlChallenge,
  Stage,
  TobRaid,
} from '@blert/common';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useContext, useEffect, useRef, useState } from 'react';

import { ChallengeContext } from '@/challenge-context';
import { useDisplay } from '@/display';
import { challengeUrl } from '@/utils/url';

import MaidenIcon from '@/svg/maiden.svg';
import BloatIcon from '@/svg/bloat.svg';
import NylocasIcon from '@/svg/nyloking.svg';
import SotetsegIcon from '@/svg/sotetseg.svg';
import XarpusIcon from '@/svg/xarpus.svg';
import VerzikIcon from '@/svg/verzik.svg';

import styles from './style.module.scss';

interface ChallengeNavProps {
  challengeId: string;
}

interface NavItem {
  path: string;
  label: string;
  stage: Stage;
  icon?: React.ReactNode;
  styles?: React.CSSProperties;
  children?: NavItem[];
}

const TOB_NAV_ITEMS: NavItem[] = [
  {
    path: 'overview',
    label: 'Overview',
    stage: Stage.UNKNOWN,
    icon: <i className="fa-solid fa-list" />,
  },
  {
    path: 'maiden',
    label: 'Maiden',
    stage: Stage.TOB_MAIDEN,
    icon: <MaidenIcon height={24} width={24} />,
  },
  {
    path: 'bloat',
    label: 'Bloat',
    stage: Stage.TOB_BLOAT,
    icon: <BloatIcon height={24} width={24} />,
  },
  {
    path: 'nylocas',
    label: 'Nylocas',
    stage: Stage.TOB_NYLOCAS,
    icon: <NylocasIcon height={24} width={24} />,
  },
  {
    path: 'sotetseg',
    label: 'Sotetseg',
    stage: Stage.TOB_SOTETSEG,
    icon: <SotetsegIcon height={24} width={24} />,
  },
  {
    path: 'xarpus',
    label: 'Xarpus',
    stage: Stage.TOB_XARPUS,
    icon: <XarpusIcon height={24} width={24} />,
  },
  {
    path: 'verzik',
    label: 'Verzik',
    stage: Stage.TOB_VERZIK,
    icon: <VerzikIcon height={24} width={24} />,
  },
];

const COLOSSEUM_NAV_ITEMS: NavItem[] = [
  {
    path: 'overview',
    label: 'Overview',
    stage: Stage.UNKNOWN,
    icon: <i className="fa-solid fa-list" />,
  },
  {
    path: 'waves/1',
    label: '',
    stage: Stage.COLOSSEUM_WAVE_1,
    icon: <span className={styles.waveIcon}>I</span>,
  },
  {
    path: 'waves/2',
    label: '',
    stage: Stage.COLOSSEUM_WAVE_2,
    icon: <span className={styles.waveIcon}>II</span>,
  },
  {
    path: 'waves/3',
    label: '',
    stage: Stage.COLOSSEUM_WAVE_3,
    icon: <span className={styles.waveIcon}>III</span>,
  },
  {
    path: 'waves/4',
    label: '',
    stage: Stage.COLOSSEUM_WAVE_4,
    icon: <span className={styles.waveIcon}>IV</span>,
  },
  {
    path: 'waves/5',
    label: '',
    stage: Stage.COLOSSEUM_WAVE_5,
    icon: <span className={styles.waveIcon}>V</span>,
  },
  {
    path: 'waves/6',
    label: '',
    stage: Stage.COLOSSEUM_WAVE_6,
    icon: <span className={styles.waveIcon}>VI</span>,
  },
  {
    path: 'waves/7',
    label: '',
    stage: Stage.COLOSSEUM_WAVE_7,
    icon: <span className={styles.waveIcon}>VII</span>,
  },
  {
    path: 'waves/8',
    label: '',
    stage: Stage.COLOSSEUM_WAVE_8,
    icon: <span className={styles.waveIcon}>VIII</span>,
  },
  {
    path: 'waves/9',
    label: '',
    stage: Stage.COLOSSEUM_WAVE_9,
    icon: <span className={styles.waveIcon}>IX</span>,
  },
  {
    path: 'waves/10',
    label: '',
    stage: Stage.COLOSSEUM_WAVE_10,
    icon: <span className={styles.waveIcon}>X</span>,
  },
  {
    path: 'waves/11',
    label: '',
    stage: Stage.COLOSSEUM_WAVE_11,
    icon: <span className={styles.waveIcon}>XI</span>,
  },
  {
    path: 'waves/12',
    label: 'Sol Heredit',
    stage: Stage.COLOSSEUM_WAVE_12,
    icon: <i className="fa-solid fa-crown" style={{ fontSize: '1.1em' }} />,
    styles: { fontFamily: 'var(--font-cinzel), serif' },
  },
];

const MOKHAIOTL_NAV_ITEMS: NavItem[] = [
  {
    path: 'overview',
    label: 'Overview',
    stage: Stage.UNKNOWN,
    icon: <i className="fa-solid fa-list" />,
  },
  {
    path: 'delves/1',
    label: 'Delve 1',
    stage: Stage.MOKHAIOTL_DELVE_1,
    icon: <i className="fa-solid fa-person-digging" />,
  },
  {
    path: 'delves/2',
    label: 'Delve 2',
    stage: Stage.MOKHAIOTL_DELVE_2,
    icon: <i className="fa-solid fa-person-digging" />,
  },
  {
    path: 'delves/3',
    label: 'Delve 3',
    stage: Stage.MOKHAIOTL_DELVE_3,
    icon: <i className="fa-solid fa-person-digging" />,
  },
  {
    path: 'delves/4',
    label: 'Delve 4',
    stage: Stage.MOKHAIOTL_DELVE_4,
    icon: <i className="fa-solid fa-person-digging" />,
  },
  {
    path: 'delves/5',
    label: 'Delve 5',
    stage: Stage.MOKHAIOTL_DELVE_5,
    icon: <i className="fa-solid fa-person-digging" />,
  },
  {
    path: 'delves/6',
    label: 'Delve 6',
    stage: Stage.MOKHAIOTL_DELVE_6,
    icon: <i className="fa-solid fa-person-digging" />,
  },
  {
    path: 'delves/7',
    label: 'Delve 7',
    stage: Stage.MOKHAIOTL_DELVE_7,
    icon: <i className="fa-solid fa-person-digging" />,
  },
  {
    path: 'delves/8',
    label: 'Delve 8',
    stage: Stage.MOKHAIOTL_DELVE_8,
    icon: <i className="fa-solid fa-person-digging" />,
  },
];

const INFERNO_NAV_ITEMS: NavItem[] = [
  {
    path: 'overview',
    label: 'Overview',
    stage: Stage.UNKNOWN,
    icon: <i className="fa-solid fa-list" />,
  },
  {
    path: 'waves/1',
    label: '1-8',
    stage: Stage.INFERNO_WAVE_1,
    children: [
      {
        path: 'waves/1',
        label: 'Wave 1',
        stage: Stage.INFERNO_WAVE_1,
        icon: <span className={styles.waveIcon}>1</span>,
      },
      {
        path: 'waves/2',
        label: 'Wave 2',
        stage: Stage.INFERNO_WAVE_2,
        icon: <span className={styles.waveIcon}>2</span>,
      },
      {
        path: 'waves/3',
        label: 'Wave 3',
        stage: Stage.INFERNO_WAVE_3,
        icon: <span className={styles.waveIcon}>3</span>,
      },
      {
        path: 'waves/4',
        label: 'Wave 4',
        stage: Stage.INFERNO_WAVE_4,
        icon: <span className={styles.waveIcon}>4</span>,
      },
      {
        path: 'waves/5',
        label: 'Wave 5',
        stage: Stage.INFERNO_WAVE_5,
        icon: <span className={styles.waveIcon}>5</span>,
      },
      {
        path: 'waves/6',
        label: 'Wave 6',
        stage: Stage.INFERNO_WAVE_6,
        icon: <span className={styles.waveIcon}>6</span>,
      },
      {
        path: 'waves/7',
        label: 'Wave 7',
        stage: Stage.INFERNO_WAVE_7,
        icon: <span className={styles.waveIcon}>7</span>,
      },
      {
        path: 'waves/8',
        label: 'Wave 8',
        stage: Stage.INFERNO_WAVE_8,
        icon: <span className={styles.waveIcon}>8</span>,
      },
    ],
  },
  {
    path: 'waves/9',
    label: '9-17',
    stage: Stage.INFERNO_WAVE_9,
    children: [
      {
        path: 'waves/9',
        label: 'Wave 9',
        stage: Stage.INFERNO_WAVE_9,
        icon: <span className={styles.waveIcon}>9</span>,
      },
      {
        path: 'waves/10',
        label: 'Wave 10',
        stage: Stage.INFERNO_WAVE_10,
        icon: <span className={styles.waveIcon}>10</span>,
      },
      {
        path: 'waves/11',
        label: 'Wave 11',
        stage: Stage.INFERNO_WAVE_11,
        icon: <span className={styles.waveIcon}>11</span>,
      },
      {
        path: 'waves/12',
        label: 'Wave 12',
        stage: Stage.INFERNO_WAVE_12,
        icon: <span className={styles.waveIcon}>12</span>,
      },
      {
        path: 'waves/13',
        label: 'Wave 13',
        stage: Stage.INFERNO_WAVE_13,
        icon: <span className={styles.waveIcon}>13</span>,
      },
      {
        path: 'waves/14',
        label: 'Wave 14',
        stage: Stage.INFERNO_WAVE_14,
        icon: <span className={styles.waveIcon}>14</span>,
      },
      {
        path: 'waves/15',
        label: 'Wave 15',
        stage: Stage.INFERNO_WAVE_15,
        icon: <span className={styles.waveIcon}>15</span>,
      },
      {
        path: 'waves/16',
        label: 'Wave 16',
        stage: Stage.INFERNO_WAVE_16,
        icon: <span className={styles.waveIcon}>16</span>,
      },
      {
        path: 'waves/17',
        label: 'Wave 17',
        stage: Stage.INFERNO_WAVE_17,
        icon: <span className={styles.waveIcon}>17</span>,
      },
    ],
  },
  {
    path: 'waves/18',
    label: '18-24',
    stage: Stage.INFERNO_WAVE_18,
    children: [
      {
        path: 'waves/18',
        label: 'Wave 18',
        stage: Stage.INFERNO_WAVE_18,
        icon: <span className={styles.waveIcon}>18</span>,
      },
      {
        path: 'waves/19',
        label: 'Wave 19',
        stage: Stage.INFERNO_WAVE_19,
        icon: <span className={styles.waveIcon}>19</span>,
      },
      {
        path: 'waves/20',
        label: 'Wave 20',
        stage: Stage.INFERNO_WAVE_20,
        icon: <span className={styles.waveIcon}>20</span>,
      },
      {
        path: 'waves/21',
        label: 'Wave 21',
        stage: Stage.INFERNO_WAVE_21,
        icon: <span className={styles.waveIcon}>21</span>,
      },
      {
        path: 'waves/22',
        label: 'Wave 22',
        stage: Stage.INFERNO_WAVE_22,
        icon: <span className={styles.waveIcon}>22</span>,
      },
      {
        path: 'waves/23',
        label: 'Wave 23',
        stage: Stage.INFERNO_WAVE_23,
        icon: <span className={styles.waveIcon}>23</span>,
      },
      {
        path: 'waves/24',
        label: 'Wave 24',
        stage: Stage.INFERNO_WAVE_24,
        icon: <span className={styles.waveIcon}>24</span>,
      },
    ],
  },
  {
    path: 'waves/25',
    label: '25-34',
    stage: Stage.INFERNO_WAVE_25,
    children: [
      {
        path: 'waves/25',
        label: 'Wave 25',
        stage: Stage.INFERNO_WAVE_25,
        icon: <span className={styles.waveIcon}>25</span>,
      },
      {
        path: 'waves/26',
        label: 'Wave 26',
        stage: Stage.INFERNO_WAVE_26,
        icon: <span className={styles.waveIcon}>26</span>,
      },
      {
        path: 'waves/27',
        label: 'Wave 27',
        stage: Stage.INFERNO_WAVE_27,
        icon: <span className={styles.waveIcon}>27</span>,
      },
      {
        path: 'waves/28',
        label: 'Wave 28',
        stage: Stage.INFERNO_WAVE_28,
        icon: <span className={styles.waveIcon}>28</span>,
      },
      {
        path: 'waves/29',
        label: 'Wave 29',
        stage: Stage.INFERNO_WAVE_29,
        icon: <span className={styles.waveIcon}>29</span>,
      },
      {
        path: 'waves/30',
        label: 'Wave 30',
        stage: Stage.INFERNO_WAVE_30,
        icon: <span className={styles.waveIcon}>30</span>,
      },
      {
        path: 'waves/31',
        label: 'Wave 31',
        stage: Stage.INFERNO_WAVE_31,
        icon: <span className={styles.waveIcon}>31</span>,
      },
      {
        path: 'waves/32',
        label: 'Wave 32',
        stage: Stage.INFERNO_WAVE_32,
        icon: <span className={styles.waveIcon}>32</span>,
      },
      {
        path: 'waves/33',
        label: 'Wave 33',
        stage: Stage.INFERNO_WAVE_33,
        icon: <span className={styles.waveIcon}>33</span>,
      },
      {
        path: 'waves/34',
        label: 'Wave 34',
        stage: Stage.INFERNO_WAVE_34,
        icon: <span className={styles.waveIcon}>34</span>,
      },
    ],
  },
  {
    path: 'waves/35',
    label: '35-41',
    stage: Stage.INFERNO_WAVE_35,
    children: [
      {
        path: 'waves/35',
        label: 'Wave 35',
        stage: Stage.INFERNO_WAVE_35,
        icon: <span className={styles.waveIcon}>35</span>,
      },
      {
        path: 'waves/36',
        label: 'Wave 36',
        stage: Stage.INFERNO_WAVE_36,
        icon: <span className={styles.waveIcon}>36</span>,
      },
      {
        path: 'waves/37',
        label: 'Wave 37',
        stage: Stage.INFERNO_WAVE_37,
        icon: <span className={styles.waveIcon}>37</span>,
      },
      {
        path: 'waves/38',
        label: 'Wave 38',
        stage: Stage.INFERNO_WAVE_38,
        icon: <span className={styles.waveIcon}>38</span>,
      },
      {
        path: 'waves/39',
        label: 'Wave 39',
        stage: Stage.INFERNO_WAVE_39,
        icon: <span className={styles.waveIcon}>39</span>,
      },
      {
        path: 'waves/40',
        label: 'Wave 40',
        stage: Stage.INFERNO_WAVE_40,
        icon: <span className={styles.waveIcon}>40</span>,
      },
      {
        path: 'waves/41',
        label: 'Wave 41',
        stage: Stage.INFERNO_WAVE_41,
        icon: <span className={styles.waveIcon}>41</span>,
      },
    ],
  },
  {
    path: 'waves/42',
    label: '42-49',
    stage: Stage.INFERNO_WAVE_42,
    children: [
      {
        path: 'waves/42',
        label: 'Wave 42',
        stage: Stage.INFERNO_WAVE_42,
        icon: <span className={styles.waveIcon}>42</span>,
      },
      {
        path: 'waves/43',
        label: 'Wave 43',
        stage: Stage.INFERNO_WAVE_43,
        icon: <span className={styles.waveIcon}>43</span>,
      },
      {
        path: 'waves/44',
        label: 'Wave 44',
        stage: Stage.INFERNO_WAVE_44,
        icon: <span className={styles.waveIcon}>44</span>,
      },
      {
        path: 'waves/45',
        label: 'Wave 45',
        stage: Stage.INFERNO_WAVE_45,
        icon: <span className={styles.waveIcon}>45</span>,
      },
      {
        path: 'waves/46',
        label: 'Wave 46',
        stage: Stage.INFERNO_WAVE_46,
        icon: <span className={styles.waveIcon}>46</span>,
      },
      {
        path: 'waves/47',
        label: 'Wave 47',
        stage: Stage.INFERNO_WAVE_47,
        icon: <span className={styles.waveIcon}>47</span>,
      },
      {
        path: 'waves/48',
        label: 'Wave 48',
        stage: Stage.INFERNO_WAVE_48,
        icon: <span className={styles.waveIcon}>48</span>,
      },
      {
        path: 'waves/49',
        label: 'Wave 49',
        stage: Stage.INFERNO_WAVE_49,
        icon: <span className={styles.waveIcon}>49</span>,
      },
    ],
  },
  {
    path: 'waves/50',
    label: '50-56',
    stage: Stage.INFERNO_WAVE_50,
    children: [
      {
        path: 'waves/50',
        label: 'Wave 50',
        stage: Stage.INFERNO_WAVE_50,
        icon: <span className={styles.waveIcon}>50</span>,
      },
      {
        path: 'waves/51',
        label: 'Wave 51',
        stage: Stage.INFERNO_WAVE_51,
        icon: <span className={styles.waveIcon}>51</span>,
      },
      {
        path: 'waves/52',
        label: 'Wave 52',
        stage: Stage.INFERNO_WAVE_52,
        icon: <span className={styles.waveIcon}>52</span>,
      },
      {
        path: 'waves/53',
        label: 'Wave 53',
        stage: Stage.INFERNO_WAVE_53,
        icon: <span className={styles.waveIcon}>53</span>,
      },
      {
        path: 'waves/54',
        label: 'Wave 54',
        stage: Stage.INFERNO_WAVE_54,
        icon: <span className={styles.waveIcon}>54</span>,
      },
      {
        path: 'waves/55',
        label: 'Wave 55',
        stage: Stage.INFERNO_WAVE_55,
        icon: <span className={styles.waveIcon}>55</span>,
      },
      {
        path: 'waves/56',
        label: 'Wave 56',
        stage: Stage.INFERNO_WAVE_56,
        icon: <span className={styles.waveIcon}>56</span>,
      },
    ],
  },
  {
    path: 'waves/57',
    label: '57-59',
    stage: Stage.INFERNO_WAVE_57,
    children: [
      {
        path: 'waves/57',
        label: 'Wave 57',
        stage: Stage.INFERNO_WAVE_57,
        icon: <span className={styles.waveIcon}>57</span>,
      },
      {
        path: 'waves/58',
        label: 'Wave 58',
        stage: Stage.INFERNO_WAVE_58,
        icon: <span className={styles.waveIcon}>58</span>,
      },
      {
        path: 'waves/59',
        label: 'Wave 59',
        stage: Stage.INFERNO_WAVE_59,
        icon: <span className={styles.waveIcon}>59</span>,
      },
    ],
  },
  {
    path: 'waves/60',
    label: '60-62',
    stage: Stage.INFERNO_WAVE_60,
    children: [
      {
        path: 'waves/60',
        label: 'Wave 60',
        stage: Stage.INFERNO_WAVE_60,
        icon: <span className={styles.waveIcon}>60</span>,
      },
      {
        path: 'waves/61',
        label: 'Wave 61',
        stage: Stage.INFERNO_WAVE_61,
        icon: <span className={styles.waveIcon}>61</span>,
      },
      {
        path: 'waves/62',
        label: 'Wave 62',
        stage: Stage.INFERNO_WAVE_62,
        icon: <span className={styles.waveIcon}>62</span>,
      },
    ],
  },
  {
    path: 'waves/63',
    label: '63-65',
    stage: Stage.INFERNO_WAVE_63,
    children: [
      {
        path: 'waves/63',
        label: 'Wave 63',
        stage: Stage.INFERNO_WAVE_63,
        icon: <span className={styles.waveIcon}>63</span>,
      },
      {
        path: 'waves/64',
        label: 'Wave 64',
        stage: Stage.INFERNO_WAVE_64,
        icon: <span className={styles.waveIcon}>64</span>,
      },
      {
        path: 'waves/65',
        label: 'Wave 65',
        stage: Stage.INFERNO_WAVE_65,
        icon: <span className={styles.waveIcon}>65</span>,
      },
    ],
  },
  {
    path: 'waves/66',
    label: '66',
    stage: Stage.INFERNO_WAVE_66,
  },
  {
    path: 'waves/67',
    label: 'Jad',
    stage: Stage.INFERNO_WAVE_67,
    icon: <i className="fa-solid fa-skull" />,
  },
  {
    path: 'waves/68',
    label: 'Triples',
    stage: Stage.INFERNO_WAVE_68,
    icon: <i className="fa-solid fa-skull-crossbones" />,
  },
  {
    path: 'waves/69',
    label: 'Zuk',
    stage: Stage.INFERNO_WAVE_69,
    icon: <i className="fa-solid fa-crown" />,
  },
];

interface NavItemComponentProps {
  item: NavItem;
  challengeType: ChallengeType;
  challengeId: string;
  pathname: string;
  isStageAccessible: (stage: Stage) => boolean;
  activeItemRef: React.RefObject<HTMLAnchorElement | null>;
  dropdownOpen: boolean;
  onDropdownOpen: (stage: Stage) => void;
  onDropdownClose: () => void;
}

function NavItemComponent({
  item,
  challengeType,
  challengeId,
  pathname,
  isStageAccessible,
  activeItemRef,
  dropdownOpen,
  onDropdownOpen,
  onDropdownClose,
}: NavItemComponentProps) {
  const display = useDisplay();

  if (item.children) {
    const anyChildActive = item.children.some((child) => {
      const path = `${challengeUrl(challengeType, challengeId)}/${child.path}`;
      return pathname === path;
    });

    const anyChildAccessible = item.children.some((child) =>
      isStageAccessible(child.stage),
    );

    const isAccessible = anyChildAccessible;

    const handleInteraction = () => {
      if (display.isCompact()) {
        if (dropdownOpen) {
          onDropdownClose();
        } else {
          onDropdownOpen(item.stage);
        }
      }
    };

    const handleMouseEvents = display.isCompact()
      ? {}
      : {
          onMouseEnter: () => onDropdownOpen(item.stage),
          onMouseLeave: onDropdownClose,
        };

    return (
      <div className={styles.dropdown} {...handleMouseEvents}>
        <div
          className={`${styles.navItem} ${anyChildActive ? styles.active : ''} ${
            !isAccessible ? styles.disabled : ''
          }`}
          style={item.styles}
          onClick={handleInteraction}
        >
          {item.icon}
          {item.label}
          <i className="fa-solid fa-chevron-down" />
        </div>
        {dropdownOpen && isAccessible && (
          <div
            className={styles.dropdownContent}
            onClick={(e) => {
              if (display.isCompact() && e.target === e.currentTarget) {
                onDropdownClose();
              }
            }}
          >
            {item.children.map((child) => {
              const path = `${challengeUrl(challengeType, challengeId)}/${child.path}`;
              const isChildAccessible = isStageAccessible(child.stage);
              const isActive = pathname === path;

              return (
                <Link
                  key={child.stage}
                  href={isChildAccessible ? path : '#'}
                  className={`${styles.dropdownItem} ${
                    isActive ? styles.active : ''
                  } ${!isChildAccessible ? styles.disabled : ''}`}
                  onClick={(e) => {
                    if (!isChildAccessible) {
                      e.preventDefault();
                    } else if (display.isCompact()) {
                      onDropdownClose();
                    }
                  }}
                  ref={isActive ? activeItemRef : null}
                  style={child.styles}
                >
                  {child.icon}
                  {child.label}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  } else {
    const path = `${challengeUrl(challengeType, challengeId)}/${item.path}`;
    const isAccessible = isStageAccessible(item.stage);
    const isActive = pathname === path;

    return (
      <Link
        key={item.stage}
        href={isAccessible ? path : '#'}
        className={`${styles.navItem} ${isActive ? styles.active : ''} ${
          !isAccessible ? styles.disabled : ''
        }`}
        onClick={(e) => {
          if (!isAccessible) {
            e.preventDefault();
          }
        }}
        ref={isActive ? activeItemRef : null}
        style={item.styles}
      >
        {item.icon}
        {item.label}
      </Link>
    );
  }
}

export default function ChallengeNav({ challengeId }: ChallengeNavProps) {
  const pathname = usePathname();
  const display = useDisplay();

  const [challenge] = useContext(ChallengeContext) as [
    Challenge | null,
    unknown,
  ];
  const navRef = useRef<HTMLDivElement>(null);
  const activeItemRef = useRef<HTMLAnchorElement>(null);

  const [openDropdown, setOpenDropdown] = useState<Stage | null>(null);
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleDropdownOpen = (stage: Stage) => {
    if (closeTimeoutRef.current !== null) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    setOpenDropdown(stage);
  };

  const handleDropdownClose = () => {
    closeTimeoutRef.current = setTimeout(() => {
      setOpenDropdown(null);
      closeTimeoutRef.current = null;
    }, 150);
  };

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current !== null) {
        clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    // Scroll active item into view on mobile.
    if (display.isCompact() && activeItemRef.current && navRef.current) {
      const nav = navRef.current;
      const item = activeItemRef.current;
      const itemLeft = item.offsetLeft;
      const navWidth = nav.offsetWidth;
      const itemWidth = item.offsetWidth;

      nav.scrollLeft = itemLeft - (navWidth - itemWidth) / 2;
    }
  }, [pathname, display]);

  if (challenge === null) {
    return null;
  }

  let navItems: NavItem[] = [];

  switch (challenge.type) {
    case ChallengeType.TOB:
      navItems = TOB_NAV_ITEMS;
      break;
    case ChallengeType.COLOSSEUM:
      navItems = COLOSSEUM_NAV_ITEMS;
      break;
    case ChallengeType.INFERNO:
      navItems = INFERNO_NAV_ITEMS;
      break;
    case ChallengeType.MOKHAIOTL:
      navItems = MOKHAIOTL_NAV_ITEMS;
      break;
  }

  const isStageAccessible = (stage: Stage): boolean => {
    if (stage === Stage.UNKNOWN) {
      return true;
    }

    switch (challenge.type) {
      case ChallengeType.TOB: {
        const rooms = (challenge as TobRaid).tobRooms;

        switch (stage) {
          case Stage.TOB_MAIDEN:
            return !!rooms.maiden;
          case Stage.TOB_BLOAT:
            return !!rooms.bloat;
          case Stage.TOB_NYLOCAS:
            return !!rooms.nylocas;
          case Stage.TOB_SOTETSEG:
            return !!rooms.sotetseg;
          case Stage.TOB_XARPUS:
            return !!rooms.xarpus;
          case Stage.TOB_VERZIK:
            return !!rooms.verzik;
          default:
            return false;
        }
      }
      case ChallengeType.COLOSSEUM: {
        const waves = (challenge as ColosseumChallenge).colosseum.waves;
        const offset = stage - Stage.COLOSSEUM_WAVE_1;
        return offset < waves.length;
      }
      case ChallengeType.INFERNO: {
        const waves = (challenge as InfernoChallenge).inferno.waves;
        const offset = stage - Stage.INFERNO_WAVE_1;
        return offset < waves.length;
      }
      case ChallengeType.MOKHAIOTL: {
        const delves = (challenge as MokhaiotlChallenge).mokhaiotl.delves;
        const offset = stage - Stage.MOKHAIOTL_DELVE_1;
        return offset < delves.length;
      }
    }

    return false;
  };

  return (
    <nav className={styles.nav} data-blert-disable-sidebar="true">
      <div className={styles.navItems} ref={navRef}>
        {navItems.map((item) => (
          <NavItemComponent
            key={item.stage}
            item={item}
            challengeType={challenge.type}
            challengeId={challengeId}
            pathname={pathname}
            isStageAccessible={isStageAccessible}
            activeItemRef={activeItemRef}
            dropdownOpen={openDropdown === item.stage}
            onDropdownOpen={handleDropdownOpen}
            onDropdownClose={handleDropdownClose}
          />
        ))}
      </div>
    </nav>
  );
}
