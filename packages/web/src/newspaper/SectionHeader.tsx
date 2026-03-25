import { useState } from 'react';
import { libraryImageUrl } from './types.ts';

type SectionHeaderProps = {
  name: string;
};

export default function SectionHeader({ name }: SectionHeaderProps) {
  const [failed, setFailed] = useState<boolean>(false);

  if (failed) {
    return null;
  }

  return (
    <img
      alt=""
      className="section-header-img"
      onError={() => setFailed(true)}
      src={libraryImageUrl(`headers/${name}.webp`)}
    />
  );
}
