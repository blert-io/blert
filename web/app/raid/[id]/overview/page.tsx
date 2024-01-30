'use client';

import { useContext } from 'react';
import { RaidContext } from '../../context';

export default function Overview() {
  const raid = useContext(RaidContext);

  if (raid === null) {
    return <div>no raid placeholrder</div>;
  }

  return (
    <div>
      <div>
        {raid.party.map((p) => (
          <span>{p}</span>
        ))}
      </div>
    </div>
  );
}
