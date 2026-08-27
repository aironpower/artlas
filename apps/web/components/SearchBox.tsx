'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { t, type Lang } from '@/lib/i18n';

export default function SearchBox({ lang }: { lang: Lang }) {
  const router = useRouter();
  const [value, setValue] = useState('');

  return (
    <form
      className="search-form"
      onSubmit={(e) => {
        e.preventDefault();
        const q = value.trim();
        router.push(`/${lang}/buscar${q ? `?q=${encodeURIComponent(q)}` : ''}`);
      }}
    >
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t(lang, 'search')}
        aria-label={t(lang, 'search')}
      />
      <button className="btn" type="submit">{t(lang, 'searchAction')}</button>
    </form>
  );
}
