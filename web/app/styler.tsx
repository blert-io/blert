'use client';

import { useEffect } from 'react';

export default function Styler() {
  useEffect(() => {
    let link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href =
      'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css';
    document.head.appendChild(link);
    document.title = 'Blert';
  }, []);

  return null;
}
