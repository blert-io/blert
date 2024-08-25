export function Mage({ children }: { children: React.ReactNode }) {
  return <span style={{ color: '#42c6d7' }}>{children}</span>;
}

export function Range({ children }: { children: React.ReactNode }) {
  return <span style={{ color: '#408d43' }}>{children}</span>;
}

export function Melee({ children }: { children: React.ReactNode }) {
  return <span style={{ color: '#fff' }}>{children}</span>;
}
