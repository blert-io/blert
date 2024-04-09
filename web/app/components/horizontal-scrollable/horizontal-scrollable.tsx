'use client';

import { useEffect, useRef } from 'react';

type HorizontalScrollableProps = React.HTMLAttributes<HTMLDivElement> & {
  customRef?: React.MutableRefObject<HTMLDivElement | null>;
};

export function HorizontalScrollable(props: HorizontalScrollableProps) {
  const { customRef, ...divProps } = props;

  const ref = useRef<HTMLDivElement | null>(null);

  const setRefs = (el: HTMLDivElement | null) => {
    ref.current = el;
    if (props.customRef) {
      props.customRef.current = el;
    }
  };

  useEffect(() => {
    const div = ref.current;
    if (div === null) {
      return () => {};
    }

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      div.scrollLeft += e.deltaY;
    };

    div.addEventListener('wheel', handleWheel, { passive: false });
    return () => div.removeEventListener('wheel', handleWheel);
  }, []);

  return (
    <div ref={setRefs} {...divProps}>
      {props.children}
    </div>
  );
}
